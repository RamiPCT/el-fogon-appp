// Textos para la impresora térmica (48 columnas): ticket de cuenta, factura y cierre de caja
const time = require('./time');

const W = 48;
const eur = (c) => `${(c / 100).toFixed(2).replace('.', ',')} €`;
const line = (ch = '-') => ch.repeat(W);
const center = (t) => { const s = String(t).slice(0, W); return ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s; };
const lr = (l, r) => { const right = String(r); const left = String(l).slice(0, W - right.length - 1); return left + ' '.repeat(W - left.length - right.length) + right; };
const when = (iso, tz) => `${time.formatDate(iso, tz)} ${time.formatTime(iso, tz)}`;

function header(settings) {
  const out = [line('='), center((settings.restaurantName || 'EL FOGÓN').toUpperCase())];
  if (settings.subtitle) out.push(center(settings.subtitle));
  if (settings.address) out.push(center([settings.address, settings.city].filter(Boolean).join(', ')));
  if (settings.publicPhone) out.push(center(`Tel. ${settings.publicPhone}`));
  out.push(line('='));
  return out;
}

function itemLines(lines) {
  const out = [];
  for (const l of lines) {
    const qty = l.unitCents < 0 ? '' : `${l.quantity}x `; // el descuento no lleva cantidad
    out.push(lr(`${qty}${l.name}`, eur(l.totalCents)));
    if (l.quantity !== 1 && l.unitCents) out.push(`   ${eur(l.unitCents)} / ud.`);
  }
  return out;
}

// Ticket de cuenta (precuenta): no es una factura
function checkTicket(s, settings) {
  const tz = settings.timezone;
  const billable = s.lines.filter(l => l.billQty > 0).map(l => ({ name: l.name, quantity: l.billQty, unitCents: l.unitCents, totalCents: l.totalCents }));
  const comps = s.lines.filter(l => l.compQty > 0).map(l => `${l.compQty}x ${l.name} (invitación)`);
  const out = [...header(settings), lr(`MESA ${s.tableNumber}`, when(new Date().toISOString(), tz)), line()];
  out.push(...itemLines(billable));
  comps.forEach(c => out.push(lr(c, eur(0))));
  out.push(line());
  out.push(lr('Subtotal', eur(s.subtotalCents)));
  if (s.discountCents) out.push(lr(`Descuento${s.discount?.reason ? ` (${s.discount.reason})` : ''}`, `-${eur(s.discountCents)}`));
  out.push(lr('TOTAL (IVA incluido)', eur(s.totalCents)));
  if (s.paidCents) {
    out.push(lr('Pagado', eur(s.paidCents)));
    out.push(lr('Pendiente', eur(s.pendingCents)));
  }
  out.push(line('='), center('Este ticket no es una factura'), center('Gracias por su visita'), '\n\n\n');
  return out.join('\n');
}

const TYPE_TITLE = { simplified: 'FACTURA SIMPLIFICADA', full: 'FACTURA', rectifying: 'FACTURA RECTIFICATIVA' };

function invoiceTicket(inv, settings) {
  const tz = settings.timezone;
  const out = [line('='), center(inv.issuer.tradeName ? inv.issuer.tradeName.toUpperCase() : ''), center(inv.issuer.name), center(`NIF ${inv.issuer.nif}`), center(inv.issuer.address), line('=')];
  out.push(center(TYPE_TITLE[inv.type]), lr(`Nº ${inv.number}`, when(inv.issuedAt, tz)));
  if (inv.replaces) out.push(`Sustituye a la factura simplificada ${inv.replaces}`);
  if (inv.rectifies) out.push(`Rectifica la factura ${inv.rectifies}`, `Motivo: ${inv.reason}`);
  if (inv.customer) out.push(line(), `Cliente: ${inv.customer.name}`, `NIF: ${inv.customer.nif}`, inv.customer.address);
  out.push(line());
  out.push(...itemLines(inv.lines));
  out.push(line());
  for (const t of inv.taxes) {
    out.push(lr(`Base imponible ${t.rate} %`, eur(t.baseCents)));
    out.push(lr(`IVA ${t.rate} %`, eur(t.taxCents)));
  }
  out.push(lr('TOTAL', eur(inv.totalCents)));
  if (inv.type === 'simplified') out.push(line(), center('IVA incluido'));
  out.push(line('='), center('Gracias por su visita'), '\n\n\n');
  return out.join('\n');
}

function cashTicket(c, settings) {
  const tz = settings.timezone;
  const out = [line('='), center('CIERRE DE CAJA'), line('=')];
  out.push(lr('Apertura', when(c.openedAt, tz)), lr('  por', c.openedBy || ''));
  if (c.closedAt) out.push(lr('Cierre', when(c.closedAt, tz)), lr('  por', c.closedBy || ''));
  out.push(line());
  out.push(lr('Fondo inicial', eur(c.openingCents)));
  out.push(lr('Cobros en efectivo', eur(c.cashCents)));
  out.push(lr('Entradas de efectivo', eur(c.inCents)));
  out.push(lr('Salidas de efectivo', `-${eur(c.outCents)}`));
  out.push(lr('EFECTIVO ESPERADO', eur(c.expectedCashCents)));
  if (c.countedCents !== null && c.countedCents !== undefined) {
    out.push(lr('EFECTIVO CONTADO', eur(c.countedCents)));
    out.push(lr('DESCUADRE', `${c.differenceCents > 0 ? '+' : ''}${eur(c.differenceCents)}`));
  }
  out.push(line());
  out.push(lr('Tarjeta', eur(c.cardCents)), lr('Otros', eur(c.otherCents)), lr('Total cobrado', eur(c.totalSalesCents)));
  out.push(lr('Devoluciones', eur(c.refundsCents)), lr('Cuentas cobradas', String(c.checksPaid)));
  if (c.movements?.length) {
    out.push(line(), 'Movimientos:');
    c.movements.forEach(m => out.push(lr(` ${m.type === 'in' ? '+' : '-'} ${m.reason}`, eur(m.amountCents))));
  }
  if (c.notes) out.push(line(), `Notas: ${c.notes}`);
  out.push(line('='), '\n\n\n');
  return out.join('\n');
}

module.exports = { checkTicket, invoiceTicket, cashTicket };
