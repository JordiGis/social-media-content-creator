import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './paths.js';

// Plantillas de disposición (layouts) editables desde la Biblioteca. Se guardan
// en un JSON plano (git-friendly), igual que defaults.json. Una plantilla coloca
// cada elemento (fondo / vídeo top / avatar / imágenes flotantes) en una caja
// libre sobre el lienzo 1080×1920 (formato Instagram 9:16).
const LAYOUTS_FILE = path.join(ROOT, 'layouts.json');

// Lienzo de referencia. Toda x/y/w/h de los elementos es en píxeles sobre él.
export const CANVAS = { instagram: { w: 1080, h: 1920 } };

// Roles de elemento:
//   fondo  -> vídeo de fondo (input del plano)        · ajuste cover (rellena+recorta)
//   top    -> vídeo de contenido (input del plano)    · ajuste cover
//   avatar -> PNG del avatar (input del plano)        · ajuste contain (cabe dentro)
//   imagen -> imagen flotante fija de la plantilla    · ajuste contain · lleva `src`
//   subtitle -> caja donde se pinta el subtítulo automático (texto del plano).
//               Solo posición/tamaño; el estilo es global (config.subtitle).
export const ROLES = ['fondo', 'top', 'avatar', 'imagen', 'efecto', 'subtitle'];

// Tipos de efecto válidos (rol `efecto`). Operan sobre lo compuesto debajo, en
// su caja: difuminar, oscurecer (velo negro), aclarar (velo blanco), pixelar.
export const EFFECTS = ['blur', 'oscurecer', 'aclarar', 'pixelar'];

// Ajuste de un elemento visual (vídeo/imagen) a su caja:
//   estirar  -> rellena {w,h} deformando la relación de aspecto (clásico)
//   recortar -> rellena {w,h} SIN deformar (cover): escala y recorta lo que sobra
// `pos` elige qué parte se conserva al recortar (de qué lado se corta).
export const FITS = ['estirar', 'recortar'];
export const POSITIONS = ['centro', 'arriba', 'abajo', 'izquierda', 'derecha'];
const VISUAL_ROLES = ['fondo', 'top', 'avatar', 'imagen'];

// Semillas built-in: reproducen el render clásico para que los guiones que ya
// usan layout "avatar_abajo" / "avatar_arriba" sigan funcionando igual.
const HALF = 960; // 1920 / 2
export const BUILTIN_TEMPLATES = [
  {
    id: 'avatar_abajo',
    name: 'Avatar abajo · vídeo arriba',
    format: 'instagram',
    builtin: true,
    elements: [
      { role: 'top', x: 0, y: 0, w: 1080, h: HALF },
      { role: 'fondo', x: 0, y: HALF, w: 1080, h: HALF },
      { role: 'avatar', x: 240, y: HALF + (HALF - 600) / 2, w: 600, h: 600, bounce: true },
    ],
  },
  {
    id: 'avatar_arriba',
    name: 'Avatar arriba · vídeo abajo',
    format: 'instagram',
    builtin: true,
    elements: [
      { role: 'fondo', x: 0, y: 0, w: 1080, h: HALF },
      { role: 'top', x: 0, y: HALF, w: 1080, h: HALF },
      { role: 'avatar', x: 240, y: (HALF - 600) / 2, w: 600, h: 600, bounce: true },
    ],
  },
];

export const DEFAULT_TEMPLATE_ID = 'avatar_abajo';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function slugify(str) {
  return (
    String(str || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'plantilla'
  );
}

/**
 * Sanea un elemento: rol válido, caja con tamaño positivo, flags normalizados.
 * La caja PUEDE salirse del lienzo (x/y negativos, o w/h que lo superan): el
 * render recorta a lo que quede dentro. Se limita el desbordamiento a un lienzo
 * por lado (OVER) para evitar valores absurdos.
 */
function cleanElement(el = {}, canvas) {
  const role = ROLES.includes(el.role) ? el.role : 'imagen';
  const w = clamp(Math.round(Number(el.w) || 0), 1, canvas.w * 2);
  const h = clamp(Math.round(Number(el.h) || 0), 1, canvas.h * 2);
  const x = clamp(Math.round(Number(el.x) || 0), -canvas.w, canvas.w * 2);
  const y = clamp(Math.round(Number(el.y) || 0), -canvas.h, canvas.h * 2);
  const out = { role, x, y, w, h };
  if (VISUAL_ROLES.includes(role)) {
    out.fit = FITS.includes(el.fit) ? el.fit : 'estirar';
    out.pos = POSITIONS.includes(el.pos) ? el.pos : 'centro';
  }
  if (role === 'avatar' || role === 'imagen') out.bounce = !!el.bounce;
  if (role === 'imagen') out.src = el.src ? path.basename(String(el.src)) : '';
  if (role === 'efecto') {
    out.effect = EFFECTS.includes(el.effect) ? el.effect : 'blur';
    out.amount = clamp(Math.round(Number(el.amount) || 0), 0, 100); // 0 = intensidad por defecto
  }
  return out;
}

/** Sanea una plantilla completa. `id` opcional fuerza el identificador. */
export function cleanTemplate(tpl = {}, id) {
  const format = CANVAS[tpl.format] ? tpl.format : 'instagram';
  const canvas = CANVAS[format];
  const finalId = slugify(id || tpl.id || tpl.name);
  return {
    id: finalId,
    name: String(tpl.name || finalId).trim().slice(0, 80) || finalId,
    format,
    elements: Array.isArray(tpl.elements) ? tpl.elements.map((e) => cleanElement(e, canvas)) : [],
  };
}

const isSeed = (id) => BUILTIN_TEMPLATES.some((b) => b.id === id);

/** Lee solo las plantillas guardadas en disco (overrides + custom), ya saneadas. */
async function readSaved() {
  try {
    const json = JSON.parse(await fs.readFile(LAYOUTS_FILE, 'utf8'));
    if (Array.isArray(json?.templates)) return json.templates.map((t) => cleanTemplate(t));
  } catch {
    /* sin archivo */
  }
  return [];
}

async function writeSaved(saved) {
  await fs.writeFile(
    LAYOUTS_FILE,
    JSON.stringify({ version: 1, templates: saved.map((t) => cleanTemplate(t)) }, null, 2) + '\n',
    'utf8'
  );
}

/**
 * Lee todas las plantillas: built-in (semillas en código) + las guardadas, que
 * pisan a la built-in del mismo id (override editable). Cada una lleva flags:
 *   builtin    -> su id es una semilla
 *   overridden -> existe una versión guardada que pisa la semilla (se puede restaurar)
 */
export async function readLayouts() {
  const saved = await readSaved();
  const savedIds = new Set(saved.map((t) => t.id));
  const byId = new Map();
  for (const t of BUILTIN_TEMPLATES) {
    byId.set(t.id, { ...cleanTemplate(t), builtin: true, overridden: savedIds.has(t.id) });
  }
  for (const t of saved) {
    const seed = isSeed(t.id);
    byId.set(t.id, { ...t, builtin: seed, overridden: seed });
  }
  return [...byId.values()];
}

/** Crea o actualiza una plantilla (incluido override de una built-in). */
export async function upsertTemplate(id, body = {}) {
  const saved = await readSaved();
  const c = cleanTemplate(body, id);
  const next = saved.some((t) => t.id === c.id) ? saved.map((t) => (t.id === c.id ? c : t)) : [...saved, c];
  await writeSaved(next);
  const seed = isSeed(c.id);
  return { ...c, builtin: seed, overridden: seed };
}

/**
 * Borra una plantilla guardada. Si el id es una semilla, esto la RESTAURA a su
 * versión de fábrica (quita el override). Si es custom, la elimina del todo.
 */
export async function deleteTemplate(id) {
  const sid = slugify(id);
  const saved = await readSaved();
  if (!saved.some((t) => t.id === sid)) {
    const e = new Error(
      isSeed(sid) ? 'La plantilla integrada no tiene cambios que restaurar' : 'Plantilla no encontrada'
    );
    e.status = isSeed(sid) ? 409 : 404;
    throw e;
  }
  await writeSaved(saved.filter((t) => t.id !== sid));
  return { id: sid, reset: isSeed(sid) };
}

/** Resuelve un id a su plantilla; cae al default si no existe. */
export async function resolveTemplate(id) {
  const all = await readLayouts();
  return (
    all.find((t) => t.id === id) ||
    all.find((t) => t.id === DEFAULT_TEMPLATE_ID) ||
    all[0] ||
    BUILTIN_TEMPLATES[0]
  );
}
