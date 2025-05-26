import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { v4 as uuidv4 } from 'uuid';

// Cola simple en memoria
const webhookQueue = [];
let webhookProcessing = false;

// Agregar un Set para tracking de webhooks procesados
const processedWebhooks = new Set();

async function processWebhookQueue() {
  if (webhookProcessing) return;
  webhookProcessing = true;
  try {
    while (webhookQueue.length > 0) {
      const { id, request, resolve, body } = webhookQueue.shift();
      
      // Crear una clave única para el webhook
      const webhookKey = `${body.sku}-${body.operation}-${Date.now()}`;
      
      // Verificar si ya fue procesado recientemente (dentro de los últimos 5 minutos)
      if (processedWebhooks.has(webhookKey)) {
        resolve(new Response(
          JSON.stringify({
            status: "ignored",
            reason: "duplicate_webhook",
            timestamp: new Date().toISOString()
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        ));
        continue;
      }

      // Agregar a procesados
      processedWebhooks.add(webhookKey);
      
      // Limpiar webhooks antiguos (más de 5 minutos)
      setTimeout(() => {
        processedWebhooks.delete(webhookKey);
      }, 5 * 60 * 1000);

      // Filtra duplicados ANTES de procesar la petición actual
      for (let i = webhookQueue.length - 1; i >= 0; i--) {
        const item = webhookQueue[i];
        if (item.body.sku === body.sku && item.body.operation === body.operation) {
          webhookQueue.splice(i, 1); // Elimina duplicados
        }
      }

      try {
        // Clonar la request antes de procesarla
        const requestToProcess = request.clone();
        const result = await processWebhookRequest(requestToProcess);
        resolve(result);
        // Esperar 2 segundos antes de procesar el siguiente webhook
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        resolve(new Response(
          JSON.stringify({
            status: "error",
            error: "Queue processing error",
            details: err.message,
            timestamp: new Date().toISOString()
          }, null, 2),
          { status: 500, headers: { "Content-Type": "application/json" } }
        ));
      }
    }
  } finally {
    webhookProcessing = false;
  }
}

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
  return fetch('http://localhost/shipeu/public/api/shopify/store/inventory', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer 08afb311-1009-45a9-923e-0c032a4676e2`,
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

async function processWebhookRequest(request) {
  try {
    const { shop, admin, topic, payload } = await authenticate.webhook(request);

    // Normalizar el topic a minúsculas y formato estándar
    const normalizedTopic = topic.toLowerCase();

    // Buscar la sesión más reciente
    const existingSession = await prisma.session.findFirst({
      where: { 
        shop: shop
      },
      orderBy: {
        createdAt: 'desc'
      },
      select: {
        id: true,
        shop: true,
        shipeuLocationId: true,
        shipeuId: true,
        createdAt: true,
        updatedAt: true
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

    // Manejar cada tipo de evento por separado usando el topic normalizado
    switch (normalizedTopic) {
      case "inventory_levels_update": {
        const { inventory_item_id, available, location_id } = payload;

        // Verificar si es la ubicación correcta
        const normalizedConfiguredLocation = extractLocationId(existingSession.shipeuLocationId);
        const normalizedReceivedLocation = parseInt(location_id, 10);

        if (normalizedConfiguredLocation !== normalizedReceivedLocation) {
          return new Response(
            JSON.stringify({
              status: "ignored",
              reason: "location_mismatch",
              received_location: normalizedReceivedLocation,
              configured_location: parseInt(normalizedConfiguredLocation, 10),
              timestamp: new Date().toISOString()
            }, null, 2),
            { 
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          );
        }

        // Obtener detalles del item incluyendo SKU
        const itemDetails = await getInventoryItemDetails(admin, inventory_item_id);
        
        if (!itemDetails?.sku) {
          return new Response(
            JSON.stringify({
              status: "error",
              reason: "no_sku_found",
              case: "inventory_levels_update",
              inventoryItem: itemDetails,
              inventory_item_id,
              payload: payload,
              timestamp: new Date().toISOString()
            }, null, 2),
            { 
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          );
        }

        // Enviar a Shipeu
        let syncResult;
        try {
          syncResult = await syncWithShipeu({
            sellerId: existingSession.shipeuId,
            operation: "update_quantity",
            data: {
              sku: itemDetails.sku,
              new_quantity: available,
              product_title: itemDetails.variant?.product?.title,
              variant_title: itemDetails.variant?.title,
              price: itemDetails.variant?.price,
              inventory_item_id,
              location_id
            }
          });
        } catch (error) {
          // Maneja el error de reintentos aquí
          return new Response(
            JSON.stringify({
              status: "error",
              error: error.message,
              details: error.details,
              timestamp: new Date().toISOString()
            }, null, 2),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }

        if (syncResult.status === 200) {
          return new Response(
            JSON.stringify({
              status: "success",
              operation: "update_quantity",
              data: {
                sku: itemDetails.sku,
                new_quantity: available,
                product_title: itemDetails.variant?.product?.title,
                variant_title: itemDetails.variant?.title,
                price: itemDetails.variant?.price,
                inventory_item_id,
                location_id
              },
              payload: payload,
              timestamp: new Date().toISOString()
            }, null, 2),
            { 
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          );
        } else {
          return new Response(
            JSON.stringify({
              status: syncResult.status,
              source: syncResult.source,
              message: syncResult.message,
              receivedData: syncResult.receivedData,
              error: syncResult.error,
              payload: payload,
              timestamp: new Date().toISOString()
            }, null, 2),
            { 
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          );
        }
      }

      case "inventory_items_create": {
        const { id, sku } = payload;
        
        if (!sku) {
          return new Response(
            JSON.stringify({
              status: "error",
              reason: "no_sku_provided",
              case: "inventory_items_create",
              inventory_item_id: id,
              timestamp: new Date().toISOString()
            }, null, 2),
            { 
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          );
        }

        // Obtener detalles adicionales del producto
        const itemDetails = await getInventoryItemDetails(admin, id);

        // Enviar a Shipeu SOLO con retry en la llamada externa
        let syncResult;
        try {
          syncResult = await syncWithShipeu({
            sellerId: existingSession.shipeuId,
            operation: "create_product",
            data: {
              sku,
              inventory_item_id: id,
              product_title: itemDetails.variant?.product?.title,
              variant_title: itemDetails.variant?.title,
              price: itemDetails.variant?.price,
              vendor: itemDetails.variant?.product?.vendor,
              product_status: itemDetails.variant?.product?.status,
              tracked: itemDetails.tracked
            }
          });
        } catch (error) {
          return new Response(
            JSON.stringify({
              status: "error",
              error: error.message,
              details: error.details,
              timestamp: new Date().toISOString()
            }, null, 2),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }

        if (syncResult.status === 200) {
          return new Response(
            JSON.stringify({
              status: "success",
              operation: "create_product",
              data: {
                sku,
                inventory_item_id: id,
                product_title: itemDetails.variant?.product?.title,
                variant_title: itemDetails.variant?.title,
                price: itemDetails.variant?.price,
                vendor: itemDetails.variant?.product?.vendor,
                product_status: itemDetails.variant?.product?.status,
                tracked: itemDetails.tracked
              },
              timestamp: new Date().toISOString()
            }, null, 2),
            { 
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          );
        } else {
          return new Response(
            JSON.stringify({
              status: syncResult.status,
              source: syncResult.source,
              message: syncResult.message,
              receivedData: syncResult.receivedData,
              error: syncResult.error,
              timestamp: new Date().toISOString()
            }, null, 2),
            { 
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          );
        }
      }

      default:
        return new Response(
          JSON.stringify({
            status: "received",
            topic,
            timestamp: new Date().toISOString()
          }, null, 2),
          { 
            status: 200,
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
}

export const action = async ({ request }) => {
  const id = uuidv4();
  // Clonar la request antes de leer el body
  const clonedRequest = request.clone();
  const body = await clonedRequest.json();
  
  return new Promise((resolve) => {
    // Pasar la request original a la cola
    webhookQueue.push({ id, request, resolve, body });
    processWebhookQueue();
  });
}; 