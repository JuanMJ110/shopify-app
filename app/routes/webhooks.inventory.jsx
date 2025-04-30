import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 segundo

async function retryOperation(operation, maxRetries = MAX_RETRIES) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (error.status === 429) { // Rate limit
        const retryAfter = error.headers?.get('Retry-After') || RETRY_DELAY;
        await new Promise(resolve => setTimeout(resolve, retryAfter));
      } else if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * Math.pow(2, i)));
      }
    }
  }
  throw lastError;
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
  return retryOperation(async () => {
    const response = await fetch('http://localhost/shipeu/public/api/shopify/store/inventory', {
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

    const responseText = await response.text();
    
    // Verificar si la respuesta es HTML
    if (responseText.trim().startsWith('<!DOCTYPE html>')) {
      const error = new Error('Received HTML response instead of JSON');
      error.details = {
        success: false,
        status: 'error',
        source: 'shipeu',
        message: 'Received HTML response instead of JSON',
        receivedData: {
          sellerId,
          operation,
          ...data
        },
        error: {
          status: response.status,
          response: responseText
        }
      };
      throw error;
    }

    try {
      const jsonResponse = JSON.parse(responseText);
      
      // Verificar si la respuesta es un error de validación
      if (response.status >= 400) {
        const error = new Error(jsonResponse.message || 'Error from Shipeu API');
        error.details = {
          success: false,
          status: 'error',
          source: 'shipeu',
          message: jsonResponse.message || 'Error from Shipeu API',
          receivedData: {
            sellerId,
            operation,
            ...data
          },
          error: {
            status: response.status,
            message: jsonResponse.message,
            details: jsonResponse
          }
        };
        throw error;
      }

      return {
        success: true,
        status: 'success',
        source: 'shipeu',
        message: 'Operation completed successfully',
        receivedData: {
          sellerId,
          operation,
          ...data
        },
        response: {
          ...jsonResponse,
          operation,
          timestamp: new Date().toISOString()
        }
      };
    } catch (parseError) {
      const error = new Error(`Failed to parse JSON response: ${parseError.message}`);
      error.details = {
        success: false,
        status: 'error',
        source: 'shipeu',
        message: 'Failed to parse JSON response',
        receivedData: {
          sellerId,
          operation,
          ...data
        },
        error: {
          message: parseError.message,
          response: responseText
        }
      };
      throw error;
    }
  });
}

function isRelevantLocation(locationId, configuredLocationId) {
  const normalizedConfigured = extractLocationId(configuredLocationId);
  const normalizedReceived = parseInt(locationId, 10);
  return normalizedConfigured === normalizedReceived;
}

export const action = async ({ request }) => {
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
        const syncResult = await syncWithShipeu({
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

        if (syncResult.success) {
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

        // Enviar a Shipeu
        const syncResult = await syncWithShipeu({
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

        if (syncResult.success) {
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
}; 