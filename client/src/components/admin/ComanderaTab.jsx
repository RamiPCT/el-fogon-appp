import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api';
import { formatPrice } from '../../utils/formatters';
import { useSocket } from '../../context/SocketContext';
import { useStaff } from '../../hooks/useStaff';
import { CheckPanel } from './CheckPanel';

const STATUS = {
  RECEIVED: ['Recibido', 'bg-stone-700 text-stone-100'],
  IN_PREP: ['En preparación', 'bg-amber-600 text-black'],
  READY: ['Listo', 'bg-green-600 text-black'],
  SERVED: ['Servido', 'bg-stone-800 text-stone-400'],
  CLOSED: ['Cerrado', 'bg-stone-900 text-stone-500']
};
const TABLE_COLOR = {
  AVAILABLE: 'border-green-800 bg-[#14281D]/60',
  OCCUPIED: 'border-red-800 bg-red-950/50',
  RESERVED_SOON: 'border-amber-700 bg-amber-950/40'
};

// Comandera del camarero: elegir mesa, tocar platos y enviarlos a cocina/barra.
// El pedido queda a nombre del empleado que lo toma (origen «pos»).
export const ComanderaTab = ({ tables, products, categories }) => {
  const { socket } = useSocket();
  const { can } = useStaff();
  const [checkVersion, setCheckVersion] = useState(0);
  const [table, setTable] = useState(null);
  const [cat, setCat] = useState(null);
  const [cart, setCart] = useState([]);       // { key, product, quantity, modifiers }
  const [notes, setNotes] = useState('');
  const [picking, setPicking] = useState(null); // producto con opciones abiertas
  const [choice, setChoice] = useState({});
  const [orders, setOrders] = useState([]);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState(null);

  const activeCats = useMemo(
    () => categories.filter(c => c.active !== false && products.some(p => p.categoryId === c.id && p.active !== false)),
    [categories, products]
  );
  useEffect(() => { if (!cat && activeCats[0]) setCat(activeCats[0].id); }, [activeCats, cat]);

  const loadOrders = (num) => api(`/api/tables/${encodeURIComponent(num)}/orders`).then(o => setOrders(Array.isArray(o) ? o : [])).catch(() => setOrders([]));
  useEffect(() => { if (table) loadOrders(table.number); }, [table]);

  // Estados de las comandas en tiempo real
  useEffect(() => {
    if (!socket || !table) return;
    const onAny = (o) => { if (o.tableNumber === table.number) loadOrders(table.number); };
    socket.on('order:new', onAny);
    socket.on('order:update', onAny);
    return () => { socket.off('order:new', onAny); socket.off('order:update', onAny); };
  }, [socket, table]);

  const sortedTables = [...tables].sort((a, b) => String(a.number).localeCompare(String(b.number), 'es', { numeric: true }));
  const total = cart.reduce((s, i) => s + Number(i.product.price) * i.quantity, 0);
  const count = cart.reduce((s, i) => s + i.quantity, 0);

  const addToCart = (product, modifiers = {}) => {
    const key = `${product.id}|${JSON.stringify(modifiers)}`;
    setCart(prev => prev.some(i => i.key === key)
      ? prev.map(i => (i.key === key ? { ...i, quantity: i.quantity + 1 } : i))
      : [...prev, { key, product, quantity: 1, modifiers }]);
    setPicking(null);
  };

  const tapProduct = (p) => {
    if (p.isAvailable === false) return;
    const mods = (p.modifiers || []).filter(m => m.options?.length);
    if (!mods.length) return addToCart(p);
    setPicking(p);
    setChoice(Object.fromEntries(mods.filter(m => m.required).map(m => [m.name, m.options[0]])));
  };

  const changeQty = (key, d) => setCart(prev => prev.map(i => (i.key === key ? { ...i, quantity: i.quantity + d } : i)).filter(i => i.quantity > 0));

  const send = async () => {
    if (!cart.length || sending) return;
    setSending(true);
    setMsg(null);
    try {
      const r = await api('/api/orders', {
        method: 'POST',
        body: {
          tableNumber: table.number,
          items: cart.map(i => ({ productId: i.product.id, quantity: i.quantity, modifiers: i.modifiers })),
          notes
        }
      });
      setMsg({ ok: true, text: `✅ Comanda #${r.order.orderNumber} enviada a la mesa ${table.number}.` });
      setCart([]);
      setNotes('');
      loadOrders(table.number);
      setCheckVersion(v => v + 1);
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setSending(false);
    }
  };

  // ---------- 1. Elegir mesa ----------
  if (!table) {
    return (
      <div className="bg-[#1A1A1A] border border-stone-800 rounded-2xl p-4 space-y-3 shadow-xl">
        <div className="pb-2 border-b border-stone-800">
          <h3 className="font-display text-sm font-bold text-[#C8A45D]">Comandera</h3>
          <p className="text-[10px] text-stone-400">Elige la mesa para tomar el pedido.</p>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {sortedTables.map(t => (
            <button
              key={t.id}
              onClick={() => { setTable(t); setCart([]); setMsg(null); }}
              className={`rounded-xl border-2 py-3 text-center active:scale-95 transition ${TABLE_COLOR[t.status] || TABLE_COLOR.AVAILABLE}`}
            >
              <span className="block font-display text-lg font-bold text-[#F4EFE6]">{t.number}</span>
              <span className="block text-[10px] text-stone-400">{t.status === 'OCCUPIED' ? 'Ocupada' : t.status === 'RESERVED_SOON' ? 'Reserva pronto' : 'Libre'} · {t.capacity} p.</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---------- 2. Tomar pedido ----------
  return (
    <div className="space-y-3 pb-28">
      <div className="bg-[#1A1A1A] border border-[#C8A45D]/50 rounded-2xl p-3 flex items-center justify-between shadow-xl">
        <button onClick={() => { if (!cart.length || window.confirm('Hay platos sin enviar. ¿Salir de la mesa?')) { setTable(null); setCart([]); } }} className="text-xs text-stone-300 underline">← Mesas</button>
        <h3 className="font-display text-base font-bold text-[#F4EFE6]">Mesa {table.number}</h3>
        <span className="text-[10px] text-stone-500">{table.capacity} p.</span>
      </div>

      {msg && <p className={`text-xs px-1 ${msg.ok ? 'text-green-300' : 'text-red-300'}`} role="status">{msg.text}</p>}

      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {activeCats.map(c => (
          <button key={c.id} onClick={() => setCat(c.id)} className={`shrink-0 px-3 py-1.5 rounded-full text-xs border ${cat === c.id ? 'bg-[#C8A45D] text-[#121212] border-[#C8A45D] font-bold' : 'border-stone-700 text-stone-300'}`}>
            {c.name}
          </button>
        ))}
      </div>

      <div className="bg-[#1A1A1A] border border-stone-800 rounded-2xl divide-y divide-stone-800 overflow-hidden">
        {products.filter(p => p.categoryId === cat && p.active !== false).map(p => (
          <div key={p.id}>
            <button
              onClick={() => tapProduct(p)}
              disabled={p.isAvailable === false}
              className="w-full flex items-center justify-between gap-2 px-3 py-3 text-left active:bg-[#121212] disabled:opacity-40"
            >
              <span className="text-sm text-[#F4EFE6]">{p.name}{p.isAvailable === false && ' · agotado'}</span>
              <span className="text-xs text-[#C8A45D] font-mono shrink-0">{formatPrice(p.price)}</span>
            </button>
            {picking?.id === p.id && (
              <div className="px-3 pb-3 space-y-2 bg-[#121212]">
                {(p.modifiers || []).filter(m => m.options?.length).map(m => (
                  <label key={m.name} className="block text-[11px] text-stone-400">{m.name}{m.required && ' *'}
                    <select
                      value={choice[m.name] || ''}
                      onChange={e => setChoice(prev => ({ ...prev, [m.name]: e.target.value }))}
                      className="mt-1 w-full bg-[#1A1A1A] border border-stone-700 rounded-lg px-2 py-1.5 text-xs text-stone-100"
                    >
                      {!m.required && <option value="">—</option>}
                      {m.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                ))}
                <div className="flex gap-2">
                  <button onClick={() => addToCart(p, Object.fromEntries(Object.entries(choice).filter(([, v]) => v)))} className="flex-1 py-2 rounded-lg bg-[#C8A45D] text-[#121212] text-xs font-bold">Añadir</button>
                  <button onClick={() => setPicking(null)} className="px-3 py-2 rounded-lg border border-stone-700 text-xs text-stone-300">Cancelar</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {orders.length > 0 && (
        <div className="bg-[#1A1A1A] border border-stone-800 rounded-2xl p-3 space-y-2">
          <p className="text-[11px] font-bold text-stone-300">Pedidos abiertos de la mesa</p>
          {orders.map(o => (
            <div key={o.id} className="text-xs text-stone-300 flex flex-wrap items-center gap-2">
              <span className="font-mono text-stone-500">#{o.orderNumber}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS[o.status]?.[1] || ''}`}>{STATUS[o.status]?.[0] || o.status}</span>
              <span className="flex-1 min-w-0 truncate">{o.items.map(i => `${i.quantity}× ${i.name}`).join(', ')}</span>
              <span className="text-[10px] text-stone-500">{o.origin === 'pos' ? `por ${o.createdBy?.name || 'personal'}` : 'desde QR'}</span>
            </div>
          ))}
        </div>
      )}

      {can('checks.view') && <CheckPanel key={`${table.number}-${checkVersion}`} tableNumber={table.number} />}

      {cart.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 p-3 bg-[#121212]/95 backdrop-blur border-t border-[#C8A45D]/40">
          <div className="max-w-4xl mx-auto space-y-2">
            <ul className="max-h-36 overflow-y-auto space-y-1">
              {cart.map(i => (
                <li key={i.key} className="flex items-center gap-2 text-xs text-stone-200">
                  <button onClick={() => changeQty(i.key, -1)} className="w-7 h-7 rounded-lg border border-stone-700" aria-label={`Quitar uno de ${i.product.name}`}>−</button>
                  <span className="w-5 text-center font-bold">{i.quantity}</span>
                  <button onClick={() => changeQty(i.key, 1)} className="w-7 h-7 rounded-lg border border-stone-700" aria-label={`Añadir uno de ${i.product.name}`}>+</button>
                  <span className="flex-1 min-w-0 truncate">{i.product.name}{Object.keys(i.modifiers).length > 0 && <span className="text-stone-500"> · {Object.values(i.modifiers).join(', ')}</span>}</span>
                </li>
              ))}
            </ul>
            <input value={notes} onChange={e => setNotes(e.target.value)} maxLength={200} placeholder="Nota para cocina (opcional)" className="w-full bg-[#1A1A1A] border border-stone-700 rounded-lg px-2 py-1.5 text-xs text-stone-100" />
            <button onClick={send} disabled={sending} className="w-full py-3 rounded-xl bg-[#C8A45D] text-[#121212] font-bold text-sm disabled:opacity-50">
              {sending ? 'Enviando…' : `Enviar a cocina · ${count} · ${formatPrice(total)}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
