# Voice (Pocket TTS)

The narrator voice is generated **locally** by [Pocket TTS](https://huggingface.co/kyutai/pocket-tts)
(`kyutai-labs/pocket-tts`), a zero-shot voice-cloning TTS that runs on CPU. It's spawned per
render by `src/pockettts.js` → `python/pocket_tts_bridge.py`, and it loads **once per render**
to synthesize every shot in one batch.

The voice is **global**: one narrator for the whole video, set by `archivo_voz_clon` in a
script's front-matter (or the global default in Settings).

## Install

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r python/requirements.txt
```

Set `PYTHON_BIN=.venv/bin/python` in `.env` so the app finds this interpreter without you
activating the venv each time.

## Three ways to voice a script

### 1. Mock (no model at all)

```bash
POCKET_TTS_MOCK=1 pnpm dev
```

Generates a **tone** instead of speech — great for testing the pipeline without downloading
the ~1GB model. Also settable as `POCKET_TTS_MOCK=1` in `.env`.

### 2. Catalog voice (no login) — recommended to start

Set `archivo_voz_clon` to a catalog name:

```
alba, lola, giovanni, jean, vera, eve, …
```

These work with **no Hugging Face login**. The base model downloads on first use. Pick the
language with `POCKET_TTS_LANGUAGE` (`spanish`, `english`, `french`, `german`, `portuguese`,
`italian`).

### 3. Clone your own voice (gated model)

Put a clean **~20-second `.wav`** of your voice in `assets/voces_referencia/` and set
`archivo_voz_clon` to that filename (e.g. `narrator.wav`).

Cloning uses a **gated** model, so once you must:

1. Accept the terms at <https://huggingface.co/kyutai/pocket-tts>.
2. Authenticate, either:
   - `.venv/bin/hf auth login`, or
   - put `HF_TOKEN=hf_xxx` in `.env`.

After that, cloning works offline like any other render.

## Tuning

| `.env` var | Default | Effect |
|---|---|---|
| `POCKET_TTS_LANGUAGE` | `spanish` | Language model. |
| `POCKET_TTS_DEFAULT_VOICE_FILE` | *(empty)* | Fallback voice if a script sets none. Empty = require it per script. |
| `POCKET_TTS_TEMPERATURE` | *(model default ≈ 0.7)* | Higher = livelier / more varied delivery. |
| `POCKET_TTS_MOCK` | `0` | `1` = tone instead of the model. |

## Bridge exit codes

`python/pocket_tts_bridge.py` emits one JSON line per event on stdout; on failure it prints a
JSON line on stderr and exits with a specific code — handy when debugging:

| Code | Meaning |
|---|---|
| `3` | Python libraries missing (reinstall `python/requirements.txt`). |
| `4` | Reference voice file not found. |
| `5` | Synthesis failed. |
| `6` | Gated model needs a Hugging Face login (see cloning, above). |
