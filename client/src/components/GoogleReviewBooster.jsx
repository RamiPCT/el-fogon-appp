import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { Star, Share2, ExternalLink, X } from 'lucide-react';
import { useI18n } from '../i18n';

// Confirmación del pedido + invitación a opinar.
// Importante: Google prohíbe ofrecer regalos o descuentos a cambio de reseñas (y pedir solo 5 estrellas).
// Por eso aquí solo se invita a dejar una opinión sincera, sin incentivos.
export const GoogleReviewBooster = ({ tableNumber, orderNumber, googleReviewUrl, onClose }) => {
  const { t } = useI18n();

  useEffect(() => {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    try {
      confetti({
        particleCount: 70,
        spread: 60,
        origin: { y: 0.7 },
        colors: ['#C8A45D', '#5A1826', '#F4EFE6', '#D4AF37']
      });
    } catch (e) {
      // Ignorar si canvas no está disponible
    }
  }, []);

  const handleShareTable = () => {
    const url = `${window.location.origin}/m/${encodeURIComponent(tableNumber)}`;
    const text = t('boost.shareText', { n: tableNumber, url });
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  return (
    <div className="relative bg-gradient-to-b from-[#1A1A1A] to-[#14281D] border-2 border-[#C8A45D] rounded-2xl p-5 shadow-2xl space-y-4" role="status">
      <button onClick={onClose} className="absolute top-3 right-3 text-stone-400 hover:text-white" aria-label={t('boost.close')}>
        <X className="w-4 h-4" />
      </button>

      <div className="text-center space-y-1">
        <div className="inline-flex w-12 h-12 rounded-full bg-[#121212] border border-[#C8A45D] items-center justify-center shadow-lg p-1.5">
          <img src="/assets/logo-horse.png" alt="" className="w-full h-full object-contain" />
        </div>
        <h3 className="font-display text-base font-bold text-[#C8A45D]">
          {t('boost.title', { n: orderNumber })}
        </h3>
        <p className="text-xs text-stone-300">{t('boost.text')}</p>
      </div>

      {googleReviewUrl && (
        <div className="bg-[#121212] p-4 rounded-xl border border-stone-800 text-center space-y-2.5">
          <div className="flex items-center justify-center gap-1 text-amber-400" aria-hidden="true">
            {[0, 1, 2, 3, 4].map(i => <Star key={i} className="w-4 h-4" />)}
          </div>
          <div>
            <h4 className="font-display text-xs font-bold text-[#F4EFE6]">{t('boost.reviewTitle')}</h4>
            <p className="text-[11px] text-stone-400 leading-relaxed mt-1">{t('boost.reviewText')}</p>
          </div>
          <a
            href={googleReviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-2.5 bg-gradient-to-r from-[#C8A45D] to-amber-500 hover:from-amber-400 hover:to-amber-500 text-[#121212] font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition shadow-lg"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>{t('boost.reviewBtn')}</span>
          </a>
        </div>
      )}

      <button
        onClick={handleShareTable}
        className="w-full py-2.5 bg-[#121212] hover:bg-stone-900 border border-[#C8A45D]/50 text-stone-200 text-xs font-semibold rounded-xl flex items-center justify-center gap-2 transition"
      >
        <Share2 className="w-3.5 h-3.5 text-[#C8A45D]" />
        <span>{t('boost.share', { n: tableNumber })}</span>
      </button>
    </div>
  );
};
