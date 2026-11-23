// Pruebas automáticas del servidor (sin dependencias extra): `npm test`
// Arranca el servidor con una carpeta de datos temporal y un puerto libre,
// así nunca toca los datos reales de server/data/db.json.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const SERVER = path.join(__dirname, '..', 'server', 'index.js');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fogon-test-'));
const PORT = 3900 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const PIN = '4321';
let proc;
let token;

const start = () => new Promise((resolve, reject) => {
  proc = spawn(process.execPath, ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', SERVER], {
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


// ---------------------------------------------------------------- Fase 3
const loginAs = async (username, password) => {
  const r = await call('POST', '/api/auth/login', { username, password }, false);
  return { status: r.status, token: r.data?.token, staff: r.data?.staff };
};
const as = (tk) => async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data; try { data = await res.json(); } catch (_) { data = null; }
  return { status: res.status, data };
};

test('empleados: alta, acceso con usuario y permisos por rol en el servidor', async () => {
  const mk = (name, username, role) => call('POST', '/api/staff', { name, username, password: 'secreta1', role });
  assert.equal((await mk('Marta', 'marta', 'manager')).status, 201);
  assert.equal((await mk('Leo', 'leo', 'waiter')).status, 201);
  assert.equal((await mk('Cocina', 'cocina', 'kitchen')).status, 201);
  assert.equal((await mk('Leo bis', 'LEO', 'waiter')).status, 409, 'usuario repetido (sin distinguir mayúsculas)');
  assert.equal((await mk('X', 'x y', 'waiter')).status, 400, 'usuario con espacios');

  assert.equal((await loginAs('leo', 'mala')).status, 401);
  const kit = await loginAs('cocina', 'secreta1');
  assert.equal(kit.status, 200);
  assert.equal(kit.staff.role, 'kitchen');
  const k = as(kit.token);
  assert.equal((await k('GET', '/api/orders')).status, 200, 'cocina ve comandas');
  assert.equal((await k('PUT', '/api/settings', { restaurantName: 'hack' })).status, 403, 'cocina no cambia ajustes');
  assert.equal((await k('GET', '/api/reservations')).status, 403, 'cocina no ve datos de clientes');
  assert.equal((await k('GET', '/api/staff')).status, 403);
  const menu = (await call('GET', '/api/menu', undefined, false)).data;
  const prod = menu.products[0];
  assert.equal((await k('PUT', `/api/products/${prod.id}`, { isAvailable: false })).status, 200, 'cocina marca agotado');
  assert.equal((await k('PUT', `/api/products/${prod.id}`, { price: 0.5 })).status, 403, 'cocina no cambia precios');
  await call('PUT', `/api/products/${prod.id}`, { isAvailable: true });

  const man = as((await loginAs('marta', 'secreta1')).token);
  assert.equal((await man('POST', '/api/staff', { name: 'Jefe', username: 'jefe', password: 'secreta1', role: 'admin' })).status, 403, 'el encargado no crea administradores');
  assert.equal((await man('POST', '/api/staff', { name: 'Ana', username: 'ana', password: 'secreta1', role: 'bar' })).status, 201);
  assert.equal((await man('PUT', '/api/settings', { restaurantName: 'x' })).status, 403);
});

test('camarero: toma pedidos en la comandera pero no ve teléfonos ni escribe a clientes', async () => {
  const tables = (await call('GET', '/api/tables', undefined, false)).data;
  const t = tables.find(x => x.shape !== 'bar_stool');
  const menu = (await call('GET', '/api/menu', undefined, false)).data;
  const tom = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(Date.now() + 60 * 3600e3));
  await call('POST', '/api/reservations', { tableId: t.id, customerName: 'Cliente Tel', customerPhone: '611222333', date: tom, startTime: '13:00', guests: 2, privacyAccepted: true }, false);

  const w = as((await loginAs('leo', 'secreta1')).token);
  const resW = (await w('GET', '/api/reservations')).data;
  assert.ok(resW.length > 0 && resW.every(r => r.customerPhone === undefined), 'el camarero no recibe teléfonos');
  const m = as((await loginAs('marta', 'secreta1')).token);
  assert.ok((await m('GET', '/api/reservations')).data.some(r => r.customerPhone === '611222333'), 'el encargado sí');

  const o = await w('POST', '/api/orders', { tableNumber: t.number, items: [{ productId: menu.products[0].id, quantity: 2 }], notes: 'sin sal' });
  assert.equal(o.status, 201);
  assert.equal(o.data.order.origin, 'pos');
  assert.equal(o.data.order.createdBy.name, 'Leo');
  const k = as((await loginAs('cocina', 'secreta1')).token);
  assert.equal((await k('POST', '/api/orders', { tableNumber: t.number, items: [{ productId: menu.products[0].id }] })).status, 403, 'cocina no toma pedidos');
});

test('cambio de estado de comanda queda registrado con el empleado', async () => {
  const tables = (await call('GET', '/api/tables', undefined, false)).data;
  const menu = (await call('GET', '/api/menu', undefined, false)).data;
  const o = (await call('POST', '/api/orders', { tableNumber: tables[0].number, items: [{ productId: menu.products[0].id, quantity: 1 }] }, false)).data.order;
  const k = as((await loginAs('cocina', 'secreta1')).token);
  const r = await k('PATCH', `/api/orders/${o.id}/status`, { status: 'IN_PREP' });
  assert.equal(r.status, 200);
  assert.equal(r.data.statusHistory.at(-1).by.name, 'Cocina');
  const log = (await call('GET', `/api/audit?entity=order&entityId=${o.orderNumber}`)).data;
  assert.ok(log.some(e => e.action === 'order.status' && e.employeeName === 'Cocina' && e.after.status === 'IN_PREP'));
  assert.equal((await k('GET', '/api/audit')).status, 403, 'cocina no ve el historial');
});

test('desactivar un empleado cierra su sesión al momento', async () => {
  const leo = await loginAs('leo', 'secreta1');
  assert.equal((await as(leo.token)('GET', '/api/auth/check')).status, 200);
  const list = (await call('GET', '/api/staff')).data;
  const id = list.find(e => e.username === 'leo').id;
  assert.equal((await call('PUT', `/api/staff/${id}`, { active: false })).status, 200);
  assert.equal((await as(leo.token)('GET', '/api/auth/check')).status, 401);
  assert.equal((await loginAs('leo', 'secreta1')).status, 401, 'no puede volver a entrar');
});

test('acceso con PIN: solo se puede desactivar si hay un administrador', async () => {
  const settings = (await call('GET', '/api/settings')).data;
  assert.equal((await call('PUT', '/api/settings', { ...settings, allowPinLogin: false })).status, 409);
  assert.equal((await call('POST', '/api/staff', { name: 'Dueño', username: 'dueno', password: 'secreta1', role: 'admin' })).status, 201);
  const adm = await loginAs('dueno', 'secreta1');
  const a = as(adm.token);
  assert.equal((await a('PUT', '/api/settings', { ...settings, allowPinLogin: false })).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { pin: PIN }, false)).status, 403, 'PIN desactivado');
  assert.equal((await call('GET', '/api/auth/check')).status, 401, 'la sesión abierta con PIN deja de valer');
  assert.equal((await a('PUT', '/api/settings', { ...settings, allowPinLogin: true })).status, 200);
  token = (await call('POST', '/api/auth/login', { pin: PIN }, false)).data.token;
  assert.ok(token);
});

test('el historial de actividad no se puede modificar ni borrar', async () => {
  const log = (await call('GET', '/api/audit?limit=5')).data;
  assert.ok(log.length > 0);
  const { DatabaseSync } = require('node:sqlite');
  const sql = new DatabaseSync(path.join(DATA_DIR, 'fogon.sqlite'));
  assert.throws(() => sql.prepare('UPDATE audit_log SET action = ? WHERE id = ?').run('x', log[0].id), /no se puede modificar/);
  assert.throws(() => sql.prepare('DELETE FROM audit_log').run(), /no se puede borrar/);
  sql.close();
});

test('carta: alta y baja de categorías y platos', async () => {
  const cat = await call('POST', '/api/categories', { name: 'Vermuts', area: 'bar' });
  assert.equal(cat.status, 201);
  const prod = await call('POST', '/api/products', { name: 'Vermut de grifo', price: 3.5, categoryId: cat.data.id, allergens: ['sulfitos', 'inventado'], vatRate: 10 });
  assert.equal(prod.status, 201);
  assert.deepEqual(prod.data.allergens, ['sulfitos']);
  assert.equal((await call('POST', '/api/products', { name: 'Malo', price: 1, categoryId: cat.data.id, vatRate: 7 })).status, 400, 'IVA no válido');
  let pub = (await call('GET', '/api/menu', undefined, false)).data;
  assert.ok(pub.products.some(p => p.id === prod.data.id));
  const tables = (await call('GET', '/api/tables', undefined, false)).data;
  assert.equal((await call('DELETE', `/api/products/${prod.data.id}`)).status, 200);
  pub = (await call('GET', '/api/menu', undefined, false)).data;
  assert.ok(!pub.products.some(p => p.id === prod.data.id), 'dado de baja: no se ve');
  assert.equal((await call('POST', '/api/orders', { tableNumber: tables[0].number, items: [{ productId: prod.data.id }] }, false)).status, 400, 'no se puede pedir');
  const all = (await call('GET', '/api/menu?all=1')).data;
  assert.ok(all.products.some(p => p.id === prod.data.id && p.active === false), 'el personal lo sigue viendo para recuperarlo');
  assert.equal((await call('PUT', `/api/products/${prod.data.id}`, { active: true })).status, 200);
  assert.equal((await call('DELETE', `/api/categories/${cat.data.id}`)).status, 200);
  pub = (await call('GET', '/api/menu', undefined, false)).data;
  assert.ok(!pub.products.some(p => p.id === prod.data.id), 'categoría de baja oculta sus platos');
});

test('QR seguros: sin la clave de la mesa no se puede pedir (cuando se desactivan los antiguos)', async () => {
  const pubTables = (await call('GET', '/api/tables', undefined, false)).data;
  assert.ok(pubTables.every(t => t.qrKey === undefined), 'la clave no se publica');
  const tables = (await call('GET', '/api/tables')).data;
  const [t1, t2] = tables.filter(t => t.shape !== 'bar_stool');
  assert.ok(t1.qrKey && t2.qrKey && t1.qrKey !== t2.qrKey);
  assert.equal((await call('GET', `/api/qr/${t1.qrKey}`, undefined, false)).data.tableNumber, t1.number);
  assert.equal((await call('GET', '/api/qr/clave-inventada-123', undefined, false)).status, 404);

  const settings = (await call('GET', '/api/settings')).data;
  await call('PUT', '/api/settings', { ...settings, qrLegacyEnabled: false });
  const menu = (await call('GET', '/api/menu', undefined, false)).data;
  const item = [{ productId: menu.products[0].id, quantity: 1 }];
  const order = (key, num = t1.number) => fetch(`${BASE}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Table-Key': key } : {}) }, body: JSON.stringify({ tableNumber: num, items: item }) });
  assert.equal((await order(null)).status, 403, 'solo con el número no vale');
  assert.equal((await order(t2.qrKey)).status, 403, 'la clave de otra mesa no vale');
  assert.equal((await order(t1.qrKey)).status, 201, 'con el QR de la mesa sí');
  assert.equal((await fetch(`${BASE}/api/tables/${t1.number}/orders`)).status, 403);
  assert.equal((await fetch(`${BASE}/api/tables/${t1.number}/orders`, { headers: { 'X-Table-Key': t1.qrKey } })).status, 200);
  assert.equal((await call('POST', `/api/tables/${t1.number}/call`, { type: 'waiter' }, false)).status, 403);
  const staffOrder = await call('POST', '/api/orders', { tableNumber: t1.number, items: item });
  assert.equal(staffOrder.status, 201, 'el personal pide para cualquier mesa');
  assert.equal(staffOrder.data.order.origin, 'pos');

  // Regenerar invalida el QR anterior
  const regen = await call('POST', `/api/tables/${t1.id}/qr`, {});
  assert.equal(regen.status, 200);
  assert.equal((await order(t1.qrKey)).status, 403, 'el QR antiguo ya no sirve');
  assert.equal((await order(regen.data.qrKey)).status, 201);
  await call('PUT', '/api/settings', { ...settings, qrLegacyEnabled: true });
  assert.equal((await order(null)).status, 201, 'modo compatibilidad: los QR antiguos vuelven a funcionar');
});

test('la sesión sigue válida después de reiniciar el servidor', async () => {
  await stop();
  await start();
  assert.equal((await call('GET', '/api/auth/check')).status, 200);
});

test('si la base de datos se daña, se recupera desde la copia', async () => {
  await stop();
  const file = path.join(DATA_DIR, 'fogon.sqlite');
  for (const ext of ['-wal', '-shm']) fs.rmSync(file + ext, { force: true });
  fs.writeFileSync(file, 'esto no es una base de datos SQLite'.repeat(200));
  await start();
  const tables = (await call('GET', '/api/tables', undefined, false)).data;
  assert.ok(Array.isArray(tables) && tables.length > 0);
  assert.ok(fs.readdirSync(DATA_DIR).some(f => f.includes('.corrupto-')), 'el archivo dañado se aparta, no se borra');
  // La sesión se pierde con la base dañada: volver a entrar
  token = (await call('POST', '/api/auth/login', { pin: PIN }, false)).data.token;
});

test('impresora: desactivada, sin conexión y enviada se distinguen', async () => {
  const settings = (await call('GET', '/api/settings')).data;
  await call('PUT', '/api/settings', { ...settings, printerEnabled: false });
  assert.equal((await call('POST', '/api/printer/test', {})).data.status, 'DISABLED');

  // Puerto cerrado: no se puede conectar -> FAILED (nunca "simulado")
  const closed = net.createServer(); await new Promise(r => closed.listen(0, '127.0.0.1', r));
  const closedPort = closed.address().port; await new Promise(r => closed.close(r));
  await call('PUT', '/api/settings', { ...settings, printerEnabled: true, printerIp: '127.0.0.1', printerPort: closedPort });
  const failed = (await call('POST', '/api/printer/test', {})).data;
  assert.equal(failed.status, 'FAILED');
  assert.ok(failed.error);

  // Impresora falsa que recibe los datos -> SENT
  let received = 0;
  const fake = net.createServer(sock => sock.on('data', d => { received += d.length; }));
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  await call('PUT', '/api/settings', { ...settings, printerEnabled: true, printerIp: '127.0.0.1', printerPort: fake.address().port });
  assert.equal((await call('POST', '/api/printer/test', {})).data.status, 'SENT');
  await new Promise(r => setTimeout(r, 200));
  assert.ok(received > 50, 'la impresora recibió el ticket');
  fake.close();
  await call('PUT', '/api/settings', { ...settings, printerEnabled: false });
});

test('el historial de comandas no se borra al superar 2000', async () => {
  await stop();
  const { DatabaseSync } = require('node:sqlite');
  const sql = new DatabaseSync(path.join(DATA_DIR, 'fogon.sqlite'));
  const t = JSON.parse(sql.prepare("SELECT data FROM docs WHERE coll = 'tables' ORDER BY pos LIMIT 1").get().data);
  const ins = sql.prepare("INSERT INTO docs (coll, id, pos, data) VALUES ('orders', ?, 0, ?)");
  sql.exec('BEGIN');
  for (let i = 0; i < 2100; i++) {
    ins.run(`ord-antigua-${i}`, JSON.stringify({ id: `ord-antigua-${i}`, orderNumber: String(i + 1).padStart(4, '0'), createdAt: new Date(Date.now() - (i + 1) * 864e5).toISOString(), status: 'CLOSED', tableId: t.id, tableNumber: t.number, items: [], total: 0, notes: '' }));
  }
  sql.exec('COMMIT');
  const count = () => sql.prepare("SELECT count(*) AS n FROM docs WHERE coll = 'orders'").get().n;
  const before = count();
  sql.close();
  await start();
  const menu = (await call('GET', '/api/menu', undefined, false)).data;
  const r = await call('POST', '/api/orders', { tableNumber: t.number, items: [{ productId: menu.products[0].id, quantity: 1 }] }, false);
  assert.equal(r.status, 201);
  const sql2 = new DatabaseSync(path.join(DATA_DIR, 'fogon.sqlite'));
  assert.equal(sql2.prepare("SELECT count(*) AS n FROM docs WHERE coll = 'orders'").get().n, before + 1);
  assert.ok(sql2.prepare("SELECT 1 FROM docs WHERE coll = 'orders' AND id = 'ord-antigua-2099'").get(), 'la comanda más antigua sigue ahí');
  sql2.close();
});

test('migración: los datos de db.json pasan a SQLite sin tocar el original', async () => {
  await stop();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fogon-mig-'));
  const legacy = {
    sectors: [{ id: 'sec-salon', name: 'Salón', floor: 1 }],
    tables: [{ id: 'tbl-x1', number: '01', sectorId: 'sec-salon', capacity: 4, x: 40, y: 40, width: 80, height: 60, shape: 'rect', status: 'OCCUPIED' }],
    categories: [{ id: 'cat-a', name: 'Entrantes' }],
    products: [{ id: 'prod-a', categoryId: 'cat-a', name: 'Croquetas', price: 7.5, isAvailable: true, allergens: ['gluten'], modifiers: [] }],
    orders: [{ id: 'ord-1', orderNumber: '0142', createdAt: '2026-11-22T20:00:00.000Z', status: 'SERVED', tableId: 'tbl-x1', tableNumber: '01', items: [{ productId: 'prod-a', name: 'Croquetas', price: 7.5, quantity: 2 }], total: 15 }],
    reservations: [{ id: 'res-1', tableId: 'tbl-x1', tableNumber: '01', customerName: 'Ana', customerPhone: '600', guests: 2, date: '2030-01-01', startTime: '21:00', status: 'CONFIRMED', createdAt: '2026-11-22T10:00:00.000Z' }],
    settings: { restaurantName: 'El Fogón', ownerPhone: '34600000000' },
    floor: { cols: 20, rows: 20, cell: 20, voids: ['0,0'], elements: [] },
    sessions: []
  };
  const raw = JSON.stringify(legacy, null, 2);
  fs.writeFileSync(path.join(dir, 'db.json'), raw);
  const saved = { dir: DATA_DIR };
  process.env.__MIG = '1';
  const migProc = spawn(process.execPath, ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', SERVER], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, STAFF_PIN: PIN, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(out)), 15000);
    const on = d => { out += d; if (out.includes('SERVIDOR ACTIVO')) { clearTimeout(t); resolve(); } };
    migProc.stdout.on('data', on); migProc.stderr.on('data', on);
  });
  try {
    assert.match(out, /Datos migrados de db\.json a fogon\.sqlite/);
    assert.equal(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'), raw, 'db.json queda intacto');
    assert.ok(fs.readdirSync(path.join(dir, 'backups')).some(f => f.endsWith('antes-de-migrar.json')));
    const tables = (await call('GET', '/api/tables', undefined, false)).data;
    assert.equal(tables[0].number, '01');
    const menu = (await call('GET', '/api/menu', undefined, false)).data;
    assert.deepEqual(menu.products[0].allergens, ['gluten']);
    const tk = (await call('POST', '/api/auth/login', { pin: PIN }, false)).data.token;
    const orders = await (await fetch(`${BASE}/api/orders`, { headers: { Authorization: `Bearer ${tk}` } })).json();
    assert.equal(orders[0].orderNumber, '0142');
    const res = await (await fetch(`${BASE}/api/reservations`, { headers: { Authorization: `Bearer ${tk}` } })).json();
    assert.equal(res[0].customerName, 'Ana');
    const floor = (await call('GET', '/api/floor', undefined, false)).data;
    assert.deepEqual(floor.voids, ['0,0']);
  } finally {
    await new Promise(r => { migProc.once('exit', r); migProc.kill(); });
    fs.rmSync(dir, { recursive: true, force: true });
    await start();
    void saved;
  }
});
