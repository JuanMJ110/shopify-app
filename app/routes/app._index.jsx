import { Page, Card, EmptyState, Layout, Text } from "@shopify/polaris";

export default function OrdersIndex() {
  return (
    <Page title="Shopify Orders">
      <Layout>
        <Layout.Section>
          <Card>
            <EmptyState
              heading="No Orders Yet"
              action={{ content: "Create Order", onAction: () => alert("Create order") }}
              image="https://cdn.shopify.com/s/files/1/0070/7032/5992/files/empty_state.svg?301"
            >
              <Text>
                Looks like there are no orders to display right now. You can create a new order using the button above.
              </Text>
            </EmptyState>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
