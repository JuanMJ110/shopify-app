import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Button,
  Frame,
  Toast,
  Text,
  Box,
  FormLayout,
  TextField,
  Banner,
  Icon,
  BlockStack,
  Select,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useEffect, useState } from "react";
import { ViewIcon, HideIcon, ClipboardIcon } from "@shopify/polaris-icons";
import { regenerateApiKey, registerStore, syncStore } from "../shipeu.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  if (!session) {
    throw await authenticate.error(request);
  }

  const existingSession = await prisma.session.findFirst({
    where: {
      shop: session.shop,
    },
  });

  // Obtener las localizaciones de Shopify
  const response = await admin.graphql(
    `#graphql
      query {
        locations(first: 50) {
          edges {
            node {
              id
              name
              address {
                address1
                city
                province
                country
                zip
              }
            }
          }
        }
      }
    `
  );

  const responseJson = await response.json();
  const locations = responseJson.data.locations.edges.map(edge => ({
    id: edge.node.id,
    name: edge.node.name,
    address: edge.node.address
  }));

  return json({
    shop: session.shop,
    isConfigured: existingSession?.shipeuStatus === "active",
    apiKey: existingSession?.apiKey || null,
    shipeuLocationId: existingSession?.shipeuLocationId || null,
    locations
  });
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  if (!session) {
    throw await authenticate.error(request);
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  const existingSession = await prisma.session.findFirst({
    where: {
      shop: session.shop,
    },
  });

  if (!existingSession) {
    return json({ 
      success: false, 
      error: "Invalid session. Please authenticate again." 
    }, { status: 401 });
  }

  switch (intent) {
    case "regenerate_api_key": {
      try {
        const { apiKey } = await regenerateApiKey(existingSession.apiKey);

        await prisma.session.update({
          where: { id: existingSession.id },
          data: {
            apiKey,
            shipeuStatus: "active",
          },
        });

        return json({ success: true, apiKey });
      } catch (error) {
        console.error("Error regenerating API key:", error);
        return json({ 
          success: false, 
          error: "Error regenerating API Key. Please try again." 
        }, { status: 500 });
      }
    }

    case "register_new_store": {
      try {
        const formFields = Object.fromEntries(formData);
        console.log("Form fields for registration:", formFields);
        console.log("Location ID from form:", formFields.locationId);
        
        const { apiKey, status, shipeuId } = await registerStore({
          ...formFields
        });

        await prisma.session.update({
          where: { id: existingSession.id },
          data: {
            apiKey,
            shipeuStatus: status,
            shipeuId,
            email: formFields.email,
            shipeuLocationId: formFields.locationId
          }
        });

        return json({ 
          success: true, 
          message: "Store registered successfully",
          data: {
            apiKey,
            status,
            storeId: shipeuId,
            shipeuLocationId: formFields.locationId
          }
        });
      } catch (error) {
        console.error("Error registering store:", error);
        return json({ 
          success: false, 
          error: error.message || "Error registering the store. Please verify the data and try again."
        }, { status: 500 });
      }
    }

    case "sync_existing_store": {
      try {
        const formFields = Object.fromEntries(formData);
        console.log("Form fields for sync:", formFields);
        
        const { status, shipeuId, apiKey: newApiKey } = await syncStore({ 
          email: formFields.email
        });
        
        await prisma.session.update({
          where: { id: existingSession.id },
          data: {
            apiKey: newApiKey,
            shipeuStatus: status,
            shipeuId,
            email: formFields.email,
            shipeuLocationId: formFields.locationId
          }
        });

        return json({ 
          success: true, 
          message: "Store synchronized successfully",
          data: {
            apiKey: newApiKey,
            status,
            storeId: shipeuId,
            shipeuLocationId: formFields.locationId
          }
        });
      } catch (error) {
        console.error("Error synchronizing store:", error);
        return json({ 
          success: false, 
          error: error.message || "Error synchronizing the store. Please verify your credentials."
        }, { status: 500 });
      }
    }

    default:
      return json({ success: false, error: "Invalid action" }, { status: 400 });
  }
};

export default function ShipeuSync() {
  const { isConfigured, apiKey: initialApiKey, locations, shipeuLocationId } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const [currentApiKey, setCurrentApiKey] = useState(() => actionData?.apiKey || initialApiKey || "");
  const [showApiKey, setShowApiKey] = useState(false);
  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [showRegistrationForm, setShowRegistrationForm] = useState(false);
  const [showSyncForm, setShowSyncForm] = useState(false);
  const [showError, setShowError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [formData, setFormData] = useState({
    storeName: "",
    email: "",
    phone1: "",
    storeAddress: "",
    contact: "",
    company: "",
    country: "ES",
    state: "",
    city: "",
    postalCode: "",
    phone2: "",
    cif: "",
    locationId: shipeuLocationId || ""
  });
  const [syncFormData, setSyncFormData] = useState({
    apiKey: "",
    email: "",
    locationId: shipeuLocationId || ""
  });

  useEffect(() => {
    if (actionData?.error) {
      setErrorMessage(actionData.error);
      setShowError(true);
      // Auto-cerrar después de 5 segundos
      const timer = setTimeout(() => {
        setShowError(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [actionData]);

  useEffect(() => {
    if (actionData?.apiKey) {
      setCurrentApiKey(actionData.apiKey);
    }
  }, [actionData]);

  useEffect(() => {
    if (actionData?.success && actionData?.apiKey) {
      setFormData({
        storeName: "",
        email: "",
        phone1: "",
        storeAddress: "",
        contact: "",
        company: "",
        country: "ES",
        state: "",
        city: "",
        postalCode: "",
        phone2: "",
        cif: "",
        locationId: shipeuLocationId || ""
      });
    }
  }, [actionData]);

  function handleToggleApiKey() {
    setShowApiKey(!showApiKey);
    setToastMessage(showApiKey ? "API Key hidden" : "API Key visible");
    setToastActive(true);
  }

  function handleGenerateApiKey() {
    if (confirm("Are you sure you want to regenerate the API Key? The previous API Key will stop working.")) {
      setShowApiKey(false);
      submit({ intent: "regenerate_api_key" }, { method: "post" });
      setToastMessage("Requesting new API Key...");
      setToastActive(true);
    }
  }

  function handleCopyApiKey() {
    if (!currentApiKey) return;
    
    navigator.clipboard.writeText(currentApiKey);
    setToastMessage("API Key copied to clipboard");
    setToastActive(true);
  }

  function handleInputChange(field) {
    return (value) => {
      console.log(`[Form] Field changed: ${field} = ${value}`);
      setFormData(prev => {
        const newData = { ...prev, [field]: value };
        console.log("[Form] New form data:", newData);
        return newData;
      });
    };
  }

  function handleSubmit(e) {
    e.preventDefault();
    console.log("[Form] Submitting form with data:", formData);
    const formDataToSubmit = new FormData();
    Object.entries(formData).forEach(([key, value]) => {
      formDataToSubmit.append(key, value);
    });
    formDataToSubmit.append("intent", "register_new_store");
    submit(formDataToSubmit, { method: "post" });
  }

  const handleSyncExisting = () => {
    setShowSyncForm(true);
  };

  const handleSyncSubmit = (e) => {
    e.preventDefault();
    console.log("[Sync Form] Submitting with data:", syncFormData);
    const formDataToSubmit = new FormData();
    Object.entries(syncFormData).forEach(([key, value]) => {
      formDataToSubmit.append(key, value);
    });
    formDataToSubmit.append("intent", "sync_existing_store");
    submit(formDataToSubmit, { method: "post" });
  };

  const handleSyncInputChange = (field) => {
    return (value) => {
      console.log(`[Sync Form] Field changed: ${field} = ${value}`);
      setSyncFormData(prev => {
        const newData = { ...prev, [field]: value };
        console.log("[Sync Form] New form data:", newData);
        return newData;
      });
    };
  };

  return (
    <Frame>
      <Page
        title="Shipeu Configuration"
        backAction={{ url: "/app", content: "Back" }}
      >
        {toastActive && (
          <Toast
            content={toastMessage}
            onDismiss={() => setToastActive(false)}
            duration={3000}
          />
        )}

        {showError && (
          <Banner status="critical" onDismiss={() => setShowError(false)}>
            {errorMessage}
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            {isConfigured ? (
              <Card sectioned>
                <BlockStack gap="8">
                  <div>
                    <Text variant="headingMd">API Key of Shipeu</Text>
                    <div style={{ 
                      marginTop: '1rem',
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px',
                      padding: '6px 8px',
                      border: '1px solid #c9cccf',
                      borderRadius: '6px',
                      background: '#ffffff'
                    }}>
                      <input
                        type={showApiKey ? "text" : "password"}
                        value={currentApiKey}
                        readOnly
                        style={{
                          border: 'none',
                          background: 'transparent',
                          flex: 1,
                          fontSize: '0.9375rem',
                          color: '#202223',
                          padding: '4px',
                          outline: 'none',
                          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif'
                        }}
                      />
                      <Button
                        onClick={handleToggleApiKey}
                        icon={showApiKey ? HideIcon : ViewIcon}
                        variant="tertiary"
                        size="slim"
                      />
                      <Button
                        onClick={handleCopyApiKey}
                        icon={ClipboardIcon}
                        variant="tertiary"
                        size="slim"
                      />
                    </div>
                  </div>

                  <div style={{ marginTop: '2rem' }}>
                    <Text variant="headingMd">Regenerate API Key</Text>
                    <Text as="p" variant="bodyMd" color="subdued">
                      If you need a new API Key, you can regenerate it. Note that the previous API Key will stop working.
                    </Text>
                    <div style={{ marginTop: '1rem' }}>
                      <Button onClick={handleGenerateApiKey} tone="critical">
                        Regenerate API Key
                      </Button>
                    </div>
                  </div>
                </BlockStack>
              </Card>
            ) : showRegistrationForm ? (
              <Card sectioned>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <Text variant="headingMd">Register with Shipeu</Text>
                  <Button plain onClick={() => setShowRegistrationForm(false)}>
                    Back
                  </Button>
                </div>
                <Text color="subdued">
                  Complete the form to register your store with Shipeu and start enjoying our services.
                </Text>
                <div style={{ 
                  marginTop: '1rem', 
                  maxHeight: '65vh', 
                  overflowY: 'auto', 
                  overflowX: 'hidden',
                  padding: '0 1rem'
                }}>
                  <form onSubmit={handleSubmit}>
                    <FormLayout>
                      <FormLayout.Group>
                        <TextField
                          label="Company Name"
                          value={formData.storeName}
                          onChange={handleInputChange("storeName")}
                          autoComplete="off"
                          required
                          helpText="Legal name of your company"
                        />
                        <TextField
                          label="CIF"
                          value={formData.cif}
                          onChange={handleInputChange("cif")}
                          autoComplete="off"
                          required
                          helpText="CIF of your company"
                        />
                      </FormLayout.Group>

                      <FormLayout.Group>
                        <TextField
                          label="Contact"
                          value={formData.contact}
                          onChange={handleInputChange("contact")}
                          autoComplete="off"
                          required
                          helpText="Name of the contact person"
                        />
                        <TextField
                          label="Email"
                          type="email"
                          value={formData.email}
                          onChange={handleInputChange("email")}
                          autoComplete="off"
                          required
                          helpText="Primary contact email"
                        />
                      </FormLayout.Group>

                      <FormLayout.Group>
                        <TextField
                          label="Primary Phone"
                          type="tel"
                          value={formData.phone1}
                          onChange={handleInputChange("phone1")}
                          autoComplete="off"
                          required
                          helpText="Primary contact phone"
                        />
                        <TextField
                          label="Secondary Phone"
                          type="tel"
                          value={formData.phone2}
                          onChange={handleInputChange("phone2")}
                          autoComplete="off"
                          helpText="Secondary phone (optional)"
                        />
                      </FormLayout.Group>

                      <FormLayout.Group condensed>
                        <div style={{ flex: '1' }}>
                          <Select
                            label="Country"
                            options={[
                              {label: 'Spain', value: 'ES'},
                              {label: 'Other', value: 'OTHER'}
                            ]}
                            value={formData.country}
                            onChange={handleInputChange("country")}
                            required
                            helpText="Country where your company is located"
                          />
                        </div>
                        <div style={{ flex: '1' }}>
                          <TextField
                            label="Province"
                            value={formData.state}
                            onChange={handleInputChange("state")}
                            autoComplete="off"
                            required
                            helpText="Province where your company is located"
                          />
                        </div>
                      </FormLayout.Group>

                      <FormLayout.Group>
                        <TextField
                          label="City"
                          value={formData.city}
                          onChange={handleInputChange("city")}
                          autoComplete="off"
                          required
                          helpText="City where your company is located"
                        />
                        <TextField
                          label="Postal Code"
                          value={formData.postalCode}
                          onChange={handleInputChange("postalCode")}
                          type="text"
                          autoComplete="off"
                          required
                          helpText="Postal code of your address"
                        />
                      </FormLayout.Group>

                      <TextField
                        label="Address"
                        value={formData.storeAddress}
                        onChange={handleInputChange("storeAddress")}
                        multiline={2}
                        autoComplete="off"
                        required
                        helpText="Complete address of your company"
                      />

                      <FormLayout.Group>
                        <Select
                          label="Shipeu Location"
                          options={locations.map(loc => ({
                            label: `${loc.name} - ${loc.address.city}, ${loc.address.province}`,
                            value: loc.id
                          }))}
                          value={formData.locationId}
                          onChange={handleInputChange("locationId")}
                          required
                          helpText="Select the location that will be used for Shipeu inventory management"
                        />
                      </FormLayout.Group>

                      <div style={{ 
                        display: 'flex', 
                        justifyContent: 'center', 
                        marginTop: '1.5rem'
                      }}>
                        <Button submit primary size="large">
                          Register Store
                        </Button>
                      </div>
                    </FormLayout>
                  </form>
                </div>
              </Card>
            ) : showSyncForm ? (
              <Card sectioned>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <Text variant="headingMd">Synchronize existing store</Text>
                  <Button plain onClick={() => setShowSyncForm(false)}>
                    Back
                  </Button>
                </div>
                <Text color="subdued">
                  Enter your Shipeu registered email to synchronize your store.
                </Text>
                <div style={{ marginTop: '1rem' }}>
                  <form onSubmit={handleSyncSubmit}>
                    <FormLayout>
                      <TextField
                        label="Email"
                        value={syncFormData.email}
                        onChange={handleSyncInputChange("email")}
                        type="email"
                        autoComplete="off"
                        required
                      />
                      <FormLayout.Group>
                        <Select
                          label="Shipeu Location"
                          options={locations.map(loc => ({
                            label: `${loc.name} - ${loc.address.city}, ${loc.address.province}`,
                            value: loc.id
                          }))}
                          value={syncFormData.locationId}
                          onChange={handleSyncInputChange("locationId")}
                          required
                          helpText="Select the location that will be used for Shipeu inventory management"
                        />
                      </FormLayout.Group>
                      <div style={{ 
                        display: 'flex', 
                        justifyContent: 'center', 
                        marginTop: '1rem'
                      }}>
                        <Button submit primary size="large">
                          Synchronize Store
                        </Button>
                      </div>
                    </FormLayout>
                  </form>
                </div>
              </Card>
            ) : (
              <>
                <Card sectioned>
                  <Text variant="headingMd">Already a Shipeu customer?</Text>
                  <Text color="subdued" as="p" variant="bodyMd">
                    If you already have a Shipeu account, sync your store to start using our services.
                  </Text>
                  <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'center' }}>
                    <Button onClick={handleSyncExisting} primary size="medium">
                      Yes, I'm a customer - Synchronize Store
                    </Button>
                  </div>
                </Card>
                <div style={{ marginTop: '1rem' }}>
                  <Card sectioned>
                    <Text variant="headingMd">New to Shipeu?</Text>
                    <Text color="subdued" as="p" variant="bodyMd">
                      Register with Shipeu to access our shipping and logistics management services.
                    </Text>
                    <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'center' }}>
                      <Button onClick={() => setShowRegistrationForm(true)} size="medium">
                        Register with Shipeu
                      </Button>
                    </div>
                  </Card>
                </div>
              </>
            )}
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}