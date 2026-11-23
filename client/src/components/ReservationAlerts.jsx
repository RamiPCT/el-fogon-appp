import React, { useEffect, useState } from 'react';
import { CalendarDays, Check, Phone } from 'lucide-react';
import { useSocket } from '../context/SocketContext';
import { api, storage } from '../utils/api';
import { prettyDate, todayStr } from '../utils/time';
import { playReservationChime } from '../utils/sound';

// Avisos de reservas hechas desde la web, para el personal (KDS y Admin).
// Así el local se entera aunque el cliente no llegue a enviar el WhatsApp.
const SEEN_KEY = 'fogon_seen_reservations';
const getSeen = () => { try { return new Set(JSON.parse(storage.get(SEEN_KEY) || '[]')); } catch (_) { return new Set(); } };
const addSeen = (id) => {
  const seen = [...getSeen(), id].slice(-300);
  storage.set(SEEN_KEY, JSON.stringify(seen));
};

const isRecentWeb = (r) =>
  r && r.source === 'web' && r.status === 'CONFIRMED' &&
  Date.now() - new Date(r.createdAt).getTime() < 12 * 60 * 60 * 1000;

export const ReservationAlerts = ({ compact = false }) => {
  const { socket } = useSocket();
  const [alerts, setAlerts] = useState([]);

  // Al abrir: reservas web de las últimas 12 h que nadie ha marcado como vistas
  useEffect(() => {
    api('/api/reservations')
      .then(list => {
        const seen = getSeen();
        const pending = (list || []).filter(r => isRecentWeb(r) && !seen.has(r.id));
        if (pending.length) setAlerts(pending.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onNew = (r) => {
      if (r.source !== 'web') return;
      setAlerts(prev => [r, ...prev.filter(x => x.id !== r.id)]);
      playReservationChime();
    };
    const onCancel = (r) => setAlerts(prev => prev.filter(x => x.id !== r.id));
    socket.on('reservation:new', onNew);
    socket.on('reservation:cancelled', onCancel);
    return () => {
      socket.off('reservation:new', onNew);
      socket.off('reservation:cancelled', onCancel);
    };
  }, [socket]);

  const dismiss = (id) => {
    addSeen(id);
    setAlerts(prev => prev.filter(x => x.id !== id));
  };

  if (!alerts.length) return null;
  const today = todayStr();

  return (
    <div className={`grid gap-2 ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`} role="status" aria-live="polite">
      {alerts.slice(0, 6).map(r => (
        <div key={r.id} className="fogon-pop rounded-2xl p-3 bg-gradient-to-br from-[#14281D] to-[#0f1a14] border-2 border-[#C8A45D] shadow-xl flex items-start gap-3">
          <CalendarDays className="w-6 h-6 text-[#C8A45D] shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 text-xs">
            <p className="font-display text-sm font-bold text-[#F4EFE6]">Nueva reserva web · Mesa {r.tableNumber}</p>
            <p className="text-[#E6C687] font-semibold mt-0.5">
              {r.date === today ? 'HOY' : prettyDate(r.date)} · {r.startTime} h · {r.guests} pers.
            </p>
            <p className="text-stone-300 truncate">{r.customerName}{r.notes ? ` · “${r.notes}”` : ''}</p>
            {r.customerPhone && (
              <a href={`tel:${String(r.customerPhone).replace(/\s/g, '')}`} className="inline-flex items-center gap-1 text-stone-300 underline mt-0.5">
                <Phone className="w-3 h-3" />{r.customerPhone}
              </a>
            )}
          </div>
          <button onClick={() => dismiss(r.id)} className="px-2.5 py-1.5 rounded-lg bg-white text-black text-[11px] font-bold flex items-center gap-1 active:scale-95 shrink-0">
            <Check className="w-3.5 h-3.5" /> Visto
          </button>
        </div>
      ))}
    </div>
  );
};
