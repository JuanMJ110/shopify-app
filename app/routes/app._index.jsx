import { Page, Card, EmptyState, Layout, Text, Button } from "@shopify/polaris";

export default function Home() {
  return (
    <Page title="Bienvenido a tu App">
      <Layout>
        <Layout.Section>
          <Card>
            <EmptyState
              heading="¡Bienvenido a tu aplicación!"
              image="https://cdn.shopify.com/s/files/1/0070/7032/5992/files/empty_state.svg?301"
            >
              <Text as="p" variant="bodyMd">
                Esta es la plataforma ideal para gestionar tus pedidos de forma rápida y eficiente. 
                Explora las opciones y personaliza la experiencia según tus necesidades.
              </Text>
            </EmptyState>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
