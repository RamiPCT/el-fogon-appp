import React from 'react';
import { Clock, Users, Lock } from 'lucide-react';
import { useI18n } from '../i18n';
import { FloorPlan } from './FloorPlan';

// Sillas alrededor de la mesa según su capacidad y forma
const Seats = ({ capacity, shape, tone }) => {
  const n = Math.min(Math.max(capacity || 2, 1), 10);
  const seats = [];
  if (shape === 'round') {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      seats.push({ left: 50 + Math.cos(a) * 54, top: 50 + Math.sin(a) * 54 });
    }
  } else {
    const top = Math.ceil(n / 2);
    const bottom = n - top;
    for (let i = 0; i < top; i++) seats.push({ left: ((i + 1) / (top + 1)) * 100, top: -9 });
    for (let i = 0; i < bottom; i++) seats.push({ left: ((i + 1) / (bottom + 1)) * 100, top: 109 });
  }
  return seats.map((s, i) => (
    <span
      key={i}
      className={`absolute w-2.5 h-2.5 rounded-full -translate-x-1/2 -translate-y-1/2 border ${tone}`}
      style={{ left: `${s.left}%`, top: `${s.top}%` }}
      aria-hidden="true"
    />
  ));
};

/**
 * mode = 'live'         → estado en tiempo real (estoy en el local)
 * mode = 'availability' → disponibilidad para la fecha/hora elegida (reservar)
 */
export const TableMap = ({ floor, tables, selectedTableId, onTableClick, mode = 'live', availability = null }) => {
  const { t } = useI18n();

  const avail = (table) => availability?.tables?.find(a => a.id === table.id);

  // Devuelve la "apariencia" de una mesa
  const look = (table) => {
    const isSelected = selectedTableId === table.id;
    if (mode === 'availability') {
      const a = avail(table);
      if (!a) return { key: 'loading', disabled: true };
      if (!a.available) return { key: 'blocked', disabled: true, label: a.reason === 'reserved' ? t('status.reservedShort') : t('status.occupied') };
      if (!a.fits) return { key: 'small', disabled: false, label: t('plan.small'), selected: isSelected };
      return { key: 'free', label: t('status.free'), selected: isSelected };
    }
    if (table.status === 'OCCUPIED') return { key: 'occupied', label: t('status.occupied'), selected: false };
    if (table.status === 'RESERVED_SOON') return { key: 'soon', label: table.nextReservation?.startTime, selected: isSelected };
    return { key: 'free', label: t('status.free'), selected: isSelected, later: table.nextReservation?.startTime };
  };

  const styles = {
    free: { top: 'bg-gradient-to-br from-[#1c3a29] to-[#14281D] border-[#C8A45D]/70 text-[#F4EFE6]', seat: 'bg-[#14281D] border-[#C8A45D]/60', chip: 'text-emerald-300' },
    small: { top: 'bg-[#16201a] border-stone-600 text-stone-300', seat: 'bg-stone-800 border-stone-600', chip: 'text-stone-400' },
    occupied: { top: 'bg-gradient-to-br from-[#6e1e30] to-[#5A1826] border-red-900 text-stone-200', seat: 'bg-[#5A1826] border-red-900', chip: 'text-red-200' },
    soon: { top: 'bg-gradient-to-br from-amber-900 to-amber-950 border-amber-500 text-amber-100', seat: 'bg-amber-950 border-amber-600', chip: 'text-amber-200' },
    blocked: { top: 'bg-[#1a1416] border-red-950 text-stone-500 opacity-60', seat: 'bg-stone-900 border-stone-800', chip: 'text-stone-500' },
    loading: { top: 'bg-stone-900 border-stone-800 text-stone-600 animate-pulse', seat: 'bg-stone-900 border-stone-800', chip: 'text-stone-600' },
    selected: { top: 'bg-gradient-to-br from-[#E6C687] to-[#C8A45D] border-white text-[#121212] fogon-pulse-ring', seat: 'bg-[#C8A45D] border-white', chip: 'text-[#121212]' }
  };

  const ariaFor = (table, l) =>
    `${table.shape === 'bar_stool' ? t('plan.stool', { n: table.number }) : t('table', { n: table.number })}, ${t('plan.guests', { n: table.capacity })}${l.label ? ` – ${l.label}` : ''}${l.later ? ` – ${t('plan.reservedAt', { t: l.later })}` : ''}`;

  const renderTable = (table) => {
    const l = look(table);
    const st = styles[l.selected ? 'selected' : l.key];
    const stool = table.shape === 'bar_stool';
    const small = (table.width || 60) < 60 || (table.height || 60) < 50;
    return {
      className: st.top,
      disabled: l.disabled,
      pressed: !!l.selected,
      ariaLabel: ariaFor(table, l),
      onClick: () => onTableClick(table),
      content: (
        <>
          {!stool && <Seats capacity={table.capacity} shape={table.shape} tone={st.seat} />}
          <span className={`font-display font-bold leading-none ${small ? 'text-[11px]' : 'text-sm sm:text-base'}`}>{table.number}</span>
          {!small && (
            <span className="flex items-center gap-0.5 text-[9px] opacity-80 mt-0.5">
              <Users className="w-2.5 h-2.5" />{table.capacity}
            </span>
          )}
          {!small && l.label && (
            <span className={`text-[8px] font-bold uppercase tracking-wide mt-0.5 ${st.chip} flex items-center gap-0.5`}>
              {l.key === 'soon' && <Clock className="w-2.5 h-2.5" />}
              {l.key === 'blocked' && <Lock className="w-2.5 h-2.5" />}
              {l.label}
            </span>
          )}
          {small && (l.key === 'occupied' || l.key === 'blocked') && <Lock className="w-2.5 h-2.5 opacity-80" />}
          {l.later && !l.selected && (
            <span className="absolute -top-2.5 -right-2 bg-amber-500 text-black text-[8px] font-bold px-1 py-0.5 rounded-full flex items-center gap-0.5 shadow z-10">
              <Clock className="w-2.5 h-2.5" />{l.later}
            </span>
          )}
        </>
      )
    };
  };

  return (
    <div className="relative rounded-3xl border border-[#C8A45D]/25 bg-[#101010] p-2 sm:p-3 shadow-2xl">
      {floor ? (
        <FloorPlan floor={floor} tables={tables} renderTable={renderTable} />
      ) : (
        <div className="p-12 text-center text-xs text-stone-500 animate-pulse">…</div>
      )}
    </div>
  );
};

// Leyenda compacta
export const MapLegend = ({ mode }) => {
  const { t } = useI18n();
  const items = mode === 'availability'
    ? [
        ['bg-[#14281D] border-[#C8A45D]', t('status.free')],
        ['bg-[#1a1416] border-red-950', t('status.reservedShort')],
        ['bg-[#16201a] border-stone-600', t('plan.small')],
        ['bg-[#C8A45D] border-white', t('status.selected')]
      ]
    : [
        ['bg-[#14281D] border-[#C8A45D]', t('status.free')],
        ['bg-[#5A1826] border-red-900', t('status.occupied')],
        ['bg-amber-900 border-amber-500', t('status.soon')],
        ['bg-[#C8A45D] border-white', t('status.selected')]
      ];
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[11px] text-stone-400">
      {items.map(([cls, label]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className={`w-3 h-3 rounded-md border ${cls}`} />{label}
        </span>
      ))}
    </div>
  );
};
