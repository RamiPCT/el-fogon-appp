import React, { useState } from 'react';
import { api } from '../../utils/api';
import { formatPrice } from '../../utils/formatters';
import { onImgError } from '../../utils/images';
import { ALLERGEN_LABELS } from './labels';

// Pestaña "Carta" del panel del dueño: precio, disponibilidad, alérgenos y foto
export const MenuTab = ({ products, setProducts, categories, allergenKeys }) => {
  const [editingProductId, setEditingProductId] = useState(null);
  const [savingProductId, setSavingProductId] = useState(null);

  // Guardar cambios de un producto de la carta
  const handleSaveProduct = async (productId, updates) => {
    setSavingProductId(productId);
    try {
      const updated = await api(`/api/products/${productId}`, { method: 'PUT', body: updates });
      setProducts(prev => prev.map(p => p.id === productId ? updated : p));
    } catch (err) {
      alert(`No se pudo guardar el producto: ${err.message}`);
    } finally {
      setSavingProductId(null);
    }
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
      setProducts(prev => prev.map(p => p.id === productId ? updated : p));
    } catch (err) {
      alert(`No se pudo subir la foto: ${err.message}`);
    } finally {
      setUploadingId(null);
    }
  };

  const updateProductLocal = (productId, field, value) => {
    setProducts(prev => prev.map(p => p.id === productId ? { ...p, [field]: value } : p));
  };

  return (
    <div className="bg-[#1A1A1A] border border-stone-800 rounded-2xl p-3.5 space-y-3 shadow-xl">
      <div className="pb-2 border-b border-stone-800">
        <h3 className="font-display text-sm font-bold text-[#C8A45D]">Carta</h3>
        <p className="text-[10px] text-stone-400">
          Cambia precios y fotos (toca la imagen), marca platos como agotados y declara los alérgenos. Los cambios se ven al instante en las mesas.
        </p>
      </div>

      <div className="p-2.5 bg-amber-950/30 border border-amber-800/60 rounded-xl text-[11px] text-amber-200">
        ⚠️ La información de alérgenos es obligatoria y la debe confirmar la cocina. Si un plato no tiene alérgenos marcados, la carta pide al cliente que consulte al personal.
      </div>

      {categories.map(cat => {
        const catProducts = products.filter(p => p.categoryId === cat.id);
        if (catProducts.length === 0) return null;
        return (
          <div key={cat.id} className="space-y-2">
            <h4 className="text-xs font-bold text-stone-300 pt-1">{cat.name}</h4>
            {catProducts.map(prod => {
              const isEditing = editingProductId === prod.id;
              const allergens = Array.isArray(prod.allergens) ? prod.allergens : [];
              return (
                <div key={prod.id} className={`bg-[#121212] border rounded-xl p-3 space-y-2 ${prod.isAvailable === false ? 'border-red-900/60' : 'border-stone-800'}`}>
                  <div className="flex items-center gap-3">
                    <label className="relative w-14 h-14 rounded-lg overflow-hidden shrink-0 cursor-pointer group" title="Cambiar foto">
                      <img src={prod.image} onError={onImgError} alt="" className="w-full h-full object-cover" />
                      <span className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white bg-black/55 transition ${uploadingId === prod.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                        {uploadingId === prod.id ? '…' : '📷 Foto'}
                      </span>
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => handlePhoto(prod.id, e)} />
                    </label>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-[#F4EFE6] truncate">{prod.name}</p>
                      <p className="text-[10px] text-stone-500">
                        {allergens.length ? allergens.map(a => ALLERGEN_LABELS[a] || a).join(', ') : 'Sin alérgenos declarados'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={prod.price}
                        onChange={(e) => updateProductLocal(prod.id, 'price', e.target.value)}
                        onBlur={(e) => handleSaveProduct(prod.id, { price: Number(e.target.value) })}
                        className="w-16 bg-[#1A1A1A] border border-stone-700 rounded-lg px-1.5 py-1 text-xs text-right text-[#C8A45D] font-mono outline-none focus:border-[#C8A45D]"
                        aria-label={`Precio de ${prod.name}`}
                      />
                      <span className="text-xs text-stone-500">€</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <button
                      onClick={() => handleSaveProduct(prod.id, { isAvailable: prod.isAvailable === false })}
                      disabled={savingProductId === prod.id}
                      className={`px-2.5 py-1 rounded-lg font-bold border transition ${
                        prod.isAvailable === false
                          ? 'bg-red-950 border-red-800 text-red-300'
                          : 'bg-[#14281D] border-green-800 text-green-300'
                      }`}
                    >
                      {prod.isAvailable === false ? '⛔ Agotado' : '✅ Disponible'}
                    </button>
                    <button
                      onClick={() => setEditingProductId(isEditing ? null : prod.id)}
                      className="px-2.5 py-1 rounded-lg border border-stone-700 text-stone-300 hover:text-white"
                    >
                      {isEditing ? 'Cerrar alérgenos' : 'Editar alérgenos'}
                    </button>
                    <span className="text-stone-500">Precio actual: {formatPrice(prod.price)}</span>
                  </div>

                  {isEditing && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {allergenKeys.map(key => {
                        const on = allergens.includes(key);
                        return (
                          <button
                            key={key}
                            onClick={() => handleSaveProduct(prod.id, { allergens: on ? allergens.filter(a => a !== key) : [...allergens, key] })}
                            className={`px-2 py-1 rounded-full text-[10px] font-semibold border transition ${
                              on ? 'bg-amber-500 border-amber-400 text-black' : 'bg-[#1A1A1A] border-stone-700 text-stone-400 hover:text-white'
                            }`}
                          >
                            {ALLERGEN_LABELS[key] || key}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
