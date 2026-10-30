# Bangladesh Open World: project instructions

Non-violent, GTA-style open-world browser game set in Bangladesh, starting with Mirpur 10, Dhaka. Later versions add cybersecurity and scam-awareness missions.

## Read first

- `Guide Docs/documents/10_AI_Agent_Project_Constitution.md` for long-term rules.
- `Guide Docs/documents/14_Online_Research_Open_Source_and_Agent_Permissions.md` for research and licensing rules.
- `Guide Docs/character_and_asset_reference_sheets/` for the art direction.
- `tools/blender/ASSET_CONTRACT.md` before touching any 3D asset.

## Scope decision (from the project owner, overrides the docs)

The Guide Docs call the first milestone "walking only". The owner replaced that in chat: v1 includes every vehicle being driveable, taking any vehicle, traffic, traffic lights, traffic police, pedestrians and premium graphics. No missions yet. The docs remain the direction for everything else.

## Rules that never change

- No weapons, combat, blood or injury. Taking a vehicle means the driver steps out peacefully. Vehicle contact makes people hop aside, never harms them.
- Fruit characters only. No eyes, noses or mouths in geometry or texture from any angle. Opaque eyewear on everyone; the owner allows futuristic glasses too. Mango is the hero; NPCs are mixed fruit, male cast for now.
- Bangla first. All strings live in `src/localization/bn.ts`. Have a native speaker review them; Bangla endings differ per word, so never build words by concatenation.
- $0 additional cost. Only original work or properly licensed assets; log them in `docs/ASSET_LEDGER.md`.
- No real brands or logos, and no "GTA" in in-game branding.

## Commands

- `npm run dev` then open http://localhost:5173
- `npm run build` runs the type check and a production build
- `python tools/textures/build_textures.py [asphalt paver marking facade]` regenerates textures
- `blender --background --factory-startup --python tools/blender/build_*.py -- <ids>` regenerates models
- `python tools/textures/build_shops.py` regenerates the shop interior atlas
- `node tools/test/edge.mjs start [vsync|igpu]|goto|eval|shot|canvas|key|stop` drives the game in Edge. Use `vsync` for honest smoothness numbers: with the cap off, the swap chain's own stalls look like game hitches
- `node tools/test/fps_tour.mjs [preset]`, `hitch_probe.mjs [seconds] [car|foot]`, `cost_probe.mjs`, `trace.mjs [seconds]` measure frame times and what causes slow frames
- `node tools/test/soak.mjs [minutes]` runs traffic and crowds with no rendering and reports anything odd
- `node tools/test/entry_check.mjs <dir> <vehicle> [drive|ride]` steps the get-in and get-out sequence and saves frames

## Machine notes

Hybrid laptop: RTX 3050 4 GB plus AMD iGPU. Browsers default to the iGPU unless Windows assigns them to High Performance, so measure FPS with `tools/test/edge.mjs`. Drive E: is nearly full: never save `.blend` files or large intermediates there.

## Architecture

Region data (`src/regions/`) drives everything; systems never name a place. New districts register in `src/regions/registry.ts`. Babylon keeps thin-instance data on the geometry, so never split thin instances across clones of one mesh (see `src/world/props.ts`).
