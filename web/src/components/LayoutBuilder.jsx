import { useRef, useState } from 'react';
import { Trash2, ChevronUp, ChevronDown, X, Plus } from 'lucide-react';
import { api, assetUrl } from '../api';
import { useDialog } from './Dialog.jsx';

// Lienzo de referencia (Instagram 9:16). Toda x/y/w/h es en píxeles sobre él.
const CANVAS = { w: 1080, h: 1920 };
const DISPLAY_W = 270; // ancho del lienzo en pantalla
const SCALE = DISPLAY_W / CANVAS.w; // px lienzo -> px pantalla

const ROLE_META = {
  fondo: { label: 'Fondo', color: '#4b4b6b' },
  top: { label: 'Vídeo', color: '#2563eb' },
  avatar: { label: 'Avatar', color: '#16a34a' },
  imagen: { label: 'Imagen', color: '#d97706' },
  efecto: { label: 'Efecto', color: '#7c3aed' },
  subtitle: { label: 'Subtítulo', color: '#0891b2' },
};

// Efectos del rol `efecto`. `amount` 0 = intensidad por defecto (def).
const EFFECTS = [
  { id: 'blur', label: 'Difuminar', def: 25 },
  { id: 'oscurecer', label: 'Oscurecer', def: 45 },
  { id: 'aclarar', label: 'Aclarar', def: 35 },
  { id: 'pixelar', label: 'Pixelar', def: 18 },
];
const EFFECT_DEF = Object.fromEntries(EFFECTS.map((e) => [e.id, e.def]));

// Estilo CSS aproximado del efecto para la vista previa del lienzo.
function effectPreview(el) {
  const amt = el.amount > 0 ? el.amount : EFFECT_DEF[el.effect] ?? 25;
  if (el.effect === 'oscurecer') return { background: `rgba(0,0,0,${amt / 100})` };
  if (el.effect === 'aclarar') return { background: `rgba(255,255,255,${amt / 100})` };
  const px = Math.max(1, amt * SCALE * (el.effect === 'pixelar' ? 0.4 : 1));
  const blur = `blur(${px.toFixed(1)}px)`;
  return { backdropFilter: blur, WebkitBackdropFilter: blur, background: 'transparent' };
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Un elemento puede salirse del lienzo (medio dentro / medio fuera): el vídeo
// recorta a lo que quede dentro. KEEP_VISIBLE px siguen sobre el lienzo al
// arrastrar para poder agarrar la caja; OVER limita cuánto puede crecer/salir.
const KEEP_VISIBLE = 40;
const OVER = { w: CANVAS.w, h: CANVAS.h }; // margen permitido fuera por lado

// Caja por defecto al añadir un elemento nuevo de cada rol.
const VISUAL_ROLES = ['fondo', 'top', 'avatar', 'imagen'];
// pos -> object-position CSS para la vista previa del recorte.
const POS_CSS = { centro: 'center', arriba: 'top', abajo: 'bottom', izquierda: 'left', derecha: 'right' };

function freshElement(role, src = '') {
  // Fondo/top arrancan en 'recortar' (cover): la mayoría de vídeos son
  // horizontales y deformarlos al estirar queda feo; mejor recortar.
  if (role === 'fondo') return { role, x: 0, y: 0, w: CANVAS.w, h: CANVAS.h, fit: 'recortar', pos: 'centro' };
  if (role === 'top') return { role, x: 0, y: 0, w: CANVAS.w, h: 960, fit: 'recortar', pos: 'centro' };
  if (role === 'efecto') return { role, x: 0, y: 1280, w: CANVAS.w, h: 640, effect: 'blur', amount: 0 };
  if (role === 'subtitle') return { role, x: 60, y: 1460, w: CANVAS.w - 120, h: 300 };
  const base = { role, x: 240, y: 1140, w: 600, h: 600, bounce: role === 'avatar', fit: 'estirar', pos: 'centro' };
  if (role === 'imagen') base.src = src;
  return base;
}

/**
 * Editor visual de una plantilla de disposición. Coloca cada elemento en una caja
 * libre sobre el lienzo 1080×1920; se arrastra para mover y se redimensiona por la
 * esquina. Guarda vía PUT /api/layouts/:id.
 */
export default function LayoutBuilder({ initial, assets, onClose, onSaved }) {
  const { alert, confirm } = useDialog();
  const [name, setName] = useState(initial?.name || 'Nueva plantilla');
  const [elements, setElements] = useState(() =>
    (initial?.elements || []).map((e) => ({ ...e }))
  );
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef(null);
  const drag = useRef(null); // { mode:'move'|'resize', i, startX, startY, ox, oy, ow, oh }

  const imagenes = assets?.imagenes || [];
  const editingId = initial?.id || null; // null = plantilla nueva
  const canDelete = !!editingId && !initial?.builtin; // built-in se restaura desde la tarjeta

  const patchEl = (i, patch) =>
    setElements((els) => els.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));

  const addEl = (role) => {
    const src = role === 'imagen' ? imagenes[0] || '' : '';
    if (role === 'imagen' && !src) {
      alert({
        title: 'No hay imágenes',
        message: 'Sube imágenes en la pestaña «Imágenes» para usarlas como elementos flotantes.',
      });
      return;
    }
    setElements((els) => [...els, freshElement(role, src)]);
    setSel(elements.length);
  };

  const removeEl = (i) => {
    setElements((els) => els.filter((_, idx) => idx !== i));
    setSel((s) => (s >= i ? Math.max(0, s - 1) : s));
  };

  const moveLayer = (i, dir) =>
    setElements((els) => {
      const j = i + dir;
      if (j < 0 || j >= els.length) return els;
      const c = [...els];
      [c[i], c[j]] = [c[j], c[i]];
      setSel(j);
      return c;
    });

  // --- Arrastrar / redimensionar (pointer events, sin librería) ---
  const onPointerDown = (e, i, mode, corner = 'se') => {
    e.preventDefault();
    e.stopPropagation();
    setSel(i);
    const el = elements[i];
    drag.current = {
      mode,
      corner,
      i,
      startX: e.clientX,
      startY: e.clientY,
      ox: el.x,
      oy: el.y,
      ow: el.w,
      oh: el.h,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / SCALE;
    const dy = (e.clientY - d.startY) / SCALE;
    if (d.mode === 'move') {
      // Puede salirse por cualquier lado; deja KEEP_VISIBLE px dentro para agarrar.
      patchEl(d.i, {
        x: Math.round(clamp(d.ox + dx, -(d.ow - KEEP_VISIBLE), CANVAS.w - KEEP_VISIBLE)),
        y: Math.round(clamp(d.oy + dy, -(d.oh - KEEP_VISIBLE), CANVAS.h - KEEP_VISIBLE)),
      });
    } else {
      // Redimensiona desde la esquina arrastrada. Los bordes opuestos quedan fijos.
      // La caja puede crecer más allá del lienzo (lo de fuera se recorta al render).
      let { ox: x, oy: y, ow: w, oh: h } = d;
      if (d.corner.includes('e')) {
        w = clamp(d.ow + dx, 40, CANVAS.w + OVER.w - d.ox);
      } else {
        x = clamp(d.ox + dx, -OVER.w, d.ox + d.ow - 40);
        w = d.ow + (d.ox - x);
      }
      if (d.corner.includes('s')) {
        h = clamp(d.oh + dy, 40, CANVAS.h + OVER.h - d.oy);
      } else {
        y = clamp(d.oy + dy, -OVER.h, d.oy + d.oh - 40);
        h = d.oh + (d.oy - y);
      }
      patchEl(d.i, {
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
      });
    }
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  async function save() {
    const cleanName = name.trim();
    if (!cleanName) {
      alert({ title: 'Falta el nombre', message: 'Ponle un nombre a la plantilla.' });
      return;
    }
    if (!elements.length) {
      alert({ title: 'Plantilla vacía', message: 'Añade al menos un elemento.' });
      return;
    }
    setBusy(true);
    try {
      // id: al editar se conserva el existente; al crear, el backend lo deriva del nombre.
      await api.saveLayout(editingId || cleanName, {
        name: cleanName,
        format: 'instagram',
        elements,
      });
      onSaved?.();
      onClose?.();
    } catch (e) {
      alert({ title: 'No se pudo guardar', message: e.message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!editingId) return;
    const ok = await confirm({
      title: 'Borrar plantilla',
      message: `¿Borrar «${name}»? No se puede deshacer.`,
      confirmText: 'Borrar',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.deleteLayout(editingId);
      onSaved?.();
      onClose?.();
    } catch (e) {
      alert({ title: 'No se pudo borrar', message: e.message, tone: 'danger' });
      setBusy(false);
    }
  }

  const cur = elements[sel];

  return (
    <div className="lb-overlay" onClick={onClose}>
      <div className="lb-modal" onClick={(e) => e.stopPropagation()}>
        <header className="lb-head">
          <input
            className="lb-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre de la plantilla"
          />
          <button className="btn-icon" title="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="lb-body">
          {/* Lienzo Instagram 9:16 */}
          <div
            className="lb-canvas"
            ref={canvasRef}
            style={{ width: DISPLAY_W, height: DISPLAY_W * (CANVAS.h / CANVAS.w) }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            {elements.map((el, i) => {
              const m = ROLE_META[el.role] || ROLE_META.imagen;
              const showImg = el.role === 'imagen' && el.src;
              const isFx = el.role === 'efecto';
              const isSub = el.role === 'subtitle';
              const bg = isFx ? effectPreview(el) : { background: showImg ? 'transparent' : `${m.color}33` };
              return (
                <div
                  key={i}
                  className={`lb-box ${i === sel ? 'sel' : ''}`}
                  style={{
                    left: el.x * SCALE,
                    top: el.y * SCALE,
                    width: el.w * SCALE,
                    height: el.h * SCALE,
                    borderColor: m.color,
                    ...bg,
                  }}
                  onPointerDown={(e) => onPointerDown(e, i, 'move')}
                >
                  {showImg && (
                    <img
                      className="lb-box-img"
                      src={assetUrl.imagen(el.src)}
                      alt=""
                      draggable={false}
                      style={{
                        objectFit: el.fit === 'recortar' ? 'cover' : 'fill',
                        objectPosition: POS_CSS[el.pos] || 'center',
                      }}
                    />
                  )}
                  {isSub && (
                    <span
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textAlign: 'center',
                        padding: 2,
                        color: '#fff',
                        fontWeight: 800,
                        fontSize: Math.max(7, el.h * SCALE * 0.22),
                        lineHeight: 1.1,
                        textShadow: '0 0 2px #000, 0 0 2px #000, 0 0 2px #000',
                        pointerEvents: 'none',
                      }}
                    >
                      Texto del plano
                    </span>
                  )}
                  <span className="lb-box-label" style={{ background: m.color }}>
                    {m.label}
                    {isFx ? ` · ${EFFECTS.find((e) => e.id === el.effect)?.label || el.effect}` : ''}
                    {el.bounce ? ' ↕' : ''}
                  </span>
                  {['nw', 'ne', 'sw', 'se'].map((c) => (
                    <span
                      key={c}
                      className={`lb-handle ${c}`}
                      style={{ background: m.color }}
                      onPointerDown={(e) => onPointerDown(e, i, 'resize', c)}
                    />
                  ))}
                </div>
              );
            })}
          </div>

          {/* Panel lateral */}
          <div className="lb-side">
            <div className="lb-add">
              <span className="muted small">Añadir elemento</span>
              <div className="lb-add-btns">
                {['fondo', 'top', 'avatar', 'imagen', 'efecto', 'subtitle'].map((r) => (
                  <button key={r} className="btn lb-add-btn" onClick={() => addEl(r)}>
                    <Plus size={13} /> {ROLE_META[r].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="lb-layers">
              {elements.length === 0 && (
                <p className="muted small pad">Sin elementos. Añade fondo, vídeo o avatar.</p>
              )}
              {/* Lista invertida: arriba = capa delantera (último del array). */}
              {elements.map((_, idx) => elements.length - 1 - idx).map((i) => {
                const el = elements[i];
                const m = ROLE_META[el.role] || ROLE_META.imagen;
                return (
                  <div
                    key={i}
                    className={`lb-layer ${i === sel ? 'sel' : ''}`}
                    onClick={() => setSel(i)}
                  >
                    <span className="lb-dot" style={{ background: m.color }} />
                    <span className="lb-layer-name">
                      {m.label}
                      {el.role === 'imagen' && el.src ? ` · ${el.src}` : ''}
                    </span>
                    <button
                      className="btn-icon"
                      title="Subir capa"
                      onClick={(e) => {
                        e.stopPropagation();
                        moveLayer(i, 1);
                      }}
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      className="btn-icon"
                      title="Bajar capa"
                      onClick={(e) => {
                        e.stopPropagation();
                        moveLayer(i, -1);
                      }}
                    >
                      <ChevronDown size={14} />
                    </button>
                    <button
                      className="btn-icon danger"
                      title="Quitar"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeEl(i);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>

            {cur && (
              <div className="lb-props">
                <span className="muted small">
                  Propiedades · {ROLE_META[cur.role]?.label || cur.role}
                </span>
                {cur.role === 'subtitle' && (
                  <p className="muted small pad">
                    El texto del plano se trocea y se reparte automáticamente. La caja fija
                    posición y ancho; el estilo (fuente, tamaño, color, contorno) es global.
                  </p>
                )}
                {cur.role === 'imagen' && (
                  <label className="lb-prop">
                    <span>Imagen</span>
                    <select value={cur.src || ''} onChange={(e) => patchEl(sel, { src: e.target.value })}>
                      {!imagenes.includes(cur.src) && cur.src && (
                        <option value={cur.src}>{cur.src} (falta)</option>
                      )}
                      {imagenes.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {cur.role === 'efecto' && (
                  <>
                    <label className="lb-prop">
                      <span>Efecto</span>
                      <select
                        value={cur.effect || 'blur'}
                        onChange={(e) => patchEl(sel, { effect: e.target.value })}
                      >
                        {EFFECTS.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="lb-prop">
                      <span>Intensidad {cur.amount > 0 ? cur.amount : '(auto)'}</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={cur.amount || 0}
                        onChange={(e) => patchEl(sel, { amount: Math.round(Number(e.target.value) || 0) })}
                      />
                    </label>
                  </>
                )}
                {VISUAL_ROLES.includes(cur.role) && (
                  <>
                    <label className="lb-prop">
                      <span>Ajuste</span>
                      <select
                        value={cur.fit || 'estirar'}
                        onChange={(e) => patchEl(sel, { fit: e.target.value })}
                      >
                        <option value="estirar">Estirar (rellena, deforma)</option>
                        <option value="recortar">Recortar (cover, sin deformar)</option>
                      </select>
                    </label>
                    {cur.fit === 'recortar' && (
                      <label className="lb-prop">
                        <span>Mostrar</span>
                        <select
                          value={cur.pos || 'centro'}
                          onChange={(e) => patchEl(sel, { pos: e.target.value })}
                        >
                          <option value="centro">Centro</option>
                          <option value="arriba">Arriba</option>
                          <option value="abajo">Abajo</option>
                          <option value="izquierda">Izquierda</option>
                          <option value="derecha">Derecha</option>
                        </select>
                      </label>
                    )}
                  </>
                )}
                <div className="lb-prop-grid">
                  {['x', 'y', 'w', 'h'].map((k) => (
                    <label key={k} className="lb-prop">
                      <span>{k.toUpperCase()}</span>
                      <input
                        type="number"
                        value={cur[k]}
                        onChange={(e) => {
                          const v = Math.round(Number(e.target.value) || 0);
                          // x/y pueden ser negativos (caja fuera por arriba/izquierda);
                          // w/h pueden superar el lienzo (caja más grande, se recorta).
                          const span = k === 'x' || k === 'w' ? CANVAS.w : CANVAS.h;
                          const over = k === 'x' || k === 'w' ? OVER.w : OVER.h;
                          const isSize = k === 'w' || k === 'h';
                          patchEl(sel, { [k]: clamp(v, isSize ? 40 : -over, span + over) });
                        }}
                      />
                    </label>
                  ))}
                </div>
                {(cur.role === 'avatar' || cur.role === 'imagen') && (
                  <label className="lb-check">
                    <input
                      type="checkbox"
                      checked={!!cur.bounce}
                      onChange={(e) => patchEl(sel, { bounce: e.target.checked })}
                    />
                    Flota (rebote vertical)
                  </label>
                )}
              </div>
            )}
          </div>
        </div>

        <footer className="lb-foot">
          {canDelete && (
            <button className="btn danger" disabled={busy} onClick={del}>
              Borrar
            </button>
          )}
          <span className="lb-spacer" />
          <button className="btn" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? 'Guardando…' : 'Guardar plantilla'}
          </button>
        </footer>
      </div>
    </div>
  );
}
