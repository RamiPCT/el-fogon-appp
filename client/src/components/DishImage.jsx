import React, { useState } from 'react';
import { UtensilsCrossed } from 'lucide-react';

// Foto de un plato. Si no tiene foto o no carga, se muestra un fondo de la marca
// con el icono de su categoría (en vez de un hueco gris).
export const DishImage = ({ src, alt = '', icon: Icon = UtensilsCrossed, soldOut = false, className = '', imgClassName = '', iconClassName = 'w-7 h-7', eager = false }) => {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={`relative flex items-center justify-center bg-[radial-gradient(circle_at_50%_30%,#1c3a29_0%,#13221a_55%,#101410_100%)] ${soldOut ? 'grayscale' : ''} ${className}`} role={alt ? 'img' : undefined} aria-label={alt || undefined}>
        <div className="absolute inset-[10%] rounded-full border border-[#C8A45D]/15" aria-hidden="true" />
        <Icon className={`${iconClassName} text-[#C8A45D]/80`} aria-hidden="true" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      onError={() => setFailed(true)}
      className={`w-full h-full object-cover ${soldOut ? 'grayscale' : ''} ${imgClassName} ${className}`}
    />
  );
};
