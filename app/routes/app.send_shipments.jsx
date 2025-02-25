import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Función para verificar la clave API
async function verificarApiKey(apiKey) {
  if (!apiKey) return null;
  
  const ahora = new Date();
  
  // Buscar la sesión con esta clave API que no haya expirado
  const session = await prisma.session.findFirst({
    where: {
      apiKey,
      apiKeyExpires: {
        gt: ahora
      }
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
    // Verificar la clave API y obtener la sesión asociada
    const session = await verificarApiKey(apiKey);
    
    if (!session) {
      return json({ error: 'Clave API inválida o expirada' }, { status: 401 });
    }

    const { orderId, locationId, trackingNumber, trackingUrl } = await request.json();
    
    if (!orderId || !locationId || !trackingNumber || !trackingUrl) {
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

    // A partir de aquí, es tu código original
    const orderGid = `gid://shopify/Order/${orderId}`;
    const location = `gid://shopify/Location/${locationId}`; // ID de la nueva ubicación

    // 1. Obtener la orden por su ID
    const response = await admin.graphql(
      `#graphql
        query GetOrderById($id: ID!) {
          order(id: $id) {
            id
            name
            processedAt
            totalPrice
            email
            currencyCode
            paymentGatewayNames
            displayFulfillmentStatus
            lineItems(first: 50) {
              edges {
                node {
                  id
                  quantity
                  name
                  variant {
                    id
                    sku
                    price
                  }
                }
              }
            }
            shippingAddress {
              firstName
              lastName
              address1
              address2
              zip
              city
              province
              country
              phone
            }
            fulfillmentOrders(first: 10) {
              edges {
                node {
                  id
                  status
                  assignedLocation {
                    name
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
            "id": orderGid,
          },
        }
    );

    const responseJson = await response.json();
    if (responseJson.errors) {
      console.error("GraphQL Errors:", responseJson.errors);
      return json(
        {
          success: false,
          error: "Error en la consulta GraphQL",
          details: responseJson.errors,
        },
        { status: 400 }
      );
    }

    const order = responseJson.data?.order;
    if (!order) {
      return json(
        {
          success: false,
          error: "No se encontró la orden",
        },
        { status: 404 }
      );
    }

    const fulfillmentOrder = order.fulfillmentOrders.edges[0]?.node;
    if (!fulfillmentOrder) {
      console.warn(`La orden ${order.name} no tiene órdenes de cumplimiento`);
      return json(
        {
          success: false,
          error: `La orden ${order.name} no tiene órdenes de cumplimiento`,
        },
        { status: 400 }
      );
    }

    // 2. Mover la orden si es necesario
    if (fulfillmentOrder.assignedLocation?.location?.id !== location) {
      const moveResponse = await admin.graphql(
        `#graphql
          mutation MoveFulfillmentOrder($id: ID!, $newLocationId: ID!) {
            fulfillmentOrderMove(id: $id, newLocationId: $newLocationId) {
              movedFulfillmentOrder {
                id
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        { variables: { id: fulfillmentOrder.id, newLocationId: location } }
      );
      

      const moveResult = await moveResponse.json();
      if (moveResult.errors || moveResult.data?.fulfillmentOrderMove?.userErrors?.length > 0) {
        throw new Error(
          `Error moviendo la orden: ${JSON.stringify(
            moveResult.errors || moveResult.data.fulfillmentOrderMove.userErrors
          )}`
        );
      }
    }

    // 3. Crear el cumplimiento con el número de seguimiento
    const fulfillmentResponse = await admin.graphql(
      `mutation CreateFulfillment {
        fulfillmentCreateV2(
          fulfillment: {
            lineItemsByFulfillmentOrder: [
              { fulfillmentOrderId: "${fulfillmentOrder.id}" }
            ]
            trackingInfo: {
              number: "${trackingNumber}",
              url: "${trackingUrl}"
            }
            notifyCustomer: true
          }
        ) {
          fulfillment {
            id
            status
          }
          userErrors {
            field
            message
          }
        }
      }`
    );

    const fulfillmentResult = await fulfillmentResponse.json();
    if (fulfillmentResult.errors || fulfillmentResult.data?.fulfillmentCreateV2?.userErrors?.length > 0) {
      throw new Error(
        `Error creando el cumplimiento: ${JSON.stringify(
          fulfillmentResult.errors || fulfillmentResult.data.fulfillmentCreateV2.userErrors
        )}`
      );
    }

    // Retornar los detalles de la orden procesada
    return json({
      success: true,
      order: {
        order_id: order.name,
        idWS: order.id,
        date: order.processedAt,
        order_total: parseFloat(order.totalPrice),
        order_currency: order.currencyCode,
        billing_email: order.email,
        shipping_address: order.shippingAddress,
        fulfillment_status: "Fulfilled",
        location: fulfillmentOrder.assignedLocation?.location?.id,
        tracking_number: trackingNumber,
        tracking_url: trackingUrl,
      },
    });
  } catch (error) {
    console.error("Error general en el proceso:", error);
    return json(
      {
        success: false,
        error: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}