// "Carrito" de recursos a descargar (vídeos IA, música libre…). Cada tarjeta
// (card) es un enlace curado con una carpeta destino (`kind`). El script
// scripts/descargar.mjs (o la subida manual desde la web) baja VARIOS candidatos
// por card a STAGING (assets/_pendientes); tú marcas cuáles son válidos, registras
// los buenos a su carpeta de assets y borras los sobrantes SIN borrar la card
// (así la card sigue como plantilla para volver a buscar).
//
// El catálogo (enlaces + candidatos + estado) se guarda en descargas.json en la
// raíz: texto plano, git-friendly, igual que defaults.json. Los binarios en
// _pendientes NO se versionan (ver .gitignore).

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, PENDIENTES_DIR } from './paths.js';
import { assetKind, uploadAsset, deleteAsset } from './assets.js';

const FILE = path.join(ROOT, 'descargas.json');

const shortId = () => crypto.randomUUID().slice(0, 8);

function badRequest(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Deriva el host de una URL para mostrarlo como "fuente" (pixabay.com…).
function hostOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Estado de la card, DERIVADO de sus candidatos (no se persiste):
//   'pendiente'  -> sin candidatos aún (solo el enlace)
//   'subido'     -> hay candidatos en staging por revisar/registrar
//   'registrado' -> todos los candidatos ya registrados (y hay al menos uno)
function estadoOf(card) {
  const cs = card.candidatos || [];
  if (!cs.length) return 'pendiente';
  if (cs.some((c) => c.estado !== 'registrado')) return 'subido';
  return 'registrado';
}

// Migra una card del modelo antiguo (archivo/assetName/estado planos, 1 archivo)
// al nuevo (candidatos[]). Idempotente: si ya trae `candidatos`, la deja igual.
function migrateCard(raw) {
  if (Array.isArray(raw.candidatos)) return raw;
  const candidatos = [];
  if (raw.estado === 'registrado' && raw.assetName) {
    candidatos.push({
      cid: shortId(), url: raw.url || '', archivo: null, origName: raw.origName || '',
      size: 0, valido: true, estado: 'registrado', assetName: raw.assetName,
      createdAt: raw.createdAt || null,
    });
  } else if (raw.archivo) {
    candidatos.push({
      cid: shortId(), url: raw.url || '', archivo: raw.archivo, origName: raw.origName || '',
      size: 0, valido: false, estado: 'subido', assetName: null,
      createdAt: raw.createdAt || null,
    });
  }
  const { archivo, assetName, origName, estado, ...card } = raw;
  return { ...card, candidatos };
}

async function readAll() {
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(FILE, 'utf8'));
  } catch {
    return { list: [], migrated: false };
  }
  if (!Array.isArray(raw)) return { list: [], migrated: false };
  const before = JSON.stringify(raw);
  const list = raw.map(migrateCard);
  return { list, migrated: JSON.stringify(list) !== before };
}

async function writeAll(list) {
  await fs.writeFile(FILE, JSON.stringify(list, null, 2) + '\n', 'utf8');
}

// Lee el catálogo migrado; persiste la migración la primera vez que cambia algo.
async function load() {
  const { list, migrated } = await readAll();
  if (migrated) await writeAll(list);
  return list;
}

// Añade el estado derivado a la card para el cliente.
function decorate(card) {
  return { ...card, estado: estadoOf(card) };
}

/** Lista completa (más recientes primero), con estado derivado. */
export async function listDescargas() {
  const list = await load();
  return [...list].reverse().map(decorate);
}

function findCard(list, id) {
  const card = list.find((d) => d.id === id);
  if (!card) throw badRequest('Descarga no encontrada', 404);
  return card;
}

// Sanea el patch entrante a las claves editables por el usuario.
function pickPatch(obj = {}) {
  const out = {};
  if (obj.titulo != null) out.titulo = String(obj.titulo).trim().slice(0, 200);
  if (obj.url != null) out.url = String(obj.url).trim().slice(0, 2000);
  if (obj.nota != null) out.nota = String(obj.nota).trim().slice(0, 500);
  if (obj.kind != null) {
    assetKind(obj.kind); // valida contra el catálogo de assets (lanza si no existe)
    out.kind = String(obj.kind);
  }
  return out;
}

/** Alta de un enlace nuevo en la lista. `kind` = carpeta destino (top|musica|…). */
export async function addDescarga(body = {}) {
  const patch = pickPatch(body);
  if (!patch.url) throw badRequest('Falta el enlace (url)');
  const kind = patch.kind || 'top';
  assetKind(kind);
  const card = {
    id: shortId(),
    titulo: patch.titulo || '',
    url: patch.url,
    fuente: hostOf(patch.url),
    kind,
    nota: patch.nota || '',
    candidatos: [], // se llenan al descargar/subir; cada uno un archivo en staging
    createdAt: new Date().toISOString(),
  };
  const list = await load();
  list.push(card);
  await writeAll(list);
  return decorate(card);
}

/** Edita título/url/kind/nota de un enlace ya listado. */
export async function updateDescarga(id, body = {}) {
  const list = await load();
  const card = findCard(list, id);
  const patch = pickPatch(body);
  Object.assign(card, patch);
  if (patch.url) card.fuente = hostOf(patch.url);
  await writeAll(list);
  return decorate(card);
}

async function unlinkStaged(name) {
  if (!name) return;
  await fs.rm(path.join(PENDIENTES_DIR, path.basename(name)), { force: true });
}

/** Borra una card entera (y todos sus binarios en staging). */
export async function deleteDescarga(id) {
  const list = await load();
  const card = findCard(list, id);
  for (const c of card.candidatos || []) await unlinkStaged(c.archivo);
  await writeAll(list.filter((d) => d.id !== id));
  return { id };
}

/**
 * Añade un candidato a la card: guarda el binario en staging y lo deja 'subido'
 * (por revisar/registrar). `origName` da la extensión; `sourceUrl` es de dónde
 * salió (página del clip) para atribución. Devuelve la card decorada.
 */
export async function addCandidato(id, origName, buffer, sourceUrl = '') {
  if (!buffer || !buffer.length) throw badRequest('Archivo vacío');
  const list = await load();
  const card = findCard(list, id);
  const ext = path.extname(String(origName || '')).toLowerCase();
  const k = assetKind(card.kind);
  if (!k.ext.has(ext)) {
    throw badRequest(`Formato no admitido para ${k.label}. Permitidos: ${[...k.ext].join(', ')}`);
  }
  await fs.mkdir(PENDIENTES_DIR, { recursive: true });
  const cid = shortId();
  const archivo = `${card.id}-${cid}${ext}`;
  await fs.writeFile(path.join(PENDIENTES_DIR, archivo), buffer);
  card.candidatos.push({
    cid,
    url: String(sourceUrl || card.url || ''),
    archivo,
    origName: path.basename(String(origName || '')),
    size: buffer.length,
    valido: false,
    estado: 'subido',
    assetName: null,
    createdAt: new Date().toISOString(),
  });
  await writeAll(list);
  return decorate(card);
}

function findCandidato(card, cid) {
  const c = (card.candidatos || []).find((x) => x.cid === cid);
  if (!c) throw badRequest('Candidato no encontrado', 404);
  return c;
}

/** Marca/desmarca un candidato como válido (la elección del usuario). */
export async function marcarCandidato(id, cid, valido) {
  const list = await load();
  const card = findCard(list, id);
  findCandidato(card, cid).valido = !!valido;
  await writeAll(list);
  return decorate(card);
}

/**
 * Borra UN candidato (su binario en staging y, si ya estaba registrado, también
 * el asset). NO borra la card: sirve para descartar los que no gustan y dejar la
 * card lista para volver a buscar.
 */
export async function deleteCandidato(id, cid) {
  const list = await load();
  const card = findCard(list, id);
  const c = findCandidato(card, cid);
  await unlinkStaged(c.archivo);
  if (c.estado === 'registrado' && c.assetName) {
    try {
      await deleteAsset(card.kind, c.assetName);
    } catch {
      // el asset pudo borrarse/renombrarse a mano; seguimos quitando el candidato
    }
  }
  card.candidatos = card.candidatos.filter((x) => x.cid !== cid);
  await writeAll(list);
  return decorate(card);
}

// Registra un candidato concreto: mueve el binario de staging a su carpeta de
// assets con nombre limpio (vía uploadAsset) y lo deja 'registrado'.
async function registerOne(card, c, desiredName) {
  if (c.estado === 'registrado') return c;
  if (!c.archivo) throw badRequest('El candidato no tiene archivo en staging', 409);
  const staged = path.join(PENDIENTES_DIR, path.basename(c.archivo));
  const buffer = await fs.readFile(staged);
  const name = (desiredName && String(desiredName).trim()) || card.titulo || c.origName || card.id;
  const { name: assetName } = await uploadAsset(card.kind, c.origName || c.archivo, name, buffer);
  await unlinkStaged(c.archivo);
  c.archivo = null;
  c.assetName = assetName;
  c.valido = true;
  c.estado = 'registrado';
  return c;
}

/** Registra un candidato concreto de la card. */
export async function registrarCandidato(id, cid, desiredName) {
  const list = await load();
  const card = findCard(list, id);
  const c = findCandidato(card, cid);
  await registerOne(card, c, desiredName);
  await writeAll(list);
  return decorate(card);
}

/**
 * Registra de golpe todos los candidatos marcados como válidos y aún en staging.
 * Devuelve la card y los nombres de asset creados.
 */
export async function registrarValidos(id, desiredName) {
  const list = await load();
  const card = findCard(list, id);
  const pend = (card.candidatos || []).filter((c) => c.valido && c.estado === 'subido');
  if (!pend.length) throw badRequest('No hay candidatos válidos por registrar', 409);
  const assetNames = [];
  for (const c of pend) {
    await registerOne(card, c, desiredName);
    assetNames.push(c.assetName);
  }
  await writeAll(list);
  return { card: decorate(card), assetNames };
}
