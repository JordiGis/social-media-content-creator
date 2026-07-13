import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Mail, MailOpen, Inbox as InboxIcon, Settings as SettingsIcon } from 'lucide-react';
import { api } from '../api';

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-ES', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function Inbox() {
  const [state, setState] = useState({ loading: true, error: null, messages: [], total: 0 });
  const [selected, setSelected] = useState(null); // { loading, error, msg }

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await api.listMail(30);
      setState({ loading: false, error: null, messages: r.messages || [], total: r.total || 0 });
    } catch (e) {
      setState({ loading: false, error: e.message, messages: [], total: 0 });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function open(uid) {
    setSelected({ loading: true, error: null, msg: null, uid });
    try {
      const msg = await api.getMail(uid);
      setSelected({ loading: false, error: null, msg, uid });
    } catch (e) {
      setSelected({ loading: false, error: e.message, msg: null, uid });
    }
  }

  return (
    <div className="editor">
      <header className="editor-head">
        <h1 className="lib-title">
          <InboxIcon size={18} style={{ verticalAlign: '-3px', marginRight: 8 }} />
          Correo entrante
        </h1>
        <button className="btn" onClick={load} disabled={state.loading} style={{ marginLeft: 'auto' }}>
          <RefreshCw size={15} /> {state.loading ? 'Cargando…' : 'Actualizar'}
        </button>
      </header>

      {state.error ? (
        <div className="muted pad">
          <p>No se pudo cargar el correo: {state.error}</p>
          <Link to="/configuracion" className="nav-link" style={{ display: 'inline-flex', marginTop: 8 }}>
            <SettingsIcon size={15} /> Ir a Configuración
          </Link>
        </div>
      ) : (
        <div className="inbox">
          <ul className="inbox-list">
            {state.messages.length === 0 && !state.loading && (
              <li className="muted pad">Buzón vacío o sin mensajes recientes.</li>
            )}
            {state.messages.map((m) => (
              <li
                key={m.uid}
                className={`inbox-item ${selected?.uid === m.uid ? 'active' : ''}`}
                onClick={() => open(m.uid)}
              >
                <span className="inbox-icon">{m.seen ? <MailOpen size={16} /> : <Mail size={16} />}</span>
                <div className="inbox-item-main">
                  <div className="inbox-from" title={m.fromAddress}>
                    {m.fromName}
                  </div>
                  <div className="inbox-subject">{m.subject}</div>
                </div>
                <span className="inbox-date muted small">{fmtDate(m.date)}</span>
              </li>
            ))}
          </ul>

          <div className="inbox-reader">
            {!selected ? (
              <div className="muted pad">Elige un correo para leerlo.</div>
            ) : selected.loading ? (
              <div className="muted pad">Cargando mensaje…</div>
            ) : selected.error ? (
              <div className="muted pad">Error: {selected.error}</div>
            ) : (
              <article className="inbox-msg">
                <h2 className="inbox-msg-subject">{selected.msg.subject}</h2>
                <div className="muted small inbox-msg-meta">
                  {selected.msg.fromName} &lt;{selected.msg.fromAddress}&gt; · {fmtDate(selected.msg.date)}
                </div>
                {selected.msg.html ? (
                  // iframe en sandbox: aísla el HTML del correo (sin scripts, sin
                  // acceso al DOM de la app) pero respeta su maquetación.
                  <iframe
                    className="inbox-msg-html"
                    title="Contenido del correo"
                    sandbox=""
                    srcDoc={selected.msg.html}
                  />
                ) : (
                  <pre className="inbox-msg-text">{selected.msg.text || '(sin contenido)'}</pre>
                )}
              </article>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
