import React, { useState } from 'react';
import { useI18n } from '../i18n';
import { storage } from '../utils/api';

// Aviso informativo: la web solo usa almacenamiento técnico (no requiere consentimiento),
// pero informar es una buena práctica y transmite confianza.
const KEY = 'fogon_cookie_notice';

export const CookieNotice = ({ onNavigate }) => {
  const { t } = useI18n();
  const [visible, setVisible] = useState(() => storage.get(KEY) !== '1');

  if (!visible) return null;

  const dismiss = () => {
    storage.set(KEY, '1');
    setVisible(false);
  };

  return (
    <div className="fixed bottom-20 sm:bottom-4 left-3 right-3 sm:left-auto sm:right-4 sm:max-w-sm z-[45] bg-[#1A1A1A]/95 backdrop-blur border border-stone-700 rounded-2xl p-3.5 shadow-2xl text-[11px] text-stone-300 space-y-2.5" role="region" aria-label="Cookies">
      <p className="leading-relaxed">{t('cookie.text')}</p>
      <div className="flex items-center justify-end gap-3">
        <button onClick={() => onNavigate('/cookies')} className="text-stone-400 hover:text-[#C8A45D] underline">
          {t('cookie.more')}
        </button>
        <button onClick={dismiss} className="px-3 py-1.5 bg-[#C8A45D] hover:bg-amber-400 text-[#121212] font-bold rounded-lg">
          {t('cookie.ok')}
        </button>
      </div>
    </div>
  );
};
