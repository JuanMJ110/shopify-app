import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);
  const orderId = "6194758418632"; // El ID proporcionado
  const orderGid = `gid://shopify/Order/${orderId}`;
  const NEW_LOCATION_ID = "gid://shopify/Location/74597728456"; // ID de la nueva ubicación
  const trackingNumber = "TRACK123456789"; // Número de seguimiento
  const trackingUrl = `https://tracking.example.com/${trackingNumber}`; // URL del tracking

  try {
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
      { id: orderGid }
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
    if (fulfillmentOrder.assignedLocation?.location?.id !== NEW_LOCATION_ID) {
      const moveResponse = await admin.graphql(
        `mutation MoveFulfillmentOrder {
          fulfillmentOrderMove(
            fulfillmentOrderId: "${fulfillmentOrder.id}",
            newLocationId: "${NEW_LOCATION_ID}"
          ) {
            movedFulfillmentOrder {
              id
            }
            userErrors {
              field
              message
            }
          }
        }`
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
