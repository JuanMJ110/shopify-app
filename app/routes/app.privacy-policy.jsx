import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page, Card, Layout, Text, BlockStack, List
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { loadPrivacyPolicy } from "../utils/privacy.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const content = await loadPrivacyPolicy();
  return json({ content });
};

export default function PrivacyPolicy() {
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
                    
                    {sectionContent.split('\n### ').map((subsection, subIndex) => {
                      if (subIndex === 0 && !section.includes('\n### ')) {
                        return (
                          <BlockStack gap="300" key={`sub-${subIndex}`}>
                            {subsection.split('\n- ').map((item, itemIndex) => (
                              itemIndex === 0 ? (
                                <Text as="p" variant="bodyMd" key={`text-${itemIndex}`}>
                                  {processContent(item.trim())}
                                </Text>
                              ) : (
                                <List type="bullet" key={`list-${itemIndex}`}>
                                  <List.Item>
                                    <Text as="span" variant="bodyMd">
                                      {item.trim()}
                                    </Text>
                                  </List.Item>
                                </List>
                              )
                            ))}
                          </BlockStack>
                        );
                      }

                      const [subTitle, ...subContent] = subsection.split('\n');
                      return (
                        <BlockStack gap="300" key={`sub-${subIndex}`}>
                          <Text as="h3" variant="headingLg" fontWeight="semibold">
                            {processContent(subTitle.trim())}
                          </Text>
                          {subContent.map((line, lineIndex) => (
                            line.trim().startsWith('- ') ? (
                              <List type="bullet" key={`list-${lineIndex}`}>
                                <List.Item>
                                  <Text as="span" variant="bodyMd">
                                    {line.replace('- ', '').trim()}
                                  </Text>
                                </List.Item>
                              </List>
                            ) : (
                              line.trim() && (
                                <Text as="p" variant="bodyMd" key={`text-${lineIndex}`}>
                                  {line.trim()}
                                </Text>
                              )
                            )
                          ))}
                        </BlockStack>
                      );
                    })}
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