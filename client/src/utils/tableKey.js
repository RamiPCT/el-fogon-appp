import { storage } from './api';

// Clave del QR de cada mesa escaneada en este móvil (la pide el servidor para pedir desde la mesa)
const KEY = 'fogon_table_keys';
const read = () => { try { return JSON.parse(storage.get(KEY) || '{}'); } catch (_) { return {}; } };

export const getTableKey = (tableNumber) => (tableNumber ? read()[tableNumber] || '' : '');
export const setTableKey = (tableNumber, key) => {
  const all = read();
  all[tableNumber] = key;
  storage.set(KEY, JSON.stringify(all));
};
export const tableKeyHeaders = (tableNumber) => {
  const k = getTableKey(tableNumber);
  return k ? { 'X-Table-Key': k } : {};
};
