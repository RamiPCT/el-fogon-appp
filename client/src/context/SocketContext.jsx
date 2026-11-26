import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { getStaffToken } from '../utils/api';

const SocketContext = createContext(null);

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // El token de personal (si existe) da acceso a las comandas y reservas en tiempo real
    const newSocket = io(window.location.origin, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      auth: (cb) => cb({ token: getStaffToken() })
    });

    newSocket.on('connect', () => setIsConnected(true));
    newSocket.on('disconnect', () => setIsConnected(false));

    // Al iniciar o cerrar sesión de personal, reconectar con las nuevas credenciales
    const handleAuthChange = () => {
      newSocket.disconnect();
      newSocket.connect();
    };
    window.addEventListener('auth:changed', handleAuthChange);

    // Los móviles congelan la pestaña al bloquear la pantalla o cambiar de app y la conexión
    // puede quedar muerta sin avisar. Al volver, se reconecta y cada pantalla recarga sus datos.
    let hiddenAt = 0;
    const resync = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (!newSocket.connected || Date.now() - hiddenAt > 3000) {
        newSocket.disconnect();
        newSocket.connect();
      }
    };
    const onOnline = () => { newSocket.disconnect(); newSocket.connect(); };
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('pageshow', resync);
    window.addEventListener('online', onOnline);

    setSocket(newSocket);

    return () => {
      window.removeEventListener('auth:changed', handleAuthChange);
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('pageshow', resync);
      window.removeEventListener('online', onOnline);
      newSocket.close();
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => {
  return useContext(SocketContext);
};
