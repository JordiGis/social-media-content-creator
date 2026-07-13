import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { BRIDGE_SCRIPT, TEMP_DIR } from './paths.js';

// Mensajes por código de salida del puente Python (ver pocket_tts_bridge.py).
const EXIT_MESSAGES = {
  2: 'Argumentos inválidos para el puente Pocket TTS',
  3: 'El entorno local de Pocket TTS no está instalado o faltan librerías nativas del Mac (instala: pip install pocket-tts dentro de un venv)',
  4: 'No se encontró el archivo de voz de referencia',
  5: 'Fallo durante la generación de voz con Pocket TTS',
  6: 'La clonación requiere acceso al modelo gated de Pocket TTS (acepta términos en huggingface.co/kyutai/pocket-tts y ejecuta `hf auth login`)',
};

/**
 * Lanza el puente Python y procesa su stdout (una línea JSON por evento).
 * @param {string[]} args
 * @param {object} opts
 * @param {(line:string)=>void} [opts.onLog]
 * @param {(ev:object)=>void} [opts.onEvent]  evento JSON parseado (status, index…)
 */
function runBridge(args, { onLog, onEvent } = {}) {
  const { pythonBin } = config.pocketTts;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(pythonBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(new Error(`No se pudo iniciar Python ("${pythonBin}"): ${err.message}`));
      return;
    }

    let stderrTail = '';
    let stdoutBuf = '';

    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString();
      let nl;
      while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line) continue;
        try {
          const ev = JSON.parse(line);
          onLog?.(`[pocket-tts] ${ev.status || JSON.stringify(ev)}\n`);
          onEvent?.(ev);
        } catch {
          onLog?.(`[pocket-tts] ${line}\n`);
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      stderrTail = (stderrTail + s).slice(-4000);
      onLog?.(s);
    });

    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(
          new Error(
            `No se encontró Python ("${pythonBin}"). Instala Python 3 o ajusta PYTHON_BIN en .env`
          )
        );
      } else {
        reject(new Error(`Error al ejecutar el puente Pocket TTS: ${err.message}`));
      }
    });

    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (signal) {
        reject(new Error('Generación de voz cancelada'));
        return;
      }
      // Intenta extraer el JSON de error de stderr (última línea válida).
      let detail = '';
      const lines = stderrTail.split(/\r?\n/).filter(Boolean);
      for (let k = lines.length - 1; k >= 0; k--) {
        try {
          const j = JSON.parse(lines[k]);
          if (j && j.error) {
            detail = j.error;
            break;
          }
        } catch {
          /* no era JSON */
        }
      }
      const base = EXIT_MESSAGES[code] || `El puente Pocket TTS terminó con código ${code}`;
      reject(new Error(detail ? `${base}: ${detail}` : `${base}\n${stderrTail.slice(-600)}`));
    });
  });
}

/**
 * Sintetiza voz con Pocket TTS (clonación zero-shot) para un único texto.
 * @returns {Promise<string>} outPath
 */
export async function synthesizeSpeech(text, outPath, { voiceRef = '', onLog } = {}) {
  if (!text || !text.trim()) throw new Error('El texto para la voz en off está vacío');

  const { language } = config.pocketTts;
  const textFile = path.join(TEMP_DIR, `${path.basename(outPath).replace(/\.[^.]+$/, '')}.txt`);
  await fs.writeFile(textFile, text, 'utf8');

  const args = [BRIDGE_SCRIPT, '--text-file', textFile, '--output', outPath, '--language', language];
  if (voiceRef) args.push('--voice', voiceRef);
  if (config.pocketTts.temperature != null && !Number.isNaN(config.pocketTts.temperature)) {
    args.push('--temp', String(config.pocketTts.temperature));
  }
  if (config.pocketTts.mock) args.push('--mock');

  await runBridge(args, { onLog });
  return outPath;
}

/**
 * Sintetiza varios planos en UN solo proceso: el modelo y el estado de voz se
 * cargan una vez y se reutilizan para todos (misma voz, mucho más rápido que
 * llamar al puente una vez por plano).
 *
 * @param {Array<{text:string, output:string}>} items
 * @param {object} opts
 * @param {string} [opts.voiceRef]      archivo clon / nombre de catálogo / URL
 * @param {string} [opts.manifestPath]  dónde escribir el manifest (def: temp)
 * @param {(line:string)=>void} [opts.onLog]
 * @param {(ev:{index:number,output:string})=>void} [opts.onItem]  por plano sintetizado
 * @returns {Promise<string[]>} rutas de los WAV en orden
 */
export async function synthesizeSegments(items, { voiceRef = '', manifestPath, onLog, onItem } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('No hay segmentos para sintetizar');
  }
  items.forEach((it, i) => {
    if (!it.text || !it.text.trim()) throw new Error(`El plano ${i + 1} no tiene texto para la voz`);
    if (!it.output) throw new Error(`El plano ${i + 1} no tiene ruta de salida`);
  });

  const { language, temperature } = config.pocketTts;
  const mPath = manifestPath || path.join(TEMP_DIR, 'segments.manifest.json');
  const spec = {
    voice: voiceRef || '',
    language,
    items: items.map((it) => ({ text: it.text, output: it.output })),
  };
  if (temperature != null && !Number.isNaN(temperature)) spec.temp = temperature;
  await fs.writeFile(mPath, JSON.stringify(spec), 'utf8');

  const args = [BRIDGE_SCRIPT, '--manifest', mPath];
  if (config.pocketTts.mock) args.push('--mock');

  await runBridge(args, {
    onLog,
    onEvent: (ev) => {
      if (ev.status === 'item_done') onItem?.({ index: ev.index, output: ev.output });
    },
  });
  return items.map((it) => it.output);
}
