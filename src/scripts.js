import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { GUIONES_DIR } from './paths.js';
import {
  parseSegments,
  serializeSegments,
  extractVoiceOver,
  cleanForTTS,
  DEFAULT_LAYOUT,
} from './segments.js';
import { readDefaults, FALLBACK_DEFAULTS } from './defaults.js';

// Re-export para que el resto del backend (render.js) tenga una única fuente.
export { parseSegments, serializeSegments, extractVoiceOver, cleanForTTS };

const MD_RE = /^[\w.\- ]+\.md$/;

/** Valida y normaliza el nombre del guion (evita path traversal). */
export function safeScriptName(name) {
  const base = path.basename(String(name || ''));
  if (!base.endsWith('.md') || !MD_RE.test(base)) {
    const e = new Error('Nombre de guion inválido');
    e.status = 400;
    throw e;
  }
  const full = path.join(GUIONES_DIR, base);
  if (!full.startsWith(GUIONES_DIR + path.sep)) {
    const e = new Error('Ruta de guion inválida');
    e.status = 400;
    throw e;
  }
  return base;
}

export async function listScripts() {
  let files = [];
  try {
    files = await fs.readdir(GUIONES_DIR);
  } catch {
    return [];
  }
  const mds = files.filter((f) => f.toLowerCase().endsWith('.md'));
  const out = [];
  for (const file of mds) {
    const full = path.join(GUIONES_DIR, file);
    try {
      const raw = await fs.readFile(full, 'utf8');
      const { data, content } = matter(raw);
      const stat = await fs.stat(full);
      const segments = parseSegments(content, data);
      out.push({
        file,
        titulo: data.titulo || file.replace(/\.md$/i, ''),
        avatar_default: data.avatar_default || '',
        fondo_default: data.fondo_default || '',
        video_top_default: data.video_top_default || '',
        archivo_voz_clon: data.archivo_voz_clon || '',
        segmentos: segments.length,
        mtime: stat.mtimeMs,
      });
    } catch {
      out.push({ file, titulo: file, error: true });
    }
  }
  out.sort((a, b) => a.file.localeCompare(b.file, 'es', { numeric: true }));
  return out;
}

export async function readScript(name) {
  const file = safeScriptName(name);
  const raw = await fs.readFile(path.join(GUIONES_DIR, file), 'utf8');
  const parsed = matter(raw);
  return {
    file,
    raw,
    data: parsed.data,
    content: parsed.content,
    segments: parseSegments(parsed.content, parsed.data),
  };
}

export async function writeScript(name, { data, content }) {
  const file = safeScriptName(name);
  const raw = matter.stringify(content ?? '', data ?? {});
  await fs.writeFile(path.join(GUIONES_DIR, file), raw, 'utf8');
  return { file, raw };
}

export async function deleteScript(name) {
  const file = safeScriptName(name);
  await fs.unlink(path.join(GUIONES_DIR, file));
  return { file };
}

function slugify(str) {
  return (
    String(str || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'guion'
  );
}

async function nextIndex() {
  let files = [];
  try {
    files = await fs.readdir(GUIONES_DIR);
  } catch {
    /* carpeta vacía */
  }
  let max = 0;
  for (const f of files) {
    const m = f.match(/^(\d+)_/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return String(max + 1).padStart(3, '0');
}

export function buildTemplate(opts = {}, defaults = FALLBACK_DEFAULTS) {
  const data = {
    titulo: opts.titulo || 'Nuevo guion',
    avatar_default: opts.avatar_default || defaults.avatar,
    fondo_default: opts.fondo_default || defaults.fondo,
    video_top_default: opts.video_top_default || defaults.top,
    archivo_voz_clon: opts.archivo_voz_clon || defaults.voz,
  };
  // Sólo se escriben si difieren del valor base, para no ensuciar el front-matter.
  if (defaults.layout && defaults.layout !== DEFAULT_LAYOUT) data.layout_default = defaults.layout;
  if (defaults.musica) data.musica_default = defaults.musica;
  // Cuerpo de ejemplo con dos planos: el segundo cambia de avatar para mostrar
  // cómo conmutar avatar/top/fondo dentro del mismo guion.
  const content = `@@ nombre: Intro
Escribe aquí lo que dirá la voz en off de este primer plano.

@@ nombre: Noticia impactante
   avatar: ${data.avatar_default}
Cambia avatar, vídeo superior o fondo en cada plano para darle ritmo al vídeo.
`;
  return matter.stringify(content, data);
}

export async function createScript(opts = {}) {
  const defaults = await readDefaults();
  const idx = await nextIndex();
  const file = `${idx}_${slugify(opts.titulo)}.md`;
  const raw = buildTemplate(opts, defaults);
  await fs.writeFile(path.join(GUIONES_DIR, file), raw, 'utf8');
  return { file };
}
