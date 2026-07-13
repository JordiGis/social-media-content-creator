// Orquesta la publicación de un vídeo en Instagram Reels (automático) y TikTok
// (sube a borrador; publicas con un toque). Todo con APIs nativas gratis.
//   - Instagram: Graph API. El vídeo se sirve por una URL pública temporal
//     (cloudflared) que IG va a buscar; se publica solo.
//   - TikTok: Content Posting API (inbox upload). Queda en la app para dar a
//     "Publicar" con un toque (sin audit de TikTok).
//
// Caption = título + descripción (hashtags) del guion homónimo. Los tokens viven
// en social.config.json (src/socialconfig.js).

import path from 'node:path';
import { config } from './config.js';
import { readScript } from './scripts.js';
import { readSocial } from './socialconfig.js';
import { hostTemporarily } from './videohost.js';
import { publishReel } from './instagram.js';
import { uploadInbox } from './tiktok.js';

const PLATFORMS = new Set(['instagram', 'tiktok']);

/** ¿Hay al menos una red configurada (con token)? */
export async function publishConfigured() {
  const c = await readSocial();
  return !!(c.tiktok.token || (c.ig.token && c.ig.userId));
}

/** Caption para redes: título + descripción (con hashtags) del guion homónimo. */
export async function captionForOutput(outputName) {
  const base = path.basename(String(outputName || '')).replace(/\.mp4$/i, '');
  try {
    const { data } = await readScript(`${base}.md`);
    const titulo = String(data.titulo || '').trim();
    const desc = String(data.descripcion || '').trim();
    return [titulo, desc].filter(Boolean).join('\n\n');
  } catch {
    return '';
  }
}

/**
 * Publica `filePath` en las `platforms` pedidas. Devuelve un array de resultados
 * por red: { platform, ok, id?, message?, nota? }. No lanza si una red falla:
 * cada una reporta su propio estado.
 */
export async function publishVideo(filePath, { caption = '', platforms } = {}) {
  const plats = (platforms || config.social.porDefecto).filter((p) => PLATFORMS.has(p));
  if (!plats.length) throw new Error('Elige al menos una red (instagram o tiktok)');
  const social = await readSocial();
  const results = [];

  // TikTok primero (rápido, sin túnel): subida a borrador.
  if (plats.includes('tiktok')) {
    try {
      const r = await uploadInbox(filePath, social.tiktok);
      results.push({ platform: 'tiktok', ok: true, id: r.publish_id,
        nota: 'Enviado a tu TikTok: ábrelo y dale a Publicar (1 toque).' });
    } catch (e) {
      results.push({ platform: 'tiktok', ok: false, message: e.message });
    }
  }

  // Instagram: necesita URL pública -> host temporal mientras IG procesa.
  if (plats.includes('instagram')) {
    try {
      const url = await hostTemporarily(filePath);
      const r = await publishReel(url, caption, social.ig);
      results.push({ platform: 'instagram', ok: true, id: r.id, nota: 'Reel publicado.' });
    } catch (e) {
      results.push({ platform: 'instagram', ok: false, message: e.message });
    }
  }

  return results;
}
