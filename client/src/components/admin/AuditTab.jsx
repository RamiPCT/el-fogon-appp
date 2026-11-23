import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api';

const ACTIONS = {
  'auth.login': 'Inicio de sesión',
  'auth.login_failed': 'Intento de acceso fallido',
  'auth.logout': 'Cierre de sesión',
  'auth.pin_changed': 'PIN del local cambiado',
  'settings.update': 'Ajustes modificados',
  'table.update': 'Mesa modificada',
  'floor.tables_changed': 'Mesas añadidas o quitadas del plano',
  'product.create': 'Plato creado',
  'product.update': 'Plato modificado',
  'product.image': 'Foto de plato cambiada',
  'product.deactivate': 'Plato dado de baja',
  'category.create': 'Categoría creada',
  'category.update': 'Categoría modificada',
  'category.deactivate': 'Categoría dada de baja',
  'order.status': 'Estado de comanda',
  'order.reprint': 'Comanda reimpresa',
  'reservation.create': 'Reserva creada',
  'reservation.cancel': 'Reserva cancelada',
  'call.ack': 'Aviso de mesa atendido',
  'backup.create': 'Copia de seguridad creada',
  'backup.download': 'Copia descargada',
  'backup.restore': 'Datos restaurados',
  'staff.create': 'Usuario creado',
  'staff.update': 'Usuario modificado',
  'staff.update_password': 'Contraseña de usuario cambiada'
};
const FILTERS = [
  ['', 'Todo'], ['order.', 'Comandas'], ['reservation.', 'Reservas'], ['product.', 'Carta'],
  ['staff.', 'Equipo'], ['auth.', 'Accesos'], ['settings.', 'Ajustes'], ['backup.', 'Copias']
];
const fmt = (iso) => new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

const describe = (e) => {
  const parts = [];
  if (e.entityId) parts.push(`${e.entity === 'order' ? 'Comanda #' : e.entity === 'table' ? 'Mesa ' : ''}${e.entityId}`);
  if (e.before && e.after && typeof e.after === 'object') {
    for (const k of Object.keys(e.after)) {
      if (e.before[k] !== undefined && JSON.stringify(e.before[k]) !== JSON.stringify(e.after[k])) {
        parts.push(`${k}: ${JSON.stringify(e.before[k])} → ${JSON.stringify(e.after[k])}`);
      }
    }
  }
  return parts.join(' · ');
};

// Pestaña "Historial": registro de actividad de solo lectura (nadie puede modificarlo ni borrarlo)
export const AuditTab = () => {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('');
  const [more, setMore] = useState(true);
  const [error, setError] = useState('');

  const load = async (reset = true) => {
    setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (filter) params.set('action', filter);
      if (!reset && items.length) params.set('beforeId', String(items[items.length - 1].id));
      const page = await api(`/api/audit?${params}`);
      setItems(prev => (reset ? page : [...prev, ...page]));
      setMore(page.length === 100);
    } catch (err) { setError(err.message); }
  };
  useEffect(() => { load(true); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="bg-[#1A1A1A] border border-stone-800 rounded-2xl p-4 space-y-3 shadow-xl">
      <div className="pb-2 border-b border-stone-800">
        <h3 className="font-display text-sm font-bold text-[#C8A45D]">Historial de actividad</h3>
        <p className="text-[10px] text-stone-400">Quién hizo qué y cuándo. Este registro no se puede modificar ni borrar.</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(([v, label]) => (
          <button key={v || 'all'} onClick={() => setFilter(v)} className={`px-2.5 py-1 rounded-full text-[11px] border ${filter === v ? 'bg-[#C8A45D] text-[#121212] border-[#C8A45D] font-bold' : 'border-stone-700 text-stone-300'}`}>{label}</button>
        ))}
      </div>
      {error && <p className="text-xs text-red-300" role="alert">{error}</p>}
      <ul className="divide-y divide-stone-800 text-xs">
        {items.map(e => (
          <li key={e.id} className="py-2 flex flex-wrap gap-x-3 gap-y-0.5">
            <span className="text-stone-500 font-mono text-[11px] w-[118px] shrink-0">{fmt(e.at)}</span>
            <span className={`font-semibold ${e.result === 'ok' ? 'text-[#F4EFE6]' : 'text-red-300'}`}>{ACTIONS[e.action] || e.action}</span>
            <span className="text-[#E6C687]">{e.employeeName || (e.action.startsWith('reservation.') || e.action.startsWith('order.') ? 'Cliente (web)' : '—')}</span>
            {describe(e) && <span className="basis-full sm:basis-auto text-stone-400 break-all">{describe(e)}</span>}
          </li>
        ))}
      </ul>
      {items.length === 0 && !error && <p className="text-xs text-stone-400">Sin actividad registrada todavía.</p>}
      {more && items.length > 0 && (
        <button onClick={() => load(false)} className="w-full py-2 rounded-xl border border-stone-700 text-xs text-stone-300">Ver más</button>
      )}
    </div>
  );
};
