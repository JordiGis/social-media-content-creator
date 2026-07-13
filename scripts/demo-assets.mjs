#!/usr/bin/env node
// Genera ASSETS DE EJEMPLO (placeholders) para poder renderizar el guion demo sin
// aportar tú ninguna imagen/vídeo. Todo se sintetiza en local con FFmpeg (colores
// planos) y rsvg-convert (avatar SVG -> PNG). No descarga nada.
//
//   pnpm demo            # crea los assets + el guion guiones/001_demo.md
//
// Después:  POCKET_TTS_MOCK=1 pnpm dev   ->  abre el guion demo  ->  ▶ Generar vídeo
//
// Los archivos van a assets/ (que están en .gitignore, así que no se versionan).

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const RSVG = process.env.RSVG_PATH || 'rsvg-convert';

function run(bin, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => reject(new Error(`No se pudo ejecutar ${bin}: ${e.message}`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `${bin} salió con ${code}`))));
    if (input) { child.stdin.write(input); child.stdin.end(); }
  });
}

// Clip de color plano 1080x1920, 4 s, con una etiqueta grande centrada (dibujada
// como imagen fija que FFmpeg superpone; sin drawtext porque el ffmpeg de Homebrew
// no trae freetype).
async function colorClip(dest, color, labelPng) {
  const args = [
    '-y',
    '-f', 'lavfi', '-i', `color=c=${color}:s=1080x1920:d=4:r=30`,
    '-i', labelPng,
    '-filter_complex', '[0:v][1:v]overlay=(W-w)/2:(H-h)/2:format=auto[v]',
    '-map', '[v]', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', dest,
  ];
  await run(FFMPEG, args);
}

// SVG -> PNG con rsvg-convert (lee el SVG por stdin, escribe el PNG a `dest`).
async function svgToPng(svg, dest, width) {
  await run(RSVG, ['-w', String(width), '-o', dest, '/dev/stdin'], svg);
}

const labelSvg = (text, w, h, fg) => `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <text x="50%" y="50%" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(h * 0.22)}"
        font-weight="800" fill="${fg}" text-anchor="middle" dominant-baseline="middle"
        opacity="0.85">${text}</text>
</svg>`;

const avatarSvg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
  <ellipse cx="300" cy="760" rx="150" ry="30" fill="#000" opacity="0.15"/>
  <rect x="170" y="360" width="260" height="360" rx="120" fill="#4f7cff"/>
  <circle cx="300" cy="250" r="150" fill="#ffd9b3"/>
  <circle cx="250" cy="240" r="18" fill="#222"/>
  <circle cx="350" cy="240" r="18" fill="#222"/>
  <path d="M250 310 Q300 350 350 310" stroke="#222" stroke-width="10" fill="none" stroke-linecap="round"/>
  <path d="M150 220 Q300 60 450 220 L450 180 Q300 20 150 180 Z" fill="#3a3a3a"/>
</svg>`;

async function main() {
  const A = path.join(ROOT, 'assets');
  const tmp = path.join(ROOT, 'temp');
  await fs.mkdir(tmp, { recursive: true });

  // Etiquetas para los clips de color.
  const topLabel = path.join(tmp, '_lbl_top.png');
  const fondoLabel = path.join(tmp, '_lbl_fondo.png');
  await svgToPng(labelSvg('VÍDEO SUPERIOR', 1080, 300, '#ffffff'), topLabel, 1080);
  await svgToPng(labelSvg('FONDO', 1080, 300, '#ffffff'), fondoLabel, 1080);

  console.log('▸ Generando avatar de ejemplo…');
  await svgToPng(avatarSvg, path.join(A, 'avatares', 'demo_avatar.png'), 600);

  console.log('▸ Generando vídeo superior de ejemplo…');
  await colorClip(path.join(A, 'inputs_top', 'demo_top.mp4'), '0x1f6feb', topLabel);

  console.log('▸ Generando fondo de ejemplo…');
  await colorClip(path.join(A, 'fondos_matrix', 'demo_fondo.mp4'), '0x0d1117', fondoLabel);

  await fs.rm(topLabel, { force: true });
  await fs.rm(fondoLabel, { force: true });

  console.log('\n✓ Assets de ejemplo listos en assets/.');
  console.log('  Prueba:  POCKET_TTS_MOCK=1 pnpm dev   ->  abre 001_demo  ->  ▶ Generar vídeo');
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
