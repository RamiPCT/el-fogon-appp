import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { TableMap, MapLegend } from '../components/TableMap';
import { TableBufferModal } from '../components/TableBufferModal';
import { TableOccupiedModal } from '../components/TableOccupiedModal';
import { WhatsAppBookingModal } from '../components/WhatsAppBookingModal';
import { AuraHero } from '../components/Embers';
import { useSocket } from '../context/SocketContext';
import { useSettings } from '../context/SettingsContext';
import { useI18n } from '../i18n';
import { clockNow, todayStr, addDays, prettyDate, timeSlots } from '../utils/time';
import { Clock, UtensilsCrossed, CalendarDays, Users, Minus, Plus, MapPin, AlertTriangle, X } from 'lucide-react';

export const CustomerPortal = ({ onGoToTable, currentSelectedTable, onSelectGlobalTable, initialMode = 'book' }) => {
  const { socket } = useSocket();
  const settings = useSettings();
  const { t, lang } = useI18n();

  const [mode, setMode] = useState(initialMode); // 'here' | 'book'
  const [tables, setTables] = useState(null);
  const [floor, setFloor] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [occupiedTable, setOccupiedTable] = useState(null);
  const [bufferTable, setBufferTable] = useState(null);
  const [bookingTable, setBookingTable] = useState(null); // se fija al abrir, para que el modal no se cierre si la mesa deja de estar libre
  const [currentTime, setCurrentTime] = useState(() => clockNow());

  // Parámetros de reserva
  const today = todayStr();
  const slotsFor = useCallback((d) => timeSlots(d, settings.bookingStart || '12:00', settings.bookingEnd || '23:30'), [settings.bookingStart, settings.bookingEnd]);
  const [date, setDate] = useState(() => (slotsFor(today).length ? today : addDays(today, 1)));
  const slots = useMemo(() => slotsFor(date), [date, slotsFor]);
  const [time, setTime] = useState(() => {
    const s = slotsFor(slotsFor(today).length ? today : addDays(today, 1));
    return s.includes('21:00') ? '21:00' : (s[0] || '21:00');
  });
  const [guests, setGuests] = useState(2);
  const [availability, setAvailability] = useState(null);
  const [availError, setAvailError] = useState('');

  const selectedRef = useRef(null);
  selectedRef.current = selectedId;

  // Si cambia la fecha y la hora ya no es válida, elegir la primera disponible
  useEffect(() => {
    if (slots.length && !slots.includes(time)) setTime(slots.includes('21:00') ? '21:00' : slots[0]);
  }, [slots]);

  const fetchTables = useCallback(async () => {
    try {
      const res = await fetch('/api/tables');
      setTables(await res.json());
    } catch (_) {
      setTables(prev => prev || []);
    }
  }, []);

  const fetchAvailability = useCallback(async () => {
    if (!time) return;
    try {
      const res = await fetch(`/api/availability?date=${date}&time=${encodeURIComponent(time)}&guests=${guests}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAvailability(data);
      setAvailError('');
      // Si la mesa elegida deja de estar libre, se deselecciona
      const sel = data.tables.find(a => a.id === selectedRef.current);
      if (sel && !sel.available) setSelectedId(null);
    } catch (err) {
      setAvailability(null);
      setAvailError(err.message || 'Error');
    }
  }, [date, time, guests]);

  useEffect(() => {
    fetchTables();
    fetch('/api/floor').then(r => r.json()).then(setFloor).catch(() => {});
    const iv = setInterval(() => setCurrentTime(clockNow()), 15000);
    return () => clearInterval(iv);
  }, [fetchTables]);

  useEffect(() => {
    if (mode === 'book') fetchAvailability();
  }, [mode, fetchAvailability]);

  useEffect(() => { setSelectedId(null); }, [mode]);

  // Tiempo real: cualquier cambio en mesas o reservas refresca el plano (y la disponibilidad)
  const availTimer = useRef(null);
  useEffect(() => {
    if (!socket) return;
    const refreshAvail = () => {
      clearTimeout(availTimer.current);
      availTimer.current = setTimeout(() => { if (mode === 'book') fetchAvailability(); }, 400);
    };
    const onStatus = (updated) => {
      setTables(prev => (prev || []).map(tb => tb.id === updated.id ? updated : tb));
      if (mode === 'here' && selectedRef.current === updated.id && updated.status === 'OCCUPIED') setSelectedId(null);
      refreshAvail();
    };
    const onLayout = (all) => { setTables(all); refreshAvail(); };
    const onFloor = (f) => setFloor(f);
    socket.on('floor:update', onFloor);
    const onConnect = () => { fetchTables(); refreshAvail(); };
    socket.on('table:status_update', onStatus);
    socket.on('table:layout_update', onLayout);
    socket.on('connect', onConnect);
    return () => {
      socket.off('table:status_update', onStatus);
      socket.off('table:layout_update', onLayout);
      socket.off('floor:update', onFloor);
      socket.off('connect', onConnect);
      clearTimeout(availTimer.current);
    };
  }, [socket, mode, fetchAvailability, fetchTables]);

  const selected = (tables || []).find(tb => tb.id === selectedId) || null;
  const selectedAvail = availability?.tables?.find(a => a.id === selectedId);

  const select = (table) => {
    setSelectedId(table.id);
    onSelectGlobalTable && onSelectGlobalTable(table.number);
  };

  const handleTableClick = (table) => {
    if (mode === 'book') return select(table);
    if (table.status === 'OCCUPIED') return setOccupiedTable(table);
    // Aviso SIEMPRE que la mesa tenga una reserva más tarde hoy
    if (table.nextReservation) return setBufferTable(table);
    select(table);
  };

  const freeCount = availability ? availability.tables.filter(a => a.available && a.fits).length : null;
  const dayChips = [0, 1].map(i => addDays(today, i)).filter(d => slotsFor(d).length);

  return (
    <div className="pb-44">

      {/* ================= CABECERA CON AURA ================= */}
      <AuraHero>
        <div className="max-w-md mx-auto px-5 pt-6 pb-5 text-center">
          <span className="fogon-fade-up text-[10px] tracking-[0.3em] uppercase text-[#C8A45D]/90 font-semibold">{t('plan.kicker')}</span>
          <h1 className="fogon-fade-up font-script text-[#E6C687] text-4xl mt-1 leading-tight" style={{ animationDelay: '0.1s' }}>{t('plan.heroTitle')}</h1>
          <div className="fogon-fade-up inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full bg-black/40 border border-[#C8A45D]/30 text-[11px] text-stone-300" style={{ animationDelay: '0.2s' }}>
            <Clock className="w-3 h-3 text-[#C8A45D]" />
            {t('plan.clock')}: <strong className="text-[#F4EFE6] font-mono">{currentTime}</strong>
          </div>

          {/* Selector de modo */}
          <div className="fogon-fade-up mt-5 grid grid-cols-2 gap-1 p-1 rounded-2xl bg-black/40 border border-[#C8A45D]/30 text-xs font-bold" role="tablist" style={{ animationDelay: '0.3s' }}>
            {[['book', CalendarDays, t('plan.modeBook')], ['here', MapPin, t('plan.modeHere')]].map(([key, Icon, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={mode === key}
                onClick={() => setMode(key)}
                className={`py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition ${mode === key ? 'bg-[#C8A45D] text-[#121212] shadow-lg' : 'text-stone-300 hover:text-white'}`}
              >
                <Icon className="w-3.5 h-3.5" />{label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-stone-400 mt-2.5">{mode === 'book' ? t('plan.bookHint') : t('plan.hereHint')}</p>
        </div>
      </AuraHero>

      <div className="max-w-md mx-auto px-3.5 pt-4 space-y-4">

        {/* ================= DÍA, HORA Y PERSONAS ================= */}
        {mode === 'book' && (
          <div className="bg-[#1A1A1A] border border-[#C8A45D]/30 rounded-2xl p-3.5 space-y-3 shadow-xl fogon-pop">
            {/* Día */}
            <div className="flex gap-1.5 overflow-x-auto fogon-no-scrollbar">
              {dayChips.map((d, i) => (
                <button
                  key={d}
                  onClick={() => setDate(d)}
                  className={`shrink-0 px-3 py-2 rounded-xl text-xs font-bold border transition ${date === d ? 'bg-[#14281D] border-[#C8A45D] text-[#E6C687]' : 'bg-[#121212] border-stone-800 text-stone-300'}`}
                >
                  {d === today ? t('plan.today') : d === addDays(today, 1) ? t('plan.tomorrow') : prettyDate(d, lang)}
                </button>
              ))}
              <label className={`shrink-0 relative px-3 py-2 rounded-xl text-xs font-bold border flex items-center gap-1 cursor-pointer ${!dayChips.includes(date) ? 'bg-[#14281D] border-[#C8A45D] text-[#E6C687]' : 'bg-[#121212] border-stone-800 text-stone-300'}`}>
                <CalendarDays className="w-3.5 h-3.5" />
                {!dayChips.includes(date) ? prettyDate(date, lang) : t('plan.otherDate')}
                <input
                  type="date"
                  min={today}
                  value={date}
                  onChange={(e) => e.target.value && setDate(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  aria-label={t('plan.otherDate')}
                />
              </label>
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
              {/* Hora */}
              <div>
                <label htmlFor="plan-time" className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold flex items-center gap-1 mb-1">
                  <Clock className="w-3 h-3" />{t('plan.time')}
                </label>
                {slots.length ? (
                  <select
                    id="plan-time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full bg-[#121212] border border-stone-700 rounded-xl px-3 py-2.5 text-sm text-[#F4EFE6] font-mono outline-none focus:border-[#C8A45D]"
                  >
                    {slots.map(s => <option key={s} value={s}>{s} h</option>)}
                  </select>
                ) : (
                  <p className="text-xs text-amber-300 py-2.5">{t('plan.noSlotsToday')}</p>
                )}
              </div>
              {/* Personas */}
              <div>
                <span className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold flex items-center gap-1 mb-1">
                  <Users className="w-3 h-3" />{t('plan.guestsLabel')}
                </span>
                <div className="flex items-center bg-[#121212] border border-stone-700 rounded-xl">
                  <button onClick={() => setGuests(g => Math.max(1, g - 1))} className="w-10 h-10 flex items-center justify-center text-stone-300 active:text-[#C8A45D]" aria-label="−1">
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-6 text-center font-mono font-bold text-[#F4EFE6]" aria-live="polite">{guests}</span>
                  <button onClick={() => setGuests(g => Math.min(20, g + 1))} className="w-10 h-10 flex items-center justify-center text-stone-300 active:text-[#C8A45D]" aria-label="+1">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className="text-[11px] text-center" aria-live="polite">
              {availError ? (
                <span className="text-red-300">{availError}</span>
              ) : freeCount === null ? (
                <span className="text-stone-500">{t('plan.loadingAvail')}</span>
              ) : freeCount === 0 ? (
                <span className="text-amber-300">{t('plan.noneFree')}</span>
              ) : (
                <span className="text-emerald-300 font-semibold">{t('plan.freeCount', { n: freeCount })} · {t('plan.when', { date: prettyDate(date, lang), time, n: guests })}</span>
              )}
            </div>
          </div>
        )}

        {/* ================= PLANO ================= */}
        <MapLegend mode={mode === 'book' ? 'availability' : 'live'} />
        {tables === null ? (
          <div className="rounded-3xl border border-[#C8A45D]/25 fogon-floor p-12 text-center text-xs text-stone-400 animate-pulse">{t('plan.loading')}</div>
        ) : (
          <TableMap
            floor={floor}
            tables={tables}
            selectedTableId={selectedId}
            onTableClick={handleTableClick}
            mode={mode === 'book' ? 'availability' : 'live'}
            availability={mode === 'book' ? availability : null}
          />
        )}

        {/* Pasos */}
        <div className="flex items-center justify-center gap-2 text-[11px] text-stone-500">
          <span className="w-5 h-5 rounded-full bg-[#14281D] border border-[#C8A45D]/60 text-[#C8A45D] flex items-center justify-center font-bold">1</span>
          {t('plan.step1')}
          <span className="w-6 h-px bg-stone-700" />
          <span className="w-5 h-5 rounded-full bg-[#14281D] border border-[#C8A45D]/60 text-[#C8A45D] flex items-center justify-center font-bold">2</span>
          {mode === 'book' ? t('plan.step2') : t('plan.step2here')}
        </div>
      </div>

      {/* ================= HOJA INFERIOR DE LA MESA ELEGIDA ================= */}
      <div className="fixed bottom-0 inset-x-0 z-40 pointer-events-none">
        <div className="max-w-md mx-auto px-3 pointer-events-auto">
          {selected ? (
            <div key={selected.id} className="fogon-sheet bg-[#1A1A1A]/95 backdrop-blur border border-[#C8A45D]/60 border-b-0 rounded-t-3xl p-4 shadow-[0_-10px_40px_rgba(0,0,0,0.6)] space-y-3 fogon-safe-bottom">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] text-stone-400 uppercase tracking-wider">{t('plan.selected')}</p>
                  <h2 className="font-display text-lg font-bold text-[#C8A45D] leading-tight">
                    {selected.shape === 'bar_stool' ? t('plan.stool', { n: selected.number }) : t('table', { n: selected.number })}
                    <span className="text-stone-400 text-xs font-body font-normal"> · {t('plan.guests', { n: selected.capacity })}</span>
                  </h2>
                </div>
                <button onClick={() => setSelectedId(null)} className="w-8 h-8 rounded-full bg-stone-800 text-stone-400 flex items-center justify-center" aria-label={t('common.close')}>
                  <X className="w-4 h-4" />
                </button>
              </div>

              {mode === 'here' && selected.nextReservation && (
                <p className="text-[11px] text-amber-200 bg-amber-950/50 border border-amber-700/60 rounded-xl px-3 py-2 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  {t('plan.usableUntil', { t: selected.nextReservation.bufferLimitTime, r: selected.nextReservation.startTime })}
                </p>
              )}
              {mode === 'book' && selectedAvail && !selectedAvail.fits && (
                <p className="text-[11px] text-amber-200 bg-amber-950/50 border border-amber-700/60 rounded-xl px-3 py-2">
                  {t('plan.tooSmall', { n: selected.capacity })}
                </p>
              )}
              {mode === 'book' && (
                <p className="text-xs text-stone-300 font-mono">{t('plan.when', { date: prettyDate(date, lang), time, n: guests })}</p>
              )}

              {mode === 'here' ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => onGoToTable(selected.number)}
                    className="py-3 bg-[#C8A45D] hover:bg-[#E6C687] text-[#121212] font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-lg active:scale-95 transition"
                  >
                    <UtensilsCrossed className="w-4 h-4" />{t('plan.sitHere')}
                  </button>
                  <button
                    onClick={() => setMode('book')}
                    className="py-3 bg-[#14281D] border border-[#C8A45D]/60 text-[#E6C687] font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 active:scale-95 transition"
                  >
                    <CalendarDays className="w-4 h-4" />{t('plan.book')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setBookingTable(selected)}
                  disabled={!selectedAvail || !selectedAvail.available || !selectedAvail.fits}
                  className="w-full py-3.5 bg-[#C8A45D] hover:bg-[#E6C687] text-[#121212] font-bold text-sm rounded-xl flex items-center justify-center gap-2 shadow-[0_10px_30px_rgba(200,164,93,0.3)] active:scale-95 transition disabled:opacity-40"
                >
                  <CalendarDays className="w-4 h-4" />{t('plan.bookThis')}
                </button>
              )}
            </div>
          ) : (
            <div className="mb-4 mx-auto w-fit bg-black/70 backdrop-blur border border-stone-700 rounded-full px-4 py-2 text-[11px] text-stone-300 shadow-xl fogon-safe-bottom">
              👆 {t('plan.selectPrompt')}
            </div>
          )}
        </div>
      </div>

      {/* Modales */}
      <TableOccupiedModal isOpen={!!occupiedTable} table={occupiedTable} onClose={() => setOccupiedTable(null)} onBook={() => { setOccupiedTable(null); setMode('book'); }} />
      <TableBufferModal
        isOpen={!!bufferTable}
        table={bufferTable}
        currentTime={currentTime}
        bufferMinutes={settings.bufferMinutes || 15}
        onAccept={(tb) => { select(tb); setBufferTable(null); }}
        onCancel={() => setBufferTable(null)}
      />
      {bookingTable && (
        <WhatsAppBookingModal
          table={bookingTable}
          initial={{ date, time, guests }}
          onClose={() => { setBookingTable(null); fetchAvailability(); }}
          onBookingSuccess={() => { fetchTables(); setSelectedId(null); }}
        />
      )}
    </div>
  );
};
