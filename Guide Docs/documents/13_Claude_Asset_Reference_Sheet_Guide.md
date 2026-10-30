# 13 | Claude Asset Reference Sheets: What to Prepare

**Goal:** Give Codex/Claude a precise, consistent art brief for high-quality 3D assets. A *reference sheet* is usually a labelled collection of images and design specifications. It is **not** itself a rigged model or a texture atlas. Reference images alone will not reliably produce production-ready GLB models.

## The 9 sheets I recommend

| ID | Sheet | What it must contain | When |
| --- | --- | --- | --- |
| `S01` | **Visual North Star** | 4–8 images defining world/character visual quality, materials, lighting, camera perspective and things to avoid; one short style statement | **Before any 3D asset** |
| `S02` | **Mango Hero Turnaround** | Front, left/right side, back, 3/4 view and T/A-pose; dimensions, visor, clothes, shoes, colors, silhouette, no facial anatomy | **Before hero modelling** |
| `S03` | **Fruit NPC Lineup** | At least 8 different male fruit NPCs using mixed fruit species, each with role, name/species, outfit, accessories, silhouette, heights, beard/visor variants; no facial features. Headphones only where culturally appropriate and never as a default | NPC phase; one early example helps align style |
| `S04` | **Mirpur 10 Place and Layout** | Rights-cleared real-world photos with capture date/source, intersection shape, road width estimates, metro, sidewalk, key identifiable views, annotated map sketch | **Before environment modelling** |
| `S05` | **Dhaka Buildings and Landmarks** | Metro station/pillars, shops, office/residential facades, signage, street-scale dimensions and detailed facade closeups | **Before environment modelling** |
| `S06` | **Vehicles of Bangladesh** | Pedal rickshaw vs battery rickshaw, CNG, bus, cycle and motorbike, front/side/back/3/4 views, scale and signature details | Vehicle phase; silhouettes can be set early |
| `S07` | **Street Props and Shopfronts** | Tea stalls, benches, kettle, cups, cart, umbrellas, utility poles, overhead wires, road barriers, signs in correct Bangla and common props | Environment polish |
| `S08` | **Materials, Light and Camera** | PBR references for concrete, asphalt, metal, paint and cloth; color palette; 3 lighting/time-of-day examples; target third-person gameplay screenshots | **Before look-development** |
| `S09` | **Animation and Audio Identity** | 6–8 pose frames for idle/walk/run/turn/interact; voice casting thumbnails, approved Bangla scripts, location ambience diagram | Animation and NPC/audio phases |

## Minimum reference pack for the first Codex/Claude build

Only **four core pages** are required before the walking Mirpur 10 prototype. S03 is an optional NPC-direction reference for later phases:

1. `S01_Visual_North_Star.png` - one coherent target style and 2–3 counterexamples of what not to produce.
2. `S02_Mango_Hero_Turnaround.png` - one hero from consistent angles with no eyes, mouth or nose.
3. `S04_Mirpur10_Place_and_Layout.png` - labelled views of the intersection/metro/shops plus a basic road sketch.
4. `S08_Materials_Lighting_Camera.png` - consistent materials and camera look for a polished street scene.

Optional early art reference: `S03_Fruit_NPC_Lineup.png` - a culturally appropriate Bangladeshi mixed-fruit NPC cast with restrained accessory use. Use it when beginning NPC work, not as a prerequisite for the first walking build.

Add `S05` as the next priority if the resulting Mirpur environment is too generic. Do not block basic character movement while waiting for all reference sheets.

## How to lay out each sheet

**Suggested canvas:** 1920 x 1080 px for overview sheets or 2048 x 2048 px for character turnarounds. Use these as design defaults, not requirements imposed by the engine.

Header: `Sheet ID | Game | Region | v0.x | Date`.  
Main area: 4–10 clear, unwatermarked, permitted images or original sketches.  
Annotations: precise labels, scale/relative dimensions, material names, short do/don't notes.  
Footer: `Source links / creator / permission / captured date` plus `Approved by` / `Revision notes`.

**For a character turnaround**, keep the SAME character with SAME clothes, proportions and visor in every view. Show front, side, back and a neutral rigging pose. Avoid giving Claude unrelated AI images with conflicting shapes.

**For a location sheet**, label which pictures show real Mirpur 10 and which are aesthetic mood references. Annotate landmarks and preferred player camera compositions. Never treat OpenStreetMap road geometry as a source of accurate 3D buildings, and never copy Google/Street View geometry or imagery into the shipped game without the applicable rights.

**For a vehicle sheet**, separate pedal rickshaw from battery rickshaw. They are not the same vehicle, so they need distinct silhouettes, geometry and animations. Give dimensions or measured estimates when possible.

## Shared art constraints to paste into every Claude asset task

> Create an original, production-oriented 3D asset for a high-quality browser-based, third-person Bangladesh exploration game. Match the attached approved reference sheets in scale, silhouette, palette, PBR material quality and stylized-realistic art direction. Do not add eyes, noses or mouths to any fruit character, including textured, stylized or hidden features. Use an opaque visor/glasses where appropriate. Initial NPC roster is male only. No combat or weapons. Target Blender source and optimized GLB export; maintain proper topology, pivots, units, collisions and reusable animations where applicable. Do not copy protected brands or third-party 3D models. Do not invent landmark details beyond what the references support. Tell me what was actually modelled, what is placeholder and what still needs manual Blender review.

## Reference packet folders

The bundled PNG files use these exact names:

```text
reference_sheets/
  S01_VISUAL_STYLE_and_QUALITY.png
  S02_MANGO_HERO_CHARACTER.png
  S03_MALE_FRUIT_NPC_CAST.png
  S04_MIRPUR_10_ENVIRONMENT.png
  S05_BUILDINGS_and_LANDMARKS.png
  S06_BANGLADESH_VEHICLE_FLEET.png
  S07_STREET_PROPS_and_CULTURE.png
  S08_MATERIALS_and_LIGHTING.png
  S09_ANIMATION_and_AUDIO_CUES.png
```

S03 was regenerated to include different fruit species and culturally appropriate role-specific accessories. Use these sheets as art direction. AI-generated labels, signs and location details must be checked against real-world references before implementation.

## Research permission for asset production
Agents may browse public reference sites, open-source repositories and free Blender add-ons or materials as needed to produce higher-quality original models. Compare references and verify sources, model licences and attribution before reuse. Inspect public automation scripts and agent skills before execution. Research does not authorize copying protected images/textures/meshes, purchasing assets or accessing restricted systems. See `14_Online_Research_Open_Source_and_Agent_Permissions.md`.

## Rules for using Claude and Codex

- The sheet is a *brief*, not proof of a finished playable asset. Ask for a Blender `.blend` master and a browser-ready `.glb` only when you are actually ready to create that asset.
- Have Claude first inspect the images, produce an asset checklist and point out missing views. Then implement **one asset at a time** and show rendered front/side/gameplay views for approval.
- Preserve consistency: same character and geometry across views; no shifting logo/clothing/color from angle to angle.
- Use visual references as inspiration or permitted documentation, not as authorization to reuse copyrighted 3D meshes, logos or photographic textures.
- Reject outputs that only look good in a rendered still but have broken topology, no usable collision, extreme polygon count or unusable rigs.
- Keep a ledger of origin, rights, dimensions, `.blend` source, `.glb` export, texture size and review status.

## Asset acceptance questions

1. Does it read as recognizably Bangladeshi at gameplay-camera distance?
2. Does its art style match the agreed S01/S08 look?
3. Are the character's prohibited facial features absent in ALL views?
4. Can we import, animate, collide with and view the GLB in the actual browser build?
5. Does it maintain usable frame rate on the target preset and device?
6. Can we prove we have rights to every reference, texture and sound used?


### S03 cultural accuracy rules

- Do not make all NPCs mango. Use a believable mixed-fruit population.
- Do not place headphones on traditional or everyday Bangladesh roles by default.
- Good common accessories: cap, topi, gamcha, scarf, beard, apron, satchel, sunglasses or visor, sandals.
- Headphones are acceptable only for some students or modern youth variants.
