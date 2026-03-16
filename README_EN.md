# Litemora | Playable Schematic Worlds

[中文](README.md) | English

Litemora is an **ultra-elegant, minimalist** web-based 3D gallery dedicated to showcasing and exploring Minecraft architectural schematics. 
We focus on transforming rigid building files into **immersive, playable worlds** that you can physically walk through, utilizing native Minecraft resource packs for authentic visual fidelity.

<div align="center">
  <img src="https://raw.githubusercontent.com/shichien/Litemora/main/public/og.jpg" width="800" alt="Litemora Banner" />
</div>

> **Live Preview**: [https://litemora.art/](https://litemora.art/)
> **Design Language**: Dark mode, refined typography, Afilmory gallery aesthetic

---

## Core Highlights

Litemora has evolved entirely from its early "RPG combat demo" origins into a **pure exhibition space for architectural projections**.

1. **Native Rendering Fidelity**  
   Flawless parsing of Minecraft block models, combined with custom shaders to bring resource packs to life with stunning lighting.
2. **Multi-format Support (3+ Formats)**  
   Reads `.litematic` and other schematics directly on the client. Zero server rendering cost—pure frontend performance.
3. **First-Person Exploration**  
   Don't just look at a model. Step inside with first-person controls, experiencing true collision and physical presence within the architecture.
4. **Creator Spaces**  
   Instantly claim a dedicated URL (e.g., `litemora.art/your-space`) to serve as your personal architectural portfolio.

---

## Tech Stack

Powered by cutting-edge frontend technologies, prioritizing both performance and premium aesthetics:

- **3D Engine**: [Three.js](https://threejs.org/) (v0.172+)
- **UI Framework**: [Vue 3](https://vuejs.org/) + [Tailwind CSS](https://tailwindcss.com/)
- **State Management**: [Pinia](https://pinia.vuejs.org/)
- **Internationalization**: [Vue-i18n](https://vue-i18n.intlify.dev/) (CN & EN support)
- **Authentication**: GitHub OAuth for protecting private gallery spaces

---

## Local Development Guide

Litemora uses modern package managers and build tools.

### Requirements

- **Node.js**: 20.x or above (LTS recommended)
- **Package Manager**: `pnpm` is highly recommended (repo contains `pnpm-lock.yaml`)

### Installation & Running

```bash
# 1. Clone the repository
git clone https://github.com/shichien/Litemora.git
cd Litemora

# 2. Install dependencies
pnpm install

# 3. Start the dev server
pnpm dev
```
Once started, visit the Vite local address (usually `http://localhost:5175`).

### Server-Side OAuth Deployment (Cloudflare Pages)

If you intend to host the application and enable the "Create Space" feature, configure the following secrets on your server:
- `OAUTH_GITHUB_CLIENT_ID`
- `OAUTH_GITHUB_CLIENT_SECRET`
- `LITEMORA_SESSION_SECRET`

When deploying to Cloudflare Pages, add these to **Settings -> Environment variables**. Make sure `_SECRET` keys are never prefixed with `VITE_` to avoid leaking to the client.

---

## Architecture & Conventions

1. **Decoupled UI & 3D**:  
   `src/vue/` is strictly for gorgeous DOM interactions. All 3D rendering happens inside the `src/js/experience.js` singleton. Use Pinia and `mitt` for data sync.
2. **Styling Direction**:  
   Dark, low-saturation palettes with gold accents (`#040404`, `#d4af37`), driven by CSS Custom Properties. Typography heavily relies on the elegant *Playfair Display* serif. Avoid heavy component libraries; hand-craft the CSS.
3. **Resource Management**:  
   Voxel data can be massive. Strict garbage collection is required for textures and `BufferGeometry` to prevent memory leaks.

---

## License

This project is open-sourced under the **AGPL-3.0-only** license. See the [LICENSE](LICENSE) file for details.
If you use Litemora's code for commercial purposes or host a public service, you **must** open-source your modifications and backend.

*“Where schematics become playable worlds.”*
