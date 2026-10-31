# Test notes: version 0.8 (31 October 2026)

## Test machine

Windows 11, Ryzen 5 5600H, 15.4 GB RAM, RTX 3050 Laptop 4 GB plus AMD integrated GPU. Headless Edge on the RTX, capped by the display (`tools/test/edge.mjs start vsync`), production build, High quality, rush hour.

## Frame rate

| Place | Mirpur | Gulshan | Dhanmondi |
| --- | --- | --- | --- |
| Start | 41 | 41 | 44 |
| Golchattar | 44 | 43 | 48 |
| East road | 57 | 53 | 60 |
| Market lane | 57 | 59 | 59 |
| Terminal | 55 | 54 | 59 |
| Metro north | 43 | 45 | 47 |

Still below the 60 Hz bar at the busiest spots. Draw calls remain the limit, and the infill goes into each block's existing merged mesh, so it added little.

## Stage B checks, in the running game

`node tools/test/stage_b.mjs <dir>` and `node tools/test/missions_auto.mjs`. No script errors from the game.

| Check | Result |
| --- | --- |
| All 20 missions, self-driving | Every stage of every mission reaches the end, in its own district. Waits are answered automatically: this proves they can finish, not that each is well judged in difficulty |
| Mission 1 by hand | Marker, E to start, walk, conversation, three customers by number keys, reward, next mission opens |
| Off switch | Objective, marker, scams and calls all go; come back when it's on |
| Buying | Note crosses, parcel comes back, seller reaches out, money floats off the purse. Eat now or keep in the bag |
| Rickshaw fare | Paid on the road after getting down, hand to hand (written, and the same hand-over; not separately watched) |
| Bag | Food heals, medicine heals, story book reads across pages, raw food only cooks at home |
| Collapse | At nought: clinic, 70 health, a bill up to 500 taka; a mission in progress fails |
| First person | On foot, car, bus, bike and rickshaw; head hidden. V switches and it's remembered for each |
| Conversations | Greeting changes once met, memory kept by place, someone insulted enough refuses to talk |
| Friends | Meet, added to the phone, tea together, level goes up |
| Scams | Call, message, stranger and street event all play out; money and scam sense change |
| Jobs | All eight finish and pay, self-driving |
| Garage | Dents bend the body, repair charges and restores |
| Licence | Quiz passes at four of five |
| Radio | Three stations, talk in the game's voices |
| Stickers, business, race, awards, journal | All work |
| Sound | With a real click the engine runs and the meter reads real output. Not listened to by a person |
| English | No visible Bangla left on the HUD apart from the ৳ sign; voices stay Bangla |
| Solid check | Hero's walk 0 of 75,200 steps inside anything. Thrown at walls 0 of 260. Station 0 stuck |
| Soak, 2 minutes | 0 errors, 0 bad states, 0 off road, nobody stuck |
| Traffic overlap at 3x slider | Measured before the last change at 0.46 pairs a frame, worst 0.65 m, all one cause: a car forcing out of a locked junction. It now creeps instead. Not re-measured since |

## Not checked

- **Sound by ear.** Nobody has listened to anything, including the radio music and the new voices.
- **Missions played by hand beyond the first.** Difficulty, timers and following distances are my estimates.
- **Real mouse and keyboard.** Headless test browser.
- **Other browsers and machines.**
- **A native speaker** on about 6,000 new Bangla lines, written by AI.
- **Women's voices.** Text only until a woman's voice model is approved.

## Known rough edges

- Clothes bought change standing with people but not the hero's look.
- The lock has nothing to protect against yet, since nobody steals bicycles in the game.
- People hanging off the bus door haven't been looked at from every angle since the fix.
- Very close up, crowd clothes show jagged edges: visible from a bus seat in first person.
