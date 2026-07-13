// Envío de correo SMTP. Reutiliza las credenciales de mail.config.json (las
// mismas del cliente IMAP de lectura, ver src/mail.js): mismo usuario/contraseña,
// host derivado cambiando el prefijo `imap.` por `smtp.`. Pensado para avisos
// automáticos (p. ej. "vídeo listo en Drive") sin depender de servicios externos.
//
// Si el proveedor no sigue el patrón imap./smtp., define SMTP_HOST / SMTP_PORT
// en .env para forzarlo.

import fs from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { ROOT } from './paths.js';

const MAIL_FILE = path.join(ROOT, 'mail.config.json');

// Lee la config CON contraseña (readMailConfig de src/mail.js la oculta a propósito).
async function readRawMailConfig() {
  try {
    return JSON.parse(await fs.readFile(MAIL_FILE, 'utf8'));
  } catch {
    throw new Error('No hay mail.config.json: configura el correo en Configuración → Correo.');
  }
}

// smtp.<dominio> a partir de imap.<dominio> (patrón habitual de los proveedores).
function smtpHostFrom(imapHost = '') {
  return String(imapHost).replace(/^imap\./i, 'smtp.');
}

/**
 * Envía un correo. Por defecto va del usuario configurado a sí mismo.
 * @param {{to?:string, subject:string, text?:string, html?:string, attachments?:Array}} opts
 */
export async function sendMail({ to, subject, text, html, attachments } = {}) {
  const cfg = await readRawMailConfig();
  if (!cfg.user || !cfg.password) {
    throw new Error('Faltan usuario/contraseña en mail.config.json.');
  }
  const host = process.env.SMTP_HOST || smtpHostFrom(cfg.host);
  const port = Number(process.env.SMTP_PORT) || 465;
  const secure = port === 465; // 465 = SSL directo; 587 = STARTTLS

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user: cfg.user, pass: cfg.password },
  });

  const info = await transporter.sendMail({
    from: cfg.user,
    to: to || cfg.user,
    subject,
    text,
    html,
    attachments,
  });
  return { messageId: info.messageId, accepted: info.accepted, host, from: cfg.user };
}
