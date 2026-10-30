# 02 | Product Requirements Document (PRD)

## Scope and delivery model
**M1 walking vertical slice** is the current implementation request. **M2-M5** describe later capabilities but are not authorized work for the first coding prompt. The full first **sandbox release** is a larger effort than M1.

## M1 | Walkable visual vertical slice (current)
| ID | Requirement | Acceptance evidence |
|---|---|---|
| M1-01 | Browser game starts locally from documented commands | `npm run dev` works; `npm run build` succeeds |
| M1-02 | Babylon.js, TypeScript and Vite foundation | Typed source, modular folders, no unlicensed packages |
| M1-03 | Third-person fruit avatar | Avatar visible; forward/back/strafe/rotate; run; appropriate camera |
| M1-04 | Stable movement and collisions | No sinking through streets or walking through test buildings |
| M1-05 | Mirpur 10-inspired street corner | Elevated metro reference, one road intersection, shops, sidewalks, Bangla signage; approximation clearly labeled |
| M1-06 | Consistent visual presentation | Intentional lighting, basic PBR material set, shadows and polished composition even before full assets |
| M1-07 | Graphics quality tiers | Low/Medium/High; selectable and persistent; safe default |
| M1-08 | Performance diagnostics | FPS panel toggle; observed device/browser documented |
| M1-09 | Input and UI | Keyboard/mouse, pause/reset position, loading/unsupported-device messaging |
| M1-10 | No violent mechanics | No weapon, attack, shooting, fighting or combat code/UI |
| M1-11 | Free asset use | Asset ledger stores creator, licence, source and changes |
| M1-12 | Reproducible developer workflow | README, run/build/test commands, meaningful screenshot evidence |

## M2 | Environment foundation
- Replace placeholder environment with authored Blender street kit, optimized textures and believable visual landmarks.
- Introduce district asset streaming and reusable roads, signage, shops and roadside props.
- Add soundscape, day/night lighting *only after* daytime performance is stable.
- Build initial scene accessibility, camera collision and touch control feasibility test.

## M3 | Vehicle interaction
- Enter/exit vehicle interaction, one usable bicycle or CNG initially, followed by cycle rickshaw, battery rickshaw, CNG, motorbike and bus.
- Distinguish *driveable* from *ride-as-passenger* vehicles. A bus need not be player-driveable in its first implementation.
- Simplified arcade-style physics rather than full traffic physics. Camera follows vehicle; no destructive violence.
- Vehicle categories configured from data, not bespoke monolith scripts.

## M4 | Living Dhaka
- Route-based traffic, stops/intersections, crowds, stall activities, male fruit NPCs, Bangla text and short prewritten voice lines where rights permit.
- Basic interactions: greet, ask direction, board a vehicle, inspect a place; avoid live LLM dialogue at first.
- Crowd density and traffic level adapt to device quality tiers.

## M5 | Map expansion
- Add Dhaka districts with unique landmarks and coherent transitions; later Cox's Bazar and Saint Martin's as their own destinations.
- World-select screen, streaming, region loading progress, persistent player state, optional local achievements.
- New regions must not require changing player movement or core engine code.

## Future feature reserved, not implemented
Non-violent cybersecurity/scam/social-engineering stories and investigations. Keep conceptual extension points in docs only. Do not create mission mechanics, fake forms or scoring in M1.

## Non-functional requirements
- **Performance:** targets not guarantees: 60 FPS on capable desktop hardware at appropriate settings; 30 FPS on chosen mid-range mobile targets after mobile support is developed. Profile actual devices. Avoid making universal compatibility promises.
- **Rendering:** optional WebGPU when supported, WebGL fallback; graceful error if minimum GPU/browser capability is absent.
- **Quality:** high-end tier uses enhanced textures, shadows, post-processing and longer draw distances; low tier uses LOD, reduced effects and smaller crowds.
- **Load size:** asset bundles split by district. Budgets established after first profiling; no unverified numerical claims.
- **Localization:** Unicode Bangla fonts, strings outside code, English fallback option planned.
- **Privacy/security:** no account and no collection of personal information in M1; local preferences only.
- **Cost:** no paid infrastructure, map API, TTS API, marketplace asset or payment-card requirement.
- **Accessibility:** pause, adjustable camera sensitivity, readable text, keyboard mapping, future touch controls.

## Release gates
M1 is done only when it builds, a tester can walk around without blockers, the region looks intentional rather than raw primitives, settings work and measured browser performance is recorded. Each later milestone needs its own acceptance checklist.
