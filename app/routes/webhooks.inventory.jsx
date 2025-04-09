import { authenticate } from "../shopify.server";
import prisma from "../db.server";

async function getInventoryItemDetails(admin, inventoryItemId) {
  try {
    console.log("[Shopify API] Fetching inventory item details for:", inventoryItemId);
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
          id: inventoryItemId,
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

async function syncWithShipeu({ sellerId, sku, operation, quantity = null }) {
  try {
    console.log(`[Shipeu Sync] Sending update to Shipeu:`, {
      sellerId,
      sku,
      operation,
      quantity
    });
    
    // Aquí implementarías la llamada real a la API de Shipeu
    // const response = await fetch('https://api.shipeu.com/inventory', {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'Authorization': `Bearer ${apiKey}`
    //   },
    //   body: JSON.stringify({
    //     sellerId,
    //     sku,
    //     operation,
    //     quantity
    //   })
    // });
    
    // return await response.json();
  } catch (error) {
    console.error("[Shipeu API] Error syncing with Shipeu:", error);
    throw error;
  }
}

export const action = async ({ request }) => {
  console.log("[Webhook Debug] ==========================================");
  console.log("[Webhook Debug] Starting inventory webhook handler");
  
  try {
    const { shop, admin, topic, payload } = await authenticate.webhook(request);

    console.log(`[Webhook Debug] Received ${topic} webhook for ${shop}`);
    console.log(`[Webhook Debug] Raw Payload:`, JSON.stringify(payload, null, 2));

    // Buscar la sesión activa
    const existingSession = await prisma.session.findFirst({
      where: { 
        shop: shop,
        isOnline: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

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

    // Manejar cada tipo de evento por separado
    switch (topic) {
      case "inventory_levels/update": {
        const { inventory_item_id, available, location_id } = payload;

        // Verificar si es la ubicación correcta
        if (location_id !== existingSession.shipeuLocationId) {
          console.log(`[Webhook Debug] Location mismatch. Expected: ${existingSession.shipeuLocationId}, Received: ${location_id}`);
          return new Response(
            JSON.stringify({
              status: "ignored",
              reason: "location_mismatch",
              received_location: location_id,
              configured_location: existingSession.shipeuLocationId,
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
              inventory_item_id,
              timestamp: new Date().toISOString()
            }, null, 2),
            { 
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          );
        }

        // Devolver la información relevante para Shipeu
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
      }

      case "inventory_items/create": {
        const { id, sku } = payload;
        
        if (!sku) {
          console.log(`[Webhook Debug] No SKU provided for new inventory item: ${id}`);
          return new Response(
            JSON.stringify({
              status: "error",
              reason: "no_sku_provided",
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
      }

      case "inventory_items/update": {
        const { id } = payload;
        const itemDetails = await getInventoryItemDetails(admin, id);
        
        if (!itemDetails?.sku) {
          console.log(`[Webhook Debug] No SKU found for updated inventory item: ${id}`);
          return new Response(
            JSON.stringify({
              status: "error",
              reason: "no_sku_found",
              inventory_item_id: id,
              timestamp: new Date().toISOString()
            }, null, 2),
            { 
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          );
        }

        return new Response(
          JSON.stringify({
            status: "success",
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
            },
            timestamp: new Date().toISOString()
          }, null, 2),
          { 
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      case "inventory_items/delete": {
        const { id } = payload;
        const itemDetails = await getInventoryItemDetails(admin, id);
        
        if (!itemDetails?.sku) {
          console.log(`[Webhook Debug] No SKU found for deleted inventory item: ${id}`);
          return new Response(
            JSON.stringify({
              status: "error",
              reason: "no_sku_found",
              inventory_item_id: id,
              timestamp: new Date().toISOString()
            }, null, 2),
            { 
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          );
        }

        return new Response(
          JSON.stringify({
            status: "success",
            operation: "delete_product",
            data: {
              sku: itemDetails.sku,
              inventory_item_id: id,
              product_title: itemDetails.variant?.product?.title,
              variant_title: itemDetails.variant?.title
            },
            timestamp: new Date().toISOString()
          }, null, 2),
          { 
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
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