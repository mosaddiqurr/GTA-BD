# 03 | Game Design Document (GDD)

## Current core loop (M1)
Start browser -> load district -> control fruit avatar -> walk/explore a memorable street -> inspect environmental detail -> change camera/quality -> repeat. There are **no missions or score** yet.

## Core camera and movement
- Third-person orbit camera, over-the-shoulder or slightly elevated. Mouse drag/relative movement; default camera collision to avoid clipping into walls.
- WASD/arrow walking, Shift run, Space optional jump only if implemented cleanly; Esc pause, R recover/reset stuck position.
- Character has deliberate turning/acceleration and synchronized walk/run/idle animation. Avoid foot sliding.
- No damage, combat, punching or attack controls. Vehicle contact must stop/block or gently reset rather than become a violence system.

## Player persona
One protagonist fruit (mango as the leading candidate), full body and limbs. Never display eyes, mouth or nose; opaque visor or eyewear. Silhouette and animation convey expression. NPCs must not all be mango. Use a mixed-fruit cast across the city so the world feels socially and visually diverse.

## Vehicle experience (later)
| Category | Role | Interaction goal | Notes |
|---|---|---|---|
| Bicycle | Player ride | Mount, steer, pedal, brake, dismount | First low-cost vehicle candidate |
| Pedal rickshaw | Driver or passenger | Ride or choose destination | Painted back panel and canopy detail |
| Battery rickshaw | Passenger/driver as tested | Hop in/out, steer if supported | Differentiated from pedal rickshaw |
| CNG auto-rickshaw | Passenger initially, optional driving later | Hail, board, travel | Distinct green body and geometry |
| Bus | Passenger initially | Board/exit at stops | Dense traffic and local bus culture |
| Motorbike | Player ride later | Mount, steer, brake, dismount | Safety-oriented non-violent driving |

## NPC system (later)

NPC roster rule: the playable hero may remain mango, but general NPCs must use multiple fruit species such as banana, guava, coconut, papaya, orange, lemon, watermelon, jackfruit, date and pineapple. Avoid a one-species city.
- Initial cast: male fruit people of different species, heights, outfits, headwear, eyewear, beard silhouettes and body language.
- Facial rule: never model eyes/nose/mouth; avoid accidental facial features from textures or shadows.
- NPC states: idle, walk route, wait at crossing, browse stall, converse, board vehicle, react to obstruction.
- Cultural styling rule: role-appropriate clothing and accessories must match ordinary Bangladesh street life. Do not default to headphones for all NPCs. Headphones may appear only on appropriate modern roles such as some students or younger urban characters.
- Dialogue: short curated Bangla text lines plus optional rights-cleared recordings. Conversation trees are deterministic and offline by default.
- Intentional cultural range: tea stall vendor, commuter, shopkeeper, rickshaw driver, student, office worker and street-food vendor. Avoid stereotypes.
- Do not implement dynamic chatbot NPCs in the initial release.

## Environmental storytelling
Road markings, Bangla shop signs, metro pillars, overhead cables, tea stalls, seating, signage and variable street textures should make the place identifiable without reading a location label.

## Audio (later, after basic walking works)
Layer buses/horns carefully, rickshaw bells, street conversations, birds, engines, tea stall activity and environmental ambience. Include master/effects/voice sliders, and silence/volume options. No copyrighted commercial audio. The detailed plan is in `08A_Bangla_Voice_Dialogue_and_Audio_Design.md`; do not add TTS or NPC voices during the walking-only P1 build.

## Interactions (later)
Context-sensitive short prompt when near a supported object, clear enter/exit vehicle animation, safe collision and visible feedback. Interaction system must be general and not hard-coded to each object.

## UX and settings
Simple title/loading screen, play/pause, device compatibility and settings. Low, medium and high quality; camera sensitivity and audio. Do not clutter the screen with quest markers before missions exist.

## Future non-violent narrative system
Eventually NPCs may initiate scam-awareness and cyber-safety investigation stories. Mechanics should use dialogue, examining clues and evidence-based choices, not fighting or weapon use. No implementation now.
