import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Download, RefreshCw, Plus, ExternalLink, Upload, CheckCircle2,
  Clock, Trash2, PackageCheck, Star,
} from 'lucide-react';
import { api, pendienteUrl } from '../api';
import { useDialog } from './Dialog.jsx';

// Carpetas destino ofrecidas al curar un enlace. `kind` = clave del backend.
const KINDS = [
  { kind: 'top', label: 'Vídeo', accept: 'video/*' },
  { kind: 'musica', label: 'Música', accept: 'audio/*' },
  { kind: 'imagenes', label: 'Imagen', accept: 'image/*' },
  { kind: 'fondos', label: 'Fondo', accept: 'video/*' },
  { kind: 'avatares', label: 'Avatar', accept: 'image/*' },
];
const kindOf = (k) => KINDS.find((x) => x.kind === k) || KINDS[0];

const ESTADO = {
  pendiente: { label: 'Por descargar', icon: Clock, cls: 'pend' },
  subido: { label: 'Elige candidatos', icon: Upload, cls: 'stag' },
  registrado: { label: 'Registrado', icon: CheckCircle2, cls: 'done' },
};

const mb = (n) => (n ? `${(n / 1e6).toFixed(1)} MB` : '');

// Vista previa de un candidato en staging según el tipo destino.
function CandPreview({ kind, url, titulo }) {
  if (kind === 'musica') return <audio className="dl-media" controls preload="none" src={url} />;
  if (kind === 'imagenes' || kind === 'avatares')
    return <img className="dl-media" src={url} alt={titulo} loading="lazy" />;
  return <video className="dl-media" src={`${url}#t=0.1`} muted playsInline preload="metadata" controls />;
}

// Un candidato: preview + marcar válido / registrar / descartar.
function CandidatoTile({ card, cand, busy, run }) {
  const registrado = cand.estado === 'registrado';
  return (
    <div className={`dl-cand ${cand.valido ? 'valido' : ''} ${registrado ? 'done' : ''}`}>
      {registrado ? (
        <Link className="dl-cand-done" to={`/biblioteca?tab=${card.kind === 'musica' ? 'musica' : card.kind}`}>
          <CheckCircle2 size={22} />
          <span title={cand.assetName}>{cand.assetName}</span>
        </Link>
      ) : (
        <CandPreview kind={card.kind} url={pendienteUrl(cand.archivo)} titulo={card.titulo} />
      )}

      <div className="dl-cand-foot">
        {!registrado && (
          <button
            className={`btn-icon ${cand.valido ? 'valido-on' : ''}`}
            title={cand.valido ? 'Quitar de válidos' : 'Marcar válido'}
            disabled={busy}
            onClick={() => run(() => api.marcarCandidato(card.id, cand.cid, !cand.valido))}
          >
            <Star size={15} fill={cand.valido ? 'currentColor' : 'none'} />
          </button>
        )}
        <span className="muted small">{registrado ? 'registrado' : mb(cand.size)}</span>
        <span style={{ flex: 1 }} />
        {!registrado && (
          <button
            className="btn-icon"
            title="Registrar este"
            disabled={busy}
            onClick={() => run(() => api.registrarCandidato(card.id, cand.cid, card.titulo))}
          >
            <PackageCheck size={15} />
          </button>
        )}
        <button
          className="btn-icon danger"
          title={registrado ? 'Borrar (también el asset)' : 'Descartar'}
          disabled={busy}
          onClick={() => run(() => api.borrarCandidato(card.id, cand.cid))}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function DescargaCard({ item, reload }) {
  const { confirm, alert } = useDialog();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const est = ESTADO[item.estado] || ESTADO.pendiente;
  const EstIcon = est.icon;
  const k = kindOf(item.kind);
  const cands = item.candidatos || [];
  const validosPend = cands.filter((c) => c.valido && c.estado === 'subido').length;

  // Envuelve una acción de API: bloquea, ejecuta, recarga, y avisa si falla.
  const run = useCallback(async (fn, okMsg) => {
    setBusy(true);
    try {
      const r = await fn();
      reload();
      if (okMsg) alert({ title: 'Hecho', message: typeof okMsg === 'function' ? okMsg(r) : okMsg });
    } catch (err) {
      alert({ title: 'Error', message: err.message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }, [reload, alert]);

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (f) run(() => api.subirDescarga(item.id, f));
  }

  async function delCard() {
    const ok = await confirm({
      title: 'Quitar card',
      message: `¿Quitar «${item.titulo || item.url}» y todos sus candidatos?`,
      confirmText: 'Quitar',
      tone: 'danger',
    });
    if (ok) run(() => api.deleteDescarga(item.id));
  }

  return (
    <div className={`dl-card ${busy ? 'busy' : ''}`}>
      <div className="dl-card-head">
        <span className={`dl-badge dl-badge-${item.kind}`}>{k.label}</span>
        <span className="dl-title" title={item.titulo}>{item.titulo || '(sin título)'}</span>
        <span className={`dl-estado dl-estado-${est.cls}`}>
          <EstIcon size={13} /> {est.label}{cands.length ? ` · ${cands.length}` : ''}
        </span>
        <button className="btn-icon danger" title="Quitar card" onClick={delCard} disabled={busy}>
          <Trash2 size={15} />
        </button>
      </div>

      {item.nota && <p className="muted small dl-nota">{item.nota}</p>}

      {cands.length > 0 ? (
        <div className="dl-cand-grid">
          {cands.map((c) => (
            <CandidatoTile key={c.cid} card={item} cand={c} busy={busy} run={run} />
          ))}
        </div>
      ) : (
        <p className="muted small dl-nota">
          Sin candidatos. Ejecuta <code>pnpm descargar</code> o sube uno a mano.
        </p>
      )}

      <div className="dl-card-actions">
        <a className="btn" href={item.url} target="_blank" rel="noreferrer">
          <ExternalLink size={14} /> Abrir enlace{item.fuente ? ` · ${item.fuente}` : ''}
        </a>

        <input ref={fileRef} type="file" accept={k.accept} hidden onChange={onFile} />
        <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> Subir candidato
        </button>

        {validosPend > 0 && (
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => run(
              () => api.registrarValidos(item.id, item.titulo),
              (r) => `Registrados ${r.assetNames.length} en ${k.label}: ${r.assetNames.join(', ')}`
            )}
          >
            <PackageCheck size={14} /> Registrar válidos ({validosPend})
          </button>
        )}
      </div>
    </div>
  );
}

// Formulario para añadir un enlace nuevo a la lista (yo o el usuario).
function AddForm({ onAdded }) {
  const { alert } = useDialog();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ url: '', titulo: '', kind: 'top', nota: '' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function add() {
    if (!form.url.trim() || busy) return;
    setBusy(true);
    try {
      await api.addDescarga(form);
      setForm({ url: '', titulo: '', kind: 'top', nota: '' });
      setOpen(false);
      onAdded();
    } catch (e) {
      alert({ title: 'No se pudo añadir', message: e.message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        <Plus size={16} /> Añadir enlace
      </button>
    );
  }
  return (
    <div className="dl-addform">
      <input className="dl-input" placeholder="URL del recurso" value={form.url}
        onChange={(e) => set('url', e.target.value)} autoFocus />
      <input className="dl-input" placeholder="Título" value={form.titulo}
        onChange={(e) => set('titulo', e.target.value)} />
      <select className="lib-select" value={form.kind} onChange={(e) => set('kind', e.target.value)}>
        {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
      </select>
      <input className="dl-input" placeholder="Nota (opcional)" value={form.nota}
        onChange={(e) => set('nota', e.target.value)} />
      <button className="btn btn-primary" disabled={busy} onClick={add}>Añadir</button>
      <button className="btn" disabled={busy} onClick={() => setOpen(false)}>Cancelar</button>
    </div>
  );
}

export default function Descargas() {
  const [state, setState] = useState({ loading: true, error: null, items: [] });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      setState({ loading: false, error: null, items: await api.listDescargas() });
    } catch (e) {
      setState({ loading: false, error: e.message, items: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const { items } = state;
  const pendientes = items.filter((i) => i.estado !== 'registrado');
  const registrados = items.filter((i) => i.estado === 'registrado');

  return (
    <div className="editor">
      <header className="editor-head">
        <h1 className="lib-title">
          <Download size={18} style={{ verticalAlign: '-3px', marginRight: 8 }} />
          Descargas pendientes
        </h1>
        <button className="btn" onClick={load} disabled={state.loading} style={{ marginLeft: 'auto' }}>
          <RefreshCw size={15} /> {state.loading ? 'Cargando…' : 'Actualizar'}
        </button>
      </header>

      <p className="muted small file-row" style={{ border: 'none' }}>
        Cada card es un enlace curado. <code>pnpm descargar</code> baja varios candidatos por card;
        marca con <Star size={12} style={{ verticalAlign: '-1px' }} /> los que te gusten, registra los
        válidos y descarta el resto (la card se queda para volver a buscar).
      </p>

      <div className="dl-toolbar">
        <AddForm onAdded={load} />
      </div>

      {state.error ? (
        <div className="muted pad">No se pudo cargar la lista: {state.error}</div>
      ) : items.length === 0 && !state.loading ? (
        <div className="muted pad">La lista está vacía. Añade un enlace <Plus size={14} /></div>
      ) : (
        <>
          {pendientes.length > 0 && (
            <div className="dl-list">
              {pendientes.map((it) => <DescargaCard key={it.id} item={it} reload={load} />)}
            </div>
          )}
          {registrados.length > 0 && (
            <>
              <h2 className="lib-subtitle" style={{ marginTop: 18 }}>Ya registrados</h2>
              <div className="dl-list">
                {registrados.map((it) => <DescargaCard key={it.id} item={it} reload={load} />)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
