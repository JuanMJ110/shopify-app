import { authenticate } from "../shopify.server";
import prisma from "../db.server";

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
    console.log("[Shopify API] Fetching inventory item details for:", formattedId);
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
    console.log("[Shopify API] Response:", JSON.stringify(responseJson, null, 2));
    return responseJson.data.inventoryItem;
  } catch (error) {
    console.error("[Shopify API] Error fetching inventory item details:", error);
    throw error;
  }
}

async function syncWithShipeu({ sellerId, operation, data }) {
  try {
    console.log(`[Shipeu Sync] Sending update to Shipeu:`, {
      sellerId,
      operation,
      data
    });
    
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
      return {
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
    }

    try {
      const jsonResponse = JSON.parse(responseText);
      
      // Verificar si la respuesta es un error de validación
      if (response.status >= 400) {
        return {
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
      }

      // Respuesta exitosa
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
      return {
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
    }

  } catch (error) {
    return {
      success: false,
      status: 'error',
      source: 'shipeu',
      message: 'Error communicating with Shipeu',
      receivedData: {
        sellerId,
        operation,
        ...data
      },
      error: {
        message: error.message,
        stack: error.stack
      }
    };
  }
}

function isRelevantLocation(locationId, configuredLocationId) {
  const normalizedConfigured = extractLocationId(configuredLocationId);
  const normalizedReceived = parseInt(locationId, 10);
  return normalizedConfigured === normalizedReceived;
}

export const action = async ({ request }) => {
  console.log("[Webhook Debug] ==========================================");
  console.log("[Webhook Debug] Starting inventory webhook handler");
  
  try {
    const { shop, admin, topic, payload } = await authenticate.webhook(request);

    // Normalizar el topic a minúsculas y formato estándar
    const normalizedTopic = topic.toLowerCase();
    console.log(`[Webhook Debug] Original topic: ${topic}, Normalized: ${normalizedTopic}`);
    console.log(`[Webhook Debug] Received webhook for ${shop}`);
    console.log(`[Webhook Debug] Raw Payload:`, JSON.stringify(payload, null, 2));

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

    console.log(`[Webhook Debug] Session search result:`, existingSession ? {
      id: existingSession.id,
      shop: existingSession.shop,
      shipeuLocationId: existingSession.shipeuLocationId,
      shipeuId: existingSession.shipeuId,
      createdAt: existingSession.createdAt,
      updatedAt: existingSession.updatedAt
    } : 'No session found');

    if (!existingSession) {
      console.log(`[Webhook Debug] No session found for shop ${shop}`);
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
      console.log(`[Webhook Debug] Location mismatch. Expected: ${existingSession.shipeuLocationId}, Received: ${locationId}`);
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
          console.log(`[Webhook Debug] Location mismatch. Expected: ${normalizedConfiguredLocation}, Received: ${normalizedReceivedLocation}`);
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
          console.log(`[Webhook Debug] No SKU found for inventory item: ${inventory_item_id}`);
          return new Response(
            JSON.stringify({
              status: "error",
              reason: "no_sku_found",
              case: "inventory_levels_update",
              inventoryItem: itemDetails,
              inventory_item_id,
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

      case "inventory_items_create": {
        const { id, sku } = payload;
        
        if (!sku) {
          console.log(`[Webhook Debug] No SKU provided for new inventory item: ${id}`);
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

      case "inventory_items_update": {
        const { id } = payload;
        const itemDetails = await getInventoryItemDetails(admin, id);
        
        if (!itemDetails?.sku) {
          console.log(`[Webhook Debug] No SKU found for updated inventory item: ${id}`);
          return new Response(
            JSON.stringify({
              status: "error",
              reason: "no_sku_found",
              case: "inventory_items_update",
              inventory_item_id: id,
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
          operation: "update_product",
          data: {
            sku: itemDetails.sku,
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
              operation: "update_product",
              data: {
                sku: itemDetails.sku,
                inventory_item_id: id,
                product_title: itemDetails.variant?.product?.title,
                variant_title: itemDetails.variant?.title,
                price: itemDetails.variant?.product?.price,
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

      case "inventory_items_delete": {
        const { id } = payload;
        
        // Enviar a Shipeu
        const syncResult = await syncWithShipeu({
          sellerId: existingSession.shipeuId,
          operation: "delete_product",
          data: {
            inventory_item_id: id
          }
        });

        if (syncResult.success) {
          return new Response(
            JSON.stringify({
              status: "success",
              operation: "delete_product",
              data: {
                inventory_item_id: id,
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
    console.error(`[Webhook Error] Failed to process inventory webhook:`, error);
    return new Response(
      JSON.stringify({
        status: "error",
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      }, null, 2),
      { 
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}; 