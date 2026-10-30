# 07 | Asset Production, Blender Workflow and Licensing

## General approach
Create a reusable Bangladesh-themed 3D asset library in Blender. Buy no assets. Reference photos may inform shape and materials but must not be extracted or used as game textures without rights.

## Asset ledger schema
`asset_id, type, region, file_path, author, source_url, licence, attribution_required, attribution_text, modification_notes, LOD_count, texture_size, reviewed`
All third-party assets must be approved in the ledger before use.

## Initial asset inventory (M1)
| Priority | Asset | Scope |
|---|---|---|
| P0 | Mango hero | One fruit body, visor, limbs, simple rig, idle/walk/run |
| P0 | Road kit | Intersection, sidewalk, kerb, crosswalk and asphalt materials |
| P0 | Metro reference | Elevated rail beam and columns + recognizable station facade silhouette (fictionalized detail allowed) |
| P0 | Shops/buildings | 3-5 modular storefront styles + upper floors |
| P0 | Bangla text | Legal placeholder shop names, typeface and correct shaping |
| P1 | Tea stall | Bench, kettles, cups, counter, awning |
| P1 | Static vehicle props | CNG, rickshaw, bus silhouette as static reference only |
| P1 | Street detail | Wires, signs, lamps, shutters and bins |
| P2 | Environmental sound | Self-recorded/rights-cleared only, later |

## Workflow for every Blender model
1. Gather own or permitted references and note location/date.
2. Block out to world scale (meters), correct navigation clearance and main silhouette.
3. High-quality geometry for near assets; modular geometry for repetition.
4. UV unwrap and prepare textures/PBR materials; ensure consistent palette/texel density.
5. Rig/animate character assets; test idle/walk/run transitions.
6. Create collision geometry and simplified LODs (as needed).
7. Export GLB and verify orientation, units, normals, texture links and animation names in a Babylon test viewer.
8. Screenshot at gameplay camera, profile draw calls/FPS and iterate.
9. Register source/creator/licence and the final asset version.

## Open-resource sourcing is encouraged
Research publicly available high-quality Blender workflows, 3D reference packs, permissively licensed models, shaders, animation rigs, texture libraries and asset-generation scripts. Search the wider web and GitHub instead of working from memory. Quality should improve through legitimate reuse and adaptation, but **public access does not equal redistribution permission**. Keep the asset ledger with authors, links, licence and credits; inspect add-ons/scripts before executing. Do not import copyrighted Google map textures/geometry or assume an AI-generated reference proves real Mirpur geometry. The full agent permission policy is in `14_Online_Research_Open_Source_and_Agent_Permissions.md`.

## Tool suggestions ($0)
- Blender for meshes, UVs, animation and rendering reference sheets.
- GIMP/Krita for painting and texture corrections if necessary.
- Audacity for editing self-recorded or appropriately licensed audio later.
- Kenney and Quaternius for prototype material only after checking each specific pack licence; keep visual style coherent.
- OpenStreetMap for geographic data with required attribution/ODbL checks. Do not scrape copyrighted map tiles or Google 3D imagery.

## Distinct region asset packs
**Urban Dhaka:** metro, shopfront, traffic furniture, towers, rickshaws, street stalls. **Coastal Cox's Bazar:** water, beach materials, vehicles, low-rise tourism buildings, plants. **Saint Martin's:** shoreline, dock/boat, vegetation and island architecture. Share core player/NPC/material systems, not every environmental asset.

## Quality gates
Reject assets with random scale, missing textures, broken normals, unlicensed imagery, visible facial features on fruit people, jagged silhouette at main view or disproportionately high memory cost. Polished means coherent and playable, not the largest polygon count.
