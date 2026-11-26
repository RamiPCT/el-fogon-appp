import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../utils/api';
import { useSocket } from '../../context/SocketContext';
import { eur, newKey, printTicketText } from '../../utils/money';
import { useStaff } from '../../hooks/useStaff';
import { PRINT_STATUS } from './PrinterTest';

const METHOD = { cash: '💶 Efectivo', card: '💳 Tarjeta', other: '🔖 Otro' };
const btn = 'px-3 py-2 rounded-xl text-xs font-bold active:scale-95 transition disabled:opacity-40';
const inputCls = 'w-full bg-[#121212] border border-stone-700 rounded-lg px-2 py-2 text-sm text-stone-100 outline-none focus:border-[#C8A45D]';

// Imprime en la térmica si está activada; si no, abre el ticket en el navegador
async function printBoth(serverPrintUrl, textUrl, title) {
  try {
    const r = await api(serverPrintUrl, { method: 'POST', body: {} });
    if (r.status === 'SENT') return;
    const { text } = await api(textUrl);
    printTicketText(title, text);
    if (r.status === 'FAILED') alert(PRINT_STATUS.FAILED);
  } catch (err) { alert(err.message); }
}

// ---------------------------------------------------------------- Cobrar
const PayDialog = ({ check, onClose, onDone }) => {
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState((check.pendingCents / 100).toFixed(2));
  const [tendered, setTendered] = useState('');
  const [byItems, setByItems] = useState(false);
  const [selected, setSelected] = useState({}); // clave línea -> unidades
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const key = useRef(newKey());

  const billable = check.lines.filter(l => l.billQty > 0);
  const lineKey = (l) => `${l.orderId}:${l.idx}`;
  // Por platos: el importe sale de las unidades elegidas (aplicando el descuento en proporción)
  const itemsCents = useMemo(() => {
    const gross = billable.reduce((s, l) => s + (selected[lineKey(l)] || 0) * l.unitCents, 0);
    return check.subtotalCents ? Math.round(gross * check.totalCents / check.subtotalCents) : gross;
  }, [selected, check]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (byItems) setAmount((Math.min(itemsCents, check.pendingCents) / 100).toFixed(2)); }, [byItems, itemsCents, check.pendingCents]);

  const amountCents = Math.round(Number(String(amount).replace(',', '.')) * 100) || 0;
  const tenderedCents = Math.round(Number(String(tendered).replace(',', '.')) * 100) || 0;
  const change = method === 'cash' && tenderedCents ? tenderedCents - amountCents : null;
  const split = (n) => { setByItems(false); setAmount((Math.ceil(check.pendingCents / n) / 100).toFixed(2)); };

  const submit = async () => {
    setSending(true);
    setError('');
    try {
      const items = byItems ? billable.filter(l => selected[lineKey(l)]).map(l => ({ name: l.name, qty: selected[lineKey(l)] })) : undefined;
      const r = await api(`/api/checks/${check.id}/payments`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key.current },
        body: { method, amount: amountCents / 100, tendered: method === 'cash' && tendered ? tenderedCents / 100 : undefined, items }
      });
      key.current = newKey();
      onDone(r);
    } catch (err) {
      setError(err.message);
      if (err.status && err.status < 500) key.current = newKey();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-label="Cobrar">
      <div className="w-full sm:max-w-md bg-[#1A1A1A] border border-[#C8A45D]/60 rounded-t-3xl sm:rounded-3xl p-4 space-y-3 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-[#F4EFE6]">Cobrar · Mesa {check.tableNumber}</h3>
          <button onClick={onClose} className="text-stone-400 text-sm" aria-label="Cerrar">✕</button>
        </div>
        <p className="text-xs text-stone-400">Pendiente: <strong className="text-[#E6C687] text-base">{eur(check.pendingCents)}</strong></p>

        <div className="grid grid-cols-3 gap-1.5">
          {Object.entries(METHOD).map(([k, label]) => (
            <button key={k} onClick={() => setMethod(k)} className={`${btn} border ${method === k ? 'bg-[#C8A45D] text-[#121212] border-[#C8A45D]' : 'border-stone-700 text-stone-300'}`}>{label}</button>
          ))}
        </div>
        {method === 'card' && <p className="text-[11px] text-stone-400">Cobra en el datáfono del banco y confirma aquí cuando el pago salga aprobado.</p>}

        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <span className="text-stone-500 self-center">Dividir:</span>
          <button onClick={() => { setByItems(false); setAmount((check.pendingCents / 100).toFixed(2)); }} className="px-2 py-1 rounded-lg border border-stone-700 text-stone-300">Todo</button>
          {[2, 3, 4].map(n => <button key={n} onClick={() => split(n)} className="px-2 py-1 rounded-lg border border-stone-700 text-stone-300">Entre {n}</button>)}
          <button onClick={() => setByItems(v => !v)} className={`px-2 py-1 rounded-lg border ${byItems ? 'border-[#C8A45D] text-[#E6C687]' : 'border-stone-700 text-stone-300'}`}>Por platos</button>
        </div>

        {byItems && (
          <ul className="bg-[#121212] border border-stone-800 rounded-xl divide-y divide-stone-800 text-xs">
            {billable.map(l => {
              const k = lineKey(l);
              const n = selected[k] || 0;
              return (
                <li key={k} className="flex items-center gap-2 px-2 py-1.5">
                  <span className="flex-1 min-w-0 truncate text-stone-200">{l.billQty}× {l.name}</span>
                  <button onClick={() => setSelected(p => ({ ...p, [k]: Math.max(0, n - 1) }))} className="w-7 h-7 rounded-lg border border-stone-700" aria-label={`Menos ${l.name}`}>−</button>
                  <span className="w-4 text-center font-bold">{n}</span>
                  <button onClick={() => setSelected(p => ({ ...p, [k]: Math.min(l.billQty, n + 1) }))} className="w-7 h-7 rounded-lg border border-stone-700" aria-label={`Más ${l.name}`}>+</button>
                </li>
              );
            })}
          </ul>
        )}

        <label className="block text-[11px] text-stone-400">Importe a cobrar (€)
          <input className={`${inputCls} mt-1 text-lg font-mono`} inputMode="decimal" value={amount} onChange={e => { setByItems(false); setAmount(e.target.value); }} />
        </label>

        {method === 'cash' && (
          <div className="space-y-1.5">
            <label className="block text-[11px] text-stone-400">Entrega el cliente (€, opcional)
              <input className={`${inputCls} mt-1 font-mono`} inputMode="decimal" value={tendered} onChange={e => setTendered(e.target.value)} placeholder="Para calcular el cambio" />
            </label>
            <div className="flex gap-1.5">
              {[5, 10, 20, 50].map(b => <button key={b} onClick={() => setTendered(String(b))} className="px-2.5 py-1 rounded-lg border border-stone-700 text-[11px] text-stone-300">{b} €</button>)}
            </div>
            {change !== null && (
              <p className={`text-sm font-bold ${change < 0 ? 'text-red-300' : 'text-green-300'}`}>{change < 0 ? `Faltan ${eur(-change)}` : `Cambio: ${eur(change)}`}</p>
            )}
          </div>
        )}

        {error && <p className="text-xs text-red-300" role="alert">{error}</p>}
        <button onClick={submit} disabled={sending || amountCents <= 0 || amountCents > check.pendingCents || (change !== null && change < 0)} className={`${btn} w-full py-3 text-sm bg-[#C8A45D] text-[#121212]`}>
          {sending ? 'Cobrando…' : `Cobrar ${eur(amountCents)} · ${METHOD[method].split(' ')[1]}`}
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- Factura
const InvoiceDialog = ({ check, onClose, onDone }) => {
  const [type, setType] = useState('simplified');
  const [customer, setCustomer] = useState({ name: '', nif: '', address: '' });
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/api/invoices/status').then(setStatus).catch(() => {}); }, []);

  const issue = async () => {
    setBusy(true);
    setError('');
    try {
      const inv = await api(`/api/checks/${check.id}/invoice`, { method: 'POST', body: { type, customer: type === 'full' ? customer : undefined } });
      await printBoth(`/api/invoices/${inv.id}/print`, `/api/invoices/${inv.id}/text`, inv.number);
      onDone(inv);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center" role="dialog" aria-label="Factura">
      <div className="w-full sm:max-w-md bg-[#1A1A1A] border border-[#C8A45D]/60 rounded-t-3xl sm:rounded-3xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-[#F4EFE6]">Factura · Mesa {check.tableNumber}</h3>
          <button onClick={onClose} className="text-stone-400 text-sm" aria-label="Cerrar">✕</button>
        </div>
        {status && !status.ready ? (
          <p className="text-xs text-amber-200 bg-amber-950/40 border border-amber-800/60 rounded-lg p-2.5">
            Para emitir facturas faltan los datos fiscales ({status.missing.join(', ')}). El administrador los completa en Ajustes → Datos fiscales. Mientras tanto puedes dar el ticket de cuenta.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <button onClick={() => setType('simplified')} className={`${btn} border ${type === 'simplified' ? 'bg-[#C8A45D] text-[#121212] border-[#C8A45D]' : 'border-stone-700 text-stone-300'}`}>Simplificada</button>
              <button onClick={() => setType('full')} className={`${btn} border ${type === 'full' ? 'bg-[#C8A45D] text-[#121212] border-[#C8A45D]' : 'border-stone-700 text-stone-300'}`}>Con datos del cliente</button>
            </div>
            {type === 'full' && (
              <div className="space-y-2">
                <input className={inputCls} placeholder="Nombre o razón social" value={customer.name} onChange={e => setCustomer({ ...customer, name: e.target.value })} />
                <input className={inputCls} placeholder="NIF / CIF" value={customer.nif} onChange={e => setCustomer({ ...customer, nif: e.target.value })} />
                <input className={inputCls} placeholder="Dirección" value={customer.address} onChange={e => setCustomer({ ...customer, address: e.target.value })} />
              </div>
            )}
            <p className="text-sm text-stone-300">Total: <strong className="text-[#E6C687]">{eur(check.totalCents)}</strong> (IVA incluido)</p>
            {error && <p className="text-xs text-red-300" role="alert">{error}</p>}
            <button onClick={issue} disabled={busy} className={`${btn} w-full py-3 text-sm bg-[#C8A45D] text-[#121212]`}>{busy ? 'Emitiendo…' : 'Emitir e imprimir'}</button>
          </>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- Cuenta
// Cuenta de una mesa: platos, anulaciones, invitaciones, descuento, cobros y factura.
export const CheckPanel = ({ tableNumber, checkId, onClosed }) => {
  const { can } = useStaff();
  const [check, setCheck] = useState(null);
  const [cashOpen, setCashOpen] = useState(true);
  const [paying, setPaying] = useState(false);
  const [invoicing, setInvoicing] = useState(false);
  const [msg, setMsg] = useState(null);

  const lastId = useRef(null);
  useEffect(() => { lastId.current = null; }, [tableNumber, checkId]);
  const load = async () => {
    try {
      let c = checkId ? await api(`/api/checks/${checkId}`) : await api(`/api/tables/${encodeURIComponent(tableNumber)}/check`);
      // Recién cobrada: se sigue mostrando (para la factura) hasta que la mesa abra otra cuenta
      if (!c && lastId.current) c = await api(`/api/checks/${lastId.current}`);
      if (c) lastId.current = c.id;
      setCheck(c);
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  };
  useEffect(() => {
    load();
    if (can('payments.take')) api('/api/cash/current').then(c => setCashOpen(!!c)).catch(() => {});
  }, [tableNumber, checkId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Refrescar al momento si alguien añade pedidos o cobra desde otro dispositivo (y cada 8 s por si acaso)
  const { socket } = useSocket();
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const t = setInterval(() => loadRef.current(), 8000);
    if (!socket) return () => clearInterval(t);
    let timer = null;
    const soon = () => { clearTimeout(timer); timer = setTimeout(() => loadRef.current(), 300); };
    const onCash = () => { if (can('payments.take')) api('/api/cash/current').then(c => setCashOpen(!!c)).catch(() => {}); };
    const events = ['check:update', 'order:new', 'order:update', 'connect'];
    events.forEach(e => socket.on(e, soon));
    socket.on('cash:update', onCash);
    return () => { clearInterval(t); clearTimeout(timer); events.forEach(e => socket.off(e, soon)); socket.off('cash:update', onCash); };
  }, [socket, tableNumber, checkId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!check) {
    return <div className="bg-[#1A1A1A] border border-stone-800 rounded-2xl p-3 text-xs text-stone-400">{msg ? msg.text : 'Sin cuenta abierta en esta mesa.'}</div>;
  }

  const adjust = async (l, type) => {
    const verb = type === 'void' ? 'anular' : 'invitar';
    const remaining = l.billQty;
    const qty = remaining > 1 ? Number(window.prompt(`¿Cuántas unidades de «${l.name}» quieres ${verb}? (máx. ${remaining})`, '1')) : 1;
    if (!qty) return;
    const reason = window.prompt(`Motivo para ${verb} ${qty}× ${l.name}:`);
    if (!reason) return;
    try {
      setCheck(await api(`/api/orders/${l.orderId}/items/${l.idx}/adjust`, { method: 'POST', body: { type, qty, reason } }));
      setMsg({ ok: true, text: type === 'void' ? `Anulado: ${qty}× ${l.name}` : `Invitación: ${qty}× ${l.name}` });
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  };

  const discount = async () => {
    const v = window.prompt('Descuento: escribe un porcentaje (ej. 10%) o un importe en euros (ej. 5). Deja vacío para quitarlo.', check.discount ? (check.discount.type === 'percent' ? `${check.discount.value / 100}%` : String(check.discount.value / 100)) : '');
    if (v === null) return;
    try {
      if (v.trim() === '') {
        setCheck(await api(`/api/checks/${check.id}/discount`, { method: 'PUT', body: { type: 'none' } }));
        return;
      }
      const reason = window.prompt('Motivo del descuento:');
      if (!reason) return;
      const isPct = v.includes('%');
      setCheck(await api(`/api/checks/${check.id}/discount`, { method: 'PUT', body: { type: isPct ? 'percent' : 'amount', value: Number(v.replace('%', '').replace(',', '.')), reason } }));
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  };

  const refund = async (p) => {
    const reason = window.prompt(`Devolver ${eur(p.amountCents)} (${METHOD[p.method]}). Motivo:`);
    if (!reason) return;
    try {
      const r = await api(`/api/payments/${p.id}/refund`, { method: 'POST', body: { reason } });
      setCheck(r.check);
      setMsg({ ok: true, text: `Devuelto ${eur(-r.refund.amountCents)}.` });
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  };

  const closeZero = async () => {
    try {
      setCheck(await api(`/api/checks/${check.id}/close`, { method: 'POST', body: {} }));
      onClosed && onClosed();
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  };

  const paid = check.status === 'paid';
  const activeInvoice = check.invoices?.length ? check.invoices[check.invoices.length - 1] : null;

  return (
    <div className="bg-[#1A1A1A] border border-[#C8A45D]/40 rounded-2xl p-3 space-y-2.5 shadow-xl">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-[#C8A45D]">🧾 Cuenta · Mesa {check.tableNumber}</h4>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${paid ? 'bg-green-700 text-black' : 'bg-stone-700 text-stone-100'}`}>{paid ? 'COBRADA' : 'ABIERTA'}</span>
      </div>

      <ul className="divide-y divide-stone-800 text-xs">
        {check.lines.map(l => (
          <li key={`${l.orderId}:${l.idx}`} className="py-1.5 flex flex-wrap items-center gap-x-2">
            <span className={`flex-1 min-w-0 ${l.billQty === 0 ? 'line-through text-stone-500' : 'text-stone-200'}`}>
              {l.quantity}× {l.name}
              {Object.keys(l.modifiers || {}).length > 0 && <span className="text-stone-500"> · {Object.values(l.modifiers).join(', ')}</span>}
            </span>
            <span className="font-mono text-stone-300">{eur(l.totalCents)}</span>
            {(l.voidQty > 0 || l.compQty > 0) && (
              <span className="basis-full text-[10px] text-amber-300">
                {l.adjustments.map((a, i) => <span key={i} className="mr-2">{a.type === 'void' ? 'Anulado' : 'Invitado'} {a.qty} · {a.reason} · {a.by?.name}</span>)}
              </span>
            )}
            {!paid && can('orders.void') && l.billQty > 0 && (
              <span className="basis-full flex gap-3 text-[10px]">
                <button onClick={() => adjust(l, 'void')} className="text-red-300 underline">Anular</button>
                <button onClick={() => adjust(l, 'comp')} className="text-amber-300 underline">Invitar</button>
              </span>
            )}
          </li>
        ))}
      </ul>

      <div className="text-xs space-y-0.5 border-t border-stone-800 pt-2">
        <p className="flex justify-between text-stone-400"><span>Subtotal</span><span className="font-mono">{eur(check.subtotalCents)}</span></p>
        {check.discountCents > 0 && <p className="flex justify-between text-amber-300"><span>Descuento ({check.discount?.reason})</span><span className="font-mono">−{eur(check.discountCents)}</span></p>}
        <p className="flex justify-between text-sm font-bold text-[#F4EFE6]"><span>Total</span><span className="font-mono">{eur(check.totalCents)}</span></p>
        {check.payments.map(p => (
          <p key={p.id} className="flex flex-wrap justify-between gap-x-2 text-stone-400">
            <span>{p.amountCents < 0 ? '↩︎ Devolución' : METHOD[p.method]} · {p.employee}{p.changeCents ? ` · cambio ${eur(p.changeCents)}` : ''}</span>
            <span className="font-mono">{eur(p.amountCents)}
              {p.amountCents > 0 && can('payments.refund') && !check.payments.some(x => x.refundOf === p.id) && (
                <button onClick={() => refund(p)} className="ml-2 text-[10px] text-red-300 underline">Devolver</button>
              )}
            </span>
          </p>
        ))}
        {!paid && <p className="flex justify-between text-sm font-bold text-[#E6C687]"><span>Pendiente</span><span className="font-mono">{eur(check.pendingCents)}</span></p>}
        {check.invoices?.map(i => <p key={i.id} className="text-[10px] text-green-300">Factura {i.number}</p>)}
      </div>

      {msg && <p className={`text-[11px] ${msg.ok ? 'text-green-300' : 'text-red-300'}`} role="status">{msg.text}</p>}
      {!cashOpen && !paid && can('payments.take') && <p className="text-[11px] text-amber-200">La caja está cerrada: hay que abrirla (pestaña Caja) para poder cobrar.</p>}

      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => printBoth(`/api/checks/${check.id}/print`, `/api/checks/${check.id}/text`, `Mesa ${check.tableNumber}`)} className={`${btn} border border-stone-600 text-stone-200`}>🖨️ Ticket</button>
        {!paid && can('discounts.apply') && <button onClick={discount} className={`${btn} border border-stone-600 text-stone-200`}>% Descuento</button>}
        {!paid && can('payments.take') && check.pendingCents > 0 && <button onClick={() => setPaying(true)} disabled={!cashOpen} className={`${btn} flex-1 bg-[#C8A45D] text-[#121212]`}>💶 Cobrar {eur(check.pendingCents)}</button>}
        {!paid && can('payments.take') && check.pendingCents === 0 && <button onClick={closeZero} className={`${btn} flex-1 bg-[#14281D] border border-green-800 text-green-200`}>Cerrar cuenta (0 €)</button>}
        {paid && can('invoices.issue') && check.totalCents > 0 && <button onClick={() => setInvoicing(true)} className={`${btn} border border-[#C8A45D]/70 text-[#E6C687]`}>{activeInvoice ? 'Factura con datos del cliente' : '📄 Factura'}</button>}
        {paid && activeInvoice && <button onClick={() => printBoth(`/api/invoices/${activeInvoice.id}/print`, `/api/invoices/${activeInvoice.id}/text`, activeInvoice.number)} className={`${btn} border border-stone-600 text-stone-200`}>Reimprimir factura</button>}
      </div>

      {paying && (
        <PayDialog
          check={check}
          onClose={() => setPaying(false)}
          onDone={(r) => {
            setPaying(false);
            setCheck(r.check);
            const ch = r.payment.changeCents ? ` · Cambio: ${eur(r.payment.changeCents)}` : '';
            setMsg({ ok: true, text: r.check.status === 'paid' ? `✅ Cuenta cobrada. Mesa liberada.${ch}` : `✅ Cobrado ${eur(r.payment.amountCents)}. Quedan ${eur(r.check.pendingCents)}.${ch}` });
          }}
        />
      )}
      {invoicing && <InvoiceDialog check={check} onClose={() => setInvoicing(false)} onDone={(inv) => { setInvoicing(false); setMsg({ ok: true, text: `✅ Factura ${inv.number} emitida.` }); load(); }} />}
    </div>
  );
};
