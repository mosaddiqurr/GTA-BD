# Asset contract: Blender to game

Everything here is what the game's TypeScript code expects. Do not rename things.

Blender: `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe` (5.2 LTS).
Run headless: `blender --background --factory-startup --python tools/blender/<script>.py -- <args>`.
From PowerShell use `&`; from the Bash tool use `"/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"`.
Helpers live in `tools/blender/bo_common.py` (loft, tube_path, box, cylinder, uv_sphere,
subsurf, solidify, join, pbr, add_noise_color, add_bump, add_plaid, smart_uv, bake_pbr,
export_glb, preview_render). Read it first. Extend it only by adding new functions, because
other scripts share it; do not change the behaviour of existing ones.

## Art direction

Stylized realism for a premium Bangladesh open-world game. Think high-end animated-film
props at game-camera distance, never primitive-looking or toy-like. Reference boards are in
`Guide Docs/character_and_asset_reference_sheets/` (S01 style, S02 hero, S03 NPCs,
S05 buildings, S06 vehicles, S07 props, S08 materials). They are concepts: follow their spirit
and silhouettes, do not copy text or logos from them.

Quality comes from:
- believable real-world proportions and silhouettes, researched from what the object is
- rounded, bevelled, subdivided forms (no raw cubes; every hard edge gets a bevel or subsurf)
- material variety: procedural noise, wear, dust, scratches, fabric weave, baked ambient occlusion
- small authentic details that make it read as Bangladeshi

Never: copied brand logos, real company names, Bangla text baked into textures (Blender cannot
shape Bangla; signs are added at runtime via the empties below), weapons of any kind.

## Conventions

- 1 unit = 1 metre. Z up. Origin on the ground, centred on the asset.
- Everything faces Blender **-Y**. The asset's own right side is Blender **-X**.
- Bangladesh drives on the LEFT, so steering wheels are on the vehicle's right (Blender -X).
- Bake each asset down to ONE PBR material with `bo.smart_uv` + `bo.bake_pbr` (separate glass or
  alpha-cut leaf materials are the only exceptions) so each asset is about one draw call.
- Export with `bo.export_glb` (WEBP textures). No cameras or lights in GLBs.
- Disk is tight (E: has about 500 MB free in total, shared). Never save `.blend` files or
  intermediates on E:. Put all preview renders and temp files in the scratchpad directory given
  in your brief. Clean up `public/assets/_smoke` if you see it.
- Three agents run at once on one 4 GB GPU. If a bake fails with out-of-memory, wait and retry.
  Render previews small (480-640 px, 24-32 samples).

## Review loop (required)

After building an asset, render it with `bo.preview_render` from 2-3 angles and actually look at
the PNG using the Read tool. Fix what looks wrong or cheap, then re-render. Do not report an asset as
done without having looked at it. Report honestly anything you were not able to make look good.

## Characters: `public/assets/characters/<id>.glb`

Fruit people. **Absolute rule: no eyes, no nose, no mouth, no eyebrows, no face-like marks, in
geometry or texture, from any angle.** Glasses are optional: some of the cast wear opaque eyewear
(sunglasses, aviators, wrap visors, futuristic shades), and traditional dress and working roles
usually have a plain fruit face.
Male cast only. Chunky mascot proportions: big fruit head about 40% of total height, stubby limbs,
chunky hands with thumb plus 3 thick fingers, separate shoes/sandals.

Skeleton, exact bone names, one armature object named `rig`:
`root, hips, spine, chest, head, upperarm.L, forearm.L, hand.L, upperarm.R, forearm.R, hand.R,
thigh.L, shin.L, foot.L, thigh.R, shin.R, foot.R`
- `.L` is the character's own left (Blender +X). Parented in the obvious chain; `root` at the ground, `hips` parented to
  root, `spine`>`chest`>`head`; arms parent to `chest`; thighs parent to `hips`.
- Rest pose: relaxed A-pose, arms about 35 degrees down from horizontal, legs straight down, standing on z=0.
- The game animates bones in code, so do NOT author animation actions.
- One skinned mesh object named `body` holding everything (clothes, head, accessories) with one
  baked material. Weights blended smoothly at joints; accessories rigid to their bone.
  Long garments (lungi, panjabi) weighted between hips and both thighs so they do not tear.
- Budget: hero about 14k tris, NPCs about 7-10k tris. Texture: hero 1024, NPCs 768-1024.
- Heights: hero 1.40 m; NPCs 1.25-1.60 m, varied.

## Vehicles: `public/assets/vehicles/<id>.glb`

Real-world scale. Node names (mesh objects unless noted):
- `body`: everything that does not move, one baked material.
- `glass`: optional separate mesh for car/microbus/bus/truck windows, material named `glass`, alpha blended,
  so the driver is visible. Simple interior (seats, dashboard, steering wheel) lives in `body`.
- `wheel_FL, wheel_FR, wheel_RL, wheel_RR`, or `wheel_F, wheel_R` for two-wheelers, or `wheel_F, wheel_RL, wheel_RR`
  for three-wheelers. Each is its own object with its origin on the axle centre; the game spins it about
  its local X. Same material as body.
- `steer`: optional object for parts turning with the steering (handlebars, fork, mudguard), origin on
  the steering axis. For two- and three-wheelers `wheel_F` is parented to `steer`.
- Doors: cut out afterwards by `tools/blender/build_doors.py`, each its own object with its origin on the
  hinge. `door_D`, `door_DL` the driver's on the right and left; `door_P`, `door_PL` the passengers'; `door_P2`
  the second leaf of the bus's door. A pane of glass in a door is the same name plus `_glass`.
- Empties (plain empty objects exported as nodes):
  `seat_driver` at the character's hips position, `seat_p1`, `seat_p2`... for passengers,
  `exit_L`, `exit_R` on the ground just beside the driver where the character stands after getting out,
  `plate_F`, `plate_R` where number plates go (a 0.32 x 0.16 m quad will be placed there, facing the empty's -Y for
  plate_F and +Y for plate_R), `light_FL, light_FR, light_RL, light_RR` for lamps,
  `route_F` (bus and microbus only, front destination board, 1.2 x 0.25 m).

Parented empties are fine; the game looks them up by name. Empties must export (select them too).

Colour variants: for vehicles with variants, also write extra albedo files
`public/assets/vehicles/<id>__<variant>_albedo.webp`, baked from the same UVs, and list them in the manifest.

Write `public/assets/vehicles/manifest.json`:
`{ "<id>": { "length": m, "width": m, "height": m, "wheelbase": m, "wheelRadius": m, "seatPose": "...",
"variants": ["default", ...] } }`
`seatPose` is one of `ride_bicycle`, `ride_motorbike`, `pedal_rickshaw`, `sit_drive`, `sit_bus`.

Vehicle ids: `bicycle, rickshaw, easybike, cng, motorbike, car_sedan, microbus, bus_city, truck`.
Budgets: bicycle/motorbike 8-12k tris, rickshaw/easybike 12-18k, cng 10-14k, car/microbus 10-14k,
bus/truck 14-20k. Textures 1024 (bus and truck 2048 allowed). File size under 3 MB each.

## Props and landmarks

See the props brief. Same one-material rule. Each is a static GLB, origin on the ground.
`public/assets/props/<id>.glb`, `public/assets/landmarks/<id>.glb`. File size targets: small props under 300 KB,
stalls under 800 KB, landmarks under 3 MB.
