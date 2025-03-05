import { Link, Outlet, useLoaderData, useRouteError, useLocation } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";
import { HomeIcon, SettingsIcon } from "@shopify/polaris-icons";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();
  const location = useLocation();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link 
          to="/app" 
          rel="home"
          style={{
            display: 'block',
            padding: '0.5rem 2rem',
            textDecoration: 'none',
            color: location.pathname === '/app' ? '#202223' : '#6D7175',
            fontWeight: location.pathname === '/app' ? '600' : 'normal'
          }}
        >
          Inicio
        </Link>
        <Link 
          to="/app/shipeu-sync" 
          rel="shipeu-sync"
          style={{
            display: 'block',
            padding: '0.5rem 2rem',
            textDecoration: 'none',
            color: location.pathname === '/app/shipeu-sync' ? '#202223' : '#6D7175',
            fontWeight: location.pathname === '/app/shipeu-sync' ? '600' : 'normal'
          }}
        >
          Configuración Shipeu
        </Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
