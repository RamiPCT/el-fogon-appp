// Si una foto de la carta no carga, se muestra el caballo de la marca en su lugar
export const FALLBACK_IMG = '/assets/horse-white.png';

export const onImgError = (e) => {
  const img = e.currentTarget;
  if (img.dataset.fallback) return;
  img.dataset.fallback = '1';
  img.src = FALLBACK_IMG;
  img.alt = '';
  img.style.objectFit = 'contain';
  img.style.padding = '18%';
  img.style.opacity = '0.35';
};
