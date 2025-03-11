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
      title: "Envíos Nacionales e Internacionales",
      description: "Gestiona envíos a cualquier parte del mundo con las mejores tarifas del mercado."
    },
    {
      icon: OrderFulfilledIcon,
      title: "Gestión de Pedidos",
      description: "Automatiza la gestión de tus pedidos y reduce errores en el proceso de envío."
    },
    {
      icon: OrdersStatusIcon,
      title: "Seguimiento en Tiempo Real",
      description: "Mantén informados a tus clientes con actualizaciones en tiempo real del estado de sus envíos."
    },
    {
      icon: InventoryUpdatedIcon,
      title: "Sincronización de Inventario",
      description: "Mantén tu inventario siempre actualizado y sincronizado entre Shopify y Shipeu."
    }
  ];

  const reasons = [
    {
      icon: ConnectIcon,
      title: "Integración perfecta",
      description: "Conecta tu tienda Shopify de manera rápida y sencilla, sin complicaciones técnicas."
    },
    {
      icon: MoneyIcon,
      title: "Mejores tarifas",
      description: "Obtén las tarifas más competitivas del mercado para tus envíos nacionales e internacionales."
    },
    {
      icon: QuestionCircleIcon,
      title: "Soporte especializado",
      description: "Cuenta con un equipo técnico dedicado para resolver todas tus dudas y necesidades."
    },
    {
      icon: CheckCircleIcon,
      title: "Panel intuitivo",
      description: "Gestiona tus envíos desde una interfaz fácil de usar y diseñada pensando en ti."
    }
  ];

  return (
    <Page title="Bienvenido a Shipeu" fullWidth>
      <BlockStack gap="500" padding="500">
        {needsConfiguration && (
          <Layout.Section>
            <Banner
              title="Configuración pendiente"
              status="warning"
              action={{
                content: "Configurar ahora",
                onAction: () => navigate("/app/shipeu-sync")
              }}
            >
              <p>Para comenzar a disfrutar de todos los beneficios de Shipeu, necesitas completar la configuración de tu tienda.</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout>
          <Layout.Section>
            <Card roundedAbove="xl">
              <Box padding="500">
                <div style={{ textAlign: 'center', maxWidth: '800px', margin: '0 auto' }}>
                  <BlockStack gap="400" align="center">
                    <Text as="h2" variant="headingXl">
                      Optimiza tu logística con Shipeu
                    </Text>
                    <Text as="p" variant="bodyLg" color="subdued" alignment="center">
                      Simplifica tus envíos y mejora la experiencia de tus clientes con nuestra solución integral de logística.
                    </Text>
                    {!needsConfiguration && (
                      <BlockStack gap="400" align="center">
                        <Text as="p" variant="bodyMd" alignment="center">
                          Tu tienda <strong>{shop}</strong> está correctamente configurada con Shipeu y lista para gestionar envíos.
                        </Text>
                        <InlineStack gap="300" align="center">
                          <Button primary size="large" onClick={() => navigate("/app/shipeu-sync")}>
                            Gestionar configuración
                          </Button>
                          <Button size="large" onClick={() => window.open("https://docs.shipeu.com/shipeu-control/", "_blank")}>
                            Ver documentación
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
                    <Text as="h3" variant="headingLg" alignment="center">
                      Características principales
                    </Text>
                    
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                      gap: '20px',
                      width: '100%'
                    }}>
                      {features.map((feature, index) => (
                        <div key={index} style={{
                          backgroundColor: 'var(--p-surface)',
                          borderRadius: 'var(--p-border-radius-400)',
                          padding: '24px',
                        }}>
                          <BlockStack gap="300" align="center">
                            <div style={{
                              color: 'var(--p-action-primary)',
                              backgroundColor: 'var(--p-surface-selected)',
                              padding: '12px',
                              borderRadius: '50%',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center'
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
                        </div>
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
                  <Text as="h3" variant="headingLg" alignment="center">
                    ¿Por qué elegir Shipeu?
                  </Text>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: '20px',
                    width: '100%'
                  }}>
                    {reasons.map((reason, index) => (
                      <div key={index} style={{
                        backgroundColor: 'var(--p-surface)',
                        borderRadius: 'var(--p-border-radius-400)',
                        padding: '24px',
                      }}>
                        <BlockStack gap="300" align="center">
                          <div style={{
                            color: 'var(--p-action-primary)',
                            backgroundColor: 'var(--p-surface-selected)',
                            padding: '12px',
                            borderRadius: '50%',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center'
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
                      </div>
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
