import React, { useState, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';
import { playOrderChime, playCallChime, unlockAudio, isAudioLocked } from '../utils/sound';
import { api } from '../utils/api';
import { ReservationAlerts } from '../components/ReservationAlerts';
import { PRINT_STATUS } from '../components/admin/PrinterTest';
import { Printer, Clock, CheckCircle, ChefHat, Bell, RotateCcw, BellRing, Receipt, Volume2, Check } from 'lucide-react';

// Unidades anuladas de una línea (no hay que prepararlas)
const voidedQty = (item) => (item.adjustments || []).filter(a => a.type === 'void').reduce((t, a) => t + a.qty, 0);

export const KdsDisplay = () => {
  const { socket } = useSocket();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [calls, setCalls] = useState([]);
  const [audioLocked, setAudioLocked] = useState(isAudioLocked());
  const [, setTick] = useState(0);

  // Refresca los "hace X min" cada 30 s
  useEffect(() => {
    const iv = setInterval(() => setTick(x => x + 1), 30000);
    return () => clearInterval(iv);
  }, []);

  const fetchCalls = async () => {
    try { setCalls(await api('/api/calls')); } catch (_) { /* sin sesión */ }
  };

  const handleUnlock = async () => {
    const ok = await unlockAudio();
    setAudioLocked(!ok);
    if (ok) playOrderChime();
  };

  const ackCall = async (id) => {
    setCalls(prev => prev.filter(c => c.id !== id));
    try { await api(`/api/calls/${id}/ack`, { method: 'POST', body: {} }); } catch (_) { fetchCalls(); }
  };

  const fetchOrders = async () => {
    try {
      const data = await api('/api/orders');
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error al cargar órdenes KDS:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    fetchCalls();
    // Red de seguridad por si se pierde algún aviso en tiempo real
    const poll = setInterval(() => { if (document.visibilityState === 'visible') { fetchOrders(); fetchCalls(); } }, 20000);
    return () => clearInterval(poll);
  }, []);

  // Escuchar nuevas órdenes en tiempo real y emitir sonido de campanilla
  useEffect(() => {
    if (!socket) return;

    const onNew = (newOrder) => {
      setOrders(prev => [newOrder, ...prev.filter(o => o.id !== newOrder.id)]);
      playOrderChime();
    };
    const onUpdate = (updated) => {
      setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
    };
    // Si la tablet pierde la conexión y vuelve, recargar para no perder comandas
    const onConnect = () => { fetchOrders(); fetchCalls(); };
    const onCall = (call) => {
      setCalls(prev => [...prev.filter(c => c.id !== call.id), call]);
      playCallChime();
    };
    const onCallResolved = (call) => setCalls(prev => prev.filter(c => c.id !== call.id));

    socket.on('order:new', onNew);
    socket.on('order:update', onUpdate);
    socket.on('connect', onConnect);
    socket.on('call:new', onCall);
    socket.on('call:resolved', onCallResolved);

    return () => {
      socket.off('order:new', onNew);
      socket.off('order:update', onUpdate);
      socket.off('connect', onConnect);
      socket.off('call:new', onCall);
      socket.off('call:resolved', onCallResolved);
    };
  }, [socket]);

  const handleUpdateStatus = async (orderId, newStatus) => {
    try {
      const data = await api(`/api/orders/${orderId}/status`, { method: 'PATCH', body: { status: newStatus } });
      setOrders(prev => prev.map(o => o.id === orderId ? data : o));
    } catch (err) {
      alert(`No se pudo actualizar la comanda: ${err.message}`);
    }
  };

  const handleReprint = async (orderId) => {
    try {
      const job = await api(`/api/printer/reprint/${orderId}`, { method: 'POST', body: {} });
      alert(`🖨️ Ticket #${job.orderNumber}: ${PRINT_STATUS[job.status] || job.status}`);
    } catch (err) {
      alert(`Error al reimprimir: ${err.message}`);
    }
  };

  const getTimeElapsed = (createdAt) => {
    const diffMin = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
    if (diffMin <= 0) return 'Ahora mismo';
    return `Hace ${diffMin} min`;
  };

  const receivedOrders = orders.filter(o => o.status === 'RECEIVED');
  const inPrepOrders = orders.filter(o => o.status === 'IN_PREP');
  const readyOrders = orders.filter(o => o.status === 'READY');

  return (
    <div className="max-w-7xl mx-auto px-4 py-4 space-y-4">
      
      {/* Barra Superior KDS */}
      <div className="bg-[#1A1A1A] border border-[#5A1826]/80 rounded-2xl p-4 flex flex-wrap justify-between items-center gap-3 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#5A1826] border border-red-700 flex items-center justify-center text-white">
            <ChefHat className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-bold text-[#F4EFE6]">
              Pantalla KDS • Barra de Coctelería & Cocina
            </h2>
            <p className="text-xs text-stone-400">
              Comandas en directo desde las mesas (QR) e impresión de tickets.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleUnlock}
            className="px-3 py-1.5 bg-[#121212] hover:bg-stone-800 border border-stone-700 text-stone-300 text-xs rounded-xl flex items-center gap-1.5 transition"
            title="Probar sonido de campanilla"
          >
            <Bell className="w-3.5 h-3.5 text-amber-400" />
            <span>{audioLocked ? 'Activar sonido' : 'Probar timbre'}</span>
          </button>
          
          <button
            onClick={fetchOrders}
            className="px-3 py-1.5 bg-[#121212] hover:bg-stone-800 border border-stone-700 text-stone-300 text-xs rounded-xl flex items-center gap-1.5 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Refrescar</span>
          </button>
        </div>
      </div>

      {/* Activar sonido (obligatorio en tablets: el navegador no deja sonar sin un toque) */}
      {audioLocked && (
        <button
          onClick={handleUnlock}
          className="w-full py-3 rounded-2xl bg-amber-500 text-black font-bold text-sm flex items-center justify-center gap-2 animate-pulse"
        >
          <Volume2 className="w-5 h-5" /> Toca aquí para activar el sonido de las comandas
        </button>
      )}

      {/* Reservas nuevas desde la web */}
      <ReservationAlerts />

      {/* Avisos de las mesas */}
      {calls.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {calls.map(c => {
            const isBill = c.type === 'bill';
            const Icon = isBill ? Receipt : BellRing;
            return (
              <div key={c.id} className={`rounded-2xl p-3 flex items-center gap-3 border-2 shadow-xl fogon-pop ${isBill ? 'bg-[#14281D] border-[#C8A45D]' : 'bg-[#5A1826] border-red-500'}`}>
                <Icon className={`w-7 h-7 shrink-0 ${isBill ? 'text-[#C8A45D]' : 'text-white animate-bounce'}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-display text-lg font-bold text-white leading-tight">Mesa {c.tableNumber}</p>
                  <p className="text-xs text-stone-200">{isBill ? 'Pide la cuenta' : 'Llama al camarero'} · {getTimeElapsed(c.createdAt)}</p>
                </div>
                <button onClick={() => ackCall(c.id)} className="px-3 py-2 rounded-xl bg-white text-black text-xs font-bold flex items-center gap-1 active:scale-95">
                  <Check className="w-4 h-4" /> Atendido
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Columnas Kanban */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        
        {/* COLUMNA 1: NUEVAS COMANDAS (FONDO BORGOÑA / ALERTA) */}
        <div className="space-y-3">
          <div className="bg-[#5A1826]/30 border border-[#5A1826] rounded-xl p-3 flex justify-between items-center">
            <span className="font-display text-xs font-bold text-red-200 uppercase tracking-wider flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></span>
              Nuevas Comandas ({receivedOrders.length})
            </span>
          </div>

          <div className="space-y-3">
            {receivedOrders.length === 0 ? (
              <p className="text-xs text-stone-500 text-center py-8">No hay nuevas comandas pendientes.</p>
            ) : (
              receivedOrders.map(order => (
                <div key={order.id} className="bg-[#1A1A1A] border-2 border-[#5A1826] rounded-2xl p-4 shadow-xl space-y-3 animate-in fade-in">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-xs font-mono text-[#C8A45D]">Comanda #{order.orderNumber}</span>
                      <h3 className="font-display text-lg font-bold text-[#F4EFE6]">Mesa #{order.tableNumber}</h3>
                    </div>
                    <span className="text-[11px] font-mono text-stone-400 bg-[#121212] px-2 py-0.5 rounded-md border border-stone-800">
                      {getTimeElapsed(order.createdAt)}
                    </span>
                  </div>

                  {/* Ítems */}
                  <div className="divide-y divide-stone-800 text-xs">
                    {order.items.map((item, idx) => (
                      <div key={idx} className="py-1.5 space-y-0.5">
                        <div className="flex justify-between font-semibold text-stone-200">
                          <span className={voidedQty(item) >= item.quantity ? 'line-through opacity-50' : ''}>{item.quantity}x {item.name}{voidedQty(item) > 0 && <span className="ml-1 text-red-400 text-xs font-bold">(anulado {voidedQty(item)})</span>}</span>
                        </div>
                        {item.modifiers && Object.entries(item.modifiers).map(([k, v]) => (
                          <p key={k} className="text-[10px] text-amber-300 pl-3">↳ {k}: {v}</p>
                        ))}
                        {item.notes && <p className="text-[10px] text-red-300 pl-3">↳ NOTA: {item.notes}</p>}
                      </div>
                    ))}
                  </div>

                  {order.notes && (
                    <div className="p-2 bg-[#121212] rounded-lg border border-red-900/60 text-[11px] text-red-200">
                      <strong>Nota general:</strong> {order.notes}
                    </div>
                  )}

                  {/* Botones de Acción */}
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-stone-800">
                    <button
                      onClick={() => handleReprint(order.id)}
                      className="py-2 bg-[#121212] hover:bg-stone-800 border border-stone-700 text-stone-300 text-xs rounded-xl flex items-center justify-center gap-1.5 transition"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Reimprimir</span>
                    </button>
                    <button
                      onClick={() => handleUpdateStatus(order.id, 'IN_PREP')}
                      className="py-2 bg-[#5A1826] hover:bg-red-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition shadow-lg"
                    >
                      <ChefHat className="w-3.5 h-3.5" />
                      <span>Preparar</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* COLUMNA 2: EN PREPARACIÓN */}
        <div className="space-y-3">
          <div className="bg-[#1A1A1A] border border-amber-500/40 rounded-xl p-3 flex justify-between items-center">
            <span className="font-display text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
              En Preparación ({inPrepOrders.length})
            </span>
          </div>

          <div className="space-y-3">
            {inPrepOrders.length === 0 ? (
              <p className="text-xs text-stone-500 text-center py-8">No hay pedidos en preparación.</p>
            ) : (
              inPrepOrders.map(order => (
                <div key={order.id} className="bg-[#1A1A1A] border border-amber-600/60 rounded-2xl p-4 shadow-xl space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-xs font-mono text-[#C8A45D]">Comanda #{order.orderNumber}</span>
                      <h3 className="font-display text-lg font-bold text-[#F4EFE6]">Mesa #{order.tableNumber}</h3>
                    </div>
                    <span className="text-[11px] font-mono text-stone-400 bg-[#121212] px-2 py-0.5 rounded-md border border-stone-800">
                      {getTimeElapsed(order.createdAt)}
                    </span>
                  </div>

                  <div className="divide-y divide-stone-800 text-xs">
                    {order.items.map((item, idx) => (
                      <div key={idx} className="py-1 text-stone-200 space-y-0.5">
                        <span className={voidedQty(item) >= item.quantity ? 'line-through opacity-50' : ''}>{item.quantity}x {item.name}{voidedQty(item) > 0 && <span className="ml-1 text-red-400 text-xs font-bold">(anulado {voidedQty(item)})</span>}</span>
                        {item.modifiers && Object.entries(item.modifiers).map(([k, v]) => (
                          <p key={k} className="text-[10px] text-amber-300 pl-3">↳ {k}: {v}</p>
                        ))}
                        {item.notes && <p className="text-[10px] text-red-300 pl-3">↳ NOTA: {item.notes}</p>}
                      </div>
                    ))}
                  </div>
                  {order.notes && (
                    <div className="p-2 bg-[#121212] rounded-lg border border-red-900/60 text-[11px] text-red-200">
                      <strong>Nota general:</strong> {order.notes}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-stone-800">
                    <button
                      onClick={() => handleReprint(order.id)}
                      className="py-2 bg-[#121212] hover:bg-stone-800 border border-stone-700 text-stone-300 text-xs rounded-xl flex items-center justify-center gap-1.5 transition"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Reimprimir</span>
                    </button>
                    <button
                      onClick={() => handleUpdateStatus(order.id, 'READY')}
                      className="py-2 bg-[#C8A45D] hover:bg-amber-400 text-[#121212] font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition shadow-lg"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span>Listo</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* COLUMNA 3: LISTAS PARA SERVIR */}
        <div className="space-y-3">
          <div className="bg-[#14281D] border border-green-700/60 rounded-xl p-3 flex justify-between items-center">
            <span className="font-display text-xs font-bold text-green-300 uppercase tracking-wider flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500"></span>
              Listas para Servir ({readyOrders.length})
            </span>
          </div>

          <div className="space-y-3">
            {readyOrders.length === 0 ? (
              <p className="text-xs text-stone-500 text-center py-8">No hay comandas listas esperando entrega.</p>
            ) : (
              readyOrders.map(order => (
                <div key={order.id} className="bg-[#1A1A1A] border border-green-600 rounded-2xl p-4 shadow-xl space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-xs font-mono text-[#C8A45D]">Comanda #{order.orderNumber}</span>
                      <h3 className="font-display text-lg font-bold text-green-300">Mesa #{order.tableNumber}</h3>
                    </div>
                    <span className="text-[11px] font-mono text-green-400 bg-[#14281D] px-2 py-0.5 rounded-md border border-green-700">
                      ¡Listo!
                    </span>
                  </div>

                  <button
                    onClick={() => handleUpdateStatus(order.id, 'SERVED')}
                    className="w-full py-2.5 bg-green-600 hover:bg-green-500 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition shadow-lg"
                  >
                    <CheckCircle className="w-4 h-4" />
                    <span>Marcar como Servido en Mesa</span>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
