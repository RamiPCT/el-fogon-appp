import React from 'react';
import { Trash2, X, AlertTriangle, ArrowLeft } from 'lucide-react';

export const DeleteTableModal = ({ isOpen, table, onConfirm, onCancel }) => {
  if (!isOpen || !table) return null;

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-[#1A1A1A] border-2 border-[#5A1826] rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
        
        {/* Cabecera */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-[#5A1826]/40 text-red-400 flex items-center justify-center shrink-0 border border-red-800/80 shadow-md">
            <Trash2 className="w-5 h-5 text-red-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-sm font-bold text-red-200">
              ¿Eliminar Mesa #{table.number}?
            </h3>
            <p className="text-xs text-stone-400">
              Capacidad: {table.capacity} comensales
            </p>
          </div>
          <button 
            onClick={onCancel}
            className="text-stone-400 hover:text-white p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mensaje de Confirmación */}
        <div className="bg-[#121212] p-3.5 rounded-xl border border-stone-800 text-xs text-stone-300 space-y-2.5">
          <p className="leading-relaxed">
            Esta acción quitará la mesa del plano físico del salón. Ya no estará disponible para comensales ni para asignar comandas.
          </p>
          <div className="p-2.5 bg-[#5A1826]/20 border border-red-900/60 rounded-lg text-red-200 text-[11px] leading-relaxed flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>Los cambios se guardarán automáticamente al publicar el plano.</span>
          </div>
        </div>

        {/* Acciones */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            onClick={onCancel}
            className="py-2.5 px-3 bg-stone-800 hover:bg-stone-700 text-stone-300 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Cancelar</span>
          </button>
          
          <button
            onClick={onConfirm}
            className="py-2.5 px-3 bg-gradient-to-r from-[#5A1826] to-red-800 hover:from-red-900 hover:to-red-700 text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 border border-red-700 shadow-lg"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Eliminar</span>
          </button>
        </div>

      </div>
    </div>
  );
};
