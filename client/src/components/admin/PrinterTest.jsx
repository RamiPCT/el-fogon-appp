import React, { useState } from 'react';
import { api } from '../../utils/api';

const LABELS = {
  PRINTED: '✅ Ticket impreso. Revisa que se lean bien los acentos, la ñ y el €.',
  SIMULATED_SUCCESS: 'ℹ️ La impresión automática está desactivada: el ticket solo se ha simulado. Actívala arriba y guarda los ajustes.',
  SIMULATED_LOCAL: '⚠️ No se encontró la impresora en esa IP y puerto. Comprueba que esté encendida y en la misma red.',
  ERROR: '❌ La impresora respondió con un error.'
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
      setResult(LABELS[r.status] || r.status);
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
