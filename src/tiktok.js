// Sube un vídeo a la bandeja/borradores de TikTok (Content Posting API, inbox
// upload). El vídeo queda en la app del creador y el usuario da a "Publicar" con
// un toque (añadiendo/copiando ahí el texto). Este modo NO requiere el audit de
// TikTok, así que funciona gratis desde el primer día.
//
// Requiere: app de TikTok for Developers + token OAuth con scope video.upload.
// Guarda el token en social.config.json (ver src/socialconfig.js).
//
// Como nuestros mp4 caben en un solo chunk (<= 64 MB), subimos el archivo entero
// de una vez (total_chunk_count = 1).

import fs from 'node:fs/promises';

const INIT = 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/';

/**
 * Sube `filePath` a la bandeja de TikTok. `cfg` = { token }.
 * Devuelve { publish_id }.
 */
export async function uploadInbox(filePath, cfg) {
  if (!cfg?.token) throw new Error('TikTok sin configurar (falta token)');
  const buffer = await fs.readFile(filePath);
  const size = buffer.length;

  // 1. init: un único chunk con todo el archivo.
  const initRes = await fetch(INIT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: size,
        chunk_size: size,
        total_chunk_count: 1,
      },
    }),
  });
  const initData = await initRes.json().catch(() => ({}));
  if (!initRes.ok || initData.error?.code !== 'ok') {
    throw new Error(`TikTok init: ${initData.error?.message || `HTTP ${initRes.status}`}`);
  }
  const { publish_id, upload_url } = initData.data;

  // 2. subir los bytes (rango completo).
  const put = await fetch(upload_url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(size),
      'Content-Range': `bytes 0-${size - 1}/${size}`,
    },
    body: buffer,
  });
  if (!put.ok) throw new Error(`TikTok subida: HTTP ${put.status}`);
  return { publish_id };
}
