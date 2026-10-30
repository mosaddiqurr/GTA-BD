# 08 | Development Roadmap, Milestones and Testing

## Build principles
One working vertical slice at a time. Avoid setting unrealistic dates before measuring team capacity and computer/GPU capability. Every milestone requires screenshots, recorded performance and a reproducible build. Do not prematurely implement future phases.

## Milestones
| Stage | Deliverable | Definition of done |
|---|---|---|
| P0 | Documentation + repo | Baseline docs, assets licence ledger, local starter setup |
| P1a | Browser 3D foundation | Scene launches, camera, ground, settings, FPS and resize work |
| P1b | Player movement | Fruit avatar walks/runs, collisions, camera follow, recovery and animations work |
| P1c | Mirpur visual slice | One compelling metro/road/shop street block, consistent lighting/materials and Bangla signs |
| P1d | Quality and cross-browser gate | Low/Med/High tested, build passes, desktop browser coverage and recorded FPS |
| P2 | Expand walkable block | Additional roads/buildings, improved ambient sound and region chunk boundary |
| P3 | Vehicles | One functional mount/ride/exit system, then multiple Bangladesh vehicle categories |
| P4 | Living city | Traffic routes, crowds, male fruit NPCs and written/recorded Bangla lines |
| P5 | Additional Dhaka destinations | Region transitions and recognizable landmark districts |
| P6 | Coast/island destinations | Cox's Bazar and Saint Martin's independently loadable worlds |
| Future | Non-violent investigation stories | Story/mission design separately approved and implemented later |

## P1 prioritized work order
1. Repo bootstrap and run/build scripts.
2. Technical smoke tests (rendering API, scene draw, input, animation, browser diagnostics).
3. Avatar motor + camera + collisions.
4. Mirpur geometry and visuals (metro/intersection/shop block).
5. Quality presets and optional profiling.
6. Test, refactor, document evidence, tag release.

## Performance test matrix
- **Desktop:** latest stable Chrome, Edge and Firefox on real available laptop/PC. Record OS, RAM, GPU, resolution, browser, preset and median FPS across a fixed 60-second route.
- **Mobile later:** Android Chrome and iOS Safari on representative test devices. Touch and quality differences explicitly recorded, not assumed.
- **Conditions:** cold load, repeat load, camera facing dense street, rapid turns, resize, low preset, shadows on/off and re-entry after pause.
- **Goals:** desktop-capable 60 FPS at an appropriate preset and mobile 30 FPS on selected supported devices after mobile phase. Targets subject to actual measured hardware.

## Visual QA
Reference camera shots: street-level hero view, wide intersection, metro underside, Bangla shop signs, character close-up and high/medium/low comparison. Review movement foot sliding, shadow artifacts, collision, pop-in, perspective and scene cohesion.

## Usability study (early)
Ask 5-10 testers to play without instructions. Measure time to move, camera trouble, number of stuck events, whether Mirpur/Dhaka feels recognizable and voluntary interest in further exploration. Test acceptance matters more than AI-generated screenshots.

## Evidence to save
- Running browser scene with recognizable local features.
- Fruit avatar during walking/running.
- FPS/settings overlay with actual device notes.
- Build/test terminal success.
- Source and licence ledger.

## Release failure conditions
Build breaks; black-screen initial load; movement cannot be completed; multiple serious collision failures; assets have unclear rights; the game only works on the developer's machine with undocumented workarounds; visuals remain unpolished placeholders at a 'visual slice' release gate.
