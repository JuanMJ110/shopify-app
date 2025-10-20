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
    const variants = searchData?.data?.productVariants?.edges || [];
    if (variants.length === 0)
      return json({ error: "SKU not found in Shopify" }, { status: 404 });

    const inventoryItemId = variants[0].node.inventoryItem.id;

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
