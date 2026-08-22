# Adonis Engine

v2.4.0 — a static, GitHub Pages–compatible studio that rolls a detailed adult male persona, paints a portrait with Gemini, then drops you into a texting roleplay.

Legal adults only. Do not commit API keys.

## What it does

1. **Roll Character** — dice a trait sheet from `data/descriptors.json`, then Gemini writes inner life and a structured visual prompt. Optional **character concept** (the box under Visualizer / Chat) steers vibe and job; **Settings → Fantasy** is hard canon for age, opener, heat, and who he’s texting.
2. **Visualizer** — generate / iterate a photo or 3D portrait. Detail Editor is for post-roll tweaks, not the initial roll.
3. **Chat** — in-character SMS roleplay using the rolled profile, kinks/wounds, opener, heat, and your persona.

Sessions autosave in this browser (IndexedDB). History keeps the last 12 portraits. Named slots and JSON export/import live under Settings → Saves.

## Fantasy settings (Roll + Chat)

Set these before you roll. They persist in `localStorage` (`adonis_fantasy`).

| Control | Effect |
| --- | --- |
| **Age lock** | Restricts the dice age bracket, blocks “looks younger” modifiers for Prime/Daddy/Silver, and is hard canon for the portrait and psychology pass (beats a concept that implies a different age). |
| **Heat** | Slow burn / flirty / filthy — wardrobe energy on the portrait and pacing in chat. |
| **Opener** | Strangers, dating-app, wrong number, dad’s friend, professor, boss, neighbor — shapes backstory, attire, and first-message context. |
| **You** | Name, age, what he calls you, notes — canon for how he pursues you. Not drawn in the portrait. |
| **Daddy preset** | Age 36–59, dad’s friend, filthy. |

Dossier row locks and per-trait reroll still work. A locked age that sits outside the current age lock is ignored on the next roll.

## Setup

### Windows (local)

1. Clone the repo.
2. Double-click `launch.bat` in the root. It serves the folder on [http://localhost:8080/](http://localhost:8080/) and opens your browser. (Python 3 or Node.js. Do **not** open `index.html` as a file.)
3. Settings → paste a Google Gemini API key.
4. Optionally set Fantasy, then **Roll Character**.

### Any OS

Serve the repo root (`py -m http.server 8080`, `python -m http.server 8080`, or `npx serve`) and open the printed localhost URL.

### GitHub Pages

Enable Pages on branch `main` / root (`/`). Relative paths work as-is.

## Stack

React 18 + Tailwind + Babel Standalone (CDN). Gemini `generateContent` from the browser (`js/gemini.js`). No bundler, no server of your own. Default text model is `gemini-2.5-flash`; Gemini 3 / Interactions-only IDs are skipped, with fallbacks if Google rejects the first choice.
