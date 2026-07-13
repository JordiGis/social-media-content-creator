import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { config } from './config.js';

/**
 * Subtítulos automáticos: trocea el texto del plano, reparte cada trozo sobre la
 * duración de la voz, y rasteriza cada trozo a un PNG transparente (SVG ->
 * rsvg-convert) listo para superponer con FFmpeg (`overlay ... enable=...`).
 *
 * El estilo es GLOBAL (config.subtitle); la caja del elemento `subtitle` de la
 * disposición decide DÓNDE y con qué ancho se pinta (centra + ajusta líneas).
 */

const SENTENCE_END = /[.!?…:]$/;

/**
 * Parte el texto en trozos de ~maxWords palabras. Corta antes si la palabra
 * cierra frase (. ! ? … :), para que un trozo no mezcle dos frases.
 */
export function splitSubtitle(text, maxWords = 4) {
  const words = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const n = Math.max(1, Math.floor(maxWords) || 1);
  const chunks = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length >= n || SENTENCE_END.test(w)) {
      chunks.push(cur.join(' '));
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur.join(' '));
  return chunks;
}

/**
 * Trozos con tiempo: cada uno ocupa una fracción de `duration` proporcional a su
 * nº de caracteres (las frases largas se ven más rato). Devuelve
 * [{ text, start, end }] en segundos sobre la duración de la voz del plano.
 */
export function buildChunks(text, duration, maxWords = 4) {
  const pieces = splitSubtitle(text, maxWords);
  if (!pieces.length || !(duration > 0)) return [];
  const lens = pieces.map((p) => Math.max(1, p.length));
  const totalC = lens.reduce((a, b) => a + b, 0);
  let acc = 0;
  return pieces.map((txt, i) => {
    const start = (acc / totalC) * duration;
    acc += lens[i];
    const end = (acc / totalC) * duration;
    return { text: txt, start, end };
  });
}

const xmlEsc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Ajusta el texto a varias líneas que quepan en `boxW`, estimando el ancho de
 * carácter (≈ 0.52·fontSize para una fuente sans). No mide con precisión (no hay
 * acceso a métricas), pero evita que un trozo largo se salga de la caja.
 */
function wrapLines(text, boxW, fontSize) {
  const maxChars = Math.max(1, Math.floor(boxW / (fontSize * 0.52)));
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const cand = line ? `${line} ${w}` : w;
    if (cand.length > maxChars && line) {
      lines.push(line);
      line = w;
    } else {
      line = cand;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** SVG de un trozo: texto centrado en la caja, con contorno (paint-order). */
function chunkSvg(text, box, canvas) {
  const s = config.subtitle;
  const txt = s.uppercase ? String(text).toUpperCase() : String(text);
  const lines = wrapLines(txt, box.w, s.fontSize);
  const lh = s.fontSize * s.lineHeight;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  // Centro vertical del bloque en cy; baseline ≈ centro de línea + 0.35·fontSize.
  const firstCenter = cy - ((lines.length - 1) * lh) / 2;
  const tspans = lines
    .map((ln, i) => {
      const y = (firstCenter + i * lh + s.fontSize * 0.35).toFixed(1);
      return `<tspan x="${cx.toFixed(1)}" y="${y}">${xmlEsc(ln)}</tspan>`;
    })
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.w}" height="${canvas.h}">` +
    `<text text-anchor="middle" font-family="${xmlEsc(s.fontFamily)}" ` +
    `font-size="${s.fontSize}" font-weight="${s.weight}" fill="${s.color}" ` +
    `stroke="${s.strokeColor}" stroke-width="${s.strokeWidth}" paint-order="stroke" ` +
    `style="stroke-linejoin:round;stroke-linecap:round">${tspans}</text></svg>`
  );
}

function runRsvg(svgPath, pngPath, canvas) {
  return new Promise((resolve, reject) => {
    const args = ['-w', String(canvas.w), '-h', String(canvas.h), svgPath, '-o', pngPath];
    let child;
    try {
      child = spawn(config.subtitle.rsvgBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      reject(new Error(`No se pudo iniciar rsvg-convert: ${err.message}`));
      return;
    }
    let err = '';
    child.stderr.on('data', (c) => (err += c.toString()));
    child.on('error', (e) => {
      reject(
        e.code === 'ENOENT'
          ? new Error(
              `No se encontró "rsvg-convert" (subtítulos). Instálalo con: brew install librsvg`
            )
          : new Error(`Error de rsvg-convert: ${e.message}`)
      );
    });
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`rsvg-convert salió con código ${code}. ${err}`))
    );
  });
}

/**
 * Rasteriza los trozos a PNG transparentes (tamaño lienzo completo: el texto va
 * ya colocado dentro vía la caja, así el overlay siempre es en 0,0).
 *   chunks      -> [{ text, start, end }] (de buildChunks)
 *   box         -> caja {x,y,w,h} del elemento subtitle (posición/ancho)
 *   canvas      -> {w,h}
 *   outPrefix   -> ruta base; cada trozo escribe `${outPrefix}_subK.svg|.png`
 * Devuelve los chunks anotados con `png` (ruta absoluta del PNG).
 */
export async function renderSubtitleImages(chunks, box, canvas, outPrefix) {
  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    const svgPath = `${outPrefix}_sub${i}.svg`;
    const pngPath = `${outPrefix}_sub${i}.png`;
    await fs.writeFile(svgPath, chunkSvg(chunks[i].text, box, canvas), 'utf8');
    await runRsvg(svgPath, pngPath, canvas);
    out.push({ ...chunks[i], png: pngPath });
  }
  return out;
}
