// Hosting temporal del vídeo para que Instagram (Graph API) pueda ir a buscarlo
// por URL pública. Sube el mp4 a litterbox (catbox temporal) y devuelve una URL
// directa en dominio estable (sin lag de DNS, a diferencia de un túnel efímero).
// El archivo se autoborra pasado `time` (1h por defecto), no hay que limpiar.
//
// El contenido va a publicarse en redes de todos modos (no es privado), así que
// un host temporal público es adecuado.

import fs from 'node:fs/promises';
import path from 'node:path';

const ENDPOINT = 'https://litterbox.catbox.moe/resources/internals/api.php';

/**
 * Sube `filePath` a un host temporal y devuelve la URL pública directa.
 * `time` ∈ 1h | 12h | 24h | 72h.
 */
export async function hostTemporarily(filePath, { time = '1h' } = {}) {
  const buffer = await fs.readFile(filePath);
  const form = new FormData();
  form.set('reqtype', 'fileupload');
  form.set('time', time);
  form.set('fileToUpload', new Blob([buffer], { type: 'video/mp4' }), path.basename(filePath));

  const res = await fetch(ENDPOINT, { method: 'POST', body: form });
  const text = (await res.text()).trim();
  if (!res.ok || !/^https?:\/\//.test(text)) {
    throw new Error(`No se pudo hostear el vídeo para Instagram: ${text || `HTTP ${res.status}`}`);
  }
  return text;
}
