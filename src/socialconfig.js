// Credenciales de publicación en redes (tokens de Instagram Graph API y TikTok).
// Se guardan en social.config.json en la raíz, FUERA de git (.gitignore). Los
// tokens nunca se devuelven al cliente: solo se expone si hay token guardado.

import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './paths.js';

const FILE = path.join(ROOT, 'social.config.json');

const EMPTY = { ig: { token: '', userId: '' }, tiktok: { token: '' } };

/** Lee la config completa (con tokens) para uso interno del backend. */
export async function readSocial() {
  try {
    const raw = JSON.parse(await fs.readFile(FILE, 'utf8'));
    return {
      ig: { token: raw?.ig?.token || '', userId: raw?.ig?.userId || '' },
      tiktok: { token: raw?.tiktok?.token || '' },
    };
  } catch {
    return { ig: { ...EMPTY.ig }, tiktok: { ...EMPTY.tiktok } };
  }
}

/** Versión segura para el cliente: sin tokens, solo si están puestos. */
export async function readSocialSafe() {
  const c = await readSocial();
  return {
    ig: { userId: c.ig.userId, hasToken: !!c.ig.token, configurado: !!(c.ig.token && c.ig.userId) },
    tiktok: { hasToken: !!c.tiktok.token, configurado: !!c.tiktok.token },
  };
}

/**
 * Guarda la config. Los tokens solo se sobrescriben si llegan no vacíos (para no
 * borrarlos al guardar sin reescribirlos, igual que la contraseña de correo).
 */
export async function writeSocial(patch = {}) {
  const cur = await readSocial();
  const next = {
    ig: {
      userId: patch.ig?.userId != null ? String(patch.ig.userId).trim() : cur.ig.userId,
      token: patch.ig?.token ? String(patch.ig.token).trim() : cur.ig.token,
    },
    tiktok: {
      token: patch.tiktok?.token ? String(patch.tiktok.token).trim() : cur.tiktok.token,
    },
  };
  await fs.writeFile(FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return readSocialSafe();
}
