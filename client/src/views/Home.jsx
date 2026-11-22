import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { useSettings, waLink, mapsLink } from '../context/SettingsContext';
import { formatPrice } from '../utils/formatters';
import { onImgError } from '../utils/images';
import { Flame, UtensilsCrossed, Martini, CalendarDays, MapPin, Clock, Phone, MessageCircle, Star, QrCode, ChevronRight, AtSign } from 'lucide-react';

// Partículas de brasa (posiciones aleatorias fijas durante la visita)
const useEmbers = (count) => useMemo(() => Array.from({ length: count }, (_, i) => ({
  id: i,
  left: Math.random() * 100,
  size: 2 + Math.random() * 4,
  delay: Math.random() * 8,
  duration: 6 + Math.random() * 7,
  drift: (Math.random() - 0.5) * 80
})), [count]);

// Capas de "canto" que dan grosor al caballo mientras gira (solo existen durante el giro)
const COIN_EDGE_LAYERS = Array.from({ length: 8 }, (_, i) => i + 1);
const COIN_DEPTH = 1.3; // px entre capas

// Caballo que gira en 3D como una moneda de oro al tocarlo.
// Compatible con Safari/iPhone: durante el giro no hay filtros ni mezclas de color
// dentro de la escena 3D (Safari la "aplanaría").
const SpinningHorse = ({ label }) => {
  const [spinId, setSpinId] = useState(0);
  const busy = useRef(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const finish = () => {
    busy.current = false;
    setSpinId(0);
  };

  // El giro lo inicia la persona al tocar, por eso se permite aunque el móvil tenga "reducir movimiento"
  const spin = () => {
    if (busy.current) return;
    busy.current = true;
    setSpinId(Date.now());
    clearTimeout(timer.current);
    timer.current = setTimeout(finish, 2200); // por si el navegador no avisa del final
  };

  const spinning = spinId !== 0;
  const back = (COIN_EDGE_LAYERS.length + 1) * COIN_DEPTH;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={spin}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); spin(); } }}
      aria-label={label}
      className="fogon-coin-stage absolute inset-0"
    >
      <div
        key={spinId}
        className={`fogon-coin ${spinning ? 'is-spinning' : ''}`}
        onAnimationEnd={(e) => { if (e.animationName === 'fogon-coin-spin') { clearTimeout(timer.current); finish(); } }}
      >
        {spinning && COIN_EDGE_LAYERS.map(i => (
          <div
            key={i}
            aria-hidden="true"
            className="fogon-coin-edge"
            style={{ transform: `translateZ(${-i * COIN_DEPTH}px)` }}
          />
        ))}
        {spinning && (
          <img src="/assets/logo-horse.png" alt="" aria-hidden="true" draggable="false" className="fogon-coin-face" style={{ transform: `translateZ(${-back}px) rotateY(180deg)` }} />
        )}
        <img
          src="/assets/logo-horse.png"
          alt="El Fogón"
          draggable="false"
          className={`fogon-coin-face ${spinning ? '' : 'drop-shadow-[0_10px_30px_rgba(200,164,93,0.35)]'}`}
          style={spinning ? { transform: 'translateZ(0.5px)' } : undefined}
        />
        {!spinning && <div className="fogon-shimmer fogon-coin-face" aria-hidden="true" />}
        {spinning && <div className="fogon-coin-glint fogon-coin-face" aria-hidden="true" style={{ transform: 'translateZ(1px)' }} />}
      </div>
    </div>
  );
};

export const Home = ({ onNavigate }) => {
  const { t, tf, lang } = useI18n();
  const settings = useSettings();
  const embers = useEmbers(28);
  const [featured, setFeatured] = useState([]);

  useEffect(() => {
    fetch('/api/menu')
      .then(r => r.json())
      .then(data => {
        const products = (data.products || []).filter(p => p.isAvailable !== false);
        const sorted = [...products].sort((a, b) => (b.badge ? 1 : 0) - (a.badge ? 1 : 0));
        setFeatured(sorted.slice(0, 4));
      })
      .catch(() => {});
  }, []);

  const whatsapp = waLink(settings.ownerPhone, lang === 'en' ? 'Hi! I have a question about El Fogón.' : '¡Hola! Tengo una consulta sobre El Fogón.');
  const directions = mapsLink(settings);
  const hours = (lang === 'en' && settings.openingHours_en) || settings.openingHours || '';
  const hoursLines = hours.split('\n').map(l => l.trim()).filter(Boolean);
  const fullAddress = [settings.address, [settings.postalCode, settings.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  const pillars = [
    { icon: Flame, title: t('home.p1Title'), text: t('home.p1Text') },
    { icon: UtensilsCrossed, title: t('home.p2Title'), text: t('home.p2Text') },
    { icon: Martini, title: t('home.p3Title'), text: t('home.p3Text') }
  ];

  return (
    <div className="pb-24 sm:pb-8">

      {/* ================= HERO ================= */}
      <section className="relative overflow-hidden border-b border-[#C8A45D]/20">
        {/* Fondo: verde botella de la marca fundido a carbón */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,#14281D_0%,#0f1a14_38%,#121212_75%)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-[radial-gradient(ellipse_at_50%_100%,rgba(200,120,40,0.18),transparent_70%)] fogon-glow" />

        {/* Brasas */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          {embers.map(e => (
            <span
              key={e.id}
              className="fogon-ember"
              style={{
                left: `${e.left}%`,
                width: `${e.size}px`,
                height: `${e.size}px`,
                animationDelay: `${e.delay}s`,
                animationDuration: `${e.duration}s`,
                '--drift': `${e.drift}px`
              }}
            />
          ))}
        </div>

        <div className="relative max-w-3xl mx-auto px-5 pt-10 pb-14 sm:pt-14 sm:pb-20 flex flex-col items-center text-center">
          <span className="fogon-fade-up text-[10px] sm:text-xs tracking-[0.3em] uppercase text-[#C8A45D]/90 font-semibold">
            {t('home.kicker')}
          </span>

          {/* Caballo con barrido de brillo dorado */}
          <div className="fogon-fade-up relative mt-5 w-44 h-44 sm:w-56 sm:h-56" style={{ animationDelay: '0.1s' }}>
            <div className="absolute inset-0 rounded-full bg-[#C8A45D]/10 blur-3xl fogon-glow" />
            <SpinningHorse label={t('home.spinLogo')} />
          </div>

          <img
            src="/assets/logo-text.png"
            alt="El Fogón"
            className="fogon-fade-up mt-3 h-10 sm:h-14 w-auto object-contain"
            style={{ animationDelay: '0.2s' }}
          />

          <p className="fogon-fade-up font-script text-[#E6C687] text-3xl sm:text-4xl mt-3 leading-tight" style={{ animationDelay: '0.3s' }}>
            {t('home.tagline')}
          </p>

          <div className="fogon-fade-up mt-8 flex flex-col sm:flex-row gap-3 w-full sm:w-auto" style={{ animationDelay: '0.4s' }}>
            <button
              onClick={() => onNavigate('/reservar')}
              className="px-7 py-3.5 bg-[#C8A45D] hover:bg-[#E6C687] text-[#121212] font-bold text-sm rounded-xl flex items-center justify-center gap-2 shadow-[0_10px_30px_rgba(200,164,93,0.3)] transition active:scale-95"
            >
              <CalendarDays className="w-4 h-4" />
              {t('home.ctaBook')}
            </button>
            <button
              onClick={() => onNavigate('/carta')}
              className="px-7 py-3.5 bg-transparent hover:bg-[#C8A45D]/10 border border-[#C8A45D]/70 text-[#F4EFE6] font-bold text-sm rounded-xl flex items-center justify-center gap-2 transition active:scale-95"
            >
              <UtensilsCrossed className="w-4 h-4 text-[#C8A45D]" />
              {t('home.ctaMenu')}
            </button>
          </div>
        </div>
      </section>

      {/* ================= LA CASA ================= */}
      <section className="max-w-4xl mx-auto px-5 py-12 sm:py-16">
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#F4EFE6]">{t('home.aboutTitle')}</h2>
          <div className="w-16 h-px bg-gradient-to-r from-transparent via-[#C8A45D] to-transparent mx-auto my-4" />
          <p className="text-sm sm:text-base text-stone-300 leading-relaxed">{t('home.aboutText')}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-10">
          {pillars.map(({ icon: Icon, title, text }) => (
            <div key={title} className="bg-[#1A1A1A] border border-stone-800 hover:border-[#C8A45D]/50 rounded-2xl p-5 text-center transition group">
              <div className="w-11 h-11 mx-auto rounded-full bg-[#14281D] border border-[#C8A45D]/60 flex items-center justify-center group-hover:scale-110 transition">
                <Icon className="w-5 h-5 text-[#C8A45D]" />
              </div>
              <h3 className="font-display text-base font-bold text-[#C8A45D] mt-3">{title}</h3>
              <p className="text-xs text-stone-400 mt-1.5 leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ================= DESTACADOS DE LA CARTA ================= */}
      {featured.length > 0 && (
        <section className="bg-[#0f0f0f] border-y border-stone-900 py-12 sm:py-16">
          <div className="max-w-5xl mx-auto px-5">
            <div className="flex items-end justify-between gap-3 mb-6">
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#F4EFE6]">{t('home.featuredTitle')}</h2>
              <button onClick={() => onNavigate('/carta')} className="text-xs text-[#C8A45D] hover:text-[#E6C687] font-semibold flex items-center gap-1 shrink-0">
                {t('home.featuredAll')} <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex sm:grid sm:grid-cols-4 gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-5 px-5 sm:mx-0 sm:px-0 fogon-no-scrollbar">
              {featured.map(p => (
                <button
                  key={p.id}
                  onClick={() => onNavigate('/carta')}
                  className="snap-start shrink-0 w-56 sm:w-auto text-left bg-[#1A1A1A] border border-stone-800 hover:border-[#C8A45D]/60 rounded-2xl overflow-hidden transition group"
                >
                  <div className="relative h-36 overflow-hidden bg-stone-900">
                    <img onError={onImgError} src={p.image} alt={tf(p, 'name')} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
                    {p.badge && (
                      <span className="absolute top-2 left-2 bg-[#5A1826] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{p.badge}</span>
                    )}
                  </div>
                  <div className="p-3.5">
                    <h3 className="font-display text-sm font-bold text-[#F4EFE6] leading-tight group-hover:text-[#C8A45D] transition">{tf(p, 'name')}</h3>
                    <p className="text-[11px] text-stone-400 mt-1 line-clamp-2">{tf(p, 'description')}</p>
                    <p className="font-mono text-sm font-bold text-[#C8A45D] mt-2">{formatPrice(p.price)}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ================= RESERVA ================= */}
      <section className="max-w-4xl mx-auto px-5 py-12 sm:py-16">
        <div className="relative overflow-hidden rounded-3xl border border-[#C8A45D]/40 bg-gradient-to-br from-[#14281D] via-[#121212] to-[#5A1826]/40 p-6 sm:p-10 text-center">
          <img src="/assets/horse-white.png" alt="" className="absolute -right-6 -bottom-6 w-40 opacity-[0.07] pointer-events-none" aria-hidden="true" />
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#F4EFE6]">{t('home.bookingTitle')}</h2>
          <p className="text-sm text-stone-300 mt-3 max-w-md mx-auto leading-relaxed">{t('home.bookingText')}</p>
          <button
            onClick={() => onNavigate('/reservar')}
            className="mt-6 px-7 py-3.5 bg-[#C8A45D] hover:bg-[#E6C687] text-[#121212] font-bold text-sm rounded-xl inline-flex items-center gap-2 shadow-lg transition active:scale-95"
          >
            <CalendarDays className="w-4 h-4" />
            {t('home.ctaBook')}
          </button>
        </div>
      </section>

      {/* ================= VISÍTANOS ================= */}
      <section className="max-w-4xl mx-auto px-5 pb-12 sm:pb-16">
        <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#F4EFE6] text-center mb-6">{t('home.visitTitle')}</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-[#1A1A1A] border border-stone-800 rounded-2xl p-5">
            <h3 className="font-display text-sm font-bold text-[#C8A45D] flex items-center gap-2">
              <Clock className="w-4 h-4" /> {t('home.hours')}
            </h3>
            {hoursLines.length > 0 ? (
              <ul className="mt-3 space-y-1.5 text-sm text-stone-300">
                {hoursLines.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-stone-400">{t('home.hoursPending')}</p>
            )}
          </div>

          <div className="bg-[#1A1A1A] border border-stone-800 rounded-2xl p-5 flex flex-col">
            <h3 className="font-display text-sm font-bold text-[#C8A45D] flex items-center gap-2">
              <MapPin className="w-4 h-4" /> {t('home.address')}
            </h3>
            <p className="mt-3 text-sm text-stone-300">{fullAddress || 'Alicante'}</p>

            <div className="mt-auto pt-4 flex flex-wrap gap-2">
              {directions && (
                <a href={directions} target="_blank" rel="noopener noreferrer" className="px-3.5 py-2 bg-[#14281D] hover:bg-[#1c3a29] border border-[#C8A45D]/50 text-[#F4EFE6] text-xs font-bold rounded-xl inline-flex items-center gap-1.5 transition">
                  <MapPin className="w-3.5 h-3.5 text-[#C8A45D]" /> {t('home.directions')}
                </a>
              )}
              {whatsapp && (
                <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="px-3.5 py-2 bg-[#14281D] hover:bg-[#1c3a29] border border-green-700/60 text-green-200 text-xs font-bold rounded-xl inline-flex items-center gap-1.5 transition">
                  <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                </a>
              )}
              {settings.publicPhone && (
                <a href={`tel:${settings.publicPhone.replace(/\s/g, '')}`} className="px-3.5 py-2 bg-[#121212] hover:bg-stone-900 border border-stone-700 text-stone-200 text-xs font-bold rounded-xl inline-flex items-center gap-1.5 transition">
                  <Phone className="w-3.5 h-3.5" /> {t('home.call')}
                </a>
              )}
              {settings.instagram && (
                <a href={`https://www.instagram.com/${settings.instagram}`} target="_blank" rel="noopener noreferrer" className="px-3.5 py-2 bg-[#121212] hover:bg-stone-900 border border-stone-700 text-stone-200 text-xs font-bold rounded-xl inline-flex items-center gap-1.5 transition">
                  <AtSign className="w-3.5 h-3.5" /> @{settings.instagram}
                </a>
              )}
            </div>
          </div>
        </div>

        <div className={`grid grid-cols-1 ${settings.googleReviewUrl ? 'sm:grid-cols-2' : ''} gap-3 mt-3`}>
          <div className="bg-[#1A1A1A] border border-stone-800 rounded-2xl p-5 flex gap-4 items-start">
            <div className="w-10 h-10 rounded-xl bg-[#121212] border border-[#C8A45D]/50 flex items-center justify-center shrink-0">
              <QrCode className="w-5 h-5 text-[#C8A45D]" />
            </div>
            <div>
              <h3 className="font-display text-sm font-bold text-[#F4EFE6]">{t('home.inLocalTitle')}</h3>
              <p className="text-xs text-stone-400 mt-1 leading-relaxed">{t('home.inLocalText')}</p>
              <button onClick={() => onNavigate('/bienvenido')} className="mt-2.5 text-xs text-[#C8A45D] hover:text-[#E6C687] font-semibold inline-flex items-center gap-1">
                {t('home.seePlan')} <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {settings.googleReviewUrl && (
            <div className="bg-[#1A1A1A] border border-stone-800 rounded-2xl p-5 flex gap-4 items-start">
              <div className="w-10 h-10 rounded-xl bg-[#121212] border border-amber-500/50 flex items-center justify-center shrink-0">
                <Star className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="font-display text-sm font-bold text-[#F4EFE6]">{t('home.reviewTitle')}</h3>
                <p className="text-xs text-stone-400 mt-1 leading-relaxed">{t('home.reviewText')}</p>
                <a href={settings.googleReviewUrl} target="_blank" rel="noopener noreferrer" className="mt-2.5 text-xs text-[#C8A45D] hover:text-[#E6C687] font-semibold inline-flex items-center gap-1">
                  {t('home.reviewBtn')} <ChevronRight className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ================= BARRA DE ACCIONES FIJA (MÓVIL) ================= */}
      <div className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-[#121212]/95 backdrop-blur border-t border-[#C8A45D]/30 px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] grid grid-cols-3 gap-2 text-[11px] font-bold">
        <button onClick={() => onNavigate('/reservar')} className="py-2.5 bg-[#C8A45D] text-[#121212] rounded-xl flex flex-col items-center gap-0.5">
          <CalendarDays className="w-4 h-4" />
          {t('nav.book')}
        </button>
        {whatsapp ? (
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="py-2.5 bg-[#14281D] border border-green-700/60 text-green-200 rounded-xl flex flex-col items-center gap-0.5">
            <MessageCircle className="w-4 h-4" />
            WhatsApp
          </a>
        ) : (
          <button onClick={() => onNavigate('/carta')} className="py-2.5 bg-[#1A1A1A] border border-stone-700 text-stone-200 rounded-xl flex flex-col items-center gap-0.5">
            <UtensilsCrossed className="w-4 h-4" />
            {t('nav.menu')}
          </button>
        )}
        {directions ? (
          <a href={directions} target="_blank" rel="noopener noreferrer" className="py-2.5 bg-[#1A1A1A] border border-stone-700 text-stone-200 rounded-xl flex flex-col items-center gap-0.5">
            <MapPin className="w-4 h-4" />
            {t('home.directions')}
          </a>
        ) : (
          <button onClick={() => onNavigate('/carta')} className="py-2.5 bg-[#1A1A1A] border border-stone-700 text-stone-200 rounded-xl flex flex-col items-center gap-0.5">
            <UtensilsCrossed className="w-4 h-4" />
            {t('nav.menu')}
          </button>
        )}
      </div>
    </div>
  );
};
