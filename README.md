# বাংলাদেশ ওপেন ওয়ার্ল্ড (Bangladesh Open World)

A non-violent, third-person open-world browser game set in Dhaka, with a Bangla-first interface and a cast of faceless fruit people. You can play in Mirpur 10, Gulshan and Dhanmondi, and travel between them by road, bus, CNG, taxi or metro. Every vehicle can be driven, and there's live traffic, traffic lights, traffic police, shops and money. Cybersecurity and scam-awareness missions come in later versions.

The districts are original, compressed approximations inspired by the real places. They are not survey data.

## What's in it

Three districts of about 1.7 km each (Mirpur 10, Gulshan, Dhanmondi), joined by road, bus and metro. Drive anything except the police's, on real tyres with real weight. Walk into shops, a mall, restaurants, a clinic, a bank, your own flat. Haggle in the market, book a ride on your phone, get a fine and pay it at the station, get caught in the rain. Choose one of five people to be. No weapons, no fighting, nobody ever hurt.

## Run it

Needs Node.js 20.19+ (24 recommended) and a modern browser with WebGL2.

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173. A finished build is made with `npm run build` and served with `npm run preview`.

### Important on laptops with two GPUs

Browsers often pick the weak integrated GPU, which holds the game to about 30 FPS. On Windows: Settings, System, Display, Graphics, add your browser (Edge or Chrome), Options, High performance, then restart the browser. The game shows a reminder on the title screen when it detects an integrated GPU, and the FPS panel in the pause menu shows which GPU is in use.

## Controls

| Key | Action |
| --- | --- |
| W A S D or arrows | Walk or drive |
| Shift | Run |
| Space | Jump; handbrake in a vehicle |
| F | Get in and drive any vehicle, or get out. While riding, ask the driver to stop. On a platform, board the train |
| G | Ride as a passenger: agree a place and a fare on a CNG, rickshaw or taxi, or tell the bus conductor where you're getting off |
| V | Choose any vehicle and paint job, and have it brought to you |
| M | Big map of the district. Click to mark a place; see how to reach the other districts |
| E | Talk to anyone, buy from a shop or cart, sit down at a tea stall, buy a metro ticket, or look at a landmark. Confirms a menu choice |
| Q | Call a rickshaw, CNG or taxi to you, or ask about a bus |
| 1 to 9 | Pick from a menu; or use the wheel or arrow keys, then E |
| H | Horn or rickshaw bell |
| Mouse | Look around (click the game to capture the mouse) |
| Mouse wheel, C | Camera distance |
| T | Jump to the next time of day; the clock also runs by itself |
| R | Return to the safe spawn point |
| Esc | Pause and settings |

## What is in this version

New in 0.6:

- Two more districts, Gulshan and Dhanmondi, and real ways to get between all three: drive out on the right road, hire a CNG or taxi, find one of the few buses that go there, or take the metro between Mirpur 10 and Shahbagh
- Walk over the footbridge and up into the metro station. Buy a ticket and ride the train
- A flyover on Mirpur Road, used by traffic and by you
- Money, shopkeepers and things to buy, carried over between districts
- Boys playing cricket and football, plus a school and a university in each district
- Three outfits per character, and people of different heights
- A much better map, with a mark you can place by clicking
- Q now asks what to call, and rickshaws, CNGs and taxis drive to you
- Far more traffic at full, drivers who shout and go round you, solid shop fronts, and no more getting squeezed into vehicles

New in 0.5:

- Much bigger crowds: the people and vehicle sliders go about twice as far, up to about 1,140 people and 270 vehicles around you
- Free AI Bangla voices with six male voice types, in the game's own files, so they work in any browser
- Separate volumes for voices, surroundings, vehicles and other sounds, plus mute and subtitles on or off
- Hire a CNG or rickshaw: pick a place, hear the fare, haggle, and it drives you there by road
- On a bus, the conductor asks where you're getting off and tells you when you're there
- People climb the bus steps one at a time, and conductors call the route
- Drivers have tempers: some speed, they overtake, bikes thread through queues
- Crashes are real knocks: vehicles are pushed by weight and swing round, with dust and sparks, and people hop aside
- Steadier driving and less jitter on people's legs

New in 0.4:

- Only male voices: the game picks the browser's male Bangla voice, and shows text alone if there is none
- Talk to anyone with a menu of choices, with lines above their heads and an answer that depends on who they are
- Ask the way: they point, and a marker appears on the map and on screen
- Pull doors open by hand on the car, microbus, truck, CNG and bus, and pull them shut after you
- Crashes get a reaction: the other vehicle rocks and is pushed, carts slide, drivers shout or climb out, people turn, police whistle
- Sit down at a tea stall: order, drink against a timer, talk to whoever is alongside, or hurry up and leave
- People stop to chat with one another, go and look at stalls, and stall owners call out
- Look at landmarks, and wave down a CNG or rickshaw

New in 0.3:

- No more character flicker; vehicles sit level, with realistic pitch and roll
- Drivers' hands on the real wheel or handlebars, on every vehicle
- Solid carts, stalls and people; people walk both ways, keep left and step aside, and react when bumped
- Traffic stays off the footpath
- Overhead traffic signals you can see from down the street, and traffic police at every signalled junction
- The clock runs through a full day and night, and nights are easier to see in
- Big map on M; settings for how many people and vehicles, and how fast the day passes
- Only some people wear glasses; others have a plain fruit face

See [docs/ROADMAP.md](docs/ROADMAP.md) for what comes next.

New in 0.2:

- Sharp picture at any Windows scaling, and a steady 60 FPS on an RTX 3050 with hundreds of people in view
- A crowd about four times bigger, drawn in bulk, with people who chat, queue at bus stops and board buses
- Drivers and passengers visible in every vehicle; ride along as a passenger, or stop the driver and get off
- Getting in is a sequence: jog to the door, open it, the driver climbs out and shrugs, you climb in, the door closes. On a bus you walk up the steps and along the aisle
- Traffic with realistic car following, axle-based turning, lane changes and buses that stop at stops
- Vehicle chooser, every bus livery at the terminal, and bus routes named in the prompt
- Positional engines, horns and bells, door sounds, tea glasses, crowd murmur, and spoken Bangla where the browser has a voice
- Bamboo scaffolding, tin sheds and fences, pavement sellers, sacks, brick piles, bunting and overhead cables; proper side and back walls; high-resolution shop interiors

Everything else:

- Mirpur 10-inspired district of about 1 km²: golchattar plaza, elevated metro with passing trains and a station, main avenue, side streets, a market, a bus and CNG stand, a playing field and a mosque
- Procedurally generated Dhaka buildings: grilled windows, balconies with laundry, shopfronts, rooftop tanks and billboards, overhead wires
- Bangla everywhere, typeset by the browser so conjuncts render correctly: shop signs, billboards, number plates, route boards, HUD and menus
- Vehicles: bicycle, pedal rickshaw, battery rickshaw, CNG, motorbike, car, microbus, city bus and truck, all driveable
- Left-hand traffic with lane following, signal phases, clockwise circulation at the plaza, horns and queueing
- Traffic police who whistle if you run a red light in front of them
- Pedestrians of many fruit species, tea stalls and street vendors
- Five times of day with night lighting; synthesised city, engine, horn and bell audio
- Low, Medium, High and Ultra presets with Auto selection

## Rules this project follows

No weapons, combat or injury: taking a vehicle means the driver steps out peacefully, and people hop clear of traffic. Characters never have eyes, noses or mouths. No real brands or logos. See [CLAUDE.md](CLAUDE.md) and `Guide Docs/` for the full rules.

## Project layout

```text
src/app         game loop, settings
src/regions     region data; new districts register here
src/world       city generation, buildings, roads, signs, props, collision
src/traffic     lane graph, signals, traffic AI
src/vehicles    specs, physics, model loading
src/characters  skeleton animation in code
src/npc         pedestrians, vendors, police
src/player      input, camera, player controller
src/graphics    sky, lighting, post-processing, quality presets
src/audio       synthesised sound
src/ui          HUD, menus, minimap
src/localization  all Bangla text
tools/blender   scripts that model and bake every 3D asset
tools/textures  scripts that generate every surface texture
tools/test      browser driver: frame rate, hitches, soak test, get-in sequences
docs            asset ledger and test notes
```

## Rebuilding assets

Every asset is generated by a script, so nothing depends on a saved `.blend` file.

```bash
python tools/textures/build_textures.py
```

```bash
blender --background --factory-startup --python tools/blender/build_vehicles.py -- rickshaw cng
```

The same pattern works for `build_characters.py`, `build_props.py` and `build_sky.py`.
