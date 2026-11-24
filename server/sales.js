// Cuentas por mesa, cobros, caja y facturas.
// - Importes SIEMPRE en céntimos enteros. Los precios de la carta llevan el IVA incluido.
// - Toda operación de dinero va en una transacción (todo o nada).
// - Pagos, movimientos de caja y facturas solo se añaden (los triggers impiden cambiarlos).
const crypto = require('crypto');
const time = require('./time');

const cents = (euros) => Math.round(Number(euros) * 100);
const uid = (p) => `${p}-${crypto.randomUUID().slice(0, 12)}`;
const nowIso = () => new Date().toISOString();
const who = (staff) => (staff ? { id: staff.id, name: staff.name } : null);
const fail = (status, error) => Object.assign(new Error(error), { status });

const SERIES = { simplified: 'T', full: 'F', rectifying: 'R' };
const METHODS = ['cash', 'card', 'other'];

function createSales(db) {
  const sql = db.sql;
  const tx = (fn) => db.transaction(fn);
  const q = (text) => sql.prepare(text);

  // ------------------------------------------------------------------ Cuentas
  const getCheckRow = (id) => q('SELECT * FROM checks WHERE id = ?').get(id);
  const openCheckFor = (tableId) => q("SELECT * FROM checks WHERE table_id = ? AND status = 'open'").get(tableId);

  // Cuenta abierta de la mesa (se crea con el primer pedido)
  function ensureOpenCheck(table, staff) {
    const existing = openCheckFor(table.id);
    if (existing) return existing;
    const id = uid('chk');
    q('INSERT INTO checks (id, table_id, table_number, status, opened_at, opened_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, table.id, String(table.number), 'open', nowIso(), staff?.id || null);
    return getCheckRow(id);
  }

  // Pedidos anteriores a las cuentas: se agrupan en la cuenta abierta de su mesa (una vez)
  function adoptLegacyOrders() {
    tx(() => {
      let changed = false;
      for (const o of db.getOrders()) {
        if (o.checkId || o.status === 'CLOSED') continue;
        const table = db.getTable(o.tableId) || db.getTable(o.tableNumber);
        if (!table) continue;
        o.checkId = ensureOpenCheck(table, null).id;
        db.touch('orders', o.id);
        changed = true;
      }
      if (changed) db.save();
    });
  }

  const ordersOf = (checkId) => db.getOrders().filter(o => o.checkId === checkId).slice().reverse();

  // Líneas facturables de una cuenta (con anulaciones e invitaciones aplicadas)
  function linesOf(checkId) {
    const lines = [];
    for (const o of ordersOf(checkId)) {
      (o.items || []).forEach((it, idx) => {
        const adj = it.adjustments || [];
        const voidQty = adj.filter(a => a.type === 'void').reduce((s, a) => s + a.qty, 0);
        const compQty = adj.filter(a => a.type === 'comp').reduce((s, a) => s + a.qty, 0);
        const unitCents = cents(it.price);
        const billQty = Math.max(0, it.quantity - voidQty - compQty);
        lines.push({
          orderId: o.id, orderNumber: o.orderNumber, idx, productId: it.productId, name: it.name,
          modifiers: it.modifiers || {}, unitCents, vatRate: it.vatRate ?? productVat(it.productId),
          quantity: it.quantity, voidQty, compQty, billQty, totalCents: unitCents * billQty,
          adjustments: adj, createdBy: o.createdBy || null, origin: o.origin || 'qr', at: o.createdAt
        });
      });
    }
    return lines;
  }
  const productVat = (pid) => db.getProducts().find(p => p.id === pid)?.vatRate ?? 10;

  const paymentsOf = (checkId) => q('SELECT * FROM payments WHERE check_id = ? ORDER BY at').all(checkId).map(publicPayment);
  const publicPayment = (p) => ({
    id: p.id, checkId: p.check_id, sessionId: p.session_id, method: p.method, amountCents: p.amount_cents,
    tenderedCents: p.tendered_cents, changeCents: p.change_cents, refundOf: p.refund_of, reason: p.reason,
    items: p.items ? JSON.parse(p.items) : null, employee: p.employee_name, employeeId: p.employee_id, at: p.at
  });

  function summary(checkId) {
    const c = getCheckRow(checkId);
    if (!c) return null;
    const lines = linesOf(checkId);
    const subtotalCents = lines.reduce((s, l) => s + l.totalCents, 0);
    let discountCents = 0;
    if (c.discount_type === 'percent') discountCents = Math.round(subtotalCents * c.discount_value / 10000);
    if (c.discount_type === 'amount') discountCents = c.discount_value;
    discountCents = Math.min(subtotalCents, Math.max(0, discountCents));
    const totalCents = subtotalCents - discountCents;
    const payments = paymentsOf(checkId);
    const paidCents = payments.reduce((s, p) => s + p.amountCents, 0);
    const invoices = q('SELECT id, full_number, type, total_cents, issued_at FROM invoices WHERE check_id = ? ORDER BY issued_at').all(checkId)
      .map(i => ({ id: i.id, number: i.full_number, type: i.type, totalCents: i.total_cents, issuedAt: i.issued_at }));
    return {
      id: c.id, tableId: c.table_id, tableNumber: c.table_number, status: c.status,
      openedAt: c.opened_at, closedAt: c.closed_at,
      discount: c.discount_type ? { type: c.discount_type, value: c.discount_value, reason: c.discount_reason, by: c.discount_by } : null,
      lines, subtotalCents, discountCents, totalCents, paidCents, pendingCents: totalCents - paidCents,
      payments, invoices
    };
  }

  function checkForTable(table) {
    const c = openCheckFor(table.id);
    return c ? summary(c.id) : null;
  }

  function listChecks({ status, from, to, limit = 200 } = {}) {
    const where = [];
    const args = [];
    if (status) { where.push('status = ?'); args.push(status); }
    if (from) { where.push('opened_at >= ?'); args.push(from); }
    if (to) { where.push('opened_at < ?'); args.push(to); }
    args.push(Math.min(1000, Number(limit) || 200));
    return q(`SELECT id FROM checks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY opened_at DESC LIMIT ?`).all(...args).map(r => summary(r.id));
  }

  // Anular o invitar unidades de una línea (con motivo y autor)
  function adjustLine(orderId, idx, { type, qty, reason }, staff) {
    if (!['void', 'comp'].includes(type)) throw fail(400, 'Tipo no válido');
    const why = String(reason || '').trim().slice(0, 140);
    if (why.length < 3) throw fail(400, 'Indica el motivo');
    return tx(() => {
      const o = db.getOrders().find(x => x.id === orderId);
      if (!o) throw fail(404, 'Comanda no encontrada');
      const c = o.checkId && getCheckRow(o.checkId);
      if (!c || c.status !== 'open') throw fail(409, 'La cuenta de esta comanda ya está cerrada');
      const it = (o.items || [])[Number(idx)];
      if (!it) throw fail(404, 'Línea no encontrada');
      const done = (it.adjustments || []).reduce((s, a) => s + a.qty, 0);
      const remaining = it.quantity - done;
      const n = Math.max(1, parseInt(qty, 10) || 1);
      if (n > remaining) throw fail(409, `Solo quedan ${remaining} por ${type === 'void' ? 'anular' : 'invitar'}`);
      const s = summary(c.id);
      const lineCents = cents(it.price) * n;
      if (lineCents > 0 && s.totalCents - lineCents < s.paidCents) {
        throw fail(409, 'Ya se ha cobrado parte de la cuenta: anula o invita solo lo que falta por cobrar, o devuelve antes el pago');
      }
      (it.adjustments ||= []).push({ type, qty: n, reason: why, by: who(staff), at: nowIso() });
      db.touch('orders', o.id);
      db.save();
      return { order: o, check: summary(c.id) };
    });
  }

  function setDiscount(checkId, { type, value, reason }, staff) {
    return tx(() => {
      const c = getCheckRow(checkId);
      if (!c) throw fail(404, 'Cuenta no encontrada');
      if (c.status !== 'open') throw fail(409, 'La cuenta ya está cerrada');
      if (type === null || type === 'none') {
        q('UPDATE checks SET discount_type = NULL, discount_value = 0, discount_reason = NULL, discount_by = ? WHERE id = ?').run(staff?.name || null, checkId);
        return summary(checkId);
      }
      const why = String(reason || '').trim().slice(0, 140);
      if (why.length < 3) throw fail(400, 'Indica el motivo del descuento');
      let v;
      if (type === 'percent') {
        v = Math.round(Number(value) * 100);
        if (!(v > 0 && v <= 10000)) throw fail(400, 'Porcentaje no válido (1–100)');
      } else if (type === 'amount') {
        v = cents(value);
        if (!(v > 0)) throw fail(400, 'Importe no válido');
      } else throw fail(400, 'Tipo de descuento no válido');
      q('UPDATE checks SET discount_type = ?, discount_value = ?, discount_reason = ?, discount_by = ? WHERE id = ?').run(type, v, why, staff?.name || null, checkId);
      const s = summary(checkId);
      if (s.totalCents < s.paidCents) throw fail(409, 'El descuento deja la cuenta por debajo de lo ya cobrado');
      return s;
    });
  }

  // ------------------------------------------------------------------ Caja
  const openSession = () => q("SELECT * FROM cash_sessions WHERE status = 'open'").get();

  function sessionSummary(id) {
    const ses = q('SELECT * FROM cash_sessions WHERE id = ?').get(id);
    if (!ses) return null;
    const pays = q('SELECT method, amount_cents, refund_of FROM payments WHERE session_id = ?').all(id);
    const byMethod = { cash: 0, card: 0, other: 0 };
    let refundsCents = 0;
    for (const p of pays) {
      byMethod[p.method] += p.amount_cents;
      if (p.amount_cents < 0) refundsCents += -p.amount_cents;
    }
    const moves = q('SELECT * FROM cash_movements WHERE session_id = ? ORDER BY at').all(id);
    const inCents = moves.filter(m => m.type === 'in').reduce((s, m) => s + m.amount_cents, 0);
    const outCents = moves.filter(m => m.type === 'out').reduce((s, m) => s + m.amount_cents, 0);
    const expectedCashCents = ses.opening_cents + byMethod.cash + inCents - outCents;
    const checksPaid = q("SELECT count(DISTINCT p.check_id) n FROM payments p JOIN checks c ON c.id = p.check_id WHERE p.session_id = ? AND c.status = 'paid'").get(id).n;
    return {
      id: ses.id, status: ses.status, openedAt: ses.opened_at, openedBy: ses.opened_by_name, openingCents: ses.opening_cents,
      closedAt: ses.closed_at, closedBy: ses.closed_by_name, countedCents: ses.counted_cents, differenceCents: ses.difference_cents, notes: ses.notes,
      cashCents: byMethod.cash, cardCents: byMethod.card, otherCents: byMethod.other, totalSalesCents: byMethod.cash + byMethod.card + byMethod.other,
      refundsCents, inCents, outCents, expectedCashCents, checksPaid, paymentsCount: pays.length,
      movements: moves.map(m => ({ id: m.id, type: m.type, amountCents: m.amount_cents, reason: m.reason, employee: m.employee_name, at: m.at }))
    };
  }

  function openCash(openingEuros, staff) {
    const opening = cents(openingEuros);
    if (!Number.isFinite(opening) || opening < 0) throw fail(400, 'Fondo inicial no válido');
    return tx(() => {
      if (openSession()) throw fail(409, 'Ya hay una caja abierta');
      const id = uid('caja');
      q('INSERT INTO cash_sessions (id, status, opened_at, opened_by, opened_by_name, opening_cents) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, 'open', nowIso(), staff.id, staff.name, opening);
      return sessionSummary(id);
    });
  }

  function cashMovement({ type, amount, reason }, staff) {
    const a = cents(amount);
    const why = String(reason || '').trim().slice(0, 140);
    if (!['in', 'out'].includes(type)) throw fail(400, 'Tipo no válido');
    if (!(a > 0)) throw fail(400, 'Importe no válido');
    if (why.length < 3) throw fail(400, 'Indica el motivo');
    return tx(() => {
      const ses = openSession();
      if (!ses) throw fail(409, 'No hay ninguna caja abierta');
      if (type === 'out' && a > sessionSummary(ses.id).expectedCashCents) throw fail(409, 'No hay tanto efectivo en la caja');
      q('INSERT INTO cash_movements (id, session_id, type, amount_cents, reason, employee_id, employee_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(uid('mov'), ses.id, type, a, why, staff.id, staff.name, nowIso());
      return sessionSummary(ses.id);
    });
  }

  function closeCash({ counted, notes }, staff) {
    const c = cents(counted);
    if (!Number.isFinite(c) || c < 0) throw fail(400, 'Indica el efectivo contado');
    return tx(() => {
      const ses = openSession();
      if (!ses) throw fail(409, 'No hay ninguna caja abierta');
      const s = sessionSummary(ses.id);
      const openChecks = q("SELECT count(*) n FROM checks WHERE status = 'open'").get().n;
      const summaryJson = JSON.stringify({ ...s, openChecksAtClose: openChecks });
      q("UPDATE cash_sessions SET status = 'closed', closed_at = ?, closed_by = ?, closed_by_name = ?, expected_cents = ?, counted_cents = ?, difference_cents = ?, notes = ?, summary = ? WHERE id = ?")
        .run(nowIso(), staff.id, staff.name, s.expectedCashCents, c, c - s.expectedCashCents, String(notes || '').slice(0, 300), summaryJson, ses.id);
      return { ...sessionSummary(ses.id), openChecksAtClose: openChecks };
    });
  }

  const currentCash = () => { const s = openSession(); return s ? sessionSummary(s.id) : null; };
  const cashHistory = (limit = 60) => q('SELECT id FROM cash_sessions ORDER BY opened_at DESC LIMIT ?').all(Math.min(365, Number(limit) || 60)).map(r => sessionSummary(r.id));

  // ------------------------------------------------------------------ Cobros
  // Cobro parcial o total. Varios cobros = pago mixto o cuenta dividida.
  function pay(checkId, { method, amount, tendered, items, idempotencyKey, freeTable = true }, staff, onPaid) {
    if (!METHODS.includes(method)) throw fail(400, 'Forma de pago no válida');
    const key = idempotencyKey ? String(idempotencyKey).slice(0, 80) : null;
    return tx(() => {
      if (key) {
        const dup = q('SELECT * FROM payments WHERE idempotency_key = ?').get(key);
        if (dup) return { payment: publicPayment(dup), check: summary(dup.check_id), duplicate: true };
      }
      const ses = openSession();
      if (!ses) throw fail(409, 'Abre la caja antes de cobrar');
      const s = summary(checkId);
      if (!s) throw fail(404, 'Cuenta no encontrada');
      if (s.status !== 'open') throw fail(409, 'La cuenta ya está cobrada');
      const a = amount === undefined || amount === null || amount === '' ? s.pendingCents : cents(amount);
      if (!(a > 0)) throw fail(400, 'Importe no válido');
      if (a > s.pendingCents) throw fail(409, `Solo quedan ${(s.pendingCents / 100).toFixed(2)} € por cobrar`);
      let tenderedCents = null;
      let changeCents = null;
      if (method === 'cash' && tendered !== undefined && tendered !== null && tendered !== '') {
        tenderedCents = cents(tendered);
        if (tenderedCents < a) throw fail(400, 'El cliente entrega menos de lo que se cobra');
        changeCents = tenderedCents - a;
      }
      const id = uid('pago');
      const itemsJson = Array.isArray(items) && items.length ? JSON.stringify(items.slice(0, 100)) : null;
      q('INSERT INTO payments (id, check_id, session_id, method, amount_cents, tendered_cents, change_cents, items, employee_id, employee_name, at, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, checkId, ses.id, method, a, tenderedCents, changeCents, itemsJson, staff.id, staff.name, nowIso(), key);
      let after = summary(checkId);
      if (after.pendingCents === 0) {
        closeCheck(checkId, staff, freeTable, onPaid);
        after = summary(checkId);
      }
      return { payment: publicPayment(q('SELECT * FROM payments WHERE id = ?').get(id)), check: after };
    });
  }

  // Cuenta saldada: se cierra y (por defecto) se libera la mesa
  function closeCheck(checkId, staff, freeTable, onPaid) {
    q("UPDATE checks SET status = 'paid', closed_at = ?, closed_by = ? WHERE id = ?").run(nowIso(), staff?.id || null, checkId);
    for (const o of ordersOf(checkId)) {
      if (o.status !== 'CLOSED') {
        (o.statusHistory ||= []).push({ from: o.status, to: 'CLOSED', at: nowIso(), by: who(staff), reason: 'cuenta cobrada' });
        o.status = 'CLOSED';
        db.touch('orders', o.id);
      }
    }
    db.save();
    if (onPaid) onPaid(getCheckRow(checkId), freeTable);
  }

  // Cerrar una cuenta a 0 € (todo invitado o anulado)
  function closeZero(checkId, staff, onPaid) {
    return tx(() => {
      const s = summary(checkId);
      if (!s) throw fail(404, 'Cuenta no encontrada');
      if (s.status !== 'open') throw fail(409, 'La cuenta ya está cerrada');
      if (s.pendingCents !== 0) throw fail(409, 'Aún queda importe por cobrar');
      closeCheck(checkId, staff, true, onPaid);
      return summary(checkId);
    });
  }

  // Devolución de un cobro (nueva fila en negativo; la cuenta vuelve a quedar abierta)
  function refund(paymentId, reason, staff) {
    const why = String(reason || '').trim().slice(0, 140);
    if (why.length < 3) throw fail(400, 'Indica el motivo de la devolución');
    return tx(() => {
      const p = q('SELECT * FROM payments WHERE id = ?').get(paymentId);
      if (!p) throw fail(404, 'Cobro no encontrado');
      if (p.amount_cents < 0) throw fail(400, 'Eso ya es una devolución');
      if (q('SELECT 1 FROM payments WHERE refund_of = ?').get(paymentId)) throw fail(409, 'Ese cobro ya se devolvió');
      const ses = openSession();
      if (!ses) throw fail(409, 'Abre la caja para hacer la devolución');
      if (p.method === 'cash' && p.amount_cents > sessionSummary(ses.id).expectedCashCents) throw fail(409, 'No hay tanto efectivo en la caja');
      const id = uid('dev');
      q('INSERT INTO payments (id, check_id, session_id, method, amount_cents, refund_of, reason, employee_id, employee_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, p.check_id, ses.id, p.method, -p.amount_cents, p.id, why, staff.id, staff.name, nowIso());
      const c = getCheckRow(p.check_id);
      if (c.status === 'paid') {
        if (openCheckFor(c.table_id)) throw fail(409, 'La mesa ya tiene otra cuenta abierta: cobra o cierra esa antes de devolver este pago');
        q("UPDATE checks SET status = 'open', closed_at = NULL, closed_by = NULL WHERE id = ?").run(c.id);
      }
      return { refund: publicPayment(q('SELECT * FROM payments WHERE id = ?').get(id)), check: summary(p.check_id) };
    });
  }

  const paymentsList = ({ sessionId, limit = 300 } = {}) => (sessionId
    ? q('SELECT p.*, c.table_number FROM payments p JOIN checks c ON c.id = p.check_id WHERE p.session_id = ? ORDER BY p.at DESC LIMIT ?').all(sessionId, Math.min(2000, Number(limit) || 300))
    : q('SELECT p.*, c.table_number FROM payments p JOIN checks c ON c.id = p.check_id ORDER BY p.at DESC LIMIT ?').all(Math.min(2000, Number(limit) || 300))
  ).map(p => ({ ...publicPayment(p), tableNumber: p.table_number, refunded: !!q('SELECT 1 FROM payments WHERE refund_of = ?').get(p.id) }));

  // ------------------------------------------------------------------ Facturas
  // Datos del emisor (los mismos del Aviso legal en Ajustes)
  function issuerData() {
    const st = db.getSettings();
    const issuer = {
      name: String(st.legalName || '').trim(), nif: String(st.nif || '').trim(),
      address: [st.address, [st.postalCode, st.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      tradeName: st.restaurantName || ''
    };
    const missing = [!issuer.name && 'razón social', !issuer.nif && 'NIF', !st.address && 'dirección'].filter(Boolean);
    return { issuer, missing };
  }

  // Reparte el descuento entre las líneas y desglosa el IVA por tipo (precios con IVA incluido)
  function taxBreakdown(lines, discountCents) {
    const gross = lines.reduce((s, l) => s + l.totalCents, 0);
    let remaining = discountCents;
    const alloc = lines.map((l, i) => {
      const share = i === lines.length - 1 ? remaining : Math.round(discountCents * (gross ? l.totalCents / gross : 0));
      remaining -= share;
      return { ...l, netCents: l.totalCents - share };
    });
    const byRate = {};
    for (const l of alloc) byRate[l.vatRate] = (byRate[l.vatRate] || 0) + l.netCents;
    const taxes = Object.entries(byRate).map(([rate, totalCents]) => {
      const r = Number(rate);
      const baseCents = Math.round(totalCents * 100 / (100 + r));
      return { rate: r, baseCents, taxCents: totalCents - baseCents, totalCents };
    }).sort((a, b) => b.rate - a.rate);
    return { taxes, totalCents: alloc.reduce((s, l) => s + l.netCents, 0) };
  }

  function nextNumber(series, year) {
    return (q('SELECT max(number) m FROM invoices WHERE series = ? AND year = ?').get(series, year).m || 0) + 1;
  }

  function insertInvoice({ type, checkId, rectifiesId, replacesId, issuer, customer, lines, taxes, totalCents, reason }, staff) {
    const series = SERIES[type];
    const issuedAt = nowIso();
    const year = Number(time.todayStr(db.getSettings().timezone, new Date(issuedAt)).slice(0, 4));
    const number = nextNumber(series, year);
    const fullNumber = `${series}${year}-${String(number).padStart(6, '0')}`;
    const prev = q('SELECT hash FROM invoices ORDER BY rowid DESC LIMIT 1').get();
    const prevHash = prev ? prev.hash : null;
    // Encadenamiento: cada factura incluye la huella de la anterior (no se puede alterar ni intercalar)
    const hash = crypto.createHash('sha256').update(JSON.stringify([fullNumber, issuedAt, issuer.nif, totalCents, taxes, lines.map(l => [l.name, l.quantity, l.unitCents, l.vatRate]), prevHash])).digest('hex');
    const id = uid('fac');
    q('INSERT INTO invoices (id, series, year, number, full_number, type, check_id, rectifies_id, replaces_id, issued_at, issued_by, issued_by_name, issuer, customer, lines, taxes, total_cents, reason, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, series, year, number, fullNumber, type, checkId || null, rectifiesId || null, replacesId || null, issuedAt, staff?.id || null, staff?.name || null,
        JSON.stringify(issuer), customer ? JSON.stringify(customer) : null, JSON.stringify(lines), JSON.stringify(taxes), totalCents, reason || null, prevHash, hash);
    return getInvoice(id);
  }

  function getInvoice(id) {
    const r = q('SELECT * FROM invoices WHERE id = ? OR full_number = ?').get(id, id);
    if (!r) return null;
    const rectifiedBy = q('SELECT full_number FROM invoices WHERE rectifies_id = ?').get(r.id)?.full_number || null;
    const replacedBy = q('SELECT full_number FROM invoices WHERE replaces_id = ?').get(r.id)?.full_number || null;
    const ref = (x) => (x ? q('SELECT full_number FROM invoices WHERE id = ?').get(x)?.full_number : null);
    return {
      id: r.id, number: r.full_number, series: r.series, year: r.year, type: r.type, checkId: r.check_id,
      rectifies: ref(r.rectifies_id), replaces: ref(r.replaces_id), rectifiedBy, replacedBy,
      issuedAt: r.issued_at, issuedBy: r.issued_by_name, issuer: JSON.parse(r.issuer), customer: r.customer ? JSON.parse(r.customer) : null,
      lines: JSON.parse(r.lines), taxes: JSON.parse(r.taxes), totalCents: r.total_cents, reason: r.reason, hash: r.hash, prevHash: r.prev_hash
    };
  }

  function issueInvoice(checkId, { type = 'simplified', customer } = {}, staff) {
    if (!['simplified', 'full'].includes(type)) throw fail(400, 'Tipo de factura no válido');
    const { issuer, missing } = issuerData();
    if (missing.length) throw fail(409, `Para emitir facturas faltan los datos fiscales en Ajustes: ${missing.join(', ')}`);
    let cust = null;
    if (type === 'full') {
      cust = {
        name: String(customer?.name || '').trim().slice(0, 120),
        nif: String(customer?.nif || '').trim().toUpperCase().slice(0, 20),
        address: String(customer?.address || '').trim().slice(0, 200)
      };
      if (!cust.name || !cust.nif || !cust.address) throw fail(400, 'Para la factura completa indica nombre, NIF y dirección del cliente');
    }
    return tx(() => {
      const s = summary(checkId);
      if (!s) throw fail(404, 'Cuenta no encontrada');
      if (s.status !== 'paid') throw fail(409, 'Primero cobra la cuenta completa');
      if (s.totalCents <= 0) throw fail(409, 'Una cuenta a 0 € no lleva factura');
      const active = q("SELECT * FROM invoices i WHERE check_id = ? AND type IN ('simplified', 'full') AND NOT EXISTS (SELECT 1 FROM invoices r WHERE r.rectifies_id = i.id) AND NOT EXISTS (SELECT 1 FROM invoices x WHERE x.replaces_id = i.id)").all(checkId);
      if (active.some(i => i.type === 'full')) throw fail(409, 'Esta cuenta ya tiene factura completa');
      if (type === 'simplified' && active.length) throw fail(409, `Esta cuenta ya tiene la factura ${active[0].full_number}`);
      const replaces = type === 'full' ? active.find(i => i.type === 'simplified') : null;
      const billable = s.lines.filter(l => l.billQty > 0);
      const { taxes, totalCents } = taxBreakdown(billable, s.discountCents);
      const lines = billable.map(l => ({ name: l.name, quantity: l.billQty, unitCents: l.unitCents, vatRate: l.vatRate, totalCents: l.totalCents }));
      if (s.discountCents) lines.push({ name: `Descuento${s.discount?.reason ? ` (${s.discount.reason})` : ''}`, quantity: 1, unitCents: -s.discountCents, vatRate: null, totalCents: -s.discountCents });
      return insertInvoice({ type, checkId, replacesId: replaces?.id, issuer, customer: cust, lines, taxes, totalCents }, staff);
    });
  }

  // Factura rectificativa por el total (anula los importes de la original)
  function rectify(invoiceId, reason, staff) {
    const why = String(reason || '').trim().slice(0, 200);
    if (why.length < 3) throw fail(400, 'Indica el motivo de la rectificación');
    return tx(() => {
      const orig = getInvoice(invoiceId);
      if (!orig) throw fail(404, 'Factura no encontrada');
      if (orig.type === 'rectifying') throw fail(409, 'No se puede rectificar una rectificativa');
      if (orig.rectifiedBy) throw fail(409, `Ya está rectificada por ${orig.rectifiedBy}`);
      if (orig.replacedBy) throw fail(409, `Fue sustituida por la factura ${orig.replacedBy}: rectifica esa`);
      const { issuer, missing } = issuerData();
      if (missing.length) throw fail(409, `Faltan los datos fiscales en Ajustes: ${missing.join(', ')}`);
      const lines = orig.lines.map(l => ({ ...l, quantity: -l.quantity, totalCents: -l.totalCents }));
      const taxes = orig.taxes.map(t => ({ rate: t.rate, baseCents: -t.baseCents, taxCents: -t.taxCents, totalCents: -t.totalCents }));
      const row = q('SELECT id FROM invoices WHERE full_number = ?').get(orig.number);
      return insertInvoice({ type: 'rectifying', checkId: orig.checkId, rectifiesId: row.id, issuer, customer: orig.customer, lines, taxes, totalCents: -orig.totalCents, reason: why }, staff);
    });
  }

  function listInvoices({ from, to, limit = 300 } = {}) {
    const where = [];
    const args = [];
    if (from) { where.push('issued_at >= ?'); args.push(from); }
    if (to) { where.push('issued_at < ?'); args.push(to); }
    args.push(Math.min(5000, Number(limit) || 300));
    return q(`SELECT id FROM invoices ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY issued_at DESC LIMIT ?`).all(...args).map(r => getInvoice(r.id));
  }

  // Comprueba que la cadena de huellas no se ha roto
  function verifyChain() {
    const rows = q('SELECT * FROM invoices ORDER BY rowid').all();
    let prev = null;
    for (const r of rows) {
      const lines = JSON.parse(r.lines);
      const expected = crypto.createHash('sha256').update(JSON.stringify([r.full_number, r.issued_at, JSON.parse(r.issuer).nif, r.total_cents, JSON.parse(r.taxes), lines.map(l => [l.name, l.quantity, l.unitCents, l.vatRate]), prev])).digest('hex');
      if (r.prev_hash !== prev || r.hash !== expected) return { ok: false, brokenAt: r.full_number, count: rows.length };
      prev = r.hash;
    }
    return { ok: true, count: rows.length };
  }

  return {
    ensureOpenCheck, adoptLegacyOrders, summary, checkForTable, listChecks, adjustLine, setDiscount,
    openCash, cashMovement, closeCash, currentCash, cashHistory, sessionSummary,
    pay, closeZero, refund, paymentsList,
    issuerData, issueInvoice, rectify, getInvoice, listInvoices, verifyChain, taxBreakdown
  };
}

module.exports = { createSales, cents };
