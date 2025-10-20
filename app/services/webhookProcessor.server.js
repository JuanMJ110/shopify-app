import prisma from "../db.server";
import { v4 as uuidv4 } from 'uuid';

const BATCH_SIZE = 10;

export async function processWebhookQueue(specificWebhookId = null) {
  try {
    // Obtener webhooks pendientes o con error que necesiten reintento
    const pendingWebhooks = await prisma.webhookQueue.findMany({
      where: {
        ...(specificWebhookId ? { id: specificWebhookId } : {
          OR: [
            { status: 'pending' },
            {
              status: 'error',
              attempts: { lt: 3 }
            }
          ]
        })
      },
      orderBy: [
        { createdAt: 'asc' },
        { attempts: 'asc' }
      ],
      take: specificWebhookId ? 1 : BATCH_SIZE,
      select: {
        id: true,
        shop: true,
        topic: true,
        payload: true,
        status: true,
        attempts: true
      }
    });

    for (const webhook of pendingWebhooks) {
      try {
        const parsedPayload = JSON.parse(webhook.payload);
        
        // Verificar si ya existe un webhook pendiente para la misma operación
        const existingWebhooks = await prisma.webhookQueue.findMany({
          where: {
            shop: webhook.shop,
            topic: webhook.topic,
            status: 'pending',
            id: { not: webhook.id }
          },
          select: {
            id: true,
            payload: true
          }
        });

        // Verificar si hay un webhook con el mismo contenido
        const isDuplicate = existingWebhooks.some(existing => {
          try {
            const existingPayload = JSON.parse(existing.payload);
            
            // Para inventory_levels_update, comparar inventory_item_id y location_id
            if (webhook.topic === 'inventory_levels_update') {
              return existingPayload.inventory_item_id === parsedPayload.inventory_item_id &&
                     existingPayload.location_id === parsedPayload.location_id;
            }
            
            // Para inventory_items_create, comparar id
            if (webhook.topic === 'inventory_items_create') {
              return existingPayload.id === parsedPayload.id;
            }

            return false;
          } catch (e) {
            return false;
          }
        });

        if (isDuplicate) {
          // Si es duplicado, simplemente continuamos sin guardar nada
          continue;
        }

        await processWebhook(webhook);
      } catch (error) {
        await handleProcessingError(webhook, error);
        if (specificWebhookId) {
          throw error;
        }
      }
    }
  } catch (error) {
    throw error;
  }
}

async function processWebhook(webhook) {
  try {
    const parsedPayload = JSON.parse(webhook.payload);
    
    // Obtener la sesión de la tienda
    const session = await prisma.session.findFirst({
      where: { shop: webhook.shop },
      orderBy: { createdAt: 'desc' }
    });

    if (!session) {
      throw new Error('No session found for shop');
    }

    // Crear cliente admin
    const admin = createAdminClient(session);

    // Procesar según el tipo de webhook
    const { operation, data } = await determineOperation(webhook.topic, parsedPayload, admin);
    
    if (!operation) {
      // Si no hay operación, simplemente continuamos sin guardar nada
      return;
    }

    // Enviar a Shipeu
    const shipeuRequest = {
      sellerId: session.shipeuId,
      operation,
      ...data
    };

    try {
      const syncResult = await syncWithShipeu(shipeuRequest);
      const shipeuResponse = await syncResult.json();

      if (syncResult.status === 200) {
        // Eliminar el webhook de la base de datos después de procesamiento exitoso
        try {
          await prisma.webhookQueue.delete({
            where: { id: webhook.id }
          });
        } catch (deleteError) {
          // Si falla la eliminación, actualizamos el estado a 'completed'
          await prisma.webhookQueue.update({
            where: { id: webhook.id },
            data: {
              status: 'completed',
              processedAt: new Date()
            }
          });
        }
      } else {
        throw new Error(`Shipeu sync failed: ${syncResult.status}`);
      }
    } catch (error) {
      // Verificar si es el error específico de producto no encontrado
      if (error.message.includes('Product not found') && error.message.includes('status":"error"')) {
        // Eliminar el webhook sin procesar
        try {
          await prisma.webhookQueue.delete({
            where: { id: webhook.id }
          });
        } catch (deleteError) {
          // Si falla la eliminación, actualizamos el estado a 'completed'
          await prisma.webhookQueue.update({
            where: { id: webhook.id },
            data: {
              status: 'completed',
              processedAt: new Date()
            }
          });
        }
        return;
      }
      throw error;
    }
  } catch (error) {
    throw error;
  }
}

async function handleProcessingError(webhook, error) {
  try {
    const existingWebhook = await prisma.webhookQueue.findUnique({
      where: { id: webhook.id },
      select: {
        id: true,
        attempts: true
      }
    });

    if (!existingWebhook) {
      return;
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
  } catch (updateError) {
    // Si falla la actualización, no hacemos nada
  }
}

function createAdminClient(session) {
  return {
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
}

async function determineOperation(topic, payload, admin) {
  switch (topic) {
    case 'inventory_levels_update':
      return handleInventoryLevelsUpdate(payload, admin);
    case 'inventory_items_create':
      return handleInventoryItemsCreate(payload, admin);
    case 'shipeu_inventory_update':
      return handleShipeuInventoryUpdate(payload, admin);
    default:
      return { operation: null, data: null };
  }
}

async function handleInventoryLevelsUpdate(payload, admin) {
  const { inventory_item_id, new_quantity, location_id } = payload;
  
  const itemDetails = await getInventoryItemDetails(admin, inventory_item_id);
  
  if (!itemDetails?.sku) {
    throw new Error('No SKU found for inventory item');
  }

  return {
    operation: 'update_quantity',
    data: {
      sku: itemDetails.sku,
      new_quantity: new_quantity,
      product_title: itemDetails.variant?.product?.title,
      variant_title: itemDetails.variant?.title,
      price: itemDetails.variant?.price,
      inventory_item_id,
      location_id
    }
  };
}

async function handleInventoryItemsCreate(payload, admin) {
  const { id, sku } = payload;
  
  if (!sku) {
    throw new Error('No SKU provided');
  }

  const itemDetails = await getInventoryItemDetails(admin, id);

  return {
    operation: 'create_product',
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
  };
}

async function handleShipeuInventoryUpdate(payload, admin) {
  const { sku, quantity, locationId } = payload;
  
  // Buscar el producto por SKU
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
        locationId
      }
    }
  );

  const searchData = await searchResponse.json();
  const variants = searchData.data?.productVariants?.edges || [];
  const exactVariant = variants.find(v => v.node.sku === sku);
  
  if (!exactVariant) {
    throw new Error('Product not found');
  }

  const variant = exactVariant.node;
  
  return {
    operation: 'update_quantity',
    data: {
      sku,
      new_quantity: quantity,
      inventory_item_id: variant.inventoryItem.id,
      location_id: locationId
    }
  };
}

async function getInventoryItemDetails(admin, inventoryItemId) {
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
}

function formatInventoryItemGid(id) {
  if (String(id).startsWith('gid://')) return id;
  return `gid://shopify/InventoryItem/${id}`;
}

async function syncWithShipeu(request) {
  const shipeuApiUrl = `${process.env.SHIPEU_URL}/store/inventory`;
  try {
    const response = await fetch(shipeuApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SHIPEU_API_KEY}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify(request)
    });

    // Verificar el tipo de contenido
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      throw new Error(`Respuesta inválida del servidor Shipeu (${response.status}). Content-Type: ${contentType}, Respuesta: ${text.substring(0, 200)}...`);
    }

    const responseData = await response.json();

    // Verificar si es un error 404 de producto no encontrado
    if (response.status === 404 && 
        responseData.status === 'error' && 
        responseData.message === 'Product not found') {
      return {
        status: 404,
        json: async () => responseData
      };
    }

    // Verificar el estado de la respuesta
    if (!response.ok) {
      throw new Error(`Error del servidor Shipeu (${response.status}): ${JSON.stringify(responseData)}`);
    }

    return {
      status: response.status,
      json: async () => responseData
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Error al procesar la respuesta de Shipeu: ${error.message}`);
    }
    throw error;
  }
}  