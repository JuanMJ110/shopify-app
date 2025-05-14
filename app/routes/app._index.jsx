import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  Banner,
  Button,
  BlockStack,
  InlineStack,
  Icon,
  Box,
  List,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  OrderIcon,
  OrderFulfilledIcon,
  OrdersStatusIcon,
  InventoryUpdatedIcon,
  ConnectIcon,
  MoneyIcon,
  QuestionCircleIcon,
  CheckCircleIcon
} from "@shopify/polaris-icons";
import { iconNames } from "lucide-react/dynamic";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  if (!session) {
    throw await authenticate.error(request);
  }

  // Verificar si la tienda necesita configuración
  const existingSession = await prisma.session.findFirst({
    where: {
      shop: session.shop,
    },
  });

  // Redirigir a configuración solo si no existe ninguna sesión para esta tienda
  // o si específicamente necesitamos configuración (no usar shipeuStatus para evitar ciclos)
  if (!existingSession) {
    return redirect("/app/shipeu-sync");
  }

  return json({
    shop: session.shop,
    // También pasamos la información de estado para mostrar mensajes relevantes
    needsConfiguration: !existingSession || !existingSession.shipeuStatus || existingSession.shipeuStatus !== "active",
  });
};

export default function Index() {
  const { shop, needsConfiguration } = useLoaderData();
  const navigate = useNavigate();

  const features = [
    {
      icon: OrderIcon,
      title: "National and International Shipping",
      description: "Manage shipments anywhere in the world with the best market rates."
    },
    {
      icon: OrderFulfilledIcon,
      title: "Order Management",
      description: "Automate your order management and reduce errors in the shipping process."
    },
    {
      icon: OrdersStatusIcon,
      title: "Real-Time Tracking",
      description: "Keep your customers informed with real-time updates on their shipment status."
    },
    {
      icon: InventoryUpdatedIcon,
      title: "Inventory Synchronization",
      description: "Keep your inventory always updated and synchronized between Shopify and Shipeu."
    }
  ];

  const reasons = [
    {
      icon: ConnectIcon,
      title: "Perfect Integration",
      description: "Connect your Shopify store quickly and easily, without technical complications."
    },
    {
      icon: MoneyIcon,
      title: "Best Rates",
      description: "Get the most competitive market rates for your national and international shipments."
    },
    {
      icon: QuestionCircleIcon,
      title: "Specialized Support",
      description: "Count on a dedicated technical team to solve all your doubts and needs."
    },
    {
      icon: CheckCircleIcon,
      title: "Intuitive Panel",
      description: "Manage your shipments from an easy-to-use interface designed with you in mind."
    }
  ];

  return (
    <Page title="Welcome to Shipeu" fullWidth>
      <BlockStack gap="500" padding="500">
        <Layout>
          {needsConfiguration && (
            <Layout.Section>
              <Banner
                title="Pending Configuration"
                status="warning"
                action={{
                  content: "Set up now",
                  onAction: () => navigate("/app/shipeu-sync")
                }}
              >
                <p>To start enjoying all the benefits of Shipeu, you need to complete your store setup.</p>
              </Banner>
            </Layout.Section>
          )}
          <Layout.Section>
            <Card roundedAbove="xl">
              <Box padding="500">
                <div style={{ textAlign: 'center', maxWidth: '800px', margin: '0 auto' }}>
                  <BlockStack gap="400" align="center">
                    <Text as="h2" variant="headingXl" color="success">
                      Optimize your logistics with Shipeu
                    </Text>
                    <Text as="p" variant="bodyLg" color="subdued" alignment="center">
                      Simplify your shipments and improve your customers' experience with our comprehensive logistics solution.
                    </Text>
                    {!needsConfiguration && (
                      <BlockStack gap="400" align="center">
                        <Text as="p" variant="bodyMd" alignment="center">
                          Your store <strong>{shop}</strong> is correctly configured with Shipeu and ready to manage shipments.
                        </Text>
                        <InlineStack gap="300" align="center">
                          <Button primary size="large" onClick={() => navigate("/app/shipeu-sync")}>
                            Manage settings
                          </Button>
                          <Button size="large" onClick={() => window.open("https://docs.shipeu.com/shipeu-control/", "_blank")}>
                            View documentation
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    )}
                  </BlockStack>
                </div>
              </Box>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <BlockStack gap="400">
              <Card roundedAbove="xl">
                <Box padding="500">
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingLg" alignment="center" color="success">
                      Main Features
                    </Text>

                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                      gap: '20px',
                      width: '100%'
                    }}>
                      {features.map((feature, index) => (
                        <Card key={index} sectioned>
                          <BlockStack gap="300" align="center">
                            <div style={{
                              color: 'var(--p-action-primary)',
                              backgroundColor: 'var(--p-surface-selected)',
                              padding: '16px',
                              borderRadius: '50%',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                            }}>
                              <Icon source={feature.icon} />
                            </div>
                            <Text as="h4" variant="headingMd" alignment="center">
                              {feature.title}
                            </Text>
                            <Text as="p" variant="bodyMd" color="subdued" alignment="center">
                              {feature.description}
                            </Text>
                          </BlockStack>
                        </Card>
                      ))}
                    </div>
                  </BlockStack>
                </Box>
              </Card>
            </BlockStack>
          </Layout.Section>

          <Layout.Section>
            <Card roundedAbove="xl">
              <Box padding="500" paddingBlockEnd="800">
                <BlockStack gap="400">
                  <Text as="h3" variant="headingLg" alignment="center" color="success">
                    Why choose Shipeu?
                  </Text>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: '20px',
                    width: '100%'
                  }}>
                    {reasons.map((reason, index) => (
                      <Card key={index} sectioned>
                        <BlockStack gap="300" align="center">
                          <div style={{
                            color: 'var(--p-action-primary)',
                            backgroundColor: 'var(--p-surface-selected)',
                            padding: '16px',
                            borderRadius: '50%',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                          }}>
                            <Icon source={reason.icon} />
                          </div>
                          <Text as="h4" variant="headingMd" alignment="center">
                            {reason.title}
                          </Text>
                          <Text as="p" variant="bodyMd" color="subdued" alignment="center">
                            {reason.description}
                          </Text>
                        </BlockStack>
                      </Card>
                    ))}
                  </div>
                </BlockStack>
              </Box>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
