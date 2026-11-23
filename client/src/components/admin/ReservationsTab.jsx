import React, { useState } from 'react';
import { MessageSquare, Trash2 } from 'lucide-react';
import { todayStr, prettyDate } from '../../utils/time';

// Pestaña "Reservas" del panel del dueño
export const ReservationsTab = ({ reservations, onCancel }) => {
  const [showPastReservations, setShowPastReservations] = useState(false);
  const handleCancelReservation = onCancel;

  const today = todayStr();
  const list = reservations
    .filter(r => showPastReservations || ((r.date || today) >= today && r.status === 'CONFIRMED'))
    .sort((a, b) => `${a.date || ''} ${a.startTime || ''}`.localeCompare(`${b.date || ''} ${b.startTime || ''}`));
  return (
    <div className="bg-[#1A1A1A] border border-stone-800 rounded-2xl p-3.5 space-y-3 shadow-xl">
      <div className="flex flex-wrap justify-between items-center gap-2 pb-2 border-b border-stone-800">
        <h3 className="font-display text-sm font-bold text-[#C8A45D]">
          {showPastReservations ? 'Todas las reservas' : 'Próximas reservas'}
        </h3>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-stone-400">{list.length}</span>
          <button
            onClick={() => setShowPastReservations(v => !v)}
            className="px-2.5 py-1 rounded-lg bg-[#121212] border border-stone-700 text-stone-300 hover:text-white"
          >
            {showPastReservations ? 'Ver solo próximas' : 'Ver historial'}
          </button>
        </div>
      </div>

      <div className="space-y-2.5">
        {list.length === 0 ? (
          <p className="text-xs text-stone-500 py-6 text-center">No hay reservas{showPastReservations ? '' : ' próximas'}.</p>
        ) : (
          list.map(res => {
            const phoneDigits = String(res.customerPhone || '').replace(/\D/g, '');
            const isToday = res.date === today;
            return (
              <div key={res.id} className={`bg-[#121212] border rounded-xl p-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2.5 ${isToday && res.status === 'CONFIRMED' ? 'border-amber-600/60' : 'border-stone-800'}`}>
                <div className="space-y-1 text-xs min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display font-bold text-[#F4EFE6] text-sm">{res.customerName}</span>
                    <span className="bg-[#14281D] text-[#C8A45D] px-2 py-0.5 rounded text-[10px] font-bold border border-[#C8A45D]/40">
                      Mesa {res.tableNumber}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                      res.status === 'CONFIRMED' ? 'bg-green-950 text-green-300' : 'bg-red-950 text-red-300'
                    }`}>
                      {res.status === 'CONFIRMED' ? 'Confirmada' : 'Cancelada'}
                    </span>
                    {isToday && res.status === 'CONFIRMED' && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500 text-black">HOY</span>
                    )}
                  </div>

                  <div className="text-stone-400 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                    <span>📅 <strong className="text-stone-200">{prettyDate(res.date || today)}</strong></span>
                    <span>⏰ <strong className="text-stone-200">{res.startTime} h</strong></span>
                    <span>👥 {res.guests} pers.</span>
                    {res.customerPhone && <span>📞 {res.customerPhone}</span>}
                  </div>
                  {res.notes && <p className="text-[11px] text-stone-400 italic">“{res.notes}”</p>}
                </div>

                {res.status === 'CONFIRMED' && (
                  <div className="flex gap-2 shrink-0">
                    {phoneDigits.length >= 8 && (
                      <a
                        href={`https://wa.me/${phoneDigits}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 bg-[#14281D] hover:bg-green-900 border border-green-700 text-green-300 text-xs rounded-lg flex items-center gap-1 transition"
                      >
                        <MessageSquare className="w-3 h-3" />
                        <span>WhatsApp</span>
                      </a>
                    )}
                    <button
                      onClick={() => handleCancelReservation(res.id)}
                      className="px-2.5 py-1 bg-red-950/80 hover:bg-red-900 border border-red-800 text-red-300 text-xs rounded-lg flex items-center gap-1 transition"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Cancelar</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
