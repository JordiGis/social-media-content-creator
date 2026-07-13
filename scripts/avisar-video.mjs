#!/usr/bin/env node
// Tras renderizar: sube el vídeo (+ su .txt de descripción) a Drive, obtiene los
// enlaces compartibles y envía un correo de aviso (del correo configurado a sí
// mismo por defecto) con la descripción lista para copiar y los enlaces.
//
// Uso:
//   node scripts/avisar-video.mjs 009_gemini_gratis           # a sí mismo
//   node scripts/avisar-video.mjs 009_gemini_gratis dest@x.com

import fs from 'node:fs/promises';
import path from 'node:path';
import { OUTPUTS_DIR } from '../src/paths.js';
import { uploadToDrive, driveLink, driveConfigured } from '../src/drive.js';
import { writeVideoMeta } from '../src/videometa.js';
import { sendMail } from '../src/smtpmail.js';

const [rawName, to] = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (!rawName) {
  console.error('Uso: node scripts/avisar-video.mjs <guion> [destinatario]');
  process.exit(1);
}
const base = path.basename(rawName).replace(/\.(mp4|md)$/i, '');
const mp4 = path.join(OUTPUTS_DIR, `${base}.mp4`);

async function main() {
  await fs.access(mp4).catch(() => {
    throw new Error(`No existe outputs/${base}.mp4 (¿renderizaste primero?)`);
  });
  if (!(await driveConfigured())) throw new Error('Remote de Drive no configurado (rclone config).');

  // 1) Vídeo a Drive + enlace.
  console.log(`↑ Subiendo ${base}.mp4 a Drive…`);
  await uploadToDrive(mp4, { onLog: (l) => process.stdout.write(`\r  ${l}   `) });
  const linkMp4 = await driveLink(`${base}.mp4`);
  console.log(`\n  ✓ ${linkMp4}`);

  // 2) .txt de descripción (título + hashtags) a Drive + enlace.
  const txtPath = await writeVideoMeta(`${base}.mp4`);
  let linkTxt = '';
  let descripcion = '';
  if (txtPath) {
    descripcion = await fs.readFile(txtPath, 'utf8');
    await uploadToDrive(txtPath);
    linkTxt = await driveLink(path.basename(txtPath));
    console.log(`  ✓ ${path.basename(txtPath)}: ${linkTxt}`);
  }

  // 3) Correo de aviso.
  const subject = `🎬 Vídeo listo en Drive: ${base}`;
  const text = [
    `El vídeo "${base}" ya está renderizado y subido a Google Drive.`,
    '',
    `▶️ Vídeo:  ${linkMp4}`,
    linkTxt ? `📝 Descripción (.txt):  ${linkTxt}` : '',
    '',
    '— Descripción para copiar al publicar —',
    '',
    descripcion.trim() || '(sin descripción)',
  ].filter((l) => l !== undefined).join('\n');

  console.log('✉️  Enviando correo…');
  const res = await sendMail({ to, subject, text });
  console.log(`  ✓ Enviado desde ${res.from} a ${res.accepted?.join(', ') || to || res.from} (${res.host})`);
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
