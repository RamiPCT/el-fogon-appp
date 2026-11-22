// Utilidades de fecha y hora siempre en la zona horaria del local (por defecto Madrid),
// sin depender de la zona horaria del servidor donde se publique la app.

const DEFAULT_TZ = 'Europe/Madrid';

function parts(tz = DEFAULT_TZ, date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

// 'YYYY-MM-DD' de hoy en la zona del local
function todayStr(tz) {
  return parts(tz).date;
}

// Minutos transcurridos desde la medianoche, en la zona del local
function nowMinutes(tz) {
  return parts(tz).minutes;
}

// 'HH:MM' -> minutos (o null si el formato no es válido)
function toMinutes(hhmm) {
  if (typeof hhmm !== 'string' || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

// minutos -> 'HH:MM'
function fromMinutes(total) {
  const t = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function isValidDate(str) {
  return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str) && !Number.isNaN(Date.parse(str));
}

function formatDate(iso, tz = DEFAULT_TZ) {
  return new Date(iso).toLocaleDateString('es-ES', { timeZone: tz });
}

function formatTime(iso, tz = DEFAULT_TZ) {
  return new Date(iso).toLocaleTimeString('es-ES', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

// '2026-11-22' -> '22/11/2026'
function prettyDate(yyyyMmDd) {
  if (!isValidDate(yyyyMmDd)) return yyyyMmDd || '';
  const [y, m, d] = yyyyMmDd.split('-');
  return `${d}/${m}/${y}`;
}

module.exports = { DEFAULT_TZ, todayStr, nowMinutes, toMinutes, fromMinutes, isValidDate, formatDate, formatTime, prettyDate };
