import { json } from "@remix-run/node";
import prisma from "../db.server";

async function verificarApiKey(apiKey) {
  if (!apiKey) return null;

  const session = await prisma.session.findFirst({
    where: {
      apiKey,
      // shipeuStatus: "active"
    }
  });

  return session;
}

async function obtenerOrdenes(accessToken, shop, financialStatus = "any", status = "any") {
  const shopifyDomain = `https://${shop}`;
  const url = `${shopifyDomain}/admin/api/2024-10/graphql.json`;

  const dateNow = new Date();
  const createdAtMin = new Date(dateNow.setDate(dateNow.getDate() - 15)).toISOString();

  const query = `#graphql
  query GetFilteredOrders {
    orders(first: 250, query: "created_at:>=${createdAtMin} status:${status} financial_status:${financialStatus}") {
      edges {
        node {
          id
          name
          processedAt
          totalPrice
          currencyCode
          email
          displayFinancialStatus
          displayFulfillmentStatus
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
            refundLineItems(first: 50) { 
              edges {
                node {
                  lineItem {
                    id
                  }
                }
              }
            }
          }
          fulfillmentOrders(first: 100) {
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
          shippingLines(first: 100) {
            edges {
              node {
                title
                price
              }
            }
          }
        }
      }
    }
  }
  `;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      },
      body: JSON.stringify({ query })
    });

    if (!response.ok) {
      throw new Error(`Error en la respuesta de Shopify: ${response.statusText}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error("Error al obtener órdenes de Shopify:", error);
    throw error;
  }
}

export async function loader({ request }) {
  const url = new URL(request.url);
  const apiKey = url.searchParams.get('api_key') ||
    request.headers.get('X-API-Key') ||
    request.headers.get('Authorization')?.replace("Bearer ", "");

  const financialStatus = url.searchParams.get('financial_status') || 'any';
  const status = url.searchParams.get('status') || 'any';
  const fulfillmentStatus = url.searchParams.get('fulfillment_status') || 'any';

  if (!apiKey) {
    return json({ error: 'Se requiere clave API' }, { status: 401 });
  }

  try {
    const session = await verificarApiKey(apiKey);

    if (!session) {
      return json({ error: 'Clave API inválida o expirada' }, { status: 401 });
    }

    const data = await obtenerOrdenes(session.accessToken, session.shop, financialStatus, status, fulfillmentStatus);

    if (!data.data?.orders?.edges?.length) {
      return json({
        success: true,
        orders: [],
        debug: data
      }, { status: 404 });
    }

    const orders = data.data.orders.edges.map(({ node }) => {
      const totalRefunded = node.refunds?.reduce((sum, refund) =>
        sum + parseFloat(refund.totalRefundedSet?.shopMoney?.amount || 0), 0
      ) || 0;

      // Crear un mapa con las cantidades reembolsadas de cada producto
      const refundedItemQuantities = new Map();
      node.refunds?.forEach(refund => {
        refund.refundLineItems?.edges?.forEach(({ node: refundedItem }) => {
          const itemId = refundedItem.lineItem.id;
          refundedItemQuantities.set(itemId, (refundedItemQuantities.get(itemId) || 0) + 1);
        });
      });

      // Ajustar las cantidades en lugar de eliminar los productos
      const lineItems = node.lineItems.edges
        .map(({ node: item }) => {
          const refundedQty = refundedItemQuantities.get(item.id) || 0;
          const remainingQty = item.quantity - refundedQty;

          if (remainingQty <= 0) return null; // Solo excluir si se reembolsaron todas las unidades

          return {
            total: parseFloat(item.originalUnitPrice) * remainingQty,
            price: parseFloat(item.originalUnitPrice),
            sku: item.variant?.sku || "",
            quantity: remainingQty,
            name: item.name
          };
        })
        .filter(Boolean); // Eliminar los nulls de los productos completamente reembolsados

      const lastFulfillmentOrder = node.fulfillmentOrders?.edges.slice(-1)[0]?.node;

      // Extraer la información de los métodos de envío
      const shippingLines = node.shippingLines.edges.map(({ node: shipping }) => ({
        title: shipping.title,
        price: parseFloat(shipping.price) || 0
      }));

      return {
        order_id: node.name,
        idWS: node.id,
        date: node.processedAt,
        order_total: parseFloat(node.totalPrice) - totalRefunded,
        order_currency: node.currencyCode,
        financial_status: node.displayFinancialStatus,
        fulfillment_status: node.displayFulfillmentStatus,
        status: node.displayStatus,
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
        line_items: lineItems,
        shipping_lines: shippingLines,
        fulfillment_location_id: lastFulfillmentOrder?.assignedLocation?.location?.id || null,
      };
    });


    return json({ success: true, orders });

  } catch (error) {
    console.error("Error al procesar solicitud:", error);
    return json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
