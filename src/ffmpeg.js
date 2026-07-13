import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { TEMP_DIR } from './paths.js';

// Índice de entrada FFmpeg fijo por rol respaldado por el plano.
//   0: vídeo top · 1: fondo · 2: avatar · 3: voz · 4..: imágenes flotantes.
const ROLE_INPUT = { top: 0, fondo: 1, avatar: 2 };

/**
 * Construye el -filter_complex a partir de una plantilla de disposición.
 * La plantilla coloca cada elemento en una caja libre {x,y,w,h} sobre el lienzo
 * (1080×1920). Todo elemento (vídeo o imagen) se estira a su caja exacta: rellena
 * {w,h} sin recortar ni dejar hueco, aplastando la relación de aspecto si hace
 * falta. Con `bounce` el elemento flota en Y (senoidal) como el avatar clásico.
 *
 * `elements` ya viene anotado con `input` (índice de entrada FFmpeg). El primero
 * del array queda al fondo; el último, encima (orden de capas).
 *
 * `subtitle` (opcional) = { chunks: [{ start, end }], baseInput } describe los
 * PNGs de subtítulo ya añadidos como entradas (índices baseInput..). El elemento
 * de rol `subtitle` superpone cada trozo en su ventana de tiempo (enable).
 */
export function buildFilter(elements, canvas, subtitle = null) {
  const { fps } = config.ffmpeg;
  const { bounceAmplitude: amp, bounceFreq: freq } = config.avatar;

  const parts = [];
  // Lienzo base negro: cubre los huecos que no pinte ningún elemento.
  parts.push(`color=c=black:s=${canvas.w}x${canvas.h}:r=${fps}[base]`);

  if (!elements.length) {
    parts.push('[base]null[outv]');
    return parts.join(';');
  }

  let prev = 'base';
  let subtitleDone = false; // solo el primer elemento `subtitle` pinta los trozos
  elements.forEach((el, i) => {
    const out = i === elements.length - 1 ? 'outv' : `tmp${i}`;

    // --- Subtítulo: superpone cada PNG de trozo en su ventana [start,end].
    if (el.role === 'subtitle') {
      const chunks = !subtitleDone ? subtitle?.chunks : null;
      subtitleDone = true;
      // La caja del propio elemento define el recorrido de la cortina (wipe).
      parts.push(
        subtitleFilter(chunks, subtitle?.baseInput, prev, out, el, subtitle?.reveal)
      );
      prev = out;
      return;
    }

    // --- Efecto: no tiene entrada propia; reprocesa la zona ya compuesta debajo.
    if (el.role === 'efecto') {
      parts.push(effectFilter(el, i, prev, out, fps, canvas));
      prev = out;
      return;
    }

    const lbl = `el${i}`;
    // Ajuste a la caja: 'estirar' rellena {w,h} deformando; 'recortar' (cover)
    // escala manteniendo proporción y recorta lo que sobra según `pos`.
    parts.push(`[${el.input}:v]${fitChain(el, fps)}[${lbl}]`);

    // La caja queda exactamente rellena; rebote opcional en Y (irregular).
    const x = String(el.x);
    const y = el.bounce ? bounceExpr(el.y, amp, freq, i) : String(el.y);
    const ev = el.bounce ? ':eval=frame' : '';
    parts.push(`[${prev}][${lbl}]overlay=x='${x}':y='${y}'${ev}[${out}]`);
    prev = out;
  });

  return parts.join(';');
}

// Esquina superior-izquierda del recorte (cover) según `pos`. Tras escalar con
// force_original_aspect_ratio=increase, la imagen es >= caja; se recorta {w,h}.
const CROP_XY = {
  centro: '(in_w-out_w)/2:(in_h-out_h)/2',
  arriba: '(in_w-out_w)/2:0',
  abajo: '(in_w-out_w)/2:in_h-out_h',
  izquierda: '0:(in_h-out_h)/2',
  derecha: 'in_w-out_w:(in_h-out_h)/2',
};

/** Cadena de escalado de un elemento visual a su caja: 'estirar' o 'recortar'. */
function fitChain(el, fps) {
  if (el.fit === 'recortar') {
    const xy = CROP_XY[el.pos] || CROP_XY.centro;
    return (
      `scale=${el.w}:${el.h}:force_original_aspect_ratio=increase,` +
      `crop=${el.w}:${el.h}:${xy},setsar=1,fps=${fps}`
    );
  }
  return `scale=${el.w}:${el.h},setsar=1,fps=${fps}`;
}

/**
 * Expresión Y del rebote IRREGULAR de un elemento flotante.
 * En vez de un único seno (rebote mecánico y perfectamente periódico), se suman
 * tres senos con frecuencias inconmensurables (1, 2.13, 0.47×) → el movimiento
 * no se repite a simple vista y parece orgánico. El desfase depende del índice
 * del elemento (`i`), así dos avatares/imágenes no rebotan sincronizados.
 * Los pesos suman ~1, de modo que la amplitud máxima sigue siendo ≈ amp.
 */
function bounceExpr(baseY, amp, freq, i) {
  const ph = i * 1.7; // desfase propio del elemento
  const w = 2 * Math.PI * freq; // pulsación base
  const term = (mult, weight, dph) =>
    `${weight}*sin(${(w * mult).toFixed(6)}*t + ${(ph + dph).toFixed(3)})`;
  const wobble =
    `${term(1, 0.6, 0)} + ${term(2.13, 0.27, 1.1)} + ${term(0.47, 0.18, 2.3)}`;
  return `${baseY} + ${amp}*(${wobble})`;
}

/**
 * Sub-filtro del rol `subtitle`. Cada trozo es un PNG a lienzo completo (entrada
 * baseInput+k) con el texto ya colocado: se superpone en 0,0 solo durante su
 * ventana [start,end] (overlay soporta `enable`). Sin trozos -> pasa la capa tal cual.
 *
 * Con `reveal === 'wipe'` el trozo se "escribe": una cortina recorre la caja de
 * izquierda a derecha durante su ventana. Se hace con `geq` sobre el canal alfa
 * (alfa=0 a la derecha del borde móvil), sin metrics de glifo: el borde va de
 * box.x a box.x+box.w proporcional al tiempo dentro de [start,end].
 */
function subtitleFilter(chunks, baseInput, prev, out, box, reveal) {
  if (!chunks?.length || baseInput == null) return `[${prev}]null[${out}]`;
  const wipe = reveal === 'wipe' && box && box.w > 0;
  const steps = [];
  let p = prev;
  chunks.forEach((c, k) => {
    const o = k === chunks.length - 1 ? out : `su${k}`;
    const enable = `enable='between(t,${c.start.toFixed(3)},${c.end.toFixed(3)})'`;
    // La cortina termina en wipeEnd (deja el texto fijo hasta `end` = margen de
    // lectura). Sin wipeEnd, recorre toda la ventana.
    const wipeEnd = c.wipeEnd != null ? c.wipeEnd : c.end;
    const dur = wipeEnd - c.start;
    let src = `${baseInput + k}:v`;
    if (wipe && dur > 0) {
      // Borde móvil: x0 -> x1 según el tiempo del trozo (clampeado a [0,1]).
      const prog = `min(1,max(0,(T-${c.start.toFixed(3)})/${dur.toFixed(3)}))`; // dur = wipeEnd-start
      const edge = `${box.x}+${box.w}*${prog}`;
      const mk = `mk${k}`;
      steps.push(
        `[${baseInput + k}:v]format=rgba,` +
          `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(X,${edge}),alpha(X,Y),0)'[${mk}]`
      );
      src = mk;
    }
    steps.push(`[${p}][${src}]overlay=0:0:${enable}[${o}]`);
    p = o;
  });
  return steps.join(';');
}

// Intensidad por defecto de cada efecto (0–100 en la UI).
const EFFECT_DEFAULT = { blur: 25, oscurecer: 45, aclarar: 35, pixelar: 18 };

/**
 * Construye el sub-filtro de un elemento `efecto`. Toma la capa ya compuesta
 * (`prev`), aplica el efecto SOLO en la caja {x,y,w,h} y devuelve `out`.
 *   blur / pixelar -> recorta la zona, la procesa y la vuelve a pegar encima.
 *   oscurecer / aclarar -> superpone un velo de color semitransparente.
 */
function effectFilter(el, i, prev, out, fps, canvas) {
  const fx = `fx${i}`;
  const amt = Number.isFinite(+el.amount) && +el.amount > 0
    ? +el.amount
    : EFFECT_DEFAULT[el.effect] ?? 25;

  // La caja puede salirse del lienzo: se recorta a la parte visible (intersección
  // con el lienzo). `crop` exige un rectángulo dentro del frame; `overlay` no.
  const cx = Math.max(0, el.x);
  const cy = Math.max(0, el.y);
  const cw = Math.min(canvas.w, el.x + el.w) - cx;
  const ch = Math.min(canvas.h, el.y + el.h) - cy;

  if (el.effect === 'oscurecer' || el.effect === 'aclarar') {
    const base = el.effect === 'oscurecer' ? 'black' : 'white';
    const a = Math.max(0, Math.min(1, amt / 100)).toFixed(3);
    // overlay recorta solo; se usa la caja completa con su x/y (negativo incluido).
    return (
      `color=c=${base}@${a}:s=${el.w}x${el.h}:r=${fps}[${fx}];` +
      `[${prev}][${fx}]overlay=x=${el.x}:y=${el.y}[${out}]`
    );
  }

  // Fuera del lienzo del todo: no hay nada que difuminar/pixelar, se deja pasar.
  if (cw <= 0 || ch <= 0) return `[${prev}]null[${out}]`;

  // blur / pixelar: hay que duplicar la capa (split) para conservar el fondo
  // intacto fuera de la caja y reescribir solo la región procesada (ya recortada).
  const bg = `bg${i}`;
  const reg = `rg${i}`;
  let chain;
  if (el.effect === 'pixelar') {
    const f = Math.max(2, Math.round(amt)); // factor de bloque
    chain =
      `crop=${cw}:${ch}:${cx}:${cy},` +
      `scale=ceil(${cw}/${f}):ceil(${ch}/${f}):flags=neighbor,` +
      `scale=${cw}:${ch}:flags=neighbor`;
  } else {
    // blur (por defecto). boxblur exige radio < min(w,h)/2.
    const rMax = Math.max(1, Math.floor(Math.min(cw, ch) / 2) - 1);
    const r = Math.max(1, Math.min(Math.round(amt), rMax));
    chain = `crop=${cw}:${ch}:${cx}:${cy},boxblur=${r}:1`;
  }
  return (
    `[${prev}]split=2[${bg}][${reg}];` +
    `[${reg}]${chain}[${fx}];` +
    `[${bg}][${fx}]overlay=x=${cx}:y=${cy}[${out}]`
  );
}

/**
 * Anota los elementos de una plantilla con su índice de entrada FFmpeg y resuelve
 * la ruta de las imágenes flotantes. Devuelve { elements, imagePaths } donde
 * imagePaths son las entradas extra (-loop 1 -i …) en el orden de aparición.
 *   resolveImage(src) -> ruta absoluta de la imagen flotante (o null si falta).
 */
export function planTemplate(template, resolveImage) {
  const elements = [];
  const imagePaths = [];
  for (const el of template.elements || []) {
    if (el.role === 'efecto' || el.role === 'subtitle') {
      // efecto: opera sobre lo compuesto debajo · subtitle: supone PNGs aparte.
      elements.push({ ...el }); // sin input propio
    } else if (el.role === 'imagen') {
      const full = resolveImage?.(el.src);
      if (!full) continue; // imagen flotante sin archivo: se omite
      const input = 4 + imagePaths.length;
      imagePaths.push(full);
      elements.push({ ...el, input });
    } else {
      const input = ROLE_INPUT[el.role];
      if (input == null) continue;
      elements.push({ ...el, input });
    }
  }
  return { elements, imagePaths };
}

/**
 * Compone el vídeo final 1080x1920.
 * Devuelve una Promise que resuelve con { output } o rechaza con Error.
 * onSpawn(child) se llama al arrancar el proceso (para poder cancelarlo).
 */
export function composeVideo({
  topVideo,
  bgVideo,
  avatar,
  audio,
  output,
  duration,
  elements,
  imagePaths = [],
  subtitleChunks = [],
  subtitleReveal,
  canvas,
  onLog,
  onProgress,
  onSpawn,
}) {
  return new Promise((resolve, reject) => {
    // Entradas extra de subtítulo: un PNG (lienzo completo) por trozo, tras las
    // imágenes flotantes. Su índice de entrada empieza en 4 + nº de imágenes.
    const subBaseInput = 4 + imagePaths.length;
    const subtitle = subtitleChunks.length
      ? {
          chunks: subtitleChunks,
          baseInput: subBaseInput,
          reveal: subtitleReveal ?? config.subtitle.reveal,
        }
      : null;
    const filter = buildFilter(elements, canvas, subtitle);
    // Cola tras la voz: el plano dura voz + cola; la imagen sigue (avatar flota,
    // vídeos en bucle) y el audio se rellena con silencio (apad) hasta el final,
    // de modo que el corte al siguiente plano no sea repentino.
    const tail = Math.max(0, config.ffmpeg.tailPadding || 0);
    const clipLen = duration + tail;
    const imageInputs = imagePaths.flatMap((p) => ['-loop', '1', '-i', p]); // 4..
    // PNGs de subtítulo (uno por trozo), tras las imágenes flotantes.
    const subtitleInputs = subtitleChunks.flatMap((c) => ['-loop', '1', '-i', c.png]);
    // Entrada 3 = audio. Plano con voz: el WAV (apad rellena el rabillo de cola).
    // Plano "mudo" (solo duración): silencio infinito (anullsrc), lo corta -t.
    const audioInput = audio
      ? ['-i', audio]
      : ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo'];
    const args = [
      '-y',
      '-stream_loop', '-1', '-i', topVideo, // 0: vídeo superior en bucle
      '-stream_loop', '-1', '-i', bgVideo, //  1: fondo en bucle
      '-loop', '1', '-i', avatar, //           2: avatar (imagen fija)
      ...audioInput, //                        3: voz en off | silencio
      ...imageInputs, //                       4..: imágenes flotantes (fijas)
      ...subtitleInputs, //                     …: PNGs de subtítulo (uno por trozo)
      '-filter_complex', filter,
      '-map', '[outv]',
      '-map', '3:a',
      ...(audio ? ['-af', 'apad'] : []), // apad solo con voz real
      '-t', clipLen.toFixed(3), // voz + cola (no se usa -shortest: lo marca -t)
      '-r', String(config.ffmpeg.fps),
      '-c:v', 'libx264',
      '-preset', config.ffmpeg.preset,
      '-crf', String(config.ffmpeg.crf),
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '44100', // audio uniforme (stereo 44.1k) en TODOS los clips: así
      '-ac', '2', //     concat/mezcla no tienen que rematrixar canales dispares
      '-movflags', '+faststart',
      output,
    ];

    onLog?.(`$ ${config.ffmpeg.bin} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}\n`);

    let child;
    try {
      child = spawn(config.ffmpeg.bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(new Error(`No se pudo iniciar FFmpeg: ${err.message}`));
      return;
    }
    onSpawn?.(child);

    let stderrTail = '';
    const timeRe = /time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;

    child.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      stderrTail = (stderrTail + s).slice(-4000);
      onLog?.(s);
      const m = s.match(timeRe);
      if (m && duration > 0) {
        const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        const pct = Math.max(0, Math.min(100, (secs / duration) * 100));
        onProgress?.(pct);
      }
    });

    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(
          new Error(
            `No se encontró el binario de FFmpeg ("${config.ffmpeg.bin}"). Instálalo con: brew install ffmpeg`
          )
        );
      } else {
        reject(new Error(`Error de FFmpeg: ${err.message}`));
      }
    });

    child.on('close', (code, signal) => {
      if (code === 0) {
        onProgress?.(100);
        resolve({ output });
      } else if (signal) {
        reject(new Error('Render cancelado'));
      } else {
        reject(new Error(`FFmpeg terminó con código ${code}.\n${stderrTail.slice(-800)}`));
      }
    });
  });
}

/** Ejecuta FFmpeg con args genéricos (usado por la concatenación). */
function runFfmpeg(args, { onLog, onProgress, onSpawn, duration } = {}) {
  return new Promise((resolve, reject) => {
    onLog?.(`$ ${config.ffmpeg.bin} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}\n`);
    let child;
    try {
      child = spawn(config.ffmpeg.bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(new Error(`No se pudo iniciar FFmpeg: ${err.message}`));
      return;
    }
    onSpawn?.(child);

    let stderrTail = '';
    const timeRe = /time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;
    child.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      stderrTail = (stderrTail + s).slice(-4000);
      onLog?.(s);
      const m = s.match(timeRe);
      if (m && duration > 0) {
        const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        onProgress?.(Math.max(0, Math.min(100, (secs / duration) * 100)));
      }
    });
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`No se encontró el binario de FFmpeg ("${config.ffmpeg.bin}"). Instálalo con: brew install ffmpeg`));
      } else {
        reject(new Error(`Error de FFmpeg: ${err.message}`));
      }
    });
    child.on('close', (code, signal) => {
      if (code === 0) {
        onProgress?.(100);
        resolve();
      } else if (signal) {
        reject(new Error('Render cancelado'));
      } else {
        reject(new Error(`FFmpeg terminó con código ${code}.\n${stderrTail.slice(-800)}`));
      }
    });
  });
}

/**
 * Concatena varios clips (uno por plano) en el vídeo final usando el demuxer
 * `concat` de FFmpeg. Como todos los clips se codifican con los mismos
 * parámetros, intenta primero `-c copy` (instantáneo) y, si falla, re-codifica.
 */
export async function concatClips(clipPaths, output, { onLog, onProgress, onSpawn, totalDuration } = {}) {
  if (!clipPaths || clipPaths.length === 0) throw new Error('No hay clips para concatenar');
  if (clipPaths.length === 1) {
    await fs.copyFile(clipPaths[0], output);
    onProgress?.(100);
    return { output };
  }

  const base = path.basename(output).replace(/\.[^.]+$/, '');
  const listPath = path.join(TEMP_DIR, `${base}_concat.txt`);
  const listBody = clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n';
  await fs.writeFile(listPath, listBody, 'utf8');

  const inputArgs = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath];
  const copyArgs = [...inputArgs, '-c', 'copy', '-movflags', '+faststart', output];

  try {
    await runFfmpeg(copyArgs, { onLog, onProgress, onSpawn, duration: totalDuration });
    return { output };
  } catch (err) {
    onLog?.(`\n[concat] "-c copy" falló (${err.message}). Reintentando con re-codificación…\n`);
    const reArgs = [
      ...inputArgs,
      '-c:v', 'libx264',
      '-preset', config.ffmpeg.preset,
      '-crf', String(config.ffmpeg.crf),
      '-pix_fmt', 'yuv420p',
      '-r', String(config.ffmpeg.fps),
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '44100',
      '-ac', '2',
      '-movflags', '+faststart',
      output,
    ];
    await runFfmpeg(reArgs, { onLog, onProgress, onSpawn, duration: totalDuration });
    return { output };
  }
}

/**
 * Mezcla música de fondo bajo la voz del vídeo ya montado.
 *   videoIn  -> vídeo con la voz en off (se copia el vídeo, sin recodificar)
 *   runs     -> [{ file, startSec, lenSec, volume? }] tramos de música. Un tramo
 *               puede abarcar varios planos (música continua); cambiar de pista
 *               o silenciar genera tramos distintos.
 *
 * Cada pista entra/sale con un fundido y se retrasa hasta su inicio (adelay).
 * Todas se mezclan con la voz vía amix (normalize=0: respeta los volúmenes).
 * Si una pista es más corta que su tramo, se repite en bucle (-stream_loop).
 */
export async function mixMusic(videoIn, runs, output, { onLog, onProgress, onSpawn, totalDuration } = {}) {
  if (!runs || runs.length === 0) {
    await fs.copyFile(videoIn, output);
    onProgress?.(100);
    return { output };
  }

  const { volume: defVol, fade } = config.music;
  const inputs = ['-y', '-i', videoIn];
  const chains = [];
  const labels = [];

  runs.forEach((run, i) => {
    inputs.push('-stream_loop', '-1', '-i', run.file);
    const idx = i + 1; // 0 es el vídeo con la voz
    const len = Math.max(0, run.lenSec);
    const fd = Math.max(0, Math.min(fade, len / 2));
    const startMs = Math.round(Math.max(0, run.startSec) * 1000);
    const vol = run.volume == null ? defVol : run.volume;
    const steps = [
      // Uniforma la pista a stereo 44.1k: amix exige el mismo layout en todas las
      // ramas (si no, intenta rematrixar y falla con canales dispares).
      `[${idx}:a]aformat=sample_rates=44100:channel_layouts=stereo`,
      `atrim=0:${len.toFixed(3)}`,
      `asetpts=PTS-STARTPTS`,
      fd > 0 ? `afade=t=in:st=0:d=${fd.toFixed(3)}` : null,
      fd > 0 ? `afade=t=out:st=${(len - fd).toFixed(3)}:d=${fd.toFixed(3)}` : null,
      `volume=${vol}`,
      startMs > 0 ? `adelay=${startMs}|${startMs}` : null,
    ].filter(Boolean);
    chains.push(`${steps.join(',')}[m${i}]`);
    labels.push(`[m${i}]`);
  });

  // La voz también se uniforma a stereo 44.1k antes de mezclar. normalize=0 evita
  // que amix baje el volumen al sumar entradas o cuando una pista termina.
  const voicePre = `[0:a]aformat=sample_rates=44100:channel_layouts=stereo[av]`;
  const filter =
    `${voicePre};${chains.join(';')};[av]${labels.join('')}amix=inputs=${runs.length + 1}:normalize=0:dropout_transition=0[aout]`;

  const args = [
    ...inputs,
    '-filter_complex', filter,
    '-map', '0:v',
    '-map', '[aout]',
    '-c:v', 'copy', // el vídeo no se recodifica: rápido
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    output,
  ];

  await runFfmpeg(args, { onLog, onProgress, onSpawn, duration: totalDuration });
  return { output };
}
