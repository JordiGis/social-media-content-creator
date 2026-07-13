import { useEffect, useRef, useState } from 'react';
import { X, CircleX, Check, Clapperboard, Mic, Download, Clock, CloudUpload, Send } from 'lucide-react';
import { api } from '../api';

// Segundos -> "45s" | "1m 23s".
const fmtSecs = (s) => {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`;
};

const STAGE_LABEL = {
  start: 'Iniciando…',
  parse: 'Analizando guion…',
  tts: 'Generando voz…',
  duration: 'Midiendo duración…',
  ffmpeg: 'Componiendo planos…',
  concat: 'Uniendo planos…',
  music: 'Añadiendo música…',
};

export default function RenderConsole({ target, onClose, reloadScripts }) {
  const [stage, setStage] = useState('Iniciando…');
  const [percent, setPercent] = useState(0);
  const [segs, setSegs] = useState({}); // index -> { nombre, stage }
  const [total, setTotal] = useState(0);
  const [log, setLog] = useState('');
  const [showLog, setShowLog] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [elapsed, setElapsed] = useState(0); // segundos transcurridos (cronómetro)
  const [driveOk, setDriveOk] = useState(false); // remote de Drive configurado
  const [drive, setDrive] = useState({ state: 'idle', msg: '' }); // idle|subiendo|ok|error
  const [pubOk, setPubOk] = useState(false); // Ayrshare configurado
  const [plats, setPlats] = useState({ instagram: true, tiktok: true }); // redes marcadas
  const [caption, setCaption] = useState('');
  const [pub, setPub] = useState({ state: 'idle', msg: '' }); // idle|publicando|ok|error
  const logRef = useRef(null);
  const startRef = useRef(0);
  const timerRef = useRef(null);

  // ¿Está Drive configurado? (decide si mostrar el botón de subir).
  useEffect(() => {
    api.driveEstado().then((r) => setDriveOk(!!r.configurado)).catch(() => setDriveOk(false));
    api.publicarEstado().then((r) => {
      setPubOk(!!r.configurado);
      const def = r.porDefecto || ['instagram', 'tiktok'];
      setPlats({ instagram: def.includes('instagram'), tiktok: def.includes('tiktok') });
    }).catch(() => setPubOk(false));
  }, []);

  // Al tener resultado, precarga el caption (título + descripción del guion).
  useEffect(() => {
    if (result?.output) api.captionOutput(result.output).then(setCaption).catch(() => {});
  }, [result]);

  async function publicar() {
    if (!result?.output) return;
    const sel = Object.entries(plats).filter(([, v]) => v).map(([k]) => k);
    if (!sel.length) { setPub({ state: 'error', msg: 'Marca al menos una red' }); return; }
    setPub({ state: 'publicando', msg: '' });
    try {
      const r = await api.publicarOutput(result.output, sel, caption);
      const lines = (r.results || []).map((x) =>
        x.ok ? `✓ ${x.platform}: ${x.nota || 'ok'}` : `✗ ${x.platform}: ${x.message}`
      );
      const anyFail = (r.results || []).some((x) => !x.ok);
      setPub({ state: anyFail ? 'error' : 'ok', msg: lines.join('\n') });
    } catch (e) {
      setPub({ state: 'error', msg: e.message });
    }
  }

  async function subirDrive() {
    if (!result?.output) return;
    setDrive({ state: 'subiendo', msg: '' });
    try {
      const r = await api.subirOutputDrive(result.output);
      setDrive({ state: 'ok', msg: r.dest });
    } catch (e) {
      setDrive({ state: 'error', msg: e.message });
    }
  }

  useEffect(() => {
    if (!target?.file) return undefined;
    setStage('Iniciando…');
    setPercent(0);
    setSegs({});
    setTotal(0);
    setLog('');
    setResult(null);
    setError(null);
    setDone(false);
    setElapsed(0);

    // Cronómetro: arranca al abrir el stream, tick cada segundo. Se detiene y
    // congela el total al recibir 'done' o 'error'.
    startRef.current = Date.now();
    const stopTimer = () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
    const freeze = () => {
      stopTimer();
      setElapsed((Date.now() - startRef.current) / 1000);
    };
    timerRef.current = setInterval(
      () => setElapsed((Date.now() - startRef.current) / 1000),
      1000
    );

    const es = new EventSource(api.renderUrl(target.file));
    es.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (m.type) {
        case 'stage':
          setStage(STAGE_LABEL[m.stage] || m.message || m.stage);
          break;
        case 'segment':
          setTotal(m.total || 0);
          setSegs((s) => ({ ...s, [m.index]: { nombre: m.nombre, stage: m.stage } }));
          break;
        case 'progress':
          setPercent(m.percent);
          break;
        case 'log':
          setLog((l) => (l + m.line).slice(-20000));
          break;
        case 'done':
          freeze();
          setPercent(100);
          setDone(true);
          // Cache-buster: el archivo se sobrescribe en cada render con el mismo
          // nombre; sin esto el <video> reusa los bytes cacheados (vídeo viejo)
          // y se queda colgado donde el archivo nuevo difiere del anterior.
          setResult({ url: `${m.url}?v=${Date.now()}`, output: m.output });
          reloadScripts?.();
          break;
        case 'error':
          freeze();
          setError(m.message);
          break;
        case 'end':
          es.close();
          break;
        default:
          break;
      }
    };
    es.onerror = () => es.close();
    return () => {
      stopTimer();
      es.close();
    };
  }, [target?.file, reloadScripts]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log, showLog]);

  const segList = Object.keys(segs)
    .map(Number)
    .sort((a, b) => a - b)
    .map((i) => ({ i, ...segs[i] }));

  return (
    <div className="console">
      <div className="console-head">
        <strong title={target.titulo}>Render · {target.titulo}</strong>
        <button className="btn-icon" onClick={onClose} title="Cerrar">
          <X size={16} />
        </button>
      </div>

      <div className="console-body">
        <div className="console-stage">
          {error ? (
            <><CircleX size={16} /> Error</>
          ) : done ? (
            <><Check size={16} /> Completado</>
          ) : (
            stage
          )}
        </div>
        <div className="progress">
          <div
            className={`progress-bar ${error ? 'err' : ''}`}
            style={{ width: `${Math.round(percent)}%` }}
          />
        </div>
        <div className="progress-pct muted small">
          {Math.round(percent)}%
          <span className="render-timer" style={{ marginLeft: 8 }}>
            <Clock size={12} style={{ verticalAlign: '-2px' }} />{' '}
            {done || error ? `Total: ${fmtSecs(elapsed)}` : fmtSecs(elapsed)}
          </span>
        </div>

        {total > 0 && (
          <div className="seg-chips">
            {segList.map((s) => (
              <span key={s.i} className={`chip chip-${s.stage}`} title={s.nombre}>
                {s.i + 1}
                {s.stage === 'montaje' ? (
                  <Clapperboard size={12} />
                ) : s.stage === 'voz' ? (
                  <Mic size={12} />
                ) : null}
              </span>
            ))}
          </div>
        )}

        {error && <div className="console-error">{error}</div>}

        {result && (
          <div className="console-result">
            <video src={result.url} controls />
            <div className="console-result-actions">
              <a className="btn" href={result.url} download={result.output}>
                <Download size={16} /> Descargar {result.output}
              </a>
              {driveOk && (
                <button
                  className="btn"
                  onClick={subirDrive}
                  disabled={drive.state === 'subiendo'}
                  title="Subir este vídeo a Google Drive (reemplaza si ya existe)"
                >
                  <CloudUpload size={16} />{' '}
                  {drive.state === 'subiendo' ? 'Subiendo…'
                    : drive.state === 'ok' ? 'Subido ✓'
                    : 'Subir a Drive'}
                </button>
              )}
            </div>
            {drive.state === 'ok' && <div className="muted small">↑ {drive.msg}</div>}
            {drive.state === 'error' && <div className="console-error">Drive: {drive.msg}</div>}

            {pubOk && (
              <div className="publish-box">
                <div className="publish-plats">
                  <span className="muted small">Publicar en:</span>
                  <label className="publish-check">
                    <input type="checkbox" checked={plats.instagram}
                      onChange={(e) => setPlats((p) => ({ ...p, instagram: e.target.checked }))} />
                    Instagram
                  </label>
                  <label className="publish-check">
                    <input type="checkbox" checked={plats.tiktok}
                      onChange={(e) => setPlats((p) => ({ ...p, tiktok: e.target.checked }))} />
                    TikTok
                  </label>
                </div>
                <textarea
                  className="desc-textarea"
                  rows={4}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Texto del post (título + descripción + hashtags)…"
                />
                <button
                  className="btn btn-primary"
                  onClick={publicar}
                  disabled={pub.state === 'publicando'}
                >
                  <Send size={16} />{' '}
                  {pub.state === 'publicando' ? 'Publicando…' : pub.state === 'ok' ? 'Publicado ✓' : 'Publicar'}
                </button>
                {(pub.state === 'ok' || pub.state === 'error') && pub.msg && (
                  <div className={pub.state === 'error' ? 'console-error' : 'muted small'}
                    style={{ whiteSpace: 'pre-line' }}>
                    {pub.msg}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <button className="link-btn" onClick={() => setShowLog((v) => !v)}>
          {showLog ? 'Ocultar log' : 'Ver log técnico'}
        </button>
        {showLog && (
          <pre className="console-log" ref={logRef}>
            {log}
          </pre>
        )}
      </div>
    </div>
  );
}
