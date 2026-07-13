import { useState } from 'react';
import { Link, useNavigate, useMatch } from 'react-router-dom';
import { Plus, SlidersHorizontal, TriangleAlert, Play, Trash2, Inbox, Settings, Download } from 'lucide-react';
import { api } from '../api';
import { useDialog } from './Dialog.jsx';

export default function Sidebar({ scripts, reloadScripts, onRender }) {
  const nav = useNavigate();
  const { confirm, alert } = useDialog();
  const match = useMatch('/g/:file');
  const libMatch = useMatch('/biblioteca');
  const mailMatch = useMatch('/correo');
  const dlMatch = useMatch('/descargas');
  const cfgMatch = useMatch('/configuracion');
  const currentFile = match?.params?.file ? decodeURIComponent(match.params.file) : null;
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? scripts.filter(
        (s) =>
          (s.titulo || '').toLowerCase().includes(needle) ||
          s.file.toLowerCase().includes(needle)
      )
    : scripts;

  async function create() {
    setBusy(true);
    try {
      const res = await api.createScript({ titulo: 'Nuevo guion' });
      await reloadScripts();
      nav(`/g/${encodeURIComponent(res.file)}`);
    } catch (e) {
      alert({ title: 'No se pudo crear', message: e.message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(file, e) {
    e.preventDefault();
    e.stopPropagation();
    const ok = await confirm({
      title: 'Eliminar guion',
      message: `¿Eliminar "${file}"? No se puede deshacer.`,
      confirmText: 'Eliminar',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.deleteScript(file);
      await reloadScripts();
      if (currentFile === file) nav('/');
    } catch (err) {
      alert({ title: 'No se pudo eliminar', message: err.message, tone: 'danger' });
    }
  }

  function render(s, e) {
    e.preventDefault();
    e.stopPropagation();
    onRender(s.file, s.titulo);
  }

  return (
    <aside className="sidebar">
      <Link to="/" className="brand">
        <span className="dot" />
        <span>Content Creator</span>
      </Link>

      <button className="btn-new" onClick={create} disabled={busy}>
        <Plus size={16} /> Nuevo guion
      </button>

      <Link to="/biblioteca" className={`nav-link ${libMatch ? 'active' : ''}`}>
        <SlidersHorizontal size={16} /> Biblioteca de recursos
      </Link>

      <Link to="/correo" className={`nav-link ${mailMatch ? 'active' : ''}`}>
        <Inbox size={16} /> Correo entrante
      </Link>

      <Link to="/descargas" className={`nav-link ${dlMatch ? 'active' : ''}`}>
        <Download size={16} /> Descargas pendientes
      </Link>

      <Link to="/configuracion" className={`nav-link ${cfgMatch ? 'active' : ''}`}>
        <Settings size={16} /> Configuración
      </Link>

      <input
        className="search"
        placeholder="Buscar…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <nav className="script-list">
        {filtered.length === 0 ? (
          <div className="muted small pad">
            {scripts.length === 0 ? 'No hay guiones todavía.' : 'Sin coincidencias.'}
          </div>
        ) : (
          filtered.map((s) => (
            <Link
              key={s.file}
              to={`/g/${encodeURIComponent(s.file)}`}
              className={`script-item ${currentFile === s.file ? 'active' : ''}`}
            >
              <div className="si-main">
                <div className="si-title">{s.titulo || s.file}</div>
                <div className="si-meta muted small">
                  {s.error ? (
                    <><TriangleAlert size={12} /> error</>
                  ) : (
                    `${s.segmentos ?? 0} plano${s.segmentos === 1 ? '' : 's'}`
                  )}
                </div>
              </div>
              <div className="si-actions">
                <button title="Generar vídeo" className="btn-icon" onClick={(e) => render(s, e)}>
                  <Play size={16} />
                </button>
                <button title="Eliminar" className="btn-icon" onClick={(e) => remove(s.file, e)}>
                  <Trash2 size={16} />
                </button>
              </div>
            </Link>
          ))
        )}
      </nav>
    </aside>
  );
}
