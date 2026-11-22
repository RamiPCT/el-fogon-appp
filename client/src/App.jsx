import React, { useState, useEffect, useCallback } from 'react';
import { SocketProvider } from './context/SocketContext';
import { SettingsProvider } from './context/SettingsContext';
import { I18nProvider, useI18n } from './i18n';
import { Header } from './components/Header';
import { StaffLogin } from './components/StaffLogin';
import { CookieNotice } from './components/CookieNotice';
import { Home } from './views/Home';
import { CustomerPortal } from './views/CustomerPortal';
import { TableOrderPortal } from './views/TableOrderPortal';
import { KdsDisplay } from './views/KdsDisplay';
import { AdminDashboard } from './views/AdminDashboard';
import { CancelReservation } from './views/CancelReservation';
import { LegalPage } from './views/LegalPage';
import { api, getStaffToken, staffLogout } from './utils/api';
import { Lock, Unlock, X } from 'lucide-react';

// --------------------------------------------------------------------------
// Rutas
// --------------------------------------------------------------------------
const LEGAL_ROUTES = { '/aviso-legal': 'legal', '/privacidad': 'privacy', '/cookies': 'cookies' };

function parseRoute(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';
  const parts = path.split('/');
  if (path === '/') return { view: 'home' };
  if (path === '/reservar') return { view: 'plan', planMode: 'book' };
  // QR de la entrada del local: estado en vivo de las mesas
  if (['/bienvenido', '/plano'].includes(path)) return { view: 'plan', planMode: 'here' };
  if (path === '/carta') return { view: 'table', table: null };
  if (path.startsWith('/m/') || path.startsWith('/mesa/')) return { view: 'table', table: decodeURIComponent(parts[2] || '') || null };
  if (path === '/kds') return { view: 'kds' };
  if (path === '/admin') return { view: 'admin' };
  if (path.startsWith('/cancelar/')) return { view: 'cancel', cancelId: parts[2] };
  if (LEGAL_ROUTES[path]) return { view: 'legal', legal: LEGAL_ROUTES[path] };
  return { view: 'home' };
}

const STAFF_VIEWS = ['kds', 'admin'];

function AppShell() {
  const { t } = useI18n();
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname));
  const [currentTable, setCurrentTable] = useState(() => parseRoute(window.location.pathname).table || null);
  const [isStaff, setIsStaff] = useState(() => !!getStaffToken());
  const [showPinModal, setShowPinModal] = useState(false);

  const navigate = useCallback((path) => {
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
    const r = parseRoute(path);
    setRoute(r);
    if (r.view === 'table' && r.table !== undefined) setCurrentTable(r.table);
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }, []);

  // Botón "atrás/adelante" del navegador
  useEffect(() => {
    const onPop = () => {
      const r = parseRoute(window.location.pathname);
      setRoute(r);
      if (r.view === 'table') setCurrentTable(r.table || null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Sesión de personal: comprobarla con el servidor y reaccionar si caduca
  useEffect(() => {
    if (getStaffToken()) {
      api('/api/auth/check').then(() => setIsStaff(true)).catch(() => setIsStaff(false));
    }
    const sync = () => setIsStaff(!!getStaffToken());
    window.addEventListener('auth:changed', sync);
    return () => window.removeEventListener('auth:changed', sync);
  }, []);

  // Título de la pestaña según la sección
  useEffect(() => {
    const base = 'El Fogón';
    const titles = {
      home: `${base} | Picoteo y coctelería de autor en Alicante`,
      plan: `${t('nav.book')} | ${base}`,
      table: currentTable ? `${t('table', { n: currentTable })} | ${base}` : `${t('nav.menu')} | ${base}`,
      kds: `KDS | ${base}`,
      admin: `Admin | ${base}`,
      cancel: `${t('cancel.title')} | ${base}`,
      legal: base
    };
    document.title = titles[route.view] || base;
  }, [route, currentTable, t]);

  const goToTable = (tableNumber) => navigate(tableNumber ? `/m/${encodeURIComponent(tableNumber)}` : '/carta');

  const handleViewChange = (view) => {
    const paths = { home: '/', plan: '/reservar', kds: '/kds', admin: '/admin' };
    if (view === 'table') return goToTable(currentTable);
    navigate(paths[view] || '/');
  };

  const handleLogout = async () => {
    await staffLogout();
    setIsStaff(false);
    if (STAFF_VIEWS.includes(route.view)) navigate('/');
  };

  const needsLogin = STAFF_VIEWS.includes(route.view) && !isStaff;
  const isKds = route.view === 'kds' && isStaff;

  return (
    <div className="min-h-screen bg-[#121212] text-[#F4EFE6] flex flex-col font-body selection:bg-[#C8A45D] selection:text-[#121212]">
      <Header
        currentView={route.view}
        onViewChange={handleViewChange}
        currentTable={currentTable}
        isStaffMode={isStaff}
        compact={isKds}
      />

      <main className="flex-1">
        {route.view === 'home' && (
          <Home onNavigate={navigate} />
        )}

        {route.view === 'plan' && (
          <CustomerPortal
            key={route.planMode}
            initialMode={route.planMode}
            onGoToTable={goToTable}
            currentSelectedTable={currentTable}
            onSelectGlobalTable={(tbl) => setCurrentTable(tbl)}
            onNavigate={navigate}
          />
        )}

        {route.view === 'table' && (
          <TableOrderPortal
            tableNumber={currentTable}
            onSelectTableNumber={goToTable}
          />
        )}

        {needsLogin && (
          <div className="max-w-xs mx-auto px-4 py-12">
            <StaffLogin onSuccess={() => setIsStaff(true)} />
          </div>
        )}

        {route.view === 'kds' && isStaff && <KdsDisplay />}
        {route.view === 'admin' && isStaff && <AdminDashboard />}

        {route.view === 'cancel' && (
          <CancelReservation
            reservationId={route.cancelId}
            onBack={() => navigate('/')}
          />
        )}

        {route.view === 'legal' && (
          <LegalPage type={route.legal} onNavigate={navigate} />
        )}
      </main>

      {/* Pie de página con enlaces legales y acceso de personal */}
      {!isKds && (
        <footer className="py-6 px-4 text-center text-[11px] text-stone-500 border-t border-stone-900 mt-auto flex flex-col items-center gap-2">
          <nav className="flex flex-wrap justify-center gap-x-4 gap-y-1">
            <a href="/aviso-legal" onClick={(e) => { e.preventDefault(); navigate('/aviso-legal'); }} className="hover:text-[#C8A45D] transition">{t('footer.legal')}</a>
            <a href="/privacidad" onClick={(e) => { e.preventDefault(); navigate('/privacidad'); }} className="hover:text-[#C8A45D] transition">{t('footer.privacy')}</a>
            <a href="/cookies" onClick={(e) => { e.preventDefault(); navigate('/cookies'); }} className="hover:text-[#C8A45D] transition">{t('footer.cookies')}</a>
          </nav>
          <p>© {new Date().getFullYear()} El Fogón · Alicante</p>

          {!isStaff ? (
            <button
              onClick={() => setShowPinModal(true)}
              className="text-[10px] text-stone-600 hover:text-[#C8A45D] transition flex items-center gap-1 py-1 px-2.5 rounded-lg border border-transparent hover:border-stone-800"
            >
              <Lock className="w-3 h-3" />
              <span>{t('footer.staff')}</span>
            </button>
          ) : (
            <button
              onClick={handleLogout}
              className="text-[10px] text-amber-500 hover:text-amber-400 transition flex items-center gap-1 py-1 px-2.5 rounded-lg border border-stone-800"
            >
              <Unlock className="w-3 h-3" />
              <span>{t('footer.logout')}</span>
            </button>
          )}
        </footer>
      )}

      {isKds && (
        <div className="text-center pb-4">
          <button onClick={handleLogout} className="text-[10px] text-stone-600 hover:text-amber-400 transition inline-flex items-center gap-1">
            <Unlock className="w-3 h-3" /> Cerrar sesión de personal
          </button>
        </div>
      )}

      {/* Modal de PIN para acceso de personal */}
      {showPinModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="relative max-w-xs w-full">
            <button
              onClick={() => setShowPinModal(false)}
              className="absolute right-3 top-3 z-10 text-stone-400 hover:text-white"
              aria-label="Cerrar"
            >
              <X className="w-4 h-4" />
            </button>
            <StaffLogin
              onSuccess={() => {
                setIsStaff(true);
                setShowPinModal(false);
                navigate('/admin');
              }}
            />
          </div>
        </div>
      )}

      <CookieNotice onNavigate={navigate} />
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <SocketProvider>
        <SettingsProvider>
          <AppShell />
        </SettingsProvider>
      </SocketProvider>
    </I18nProvider>
  );
}
