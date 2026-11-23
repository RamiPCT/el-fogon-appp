import React, { useState } from 'react';
import { api } from '../../utils/api';
import { formatPrice } from '../../utils/formatters';
import { onImgError } from '../../utils/images';
import { ALLERGEN_LABELS } from './labels';

const AREA_LABELS = { kitchen: '🍳 Cocina', bar: '🍸 Barra' };
const VAT_RATES = [10, 21, 4, 0];
const inputCls = 'w-full bg-[#1A1A1A] border border-stone-700 rounded-lg px-2 py-1.5 text-xs text-stone-100 outline-none focus:border-[#C8A45D]';

// Opciones del plato (p. ej. «Punto de la carne: poco / al punto / hecho»)
const ModifiersEditor = ({ value, onSave }) => {
  const [groups, setGroups] = useState(() => (value || []).map(g => ({ ...g, optionsText: (g.options || []).join(', ') })));
  const update = (i, k, v) => setGroups(prev => prev.map((g, j) => (j === i ? { ...g, [k]: v } : g)));
  const save = () => onSave(groups.map(g => ({
    id: g.id, name: g.name, required: !!g.required,
    options: String(g.optionsText || '').split(',').map(o => o.trim()).filter(Boolean)
  })));
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-stone-400">Opciones que elige el cliente (separadas por comas). Llegan a cocina con la comanda.</p>
      {groups.map((g, i) => (
        <div key={g.id || i} className="grid grid-cols-[1fr_auto] gap-1.5 bg-[#1A1A1A] border border-stone-800 rounded-lg p-2">
          <input className={inputCls} value={g.name} placeholder="Nombre (p. ej. Punto)" onChange={e => update(i, 'name', e.target.value)} aria-label="Nombre de la opción" />
          <button type="button" onClick={() => setGroups(prev => prev.filter((_, j) => j !== i))} className="text-[11px] text-red-300 px-2" aria-label="Quitar opción">✕</button>
          <input className={`${inputCls} col-span-2`} value={g.optionsText} placeholder="Poco hecho, Al punto, Hecho" onChange={e => update(i, 'optionsText', e.target.value)} aria-label="Valores" />
          <label className="col-span-2 flex items-center gap-1.5 text-[11px] text-stone-300">
            <input type="checkbox" checked={!!g.required} onChange={e => update(i, 'required', e.target.checked)} /> Obligatorio
          </label>
        </div>
      ))}
      <div className="flex gap-2">
        <button type="button" onClick={() => setGroups(prev => [...prev, { name: '', optionsText: '', required: false }])} className="px-2.5 py-1 rounded-lg border border-stone-700 text-[11px] text-stone-300">+ Añadir opción</button>
        <button type="button" onClick={save} className="px-2.5 py-1 rounded-lg bg-[#C8A45D] text-[#121212] text-[11px] font-bold">Guardar opciones</button>
      </div>
    </div>
  );
};

// Pestaña "Carta": altas y bajas, precios, fotos, disponibilidad, alérgenos, IVA y opciones.
// Con canManage = false (cocina, barra, camareros) solo se puede marcar «agotado».
export const MenuTab = ({ products, setProducts, categories, setCategories, allergenKeys, canManage = true }) => {
  const [editingProductId, setEditingProductId] = useState(null);
  const [savingProductId, setSavingProductId] = useState(null);
  const [newCat, setNewCat] = useState({ name: '', area: 'kitchen' });
  const [newProd, setNewProd] = useState({}); // categoryId -> { name, price }
  const [showInactive, setShowInactive] = useState(false);

  const handleSaveProduct = async (productId, updates) => {
    setSavingProductId(productId);
    try {
      const updated = await api(`/api/products/${productId}`, { method: 'PUT', body: updates });
      setProducts(prev => prev.map(p => (p.id === productId ? updated : p)));
    } catch (err) {
      alert(`No se pudo guardar el producto: ${err.message}`);
    } finally {
      setSavingProductId(null);
    }
  };

  const updateProductLocal = (productId, field, value) => {
    setProducts(prev => prev.map(p => (p.id === productId ? { ...p, [field]: value } : p)));
  };

  const addCategory = async (e) => {
    e.preventDefault();
    try {
      const cat = await api('/api/categories', { method: 'POST', body: newCat });
      setCategories && setCategories(prev => [...prev, cat]);
      setNewCat({ name: '', area: 'kitchen' });
    } catch (err) { alert(err.message); }
  };

  const saveCategory = async (id, body) => {
    try {
      const cat = await api(`/api/categories/${id}`, { method: 'PUT', body });
      setCategories && setCategories(prev => prev.map(c => (c.id === id ? cat : c)));
    } catch (err) { alert(err.message); }
  };

  const addProduct = async (categoryId) => {
    const d = newProd[categoryId] || {};
    try {
      const prod = await api('/api/products', { method: 'POST', body: { name: d.name, price: Number(d.price), categoryId } });
      setProducts(prev => [...prev, prod]);
      setNewProd(prev => ({ ...prev, [categoryId]: { name: '', price: '' } }));
      setEditingProductId(prod.id);
    } catch (err) { alert(err.message); }
  };

  // Foto propia del plato: se reduce en el móvil antes de subirla (máx. 1200 px, JPG)
  const [uploadingId, setUploadingId] = useState(null);
  const resizeImage = (file) => new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1200;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });

  const handlePhoto = async (productId, e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingId(productId);
    try {
      const dataUrl = await resizeImage(file);
      const updated = await api(`/api/products/${productId}/image`, { method: 'POST', body: { dataUrl } });
      setProducts(prev => prev.map(p => (p.id === productId ? updated : p)));
    } catch (err) {
      alert(`No se pudo subir la foto: ${err.message}`);
    } finally {
      setUploadingId(null);
    }
  };

  const visibleCats = [...categories]
    .filter(c => showInactive || c.active !== false)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const inactiveCount = products.filter(p => p.active === false).length + categories.filter(c => c.active === false).length;

  return (
    <div className="bg-[#1A1A1A] border border-stone-800 rounded-2xl p-4 space-y-4 shadow-xl">
      <div className="pb-2 border-b border-stone-800">
        <h3 className="font-display text-sm font-bold text-[#C8A45D]">Carta</h3>
        <p className="text-[10px] text-stone-400">
          {canManage
            ? 'Crea categorías y platos, cambia precios y fotos (toca la imagen), marca agotados y declara alérgenos. Los cambios se ven al instante en las mesas.'
            : 'Marca los platos agotados: dejan de poder pedirse al momento.'}
        </p>
      </div>

      {canManage && (
        <div className="p-2.5 bg-amber-950/30 border border-amber-800/60 rounded-xl text-[11px] text-amber-200">
          ⚠️ La información de alérgenos es obligatoria y la debe confirmar la cocina. El tipo de IVA de cada plato confírmalo con tu asesor.
        </div>
      )}

      {canManage && (
        <form onSubmit={addCategory} className="flex flex-wrap items-end gap-2 bg-[#121212] border border-stone-800 rounded-xl p-3">
          <label className="flex-1 min-w-[140px] text-[11px] text-stone-400">Nueva categoría
            <input className={`${inputCls} mt-1`} value={newCat.name} onChange={e => setNewCat({ ...newCat, name: e.target.value })} placeholder="Ej.: Entrantes" />
          </label>
          <label className="text-[11px] text-stone-400">Se prepara en
            <select className={`${inputCls} mt-1`} value={newCat.area} onChange={e => setNewCat({ ...newCat, area: e.target.value })}>
              <option value="kitchen">Cocina</option>
              <option value="bar">Barra</option>
            </select>
          </label>
          <button disabled={!newCat.name.trim()} className="px-3 py-2 rounded-lg bg-[#C8A45D] text-[#121212] text-xs font-bold disabled:opacity-40">+ Crear categoría</button>
        </form>
      )}

      {canManage && inactiveCount > 0 && (
        <label className="flex items-center gap-2 text-[11px] text-stone-400">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          Mostrar lo dado de baja ({inactiveCount})
        </label>
      )}

      {visibleCats.map(cat => {
        const catProducts = products
          .filter(p => p.categoryId === cat.id && (showInactive || p.active !== false))
          .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
        if (!canManage && catProducts.length === 0) return null;
        const np = newProd[cat.id] || { name: '', price: '' };
        return (
          <div key={cat.id} className={`space-y-2 ${cat.active === false ? 'opacity-60' : ''}`}>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <h4 className="text-xs font-bold text-stone-200">{cat.name}{cat.active === false && ' · de baja'}</h4>
              {canManage && (
                <>
                  <select value={cat.area || 'kitchen'} onChange={e => saveCategory(cat.id, { area: e.target.value })} className="bg-[#121212] border border-stone-700 rounded-lg px-1.5 py-0.5 text-[10px] text-stone-300" aria-label={`Dónde se prepara ${cat.name}`}>
                    <option value="kitchen">{AREA_LABELS.kitchen}</option>
                    <option value="bar">{AREA_LABELS.bar}</option>
                  </select>
                  <button onClick={() => { const name = window.prompt('Nuevo nombre de la categoría', cat.name); if (name && name.trim()) saveCategory(cat.id, { name: name.trim() }); }} className="text-[10px] text-stone-400 underline">Renombrar</button>
                  <button
                    onClick={() => (cat.active === false || window.confirm(`¿Dar de baja «${cat.name}»? Sus platos dejarán de verse en la carta (no se borra nada).`)) && saveCategory(cat.id, { active: cat.active === false })}
                    className="text-[10px] text-red-300 underline"
                  >
                    {cat.active === false ? 'Reactivar' : 'Dar de baja'}
                  </button>
                </>
              )}
            </div>

            {catProducts.map(prod => {
              const isEditing = editingProductId === prod.id;
              const allergens = Array.isArray(prod.allergens) ? prod.allergens : [];
              const inactive = prod.active === false;
              return (
                <div key={prod.id} className={`bg-[#121212] border rounded-xl p-3 space-y-2 ${inactive ? 'opacity-60 border-stone-800' : prod.isAvailable === false ? 'border-red-900/60' : 'border-stone-800'}`}>
                  <div className="flex items-center gap-3">
                    {canManage ? (
                      <label className="relative w-14 h-14 rounded-lg overflow-hidden shrink-0 cursor-pointer group" title="Cambiar foto">
                        <img src={prod.image} onError={onImgError} alt="" className="w-full h-full object-cover" />
                        <span className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white bg-black/55 transition ${uploadingId === prod.id || !prod.image ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                          {uploadingId === prod.id ? '…' : prod.image ? '📷 Foto' : '📷 Añadir'}
                        </span>
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handlePhoto(prod.id, e)} />
                      </label>
                    ) : (
                      <img src={prod.image} onError={onImgError} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-[#F4EFE6] truncate">{prod.name}{inactive && ' · de baja'}</p>
                      <p className="text-[10px] text-stone-500">
                        {allergens.length ? allergens.map(a => ALLERGEN_LABELS[a] || a).join(', ') : 'Sin alérgenos declarados'}
                        {canManage && ` · IVA ${prod.vatRate ?? 10} %`}
                      </p>
                    </div>
                    {canManage ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <input
                          type="number" min="0" step="0.1" value={prod.price}
                          onChange={(e) => updateProductLocal(prod.id, 'price', e.target.value)}
                          onBlur={(e) => handleSaveProduct(prod.id, { price: Number(e.target.value) })}
                          className="w-16 bg-[#1A1A1A] border border-stone-700 rounded-lg px-1.5 py-1 text-xs text-right text-[#C8A45D] font-mono outline-none focus:border-[#C8A45D]"
                          aria-label={`Precio de ${prod.name}`}
                        />
                        <span className="text-xs text-stone-500">€</span>
                      </div>
                    ) : (
                      <span className="text-xs text-[#C8A45D] font-mono shrink-0">{formatPrice(prod.price)}</span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <button
                      onClick={() => handleSaveProduct(prod.id, { isAvailable: prod.isAvailable === false })}
                      disabled={savingProductId === prod.id || inactive}
                      className={`px-2.5 py-1 rounded-lg font-bold border transition ${prod.isAvailable === false ? 'bg-red-950 border-red-800 text-red-300' : 'bg-[#14281D] border-green-800 text-green-300'}`}
                    >
                      {prod.isAvailable === false ? '⛔ Agotado' : '✅ Disponible'}
                    </button>
                    {canManage && (
                      <>
                        <button onClick={() => setEditingProductId(isEditing ? null : prod.id)} className="px-2.5 py-1 rounded-lg border border-stone-700 text-stone-300 hover:text-white">
                          {isEditing ? 'Cerrar' : 'Editar'}
                        </button>
                        <button
                          onClick={() => (inactive || window.confirm(`¿Dar de baja «${prod.name}»? Dejará de verse en la carta. Los pedidos antiguos no cambian.`)) && handleSaveProduct(prod.id, { active: inactive })}
                          className="px-2.5 py-1 rounded-lg border border-red-900/70 text-red-300"
                        >
                          {inactive ? 'Reactivar' : 'Dar de baja'}
                        </button>
                      </>
                    )}
                  </div>

                  {canManage && isEditing && (
                    <div className="space-y-3 pt-2 border-t border-stone-800">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {[['name', 'Nombre'], ['name_en', 'Nombre en inglés']].map(([k, label]) => (
                          <label key={k} className="text-[11px] text-stone-400">{label}
                            <input className={`${inputCls} mt-1`} value={prod[k] || ''} onChange={e => updateProductLocal(prod.id, k, e.target.value)} onBlur={e => handleSaveProduct(prod.id, { [k]: e.target.value })} />
                          </label>
                        ))}
                        {[['description', 'Descripción'], ['description_en', 'Descripción en inglés']].map(([k, label]) => (
                          <label key={k} className="text-[11px] text-stone-400 sm:col-span-1">{label}
                            <textarea rows={2} className={`${inputCls} mt-1`} value={prod[k] || ''} onChange={e => updateProductLocal(prod.id, k, e.target.value)} onBlur={e => handleSaveProduct(prod.id, { [k]: e.target.value })} />
                          </label>
                        ))}
                        <label className="text-[11px] text-stone-400">Categoría
                          <select className={`${inputCls} mt-1`} value={prod.categoryId} onChange={e => handleSaveProduct(prod.id, { categoryId: e.target.value })}>
                            {categories.map(c => <option key={c.id} value={c.id}>{c.name}{c.active === false ? ' (de baja)' : ''}</option>)}
                          </select>
                        </label>
                        <label className="text-[11px] text-stone-400">Se prepara en
                          <select className={`${inputCls} mt-1`} value={prod.area || ''} onChange={e => handleSaveProduct(prod.id, { area: e.target.value || null })}>
                            <option value="">Como su categoría ({AREA_LABELS[cat.area || 'kitchen']})</option>
                            <option value="kitchen">Cocina</option>
                            <option value="bar">Barra</option>
                          </select>
                        </label>
                        <label className="text-[11px] text-stone-400">Tipo de IVA
                          <select className={`${inputCls} mt-1`} value={prod.vatRate ?? 10} onChange={e => handleSaveProduct(prod.id, { vatRate: Number(e.target.value) })}>
                            {VAT_RATES.map(v => <option key={v} value={v}>{v} %</option>)}
                          </select>
                        </label>
                        <label className="text-[11px] text-stone-400">Etiqueta (opcional)
                          <input className={`${inputCls} mt-1`} value={prod.badge || ''} placeholder="Ej.: Nuevo" onChange={e => updateProductLocal(prod.id, 'badge', e.target.value)} onBlur={e => handleSaveProduct(prod.id, { badge: e.target.value })} />
                        </label>
                      </div>

                      <div>
                        <p className="text-[11px] text-stone-400 mb-1.5">Alérgenos</p>
                        <div className="flex flex-wrap gap-1.5">
                          {allergenKeys.map(key => {
                            const on = allergens.includes(key);
                            return (
                              <button
                                key={key}
                                onClick={() => handleSaveProduct(prod.id, { allergens: on ? allergens.filter(a => a !== key) : [...allergens, key] })}
                                className={`px-2 py-1 rounded-full text-[10px] font-semibold border transition ${on ? 'bg-amber-500 border-amber-400 text-black' : 'bg-[#1A1A1A] border-stone-700 text-stone-400 hover:text-white'}`}
                              >
                                {ALLERGEN_LABELS[key] || key}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <ModifiersEditor value={prod.modifiers} onSave={(modifiers) => handleSaveProduct(prod.id, { modifiers })} />
                    </div>
                  )}
                </div>
              );
            })}

            {canManage && cat.active !== false && (
              <div className="flex flex-wrap items-center gap-2 bg-[#121212]/60 border border-dashed border-stone-700 rounded-xl p-2">
                <input className={`${inputCls} flex-1 min-w-[120px]`} value={np.name} placeholder={`Nuevo plato en ${cat.name}`} onChange={e => setNewProd(prev => ({ ...prev, [cat.id]: { ...np, name: e.target.value } }))} aria-label={`Nombre del nuevo plato en ${cat.name}`} />
                <input className={`${inputCls} w-20`} type="number" min="0" step="0.1" value={np.price} placeholder="€" onChange={e => setNewProd(prev => ({ ...prev, [cat.id]: { ...np, price: e.target.value } }))} aria-label="Precio" />
                <button onClick={() => addProduct(cat.id)} disabled={!np.name?.trim() || np.price === ''} className="px-3 py-1.5 rounded-lg bg-[#C8A45D] text-[#121212] text-[11px] font-bold disabled:opacity-40">+ Añadir</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
