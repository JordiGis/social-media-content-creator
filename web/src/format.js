// Reexporta la lógica de segmentos COMPARTIDA con el backend (única fuente de
// verdad del formato `@@`). Vite la empaqueta desde src/ (ver vite.config fs.allow).
export {
  parseSegments,
  serializeSegments,
  cleanForTTS,
  defaultsFromFrontmatter,
} from '../../src/segments.js';
