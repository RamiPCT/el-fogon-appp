import React, { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { staffLogin } from '../utils/api';

// Formulario de PIN del personal. El PIN se comprueba en el servidor.
export const StaffLogin = ({ onSuccess }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [devPin, setDevPin] = useState(null);

  useEffect(() => {
    fetch('/api/auth/info')
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(d => setDevPin(d.devPin))
      .catch((status) => {
        if (status === 404) setError('El servidor está desactualizado. Cierra todas las terminales y vuelve a ejecutar «npm run dev».');
      });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!pin) return;
    setLoading(true);
    setError('');
    try {
      await staffLogin(pin);
      setPin('');
      onSuccess && onSuccess();
    } catch (err) {
      setError(err.status === 404
        ? 'El servidor está desactualizado. Cierra todas las terminales y vuelve a ejecutar «npm run dev».'
        : (err.message || 'No se pudo iniciar sesión'));
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#1A1A1A] border border-[#C8A45D]/60 rounded-2xl p-5 shadow-2xl space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-stone-800">
        <KeyRound className="w-4 h-4 text-[#C8A45D]" />
        <h3 className="font-display text-sm font-bold text-[#F4EFE6]">Acceso de personal</h3>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <label htmlFor="staff-pin" className="block text-xs text-stone-400">
          Introduce el PIN para acceder a la barra y la administración:
        </label>
        <input
          id="staff-pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          maxLength={12}
          autoFocus
          value={pin}
          onChange={(e) => { setPin(e.target.value); setError(''); }}
          placeholder="PIN"
          className="w-full text-center text-lg tracking-widest bg-[#121212] border border-stone-700 rounded-xl p-2.5 text-stone-100 font-mono outline-none focus:border-[#C8A45D]"
        />
        {devPin && (
          <p className="text-[11px] text-amber-200 bg-amber-950/40 border border-amber-800/60 rounded-lg px-2.5 py-1.5 text-center">
            PIN de desarrollo: <strong className="font-mono tracking-widest">{devPin}</strong> · cámbialo en Admin → Ajustes
          </p>
        )}
        {error && (
          <p className="text-[11px] text-red-400 text-center font-semibold" role="alert">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading || !pin}
          className="w-full py-2.5 bg-[#C8A45D] hover:bg-amber-400 text-[#121212] font-bold text-xs rounded-xl shadow-lg transition disabled:opacity-50"
        >
          {loading ? 'Comprobando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
};
