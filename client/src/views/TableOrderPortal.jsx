import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MenuCatalog } from '../components/MenuCatalog';
import { CartDrawer } from '../components/CartDrawer';
import { GoogleReviewBooster } from '../components/GoogleReviewBooster';
import { AuraHero } from '../components/Embers';
import { useSocket } from '../context/SocketContext';
import { useSettings } from '../context/SettingsContext';
import { useI18n } from '../i18n';
import { api } from '../utils/api';
import { getTableKey, tableKeyHeaders } from '../utils/tableKey';
import { formatPrice } from '../utils/formatters';
import { BellRing, Receipt, Clock, ChefHat, CircleCheck, GlassWater, AlertTriangle, ChevronDown, Check } from 'lucide-react';

const STEPS = ['RECEIVED', 'IN_PREP', 'READY', 'SERVED'];
const STEP_ICONS = { RECEIVED: Clock, IN_PREP: ChefHat, READY: CircleCheck, SERVED: GlassWater };

// Seguimiento visual de una comanda
const OrderTracker = ({ order, productName }) => {
  const { t } = useI18n();
  const idx = Math.max(0, STEPS.indexOf(order.status));
  return (
    <div className="bg-[#1A1A1A] rounded-2xl border border-stone-800 p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-[#C8A45D]">#{order.orderNumber}</span>
        <span className="text-[11px] font-semibold text-stone-300">{t(`ostatus.${order.status}`)}</span>
      </div>
      <div className="flex items-center" aria-label={t(`ostatus.${order.status}`)}>
        {STEPS.map((s, i) => {
          const Icon = STEP_ICONS[s];
          const done = i <= idx;
          const current = i === idx && order.status !== 'SERVED';
          return (
            <React.Fragment key={s}>
              <span className={`w-7 h-7 rounded-full flex items-center justify-center border shrink-0 transition ${done ? 'bg-[#C8A45D] border-[#E6C687] text-[#121212]' : 'bg-[#121212] border-stone-700 text-stone-600'} ${current ? 'fogon-pulse-ring' : ''}`}>
                <Icon className="w-3.5 h-3.5" />
              </span>
              {i < STEPS.length - 1 && <span className={`flex-1 h-0.5 mx-1 rounded ${i < idx ? 'bg-[#C8A45D]' : 'bg-stone-800'}`} />}
            </React.Fragment>
          );
        })}
      </div>
      <ul className="text-[11px] text-stone-400 space-y-0.5">
        {order.items?.map((it, i) => (
          <li key={i} className="flex justify-between gap-2">
            <span className="truncate">{it.quantity}× {productName(it)}</span>
            <span className="font-mono shrink-0">{formatPrice((it.price || 0) * (it.quantity || 1))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export const TableOrderPortal = ({ tableNumber, onSelectTableNumber }) => {
  const { socket } = useSocket();
  const settings = useSettings();
  const { t, tf } = useI18n();
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [cartNotice, setCartNotice] = useState('');
  const [lastOrder, setLastOrder] = useState(null);
  const [orders, setOrders] = useState([]);
  const [showAllOrders, setShowAllOrders] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sendError, setSendError] = useState('');
  const [showBooster, setShowBooster] = useState(false);
  const [tablesList, setTablesList] = useState([]);
  const [tableInfo, setTableInfo] = useState(null);
  const [calls, setCalls] = useState({}); // { waiter: 'sent' | 'ack', bill: ... }
  const [callMsg, setCallMsg] = useState('');
  const tableRef = useRef(tableNumber);
  tableRef.current = tableNumber;

  // ---------- Carga inicial ----------
  useEffect(() => {
    fetch('/api/tables').then(r => r.json()).then(setTablesList).catch(() => {});
    fetch('/api/menu').then(r => r.json()).then(d => {
      setCategories(d.categories || []);
      setProducts(d.products || []);
    }).catch(() => {});
  }, []);

  // Si la mesa de la URL no existe, volver al selector
  useEffect(() => {
    if (tableNumber && tablesList.length > 0 && !tablesList.some(tb => tb.number === tableNumber)) onSelectTableNumber(null);
  }, [tableNumber, tablesList]);

  const loadTable = useCallback((tbl) => {
    if (!tbl) return;
    fetch(`/api/tables/${encodeURIComponent(tbl)}/orders`, { headers: tableKeyHeaders(tbl) }).then(r => (r.ok ? r.json() : [])).then(o => setOrders(Array.isArray(o) ? o : [])).catch(() => {});
    fetch(`/api/tables/${encodeURIComponent(tbl)}`).then(r => (r.ok ? r.json() : null)).then(setTableInfo).catch(() => {});
  }, []);

  useEffect(() => {
    setShowBooster(false);
    setSendError('');
    setCalls({});
    setOrders([]);
    setTableInfo(null);
    if (tableNumber) loadTable(tableNumber);
  }, [tableNumber, loadTable]);

  // ---------- Tiempo real ----------
  useEffect(() => {
    if (!socket) return;
    const join = () => { if (tableRef.current) { socket.emit('table:join', tableRef.current, getTableKey(tableRef.current)); loadTable(tableRef.current); } };
    join();
    const mine = (o) => o.tableNumber === tableRef.current;
    const onNew = (o) => { if (mine(o)) setOrders(prev => [o, ...prev.filter(x => x.id !== o.id)]); };
    const onUpdate = (o) => {
      if (!mine(o)) return;
      setOrders(prev => (o.status === 'CLOSED' ? prev.filter(x => x.id !== o.id) : prev.map(x => (x.id === o.id ? o : x))));
    };
    const onMenu = (d) => { setCategories(d.categories || []); setProducts(d.products || []); };
    const onTable = (tb) => {
      if (tb.number === tableRef.current) setTableInfo(tb);
      setTablesList(prev => prev.map(x => (x.id === tb.id ? tb : x)));
    };
    const onLayout = (all) => {
      setTablesList(all);
      const mineTb = all.find(x => x.number === tableRef.current);
      if (mineTb) setTableInfo(mineTb);
    };
    const onCallResolved = (c) => {
      if (c.tableNumber !== tableRef.current) return;
      setCalls(prev => ({ ...prev, [c.type]: 'ack' }));
      setCallMsg(t('call.onTheWay'));
      setTimeout(() => setCalls(prev => ({ ...prev, [c.type]: undefined })), 8000);
    };
    socket.on('connect', join);
    socket.on('order:new', onNew);
    socket.on('order:update', onUpdate);
    socket.on('menu:update', onMenu);
    socket.on('table:status_update', onTable);
    socket.on('table:layout_update', onLayout);
    socket.on('call:resolved', onCallResolved);
    return () => {
      socket.off('connect', join);
      socket.off('order:new', onNew);
      socket.off('order:update', onUpdate);
      socket.off('menu:update', onMenu);
      socket.off('table:status_update', onTable);
      socket.off('table:layout_update', onLayout);
      socket.off('call:resolved', onCallResolved);
    };
  }, [socket, loadTable, t]);

  // Si cambia la carta (precio o agotado) mientras hay cosas en el carrito, se actualiza
  useEffect(() => {
    if (!cart.length || !products.length) return;
    const removed = [];
    let changed = false;
    const next = cart.filter(item => {
      const p = products.find(x => x.id === item.id);
      if (!p || p.isAvailable === false) { removed.push(tf(item, 'name')); return false; }
      return true;
    }).map(item => {
      const p = products.find(x => x.id === item.id);
      if (p.price !== item.price) { changed = true; return { ...item, price: p.price }; }
      return item;
    });
    if (removed.length || changed) {
      setCart(next);
      setCartNotice(removed.length ? t('cart.removedSoldOut', { name: removed.join(', ') }) : t('cart.priceUpdated'));
      setTimeout(() => setCartNotice(''), 6000);
    }
  }, [products]);

  // ---------- Carrito ----------
  const keyOf = (i) => `${i.id}|${JSON.stringify(i.selectedModifiers || {})}|${i.itemNotes || ''}`;
  const handleAddToCart = (item) => {
    setCart(prev => {
      const k = keyOf(item);
      const idx = prev.findIndex(x => keyOf(x) === k);
      if (idx !== -1) return prev.map((x, i) => (i === idx ? { ...x, quantity: Math.min(50, x.quantity + item.quantity) } : x));
      return [...prev, item];
    });
  };
  const handleUpdateQuantity = (index, delta) => {
    setCart(prev => prev.map((x, i) => (i === index ? { ...x, quantity: x.quantity + delta } : x)).filter(x => x.quantity > 0));
  };

  const handleSendOrder = async (cartItems, notes) => {
    if (!tableNumber) { setSendError(t('order.chooseFirst')); return false; }
    setIsSubmitting(true);
    setSendError('');
    try {
      const data = await api('/api/orders', {
        method: 'POST',
        headers: tableKeyHeaders(tableNumber),
        body: {
          tableNumber,
          items: cartItems.map(i => ({ productId: i.id, name: i.name, quantity: i.quantity, modifiers: i.selectedModifiers, notes: i.itemNotes || '' })),
          notes
        }
      });
      setLastOrder(data.order);
      setOrders(prev => [data.order, ...prev.filter(o => o.id !== data.order.id)]);
      setCart([]);
      setShowBooster(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return true;
    } catch (err) {
      setSendError(`${t('order.error')}: ${err.message}`);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---------- Llamadas al personal ----------
  const callStaff = async (type) => {
    setCallMsg('');
    try {
      await api(`/api/tables/${encodeURIComponent(tableNumber)}/call`, { method: 'POST', body: { type }, headers: tableKeyHeaders(tableNumber) });
      setCalls(prev => ({ ...prev, [type]: 'sent' }));
      setCallMsg(type === 'bill' ? t('call.billSent') : t('call.waiterSent'));
    } catch (err) {
      if (err.status === 429) {
        setCalls(prev => ({ ...prev, [type]: 'sent' }));
        setCallMsg(err.message);
      } else setCallMsg(err.message);
    }
  };

  const productName = (item) => tf(products.find(p => p.id === item.productId || p.name === item.name) || item, 'name') || item.name;
  const total = orders.reduce((s, o) => s + (o.total || 0), 0);
  const activeOrders = orders.filter(o => o.status !== 'SERVED');
  const visibleOrders = showAllOrders ? orders : (activeOrders.length ? activeOrders : orders.slice(0, 1));
  const res = tableInfo?.nextReservation;

  return (
    <div className="pb-32">
      {/* ================= CABECERA ================= */}
      <AuraHero embers={14}>
        {tableNumber ? (
          <div className="max-w-md mx-auto px-5 pt-5 pb-6 text-center">
            <span className="fogon-fade-up text-[10px] tracking-[0.3em] uppercase text-[#C8A45D]/90 font-semibold">{t('order.welcome')}</span>
            <div className="fogon-fade-up mt-3 mx-auto w-24 h-24 rounded-full p-[2px] bg-gradient-to-b from-[#E6C687] via-[#C8A45D] to-[#6b5428] shadow-[0_0_40px_rgba(200,164,93,0.25)]" style={{ animationDelay: '0.1s' }}>
              <div className="w-full h-full rounded-full bg-[radial-gradient(circle_at_50%_30%,#1c3a29,#0f1a14)] flex flex-col items-center justify-center">
                <span className="text-[9px] uppercase tracking-[0.25em] text-[#C8A45D]">{t('order.tableWord')}</span>
                <span className="font-display text-3xl font-bold text-[#F4EFE6] leading-none">{tableNumber}</span>
              </div>
            </div>
            <p className="fogon-fade-up font-script text-[#E6C687] text-2xl mt-3" style={{ animationDelay: '0.2s' }}>{t('order.heroScript')}</p>
            <p className="text-[11px] text-stone-400 mt-1 max-w-xs mx-auto">{t('order.heroSub')}</p>
            <button onClick={() => onSelectTableNumber(null)} className="mt-2 text-[10px] text-stone-500 underline">{t('order.change')}</button>
          </div>
        ) : (
          <div className="max-w-md mx-auto px-5 pt-6 pb-6 text-center">
            <span className="text-[10px] tracking-[0.3em] uppercase text-[#C8A45D]/90 font-semibold">El Fogón</span>
            <h1 className="font-script text-[#E6C687] text-4xl mt-1">{t('menu.title')}</h1>
            <div className="mt-4 bg-black/40 border border-[#C8A45D]/30 rounded-2xl p-3.5 text-left">
              <p className="text-xs font-bold text-[#F4EFE6]">{t('order.whichTable')}</p>
              <p className="text-[11px] text-stone-400 mt-0.5">{t('order.whichTableText')}</p>
              <div className="grid grid-cols-5 gap-1.5 mt-3">
                {tablesList.map(tb => (
                  <button
                    key={tb.id}
                    onClick={() => onSelectTableNumber(tb.number)}
                    className="py-2.5 bg-[#121212] border border-stone-700 active:border-[#C8A45D] text-stone-200 font-display font-bold text-xs rounded-xl active:scale-95 transition"
                  >
                    {tb.number}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </AuraHero>

      <div className="max-w-md mx-auto px-3.5 pt-4 space-y-3.5">
        {/* Aviso de reserva en esta mesa */}
        {tableNumber && res && (
          <div className={`flex items-start gap-2.5 rounded-2xl px-3.5 py-3 border text-xs fogon-pop ${res.soon ? 'bg-amber-950/60 border-amber-500 text-amber-100' : 'bg-amber-950/30 border-amber-800/60 text-amber-200'}`} role="status">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p>{t('order.reservedBanner', { r: res.startTime, t: res.bufferLimitTime })}</p>
          </div>
        )}

        {/* Acciones rápidas */}
        {tableNumber && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              {[['waiter', BellRing, t('call.waiter')], ['bill', Receipt, t('call.bill')]].map(([type, Icon, label]) => {
                const state = calls[type];
                return (
                  <button
                    key={type}
                    onClick={() => callStaff(type)}
                    disabled={state === 'sent'}
                    className={`py-3 rounded-2xl border text-xs font-bold flex items-center justify-center gap-2 transition active:scale-95 ${
                      state === 'sent' ? 'bg-[#14281D] border-green-700 text-green-300' :
                      state === 'ack' ? 'bg-[#14281D] border-[#C8A45D] text-[#E6C687]' :
                      'bg-[#1A1A1A] border-stone-700 text-stone-200'
                    }`}
                  >
                    {state ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4 text-[#C8A45D]" />}
                    {state === 'sent' ? t('call.sent') : label}
                  </button>
                );
              })}
            </div>
            {callMsg && <p className="text-[11px] text-center text-stone-400" aria-live="polite">{callMsg}</p>}
          </div>
        )}

        {/* Confirmación del pedido */}
        {showBooster && lastOrder && (
          <GoogleReviewBooster tableNumber={tableNumber} orderNumber={lastOrder.orderNumber} googleReviewUrl={settings.googleReviewUrl} onClose={() => setShowBooster(false)} />
        )}

        {/* Pedidos de la mesa */}
        {tableNumber && orders.length > 0 && (
          <section className="space-y-2" aria-label={t('order.tableOrders')}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-bold text-[#F4EFE6] flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />{t('order.tableOrders')}
              </h2>
              <span className="font-mono text-xs text-[#C8A45D] font-bold">{t('order.total')}: {formatPrice(total)}</span>
            </div>
            {visibleOrders.map(o => <OrderTracker key={o.id} order={o} productName={productName} />)}
            {orders.length > visibleOrders.length || showAllOrders ? (
              <button onClick={() => setShowAllOrders(v => !v)} className="w-full text-[11px] text-stone-400 flex items-center justify-center gap-1 py-1">
                {showAllOrders ? t('order.showLess') : t('order.showAll', { n: orders.length })}
                <ChevronDown className={`w-3.5 h-3.5 transition ${showAllOrders ? 'rotate-180' : ''}`} />
              </button>
            ) : null}
          </section>
        )}

        {sendError && <p className="text-xs text-red-300 bg-red-950/40 border border-red-900/60 rounded-xl p-3" role="alert">{sendError}</p>}
        {cartNotice && <p className="text-xs text-amber-200 bg-amber-950/40 border border-amber-800/60 rounded-xl p-3" role="status">{cartNotice}</p>}

        <MenuCatalog categories={categories} products={products} canOrder={!!tableNumber} onAddToCart={handleAddToCart} />
      </div>

      <CartDrawer cart={cart} tableNumber={tableNumber || '—'} onUpdateQuantity={handleUpdateQuantity} onSendOrder={handleSendOrder} isSubmitting={isSubmitting} />
    </div>
  );
};
