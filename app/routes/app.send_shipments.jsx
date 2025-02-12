import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  try {
    // 1. Obtener las órdenes
    const response = await admin.graphql(
      `#graphql
        query GetAllOrders {
          orders(first: 10, query: "financial_status:open OR fulfillment_status:unfulfilled") {
            edges {
              node {
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
            }
          }
        }`
    );

    const responseJson = await response.json();
    console.log("Response from GraphQL:", responseJson);

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

    if (!responseJson.data?.orders?.edges?.length) {
      return json(
        {
          success: false,
          error: "No se encontraron órdenes",
        },
        { status: 404 }
      );
    }

    const NEW_LOCATION_ID = "gid://shopify/Location/74597728456";

    const orders = await Promise.all(
      responseJson.data.orders.edges.map(async ({ node }) => {
        const fulfillmentOrder = node.fulfillmentOrders.edges[0]?.node;
        if (!fulfillmentOrder) {
          console.warn(`Order ${node.name} has no fulfillment orders`);
          return null;
        }

        try {
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
                `Error moving order: ${JSON.stringify(moveResult.errors || moveResult.data.fulfillmentOrderMove.userErrors)}`
              );
            }
          }

          // 3. Crear el cumplimiento con el número de seguimiento
          const trackingNumber = "TRACK123456789"; // Aquí coloca el tracking real
          const trackingUrl = `https://tracking.example.com/${trackingNumber}`;

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
              `Error creating fulfillment: ${JSON.stringify(
                fulfillmentResult.errors || fulfillmentResult.data.fulfillmentCreateV2.userErrors
              )}`
            );
          }

          return {
            order_id: node.name,
            idWS: node.id,
            date: node.processedAt,
            order_total: parseFloat(node.totalPrice),
            order_currency: node.currencyCode,
            billing_email: node.email,
            shipping_address: node.shippingAddress,
            fulfillment_status: "Fulfilled",
            location: fulfillmentOrder.assignedLocation?.location?.id,
            tracking_number: trackingNumber,
            tracking_url: trackingUrl,
          };
        } catch (error) {
          console.error(`Error processing order ${node.name}:`, error);
          return null;
        }
      })
    );

    const successfulOrders = orders.filter(Boolean);
    if (!successfulOrders.length) {
      return json(
        {
          success: false,
          error: "No se pudo procesar ninguna orden correctamente",
        },
        { status: 500 }
      );
    }

    return json({ success: true, orders: successfulOrders });
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
