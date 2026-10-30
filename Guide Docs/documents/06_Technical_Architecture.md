# 06 | Technical Architecture Document

## Chosen starting stack
- **Frontend runtime:** TypeScript and Babylon.js.
- **Build/dev:** Vite with npm, Node.js 24 LTS recommended as a stable compatible baseline as of Oct 2026.
- **3D authoring:** Blender (already installed); export `.glb`/glTF.
- **Data:** versioned JSON/TypeScript schemas; **local** browser storage for settings and basic save state.
- **Hosting:** local dev initially; a free static host may be evaluated with real bandwidth/asset limits before public deployment.
- **Testing:** TypeScript checks, build checks, smoke checks, screenshot/manual QA across browsers. Introduce an automated browser test runner once basic interactions are stable.

## External library and tool policy
The development agent may proactively research public websites, GitHub/GitLab and free open-source projects to find the strongest compatible, maintainable implementation of rendering, controls, animation, optimization, region loading and audio. Review security, package health, browser compatibility, licensing and size. Pin dependencies when practical and record used source/commit/licence. Do not run unreviewed scripts or silently introduce a paid hosted service. See `14_Online_Research_Open_Source_and_Agent_Permissions.md`.

## Why Babylon.js first
Strong browser-based 3D renderer, scene graph, animations, materials and WebGL/WebGPU support. It supports modern high-quality techniques, but results depend primarily on asset craft, scene design and optimization. Review engine only after a working prototype is benchmarked.

## Compatibility and rendering strategy
- Try WebGPU on supported devices only if stable and tested; use WebGL2 fallback for broad reach. Decide rendering backend **at initialization**, not via untested hot-swap.
- Never promise universal device support. When unsupported, display a clear message and offer a lighter/static alternative if feasible.
- Low/Medium/High/Auto quality presets; default to Auto after capability checks and measure frame performance. Manual override.
- High-end desktop gets quality shadows, enhanced materials/effects and longer draw ranges. Mobile favors stable performance and lower memory.
- Touch controls and safe-area adaptation are a later supported target; M1 keyboard/mouse must work.

## Suggested directory layout
```text
src/
  app/                 # bootstrap, settings, loading, error states
  engine/              # Babylon engine init and render loop
  player/              # avatar controller, input and camera
  world/               # region loading, scene contracts, spawn points
  regions/dhaka/mirpur10/
  graphics/            # presets, LOD, lighting, materials
  ui/                  # pause/options/FPS overlay
  vehicles/            # future
  npc/                 # future
  localization/        # Bangla-first strings
  data/                # JSON schemas/registries
public/assets/regions/dhaka/mirpur10/
public/assets/characters/
docs/
```

## Region interface (proposed)
```ts
type RegionManifest = {
  id: string;
  displayNameBn: string;
  displayNameEn: string;
  entryScene: string;
  spawnPoints: Record<string, [number, number, number]>;
  assetBundles: { low: string[]; medium: string[]; high: string[] };
  environmentProfile: string;
};
```
Never use one hardcoded `if (mirpur10)` chain throughout the project. Load future districts via a registry. Keep runtime systems reusable across regions.

## Asset streaming and memory
- Start with just one Mirpur street chunk in M1.
- Later split regions into chunks/tiles with bounding boxes; load close chunks and release distant ones. Keep important landmark silhouettes in lower-detail distance representations.
- Use mesh instancing and shared materials for repeat items; texture atlases and LOD. Avoid hundreds of independently animated crowds at once.
- Create debug counters for draw calls, FPS and active scene objects; set practical budgets after hardware measurements.

## Player and physics
- Separate player input, camera rig, character motor/collision and animation state.
- Basic movement collision M1 can use lightweight scene collision; vehicle physics later can use tested browser-compatible physics library.
- Update movement in a fixed or delta-time-safe way; clamp extreme frame delays.
- Vehicle and NPC modules must not be dependencies of the M1 player core.

## Persistence
M1: local preferences and optionally last spawn point. Save-data version field. Future: player/region travel state and richer local save. No backend, account, cloud sync, telemetry or paid DB at initial stages.

## Failure and test conditions
Unsupported graphics API, lost WebGL context, no audio permission, asset loading errors, browser tab hidden, resize and low-memory behavior. UI must fail gracefully. Avoid blocking the entire page with a black screen and no explanation.

## Open issues / investigation spikes
- Real browser/device performance with one visually polished block.
- Bangla font glyph readability and text rendering route.
- WebGPU vs WebGL2 stability for chosen target devices.
- Whether a web installer/PWA or desktop wrapper later improves distribution without new paid costs.
- Licensing for exterior landmark reproductions, original street photos, sound recordings and derived map data.
