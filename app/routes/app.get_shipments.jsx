import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);
  
  const dateNow = new Date();
  const createdAtMin = new Date(dateNow.setDate(dateNow.getDate() - 15)).toISOString(); // Últimos 15 días
  const financialStatus = "paid"; // Cambiar según el caso
  const status = "open"; // Cambiar según el estado deseado

  try {
    const response = await admin.graphql(
      `#graphql
        query GetFilteredOrders {
          orders(first: 100, query: "created_at:>=${createdAtMin} status:${status} financial_status:${financialStatus}") {
            edges {
              node {
                id
                name
                processedAt
                totalPrice
                email
                currencyCode
                paymentGatewayNames
                subtotalLineItemsQuantity
                lineItems(first: 50) {
                  edges {
                    node {
                      id
                      quantity
                      name
                      originalUnitPrice
                      discountedUnitPrice
                      variant {
                        id
                        sku
                        price
                        product {
                          id
                          title
                          handle
                        }
                      }
                    }
                  }
                }
                billingAddress {
                  phone
                }
                shippingAddress {
                  firstName
                  lastName
                  address1
                  address2
                  zip
                  city
                  province
                  company
                  country
                  phone
                }
                refunds {
                  totalRefundedSet {
                    shopMoney {
                      amount
                    }
                  }
                }
              }
            }
          }
        }`
    );

    console.log("Respuesta completa:", JSON.stringify(response, null, 2));

    if (!response.ok) {
      console.error("Error en la respuesta de la API");
      return json({ success: false, error: "Error en la respuesta de la API" }, { status: response.status });
    }

    const data = await response.json();
    
    if (!data.data?.orders?.edges?.length) {
      console.log("No se encontraron órdenes. Data recibida:", data);
      return json({ 
        success: false, 
        error: "No se encontraron órdenes",
        debug: data 
      }, { status: 404 });
    }

    const orders = data.data.orders.edges.map(({ node }) => {
      const totalRefunded = node.refunds?.reduce((sum, refund) => 
        sum + parseFloat(refund.totalRefundedSet.shopMoney.amount), 0) || 0;

      const lineItems = node.lineItems.edges.map(({ node: item }) => ({
        id: item.id,
        quantity: item.quantity,
        name: item.name,
        price: {
          original: item.originalUnitPrice,
          discounted: item.discountedUnitPrice
        },
        variant: item.variant ? {
          id: item.variant.id,
          sku: item.variant.sku,
          price: item.variant.price,
          product: {
            id: item.variant.product.id,
            title: item.variant.product.title,
            handle: item.variant.product.handle
          }
        } : null
      }));

      return {
        order_id: node.name,
        idWS: node.id,
        date: node.processedAt,
        order_total: parseFloat(node.totalPrice) - totalRefunded,
        order_currency: node.currencyCode,
        billing_email: node.email,
        billing_phone: node.billingAddress?.phone || node.shippingAddress?.phone || "",
        shipping_first_name: node.shippingAddress?.firstName || "",
        shipping_last_name: node.shippingAddress?.lastName || "",
        shipping_address_1: node.shippingAddress?.address1 || "",
        shipping_address_2: node.shippingAddress?.address2 || "",
        shipping_postcode: node.shippingAddress?.zip || "",
        shipping_city: node.shippingAddress?.city || "",
        shipping_state: node.shippingAddress?.province || "",
        shipping_company: node.shippingAddress?.company || "",
        shipping_country: node.shippingAddress?.country || "",
        payment_method: node.paymentGatewayNames?.[0] || "",
        date_created: node.processedAt,
        line_items: lineItems
      };
    });

    return json({ success: true, orders });
    
  } catch (error) {
    console.error("Error detallado:", error);
    return json({ 
      success: false, 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
}
