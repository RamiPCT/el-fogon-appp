import React, { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { staffLogin } from '../utils/api';

const OUTDATED = 'El servidor está desactualizado. Cierra todas las terminales y vuelve a ejecutar «npm start».';
const inputCls = 'w-full bg-[#121212] border border-stone-700 rounded-xl p-2.5 text-stone-100 outline-none focus:border-[#C8A45D]';

// Acceso del personal: cada empleado con su usuario, o el PIN del local (si está permitido).
// Las credenciales se comprueban en el servidor.
export const StaffLogin = ({ onSuccess }) => {
  const [mode, setMode] = useState('pin'); // 'user' | 'pin'
  const [pin, setPin] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState({ devPin: null, pinAllowed: true, hasEmployees: false });

  useEffect(() => {
    fetch('/api/auth/info')
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(d => {
        const next = { devPin: d.devPin, pinAllowed: d.pinAllowed !== false, hasEmployees: !!d.hasEmployees };
        setInfo(next);
        if (next.hasEmployees || !next.pinAllowed) setMode('user');
      })
      .catch((status) => { if (status === 404) setError(OUTDATED); });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (mode === 'pin' ? !pin : !username || !password) return;
    setLoading(true);
    setError('');
    try {
      await staffLogin(mode === 'pin' ? pin : { username: username.trim(), password });
      setPin('');
      setPassword('');
      onSuccess && onSuccess();
    } catch (err) {
      setError(err.status === 404 ? OUTDATED : (err.message || 'No se pudo iniciar sesión'));
      setPin('');
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  const tab = (id, label) => (
    <button
      type="button"
      onClick={() => { setMode(id); setError(''); }}
      className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition ${mode === id ? 'bg-[#C8A45D] text-[#121212]' : 'text-stone-400 hover:text-white'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="bg-[#1A1A1A] border border-[#C8A45D]/60 rounded-2xl p-5 shadow-2xl space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-stone-800">
        <KeyRound className="w-4 h-4 text-[#C8A45D]" />
        <h3 className="font-display text-sm font-bold text-[#F4EFE6]">Acceso de personal</h3>
      </div>

      {info.pinAllowed && (
        <div className="flex gap-1 bg-[#121212] p-1 rounded-xl border border-stone-800">
          {tab('user', 'Mi usuario')}
          {tab('pin', 'PIN del local')}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        {mode === 'pin' ? (
          <>
            <label htmlFor="staff-pin" className="block text-xs text-stone-400">Introduce el PIN del local:</label>
            <input
              id="staff-pin" type="password" inputMode="numeric" autoComplete="current-password" maxLength={12} autoFocus
              value={pin} onChange={(e) => { setPin(e.target.value); setError(''); }} placeholder="PIN"
              className={`${inputCls} text-center text-lg tracking-widest font-mono`}
            />
            {info.devPin && (
              <p className="text-[11px] text-amber-200 bg-amber-950/40 border border-amber-800/60 rounded-lg px-2.5 py-1.5 text-center">
                PIN de desarrollo: <strong className="font-mono tracking-widest">{info.devPin}</strong> · cámbialo en Admin → Ajustes
              </p>
            )}
          </>
        ) : (
          <>
            <label htmlFor="staff-user" className="block text-xs text-stone-400">Usuario
              <input
                id="staff-user" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus
                value={username} onChange={(e) => { setUsername(e.target.value); setError(''); }} className={`${inputCls} mt-1 text-sm`}
              />
            </label>
            <label htmlFor="staff-pass" className="block text-xs text-stone-400">Contraseña
              <input
                id="staff-pass" type="password" autoComplete="current-password"
                value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }} className={`${inputCls} mt-1 text-sm`}
              />
            </label>
            {!info.hasEmployees && info.pinAllowed && (
              <p className="text-[11px] text-stone-400">Aún no hay usuarios creados: entra con el PIN del local y créalos en Admin → Equipo.</p>
            )}
          </>
        )}
        {error && <p className="text-[11px] text-red-400 text-center font-semibold" role="alert">{error}</p>}
        <button
          type="submit"
          disabled={loading || (mode === 'pin' ? !pin : !username || !password)}
          className="w-full py-2.5 bg-[#C8A45D] hover:bg-amber-400 text-[#121212] font-bold text-xs rounded-xl shadow-lg transition disabled:opacity-50"
        >
          {loading ? 'Comprobando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
};
