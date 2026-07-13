// Subida de archivos a Google Drive vía rclone. rclone gestiona el OAuth de Drive
// y refresca el token solo, así que una vez configurado el remote (rclone config)
// la subida es totalmente automática, sin navegador ni intervención.
//
// Config en src/config.js -> config.drive (remote, folder, auto, rcloneBin).
// El remote se crea una sola vez con `rclone config` (tipo: drive).

import { spawn } from 'node:child_process';
import path from 'node:path';
import { config } from './config.js';

const { rcloneBin, remote, folder } = config.drive;

// Ejecuta rclone y resuelve con el stdout; rechaza con stderr si sale != 0.
function runRclone(args, { onLog } = {}) {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    let child;
    try {
      child = spawn(rcloneBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      reject(new Error(`No se pudo ejecutar rclone: ${e.message}`));
      return;
    }
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => {
      const s = String(d);
      err += s;
      if (onLog) s.split(/\r?\n/).forEach((l) => l.trim() && onLog(l.trim()));
    });
    child.on('error', (e) => reject(new Error(`No se pudo ejecutar rclone: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim() || `rclone salió con código ${code}`));
    });
  });
}

/** ¿Está el remote de Drive configurado? (evita subir a ciegas). */
export async function driveConfigured() {
  try {
    const remotes = (await runRclone(['listremotes'])).split(/\r?\n/).map((r) => r.replace(/:$/, ''));
    return remotes.includes(remote);
  } catch {
    return false;
  }
}

/**
 * Sube un archivo a `remote:folder` conservando el nombre. Con onProgress recibe
 * las líneas de progreso de rclone. Lanza si el remote no está configurado.
 */
export async function uploadToDrive(filePath, { onLog } = {}) {
  if (!(await driveConfigured())) {
    throw new Error(
      `Remote «${remote}» no configurado. Ejecuta una vez: rclone config  (tipo: drive)`
    );
  }
  const dest = `${remote}:${folder}`;
  // copy conserva el nombre del archivo dentro de la carpeta destino.
  await runRclone(['copy', filePath, dest, '--progress', '--stats-one-line', '--stats=2s'], { onLog });
  return `${dest}/${path.basename(filePath)}`;
}

/**
 * Devuelve un enlace público (compartible) de un archivo ya subido a Drive.
 * `nameOrPath` puede ser el nombre del archivo (se busca en la carpeta destino)
 * o una ruta remota completa `remote:folder/archivo`. rclone crea/reutiliza el
 * enlace de "cualquiera con el enlace puede ver".
 */
export async function driveLink(nameOrPath) {
  const remotePath = nameOrPath.includes(':')
    ? nameOrPath
    : `${remote}:${folder}/${path.basename(nameOrPath)}`;
  return (await runRclone(['link', remotePath])).trim();
}
