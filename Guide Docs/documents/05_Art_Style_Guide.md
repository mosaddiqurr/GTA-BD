# 05 | Art Style Guide and Visual Quality Bar

## Direction
**Stylized realism:** believable Bangladesh architecture, roads, materials, scale and light with intentionally stylized fruit-humanoid people. Goal: a polished indie/open-world game, not generic shapes, mismatched stock assets or an AI-generated collage. Consistency beats raw polygon count.

## Visual hierarchy
1. Landmark silhouette and composition: recognizable at a distance.
2. Character readability: distinct fruit species + outfit even without faces.
3. Mid-distance texture/material variety: aging plaster, tile, concrete, metal, painted shop signs.
4. Small details: rickshaw art, wires, posters, shop goods, umbrellas and lamps only where they add identity.
5. Clear playable routes: do not overcrowd the path merely to imitate congestion.

## Strict character design rules
- Fruit bodies and non-human silhouettes. No modeled or painted eyes, mouths or noses. No face-shaped texture artifacts.
- Opaque sunglasses/visors may cover face zone. Mask, beard, cap, helmet, scarf and glasses allowed as separate geometry.
- Male characters only in the first roster, but meshes and skeletons must be reusable for future variety. Do not treat this as a permanent restriction on the engine.
- Main mango hero: iconic silhouette, premium clothing/outfit materials, animated hands/feet, clean joints.
- NPC species variations: banana, pineapple, orange, watermelon, guava, coconut, papaya, lemon, jackfruit, date and others. Coordinate limb proportions and rig standard so movement animation can be reused where feasible. Mango remains the main hero identity, not the default species for every NPC.
- Character emotion through posture, pace, gestures, arm positions, voice and costume, never facial features.

## Bangladesh clothing and local identity
Panjabi, shirts, trousers, lungi, waistcoat, workwear, aprons, safety vests, casual jackets and role-appropriate local footwear where appropriate. Shopkeeper, tea seller, commuter, driver, office worker, elderly man, street vendor and security guard variants. Respectful representation without creating one stereotyped look for all NPCs.

Accessory rule: do not treat headphones as a default accessory. For many Bangladesh roles such as traditional dress characters, tea stall owners, shopkeepers, elderly men, religious-style characters and most drivers, headphones should normally be absent. Prefer caps, topi, gamcha, scarf, beard, apron, satchel, sunglasses or visor, sandals and simple bags. Headphones may be used sparingly for selected students or modern urban youth only.

## Vehicles
Pedal rickshaw, battery rickshaw, CNG auto-rickshaw, bus, bicycle, motorbike. Authored recognizable silhouettes with correct category differences. Hand-painted rickshaw art should be original/licensed, not copied from arbitrary web photographs.

## Material, lighting and post effects
- Use PBR workflow (albedo/base color, roughness, normal, metallic only when meaningful). Real-world-ish scale and consistent texel density.
- High tier: clean soft shadows, screen-space effects only if profiling allows, improved anti-aliasing, better environmental reflections, rich atmosphere without distracting bloom.
- Medium tier: balanced shadows and textures with reduced effects and LOD distances.
- Low tier: simple shadow path, reduced texture sizes, fewer drawn props and stable frame pacing.
- Author around daylight first; rainy/evening modes after daytime quality is proven.
- A single polished reference street scene becomes the look-development benchmark for every new region.

## Environmental asset kits
- Dhaka: metro modules, concrete pillars, mixed-use storefronts, flat roofs, overhead cables, balconies, shutters, signs, tea stalls, sidewalks and market props.
- Cox's Bazar: beach-front roads, sand/shore/sea kit, resorts/shops, vegetation and water shading.
- Saint Martin's: island huts/buildings as appropriate, jetty/boats, coast vegetation and controlled small-scale geometry.

## LOD and export rules
Hero assets have highest fidelity; distant buildings use simplified LODs, repeatable modular facades and atlased textures. Blender -> clean UVs/scale/pivots/animation -> GLB/glTF -> runtime. Check normal direction, collisions and hierarchy before commit. Compression may be added after browser compatibility testing.

## Visual acceptance review
Capture same camera position at High/Medium/Low and on two test devices; check silhouette, readability, consistent shading, no floating objects, no broken Bangla font, no screen-space noise and adequate framerate. Reject random asset-style mixing even if individually impressive.
