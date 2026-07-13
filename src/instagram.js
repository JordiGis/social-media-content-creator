// Publica un Reel en Instagram con la Graph API (gratis). Flujo oficial:
//   1. crear contenedor de media (media_type=REELS, video_url público, caption)
//   2. sondear su status_code hasta FINISHED (la IG descarga y procesa el vídeo)
//   3. publicar el contenedor
//
// Requiere: cuenta IG Business/Creator ligada a una página de Facebook, una app
// de Meta (en modo desarrollo basta para tu propia cuenta, sin App Review) y un
// token con instagram_content_publish. Guarda token + ig-user-id en
// social.config.json (ver src/socialconfig.js).

import { config } from './config.js';

const GRAPH = `https://graph.facebook.com/${config.social.graphVersion}`;

async function gp(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `Graph API HTTP ${res.status}`);
  }
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Publica `videoUrl` (URL pública del mp4) como Reel con `caption`.
 * `cfg` = { token, userId }. Devuelve { id } del post publicado.
 */
export async function publishReel(videoUrl, caption, cfg) {
  if (!cfg?.token || !cfg?.userId) {
    throw new Error('Instagram sin configurar (falta token o ig-user-id)');
  }
  // 1. Contenedor.
  const create = new URL(`${GRAPH}/${cfg.userId}/media`);
  create.searchParams.set('media_type', 'REELS');
  create.searchParams.set('video_url', videoUrl);
  create.searchParams.set('caption', caption || '');
  create.searchParams.set('access_token', cfg.token);
  const { id: creationId } = await gp(create.toString(), { method: 'POST' });

  // 2. Esperar a que IG termine de bajar/procesar el vídeo (hasta ~2 min).
  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    const st = new URL(`${GRAPH}/${creationId}`);
    st.searchParams.set('fields', 'status_code,status');
    st.searchParams.set('access_token', cfg.token);
    const s = await gp(st.toString());
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR') throw new Error(`IG no pudo procesar el vídeo: ${s.status || ''}`);
    if (i === 39) throw new Error('IG tardó demasiado en procesar el vídeo');
  }

  // 3. Publicar.
  const pub = new URL(`${GRAPH}/${cfg.userId}/media_publish`);
  pub.searchParams.set('creation_id', creationId);
  pub.searchParams.set('access_token', cfg.token);
  return gp(pub.toString(), { method: 'POST' });
}
