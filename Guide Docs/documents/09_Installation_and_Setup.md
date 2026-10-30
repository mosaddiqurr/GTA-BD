# 09 | Installation and Local Development Setup

## Already owned
- **Blender:** installed. Keep it; no second copy needed.
- **Codex and Claude subscriptions:** available to help code and create design iterations. No additional paid AI service assumed.

## Install now (Windows or your chosen development OS)
1. **Node.js 24 LTS** from https://nodejs.org/en/download (or another supported maintained LTS matching your Vite release). It includes npm. Verify: `node --version` and `npm --version`.
2. **Git** from https://git-scm.com/downloads . Verify: `git --version`.
3. **VS Code** from https://code.visualstudio.com/ if you want a local editor; another editor is fine.
4. **Chrome or Edge** from official site for browser graphics testing. Firefox as a second browser.
5. **Blender** is already installed, so do not reinstall.

## No need to install right now
Paid game engine, Unreal Engine, Unity, PostgreSQL, Docker, hosting accounts, payment card, map API key, Blender plugins, GIS application, external AI NPC model, speech/voice API or mobile build toolchain.

## Recommended first commands (in your chosen work folder)
```bash
npm create vite@latest bangladesh-open-world -- --template vanilla-ts
cd bangladesh-open-world
npm install
npm install @babylonjs/core @babylonjs/loaders
npm run dev
```
These commands establish a starter project; the coding agent will implement the 3D scene and player controller. Verify the current Vite/Node requirements at https://vite.dev/guide/ before running.

## Suggested second development commands
```bash
npm run build
npm run preview
```
Type checking is normally included in the starter build script; check `package.json` rather than assuming it is.

## Git initialization
```bash
git init
git add .
git commit -m "chore: initialize browser game foundation"
```
Configure Git author name/email locally if Git asks. Do not commit API keys, credentials or large unlicensed reference photo collections.

## Blender practical checklist
Set meters, create one hero placeholder and one metro pillar, export as GLB with consistent units. Keep source `.blend` in a separate asset-source directory. Test model import in browser before building many models. Use a consistent skeleton for NPC variants.

## Browser and hardware cautions
A desktop webpage may open on a phone but still be too slow to play. Mobile touch controls and mobile-friendly asset bundles are separate development work. WebGPU support varies; use WebGL fallback. Do not claim all devices are supported until measured.

## $0 cost controls
Avoid paid map tiles, Google Maps billing, asset shops, subscription sound libraries, cloud hosted AI/NPC features and paid backend. For public hosting review static host storage, bandwidth, traffic limits and any terms; free tiers are not unlimited. OSM raw data is open with licence obligations, but its public tile servers are not a free mass game API.

## Additional free tools and integrations
Claude/Codex may research, download and test reputable free development tools, open-source Blender add-ons, package managers, modelling utilities and agent skills if beneficial. Check safety, terms and commercial reuse rights first; do not install bundled paid services or run remote installer scripts without review. Track every new tool and version in the project README. See `14_Online_Research_Open_Source_and_Agent_Permissions.md`.
