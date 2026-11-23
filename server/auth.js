// Autenticación del personal (KDS y Admin).
// El PIN se valida SOLO en el servidor y se entrega un token temporal.
//
// Orden de prioridad del PIN:
//   1. Variable de entorno STAFF_PIN (si existe, manda siempre)
//   2. PIN guardado desde Admin → Ajustes (se almacena cifrado, nunca en claro)
//   3. En desarrollo, si no hay ninguno: 1234

const crypto = require('crypto');
const { permissionsOf, can } = require('./staff');

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días, se renueva con el uso
const RENEW_AFTER_MS = 12 * 60 * 60 * 1000;      // renovar como mucho cada 12 h
const MAX_FAILED = 10;                    // intentos fallidos permitidos...
const FAIL_WINDOW_MS = 10 * 60 * 1000;    // ...cada 10 minutos por IP

// Sesiones: se guarda solo el hash del token (nunca el token) y su caducidad.
// Se persisten en la base de datos para que un reinicio no cierre la sesión del KDS en pleno servicio.
const tokens = new Map();   // sha256(token) -> { exp, emp } (emp = id del empleado o 'pin')
let store = { load: () => [], save: () => {} };

const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

function setSessionStore(s) {
  store = s;
  const now = Date.now();
  for (const it of store.load() || []) {
    // Las sesiones antiguas (sin empleado) se abrieron con el PIN del local
    if (it && typeof it.h === 'string' && it.exp > now) tokens.set(it.h, { exp: it.exp, emp: it.emp || 'pin' });
  }
}

function persist() {
  try {
    store.save([...tokens].map(([h, v]) => ({ h, exp: v.exp, emp: v.emp })));
  } catch (err) {
    console.error('No se pudieron guardar las sesiones:', err.message);
  }
}
const attempts = new Map(); // ip -> { count, first }

const DEV_PIN = '1234';

let getStoredHash = () => null; // lo inyecta index.js (lee de la base de datos)
function setStoredHashGetter(fn) { getStoredHash = fn; }

// Identidades de empleados (las inyecta index.js)
let resolveEmployee = (id) => (id === 'pin' ? { id: 'pin', name: 'Dueño (PIN)', role: 'admin', active: true } : null);
let authenticateEmployee = () => null;
let pinLoginAllowed = () => true;
function setEmployeeProvider({ resolve, authenticate, allowPin }) {
  if (resolve) resolveEmployee = resolve;
  if (authenticate) authenticateEmployee = authenticate;
  if (allowPin) pinLoginAllowed = allowPin;
}

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyHash(pin, stored) {
  const [algo, salt, hash] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const test = crypto.scryptSync(String(pin), salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === test.length && crypto.timingSafeEqual(test, expected);
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// 'env' | 'stored' | 'dev' | 'none'
function pinSource() {
  if (process.env.STAFF_PIN) return 'env';
  if (getStoredHash()) return 'stored';
  return process.env.NODE_ENV === 'production' ? 'none' : 'dev';
}

function isUsingDevPin() {
  return pinSource() === 'dev';
}

function checkPin(pin) {
  if (typeof pin !== 'string' || !pin) return false;
  switch (pinSource()) {
    case 'env': return safeEqual(pin, process.env.STAFF_PIN);
    case 'stored': return verifyHash(pin, getStoredHash());
    case 'dev': return safeEqual(pin, DEV_PIN);
    default: return false;
  }
}

// Acceso con { pin } (PIN compartido del local) o { username, password } (empleado)
function login(creds, ip = 'unknown') {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (rec && now - rec.first < FAIL_WINDOW_MS && rec.count >= MAX_FAILED) {
    return { ok: false, locked: true, retryAfterSec: Math.ceil((rec.first + FAIL_WINDOW_MS - now) / 1000) };
  }
  if (typeof creds === 'string') creds = { pin: creds };

  let identity = null;
  let pinDisabled = false;
  if (creds && creds.username) {
    identity = authenticateEmployee(String(creds.username), String(creds.password || ''));
  } else if (creds && checkPin(String(creds.pin ?? ''))) {
    if (pinLoginAllowed()) identity = resolveEmployee('pin');
    else pinDisabled = true;
  }

  if (!identity) {
    if (!rec || now - rec.first >= FAIL_WINDOW_MS) attempts.set(ip, { count: 1, first: now });
    else rec.count += 1;
    return { ok: false, pinDisabled };
  }

  attempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(hashToken(token), { exp: now + TOKEN_TTL_MS, emp: identity.id });
  persist();
  return { ok: true, token, expiresAt: now + TOKEN_TTL_MS, staff: describe(identity) };
}

const describe = (who) => ({ id: who.id, name: who.name, role: who.role, permissions: permissionsOf(who.role) });

// Devuelve la identidad del empleado o null (sesión caducada, empleado desactivado…)
function verify(token) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const h = hashToken(token);
  const s = tokens.get(h);
  if (!s) return null;
  const now = Date.now();
  if (s.exp < now) {
    tokens.delete(h);
    persist();
    return null;
  }
  if (s.emp === 'pin' && !pinLoginAllowed()) return null;
  const who = resolveEmployee(s.emp);
  if (!who || !who.active) return null;
  // Renovación deslizante: mientras se use, no caduca
  if (now + TOKEN_TTL_MS - s.exp > RENEW_AFTER_MS) {
    s.exp = now + TOKEN_TTL_MS;
    persist();
  }
  return describe(who);
}

function revoke(token) {
  if (!token) return;
  if (tokens.delete(hashToken(token))) persist();
}

// Al cambiar el PIN se cierran todas las sesiones excepto la actual
function revokeAllExcept(keep) {
  const keepHash = keep ? hashToken(keep) : null;
  for (const h of [...tokens.keys()]) if (h !== keepHash) tokens.delete(h);
  persist();
}

// Cerrar las sesiones de un empleado (desactivado, contraseña o rol cambiados)
function revokeEmployee(empId) {
  let changed = false;
  for (const [h, v] of tokens) if (v.emp === empId) { tokens.delete(h); changed = true; }
  if (changed) persist();
}

function tokenFromReq(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function requireStaff(req, res, next) {
  const who = verify(tokenFromReq(req));
  if (who) {
    req.isStaff = true;
    req.staff = who;
    return next();
  }
  return res.status(401).json({ error: 'No autorizado. Inicia sesión como personal.' });
}

// Exige sesión y un permiso concreto (comprobado aquí, no en el navegador)
function requirePermission(perm) {
  return (req, res, next) => requireStaff(req, res, () => {
    if (can(req.staff.role, perm)) return next();
    return res.status(403).json({ error: 'Tu usuario no tiene permiso para esta acción.' });
  });
}

function optionalStaff(req, res, next) {
  const who = verify(tokenFromReq(req));
  req.isStaff = !!who;
  req.staff = who || null;
  next();
}

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [h, v] of tokens) if (v.exp < now) { tokens.delete(h); changed = true; }
  if (changed) persist();
  for (const [ip, rec] of attempts) if (now - rec.first >= FAIL_WINDOW_MS) attempts.delete(ip);
}, 10 * 60 * 1000).unref();

module.exports = {
  login, verify, revoke, revokeAllExcept, revokeEmployee, tokenFromReq, requireStaff, requirePermission, optionalStaff,
  setEmployeeProvider,
  isUsingDevPin, pinSource, checkPin, hashPin, setStoredHashGetter, setSessionStore, DEV_PIN
};
