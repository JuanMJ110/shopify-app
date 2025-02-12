import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { Page, Layout, Card, Button, Toast, Frame } from "@shopify/polaris";
import { useState, useCallback } from "react";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
    query {
      products(first: 10) {
        edges {
          node {
            id
            title
            productType
            variants(first: 1) {
              edges {
                node {
                  id
                  price
                  inventoryQuantity
                  inventoryItem {
                    id
                    inventoryLevels(first: 10) {
                      edges {
                        node {
                          location {
                            id
                            name
                          }
                        }
                      }
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

  const data = await response.json();
  return json({ 
    products: data.data.products.edges
  });
}

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const inventoryItems = JSON.parse(formData.get("inventoryItemIds"));

  try {
    const response = await admin.graphql(
      `#graphql
      mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
        inventoryAdjustQuantities(input: $input) {
          userErrors {
            field
            message
          }
          inventoryAdjustmentGroup {
            createdAt
            reason
            changes {
              name
              delta
            }
          }
        }
      }`,
      {
        variables: {
          input: {
            reason: "correction",
            name: "available",
            changes: inventoryItems.map(({ inventoryItemId, locationId }) => ({
              delta: 9999,
              inventoryItemId,
              locationId
            }))
          }
        },
      }
    );

    const result = await response.json();
    
    if (result.data?.inventoryAdjustQuantities?.userErrors?.length > 0) {
      throw new Error(result.data.inventoryAdjustQuantities.userErrors[0].message);
    }
    
    return json({ 
      success: true, 
      result: result.data.inventoryAdjustQuantities 
    });
  } catch (error) {
    console.error("Error updating stock:", error);
    return json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

export default function ShipmentsList() {
  const { products } = useLoaderData();
  const fetcher = useFetcher();
  const [toastActive, setToastActive] = useState(false);

  const isUpdating = fetcher.state !== "idle";

  const handleUpdateStock = useCallback(() => {
    const inventoryItemIds = products
      .map(({ node }) => {
        const variant = node?.variants?.edges[0]?.node;
        const inventoryItemId = variant?.inventoryItem?.id;
        const locationId = variant?.inventoryItem?.inventoryLevels?.edges[0]?.node?.location?.id;
        
        return inventoryItemId && locationId ? { inventoryItemId, locationId } : null;
      })
      .filter(Boolean);

    fetcher.submit(
      { 
        inventoryItemIds: JSON.stringify(inventoryItemIds)
      },
      { method: "POST" }
    );

    setToastActive(true);
  }, [products, fetcher]);

  return (
    <Frame>
      <Page title="Products List">
        {toastActive && (
          <Toast
            content={fetcher.data?.success 
              ? "Stock updated to 9999 for all products."
              : `Error updating stock: ${fetcher.data?.error || 'Please try again.'}`}
            onDismiss={() => setToastActive(false)}
          />
        )}
        <Layout>
          <Layout.Section>
            <Button onClick={handleUpdateStock} loading={isUpdating}>
              {isUpdating ? "Updating..." : "Update All Stock to 9999"}
            </Button>
          </Layout.Section>

          <Layout.Section>
            {products.length === 0 ? (
              <p>No products found.</p>
            ) : (
              <ul>
                {products.map(({ node }) => {
                  const variant = node?.variants?.edges[0]?.node;
                  const inventoryItemId = variant?.inventoryItem?.id || "N/A";
                  const inventoryLevels = variant?.inventoryItem?.inventoryLevels?.edges || [];

                  return (
                    <Card title={node.title} sectioned key={node.id}>
                      <ul style={{ listStyleType: "none", padding: 0, margin: 0 }}>
                        <li>
                          <strong>Type:</strong> {node.productType || "N/A"}
                        </li>
                        <li>
                          <strong>Price:</strong> ${variant?.price || "0.00"}
                        </li>
                        <li>
                          <strong>Inventory:</strong> {variant?.inventoryQuantity || 0}
                        </li>
                        <li>
                          <strong>Inventory Item ID:</strong> {inventoryItemId}
                        </li>
                        <li>
                          <strong>Locations:</strong>
                          {inventoryLevels.length > 0 ? (
                            <ul>
                              {inventoryLevels.map(({ node }) => (
                                <li key={node.location.id}>
                                  <strong>{node.location.name}</strong> (ID: {node.location.id})
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p>No locations available.</p>
                          )}
                        </li>
                      </ul>
                    </Card>
                  );
                })}
              </ul>
            )}
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}