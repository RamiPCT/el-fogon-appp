// Autenticación del personal (KDS y Admin).
// El PIN se valida SOLO en el servidor y se entrega un token temporal.
//
// Orden de prioridad del PIN:
//   1. Variable de entorno STAFF_PIN (si existe, manda siempre)
//   2. PIN guardado desde Admin → Ajustes (se almacena cifrado, nunca en claro)
//   3. En desarrollo, si no hay ninguno: 1234

const crypto = require('crypto');

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días, se renueva con el uso
const RENEW_AFTER_MS = 12 * 60 * 60 * 1000;      // renovar como mucho cada 12 h
const MAX_FAILED = 10;                    // intentos fallidos permitidos...
const FAIL_WINDOW_MS = 10 * 60 * 1000;    // ...cada 10 minutos por IP

// Sesiones: se guarda solo el hash del token (nunca el token) y su caducidad.
// Se persisten en la base de datos para que un reinicio no cierre la sesión del KDS en pleno servicio.
const tokens = new Map();   // sha256(token) -> expiresAt
let store = { load: () => [], save: () => {} };

const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

function setSessionStore(s) {
  store = s;
  const now = Date.now();
  for (const it of store.load() || []) {
    if (it && typeof it.h === 'string' && it.exp > now) tokens.set(it.h, it.exp);
  }
}

function persist() {
  try {
    store.save([...tokens].map(([h, exp]) => ({ h, exp })));
  } catch (err) {
    console.error('No se pudieron guardar las sesiones:', err.message);
  }
}
const attempts = new Map(); // ip -> { count, first }

const DEV_PIN = '1234';

let getStoredHash = () => null; // lo inyecta index.js (lee de la base de datos)
function setStoredHashGetter(fn) { getStoredHash = fn; }

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

function login(pin, ip = 'unknown') {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (rec && now - rec.first < FAIL_WINDOW_MS && rec.count >= MAX_FAILED) {
    return { ok: false, locked: true, retryAfterSec: Math.ceil((rec.first + FAIL_WINDOW_MS - now) / 1000) };
  }

  if (!checkPin(pin)) {
    if (!rec || now - rec.first >= FAIL_WINDOW_MS) attempts.set(ip, { count: 1, first: now });
    else rec.count += 1;
    return { ok: false };
  }

  attempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(hashToken(token), now + TOKEN_TTL_MS);
  persist();
  return { ok: true, token, expiresAt: now + TOKEN_TTL_MS };
}

function verify(token) {
  if (!token || typeof token !== 'string' || token.length > 200) return false;
  const h = hashToken(token);
  const exp = tokens.get(h);
  if (!exp) return false;
  const now = Date.now();
  if (exp < now) {
    tokens.delete(h);
    persist();
    return false;
  }
  // Renovación deslizante: mientras se use, no caduca
  if (now + TOKEN_TTL_MS - exp > RENEW_AFTER_MS) {
    tokens.set(h, now + TOKEN_TTL_MS);
    persist();
  }
  return true;
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

function tokenFromReq(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function requireStaff(req, res, next) {
  if (verify(tokenFromReq(req))) {
    req.isStaff = true;
    return next();
  }
  return res.status(401).json({ error: 'No autorizado. Inicia sesión como personal.' });
}

function optionalStaff(req, res, next) {
  req.isStaff = verify(tokenFromReq(req));
  next();
}

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [h, exp] of tokens) if (exp < now) { tokens.delete(h); changed = true; }
  if (changed) persist();
  for (const [ip, rec] of attempts) if (now - rec.first >= FAIL_WINDOW_MS) attempts.delete(ip);
}, 10 * 60 * 1000).unref();

module.exports = {
  login, verify, revoke, revokeAllExcept, tokenFromReq, requireStaff, optionalStaff,
  isUsingDevPin, pinSource, checkPin, hashPin, setStoredHashGetter, setSessionStore, DEV_PIN
};
