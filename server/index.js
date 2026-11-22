const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const db = require('./db');
const printer = require('./printer');
const auth = require('./auth');
const time = require('./time');

// --------------------------------------------------------------------------
// ARRANQUE SEGURO
// --------------------------------------------------------------------------
const IS_PROD = process.env.NODE_ENV === 'production';
auth.setStoredHashGetter(() => db.getSettings().staffPinHash || null);
auth.setSessionStore({ load: () => db.getSessions(), save: (list) => db.setSessions(list) });

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

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (CORS_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});
app.use(express.json({ limit: '100kb' }));

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

  const { qrToken, ...rest } = table;
  return { ...rest, status, nextReservation };
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
  'bookingStart', 'bookingEnd'
];
const EDITABLE_SETTING_KEYS = [
  ...PUBLIC_SETTING_KEYS, 'soonWindowMinutes', 'reservationDurationMinutes',
  'printerEnabled', 'printerIp', 'printerPort'
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
    } else if (k === 'printerEnabled') {
      out[k] = Boolean(v);
    } else if (k === 'ownerPhone' || k === 'publicPhone') {
      out[k] = str(v, 30);
    } else if (k === 'openingHours' || k === 'openingHours_en') {
      out[k] = str(v, 600);
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
  const result = auth.login(String(req.body?.pin ?? ''), req.ip);
  if (result.locked) {
    res.setHeader('Retry-After', String(result.retryAfterSec));
    return res.status(429).json({ error: `Demasiados intentos. Prueba de nuevo en ${Math.ceil(result.retryAfterSec / 60)} min.` });
  }
  if (!result.ok) return res.status(401).json({ error: 'PIN incorrecto' });
  res.json({ token: result.token, expiresAt: result.expiresAt });
});

app.post('/api/auth/logout', (req, res) => {
  auth.revoke(auth.tokenFromReq(req));
  res.json({ success: true });
});

app.get('/api/auth/check', auth.requireStaff, (req, res) => {
  res.json({ ok: true });
});

// Indica si se está usando el PIN de desarrollo (para mostrarlo en la pantalla de acceso)
app.get('/api/auth/info', (req, res) => {
  const source = auth.pinSource();
  res.json({ source, devPin: source === 'dev' ? auth.DEV_PIN : null });
});

// Cambiar el PIN desde Admin → Ajustes
app.put('/api/auth/pin', auth.requireStaff, (req, res) => {
  const { currentPin, newPin } = req.body || {};
  if (auth.pinSource() === 'env') {
    return res.status(409).json({ error: 'El PIN está fijado con la variable STAFF_PIN del servidor. Cámbialo allí.' });
  }
  if (!auth.checkPin(String(currentPin || ''))) return res.status(403).json({ error: 'El PIN actual no es correcto' });
  if (!/^\d{4,12}$/.test(String(newPin || ''))) return res.status(400).json({ error: 'El nuevo PIN debe tener entre 4 y 12 números' });
  if (String(newPin) === auth.DEV_PIN) return res.status(400).json({ error: 'Elige un PIN distinto de 1234' });
  db.updateSettings({ staffPinHash: auth.hashPin(String(newPin)) });
  auth.revokeAllExcept(auth.tokenFromReq(req));
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

app.put('/api/settings', auth.requireStaff, (req, res) => {
  const updated = db.updateSettings(sanitizeSettings(req.body || {}));
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

app.put('/api/tables/:id', auth.requireStaff, (req, res) => {
  const updates = {};
  if (['AVAILABLE', 'OCCUPIED'].includes(req.body?.status)) updates.status = req.body.status;
  if (req.body?.capacity !== undefined) updates.capacity = Math.max(1, Math.min(30, parseInt(req.body.capacity, 10) || 1));

  const updated = db.updateTable(req.params.id, updates);
  if (!updated) return res.status(404).json({ error: 'Mesa no encontrada' });

  // Al liberar una mesa, se cierra su cuenta (las comandas servidas dejan de sumar)
  if (updates.status === 'AVAILABLE') db.closeServedOrders(updated);

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
app.post('/api/tables/layout', auth.requireStaff, (req, res) => {
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

  db.updateTablePositions(clean);
  io.emit('floor:update', savedFloor);
  io.emit('table:layout_update', publicTables());
  res.json({ success: true, floor: savedFloor, tables: db.getTables().map(t => enrichTable(t, { full: true })) });
});

// --------------------------------------------------------------------------
// CARTA
// --------------------------------------------------------------------------
app.get('/api/menu', (req, res) => {
  res.json({
    categories: db.getCategories(),
    products: db.getProducts(),
    allergens: db.ALLERGENS
  });
});

app.put('/api/products/:id', auth.requireStaff, (req, res) => {
  const b = req.body || {};
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

  const updated = db.updateProduct(req.params.id, updates);
  if (!updated) return res.status(404).json({ error: 'Producto no encontrado' });
  io.emit('menu:update', { categories: db.getCategories(), products: db.getProducts() });
  res.json(updated);
});

// --------------------------------------------------------------------------
// COMANDAS (KDS)
// --------------------------------------------------------------------------
const ORDER_STATUSES = ['RECEIVED', 'IN_PREP', 'READY', 'SERVED', 'CLOSED'];

app.get('/api/orders', auth.requireStaff, (req, res) => {
  res.json(db.getOrders().slice(0, 300));
});

// Comandas abiertas de una mesa (lo que ven los comensales en su móvil)
app.get('/api/tables/:number/orders', (req, res) => {
  const tbl = db.getTable(req.params.number);
  if (!tbl) return res.status(404).json({ error: 'Mesa no encontrada' });
  const since = Date.now() - 12 * 60 * 60 * 1000;
  const orders = db.getOrders().filter(o =>
    (o.tableId === tbl.id || o.tableNumber === tbl.number) &&
    !['PAID', 'CLOSED'].includes(o.status) &&
    new Date(o.createdAt).getTime() >= since
  );
  res.json(orders);
});

app.post('/api/orders', orderLimiter, (req, res) => {
  try {
    const { tableNumber, items, notes } = req.body || {};
    const tbl = db.getTable(str(String(tableNumber ?? ''), 10)) || db.getTable(str(req.body?.tableId, 40));
    if (!tbl) return res.status(400).json({ error: 'Mesa no válida' });
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
        notes: str(it.notes, 140)
      });
    }

    const total = Math.round(cleanItems.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100;
    const newOrder = db.createOrder({
      tableId: tbl.id,
      tableNumber: tbl.number,
      items: cleanItems,
      total,
      notes: str(notes, 200)
    });

    // Avisar al personal (KDS) y a los comensales de esa mesa
    io.to('staff').to(`table:${tbl.number}`).emit('order:new', newOrder);
    broadcastTable(db.getTable(tbl.id));

    // Impresión térmica en segundo plano (el cliente no espera a la impresora)
    printer.printOrder(newOrder, db.getSettings()).catch(err => console.error('Error de impresión:', err));

    res.status(201).json({ success: true, order: newOrder });
  } catch (err) {
    console.error('Error al crear comanda:', err);
    res.status(500).json({ error: 'Error interno al procesar la comanda' });
  }
});

app.patch('/api/orders/:id/status', auth.requireStaff, (req, res) => {
  const { status } = req.body || {};
  if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'Estado no válido' });
  const updated = db.updateOrderStatus(req.params.id, status);
  if (!updated) return res.status(404).json({ error: 'Comanda no encontrada' });

  io.to('staff').to(`table:${updated.tableNumber}`).emit('order:update', updated);
  res.json(updated);
});

// --------------------------------------------------------------------------
// RESERVAS
// --------------------------------------------------------------------------
app.get('/api/reservations', auth.requireStaff, (req, res) => {
  const list = [...db.getReservations()].sort((a, b) =>
    `${b.date || ''} ${b.startTime || ''}`.localeCompare(`${a.date || ''} ${a.startTime || ''}`)
  );
  res.json(list);
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

  db.addReservation(reservation);
  broadcastTable(tbl);
  io.to('staff').emit('reservation:new', reservation);

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
app.delete('/api/reservations/:id', (req, res) => {
  const existing = db.getReservation(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Reserva no encontrada' });
  if (existing.status === 'CANCELLED') return res.status(409).json({ error: 'Esta reserva ya estaba cancelada' });

  const cancelled = db.cancelReservation(req.params.id);
  broadcastTable(db.getTable(cancelled.tableId || cancelled.tableNumber));
  io.to('staff').emit('reservation:cancelled', cancelled);

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

app.post('/api/tables/:number/call', (req, res) => {
  const tbl = db.getTable(req.params.number);
  if (!tbl) return res.status(404).json({ error: 'Mesa no encontrada' });
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

app.get('/api/calls', auth.requireStaff, (req, res) => {
  res.json(calls);
});

app.post('/api/calls/:id/ack', auth.requireStaff, (req, res) => {
  const idx = calls.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Aviso no encontrado' });
  const [call] = calls.splice(idx, 1);
  lastCallByTable.delete(`${call.tableNumber}:${call.type}`);
  io.to('staff').to(`table:${call.tableNumber}`).emit('call:resolved', call);
  res.json({ success: true });
});

// --------------------------------------------------------------------------
// IMPRESIÓN
// --------------------------------------------------------------------------
app.get('/api/printer/history', auth.requireStaff, (req, res) => {
  res.json(printer.getHistory());
});

app.post('/api/printer/reprint/:orderId', auth.requireStaff, async (req, res) => {
  const order = db.getOrders().find(o => o.id === req.params.orderId || o.orderNumber === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Comanda no encontrada' });
  const printJob = await printer.printOrder(order, db.getSettings());
  res.json(printJob);
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// Errores: JSON mal formado, cuerpo demasiado grande o fallos internos -> respuesta clara en JSON
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Datos no válidos' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Datos demasiado grandes' });
  console.error('Error en', req.method, req.url, err);
  res.status(500).json({ error: 'Error interno del servidor. Inténtalo de nuevo.' });
});

// --------------------------------------------------------------------------
// WEBSOCKETS
// --------------------------------------------------------------------------
io.use((socket, next) => {
  socket.data.isStaff = auth.verify(socket.handshake.auth?.token);
  next();
});

io.on('connection', (socket) => {
  if (socket.data.isStaff) socket.join('staff');

  // Los comensales se suscriben solo a las comandas de su mesa
  socket.on('table:join', (number) => {
    for (const room of socket.rooms) if (room.startsWith('table:')) socket.leave(room);
    const tbl = db.getTable(String(number || ''));
    if (tbl) socket.join(`table:${tbl.number}`);
  });
});

// RGPD: anonimizar reservas antiguas al arrancar y una vez al día
const runPurge = () => {
  const n = db.anonymizeOldReservations(180);
  if (n) console.log(`🧹 ${n} reservas antiguas anonimizadas (más de 6 meses).`);
};
runPurge();
setInterval(runPurge, 24 * 60 * 60 * 1000).unref();

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
