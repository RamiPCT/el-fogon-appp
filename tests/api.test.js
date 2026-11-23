// Pruebas automáticas del servidor (sin dependencias extra): `npm test`
// Arranca el servidor con una carpeta de datos temporal y un puerto libre,
// así nunca toca los datos reales de server/data/db.json.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'server', 'index.js');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fogon-test-'));
const PORT = 3900 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const PIN = '4321';
let proc;
let token;

const start = () => new Promise((resolve, reject) => {
  proc = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR, STAFF_PIN: PIN, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  const timer = setTimeout(() => reject(new Error(`El servidor no arrancó:\n${out}`)), 15000);
  const onData = (d) => {
    out += d;
    if (out.includes('SERVIDOR ACTIVO')) { clearTimeout(timer); resolve(); }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('exit', (code) => { clearTimeout(timer); if (code) reject(new Error(`Servidor salió (${code}):\n${out}`)); });
});
const stop = () => new Promise((resolve) => {
  if (!proc || proc.exitCode !== null) return resolve();
  proc.once('exit', resolve);
  proc.kill();
});

const call = async (method, url, body, auth = true) => {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: res.status, data };
};

const tomorrow = () => {
  const d = new Date(Date.now() + 36 * 3600 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d);
};

before(start);
after(async () => { await stop(); fs.rmSync(DATA_DIR, { recursive: true, force: true }); });

test('el servidor responde', async () => {
  const r = await call('GET', '/api/status', undefined, false);
  assert.equal(r.status, 200);
});

test('PIN incorrecto se rechaza y el correcto da acceso', async () => {
  const bad = await call('POST', '/api/auth/login', { pin: '0000' }, false);
  assert.equal(bad.status, 401);
  const ok = await call('POST', '/api/auth/login', { pin: PIN }, false);
  assert.equal(ok.status, 200);
  assert.ok(ok.data.token);
  token = ok.data.token;
  assert.equal((await call('GET', '/api/auth/check')).status, 200);
});

test('las rutas del personal exigen sesión', async () => {
  for (const url of ['/api/orders', '/api/reservations', '/api/admin/backups', '/api/calls']) {
    const r = await call('GET', url, undefined, false);
    assert.equal(r.status, 401, url);
  }
});

test('el precio del pedido lo calcula el servidor, no el navegador', async () => {
  const menu = (await call('GET', '/api/menu', undefined, false)).data;
  const prod = menu.products.find(p => p.isAvailable !== false);
  const tables = (await call('GET', '/api/tables', undefined, false)).data;
  const r = await call('POST', '/api/orders', {
    tableNumber: tables[0].number,
    items: [{ productId: prod.id, quantity: 2, price: 0.01 }]
  }, false);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(Math.round(r.data.order.total * 100), Math.round(prod.price * 2 * 100));
});

test('pedido con mesa o producto inexistente se rechaza', async () => {
  assert.equal((await call('POST', '/api/orders', { tableNumber: 'ZZ', items: [{ productId: 'x' }] }, false)).status, 400);
  const tables = (await call('GET', '/api/tables', undefined, false)).data;
  assert.equal((await call('POST', '/api/orders', { tableNumber: tables[0].number, items: [{ productId: 'no-existe' }] }, false)).status, 400);
});

test('no se pueden hacer dos reservas solapadas en la misma mesa', async () => {
  const tables = (await call('GET', '/api/tables', undefined, false)).data;
  const t = tables[0];
  const base = { tableId: t.id, date: tomorrow(), guests: 2, privacyAccepted: true, customerPhone: '600000000' };
  const a = await call('POST', '/api/reservations', { ...base, customerName: 'Prueba A', startTime: '21:00' }, false);
  assert.equal(a.status, 201, JSON.stringify(a.data));
  const b = await call('POST', '/api/reservations', { ...base, customerName: 'Prueba B', startTime: '21:30' }, false);
  assert.equal(b.status, 409);
  const avail = await call('GET', `/api/availability?date=${tomorrow()}&time=21:30&guests=2`, undefined, false);
  assert.equal(avail.status, 200);
  const list = Array.isArray(avail.data) ? avail.data : avail.data.tables;
  const row = list.find(x => x.id === t.id || x.number === t.number);
  assert.ok(row && row.available === false, 'la mesa reservada debe salir no disponible');
  // Cancelar y volver a reservar
  const del = await call('DELETE', `/api/reservations/${a.data.reservation.id}`, undefined, true);
  assert.equal(del.status, 200);
  const c = await call('POST', '/api/reservations', { ...base, customerName: 'Prueba C', startTime: '21:30' }, false);
  assert.equal(c.status, 201);
});

test('reserva sin aceptar privacidad o con fecha pasada se rechaza', async () => {
  const tables = (await call('GET', '/api/tables', undefined, false)).data;
  const base = { tableId: tables[1].id, customerName: 'X', startTime: '22:00', guests: 2 };
  assert.equal((await call('POST', '/api/reservations', { ...base, date: tomorrow() }, false)).status, 400);
  assert.equal((await call('POST', '/api/reservations', { ...base, date: '2020-01-01', privacyAccepted: true }, false)).status, 400);
});

test('llamar al camarero y marcarlo como atendido', async () => {
  const tables = (await call('GET', '/api/tables', undefined, false)).data;
  const r = await call('POST', `/api/tables/${tables[0].number}/call`, { type: 'waiter' }, false);
  assert.ok(r.status === 200 || r.status === 201, JSON.stringify(r.data));
  const calls = (await call('GET', '/api/calls')).data;
  assert.ok(calls.length >= 1);
  assert.equal((await call('POST', `/api/calls/${calls[0].id}/ack`, {})).status, 200);
});

test('el plano se guarda y limpia valores fuera de rango', async () => {
  const tables = (await call('GET', '/api/tables')).data;
  const floor = { cols: 9999, rows: 30, cell: 20, voids: ['1,1', 'basura'], elements: [{ id: 'e1', type: 'bar', x: 20, y: 20, w: 100, h: 40, label: 'Barra' }, { type: 'misil' }] };
  const positions = tables.map((t, i) => ({ ...t, x: 20 + i * 80, y: 40, width: 60, height: 60 }));
  const r = await call('POST', '/api/tables/layout', { positions, floor });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const f = (await call('GET', '/api/floor', undefined, false)).data;
  assert.ok(f.cols <= 80, 'cols limitado');
  assert.ok(!f.voids.includes('basura'));
  assert.ok(f.elements.every(e => e.type !== 'misil'));
  const again = (await call('GET', '/api/tables')).data;
  assert.equal(again.find(t => t.id === tables[0].id).x, 20);
});

test('subir foto de un plato y servirla', async () => {
  const menu = (await call('GET', '/api/menu', undefined, false)).data;
  const prod = menu.products[0];
  // PNG 1x1
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const bad = await call('POST', `/api/products/${prod.id}/image`, { dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' });
  assert.equal(bad.status, 400);
  const r = await call('POST', `/api/products/${prod.id}/image`, { dataUrl: `data:image/png;base64,${png}` });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.image, /^\/uploads\//);
  const img = await fetch(BASE + r.data.image);
  assert.equal(img.status, 200);
});

test('copias de seguridad: crear, listar y restaurar', async () => {
  const before = (await call('GET', '/api/settings')).data;
  assert.equal((await call('POST', '/api/admin/backups', {})).status, 201);
  const list = (await call('GET', '/api/admin/backups')).data;
  assert.ok(list.length >= 1);
  const name = list[0].name;
  // Cambiar algo y restaurar la copia
  await call('PUT', '/api/settings', { ...before, restaurantName: 'CAMBIADO POR TEST' });
  assert.equal((await call('GET', '/api/settings')).data.restaurantName, 'CAMBIADO POR TEST');
  assert.equal((await call('POST', '/api/admin/restore', { name })).status, 200);
  assert.equal((await call('GET', '/api/settings')).data.restaurantName, before.restaurantName);
  // La descarga no incluye sesiones ni el PIN
  const dl = (await call('GET', '/api/admin/backup/download')).data;
  assert.ok(dl.tables && !dl.sessions);
  assert.ok(!dl.settings.staffPinHash);
  // Un archivo inválido no se restaura
  assert.equal((await call('POST', '/api/admin/restore', { data: { hola: 1 } })).status, 400);
});

test('la sesión sigue válida después de reiniciar el servidor', async () => {
  await stop();
  await start();
  assert.equal((await call('GET', '/api/auth/check')).status, 200);
});

test('si el archivo de datos se daña, se recupera desde la copia', async () => {
  await stop();
  fs.writeFileSync(path.join(DATA_DIR, 'db.json'), '{ esto no es json');
  await start();
  const tables = (await call('GET', '/api/tables', undefined, false)).data;
  assert.ok(Array.isArray(tables) && tables.length > 0);
});
