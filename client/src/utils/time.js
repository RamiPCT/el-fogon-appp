// Fecha y hora en la zona horaria del local (Alicante → Europe/Madrid),
// para que un turista con el móvil en otra zona vea las horas correctas.

export const RESTAURANT_TZ = 'Europe/Madrid';

export const clockNow = (withSeconds = false) =>
  new Date().toLocaleTimeString('es-ES', {
    timeZone: RESTAURANT_TZ,
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hourCycle: 'h23'
  });

// 'YYYY-MM-DD' de hoy en el local
export const todayStr = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: RESTAURANT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// '2026-11-22' -> 'dom, 22 nov' / 'Sun, 22 Nov'
export const prettyDate = (yyyyMmDd, lang = 'es') => {
  if (!yyyyMmDd) return '';
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return date.toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
};

// Suma días a 'YYYY-MM-DD'
export const addDays = (yyyyMmDd, n) => {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n, 12));
  return dt.toISOString().slice(0, 10);
};

// Minutos actuales en el local
export const nowMinutes = () => {
  const [h, m] = clockNow().split(':').map(Number);
  return h * 60 + m;
};

// Horarios cada 30 min entre start y end ('HH:MM'); para hoy, solo los que quedan (+15 min de margen)
export const timeSlots = (dateStr, start = '12:00', end = '23:30') => {
  const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
  let from = toMin(start);
  const to = toMin(end);
  if (dateStr === todayStr()) from = Math.max(from, Math.ceil((nowMinutes() + 15) / 30) * 30);
  const out = [];
  for (let x = from; x <= to; x += 30) out.push(`${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`);
  return out;
};
