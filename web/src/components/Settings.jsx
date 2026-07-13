import { useEffect, useState } from 'react';
import { Mail, Plug, Save, CheckCircle2, CloudUpload, RefreshCw, AlertCircle } from 'lucide-react';
import { api } from '../api';
import { useDialog } from './Dialog.jsx';

// Sección de Google Drive: estado del remote (rclone) + instrucciones de alta.
function DriveSection() {
  const [st, setSt] = useState(null);
  const load = () => api.driveEstado().then(setSt).catch(() => setSt({ configurado: false }));
  useEffect(() => { load(); }, []);
  if (!st) return null;
  const cmd = 'rclone config';
  return (
    <section className="lib-defaults" style={{ marginTop: 28 }}>
      <h2 className="lib-subtitle">
        <CloudUpload size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />
        Google Drive (subida de vídeos)
      </h2>
      <p className="muted small">
        Los vídeos finales se suben a Drive con <strong>rclone</strong>. Drive exige autorizar por
        navegador una sola vez (Google no permite usuario/contraseña en scripts). El token luego se
        refresca solo: la subida queda automática.
      </p>

      <div className="drive-status">
        {st.configurado ? (
          <span className="dl-estado dl-estado-done">
            <CheckCircle2 size={14} /> Conectado · remote «{st.remote}» → carpeta «{st.folder}»
            {st.auto ? ' · subida automática ON' : ''}
          </span>
        ) : (
          <span className="dl-estado dl-estado-stag">
            <AlertCircle size={14} /> Sin conectar (remote «{st.remote}» no configurado)
          </span>
        )}
        <button className="btn" onClick={load}>
          <RefreshCw size={14} /> Comprobar
        </button>
      </div>

      {!st.configurado && (
        <div className="settings-card" style={{ marginTop: 12 }}>
          <p className="muted small" style={{ margin: '0 0 8px' }}>
            En una terminal, ejecuta <code>{cmd}</code> y sigue: <code>n</code> (nuevo) → nombre{' '}
            <code>{st.remote}</code> → tipo <code>drive</code> → client_id/secret vacíos (Enter) →
            scope <code>1</code> → root vacío → advanced <code>n</code> → auto config <code>y</code>{' '}
            (autoriza en el navegador) → <code>y</code> → <code>q</code>. Luego pulsa «Comprobar».
          </p>
          <button className="btn" onClick={() => navigator.clipboard?.writeText(cmd).catch(() => {})}>
            Copiar «{cmd}»
          </button>
        </div>
      )}
    </section>
  );
}

// Presets de proveedores comunes. Al elegir uno se rellenan host/puerto/TLS;
// «Personalizado» deja los campos a mano.
const PRESETS = {
  gmail: { label: 'Gmail', host: 'imap.gmail.com', port: 993, secure: true },
  outlook: { label: 'Outlook / Microsoft 365', host: 'outlook.office365.com', port: 993, secure: true },
  icloud: { label: 'iCloud', host: 'imap.mail.me.com', port: 993, secure: true },
  yahoo: { label: 'Yahoo', host: 'imap.mail.yahoo.com', port: 993, secure: true },
  custom: { label: 'Personalizado', host: '', port: 993, secure: true },
};

function detectPreset(host) {
  const hit = Object.entries(PRESETS).find(([k, p]) => k !== 'custom' && p.host === host);
  return hit ? hit[0] : 'custom';
}

export default function Settings() {
  const { alert } = useDialog();
  const [cfg, setCfg] = useState(null);
  const [pwd, setPwd] = useState(''); // vacío = no cambiar la guardada
  const [preset, setPreset] = useState('custom');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api
      .getMailConfig()
      .then((c) => {
        setCfg(c);
        setPreset(detectPreset(c.host));
      })
      .catch(() => setCfg({ ...PRESETS.custom, enabled: false, user: '', mailbox: 'INBOX', hasPassword: false }));
  }, []);

  if (!cfg) return null;

  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));

  function applyPreset(key) {
    setPreset(key);
    const p = PRESETS[key];
    if (key !== 'custom') set('host', p.host);
    setCfg((c) => ({ ...c, port: p.port, secure: p.secure, ...(key !== 'custom' ? { host: p.host } : {}) }));
  }

  async function save() {
    setSaving(true);
    try {
      const body = {
        enabled: cfg.enabled,
        host: cfg.host,
        port: Number(cfg.port) || 993,
        secure: cfg.secure,
        user: cfg.user,
        mailbox: cfg.mailbox || 'INBOX',
      };
      if (pwd) body.password = pwd; // solo se envía si la reescribes
      const next = await api.saveMailConfig(body);
      setCfg(next);
      setPwd('');
      alert({ title: 'Guardado', message: 'Configuración de correo guardada.' });
    } catch (e) {
      alert({ title: 'No se pudo guardar', message: e.message, tone: 'danger' });
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      // Guarda primero para probar con lo que hay en pantalla.
      await save();
      const r = await api.testMail();
      alert({
        title: 'Conexión correcta',
        message: `Buzón «${r.mailbox}» accesible. ${r.total} mensaje(s).`,
      });
    } catch (e) {
      alert({ title: 'Fallo de conexión', message: e.message, tone: 'danger' });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="editor library">
      <header className="editor-head">
        <h1 className="lib-title">Configuración</h1>
      </header>

      <section className="lib-defaults">
        <h2 className="lib-subtitle">
          <Mail size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          Correo entrante (newsletters)
        </h2>
        <p className="muted small">
          Conecta un buzón por IMAP <strong>solo para leer</strong> newsletters y tener material de
          actualidad. No se envía ningún correo. Para Gmail/Outlook usa una{' '}
          <strong>contraseña de aplicación</strong>, no la principal. Las credenciales se guardan en
          local (mail.config.json, fuera de git).
        </p>

        <div className="lib-defaults-grid" style={{ maxWidth: 560 }}>
          <label className="lib-default-row">
            <span className="lib-default-label">Activado</span>
            <input
              type="checkbox"
              checked={!!cfg.enabled}
              onChange={(e) => set('enabled', e.target.checked)}
            />
          </label>

          <label className="lib-default-row">
            <span className="lib-default-label">Proveedor</span>
            <select className="lib-select" value={preset} onChange={(e) => applyPreset(e.target.value)}>
              {Object.entries(PRESETS).map(([k, p]) => (
                <option key={k} value={k}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label className="lib-default-row">
            <span className="lib-default-label">Servidor IMAP</span>
            <input
              className="lib-select"
              placeholder="imap.ejemplo.com"
              value={cfg.host || ''}
              onChange={(e) => {
                set('host', e.target.value);
                setPreset(detectPreset(e.target.value));
              }}
            />
          </label>

          <label className="lib-default-row">
            <span className="lib-default-label">Puerto</span>
            <input
              className="lib-select"
              type="number"
              value={cfg.port || 993}
              onChange={(e) => set('port', e.target.value)}
            />
          </label>

          <label className="lib-default-row">
            <span className="lib-default-label">TLS (seguro)</span>
            <input type="checkbox" checked={!!cfg.secure} onChange={(e) => set('secure', e.target.checked)} />
          </label>

          <label className="lib-default-row">
            <span className="lib-default-label">Usuario / email</span>
            <input
              className="lib-select"
              placeholder="tu@correo.com"
              autoComplete="username"
              value={cfg.user || ''}
              onChange={(e) => set('user', e.target.value)}
            />
          </label>

          <label className="lib-default-row">
            <span className="lib-default-label">Contraseña</span>
            <input
              className="lib-select"
              type="password"
              autoComplete="new-password"
              placeholder={cfg.hasPassword ? '•••••••• (guardada)' : 'contraseña de aplicación'}
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
            />
          </label>

          <label className="lib-default-row">
            <span className="lib-default-label">Buzón</span>
            <input
              className="lib-select"
              placeholder="INBOX"
              value={cfg.mailbox || 'INBOX'}
              onChange={(e) => set('mailbox', e.target.value)}
            />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="btn btn-primary" disabled={saving} onClick={save}>
            <Save size={16} /> {saving ? 'Guardando…' : 'Guardar'}
          </button>
          <button className="btn" disabled={testing} onClick={test}>
            <Plug size={16} /> {testing ? 'Probando…' : 'Probar conexión'}
          </button>
        </div>

        {cfg.enabled && cfg.host && (
          <p className="muted small" style={{ marginTop: 12 }}>
            <CheckCircle2 size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            Mira los correos en la sección «Correo entrante» de la barra lateral.
          </p>
        )}
      </section>

      <DriveSection />
      <PublishSection />
    </div>
  );
}

// Sección de publicación en redes (APIs nativas gratis): tokens IG + TikTok.
function PublishSection() {
  const { alert } = useDialog();
  const [cfg, setCfg] = useState(null);
  const [igToken, setIgToken] = useState('');   // vacío = no cambiar
  const [ttToken, setTtToken] = useState('');   // vacío = no cambiar
  const [saving, setSaving] = useState(false);

  const load = () => api.getSocialConfig().then(setCfg).catch(() => setCfg({ ig: {}, tiktok: {} }));
  useEffect(() => { load(); }, []);
  if (!cfg) return null;

  async function save() {
    setSaving(true);
    try {
      const body = { ig: { userId: cfg.ig.userId || '' }, tiktok: {} };
      if (igToken) body.ig.token = igToken;
      if (ttToken) body.tiktok.token = ttToken;
      const next = await api.saveSocialConfig(body);
      setCfg(next);
      setIgToken('');
      setTtToken('');
      alert({ title: 'Guardado', message: 'Credenciales de redes guardadas.' });
    } catch (e) {
      alert({ title: 'No se pudo guardar', message: e.message, tone: 'danger' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="lib-defaults" style={{ marginTop: 28 }}>
      <h2 className="lib-subtitle">
        <Send size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />
        Publicar en Instagram + TikTok (gratis)
      </h2>
      <p className="muted small">
        Publicación con las APIs nativas, gratis. <strong>Instagram Reels</strong> se publica solo
        (Graph API; el vídeo se expone por un túnel temporal). <strong>TikTok</strong> se sube a tu
        bandeja y lo publicas con un toque en la app. Pega abajo los tokens (se guardan en local,
        fuera de git). El botón «Publicar» sale en la consola de render.
      </p>

      <div className="lib-defaults-grid" style={{ maxWidth: 620 }}>
        <label className="lib-default-row">
          <span className="lib-default-label">
            Instagram {cfg.ig.configurado ? <CheckCircle2 size={13} style={{ verticalAlign: '-2px' }} /> : ''}
          </span>
          <span />
        </label>
        <label className="lib-default-row">
          <span className="lib-default-label">IG user id</span>
          <input className="lib-select" placeholder="17841400000000000"
            value={cfg.ig.userId || ''}
            onChange={(e) => setCfg((c) => ({ ...c, ig: { ...c.ig, userId: e.target.value } }))} />
        </label>
        <label className="lib-default-row">
          <span className="lib-default-label">IG access token</span>
          <input className="lib-select" type="password" autoComplete="new-password"
            placeholder={cfg.ig.hasToken ? '•••••••• (guardado)' : 'token de larga duración'}
            value={igToken} onChange={(e) => setIgToken(e.target.value)} />
        </label>
        <label className="lib-default-row">
          <span className="lib-default-label">
            TikTok {cfg.tiktok.configurado ? <CheckCircle2 size={13} style={{ verticalAlign: '-2px' }} /> : ''}
          </span>
          <span />
        </label>
        <label className="lib-default-row">
          <span className="lib-default-label">TikTok access token</span>
          <input className="lib-select" type="password" autoComplete="new-password"
            placeholder={cfg.tiktok.hasToken ? '•••••••• (guardado)' : 'token con scope video.upload'}
            value={ttToken} onChange={(e) => setTtToken(e.target.value)} />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary" disabled={saving} onClick={save}>
          <Save size={16} /> {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>

      <p className="muted small" style={{ marginTop: 12 }}>
        {cfg.ig.configurado || cfg.tiktok.configurado
          ? <><CheckCircle2 size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              Conectado: {[cfg.ig.configurado && 'Instagram', cfg.tiktok.configurado && 'TikTok'].filter(Boolean).join(' + ')}</>
          : <><AlertCircle size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              Sin conectar. Necesitas crear una app de Meta (IG) y otra de TikTok para obtener los tokens.</>}
      </p>
    </section>
  );
}
