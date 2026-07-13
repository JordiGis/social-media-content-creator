#!/usr/bin/env python3
"""
Puente Pocket TTS para video-automation-core.

Genera WAV a partir de texto usando clonación de voz zero-shot con
kyutai-labs/pocket-tts (https://github.com/kyutai-labs/pocket-tts).
El backend de Node lo invoca mediante child_process.

Dos modos
---------
1) Individual (compatible con versiones previas):
     --text-file PATH --output PATH [--voice ...]
2) Lote / batch (un solo proceso, el modelo se carga UNA vez):
     --manifest PATH
   donde PATH es un JSON:
     {"voice": "...", "language": "spanish", "temp": null,
      "items": [{"text": "...", "output": "/abs/seg000.wav"}, ...]}
   El modo batch existe para que un guion con varios planos no recargue el
   modelo por cada plano. La voz (modelo, clon, calidad) es idéntica al modo
   individual: solo cambia que se reaprovecha el modelo y el estado de voz.

salida:
  stdout: una línea JSON por evento -> {"status": "..."} / {"status":"item_done", ...}
  stderr: en error, una línea JSON -> {"error": "...", "kind": "..."}

códigos de salida:
  0 ok | 2 args | 3 import/libs nativas | 4 voz de referencia no encontrada
  5 fallo síntesis | 6 modelo gated (clonación requiere login HF)
"""
import argparse
import array
import json
import math
import os
import sys
import wave


def emit(**kw):
    sys.stdout.write(json.dumps(kw, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def fail(kind, message, code):
    sys.stderr.write(json.dumps({"error": message, "kind": kind}, ensure_ascii=False) + "\n")
    sys.stderr.flush()
    sys.exit(code)


def write_wav(path, sample_rate, floats):
    """Escribe PCM mono int16 desde un iterable de floats en [-1, 1] (sin numpy/scipy)."""
    buf = array.array("h")
    for x in floats:
        if x > 1.0:
            x = 1.0
        elif x < -1.0:
            x = -1.0
        buf.append(int(x * 32767.0))
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(sample_rate))
        w.writeframes(buf.tobytes())


def run_mock(text, output):
    sr = 24000
    # Duración proporcional al texto (entre 1.5 y 20 s) para ejercitar el pipeline.
    dur = max(1.5, min(20.0, len(text) / 16.0))
    n = int(sr * dur)
    write_wav(output, sr, (0.2 * math.sin(2 * math.pi * 220.0 * (i / sr)) for i in range(n)))
    return {"sample_rate": sr, "samples": n, "mock": True}


# --- Modo real (modelo Pocket TTS) -------------------------------------------

def load_model(language, temp):
    """Importa y carga el modelo una sola vez. Códigos: 3 import, 5 carga."""
    try:
        emit(status="import")
        from pocket_tts import TTSModel  # noqa: WPS433 (import diferido a propósito)
    except Exception as e:  # ImportError o librerías nativas del Mac que faltan
        fail(
            "import",
            "No se pudo importar 'pocket_tts'. Instala el entorno local "
            "(recomendado venv en Apple Silicon): pip install pocket-tts. "
            f"Detalle: {type(e).__name__}: {e}",
            3,
        )

    try:
        emit(status="load_model", language=language, temp=temp)
        load_kwargs = {}
        if language:
            load_kwargs["language"] = language
        if temp is not None:
            load_kwargs["temp"] = temp
        try:
            model = TTSModel.load_model(**load_kwargs)
        except TypeError:
            model = TTSModel.load_model(language=language) if language else TTSModel.load_model()
    except Exception as e:
        fail("model", f"Fallo al cargar el modelo Pocket TTS: {type(e).__name__}: {e}", 5)
    return model


def make_voice_state(model, voice):
    """Calcula el estado de voz (clon/catálogo) una sola vez. Códigos: 4, 6, 5."""
    if not voice:
        fail("voice_not_found", "No se indicó voz (archivo de clonación o nombre de catálogo)", 4)
    is_file = os.path.isfile(voice)
    try:
        emit(status="clone_voice" if is_file else "voice",
             voice=os.path.basename(voice) if is_file else voice)
        return model.get_state_for_audio_prompt(voice)
    except Exception as e:
        _maybe_auth_fail(str(e))
        fail("generate", f"Fallo al preparar la voz: {type(e).__name__}: {e}", 5)


def _maybe_auth_fail(msg):
    if "voice cloning" in msg or "accept the terms" in msg:
        fail(
            "auth",
            "La clonación de tu propia voz usa el modelo 'gated' de Pocket TTS. "
            "1) Acepta los términos en https://huggingface.co/kyutai/pocket-tts  "
            "2) Autentícate en local: '.venv/bin/hf auth login' (o exporta HF_TOKEN).  "
            "Alternativa sin login: usa una voz de catálogo (alba, giovanni, lola, jean…). "
            f"Detalle: {msg}",
            6,
        )


def generate_one(model, voice_state, text, output):
    """Sintetiza un texto y escribe el WAV. Devuelve metadatos."""
    try:
        emit(status="generate", chars=len(text))
        audio = model.generate_audio(voice_state, text)

        sr = int(getattr(model, "sample_rate", 24000))
        # audio: tensor torch [canales, muestras] o [muestras].
        if hasattr(audio, "detach"):
            audio = audio.detach().cpu()
        try:
            ndim = audio.dim()  # torch.Tensor
        except AttributeError:
            import numpy as np

            audio = np.asarray(audio)
            ndim = audio.ndim
        if ndim > 1:
            audio = audio[0]  # primer canal (mono)
        samples = audio.tolist()

        write_wav(output, sr, samples)
        return {"sample_rate": sr, "samples": len(samples)}
    except Exception as e:
        _maybe_auth_fail(str(e))
        fail("generate", f"Fallo en la síntesis de voz: {type(e).__name__}: {str(e)}", 5)


# --- Orquestación ------------------------------------------------------------

def run_single(text, voice, output, language, temp, mock):
    if mock:
        emit(status="mock")
        try:
            meta = run_mock(text, output)
        except Exception as e:
            fail("generate", f"Fallo en modo mock: {type(e).__name__}: {e}", 5)
        emit(status="done", output=output, **meta)
        return
    model = load_model(language, temp)
    voice_state = make_voice_state(model, voice)
    meta = generate_one(model, voice_state, text, output)
    emit(status="done", output=output, **meta)


def run_manifest(manifest_path, mock):
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            spec = json.load(f)
    except Exception as e:
        fail("args", f"No se pudo leer --manifest: {e}", 2)

    items = spec.get("items") or []
    if not items:
        fail("args", "El manifest no contiene 'items'", 2)
    voice = spec.get("voice", "")
    language = spec.get("language", "english")
    temp = spec.get("temp")

    emit(status="batch", count=len(items))

    if mock:
        emit(status="mock")
        for i, it in enumerate(items):
            try:
                meta = run_mock(it["text"], it["output"])
            except Exception as e:
                fail("generate", f"Fallo en modo mock (item {i}): {type(e).__name__}: {e}", 5)
            emit(status="item_done", index=i, output=it["output"], **meta)
        emit(status="done", count=len(items))
        return

    model = load_model(language, temp)
    voice_state = make_voice_state(model, voice)  # una sola vez para todos los planos
    for i, it in enumerate(items):
        meta = generate_one(model, voice_state, it["text"], it["output"])
        emit(status="item_done", index=i, output=it["output"], **meta)
    emit(status="done", count=len(items))


def main():
    p = argparse.ArgumentParser(description="Puente Pocket TTS")
    p.add_argument("--text-file", dest="text_file")
    p.add_argument("--manifest")
    p.add_argument("--voice", default="")
    p.add_argument("--output")
    p.add_argument("--language", default="english")
    p.add_argument("--temp", type=float, default=None, help="temperatura de muestreo (def modelo 0.7)")
    p.add_argument(
        "--mock",
        action="store_true",
        default=str(os.environ.get("POCKET_TTS_MOCK", "")).lower() in ("1", "true", "yes"),
    )
    args = p.parse_args()

    if args.manifest:
        run_manifest(args.manifest, args.mock)
        return

    if not args.text_file or not args.output:
        fail("args", "Faltan --text-file y --output (o usa --manifest)", 2)

    try:
        with open(args.text_file, "r", encoding="utf-8") as f:
            text = f.read().strip()
    except Exception as e:
        fail("args", f"No se pudo leer --text-file: {e}", 2)

    if not text:
        fail("args", "El texto a sintetizar está vacío", 2)

    run_single(text, args.voice, args.output, args.language, args.temp, args.mock)


if __name__ == "__main__":
    main()
