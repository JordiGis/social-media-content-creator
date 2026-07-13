import path from 'node:path';
import fs from 'node:fs/promises';
import { readScript, cleanForTTS } from './scripts.js';
import { parseDuration } from './segments.js';
import { resolveAsset, listAssets } from './assets.js';
import { synthesizeSegments } from './pockettts.js';
import { getAudioDuration } from './audio.js';
import { composeVideo, concatClips, mixMusic, planTemplate } from './ffmpeg.js';
import { buildChunks, renderSubtitleImages } from './subtitles.js';
import { readDefaults } from './defaults.js';
import { readLayouts, CANVAS, DEFAULT_TEMPLATE_ID, BUILTIN_TEMPLATES } from './layouts.js';
import { config } from './config.js';
import {
  AVATARES_DIR,
  IMAGENES_DIR,
  FONDOS_DIR,
  INPUTS_TOP_DIR,
  VOCES_DIR,
  MUSICA_DIR,
  OUTPUTS_DIR,
  TEMP_DIR,
} from './paths.js';

// Valores de `musica` que silencian la pista (en vez de cambiarla).
const MUSIC_STOP = new Set(['none', 'ninguna', 'ninguno', 'silencio', 'off', '-', 'no']);

const rendering = new Set();

export function isRendering(file) {
  return rendering.has(file);
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function requireAsset(dir, filename, label, available) {
  if (!filename) throw new Error(`Falta definir ${label} en el guion`);
  const full = resolveAsset(dir, filename);
  if (!(await fileExists(full))) {
    const list = available.length ? available.join(', ') : '(carpeta vacía)';
    throw new Error(`No se encontró ${label} "${filename}". Disponibles: ${list}`);
  }
  return full;
}

/**
 * Resuelve la voz GLOBAL del guion (no cambia entre planos):
 * archivo de clonación local | nombre de catálogo | URL.
 */
async function resolveVoice(data, assets) {
  const voiceVal = data.archivo_voz_clon || config.pocketTts.defaultVoiceFile;
  if (!voiceVal) {
    if (config.pocketTts.mock) return { voiceRef: '', voiceMode: 'mock' };
    throw new Error(
      'Define "archivo_voz_clon" en el guion (archivo en assets/voces_referencia, ' +
        'nombre de catálogo, o URL) o POCKET_TTS_DEFAULT_VOICE_FILE en .env'
    );
  }
  const candidate = resolveAsset(VOCES_DIR, voiceVal);
  if (candidate && (await fileExists(candidate))) {
    return { voiceRef: candidate, voiceMode: `clonación: ${voiceVal}` };
  }
  if (/^(https?:|hf:)/i.test(voiceVal) || !/\.[A-Za-z0-9]{2,4}$/.test(voiceVal)) {
    return { voiceRef: voiceVal, voiceMode: `catálogo/URL: ${voiceVal}` };
  }
  const list = assets.voces.length ? assets.voces.join(', ') : '(vacío)';
  throw new Error(
    `No se encontró la voz "${voiceVal}" en assets/voces_referencia (${list}). ` +
      'Usa un archivo de audio para clonar, o un nombre de catálogo (alba, giovanni, lola…).'
  );
}

/**
 * Calcula los tramos de música de fondo del guion.
 *
 * Semántica de la directiva `musica` por plano:
 *   - con valor de archivo  -> arranca / cambia a esa pista en ese plano
 *   - "none/silencio/…"     -> corta la música a partir de ese plano
 *   - vacío                 -> CONTINÚA la pista del plano anterior (continua)
 * `musica_default` (front-matter) fija la pista con la que abre el vídeo.
 *
 * Planos contiguos con la misma pista se funden en UN tramo (música continua,
 * sin reiniciar). Devuelve [{ file, name, label, startSec, lenSec }].
 */
async function buildMusicRuns(planned, data, assets, emit) {
  const isStop = (v) => MUSIC_STOP.has(String(v || '').toLowerCase());

  // 1) Pista activa en cada plano (propagando la continuación).
  let current = '';
  const def = String(data.musica_default || '').trim();
  if (def && !isStop(def)) current = def;
  for (const p of planned) {
    const m = (p.musica || '').trim();
    if (m) current = isStop(m) ? '' : m;
    p.track = current;
  }

  // 2) Agrupar planos contiguos con la misma pista en tramos.
  const runs = [];
  let cursor = 0;
  for (const p of planned) {
    const len = p.clipLen;
    if (p.track) {
      const last = runs[runs.length - 1];
      if (last && last.name === p.track && Math.abs(last._end - cursor) < 1e-6) {
        last.lenSec += len;
        last._end += len;
      } else {
        runs.push({ name: p.track, startSec: cursor, lenSec: len, _end: cursor + len });
      }
    }
    cursor += len;
  }

  // 3) Resolver y validar el archivo de cada pista.
  for (const r of runs) {
    r.file = await requireAsset(MUSICA_DIR, r.name, 'la música', assets.musica);
    r.label = r.name;
    delete r._end;
  }

  if (runs.length) {
    emit({
      type: 'log',
      line:
        `Música: ${runs.length} tramo(s) — ` +
        runs.map((r) => `${r.label} (${r.startSec.toFixed(1)}–${(r.startSec + r.lenSec).toFixed(1)}s)`).join(', ') +
        '\n',
    });
  }
  return runs;
}

/**
 * Pipeline completo de un guion con planos (segmentos).
 *   emit(event)        -> eventos de progreso al cliente (SSE)
 *   registerChild(cp)  -> expone el proceso ffmpeg activo para poder cancelarlo
 */
export async function runRender(name, emit, registerChild) {
  const { file, data, segments } = await readScript(name);
  if (rendering.has(file)) throw new Error('Ese guion ya se está renderizando');
  rendering.add(file);

  try {
    emit({ type: 'stage', stage: 'parse', message: `Analizando ${file}…` });

    const assets = await listAssets();
    const { voiceRef, voiceMode } = await resolveVoice(data, assets);

    // Modo de subtítulos (ajuste global, editable en la Biblioteca):
    //   'entero' -> texto del plano entero y fijo · 'flujo' -> troceado + cortina.
    const globalDefaults = await readDefaults();
    const subMode = globalDefaults.subtitulos === 'entero' ? 'entero' : 'flujo';

    // Plantillas de disposición (built-in + custom), indexadas por id.
    const templates = await readLayouts();
    const templatesById = new Map(templates.map((t) => [t.id, t]));

    // Prepara cada plano: texto limpio + assets validados + rutas temporales.
    const base = file.replace(/\.md$/i, '');
    const planned = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const cleanText = cleanForTTS(seg.texto);
      const holdSec = parseDuration(seg.duracion); // duración fija (0 = la marca la voz)
      // Plano sin texto Y sin duración: nada que mostrar, se omite. Con duración
      // se renderiza como plano "mudo" (avatar/top/fondo durante N segundos).
      if (!cleanText && holdSec <= 0) continue;
      const idx = String(planned.length).padStart(3, '0');

      // Plantilla del plano: id guardado -> default -> primera built-in.
      const tpl =
        templatesById.get(seg.layout) ||
        templatesById.get(DEFAULT_TEMPLATE_ID) ||
        BUILTIN_TEMPLATES[0];
      // Valida las imágenes flotantes de la plantilla (una vez por src).
      const imgPaths = new Map();
      for (const el of tpl.elements || []) {
        if (el.role === 'imagen' && el.src && !imgPaths.has(el.src)) {
          imgPaths.set(
            el.src,
            await requireAsset(IMAGENES_DIR, el.src, `la imagen "${el.src}"`, assets.imagenes)
          );
        }
      }
      const { elements, imagePaths } = planTemplate(tpl, (src) => imgPaths.get(src) || null);
      // Caja del subtítulo (si la disposición tiene un elemento `subtitle`): marca
      // dónde y con qué ancho se pinta el texto del plano. Solo la primera cuenta.
      const subtitleBox = elements.find((e) => e.role === 'subtitle') || null;

      planned.push({
        n: planned.length,
        idx, // índice 000.. para nombrar archivos temporales
        nombre: seg.nombre || `Plano ${planned.length + 1}`,
        text: cleanText,
        hasVoice: !!cleanText, // plano "mudo" si no hay texto (solo duración)
        holdSec,
        elements,
        imagePaths,
        subtitleBox,
        canvas: CANVAS[tpl.format] || CANVAS.instagram,
        musica: (seg.musica || '').trim(),
        topVideo: await requireAsset(INPUTS_TOP_DIR, seg.top, 'el vídeo superior', assets.topVideos),
        bgVideo: await requireAsset(FONDOS_DIR, seg.fondo, 'el fondo', assets.fondos),
        avatar: await requireAsset(AVATARES_DIR, seg.avatar, 'el avatar', assets.avatares),
        wav: cleanText ? path.join(TEMP_DIR, `${base}_seg${idx}.wav`) : null,
        clip: path.join(TEMP_DIR, `${base}_seg${idx}.mp4`),
      });
    }
    if (planned.length === 0) {
      throw new Error('El guion no tiene texto para la voz en off en ningún plano');
    }

    const total = planned.length;
    emit({ type: 'log', line: `${total} plano(s) · voz (${voiceMode})\n` });

    const setProgress = (pct) => emit({ type: 'progress', percent: Math.max(0, Math.min(100, pct)) });

    // 1) Voz — batch (el modelo Pocket TTS se carga UNA vez). Solo planos con texto;
    //    los planos "mudos" (solo duración) no pasan por el TTS.
    const voiced = planned.filter((p) => p.hasVoice);
    if (voiced.length) {
      emit({
        type: 'stage',
        stage: 'tts',
        message: config.pocketTts.mock
          ? 'Generando voz (Pocket TTS · modo prueba)…'
          : 'Generando voz con Pocket TTS…',
      });
      await synthesizeSegments(
        voiced.map((p) => ({ text: p.text, output: p.wav })),
        {
          voiceRef,
          manifestPath: path.join(TEMP_DIR, `${base}.manifest.json`),
          onLog: (line) => emit({ type: 'log', line }),
          onItem: ({ index }) => {
            const p = voiced[index];
            if (p) emit({ type: 'segment', index: p.n, total, nombre: p.nombre, stage: 'voz' });
            setProgress(((index + 1) / voiced.length) * 40);
          },
        }
      );
    }

    // 2) Duración de cada plano. clip = voz + cola (config.ffmpeg.tailPadding),
    //    para que el corte entre planos no sea repentino.
    emit({ type: 'stage', stage: 'duration', message: 'Midiendo duración de cada plano…' });
    const tail = Math.max(0, config.ffmpeg.tailPadding || 0);
    let totalDuration = 0;
    for (const p of planned) {
      const voice = p.hasVoice ? await getAudioDuration(p.wav) : 0;
      // El plano dura lo que tarde la voz o la duración fija (la mayor de las dos).
      p.duration = Math.max(voice, p.holdSec);
      p.clipLen = p.duration + tail;
      totalDuration += p.clipLen;

      // Subtítulo: si la disposición tiene caja `subtitle` y el plano tiene texto,
      // se rasteriza a PNG (se superpone luego en el montaje). Según el modo global:
      //   'entero' -> un solo trozo (texto completo), fijo todo el plano.
      //   'flujo'  -> troceado + cortina, con margen de lectura tras cada trozo.
      p.subtitleChunks = [];
      if (p.subtitleBox && p.text && p.duration > 0) {
        let chunks;
        if (subMode === 'entero') {
          chunks = [{ text: p.text, start: 0, end: p.duration + tail }];
        } else {
          chunks = buildChunks(p.text, p.duration, config.subtitle.maxWords);
          if (chunks.length) {
            // Margen de lectura: la cortina acaba en `wipeEnd` (antes del fin de la
            // ventana) y el texto completo se queda fijo el resto. El último trozo
            // sigue visible durante la cola muda del plano (se lee con calma).
            const hold = Math.max(0, config.subtitle.holdSec);
            for (const c of chunks) {
              c.wipeEnd = c.end - Math.min(hold, (c.end - c.start) * 0.6);
            }
            chunks[chunks.length - 1].end = p.duration + tail;
          }
        }
        if (chunks.length) {
          p.subtitleChunks = await renderSubtitleImages(
            chunks,
            p.subtitleBox,
            p.canvas,
            path.join(TEMP_DIR, `${base}_seg${p.idx}`)
          );
        }
      }
    }
    emit({ type: 'duration', seconds: totalDuration });
    emit({ type: 'log', line: `Duración total: ${totalDuration.toFixed(2)} s\n` });

    // Tramos de música de fondo (un tramo puede abarcar varios planos).
    const runs = await buildMusicRuns(planned, data, assets, emit);
    const hasMusic = runs.length > 0;

    const outputPath = path.join(OUTPUTS_DIR, `${base}.mp4`);
    // Vídeo con la voz antes de la música. Si hay música, es un temporal que
    // luego se mezcla hacia outputPath; si no, se escribe ya en el destino.
    const voicePath = hasMusic ? path.join(TEMP_DIR, `${base}_voz.mp4`) : outputPath;

    // 3) Montaje por plano (cada plano = su avatar/top/fondo/layout).
    emit({ type: 'stage', stage: 'ffmpeg', message: 'Componiendo cada plano (1080×1920)…' });
    const composeSpan = hasMusic ? 40 : 50; // % del progreso asignado al montaje
    for (const p of planned) {
      emit({ type: 'segment', index: p.n, total, nombre: p.nombre, stage: 'montaje' });
      const target = total === 1 ? voicePath : p.clip;
      await composeVideo({
        topVideo: p.topVideo,
        bgVideo: p.bgVideo,
        avatar: p.avatar,
        audio: p.wav,
        output: target,
        duration: p.duration,
        elements: p.elements,
        imagePaths: p.imagePaths,
        subtitleChunks: p.subtitleChunks,
        subtitleReveal: subMode === 'entero' ? 'none' : config.subtitle.reveal,
        canvas: p.canvas,
        onLog: (line) => emit({ type: 'log', line }),
        onProgress: (percent) => setProgress(40 + ((p.n + percent / 100) / total) * composeSpan),
        onSpawn: registerChild,
      });
    }

    // 4) Concatenación (si hay más de un plano).
    if (total > 1) {
      emit({ type: 'stage', stage: 'concat', message: `Uniendo ${total} planos…` });
      const concatBase = 40 + composeSpan; // 80 (con música) | 90 (sin)
      await concatClips(
        planned.map((p) => p.clip),
        voicePath,
        {
          totalDuration,
          onLog: (line) => emit({ type: 'log', line }),
          onProgress: (percent) => setProgress(concatBase + (percent / 100) * (hasMusic ? 8 : 10)),
          onSpawn: registerChild,
        }
      );
    }

    // 5) Música de fondo: mezcla final (copia el vídeo, recodifica solo el audio).
    if (hasMusic) {
      emit({
        type: 'stage',
        stage: 'music',
        message: `Añadiendo música (${runs.length} pista/s): ${runs.map((r) => r.label).join(', ')}…`,
      });
      await mixMusic(voicePath, runs, outputPath, {
        totalDuration,
        onLog: (line) => emit({ type: 'log', line }),
        onProgress: (percent) => setProgress(90 + percent / 10),
        onSpawn: registerChild,
      });
    }
    setProgress(100);

    const outName = path.basename(outputPath);
    emit({
      type: 'done',
      message: '¡Vídeo generado!',
      output: outName,
      url: `/outputs/${encodeURIComponent(outName)}`,
    });
    return outputPath;
  } finally {
    rendering.delete(file);
  }
}
