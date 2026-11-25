import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { useSettings, waLink, mapsLink } from '../context/SettingsContext';
import { formatPrice } from '../utils/formatters';
import { DishImage } from '../components/DishImage';
import { categoryIcon } from '../utils/category';
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
  const [cats, setCats] = useState([]);

  useEffect(() => {
    fetch('/api/menu')
      .then(r => r.json())
      .then(data => {
        const products = (data.products || []).filter(p => p.isAvailable !== false);
        const sorted = [...products].sort((a, b) => (b.badge ? 1 : 0) - (a.badge ? 1 : 0));
        setFeatured(sorted.slice(0, 4));
        setCats(data.categories || []);
      })
      .catch(() => {});
  }, []);

  const whatsapp = waLink(settings.ownerPhone, lang === 'en' ? 'Hi! I have a question about El Fogón.' : '¡Hola! Tengo una consulta sobre El Fogón.');
  const directions = mapsLink(settings);
  const hours = (lang === 'en' && settings.openingHours_en) || settings.openingHours || '';
  const hoursLines = hours.split('\n').map(l => l.trim()).filter(Boolean);
  const fullAddress = !settings.address ? '' : [settings.address, [settings.postalCode, settings.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  const pillars = [
    { icon: Flame, title: t('home.p1Title'), text: t('home.p1Text') },
    { icon: UtensilsCrossed, title: t('home.p2Title'), text: t('home.p2Text') },
    { icon: Martini, title: t('home.p3Title'), text: t('home.p3Text') }
  ];

  return (
    <div className="pb-8">

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
      <section className="max-w-5xl mx-auto px-5 py-12 sm:py-20">
        <div className="grid grid-cols-1 md:grid-cols-[1.05fr_1fr] gap-8 md:gap-12 items-center">
          <figure className="relative rounded-3xl overflow-hidden border border-[#C8A45D]/25 shadow-[0_30px_80px_rgba(0,0,0,0.55)] aspect-[4/3] md:aspect-[1/1]">
            <picture>
              <source srcSet="/assets/fachada.webp" type="image/webp" />
              <img src="/assets/fachada.jpg" alt={t('home.facadeAlt')} loading="lazy" className="w-full h-full object-cover" />
            </picture>
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" aria-hidden="true" />
            <figcaption className="absolute bottom-3 left-4 text-[10px] tracking-[0.3em] uppercase text-[#E6C687] font-semibold">{settings.city || 'Alicante'}</figcaption>
          </figure>

          <div>
            <span className="text-[10px] tracking-[0.3em] uppercase text-[#C8A45D] font-semibold">{t('home.aboutKicker')}</span>
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-[#F4EFE6] mt-2">{t('home.aboutTitle')}</h2>
            <p className="text-[15px] text-stone-300 leading-relaxed mt-4">{t('home.aboutText')}</p>

            <ul className="mt-7 divide-y divide-stone-800 border-y border-stone-800">
              {pillars.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex items-start gap-4 py-4">
                  <Icon className="w-5 h-5 text-[#C8A45D] mt-0.5 shrink-0" aria-hidden="true" />
                  <div>
                    <h3 className="font-display text-base font-bold text-[#E6C687] leading-tight">{title}</h3>
                    <p className="text-sm text-stone-300 mt-1 leading-relaxed">{text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
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
                  className="snap-start shrink-0 w-60 sm:w-auto text-left bg-[#1A1A1A] border border-stone-800 hover:border-[#C8A45D]/60 rounded-2xl overflow-hidden transition group"
                >
                  <div className="relative h-40 overflow-hidden bg-stone-900">
                    <DishImage src={p.image} alt={tf(p, 'name')} icon={categoryIcon(cats.find(c => c.id === p.categoryId))} iconClassName="w-9 h-9" className="w-full h-full group-hover:scale-105 transition duration-500" />
                    {p.badge && (
                      <span className="absolute top-2 left-2 bg-[#5A1826] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{p.badge}</span>
                    )}
                  </div>
                  <div className="p-3.5">
                    <h3 className="font-display text-sm font-bold text-[#F4EFE6] leading-tight group-hover:text-[#C8A45D] transition">{tf(p, 'name')}</h3>
                    <p className="text-xs text-stone-300 mt-1 line-clamp-2 leading-relaxed">{tf(p, 'description')}</p>
                    <p className="font-mono text-sm font-bold text-[#C8A45D] mt-2">{formatPrice(p.price)}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ================= RESERVA ================= */}
      <section className="max-w-5xl mx-auto px-5 py-12 sm:py-16">
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
      <section className="max-w-5xl mx-auto px-5 pb-12 sm:pb-16">
        <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#F4EFE6] text-center mb-6">{t('home.visitTitle')}</h2>

        <div className={`grid grid-cols-1 ${hoursLines.length > 0 ? 'sm:grid-cols-2' : ''} gap-3`}>
          {hoursLines.length > 0 && (
            <div className="bg-[#1A1A1A] border border-stone-800 rounded-2xl p-5">
              <h3 className="font-display text-sm font-bold text-[#C8A45D] flex items-center gap-2">
                <Clock className="w-4 h-4" /> {t('home.hours')}
              </h3>
              <ul className="mt-3 space-y-1.5 text-sm text-stone-200">
                {hoursLines.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            </div>
          )}

          <div className="bg-[#1A1A1A] border border-stone-800 rounded-2xl p-5 flex flex-col">
            <h3 className="font-display text-sm font-bold text-[#C8A45D] flex items-center gap-2">
              {fullAddress ? <><MapPin className="w-4 h-4" /> {t('home.address')}</> : <><MessageCircle className="w-4 h-4" /> {t('home.contact')}</>}
            </h3>
            <p className="mt-3 text-sm text-stone-200">{fullAddress || t('home.contactText')}</p>

            <div className="mt-auto pt-4 flex flex-wrap gap-2">
              {directions && (
                <a href={directions} target="_blank" rel="noopener noreferrer" className="px-4 py-2.5 bg-[#14281D] hover:bg-[#1c3a29] border border-[#C8A45D]/50 text-[#F4EFE6] text-xs font-bold rounded-xl inline-flex items-center gap-1.5 transition">
                  <MapPin className="w-3.5 h-3.5 text-[#C8A45D]" /> {t('home.directions')}
                </a>
              )}
              {whatsapp && (
                <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="px-4 py-2.5 bg-[#14281D] hover:bg-[#1c3a29] border border-green-700/60 text-green-200 text-xs font-bold rounded-xl inline-flex items-center gap-1.5 transition">
                  <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                </a>
              )}
              {settings.publicPhone && (
                <a href={`tel:${settings.publicPhone.replace(/\s/g, '')}`} className="px-4 py-2.5 bg-[#121212] hover:bg-stone-900 border border-stone-700 text-stone-200 text-xs font-bold rounded-xl inline-flex items-center gap-1.5 transition">
                  <Phone className="w-3.5 h-3.5" /> {t('home.call')}
                </a>
              )}
              {settings.instagram && (
                <a href={`https://www.instagram.com/${settings.instagram}`} target="_blank" rel="noopener noreferrer" className="px-4 py-2.5 bg-[#121212] hover:bg-stone-900 border border-stone-700 text-stone-200 text-xs font-bold rounded-xl inline-flex items-center gap-1.5 transition">
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
              <p className="text-xs text-stone-300 mt-1 leading-relaxed">{t('home.inLocalText')}</p>
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
                <p className="text-xs text-stone-300 mt-1 leading-relaxed">{t('home.reviewText')}</p>
                <a href={settings.googleReviewUrl} target="_blank" rel="noopener noreferrer" className="mt-2.5 text-xs text-[#C8A45D] hover:text-[#E6C687] font-semibold inline-flex items-center gap-1">
                  {t('home.reviewBtn')} <ChevronRight className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          )}
        </div>
      </section>

    </div>
  );
};
