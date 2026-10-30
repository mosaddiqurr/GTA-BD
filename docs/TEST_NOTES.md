# Test notes: version 0.2 (30 October 2026)

## Test machine

Windows 11, Ryzen 5 5600H, 15.4 GB RAM, RTX 3050 Laptop 4 GB plus AMD integrated GPU. Headless Edge, window 1536 x 864 at 125% scaling, so the game renders at 1888 x 965 physical pixels. Capped to 60 Hz like an ordinary browser window (`node tools/test/edge.mjs start vsync`).

## Measured frame rate

RTX 3050, High preset, production build, about 46 moving vehicles and 110 to 220 people in view:

| Test | Average FPS | Frame time p95 | Worst frame |
| --- | --- | --- | --- |
| Spawn | 60 | 16.8 ms | 16.9 ms |
| Golchattar | 60 | 16.8 ms | 17.2 ms |
| East road | 57.1 | 32.8 ms | 33.4 ms |
| Market lane | 60 | 16.8 ms | 16.8 ms |
| Bus terminal | 60 | 16.8 ms | 17.2 ms |
| Metro north | 59.5 | 16.8 ms | 49.9 ms |
| 25-second drive along the avenue | 59.5 | 16.8 ms (p99 16.9) | 467 ms, the first frame after the test teleports the car |

Of 1487 frames in that drive, 6 took longer than 22 ms.

Version 0.1 on the same machine, with the frame cap off: High 37 to 52 FPS with about 45 people.

Integrated AMD GPU (`edge.mjs start igpu`), dev server, about 25 to 35 FPS on both Medium and Low. It is limited by geometry and CPU rather than pixels, so lowering the preset barely helps. A hint on the title screen tells the player to switch the browser to the RTX. 60 FPS needs the discrete GPU.

First load in a fresh browser with no cache: about 15 seconds on the dev server when last timed, 31 seconds on the final production build from localhost (timed by a 2-second poll). Part of that is compiling every shader up front. Real downloads over the internet will add to it.

## What was wrong, and the fix

- **Blur:** Windows scaling at 125% made the game render at 80% of the screen's pixels. The render size now follows the physical pixels on every preset. Film grain and chromatic aberration are off, FXAA is replaced by 4x MSAA on Medium and up.
- **Freezes of up to 5.5 seconds in the first minute:** the driver compiled shaders the first time each kind of mesh appeared. Everything is now compiled and drawn once behind the loading screen.
- **Stalls of up to 190 ms while moving:** one whole block of buildings was built in a single frame. It is now built a building at a time, under about 5 ms a frame.
- **Too many meshes and triangles:** vehicles and crowds are thin-instanced, with light models at a distance, so the whole fleet costs about as many draw calls as one vehicle per paint job.

## Checked working

- Production build passes type check and loads with no failed files
- Keyboard input: walking, running, driving
- Get in and out in a stepped frame-by-frame test on all nine vehicle types, with no errors. Frames reviewed by eye for the car, motorbike and bus (door opens, driver climbs out and shrugs, hero climbs in, door closes)
- Riding as a passenger on a bus and a CNG: boarding, the ride, asking to stop, getting off
- Vehicle chooser: opens, lists every vehicle and paint job, puts the chosen vehicle beside the hero
- Bus terminal bays hold each bus livery
- 8 simulated minutes of traffic and people with no rendering: no errors, no bad numbers, no vehicle jumps, no vehicle still for more than 45 seconds, and buses stop at their stops. Vehicles in long red-light queues show as waiting up to about 22 seconds; those are queues, not deadlocks
- Night and noon lighting; shops glow at night
- Audio system runs with no errors, and Edge's Bangla voice is found

## Not tested

- Audio by ear, including how the Bangla voice sounds (no listening test was possible)
- Real mouse look and pointer lock (the tests ran headless with injected keys)
- Chrome, Firefox, phones and other GPUs. In Chrome the Bangla voice only works if Windows has one installed; otherwise subtitles still show
- Long real-time play sessions and memory growth. JS heap read 613 MB once after testing
- Native Bangla review of all text, including the new lines
- People boarding buses at stops was seen working through bus stops being served, but the walk to the door was not reviewed by eye

## Known weak spots

- Shop interiors are painted walls in a clean illustrated style; buildings still cannot be entered
- Rooftops are plain, and block-interior buildings are deliberately simple
- At a distance blocks use a simple far mesh, so a shop row can look soft before the detail swaps in
- Driving flat out through the city while blocks stream in can still drop an occasional frame
- Passengers stay in their seats and do not react to crashes
- Netting on the scaffolding is opaque cloth with a printed lattice, and plant leaves look faceted within about 2 m
- Character skirts stretch in a full stride
- No rain; the street grid is straight and regular compared with real Mirpur
