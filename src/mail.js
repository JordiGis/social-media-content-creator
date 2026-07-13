// Cliente de correo SOLO LECTURA (IMAP). Sirve para recibir newsletters y tener
// material de actualidad con el que escribir guiones. NO envía nada.
//
// La config (host/puerto/usuario/contraseña) se guarda en mail.config.json en la
// raíz. Ese archivo lleva la contraseña EN CLARO, por eso está en .gitignore.
// Es una app local de un solo usuario; si necesitas algo más seguro usa una
// contraseña de aplicación dedicada (Gmail/Outlook) en vez de la principal.

import fs from 'node:fs/promises';
import path from 'node:path';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { ROOT } from './paths.js';

const MAIL_FILE = path.join(ROOT, 'mail.config.json');

const FALLBACK_CONFIG = {
  enabled: false,
  host: '',
  port: 993,
  secure: true, // TLS implícito (993). false = STARTTLS en 143.
  user: '',
  password: '',
  mailbox: 'INBOX',
};

// Claves que se devuelven al frontend (la contraseña NUNCA sale del backend).
const PUBLIC_KEYS = ['enabled', 'host', 'port', 'secure', 'user', 'mailbox'];

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

// Sanea y conserva solo claves conocidas del patch entrante.
function pick(obj = {}) {
  const out = {};
  if ('enabled' in obj) out.enabled = !!obj.enabled;
  if ('secure' in obj) out.secure = !!obj.secure;
  if (obj.host != null) out.host = String(obj.host).trim();
  if (obj.user != null) out.user = String(obj.user).trim();
  if (obj.mailbox != null) out.mailbox = String(obj.mailbox).trim() || 'INBOX';
  if (obj.port != null) out.port = num(obj.port, 993);
  // La contraseña vacía en un patch significa "no la cambies", para no borrarla
  // al guardar el resto del formulario sin reescribirla.
  if (typeof obj.password === 'string' && obj.password !== '') out.password = obj.password;
  return out;
}

async function readRaw() {
  try {
    const saved = JSON.parse(await fs.readFile(MAIL_FILE, 'utf8'));
    return { ...FALLBACK_CONFIG, ...saved };
  } catch {
    return { ...FALLBACK_CONFIG };
  }
}

/** Config sin contraseña, para el frontend. Añade `hasPassword` como indicador. */
export async function readMailConfig() {
  const cfg = await readRaw();
  const out = {};
  for (const k of PUBLIC_KEYS) out[k] = cfg[k];
  out.hasPassword = !!cfg.password;
  return out;
}

/** Mezcla el patch sobre la config actual y persiste. Devuelve la versión pública. */
export async function writeMailConfig(patch = {}) {
  const next = { ...(await readRaw()), ...pick(patch) };
  await fs.writeFile(MAIL_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return readMailConfig();
}

// Abre una conexión IMAP con la config guardada. El llamante debe cerrarla
// (try/finally con client.logout()).
async function connect() {
  const cfg = await readRaw();
  if (!cfg.host || !cfg.user || !cfg.password) {
    const err = new Error('Configura host, usuario y contraseña en Configuración → Correo.');
    err.status = 400;
    throw err;
  }
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    logger: false,
  });
  await client.connect();
  return { client, mailbox: cfg.mailbox || 'INBOX' };
}

/** Prueba la conexión y devuelve cuántos mensajes hay en el buzón. */
export async function testConnection() {
  const { client, mailbox } = await connect();
  try {
    const box = await client.mailboxOpen(mailbox, { readOnly: true });
    return { ok: true, mailbox, total: box.exists };
  } finally {
    await client.logout().catch(() => {});
  }
}

// Recorta texto plano a una vista previa de una línea.
function snippet(text, max = 160) {
  if (!text) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max) + '…' : flat;
}

/**
 * Lista los últimos `limit` mensajes del buzón (más recientes primero).
 * Solo cabeceras + vista previa; el cuerpo completo se pide por UID aparte.
 */
export async function listMessages({ limit = 30 } = {}) {
  const { client, mailbox } = await connect();
  try {
    const box = await client.mailboxOpen(mailbox, { readOnly: true });
    const total = box.exists;
    if (!total) return { mailbox, total: 0, messages: [] };

    const start = Math.max(1, total - limit + 1); // ventana de los más recientes
    const range = `${start}:${total}`;
    const messages = [];
    for await (const msg of client.fetch(
      range,
      { uid: true, envelope: true, internalDate: true, flags: true, bodyStructure: true },
      { uid: false }
    )) {
      const env = msg.envelope || {};
      const from = (env.from && env.from[0]) || {};
      messages.push({
        uid: msg.uid,
        subject: env.subject || '(sin asunto)',
        fromName: from.name || from.address || 'Desconocido',
        fromAddress: from.address || '',
        date: (env.date || msg.internalDate || null) && new Date(env.date || msg.internalDate).toISOString(),
        seen: (msg.flags && msg.flags.has && msg.flags.has('\\Seen')) || false,
      });
    }
    messages.reverse(); // más recientes primero
    return { mailbox, total, messages };
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Devuelve el cuerpo completo de un mensaje por UID, parseado a texto y HTML.
 * Lo abre en modo solo lectura: NO marca como leído.
 */
export async function getMessage(uid) {
  const id = Number(uid);
  if (!Number.isFinite(id)) {
    const err = new Error('UID inválido');
    err.status = 400;
    throw err;
  }
  const { client, mailbox } = await connect();
  try {
    await client.mailboxOpen(mailbox, { readOnly: true });
    const dl = await client.download(id, undefined, { uid: true });
    if (!dl || !dl.content) {
      const err = new Error('Mensaje no encontrado');
      err.status = 404;
      throw err;
    }
    const parsed = await simpleParser(dl.content);
    return {
      uid: id,
      subject: parsed.subject || '(sin asunto)',
      fromName: parsed.from?.value?.[0]?.name || parsed.from?.text || '',
      fromAddress: parsed.from?.value?.[0]?.address || '',
      date: parsed.date ? parsed.date.toISOString() : null,
      text: parsed.text || '',
      html: parsed.html || '', // ya viene como string sanitizable; el front lo aísla
      preview: snippet(parsed.text),
    };
  } finally {
    await client.logout().catch(() => {});
  }
}
