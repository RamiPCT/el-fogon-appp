import React from 'react';
import { Users, Check, CalendarDays } from 'lucide-react';
import { useI18n } from '../i18n';

export const TableOccupiedModal = ({ isOpen, table, onClose, onBook }) => {
  const { t } = useI18n();
  if (!isOpen || !table) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="occ-title" onClick={onClose}>
      <div
        className="fogon-sheet relative overflow-hidden bg-[#1A1A1A] border-2 border-[#5A1826] border-b-0 sm:border-b-2 rounded-t-3xl sm:rounded-3xl max-w-md w-full p-5 shadow-2xl space-y-4 fogon-safe-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(ellipse_at_50%_0%,rgba(90,24,38,0.45),transparent_70%)] pointer-events-none" />
        <div className="mx-auto w-10 h-1 rounded-full bg-stone-700 sm:hidden" />

        <div className="relative flex items-start gap-3">
          <div className="w-11 h-11 rounded-full bg-[#5A1826]/40 text-red-300 flex items-center justify-center shrink-0 border border-red-800/60">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h3 id="occ-title" className="font-display text-base font-bold text-red-200">{t('occ.title', { n: table.number })}</h3>
            <p className="text-xs text-stone-400">{t('occ.capacity', { n: table.capacity })}</p>
          </div>
        </div>

        <p className="relative text-sm text-stone-300 leading-relaxed">{t('occ.text')} {t('occ.tip')}</p>

        <div className="relative grid grid-cols-2 gap-2">
          {onBook && (
            <button onClick={onBook} className="py-3 bg-[#14281D] border border-[#C8A45D]/60 text-[#E6C687] font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 active:scale-95 transition">
              <CalendarDays className="w-4 h-4" />{t('plan.modeBook')}
            </button>
          )}
          <button
            onClick={onClose}
            className={`${onBook ? '' : 'col-span-2'} py-3 bg-[#C8A45D] hover:bg-[#E6C687] text-[#121212] font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-lg active:scale-95 transition`}
          >
            <Check className="w-4 h-4" />{t('occ.ok')}
          </button>
        </div>
      </div>
    </div>
  );
};
