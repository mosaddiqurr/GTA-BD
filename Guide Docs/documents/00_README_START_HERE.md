# Bangladesh Open World | Project documentation v0.3

**Status:** Planning baseline v0.3, 30 October 2026. **Working title:** Bangladesh Open World (not a final brand).

## The vision in one paragraph
Build a high-quality, non-violent, third-person 3D open-world game that lets players discover recognizable places in Bangladesh as stylized fruit characters. Begin with a browser-based, walkable Mirpur 10 prototype in Dhaka. Expand to a living Dhaka with vehicles, crowds, markets and Bangla conversations. Later create distinct destinations including Cox's Bazar and Saint Martin's Island, and other cities selected after testing. Cybersecurity, scam and social-engineering stories are a **future module**, not part of the first playable build.

## Non-negotiable rules
- No fighting, shooting, weapons, violent combat or GTA-style criminal missions.
- All playable and non-player characters are **fruit-based**. **No eyes, mouths or noses**. Opaque glasses/visors, clothing, beards and body language supply personality. Male NPC models only in the first release; system must allow future roster expansion.
- Bangla-first identity: signs, voice/short text dialogue, transport, street commerce, sounds and architecture.
- Graphics must have a consistent polished art direction; do not settle for generic primitive-looking models as the final look.
- Browser-first. Graphics presets and fallback path; **not** a promise that identical visuals will run on all devices.
- Zero **additional** paid tools, asset purchases, subscriptions, API keys or cloud bills. Existing Codex and Claude subscriptions may assist development.
- First playable area: Mirpur 10. Future areas are **candidate regions, not a fixed map contract**.
- World and code must remain modular so district and regional content can be added later.
- **Standing research permission:** Agents may proactively explore public websites, GitHub/GitLab, public AI skills and free open-source projects to find better solutions. Licence/security checks, attribution, local milestone scope and the $0 rule still apply. Read `14_Online_Research_Open_Source_and_Agent_Permissions.md`.

## What is and is not in milestone 1
**In:** Vite + TypeScript + Babylon.js starter, single 3D Mirpur-inspired sample street block, one temporary or stylized fruit character, third-person camera, walking/running, collision, lighting, keyboard controls, responsive UI, graphics settings, performance counter, working browser build, simple tests and documentation. One polished street corner is more valuable than a huge gray box city.

**Out:** driving, traffic simulation, multiple districts, NPC dialogue, missions, combat, AI API, logins, server, multiplayer and full-map streaming. They are planned, not part of the first task.

## Files and reading order
1. `01_Game_Vision.md`: audience, promise, boundaries and success.
2. `02_Product_Requirements_PRD.md`: phased functional and non-functional requirements.
3. `03_Game_Design_GDD.md`: traversal, vehicles, NPCs and interaction design.
4. `04_World_Map_and_Expansion.md`: Mirpur 10 first, larger Bangladesh later.
5. `05_Art_Style_Guide.md`: polished fruit characters and Bangladesh environment art.
6. `06_Technical_Architecture.md`: web engine, rendering, regions, data and performance.
7. `07_Asset_Production_and_Licensing.md`: Blender workflow, inventory and sourcing.
8. `08_Roadmap_and_Test_Plan.md`: gated build stages and test criteria.
9. `08A_Bangla_Voice_Dialogue_and_Audio_Design.md`: ninth core design document; voice, subtitles, audio assets and rights (implemented later).
10. `09_Installation_and_Setup.md`: exact local tools and starter commands.
11. `10_AI_Agent_Project_Constitution.md`: reusable long-term guardrails for coding agents.
12. `11_Codex_Claude_First_Build_Prompt.md`: paste to begin milestone 1.
13. `12_Sources_and_Research.md`
14. `13_Claude_Asset_Reference_Sheet_Guide.md`: the visual reference sheets to supply Claude and Codex.
15. `14_Online_Research_Open_Source_and_Agent_Permissions.md`: standing permission for public online research, GitHub projects, tools and skills with clear safety/licensing boundaries.
16. `AGENTS.md` and `CLAUDE.md` (at project root): concise discovery instructions for coding agents.

## Decision record
- Target style: **stylized realism** with believable architecture/materials/lighting and deliberately stylized fruit people. Not photoreal human NPCs.
- Tool choice: Babylon.js + TypeScript + Vite + Blender. Review after a performance and quality spike, not purely from marketing demos.
- Region approach: independent scenes/tiles per destination; travel links between distant locations. Never one enormous continuously loaded Bangladesh map.
- Hosting: local-first at $0. Public hosting optional and must be tested for usage/bandwidth limits.
- Brand/location: use place names descriptively; do not assume permission to reproduce protected logos, signage, photos or detailed building models.

## Project success definition
First proof: a visitor opens a local browser page, sees a recognizably Bangladeshi, good-looking Mirpur street, can smoothly move a fruit avatar around it, adjusts graphics settings and stays within tested performance budgets. Future milestones expand this to vehicles, crowds and new regions.


## Recent style update

NPCs are not limited to mango. The current direction requires a mixed-fruit city population and more culturally accurate Bangladesh role styling. Headphones must be used sparingly, not as a default accessory.
