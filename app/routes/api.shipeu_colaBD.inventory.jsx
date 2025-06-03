import { json } from "@remix-run/node";
import prisma from "../db.server";
import { verifyApiKey } from "../utils/auth.server.js";
import { processWebhookQueue } from "../services/webhookProcessor.server";

export async function action({ request }) {
  try {
    // Verificar API key
    const url = new URL(request.url);
    const apiKey = url.searchParams.get('api_key') || 
                  request.headers.get('X-API-Key') || 
                  request.headers.get('Authorization')?.replace("Bearer ", "");

    if (!apiKey) {
      return json({ error: 'API key required' }, { status: 401 });
    }
    
    const session = await verifyApiKey(apiKey, true);
    
    if (!session) {
      return json({ error: 'Invalid or expired API key' }, { status: 401 });
    }

    const { sku, quantity } = await request.json();
    
    if (!sku || quantity === undefined) {
      return json({ error: "Missing required parameters" }, { status: 400 });
    }

    // Convertir quantity a entero
    const quantityInt = parseInt(quantity, 10);
    if (isNaN(quantityInt)) {
      return json({ 
        error: "Invalid quantity format",
        details: "Quantity must be a valid number"
      }, { status: 400 });
    }

    // Autenticar con admin usando las credenciales de la sesión
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

    // 1. Buscar el producto por SKU y obtener su stock actual
    const searchResponse = await admin.graphql(
      `query searchVariant($locationId: ID!) {
        productVariants(first: 1, query: "sku:${sku}") {
          edges {
            node {
              id
              sku
              inventoryItem {
                id
                inventoryLevel(locationId: $locationId) {
                  id
                  quantities(names: ["available", "incoming", "committed", "damaged", "on_hand", "quality_control", "reserved", "safety_stock"]) {
                    name
                    quantity
                  }
                  location {
                    id
                  }
                }
              }
            }
          }
        }
      }`,
      {
        variables: {
          locationId: session.shipeuLocationId
        }
      }
    );

    const searchData = await searchResponse.json();

    if (searchData.errors) {
      return json({ 
        error: "Error querying product in Shopify",
        details: searchData.errors[0].message
      }, { status: 400 });
    }

    const variants = searchData.data?.productVariants?.edges || [];
    if (variants.length === 0) {
      return json({ 
        error: "Product not found",
        details: "No variant found with the exact SKU"
      }, { status: 404 });
    }

    const variant = variants[0].node;
    const quantities = variant.inventoryItem.inventoryLevel?.quantities || [];
    const onHandQuantity = quantities.find(q => q.name === 'on_hand')?.quantity || 0;

    // Verificar si el stock actual es igual al que queremos establecer
    if (onHandQuantity === quantityInt) {
      return json({ 
        success: true,
        message: "Stock already updated",
        data: {
          sku,
          quantity: quantityInt,
          currentStock: onHandQuantity,
          quantities,
          locationId: session.shipeuLocationId,
          skipped: true,
          timestamp: new Date().toISOString()
        }
      });
    }

    // 2. Actualizar el inventario en Shopify
    const updateResponse = await admin.graphql(
      `mutation InventorySet($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          inventoryAdjustmentGroup {
            createdAt
            reason
            changes {
              name
              delta
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          input: {
            name: "available",
            reason: "correction",
            ignoreCompareQuantity: true,
            quantities: [{
              inventoryItemId: variant.inventoryItem.id,
              locationId: session.shipeuLocationId,
              quantity: quantityInt
            }]
          }
        }
      }
    );

    const updateData = await updateResponse.json();

    // Verificar errores de GraphQL
    if (updateData.errors) {
      return json({ 
        error: "Shopify mutation error",
        details: updateData.errors[0].message
      }, { status: 400 });
    }

    // Verificar userErrors de la mutación
    if (updateData.data?.inventorySetQuantities?.userErrors?.length > 0) {
      const userError = updateData.data.inventorySetQuantities.userErrors[0];
      return json({ 
        error: "Shopify validation error",
        details: userError.message
      }, { status: 400 });
    }

    // Crear el webhook en la base de datos
    const webhook = await prisma.webhookQueue.create({
      data: {
        shop: session.shop,
        topic: 'shipeu_inventory_update',
        payload: JSON.stringify({
          sku,
          quantity: quantityInt,
          locationId: session.shipeuLocationId,
          source: 'shipeu'
        }),
        status: 'pending',
        attempts: 0
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
        return json({ 
          success: true,
          message: "Update processed successfully",
          data: {
            sku,
            quantity: quantityInt,
            timestamp: new Date().toISOString(),
            shopifyUpdate: {
              success: true,
              adjustmentGroup: updateData.data.inventorySetQuantities.inventoryAdjustmentGroup.changes
            }
          }
        });
      }

      return json({ 
        success: true,
        message: "Update queued successfully",
        data: {
          webhookId: webhook.id,
          sku,
          quantity: quantityInt,
          timestamp: new Date().toISOString(),
          shopifyUpdate: {
            success: true,
            adjustmentGroup: updateData.data.inventorySetQuantities.inventoryAdjustmentGroup.changes
          },
          webhookStatus: processedWebhook.status
        }
      });
    } catch (error) {
      // Si hay un error en el procesamiento, actualizamos el estado del webhook
      await prisma.webhookQueue.update({
        where: { id: webhook.id },
        data: {
          status: 'error',
          attempts: 1,
          error: JSON.stringify({
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            timestamp: new Date().toISOString()
          }),
          processedAt: new Date()
        }
      });

      return json({ 
        success: true,
        message: "Update queued but processing failed",
        data: {
          webhookId: webhook.id,
          sku,
          quantity: quantityInt,
          timestamp: new Date().toISOString(),
          shopifyUpdate: {
            success: true,
            adjustmentGroup: updateData.data.inventorySetQuantities.inventoryAdjustmentGroup.changes
          },
          error: error.message
        }
      });
    }

  } catch (error) {
    console.error("Error queueing inventory update:", error);
    return json({ 
      error: "Internal server error",
      details: error.message 
    }, { status: 500 });
  }
} 