#!/usr/bin/env node
// Render por línea de comandos (sin abrir la web): reusa runRender() con un emit
// que vuelca el progreso a la consola. Útil para generar varios guiones de tirón.
//
// Uso:
//   pnpm render 006_sonnet5_rebaja 007_fin_control_exportacion
//   POCKET_TTS_MOCK=1 pnpm render 006_sonnet5_rebaja   # sin cargar el modelo (tono)

import path from 'node:path';
import { safeScriptName } from '../src/scripts.js';
import { runRender } from '../src/render.js';
import { config } from '../src/config.js';
import { OUTPUTS_DIR } from '../src/paths.js';
import { uploadToDrive } from '../src/drive.js';
import { writeVideoMeta } from '../src/videometa.js';

const names = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (!names.length) {
  console.error('Uso: pnpm render <guion> [<guion>…]  (sin .md)');
  process.exit(1);
}

let child = null;
const registerChild = (c) => { child = c; };
// Al cortar (Ctrl-C), mata el ffmpeg/python vivo para no dejar procesos colgados.
process.on('SIGINT', () => { if (child) child.kill('SIGKILL'); process.exit(130); });

let lastOutput = null; // nombre del mp4 del último render (para subir a Drive)

// Vuelca los eventos SSE de runRender a la consola de forma legible.
function emit(ev) {
  if (ev.type === 'progress') process.stdout.write(`\r  ${ev.percent}%   `);
  else if (ev.type === 'log') process.stdout.write(ev.line.endsWith('\n') ? ev.line : ev.line + '\n');
  else if (ev.type === 'segment') console.log(`  · plano ${ev.index}/${ev.total} (${ev.stage}) ${ev.nombre || ''}`);
  else if (ev.type === 'stage') console.log(`— ${ev.message || ev.stage}`);
  else if (ev.type === 'done') { lastOutput = ev.output; console.log(`\n✓ ${ev.output}  -> ${ev.url}`); }
  else if (ev.type === 'error') console.log(`\n✗ ${ev.message}`);
}

// Sube el mp4 recién generado a Drive si DRIVE_AUTO está activo (no rompe el
// render si la subida falla: solo avisa).
async function autoUpload() {
  if (!config.drive.auto || !lastOutput) return;
  const file = path.join(OUTPUTS_DIR, lastOutput);
  console.log(`— Subiendo a Drive (${config.drive.remote}:${config.drive.folder})…`);
  try {
    const dest = await uploadToDrive(file, { onLog: (l) => process.stdout.write(`\r  ${l}   `) });
    console.log(`\n  ↑ ${dest}`);
    // .txt con título + descripción (mismo nombre) para copiar al publicar.
    const txt = await writeVideoMeta(lastOutput);
    if (txt) {
      await uploadToDrive(txt);
      console.log(`  ↑ ${path.basename(txt)}`);
    }
  } catch (e) {
    console.log(`\n  ✗ Drive: ${e.message}`);
  }
}

let fail = 0;
for (const name of names) {
  let file;
  try {
    file = safeScriptName(name.endsWith('.md') ? name : `${name}.md`);
  } catch (e) {
    console.log(`✗ ${name}: ${e.message}`);
    fail++;
    continue;
  }
  console.log(`\n======== ${file} ========`);
  lastOutput = null;
  try {
    await runRender(file, emit, registerChild);
    await autoUpload();
  } catch (e) {
    console.log(`\n✗ ${file}: ${e.message}`);
    fail++;
  }
}
console.log(`\nHecho. ${names.length - fail}/${names.length} renderizados.`);
process.exit(fail ? 1 : 0);
