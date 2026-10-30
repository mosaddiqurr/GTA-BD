# 04 | World and Map Design

## World model
The game is a **collection of connected playable regions**, not one continuously rendered nationwide mesh. A destination has a stable ID, one or more district scenes, asset packs, road/footpath data, spawn points, ambient sound and local lighting settings. A transport/world-map transition loads the next region.

## Current playable region: Dhaka / Mirpur 10
**Purpose:** show distinctive urban identity and third-person movement in a compact area. **Initial art target:** approximately one memorable intersection plus adjoining roads and shops; use an estimated ~300 m x 300 m as planning scale, subject to reference and performance studies, not a surveying commitment.

### Mirpur 10 visual anchors
- Mirpur 10 metro station/viaduct silhouette and columns.
- Busy road geometry, bus/CNG/rickshaw presence (static in M1; animated later).
- Street-facing commercial shops with Bangla shopfront signs and awnings.
- Footpaths, roadside sellers, shade, hanging wires and intersection detail where appropriate.
- A clear scenic view with recognizable density but navigable pedestrian paths.

**Accuracy tiers:** (A) landmark silhouette and placement relationships; (B) road/metro structure; (C) representative urban street details; (D) fictionalized/repeated filler facades. Do not promise exact measurement-level fidelity.

## Dhaka expansion system
Candidates, not commitments: additional Mirpur sections, Gulshan/Banani, Dhanmondi, Old Dhaka, metro corridor, parks and waterfront. Landmark candidates include National Parliament House, Central Shaheed Minar, Lalbagh Fort, Ahsan Manzil and Sadarghat. Verify exact location boundaries and the rights/permissions for detailed representations before production. The National Martyrs' Memorial is in **Savar**, outside Dhaka city proper; consider it a greater-Dhaka trip rather than an in-city district.

**Selection rubric per candidate (score 1-5):** recognition, uniqueness, walkable gameplay, accessible reference photos, asset reuse, rendering cost, legal/ethical constraints and suitability for an explorable public realm. Use this to decide order later instead of hard-coding the user's examples.

## Cox's Bazar future region
Independent coastal region with beach promenade, sand, surf audio, seaside commerce, tourist transport, vegetation and local building kit. New tech needed: water shader, longer views and shore transitions. Distinct from crowded Dhaka street kit.

## Saint Martin's Island future region
Independent, smaller island-region; beaches, boat landing, coastal vegetation and biodiversity-sensitive representation. Consider ecological sensitivity and up-to-date access rules before any documentary claims. The real island is environmentally sensitive; game activity should not encourage harmful real-world behavior.

## World travel later
User can choose unlocked region or take a ride/boat/bus to another region with short loading presentation. Same player identity and settings persist; vehicle state may be region-scoped. Distances need not be physically simulated in real time.

## World-content schema (illustrative)
```json
{
  "regionId": "dhaka",
  "displayNameBn": "ঢাকা",
  "displayNameEn": "Dhaka",
  "districts": ["mirpur10"],
  "spawnDistrict": "mirpur10",
  "artPack": "urban_dhaka_v1",
  "qualityVariants": ["low", "medium", "high"]
}
```

## Source accuracy and rights
OSM roads and geography can be a starting point, but ODbL compliance and attribution are mandatory; do not assume that OSM includes complete or current detailed 3D buildings. Public photos are references for understanding the place and **not automatically licensed textures**. Never copy commercial Google Maps/Street View 3D data, imagery or copyrighted logos into the game without permission. Use self-authored or explicitly licensed assets.

## Research capture template
For each region: source links, capture date, visual feature, expected asset, accuracy confidence, rights status, reviewer, approximate location and reference snapshot rights. Start Mirpur 10 with a shot list: elevated metro corner, shopfront, street-level view, pedestrian route, sign style, rickshaw artwork and pavement materials.
