import { GripVertical, ArrowUp, ArrowDown, Copy, Trash2, Plus } from 'lucide-react';
import AssetPicker from './AssetPicker.jsx';
import AutoTextarea from './AutoTextarea.jsx';

export default function SegmentBlock({
  seg,
  index,
  total,
  assets,
  defaults,
  layouts = [],
  onChange,
  onDelete,
  onDuplicate,
  onMove,
  onAddAfter,
  onDragStart,
  onDragEnter,
  onDrop,
  onDragEnd,
  isDragOver,
}) {
  // Disposición elegida -> qué roles de input necesita (fondo/top/avatar). Solo
  // se muestra el select de cada input si la disposición tiene ese rol.
  const curLayout = seg.layout || defaults.layout || 'avatar_abajo';
  const tpl = layouts.find((t) => t.id === curLayout);
  // Si la disposición no existe (falta), mostramos todos los inputs por si acaso.
  const roles = tpl ? new Set((tpl.elements || []).map((el) => el.role)) : new Set(['fondo', 'top', 'avatar']);
  return (
    <div
      className={`segment ${isDragOver ? 'dragover' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div className="seg-bar">
        <span
          className="seg-handle"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          title="Arrastra para reordenar"
        >
          <GripVertical size={16} />
        </span>
        <span className="seg-index">{index + 1}</span>
        <input
          className="seg-nombre"
          value={seg.nombre || ''}
          placeholder={`Plano ${index + 1}`}
          onChange={(e) => onChange({ nombre: e.target.value })}
        />
        <div className="seg-actions">
          <button className="btn-icon" title="Subir" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp size={16} />
          </button>
          <button
            className="btn-icon"
            title="Bajar"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown size={16} />
          </button>
          <button className="btn-icon" title="Duplicar" onClick={onDuplicate}>
            <Copy size={16} />
          </button>
          <button
            className="btn-icon danger"
            title="Eliminar"
            disabled={total === 1}
            onClick={onDelete}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="seg-pickers">
        <label className="voice-field seg-field">
          <span className="ap-label">Disposición</span>
          <select
            value={curLayout}
            onChange={(e) => onChange({ layout: e.target.value })}
          >
            {!layouts.some((t) => t.id === curLayout) && (
              <option value={curLayout}>{curLayout} (falta)</option>
            )}
            {layouts.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        {roles.has('avatar') && (
          <AssetPicker
            kind="avatar"
            value={seg.avatar}
            options={assets.avatares}
            defaultValue={defaults.avatar}
            onChange={(v) => onChange({ avatar: v })}
          />
        )}
        {roles.has('top') && (
          <AssetPicker
            kind="top"
            value={seg.top}
            options={assets.topVideos}
            defaultValue={defaults.top}
            onChange={(v) => onChange({ top: v })}
          />
        )}
        {roles.has('fondo') && (
          <AssetPicker
            kind="fondo"
            value={seg.fondo}
            options={assets.fondos}
            defaultValue={defaults.fondo}
            onChange={(v) => onChange({ fondo: v })}
          />
        )}

        <label className="voice-field seg-field">
          <span className="ap-label">Música</span>
          <select
            value={seg.musica || ''}
            onChange={(e) => onChange({ musica: e.target.value })}
          >
            <option value="">↳ Continúa la anterior</option>
            <option value="none">Silencio (corta la música)</option>
            {(assets.musica || []).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            {seg.musica &&
              seg.musica !== 'none' &&
              !(assets.musica || []).includes(seg.musica) && (
                <option value={seg.musica}>{seg.musica} (falta)</option>
              )}
          </select>
        </label>

        <label className="voice-field seg-field">
          <span className="ap-label">Duración (s)</span>
          <input
            type="number"
            min="0"
            step="0.5"
            placeholder="auto (voz)"
            value={seg.duracion ?? ''}
            onChange={(e) => onChange({ duracion: e.target.value })}
          />
        </label>
      </div>

      <AutoTextarea
        value={seg.texto || ''}
        placeholder="Texto que leerá la voz en off en este plano…"
        onChange={(v) => onChange({ texto: v })}
      />

      <div className="seg-add">
        <button className="add-between" onClick={onAddAfter}>
          <Plus size={16} /> Añadir plano
        </button>
      </div>
    </div>
  );
}
