#!/usr/bin/env node
// Sube vídeos finales a Google Drive vía rclone (src/drive.js). Sin argumentos
// sube todos los outputs/*.mp4; o pásale nombres/rutas concretos.
//
// Requiere configurar el remote una sola vez:
//   rclone config          # crea un remote tipo "drive" (autoriza en el navegador)
// Ajusta remote/carpeta con DRIVE_REMOTE / DRIVE_FOLDER en .env.
//
// Uso:
//   pnpm subir                       # todos los outputs/*.mp4
//   pnpm subir 008_fable5_prompts    # solo ese (con o sin .mp4)
//   pnpm subir outputs/006_sonnet5_rebaja.mp4

import fs from 'node:fs/promises';
import path from 'node:path';
import { OUTPUTS_DIR } from '../src/paths.js';
import { driveConfigured, uploadToDrive } from '../src/drive.js';
import { writeVideoMeta } from '../src/videometa.js';
import { config } from '../src/config.js';

// Resuelve un argumento a una ruta de mp4 dentro de outputs/ (acepta ruta, nombre
// con o sin .mp4). Sanea contra traversal con basename.
function resolveOutput(arg) {
  if (arg.includes('/') || arg.endsWith('.mp4')) {
    const p = path.isAbsolute(arg) ? arg : path.join(process.cwd(), arg);
    return p.endsWith('.mp4') ? p : `${p}.mp4`;
  }
  return path.join(OUTPUTS_DIR, `${path.basename(arg)}.mp4`);
}

async function listAllOutputs() {
  const files = await fs.readdir(OUTPUTS_DIR).catch(() => []);
  return files.filter((f) => f.endsWith('.mp4')).map((f) => path.join(OUTPUTS_DIR, f));
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const targets = args.length ? args.map(resolveOutput) : await listAllOutputs();

  if (!targets.length) {
    console.log('No hay vídeos en outputs/.');
    return;
  }
  if (!(await driveConfigured())) {
    console.error(
      `✗ Remote «${config.drive.remote}» no configurado.\n` +
      `  Ejecútalo una vez (autoriza en el navegador):\n    rclone config\n` +
      `  Crea un remote tipo "drive". Cambia el nombre con DRIVE_REMOTE si usas otro.`
    );
    process.exit(1);
  }

  let ok = 0;
  let fail = 0;
  for (const file of targets) {
    const name = path.basename(file);
    try {
      await fs.access(file);
    } catch {
      console.log(`✗ ${name}: no existe`);
      fail++;
      continue;
    }
    process.stdout.write(`↑ ${name} … `);
    try {
      const dest = await uploadToDrive(file);
      console.log(`✓ ${dest}`);
      ok++;
      // .txt con título + descripción (mismo nombre) para copiar al publicar.
      const txt = await writeVideoMeta(name);
      if (txt) {
        await uploadToDrive(txt);
        console.log(`  ↑ ${path.basename(txt)} ✓`);
      }
    } catch (e) {
      console.log(`✗ ${e.message}`);
      fail++;
    }
  }
  console.log(`\nHecho. ${ok} subidos, ${fail} fallidos.`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
