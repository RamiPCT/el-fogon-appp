const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const db = require('./db');
const printer = require('./printer');
const auth = require('./auth');
const staffMod = require('./staff');
const { createSales } = require('./sales');
const receipts = require('./receipts');
const time = require('./time');

// --------------------------------------------------------------------------
// ARRANQUE SEGURO
// --------------------------------------------------------------------------
const IS_PROD = process.env.NODE_ENV === 'production';
auth.setStoredHashGetter(() => db.getSettings().staffPinHash || null);
auth.setSessionStore({ load: () => db.getSessions(), save: (list) => db.setSessions(list) });
const staff = staffMod.createStaff(db);
auth.setEmployeeProvider({
  resolve: staff.resolve,
  authenticate: staff.authenticate,
  allowPin: () => db.getSettings().allowPinLogin !== false
});
const P = auth.requirePermission;
const audit = staff.audit;
const sales = createSales(db);
sales.adoptLegacyOrders();

// Un error inesperado se registra pero no tumba el servidor en pleno servicio
process.on('unhandledRejection', (err) => console.error('⚠️  Promesa rechazada sin gestionar:', err));
process.on('uncaughtException', (err) => console.error('⚠️  Error inesperado:', err));
if (IS_PROD && auth.pinSource() === 'none') {
  console.error('❌ No hay PIN de personal. Define la variable de entorno STAFF_PIN antes de arrancar en producción.');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);

// Detrás de Railway/Render/Nginx: necesario para conocer la IP real y el protocolo (https)
app.set('trust proxy', 1);
app.disable('x-powered-by');

// CORS solo si se configura explícitamente (en desarrollo Vite usa proxy y no hace falta)
const CORS_ORIGIN = process.env.CORS_ORIGIN || null;
const io = new Server(server, CORS_ORIGIN ? { cors: { origin: CORS_ORIGIN } } : {});

// Qué puede cargar la web: solo sus propios scripts; fotos de cualquier web https; fuentes de Google
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' ws: wss:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'"
].join('; ');

// En internet, todo por https
app.use((req, res, next) => {
  if (IS_PROD && req.headers['x-forwarded-proto'] === 'http' && req.method === 'GET') {
    return res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
  }
  next();
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Content-Security-Policy', CSP);
  // En internet (https) el navegador recordará usar siempre https
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (CORS_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});
// Límite de tamaño: pequeño para todo, más grande solo para subir fotos y restaurar copias
const jsonSmall = express.json({ limit: '100kb' });
const jsonLarge = express.json({ limit: '8mb' });
app.use((req, res, next) => {
  const large = /^\/api\/products\/[^/]+\/image$/.test(req.path) || req.path === '/api/admin/restore';
  return (large ? jsonLarge : jsonSmall)(req, res, next);
});

// --------------------------------------------------------------------------
// HELPERS
// --------------------------------------------------------------------------
const tz = () => db.getSettings().timezone || time.DEFAULT_TZ;

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const onlyDigits = (v) => String(v || '').replace(/\D/g, '');

// Límite sencillo de peticiones por IP (generoso: en el local muchos móviles comparten la misma Wi-Fi/IP)
function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const rec = hits.get(req.ip);
    if (!rec || now - rec.start > windowMs) {
      hits.set(req.ip, { start: now, count: 1 });
      return next();
    }
    rec.count += 1;
    if (rec.count > max) return res.status(429).json({ error: message });
    next();
  };
}
const orderLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 150, message: 'Demasiados pedidos seguidos. Espera un momento.' });
const reservationLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, message: 'Demasiadas reservas seguidas. Espera unos minutos.' });

function publicBaseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const fromSettings = db.getSettings().publicUrl;
  if (fromSettings) return fromSettings.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function bufferLimit(startTime, bufferMinutes) {
  const m = time.toMinutes(startTime);
  return m === null ? '' : time.fromMinutes(m - bufferMinutes);
}

// Estado efectivo de la mesa según la hora actual en el local.
// "full" incluye datos personales de la reserva (solo para el personal).
function enrichTable(table, { full = false } = {}) {
  const settings = db.getSettings();
  const zone = tz();
  const today = time.todayStr(zone);
  const now = time.nowMinutes(zone);
  const windowMin = settings.soonWindowMinutes || 120;
  const graceMin = 20; // margen de cortesía tras la hora de la reserva

  const upcoming = db.getReservations()
    .filter(r =>
      (r.tableId === table.id || r.tableNumber === table.number) &&
      r.status === 'CONFIRMED' &&
      (r.date || today) === today
    )
    .map(r => ({ r, start: time.toMinutes(r.startTime) }))
    .filter(x => x.start !== null && x.start + graceMin >= now)
    .sort((a, b) => a.start - b.start)[0];

  let status = table.status || 'AVAILABLE';
  if (status === 'RESERVED_SOON') status = 'AVAILABLE'; // se recalcula abajo
  let nextReservation = null;

  // Siempre se informa de la próxima reserva de HOY (sin datos personales en la vista pública),
  // para que quien se siente sepa hasta qué hora puede usar la mesa.
  const isSoon = !!upcoming && upcoming.start - now <= windowMin;
  if (upcoming) {
    const r = upcoming.r;
    nextReservation = {
      startTime: r.startTime,
      bufferLimitTime: r.bufferLimitTime || bufferLimit(r.startTime, settings.bufferMinutes || 15),
      guests: r.guests,
      soon: isSoon,
      minutesLeft: upcoming.start - now,
      ...(full ? { id: r.id, customerName: r.customerName } : {})
    };
  }
  if (isSoon && status !== 'OCCUPIED') status = 'RESERVED_SOON';

  // La clave del QR solo la ve el personal (para imprimirlo)
  const { qrToken, qrKey, ...rest } = table;
  return { ...rest, ...(full ? { qrKey } : {}), status, nextReservation };
}

const publicTables = () => db.getTables().map(t => enrichTable(t));

function broadcastTable(table) {
  if (!table) return;
  io.emit('table:status_update', enrichTable(table));
}

// Datos que puede ver cualquiera (sin impresora ni ajustes internos)
const PUBLIC_SETTING_KEYS = [
  'restaurantName', 'subtitle', 'currency', 'timezone', 'barPosition', 'bufferMinutes',
  'googleReviewUrl', 'ownerPhone', 'publicPhone', 'email', 'instagram', 'address',
  'postalCode', 'city', 'mapsUrl', 'openingHours', 'openingHours_en', 'legalName', 'nif',
  'bookingStart', 'bookingEnd', 'qrLegacyEnabled'
];
const EDITABLE_SETTING_KEYS = [
  ...PUBLIC_SETTING_KEYS, 'soonWindowMinutes', 'reservationDurationMinutes',
  'printerEnabled', 'printerIp', 'printerPort', 'allowPinLogin', 'publicUrl'
];

function pick(obj, keys) {
  return keys.reduce((acc, k) => {
    if (obj[k] !== undefined) acc[k] = obj[k];
    return acc;
  }, {});
}

function sanitizeSettings(body) {
  const out = {};
  for (const k of EDITABLE_SETTING_KEYS) {
    if (body[k] === undefined) continue;
    const v = body[k];
    if (['bufferMinutes', 'soonWindowMinutes', 'reservationDurationMinutes', 'printerPort'].includes(k)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0 && n <= 65535) out[k] = Math.round(n);
    } else if (['printerEnabled', 'allowPinLogin', 'qrLegacyEnabled'].includes(k)) {
      out[k] = Boolean(v);
    } else if (k === 'ownerPhone' || k === 'publicPhone') {
      out[k] = str(v, 30);
    } else if (k === 'openingHours' || k === 'openingHours_en') {
      out[k] = str(v, 600);
    } else if (k === 'publicUrl') {
      const u = str(v, 200).replace(/\/+$/, '');
      if (u === '' || /^https?:\/\/[^\s/]+$/i.test(u)) out[k] = u;
    } else if (k === 'instagram') {
      out[k] = str(v, 60).replace(/^@/, '');
    } else if (k === 'bookingStart' || k === 'bookingEnd') {
      if (time.toMinutes(v) !== null) out[k] = v;
    } else if (k === 'barPosition') {
      if (['top', 'bottom', 'left', 'none'].includes(v)) out[k] = v;
    } else {
      out[k] = str(v, 300);
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// AUTENTICACIÓN DEL PERSONAL
// --------------------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const b = req.body || {};
  const byUser = !!b.username;
  const result = auth.login(byUser ? { username: str(b.username, 40), password: String(b.password ?? '').slice(0, 200) } : { pin: String(b.pin ?? '') }, req.ip);
  if (result.locked) {
    res.setHeader('Retry-After', String(result.retryAfterSec));
    return res.status(429).json({ error: `Demasiados intentos. Prueba de nuevo en ${Math.ceil(result.retryAfterSec / 60)} min.` });
  }
  if (!result.ok) {
    audit(req, 'auth.login_failed', { entity: 'employee', entityId: byUser ? str(b.username, 40) : 'pin', result: 'error' });
    if (result.pinDisabled) return res.status(403).json({ error: 'El acceso con PIN está desactivado. Entra con tu usuario.' });
    return res.status(401).json({ error: byUser ? 'Usuario o contraseña incorrectos' : 'PIN incorrecto' });
  }
  req.staff = result.staff;
  audit(req, 'auth.login', { entity: 'employee', entityId: result.staff.id });
  res.json({ token: result.token, expiresAt: result.expiresAt, staff: result.staff });
});

app.post('/api/auth/logout', auth.optionalStaff, (req, res) => {
  if (req.staff) audit(req, 'auth.logout', { entity: 'employee', entityId: req.staff.id });
  auth.revoke(auth.tokenFromReq(req));
  res.json({ success: true });
});

app.get('/api/auth/check', auth.requireStaff, (req, res) => {
  res.json({ ok: true, staff: req.staff });
});

// Indica si se está usando el PIN de desarrollo (para mostrarlo en la pantalla de acceso)
app.get('/api/auth/info', (req, res) => {
  const source = auth.pinSource();
  const pinAllowed = db.getSettings().allowPinLogin !== false;
  res.json({ source, devPin: source === 'dev' && pinAllowed ? auth.DEV_PIN : null, pinAllowed, hasEmployees: staff.list().some(e => e.active) });
});

// Cambiar el PIN desde Admin → Ajustes
app.put('/api/auth/pin', P('settings.manage'), (req, res) => {
  const { currentPin, newPin } = req.body || {};
  if (auth.pinSource() === 'env') {
    return res.status(409).json({ error: 'El PIN está fijado con la variable STAFF_PIN del servidor. Cámbialo allí.' });
  }
  if (!auth.checkPin(String(currentPin || ''))) return res.status(403).json({ error: 'El PIN actual no es correcto' });
  if (!/^\d{4,12}$/.test(String(newPin || ''))) return res.status(400).json({ error: 'El nuevo PIN debe tener entre 4 y 12 números' });
  if (String(newPin) === auth.DEV_PIN) return res.status(400).json({ error: 'Elige un PIN distinto de 1234' });
  db.updateSettings({ staffPinHash: auth.hashPin(String(newPin)) });
  auth.revokeAllExcept(auth.tokenFromReq(req));
  audit(req, 'auth.pin_changed', { entity: 'settings' });
  res.json({ success: true });
});

// --------------------------------------------------------------------------
// ESTADO Y AJUSTES
// --------------------------------------------------------------------------
app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', brand: 'El Fogón', time: new Date().toISOString() });
});

app.get('/api/settings', auth.optionalStaff, (req, res) => {
  const s = db.getSettings();
  res.json(req.isStaff ? pick(s, EDITABLE_SETTING_KEYS) : pick(s, PUBLIC_SETTING_KEYS));
});

app.put('/api/settings', P('settings.manage'), (req, res) => {
  const clean = sanitizeSettings(req.body || {});
  if (clean.allowPinLogin === false && staff.activeAdminCount() === 0) {
    return res.status(409).json({ error: 'Crea antes un usuario administrador: si no, nadie podría entrar.' });
  }
  const before = pick(db.getSettings(), EDITABLE_SETTING_KEYS);
  const updated = db.updateSettings(clean);
  const changed = Object.keys(clean).filter(k => JSON.stringify(before[k]) !== JSON.stringify(updated[k]));
  if (changed.length) audit(req, 'settings.update', { entity: 'settings', before: pick(before, changed), after: pick(updated, changed) });
  io.emit('settings:update', pick(updated, PUBLIC_SETTING_KEYS));
  res.json(pick(updated, EDITABLE_SETTING_KEYS));
});

// --------------------------------------------------------------------------
// MESAS
// --------------------------------------------------------------------------
app.get('/api/tables', auth.optionalStaff, (req, res) => {
  res.json(db.getTables().map(t => enrichTable(t, { full: req.isStaff })));
});

app.get('/api/tables/:id', auth.optionalStaff, (req, res) => {
  const raw = db.getTable(req.params.id);
  if (!raw) return res.status(404).json({ error: 'Mesa no encontrada' });
  res.json(enrichTable(raw, { full: req.isStaff }));
});

app.put('/api/tables/:id', P('tables.status'), (req, res) => {
  const updates = {};
  const prev = db.getTable(req.params.id);
  if (['AVAILABLE', 'OCCUPIED'].includes(req.body?.status)) updates.status = req.body.status;
  if (req.body?.capacity !== undefined) updates.capacity = Math.max(1, Math.min(30, parseInt(req.body.capacity, 10) || 1));

  // No se libera una mesa con una cuenta sin cobrar
  if (updates.status === 'AVAILABLE' && prev) {
    const open = sales.checkForTable(prev);
    if (open && open.pendingCents > 0) {
      return res.status(409).json({ error: `La mesa ${prev.number} tiene una cuenta sin cobrar (${(open.pendingCents / 100).toFixed(2).replace('.', ',')} €). Cóbrala antes de liberarla.` });
    }
    if (open && open.pendingCents === 0) sales.closeZero(open.id, req.staff, null);
  }

  const updated = db.updateTable(req.params.id, updates);
  if (!updated) return res.status(404).json({ error: 'Mesa no encontrada' });

  // Al liberar una mesa, se cierra su cuenta (las comandas servidas dejan de sumar)
  if (updates.status === 'AVAILABLE') db.closeServedOrders(updated);

  audit(req, 'table.update', { entity: 'table', entityId: updated.number, before: prev && { status: prev.status, capacity: prev.capacity }, after: updates });
  broadcastTable(updated);
  res.json(enrichTable(updated, { full: true }));
});

// Plano del local (forma, barra, paredes, zonas...)
app.get('/api/floor', (req, res) => {
  res.json(db.getFloor());
});

const clampNum = (v, min, max, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};

function sanitizeFloor(f) {
  const cell = db.FLOOR_CELL;
  const cols = clampNum(f?.cols, 8, 80, 20);
  const rows = clampNum(f?.rows, 8, 80, 20);
  const W = cols * cell;
  const H = rows * cell;
  const voids = Array.isArray(f?.voids)
    ? [...new Set(f.voids.filter(v => typeof v === 'string' && /^\d{1,2},\d{1,2}$/.test(v)))]
        .filter(v => { const [c, r] = v.split(',').map(Number); return c < cols && r < rows; })
        .slice(0, cols * rows)
    : [];
  const elements = (Array.isArray(f?.elements) ? f.elements : []).slice(0, 120).map(e => {
    const w = clampNum(e.w, cell / 2, W, cell * 3);
    const h = clampNum(e.h, cell / 2, H, cell);
    return {
      id: str(e.id, 40) || `el-${crypto.randomUUID().slice(0, 8)}`,
      type: db.FLOOR_ELEMENT_TYPES.includes(e.type) ? e.type : 'zone',
      x: clampNum(e.x, 0, W - w, 0),
      y: clampNum(e.y, 0, H - h, 0),
      w,
      h,
      label: str(e.label, 40)
    };
  });
  return { cols, rows, cell, voids, elements };
}

// Guardar disposición del plano desde el editor del administrador
app.post('/api/tables/layout', P('floor.manage'), (req, res) => {
  const { positions, floor } = req.body || {};
  if (!Array.isArray(positions) || positions.length > 200) {
    return res.status(400).json({ error: 'Se esperaba un array de posiciones' });
  }
  const savedFloor = floor ? db.updateFloor(sanitizeFloor(floor)) : db.getFloor();
  const W = savedFloor.cols * savedFloor.cell;
  const H = savedFloor.rows * savedFloor.cell;

  // Números de mesa únicos (evita confusiones con los QR)
  const seen = new Set();
  for (const p of positions) {
    const n = str(String(p.number ?? ''), 10);
    if (!n) return res.status(400).json({ error: 'Todas las mesas necesitan un número' });
    if (seen.has(n)) return res.status(400).json({ error: `El número de mesa ${n} está repetido` });
    seen.add(n);
  }

  const clean = positions.map(p => ({
    id: str(p.id, 40) || `tbl-${crypto.randomUUID().slice(0, 8)}`,
    number: str(String(p.number ?? ''), 10),
    sectorId: str(p.sectorId, 40) || 'sec-salon',
    width: clampNum(p.width, 30, W, 75),
    height: clampNum(p.height, 30, H, 65),
    x: clampNum(p.x, 0, Math.max(0, W - clampNum(p.width, 30, W, 75)), 0),
    y: clampNum(p.y, 0, Math.max(0, H - clampNum(p.height, 30, H, 65)), 0),
    capacity: Math.max(1, Math.min(30, parseInt(p.capacity, 10) || 4)),
    shape: ['rect', 'round', 'bar_stool'].includes(p.shape) ? p.shape : 'rect',
    // El estado real lo manda el servidor (puede haber cambiado mientras se editaba el plano)
    status: (db.getTable(str(p.id, 40)) || {}).status === 'OCCUPIED' ? 'OCCUPIED' : 'AVAILABLE'
  }));

  const beforeNums = db.getTables().map(t => t.number).sort();
  db.updateTablePositions(clean);
  const afterNums = clean.map(t => t.number).sort();
  if (JSON.stringify(beforeNums) !== JSON.stringify(afterNums)) {
    audit(req, 'floor.tables_changed', { entity: 'floor', before: beforeNums, after: afterNums });
  }
  io.emit('floor:update', savedFloor);
  io.emit('table:layout_update', publicTables());
  res.json({ success: true, floor: savedFloor, tables: db.getTables().map(t => enrichTable(t, { full: true })) });
});

// --------------------------------------------------------------------------
// CARTA
// --------------------------------------------------------------------------
// Los clientes solo ven lo activo; el personal ve también lo dado de baja (para recuperarlo)
const visibleMenu = (all) => ({
  categories: db.getCategories().filter(c => all || c.active !== false),
  products: db.getProducts().filter(p => all || (p.active !== false && db.getCategories().some(c => c.id === p.categoryId && c.active !== false)))
});
const emitMenu = () => io.emit('menu:update', visibleMenu(false));

app.get('/api/menu', auth.optionalStaff, (req, res) => {
  res.json({ ...visibleMenu(req.isStaff && req.query.all === '1'), allergens: db.ALLERGENS, vatRates: VAT_RATES });
});

// Tipos de IVA permitidos (el tipo de cada producto lo decide el titular / su asesor)
const VAT_RATES = [0, 4, 10, 21];
const AREAS = ['kitchen', 'bar'];

function cleanModifiers(list) {
  if (!Array.isArray(list)) return undefined;
  return list.slice(0, 10).map(m => ({
    id: str(m.id, 40) || `mod-${crypto.randomUUID().slice(0, 6)}`,
    name: str(m.name, 40),
    required: !!m.required,
    options: (Array.isArray(m.options) ? m.options : []).map(o => str(String(o), 40)).filter(Boolean).slice(0, 15)
  })).filter(m => m.name && m.options.length);
}

// Campos de la carta ampliada (categoría, IVA, área de preparación, orden, modificadores, alta/baja)
function productExtras(b) {
  const u = {};
  if (b.categoryId !== undefined) u.categoryId = str(b.categoryId, 40);
  if (b.vatRate !== undefined) {
    if (!VAT_RATES.includes(Number(b.vatRate))) throw Object.assign(new Error('Tipo de IVA no válido'), { status: 400 });
    u.vatRate = Number(b.vatRate);
  }
  if (b.area !== undefined) u.area = AREAS.includes(b.area) ? b.area : null;
  if (b.sort !== undefined) u.sort = clampNum(b.sort, 0, 9999, 0);
  if (b.active !== undefined) u.active = !!b.active;
  const mods = cleanModifiers(b.modifiers);
  if (mods) u.modifiers = mods;
  return u;
}

app.post('/api/products', P('menu.manage'), (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 80);
  const price = Number(b.price);
  if (!name) return res.status(400).json({ error: 'Indica el nombre del plato' });
  if (!Number.isFinite(price) || price < 0 || price > 10000) return res.status(400).json({ error: 'Precio no válido' });
  const cat = db.getCategories().find(c => c.id === b.categoryId);
  if (!cat) return res.status(400).json({ error: 'Elige una categoría' });
  const prod = {
    id: `prod-${crypto.randomUUID().slice(0, 8)}`,
    categoryId: cat.id,
    name,
    name_en: str(b.name_en, 80),
    description: str(b.description, 300),
    description_en: str(b.description_en, 300),
    price: Math.round(price * 100) / 100,
    image: '',
    isAvailable: true,
    active: true,
    allergens: Array.isArray(b.allergens) ? b.allergens.filter(a => db.ALLERGENS.includes(a)) : [],
    modifiers: [],
    badge: str(b.badge, 30),
    vatRate: 10,
    area: null,
    sort: db.getProducts().filter(p => p.categoryId === cat.id).length,
    ...productExtras({ ...b, categoryId: undefined })
  };
  db.addProduct(prod);
  audit(req, 'product.create', { entity: 'product', entityId: prod.id, after: prod });
  emitMenu();
  res.status(201).json(prod);
});

// Baja: el plato deja de verse pero se conserva (los pedidos antiguos lo siguen nombrando)
app.delete('/api/products/:id', P('menu.manage'), (req, res) => {
  const prod = db.getProducts().find(p => p.id === req.params.id);
  if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });
  db.updateProduct(prod.id, { active: false });
  audit(req, 'product.deactivate', { entity: 'product', entityId: prod.id, before: { active: true }, after: { active: false } });
  emitMenu();
  res.json({ success: true });
});

app.post('/api/categories', P('menu.manage'), (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 60);
  if (!name) return res.status(400).json({ error: 'Indica el nombre de la categoría' });
  const cat = {
    id: `cat-${crypto.randomUUID().slice(0, 8)}`,
    name,
    name_en: str(b.name_en, 60),
    description: str(b.description, 160),
    description_en: str(b.description_en, 160),
    area: AREAS.includes(b.area) ? b.area : 'kitchen',
    sort: db.getCategories().length,
    active: true
  };
  db.addCategory(cat);
  audit(req, 'category.create', { entity: 'category', entityId: cat.id, after: cat });
  emitMenu();
  res.status(201).json(cat);
});

app.put('/api/categories/:id', P('menu.manage'), (req, res) => {
  const b = req.body || {};
  const cat = db.getCategories().find(c => c.id === req.params.id);
  if (!cat) return res.status(404).json({ error: 'Categoría no encontrada' });
  const u = {};
  for (const k of ['name', 'name_en']) if (b[k] !== undefined) u[k] = str(b[k], 60);
  for (const k of ['description', 'description_en']) if (b[k] !== undefined) u[k] = str(b[k], 160);
  if (b.area !== undefined && AREAS.includes(b.area)) u.area = b.area;
  if (b.sort !== undefined) u.sort = clampNum(b.sort, 0, 9999, 0);
  if (b.active !== undefined) u.active = !!b.active;
  if (u.name === '') return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
  const before = pick(cat, Object.keys(u));
  const updated = db.updateCategory(cat.id, u);
  audit(req, u.active === false ? 'category.deactivate' : 'category.update', { entity: 'category', entityId: cat.id, before, after: u });
  emitMenu();
  res.json(updated);
});

app.delete('/api/categories/:id', P('menu.manage'), (req, res) => {
  const cat = db.getCategories().find(c => c.id === req.params.id);
  if (!cat) return res.status(404).json({ error: 'Categoría no encontrada' });
  db.updateCategory(cat.id, { active: false });
  audit(req, 'category.deactivate', { entity: 'category', entityId: cat.id, before: { active: true }, after: { active: false } });
  emitMenu();
  res.json({ success: true });
});

app.put('/api/products/:id', auth.requireStaff, (req, res) => {
  const b = req.body || {};
  // Marcar agotado lo puede hacer cualquiera del equipo; el resto, solo encargado o administrador
  const onlyAvailability = Object.keys(b).every(k => ['isAvailable', 'id'].includes(k));
  if (!staffMod.can(req.staff.role, onlyAvailability ? 'menu.availability' : 'menu.manage')) {
    return res.status(403).json({ error: 'Tu usuario no tiene permiso para esta acción.' });
  }
  const prevProd = db.getProducts().find(p => p.id === req.params.id);
  const before = prevProd ? { ...prevProd } : null;
  const updates = {};
  if (b.price !== undefined) {
    const n = Number(b.price);
    if (!Number.isFinite(n) || n < 0 || n > 10000) return res.status(400).json({ error: 'Precio no válido' });
    updates.price = Math.round(n * 100) / 100;
  }
  if (b.isAvailable !== undefined) updates.isAvailable = Boolean(b.isAvailable);
  if (Array.isArray(b.allergens)) updates.allergens = b.allergens.filter(a => db.ALLERGENS.includes(a));
  for (const k of ['name', 'name_en']) if (b[k] !== undefined) updates[k] = str(b[k], 80);
  for (const k of ['description', 'description_en']) if (b[k] !== undefined) updates[k] = str(b[k], 300);
  if (b.badge !== undefined) updates.badge = str(b.badge, 30);
  Object.assign(updates, productExtras(b));
  if (updates.categoryId && !db.getCategories().some(c => c.id === updates.categoryId)) return res.status(400).json({ error: 'Categoría no válida' });

  const updated = db.updateProduct(req.params.id, updates);
  if (!updated) return res.status(404).json({ error: 'Producto no encontrado' });
  const changed = Object.keys(updates).filter(k => JSON.stringify(before?.[k]) !== JSON.stringify(updated[k]));
  if (changed.length) audit(req, 'product.update', { entity: 'product', entityId: updated.id, before: pick(before || {}, changed), after: pick(updated, changed) });
  emitMenu();
  res.json(updated);
});

// --------------------------------------------------------------------------
// QR DE LAS MESAS
// --------------------------------------------------------------------------
// Pedir, ver las comandas o llamar al camarero exige la clave del QR de ESA mesa.
// Mientras «qrLegacyEnabled» esté activo (hasta reimprimir los QR) se aceptan los QR antiguos.
const tableKeyFrom = (req) => String(req.get('X-Table-Key') || req.body?.qrKey || req.query.k || '');
function tableAccess(req, tbl) {
  if (req.isStaff) return true;
  const key = tableKeyFrom(req);
  if (key && db.getTableByQrKey(key)?.id === tbl.id) return true;
  return db.getSettings().qrLegacyEnabled !== false;
}
const denyTable = (res) => res.status(403).json({ error: 'Para pedir desde la mesa, escanea el código QR que hay en ella.', needQr: true });

// Del QR (/q/<clave>) a la mesa
app.get('/api/qr/:key', (req, res) => {
  const t = db.getTableByQrKey(String(req.params.key));
  if (!t) return res.status(404).json({ error: 'Este código QR ya no es válido. Pide ayuda al personal.' });
  res.json({ tableNumber: t.number });
});

// Regenerar el QR de una mesa (el anterior deja de funcionar)
app.post('/api/tables/:id/qr', P('floor.manage'), (req, res) => {
  const t = db.regenerateQrKey(req.params.id);
  if (!t) return res.status(404).json({ error: 'Mesa no encontrada' });
  audit(req, 'table.qr_regenerated', { entity: 'table', entityId: t.number });
  res.json({ tableNumber: t.number, qrKey: t.qrKey });
});

// --------------------------------------------------------------------------
// COMANDAS (KDS)
// --------------------------------------------------------------------------
const ORDER_STATUSES = ['RECEIVED', 'IN_PREP', 'READY', 'SERVED', 'CLOSED'];

// Comandas recientes (KDS) o histórico con filtros: ?from=AAAA-MM-DD&to=AAAA-MM-DD&table=01&status=SERVED
app.get('/api/orders', P('orders.view'), (req, res) => {
  const { from, to, table, status } = req.query;
  if (!from && !to && !table && !status) return res.json(db.getOrders().slice(0, 300));
  const zone = tz();
  const list = db.getOrders().filter(o => {
    const day = time.todayStr(zone, new Date(o.createdAt));
    if (from && day < String(from)) return false;
    if (to && day > String(to)) return false;
    if (table && o.tableNumber !== String(table)) return false;
    if (status && o.status !== String(status)) return false;
    return true;
  });
  res.json(list.slice(0, Math.min(5000, Number(req.query.limit) || 1000)));
});

// Comandas abiertas de una mesa (lo que ven los comensales en su móvil)
app.get('/api/tables/:number/orders', auth.optionalStaff, (req, res) => {
  const tbl = db.getTable(req.params.number);
  if (!tbl) return res.status(404).json({ error: 'Mesa no encontrada' });
  if (!tableAccess(req, tbl)) return denyTable(res);
  const since = Date.now() - 12 * 60 * 60 * 1000;
  const orders = db.getOrders().filter(o =>
    (o.tableId === tbl.id || o.tableNumber === tbl.number) &&
    !['PAID', 'CLOSED'].includes(o.status) &&
    new Date(o.createdAt).getTime() >= since
  );
  res.json(orders);
});

app.post('/api/orders', orderLimiter, auth.optionalStaff, (req, res) => {
  try {
    const { tableNumber, items, notes } = req.body || {};
    const tbl = db.getTable(str(String(tableNumber ?? ''), 10)) || db.getTable(str(req.body?.tableId, 40));
    if (!tbl) return res.status(400).json({ error: 'Mesa no válida' });
    if (!tableAccess(req, tbl)) return denyTable(res);
    if (req.isStaff && !staffMod.can(req.staff.role, 'orders.create')) {
      return res.status(403).json({ error: 'Tu usuario no tiene permiso para tomar pedidos.' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'El pedido debe incluir al menos un producto' });
    }
    if (items.length > 50) return res.status(400).json({ error: 'Demasiados productos en un solo pedido' });

    // Los precios SIEMPRE salen de la carta del servidor, nunca del navegador
    const products = db.getProducts();
    const cleanItems = [];
    for (const it of items) {
      const prod = products.find(p => p.id === it.productId) || products.find(p => p.name === it.name);
      if (!prod) return res.status(400).json({ error: 'Hay un producto que ya no está en la carta' });
      if (prod.active === false) return res.status(400).json({ error: 'Hay un producto que ya no está en la carta' });
      if (prod.isAvailable === false) return res.status(409).json({ error: `${prod.name} no está disponible ahora mismo` });

      const quantity = Math.min(50, Math.max(1, parseInt(it.quantity, 10) || 1));
      const modifiers = {};
      if (it.modifiers && typeof it.modifiers === 'object') {
        for (const m of prod.modifiers || []) {
          const v = it.modifiers[m.name];
          if (typeof v === 'string' && (m.options || []).includes(v)) modifiers[m.name] = v;
        }
      }
      cleanItems.push({
        productId: prod.id,
        name: prod.name,
        price: Number(prod.price) || 0,
        quantity,
        modifiers,
        notes: str(it.notes, 140),
        vatRate: prod.vatRate ?? 10,
        area: prod.area || db.getCategories().find(c => c.id === prod.categoryId)?.area || 'kitchen'
      });
    }

    const total = Math.round(cleanItems.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100;
    // El pedido se suma a la cuenta abierta de la mesa (se crea si no hay)
    const newOrder = db.transaction(() => db.createOrder({
      tableId: tbl.id,
      tableNumber: tbl.number,
      checkId: sales.ensureOpenCheck(tbl, req.staff).id,
      items: cleanItems,
      total,
      notes: str(notes, 200),
      origin: req.isStaff ? 'pos' : 'qr',
      ...(req.isStaff ? { createdBy: { id: req.staff.id, name: req.staff.name } } : {})
    }));
    audit(req, 'order.create', { entity: 'order', entityId: newOrder.orderNumber, after: { table: tbl.number, total, items: cleanItems.length, origin: newOrder.origin } });

    // Avisar al personal (KDS) y a los comensales de esa mesa
    io.to('staff').to(`table:${tbl.number}`).emit('order:new', newOrder);
    io.to('staff').emit('check:update', { tableNumber: tbl.number });
    broadcastTable(db.getTable(tbl.id));

    // Impresión térmica en segundo plano (el cliente no espera a la impresora)
    printer.printOrder(newOrder, db.getSettings(), { retry: true }).catch(err => console.error('Error de impresión:', err));

    res.status(201).json({ success: true, order: newOrder });
  } catch (err) {
    console.error('Error al crear comanda:', err);
    res.status(500).json({ error: 'Error interno al procesar la comanda' });
  }
});

app.patch('/api/orders/:id/status', P('orders.status'), (req, res) => {
  const { status } = req.body || {};
  if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'Estado no válido' });
  const prev = db.getOrders().find(o => o.id === req.params.id || o.orderNumber === req.params.id);
  const from = prev?.status;
  const updated = db.updateOrderStatus(req.params.id, status, req.staff);
  if (!updated) return res.status(404).json({ error: 'Comanda no encontrada' });
  audit(req, 'order.status', { entity: 'order', entityId: updated.orderNumber, before: { status: from }, after: { status } });

  io.to('staff').to(`table:${updated.tableNumber}`).emit('order:update', updated);
  res.json(updated);
});

// --------------------------------------------------------------------------
// RESERVAS
// --------------------------------------------------------------------------
// Sin permiso de contacto (camareros) no se envían teléfonos: no pueden llamar ni escribir a clientes
const withoutContact = (r) => { const { customerPhone, ...rest } = r; return rest; };

app.get('/api/reservations', P('reservations.manage'), (req, res) => {
  const list = [...db.getReservations()].sort((a, b) =>
    `${b.date || ''} ${b.startTime || ''}`.localeCompare(`${a.date || ''} ${a.startTime || ''}`)
  );
  res.json(staffMod.can(req.staff.role, 'customers.contact') ? list : list.map(withoutContact));
});

// Datos mínimos para la página de cancelación (el id es secreto y llega por WhatsApp)
app.get('/api/reservations/:id', (req, res) => {
  const r = db.getReservation(req.params.id);
  if (!r) return res.status(404).json({ error: 'Reserva no encontrada' });
  res.json({
    id: r.id,
    tableNumber: r.tableNumber,
    date: r.date,
    startTime: r.startTime,
    guests: r.guests,
    status: r.status,
    customerName: String(r.customerName || '').split(' ')[0]
  });
});

app.post('/api/reservations', reservationLimiter, auth.optionalStaff, (req, res) => {
  const b = req.body || {};
  const settings = db.getSettings();
  const zone = tz();
  const today = time.todayStr(zone);

  const tbl = db.getTable(str(b.tableId, 40)) || db.getTable(str(String(b.tableNumber ?? ''), 10));
  if (!tbl) return res.status(400).json({ error: 'Mesa no válida' });

  const customerName = str(b.customerName, 80);
  if (!customerName) return res.status(400).json({ error: 'Indica tu nombre' });

  const startTime = str(b.startTime, 5);
  const start = time.toMinutes(startTime);
  if (start === null) return res.status(400).json({ error: 'Hora no válida' });

  const date = b.date ? str(b.date, 10) : today;
  if (!time.isValidDate(date) || date < today) return res.status(400).json({ error: 'Fecha no válida' });
  if (!req.isStaff && date === today && start < time.nowMinutes(zone)) {
    return res.status(400).json({ error: 'Esa hora ya ha pasado. Elige otra.' });
  }

  const guests = Math.min(30, Math.max(1, parseInt(b.guests, 10) || 2));
  if (!req.isStaff && b.privacyAccepted !== true) {
    return res.status(400).json({ error: 'Debes aceptar la política de privacidad' });
  }

  // Evitar dos reservas solapadas en la misma mesa
  const dur = settings.reservationDurationMinutes || 120;
  const clash = db.getReservations().find(r =>
    r.status === 'CONFIRMED' &&
    (r.tableId === tbl.id || r.tableNumber === tbl.number) &&
    (r.date || today) === date &&
    Math.abs((time.toMinutes(r.startTime) ?? -9999) - start) < dur
  );
  if (clash) {
    return res.status(409).json({ error: `La mesa ${tbl.number} ya tiene una reserva a las ${clash.startTime}. Elige otra hora u otra mesa.` });
  }

  const bufferLimitTime = bufferLimit(startTime, settings.bufferMinutes || 15);
  const reservation = {
    id: 'res-' + crypto.randomUUID(),
    tableId: tbl.id,
    tableNumber: tbl.number,
    customerName,
    customerPhone: str(b.customerPhone, 30),
    guests,
    date,
    startTime,
    bufferLimitTime,
    status: 'CONFIRMED',
    notes: str(b.notes, 200),
    source: req.isStaff ? 'admin' : 'web',
    createdAt: new Date().toISOString()
  };

  if (req.isStaff && !staffMod.can(req.staff.role, 'reservations.manage')) {
    return res.status(403).json({ error: 'Tu usuario no tiene permiso para esta acción.' });
  }
  if (req.isStaff) reservation.createdBy = req.staff.id;
  db.addReservation(reservation);
  audit(req, 'reservation.create', { entity: 'reservation', entityId: reservation.id, after: { tableNumber: tbl.number, date, startTime, guests, source: reservation.source } });
  broadcastTable(tbl);
  // El aviso en tiempo real va sin teléfono (lo ve todo el equipo); el teléfono está en Reservas para quien tenga permiso
  io.to('staff').emit('reservation:new', withoutContact(reservation));

  // Mensaje de WhatsApp para el encargado
  const shareLink = `${publicBaseUrl(req)}/cancelar/${reservation.id}`;
  const lines = [
    '🔥 *NUEVA RESERVA - EL FOGÓN* 🔥',
    '¡Hola! Quiero confirmar mi reserva:',
    '',
    `👤 *Nombre:* ${customerName}`,
    `📅 *Fecha:* ${time.prettyDate(date)}`,
    `⏰ *Hora:* ${startTime} h`,
    `👥 *Personas:* ${guests}`,
    `🪑 *Mesa:* ${tbl.number}`
  ];
  if (reservation.customerPhone) lines.push(`📞 *Teléfono:* ${reservation.customerPhone}`);
  if (reservation.notes) lines.push(`📝 *Notas:* ${reservation.notes}`);
  lines.push('', `🔗 *Gestionar o cancelar:* ${shareLink}`, '', '¡Gracias!');

  const phoneOwner = onlyDigits(settings.ownerPhone);
  const waUrl = phoneOwner ? `https://wa.me/${phoneOwner}?text=${encodeURIComponent(lines.join('\n'))}` : null;

  res.status(201).json({ success: true, reservation, whatsAppUrl: waUrl, shareLink });
});

// Cancelación: la puede hacer el cliente con su enlace secreto o el personal
app.delete('/api/reservations/:id', auth.optionalStaff, (req, res) => {
  const existing = db.getReservation(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Reserva no encontrada' });
  if (existing.status === 'CANCELLED') return res.status(409).json({ error: 'Esta reserva ya estaba cancelada' });

  const cancelled = db.cancelReservation(req.params.id, req.staff?.id || null);
  audit(req, 'reservation.cancel', { entity: 'reservation', entityId: cancelled.id, before: { status: 'CONFIRMED' }, after: { status: 'CANCELLED', by: req.staff ? 'personal' : 'cliente' } });
  broadcastTable(db.getTable(cancelled.tableId || cancelled.tableNumber));
  io.to('staff').emit('reservation:cancelled', withoutContact(cancelled));

  const settings = db.getSettings();
  const phoneOwner = onlyDigits(settings.ownerPhone);
  const cancelText = [
    '❌ *CANCELACIÓN DE RESERVA - EL FOGÓN*',
    'Hola, cancelo la siguiente reserva:',
    '',
    `👤 *Nombre:* ${cancelled.customerName}`,
    `📅 *Fecha:* ${time.prettyDate(cancelled.date)}`,
    `⏰ *Hora:* ${cancelled.startTime} h`,
    `🪑 *Mesa:* ${cancelled.tableNumber}`,
    '',
    'La mesa ha quedado liberada en el sistema.'
  ].join('\n');
  const waUrl = phoneOwner ? `https://wa.me/${phoneOwner}?text=${encodeURIComponent(cancelText)}` : null;

  res.json({
    success: true,
    cancelled: { id: cancelled.id, tableNumber: cancelled.tableNumber, date: cancelled.date, startTime: cancelled.startTime },
    whatsAppUrl: waUrl
  });
});

// Disponibilidad de mesas para una fecha y hora (para reservar con antelación)
app.get('/api/availability', (req, res) => {
  const settings = db.getSettings();
  const zone = tz();
  const today = time.todayStr(zone);
  const date = str(req.query.date, 10) || today;
  const startTime = str(req.query.time, 5);
  const start = time.toMinutes(startTime);
  const guests = Math.max(1, parseInt(req.query.guests, 10) || 1);
  if (!time.isValidDate(date) || date < today || start === null) {
    return res.status(400).json({ error: 'Fecha u hora no válida' });
  }
  if (date === today && start < time.nowMinutes(zone)) {
    return res.status(400).json({ error: 'Esa hora ya ha pasado. Elige otra.' });
  }
  const dur = settings.reservationDurationMinutes || 120;
  const soonNow = date === today && start - time.nowMinutes(zone) < 60;

  const tables = db.getTables().map(t => {
    const clash = db.getReservations().find(r =>
      r.status === 'CONFIRMED' &&
      (r.tableId === t.id || r.tableNumber === t.number) &&
      (r.date || today) === date &&
      Math.abs((time.toMinutes(r.startTime) ?? -9999) - start) < dur
    );
    let reason = null;
    if (clash) reason = 'reserved';
    else if (soonNow && t.status === 'OCCUPIED') reason = 'occupied';
    return { id: t.id, number: t.number, capacity: t.capacity, available: !reason, fits: (t.capacity || 1) >= guests, reason, clashTime: clash ? clash.startTime : null };
  });
  res.json({ date, time: startTime, guests, tables });
});

// --------------------------------------------------------------------------
// LLAMADAS DE MESA (camarero / cuenta)
// --------------------------------------------------------------------------
const calls = [];               // avisos pendientes (en memoria)
const lastCallByTable = new Map();
const CALL_COOLDOWN_MS = 45 * 1000;

app.post('/api/tables/:number/call', auth.optionalStaff, (req, res) => {
  const tbl = db.getTable(req.params.number);
  if (!tbl) return res.status(404).json({ error: 'Mesa no encontrada' });
  if (!tableAccess(req, tbl)) return denyTable(res);
  const type = req.body?.type === 'bill' ? 'bill' : 'waiter';
  const key = `${tbl.number}:${type}`;
  const last = lastCallByTable.get(key) || 0;
  if (Date.now() - last < CALL_COOLDOWN_MS) {
    return res.status(429).json({ error: 'Ya hemos avisado al equipo. Enseguida vienen.', alreadyCalled: true });
  }
  lastCallByTable.set(key, Date.now());
  // Una sola llamada pendiente por mesa y tipo
  const existing = calls.find(c => c.tableNumber === tbl.number && c.type === type);
  const call = existing || { id: crypto.randomUUID(), tableNumber: tbl.number, type, createdAt: new Date().toISOString() };
  if (!existing) calls.push(call);
  io.to('staff').emit('call:new', call);
  res.status(201).json({ success: true, call: { id: call.id, type } });
});

app.get('/api/calls', P('calls.manage'), (req, res) => {
  res.json(calls);
});

app.post('/api/calls/:id/ack', P('calls.manage'), (req, res) => {
  const idx = calls.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Aviso no encontrado' });
  const [call] = calls.splice(idx, 1);
  lastCallByTable.delete(`${call.tableNumber}:${call.type}`);
  audit(req, 'call.ack', { entity: 'table', entityId: call.tableNumber, after: { type: call.type } });
  io.to('staff').to(`table:${call.tableNumber}`).emit('call:resolved', call);
  res.json({ success: true });
});

// --------------------------------------------------------------------------
// FOTOS DE LOS PLATOS
// --------------------------------------------------------------------------
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

app.post('/api/products/:id/image', P('menu.manage'), (req, res) => {
  const prod = db.getProducts().find(p => p.id === req.params.id);
  if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.dataUrl || ''));
  if (!m) return res.status(400).json({ error: 'Formato de imagen no válido (usa JPG, PNG o WebP)' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 5 * 1024 * 1024) return res.status(413).json({ error: 'La foto es demasiado grande (máx. 5 MB)' });
  fs.mkdirSync(db.UPLOAD_DIR, { recursive: true });
  const safeId = prod.id.replace(/[^a-z0-9-]/gi, '');
  const file = `${safeId}-${Date.now().toString(36)}.${IMAGE_TYPES[m[1]]}`;
  fs.writeFileSync(path.join(db.UPLOAD_DIR, file), buf);
  // Borrar la foto subida anterior de este plato (las de internet no se tocan)
  if (typeof prod.image === 'string' && prod.image.startsWith('/uploads/')) {
    try { fs.unlinkSync(path.join(db.UPLOAD_DIR, path.basename(prod.image))); } catch (_) { /* ya no existe */ }
  }
  const updated = db.updateProduct(prod.id, { image: `/uploads/${file}` });
  audit(req, 'product.image', { entity: 'product', entityId: prod.id, after: { image: updated.image } });
  emitMenu();
  res.json(updated);
});

// --------------------------------------------------------------------------
// COPIAS DE SEGURIDAD
// --------------------------------------------------------------------------
app.get('/api/admin/backups', P('backups.manage'), (req, res) => {
  res.json(db.listBackups().slice(0, 20));
});

app.post('/api/admin/backups', P('backups.manage'), (req, res) => {
  const name = db.backup('manual');
  if (!name) return res.status(500).json({ error: 'No se pudo crear la copia' });
  audit(req, 'backup.create', { entity: 'backup', entityId: name });
  res.status(201).json({ success: true, name });
});

app.get('/api/admin/backup/download', P('backups.manage'), (req, res) => {
  audit(req, 'backup.download', { entity: 'backup' });
  const stamp = time.todayStr(tz());
  res.setHeader('Content-Disposition', `attachment; filename="el-fogon-copia-${stamp}.json"`);
  res.type('application/json').send(JSON.stringify(db.exportData(), null, 2));
});

app.post('/api/admin/restore', P('backups.manage'), (req, res) => {
  const { name, data } = req.body || {};
  const source = name ? db.readBackup(name) : data;
  if (!source) return res.status(400).json({ error: 'Copia no encontrada o dañada' });
  try {
    db.restore(source);
  } catch (err) {
    audit(req, 'backup.restore', { entity: 'backup', entityId: name || 'archivo', result: 'error' });
    return res.status(400).json({ error: err.message });
  }
  audit(req, 'backup.restore', { entity: 'backup', entityId: name || 'archivo' });
  io.emit('floor:update', db.getFloor());
  io.emit('table:layout_update', publicTables());
  emitMenu();
  io.emit('settings:update', pick(db.getSettings(), PUBLIC_SETTING_KEYS));
  res.json({ success: true });
});

// --------------------------------------------------------------------------
// IMPRESIÓN
// --------------------------------------------------------------------------
app.get('/api/printer/history', P('printer.use'), (req, res) => {
  res.json(printer.getHistory());
});

// Ticket de prueba para comprobar la impresora desde Admin → Ajustes
app.post('/api/printer/test', P('printer.test'), async (req, res) => {
  const settings = db.getSettings();
  const sample = {
    orderNumber: 'PRUEBA',
    tableNumber: '00',
    createdAt: new Date().toISOString(),
    items: [{ name: 'Ticket de prueba · Ñandú €', price: 0, quantity: 1, modifiers: { Acentos: 'áéíóú ñ €' } }],
    total: 0,
    notes: 'Si lees bien los acentos, la ñ y el €, la impresora está lista.'
  };
  const job = await printer.printOrder(sample, settings);
  res.json({ status: job.status, error: job.error, enabled: !!settings.printerEnabled, ip: settings.printerIp, port: settings.printerPort });
});

app.post('/api/printer/reprint/:orderId', P('printer.use'), async (req, res) => {
  const order = db.getOrders().find(o => o.id === req.params.orderId || o.orderNumber === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Comanda no encontrada' });
  const printJob = await printer.printOrder(order, db.getSettings());
  audit(req, 'order.reprint', { entity: 'order', entityId: order.orderNumber, after: { status: printJob.status }, result: printJob.status === 'SENT' ? 'ok' : 'error' });
  res.json(printJob);
});

// --------------------------------------------------------------------------
// CUENTAS, COBROS, CAJA Y FACTURAS
// --------------------------------------------------------------------------
const salesError = (res, err) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error('Error en cobros/caja:', err);
  return res.status(500).json({ error: 'Error interno. No se ha guardado nada.' });
};

// Al cobrar la cuenta completa: liberar la mesa y avisar a todos
function onCheckPaid(check, freeTable) {
  if (freeTable) {
    const t = db.updateTable(check.table_id, { status: 'AVAILABLE' });
    if (t) broadcastTable(t);
  }
  io.to('staff').emit('check:update', { tableNumber: check.table_number, status: 'paid' });
}

app.get('/api/tables/:number/check', P('checks.view'), (req, res) => {
  const tbl = db.getTable(req.params.number);
  if (!tbl) return res.status(404).json({ error: 'Mesa no encontrada' });
  res.json(sales.checkForTable(tbl));
});

app.get('/api/checks', P('checks.view'), (req, res) => {
  res.json(sales.listChecks({ status: req.query.status, from: req.query.from, to: req.query.to, limit: req.query.limit }));
});

app.get('/api/checks/:id', P('checks.view'), (req, res) => {
  const s = sales.summary(req.params.id);
  if (!s) return res.status(404).json({ error: 'Cuenta no encontrada' });
  res.json(s);
});

// Anular o invitar unidades de un plato
app.post('/api/orders/:id/items/:idx/adjust', P('orders.void'), (req, res) => {
  try {
    const b = req.body || {};
    const r = sales.adjustLine(req.params.id, req.params.idx, { type: b.type, qty: b.qty, reason: b.reason }, req.staff);
    const it = r.order.items[Number(req.params.idx)];
    audit(req, b.type === 'comp' ? 'order.comp' : 'order.void', { entity: 'order', entityId: r.order.orderNumber, after: { plato: it.name, unidades: Number(b.qty) || 1, motivo: b.reason } });
    io.to('staff').to(`table:${r.order.tableNumber}`).emit('order:update', r.order);
    io.to('staff').emit('check:update', { tableNumber: r.order.tableNumber });
    res.json(r.check);
  } catch (err) { salesError(res, err); }
});

app.put('/api/checks/:id/discount', P('discounts.apply'), (req, res) => {
  try {
    const b = req.body || {};
    const before = sales.summary(req.params.id);
    const s = sales.setDiscount(req.params.id, { type: b.type, value: b.value, reason: b.reason }, req.staff);
    audit(req, 'check.discount', { entity: 'check', entityId: `Mesa ${s.tableNumber}`, before: { descuento: before?.discountCents / 100 }, after: { descuento: s.discountCents / 100, motivo: b.reason || null } });
    io.to('staff').emit('check:update', { tableNumber: s.tableNumber });
    res.json(s);
  } catch (err) { salesError(res, err); }
});

app.post('/api/checks/:id/payments', P('payments.take'), (req, res) => {
  try {
    const b = req.body || {};
    const r = sales.pay(req.params.id, {
      method: b.method, amount: b.amount, tendered: b.tendered, items: b.items,
      idempotencyKey: req.get('Idempotency-Key') || b.idempotencyKey, freeTable: b.freeTable !== false
    }, req.staff, onCheckPaid);
    if (!r.duplicate) {
      audit(req, 'payment.create', { entity: 'check', entityId: `Mesa ${r.check.tableNumber}`, after: { importe: r.payment.amountCents / 100, forma: r.payment.method, pendiente: r.check.pendingCents / 100 } });
      io.to('staff').emit('check:update', { tableNumber: r.check.tableNumber });
    }
    res.status(r.duplicate ? 200 : 201).json(r);
  } catch (err) { salesError(res, err); }
});

app.post('/api/checks/:id/close', P('payments.take'), (req, res) => {
  try {
    const s = sales.closeZero(req.params.id, req.staff, onCheckPaid);
    audit(req, 'check.close_zero', { entity: 'check', entityId: `Mesa ${s.tableNumber}` });
    res.json(s);
  } catch (err) { salesError(res, err); }
});

app.post('/api/payments/:id/refund', P('payments.refund'), (req, res) => {
  try {
    const r = sales.refund(req.params.id, req.body?.reason, req.staff);
    audit(req, 'payment.refund', { entity: 'check', entityId: `Mesa ${r.check.tableNumber}`, after: { importe: r.refund.amountCents / 100, forma: r.refund.method, motivo: req.body?.reason } });
    io.to('staff').emit('check:update', { tableNumber: r.check.tableNumber });
    res.status(201).json(r);
  } catch (err) { salesError(res, err); }
});

app.get('/api/payments', P('cash.manage'), (req, res) => {
  res.json(sales.paymentsList({ sessionId: req.query.session, limit: req.query.limit }));
});

// Ticket de cuenta (no es factura): impresora térmica
app.post('/api/checks/:id/print', P('checks.view'), async (req, res) => {
  const s = sales.summary(req.params.id);
  if (!s) return res.status(404).json({ error: 'Cuenta no encontrada' });
  const r = await printer.printText(receipts.checkTicket(s, db.getSettings()), db.getSettings(), 'Ticket de cuenta');
  res.json(r);
});

// Texto de tickets para imprimir desde el navegador (cuando no hay impresora térmica)
app.get('/api/checks/:id/text', P('checks.view'), (req, res) => {
  const s = sales.summary(req.params.id);
  if (!s) return res.status(404).json({ error: 'Cuenta no encontrada' });
  res.json({ text: receipts.checkTicket(s, db.getSettings()) });
});
app.get('/api/invoices/:id/text', P('invoices.issue'), (req, res) => {
  const inv = sales.getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });
  res.json({ text: receipts.invoiceTicket(inv, db.getSettings()) });
});
app.get('/api/cash/sessions/:id/text', P('cash.manage'), (req, res) => {
  const c = sales.sessionSummary(req.params.id);
  if (!c) return res.status(404).json({ error: 'Caja no encontrada' });
  res.json({ text: receipts.cashTicket(c, db.getSettings()) });
});

// Caja
app.get('/api/cash/current', P('payments.take'), (req, res) => {
  const c = sales.currentCash();
  if (!staffMod.can(req.staff.role, 'cash.manage')) return res.json(c ? { id: c.id, status: 'open', openedAt: c.openedAt } : null);
  res.json(c);
});

app.post('/api/cash/open', P('cash.manage'), (req, res) => {
  try {
    const c = sales.openCash(req.body?.opening ?? 0, req.staff);
    audit(req, 'cash.open', { entity: 'cash', entityId: c.id, after: { fondo: c.openingCents / 100 } });
    io.to('staff').emit('cash:update', { status: 'open' });
    res.status(201).json(c);
  } catch (err) { salesError(res, err); }
});

app.post('/api/cash/movements', P('cash.manage'), (req, res) => {
  try {
    const b = req.body || {};
    const c = sales.cashMovement({ type: b.type, amount: b.amount, reason: b.reason }, req.staff);
    audit(req, b.type === 'in' ? 'cash.in' : 'cash.out', { entity: 'cash', entityId: c.id, after: { importe: Number(b.amount), motivo: b.reason } });
    res.status(201).json(c);
  } catch (err) { salesError(res, err); }
});

app.post('/api/cash/close', P('cash.manage'), (req, res) => {
  try {
    const c = sales.closeCash({ counted: req.body?.counted, notes: req.body?.notes }, req.staff);
    audit(req, 'cash.close', { entity: 'cash', entityId: c.id, after: { esperado: c.expectedCashCents / 100, contado: c.countedCents / 100, descuadre: c.differenceCents / 100 } });
    io.to('staff').emit('cash:update', { status: 'closed' });
    res.json(c);
  } catch (err) { salesError(res, err); }
});

app.get('/api/cash/sessions', P('cash.manage'), (req, res) => {
  res.json(sales.cashHistory(req.query.limit));
});

app.post('/api/cash/sessions/:id/print', P('cash.manage'), async (req, res) => {
  const c = sales.sessionSummary(req.params.id);
  if (!c) return res.status(404).json({ error: 'Caja no encontrada' });
  res.json(await printer.printText(receipts.cashTicket(c, db.getSettings()), db.getSettings(), 'Cierre de caja'));
});

// Facturas
app.get('/api/invoices/status', P('invoices.issue'), (req, res) => {
  const { missing } = sales.issuerData();
  res.json({ ready: missing.length === 0, missing });
});

app.post('/api/checks/:id/invoice', P('invoices.issue'), (req, res) => {
  try {
    const inv = sales.issueInvoice(req.params.id, { type: req.body?.type, customer: req.body?.customer }, req.staff);
    audit(req, 'invoice.issue', { entity: 'invoice', entityId: inv.number, after: { tipo: inv.type, total: inv.totalCents / 100 } });
    res.status(201).json(inv);
  } catch (err) { salesError(res, err); }
});

app.get('/api/invoices', P('invoices.view'), (req, res) => {
  res.json(sales.listInvoices({ from: req.query.from, to: req.query.to, limit: req.query.limit }));
});

app.get('/api/invoices/verify', P('invoices.view'), (req, res) => {
  res.json(sales.verifyChain());
});

app.get('/api/invoices/:id', P('invoices.issue'), (req, res) => {
  const inv = sales.getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });
  res.json(inv);
});

app.post('/api/invoices/:id/rectify', P('invoices.rectify'), (req, res) => {
  try {
    const inv = sales.rectify(req.params.id, req.body?.reason, req.staff);
    audit(req, 'invoice.rectify', { entity: 'invoice', entityId: inv.number, after: { rectifica: inv.rectifies, motivo: req.body?.reason } });
    res.status(201).json(inv);
  } catch (err) { salesError(res, err); }
});

app.post('/api/invoices/:id/print', P('invoices.issue'), async (req, res) => {
  const inv = sales.getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });
  res.json(await printer.printText(receipts.invoiceTicket(inv, db.getSettings()), db.getSettings(), inv.number));
});

// --------------------------------------------------------------------------
// EMPLEADOS Y PERMISOS
// --------------------------------------------------------------------------
app.get('/api/staff/roles', auth.requireStaff, (req, res) => {
  res.json(Object.entries(staffMod.ROLES).map(([id, r]) => ({ id, label: r.label, permissions: staffMod.permissionsOf(id) })));
});

app.get('/api/staff', P('staff.manage'), (req, res) => {
  res.json(staff.list());
});

app.post('/api/staff', P('staff.manage'), (req, res) => {
  const b = req.body || {};
  const r = staff.create(req.staff, { name: b.name, username: b.username, password: b.password, role: b.role });
  if (r.error) return res.status(r.status).json({ error: r.error });
  audit(req, 'staff.create', { entity: 'employee', entityId: r.employee.id, after: { name: r.employee.name, username: r.employee.username, role: r.employee.role } });
  res.status(201).json(r.employee);
});

app.put('/api/staff/:id', P('staff.manage'), (req, res) => {
  const b = req.body || {};
  const r = staff.update(req.staff, req.params.id, { name: b.name, role: b.role, active: b.active, password: b.password || undefined });
  if (r.error) return res.status(r.status).json({ error: r.error });
  if (r.revokeSessions) auth.revokeEmployee(r.employee.id);
  const keys = ['name', 'role', 'active'];
  audit(req, b.password ? 'staff.update_password' : 'staff.update', { entity: 'employee', entityId: r.employee.id, before: pick(r.before, keys), after: pick(r.employee, keys) });
  res.json(r.employee);
});

// Historial de actividad (solo lectura): ?entity=order&entityId=0142&employeeId=…&action=order.&beforeId=…
app.get('/api/audit', P('audit.view'), (req, res) => {
  res.json(staff.auditList(req.query));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// Errores: JSON mal formado, cuerpo demasiado grande o fallos internos -> respuesta clara en JSON
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Datos no válidos' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Datos demasiado grandes' });
  if (err.status === 400) return res.status(400).json({ error: err.message });
  console.error('Error en', req.method, req.url, err);
  res.status(500).json({ error: 'Error interno del servidor. Inténtalo de nuevo.' });
});

// --------------------------------------------------------------------------
// WEBSOCKETS
// --------------------------------------------------------------------------
io.use((socket, next) => {
  socket.data.staff = auth.verify(socket.handshake.auth?.token);
  socket.data.isStaff = !!socket.data.staff;
  next();
});

io.on('connection', (socket) => {
  if (socket.data.isStaff) socket.join('staff');

  // Los comensales se suscriben solo a las comandas de su mesa
  socket.on('table:join', (number, key) => {
    for (const room of socket.rooms) if (room.startsWith('table:')) socket.leave(room);
    const tbl = db.getTable(String(number || ''));
    const keyOk = typeof key === 'string' && db.getTableByQrKey(key)?.id === tbl?.id;
    if (tbl && (socket.data.isStaff || keyOk || db.getSettings().qrLegacyEnabled !== false)) socket.join(`table:${tbl.number}`);
  });
});

// RGPD: anonimizar reservas antiguas al arrancar y una vez al día
const runPurge = () => {
  const n = db.anonymizeOldReservations(180);
  if (n) console.log(`🧹 ${n} reservas antiguas anonimizadas (más de 6 meses).`);
};
runPurge();
// Copia de seguridad diaria (además de la que se hace al arrancar)
setInterval(() => { runPurge(); db.backup('diaria'); }, 24 * 60 * 60 * 1000).unref();

// Refrescar estados de "reserva próxima" a medida que pasa el tiempo
let lastSnapshot = '';
setInterval(() => {
  const snap = JSON.stringify(publicTables().map(t => [t.id, t.status, t.nextReservation?.startTime || '']));
  if (snap !== lastSnapshot) {
    if (lastSnapshot) io.emit('table:layout_update', publicTables());
    lastSnapshot = snap;
  }
}, 60 * 1000).unref();

// --------------------------------------------------------------------------
// FRONTEND (producción)
// --------------------------------------------------------------------------
const distPath = path.join(__dirname, '../client/dist');
const indexHtmlPath = path.join(distPath, 'index.html');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Inserta la URL absoluta del sitio y los datos estructurados (SEO local) en el HTML
function renderIndex(req) {
  const base = publicBaseUrl(req);
  const s = db.getSettings();
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: s.restaurantName || 'El Fogón',
    url: base,
    image: `${base}/assets/og-image.jpg`,
    servesCuisine: ['Brasa', 'Picoteo', 'Coctelería'],
    acceptsReservations: true,
    address: {
      '@type': 'PostalAddress',
      streetAddress: s.address || undefined,
      postalCode: s.postalCode || undefined,
      addressLocality: s.city || 'Alicante',
      addressRegion: 'Alicante',
      addressCountry: 'ES'
    },
    telephone: s.publicPhone || undefined,
    sameAs: s.instagram ? [`https://www.instagram.com/${s.instagram}`] : undefined
  };
  const html = fs.readFileSync(indexHtmlPath, 'utf-8');
  return html
    .replace(/__SITE_URL__/g, escapeHtml(base))
    .replace('<!--SEO_JSONLD-->', `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`);
}

// Fotos subidas desde Admin → Carta
app.use('/uploads', express.static(db.UPLOAD_DIR, { maxAge: '30d', fallthrough: false }));

app.use(express.static(distPath, {
  index: false,
  setHeaders(res, filePath) {
    // Los archivos con hash pueden cachearse un año; el resto, poco tiempo
    if (filePath.includes(`${path.sep}assets${path.sep}index-`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}));

app.use((req, res, next) => {
  if (req.method !== 'GET' || req.url.startsWith('/socket.io')) return next();
  if (fs.existsSync(indexHtmlPath)) {
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(renderIndex(req));
  } else {
    res.send('El Fogón Backend API funcionando. En desarrollo, abre http://localhost:5173 para el frontend.');
  }
});

const PORT = process.env.PORT || 3001;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('=======================================================');
    console.error(`❌ El puerto ${PORT} ya está en uso: probablemente hay otra copia del servidor abierta.`);
    console.error('   Cierra las otras terminales de "npm run dev"/"npm start" (o reinicia el PC) y vuelve a intentarlo.');
    console.error('=======================================================');
    process.exit(1);
  }
  throw err;
});
server.listen(PORT, () => {
  console.log('=======================================================');
  console.log(`🔥 EL FOGÓN - SERVIDOR ACTIVO EN PUERTO ${PORT}`);
  console.log(`🌐 Local:  http://localhost:${PORT}`);
  console.log(`🕒 Zona horaria del local: ${tz()} (hoy ${time.todayStr(tz())})`);
  const src = auth.pinSource();
  if (src === 'dev') console.log('🔑 PIN de personal: 1234 (de desarrollo). Cámbialo en Admin → Ajustes o con STAFF_PIN.');
  else if (src === 'env') console.log('🔑 PIN de personal: definido con la variable STAFF_PIN.');
  else console.log('🔑 PIN de personal: el que guardaste en Admin → Ajustes.');
  console.log('=======================================================');
});
