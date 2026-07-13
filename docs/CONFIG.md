# Configuration reference (`.env`)

All tunables are environment variables, read in `src/config.js`. Copy `.env.example` to
`.env` and edit. Everything has a sensible default — you can run with an empty `.env`.

## Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | Backend (Express) port. Vite's dev server is always `5173`. |

## Pocket TTS (voice)

See [VOICE.md](VOICE.md) for the full story.

| Variable | Default | Description |
|---|---|---|
| `PYTHON_BIN` | `python3` | Python interpreter with `pocket-tts` (use `.venv/bin/python`). |
| `POCKET_TTS_LANGUAGE` | `spanish` | `english` · `french` · `german` · `portuguese` · `italian` · `spanish`. |
| `POCKET_TTS_DEFAULT_VOICE_FILE` | *(empty)* | Default reference voice if a script sets none. |
| `POCKET_TTS_TEMPERATURE` | *(empty ⇒ model ≈0.7)* | Sampling temperature; higher = livelier. |
| `POCKET_TTS_MOCK` | `0` | `1` = generate a tone without loading the model. |

## FFmpeg & render quality

| Variable | Default | Description |
|---|---|---|
| `FFMPEG_PATH` | `ffmpeg` | Path to the binary (Apple Silicon Homebrew: `/opt/homebrew/bin/ffmpeg`). |
| `RENDER_FPS` | `30` | Output frame rate. |
| `RENDER_CRF` | `20` | x264 quality (lower = better/bigger). |
| `RENDER_PRESET` | `medium` | x264 speed/size preset. |
| `RENDER_TAIL_PADDING` | `0.6` | Seconds of "tail" after each shot's voice, so cuts aren't abrupt. |

## Avatar (floating overlay)

| Variable | Default | Description |
|---|---|---|
| `AVATAR_BOX` | `600` | Max avatar width/height in px. |
| `AVATAR_BOUNCE_AMP` | `20` | Bounce amplitude in px (`y = base + AMP·sin(2π·FREQ·t)`). |
| `AVATAR_BOUNCE_FREQ` | `1.5` | Bounce frequency in Hz. |

## Background music

| Variable | Default | Description |
|---|---|---|
| `MUSIC_VOLUME` | `0.18` | Music gain under the voice (0..1). |
| `MUSIC_FADE` | `1.2` | Fade in/out per track, in seconds. |

## Subtitles

Only drawn if the layout has a `subtitle` element (its box sets position/size). Style is
global here; rendered SVG→PNG via `rsvg-convert`.

| Variable | Default | Description |
|---|---|---|
| `RSVG_PATH` | `rsvg-convert` | Path to the librsvg binary. |
| `SUBTITLE_REVEAL` | `wipe` | `wipe` = written left→right · `none` = appears at once. |
| `SUBTITLE_HOLD` | `0.5` | Seconds the full chunk holds after the wipe. |
| `SUBTITLE_MAX_WORDS` | `4` | Words per subtitle chunk. |
| `SUBTITLE_FONT` | `Helvetica, Arial, sans-serif` | Font family. |
| `SUBTITLE_FONT_SIZE` | `60` | px on the 1080-wide canvas. |
| `SUBTITLE_WEIGHT` | `800` | Font weight (100–900). |
| `SUBTITLE_COLOR` | `#ffffff` | Text fill. |
| `SUBTITLE_STROKE_COLOR` | `#000000` | Outline color. |
| `SUBTITLE_STROKE_WIDTH` | `7` | Outline width in px. |
| `SUBTITLE_LINE_HEIGHT` | `1.18` | Line height (× font size). |
| `SUBTITLE_UPPERCASE` | `false` | `true` = UPPERCASE subtitles. |

## Stock downloads (Pixabay)

See `scripts/descargar.mjs` and the **Descargas** tab.

| Variable | Default | Description |
|---|---|---|
| `PIXABAY_API_KEY` | *(empty)* | Free key from pixabay.com/api/docs. Without it, only direct file links download. |
| `DESCARGAS_CANDIDATOS` | `4` | Candidate clips downloaded per card. |

## Google Drive (rclone)

See [PUBLISHING.md](PUBLISHING.md#google-drive).

| Variable | Default | Description |
|---|---|---|
| `RCLONE_PATH` | `rclone` | Path to the rclone binary. |
| `DRIVE_REMOTE` | `drive` | Name of your configured rclone remote. rclone stores remotes in your machine-global `~/.config/rclone/rclone.conf`, not in this project — so if a remote named `drive` already exists, the app shows "connected". Point this at your own remote, or a non-existent name to keep Drive off. |
| `DRIVE_FOLDER` | `SocialMediaContentCreator` | Destination folder inside that Drive. |
| `DRIVE_AUTO` | `0` | `1` = upload the mp4 automatically after each render. |

## Social publishing

Tokens are **not** here — they live in `social.config.json`. See [PUBLISHING.md](PUBLISHING.md).

| Variable | Default | Description |
|---|---|---|
| `SOCIAL_DEFAULT` | `instagram,tiktok` | Networks pre-checked in the Publish button. |
| `IG_GRAPH_VERSION` | `v21.0` | Meta Graph API version. |

## Email (optional)

Credentials live in `mail.config.json` (copy `mail.config.example.json`). Only set these if
your provider doesn't follow the `imap.<domain>` / `smtp.<domain>` pattern:

| Variable | Default | Description |
|---|---|---|
| `SMTP_HOST` | *(derived from IMAP host)* | Force the SMTP host. |
| `SMTP_PORT` | `465` | `465` = implicit SSL · `587` = STARTTLS. |
