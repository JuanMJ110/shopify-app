import { authenticate } from "../shopify.server";
import db from "../db.server";

// Manejador para peticiones GET (verificación de webhook)
export const loader = async ({ request }) => {
  console.log("[Webhook Debug] Received GET request for uninstall webhook");
  return new Response(null, { status: 200 });
};

// Manejador para peticiones POST (webhook real)
export const action = async ({ request }) => {
  console.log("[Webhook Debug] Starting uninstall webhook handler");
  console.log("[Webhook Debug] Request method:", request.method);
  console.log("[Webhook Debug] Request headers:", Object.fromEntries(request.headers.entries()));
  
  try {
    // Autenticamos primero el webhook
    const { shop, session, topic } = await authenticate.webhook(request);

    console.log(`[Webhook] Received ${topic} webhook for ${shop}`);
    console.log(`[Webhook] Session exists: ${!!session}`);

    // Siempre intentamos eliminar las sesiones de la tienda, independientemente de si existe una sesión activa
    const deleteResult = await db.session.deleteMany({ 
      where: { shop }
    });

    console.log(`[Webhook] Deleted ${deleteResult.count} sessions for shop ${shop}`);

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error(`[Webhook Error] Failed to process uninstall webhook:`, error);
    console.error(`[Webhook Error] Stack trace:`, error.stack);
    
    // En caso de error de autenticación o procesamiento, intentamos leer el body para debug
    try {
      const body = await request.clone().text();
      console.error(`[Webhook Error] Request body:`, body);
    } catch (bodyError) {
      console.error(`[Webhook Error] Could not read body:`, bodyError);
    }
    
    // Devolvemos un 200 incluso en caso de error para evitar reintentos
    return new Response(null, { status: 200 });
  }
};