# Bangladesh Open World: project instructions

Non-violent, GTA-style open-world browser game set in Bangladesh, with Mirpur 10, Gulshan and Dhanmondi in Dhaka so far. Later versions add cybersecurity and scam-awareness missions.

## Read first

- `Guide Docs/documents/10_AI_Agent_Project_Constitution.md` for long-term rules.
- `Guide Docs/documents/14_Online_Research_Open_Source_and_Agent_Permissions.md` for research and licensing rules.
- `Guide Docs/character_and_asset_reference_sheets/` for the art direction.
- `tools/blender/ASSET_CONTRACT.md` before touching any 3D asset.

## Scope decision (from the project owner, overrides the docs)

The Guide Docs call the first milestone "walking only". The owner replaced that in chat: v1 includes every vehicle being driveable, taking any vehicle, traffic, traffic lights, traffic police, pedestrians and premium graphics. No missions yet. The docs remain the direction for everything else.

## Rules that never change

- No weapons, combat, blood or injury. Taking a vehicle means the driver steps out peacefully. Vehicle contact makes people hop aside, never harms them.
- Fruit characters only. No eyes, noses or mouths in geometry or texture from any angle. Glasses are optional (owner's decision, overrides the docs): some wear opaque glasses, and traditional dress and working roles usually have a plain fruit face. Mango is the default hero; NPCs are mixed fruit, men, women and children.
- A man's voice for men and boys, and only a woman's voice for women and girls. Never a man's voice for a woman or the other way round: text alone is better, and that's what women have until a woman's voice model is approved. The owner wants free AI voices, not recordings, and they must sound natural.
- Bangla first. All strings live in `src/localization/bn.ts`. Have a native speaker review them; Bangla endings differ per word, so never build words by concatenation.
- $0 additional cost. Only original work or properly licensed assets; log them in `docs/ASSET_LEDGER.md`.
- No real brands or logos, and no "GTA" in in-game branding.

## Commands

- `npm run dev` then open http://localhost:5173
- `npm run build` runs the type check and a production build
- `python tools/textures/build_textures.py [asphalt paver marking facade]` regenerates textures
- `blender --background --factory-startup --python tools/blender/build_*.py -- <ids>` regenerates models
- `python tools/textures/build_shops.py` regenerates the shop interior atlas
- `python tools/textures/build_outfits.py` regenerates the crowd's extra outfits from each character's albedo
- `http://localhost:5173/?region=dhaka_gulshan` opens a district directly, for testing
- `node tools/test/edge.mjs start [vsync|igpu]|goto|eval|shot|canvas|key|stop` drives the game in Edge. Use `vsync` for honest smoothness numbers: with the cap off, the swap chain's own stalls look like game hitches
- `node tools/test/fps_tour.mjs [preset]`, `hitch_probe.mjs [seconds] [car|foot]`, `cost_probe.mjs`, `trace.mjs [seconds]` measure frame times and what causes slow frames
- `node tools/test/frame_cost.mjs [frames]` gives what each system spends per frame. It barely moves when other programs are busy, so it separates a real slowdown from outside load
- `node tools/test/feel_probe.mjs [vehicle ids]` measures how steadily a vehicle sits on screen while driving
- `node tools/voice/extract_lines.mjs <lines.json>`, then `D:/bow-voice/venv/Scripts/python.exe -I tools/voice/generate.py <lines.json> <model dir> <work dir> public/assets/voice` regenerates voices after dialogue changes; anything already made is skipped. The tools live on D: because C: and E: are nearly full
- `node tools/test/soak.mjs [minutes]` runs traffic and crowds with no rendering and reports anything odd
- `node tools/test/solid_check.mjs [seconds]` counts overlaps, throws every vehicle at walls, walks the hero about at random
- `node tools/test/handling.mjs [vehicle ids]` measures acceleration, stopping, grip, slide and stability on an empty plane
- `node tools/test/stage_a.mjs <dir> [region]` walks through doors, lifts, towing, rain, night closures, Eid and shift crowds, and saves pictures
- `node tools/test/edge.mjs sized <w> <h> "<js>" [file]` runs something at another window size. The size only lasts as long as that one connection
- `node tools/test/entry_check.mjs <dir> <vehicle> [drive|ride]` steps the get-in and get-out sequence and saves frames

- `node tools/test/stage_b.mjs <dir> [mission talk friends scams jobs extras rain]` walks through Stage B in the game and saves pictures
- `node tools/test/missions_auto.mjs [first] [last]` runs every story mission by itself, in its own district
- `tools/test/session.mjs` is one open connection to Edge for scripts that do many things: spawning a process per step fails when the machine is busy

## Plan

`docs/ROADMAP.md` lists every stage, holding both the owner's requests and what the docs still require. Work one stage at a time and report after each.

## Machine notes

Hybrid laptop: RTX 3050 4 GB plus AMD iGPU. Browsers default to the iGPU unless Windows assigns them to High Performance, so measure FPS with `tools/test/edge.mjs`. Drive E: is nearly full: never save `.blend` files or large intermediates there.

Measure with `tools/test/edge.mjs start vsync`, and close any other copy of the game first, including the app's browser pane: a second copy costs real frames. The owner often has heavy programs open, such as Premiere Pro. Check before believing an FPS drop, and never close their programs.

## Architecture

Region data (`src/regions/`) drives everything; systems never name a place. Districts load one at a time: going to another one reloads the page, with the journey waiting in session storage (`src/app/travel.ts`) and money and purchases in local storage (`src/app/save.ts`). Anything raised above the street, like the footbridge, station floors and flyover, is a strip in `City.decks`. On a deck, the rails and `Decks.solid` keep people in, not the street's colliders, and anything checking people or vehicles against each other must compare heights. Anything the player can interact with registers a source with `Interactions` (`src/interaction/`), so prompts and keys stay the same everywhere. New districts register in `src/regions/registry.ts`. Babylon keeps thin-instance data on the geometry, so never split thin instances across clones of one mesh (see `src/world/props.ts`).

Insides of buildings are real geometry far off the map at x > 4000 (`src/world/interiors.ts`), each with a door from `Doors`. While the hero's inside, `Doors.outX/outZ` is what traffic and streaming are told, so the street carries on. The physics of the vehicle being driven is `Vehicle.stepBody`, stepped at 240 Hz; every knock anywhere is `bang()` in `trafficSystem.ts` and `Vehicle.push`; `ROAD.grip` is what the rain lowers. Anything that needs moving often and isn't a person or vehicle goes through `PropWorld.setInstance` and `flushMoves`.

Missions (`src/missions/`) are async scripts on `Kit`: each `await` holds until that thing has happened, and failing throws. Keep the writing form `k.person("id"...)`, `k.talk(name, [o(...), h(...)])` and `k.call("id", ...)`, because `tools/voice/extract_lines.mjs` reads who says what from it. Conversation text is `src/dialogue/` as Bangla and English pairs; `T(line)` picks the language and the voices always read the Bangla. English lays `src/localization/en.ts` over `bn` at startup. Blocks fill their gaps in `City.fillGaps`, one plan per block kind. Save data for all of it is `LifeData` in `src/app/life.ts`.

Things that cost real frames if undone: the draw list in `Game.frame` is rebuilt every frame so nothing switched on goes undrawn. `PostStack.setGrade` writes exposure and contrast directly, because the public setters rebuild the effect and dirty every material. Light values reach frozen materials through `Environment.thaw`, not by unfreezing them. Baked crowd clips must not change speed while playing: drive them by position instead, as `Person.phase` and `Vehicle.pedalPhase` do. Each outfit needs its own copy of the geometry, because thin instances live on it. Anything spoken with numbers needs its spoken form listed in `tools/voice/extract_lines.mjs`, or it falls back to the browser's voice.
