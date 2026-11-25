// Importes en céntimos → texto en euros
export const eur = (cents) => `${((cents || 0) / 100).toFixed(2).replace('.', ',')} €`;

// Clave única por intento de cobro (evita cobros duplicados por doble toque o reintento)
export const newKey = () => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// Abre el ticket en una ventana de 80 mm y lanza la impresión del navegador
export const printTicketText = (title, text) => {
  const win = window.open('', '_blank', 'width=420,height=700');
  if (!win) { alert('El navegador bloqueó la ventana. Permite las ventanas emergentes para imprimir.'); return; }
  const esc = String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${title}</title>
<style>@page{size:80mm auto;margin:3mm}body{margin:0}pre{font:12px/1.35 'Courier New',monospace;white-space:pre-wrap;margin:0}</style>
</head><body><pre>${esc}</pre></body></html>`);
  win.document.close();
  // Se imprime desde aquí (sin scripts dentro de la ventana, por la política de seguridad)
  setTimeout(() => { try { win.focus(); win.print(); } catch { /* ventana cerrada */ } }, 300);
};
