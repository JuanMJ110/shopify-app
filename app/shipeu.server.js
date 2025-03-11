/**
 * Configuración de la API de Shipeu
 * Descomentar y configurar cuando se tenga acceso a la API real
 */

// const SHIPEU_CONFIG = {
//   API_URL: "https://api.shipeu.com",
//   API_VERSION: "v1",
//   APP_KEY: process.env.SHIPEU_APP_KEY, // Añadir en .env
//   TIMEOUT: 30000
// };

/**
 * IMPLEMENTACIÓN REAL DE LA API DE SHIPEU
 * Descomentar y usar cuando se tenga acceso a la API real
 */

/*
async function makeShipeuRequest(endpoint, options = {}) {
  const response = await fetch(`${SHIPEU_CONFIG.API_URL}/${SHIPEU_CONFIG.API_VERSION}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Shipeu-App-Key': SHIPEU_CONFIG.APP_KEY,
      ...options.headers,
    },
    timeout: SHIPEU_CONFIG.TIMEOUT,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Error en la comunicación con Shipeu');
  }

  return data;
}

export async function registerStore(storeData) {
  const data = await makeShipeuRequest('/stores/register', {
    method: 'POST',
    body: JSON.stringify({
      store_name: storeData.storeName,
      email: storeData.email,
      primary_phone: storeData.phone1,
      secondary_phone: storeData.phone2,
      address: storeData.storeAddress,
      contact_name: storeData.contact,
      country: storeData.country,
      state: storeData.state,
      city: storeData.city,
      postal_code: storeData.postalCode,
      tax_id: storeData.cif
    })
  });

  return {
    apiKey: data.api_key,
    storeId: data.store_id,
    status: data.status || 'active'
  };
}

export async function syncStore({ apiKey, email }) {
  const data = await makeShipeuRequest('/stores/sync', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ email })
  });

  return {
    storeId: data.store_id,
    status: data.status || 'active'
  };
}

export async function regenerateApiKey(oldApiKey) {
  const data = await makeShipeuRequest('/stores/regenerate-key', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${oldApiKey}`
    }
  });

  return {
    apiKey: data.new_api_key
  };
}
*/

/**
 * IMPLEMENTACIÓN SIMULADA
 * Usar mientras no se tenga acceso a la API real
 */

import { randomUUID } from 'crypto';

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

  // Simulamos una respuesta exitosa
  return {
    apiKey: randomUUID(),
    status: 'active'
  };
}

export async function syncStore({ apiKey, email }) {
  await new Promise(resolve => setTimeout(resolve, 500));

  if (!apiKey || !email) {
    throw new Error('API Key y email son requeridos');
  }

  if (!validateEmail(email)) {
    throw new Error('El email no es válido');
  }

  if (!validateApiKey(apiKey)) {
    throw new Error('API Key no válida');
  }

  return {
    status: 'active'
  };
}

export async function regenerateApiKey(oldApiKey) {
  await new Promise(resolve => setTimeout(resolve, 500));

  if (!validateApiKey(oldApiKey)) {
    throw new Error('API Key actual no válida');
  }

  return {
    apiKey: randomUUID()
  };
}

// Funciones de utilidad para validación
export function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validateApiKey(apiKey) {
  return apiKey && apiKey.length > 10;
} 