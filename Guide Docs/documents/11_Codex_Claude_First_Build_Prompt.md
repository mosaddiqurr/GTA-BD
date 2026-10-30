# 11 | First Build Prompt (paste into Codex or Claude Code)

You are implementing the **first playable milestone** of a long-term Bangladesh open-world browser game. Read all files in `docs/` (especially `00_README_START_HERE.md`, `02_Product_Requirements_PRD.md`, `05_Art_Style_Guide.md`, `06_Technical_Architecture.md` and `10_AI_Agent_Project_Constitution.md`) before coding.

**Concept:** high-quality, non-violent, Bangla-first third-person open world of Bangladesh. Long term: multiple Dhaka destinations, Cox's Bazar, Saint Martin's Island and other chosen regions. **CURRENT SCOPE IS ONLY MIRPUR 10 WALKING VERTICAL SLICE.** Do not add shooting, fighting, crimes, missions, vehicles, traffic AI, chatting NPCs, API calls, backend, multiplayer or additional districts.

**Stack:** Babylon.js + TypeScript + Vite. Assets from original Blender files or explicitly licensable free assets only. User has Blender, Codex and Claude. Avoid any extra paid tool/API/hosting.

**Online research permission:** You have standing permission to search the public internet, official docs, GitHub/GitLab repositories, open-source game projects, Blender tools, visual references and public AI agent skills whenever that will improve your output. Prefer reliable, high-quality existing solutions over unnecessary reinvention. Before downloading or using resources, check licence, safety, compatibility and attribution. You may do normal public research and safe local installation/testing without asking again. Do not use paid APIs, expose secrets, access private systems, publish externally or bypass licensing. Follow `14_Online_Research_Open_Source_and_Agent_Permissions.md`. In your report, list significant sources, their licences and what was actually integrated.

**Build now:**
1. Inspect repository, preserve existing working code and install only needed npm packages.
2. Make a tidy scene architecture with a single Mirpur-10 district module and future region manifest interface.
3. Render a small but deliberately composed Dhaka-inspired intersection/street block: elevated metro/columns, sidewalks, a few modular shopfronts, Bangla signs and convincing daylight lighting. These are an **original approximation**, not a copied commercial map.
4. Add one controllable mango fruit hero with arms/legs, opaque visor and **absolutely no eyes, nose or mouth**. If final Blender model is not available, build a clean temporary avatar and isolate it for later replacement. Do not call temporary geometry final-quality artwork.
5. Implement responsive third-person camera, WASD movement, Shift run, idle/walk/run states, collision and reset-to-safe-spawn. Avoid foot sliding and camera clipping where practical.
6. Add settings for Auto/Low/Medium/High graphics and a toggleable FPS/debug overlay. Prefer WebGPU if verified stable on device, otherwise WebGL fallback. Show clear unsupported-browser/error state.
7. Include a short README with local commands and build/test steps. Run type checks and `npm run build` and report actual outcomes. Do not fabricate FPS measurements.
8. Capture or describe exact browser screenshot evidence to collect, and explicitly state any untested device targets.

**Visual standard:** professional stylized realism, consistent lighting/materials/scale and Bangladeshi street identity. Smaller polished scene beats a giant primitive gray map. No random low-quality stock assets or generic toy-like environment. The project is high-ambition, but do not promise GTA V visual parity in the browser on every device.

**Done means:** browser launches, walking controls work, collision behaves, scene reads as Dhaka-inspired, settings work, build passes and files remain easy to extend. Then stop and request acceptance before Phase 2. Explain what you built and what is still placeholder.


## NPC art direction (for future phases)

Keep the main playable hero as mango. For NPCs, use multiple fruit species and culturally appropriate Bangladesh roles. Do not default to headphones. Reserve headphones for limited student or modern youth variants only.
