import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api';
import { ROLE_LABELS } from '../../hooks/useStaff';

const inputCls = 'w-full bg-[#121212] border border-stone-700 rounded-lg px-2 py-1.5 text-xs text-stone-100 outline-none focus:border-[#C8A45D]';
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'nunca');
const ROLE_HELP = {
  admin: 'Todo: ajustes, copias, equipo y carta',
  manager: 'Carta, plano, reservas, equipo (sin administradores) e historial',
  waiter: 'Reservas, mesas, comandas y avisos',
  kitchen: 'Comandas y marcar platos agotados',
  bar: 'Comandas y marcar platos agotados'
};

// Pestaña "Equipo": usuarios individuales con su rol. Nunca se borran: se desactivan.
export const TeamTab = ({ me }) => {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ name: '', username: '', password: '', role: 'waiter' });
  const [msg, setMsg] = useState(null);

  const load = () => api('/api/staff').then(setList).catch(err => setMsg({ ok: false, text: err.message }));
  useEffect(() => { load(); }, []);

  // El encargado solo puede crear y tocar roles inferiores (lo vuelve a comprobar el servidor)
  const assignable = Object.keys(ROLE_LABELS).filter(r => me?.role === 'admin' || !['admin', 'manager'].includes(r));

  const create = async (e) => {
    e.preventDefault();
    setMsg(null);
    try {
      await api('/api/staff', { method: 'POST', body: form });
      setMsg({ ok: true, text: `✅ Usuario «${form.username}» creado. Ya puede entrar con su contraseña.` });
      setForm({ name: '', username: '', password: '', role: form.role });
      load();
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  };

  const update = async (emp, body, okText) => {
    setMsg(null);
    try {
      await api(`/api/staff/${emp.id}`, { method: 'PUT', body });
      setMsg({ ok: true, text: okText });
      load();
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  };

  const resetPassword = (emp) => {
    const pw = window.prompt(`Nueva contraseña para ${emp.name} (mínimo 6 caracteres):`);
    if (pw) update(emp, { password: pw }, `✅ Contraseña de ${emp.name} cambiada. Sus sesiones abiertas se han cerrado.`);
  };

  return (
    <div className="space-y-3.5">
      <div className="bg-[#1A1A1A] border border-stone-800 rounded-2xl p-4 space-y-3 shadow-xl">
        <div className="pb-2 border-b border-stone-800">
          <h3 className="font-display text-sm font-bold text-[#C8A45D]">Equipo</h3>
          <p className="text-[10px] text-stone-400">Cada persona entra con su usuario: así queda registrado quién hace cada cosa. Los permisos los comprueba el servidor.</p>
        </div>

        <form onSubmit={create} className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-stone-400">
          <label>Nombre<input className={`${inputCls} mt-1`} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ej.: Lucía" /></label>
          <label>Usuario<input className={`${inputCls} mt-1`} value={form.username} autoCapitalize="none" autoCorrect="off" onChange={e => setForm({ ...form, username: e.target.value.replace(/\s/g, '') })} placeholder="ej.: lucia" /></label>
          <label>Contraseña<input className={`${inputCls} mt-1`} type="password" autoComplete="new-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Mínimo 6 caracteres" /></label>
          <label>Rol
            <select className={`${inputCls} mt-1`} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
              {assignable.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            <span className="block mt-1 text-[10px] text-stone-500">{ROLE_HELP[form.role]}</span>
          </label>
          <button disabled={!form.name || !form.username || form.password.length < 6} className="sm:col-span-2 py-2 rounded-xl bg-[#C8A45D] text-[#121212] font-bold text-xs disabled:opacity-40">+ Crear usuario</button>
        </form>
        {msg && <p className={`text-xs ${msg.ok ? 'text-green-300' : 'text-red-300'}`} role="status">{msg.text}</p>}
      </div>

      <div className="bg-[#1A1A1A] border border-stone-800 rounded-2xl p-4 shadow-xl">
        {list.length === 0 ? (
          <p className="text-xs text-stone-400">Todavía no hay usuarios. Mientras tanto se entra con el PIN del local.</p>
        ) : (
          <ul className="divide-y divide-stone-800">
            {list.map(emp => {
              const editable = me?.role === 'admin' || !['admin', 'manager'].includes(emp.role);
              return (
                <li key={emp.id} className={`py-2.5 flex flex-wrap items-center gap-2 ${emp.active ? '' : 'opacity-50'}`}>
                  <div className="flex-1 min-w-[150px]">
                    <p className="text-xs font-bold text-[#F4EFE6]">{emp.name} <span className="font-normal text-stone-500">@{emp.username}</span>{!emp.active && ' · desactivado'}</p>
                    <p className="text-[10px] text-stone-500">Último acceso: {fmt(emp.lastLoginAt)}</p>
                  </div>
                  {editable ? (
                    <>
                      <select
                        value={emp.role}
                        onChange={e => update(emp, { role: e.target.value }, `✅ ${emp.name} ahora es ${ROLE_LABELS[e.target.value]}.`)}
                        className="bg-[#121212] border border-stone-700 rounded-lg px-1.5 py-1 text-[11px] text-stone-200"
                        aria-label={`Rol de ${emp.name}`}
                      >
                        {assignable.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                      <button onClick={() => resetPassword(emp)} className="text-[11px] text-stone-300 underline">Contraseña</button>
                      {emp.id !== me?.id && (
                        <button
                          onClick={() => update(emp, { active: !emp.active }, emp.active ? `${emp.name} desactivado: ya no puede entrar.` : `✅ ${emp.name} reactivado.`)}
                          className={`text-[11px] underline ${emp.active ? 'text-red-300' : 'text-green-300'}`}
                        >
                          {emp.active ? 'Desactivar' : 'Reactivar'}
                        </button>
                      )}
                    </>
                  ) : (
                    <span className="text-[11px] text-stone-400">{ROLE_LABELS[emp.role]}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};
