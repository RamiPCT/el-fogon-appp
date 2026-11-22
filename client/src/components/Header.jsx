import React, { useEffect, useRef } from 'react';
import { useSocket } from '../context/SocketContext';
import { useI18n } from '../i18n';
import { UtensilsCrossed, Monitor, ShieldCheck, CalendarDays, Home as HomeIcon } from 'lucide-react';

export const Header = ({ currentView, onViewChange, currentTable, isStaffMode, compact = false }) => {
  const { isConnected } = useSocket();
  const { t, lang, setLang } = useI18n();
  const ref = useRef(null);

  // Publica la altura de la cabecera para que otros elementos fijos se coloquen debajo
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--hdr-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tabClass = (active, variant = 'gold') => {
    const activeStyles = {
      gold: 'bg-[#C8A45D] text-[#121212] shadow-lg',
      wine: 'bg-[#5A1826] text-white border border-red-700 shadow-md',
      light: 'bg-stone-200 text-stone-900 shadow-md'
    };
    return `flex-1 ${isStaffMode ? 'min-w-[30%]' : ''} sm:flex-none sm:min-w-[110px] py-2 px-2.5 rounded-xl font-bold flex items-center justify-center gap-1.5 transition ${
      active ? activeStyles[variant] : 'bg-[#1A1A1A] text-stone-300 hover:text-white border border-stone-800'
    }`;
  };

  return (
    <header ref={ref} className="border-b border-[#C8A45D]/25 bg-[#121212]/95 sticky top-0 z-40 backdrop-blur-md px-3 sm:px-6 py-2 shadow-2xl">
      <div className="max-w-5xl mx-auto space-y-2">

        {/* Fila superior: caballo · logotipo · idioma */}
        {!compact && (
          <div className="grid grid-cols-3 items-center">
            <button
              onClick={() => onViewChange('home')}
              className="flex items-center group justify-self-start"
              aria-label="El Fogón - Inicio"
            >
              <img
                src="/assets/logo-horse.png"
                alt=""
                className="h-11 sm:h-12 w-auto object-contain transition-transform group-hover:scale-105 drop-shadow-[0_4px_10px_rgba(200,164,93,0.35)]"
              />
            </button>

            <button
              onClick={() => onViewChange('home')}
              className="flex flex-col items-center justify-center justify-self-center text-center px-1"
              aria-label="El Fogón"
            >
              <img
                src="/assets/logo-text.png"
                alt="El Fogón"
                className="h-7 sm:h-9 w-auto max-w-[140px] sm:max-w-[200px] object-contain drop-shadow-[0_2px_10px_rgba(200,164,93,0.5)]"
              />
              <span className="font-script text-[#C8A45D] text-sm sm:text-base tracking-wide mt-0.5 whitespace-nowrap drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">
                {t('brand.tagline')}
              </span>
            </button>

            {/* Selector de idioma */}
            <div className="justify-self-end flex items-center gap-2">
              <div className="flex rounded-lg border border-stone-800 overflow-hidden text-[10px] font-bold" role="group" aria-label="Idioma / Language">
                {['es', 'en'].map(l => (
                  <button
                    key={l}
                    onClick={() => setLang(l)}
                    aria-pressed={lang === l}
                    className={`px-2 py-1 uppercase transition ${lang === l ? 'bg-[#C8A45D] text-[#121212]' : 'text-stone-400 hover:text-white'}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {isStaffMode && (
                <span
                  className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`}
                  title={isConnected ? 'Conectado en tiempo real' : 'Sin conexión en tiempo real'}
                />
              )}
            </div>
          </div>
        )}

        {/* Navegación */}
        <nav className={`flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 pt-1 pb-0.5 text-xs ${compact ? '' : 'border-t border-stone-800/60'}`}>
          <button onClick={() => onViewChange('home')} className={tabClass(currentView === 'home')} aria-current={currentView === 'home' ? 'page' : undefined}>
            <HomeIcon className="w-3.5 h-3.5 shrink-0" />
            <span className="whitespace-nowrap">{t('nav.home')}</span>
          </button>

          <button onClick={() => onViewChange('plan')} className={tabClass(currentView === 'plan')} aria-current={currentView === 'plan' ? 'page' : undefined}>
            <CalendarDays className="w-3.5 h-3.5 shrink-0" />
            <span className="whitespace-nowrap">{t('nav.book')}</span>
          </button>

          <button onClick={() => onViewChange('table')} className={tabClass(currentView === 'table')} aria-current={currentView === 'table' ? 'page' : undefined}>
            <UtensilsCrossed className="w-3.5 h-3.5 shrink-0" />
            <span className="whitespace-nowrap">
              {currentTable ? t('nav.table', { n: currentTable }) : t('nav.menu')}
            </span>
          </button>

          {isStaffMode && (
            <>
              <button onClick={() => onViewChange('kds')} className={tabClass(currentView === 'kds', 'wine')}>
                <Monitor className="w-3.5 h-3.5 shrink-0" />
                <span className="whitespace-nowrap">KDS</span>
              </button>
              <button onClick={() => onViewChange('admin')} className={tabClass(currentView === 'admin', 'light')}>
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span className="whitespace-nowrap">Admin</span>
              </button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
};
