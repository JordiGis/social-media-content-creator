import 'dotenv/config';

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 4000),

  // Pocket TTS local (kyutai-labs/pocket-tts) con clonación de voz zero-shot.
  pocketTts: {
    pythonBin: process.env.PYTHON_BIN || 'python3',
    language: process.env.POCKET_TTS_LANGUAGE || 'spanish',
    // temperatura de muestreo: más alta = voz más viva/variada (def del modelo 0.7).
    temperature:
      process.env.POCKET_TTS_TEMPERATURE === undefined || process.env.POCKET_TTS_TEMPERATURE === ''
        ? null
        : Number(process.env.POCKET_TTS_TEMPERATURE),
    // wav de referencia por defecto (dentro de assets/voces_referencia) si el
    // guion no define `archivo_voz_clon`.
    defaultVoiceFile: process.env.POCKET_TTS_DEFAULT_VOICE_FILE || '',
    // modo prueba: genera un tono sin cargar el modelo (también vía POCKET_TTS_MOCK env).
    mock: ['1', 'true', 'yes'].includes(String(process.env.POCKET_TTS_MOCK || '').toLowerCase()),
  },

  ffmpeg: {
    bin: process.env.FFMPEG_PATH || 'ffmpeg',
    fps: num(process.env.RENDER_FPS, 30),
    crf: num(process.env.RENDER_CRF, 20),
    preset: process.env.RENDER_PRESET || 'medium',
    // cola de vídeo tras acabar la voz en cada plano, en segundos, para que el
    // corte entre planos no sea tan brusco (la imagen sigue viva, sin audio).
    tailPadding: num(process.env.RENDER_TAIL_PADDING, 0.6),
  },

  avatar: {
    box: num(process.env.AVATAR_BOX, 600), // max ancho/alto del avatar en px
    bounceAmplitude: num(process.env.AVATAR_BOUNCE_AMP, 20), // px
    bounceFreq: num(process.env.AVATAR_BOUNCE_FREQ, 1.5), // Hz
  },

  // Música de fondo (mezclada bajo la voz en off).
  music: {
    volume: num(process.env.MUSIC_VOLUME, 0.18), // 0..1, ganancia de la música
    fade: num(process.env.MUSIC_FADE, 1.2), // s de fundido al entrar/salir cada pista
  },

  // Descargas automáticas del "carrito" (scripts/descargar.mjs). Los enlaces de
  // Pixabay se resuelven vía su API de vídeos (clave gratis en pixabay.com/api/docs);
  // sin clave, el script solo baja enlaces directos a un archivo (.mp4/.mp3…).
  descargas: {
    pixabayApiKey: process.env.PIXABAY_API_KEY || '',
    // candidatos que baja por card (para elegir el que más pegue); override con --n.
    candidatos: num(process.env.DESCARGAS_CANDIDATOS, 4),
  },

  // Publicación en redes GRATIS con las APIs nativas: Instagram Reels (Graph API,
  // gratis; el vídeo se sirve por un host temporal para que IG lo descargue) +
  // TikTok (sube a la bandeja/borrador; publicas con un toque en la app, sin
  // audit). Los tokens se guardan en social.config.json (ver src/socialconfig.js).
  social: {
    graphVersion: process.env.IG_GRAPH_VERSION || 'v21.0',
    // Plataformas marcadas por defecto en el botón de publicar.
    porDefecto: (process.env.SOCIAL_DEFAULT || 'instagram,tiktok')
      .split(',').map((s) => s.trim()).filter(Boolean),
  },

  // Subida automática de los vídeos finales a Google Drive vía rclone.
  // `remote` = nombre del remote de Drive configurado con `rclone config`;
  // `folder` = carpeta destino dentro de ese Drive. Si `auto` está activo, el
  // render sube el mp4 en cuanto termina (scripts/render.mjs).
  drive: {
    remote: process.env.DRIVE_REMOTE || 'drive',
    folder: process.env.DRIVE_FOLDER || 'ContentCreator',
    auto: ['1', 'true', 'yes'].includes(String(process.env.DRIVE_AUTO || '').toLowerCase()),
    rcloneBin: process.env.RCLONE_PATH || 'rclone',
  },

  // Subtítulos automáticos. El texto del plano se trocea (≈ maxWords palabras) y
  // cada trozo se reparte sobre la duración de la voz. Estilo GLOBAL aquí; la
  // posición/tamaño la fija la caja del elemento `subtitle` en cada disposición.
  // Se renderiza como SVG -> PNG (rsvg-convert) y se superpone con FFmpeg, así no
  // hace falta drawtext (el ffmpeg de Homebrew ya no trae freetype/libass).
  subtitle: {
    rsvgBin: process.env.RSVG_PATH || 'rsvg-convert',
    // Aparición de cada trozo: 'wipe' = cortina izquierda->derecha (se "escribe");
    // 'none' = aparece de golpe en su ventana de tiempo.
    reveal: (process.env.SUBTITLE_REVEAL || 'wipe').toLowerCase() === 'none' ? 'none' : 'wipe',
    // Segundos que el trozo queda fijo (texto completo) tras terminar la cortina,
    // antes de pasar al siguiente. La cortina se acelera para reservar este margen
    // de lectura (no alarga el plano: se queda dentro de la ventana del trozo).
    holdSec: num(process.env.SUBTITLE_HOLD, 0.5),
    maxWords: num(process.env.SUBTITLE_MAX_WORDS, 4), // palabras por trozo
    fontFamily: process.env.SUBTITLE_FONT || 'Helvetica, Arial, sans-serif',
    fontSize: num(process.env.SUBTITLE_FONT_SIZE, 60), // px sobre el lienzo 1080
    weight: num(process.env.SUBTITLE_WEIGHT, 800), // grosor de fuente (100–900)
    color: process.env.SUBTITLE_COLOR || '#ffffff', // relleno del texto
    strokeColor: process.env.SUBTITLE_STROKE_COLOR || '#000000', // contorno
    strokeWidth: num(process.env.SUBTITLE_STROKE_WIDTH, 7), // grosor del contorno (px)
    lineHeight: num(process.env.SUBTITLE_LINE_HEIGHT, 1.18), // interlínea (×fontSize)
    uppercase: ['1', 'true', 'yes'].includes(
      String(process.env.SUBTITLE_UPPERCASE || '').toLowerCase()
    ),
  },
};
