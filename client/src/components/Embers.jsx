import React, { useMemo } from 'react';

// Brasas que suben desde abajo (decorativo). Se desactiva solo si el usuario prefiere menos movimiento.
export const Embers = ({ count = 18, height = 420 }) => {
  const embers = useMemo(() => Array.from({ length: count }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    size: 2 + Math.random() * 3.5,
    delay: Math.random() * 8,
    duration: 6 + Math.random() * 7,
    drift: (Math.random() - 0.5) * 70
  })), [count]);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true" style={{ '--rise': `-${height}px` }}>
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
  );
};

// Cabecera con el ambiente de la marca: verde botella, brillo cálido y brasas
export const AuraHero = ({ children, className = '', embers = 16 }) => (
  <section className={`relative overflow-hidden border-b border-[#C8A45D]/20 ${className}`}>
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_20%,#14281D_0%,#0f1a14_45%,#121212_85%)]" />
    <div className="absolute inset-x-0 bottom-0 h-24 bg-[radial-gradient(ellipse_at_50%_100%,rgba(200,120,40,0.16),transparent_70%)] fogon-glow" />
    <Embers count={embers} height={260} />
    <div className="relative">{children}</div>
  </section>
);

// Separador dorado
export const GoldRule = ({ className = '' }) => (
  <div className={`h-px bg-gradient-to-r from-transparent via-[#C8A45D] to-transparent ${className}`} aria-hidden="true" />
);
