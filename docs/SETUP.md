# Setup

Full setup guide: install, add your own media, first real render, and troubleshooting.
For a 30-second taste with placeholder assets, the [README quickstart](../README.md#-quickstart)
is enough — this doc goes deeper.

## 1. System requirements

| Tool | Why | Install (macOS) |
|---|---|---|
| **Node.js ≥ 18** | Backend + build | [nodejs.org](https://nodejs.org) or `brew install node` |
| **pnpm** | Package manager (the only one used) | `corepack enable pnpm` |
| **FFmpeg** | Video/audio rendering | `brew install ffmpeg` |
| **librsvg** (`rsvg-convert`) | Renders subtitles and placeholder art (SVG→PNG) | `brew install librsvg` |
| **Python 3** | Runs the local voice engine | ships with macOS, or `brew install python` |

> **Apple Silicon:** the Homebrew FFmpeg is usually `/opt/homebrew/bin/ffmpeg`. If FFmpeg
> isn't on your `PATH`, set `FFMPEG_PATH` in `.env` (same for `RSVG_PATH`).
>
> **Note:** the Homebrew FFmpeg has no `drawtext`/freetype — that's *by design*. This app
> renders text as SVG→PNG via `rsvg-convert` instead, so you don't need a special FFmpeg.

## 2. Install

```bash
git clone https://github.com/JordiGis/social-media-content-creator.git
cd social-media-content-creator

pnpm install
cp .env.example .env
```

### Python voice engine (Pocket TTS)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r python/requirements.txt
```

This installs `pocket-tts` and its deps. The model itself downloads on first real use
(skip it entirely with `POCKET_TTS_MOCK=1`, see below). Point `PYTHON_BIN` in `.env` at
this venv's interpreter if you don't activate it each time:

```ini
PYTHON_BIN=.venv/bin/python
```

## 3. Smoke test (no media, no model)

```bash
pnpm demo                    # generate placeholder avatar + top + background clips
POCKET_TTS_MOCK=1 pnpm dev
```

Open **http://localhost:5173**, open `001_demo`, click **▶ Generar vídeo**. You should get
`outputs/001_demo.mp4`. If that works, your FFmpeg/rsvg/pipeline are all healthy.

## 4. Add your own media

The repo ships **empty of media** (the `assets/*` folders are gitignored — bring your own).
Drop files into:

| Folder | What goes here | Format |
|---|---|---|
| `assets/avatares/` | Talking-head / character images (overlaid, floats) | PNG (transparent background recommended) |
| `assets/inputs_top/` | "Top" clips (the upper part of the frame) | MP4 |
| `assets/fondos_matrix/` | Background clips | MP4 |
| `assets/imagenes/` | Floating images you place via a layout | PNG |
| `assets/musica/` | Background music tracks | MP3 |
| `assets/voces_referencia/` | Your voice sample(s) for cloning | WAV (~20s, clean) |

Files appear in the editor's asset pickers automatically. You can also upload them from the
UI (**Settings / asset pickers**). Filenames are sanitized against path traversal.

> **Copyright:** you are responsible for the rights to everything you add. Pixabay clips are
> license-free; most music and stock elsewhere is not. Don't ship copyrighted media in a
> public fork of this repo.

## 5. Pick a voice

Set `archivo_voz_clon` in a script's front-matter (or the global default in **Settings**):

- **Catalog voice (no login):** a name like `alba`, `lola`, `giovanni`, `jean`, `vera`,
  `eve`… Works immediately, nothing to download beyond the base model.
- **Clone your own (gated model):** a `.wav` filename in `assets/voces_referencia/`.
  Requires a one-time Hugging Face login — see [VOICE.md](VOICE.md).

## 6. Run for real

```bash
# Development (hot reload for both frontend and backend)
pnpm dev        # Express :4000 + Vite :5173  ->  http://localhost:5173

# Or a single production process
pnpm build      # compiles the React app into public/
pnpm start      # everything on http://localhost:4000
```

The frontend is a SPA with routes: opening a script pushes `/g/<file>.md`, so you can
refresh (F5) without losing your place.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ffmpeg: command not found` / render fails instantly | Install FFmpeg; set `FFMPEG_PATH` in `.env` to its full path. |
| Subtitles or `pnpm demo` fail | Install librsvg (`brew install librsvg`); set `RSVG_PATH` if needed. |
| Voice step errors about the model / HF login | You're using a **cloned** voice (gated model). Use a catalog name, or log in — see [VOICE.md](VOICE.md). Or test with `POCKET_TTS_MOCK=1`. |
| `python: command not found` or wrong Python | Set `PYTHON_BIN=.venv/bin/python` in `.env`. |
| Render says an asset is missing | The filename in the script doesn't exist in `assets/…`. Check spelling, or run `pnpm demo` for the demo. |
| Port already in use | Change `PORT` in `.env` (backend) — Vite's dev port is 5173. |

More knobs (quality, subtitle style, avatar bounce, music volume) live in
[CONFIG.md](CONFIG.md).
