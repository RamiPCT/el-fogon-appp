import React from 'react';
import { Clock, AlertTriangle, Check, ArrowLeft } from 'lucide-react';
import { useI18n } from '../i18n';

const fmtLeft = (min, lang) => {
  if (min == null) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (lang === 'en') return h ? `${h} h ${m} min` : `${m} min`;
  return h ? `${h} h ${m} min` : `${m} min`;
};

// Aviso al elegir una mesa que tiene una reserva más tarde hoy
export const TableBufferModal = ({ isOpen, table, currentTime, bufferMinutes = 15, onAccept, onCancel }) => {
  const { t, lang } = useI18n();
  if (!isOpen || !table || !table.nextReservation) return null;

  const res = table.nextReservation;
  const urgent = res.soon;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="buffer-title" onClick={onCancel}>
      <div
        className={`fogon-sheet relative overflow-hidden bg-[#1A1A1A] border-2 ${urgent ? 'border-amber-500' : 'border-[#C8A45D]/60'} border-b-0 sm:border-b-2 rounded-t-3xl sm:rounded-3xl max-w-md w-full p-5 shadow-2xl space-y-4 fogon-safe-bottom`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(ellipse_at_50%_0%,rgba(245,158,11,0.18),transparent_70%)] pointer-events-none" />
        <div className="mx-auto w-10 h-1 rounded-full bg-stone-700 sm:hidden" />

        <div className="relative flex items-start gap-3">
          <div className="w-11 h-11 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/40">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h3 id="buffer-title" className="font-display text-base font-bold text-amber-300">{t('buffer.title')}</h3>
            <p className="text-xs text-stone-400">{t('buffer.table', { n: table.number, c: table.capacity })}</p>
          </div>
        </div>

        <div className="relative grid grid-cols-3 gap-2 text-center">
          <div className="bg-[#121212] rounded-xl border border-stone-800 py-2.5">
            <p className="text-[9px] uppercase tracking-wider text-stone-500">{t('buffer.now')}</p>
            <p className="font-mono text-base font-bold text-stone-200">{currentTime}</p>
          </div>
          <div className="bg-[#121212] rounded-xl border border-amber-700/60 py-2.5">
            <p className="text-[9px] uppercase tracking-wider text-amber-500/80">{t('buffer.freeUntil')}</p>
            <p className="font-mono text-base font-bold text-amber-300">{res.bufferLimitTime}</p>
          </div>
          <div className="bg-[#121212] rounded-xl border border-stone-800 py-2.5">
            <p className="text-[9px] uppercase tracking-wider text-stone-500">{t('buffer.next')}</p>
            <p className="font-mono text-base font-bold text-stone-200">{res.startTime}</p>
          </div>
        </div>

        <div className="relative p-3 bg-amber-950/40 border border-amber-700/60 rounded-xl text-amber-100 space-y-1">
          <p className="flex items-center gap-1.5 font-bold text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
            {t('buffer.limit', { t: res.bufferLimitTime })}
            {res.minutesLeft != null && <span className="font-normal text-amber-200/80">· {t('buffer.left', { x: fmtLeft(Math.max(0, res.minutesLeft - bufferMinutes), lang) })}</span>}
          </p>
          <p className="text-[11px] text-amber-200/90 leading-relaxed">{t('buffer.text', { m: bufferMinutes })}</p>
        </div>

        <div className="relative grid grid-cols-2 gap-2">
          <button
            onClick={onCancel}
            className="py-3 bg-[#121212] text-stone-300 border border-stone-700 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 active:scale-95 transition"
          >
            <ArrowLeft className="w-4 h-4" />{t('buffer.back')}
          </button>
          <button
            onClick={() => onAccept(table)}
            className="py-3 bg-[#C8A45D] hover:bg-[#E6C687] text-[#121212] text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-lg active:scale-95 transition"
          >
            <Check className="w-4 h-4" />{t('buffer.accept')}
          </button>
        </div>
      </div>
    </div>
  );
};
