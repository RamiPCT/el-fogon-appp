// Acceso a la API con sesión de personal (token emitido por el servidor tras validar el PIN).

const TOKEN_KEY = 'fogon_staff_token';
const STAFF_KEY = 'fogon_staff_info';

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

export const setStaffToken = (token, staff) => {
  storage.set(TOKEN_KEY, token);
  if (staff) storage.set(STAFF_KEY, JSON.stringify(staff));
  window.dispatchEvent(new Event('auth:changed'));
};

export const clearStaffToken = () => {
  storage.remove(TOKEN_KEY);
  storage.remove(STAFF_KEY);
  window.dispatchEvent(new Event('auth:changed'));
};

// Quién ha iniciado sesión y qué permisos tiene (lo confirma el servidor en /api/auth/check)
export const getStaffInfo = () => {
  try { return JSON.parse(storage.get(STAFF_KEY) || 'null'); } catch (_) { return null; }
};

export const setStaffInfo = (staff) => {
  if (!staff) return;
  storage.set(STAFF_KEY, JSON.stringify(staff));
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

// Acceso con PIN (texto) o con { username, password }
export async function staffLogin(creds) {
  const body = typeof creds === 'string' ? { pin: creds } : creds;
  const data = await api('/api/auth/login', { method: 'POST', body });
  setStaffToken(data.token, data.staff);
  return data;
}

export async function staffLogout() {
  try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch (_) { /* da igual */ }
  clearStaffToken();
}

export { storage };
