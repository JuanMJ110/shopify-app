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
import { randomUUID } from "crypto";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const existingSession = await prisma.session.findFirst({
    where: {
      shop: session.shop,
      shipeuStatus: "active",
    },
  });

  return json({
    isConfigured: !!existingSession,
    apiKey: existingSession?.apiKey || null,
  });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "generate_api_key") {
    const apiKey = randomUUID();
    await prisma.session.update({
      where: { id: session.id },
      data: {
        apiKey,
        shipeuStatus: "active",
      },
    });
    return json({ success: true, apiKey });
  }

  if (action === "sync_store") {
    try {
      const storeName = formData.get("storeName");
      const storeEmail = formData.get("storeEmail");
      const storePhone = formData.get("storePhone");
      const storeAddress = formData.get("storeAddress");

      if (!storeName || !storeEmail || !storePhone || !storeAddress) {
        return json({ 
          success: false, 
          error: "Todos los campos son requeridos" 
        }, { status: 400 });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(storeEmail)) {
        return json({ 
          success: false, 
          error: "El email no es válido" 
        }, { status: 400 });
      }

      const apiKey = randomUUID();
      await prisma.session.update({
        where: { id: session.id },
        data: {
          apiKey,
          shipeuStatus: "active",
        },
      });

      return json({ 
        success: true, 
        message: "Tienda sincronizada exitosamente",
        apiKey 
      });
    } catch (error) {
      console.error("Error al sincronizar tienda:", error);
      return json({ 
        success: false, 
        error: "Error al sincronizar la tienda: " + error.message 
      }, { status: 500 });
    }
  }

  if (action === "sync_existing_store") {
    try {
      const apiKey = formData.get("apiKey");
      const email = formData.get("email");

      if (!apiKey || !email) {
        return json({ 
          success: false, 
          error: "API Key y email son requeridos" 
        }, { status: 400 });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return json({ 
          success: false, 
          error: "El email no es válido" 
        }, { status: 400 });
      }

      // Aquí iría la validación con la API de Shipeu
      // const response = await validateShipeuCredentials(apiKey, email);
      
      // Por ahora, simulamos una respuesta exitosa
      await prisma.session.update({
        where: { id: session.id },
        data: {
          apiKey,
          shipeuStatus: "active",
          shipeuEmail: email
        },
      });

      return json({ 
        success: true, 
        message: "Tienda sincronizada exitosamente",
        apiKey 
      });
    } catch (error) {
      console.error("Error al sincronizar tienda:", error);
      return json({ 
        success: false, 
        error: "Error al sincronizar la tienda: " + error.message 
      }, { status: 500 });
    }
  }

  return json({ success: false, error: "Acción no válida" });
};

export default function ShipeuSync() {
  const { isConfigured, apiKey: initialApiKey } = useLoaderData();
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
    storeEmail: "",
    storePhone: "",
    storeAddress: "",
    contact: "",
    company: "",
    country: "ES",
    state: "",
    city: "",
    postalCode: "",
    address: "",
    phone1: "",
    phone2: "",
    email: "",
    cif: "",
  });
  const [syncFormData, setSyncFormData] = useState({
    apiKey: "",
    email: ""
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
        storeEmail: "",
        storePhone: "",
        storeAddress: "",
        contact: "",
        company: "",
        country: "ES",
        state: "",
        city: "",
        postalCode: "",
        address: "",
        phone1: "",
        phone2: "",
        email: "",
        cif: "",
      });
    }
  }, [actionData]);

  function handleToggleApiKey() {
    setShowApiKey(!showApiKey);
    setToastMessage(showApiKey ? "API Key oculta" : "API Key visible");
    setToastActive(true);
  }

  function handleGenerateApiKey() {
    setShowApiKey(false);
    submit({ action: "generate_api_key" }, { method: "post" });
    setToastMessage("Generando nueva API Key...");
    setToastActive(true);
  }

  function handleCopyApiKey() {
    if (!currentApiKey) return;
    
    navigator.clipboard.writeText(currentApiKey);
    setToastMessage("API Key copiada al portapapeles");
    setToastActive(true);
  }

  function handleInputChange(field) {
    return (value) => {
      setFormData(prev => ({ ...prev, [field]: value }));
    };
  }

  function handleSubmit(e) {
    e.preventDefault();
    submit({ ...formData, action: "sync_store" }, { method: "post" });
  }

  const handleSyncExisting = () => {
    setShowSyncForm(true);
  };

  const handleSyncSubmit = (e) => {
    e.preventDefault();
    submit({ 
      ...syncFormData, 
      action: "sync_existing_store" 
    }, { method: "post" });
  };

  const handleSyncInputChange = (field) => {
    return (value) => {
      setSyncFormData(prev => ({ ...prev, [field]: value }));
    };
  };

  return (
    <Frame>
      <Page
        title="Configuración de Shipeu"
        backAction={{ url: "/app", content: "Volver" }}
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
                    <Text variant="headingMd">API Key de Shipeu</Text>
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
                    <Text variant="headingMd">Regenerar API Key</Text>
                    <Text as="p" variant="bodyMd" color="subdued">
                      Si necesitas una nueva API Key, puedes regenerarla. Ten en cuenta que la API Key anterior dejará de funcionar.
                    </Text>
                    <div style={{ marginTop: '1rem' }}>
                      <Button onClick={handleGenerateApiKey} tone="critical">
                        Regenerar API Key
                      </Button>
                    </div>
                  </div>
                </BlockStack>
              </Card>
            ) : showRegistrationForm ? (
              <Card sectioned>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <Text variant="headingMd">Registrarme en Shipeu</Text>
                  <Button plain onClick={() => setShowRegistrationForm(false)}>
                    Volver
                  </Button>
                </div>
                <Text color="subdued">
                  Complete el formulario para registrar su tienda en Shipeu y comenzar a disfrutar de nuestros servicios.
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
                          label="Nombre de la empresa"
                          value={formData.storeName}
                          onChange={handleInputChange("storeName")}
                          autoComplete="off"
                          required
                        />
                        <TextField
                          label="CIF"
                          value={formData.cif}
                          onChange={handleInputChange("cif")}
                          autoComplete="off"
                          required
                        />
                      </FormLayout.Group>

                      <FormLayout.Group>
                        <TextField
                          label="Contacto"
                          value={formData.contact}
                          onChange={handleInputChange("contact")}
                          autoComplete="off"
                          required
                        />
                        <TextField
                          label="Email"
                          type="email"
                          value={formData.email}
                          onChange={handleInputChange("email")}
                          autoComplete="off"
                          required
                        />
                      </FormLayout.Group>

                      <FormLayout.Group>
                        <TextField
                          label="Teléfono principal"
                          type="tel"
                          value={formData.phone1}
                          onChange={handleInputChange("phone1")}
                          autoComplete="off"
                          required
                        />
                        <TextField
                          label="Teléfono secundario"
                          type="tel"
                          value={formData.phone2}
                          onChange={handleInputChange("phone2")}
                          autoComplete="off"
                        />
                      </FormLayout.Group>

                      <FormLayout.Group condensed>
                        <div style={{ flex: '1' }}>
                          <Select
                            label="País"
                            options={[
                              {label: 'España', value: 'ES'},
                              {label: 'Otro', value: 'OTHER'}
                            ]}
                            value={formData.country}
                            onChange={handleInputChange("country")}
                            required
                          />
                        </div>
                        <div style={{ flex: '1' }}>
                          <TextField
                            label="Provincia"
                            value={formData.state}
                            onChange={handleInputChange("state")}
                            autoComplete="off"
                            required
                          />
                        </div>
                      </FormLayout.Group>

                      <FormLayout.Group>
                        <TextField
                          label="Ciudad"
                          value={formData.city}
                          onChange={handleInputChange("city")}
                          autoComplete="off"
                          required
                        />
                        <TextField
                          label="Código postal"
                          value={formData.postalCode}
                          onChange={handleInputChange("postalCode")}
                          type="text"
                          autoComplete="off"
                          required
                        />
                      </FormLayout.Group>

                      <TextField
                        label="Dirección"
                        value={formData.address}
                        onChange={handleInputChange("address")}
                        multiline={2}
                        autoComplete="off"
                        required
                      />

                      <div style={{ 
                        display: 'flex', 
                        justifyContent: 'center', 
                        marginTop: '1.5rem'
                      }}>
                        <Button submit primary size="large">
                          Registrar tienda
                        </Button>
                      </div>
                    </FormLayout>
                  </form>
                </div>
              </Card>
            ) : showSyncForm ? (
              <Card sectioned>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <Text variant="headingMd">Sincronizar tienda existente</Text>
                  <Button plain onClick={() => setShowSyncForm(false)}>
                    Volver
                  </Button>
                </div>
                <Text color="subdued">
                  Introduce tu API Key y email de Shipeu para sincronizar tu tienda.
                </Text>
                <div style={{ marginTop: '1rem' }}>
                  <form onSubmit={handleSyncSubmit}>
                    <FormLayout>
                      <TextField
                        label="API Key de Shipeu"
                        value={syncFormData.apiKey}
                        onChange={handleSyncInputChange("apiKey")}
                        type="password"
                        autoComplete="off"
                        required
                      />
                      <TextField
                        label="Email"
                        value={syncFormData.email}
                        onChange={handleSyncInputChange("email")}
                        type="email"
                        autoComplete="off"
                        required
                      />
                      <div style={{ 
                        display: 'flex', 
                        justifyContent: 'center', 
                        marginTop: '1rem'
                      }}>
                        <Button submit primary size="large">
                          Sincronizar tienda
                        </Button>
                      </div>
                    </FormLayout>
                  </form>
                </div>
              </Card>
            ) : (
              <>
                <Card sectioned>
                  <Text variant="headingMd">¿Ya eres cliente de Shipeu?</Text>
                  <Text color="subdued" as="p" variant="bodyMd">
                    Si ya tienes una cuenta en Shipeu, sincroniza tu tienda para comenzar a usar nuestros servicios.
                  </Text>
                  <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'center' }}>
                    <Button onClick={handleSyncExisting} primary size="medium">
                      Ya soy cliente - Sincronizar tienda
                    </Button>
                  </div>
                </Card>
                <div style={{ marginTop: '1rem' }}>
                  <Card sectioned>
                    <Text variant="headingMd">¿Nuevo en Shipeu?</Text>
                    <Text color="subdued" as="p" variant="bodyMd">
                      Regístrate en Shipeu para acceder a nuestros servicios de envío y gestión logística.
                    </Text>
                    <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'center' }}>
                      <Button onClick={() => setShowRegistrationForm(true)} size="medium">
                        Registrarme en Shipeu
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