// Sonidos del KDS con un ÚNICO AudioContext (los navegadores limitan cuántos se pueden crear).
// En móviles/tablets el audio solo se activa tras un toque del usuario: usa unlockAudio().

let ctx = null;

const getCtx = () => {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
};

export const isAudioLocked = () => {
  const c = getCtx();
  return !c || c.state !== 'running';
};

export const unlockAudio = async () => {
  const c = getCtx();
  if (!c) return false;
  try {
    if (c.state !== 'running') await c.resume();
    // Un sonido silencioso termina de desbloquear iOS
    const o = c.createOscillator();
    const g = c.createGain();
    g.gain.value = 0;
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + 0.01);
  } catch (_) { /* ignorar */ }
  return c.state === 'running';
};

const tone = (freq, delay, duration, volume = 0.3, type = 'sine') => {
  const c = getCtx();
  if (!c || c.state !== 'running') return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime + delay);
  gain.gain.setValueAtTime(volume, c.currentTime + delay);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + duration);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(c.currentTime + delay);
  osc.stop(c.currentTime + delay + duration);
};

// Nueva comanda: campana de dos tonos
export const playOrderChime = () => {
  tone(880, 0, 0.8);
  tone(1320, 0.15, 1.2);
};

// Llamada de mesa (camarero / cuenta): tres toques cortos
export const playCallChime = () => {
  tone(1046, 0, 0.18, 0.28, 'triangle');
  tone(1046, 0.22, 0.18, 0.28, 'triangle');
  tone(1568, 0.44, 0.5, 0.28, 'triangle');
};

// Reserva nueva desde la web: tres notas ascendentes suaves
export const playReservationChime = () => {
  tone(660, 0, 0.35, 0.25);
  tone(880, 0.18, 0.35, 0.25);
  tone(1175, 0.36, 0.7, 0.25);
};
