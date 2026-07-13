// Cliente de la API del backend Express. Las rutas se proxean a :4000 en dev
// (ver vite.config.js) y se sirven directamente en producción.

async function j(url, opts) {
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

const jsonBody = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  listScripts: () => j('/api/scripts'),
  getScript: (name) => j(`/api/scripts/${encodeURIComponent(name)}`),
  saveScript: (name, body) =>
    j(`/api/scripts/${encodeURIComponent(name)}`, { ...jsonBody(body), method: 'PUT' }),
  createScript: (body) => j('/api/scripts', jsonBody(body)),
  deleteScript: (name) =>
    j(`/api/scripts/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  assets: () => j('/api/assets'),
  renderUrl: (name) => `/api/render/${encodeURIComponent(name)}/stream`,

  // --- Predeterminados globales para nuevos guiones ---
  getDefaults: () => j('/api/defaults'),
  saveDefaults: (body) =>
    j('/api/defaults', { ...jsonBody(body), method: 'PUT' }).then((r) => r.defaults),

  // --- Plantillas de disposición (layouts) ---
  getLayouts: () => j('/api/layouts').then((r) => r.templates || []),
  saveLayout: (id, body) =>
    j(`/api/layouts/${encodeURIComponent(id)}`, { ...jsonBody(body), method: 'PUT' }).then(
      (r) => r.template
    ),
  deleteLayout: (id) => j(`/api/layouts/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // --- Correo entrante (IMAP, solo lectura) ---
  getMailConfig: () => j('/api/mail/config'),
  saveMailConfig: (body) =>
    j('/api/mail/config', { ...jsonBody(body), method: 'PUT' }).then((r) => r.config),
  testMail: () => j('/api/mail/test', { method: 'POST' }),
  listMail: (limit = 30) => j(`/api/mail/messages?limit=${limit}`),
  getMail: (uid) => j(`/api/mail/messages/${encodeURIComponent(uid)}`),

  // --- Gestión de assets (biblioteca) ---
  // kind: avatares | top | fondos | musica | voces
  uploadAsset: (kind, file, name) =>
    j(
      `/api/assets/${kind}?name=${encodeURIComponent(name || '')}&filename=${encodeURIComponent(
        file.name || ''
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      }
    ),
  renameAsset: (kind, name, newName) =>
    j(`/api/assets/${kind}/${encodeURIComponent(name)}`, {
      ...jsonBody({ name: newName }),
      method: 'PATCH',
    }),
  deleteAsset: (kind, name) =>
    j(`/api/assets/${kind}/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // --- Descargas pendientes (carrito de recursos) ---
  listDescargas: () => j('/api/descargas'),
  addDescarga: (body) => j('/api/descargas', jsonBody(body)).then((r) => r.item),
  updateDescarga: (id, body) =>
    j(`/api/descargas/${encodeURIComponent(id)}`, { ...jsonBody(body), method: 'PATCH' }).then((r) => r.item),
  deleteDescarga: (id) => j(`/api/descargas/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  // Sube un archivo descargado a mano como nuevo candidato de la card.
  subirDescarga: (id, file) =>
    j(`/api/descargas/${encodeURIComponent(id)}/subir?filename=${encodeURIComponent(file.name || '')}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    }).then((r) => r.item),
  // --- Candidatos dentro de una card ---
  marcarCandidato: (id, cid, valido) =>
    j(`/api/descargas/${encodeURIComponent(id)}/candidatos/${encodeURIComponent(cid)}/marcar`,
      jsonBody({ valido })).then((r) => r.item),
  borrarCandidato: (id, cid) =>
    j(`/api/descargas/${encodeURIComponent(id)}/candidatos/${encodeURIComponent(cid)}`,
      { method: 'DELETE' }).then((r) => r.item),
  registrarCandidato: (id, cid, name) =>
    j(`/api/descargas/${encodeURIComponent(id)}/candidatos/${encodeURIComponent(cid)}/registrar`,
      jsonBody({ name })).then((r) => r.item),
  registrarValidos: (id, name) =>
    j(`/api/descargas/${encodeURIComponent(id)}/registrar-validos`, jsonBody({ name })),

  // --- Google Drive ---
  driveEstado: () => j('/api/drive/estado'),
  subirOutputDrive: (name) =>
    j(`/api/outputs/${encodeURIComponent(name)}/drive`, { method: 'POST' }),

  // --- Publicar en redes (Instagram + TikTok, nativo) ---
  publicarEstado: () => j('/api/publicar/estado'),
  getSocialConfig: () => j('/api/social/config'),
  saveSocialConfig: (body) =>
    j('/api/social/config', { ...jsonBody(body), method: 'PUT' }).then((r) => r.config),
  captionOutput: (name) =>
    j(`/api/outputs/${encodeURIComponent(name)}/caption`).then((r) => r.caption),
  publicarOutput: (name, platforms, caption) =>
    j(`/api/outputs/${encodeURIComponent(name)}/publicar`, jsonBody({ platforms, caption })),
};

// URL del archivo en staging (carpeta _pendientes servida por Express).
export const pendienteUrl = (file) => `/assets/_pendientes/${encodeURIComponent(file)}`;

// Rutas estáticas de assets servidas por Express.
export const assetUrl = {
  avatar: (f) => `/assets/avatares/${encodeURIComponent(f)}`,
  imagen: (f) => `/assets/imagenes/${encodeURIComponent(f)}`,
  top: (f) => `/assets/inputs_top/${encodeURIComponent(f)}`,
  fondo: (f) => `/assets/fondos_matrix/${encodeURIComponent(f)}`,
  musica: (f) => `/assets/musica/${encodeURIComponent(f)}`,
  voz: (f) => `/assets/voces_referencia/${encodeURIComponent(f)}`,
};
