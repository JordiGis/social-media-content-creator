// Genera el .txt que acompaña a cada vídeo: título + descripción (hashtags) del
// guion homónimo, para copiar/pegar al publicar en redes. Se guarda junto al mp4
// en outputs/ con el mismo nombre base (006_x.mp4 -> 006_x.txt) y se sube a Drive
// junto al vídeo.

import fs from 'node:fs/promises';
import path from 'node:path';
import { OUTPUTS_DIR } from './paths.js';
import { readScript } from './scripts.js';

/**
 * Escribe outputs/<base>.txt con el título y la descripción del guion <base>.md.
 * Devuelve la ruta del txt, o null si no hay guion homónimo ni metadatos.
 */
export async function writeVideoMeta(outputName) {
  const base = path.basename(String(outputName || '')).replace(/\.mp4$/i, '');
  if (!base) return null;
  let data;
  try {
    ({ data } = await readScript(`${base}.md`));
  } catch {
    return null; // sin guion homónimo: no hay nada que describir
  }
  const titulo = String(data.titulo || '').trim();
  const desc = String(data.descripcion || '').trim();
  if (!titulo && !desc) return null;
  const txt = [titulo, desc].filter(Boolean).join('\n\n') + '\n';
  const out = path.join(OUTPUTS_DIR, `${base}.txt`);
  await fs.writeFile(out, txt, 'utf8');
  return out;
}
