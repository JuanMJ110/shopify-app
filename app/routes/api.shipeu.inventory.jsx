import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Función para verificar la clave API
async function verificarApiKey(apiKey) {
  if (!apiKey) return null;
  
  const session = await prisma.session.findFirst({
    where: {
      apiKey,
      shipeuStatus: "active"
    }
  });
  
  return session;
}

export async function action({ request }) {
  
  // Verificar API key
  const url = new URL(request.url);
  const apiKey = url.searchParams.get('api_key') || 
                request.headers.get('X-API-Key') || 
                request.headers.get('Authorization')?.replace("Bearer ", "");

  if (!apiKey) {
    return json({ error: 'Se requiere clave API' }, { status: 401 });
  }
  
  try {
    const session = await verificarApiKey(apiKey);
    
    if (!session) {
      return json({ error: 'Clave API inválida o expirada' }, { status: 401 });
    }

    // Verificar si la última actualización fue muy reciente (menos de 5 segundos)
    if (session.lastSync && (new Date() - new Date(session.lastSync)) < 5000) {
      return json({ 
        error: "Actualización ignorada",
        details: "Se detectó una actualización reciente, evitando duplicados",
        debug: {
          lastSync: session.lastSync,
          timeSinceLastSync: new Date() - new Date(session.lastSync)
        }
      }, { status: 409 }); // 409 Conflict
    }

    if (!session.shipeuLocationId) {
      return json({ 
        error: "Configuración incompleta",
        details: "No hay locationId configurado para esta sesión",
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
      return json({ error: "Faltan parámetros requeridos" }, { status: 400 });
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
      `query searchVariant($sku: String!, $locationId: ID!) {
        productVariants(first: 1, query: $sku) {
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
          sku: sku,
          locationId: session.shipeuLocationId
        }
      }
    );

    const searchData = await searchResponse.json();
    console.log('Respuesta de búsqueda:', searchData);

    if (searchData.errors) {
      return json({ 
        error: "Error consultando el producto en Shopify",
        details: searchData.errors[0].message
      }, { status: 400 });
    }

    const variant = searchData.data?.productVariants?.edges?.[0]?.node;
    
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
    if (currentStock === quantity) {
      console.log('Stock ya actualizado para la ubicación específica', {
        sku,
        currentStock,
        newQuantity: quantity,
        locationId: session.shipeuLocationId
      });
      
      return json({ 
        success: true,
        message: "Stock ya actualizado",
        data: {
          sku,
          quantity,
          currentStock,
          locationId: session.shipeuLocationId,
          skipped: true
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
              quantity: quantity
            }]
          }
        }
      }
    );

    const updateData = await updateResponse.json();

    // Verificar errores de GraphQL primero
    if (updateData.errors) {
      return json({ 
        error: "Error en la mutación de Shopify",
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
        error: "Error de validación en Shopify",
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
      return json({ 
        error: "No se pudo confirmar la actualización",
        details: "La respuesta de Shopify no incluye la confirmación esperada",
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
      message: "Inventario actualizado correctamente",
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
    console.error("Error actualizando inventario:", error);
    return json({ 
      error: "Error interno del servidor",
      details: error.message 
    }, { status: 500 });
  }
} 