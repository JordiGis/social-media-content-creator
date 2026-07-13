# Architecture

A high-level map of how the pieces fit together. `CLAUDE.md` (in the repo root) has a
condensed version too. The codebase is ESM throughout (`"type": "module"`, Node ≥ 18, pnpm).

## Three cooperating processes

| Process | Where | Role |
|---|---|---|
| **Express backend** | `server.js` + `src/` | REST API, SSE render stream, SPA fallback. |
| **React SPA** | `web/` (built to `public/`) | The editor, layout builder, settings, render console. |
| **Python TTS bridge** | `python/pocket_tts_bridge.py` | Local voice synthesis, spawned per render. |

In dev, `pnpm dev` runs Express (`:4000`) and Vite (`:5173`) side by side, with Vite
proxying `/api`, `/outputs` and `/assets` to Express (SSE-friendly, no buffering). In prod,
`pnpm build` compiles the SPA into `public/` and `pnpm start` serves everything from Express.

## The render pipeline — `src/render.js`

`runRender(name, emit, registerChild)` is the whole flow, streamed to the client over
Server-Sent Events. `emit` pushes progress events; `registerChild` exposes the live
FFmpeg/Python child so a closed connection can `SIGKILL` it. Stages:

1. **Parse** the script → `planned[]`, one entry per shot, assets validated, temp paths set.
2. **TTS in one batch** — `synthesizeSegments` runs the Python bridge **once** for all voiced
   shots (the model and voice state load a single time — far faster than per-shot). Mute
   shots (duration, no text) skip TTS.
3. **Measure** each shot's duration (voice length or fixed `duracion`, whichever is larger) +
   a tail padding, and rasterize subtitle PNGs.
4. **Compose** each shot into its own clip via `composeVideo` — one FFmpeg call per shot.
5. **Concat** the shots with the concat demuxer (`-c copy`, falling back to re-encode).
6. **Mix music** under the voice (audio-only re-encode, video copied).

Intermediates go to `temp/`; the final video to `outputs/<script>.mp4`. All clips are forced
to identical params (yuv420p, stereo 44.1k AAC) so concat/mix never have to re-matrix.

## The shot format — `src/segments.js` (shared, pure)

This module has **no Node dependencies** and is imported by **both** `src/` and `web/`, so the
`@@` format has a single source of truth — the visual editor and the renderer can't drift
apart. `parseSegments` / `serializeSegments` apply and strip defaults (a key equal to the
global default is omitted, to keep the `.md` clean and git-friendly). See
[SCRIPT-FORMAT.md](SCRIPT-FORMAT.md).

Vite is configured (`vite.config.js`, `fs.allow`) to import this file from outside `web/`.

## Layouts — `src/layouts.js` + `src/ffmpeg.js`

A layout places elements in free boxes `{x, y, w, h}` on the 1080×1920 canvas. Roles:
`fondo`, `top`, `avatar` (the three shot inputs), `imagen` (a floating asset with `src`),
`efecto` (blur/darken/lighten/pixelate over what's below), and `subtitle` (position/size of
the auto-subtitle; style is global). Two built-in seed templates — `avatar_abajo` and
`avatar_arriba` — live in code. Any layouts you build or override in the UI persist to
`layouts.json` (deleting an override of a seed restores the seed).

`buildFilter` turns a layout into an FFmpeg `-filter_complex`. Input indices are **fixed**:
`0` top, `1` fondo, `2` avatar, `3` audio, `4..` floating images, then subtitle PNGs.

## Subtitles — `src/subtitles.js`

The Homebrew FFmpeg has no freetype/libass, so there's **no `drawtext`**. Text is rendered as
SVG → PNG via `rsvg-convert`, then overlaid per time window. `flujo` mode chunks the text
(~`maxWords`) with a left→right "wipe" reveal; `entero` mode shows the whole shot text,
static. The global mode lives in `defaults.json`.

## Python bridge — `python/pocket_tts_bridge.py`

Invoked by `src/pockettts.js` via `child_process`. Emits one JSON line per event on stdout;
on error, a JSON line on stderr plus a specific exit code (see [VOICE.md](VOICE.md)).
`--manifest` is the batch mode used by renders; `--mock` writes a tone without the model.

## Publishing & extras

- `src/drive.js` — Drive upload via rclone.
- `src/publish.js` + `src/instagram.js` + `src/tiktok.js` + `src/videohost.js` — social
  publishing (Graph API + Content Posting API; temporary public host for IG).
- `src/videometa.js` — writes the caption `.txt` beside each render.
- `src/mail.js` (IMAP read) + `src/smtpmail.js` (SMTP send) — inbox & notifications.
- `src/descargas.js` + `scripts/descargar.mjs` — the Pixabay download cart.

## Persisted state (all plaintext, git-friendly)

| Path | What |
|---|---|
| `guiones/*.md` | Your scripts. |
| `assets/{avatares,imagenes,fondos_matrix,inputs_top,voces_referencia,musica}/` | Your media. |
| `defaults.json` | Global defaults for new scripts + subtitle mode. |
| `layouts.json` | Custom/overridden layout templates (created on demand). |
| `descargas.json` | The download-cart catalog. |
| `.env`, `mail.config.json`, `social.config.json` | Config & secrets (last two gitignored). |
| `temp/`, `outputs/` | Generated (gitignored). |

## Conventions

- Backend `src/` modules are single-purpose and mostly pure functions returning promises. The
  SSE `emit` + `onProgress`/`onSpawn`/`onLog` callback shape is the standard way long ops
  report progress and expose cancellable children.
- Asset/script names are sanitized against path traversal (`safeScriptName`, `slugify`,
  `path.basename`). Preserve those guards.
- All render tunables are env vars centralized in `src/config.js` — add new knobs there, not
  inline. See [CONFIG.md](CONFIG.md).
