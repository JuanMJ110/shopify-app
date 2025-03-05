import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  // Verificar si la tienda necesita configuración
  const existingSession = await prisma.session.findFirst({
    where: {
      shop: session.shop,
      shipeuStatus: "active",
    },
  });

  if (!existingSession) {
    return redirect("/app/shipeu-sync");
  }

  return {
    shop: session.shop,
  };
};

export default function Index() {
  const { shop } = useLoaderData();

  return (
    <Page>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Bienvenido a tu tienda
              </Text>
              <Text as="p">
                Tu tienda {shop} está correctamente configurada con Shipeu.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
