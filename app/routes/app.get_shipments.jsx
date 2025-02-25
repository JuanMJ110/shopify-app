import { json } from "@remix-run/node";
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

// Función para obtener órdenes usando la API GraphQL de Shopify
async function obtenerOrdenes(accessToken, shop, financialStatus = "any", status = "any") {
  const shopifyDomain = `https://${shop}`;
  const url = `${shopifyDomain}/admin/api/2024-10/graphql.json`;
  
  const dateNow = new Date();
  const createdAtMin = new Date(dateNow.setDate(dateNow.getDate() - 15)).toISOString(); // Últimos 15 días
  
  const query = `#graphql
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
    }`;
  
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

  
  if (!apiKey) {
    return json({ error: 'Se requiere clave API' }, { status: 401 });
  }
  
  try {
    // Verificar la clave API y obtener la sesión asociada
    const session = await verificarApiKey(apiKey);
    
    if (!session) {
      return json({ error: 'Clave API inválida o expirada' }, { status: 401 });
    }
    
    // Obtener las órdenes usando las credenciales de la sesión
    const data = await obtenerOrdenes(session.accessToken, session.shop, financialStatus, status);
    
    // Procesar y formatear las órdenes como lo hacías originalmente
    if (!data.data?.orders?.edges?.length) {
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
    console.error("Error al procesar solicitud:", error);
    return json({ 
      success: false, 
      error: error.message
    }, { status: 500 });
  }
}