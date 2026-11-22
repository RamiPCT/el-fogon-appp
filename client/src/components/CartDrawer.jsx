import React, { useRef, useState } from 'react';
import { Plus, Minus, Send, Flame, X } from 'lucide-react';
import { formatPrice } from '../utils/formatters';
import { useI18n } from '../i18n';

export const CartDrawer = ({ cart, onUpdateQuantity, onSendOrder, tableNumber, isSubmitting }) => {
  const { t, tf } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [notes, setNotes] = useState('');

  const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const totalItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const sendingRef = useRef(false); // evita pedidos duplicados por doble toque

  if (cart.length === 0) return null;

  const handleConfirmOrder = async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    const ok = await onSendOrder(cart, notes).finally(() => { sendingRef.current = false; });
    if (ok) {
      setNotes('');
      setIsOpen(false);
    }
  };

  return (
    <>
      {/* Botón flotante */}
      <div className="fixed bottom-4 left-0 right-0 max-w-md mx-auto px-4 z-40 pb-[env(safe-area-inset-bottom)]">
        <button
          onClick={() => setIsOpen(true)}
          className="w-full py-3.5 px-4 bg-gradient-to-r from-[#C8A45D] via-amber-400 to-[#C8A45D] text-[#121212] font-bold text-xs rounded-2xl flex items-center justify-between shadow-[0_10px_25px_rgba(200,164,93,0.35)] active:scale-[0.98] transition duration-200"
        >
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-[#121212] text-[#C8A45D] flex items-center justify-center text-xs font-mono">
              {totalItemsCount}
            </div>
            <span className="tracking-wide uppercase font-display">{t('cart.view', { n: tableNumber })}</span>
          </div>
          <span className="font-mono text-sm font-black">{formatPrice(total)}</span>
        </button>
      </div>

      {/* Panel desplegable */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex flex-col justify-end p-0 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="cart-title" onClick={() => setIsOpen(false)}>
          <div className="fogon-sheet bg-[#1A1A1A] border-t sm:border border-[#C8A45D]/40 rounded-t-3xl sm:rounded-2xl max-w-md w-full mx-auto max-h-[88vh] flex flex-col shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>

            <div className="p-4 border-b border-stone-800 flex justify-between items-center bg-[#121212]">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-[#C8A45D]" />
                <h3 id="cart-title" className="font-display text-sm font-bold text-[#C8A45D]">
                  {t('cart.title', { n: tableNumber })}
                </h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="w-7 h-7 rounded-full bg-stone-800 text-stone-400 hover:text-white flex items-center justify-center"
                aria-label={t('common.close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-3 flex-1 divide-y divide-stone-800/60">
              {cart.map((item, index) => (
                <div key={`${item.id}-${index}`} className="pt-2 first:pt-0 flex justify-between items-start gap-3">
                  <div className="space-y-0.5 min-w-0">
                    <h4 className="font-semibold text-xs text-[#F4EFE6]">{tf(item, 'name')}</h4>
                    <p className="font-mono text-xs text-[#C8A45D]">{formatPrice(item.price * item.quantity)}</p>
                    {item.selectedModifiers && Object.keys(item.selectedModifiers).length > 0 && (
                      <div className="text-[10px] text-stone-400">
                        {Object.entries(item.selectedModifiers).map(([k, v]) => (
                          <span key={k} className="inline-block mr-2">• {v}</span>
                        ))}
                      </div>
                    )}
                    {item.itemNotes && <p className="text-[10px] text-amber-200/80">✎ {item.itemNotes}</p>}
                  </div>

                  <div className="flex items-center gap-2 bg-[#121212] px-2 py-1 rounded-xl border border-stone-800 shrink-0">
                    <button onClick={() => onUpdateQuantity(index, -1)} className="text-stone-400 hover:text-white p-1" aria-label="−1">
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="font-mono text-xs font-bold w-4 text-center">{item.quantity}</span>
                    <button onClick={() => onUpdateQuantity(index, 1)} className="text-stone-400 hover:text-white p-1" aria-label="+1">
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 bg-[#121212] border-t border-stone-800 space-y-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div>
                <label htmlFor="cart-notes" className="block text-[11px] text-stone-400 mb-1">{t('cart.notes')}</label>
                <input
                  id="cart-notes"
                  type="text"
                  maxLength={200}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('cart.notesPh')}
                  className="w-full bg-[#1A1A1A] border border-stone-700 rounded-xl px-3 py-2 text-xs text-stone-200 outline-none focus:border-[#C8A45D]"
                />
              </div>

              <div className="flex justify-between items-center pt-1 border-t border-stone-800 text-sm">
                <span className="text-stone-300 font-medium">{t('cart.total')}</span>
                <span className="font-mono text-base font-bold text-[#C8A45D]">{formatPrice(total)}</span>
              </div>

              <button
                onClick={handleConfirmOrder}
                disabled={isSubmitting || cart.length === 0}
                className="w-full py-3.5 bg-[#C8A45D] hover:bg-[#E6C687] text-[#121212] font-bold text-sm rounded-xl flex items-center justify-center gap-2 transition shadow-xl disabled:opacity-50 active:scale-[0.98]"
              >
                <Send className="w-4 h-4" />
                <span>{isSubmitting ? t('cart.sending') : t('cart.send')}</span>
              </button>
            </div>

          </div>
        </div>
      )}
    </>
  );
};
