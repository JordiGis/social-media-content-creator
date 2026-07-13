import fs from 'node:fs/promises';
import path from 'node:path';
import { AVATARES_DIR, IMAGENES_DIR, FONDOS_DIR, INPUTS_TOP_DIR, VOCES_DIR, MUSICA_DIR } from './paths.js';

const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v']);
const IMAGE_EXT = new Set(['.png', '.webp', '.gif']);
const AUDIO_EXT = new Set(['.wav', '.mp3', '.flac', '.m4a', '.ogg']);

async function listDir(dir, extSet) {
  let files = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  return files
    .filter((f) => !f.startsWith('.') && extSet.has(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
}

export async function listAssets() {
  const [avatares, imagenes, fondos, topVideos, voces, musica] = await Promise.all([
    listDir(AVATARES_DIR, IMAGE_EXT),
    listDir(IMAGENES_DIR, IMAGE_EXT),
    listDir(FONDOS_DIR, VIDEO_EXT),
    listDir(INPUTS_TOP_DIR, VIDEO_EXT),
    listDir(VOCES_DIR, AUDIO_EXT),
    listDir(MUSICA_DIR, AUDIO_EXT),
  ]);
  return { avatares, imagenes, fondos, topVideos, voces, musica };
}

/** Devuelve la ruta absoluta de un asset dentro de su carpeta (sanea el nombre). */
export function resolveAsset(dir, filename) {
  const base = path.basename(String(filename || ''));
  if (!base) return null;
  return path.join(dir, base);
}

// --- Gestión de assets (subir / renombrar / borrar) --------------------------

/** Catálogo de tipos gestionables -> carpeta + extensiones permitidas. */
const KINDS = {
  avatares: { dir: AVATARES_DIR, ext: IMAGE_EXT, label: 'avatar' },
  imagenes: { dir: IMAGENES_DIR, ext: IMAGE_EXT, label: 'imagen' },
  top: { dir: INPUTS_TOP_DIR, ext: VIDEO_EXT, label: 'vídeo superior' },
  fondos: { dir: FONDOS_DIR, ext: VIDEO_EXT, label: 'fondo' },
  musica: { dir: MUSICA_DIR, ext: AUDIO_EXT, label: 'música' },
  voces: { dir: VOCES_DIR, ext: AUDIO_EXT, label: 'voz' },
};

function badRequest(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** Resuelve un tipo gestionable (avatares|top|fondos|musica|voces). */
export function assetKind(kind) {
  const k = KINDS[kind];
  if (!k) throw badRequest(`Tipo de asset inválido: "${kind}"`);
  return k;
}

/** Limpia un nombre (sin separadores de ruta ni control), conserva acentos/espacios. */
function cleanBase(name) {
  return String(name || '')
    .normalize('NFC')
    .replace(/[/\\]/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim();
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Busca un nombre libre en `dir` para `base+ext` (añade " (2)", " (3)"…). */
async function freeName(dir, base, ext) {
  let candidate = `${base}${ext}`;
  let n = 2;
  while (await fileExists(path.join(dir, candidate))) {
    candidate = `${base} (${n})${ext}`;
    n += 1;
  }
  return candidate;
}

/** Extensión válida tomada de `name` (o de `fallback`), validada contra el tipo. */
function pickExt(k, name, fallback) {
  const fromName = path.extname(String(name || '')).toLowerCase();
  const ext = k.ext.has(fromName) ? fromName : path.extname(String(fallback || '')).toLowerCase();
  if (!k.ext.has(ext)) {
    throw badRequest(
      `Formato no admitido para ${k.label}. Permitidos: ${[...k.ext].join(', ')}`
    );
  }
  return ext;
}

/**
 * Guarda un asset nuevo. `desiredName` es el nombre elegido por el usuario
 * (opcional); `origName` es el nombre del archivo subido (para la extensión).
 * Devuelve { name } con el nombre final ya escrito en disco.
 */
export async function uploadAsset(kind, origName, desiredName, buffer) {
  const k = assetKind(kind);
  if (!buffer || !buffer.length) throw badRequest('Archivo vacío');
  const ext = pickExt(k, desiredName, origName);
  const base =
    cleanBase(String(desiredName || '').replace(/\.[^.]+$/, '')) ||
    cleanBase(String(origName || '').replace(/\.[^.]+$/, '')) ||
    kind;
  const name = await freeName(k.dir, base, ext);
  await fs.mkdir(k.dir, { recursive: true });
  await fs.writeFile(path.join(k.dir, name), buffer);
  return { name };
}

/** Renombra un asset conservando su extensión. */
export async function renameAsset(kind, name, newName) {
  const k = assetKind(kind);
  const cur = path.basename(String(name || ''));
  const src = path.join(k.dir, cur);
  if (!cur || !(await fileExists(src))) throw badRequest(`No existe "${name}"`, 404);
  const ext = path.extname(cur).toLowerCase();
  const base = cleanBase(String(newName || '').replace(/\.[^.]+$/, ''));
  if (!base) throw badRequest('El nombre no puede quedar vacío');
  const target = `${base}${ext}`;
  if (target === cur) return { name: cur };
  const dest = path.join(k.dir, target);
  if (await fileExists(dest)) throw badRequest(`Ya existe "${target}"`, 409);
  await fs.rename(src, dest);
  return { name: target };
}

/** Borra un asset. */
export async function deleteAsset(kind, name) {
  const k = assetKind(kind);
  const cur = path.basename(String(name || ''));
  const src = path.join(k.dir, cur);
  if (!cur || !(await fileExists(src))) throw badRequest(`No existe "${name}"`, 404);
  await fs.unlink(src);
  return { name: cur };
}
