import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './paths.js';
import { DEFAULT_TEMPLATE_ID } from './layouts.js';

// Predeterminados globales editables desde la Biblioteca de recursos. Se guardan
// en un JSON plano (git-friendly) y siembran el front-matter de cada guion nuevo
// (ver src/scripts.js). Si el archivo no existe, se usan los valores de reserva.
const DEFAULTS_FILE = path.join(ROOT, 'defaults.json');

export const FALLBACK_DEFAULTS = {
  avatar: 'neutral.png',
  top: 'video_top.mp4',
  fondo: 'fondo.mp4',
  voz: 'narrador.wav',
  musica: '', // vacío = el vídeo abre sin música
  layout: DEFAULT_TEMPLATE_ID,
  // Subtítulos (rol `subtitle` de la disposición). A diferencia del resto, esto
  // es un ajuste GLOBAL de render: se lee al renderizar, afecta a todos los vídeos.
  //   'flujo'  -> troceado + cortina izquierda->derecha (se "escribe")
  //   'entero' -> el texto del plano entero, fijo (como antes de la cortina)
  subtitulos: 'flujo',
};

const SUBTITULOS = new Set(['flujo', 'entero']);
const KEYS = Object.keys(FALLBACK_DEFAULTS);

// Conserva sólo claves conocidas y sanea cada valor a un nombre de archivo
// (sin separadores de ruta). `layout` es un id de plantilla (se resuelve en
// render; si no existe, cae al default), por eso aquí solo se normaliza.
function pick(obj = {}) {
  const out = {};
  for (const k of KEYS) {
    if (obj[k] == null) continue;
    const v = String(obj[k]).trim();
    if (k === 'layout') out[k] = v || DEFAULT_TEMPLATE_ID;
    else if (k === 'subtitulos') out[k] = SUBTITULOS.has(v) ? v : 'flujo';
    else out[k] = v ? path.basename(v) : '';
  }
  return out;
}

export async function readDefaults() {
  try {
    const saved = JSON.parse(await fs.readFile(DEFAULTS_FILE, 'utf8'));
    return { ...FALLBACK_DEFAULTS, ...pick(saved) };
  } catch {
    return { ...FALLBACK_DEFAULTS };
  }
}

/** Mezcla `patch` sobre los predeterminados actuales y persiste el resultado. */
export async function writeDefaults(patch = {}) {
  const next = { ...(await readDefaults()), ...pick(patch) };
  await fs.writeFile(DEFAULTS_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}
