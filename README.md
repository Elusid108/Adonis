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
1. Clone the repository and serve the root directory using any standard static web server (e.g., Node's `http-server` or Python's `http.server`).
2. Open `index.html` in a modern web browser.
3. Navigate to the Settings panel within the application UI and input a valid Google Gemini API Key.
4. Click "Roll Character" to initialize the procedural generation and AI synthesis pipeline.