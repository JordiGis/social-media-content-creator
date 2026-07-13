import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT = path.resolve(__dirname, '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const GUIONES_DIR = path.join(ROOT, 'guiones');
export const ASSETS_DIR = path.join(ROOT, 'assets');
export const AVATARES_DIR = path.join(ASSETS_DIR, 'avatares');
export const IMAGENES_DIR = path.join(ASSETS_DIR, 'imagenes');
export const FONDOS_DIR = path.join(ASSETS_DIR, 'fondos_matrix');
export const INPUTS_TOP_DIR = path.join(ASSETS_DIR, 'inputs_top');
export const VOCES_DIR = path.join(ASSETS_DIR, 'voces_referencia');
export const MUSICA_DIR = path.join(ASSETS_DIR, 'musica');
// Zona de staging: archivos descargados y subidos que aún NO se han registrado
// en su carpeta de assets definitiva (ver src/descargas.js).
export const PENDIENTES_DIR = path.join(ASSETS_DIR, '_pendientes');
export const OUTPUTS_DIR = path.join(ROOT, 'outputs');
export const TEMP_DIR = path.join(ROOT, 'temp');
export const PYTHON_DIR = path.join(ROOT, 'python');
export const BRIDGE_SCRIPT = path.join(PYTHON_DIR, 'pocket_tts_bridge.py');

export function ensureDirs() {
  for (const d of [
    GUIONES_DIR,
    AVATARES_DIR,
    IMAGENES_DIR,
    FONDOS_DIR,
    INPUTS_TOP_DIR,
    VOCES_DIR,
    MUSICA_DIR,
    PENDIENTES_DIR,
    OUTPUTS_DIR,
    TEMP_DIR,
  ]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
