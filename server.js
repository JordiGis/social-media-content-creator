import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './src/config.js';
import { PUBLIC_DIR, OUTPUTS_DIR, ASSETS_DIR, ensureDirs } from './src/paths.js';
import {
  listScripts,
  readScript,
  writeScript,
  createScript,
  deleteScript,
  safeScriptName,
} from './src/scripts.js';
import { listAssets, uploadAsset, renameAsset, deleteAsset } from './src/assets.js';
import { readDefaults, writeDefaults } from './src/defaults.js';
import { readLayouts, upsertTemplate, deleteTemplate } from './src/layouts.js';
import { readMailConfig, writeMailConfig, testConnection, listMessages, getMessage } from './src/mail.js';
import {
  listDescargas,
  addDescarga,
  updateDescarga,
  deleteDescarga,
  addCandidato,
  marcarCandidato,
  deleteCandidato,
  registrarCandidato,
  registrarValidos,
} from './src/descargas.js';
import { runRender, isRendering } from './src/render.js';
import { uploadToDrive, driveConfigured } from './src/drive.js';
import { writeVideoMeta } from './src/videometa.js';
import { publishVideo, publishConfigured, captionForOutput } from './src/publish.js';
import { readSocialSafe, writeSocial } from './src/socialconfig.js';

ensureDirs();

const app = express();
app.use(express.json({ limit: '4mb' }));

// Estáticos
app.use(express.static(PUBLIC_DIR));
// no-store: los vídeos se regeneran con el mismo nombre; evita servir una
// versión cacheada obsoleta (el reproductor se colgaba a mitad del vídeo).
app.use('/outputs', express.static(OUTPUTS_DIR, {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));
app.use('/assets', express.static(ASSETS_DIR));

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// --- Salud / assets ---
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/assets', asyncHandler(async (req, res) => res.json(await listAssets())));

// Predeterminados globales para nuevos guiones (editables desde la Biblioteca).
app.get('/api/defaults', asyncHandler(async (req, res) => res.json(await readDefaults())));
app.put('/api/defaults', asyncHandler(async (req, res) =>
  res.json({ ok: true, defaults: await writeDefaults(req.body || {}) })
));

// Plantillas de disposición (layouts) editables desde la Biblioteca.
app.get('/api/layouts', asyncHandler(async (req, res) => res.json({ templates: await readLayouts() })));
app.put('/api/layouts/:id', asyncHandler(async (req, res) =>
  res.json({ ok: true, template: await upsertTemplate(req.params.id, req.body || {}) })
));
app.delete('/api/layouts/:id', asyncHandler(async (req, res) =>
  res.json({ ok: true, ...(await deleteTemplate(req.params.id)) })
));

// Subida de un asset (cuerpo = bytes crudos). Nombre y archivo via query.
// type:()=>true -> trata CUALQUIER content-type como binario (vídeo/imagen/audio).
const rawUpload = express.raw({ type: () => true, limit: '500mb' });
app.post('/api/assets/:kind', rawUpload, asyncHandler(async (req, res) => {
  const out = await uploadAsset(req.params.kind, req.query.filename, req.query.name, req.body);
  res.status(201).json({ ok: true, ...out });
}));

app.patch('/api/assets/:kind/:name', asyncHandler(async (req, res) => {
  const out = await renameAsset(req.params.kind, req.params.name, (req.body || {}).name);
  res.json({ ok: true, ...out });
}));

app.delete('/api/assets/:kind/:name', asyncHandler(async (req, res) => {
  const out = await deleteAsset(req.params.kind, req.params.name);
  res.json({ ok: true, ...out });
}));

// --- Correo entrante (IMAP, solo lectura) para nutrir guiones de actualidad ---
app.get('/api/mail/config', asyncHandler(async (req, res) => res.json(await readMailConfig())));
app.put('/api/mail/config', asyncHandler(async (req, res) =>
  res.json({ ok: true, config: await writeMailConfig(req.body || {}) })
));
app.post('/api/mail/test', asyncHandler(async (req, res) => res.json(await testConnection())));
app.get('/api/mail/messages', asyncHandler(async (req, res) =>
  res.json(await listMessages({ limit: Number(req.query.limit) || 30 }))
));
app.get('/api/mail/messages/:uid', asyncHandler(async (req, res) =>
  res.json(await getMessage(req.params.uid))
));

// --- Descargas pendientes (carrito de recursos: enlaces -> staging -> assets) ---
app.get('/api/descargas', asyncHandler(async (req, res) => res.json(await listDescargas())));
app.post('/api/descargas', asyncHandler(async (req, res) =>
  res.status(201).json({ ok: true, item: await addDescarga(req.body || {}) })
));
app.patch('/api/descargas/:id', asyncHandler(async (req, res) =>
  res.json({ ok: true, item: await updateDescarga(req.params.id, req.body || {}) })
));
app.delete('/api/descargas/:id', asyncHandler(async (req, res) =>
  res.json({ ok: true, ...(await deleteDescarga(req.params.id)) })
));
// Añadir un candidato subiendo un archivo descargado a mano (bytes crudos).
app.post('/api/descargas/:id/subir', rawUpload, asyncHandler(async (req, res) =>
  res.status(201).json({ ok: true, item: await addCandidato(req.params.id, req.query.filename, req.body) })
));
// Marcar/desmarcar un candidato como válido (la elección del usuario).
app.post('/api/descargas/:id/candidatos/:cid/marcar', asyncHandler(async (req, res) =>
  res.json({ ok: true, item: await marcarCandidato(req.params.id, req.params.cid, (req.body || {}).valido) })
));
// Borrar UN candidato (no la card): descarta el que no gusta, deja la card.
app.delete('/api/descargas/:id/candidatos/:cid', asyncHandler(async (req, res) =>
  res.json({ ok: true, item: await deleteCandidato(req.params.id, req.params.cid) })
));
// Registrar un candidato concreto -> asset con nombre limpio.
app.post('/api/descargas/:id/candidatos/:cid/registrar', asyncHandler(async (req, res) =>
  res.json({ ok: true, item: await registrarCandidato(req.params.id, req.params.cid, (req.body || {}).name) })
));
// Registrar de golpe todos los candidatos marcados como válidos.
app.post('/api/descargas/:id/registrar-validos', asyncHandler(async (req, res) =>
  res.json({ ok: true, ...(await registrarValidos(req.params.id, (req.body || {}).name)) })
));

// --- Subida de un vídeo final a Google Drive (rclone) ---
// Estado de Drive: si el remote está configurado + remote/carpeta destino.
app.get('/api/drive/estado', asyncHandler(async (req, res) =>
  res.json({
    configurado: await driveConfigured(),
    remote: config.drive.remote,
    folder: config.drive.folder,
    auto: config.drive.auto,
  })
));
// Sube outputs/<name>.mp4 a Drive (reemplaza si ya existe, rclone copy por nombre).
app.post('/api/outputs/:name/drive', asyncHandler(async (req, res) => {
  const name = path.basename(String(req.params.name || ''));
  if (!name.endsWith('.mp4')) {
    return res.status(400).json({ error: 'Nombre de vídeo inválido' });
  }
  const file = path.join(OUTPUTS_DIR, name);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'Vídeo no encontrado' });
  }
  const dest = await uploadToDrive(file);
  // .txt con título + descripción (mismo nombre) para copiar al publicar.
  const txt = await writeVideoMeta(name);
  if (txt) await uploadToDrive(txt);
  res.json({ ok: true, dest, meta: !!txt });
}));

// --- Publicar en redes (Instagram Reels + TikTok, APIs nativas gratis) ---
// Estado: si hay redes configuradas + cuáles + plataformas por defecto.
app.get('/api/publicar/estado', asyncHandler(async (req, res) => {
  const safe = await readSocialSafe();
  res.json({
    configurado: await publishConfigured(),
    porDefecto: config.social.porDefecto,
    ig: safe.ig.configurado,
    tiktok: safe.tiktok.configurado,
  });
}));
// Credenciales de redes (tokens): lectura segura (sin tokens) y guardado.
app.get('/api/social/config', asyncHandler(async (req, res) => res.json(await readSocialSafe())));
app.put('/api/social/config', asyncHandler(async (req, res) =>
  res.json({ ok: true, config: await writeSocial(req.body || {}) })
));
// Caption (título + descripción) que se publicaría para un vídeo.
app.get('/api/outputs/:name/caption', asyncHandler(async (req, res) =>
  res.json({ caption: await captionForOutput(path.basename(String(req.params.name || ''))) })
));
// Publica outputs/<name>.mp4 en las plataformas del body.platforms con su caption.
app.post('/api/outputs/:name/publicar', asyncHandler(async (req, res) => {
  const name = path.basename(String(req.params.name || ''));
  if (!name.endsWith('.mp4')) return res.status(400).json({ error: 'Nombre de vídeo inválido' });
  const file = path.join(OUTPUTS_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Vídeo no encontrado' });
  const platforms = Array.isArray((req.body || {}).platforms) ? req.body.platforms : undefined;
  const caption = (req.body || {}).caption ?? (await captionForOutput(name));
  const results = await publishVideo(file, { caption, platforms });
  res.json({ ok: true, results });
}));

// --- Guiones ---
app.get('/api/scripts', asyncHandler(async (req, res) => res.json(await listScripts())));

app.get('/api/scripts/:name', asyncHandler(async (req, res) =>
  res.json(await readScript(req.params.name))
));

app.put('/api/scripts/:name', asyncHandler(async (req, res) => {
  const { data, content } = req.body || {};
  res.json({ ok: true, ...(await writeScript(req.params.name, { data, content })) });
}));

app.post('/api/scripts', asyncHandler(async (req, res) => {
  res.status(201).json({ ok: true, ...(await createScript(req.body || {})) });
}));

app.delete('/api/scripts/:name', asyncHandler(async (req, res) => {
  res.json({ ok: true, ...(await deleteScript(req.params.name)) });
}));

// --- Render (Server-Sent Events) ---
app.get('/api/render/:name/stream', (req, res) => {
  let file;
  try {
    file = safeScriptName(req.params.name);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 10000\n\n');

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  if (isRendering(file)) {
    send({ type: 'error', message: 'Ese guion ya se está renderizando' });
    send({ type: 'end' });
    res.end();
    return;
  }

  let child = null;
  let finished = false;

  req.on('close', () => {
    if (!finished && child) child.kill('SIGKILL');
  });

  send({ type: 'stage', stage: 'start', message: 'Iniciando render…' });

  runRender(file, send, (c) => {
    child = c;
  })
    .then(() => {
      finished = true;
      send({ type: 'end' });
      res.end();
    })
    .catch((err) => {
      finished = true;
      send({ type: 'error', message: err.message });
      send({ type: 'end' });
      res.end();
    });
});

// --- Fallback SPA (recarga segura del router de React) ---
// Cualquier GET que no sea API/estático sirve el index.html compilado, para que
// rutas como /g/001_ejemplo.md sobrevivan a un F5.
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const p = req.path;
  if (p.startsWith('/api') || p.startsWith('/outputs') || p.startsWith('/assets')) return next();
  if (fs.existsSync(INDEX_HTML)) return res.sendFile(INDEX_HTML);
  return res
    .status(503)
    .send('Frontend sin compilar. Ejecuta "pnpm build" (o usa "pnpm dev" para desarrollo).');
});

// --- Manejador de errores ---
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Error interno' });
});

app.listen(config.port, () => {
  console.log(`\n  ▶  Social Media Content Creator  ->  http://localhost:${config.port}\n`);
});
