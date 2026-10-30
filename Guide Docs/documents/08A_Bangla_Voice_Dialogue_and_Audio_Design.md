# 08A | Bangla Voice, Dialogue and Audio Design

**Project:** Bangladesh Open World  
**Document status:** v0.2, 30 October 2026  
**Type:** Ninth core design document (added after the original eight core documents; `08A` avoids renumbering the installation and agent files).  
**First region:** Mirpur 10, Dhaka  
**Future regions:** Additional selectable Dhaka districts, Cox's Bazar, Saint Martin's Island and other locations to be chosen later.  
**Costs:** $0 additional software, voice API or licensed-asset spending. Existing AI subscriptions can help draft scripts.  
**Implementation timing:** Plan the audio system now; add spoken NPC dialogue in a later milestone. Milestone P1 remains walking and visual exploration only.

## 1. Creative goal and boundaries

Make the game *sound* unmistakably Bangladeshi without turning it into an exhausting wall of noise. Players hear short, natural Bangla exchanges, local vehicles, tea stalls, foot traffic, shops and location-specific ambience. All important spoken information is also available in readable Bangla subtitles. Audio must work offline after the needed files are loaded and must not depend on a paid online TTS service at runtime.

**Hard boundaries:** no fighting, weapons or violent audio systems; no music or recordings copied from games, videos, movies or radio without rights; no unauthorized impersonation or cloning of real people; no mandatory microphone permission. NPC dialogue is curated, non-hateful and culturally respectful. Initial NPC characters are male fruit people with no eyes, noses or mouths; their personality comes from movement, costumes and voices.

**Creative principle:** authentic dialogue beats artificially constant dialogue. Some street characters should be silent. A rickshaw bell, a bus engine and a nearby short conversation can establish place more convincingly than ten NPCs talking continuously.

## 2. Audio categories and playback rules

| Bus | Content | Example | Typical playback |
| --- | --- | --- | --- |
| Voice / direct dialogue | Short interaction with player | Tea stall owner greeting | Highest speech priority; optional subtitles |
| Voice / NPC chatter | NPC-to-NPC short exchanges | Two commuters discussing traffic | Short randomized clips, limited concurrency |
| Street ambience | General city bed | Distant traffic and people | Looped and mixed at low level |
| Vehicle sound | Identity of moving traffic | CNG motor, bus idle, rickshaw bell | Attached to vehicles, distance-based |
| Object / environment | Contextual Foley | Kettle, teacups, shutters, footsteps | Event-driven and localized |
| Interface | Soft navigation confirmations | Start/pause/settings | Quiet and optional |
| Music (optional, later) | Original or properly licensed music | No music required for first street scene | Separate control and attribution |

**Priority:** intelligible direct dialogue > player feedback > vehicle hazards/traffic cues > background chatter > ambient bed. Never raise the master volume to simulate crowd density. Use multiple soft layers, not overlapping loud loops.

**Proposed starting limits to validate by testing, not permanent guarantees:** up to two simultaneously audible chatter conversations near the player; at most one foreground NPC speech event at a time; ambient one-shots spaced by approximately 15–40 seconds; short idle dialogue per NPC with a 45–120-second cooldown; distance attenuation beyond roughly 5–12 m depending on the sound source. Adjust these numbers after actual playtests.

## 3. Voice and language policy

- Written and spoken default locale: `bn-BD` (Bangladesh Bangla). English subtitle/setting translation can be added later.
- Each recurring NPC has a persistent `voice_id`, a role and a short style guide. Do not randomly change speaker identity between lines.
- Use modern conversational Bangladesh Bangla that suits the speaker and setting. Do not assume that any generic Bengali TTS model reproduces a Dhaka accent accurately.
- Street vendors, students, drivers and shopkeepers should have different speaking patterns. Avoid repeating one slang word, accent or catchphrase everywhere.
- Use clear Bangla Unicode text; review spelling, natural rhythm, pronunciation of local place names and audio-text matching.
- Use subtitles for every interaction line and any background line that conveys information. Background ambience does not need exhaustive transcription; provide sound captions where relevant.
- No facial lip-sync requirement: fruit characters have no mouths. Use body gestures, head/body orientation and subtle audio-reactive motion instead.
- All current voice casting is for male NPCs. Do not alter the original cast restriction without a design decision; keep the data format able to support later additions.

### Character voice bible (examples, not recordings yet)

| `voice_id` | Character / role | Style | Vocal guide |
| --- | --- | --- | --- |
| `bn_mirpur_tea_01` | Tea stall owner, orange | Friendly, quick, welcoming | Warm midrange, short calls |
| `bn_mirpur_rickshaw_01` | Pedal rickshaw driver, guava | Practical, relaxed | Natural street pace; not caricatured |
| `bn_mirpur_shop_01` | Shopkeeper, pineapple | Calm, conversational | Clear, measured phrases |
| `bn_mirpur_commuter_01` | Commuter, banana | Busy, mildly impatient | Slightly faster, natural cadence |
| `bn_mirpur_guide_01` | Helpful local, mango | Warm, helpful | Unhurried and easy to understand |

The visual species is not intended to imply a particular accent or personality; the role and script define speech style.

## 4. Example first-dialogue script and interactions

All lines below are **original draft dialogue**. Ask Bangladeshi speakers to revise them for local naturalness. Do not hard-code every idle line to play whenever the player passes.

| ID | Speaker | Bangla line | Trigger | Subtitle |
| --- | --- | --- | --- | --- |
| `mir10_tea_greet_001` | Tea vendor | ভাই, চা খাবেন? গরম চা আছে। | Player deliberately interacts with stall | Same Bangla line |
| `mir10_tea_reply_002` | Tea vendor | ঠিক আছে ভাই, একটু দাঁড়ান। | Player chooses an available conversation option | Same Bangla line |
| `mir10_rickshaw_001` | Rickshaw driver | মামা, কোথায় যাবেন? | Player interacts with rickshaw | Same Bangla line |
| `mir10_shop_001` | Shopkeeper | কী খুঁজছেন ভাই? | Player interacts with shopkeeper | Same Bangla line |
| `mir10_commuter_001` | Commuter | আজকে রাস্তায় অনেক জ্যাম। | Rare nearby NPC chatter | Same Bangla line |
| `mir10_guide_001` | Local guide | সামনে মেট্রো স্টেশনের রাস্তা। | Optional player interaction | Same Bangla line |

Avoid pretending every voice line has a fully implemented choice menu in P1. Dialogue UI and interaction controls are a later module.

### Script quality checklist

1. Is the line short enough to be heard while exploring? Aim for roughly 2–6 seconds for casual ambient lines.
2. Does it sound like an actual person rather than a translated chatbot answer?
3. Is it suitable for the speaker, location and action?
4. Is spelling correct and is the subtitle identical to the intended utterance?
5. Has a Bangladeshi speaker listened to the generated or recorded version?
6. Does it avoid slurs, caricatures and overused stereotypes?

## 5. Zero-cost voice production options

**Recommended production workflow:** prepare a small offline library of finished audio clips. The player's browser only downloads/plays compressed audio. No real-time inference and no monthly API cost.

| Source | Role in evaluation | Important limitation |
| --- | --- | --- |
| [IndicF5](https://huggingface.co/ai4bharat/IndicF5) | Test Bengali TTS with approved reference audio and matching transcript | Bengali support does not ensure a local Dhaka accent; reference audio must be legally available |
| [Indic-Speak](https://huggingface.co/bodhan-ai/indic-speak) | Trial a named Bengali male voice such as `Sourav` | Model access requires accepting its terms; the Indic Open Model License has conditions; approx. 3B model needs adequate compute |
| [Bangladeshi Bangla VITS](https://huggingface.co/EMTIAZZ/bangladeshi-bangla-tts-vits) | Compare pronunciation and explore later options | The available model metadata lists **female** voice type; do not choose it for the initial male-only NPC voice roster |
| Self-recorded lines | Best fallback for distinctly local speech | Obtain consent for use/editing and document rights; quiet recording conditions help |

**Licensing gate:** a model's source-code licence, weight licence, model-card terms, referenced datasets, voice rights and licence for generated outputs can differ. Check the *exact model version* and upstream dependencies before distributing a game. Indic-Speak is not a standard permissive MIT model; read its specific restrictions. Do not add restricted or uncertain sounds just because downloading them is free.

### Production steps

1. Write UTF-8 Bangla dialogue in a data file with stable IDs and an assigned voice.
2. Have a native Bangladesh Bangla reviewer check wording and pronunciation.
3. Use a model locally where the licence and computer hardware allow it, or record with a consenting speaker.
4. Record/generate a lossless WAV master, keep it in `assets-source/audio/voice/` outside the shipped bundle.
5. In Audacity or a similar free tool, trim silence, remove obvious noise, normalize moderately and check for clipping.
6. Export a small cross-browser format such as **MP3 mono** for voice. Test Opus variants only as an optional optimization. Keep WAV masters for future changes.
7. Listen to the exported file on actual speakers/headphones and confirm correct Bangla subtitles.
8. Place approved optimized audio under the correct region pack, register its licence and link it from the dialogue manifest.
9. Test audio in Chrome, Edge, Firefox and Safari on representative devices before claiming compatibility.

**Suggested starting export settings, subject to listening tests:** mono MP3 at around 64–96 kbps for short speech; use higher bitrate if compression damages consonants. Keep source masters at their native sample rate; do not claim that upsampling improves quality.

**Install only when audio production begins:** Audacity, a compatible Python virtual environment for the selected TTS model and optionally FFmpeg for batch transcoding. Nothing else is required for voice in the first walking prototype.

## 6. Game integration and data contract

Audio content is data-driven and separate from rendering/characters. The engine must support `dialogue_id`, `voice_id`, `speaker_id`, `locale`, `subtitle`, `audio_uri`, `trigger`, `priority`, `cooldown_s` and `region_id`. These are examples, not instructions to build a dialogue system during P1.

```json
{
  "dialogue_id": "mir10_tea_greet_001",
  "region_id": "dhaka_mirpur10",
  "speaker_id": "npc_tea_orange_01",
  "voice_id": "bn_mirpur_tea_01",
  "locale": "bn-BD",
  "subtitle": "ভাই, চা খাবেন? গরম চা আছে।",
  "audio_uri": "/regions/dhaka_mirpur10/audio/voice/mir10_tea_greet_001.mp3",
  "trigger": "interact",
  "priority": "foreground",
  "cooldown_s": 40
}
```

**Folder organization:**

```text
assets-source/audio/                    # editable source, not downloaded by browser
  voice/wav-masters/
  ambient/recordings/
  sound-rights.csv
public/regions/dhaka_mirpur10/audio/    # optimized shipped clips
  voice/
  ambience/
  vehicles/
  foley/
src/game/audio/                       # reusable engine code, added in later phase
src/data/dialogue/bn-BD/                # dialogue manifests
```

Future region packs use the same contract: `dhaka_dhanmondi`, `coxs_bazar`, `saint_martin`, etc. These names are examples, not a fixed region list.

### Browser playback behavior

- Initialize/unlock audio from the player's Start/Play button; do not depend on autoplay with sound.
- Provide master, voice, ambience, vehicle and UI volume controls plus a mute option. Persist settings locally.
- Use distance attenuation for world sounds; direct dialogue may be ducked against ambience for intelligibility.
- Limit duplicate sources and simultaneous chatter by priority. Do not preload an entire city's voice assets; load by nearby region and event.
- Pause/mute safely when tab is hidden and resume according to player preferences.
- If audio fails to decode or load, **the scene and subtitle still work**; show a non-disruptive recovery path.
- Never require microphone, speech recognition or permission for normal exploration.

## 7. Accessibility and quality standards

- Bangla subtitles togglable but ON by default for dialogue; readable size and good contrast.
- Sound-category sliders; mute must work instantly.
- Provide textual action prompts for nearby interactions so hearing is not required to play.
- Avoid sudden loud horns next to the listener or sustained high-volume street beds; set a sensible mix.
- Test audio on low-end headphones, mobile speakers and a desktop computer.
- Review whether players can distinguish speech from background traffic and whether the city still feels alive on mute via visual animation.

## 8. Milestone plan and acceptance tests

| Phase | Audio deliverable | Acceptance checks |
| --- | --- | --- |
| P1 walking prototype (now) | No NPC voice implementation required; architecture should not block future audio | Player can walk/inspect without external audio services |
| P2 environmental polish | One low-volume street bed and a few locally triggered effects | Start button unlocks audio; mute/pause works; no broken load |
| P3 vehicles | CNG/rickshaw/bus sounds attached to functional vehicles | Distances feel plausible; mix does not overpower gameplay |
| P4 living NPC city | At least 5 reviewed Bangla voice lines across 2–3 distinct male speakers, subtitles and interactions | Correct speaker identity; native-language review; no excessive chatter |
| P5+ new districts | Region-specific ambience and voices | Independent loading; optional audio pack streaming; no cross-region errors |
| Future mission module | New dialogues/incident audio | Only after separate mission requirements are approved; no combat |

### Test evidence to save

1. A short gameplay video of a nearby NPC speaking with an accurate Bangla subtitle.
2. A second video showing distance falloff, pause and mute.
3. Voice-listening evaluation notes from at least three Bangladesh Bangla listeners for a small initial sample.
4. A size/bandwidth and decoding test log on actual browsers/devices.
5. Audio rights ledger, model version notes and consent proof for privately recorded speech.

## 9. Reference sheets needed for audio production

- **Voice casting sheet:** NPC visual, role, `voice_id`, estimated age range, style words, 2 sample Bangla lines, approved audio sample filename.
- **Bangla phrase sheet:** line ID, Bangla text, English intent explanation, trigger and pronunciation notes for place names.
- **Ambient sound map:** top-down street blocks showing where traffic, tea stall, bus stop, metro and crowd sounds originate.
- **Audio mix sheet:** one page with relative priority, playback distance, loop/one-shot status and simultaneous-play limits.
- **Rights and credit sheet:** every clip's creator, source, licence, usage scope and consent record when necessary.

## 10. References and decision log

- [IndicF5 official model card](https://huggingface.co/ai4bharat/IndicF5): model and code/model terms; check at use time.
- [Indic-Speak model card and licence](https://huggingface.co/bodhan-ai/indic-speak): gated access, Bengali `Sourav`, specific restrictions and upstream dependencies.
- [Bangladeshi Bangla VITS model information](https://huggingface.co/EMTIAZZ/bangladeshi-bangla-tts-vits/blob/main/model_info.json): gender/voice metadata and licence.
- [MDN autoplay policy](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay): audible media requires user-start-aware implementation.
- [MDN audio codec support](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs): test real browser audio decoding; MP3 has broad support.

**Open decisions:** real voices versus AI generated voices after listening tests; final Bangla dialogue style guide; audio clip size cap based on measured load times; exact first NPC roster; legally cleared recordings; and device-specific mix targets. None of these decisions should delay the current walkable world milestone.

## Resource discovery permission
Claude/Codex may investigate additional public/open-source Bangla TTS models, voices, audio editing tools and production workflows online. Verify the exact weights, dataset, licence, commercial use conditions and recording consent before redistribution. Do not assume every Bengali TTS model produces a Dhaka accent. Paid voice APIs are excluded by the $0 additional budget. See `14_Online_Research_Open_Source_and_Agent_Permissions.md`.
