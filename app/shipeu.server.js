/**
 * Configuración de la API de Shipeu
 */

const SHIPEU_CONFIG = {
  API_URL: "http://localhost/shipeu/public/api/shopify",
  SHIPEU_API_KEY: "08afb311-1009-45a9-923e-0c032a4676e2", // API key general para todas las peticiones
  TIMEOUT: 30000
};

/**
 * IMPLEMENTACIÓN REAL DE LA API DE SHIPEU
 */

async function makeShipeuRequest(endpoint, options = {}) {
  try {
    const response = await fetch(`${SHIPEU_CONFIG.API_URL}${endpoint}`, { 
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${SHIPEU_CONFIG.SHIPEU_API_KEY}`,
        ...options.headers,
      },
      timeout: SHIPEU_CONFIG.TIMEOUT,
    });

    // Primero verificamos si la respuesta es JSON
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      throw new Error("La respuesta del servidor no es JSON válido");
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Error en la comunicación con Shipeu');
    }

    return data;
  } catch (error) {
    if (error.name === 'SyntaxError') {
      throw new Error('La respuesta del servidor no es JSON válido');
    }
    throw error;
  }
}

export async function registerStore(storeData) {
  const response = await makeShipeuRequest('/store/register', {
    method: 'POST',
    body: JSON.stringify({
      storeName: storeData.storeName,
      email: storeData.email,
      phone1: storeData.phone1,
      phone2: storeData.phone2,
      storeAddress: storeData.storeAddress,
      contact: storeData.contact,
      country: storeData.country,
      state: storeData.state,
      city: storeData.city,
      postalCode: storeData.postalCode,
      cif: storeData.cif
    })
  });

  // La respuesta ya tiene la estructura correcta
  return {
    apiKey: response.data.apiKey,
    shipeuId: response.data.storeId.toString(),
    status: response.data.status
  };
}

export async function syncStore({ email }) {
  const response = await makeShipeuRequest('/store/sync', {
    method: 'POST',
    body: JSON.stringify({ email })
  });

  return {
    shipeuId: response.data.storeId.toString(),
    status: response.data.status,
    apiKey: response.data.apiKey
  };
}

export async function regenerateApiKey(oldApiKey) {
  const response = await makeShipeuRequest('/store/regenerate-key', {
    method: 'POST',
    body: JSON.stringify({ apiKey: oldApiKey })
  });

  return {
    apiKey: response.data.apiKey
  };
}

/**
 * IMPLEMENTACIÓN SIMULADA
 * Usar mientras no se tenga acceso a la API real
 */

/*
import { randomUUID } from 'crypto';

// Simulamos la configuración
const MOCK_CONFIG = {
  SHIPEU_API_KEY: process.env.SHIPEU_SHOPIFY_API_KEY || 'test_api_key'
};

export async function registerStore(storeData) {
  // Simulamos un delay para hacer más realista la respuesta
  await new Promise(resolve => setTimeout(resolve, 500));

  // Validamos campos requeridos
  const requiredFields = ['storeName', 'email', 'phone1', 'storeAddress', 'cif'];
  for (const field of requiredFields) {
    if (!storeData[field]) {
      throw new Error(`El campo ${field} es requerido`);
    }
  }

  if (!validateEmail(storeData.email)) {
    throw new Error('El email no es válido');
  }

  // Validamos que se esté usando la API key correcta
  if (!validateShipeuApiKey()) {
    throw new Error('API Key general no válida');
  }

  // Simulamos una respuesta exitosa
  return {
    apiKey: randomUUID(),
    status: 'active'
  };
}

export async function syncStore({ email }) {
  await new Promise(resolve => setTimeout(resolve, 500));

  if (!email) {
    throw new Error('Email es requerido');
  }

  if (!validateEmail(email)) {
    throw new Error('El email no es válido');
  }

  // Validamos que se esté usando la API key correcta
  if (!validateShipeuApiKey()) {
    throw new Error('API Key general no válida');
  }

  return {
    status: 'active'
  };
}

export async function regenerateApiKey(oldApiKey) {
  await new Promise(resolve => setTimeout(resolve, 500));

  // Validamos que se esté usando la API key correcta
  if (!validateShipeuApiKey()) {
    throw new Error('API Key general no válida');
  }

  return {
    apiKey: randomUUID()
  };
}
*/

// Funciones de utilidad para validación
export function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validateApiKey(apiKey) {
  return apiKey && apiKey.length > 10;
}

// Nueva función para validar la API key general
function validateShipeuApiKey() {
  return SHIPEU_CONFIG.SHIPEU_API_KEY && SHIPEU_CONFIG.SHIPEU_API_KEY.length > 10;
} 