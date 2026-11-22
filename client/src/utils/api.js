// Acceso a la API con sesión de personal (token emitido por el servidor tras validar el PIN).

const TOKEN_KEY = 'fogon_staff_token';

const storage = {
  get(key) {
    try { return window.localStorage.getItem(key); } catch (_) { return null; }
  },
  set(key, value) {
    try { window.localStorage.setItem(key, value); } catch (_) { /* modo privado */ }
  },
  remove(key) {
    try { window.localStorage.removeItem(key); } catch (_) { /* modo privado */ }
  }
};

export const getStaffToken = () => storage.get(TOKEN_KEY);

export const setStaffToken = (token) => {
  storage.set(TOKEN_KEY, token);
  window.dispatchEvent(new Event('auth:changed'));
};

export const clearStaffToken = () => {
  storage.remove(TOKEN_KEY);
  window.dispatchEvent(new Event('auth:changed'));
};

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// fetch con JSON, token de personal y errores legibles
export async function api(url, { method = 'GET', body, headers = {} } = {}) {
  const token = getStaffToken();
  const res = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  let data = null;
  try { data = await res.json(); } catch (_) { /* respuesta sin JSON */ }

  if (res.status === 401 && token) {
    clearStaffToken();
    window.dispatchEvent(new Event('auth:expired'));
  }
  if (!res.ok) {
    throw new ApiError((data && data.error) || `Error ${res.status}`, res.status);
  }
  return data;
}

export async function staffLogin(pin) {
  const data = await api('/api/auth/login', { method: 'POST', body: { pin } });
  setStaffToken(data.token);
  return data;
}

export async function staffLogout() {
  try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch (_) { /* da igual */ }
  clearStaffToken();
}

export { storage };
