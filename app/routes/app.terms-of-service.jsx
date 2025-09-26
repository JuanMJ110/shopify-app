import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, Layout, Text, BlockStack } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { loadTerms } from "../utils/terms-of-service";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const termsContent = await loadTerms();
  return json({ content: termsContent });
};

export default function TermsOfService() {
  const { content } = useLoaderData();
  const sections = content.split('\n## ').map(section => section.trim());
  const title = sections[0].split('\n')[0].replace('# ', '');
  const mainSections = sections.slice(1);

  const processContent = (content) => {
    return content.replace(/^#{1,}/gm, '');
  };  

  return (
    <Page fullWidth>
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <Card>
              <BlockStack gap="500">
                <Text as="h1" variant="heading2xl">
                  {title}
                </Text>
                <Text as="p" variant="bodyMd">
                  {sections[0].split('\n').slice(1).join('\n')}
                </Text>
              </BlockStack>
            </Card>

            {mainSections.map((section, index) => {
              const [sectionTitle, ...content] = section.split('\n');
              const sectionContent = content.join('\n').trim();
              return (
                <Card key={index} padding="400">
                  <BlockStack gap="400">
                    <Text as="h2" variant="heading2xl">
                      {sectionTitle}
                    </Text>
                    {sectionContent.split('\n- ').map((item, itemIndex) => (
                      itemIndex === 0 ? (
                        <Text as="p" variant="bodyMd" key={`text-${itemIndex}`}>
                          {processContent(item.trim())}
                        </Text>
                      ) : (
                        <ul key={`list-${itemIndex}`} style={{ margin: 0, paddingLeft: 20 }}>
                          <li>
                            <Text as="span" variant="bodyMd">
                              {item.trim()}
                            </Text>
                          </li>
                        </ul>
                      )
                    ))}
                  </BlockStack>
                </Card>
              );
            })}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
} 