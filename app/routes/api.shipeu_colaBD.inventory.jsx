import { json } from "@remix-run/node";
import prisma from "../db.server";
import { verifyApiKey } from "../utils/auth.server.js";

export async function action({ request }) {
  try {
    const url = new URL(request.url);
    const apiKey =
      url.searchParams.get("api_key") ||
      request.headers.get("X-API-Key") ||
      request.headers.get("Authorization")?.replace("Bearer ", "");

    if (!apiKey) return json({ error: "API key required" }, { status: 401 });

    const session = await verifyApiKey(apiKey, true);
    if (!session) return json({ error: "Invalid API key" }, { status: 401 });

    const { sku, quantity } = await request.json();
    const q = parseInt(quantity, 10);
    if (!sku || isNaN(q) || q < 0)
      return json({ error: "Invalid parameters" }, { status: 400 });

    // --- 1. Buscar el producto por SKU ---
    const shopifyDomain = `https://${session.shop}`;
    const queryUrl = `${shopifyDomain}/admin/api/2024-10/graphql.json`;

    const searchQuery = `
      query searchVariant($locationId: ID!) {
        productVariants(first: 1, query: "sku:${sku}") {
          edges {
            node {
              id
              sku
              inventoryItem {
                id
              }
            }
          }
        }
      }`;

    const searchResp = await fetch(queryUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken,
      },
      body: JSON.stringify({
        query: searchQuery,
        variables: { locationId: session.shipeuLocationId },
      }),
    });

    const searchData = await searchResp.json();
    const variants = searchData?.data?.productVariants?.edges || [];
    if (variants.length === 0)
      return json({ error: "SKU not found in Shopify" }, { status: 404 });

    const inventoryItemId = variants[0].node.inventoryItem.id;

    // --- 2. Actualizar inventario en Shopify ---
    const mutation = `
      mutation InventorySet($input: InventorySetQuantitiesInput!) {
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
      }`;

    const updateResp = await fetch(queryUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          input: {
            name: "available",
            reason: "correction",
            ignoreCompareQuantity: true,
            quantities: [
              {
                inventoryItemId,
                locationId: session.shipeuLocationId,
                quantity: q,
              },
            ],
          },
        },
      }),
    });

    const updateData = await updateResp.json();
    const userErrors = updateData.data?.inventorySetQuantities?.userErrors;
    if (userErrors?.length > 0)
      return json({ error: "Shopify error", details: userErrors }, { status: 400 });

    // --- 3. Crear webhook en base de datos ---
    const webhook = await prisma.webhookQueue.create({
      data: {
        shop: session.shop,
        topic: "shipeu_inventory_update",
        payload: JSON.stringify({
          sku,
          quantity: q,
          locationId: session.shipeuLocationId,
          source: "shipeu",
        }),
        status: "pending",
        attempts: 0,
      },
    });

    // --- 4. Procesar en background ---
    setImmediate(async () => {
      try {
        const { processWebhookQueue } = await import(
          "../services/webhookProcessor.server.js"
        );
        await processWebhookQueue(webhook.id);
      } catch (err) {
        console.error("Error background process:", err.message);
      }
    });

    // --- 5. Responder inmediatamente ---
    return json({
      success: true,
      message: "Inventory updated in Shopify and queued for Shipeu sync",
      data: {
        sku,
        quantity: q,
        shopifyResult:
          updateData.data?.inventorySetQuantities?.inventoryAdjustmentGroup?.changes,
        webhookId: webhook.id,
      },
    });
  } catch (err) {
    console.error("Inventory update failed:", err);
    return json(
      { error: "Internal error", details: err.message },
      { status: 500 }
    );
  }
}
