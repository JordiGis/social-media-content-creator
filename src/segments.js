/**
 * Lógica de segmentos (planos) de un guion — PURA, sin dependencias de Node.
 * Se comparte tal cual entre el backend (src/scripts.js, src/render.js) y el
 * frontend React (web/), de modo que el formato `@@` tenga una única fuente de
 * verdad y el editor visual y el render nunca se desincronicen.
 *
 * Un guion = front-matter (defaults globales + voz) + un cuerpo dividido en
 * planos mediante líneas que empiezan por `@@`. Cada plano puede fijar su
 * propio avatar / vídeo superior (top) / fondo; lo que omita hereda el default.
 */

export const DIRECTIVE_KEYS = ['nombre', 'avatar', 'top', 'fondo', 'layout', 'musica', 'duracion'];

/** Segundos de permanencia de un plano (0 = lo marca la voz). NaN/negativo -> 0. */
export function parseDuration(v) {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Un plano se renderiza si tiene texto o una duración explícita (> 0). */
export function segmentHasContent(s) {
  return !!String(s?.texto || '').trim() || parseDuration(s?.duracion) > 0;
}

/** Disposiciones válidas: avatar abajo (def) o avatar arriba (vídeo abajo). */
export const LAYOUTS = ['avatar_abajo', 'avatar_arriba'];
export const DEFAULT_LAYOUT = 'avatar_abajo';

/** Normaliza los defaults del front-matter a las claves de segmento. */
export function defaultsFromFrontmatter(data = {}) {
  return {
    avatar: data.avatar_default || '',
    top: data.video_top_default || '',
    fondo: data.fondo_default || '',
    layout: data.layout_default || DEFAULT_LAYOUT,
  };
}

/** Parsea "avatar: x | top: y | layout: z" (una o varias claves) -> objeto. */
function parseDirectives(rest) {
  const out = {};
  for (const part of String(rest || '').split('|')) {
    const m = part.match(/^\s*(nombre|avatar|top|fondo|layout|musica|duracion)\s*:\s*(.*?)\s*$/i);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

const DIR_LINE_RE = /^\s+(nombre|avatar|top|fondo|layout|musica|duracion)\s*:\s*/i;

/**
 * Divide el cuerpo en planos.
 * @param {string} content  cuerpo markdown (sin front-matter)
 * @param {object} data     front-matter (para heredar defaults)
 * @returns {Array<{nombre,avatar,top,fondo,texto}>}  valores ya resueltos (con defaults aplicados)
 */
export function parseSegments(content, data = {}) {
  const def = defaultsFromFrontmatter(data);
  const lines = String(content || '').split(/\r?\n/);
  const hasDirectives = lines.some((l) => /^@@/.test(l));

  // Retrocompatibilidad: sin marcadores `@@` -> un único plano con el texto de
  // "# Guion de Voz en Off" (o todo el cuerpo) usando los defaults.
  if (!hasDirectives) {
    const texto = (extractVoiceOver(content) || String(content || '')).trim();
    return texto ? [{ nombre: '', ...def, texto }] : [];
  }

  const segments = [];
  let cur = null;
  let collectingDirectives = false;

  const flush = () => {
    if (!cur) return;
    cur.texto = cur._text.join('\n').trim();
    delete cur._text;
    segments.push(cur);
    cur = null;
  };

  const startSegment = (dir = {}) => {
    cur = {
      nombre: dir.nombre || '',
      avatar: dir.avatar || def.avatar,
      top: dir.top || def.top,
      fondo: dir.fondo || def.fondo,
      layout: dir.layout || def.layout,
      // La música NO se hereda: vacío = "continúa la pista del plano anterior".
      musica: dir.musica || '',
      // Duración fija en segundos (vacío = la marca la voz; útil en planos sin texto).
      duracion: dir.duracion || '',
      _text: [],
    };
  };

  for (const line of lines) {
    const at = line.match(/^@@(.*)$/);
    if (at) {
      flush();
      startSegment(parseDirectives(at[1]));
      collectingDirectives = true;
      continue;
    }
    if (!cur) {
      // Texto antes del primer `@@`: arranca un plano por defecto para no perderlo.
      if (line.trim()) {
        startSegment();
        cur._text.push(line);
        collectingDirectives = false;
      }
      continue;
    }
    if (collectingDirectives && DIR_LINE_RE.test(line)) {
      const dir = parseDirectives(line);
      if (dir.nombre != null) cur.nombre = dir.nombre;
      if (dir.avatar != null) cur.avatar = dir.avatar;
      if (dir.top != null) cur.top = dir.top;
      if (dir.fondo != null) cur.fondo = dir.fondo;
      if (dir.layout != null) cur.layout = dir.layout;
      if (dir.musica != null) cur.musica = dir.musica;
      if (dir.duracion != null) cur.duracion = dir.duracion;
      continue;
    }
    collectingDirectives = false;
    cur._text.push(line);
  }
  flush();

  // Se conserva el plano con texto O con duración fija (planos "mudos" de N seg).
  return segments.filter(segmentHasContent);
}

/**
 * Serializa planos -> cuerpo markdown con bloques `@@`.
 * Omite las claves cuyo valor coincide con el default global (quedan heredadas),
 * para mantener el archivo limpio y git-friendly.
 */
export function serializeSegments(segments, data = {}) {
  const def = defaultsFromFrontmatter(data);
  const blocks = (segments || [])
    // Un plano se escribe si tiene texto O duración fija (plano "mudo" de N seg).
    .filter(segmentHasContent)
    .map((s) => {
    const kv = [];
    if (s.nombre) kv.push(`nombre: ${s.nombre}`);
    if (s.avatar && s.avatar !== def.avatar) kv.push(`avatar: ${s.avatar}`);
    if (s.top && s.top !== def.top) kv.push(`top: ${s.top}`);
    if (s.fondo && s.fondo !== def.fondo) kv.push(`fondo: ${s.fondo}`);
    if (s.layout && s.layout !== def.layout) kv.push(`layout: ${s.layout}`);
    // La música se escribe siempre que el plano la fije (no hay default que heredar).
    if (s.musica) kv.push(`musica: ${s.musica}`);
    if (parseDuration(s.duracion) > 0) kv.push(`duracion: ${parseDuration(s.duracion)}`);

    const rest = [...kv];
    const head = rest.length ? `@@ ${rest.shift()}` : '@@';
    const dirLines = rest.map((k) => `   ${k}`);
    const texto = String(s.texto || '').trim();
    return [head, ...dirLines, texto].filter((x) => x !== '').join('\n');
  });
  return blocks.join('\n\n') + '\n';
}

// --- Extracción / limpieza de texto (compartidas) ----------------------------

const normalize = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/**
 * Formato antiguo: extrae el texto bajo el H1 "# Guion de Voz en Off" hasta el
 * siguiente H1 o el final. Se conserva para guiones previos a los segmentos.
 */
export function extractVoiceOver(content) {
  const lines = String(content || '').split(/\r?\n/);
  let capturing = false;
  const out = [];
  for (const line of lines) {
    const h1 = line.match(/^#\s+(.*)$/);
    if (h1) {
      if (normalize(h1[1]).includes('voz en off')) {
        capturing = true;
        continue;
      }
      if (capturing) break;
      continue;
    }
    if (capturing) out.push(line);
  }
  return out.join('\n').trim();
}

/** Limpia marcas markdown para que el TTS lea texto natural. */
export function cleanForTTS(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''))
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
