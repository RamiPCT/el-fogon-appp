import React, { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { api } from '../../utils/api';
import { BackupSection } from './BackupSection';
import { PrinterTest } from './PrinterTest';

// Pestaña "Ajustes" del panel del dueño
export const SettingsTab = ({ settings, setSettings }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [pinForm, setPinForm] = useState({ current: '', next: '', repeat: '' });
  const [pinMsg, setPinMsg] = useState(null); // { ok, text }
  const [pinSource, setPinSource] = useState(null);

  useEffect(() => {
    fetch('/api/auth/info').then(r => r.json()).then(d => setPinSource(d.source)).catch(() => {});
  }, []);

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const saved = await api('/api/settings', { method: 'PUT', body: settings });
      setSettings(saved);
      alert('✅ Ajustes guardados.');
    } catch (err) {
      alert(`Error al guardar: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePin = async (e) => {
    e.preventDefault();
    setPinMsg(null);
    if (pinForm.next !== pinForm.repeat) return setPinMsg({ ok: false, text: 'Los dos PIN nuevos no coinciden' });
    try {
      await api('/api/auth/pin', { method: 'PUT', body: { currentPin: pinForm.current, newPin: pinForm.next } });
      setPinForm({ current: '', next: '', repeat: '' });
      setPinSource('stored');
      setPinMsg({ ok: true, text: '✅ PIN cambiado. Las demás sesiones abiertas se han cerrado.' });
    } catch (err) {
      setPinMsg({ ok: false, text: err.message });
    }
  };

  const field = (key, label, props = {}) => (
    <div>
      <label htmlFor={`set-${key}`} className="block text-stone-300 mb-1 font-semibold">{label}</label>
      <input
        id={`set-${key}`}
        type={props.type || 'text'}
        value={settings[key] ?? ''}
        onChange={e => setSettings({ ...settings, [key]: props.type === 'number' ? Number(e.target.value) : e.target.value })}
        placeholder={props.placeholder || ''}
        className="w-full bg-[#121212] border border-stone-700 rounded-xl p-2.5 text-stone-200 outline-none focus:border-[#C8A45D]"
      />
      {props.help && <p className="text-[10px] text-stone-500 mt-1">{props.help}</p>}
    </div>
  );
  const area = (key, label, placeholder, help) => (
    <div>
      <label htmlFor={`set-${key}`} className="block text-stone-300 mb-1 font-semibold">{label}</label>
      <textarea
        id={`set-${key}`}
        rows={4}
        value={settings[key] ?? ''}
        onChange={e => setSettings({ ...settings, [key]: e.target.value })}
        placeholder={placeholder}
        className="w-full bg-[#121212] border border-stone-700 rounded-xl p-2.5 text-stone-200 outline-none focus:border-[#C8A45D] resize-y"
      />
      {help && <p className="text-[10px] text-stone-500 mt-1">{help}</p>}
    </div>
  );
  return (
    <>
    <form onSubmit={handleSaveSettings} className="bg-[#1A1A1A] border border-stone-800 rounded-2xl p-4 space-y-5 shadow-xl text-xs">
      <section className="space-y-3">
        <h3 className="font-display text-sm font-bold text-[#C8A45D] pb-2 border-b border-stone-800">Reservas y contacto</h3>
        {field('ownerPhone', '📱 WhatsApp que recibe las reservas', { placeholder: '34600000000', help: 'Con prefijo de país y sin espacios ni «+» (ej.: 34600000000).' })}
        {field('publicPhone', '☎️ Teléfono para llamar (opcional)', { placeholder: '+34 965 000 000' })}
        {field('email', '✉️ Email de contacto', { placeholder: 'hola@elfogon.es', type: 'email' })}
        {field('instagram', '📸 Instagram (usuario, sin @)', { placeholder: 'elfogon.alicante' })}
        {field('googleReviewUrl', '⭐ Enlace para dejar reseña en Google', { placeholder: 'https://g.page/r/.../review', help: 'Lo encuentras en tu Perfil de Empresa de Google → «Pedir reseñas».' })}
        <div className="grid grid-cols-2 gap-3">
          {field('bufferMinutes', '⏳ Minutos de margen antes de una reserva', { type: 'number' })}
          {field('reservationDurationMinutes', '⌛ Duración estimada de una reserva (min)', { type: 'number', help: 'Evita dos reservas solapadas en la misma mesa.' })}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-sm font-bold text-[#C8A45D] pb-2 border-b border-stone-800">Ubicación y horario (se muestran en la portada)</h3>
        {field('address', '📍 Dirección', { placeholder: 'Calle Ejemplo, 12' })}
        <div className="grid grid-cols-2 gap-3">
          {field('postalCode', 'Código postal', { placeholder: '03001' })}
          {field('city', 'Ciudad', { placeholder: 'Alicante' })}
        </div>
        {field('mapsUrl', '🗺️ Enlace de Google Maps (opcional)', { placeholder: 'https://maps.app.goo.gl/...', help: 'Si lo dejas vacío, se genera a partir de la dirección.' })}
        {area('openingHours', '🕒 Horario (una línea por franja)', 'Martes a jueves: 19:00 – 00:00\nViernes y sábado: 13:00 – 16:30 · 19:00 – 01:30\nDomingo: 13:00 – 17:00\nLunes: cerrado')}
        {area('openingHours_en', '🕒 Horario en inglés (opcional)', 'Tue–Thu: 7pm – midnight\nFri–Sat: 1pm – 4:30pm · 7pm – 1:30am\nSun: 1pm – 5pm\nMon: closed')}
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-sm font-bold text-[#C8A45D] pb-2 border-b border-stone-800">Datos legales (Aviso legal y Privacidad)</h3>
        {field('legalName', 'Razón social o nombre del titular', { placeholder: 'El Fogón Alicante S.L.' })}
        {field('nif', 'NIF / CIF', { placeholder: 'B00000000' })}
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-sm font-bold text-[#C8A45D] pb-2 border-b border-stone-800">Horario de reservas online</h3>
        <div className="grid grid-cols-2 gap-3">
          {field('bookingStart', 'Primera hora reservable', { type: 'time' })}
          {field('bookingEnd', 'Última hora reservable', { type: 'time' })}
        </div>
        <p className="text-[10px] text-stone-500">Los clientes podrán elegir horas cada 30 minutos dentro de esta franja.</p>
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-sm font-bold text-[#C8A45D] pb-2 border-b border-stone-800">Impresora de tickets</h3>
        <label className="flex items-center gap-2 text-stone-300 font-semibold">
          <input
            type="checkbox"
            checked={!!settings.printerEnabled}
            onChange={e => setSettings({ ...settings, printerEnabled: e.target.checked })}
            className="accent-[#C8A45D]"
          />
          Imprimir automáticamente cada comanda
        </label>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">{field('printerIp', 'IP de la impresora', { placeholder: '192.168.1.100' })}</div>
          {field('printerPort', 'Puerto', { type: 'number' })}
        </div>
        <p className="text-[10px] text-stone-500">La impresora debe estar en la misma red que el ordenador o servidor donde corre la app.</p>
          <PrinterTest />
      </section>

      <button
        type="submit"
        disabled={isSaving}
        className="w-full py-3 bg-[#C8A45D] hover:bg-amber-400 text-[#121212] font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition shadow-lg disabled:opacity-50"
      >
        <Save className="w-4 h-4" />
        <span>{isSaving ? 'Guardando…' : 'Guardar ajustes'}</span>
      </button>
    </form>

    <form onSubmit={handleChangePin} className="bg-[#1A1A1A] border border-stone-800 rounded-2xl p-4 space-y-3 shadow-xl text-xs mt-3.5">
      <h3 className="font-display text-sm font-bold text-[#C8A45D] pb-2 border-b border-stone-800">🔑 PIN del personal</h3>
      <label className="flex items-start gap-2 text-stone-300">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={settings.allowPinLogin !== false}
          onChange={async (e) => {
            const allowPinLogin = e.target.checked;
            try {
              const saved = await api('/api/settings', { method: 'PUT', body: { allowPinLogin } });
              setSettings(saved);
            } catch (err) { alert(err.message); }
          }}
        />
        <span>
          Permitir entrar con el PIN compartido del local.
          <span className="block text-[10px] text-stone-500">Cuando cada persona tenga su usuario (pestaña Equipo), desactívalo: así todo queda registrado con nombre. Para desactivarlo debe existir al menos un usuario Administrador.</span>
        </span>
      </label>
      {pinSource === 'env' ? (
        <p className="text-stone-400">El PIN está fijado en el servidor con la variable <code className="text-[#E6C687]">STAFF_PIN</code>. Para cambiarlo, edítala allí.</p>
      ) : (
        <>
          {pinSource === 'dev' && (
            <p className="p-2.5 rounded-xl bg-amber-950/40 border border-amber-800/60 text-amber-200">
              Estás usando el PIN de desarrollo <strong>1234</strong>. Cámbialo antes de entregar la web al local.
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[['current', 'PIN actual'], ['next', 'PIN nuevo (4-12 números)'], ['repeat', 'Repite el PIN nuevo']].map(([k, label]) => (
              <div key={k}>
                <label htmlFor={`pin-${k}`} className="block text-stone-300 mb-1 font-semibold">{label}</label>
                <input
                  id={`pin-${k}`}
                  type="password"
                  inputMode="numeric"
                  autoComplete={k === 'current' ? 'current-password' : 'new-password'}
                  maxLength={12}
                  value={pinForm[k]}
                  onChange={e => setPinForm({ ...pinForm, [k]: e.target.value.replace(/\D/g, '') })}
                  className="w-full bg-[#121212] border border-stone-700 rounded-xl p-2.5 text-stone-200 font-mono tracking-widest outline-none focus:border-[#C8A45D]"
                />
              </div>
            ))}
          </div>
          {pinMsg && <p className={pinMsg.ok ? 'text-green-300' : 'text-red-300'} role="status">{pinMsg.text}</p>}
          <button
            type="submit"
            disabled={!pinForm.current || !pinForm.next || !pinForm.repeat}
            className="w-full py-2.5 bg-[#14281D] border border-[#C8A45D]/60 text-[#E6C687] font-bold rounded-xl disabled:opacity-40"
          >
            Cambiar PIN
          </button>
        </>
      )}
    </form>

    <BackupSection />
    </>
  );
};
