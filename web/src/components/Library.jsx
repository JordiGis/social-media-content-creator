import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pencil, Trash2, Plus, ArrowUp, Copy, RotateCcw, LayoutTemplate } from 'lucide-react';
import { api, assetUrl } from '../api';
import AssetThumb from './AssetThumb.jsx';
import LayoutBuilder from './LayoutBuilder.jsx';
import { useDialog } from './Dialog.jsx';

// Cada pestaña = un tipo de asset gestionable. `kind` es la clave del backend,
// `thumb` la que entiende AssetThumb y `from` extrae la lista de api.assets().
const TABS = [
  { key: 'avatares', kind: 'avatares', thumb: 'avatar', accept: 'image/*', label: 'Avatares', from: (a) => a.avatares },
  { key: 'imagenes', kind: 'imagenes', thumb: 'imagen', accept: 'image/*', label: 'Imágenes', from: (a) => a.imagenes },
  { key: 'top', kind: 'top', thumb: 'top', accept: 'video/*', label: 'Vídeos', from: (a) => a.topVideos },
  { key: 'fondos', kind: 'fondos', thumb: 'fondo', accept: 'video/*', label: 'Fondos', from: (a) => a.fondos },
  { key: 'musica', kind: 'musica', thumb: 'musica', accept: 'audio/*', label: 'Música', from: (a) => a.musica },
  // Pestaña especial: no son assets subibles sino el creador de disposiciones.
  { key: 'disposiciones', label: 'Disposiciones', special: 'layouts' },
];

const splitName = (name) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
};

/** Tarjeta de un asset: miniatura + nombre editable + (audio) reproductor + borrar. */
function AssetCard({ kind, thumb, name, onChanged }) {
  const { confirm, alert } = useDialog();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [base, ext] = splitName(name);
  const isAudio = thumb === 'musica' || thumb === 'voz';

  const startEdit = () => {
    setDraft(base);
    setEditing(true);
  };

  async function save() {
    const v = draft.trim();
    setEditing(false);
    if (!v || v === base) return;
    setBusy(true);
    try {
      await api.renameAsset(kind, name, v);
      onChanged();
    } catch (e) {
      alert({ title: 'No se pudo renombrar', message: e.message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    const ok = await confirm({
      title: 'Eliminar recurso',
      message: `¿Eliminar "${name}"? No se puede deshacer.`,
      confirmText: 'Eliminar',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.deleteAsset(kind, name);
      onChanged();
    } catch (e) {
      alert({ title: 'No se pudo eliminar', message: e.message, tone: 'danger' });
      setBusy(false);
    }
  }

  return (
    <div className={`lib-card ${busy ? 'busy' : ''}`}>
      <div className="lib-thumb-wrap">
        <AssetThumb kind={thumb} name={name} className="lib-thumb" />
      </div>

      {editing ? (
        <div className="lib-rename">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') setEditing(false);
            }}
            onBlur={save}
          />
          <span className="lib-ext">{ext}</span>
        </div>
      ) : (
        <button className="lib-name" title={`${name} · clic para renombrar`} onClick={startEdit}>
          {name}
        </button>
      )}

      {isAudio && (
        <audio
          className="lib-audio"
          controls
          preload="none"
          src={(thumb === 'voz' ? assetUrl.voz : assetUrl.musica)(name)}
        />
      )}

      <div className="lib-card-actions">
        <button className="btn-icon" title="Renombrar" onClick={startEdit}>
          <Pencil size={16} />
        </button>
        <button className="btn-icon danger" title="Eliminar" onClick={del}>
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

/** Alta de un asset nuevo: elegir archivo, ponerle nombre, subir. */
function Uploader({ tab, onUploaded }) {
  const { alert } = useDialog();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setName('');
    if (inputRef.current) inputRef.current.value = '';
  };

  function pick(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setName(splitName(f.name)[0]); // prefija el nombre con el del archivo
  }

  async function upload() {
    if (!file || busy) return;
    setBusy(true);
    try {
      await api.uploadAsset(tab.kind, file, name);
      reset();
      onUploaded();
    } catch (e) {
      alert({ title: 'No se pudo subir', message: e.message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lib-upload">
      <input ref={inputRef} type="file" accept={tab.accept} hidden onChange={pick} />
      {!file ? (
        <button className="btn btn-primary" onClick={() => inputRef.current?.click()}>
          <Plus size={16} /> Añadir {tab.label.toLowerCase()}
        </button>
      ) : (
        <div className="lib-upload-form">
          <span className="muted small lib-file" title={file.name}>
            {file.name}
          </span>
          <input
            className="lib-name-input"
            placeholder="Nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') upload();
              if (e.key === 'Escape') reset();
            }}
          />
          <button className="btn btn-primary" disabled={busy} onClick={upload}>
            {busy ? 'Subiendo…' : 'Subir'}
          </button>
          <button className="btn" disabled={busy} onClick={reset}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

// Predeterminados que hereda cada guion nuevo. Cada campo apunta a su lista de
// assets; al cambiarlo se persiste al instante vía PUT /api/defaults.
const DEFAULT_FIELDS = [
  { key: 'avatar', label: 'Avatar', from: (a) => a.avatares },
  { key: 'top', label: 'Vídeo superior', from: (a) => a.topVideos },
  { key: 'fondo', label: 'Fondo', from: (a) => a.fondos },
  { key: 'voz', label: 'Voz', from: (a) => a.voces },
  { key: 'musica', label: 'Música inicial', from: (a) => a.musica, optional: true },
  { key: 'layout', label: 'Disposición', dynamic: 'layout' },
];

function Defaults({ assets, layouts }) {
  const { alert } = useDialog();
  const [values, setValues] = useState(null);
  const [savingKey, setSavingKey] = useState('');

  useEffect(() => {
    api.getDefaults().then(setValues).catch(() => setValues({}));
  }, []);

  async function change(key, value) {
    const prev = values;
    setValues((v) => ({ ...v, [key]: value })); // optimista
    setSavingKey(key);
    try {
      setValues(await api.saveDefaults({ [key]: value }));
    } catch (e) {
      setValues(prev);
      alert({ title: 'No se pudo guardar', message: e.message, tone: 'danger' });
    } finally {
      setSavingKey('');
    }
  }

  if (!values) return null;

  return (
    <section className="lib-defaults">
      <h2 className="lib-subtitle">Predeterminados de nuevos guiones</h2>
      <p className="muted small">
        Cada guion nuevo arranca con estos recursos. Cámbialos cuando quieras; los guiones
        existentes no se tocan.
      </p>
      <div className="lib-defaults-grid">
        {DEFAULT_FIELDS.map((f) => {
          // Disposición -> plantillas; resto -> assets de su carpeta.
          const opts =
            f.dynamic === 'layout' ? (layouts || []).map((t) => ({ value: t.id, label: t.name })) : f.options;
          const list = opts ? opts.map((o) => o.value) : f.from(assets) || [];
          const cur = values[f.key] || '';
          // Si el valor guardado ya no existe en la lista, se muestra igualmente
          // marcado para que el usuario sepa que falta.
          const missing = cur && !list.includes(cur);
          return (
            <label key={f.key} className="lib-default-row">
              <span className="lib-default-label">{f.label}</span>
              <select
                className="lib-select"
                value={cur}
                disabled={savingKey === f.key}
                onChange={(e) => change(f.key, e.target.value)}
              >
                {f.optional && <option value="">— Ninguna —</option>}
                {missing && <option value={cur}>{cur} (no encontrado)</option>}
                {opts
                  ? opts.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))
                  : list.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
              </select>
            </label>
          );
        })}
      </div>

      <h2 className="lib-subtitle" style={{ marginTop: 18 }}>Subtítulos</h2>
      <p className="muted small">
        Cómo aparece el subtítulo automático (en disposiciones con elemento «Subtítulo»).
        Ajuste global: afecta a todos los vídeos al renderizar.
      </p>
      <div className="lib-defaults-grid">
        <label className="lib-default-row">
          <span className="lib-default-label">Modo</span>
          <select
            className="lib-select"
            value={values.subtitulos || 'flujo'}
            disabled={savingKey === 'subtitulos'}
            onChange={(e) => change('subtitulos', e.target.value)}
          >
            <option value="flujo">En flujo (se escribe, por trozos)</option>
            <option value="entero">Entero (todo el texto, fijo)</option>
          </select>
        </label>
      </div>
    </section>
  );
}

const BLANK_TEMPLATE = {
  name: 'Nueva plantilla',
  format: 'instagram',
  elements: [
    { role: 'fondo', x: 0, y: 0, w: 1080, h: 1920 },
    { role: 'avatar', x: 240, y: 1140, w: 600, h: 600, bounce: true },
  ],
};

// Plantillas de disposición: lista + creador visual (drag & drop).
function LayoutTemplates({ templates, assets, reloadLayouts }) {
  const { confirm, alert } = useDialog();
  const [editing, setEditing] = useState(null); // { id?, name, format, elements } | null

  // Duplicar quita id/builtin -> se guarda como plantilla custom nueva.
  const duplicate = (t) => ({
    name: `${t.name} (copia)`,
    format: t.format,
    elements: (t.elements || []).map((e) => ({ ...e })),
  });

  // Restaurar una built-in editada: borra el override -> vuelve a la de fábrica.
  async function restore(t) {
    const ok = await confirm({
      title: 'Restaurar plantilla',
      message: `¿Devolver «${t.name}» a sus valores de fábrica?`,
      confirmText: 'Restaurar',
    });
    if (!ok) return;
    try {
      await api.deleteLayout(t.id);
      reloadLayouts();
    } catch (e) {
      alert({ title: 'No se pudo restaurar', message: e.message, tone: 'danger' });
    }
  }

  return (
    <section className="lib-defaults">
      <h2 className="lib-subtitle">Plantillas de disposición</h2>
      <p className="muted small">
        Diseña dónde va el vídeo, el avatar y las imágenes flotantes sobre el lienzo de Instagram
        (9:16). Cada plano puede usar una plantilla distinta.
      </p>

      <div className="lt-grid">
        {(templates || []).map((t) => (
          <div key={t.id} className="lt-card">
            <div className="lt-thumb">
              {(t.elements || []).map((el, i) => (
                <span
                  key={i}
                  className={`lt-el lt-el-${el.role}`}
                  style={{
                    left: `${(el.x / 1080) * 100}%`,
                    top: `${(el.y / 1920) * 100}%`,
                    width: `${(el.w / 1080) * 100}%`,
                    height: `${(el.h / 1920) * 100}%`,
                  }}
                />
              ))}
            </div>
            <div className="lt-info">
              <span className="lt-name" title={t.name}>
                {t.name}
              </span>
              <span className="muted small">
                {t.builtin ? 'Integrada' : 'Personalizada'} · {(t.elements || []).length} elem.
              </span>
            </div>
            <div className="lt-actions">
              <button className="btn-icon" title="Editar" onClick={() => setEditing(t)}>
                <Pencil size={15} />
              </button>
              <button className="btn-icon" title="Duplicar" onClick={() => setEditing(duplicate(t))}>
                <Copy size={15} />
              </button>
              {t.builtin && t.overridden && (
                <button className="btn-icon" title="Restaurar de fábrica" onClick={() => restore(t)}>
                  <RotateCcw size={15} />
                </button>
              )}
            </div>
          </div>
        ))}

        <button className="lt-new" onClick={() => setEditing({ ...BLANK_TEMPLATE, elements: BLANK_TEMPLATE.elements.map((e) => ({ ...e })) })}>
          <LayoutTemplate size={20} />
          <span>Nueva plantilla</span>
        </button>
      </div>

      {editing && (
        <LayoutBuilder
          initial={editing}
          assets={assets}
          onClose={() => setEditing(null)}
          onSaved={reloadLayouts}
        />
      )}
    </section>
  );
}

// Nº de elementos de una pestaña (assets de su carpeta, o nº de disposiciones).
const tabCount = (t, assets, layouts) =>
  t.special === 'layouts' ? (layouts || []).length : (t.from(assets) || []).length;

export default function Library({ assets, reloadAssets, layouts, reloadLayouts }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const paramTab = searchParams.get('tab');
  const tab = TABS.find((t) => t.key === paramTab) || TABS[0];
  const setTab = (key) => setSearchParams({ tab: key });
  const items = tab.special ? [] : tab.from(assets) || [];

  return (
    <div className="editor library">
      <header className="editor-head">
        <h1 className="lib-title">Biblioteca de recursos</h1>
      </header>
      <p className="muted small file-row" style={{ border: 'none' }}>
        Sube avatares, imágenes, vídeos, fondos y música, ponles nombre y reúsalos en cualquier guion.
      </p>

      <Defaults assets={assets} layouts={layouts} />

      <div className="lib-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`lib-tab ${t.key === tab.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label} <span className="lib-count">{tabCount(t, assets, layouts)}</span>
          </button>
        ))}
      </div>

      {tab.special === 'layouts' ? (
        <LayoutTemplates templates={layouts} assets={assets} reloadLayouts={reloadLayouts} />
      ) : (
        <>
          <Uploader tab={tab} onUploaded={reloadAssets} />
          {items.length === 0 ? (
            <div className="muted pad">
              No hay {tab.label.toLowerCase()} todavía. Añade el primero <ArrowUp size={14} />
            </div>
          ) : (
            <div className="lib-grid">
              {items.map((name) => (
                <AssetCard
                  key={name}
                  kind={tab.kind}
                  thumb={tab.thumb}
                  name={name}
                  onChanged={reloadAssets}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
