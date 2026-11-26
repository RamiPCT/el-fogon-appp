import React, { useCallback, useEffect, useState } from 'react';
import { BellRing, Receipt, Check } from 'lucide-react';
import { useSocket } from '../context/SocketContext';
import { api } from '../utils/api';
import { playCallChime } from '../utils/sound';

// Avisos de las mesas («Llamar al camarero» / «Pedir la cuenta») para el personal de sala.
// Se ven en cualquier móvil o tablet del personal con el panel abierto, en tiempo real.
export const CallAlerts = () => {
  const { socket } = useSocket();
  const [calls, setCalls] = useState([]);

  const fetchCalls = useCallback(async () => {
    try { setCalls(await api('/api/calls')); } catch (_) { /* sin permiso o sin conexión */ }
  }, []);

  useEffect(() => { fetchCalls(); }, [fetchCalls]);

  useEffect(() => {
    if (!socket) return;
    const onCall = (call) => {
      setCalls(prev => [...prev.filter(c => c.id !== call.id), call]);
      playCallChime();
    };
    const onResolved = (call) => setCalls(prev => prev.filter(c => c.id !== call.id));
    socket.on('call:new', onCall);
    socket.on('call:resolved', onResolved);
    socket.on('connect', fetchCalls);
    return () => {
      socket.off('call:new', onCall);
      socket.off('call:resolved', onResolved);
      socket.off('connect', fetchCalls);
    };
  }, [socket, fetchCalls]);

  const ack = async (id) => {
    setCalls(prev => prev.filter(c => c.id !== id));
    try { await api(`/api/calls/${id}/ack`, { method: 'POST', body: {} }); } catch (_) { fetchCalls(); }
  };

  if (!calls.length) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="status" aria-live="assertive">
      {calls.map(c => {
        const bill = c.type === 'bill';
        const Icon = bill ? Receipt : BellRing;
        return (
          <div key={c.id} className={`fogon-pop rounded-2xl p-3 border-2 shadow-xl flex items-center gap-3 ${bill ? 'bg-amber-950/80 border-amber-500' : 'bg-[#5A1826]/80 border-red-400'}`}>
            <Icon className="w-6 h-6 text-white shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="font-display text-base font-bold text-white leading-tight">Mesa {c.tableNumber}</p>
              <p className="text-xs text-stone-100">{bill ? 'Pide la cuenta' : 'Llama al camarero'}</p>
            </div>
            <button onClick={() => ack(c.id)} className="min-h-[44px] px-3 rounded-xl bg-white text-black text-xs font-bold flex items-center gap-1 active:scale-95 shrink-0">
              <Check className="w-4 h-4" /> Voy
            </button>
          </div>
        );
      })}
    </div>
  );
};
