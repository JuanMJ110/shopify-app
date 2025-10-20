import prisma from "../db.server";
import { v4 as uuidv4 } from "uuid";

const BATCH_SIZE = 10;
const CLEANUP_INTERVAL_HOURS = 6;
const CLEANUP_AGE_DAYS = 7;

export async function processWebhookQueue(specificWebhookId = null) {
  try {
    // Limpieza periódica no bloqueante
    setImmediate(runCleanupOldWebhooks);

    const whereClause = specificWebhookId
      ? { id: specificWebhookId }
      : {
          OR: [
            { status: "pending" },
            { status: "error", attempts: { lt: 3 } },
          ],
        };

    const pendingWebhooks = await prisma.webhookQueue.findMany({
      where: whereClause,
      orderBy: [{ createdAt: "asc" }, { attempts: "asc" }],
      take: specificWebhookId ? 1 : BATCH_SIZE,
      select: {
        id: true,
        shop: true,
        topic: true,
        payload: true,
        status: true,
        attempts: true,
      },
    });

    for (const webhook of pendingWebhooks) {
      try {
        const parsedPayload = JSON.parse(webhook.payload);

        // Evita procesar duplicados simultáneos
        const existingWebhooks = await prisma.webhookQueue.findMany({
          where: {
            shop: webhook.shop,
            topic: webhook.topic,
            status: "pending",
            id: { not: webhook.id },
          },
          select: { id: true, payload: true },
        });

        const isDuplicate = existingWebhooks.some((existing) => {
          try {
            const existingPayload = JSON.parse(existing.payload);
            if (webhook.topic === "inventory_levels_update") {
              return (
                existingPayload.inventory_item_id === parsedPayload.inventory_item_id &&
                existingPayload.location_id === parsedPayload.location_id
              );
            }
            if (webhook.topic === "inventory_items_create") {
              return existingPayload.id === parsedPayload.id;
            }
            return false;
          } catch {
            return false;
          }
        });

        if (isDuplicate) continue;

        await processWebhook(webhook);
      } catch (error) {
        await handleProcessingError(webhook, error);
        if (specificWebhookId) throw error;
      }
    }
  } catch (error) {
    throw error;
  }
}

/** Procesa un solo webhook y elimina o marca completado */
async function processWebhook(webhook) {
  try {
    const parsedPayload = JSON.parse(webhook.payload);

    const session = await prisma.session.findFirst({
      where: { shop: webhook.shop },
      orderBy: { createdAt: "desc" },
    });
    if (!session) throw new Error("No session found for shop");

    const admin = createAdminClient(session);
    const { operation, data } = await determineOperation(
      webhook.topic,
      parsedPayload,
      admin
    );
    if (!operation) return;

    const shipeuRequest = {
      sellerId: session.shipeuId,
      operation,
      ...data,
    };

    const syncResult = await syncWithShipeu(shipeuRequest);
    const shipeuResponse = await syncResult.json();

    if (syncResult.status === 200) {
      await safeDeleteWebhook(webhook.id);
    } else if (
      syncResult.status === 404 &&
      shipeuResponse?.message === "Product not found"
    ) {
      await safeDeleteWebhook(webhook.id);
    } else {
      throw new Error(`Shipeu sync failed: ${syncResult.status}`);
    }
  } catch (error) {
    throw error;
  }
}

/** Elimina el webhook o lo marca como completado */
async function safeDeleteWebhook(id) {
  try {
    await prisma.webhookQueue.delete({ where: { id } });
  } catch {
    await prisma.webhookQueue.update({
      where: { id },
      data: { status: "completed", processedAt: new Date() },
    });
  }
}

/** Registra error y reintento controlado */
async function handleProcessingError(webhook, error) {
  try {
    const existing = await prisma.webhookQueue.findUnique({
      where: { id: webhook.id },
      select: { attempts: true },
    });
    if (!existing) return;

    const attempts = existing.attempts + 1;
    await prisma.webhookQueue.update({
      where: { id: webhook.id },
      data: {
        status: attempts >= 3 ? "failed" : "error",
        attempts,
        error: JSON.stringify({
          message: error.message,
          stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
          timestamp: new Date().toISOString(),
        }),
        processedAt: new Date(),
      },
    });
  } catch {}
}

/** Limpieza de webhooks antiguos (cada 6h, >7 días) */
let lastCleanup = 0;
async function runCleanupOldWebhooks() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_HOURS * 3600 * 1000) return;
  lastCleanup = now;

  const cutoffDate = new Date(Date.now() - CLEANUP_AGE_DAYS * 86400000);
  try {
    const deleted = await prisma.webhookQueue.deleteMany({
      where: {
        OR: [{ status: "completed" }, { status: "failed" }],
        processedAt: { lt: cutoffDate },
      },
    });
    if (deleted.count > 0)
      console.log(`[CLEANUP] Eliminados ${deleted.count} webhooks antiguos`);
  } catch (err) {
    console.error("Cleanup error:", err.message);
  }
}

/** Shopify helpers */
function createAdminClient(session) {
  return {
    graphql: async (query, options = {}) => {
      const url = `https://${session.shop}/admin/api/2024-10/graphql.json`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": session.accessToken,
        },
        body: JSON.stringify({
          query,
          variables: options.variables,
        }),
      });
      return response;
    },
  };
}

/** Determina tipo de operación a enviar */
async function determineOperation(topic, payload, admin) {
  switch (topic) {
    case "inventory_levels_update":
      return handleInventoryLevelsUpdate(payload, admin);
    case "inventory_items_create":
      return handleInventoryItemsCreate(payload, admin);
    case "shipeu_inventory_update":
      return handleShipeuInventoryUpdate(payload, admin);
    default:
      return { operation: null, data: null };
  }
}

/** Manejadores específicos (idénticos a los tuyos) */
async function handleInventoryLevelsUpdate(payload, admin) {
  const { inventory_item_id, new_quantity, location_id } = payload;
  const itemDetails = await getInventoryItemDetails(admin, inventory_item_id);
  if (!itemDetails?.sku) throw new Error("No SKU found for inventory item");
  return {
    operation: "update_quantity",
    data: {
      sku: itemDetails.sku,
      new_quantity,
      product_title: itemDetails.variant?.product?.title,
      variant_title: itemDetails.variant?.title,
      price: itemDetails.variant?.price,
      inventory_item_id,
      location_id,
    },
  };
}

async function handleInventoryItemsCreate(payload, admin) {
  const { id, sku } = payload;
  if (!sku) throw new Error("No SKU provided");
  const itemDetails = await getInventoryItemDetails(admin, id);
  return {
    operation: "create_product",
    data: {
      sku,
      inventory_item_id: id,
      product_title: itemDetails.variant?.product?.title,
      variant_title: itemDetails.variant?.title,
      price: itemDetails.variant?.price,
      vendor: itemDetails.variant?.product?.vendor,
      product_status: itemDetails.variant?.product?.status,
      tracked: itemDetails.tracked,
    },
  };
}

async function handleShipeuInventoryUpdate(payload, admin) {
  const { sku, quantity, locationId } = payload;
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
                location { id }
              }
            }
          }
        }
      }
    }`,
    { variables: { locationId } }
  );

  const searchData = await searchResponse.json();
  const variants = searchData.data?.productVariants?.edges || [];
  const exactVariant = variants.find((v) => v.node.sku === sku);
  if (!exactVariant) throw new Error("Product not found");

  const variant = exactVariant.node;
  return {
    operation: "update_quantity",
    data: {
      sku,
      new_quantity: quantity,
      inventory_item_id: variant.inventoryItem.id,
      location_id: locationId,
    },
  };
}

/** Detalles de item de inventario */
async function getInventoryItemDetails(admin, id) {
  const formattedId = formatInventoryItemGid(id);
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
    { variables: { id: formattedId } }
  );
  const json = await response.json();
  return json.data.inventoryItem;
}

function formatInventoryItemGid(id) {
  return String(id).startsWith("gid://")
    ? id
    : `gid://shopify/InventoryItem/${id}`;
}

/** Sincroniza con API de Shipeu */
async function syncWithShipeu(request) {
  const url = `${process.env.SHIPEU_URL}/store/inventory`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SHIPEU_API_KEY}`,
      Accept: "application/json",
    },
    body: JSON.stringify(request),
  });

  const contentType = response.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    const text = await response.text();
    throw new Error(
      `Respuesta inválida de Shipeu (${response.status}): ${text.substring(0, 200)}`
    );
  }

  const data = await response.json();
  if (response.status === 404 && data.message === "Product not found") {
    return { status: 404, json: async () => data };
  }
  if (!response.ok) {
    throw new Error(
      `Error Shipeu (${response.status}): ${JSON.stringify(data)}`
    );
  }
  return { status: response.status, json: async () => data };
}
