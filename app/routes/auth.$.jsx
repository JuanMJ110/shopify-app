// import { authenticate } from "../shopify.server";

// export const loader = async ({ request }) => {
//   await authenticate.admin(request);

//   return null;
// };
import { json, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server"; // Usamos la función de autenticación desde shopify.server.js

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return json({ success: false, error: "Missing shop parameter" });
  }

  try {
    // Autentica la tienda y gestiona el flujo OAuth
    await authenticate.admin(request);

    // Redirige al usuario a la página principal de la app o al panel
    return redirect("/dashboard"); // Ajusta según tu ruta deseada
  } catch (error) {
    console.error("Error during authentication:", error);
    return json({ success: false, error: "Authentication failed" });
  }
};
