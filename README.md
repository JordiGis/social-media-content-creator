# 🎬 Social Media Content Creator

**Create vertical 9:16 Reels / Shorts / TikToks locally — from a written script to a
finished, captioned, voiced video — in one click.**

A self-hosted app with a **Notion-style script editor**: you write a script split into
**shots** (`planos`), and a **Node + FFmpeg** pipeline renders it. The voice is generated
**100% locally** with [Pocket TTS](https://huggingface.co/kyutai/pocket-tts) (zero-shot
voice cloning, runs on CPU). Optionally auto-upload to Google Drive and **publish to
Instagram Reels & TikTok** with free native APIs.

> The **narrator voice is global and continuous** across the whole video, while **each
> shot can swap its own avatar, top video, background, layout and music**. That's the
> core idea: one voice telling the story, visuals that change shot by shot.

Built and tested on **macOS Apple Silicon** (voice on CPU, FFmpeg from Homebrew). It
should adapt to Linux with the same tools installed.

> ℹ️ **A note on language.** The app's UI, code comments and the `.md` script format are
> in **Spanish** (that's how the project was written). This README and everything in
> [`docs/`](docs/) are in English so anyone can set it up. The two are independent — you
> don't need Spanish to run it.

---

## ✨ Features

| | |
|---|---|
| 📝 **Shot-based editor** | Notion-style visual editor. A script = global defaults + a list of shots. Add / duplicate / drag-reorder / delete shots. Autosave (`Cmd/Ctrl+S`). |
| 🗣️ **Local voice** | Pocket TTS runs on your machine. Use a **catalog voice** (no login) or **clone your own** from a ~20s `.wav`. One narrator voice for the whole video. |
| 🎞️ **Per-shot visuals** | Every shot picks its own avatar, top video, background, layout and music track. |
| 🧩 **Layout builder** | Place elements (background, top, avatar, floating images, blur/darken effects, subtitles) in free boxes on the 1080×1920 canvas. |
| 💬 **Auto subtitles** | Word-by-word "wipe" reveal or whole-shot text. Rendered as SVG→PNG (no font libs needed in FFmpeg). |
| 🎵 **Background music** | Mixed under the voice. Tracks continue across contiguous shots; change or stop per shot. |
| ⬇️ **Stock download cart** | Queue Pixabay clips per shot and batch-download them (`pnpm descargar`). |
| ☁️ **Google Drive upload** | One command (or automatic after each render) via `rclone`. |
| 📢 **Publish to IG & TikTok** | Instagram Reels via the Graph API (auto-published); TikTok uploaded to your drafts (one tap to post). Free native APIs, no paid schedulers. |
| 📧 **Newsletter inbox** | Optional read-only IMAP inbox to skim newsletters for content ideas, plus SMTP "video ready" notifications. |

---

## 🚀 Quickstart

### 1. Prerequisites

- **Node.js ≥ 18** and **pnpm** — `corepack enable pnpm`
- **FFmpeg** and **librsvg** — `brew install ffmpeg librsvg`
- **Python 3** (for the voice)

### 2. Install

```bash
git clone https://github.com/JordiGis/social-media-content-creator.git
cd social-media-content-creator

pnpm install
cp .env.example .env                       # tweak later if you want

# Python voice engine (Pocket TTS) — in a virtualenv
python3 -m venv .venv && source .venv/bin/activate
pip install -r python/requirements.txt
```

### 3. See it render (no media, no model — 30 seconds)

The repo ships **without media** (bring your own — or generate placeholders):

```bash
pnpm demo                    # generates a placeholder avatar + background + top clip
POCKET_TTS_MOCK=1 pnpm dev   # starts the app; MOCK makes a tone instead of loading the model
```

Open **http://localhost:5173**, click the **`001_demo`** script, hit **▶ Generar vídeo**,
and watch it render live. The result lands in `outputs/001_demo.mp4`.

> `POCKET_TTS_MOCK=1` replaces the voice with a tone so you can test the whole pipeline
> **without downloading the ~1GB model**. Drop it once you're ready for real voice.

### 4. Real run

```bash
pnpm dev        # dev: Express :4000 + Vite :5173  ->  http://localhost:5173
# or
pnpm build && pnpm start   # single process on http://localhost:4000
```

Then:
1. Drop your own **avatar PNGs** in `assets/avatares/`, **background/top videos** in
   `assets/fondos_matrix/` and `assets/inputs_top/`, **music** in `assets/musica/`.
2. Pick a **voice** — a catalog name (`alba`, `lola`, `giovanni`…) needs nothing, or
   clone your own (see [docs/VOICE.md](docs/VOICE.md)).
3. Write a script, assign assets per shot, and render.

📖 **Full setup:** [docs/SETUP.md](docs/SETUP.md)

---

## 📚 Documentation

| Doc | What's inside |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Detailed install, adding your own media, first real render, troubleshooting. |
| [docs/SCRIPT-FORMAT.md](docs/SCRIPT-FORMAT.md) | The `@@` shot format, front-matter, defaults & inheritance, music rules. |
| [docs/VOICE.md](docs/VOICE.md) | Pocket TTS: catalog voices vs. cloning your own, the gated model, HF login. |
| [docs/CONFIG.md](docs/CONFIG.md) | Every `.env` variable, what it does, and its default. |
| [docs/PUBLISHING.md](docs/PUBLISHING.md) | Connect Instagram & TikTok (tokens, IDs), Google Drive upload, email notifications. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the render pipeline, modules and processes fit together. |

---

## 🧠 How a render works

1. **Parse** — the script is split into shots (each with its avatar / top / background /
   layout / text).
2. **Voice (batch)** — Pocket TTS loads **once** and synthesizes every shot's line in the
   same narrator voice → one WAV per shot. (`POCKET_TTS_MOCK=1` makes a tone instead.)
3. **Measure** — each shot's duration = its voice length (or a fixed `duracion`) + a small
   tail so cuts aren't abrupt. Subtitles are rasterized to PNG.
4. **Compose** — one FFmpeg call per shot builds its 1080×1920 clip from its layout, with
   the avatar overlaid and gently floating.
5. **Concat** — shots are joined into `outputs/<script>.mp4`.
6. **Music** — background tracks are mixed under the voice.

Progress streams live to the UI console over **Server-Sent Events**. Everything writes to
`temp/`; only the final `.mp4` (and an optional caption `.txt`) lands in `outputs/`.

---

## 🗂️ Project structure

```text
social-media-content-creator/
├── server.js                 # Express API + SSE render stream + SPA fallback
├── src/                      # Backend (single-purpose ES modules)
│   ├── segments.js           #   @@ shot format (parse/serialize) — SHARED with the frontend
│   ├── render.js             #   the render pipeline (TTS -> compose -> concat -> music)
│   ├── ffmpeg.js layouts.js  #   filter graphs & layout boxes
│   ├── subtitles.js          #   SVG -> PNG subtitles
│   ├── pockettts.js          #   bridge to the Python voice engine
│   ├── drive.js publish.js instagram.js tiktok.js   # upload & publishing
│   └── mail.js smtpmail.js descargas.js …           # inbox, notifications, stock cart
├── python/pocket_tts_bridge.py   # local voice synthesis (batch mode)
├── web/                      # React SPA (Vite) — editor, layout builder, settings
├── scripts/                  # CLI helpers: demo assets, download, render, upload, notify
├── guiones/                  # your scripts (.md) — 001_demo.md ships as an example
├── assets/                   # your media (avatares, fondos_matrix, inputs_top, musica, …)
├── outputs/                  # finished .mp4s (gitignored)
└── temp/                     # intermediates (gitignored)
```

Everything that holds your work is **plaintext and git-friendly**: scripts are Markdown,
config is JSON/`.env`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the details.

---

## 🔐 Privacy & secrets

- Runs **entirely on your machine**. The voice model runs locally; nothing is sent anywhere
  unless *you* enable Drive upload or social publishing.
- Secrets live in **gitignored** files, never in the repo: `.env`, `mail.config.json`
  (IMAP/SMTP), `social.config.json` (IG/TikTok tokens). Copy the `*.example` templates and
  fill them in. Use **app passwords**, not your main ones.

---

## 📄 License

[MIT](LICENSE) — see also the [NOTICE](NOTICE) for attribution and responsible-use terms.
You bring your own media and API credentials; you're responsible for the rights to the
music, clips, images and voices you use, for using voice cloning only with voices you're
authorized to use, and for complying with the terms of Instagram, TikTok, Pixabay and
Hugging Face.
