import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { v4 as uuidv4 } from 'uuid';
import { processWebhookQueue } from "../services/webhookProcessor.server";

const processedWebhooks = new Set();

function validatePayload(payload, topic) {
  const requiredFields = {
    'inventory_levels/update': ['inventory_item_id', 'available', 'location_id'],
    'inventory_items/create': ['id', 'sku'],
    'inventory_items/update': ['id'],
    'inventory_items/delete': ['id']
  };
  const fields = requiredFields[topic];
  if (!fields) return { valid: true };
  const missingFields = fields.filter(field => !payload[field]);
  if (missingFields.length > 0) {
    return { valid: false, error: `Missing required fields: ${missingFields.join(', ')}` };
  }
  return { valid: true };
}

function extractLocationId(locationGid) {
  if (!locationGid) return null;
  if (/^\d+$/.test(locationGid)) return parseInt(locationGid, 10);
  const match = locationGid.match(/gid:\/\/shopify\/Location\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function formatInventoryItemGid(id) {
  if (String(id).startsWith('gid://')) return id;
  return `gid://shopify/InventoryItem/${id}`;
}

// Consulta on_hand usando admin_graphql_api_id, limpiando parámetros
async function obtenerExistenciaOnHand(existingSession, adminGraphqlApiId) {
  const gid = adminGraphqlApiId.split('?')[0];
  const url = `https://${existingSession.shop}/admin/api/2024-10/graphql.json`;
  const queryBody = {
    query: `query {
      inventoryLevel(id: "${gid}") {
        quantities(names: ["on_hand"]) {
          name
          quantity
        }
      }
    }`
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': existingSession.accessToken
    },
    body: JSON.stringify(queryBody)
  });
  if (!response.ok) throw new Error(`Error Shopify response: ${response.statusText}`);
  const result = await response.json();
  return result?.data?.inventoryLevel?.quantities?.find(q => q.name === "on_hand")?.quantity ?? null;
}

async function syncWithShipeu({ sellerId, operation, data }) {
  const url = process.env.SHIPEU_URL || 'http://dev.shipeu.com/api/shopify';
  const apiKey = process.env.SHIPEU_API_KEY;
  return fetch(`${url}/store/inventory`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      sellerId,
      operation,
      ...data
    })
  });
}

function isRelevantLocation(locationId, configuredLocationId) {
  const normalizedConfigured = extractLocationId(configuredLocationId);
  const normalizedReceived = parseInt(locationId, 10);
  return normalizedConfigured === normalizedReceived;
}

export const action = async ({ request }) => {
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);
    const normalizedTopic = topic.toLowerCase();

    const validation = validatePayload(payload, normalizedTopic);
    if (!validation.valid) {
      return new Response(JSON.stringify({
        status: "error",
        error: validation.error,
        timestamp: new Date().toISOString()
      }, null, 2), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    if (normalizedTopic === 'inventory_items_delete') {
      return new Response(JSON.stringify({
        status: "ignored",
        reason: "delete_operation",
        timestamp: new Date().toISOString()
      }, null, 2), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const existingSession = await prisma.session.findFirst({ where: { shop }, orderBy: { createdAt: 'desc' } });
    if (!existingSession) {
      return new Response(JSON.stringify({
        error: "No session found",
        shop,
        timestamp: new Date().toISOString(),
        message: "Please ensure the app is properly installed and configured"
      }, null, 2), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const locationId = payload.location_id || payload.location?.id;
    if (locationId && !isRelevantLocation(locationId, existingSession.shipeuLocationId)) {
      return new Response(JSON.stringify({
        status: "ignored",
        reason: "location_mismatch",
        received_location: locationId,
        configured_location: existingSession.shipeuLocationId,
        timestamp: new Date().toISOString()
      }, null, 2), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const existingWebhooks = await prisma.webhookQueue.findMany({
      where: { shop, topic: normalizedTopic, status: 'pending' }
    });
    const isDuplicate = existingWebhooks.some(existing => {
      try {
        const p = JSON.parse(existing.payload);
        if (normalizedTopic === 'inventory_levels_update') {
          return p.inventory_item_id === payload.inventory_item_id && p.location_id === payload.location_id;
        }
        if (normalizedTopic === 'inventory_items_create') {
          return p.id === payload.id;
        }
        return false;
      } catch { return false; }
    });
    if (isDuplicate) {
      processWebhookQueue().catch(console.error);
      return new Response(JSON.stringify({
        status: "ignored",
        reason: "duplicate_operation",
        timestamp: new Date().toISOString()
      }, null, 2), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const webhookKey = `${shop}_${normalizedTopic}_${JSON.stringify(payload)}`;
    if (processedWebhooks.has(webhookKey)) {
      return new Response(JSON.stringify({
        status: "ignored",
        reason: "duplicate_in_execution",
        timestamp: new Date().toISOString()
      }, null, 2), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    processedWebhooks.add(webhookKey);

    let newQuantity = payload.available;
    if (normalizedTopic === 'inventory_levels_update' && payload.admin_graphql_api_id) {
      try {
        const onHand = await obtenerExistenciaOnHand(existingSession, payload.admin_graphql_api_id);
        if (onHand !== null) newQuantity = onHand;
      } catch (err) {
        console.error("Error obteniendo on_hand, usando available", err);
      }
    }

    const enrichedPayload = { ...payload, new_quantity: newQuantity };
    const webhook = await prisma.webhookQueue.create({
      data: {
        id: uuidv4(),
        shop,
        topic: normalizedTopic,
        payload: JSON.stringify(enrichedPayload),
        status: 'pending'
      }
    });

    try {
      await processWebhookQueue(webhook.id);
      const processedWebhook = await prisma.webhookQueue.findUnique({ where: { id: webhook.id } });
      if (!processedWebhook) {
        return new Response(JSON.stringify({
          status: "completed",
          topic: normalizedTopic,
          timestamp: new Date().toISOString(),
          webhookId: webhook.id
        }, null, 2), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        status: processedWebhook.status,
        topic: normalizedTopic,
        timestamp: new Date().toISOString(),
        webhookId: webhook.id
      }, null, 2), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (error) {
      const existingWebhook = await prisma.webhookQueue.findUnique({ where: { id: webhook.id } });
      if (existingWebhook) {
        const isShipeu404 = error.message?.includes('Shipeu sync failed: 404');
        if (isShipeu404) {
          await prisma.webhookQueue.delete({ where: { id: webhook.id } });
          return new Response(JSON.stringify({
            status: "ignored",
            reason: "shipeu_404",
            error: error.message,
            timestamp: new Date().toISOString()
          }, null, 2), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        const attempts = existingWebhook.attempts + 1;
        await prisma.webhookQueue.update({
          where: { id: webhook.id },
          data: {
            status: attempts >= 3 ? 'failed' : 'error',
            attempts,
            error: JSON.stringify({
              message: error.message,
              stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
              timestamp: new Date().toISOString()
            }),
            processedAt: new Date()
          }
        });
        if (attempts < 3) {
          processWebhookQueue().catch(console.error);
        }
      }
      return new Response(JSON.stringify({
        status: "error",
        error: error.message,
        webhookId: webhook.id,
        timestamp: new Date().toISOString()
      }, null, 2), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      status: "error",
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      timestamp: new Date().toISOString()
    }, null, 2), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
