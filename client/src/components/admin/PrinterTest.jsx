import React, { useState } from 'react';
import { api } from '../../utils/api';

export const PRINT_STATUS = {
  SENT: '✅ Enviado a la impresora. Revisa que se lean bien los acentos, la ñ y el €.',
  DISABLED: 'ℹ️ No se imprimió: la impresión está desactivada. Actívala arriba y guarda los ajustes.',
  FAILED: '❌ No se imprimió: no se pudo conectar con la impresora. Comprueba que esté encendida, en la misma red y con esa IP y puerto.',
  // Nombres antiguos (por compatibilidad)
  PRINTED: '✅ Enviado a la impresora.',
  SIMULATED_SUCCESS: 'ℹ️ No se imprimió: la impresión está desactivada.',
  SIMULATED_LOCAL: '❌ No se imprimió: no se encontró la impresora.',
  ERROR: '❌ No se imprimió: la impresora dio un error.'
};

// Botón para imprimir un ticket de prueba (guarda antes los ajustes si cambiaste la IP)
export const PrinterTest = () => {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await api('/api/printer/test', { method: 'POST', body: {} });
      setResult((PRINT_STATUS[r.status] || r.status) + (r.error && r.status !== 'DISABLED' ? ` (${r.error})` : ''));
    } catch (err) {
      setResult(`❌ ${err.message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={test} disabled={busy} className="px-3 py-2 bg-[#14281D] border border-[#C8A45D]/60 text-[#E6C687] font-bold rounded-xl disabled:opacity-50">
        {busy ? 'Probando…' : '🖨️ Imprimir ticket de prueba'}
      </button>
      {result && <span className="text-[11px] text-stone-300" role="status">{result}</span>}
    </div>
  );
};
