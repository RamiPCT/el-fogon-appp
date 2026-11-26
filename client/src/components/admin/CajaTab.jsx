import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../utils/api';
import { useSocket } from '../../context/SocketContext';
import { eur, printTicketText } from '../../utils/money';
import { useStaff } from '../../hooks/useStaff';
import { CheckPanel } from './CheckPanel';
import { PRINT_STATUS } from './PrinterTest';

const METHOD = { cash: 'Efectivo', card: 'Tarjeta', other: 'Otro' };
const TYPE = { simplified: 'Simplificada', full: 'Completa', rectifying: 'Rectificativa' };
const card = 'bg-[#1A1A1A] border border-stone-800 rounded-2xl p-4 space-y-3 shadow-xl';
const inputCls = 'w-full bg-[#121212] border border-stone-700 rounded-lg px-2 py-2 text-sm text-stone-100 outline-none focus:border-[#C8A45D]';
const btn = 'px-3 py-2 rounded-xl text-xs font-bold active:scale-95 transition disabled:opacity-40';
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const toCents = (v) => Math.round(Number(String(v).replace(',', '.')) * 100);

async function printCash(id) {
  try {
    const r = await api(`/api/cash/sessions/${id}/print`, { method: 'POST', body: {} });
    if (r.status === 'SENT') return;
    const { text } = await api(`/api/cash/sessions/${id}/text`);
    printTicketText('Cierre de caja', text);
    if (r.status === 'FAILED') alert(PRINT_STATUS.FAILED);
  } catch (err) { alert(err.message); }
}

const Stat = ({ label, value, strong }) => (
  <div className="bg-[#121212] border border-stone-800 rounded-xl p-2.5">
    <p className="text-[10px] text-stone-500">{label}</p>
    <p className={`font-mono ${strong ? 'text-lg font-bold text-[#E6C687]' : 'text-sm text-stone-100'}`}>{value}</p>
  </div>
);

// Pestaña "Caja": apertura, movimientos, cuentas abiertas, cobros, cierre con arqueo, historial y facturas
export const CajaTab = () => {
  const { can } = useStaff();
  const [cash, setCash] = useState(undefined);
  const [openChecks, setOpenChecks] = useState([]);
  const [payments, setPayments] = useState([]);
  const [history, setHistory] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [selectedCheck, setSelectedCheck] = useState(null);
  const [opening, setOpening] = useState('');
  const [move, setMove] = useState({ type: 'out', amount: '', reason: '' });
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState(null);
  const [chain, setChain] = useState(null);

  const load = async () => {
    try {
      const c = await api('/api/cash/current');
      setCash(c);
      setOpenChecks(await api('/api/checks?status=open'));
      setPayments(c ? await api(`/api/payments?session=${c.id}`) : []);
      setHistory(await api('/api/cash/sessions?limit=30'));
      if (can('invoices.view')) setInvoices(await api('/api/invoices?limit=100'));
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tiempo real: cobros, cuentas y caja hechos desde otros dispositivos
  const { socket } = useSocket();
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!socket) return;
    let timer = null;
    const soon = () => { clearTimeout(timer); timer = setTimeout(() => loadRef.current(), 400); };
    const events = ['check:update', 'cash:update', 'order:new', 'connect'];
    events.forEach(e => socket.on(e, soon));
    const poll = setInterval(() => { if (document.visibilityState === 'visible') loadRef.current(); }, 20000);
    return () => { events.forEach(e => socket.off(e, soon)); clearTimeout(timer); clearInterval(poll); };
  }, [socket]);

  const run = async (fn, okText) => {
    setMsg(null);
    try { await fn(); if (okText) setMsg({ ok: true, text: okText }); await load(); } catch (err) { setMsg({ ok: false, text: err.message }); }
  };

  const openCash = () => run(() => api('/api/cash/open', { method: 'POST', body: { opening: toCents(opening || 0) / 100 } }), '✅ Caja abierta.');
  const addMove = () => run(async () => {
    await api('/api/cash/movements', { method: 'POST', body: { type: move.type, amount: toCents(move.amount) / 100, reason: move.reason } });
    setMove({ type: move.type, amount: '', reason: '' });
  }, move.type === 'in' ? '✅ Entrada registrada.' : '✅ Salida registrada.');
  const closeCash = () => {
    const diff = toCents(counted) - cash.expectedCashCents;
    const warn = openChecks.length ? `\n\nOjo: hay ${openChecks.length} cuenta(s) sin cobrar.` : '';
    if (!window.confirm(`¿Cerrar la caja?\nEsperado: ${eur(cash.expectedCashCents)}\nContado: ${eur(toCents(counted))}\nDescuadre: ${eur(diff)}${warn}`)) return;
    run(async () => {
      const c = await api('/api/cash/close', { method: 'POST', body: { counted: toCents(counted) / 100, notes } });
      setCounted('');
      setNotes('');
      await printCash(c.id);
    }, '✅ Caja cerrada.');
  };
  const rectify = (inv) => {
    const reason = window.prompt(`Rectificar la factura ${inv.number} por ${eur(inv.totalCents)}. Motivo:`);
    if (reason) run(() => api(`/api/invoices/${inv.id}/rectify`, { method: 'POST', body: { reason } }), '✅ Factura rectificativa emitida.');
  };
  const reprint = async (inv) => {
    try {
      const r = await api(`/api/invoices/${inv.id}/print`, { method: 'POST', body: {} });
      if (r.status !== 'SENT') printTicketText(inv.number, (await api(`/api/invoices/${inv.id}/text`)).text);
    } catch (err) { alert(err.message); }
  };

  if (cash === undefined) return <div className={card}><p className="text-xs text-stone-400">Cargando caja…</p></div>;
  const diffPreview = counted !== '' ? toCents(counted) - cash?.expectedCashCents : null;

  return (
    <div className="space-y-3.5">
      {msg && <p className={`text-xs px-1 ${msg.ok ? 'text-green-300' : 'text-red-300'}`} role="status">{msg.text}</p>}

      {!cash ? (
        <div className={card}>
          <h3 className="font-display text-sm font-bold text-[#C8A45D]">💶 Abrir caja</h3>
          <p className="text-[11px] text-stone-400">Cuenta el efectivo con el que empiezas (el cambio) y abre la caja. Sin caja abierta no se puede cobrar.</p>
          <label className="block text-[11px] text-stone-400">Fondo inicial (€)
            <input className={`${inputCls} mt-1 font-mono`} inputMode="decimal" value={opening} onChange={e => setOpening(e.target.value)} placeholder="0,00" />
          </label>
          <button onClick={openCash} className={`${btn} w-full py-3 bg-[#C8A45D] text-[#121212]`}>Abrir caja</button>
        </div>
      ) : (
        <>
          <div className={card}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-[#C8A45D]">💶 Caja abierta</h3>
              <span className="text-[10px] text-stone-500">desde {fmt(cash.openedAt)} · {cash.openedBy}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Stat label="Efectivo esperado en caja" value={eur(cash.expectedCashCents)} strong />
              <Stat label="Fondo inicial" value={eur(cash.openingCents)} />
              <Stat label="Cobrado en efectivo" value={eur(cash.cashCents)} />
              <Stat label="Cobrado con tarjeta" value={eur(cash.cardCents)} />
              <Stat label="Otros" value={eur(cash.otherCents)} />
              <Stat label="Total cobrado" value={eur(cash.totalSalesCents)} />
              <Stat label="Entradas / salidas" value={`+${eur(cash.inCents)} / −${eur(cash.outCents)}`} />
              <Stat label="Devoluciones" value={eur(cash.refundsCents)} />
              <Stat label="Cuentas cobradas" value={cash.checksPaid} />
            </div>
          </div>

          <div className={card}>
            <h3 className="text-xs font-bold text-stone-200">Entrada o salida de efectivo</h3>
            <div className="grid grid-cols-2 gap-1.5">
              <button onClick={() => setMove({ ...move, type: 'in' })} className={`${btn} border ${move.type === 'in' ? 'bg-[#14281D] border-green-700 text-green-200' : 'border-stone-700 text-stone-300'}`}>+ Entrada</button>
              <button onClick={() => setMove({ ...move, type: 'out' })} className={`${btn} border ${move.type === 'out' ? 'bg-red-950 border-red-800 text-red-200' : 'border-stone-700 text-stone-300'}`}>− Salida</button>
            </div>
            <div className="grid grid-cols-[110px_1fr] gap-2">
              <input className={`${inputCls} font-mono`} inputMode="decimal" placeholder="€" value={move.amount} onChange={e => setMove({ ...move, amount: e.target.value })} aria-label="Importe" />
              <input className={inputCls} placeholder={move.type === 'in' ? 'Motivo (ej. cambio del banco)' : 'Motivo (ej. pago a proveedor)'} value={move.reason} onChange={e => setMove({ ...move, reason: e.target.value })} aria-label="Motivo" />
            </div>
            <button onClick={addMove} disabled={!move.amount || move.reason.trim().length < 3} className={`${btn} w-full border border-stone-600 text-stone-200`}>Registrar</button>
            {cash.movements.length > 0 && (
              <ul className="text-[11px] text-stone-400 divide-y divide-stone-800">
                {cash.movements.map(m => <li key={m.id} className="py-1 flex justify-between gap-2"><span>{fmt(m.at)} · {m.reason} · {m.employee}</span><span className={`font-mono ${m.type === 'in' ? 'text-green-300' : 'text-red-300'}`}>{m.type === 'in' ? '+' : '−'}{eur(m.amountCents)}</span></li>)}
              </ul>
            )}
          </div>
        </>
      )}

      <div className={card}>
        <h3 className="text-xs font-bold text-stone-200">Cuentas abiertas ({openChecks.length})</h3>
        {openChecks.length === 0 && <p className="text-[11px] text-stone-500">No hay mesas con cuenta abierta.</p>}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {openChecks.map(c => (
            <button key={c.id} onClick={() => setSelectedCheck(selectedCheck === c.id ? null : c.id)} className={`rounded-xl border p-2 text-left ${selectedCheck === c.id ? 'border-[#C8A45D] bg-[#2a2416]' : 'border-stone-700 bg-[#121212]'}`}>
              <span className="block text-sm font-bold text-[#F4EFE6]">Mesa {c.tableNumber}</span>
              <span className="block text-[11px] font-mono text-[#E6C687]">{eur(c.pendingCents)}</span>
            </button>
          ))}
        </div>
        {selectedCheck && <CheckPanel key={selectedCheck} checkId={selectedCheck} onClosed={load} />}
      </div>

      {cash && (
        <div className={card}>
          <h3 className="text-xs font-bold text-stone-200">Cobros de esta caja ({payments.length})</h3>
          <ul className="text-[11px] divide-y divide-stone-800 max-h-64 overflow-y-auto">
            {payments.map(p => (
              <li key={p.id} className="py-1.5 flex justify-between gap-2 text-stone-300">
                <span>{fmt(p.at)} · Mesa {p.tableNumber} · {p.amountCents < 0 ? 'Devolución' : METHOD[p.method]} · {p.employee}{p.refunded ? ' · devuelto' : ''}</span>
                <span className={`font-mono ${p.amountCents < 0 ? 'text-red-300' : ''}`}>{eur(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {cash && (
        <div className={`${card} border-[#C8A45D]/50`}>
          <h3 className="font-display text-sm font-bold text-[#C8A45D]">🔒 Cerrar caja (arqueo)</h3>
          <p className="text-[11px] text-stone-400">Cuenta todo el efectivo del cajón (incluido el fondo) y escríbelo. La app calcula el descuadre.</p>
          <label className="block text-[11px] text-stone-400">Efectivo contado (€)
            <input className={`${inputCls} mt-1 font-mono text-lg`} inputMode="decimal" value={counted} onChange={e => setCounted(e.target.value)} placeholder={(cash.expectedCashCents / 100).toFixed(2)} />
          </label>
          {diffPreview !== null && (
            <p className={`text-sm font-bold ${diffPreview === 0 ? 'text-green-300' : 'text-amber-300'}`}>
              {diffPreview === 0 ? '✅ Cuadra' : diffPreview > 0 ? `Sobran ${eur(diffPreview)}` : `Faltan ${eur(-diffPreview)}`}
            </p>
          )}
          <input className={inputCls} placeholder="Notas (opcional)" value={notes} onChange={e => setNotes(e.target.value)} />
          <button onClick={closeCash} disabled={counted === ''} className={`${btn} w-full py-3 bg-[#C8A45D] text-[#121212]`}>Cerrar caja e imprimir resumen</button>
        </div>
      )}

      <div className={card}>
        <h3 className="text-xs font-bold text-stone-200">Cierres anteriores</h3>
        <ul className="text-[11px] divide-y divide-stone-800">
          {history.filter(h => h.status === 'closed').map(h => (
            <li key={h.id} className="py-1.5 flex flex-wrap items-center justify-between gap-2 text-stone-300">
              <span>{fmt(h.openedAt)} → {fmt(h.closedAt)} · {h.closedBy}</span>
              <span className="font-mono">{eur(h.totalSalesCents)} · <span className={h.differenceCents === 0 ? 'text-green-300' : 'text-amber-300'}>descuadre {eur(h.differenceCents)}</span></span>
              <button onClick={() => printCash(h.id)} className="text-[10px] text-[#E6C687] underline">Imprimir</button>
            </li>
          ))}
        </ul>
        {!history.some(h => h.status === 'closed') && <p className="text-[11px] text-stone-500">Todavía no hay cierres.</p>}
      </div>

      {can('invoices.view') && (
        <div className={card}>
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-stone-200">📄 Facturas emitidas</h3>
            <button onClick={async () => setChain(await api('/api/invoices/verify'))} className="text-[10px] text-stone-300 underline">Comprobar integridad</button>
          </div>
          {chain && <p className={`text-[11px] ${chain.ok ? 'text-green-300' : 'text-red-300'}`}>{chain.ok ? `✅ ${chain.count} facturas encadenadas sin alteraciones.` : `❌ La cadena se rompe en ${chain.brokenAt}.`}</p>}
          <ul className="text-[11px] divide-y divide-stone-800 max-h-80 overflow-y-auto">
            {invoices.map(i => (
              <li key={i.id} className="py-1.5 flex flex-wrap items-center justify-between gap-2 text-stone-300">
                <span><strong className="font-mono text-stone-100">{i.number}</strong> · {TYPE[i.type]} · {fmt(i.issuedAt)}{i.customer ? ` · ${i.customer.name}` : ''}{i.rectifiedBy ? ` · rectificada (${i.rectifiedBy})` : ''}{i.replacedBy ? ` · sustituida (${i.replacedBy})` : ''}</span>
                <span className="flex items-center gap-2">
                  <span className="font-mono">{eur(i.totalCents)}</span>
                  <button onClick={() => reprint(i)} className="text-[10px] text-[#E6C687] underline">Imprimir</button>
                  {can('invoices.rectify') && i.type !== 'rectifying' && !i.rectifiedBy && !i.replacedBy && <button onClick={() => rectify(i)} className="text-[10px] text-red-300 underline">Rectificar</button>}
                </span>
              </li>
            ))}
          </ul>
          {invoices.length === 0 && <p className="text-[11px] text-stone-500">Todavía no hay facturas.</p>}
        </div>
      )}
    </div>
  );
};
