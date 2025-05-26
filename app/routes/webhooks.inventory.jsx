import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { v4 as uuidv4 } from 'uuid';

// Agregar un Set para tracking de webhooks procesados
const processedWebhooks = new Set();

async function processWebhookQueue() {
  try {
    // Obtener webhooks pendientes de la BD
    const pendingWebhooks = await prisma.webhookQueue.findMany({
      where: {
        status: 'pending'
      },
      orderBy: {
        createdAt: 'asc'
      },
      take: 10 // Procesar en lotes para evitar sobrecargar el sistema
    });

    for (const webhook of pendingWebhooks) {
      // Crear una clave única para el webhook usando el ID de la BD
      const webhookKey = `${webhook.id}`;
      
      // Verificar si ya fue procesado recientemente (dentro de los últimos 5 minutos)
      if (processedWebhooks.has(webhookKey)) {
        // Este caso podría ocurrir si el worker se reinicia antes de actualizar el estado a 'ignored'
        // Lo marcamos como error para investigación si es necesario
        await prisma.webhookQueue.update({
          where: { id: webhook.id },
          data: { 
            status: 'error',
            error: JSON.stringify({ reason: 'duplicate_processing_attempt' })
          }
        });
        continue;
      }

      // Agregar a procesados
      processedWebhooks.add(webhookKey);
      
      // Limpiar webhooks antiguos (más de 5 minutos)
      setTimeout(() => {
        processedWebhooks.delete(webhookKey);
      }, 5 * 60 * 1000);

      let parsedPayload;
      try {
        parsedPayload = JSON.parse(webhook.payload);
      } catch (parseError) {
        await prisma.webhookQueue.update({
          where: { id: webhook.id },
          data: { 
            status: 'error',
            error: JSON.stringify({ message: 'Failed to parse payload', details: parseError.message })
          }
        });
        continue;
      }

      try {
        // Obtener la sesión de la tienda
        const session = await prisma.session.findFirst({
          where: { 
            shop: webhook.shop
          },
          orderBy: {
            createdAt: 'desc'
          }
        });

        if (!session) {
          await prisma.webhookQueue.update({
            where: { id: webhook.id },
            data: { 
              status: 'error',
              error: JSON.stringify({ message: 'No session found for shop' })
            }
          });
          continue;
        }

        // Crear cliente admin usando la sesión
        const admin = {
          graphql: async (query, options = {}) => {
            const shopifyDomain = `https://${session.shop}`;
            const url = `${shopifyDomain}/admin/api/2024-10/graphql.json`;
            
            const response = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': session.accessToken
              },
              body: JSON.stringify({ 
                query,
                variables: options.variables
              })
            });

            return response;
          }
        };

        let itemDetails = null;
        let shipeuOperation = '';
        let shipeuData = {};

        // Procesar el webhook según su tipo
        if (webhook.topic === 'inventory_levels_update') {
          shipeuOperation = 'update_quantity';
          const { inventory_item_id, available, location_id } = parsedPayload;

          // Verificar si es la ubicación correcta (re-check por si no se filtró en action)
           if (location_id && !isRelevantLocation(location_id, session.shipeuLocationId)) {
              await prisma.webhookQueue.update({
                where: { id: webhook.id },
                data: { 
                  status: 'ignored',
                  error: JSON.stringify({
                    reason: "location_mismatch",
                    received_location: location_id,
                    configured_location: session.shipeuLocationId
                  })
                }
              });
              continue;
            }

          itemDetails = await getInventoryItemDetails(admin, inventory_item_id);
          
          if (!itemDetails?.sku) {
            await prisma.webhookQueue.update({
              where: { id: webhook.id },
              data: { 
                status: 'error',
                error: JSON.stringify({ 
                  reason: 'no_sku_found',
                  case: 'inventory_levels_update',
                  inventoryItem: itemDetails,
                  inventory_item_id,
                  payload: parsedPayload
                })
              }
            });
            continue;
          }

          shipeuData = {
            sku: itemDetails.sku,
            new_quantity: available,
            product_title: itemDetails.variant?.product?.title,
            variant_title: itemDetails.variant?.title,
            price: itemDetails.variant?.price,
            inventory_item_id,
            location_id
          };

        } else if (webhook.topic === 'inventory_items_create') {
          shipeuOperation = 'create_product';
          const { id, sku } = parsedPayload;

          if (!sku) {
             await prisma.webhookQueue.update({
              where: { id: webhook.id },
              data: { 
                status: 'error',
                error: JSON.stringify({
                  reason: 'no_sku_provided',
                  case: 'inventory_items_create',
                  inventory_item_id: id,
                  payload: parsedPayload
                })
              }
            });
            continue;
          }

          itemDetails = await getInventoryItemDetails(admin, id);

          shipeuData = {
            sku,
            inventory_item_id: id,
            product_title: itemDetails.variant?.product?.title,
            variant_title: itemDetails.variant?.title,
            price: itemDetails.variant?.price,
            vendor: itemDetails.variant?.product?.vendor,
            product_status: itemDetails.variant?.product?.status,
            tracked: itemDetails.tracked
          };
        } else {
             // Tema no manejado, marcar como completado/ignorado
             await prisma.webhookQueue.update({
              where: { id: webhook.id },
              data: { 
                status: 'ignored',
                error: JSON.stringify({ reason: 'unhandled_topic', topic: webhook.topic })
              }
            });
            continue;
        }

        // Enviar a Shipeu si se determinó una operación
        if (shipeuOperation) {
            let syncResult;
            let shipeuResponse = null;
            let shipeuRequest = { sellerId: session.shipeuId, operation: shipeuOperation, data: shipeuData };

            try {
              syncResult = await syncWithShipeu(shipeuRequest);
              shipeuResponse = await syncResult.json();

              if (syncResult.status === 200) {
                await prisma.webhookQueue.update({
                  where: { id: webhook.id },
                  data: { 
                    status: 'completed',
                    processedAt: new Date(),
                    error: JSON.stringify({ message: 'Successfully processed', request: shipeuRequest, response: shipeuResponse })
                  }
                });
              } else {
                 // Manejar errores de Shipeu API
                await prisma.webhookQueue.update({
                  where: { id: webhook.id },
                  data: { 
                    status: 'error',
                    error: JSON.stringify({
                      message: `Shipeu sync failed: ${syncResult.status}`,
                      statusCode: syncResult.status,
                      response: shipeuResponse,
                      request: shipeuRequest
                    }),
                    processedAt: new Date(),
                  }
                });
              }

            } catch (syncError) {
               // Manejar errores de la llamada fetch (red, parseo, etc.)
               let errorDetails = { message: syncError.message };
               if (process.env.NODE_ENV === "development") errorDetails.stack = syncError.stack;

               await prisma.webhookQueue.update({
                 where: { id: webhook.id },
                 data: { 
                   status: 'error',
                   error: JSON.stringify({ message: 'Shipeu sync failed', details: errorDetails, request: shipeuRequest, response: shipeuResponse }),
                   processedAt: new Date(),
                 }
               });
            }
        }

        // Esperar 2 segundos antes de procesar el siguiente webhook para evitar saturar Shopify/Shipeu
        await new Promise(r => setTimeout(r, 2000));

      } catch (processingError) {
        // Manejar errores generales durante el procesamiento (obtener item details, etc.)
        let errorDetails = { message: processingError.message };
        if (process.env.NODE_ENV === "development") errorDetails.stack = processingError.stack;

        await prisma.webhookQueue.update({
          where: { id: webhook.id },
          data: { 
            status: 'error',
            error: JSON.stringify({ message: 'Webhook processing failed', details: errorDetails }),
            processedAt: new Date()
          }
        });
      }
    }
  } catch (queueError) {
    console.error('Error fetching or iterating webhook queue:', queueError);
    // Considerar agregar logging o notificación si esta parte falla consistentemente
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

export const action = async ({ request }) => {
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);

    // Normalizar el topic a minúsculas y formato estándar
    const normalizedTopic = topic.toLowerCase();

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

    // Guardar el webhook en la BD
    await prisma.webhookQueue.create({
      data: {
        id: uuidv4(),
        shop,
        topic: normalizedTopic,
        payload: JSON.stringify(payload),
        status: 'pending',
        // Los campos específicos del payload se extraen en processWebhookQueue
      }
    });

    // Iniciar el procesamiento de la cola
    processWebhookQueue();

    return new Response(
      JSON.stringify({
        status: "queued",
        topic: normalizedTopic,
        timestamp: new Date().toISOString()
      }, null, 2),
      { 
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
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