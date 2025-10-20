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

    // Guarda en cola
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

    // Procesar en segundo plano SIN bloquear la respuesta
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

    return json({
      success: true,
      message: "Queued successfully",
      id: webhook.id,
      sku,
      quantity: q,
    });
  } catch (err) {
    console.error("Inventory update failed:", err);
    return json({ error: "Internal error", details: err.message }, { status: 500 });
  }
}
