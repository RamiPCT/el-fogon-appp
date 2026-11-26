import React, { useEffect, useRef, useState } from 'react';
import { Plus, Minus, Info, X, Check } from 'lucide-react';
import { formatPrice } from '../utils/formatters';
import { useI18n } from '../i18n';
import { useSettings } from '../context/SettingsContext';
import { DishImage } from './DishImage';
import { cleanName, categoryIcon } from '../utils/category';

// ---------------------------------------------------------------------------
// Ficha de producto (hoja inferior): foto grande, alérgenos, opciones, notas y cantidad
// ---------------------------------------------------------------------------
const ProductSheet = ({ product, icon, canOrder, onClose, onAdd }) => {
  const { t, tf, allergenName } = useI18n();
  const settings = useSettings();
  const viewOnlyText = settings.qrLegacyEnabled === false ? t('menu.viewOnlyQr') : t('menu.viewOnly');
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const [mods, setMods] = useState(() => {
    const init = {};
    (product.modifiers || []).forEach(m => { if (m.options?.length) init[m.name] = m.options[0]; });
    return init;
  });
  const soldOut = product.isAvailable === false;
  const allergens = Array.isArray(product.allergens) ? product.allergens : [];

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="ps-title" onClick={onClose}>
      <div className="fogon-sheet relative bg-[#1A1A1A] border border-[#C8A45D]/40 border-b-0 sm:border-b rounded-t-3xl sm:rounded-3xl max-w-md w-full max-h-[92vh] flex flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="relative h-52 sm:h-60 bg-stone-900 shrink-0">
          <DishImage src={product.image} alt={tf(product, 'name')} icon={icon} soldOut={soldOut} eager className="w-full h-full" iconClassName="w-14 h-14" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#1A1A1A] via-transparent to-black/30" />
          <button onClick={onClose} className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/60 backdrop-blur text-white flex items-center justify-center" aria-label={t('common.close')}>
            <X className="w-4 h-4" />
          </button>
          {product.badge && !soldOut && (
            <span className="absolute top-3 left-3 bg-[#5A1826] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{product.badge}</span>
          )}
        </div>

        <div className="px-5 -mt-6 relative space-y-4 overflow-y-auto pb-4">
          <div>
            <h3 id="ps-title" className="font-display text-xl font-bold text-[#F4EFE6] leading-tight">{tf(product, 'name')}</h3>
            <p className="font-mono text-lg font-bold text-[#C8A45D] mt-1">{formatPrice(product.price)}</p>
            <p className="text-sm text-stone-300 leading-relaxed mt-2">{tf(product, 'description')}</p>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-1.5">{t('menu.allergens')}</p>
            {allergens.length ? (
              <div className="flex flex-wrap gap-1.5">
                {allergens.map(a => (
                  <span key={a} className="text-[11px] px-2 py-0.5 rounded-full bg-[#121212] border border-amber-800/60 text-amber-200">{allergenName(a)}</span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-stone-300 flex items-center gap-1"><Info className="w-3.5 h-3.5 text-[#C8A45D]" />{t('menu.allergenAsk')}</p>
            )}
          </div>

          {canOrder && !soldOut && (product.modifiers || []).map(mod => (
            <fieldset key={mod.name}>
              <legend className="text-xs font-semibold text-stone-200 mb-1.5">
                {mod.name} {mod.required && <span className="text-[#C8A45D]">*</span>}
              </legend>
              <div className="grid grid-cols-2 gap-1.5">
                {mod.options.map(opt => {
                  const on = mods[mod.name] === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setMods({ ...mods, [mod.name]: opt })}
                      className={`p-2.5 rounded-xl border text-left text-xs transition ${on ? 'bg-[#14281D] border-[#C8A45D] text-[#E6C687] font-bold' : 'bg-[#121212] border-stone-800 text-stone-300'}`}
                    >
                      {on && <Check className="inline w-3 h-3 mr-1" />}{opt}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}

          {canOrder && !soldOut && (
            <div>
              <label htmlFor="ps-notes" className="text-xs font-semibold text-stone-200 mb-1.5 block">{t('menu.notes')}</label>
              <input
                id="ps-notes"
                type="text"
                maxLength={140}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('menu.notesPh')}
                className="w-full bg-[#121212] border border-stone-700 rounded-xl px-3 py-2.5 text-sm text-stone-200 outline-none focus:border-[#C8A45D]"
              />
            </div>
          )}
        </div>

        {/* Pie con cantidad y botón */}
        <div className="border-t border-stone-800 p-4 bg-[#141414] fogon-safe-bottom shrink-0">
          {soldOut ? (
            <p className="text-center text-sm text-red-300 font-semibold py-2">{t('menu.soldOut')}</p>
          ) : !canOrder ? (
            <p className="text-center text-xs text-amber-200/90 py-2">{viewOnlyText}</p>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex items-center bg-[#121212] border border-stone-700 rounded-xl">
                <button onClick={() => setQty(q => Math.max(1, q - 1))} className="w-11 h-12 flex items-center justify-center text-stone-300" aria-label="−1"><Minus className="w-4 h-4" /></button>
                <span className="w-6 text-center font-mono font-bold" aria-live="polite">{qty}</span>
                <button onClick={() => setQty(q => Math.min(20, q + 1))} className="w-11 h-12 flex items-center justify-center text-stone-300" aria-label="+1"><Plus className="w-4 h-4" /></button>
              </div>
              <button
                onClick={() => onAdd({ ...product, selectedModifiers: mods, itemNotes: notes.trim(), quantity: qty })}
                className="flex-1 h-12 bg-[#C8A45D] hover:bg-[#E6C687] text-[#121212] font-bold text-sm rounded-xl flex items-center justify-between px-4 shadow-[0_8px_24px_rgba(200,164,93,0.3)] active:scale-[0.98] transition"
              >
                <span>{t('menu.add')}</span>
                <span className="font-mono">{formatPrice(product.price * qty)}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Carta continua con categorías fijas (scroll-spy)
// ---------------------------------------------------------------------------
export const MenuCatalog = ({ categories, products, onAddToCart, canOrder = true, showViewOnlyNotice = true }) => {
  const { t, tf, allergenName } = useI18n();
  const settings = useSettings();
  const viewOnlyText = settings.qrLegacyEnabled === false ? t('menu.viewOnlyQr') : t('menu.viewOnly');
  const [active, setActive] = useState(null);
  const [openProduct, setOpenProduct] = useState(null);
  const [flash, setFlash] = useState(null);
  const sectionRefs = useRef({});
  const tabsRef = useRef(null);
  const clickScroll = useRef(false);

  const visible = categories.filter(c => products.some(p => p.categoryId === c.id));
  const iconOf = (catId) => categoryIcon(categories.find(c => c.id === catId));

  useEffect(() => {
    if (visible.length && !visible.some(c => c.id === active)) setActive(visible[0].id);
  }, [categories, products]);

  // Resalta la categoría que se está viendo
  useEffect(() => {
    const obs = new IntersectionObserver((entries) => {
      if (clickScroll.current) return;
      const vis = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis[0]) setActive(vis[0].target.dataset.cat);
    }, { rootMargin: '-35% 0px -55% 0px' });
    Object.values(sectionRefs.current).forEach(el => el && obs.observe(el));
    return () => obs.disconnect();
  }, [visible.length]);

  // Mantener visible la pestaña activa
  useEffect(() => {
    const el = tabsRef.current?.querySelector(`[data-tab="${active}"]`);
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [active]);

  const goTo = (id) => {
    setActive(id);
    clickScroll.current = true;
    const el = sectionRefs.current[id];
    if (el) {
      const offset = (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hdr-h')) || 110) + 56;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior: 'smooth' });
    }
    setTimeout(() => { clickScroll.current = false; }, 700);
  };

  const quickAdd = (e, prod) => {
    e.stopPropagation();
    if (prod.modifiers && prod.modifiers.length) return setOpenProduct(prod);
    onAddToCart({ ...prod, selectedModifiers: {}, itemNotes: '', quantity: 1 });
    setFlash(prod.id);
    setTimeout(() => setFlash(f => (f === prod.id ? null : f)), 1100);
  };

  return (
    <section aria-label={t('menu.title')}>
      {/* Pestañas fijas */}
      <div className="sticky z-30 -mx-3.5 px-3.5 py-2 bg-[#121212]/95 backdrop-blur border-b border-stone-900" style={{ top: 'var(--hdr-h, 0px)' }}>
        <div ref={tabsRef} className="flex gap-2 overflow-x-auto fogon-no-scrollbar text-xs" role="tablist">
          {visible.map(cat => (
            <button
              key={cat.id}
              data-tab={cat.id}
              role="tab"
              aria-selected={active === cat.id}
              onClick={() => goTo(cat.id)}
              className={`px-3.5 py-2 rounded-full font-semibold whitespace-nowrap transition ${active === cat.id ? 'bg-[#C8A45D] text-[#121212] shadow-lg' : 'bg-[#1A1A1A] border border-stone-800 text-stone-300'}`}
            >
              {cleanName(tf(cat, 'name'))}
            </button>
          ))}
        </div>
      </div>

      {!canOrder && showViewOnlyNotice && (
        <p className="mt-3 text-[11px] text-amber-200/90 bg-amber-950/30 border border-amber-800/50 rounded-xl px-3 py-2">{viewOnlyText}</p>
      )}

      {visible.map(cat => (
        <div key={cat.id} data-cat={cat.id} ref={el => { sectionRefs.current[cat.id] = el; }} className="pt-7">
          {(() => { const CatIcon = categoryIcon(cat); return (
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-full border border-[#C8A45D]/50 flex items-center justify-center shrink-0" aria-hidden="true">
                <CatIcon className="w-4 h-4 text-[#C8A45D]" />
              </span>
              <div className="min-w-0">
                <h3 className="font-display text-lg font-bold text-[#F4EFE6] leading-tight">{cleanName(tf(cat, 'name'))}</h3>
                {tf(cat, 'description') && <p className="text-xs text-stone-400 mt-0.5">{tf(cat, 'description')}</p>}
              </div>
            </div>
          ); })()}
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            {products.filter(p => p.categoryId === cat.id).map(prod => {
              const soldOut = prod.isAvailable === false;
              const allergens = Array.isArray(prod.allergens) ? prod.allergens : [];
              return (
                <article
                  key={prod.id}
                  onClick={() => setOpenProduct(prod)}
                  className={`relative bg-[#1A1A1A] rounded-2xl border border-stone-800/80 p-2.5 flex gap-3 items-stretch cursor-pointer active:scale-[0.99] transition ${soldOut ? 'opacity-55' : 'hover:border-[#C8A45D]/40'}`}
                >
                  <div className="w-24 h-24 rounded-xl overflow-hidden shrink-0 relative bg-stone-900">
                    <DishImage src={prod.image} icon={iconOf(prod.categoryId)} soldOut={soldOut} className="w-full h-full" />
                    {soldOut ? (
                      <span className="absolute inset-x-0 bottom-0 bg-black/75 text-white text-[9px] font-bold text-center py-0.5 uppercase">{t('menu.soldOut')}</span>
                    ) : prod.badge && (
                      <span className="absolute top-1 left-1 bg-[#5A1826] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">{prod.badge}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col py-0.5">
                    <h4 className="font-display text-sm font-bold text-[#F4EFE6] leading-tight">{tf(prod, 'name')}</h4>
                    <p className="text-xs text-stone-300 line-clamp-2 leading-relaxed mt-1">{tf(prod, 'description')}</p>
                    {allergens.length > 0 && (
                      <p className="text-[10px] text-amber-200/80 mt-1 truncate">{allergens.map(allergenName).join(' · ')}</p>
                    )}
                    <div className="mt-auto flex items-center justify-between pt-1">
                      <span className="font-mono text-sm font-bold text-[#C8A45D]">{formatPrice(prod.price)}</span>
                      {canOrder && !soldOut && (
                        <button
                          onClick={(e) => quickAdd(e, prod)}
                          className={`h-9 rounded-full font-bold flex items-center justify-center gap-1 shadow-md active:scale-90 transition text-[11px] ${flash === prod.id ? 'px-3 bg-green-600 text-white' : 'w-9 bg-[#C8A45D] text-[#121212]'}`}
                          aria-label={`${t('menu.add')}: ${tf(prod, 'name')}`}
                        >
                          {flash === prod.id ? <><Check className="w-3.5 h-3.5" />{t('menu.added')}</> : <Plus className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ))}

      <p className="mt-6 text-xs text-stone-300 flex items-start gap-1.5 bg-[#1A1A1A] border border-stone-800 rounded-xl p-3">
        <Info className="w-3.5 h-3.5 text-[#C8A45D] shrink-0 mt-0.5" />
        <span>{t('menu.allergenNotice')}</span>
      </p>

      {openProduct && (
        <ProductSheet
          key={openProduct.id}
          product={openProduct}
          icon={iconOf(openProduct.categoryId)}
          canOrder={canOrder}
          onClose={() => setOpenProduct(null)}
          onAdd={(item) => {
            onAddToCart(item);
            setOpenProduct(null);
            setFlash(item.id);
            setTimeout(() => setFlash(f => (f === item.id ? null : f)), 1100);
          }}
        />
      )}
    </section>
  );
};
