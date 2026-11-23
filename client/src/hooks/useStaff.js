import { useEffect, useState } from 'react';
import { getStaffInfo } from '../utils/api';

// Empleado con sesión iniciada: { id, name, role, permissions } o null
export const useStaff = () => {
  const [staff, setStaff] = useState(getStaffInfo);
  useEffect(() => {
    const sync = () => setStaff(getStaffInfo());
    window.addEventListener('auth:changed', sync);
    return () => window.removeEventListener('auth:changed', sync);
  }, []);
  const can = (perm) => !!staff?.permissions?.includes(perm);
  return { staff, can };
};

export const ROLE_LABELS = { admin: 'Administrador', manager: 'Encargado', waiter: 'Camarero', kitchen: 'Cocina', bar: 'Barra' };
