import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { verifyApiKey } from "../utils/auth.server.js";

// Función para verificar la clave API
// async function verificarApiKey(apiKey) { // <--- Eliminada
//   if (!apiKey) return null;
//   
//   const session = await prisma.session.findFirst({
//     where: {
//       apiKey,
//       shipeuStatus: "active"
//     }
//   });
//   
//   return session;
// }

// Cola simple en memoria
const inventoryQueue = [];
let processing = false;

async function processQueue() {
  if (processing) return;
  processing = true;
  while (inventoryQueue.length > 0) {
    const { id, request, resolve } = inventoryQueue.shift();
    const body = await request.clone().json();
    
    // Elimina duplicados de la cola (excepto el que se está procesando)
    const filteredQueue = inventoryQueue.filter(item => {
      const itemBody = item.request.body ? JSON.parse(item.request.body) : {};
      return (itemBody.sku !== body.sku) || item.id === id;
    });
    
    // Actualiza la cola con los elementos filtrados
    inventoryQueue.length = 0;
    inventoryQueue.push(...filteredQueue);
    
    try {
      const result = await processInventoryRequest(request);
      resolve(result);
      await new Promise(r => setTimeout(r, 1000)); // Espera 1 segundo
    } catch (err) {
      resolve(json({ error: "Queue processing error", details: err.message }, { status: 500 }));
    }
  }
  processing = false;
}

export async function action({ request }) {
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    inventoryQueue.push({ id, request, resolve });
    processQueue();
  });
}

async function processInventoryRequest(request) {
  // Verificar API key
  const url = new URL(request.url);
  const apiKey = url.searchParams.get('api_key') || 
                request.headers.get('X-API-Key') || 
                request.headers.get('Authorization')?.replace("Bearer ", "");

  if (!apiKey) {
    return json({ error: 'API key required' }, { status: 401 });
  }
  
  try {
    const session = await verifyApiKey(apiKey, true);
    
    if (!session) {
      return json({ error: 'Invalid or expired API key' }, { status: 401 });
    }

    // Verificar si la última actualización fue muy reciente (menos de 5 segundos)
    if (session.lastSync && (new Date() - new Date(session.lastSync)) < 1000) {
      return json({ 
        error: "Update ignored",
        details: "Recent update detected, avoiding duplicates",
        debug: {
          lastSync: session.lastSync,
          timeSinceLastSync: new Date() - new Date(session.lastSync)
        }
      }, { status: 409 }); // 409 Conflict
    }

    if (!session.shipeuLocationId) {
      return json({ 
        error: "Incomplete configuration",
        details: "No locationId configured for this session",
        debug: {
          session: {
            shop: session.shop,
            locationId: session.shipeuLocationId
          }
        }
      }, { status: 400 });
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
        productVariants(first: 10, query: "sku:${sku}") {
          edges {
            node {
              id
              sku
              inventoryItem {
                id
                inventoryLevel(locationId: $locationId) {
                  id
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
    console.log('Respuesta de búsqueda:', searchData);

    if (searchData.errors) {
      return json({ 
        error: "Error querying product in Shopify",
        details: searchData.errors[0].message
      }, { status: 400 });
    }

    const variants = searchData.data?.productVariants?.edges || [];
    const exactVariant = variants.find(v => v.node.sku === sku);
    
    if (!exactVariant) {
      return json({ 
        error: "Product not found",
        details: "No variant found with the exact SKU"
      }, { status: 404 });
    }

    const variant = exactVariant.node;
    
    // Obtener el nivel de inventario actual usando una consulta separada
    const inventoryResponse = await admin.graphql(
      `query getInventoryLevel($inventoryItemId: ID!, $locationId: ID!) {
        inventoryLevel(inventoryItemId: $inventoryItemId, locationId: $locationId) {
          id
          available
        }
      }`,
      {
        variables: {
          inventoryItemId: variant?.inventoryItem?.id,
          locationId: session.shipeuLocationId
        }
      }
    );

    const inventoryData = await inventoryResponse.json();
    const currentStock = inventoryData.data?.inventoryLevel?.available || 0;

    // Verificar si el stock actual es igual al que queremos establecer
    if (currentStock === quantityInt) {
      console.log('Stock ya actualizado para la ubicación específica', {
        sku,
        currentStock,
        newQuantity: quantityInt,
        locationId: session.shipeuLocationId
      });
      
      // Actualizar lastSync incluso cuando el stock ya está actualizado
      await prisma.session.update({
        where: { id: session.id },
        data: { lastSync: new Date() }
      });
      
      return json({ 
        success: true,
        message: "Stock already updated",
        data: {
          sku,
          quantity,
          currentStock,
          locationId: session.shipeuLocationId,
          skipped: true,
          timestamp: new Date().toISOString()
        }
      });
    }

    // 2. Actualizar el inventario
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

    // Verificar errores de GraphQL primero
    if (updateData.errors) {
      return json({ 
        error: "Shopify mutation error",
        details: updateData.errors[0].message,
        debug: {
          errors: updateData.errors,
          session: {
            shop: session.shop,
            locationId: session.shipeuLocationId
          },
          variant: {
            id: variant.id,
            sku: variant.sku,
            inventoryItemId: variant.inventoryItem.id
          },
          request: {
            quantity,
            locationId: session.shipeuLocationId
          }
        }
      }, { status: 400 });
    }

    // Verificar userErrors de la mutación
    if (updateData.data?.inventorySetQuantities?.userErrors?.length > 0) {
      const userError = updateData.data.inventorySetQuantities.userErrors[0];
      return json({ 
        error: "Shopify validation error",
        details: userError.message,
        debug: {
          userErrors: updateData.data.inventorySetQuantities.userErrors,
          session: {
            shop: session.shop,
            locationId: session.shipeuLocationId
          },
          variant: {
            id: variant.id,
            sku: variant.sku,
            inventoryItemId: variant.inventoryItem.id
          },
          request: {
            quantity,
            locationId: session.shipeuLocationId
          }
        }
      }, { status: 400 });
    }

    // Verificar que tenemos una respuesta válida
    if (!updateData.data?.inventorySetQuantities?.inventoryAdjustmentGroup?.changes?.length > 0) {
      // Si no hay cambios pero tampoco hay errores, asumimos que la actualización fue exitosa
      if (!updateData.data?.inventorySetQuantities?.userErrors?.length) {
        // Actualizar lastSync
        await prisma.session.update({
          where: { id: session.id },
          data: { lastSync: new Date() }
        });

        return json({ 
          success: true,
          message: "Inventory updated successfully",
          data: {
            sku,
            quantity,
            locationId: session.shipeuLocationId,
            inventoryItemId: variant.inventoryItem.id,
            timestamp: new Date().toISOString()
          }
        });
      }

      return json({ 
        error: "Could not confirm update",
        details: "Shopify response does not include expected confirmation",
        debug: {
          response: updateData,
          session: {
            shop: session.shop,
            locationId: session.shipeuLocationId
          },
          variant: {
            id: variant.id,
            sku: variant.sku,
            inventoryItemId: variant.inventoryItem.id
          },
          request: {
            quantity,
            locationId: session.shipeuLocationId
          }
        }
      }, { status: 500 });
    }

    // Solo actualizar lastSync si la mutación fue exitosa
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSync: new Date() }
    });

    // Respuesta exitosa
    return json({ 
      success: true,
      message: "Inventory updated successfully",
      data: {
        sku,
        quantity,
        locationId: session.shipeuLocationId,
        inventoryItemId: variant.inventoryItem.id,
        adjustmentGroup: updateData.data.inventorySetQuantities.inventoryAdjustmentGroup.changes,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error("Error updating inventory:", error);
    return json({ 
      error: "Internal server error",
      details: error.message 
    }, { status: 500 });
  }
} 