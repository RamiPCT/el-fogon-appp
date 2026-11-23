import React, { useRef, useMemo } from 'react';

// ---------------------------------------------------------------------------
// Plano del local compartido por el editor (Admin) y el plano público.
// Unidades lógicas: cada celda mide floor.cell (20). Todo se posiciona en %,
// así el plano se adapta a cualquier pantalla manteniendo la proporción.
// ---------------------------------------------------------------------------

export const ELEMENT_TYPES = {
  bar: { label: 'Barra', icon: '🍸', w: 200, h: 30 },
  wall: { label: 'Pared / columna', icon: '🧱', w: 100, h: 20 },
  zone: { label: 'Zona', icon: '✨', w: 160, h: 120 },
  entrance: { label: 'Entrada', icon: '🚪', w: 80, h: 20 },
  kitchen: { label: 'Cocina', icon: '👨‍🍳', w: 120, h: 80 },
  wc: { label: 'Aseos', icon: '🚻', w: 60, h: 60 },
  plant: { label: 'Planta', icon: '🌿', w: 40, h: 40 }
};

const elementClass = (type) => ({
  bar: 'bg-gradient-to-b from-[#3a2a17] to-[#22180c] border border-[#C8A45D]/60 shadow-[inset_0_1px_0_rgba(230,198,135,0.35)] text-[#E6C687] rounded-md',
  wall: 'bg-[repeating-linear-gradient(135deg,#2b2b2b_0_6px,#232323_6px_12px)] border border-stone-700 text-stone-400 rounded-sm',
  zone: 'border border-dashed border-[#C8A45D]/35 bg-[#14281D]/25 text-[#C8A45D]/80 rounded-xl',
  entrance: 'border-2 border-dashed border-stone-500 bg-black/30 text-stone-300 rounded-md',
  kitchen: 'bg-[#2a1218] border border-[#5A1826] text-red-200/80 rounded-lg',
  wc: 'bg-[#1d1d1d] border border-stone-700 text-stone-400 rounded-lg',
  plant: 'bg-[radial-gradient(circle,#1f4a30,#0f2418)] border border-emerald-900 text-emerald-300 rounded-full'
}[type] || 'border border-stone-700');

const pct = (v, total) => `${(v / total) * 100}%`;

export const FloorPlan = ({
  floor,
  tables = [],
  editable = false,
  // público
  renderTable,              // (table) => { className, content, ariaLabel, disabled, onClick, style }
  minTapPx = 28,
  // editor
  selected = null,          // { kind: 'table'|'element', id }
  onSelect,
  onChange,                 // (kind, id, patch)
  paintMode = false,
  onPaint,                  // (cellKey, value:boolean)
  zoom = 1,
  snap = 10
}) => {
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const paintRef = useRef(null);

  const cell = floor?.cell || 20;
  const cols = floor?.cols || 20;
  const rows = floor?.rows || 20;
  const W = cols * cell;
  const H = rows * cell;
  const voidSet = useMemo(() => new Set(floor?.voids || []), [floor]);

  // Ancho mínimo en el plano público para que las mesas se puedan tocar con el dedo
  const minWidthPx = useMemo(() => {
    if (editable || !tables.length) return undefined;
    const minTable = Math.min(...tables.map(t => t.width || 60));
    return Math.round((minTapPx * W) / Math.max(20, minTable));
  }, [editable, tables, W, minTapPx]);

  const unitsPerPx = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect && rect.width ? W / rect.width : 1;
  };
  const snapTo = (v) => Math.round(v / snap) * snap;

  // ---------- Arrastrar y redimensionar (ratón y táctil) ----------
  const startDrag = (e, kind, item, mode) => {
    if (!editable || paintMode) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect && onSelect({ kind, id: item.id });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const w = kind === 'table' ? (item.width || 60) : item.w;
    const h = kind === 'table' ? (item.height || 60) : item.h;
    dragRef.current = { kind, id: item.id, mode, startX: e.clientX, startY: e.clientY, x: item.x || 0, y: item.y || 0, w, h, k: unitsPerPx(), round: kind === 'table' && (item.shape === 'round' || item.shape === 'bar_stool') };
  };

  const moveDrag = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) * d.k;
    const dy = (e.clientY - d.startY) * d.k;
    if (d.mode === 'move') {
      const x = Math.min(W - d.w, Math.max(0, snapTo(d.x + dx)));
      const y = Math.min(H - d.h, Math.max(0, snapTo(d.y + dy)));
      onChange(d.kind, d.id, { x, y });
    } else {
      const minS = d.kind === 'table' ? 30 : cell / 2;
      const w = Math.min(W - d.x, Math.max(minS, snapTo(d.w + dx)));
      const h = Math.min(H - d.y, Math.max(minS, snapTo(d.h + dy)));
      if (d.kind === 'table' && d.round) {
        const side = Math.min(Math.max(w, h), W - d.x, H - d.y);
        onChange('table', d.id, { width: side, height: side });
      } else {
        onChange(d.kind, d.id, d.kind === 'table' ? { width: w, height: h } : { w, h });
      }
    }
  };

  const endDrag = () => { dragRef.current = null; };

  // ---------- Pintar la forma del local ----------
  const cellAt = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * cols);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * rows);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return null;
    return `${c},${r}`;
  };
  const paintDown = (e) => {
    const key = cellAt(e);
    if (!key) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const value = !voidSet.has(key); // si estaba dentro, se marca fuera (y viceversa)
    paintRef.current = { value, last: key };
    onPaint(key, value);
  };
  const paintMove = (e) => {
    const p = paintRef.current;
    if (!p) return;
    const key = cellAt(e);
    if (key && key !== p.last) {
      p.last = key;
      onPaint(key, p.value);
    }
  };

  const isSel = (kind, id) => selected && selected.kind === kind && selected.id === id;

  return (
    <div className={editable ? 'overflow-auto rounded-xl border border-stone-800 bg-[#0b0b0b] max-h-[70vh]' : 'overflow-x-auto fogon-no-scrollbar -mx-1 px-1'}>
      <div
        ref={canvasRef}
        className={`relative select-none ${editable ? 'mx-auto' : 'rounded-2xl overflow-hidden'} fogon-floor`}
        style={{
          // En el editor, con zoom 1x el plano entero cabe en pantalla (ancho y alto)
          width: editable ? `min(${zoom * 100}%, calc(${zoom} * 64vh * ${W / H}))` : '100%',
          minWidth: minWidthPx ? `${minWidthPx}px` : (editable ? `${Math.round(Math.max(300, cols * 13) * zoom)}px` : undefined),
          aspectRatio: `${W} / ${H}`
        }}
        onPointerDown={() => editable && !paintMode && onSelect && onSelect(null)}
      >
        {/* Cuadrícula (solo en el editor) */}
        {editable && (
          <div
            className="absolute inset-0 pointer-events-none opacity-60"
            style={{
              backgroundImage: 'linear-gradient(to right, #2a2a2a 1px, transparent 1px), linear-gradient(to bottom, #2a2a2a 1px, transparent 1px)',
              backgroundSize: `${100 / cols}% ${100 / rows}%`
            }}
          />
        )}

        {/* Celdas fuera del local */}
        {[...voidSet].map(key => {
          const [c, r] = key.split(',').map(Number);
          return (
            <div
              key={key}
              className={`absolute pointer-events-none ${editable ? 'bg-[repeating-linear-gradient(45deg,#050505_0_4px,#141414_4px_8px)]' : 'bg-[#121212]'}`}
              style={{ left: pct(c, cols), top: pct(r, rows), width: `calc(${100 / cols}% + 0.5px)`, height: `calc(${100 / rows}% + 0.5px)` }}
            />
          );
        })}

        {/* Elementos: barra, paredes, zonas... */}
        {(floor?.elements || []).map(el => {
          const sel = isSel('element', el.id);
          const meta = ELEMENT_TYPES[el.type] || ELEMENT_TYPES.zone;
          const vertical = el.h > el.w * 1.6;
          return (
            <div
              key={el.id}
              onPointerDown={(e) => startDrag(e, 'element', el, 'move')}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className={`absolute flex items-center justify-center overflow-hidden ${elementClass(el.type)} ${editable && !paintMode ? 'cursor-move touch-none' : 'pointer-events-none'} ${sel ? 'ring-2 ring-sky-400 z-20' : el.type === 'zone' ? 'z-0' : 'z-[5]'}`}
              style={{ left: pct(el.x, W), top: pct(el.y, H), width: pct(el.w, W), height: pct(el.h, H) }}
            >
              {el.type !== 'wall' && (
                <span className={`font-display font-bold uppercase tracking-[0.15em] text-[8px] sm:text-[9px] whitespace-nowrap px-1 ${vertical ? '[writing-mode:vertical-rl] rotate-180' : ''} ${el.type === 'zone' ? 'absolute top-1 left-1.5 normal-case tracking-normal font-script text-xs sm:text-sm' : ''}`}>
                  {el.type === 'plant' ? meta.icon : `${el.type === 'zone' ? '' : meta.icon + ' '}${el.label || meta.label}`}
                </span>
              )}
              {editable && sel && (
                <span
                  onPointerDown={(e) => startDrag(e, 'element', el, 'resize')}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  className="absolute -right-2 -bottom-2 w-6 h-6 sm:w-4 sm:h-4 sm:-right-1 sm:-bottom-1 rounded-md bg-sky-400 border-2 border-white cursor-se-resize touch-none shadow"
                  aria-label="Redimensionar"
                />
              )}
            </div>
          );
        })}

        {/* Mesas */}
        {tables.map(tb => {
          const w = tb.width || 60;
          const h = tb.height || 60;
          const round = tb.shape === 'round' || tb.shape === 'bar_stool';
          const style = { left: pct(tb.x || 0, W), top: pct(tb.y || 0, H), width: pct(w, W), height: pct(h, H) };

          if (editable) {
            const sel = isSel('table', tb.id);
            return (
              <div
                key={tb.id}
                onPointerDown={(e) => startDrag(e, 'table', tb, 'move')}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                className={`absolute z-10 flex flex-col items-center justify-center border-2 text-center leading-none ${round ? 'rounded-full' : 'rounded-lg'} ${paintMode ? 'pointer-events-none opacity-60' : 'cursor-move touch-none'} ${
                  sel ? 'bg-gradient-to-br from-[#E6C687] to-[#C8A45D] border-white text-[#121212] z-30 shadow-[0_0_16px_rgba(200,164,93,0.7)]'
                    : tb.status === 'OCCUPIED' ? 'bg-[#5A1826] border-red-900 text-stone-100'
                    : 'bg-[#14281D] border-[#C8A45D]/80 text-[#F4EFE6]'
                }`}
                style={style}
              >
                <span className="font-display font-bold text-[11px] sm:text-xs">{tb.number}</span>
                <span className="text-[8px] sm:text-[9px] opacity-80">{tb.capacity}p</span>
                {tb.nextReservation && <span className="absolute -top-2 -right-2 bg-amber-500 text-black text-[8px] font-bold px-1 rounded-full">{tb.nextReservation.startTime}</span>}
                {sel && (
                  <span
                    onPointerDown={(e) => startDrag(e, 'table', tb, 'resize')}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    className="absolute -right-2.5 -bottom-2.5 w-6 h-6 sm:w-4 sm:h-4 sm:-right-1.5 sm:-bottom-1.5 rounded-md bg-sky-400 border-2 border-white cursor-se-resize touch-none shadow"
                    aria-label="Redimensionar"
                  />
                )}
              </div>
            );
          }

          const r = renderTable ? renderTable(tb) : {};
          return (
            <button
              key={tb.id}
              type="button"
              onClick={r.disabled ? undefined : r.onClick}
              disabled={r.disabled}
              aria-label={r.ariaLabel}
              aria-pressed={r.pressed}
              className={`absolute z-10 flex flex-col items-center justify-center border-2 text-center leading-none transition active:scale-95 ${round ? 'rounded-full' : 'rounded-xl'} ${r.className || ''}`}
              style={style}
            >
              {r.content}
            </button>
          );
        })}

        {/* Capa para pintar la forma del local */}
        {editable && paintMode && (
          <div
            className="absolute inset-0 z-40 cursor-crosshair touch-none"
            onPointerDown={paintDown}
            onPointerMove={paintMove}
            onPointerUp={() => { paintRef.current = null; }}
            onPointerCancel={() => { paintRef.current = null; }}
          />
        )}
      </div>
    </div>
  );
};
