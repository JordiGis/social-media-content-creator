# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Local app to automate vertical 9:16 (1080×1920) Reels/Shorts on macOS Apple Silicon.
A React "Notion-style" editor writes **guiones** (scripts) split into **planos** (shots);
a Node/FFmpeg pipeline renders them. Voice is local via **Pocket TTS** (Python, CPU,
zero-shot voice cloning). The narrator voice is GLOBAL/continuous across shots; each
shot can swap its own avatar / top video / background / layout / music. UI text, code
comments, and the `.md` script format are all in **Spanish** — match it.

## Commands

```bash
pnpm install                       # deps (corepack enable pnpm)
pnpm dev                           # Express :4000 + Vite :5173 -> open http://localhost:5173
POCKET_TTS_MOCK=1 pnpm dev         # generates a tone instead of loading the TTS model (fast pipeline test)
pnpm build                         # compile React -> public/
pnpm start                         # single process, serves everything on :4000

# Python TTS (voice). FFmpeg + rsvg-convert come from Homebrew.
python3 -m venv .venv && source .venv/bin/activate
pip install -r python/requirements.txt
brew install ffmpeg librsvg
```

No test/lint setup exists. Verify changes by rendering a script (use `POCKET_TTS_MOCK=1`
to skip the model). Config is env-driven — copy `.env.example` to `.env`.

## Architecture

Three processes cooperate: **Express backend** (`server.js` + `src/`), **React SPA**
(`web/`, built to `public/`), **Python TTS bridge** (`python/pocket_tts_bridge.py`,
spawned per render).

### Render pipeline — `src/render.js` (the core)

`runRender(name, emit, registerChild)` is the whole flow, streamed to the client over
SSE (`emit` pushes progress events; `registerChild` exposes the live ffmpeg/python
process so a closed connection can `SIGKILL` it). Stages:

1. Parse script → `planned[]`, one entry per shot, with assets validated and temp paths.
2. **TTS in one batch** — `synthesizeSegments` runs the Python bridge ONCE for all
   voiced shots (model + voice state load once; far faster than per-shot). Mute shots
   (duration but no text) skip TTS.
3. Measure each shot's duration (voice length or fixed `duracion`, whichever is larger)
   + `tailPadding` cola, and rasterize subtitle PNGs.
4. **Compose** each shot to its own clip via `composeVideo` (one ffmpeg call per shot).
5. **Concat** shots with the concat demuxer (`-c copy`, falls back to re-encode).
6. **Mix music** runs under the voice (audio-only re-encode, video copied).

Files write to `temp/`; final video to `outputs/<script>.mp4`. All clips are forced to
the same params (yuv420p, stereo 44.1k AAC) so concat/mix never have to rematrix.

### Shot format — `src/segments.js` (PURE, shared backend↔frontend)

This module has **no Node deps** and is imported by both `src/` and `web/` so the `@@`
format has one source of truth — the visual editor and the renderer can't desync. A
script is gray-matter front-matter (global defaults + `archivo_voz_clon` voice) plus a
body split by `@@` lines. Per-shot keys: `nombre`, `avatar`, `top`, `fondo`, `layout`,
`musica`, `duracion`. `parseSegments`/`serializeSegments` apply and strip defaults (a
key equal to the global default is omitted to keep the `.md` clean and git-friendly).

Key semantics to preserve:
- **Voice is global** (`archivo_voz_clon`), never per-shot.
- **Music does NOT inherit**: empty `musica` = "continue previous shot's track";
  `musica_default` opens the video; `none/silencio/off/-` stops it. Contiguous shots on
  the same track fuse into one continuous run (`buildMusicRuns`).
- Back-compat: a script with no `@@` is treated as one shot (old `# Guion de Voz en Off`).

### Layouts — `src/layouts.js` + `src/ffmpeg.js`

A layout places elements in free boxes `{x,y,w,h}` on the 1080×1920 canvas. Roles:
`fondo`, `top`, `avatar` (the three shot inputs), `imagen` (floating asset with `src`),
`efecto` (blur/oscurecer/aclarar/pixelar over what's below), `subtitle` (position/size
of auto-subtitle; style is global). Two built-in seed templates (`avatar_abajo`,
`avatar_arriba`) live in code; user edits/overrides persist to `layouts.json` (deleting
an override of a seed *restores* it). `buildFilter` turns a layout into FFmpeg
`-filter_complex`; FFmpeg input indices are FIXED: `0` top, `1` fondo, `2` avatar,
`3` audio, `4..` floating images, then subtitle PNGs.

### Subtitles — `src/subtitles.js`

ffmpeg from Homebrew lacks freetype/libass, so there's NO `drawtext`. Text is rendered
as SVG → PNG via `rsvg-convert`, then overlaid per time-window. `flujo` mode chunks text
(~`maxWords`) with a left→right "wipe" reveal; `entero` mode shows the whole shot text,
static. Global `subtitulos` mode lives in `defaults.json`.

### Persisted state (all plaintext, git-friendly — keep it that way)

- `guiones/*.md` — scripts.
- `assets/{avatares,imagenes,fondos_matrix,inputs_top,voces_referencia,musica}/` — media.
- `defaults.json` — global defaults for new scripts + subtitle mode (`src/defaults.js`).
- `layouts.json` — custom/overridden layout templates.
- `temp/` (intermediates), `outputs/` (final mp4s) — generated, gitignored.

### Frontend (`web/`)

Vite-built React SPA, proxies `/api`, `/outputs`, `/assets` to :4000 (SSE-friendly, no
buffering). React Router; opening a script pushes `/g/<file>.md` and the Express SPA
fallback serves `index.html` so F5 survives. `web/src/api.js` is the typed client;
`RenderConsole.jsx` consumes the SSE render stream. Note `web/` imports the shared
`src/segments.js` from outside its root (allowed via `vite.config.js` `fs.allow`).

### Python bridge — `python/pocket_tts_bridge.py`

Invoked by `src/pockettts.js` via child_process. Emits one JSON line per event on
stdout; on error, one JSON line on stderr + a specific exit code (3 = libs missing,
4 = ref voice not found, 5 = synth fail, 6 = gated model needs HF login). `--manifest`
is the batch mode used by renders. `--mock` writes a tone without the model.

## Conventions

- ESM throughout (`"type": "module"`). Node >= 18. pnpm only.
- Backend `src/` modules are single-purpose and mostly pure functions returning
  promises; the SSE/`emit` + `onProgress`/`onSpawn`/`onLog` callback shape is the
  standard way long ops report progress and expose cancellable children.
- Asset/script names are sanitized against path traversal (`safeScriptName`,
  `slugify`, `path.basename`) — preserve those guards.
- All render tunables (fps, crf, preset, avatar bounce, music volume/fade, subtitle
  style) are env vars centralized in `src/config.js`; add new knobs there, not inline.
- **Texto de guiones para TTS**: en el cuerpo de los `@@` planos, escribe los números
  de versión de modelo con la palabra «punto», no con `.` — p. ej. `Opus 4 punto 8`,
  `Sonnet 5`, `GPT 5 punto 1`. Pocket TTS lee mal el `.` como pausa/abreviatura; «punto»
  le facilita la lectura. Aplica siempre al redactar o editar `guiones/*.md`.
