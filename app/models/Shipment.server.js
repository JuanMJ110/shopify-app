import fetch from "node-fetch"; // Para hacer las solicitudes a Shopify

// Función para obtener todas las órdenes desde Shopify
export async function getAllShopifyOrders(shop) {
  const createdAtMin = getCreatedAtMin(); // Obtener fecha de hace 15 días
  const limitOrders = 250; // Límite de órdenes por solicitud

  try {
    // Construir la URL con los parámetros
    const apiUrl = `https://${shop}/admin/api/2023-10/orders.json`;
    const params = new URLSearchParams({
      created_at_min: createdAtMin, // Fecha de hace 15 días
      limit: limitOrders, // Límite máximo de órdenes
    });

    console.log("Llamando a Shopify API con:", `${apiUrl}?${params}`);

    // Realizar la solicitud a la API de Shopify
    const response = await fetch(`${apiUrl}?${params}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.SHOPIFY_API_TOKEN}`, // Token de autenticación
      },
    });

    if (!response.ok) {
      throw new Error(`Error al obtener órdenes de Shopify: ${response.statusText}`);
    }

    const data = await response.json(); // Parsear la respuesta JSON

    console.log("Órdenes recibidas de Shopify:", data.orders);
    return { success: true, data: data.orders || [] }; // Retornar las órdenes

  } catch (error) {
    console.error("Error al consultar Shopify:", error);
    return { success: false, message: error.message }; // Manejo de errores
  }
}

// Función para obtener la fecha de hace 15 días en formato ISO
function getCreatedAtMin() {
  const today = new Date();
  today.setDate(today.getDate() - 15); // Resta 15 días a la fecha actual
  return today.toISOString(); // Devuelve la fecha en formato ISO 8601
}
