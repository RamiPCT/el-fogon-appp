import React, { createContext, useContext, useEffect, useState } from 'react';
import { useSocket } from './SocketContext';

// Datos públicos del local (WhatsApp, dirección, horario, enlaces...) editables desde Admin → Ajustes
const SettingsContext = createContext({});

export const SettingsProvider = ({ children }) => {
  const { socket } = useSocket();
  const [settings, setSettings] = useState({});

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(setSettings)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onUpdate = (s) => setSettings(prev => ({ ...prev, ...s }));
    socket.on('settings:update', onUpdate);
    return () => socket.off('settings:update', onUpdate);
  }, [socket]);

  return <SettingsContext.Provider value={settings}>{children}</SettingsContext.Provider>;
};

export const useSettings = () => useContext(SettingsContext);

// Utilidades derivadas
export const waLink = (phone, text = '') => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
};

export const mapsLink = (s) => {
  if (s.mapsUrl) return s.mapsUrl;
  if (!s.address) return null;
  const q = [s.address, s.postalCode, s.city || 'Alicante'].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
};
