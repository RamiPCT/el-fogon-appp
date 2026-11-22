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

    setSocket(newSocket);

    return () => {
      window.removeEventListener('auth:changed', handleAuthChange);
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
