import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { v4 as uuidv4 } from 'uuid';
import { processWebhookQueue } from "../services/webhookProcessor.server";

// Agregar un Set para tracking de webhooks procesados
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
    return {
      valid: false,
      error: `Missing required fields: ${missingFields.join(', ')}`
    };
  }

  return { valid: true };
}

function extractLocationId(locationGid) {
  if (!locationGid) return null;
  // Si es solo número, convertirlo a entero
  if (/^\d+$/.test(locationGid)) return parseInt(locationGid, 10);
  // Si es GID, extraer el número y convertirlo a entero
  const match = locationGid.match(/gid:\/\/shopify\/Location\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function formatInventoryItemGid(id) {
  // Si ya es un GID, devolverlo tal cual
  if (String(id).startsWith('gid://')) return id;
  // Si no, convertirlo a formato GID
  return `gid://shopify/InventoryItem/${id}`;
}

async function getInventoryItemDetails(admin, inventoryItemId) {
  try {
    const formattedId = formatInventoryItemGid(inventoryItemId);
    const response = await admin.graphql(
      `#graphql
      query getInventoryItem($id: ID!) {
        inventoryItem(id: $id) {
          id
          sku
          tracked
          variant {
            id
            title
            price
            inventoryQuantity
            product {
              id
              title
              status
              vendor
            }
          }
        }
      }`,
      {
        variables: {
          id: formattedId,
        },
      }
    );

    const responseJson = await response.json();
    return responseJson.data.inventoryItem;
  } catch (error) {
    throw error;
  }
}

async function syncWithShipeu({ sellerId, operation, data }) {
  const url = process.env.SHIPEU_URL || 'http://dev.shipeu.com/api/shopify';
  const apiKey = process.env.SHIPEU_API_KEY || '08afb311-1009-45a9-923e-0c032a4676e2';
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

    // Normalizar el topic a minúsculas y formato estándar
    const normalizedTopic = topic.toLowerCase();

    // Si es un webhook de eliminación, lo ignoramos inmediatamente
    if (normalizedTopic === 'inventory_items_delete') {
      return new Response(
        JSON.stringify({
          status: "ignored",
          reason: "delete_operation",
          timestamp: new Date().toISOString()
        }, null, 2),
        { 
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // Buscar la sesión más reciente
    const existingSession = await prisma.session.findFirst({
      where: { 
        shop: shop
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (!existingSession) {
      return new Response(
        JSON.stringify({
          error: "No session found",
          shop,
          timestamp: new Date().toISOString(),
          message: "Please ensure the app is properly installed and configured"
        }, null, 2),
        { 
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // Verificar si el payload incluye location_id
    const locationId = payload.location_id || payload.location?.id;
    if (locationId && !isRelevantLocation(locationId, existingSession.shipeuLocationId)) {
      return new Response(
        JSON.stringify({
          status: "ignored",
          reason: "location_mismatch",
          received_location: locationId,
          configured_location: existingSession.shipeuLocationId,
          timestamp: new Date().toISOString()
        }, null, 2),
        { 
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // Verificar si ya existe un webhook pendiente para la misma operación
    const existingWebhooks = await prisma.webhookQueue.findMany({
      where: {
        shop,
        topic: normalizedTopic,
        status: 'pending'
      }
    });

    // Verificar si hay un webhook con el mismo contenido
    const isDuplicate = existingWebhooks.some(existing => {
      try {
        const existingPayload = JSON.parse(existing.payload);
        
        // Para inventory_levels_update, comparar inventory_item_id y location_id
        if (normalizedTopic === 'inventory_levels_update') {
          return existingPayload.inventory_item_id === payload.inventory_item_id &&
                 existingPayload.location_id === payload.location_id;
        }
        
        // Para inventory_items_create, comparar id
        if (normalizedTopic === 'inventory_items_create') {
          return existingPayload.id === payload.id;
        }

        return false;
      } catch (e) {
        return false;
      }
    });

    if (isDuplicate) {
      // Si es un duplicado, respondemos como ignorado
      // Y disparamos de forma asíncrona el procesamiento de la cola general
      // para intentar procesar los webhooks fallidos (incluyendo el potencial original de este duplicado)
      processWebhookQueue().catch(console.error); // Llama a la cola general asíncronamente

      return new Response(
        JSON.stringify({
          status: "ignored",
          reason: "duplicate_operation",
          timestamp: new Date().toISOString()
        }, null, 2),
        { 
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // Crear el webhook en la BD
    const webhook = await prisma.webhookQueue.create({
      data: {
        id: uuidv4(),
        shop,
        topic: normalizedTopic,
        payload: JSON.stringify(payload),
        status: 'pending'
      }
    });

    // Procesar el webhook inmediatamente
    try {
      await processWebhookQueue(webhook.id);
      
      // Verificar el estado final del webhook
      const processedWebhook = await prisma.webhookQueue.findUnique({
        where: { id: webhook.id }
      });

      if (!processedWebhook) {
        // Si el webhook ya no existe, significa que fue procesado y eliminado exitosamente
        return new Response(
          JSON.stringify({
            status: "completed",
            topic: normalizedTopic,
            timestamp: new Date().toISOString(),
            webhookId: webhook.id
          }, null, 2),
          { 
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      return new Response(
        JSON.stringify({
          status: processedWebhook.status,
          topic: normalizedTopic,
          timestamp: new Date().toISOString(),
          webhookId: webhook.id
        }, null, 2),
        { 
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    } catch (error) {
      // Verificar si el webhook aún existe antes de actualizarlo
      const existingWebhook = await prisma.webhookQueue.findUnique({
        where: { id: webhook.id }
      });

      if (existingWebhook) {
        // Verificar si es un error 404 de Shipeu
        const isShipeu404 = error.message?.includes('Shipeu sync failed: 404');
        
        if (isShipeu404) {
          // Si es un 404, eliminamos el webhook en lugar de actualizarlo
          await prisma.webhookQueue.delete({
            where: { id: webhook.id }
          });

          return new Response(
            JSON.stringify({
              status: "ignored",
              reason: "shipeu_404",
              error: error.message,
              timestamp: new Date().toISOString()
            }, null, 2),
            { 
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          );
        }

        // Si no es un 404, procedemos con la actualización normal
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

        // Si el webhook actualizado tiene estado 'error', disparamos el procesador de cola
        if (attempts < 3) {
          processWebhookQueue().catch(console.error);
        }
      }

      return new Response(
        JSON.stringify({
          status: "error",
          error: error.message,
          webhookId: webhook.id,
          timestamp: new Date().toISOString()
        }, null, 2),
        { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        status: "error",
        error: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
        timestamp: new Date().toISOString()
      }, null, 2),
      { 
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}; 