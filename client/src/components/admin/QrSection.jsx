import React, { useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../../utils/api';

const isLocal = (u) => /\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(u);
const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// QR seguros de las mesas: cada QR lleva una clave secreta de esa mesa.
// Se imprimen desde aquí; «Regenerar» invalida el QR anterior de una mesa.
export const QrSection = ({ tables, setTables, settings, setSettings }) => {
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [baseDraft, setBaseDraft] = useState(settings.publicUrl || '');
  const base = (settings.publicUrl || window.location.origin).replace(/\/+$/, '');
  const sorted = [...tables].filter(t => t.qrKey).sort((a, b) => String(a.number).localeCompare(String(b.number), 'es', { numeric: true }));

  const saveSetting = async (body, okText) => {
    try {
      const saved = await api('/api/settings', { method: 'PUT', body });
      setSettings(saved);
      setMsg({ ok: true, text: okText });
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  };

  const regenerate = async (t) => {
    if (!window.confirm(`¿Regenerar el QR de la mesa ${t.number}? El QR que esté impreso en esa mesa dejará de funcionar.`)) return;
    try {
      const r = await api(`/api/tables/${encodeURIComponent(t.id)}/qr`, { method: 'POST', body: {} });
      setTables(prev => prev.map(x => (x.id === t.id ? { ...x, qrKey: r.qrKey } : x)));
      setMsg({ ok: true, text: `✅ QR de la mesa ${t.number} regenerado. Imprímelo de nuevo.` });
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  };

  // Abre una hoja lista para imprimir (A4, 2 columnas) con el QR de cada mesa y el de la carta
  const print = async (only) => {
    const win = window.open('', '_blank');
    if (!win) { setMsg({ ok: false, text: 'El navegador bloqueó la ventana. Permite las ventanas emergentes para imprimir.' }); return; }
    win.document.write('<p style="font-family:sans-serif">Preparando los QR…</p>');
    setBusy(true);
    try {
      const opts = { margin: 1, width: 600, errorCorrectionLevel: 'M', color: { dark: '#121212', light: '#ffffff' } };
      const cards = [];
      const list = only ? [only] : sorted;
      for (const t of list) {
        cards.push({ title: `Mesa ${t.number}`, sub: 'Escanea para ver la carta y pedir', url: `${base}/q/${t.qrKey}`, img: await QRCode.toDataURL(`${base}/q/${t.qrKey}`, opts) });
      }
      if (!only) cards.push({ title: 'Carta', sub: 'Escanea para ver la carta', url: `${base}/carta`, img: await QRCode.toDataURL(`${base}/carta`, opts) });
      const name = esc(settings.restaurantName || 'El Fogón');
      win.document.open();
      win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>QR · ${name}</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { margin: 0; font-family: Georgia, 'Times New Roman', serif; color: #121212; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
  .card { border: 2px solid #C8A45D; border-radius: 6mm; padding: 6mm; text-align: center; break-inside: avoid; }
  .brand { letter-spacing: .3em; font-size: 13pt; color: #5A1826; font-weight: bold; }
  .title { font-size: 22pt; margin: 2mm 0; }
  img { width: 62mm; height: 62mm; }
  .sub { font-family: Arial, sans-serif; font-size: 10pt; color: #444; }
  .url { font-family: monospace; font-size: 6.5pt; color: #888; word-break: break-all; margin-top: 2mm; }
  .hint { font-family: Arial, sans-serif; font-size: 10pt; margin-bottom: 6mm; }
  @media print { .hint { display: none; } }
</style></head><body>
<p class="hint">Comprueba un QR con el móvil antes de imprimir. Después, pulsa Ctrl+P (o Compartir → Imprimir en el móvil).</p>
<div class="grid">${cards.map(c => `<div class="card"><div class="brand">${name.toUpperCase()}</div><div class="title">${esc(c.title)}</div><img src="${c.img}" alt="QR ${esc(c.title)}"><div class="sub">${esc(c.sub)}</div><div class="url">${esc(c.url)}</div></div>`).join('')}</div>
<script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`);
      win.document.close();
    } catch (err) {
      win.close();
      setMsg({ ok: false, text: `No se pudieron generar los QR: ${err.message}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-[#1A1A1A] border border-stone-800 rounded-2xl p-4 space-y-3 shadow-xl text-xs">
      <div className="pb-2 border-b border-stone-800">
        <h3 className="font-display text-sm font-bold text-[#C8A45D]">📱 QR de las mesas</h3>
        <p className="text-[10px] text-stone-400">Cada QR lleva una clave secreta de su mesa: nadie puede pedir a otra mesa cambiando el número en la dirección.</p>
      </div>

      <label className="block text-[11px] text-stone-400">Dirección de la web que llevarán los QR
        <div className="flex gap-2 mt-1">
          <input
            className="flex-1 bg-[#121212] border border-stone-700 rounded-lg px-2 py-1.5 text-xs text-stone-100 outline-none focus:border-[#C8A45D]"
            value={baseDraft}
            placeholder={window.location.origin}
            onChange={e => setBaseDraft(e.target.value)}
          />
          <button onClick={() => saveSetting({ publicUrl: baseDraft.trim() }, '✅ Dirección guardada.')} className="px-3 rounded-lg bg-[#14281D] border border-[#C8A45D]/60 text-[#E6C687] font-bold">Guardar</button>
        </div>
      </label>
      {isLocal(base) && (
        <p className="text-[11px] text-amber-200 bg-amber-950/40 border border-amber-800/60 rounded-lg px-2.5 py-1.5">
          ⚠️ Ahora los QR apuntarían a «{base}», que solo funciona en este ordenador. Escribe la dirección con la que entran los móviles (p. ej. http://192.168.1.139:3001) o la de la web publicada.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button onClick={() => print(null)} disabled={busy || !sorted.length} className="px-3 py-2 bg-[#C8A45D] text-[#121212] font-bold rounded-xl disabled:opacity-50">🖨️ Imprimir QR de todas las mesas</button>
      </div>

      <label className="flex items-start gap-2 text-stone-300">
        <input
          type="checkbox" className="mt-0.5"
          checked={settings.qrLegacyEnabled !== false}
          onChange={e => saveSetting({ qrLegacyEnabled: e.target.checked }, e.target.checked ? 'Se aceptan también los QR antiguos.' : '✅ Solo funcionan los QR nuevos.')}
        />
        <span>
          Aceptar también los QR antiguos (solo con el número de mesa) y elegir mesa desde el plano.
          <span className="block text-[11px] text-stone-400">Desactívalo cuando hayas colocado los QR nuevos en todas las mesas.</span>
        </span>
      </label>

      {msg && <p className={msg.ok ? 'text-green-300' : 'text-red-300'} role="status">{msg.text}</p>}

      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
        {sorted.map(t => (
          <li key={t.id} className="flex items-center justify-between gap-2 bg-[#121212] border border-stone-800 rounded-xl pl-3 pr-1.5 py-1.5">
            <span className="font-bold text-stone-200 whitespace-nowrap">Mesa {t.number}</span>
            <span className="flex gap-1.5">
              <button onClick={() => print(t)} className="min-h-[40px] px-3 text-xs font-bold text-[#E6C687] bg-[#1A1A1A] border border-[#C8A45D]/40 rounded-lg disabled:opacity-50" disabled={busy}>Imprimir</button>
              <button onClick={() => regenerate(t)} className="min-h-[40px] px-3 text-xs font-bold text-red-300 bg-[#1A1A1A] border border-red-900/60 rounded-lg">Regenerar</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
