# Adonis Engine
> A dynamic, AI-powered character generator and immersive roleplay environment that synthesizes detailed personas, renders visual portraits, and simulates authentic text-message interactions.

## Overview
Adonis Engine operates as a comprehensive suite for character creation and interactive simulation. At its core, it procedurally generates highly specific physical, psychological, and biographical traits from a vast internal dataset. It then interfaces with generative AI models to synthesize photographic or 3D portraits matching the canonical profile. Users can iteratively refine the character's visual appearance through a chat-based interface. Finally, the system loads the generated persona into an immersive text-messaging module, allowing users to engage in dynamic, in-character roleplay driven by strict behavioral rules and deep psychological profiling.

## Key Features
* **Procedural Persona Synthesis:** Automatically generates highly detailed, multi-dimensional character profiles encompassing physical traits, psychological frameworks, and deep lore.
* **Dual-Mode Studio Interface:** Features a Visualizer workspace for iterative, prompt-driven image generation and a Chat interface for real-time, in-character text messaging.
* **Context-Aware Multimodal AI Integration:** Leverages generative AI APIs to simultaneously drive image synthesis and strict persona-adherent text generation while maintaining a persistent canonical ground truth.

## Technical Architecture
* **Frontend/UI:** React 18, Tailwind CSS, Babel (Standalone via CDN)
* **Backend/Logic:** Google Generative AI (Gemini v1beta REST API)
* **Infrastructure/Hardware:** Static HTML/JS hosting, Client-side execution

## Setup & Deployment

### Windows (local)
1. Clone the repository.
2. Double-click `launch.bat` in the repo root. It serves the folder on [http://localhost:8080/](http://localhost:8080/) and opens your browser. (Requires Python 3 or Node.js. Do not open `index.html` as a file — the app must be served over HTTP.)
3. Open Settings and paste a Google Gemini API key.
4. Click **Roll Character**.

### Any OS
Serve the repo root with any static web server (`py -m http.server 8080`, `python -m http.server 8080`, or `npx serve`), then open the printed localhost URL.

### GitHub Pages
Enable Pages on branch `main` / root (`/`). Relative paths work as-is. Do not commit API keys.

Sessions auto-save in the browser (IndexedDB). Use Settings → Saves for named slots and JSON export/import.
