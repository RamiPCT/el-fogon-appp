import React, { useEffect, useRef, useState } from 'react';
import { api, getStaffToken } from '../../utils/api';

const fmtDate = (iso) => new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const reasonOf = (name) => {
  const r = name.replace(/^db-[\d-T]+-?/, '').replace(/\.json$/, '');
  return { arranque: 'al arrancar', diaria: 'diaria', manual: 'manual', 'antes-de-restaurar': 'antes de restaurar' }[r] || r;
};

// Copias de seguridad: se crean solas al arrancar y cada día. Aquí se pueden descargar y restaurar.
export const BackupSection = () => {
  const [backups, setBackups] = useState([]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = () => api('/api/admin/backups').then(setBackups).catch(() => {});
  useEffect(() => { load(); }, []);

  const createNow = async () => {
    setBusy(true);
    try { await api('/api/admin/backups', { method: 'POST', body: {} }); setMsg({ ok: true, text: '✅ Copia creada.' }); load(); }
    catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  };

  const download = async () => {
    try {
      const res = await fetch('/api/admin/backup/download', { headers: { Authorization: `Bearer ${getStaffToken()}` } });
      if (!res.ok) throw new Error('No se pudo descargar');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (res.headers.get('Content-Disposition') || '').match(/filename="(.+)"/)?.[1] || 'el-fogon-copia.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  };

  const restore = async (body, label) => {
    if (!window.confirm(`¿Restaurar ${label}? Los datos actuales se sustituirán (antes se guarda una copia por si acaso).`)) return;
    setBusy(true);
    try {
      await api('/api/admin/restore', { method: 'POST', body });
      setMsg({ ok: true, text: '✅ Datos restaurados. Recargando…' });
      setTimeout(() => window.location.reload(), 900);
    } catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  };

  const restoreFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      restore({ data }, `el archivo «${file.name}»`);
    } catch (_) {
      setMsg({ ok: false, text: 'Ese archivo no es una copia válida.' });
    }
  };

  return (
    <div className="bg-[#1A1A1A] border border-stone-800 rounded-2xl p-4 space-y-3 shadow-xl text-xs mt-3.5">
      <h3 className="font-display text-sm font-bold text-[#C8A45D] pb-2 border-b border-stone-800">💾 Copias de seguridad</h3>
      <p className="text-stone-400">Se hace una copia automática al arrancar el servidor y otra cada día (se guardan las últimas 40). Si el archivo de datos se daña, se recupera solo desde la última copia.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={download} className="px-3 py-2 bg-[#C8A45D] text-[#121212] font-bold rounded-xl">⬇️ Descargar copia actual</button>
        <button type="button" onClick={createNow} disabled={busy} className="px-3 py-2 bg-[#14281D] border border-[#C8A45D]/60 text-[#E6C687] font-bold rounded-xl disabled:opacity-50">Crear copia ahora</button>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="px-3 py-2 bg-[#121212] border border-stone-700 text-stone-200 rounded-xl disabled:opacity-50">⬆️ Restaurar desde archivo</button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={restoreFile} />
      </div>
      {msg && <p className={msg.ok ? 'text-green-300' : 'text-red-300'} role="status">{msg.text}</p>}
      {backups.length > 0 && (
        <ul className="divide-y divide-stone-800 border border-stone-800 rounded-xl overflow-hidden">
          {backups.slice(0, 8).map(b => (
            <li key={b.name} className="flex items-center justify-between gap-2 px-3 py-2 bg-[#121212]">
              <span className="text-stone-300">{fmtDate(b.createdAt)} · <span className="text-stone-500">{reasonOf(b.name)}</span></span>
              <button type="button" onClick={() => restore({ name: b.name }, `la copia del ${fmtDate(b.createdAt)}`)} disabled={busy} className="text-[11px] text-amber-300 underline disabled:opacity-50">Restaurar</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
