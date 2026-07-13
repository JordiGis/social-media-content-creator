# Script format (`guiones/*.md`)

Scripts live in `guiones/` as Markdown. You normally **won't edit them by hand** — the
visual editor reads and writes this format for you — but understanding it helps, and it's
what makes your work diff-friendly in git.

A script has two parts:

1. **Front-matter** (YAML between `---`) — global defaults + the narrator voice.
2. **Body** — split into **shots** (`planos`) by lines starting with `@@`.

## Example

```markdown
---
titulo: "AI and the future of development"
descripcion: "Short explainer. #ai #dev"     # used as the caption when publishing
avatar_default: neutral.png
fondo_default: fondo.mp4
video_top_default: video_top.mp4
archivo_voz_clon: alba          # GLOBAL voice — same for every shot
---

@@ nombre: Intro
   layout: avatar_arriba
   musica: intro.mp3
Did the US government just hit the brakes on the new AI?

@@ nombre: Breaking
   avatar: nervioso.png
   fondo: matrix_rojo.mp4
Yes. And they mean it.

@@ nombre: Wrap
The text that hangs under a shot's directives, up to the next @@, is its voice line.
```

## Front-matter keys

| Key | Meaning |
|---|---|
| `titulo` | Script title (shown in the editor; part of the publish caption). |
| `descripcion` | Description / hashtags. Becomes the caption `.txt` and the IG/TikTok text. |
| `avatar_default` | Default avatar for shots that don't set their own. |
| `fondo_default` | Default background clip. |
| `video_top_default` | Default top clip. |
| `archivo_voz_clon` | **Global narrator voice** — a catalog name or a `.wav` in `assets/voces_referencia/`. Never per-shot. |

## Shot (`@@`) keys

Each shot starts with a `@@` line. Per-shot keys can go **one per indented line** under the
`@@`, or **several on the `@@` line separated by `|`**:

```markdown
@@ nombre: Breaking | avatar: nervioso.png | fondo: matrix_rojo.mp4
Yes. And they mean it.
```

| Key | Meaning | Inherits default? |
|---|---|---|
| `nombre` | Shot label (editor only). | — |
| `avatar` | Avatar image for this shot. | Yes (`avatar_default`) |
| `top` | Top clip for this shot. | Yes (`video_top_default`) |
| `fondo` | Background clip for this shot. | Yes (`fondo_default`) |
| `layout` | Layout template id (e.g. `avatar_abajo`, `avatar_arriba`). | Yes (global default) |
| `musica` | Music track — **special rules below**. | **No** |
| `duracion` | Fixed length in seconds (for shots with no voice, or to force a minimum). | — |

The **voice line** is everything after the shot's directives, up to the next `@@`. A shot
with `duracion` but no text is a **silent/mute shot** (it holds the frame, no TTS).

> Keys equal to the global default are **omitted** on save, to keep the `.md` clean. So a
> shot that just uses defaults may show no directives at all — that's expected.

## Music rules (important — music does **not** inherit)

Music behaves like a continuous track, not a per-shot property:

| `musica` value | Effect |
|---|---|
| *(empty)* | **Continue** the previous shot's track (seamless). |
| a filename (e.g. `intro.mp3`) | **Change** to that track from this shot on. |
| `none` / `silencio` / `off` / `-` | **Stop** the music. |

Contiguous shots on the same track are fused into one continuous run, so a track started in
shot 1 keeps playing across shots 2–4 without restarting.

## Numbers & the voice ("punto")

The voice engine reads a literal `.` in "4.8" as a pause/abbreviation. When writing version
numbers **in the spoken text**, spell out the dot as the word **"punto"** so it reads
naturally:

> `Opus 4 punto 8`, `GPT 5 punto 1`, `Sonnet 5`

(This only matters for the spoken body text, not for titles or filenames.)

## Backwards compatibility

A script with **no `@@` lines** (an old single-block script) is treated as **one shot** using
the global defaults. You don't need to migrate old scripts.

## Where the format is defined

`src/segments.js` is a **pure module with no Node dependencies**, imported by both the
backend and the React frontend. That's deliberate: the editor and the renderer share one
source of truth for the `@@` format, so they can never disagree about what a script means.
