import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';
import { Settings, Users, Calendar, Sliders, Save, Plus, Trash2, Phone, MessageSquare, Printer, Check, X, Move, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Clock, Maximize2, ShieldAlert } from 'lucide-react';
import { DeleteTableModal } from '../components/DeleteTableModal';
import { FloorPlan, ELEMENT_TYPES } from '../components/FloorPlan';
import { api, getStaffToken } from '../utils/api';
import { todayStr, prettyDate } from '../utils/time';
import { ALLERGEN_LABELS } from '../components/admin/labels';
import { ReservationsTab } from '../components/admin/ReservationsTab';
import { MenuTab } from '../components/admin/MenuTab';
import { SettingsTab } from '../components/admin/SettingsTab';
import { ReservationAlerts } from '../components/ReservationAlerts';
import { TeamTab } from '../components/admin/TeamTab';
import { AuditTab } from '../components/admin/AuditTab';
import { QrSection } from '../components/admin/QrSection';
import { ComanderaTab } from '../components/admin/ComanderaTab';
import { useStaff, ROLE_LABELS } from '../hooks/useStaff';
import { onImgError } from '../utils/images';


export const AdminDashboard = () => {
  const { socket } = useSocket();
  const { staff: me, can } = useStaff();
  // Pestañas según los permisos del usuario (el servidor los vuelve a comprobar en cada acción)
  const TABS = [
    { id: 'comandera', label: '📝 Comandera', show: can('orders.create') && !can('floor.manage') },
    { id: 'visual_map', label: '🗺️ Plano', show: can('floor.manage') },
    { id: 'comandera', label: '📝 Comandera', show: can('orders.create') && can('floor.manage') },
    { id: 'reservations', label: '📅 Reservas', show: can('reservations.manage') },
    { id: 'menu', label: '🍽️ Carta', show: can('menu.manage') || can('menu.availability') },
    { id: 'team', label: '👥 Equipo', show: can('staff.manage') },
    { id: 'audit', label: '📜 Historial', show: can('audit.view') },
    { id: 'settings', label: '⚙️ Ajustes', show: can('settings.manage') }
  ].filter(t => t.show);
  const [activeTab, setActiveTab] = useState(() => TABS[0]?.id || 'none');
  useEffect(() => {
    if (!TABS.some(t => t.id === activeTab) && TABS[0]) setActiveTab(TABS[0].id);
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tables, setTables] = useState([]);
  const [selectedTableId, setSelectedTableId] = useState(null);
  const [tableToDelete, setTableToDelete] = useState(null); // Modal de confirmación estilizado
  const [reservations, setReservations] = useState([]);
  const [stepSize, setStepSize] = useState(20); // Paso de movimiento con flechas
  // Plano del local
  const [floor, setFloor] = useState(null);
  const [selected, setSelected] = useState(null); // { kind: 'table'|'element', id }
  const [editMode, setEditMode] = useState('move'); // 'move' | 'paint'
  const [zoom, setZoom] = useState(1);
  const [showFloorSize, setShowFloorSize] = useState(false);
  const [layoutDirty, setLayoutDirtyState] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = layoutDirty;
  const editVersion = useRef(0);       // aumenta con cada cambio del plano
  const setLayoutDirty = (v) => {
    if (v) editVersion.current += 1;
    setLayoutDirtyState(v);
  };
  const [saveState, setSaveState] = useState('saved'); // 'saved' | 'pending' | 'saving' | 'error'
  const [saveError, setSaveError] = useState('');
  const [loadErrors, setLoadErrors] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const tablesRef = useRef([]);
  const floorRef = useRef(null);
  
  // Estado local para programar reserva en mesa seleccionada
  const [scheduleDate, setScheduleDate] = useState(todayStr());
  const [scheduleTime, setScheduleTime] = useState('21:00');
  const [scheduleName, setScheduleName] = useState('');
  const [scheduleGuests, setScheduleGuests] = useState(4);

  const [settings, setSettings] = useState({
    ownerPhone: '',
    bufferMinutes: 15,
    googleReviewUrl: '',
    printerEnabled: false,
    printerIp: '192.168.1.100',
    printerPort: 9100,
    barPosition: 'top'
  });
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [allergenKeys, setAllergenKeys] = useState(Object.keys(ALLERGEN_LABELS));
  // Plano de respaldo que abarca todas las mesas (por si el servidor no devuelve el plano)
  const fallbackFloor = (tbls) => {
    const maxX = tbls.reduce((m, t) => Math.max(m, (t.x || 0) + (t.width || 60)), 360);
    const maxY = tbls.reduce((m, t) => Math.max(m, (t.y || 0) + (t.height || 60)), 360);
    return { cols: Math.min(80, Math.ceil((maxX + 20) / 20)), rows: Math.min(80, Math.ceil((maxY + 20) / 20)), cell: 20, voids: [], elements: [] };
  };

  // Carga cada dato por separado: si uno falla, el resto se muestra igual
  const fetchData = async () => {
    const names = ['mesas', 'reservas', 'ajustes', 'carta', 'plano'];
    const results = await Promise.allSettled([
      api('/api/tables'),
      can('reservations.manage') ? api('/api/reservations') : Promise.resolve(null),
      api('/api/settings'),
      api(can('menu.manage') ? '/api/menu?all=1' : '/api/menu'),
      api('/api/floor')
    ]);
    const [tblR, resR, setR, menuR, floorR] = results;
    const errors = results
      .map((r, i) => (r.status === 'rejected' ? `${names[i]}: ${r.reason?.message || 'error'}` : null))
      .filter(Boolean);
    setLoadErrors(errors);

    if (tblR.status === 'fulfilled' && Array.isArray(tblR.value)) {
      const tblRes = tblR.value;
      if (dirtyRef.current) {
        // Hay cambios del plano pendientes de guardar: solo se actualizan estados y reservas
        setTables(prev => prev.map(t => {
          const fresh = tblRes.find(x => x.id === t.id);
          return fresh ? { ...t, status: fresh.status, nextReservation: fresh.nextReservation } : t;
        }));
      } else {
        setTables(tblRes);
        const fl = floorR.status === 'fulfilled' && floorR.value && floorR.value.cols ? floorR.value : fallbackFloor(tblRes);
        setFloor(fl);
      }
    } else if (!dirtyRef.current && floorR.status === 'fulfilled' && floorR.value?.cols) {
      setFloor(floorR.value);
    }
    if (resR.status === 'fulfilled' && Array.isArray(resR.value)) setReservations(resR.value);
    if (setR.status === 'fulfilled' && setR.value) setSettings(setR.value);
    if (menuR.status === 'fulfilled' && menuR.value) {
      setProducts(menuR.value.products || []);
      setCategories(menuR.value.categories || []);
      if (Array.isArray(menuR.value.allergens)) setAllergenKeys(menuR.value.allergens);
    }
    setLoaded(true);
  };

  tablesRef.current = tables;
  floorRef.current = floor;

  const layoutPayload = () => ({
    positions: tablesRef.current.map(t => ({
      id: t.id,
      number: t.number,
      sectorId: t.sectorId || 'sec-salon',
      x: t.x || 0,
      y: t.y || 0,
      width: t.width || 60,
      height: t.height || 60,
      capacity: t.capacity || 4,
      shape: t.shape || 'rect',
      status: t.status || 'AVAILABLE'
    })),
    floor: floorRef.current
  });

  // Guardado del plano (automático tras cada cambio, o manual con el botón)
  const saveLayout = useCallback(async () => {
    if (!floorRef.current) return;
    const version = editVersion.current;
    setSaveState('saving');
    try {
      const data = await api('/api/tables/layout', { method: 'POST', body: layoutPayload() });
      if (editVersion.current === version) {
        setLayoutDirtyState(false);
        if (data.floor) setFloor(data.floor);
        setSaveState('saved');
      } else {
        setSaveState('pending');
      }
      setSaveError('');
    } catch (err) {
      setSaveState('error');
      setSaveError(err.message);
    }
  }, []);

  // Autoguardado: 900 ms después del último cambio
  useEffect(() => {
    if (!layoutDirty) return;
    setSaveState(s => (s === 'saving' ? s : 'pending'));
    const timer = setTimeout(saveLayout, 900);
    return () => clearTimeout(timer);
  }, [tables, floor, layoutDirty, saveLayout]);

  // Si se sale del panel o se cierra la pestaña con cambios pendientes, se guardan igual
  useEffect(() => {
    const flush = () => {
      if (!dirtyRef.current || !floorRef.current) return;
      const token = getStaffToken();
      try {
        fetch('/api/tables/layout', {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(layoutPayload())
        });
      } catch (_) { /* nada que hacer */ }
    };
    window.addEventListener('beforeunload', flush);
    return () => { window.removeEventListener('beforeunload', flush); flush(); };
  }, []);

  useEffect(() => {
    fetchData();
  }, []);

  // Reservas nuevas o canceladas en tiempo real
  useEffect(() => {
    if (!socket) return;
    const refreshReservations = () => api('/api/reservations').then(setReservations).catch(() => {});
    const refreshTables = () => api('/api/tables').then(tbl => {
      // Solo se refrescan estados y reservas; las posiciones en edición no se tocan
      setTables(prev => prev.map(t => {
        const fresh = tbl.find(x => x.id === t.id);
        return fresh ? { ...t, status: fresh.status, nextReservation: fresh.nextReservation } : t;
      }));
    }).catch(() => {});
    const onReservation = () => { refreshReservations(); refreshTables(); };
    // Si el plano se cambia desde otro dispositivo y aquí no hay cambios pendientes, se sincroniza
    const onLayout = () => { if (!dirtyRef.current) fetchData(); };
    const onConnect = () => { if (!dirtyRef.current) fetchData(); };
    socket.on('reservation:new', onReservation);
    socket.on('reservation:cancelled', onReservation);
    socket.on('table:status_update', refreshTables);
    socket.on('floor:update', onLayout);
    socket.on('connect', onConnect);
    return () => {
      socket.off('reservation:new', onReservation);
      socket.off('reservation:cancelled', onReservation);
      socket.off('table:status_update', refreshTables);
      socket.off('floor:update', onLayout);
      socket.off('connect', onConnect);
    };
  }, [socket]);

  const selectedTable = tables.find(t => t.id === selectedTableId);

  // ---------- Plano: límites reales de la cuadrícula ----------
  const cell = floor?.cell || 20;
  const floorW = (floor?.cols || 20) * cell;
  const floorH = (floor?.rows || 20) * cell;
  const selectedElement = selected?.kind === 'element' ? (floor?.elements || []).find(e => e.id === selected.id) : null;

  const patchTable = (id, fn) => {
    setTables(prev => prev.map(t => (t.id === id ? fn(t) : t)));
    setLayoutDirty(true);
  };

  // Mover la mesa seleccionada con las flechas (dentro de todo el plano)
  const handleMoveTable = (dx, dy) => {
    if (!selectedTableId) return;
    patchTable(selectedTableId, t => {
      const w = t.width || 60;
      const h = t.height || 60;
      return {
        ...t,
        x: Math.max(0, Math.min(floorW - w, (t.x || 0) + dx)),
        y: Math.max(0, Math.min(floorH - h, (t.y || 0) + dy))
      };
    });
  };

  // Cambiar tamaño de la mesa (sin salirse del plano)
  const handleResizeTable = (dWidth, dHeight) => {
    if (!selectedTableId) return;
    patchTable(selectedTableId, t => {
      const round = t.shape === 'round' || t.shape === 'bar_stool';
      const dw = round ? (dWidth || dHeight) : dWidth;
      const dh = round ? (dWidth || dHeight) : dHeight;
      let width = Math.max(30, Math.min(floorW - (t.x || 0), (t.width || 60) + dw));
      let height = Math.max(30, Math.min(floorH - (t.y || 0), (t.height || 60) + dh));
      if (round) { const side = Math.min(width, height); width = side; height = side; }
      return { ...t, width, height };
    });
  };

  const handleShapeChange = (shape) => {
    if (!selectedTableId) return;
    patchTable(selectedTableId, t => ({
      ...t,
      shape,
      sectorId: shape === 'bar_stool' ? 'sec-barra' : (t.sectorId === 'sec-barra' ? 'sec-salon' : t.sectorId),
      ...(shape === 'round' || shape === 'bar_stool' ? { height: t.width || 60 } : {})
    }));
  };

  const handleCapacityChange = (delta) => {
    if (!selectedTableId) return;
    patchTable(selectedTableId, t => ({ ...t, capacity: Math.max(1, Math.min(30, (t.capacity || 2) + delta)) }));
  };

  const handleTableNumberChange = (value) => {
    if (!selectedTableId) return;
    patchTable(selectedTableId, t => ({ ...t, number: value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) }));
  };

  // Cambios desde el lienzo (arrastrar / redimensionar)
  const handleCanvasChange = (kind, id, patch) => {
    if (kind === 'table') patchTable(id, t => ({ ...t, ...patch }));
    else updateElement(id, patch);
  };

  const updateElement = (id, patch) => {
    setFloor(prev => ({
      ...prev,
      elements: prev.elements.map(el => {
        if (el.id !== id) return el;
        const next = { ...el, ...patch };
        next.w = Math.max(cell / 2, Math.min(floorW, next.w));
        next.h = Math.max(cell / 2, Math.min(floorH, next.h));
        next.x = Math.max(0, Math.min(floorW - next.w, next.x));
        next.y = Math.max(0, Math.min(floorH - next.h, next.y));
        return next;
      })
    }));
    setLayoutDirty(true);
  };

  const nudgeElement = (id, d) => {
    const el = (floor?.elements || []).find(e => e.id === id);
    if (el) updateElement(id, { w: el.w + (d.w || 0), h: el.h + (d.h || 0) });
  };

  const handleAddElement = (type) => {
    const meta = ELEMENT_TYPES[type];
    const w = Math.min(meta.w, floorW);
    const h = Math.min(meta.h, floorH);
    const el = {
      id: `el-${Date.now().toString(36)}`,
      type,
      x: Math.round((floorW - w) / 2 / cell) * cell,
      y: Math.round((floorH - h) / 2 / cell) * cell,
      w,
      h,
      label: meta.label
    };
    setFloor(prev => ({ ...prev, elements: [...(prev.elements || []), el] }));
    setSelected({ kind: 'element', id: el.id });
    setSelectedTableId(null);
    setLayoutDirty(true);
  };

  const handleDeleteElement = (id) => {
    setFloor(prev => ({ ...prev, elements: prev.elements.filter(e => e.id !== id) }));
    setSelected(null);
    setLayoutDirty(true);
  };

  // Pintar celdas fuera del local
  const handlePaint = (key, value) => {
    setFloor(prev => {
      const set = new Set(prev.voids || []);
      if (value) set.add(key); else set.delete(key);
      return { ...prev, voids: [...set] };
    });
    setLayoutDirty(true);
  };

  const handleClearShape = () => {
    setFloor(prev => ({ ...prev, voids: [] }));
    setLayoutDirty(true);
  };

  // Ampliar o reducir la cuadrícula; lo que quede fuera se recoloca dentro
  const handleResizeFloor = (key, delta) => {
    if (!floor) return;
    const next = Math.max(8, Math.min(80, (floor[key] || 20) + delta));
    const W = (key === 'cols' ? next : floor.cols) * cell;
    const H = (key === 'rows' ? next : floor.rows) * cell;
    setFloor(prev => ({
      ...prev,
      [key]: next,
      voids: (prev.voids || []).filter(v => {
        const [c, r] = v.split(',').map(Number);
        return c < W / cell && r < H / cell;
      }),
      elements: (prev.elements || []).map(el => {
        const w = Math.min(el.w, W);
        const h = Math.min(el.h, H);
        return { ...el, w, h, x: Math.min(el.x, W - w), y: Math.min(el.y, H - h) };
      })
    }));
    setTables(prev => prev.map(t => {
      const w = Math.min(t.width || 60, W);
      const h = Math.min(t.height || 60, H);
      return { ...t, width: w, height: h, x: Math.min(t.x || 0, W - w), y: Math.min(t.y || 0, H - h) };
    }));
    setLayoutDirty(true);
  };

  const handleTableStatusChange = async (tableId, newStatus) => {
    try {
      const updated = await api(`/api/tables/${tableId}`, { method: 'PUT', body: { status: newStatus } });
      setTables(prev => prev.map(t => t.id === tableId ? { ...t, status: updated.status, nextReservation: updated.nextReservation } : t));
    } catch (err) {
      alert(`Error al actualizar estado: ${err.message}`);
    }
  };

  // Programar Reserva en la Mesa Seleccionada
  const handleScheduleReservation = async () => {
    if (!selectedTable) return;
    try {
      const data = await api('/api/reservations', {
        method: 'POST',
        body: {
          tableId: selectedTable.id,
          tableNumber: selectedTable.number,
          customerName: scheduleName.trim() || 'Reserva telefónica',
          customerPhone: '',
          guests: scheduleGuests,
          date: scheduleDate,
          startTime: scheduleTime,
          notes: 'Reserva creada desde el panel'
        }
      });
      if (data.success) {
        alert(`✅ Reserva creada: mesa ${selectedTable.number}, ${prettyDate(scheduleDate)} a las ${scheduleTime} h`);
        setScheduleName('');
        fetchData();
      }
    } catch (err) {
      alert(`No se pudo crear la reserva: ${err.message}`);
    }
  };

  // Quitar Reserva de la Mesa Seleccionada
  const handleRemoveReservation = async () => {
    if (!selectedTable || !selectedTable.nextReservation) {
      handleTableStatusChange(selectedTable.id, 'AVAILABLE');
      return;
    }
    try {
      await api(`/api/reservations/${selectedTable.nextReservation.id}`, { method: 'DELETE' });
      alert(`Reserva de la mesa ${selectedTable.number} cancelada.`);
      fetchData();
    } catch (err) {
      alert(`Error al cancelar la reserva: ${err.message}`);
    }
  };

  // Cancelar una reserva desde la lista
  const handleCancelReservation = async (reservationId) => {
    const res = reservations.find(r => r.id === reservationId);
    if (!window.confirm(`¿Cancelar la reserva de ${res?.customerName || 'este cliente'}?`)) return;
    try {
      await api(`/api/reservations/${reservationId}`, { method: 'DELETE' });
      fetchData();
    } catch (err) {
      alert(`Error al cancelar la reserva: ${err.message}`);
    }
  };

  const handleAddNewTable = (shape = 'rect') => {
    const isStool = shape === 'bar_stool';
    let num;
    if (isStool) {
      const maxB = tables.reduce((m, t) => Math.max(m, /^B\d+$/.test(t.number) ? parseInt(t.number.slice(1), 10) : 0), 0);
      num = `B${maxB + 1}`;
    } else {
      // Siguiente número libre (evita duplicados al borrar y crear mesas)
      const maxNum = tables.reduce((m, t) => Math.max(m, parseInt(t.number, 10) || 0), 0);
      num = (maxNum + 1).toString().padStart(2, '0');
    }
    const w = isStool ? 40 : shape === 'round' ? 70 : 80;
    const h = isStool ? 40 : shape === 'round' ? 70 : 60;
    const newTbl = {
      id: `tbl-${num}-${Date.now().toString(36)}`,
      number: num,
      sectorId: isStool ? 'sec-barra' : 'sec-salon',
      capacity: isStool ? 1 : shape === 'round' ? 2 : 4,
      x: Math.round((floorW - w) / 2 / cell) * cell,
      y: Math.round((floorH - h) / 2 / cell) * cell,
      width: w,
      height: h,
      shape,
      status: 'AVAILABLE'
    };
    setTables(prev => [...prev, newTbl]);
    setSelectedTableId(newTbl.id);
    setSelected({ kind: 'table', id: newTbl.id });
    setEditMode('move');
    setLayoutDirty(true);
  };

  const handleSaveLayout = () => saveLayout();

  return (
    <div className="max-w-4xl mx-auto px-3.5 py-3 space-y-3.5 pb-24">
      
      {/* Cabecera Admin y Selector de Pestañas 100% Responsivo */}
      <div className="bg-[#1A1A1A] border border-[#C8A45D]/40 rounded-2xl p-3.5 space-y-3 shadow-xl">
        <div className="flex justify-between items-center">
          <div>
            <span className="text-[10px] font-mono text-[#C8A45D] uppercase tracking-wider">
              Consola del Dueño
            </span>
            <h2 className="font-display text-base font-bold text-[#F4EFE6]">
              Gestor de Salón y Plano
            </h2>
          </div>
          <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></span>
        </div>

        {me && (
          <p className="text-[11px] text-stone-400">Sesión: <strong className="text-[#E6C687]">{me.name}</strong> · {ROLE_LABELS[me.role] || me.role}</p>
        )}

        {/* Pestañas según permisos */}
        {TABS.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-7 gap-1 bg-[#121212] p-1 rounded-xl border border-stone-800 text-[11px] sm:text-xs">
            {TABS.map(tabDef => (
              <button
                key={tabDef.id}
                onClick={() => setActiveTab(tabDef.id)}
                className={`py-2 px-1 text-center font-bold rounded-lg transition whitespace-nowrap ${activeTab === tabDef.id ? 'bg-[#C8A45D] text-[#121212] shadow-md' : 'text-stone-300 hover:text-white'}`}
              >
                {tabDef.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {TABS.length === 0 && (
        <div className="bg-[#1A1A1A] border border-stone-800 rounded-2xl p-4 text-xs text-stone-300">
          Tu usuario trabaja desde la pantalla de comandas. <a href="/kds" className="text-[#C8A45D] underline">Ir a Cocina / Barra</a>
        </div>
      )}

      <ReservationAlerts />

      {loadErrors.length > 0 && (
        <div className="bg-red-950/50 border border-red-900 rounded-2xl p-3 text-xs text-red-100 flex flex-wrap items-center justify-between gap-2" role="alert">
          <span>No se pudo cargar parte de la información ({loadErrors.join(' · ')}). Si acabas de reiniciar el servidor, recarga la página.</span>
          <button onClick={fetchData} className="px-3 py-1.5 rounded-lg bg-white text-black font-bold">Reintentar</button>
        </div>
      )}

      {/* PESTAÑA 1: EDITOR VISUAL 2D COMPLETO */}
      {activeTab === 'visual_map' && (
        <div className="bg-[#1A1A1A] border border-stone-800 rounded-2xl p-3.5 space-y-3.5 shadow-xl">
          
          <div className="flex flex-wrap justify-between items-center gap-2 pb-2 border-b border-stone-800">
            <div>
              <h3 className="font-display text-sm font-bold text-[#C8A45D]">Editor del plano</h3>
              <p className="text-[10px] text-stone-400">
                Arrastra mesas y elementos con el dedo o el ratón. La esquina azul cambia el tamaño. Los cambios se guardan solos y los clientes los ven al momento.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${
                saveState === 'saved' ? 'bg-[#14281D] border-green-800 text-green-300'
                  : saveState === 'error' ? 'bg-red-950 border-red-800 text-red-300'
                  : 'bg-amber-950 border-amber-700 text-amber-300'
              }`} role="status" aria-live="polite">
                {saveState === 'saved' ? '✓ Guardado' : saveState === 'saving' ? 'Guardando…' : saveState === 'error' ? '⚠ No guardado' : 'Cambios pendientes…'}
              </span>
              <button
                onClick={handleSaveLayout}
                disabled={saveState === 'saving'}
                className="px-3 py-1.5 bg-[#C8A45D] hover:bg-amber-400 text-[#121212] font-bold text-xs rounded-xl flex items-center gap-1.5 transition shadow-lg disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Guardar ahora</span>
              </button>
            </div>
          </div>

          {saveState === 'error' && (
            <p className="text-[11px] text-red-200 bg-red-950/50 border border-red-900 rounded-xl px-3 py-2" role="alert">
              No se pudo guardar el plano: {saveError}. Corrígelo y se guardará solo.
            </p>
          )}

          {/* Modo de edición */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-[#121212] rounded-xl border border-stone-800 text-xs font-bold">
            <button
              onClick={() => setEditMode('move')}
              className={`py-2 rounded-lg transition ${editMode === 'move' ? 'bg-[#C8A45D] text-[#121212]' : 'text-stone-300'}`}
            >
              ✋ Mover y colocar
            </button>
            <button
              onClick={() => { setEditMode('paint'); setSelected(null); }}
              className={`py-2 rounded-lg transition ${editMode === 'paint' ? 'bg-[#C8A45D] text-[#121212]' : 'text-stone-300'}`}
            >
              🖌️ Forma del local
            </button>
          </div>

          {/* Barra de herramientas */}
          {editMode === 'move' ? (
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <button onClick={() => handleAddNewTable('rect')} className="px-2.5 py-1.5 bg-[#14281D] border border-[#C8A45D]/60 text-[#E6C687] font-bold rounded-lg flex items-center gap-1">
                <Plus className="w-3 h-3" /> Mesa
              </button>
              <button onClick={() => handleAddNewTable('round')} className="px-2.5 py-1.5 bg-[#14281D] border border-[#C8A45D]/60 text-[#E6C687] font-bold rounded-lg flex items-center gap-1">
                <Plus className="w-3 h-3" /> Mesa redonda
              </button>
              <button onClick={() => handleAddNewTable('bar_stool')} className="px-2.5 py-1.5 bg-[#14281D] border border-[#C8A45D]/60 text-[#E6C687] font-bold rounded-lg flex items-center gap-1">
                <Plus className="w-3 h-3" /> Taburete
              </button>
              {Object.entries(ELEMENT_TYPES).map(([type, meta]) => (
                <button key={type} onClick={() => handleAddElement(type)} className="px-2.5 py-1.5 bg-[#121212] border border-stone-700 text-stone-200 rounded-lg">
                  {meta.icon} {meta.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="p-2.5 rounded-xl bg-sky-950/40 border border-sky-800/60 text-[11px] text-sky-100 flex flex-wrap items-center justify-between gap-2">
              <span>Pasa el dedo o el ratón por la cuadrícula para marcar las zonas que <strong>no</strong> son parte del local (se verán oscuras). Vuelve a pasar para recuperarlas.</span>
              <button onClick={handleClearShape} className="px-2.5 py-1 rounded-lg bg-[#121212] border border-stone-700 text-stone-200 shrink-0">Restablecer forma</button>
            </div>
          )}

          {/* Zoom y acceso (separado) al tamaño del salón */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-stone-300">
            <div className="flex items-center gap-1">
              <span>Zoom:</span>
              {[1, 1.5, 2].map(z => (
                <button key={z} onClick={() => setZoom(z)} className={`px-2 py-1 rounded ${zoom === z ? 'bg-[#C8A45D] text-black font-bold' : 'bg-stone-800'}`}>{z}x</button>
              ))}
            </div>
            <button
              onClick={() => setShowFloorSize(v => !v)}
              className={`px-2.5 py-1.5 rounded-lg border font-semibold ${showFloorSize ? 'bg-sky-900/60 border-sky-600 text-sky-100' : 'bg-[#121212] border-stone-700 text-stone-300'}`}
            >
              📐 {showFloorSize ? 'Cerrar tamaño del salón' : 'Cambiar tamaño del salón'}
            </button>
          </div>

          {showFloorSize && (
            <div className="bg-sky-950/40 border border-sky-800/70 rounded-xl p-3 space-y-2 text-[11px] text-sky-100">
              <p className="font-bold">📐 Tamaño de TODO el salón (no de una mesa)</p>
              <p className="text-sky-200/80">Amplía o reduce la cuadrícula del local. Para cambiar el tamaño de una mesa, tócala en el plano y usa los controles que aparecen debajo.</p>
              <div className="flex flex-wrap gap-4 pt-1">
                {[['cols', 'Ancho del salón (columnas)'], ['rows', 'Largo del salón (filas)']].map(([k, label]) => (
                  <div key={k} className="flex items-center gap-1.5">
                    <span>{label}:</span>
                    <button onClick={() => handleResizeFloor(k, -1)} className="w-8 h-8 bg-sky-900 border border-sky-700 rounded-lg font-bold text-base">−</button>
                    <span className="font-mono w-6 text-center font-bold">{floor?.[k] ?? '–'}</span>
                    <button onClick={() => handleResizeFloor(k, 1)} className="w-8 h-8 bg-sky-900 border border-sky-700 rounded-lg font-bold text-base">+</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* LIENZO DEL PLANO */}
          {loaded && tables.length === 0 && (
            <p className="text-[11px] text-stone-300 bg-[#121212] border border-stone-800 rounded-xl px-3 py-2">
              Todavía no hay mesas. Pulsa «+ Mesa», «+ Mesa redonda» o «+ Taburete» para empezar.
            </p>
          )}
          {floor ? (
            <FloorPlan
              floor={floor}
              tables={tables}
              editable
              zoom={zoom}
              paintMode={editMode === 'paint'}
              selected={selected || (selectedTableId ? { kind: 'table', id: selectedTableId } : null)}
              onSelect={(sel) => { setSelected(sel); setSelectedTableId(sel && sel.kind === 'table' ? sel.id : null); }}
              onChange={handleCanvasChange}
              onPaint={handlePaint}
            />
          ) : (
            <div className="h-64 rounded-xl border border-stone-800 animate-pulse" />
          )}

          {/* CONTROLES RÁPIDOS DE LA MESA ELEGIDA (justo debajo del plano) */}
          {selectedTable && editMode === 'move' && (
            <div className="bg-[#14281D] border border-[#C8A45D]/70 rounded-xl p-2.5 text-[11px] text-stone-200 space-y-2 fogon-pop">
              <div className="flex items-center justify-between">
                <span className="font-display font-bold text-sm text-[#E6C687]">
                  {selectedTable.shape === 'bar_stool' ? 'Taburete' : 'Mesa'} {selectedTable.number}
                </span>
                <span className="text-stone-400">{selectedTable.width || 60} × {selectedTable.height || 60}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex items-center gap-1">
                  <span className="font-semibold">Tamaño de la mesa:</span>
                  <button onClick={() => handleResizeTable(-10, -10)} className="w-9 h-9 bg-[#121212] border border-[#C8A45D]/50 rounded-lg font-bold text-base" aria-label="Más pequeña">−</button>
                  <button onClick={() => handleResizeTable(10, 10)} className="w-9 h-9 bg-[#121212] border border-[#C8A45D]/50 rounded-lg font-bold text-base" aria-label="Más grande">+</button>
                </div>
                {selectedTable.shape === 'rect' && (
                  <>
                    <div className="flex items-center gap-1">
                      <span>Ancho:</span>
                      <button onClick={() => handleResizeTable(-10, 0)} className="w-8 h-8 bg-[#121212] border border-stone-700 rounded-lg font-bold">−</button>
                      <button onClick={() => handleResizeTable(10, 0)} className="w-8 h-8 bg-[#121212] border border-stone-700 rounded-lg font-bold">+</button>
                    </div>
                    <div className="flex items-center gap-1">
                      <span>Alto:</span>
                      <button onClick={() => handleResizeTable(0, -10)} className="w-8 h-8 bg-[#121212] border border-stone-700 rounded-lg font-bold">−</button>
                      <button onClick={() => handleResizeTable(0, 10)} className="w-8 h-8 bg-[#121212] border border-stone-700 rounded-lg font-bold">+</button>
                    </div>
                    <button
                      onClick={() => patchTable(selectedTable.id, t => ({
                        ...t,
                        width: Math.min(t.height || 60, floorW - (t.x || 0)),
                        height: Math.min(t.width || 60, floorH - (t.y || 0))
                      }))}
                      className="px-2.5 h-8 bg-[#121212] border border-stone-700 rounded-lg font-semibold"
                    >
                      ↻ Girar
                    </button>
                  </>
                )}
              </div>
              <p className="text-[10px] text-stone-400">También puedes arrastrar la esquina azul de la mesa para estirarla.</p>
            </div>
          )}

          {/* PANEL DEL ELEMENTO SELECCIONADO (barra, pared, zona...) */}
          {selectedElement && (
            <div className="bg-[#121212] border border-sky-700/60 rounded-xl p-3 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sky-300">{ELEMENT_TYPES[selectedElement.type]?.icon} {ELEMENT_TYPES[selectedElement.type]?.label}</span>
                <button onClick={() => handleDeleteElement(selectedElement.id)} className="text-red-400 px-2 py-1 rounded bg-red-950/40 border border-red-900/60 flex items-center gap-1">
                  <Trash2 className="w-3.5 h-3.5" /> Quitar
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                <div className="sm:col-span-1">
                  <label className="block text-[10px] text-stone-400 mb-0.5">Texto</label>
                  <input
                    value={selectedElement.label || ''}
                    maxLength={40}
                    onChange={(e) => updateElement(selectedElement.id, { label: e.target.value })}
                    placeholder={ELEMENT_TYPES[selectedElement.type]?.label}
                    className="w-full bg-[#1A1A1A] border border-stone-700 rounded-lg p-1.5 text-stone-200 outline-none"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-stone-400">Ancho</span>
                  <button onClick={() => nudgeElement(selectedElement.id, { w: -20 })} className="w-7 h-7 bg-stone-800 rounded font-bold">-</button>
                  <button onClick={() => nudgeElement(selectedElement.id, { w: 20 })} className="w-7 h-7 bg-stone-800 rounded font-bold">+</button>
                  <span className="text-[10px] text-stone-400 ml-2">Alto</span>
                  <button onClick={() => nudgeElement(selectedElement.id, { h: -20 })} className="w-7 h-7 bg-stone-800 rounded font-bold">-</button>
                  <button onClick={() => nudgeElement(selectedElement.id, { h: 20 })} className="w-7 h-7 bg-stone-800 rounded font-bold">+</button>
                </div>
                <button onClick={() => updateElement(selectedElement.id, { w: selectedElement.h, h: selectedElement.w })} className="py-1.5 rounded-lg bg-stone-800 text-stone-200 font-semibold">
                  ↻ Girar 90°
                </button>
              </div>
            </div>
          )}

          {/* PANEL DE CONTROL DE LA MESA SELECCIONADA */}
          {selectedTable && (
            <div className="bg-[#121212] border border-[#C8A45D]/60 rounded-xl p-3.5 space-y-4">
              
              {/* Encabezado Mesa Seleccionada */}
              <div className="flex justify-between items-center pb-2 border-b border-stone-800">
                <div className="flex items-center gap-2">
                  <span className="font-display font-bold text-base text-[#C8A45D]">
                    {selectedTable.shape === 'bar_stool' ? 'Taburete' : 'Mesa'}
                  </span>
                  <input
                    value={selectedTable.number}
                    onChange={(e) => handleTableNumberChange(e.target.value)}
                    aria-label="Número de mesa"
                    className="w-16 bg-[#1A1A1A] border border-[#C8A45D]/60 rounded-lg px-2 py-1 font-display font-bold text-[#C8A45D] text-center outline-none focus:border-[#C8A45D]"
                  />
                  <span className="hidden sm:inline text-[10px] text-stone-500">El número es el del QR de la mesa</span>
                </div>
                <button
                  onClick={() => setTableToDelete(selectedTable)}
                  className="text-red-400 hover:text-red-300 px-2 py-1 rounded bg-red-950/40 border border-red-900/60 text-xs flex items-center gap-1 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Eliminar</span>
                </button>
              </div>

              {/* 0. ESTADO DE LA MESA EN EL SALÓN */}
              <div className="bg-[#1A1A1A] p-3 rounded-xl border border-stone-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-stone-300 font-semibold">Estado ahora:</span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => handleTableStatusChange(selectedTable.id, 'AVAILABLE')}
                    className={`px-3 py-1.5 rounded-lg font-bold border transition ${selectedTable.status !== 'OCCUPIED' ? 'bg-[#14281D] border-[#C8A45D] text-[#C8A45D]' : 'bg-stone-800 border-stone-700 text-stone-400 hover:text-white'}`}
                    title="Libera la mesa y cierra su cuenta (las comandas servidas dejan de sumar)"
                  >
                    Libre
                  </button>
                  <button
                    onClick={() => handleTableStatusChange(selectedTable.id, 'OCCUPIED')}
                    className={`px-3 py-1.5 rounded-lg font-bold border transition ${selectedTable.status === 'OCCUPIED' ? 'bg-[#5A1826] border-red-700 text-white' : 'bg-stone-800 border-stone-700 text-stone-400 hover:text-white'}`}
                  >
                    Ocupada
                  </button>
                </div>
              </div>

              {/* 1. BOTONERA DE MOVIMIENTO (FLECHAS AMPLIAS Y ESPACIADAS) */}
              <div className="bg-[#1A1A1A] p-3 rounded-xl border border-stone-800 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-stone-300 font-semibold flex items-center gap-1.5">
                    <Move className="w-3.5 h-3.5 text-[#C8A45D]" /> Mover en el plano:
                  </span>
                  <div className="flex items-center gap-1 text-[10px]">
                    <span>Paso:</span>
                    <button onClick={() => setStepSize(10)} className={`px-1.5 py-0.5 rounded ${stepSize === 10 ? 'bg-[#C8A45D] text-black font-bold' : 'bg-stone-800 text-stone-300'}`}>10</button>
                    <button onClick={() => setStepSize(20)} className={`px-1.5 py-0.5 rounded ${stepSize === 20 ? 'bg-[#C8A45D] text-black font-bold' : 'bg-stone-800 text-stone-300'}`}>20</button>
                    <button onClick={() => setStepSize(40)} className={`px-1.5 py-0.5 rounded ${stepSize === 40 ? 'bg-[#C8A45D] text-black font-bold' : 'bg-stone-800 text-stone-300'}`}>40</button>
                  </div>
                </div>

                {/* Flechas amplias con buen espacio táctil */}
                <div className="flex flex-col items-center gap-2 pt-1">
                  <button
                    onClick={() => handleMoveTable(0, -stepSize)}
                    className="w-14 h-11 bg-stone-800 hover:bg-stone-700 active:bg-[#C8A45D] active:text-black text-white rounded-xl font-bold flex items-center justify-center shadow-md text-sm border border-stone-700 transition"
                  >
                    <ChevronUp className="w-6 h-6" />
                  </button>
                  
                  <div className="flex gap-4">
                    <button
                      onClick={() => handleMoveTable(-stepSize, 0)}
                      className="w-14 h-11 bg-stone-800 hover:bg-stone-700 active:bg-[#C8A45D] active:text-black text-white rounded-xl font-bold flex items-center justify-center shadow-md text-sm border border-stone-700 transition"
                    >
                      <ChevronLeft className="w-6 h-6" />
                    </button>
                    <div className="w-14 h-11 bg-[#121212] border border-stone-800 rounded-xl flex items-center justify-center text-xs font-mono text-[#C8A45D]">
                      #{selectedTable.number}
                    </div>
                    <button
                      onClick={() => handleMoveTable(stepSize, 0)}
                      className="w-14 h-11 bg-stone-800 hover:bg-stone-700 active:bg-[#C8A45D] active:text-black text-white rounded-xl font-bold flex items-center justify-center shadow-md text-sm border border-stone-700 transition"
                    >
                      <ChevronRight className="w-6 h-6" />
                    </button>
                  </div>

                  <button
                    onClick={() => handleMoveTable(0, stepSize)}
                    className="w-14 h-11 bg-stone-800 hover:bg-stone-700 active:bg-[#C8A45D] active:text-black text-white rounded-xl font-bold flex items-center justify-center shadow-md text-sm border border-stone-700 transition"
                  >
                    <ChevronDown className="w-6 h-6" />
                  </button>
                </div>
              </div>

              {/* 2. TAMAÑO Y FORMA DE LA MESA */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-[#1A1A1A] p-3 rounded-xl border border-stone-800">
                <div className="space-y-2">
                  <span className="font-semibold text-stone-300 block">Tamaño de esta mesa:</span>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 space-y-1">
                      <span className="text-[10px] text-stone-400">Ancho: {selectedTable.width || 75}px</span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleResizeTable(-10, 0)} className="w-7 h-7 bg-stone-800 hover:bg-stone-700 rounded text-stone-200 font-bold">-</button>
                        <button onClick={() => handleResizeTable(10, 0)} className="w-7 h-7 bg-stone-800 hover:bg-stone-700 rounded text-stone-200 font-bold">+</button>
                      </div>
                    </div>
                    <div className="flex-1 space-y-1">
                      <span className="text-[10px] text-stone-400">Alto: {selectedTable.height || 65}px</span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleResizeTable(0, -10)} className="w-7 h-7 bg-stone-800 hover:bg-stone-700 rounded text-stone-200 font-bold">-</button>
                        <button onClick={() => handleResizeTable(0, 10)} className="w-7 h-7 bg-stone-800 hover:bg-stone-700 rounded text-stone-200 font-bold">+</button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="font-semibold text-stone-300 block">Forma y Capacidad:</span>
                  <div className="grid grid-cols-3 gap-1 text-[10px]">
                    <button
                      onClick={() => handleShapeChange('rect')}
                      className={`py-1.5 rounded font-bold border ${selectedTable.shape === 'rect' ? 'bg-[#14281D] border-[#C8A45D] text-[#C8A45D]' : 'bg-stone-800 border-stone-700 text-stone-400'}`}
                    >
                      Rect
                    </button>
                    <button
                      onClick={() => handleShapeChange('round')}
                      className={`py-1.5 rounded font-bold border ${selectedTable.shape === 'round' ? 'bg-[#14281D] border-[#C8A45D] text-[#C8A45D]' : 'bg-stone-800 border-stone-700 text-stone-400'}`}
                    >
                      Redonda
                    </button>
                    <button
                      onClick={() => handleShapeChange('bar_stool')}
                      className={`py-1.5 rounded font-bold border ${selectedTable.shape === 'bar_stool' ? 'bg-[#14281D] border-[#C8A45D] text-[#C8A45D]' : 'bg-stone-800 border-stone-700 text-stone-400'}`}
                    >
                      Barra
                    </button>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] text-stone-400">Capacidad:</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleCapacityChange(-1)} className="w-6 h-6 bg-stone-800 rounded text-stone-200 font-bold">-</button>
                      <span className="font-mono font-bold text-stone-200">{selectedTable.capacity} pers</span>
                      <button onClick={() => handleCapacityChange(1)} className="w-6 h-6 bg-stone-800 rounded text-stone-200 font-bold">+</button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. PROGRAMAR RESERVA DIRECTA EN ESTA MESA */}
              <div className="bg-[#1A1A1A] p-3 rounded-xl border border-amber-500/40 space-y-2.5">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-amber-300 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" /> Nueva reserva en la mesa {selectedTable.number}
                  </span>
                  {selectedTable.nextReservation && (
                    <span className="text-[10px] bg-amber-950 text-amber-300 px-2 py-0.5 rounded font-mono border border-amber-600">
                      Hoy a las {selectedTable.nextReservation.startTime} h · {selectedTable.nextReservation.customerName}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div>
                    <label className="block text-[10px] text-stone-400 mb-0.5">Fecha:</label>
                    <input
                      type="date"
                      min={todayStr()}
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      className="w-full bg-[#121212] border border-stone-700 rounded-lg p-1.5 text-stone-200 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-stone-400 mb-0.5">Hora:</label>
                    <input
                      type="time"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      className="w-full bg-[#121212] border border-stone-700 rounded-lg p-1.5 text-stone-200 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-stone-400 mb-0.5">Nombre:</label>
                    <input
                      type="text"
                      value={scheduleName}
                      onChange={(e) => setScheduleName(e.target.value)}
                      placeholder="Nombre del cliente"
                      className="w-full bg-[#121212] border border-stone-700 rounded-lg p-1.5 text-stone-200 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-stone-400 mb-0.5">Personas:</label>
                    <input
                      type="number"
                      value={scheduleGuests}
                      onChange={(e) => setScheduleGuests(Number(e.target.value))}
                      className="w-full bg-[#121212] border border-stone-700 rounded-lg p-1.5 text-stone-200 outline-none"
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleScheduleReservation}
                    className="flex-1 py-2 bg-[#C8A45D] hover:bg-amber-400 text-[#121212] font-bold text-xs rounded-lg transition shadow"
                  >
                    Crear reserva
                  </button>
                  {selectedTable.nextReservation && (
                    <button
                      onClick={handleRemoveReservation}
                      className="px-3 py-2 bg-red-950/80 hover:bg-red-900 border border-red-800 text-red-300 font-bold text-xs rounded-lg transition"
                    >
                      Cancelar reserva
                    </button>
                  )}
                </div>
              </div>

            </div>
          )}

        </div>
      )}

      {activeTab === 'visual_map' && (
        <QrSection tables={tables} setTables={setTables} settings={settings} setSettings={setSettings} />
      )}

      {/* PESTAÑA 2: RESERVAS */}
      {activeTab === 'reservations' && (
        <ReservationsTab reservations={reservations} onCancel={handleCancelReservation} />
      )}

      {/* PESTAÑA 3: CARTA */}
      {activeTab === 'menu' && (
        <MenuTab products={products} setProducts={setProducts} categories={categories} setCategories={setCategories} allergenKeys={allergenKeys} canManage={can('menu.manage')} />
      )}

      {/* PESTAÑA: COMANDERA (camareros) */}
      {activeTab === 'comandera' && <ComanderaTab tables={tables} products={products} categories={categories} />}

      {/* PESTAÑA: EQUIPO */}
      {activeTab === 'team' && <TeamTab me={me} />}

      {/* PESTAÑA: HISTORIAL */}
      {activeTab === 'audit' && <AuditTab />}

      {/* PESTAÑA 4: AJUSTES */}
      {activeTab === 'settings' && (
        <SettingsTab settings={settings} setSettings={setSettings} />
      )}

      {/* Modal elegante para Confirmación de Eliminación de Mesa */}
      <DeleteTableModal
        isOpen={!!tableToDelete}
        table={tableToDelete}
        onCancel={() => setTableToDelete(null)}
        onConfirm={() => {
          if (!tableToDelete) return;
          const id = tableToDelete.id;
          const remaining = tables.filter(t => t.id !== id);
          setTables(remaining);
          if (selectedTableId === id) {
            setSelectedTableId(null);
            setSelected(null);
          }
          setLayoutDirty(true);
          setTableToDelete(null);
        }}
      />

    </div>
  );
};
