import { DIR, Heading } from "../traffic/laneGraph";
import { TravelPlan, leaveFor, readTravel } from "./travel";
import { SLOTS, Wallet, deleteSlot, loadPhotos, loadSave, readSlot, savePhotos, setActiveSlot, startGame, writeSave } from "./save";
import type { SlotInfo } from "../ui/hud";

/** How often a game in progress saves itself, in seconds. */
const AUTOSAVE_SECONDS = 45;
import { Shops } from "../interaction/shops";
import type { Vehicle } from "../vehicles/vehicle";
import { AbstractMesh, Engine, Mesh, Scene, Vector3 } from "@babylonjs/core";
import { AudioSystem } from "../audio/audio";
import { lineSeconds, roleOf, setHeroVoice, voiceOf } from "../interaction/cast";
import { Interactions } from "../interaction/interactions";
import { Reactions } from "../interaction/reactions";
import { TeaBreak } from "../interaction/teaBreak";
import { Talk } from "../interaction/talk";
import { Gates } from "../interaction/gates";
import { Metro } from "../interaction/metro";
import { Playground } from "../world/playground";
import { KERB_H } from "../world/cityLayout";
import { Hail } from "../interaction/hail";
import { Trips, seatAnchor } from "../interaction/trips";
import { CharacterId, preloadCharacters, PEDESTRIAN_IDS } from "../characters/character";
import { Crowd } from "../characters/crowd";
import { CrashFx } from "../graphics/crashFx";
import { Strays } from "../world/strays";
import { CatchGame } from "../interaction/catchGame";
import { Doors } from "../interaction/doors";
import { RainSetting, Weather } from "../graphics/weather";
import { RainGear, RainWearer } from "../npc/rainGear";
import { Life, completeLife } from "./life";
import { itemOf } from "./items";
import { Panels } from "../ui/panels";
import { Bag } from "../interaction/bag";
import { HandOver } from "../interaction/handOver";
import { Converse } from "../interaction/converse";
import { Friends } from "../interaction/friends";
import { Everyday } from "../interaction/scams";
import { Tutorial } from "../interaction/tutorial";
import { Extras } from "../interaction/extras";
import { Radio } from "../audio/radio";
import { Dents } from "../vehicles/dents";
import { JOB_LIST, JOB_WORDS } from "../missions/jobs";
import { TreeHost, TreeRunner } from "../interaction/treeRunner";
import { MissionHost } from "../missions/kit";
import { MissionRunner } from "../missions/runner";
import { STORY_1 } from "../missions/story1";
import { STORY_2 } from "../missions/story2";
import { CityRhythm } from "./cityRhythm";
import { heroById } from "./heroes";
import { PoliceForce } from "../interaction/policeForce";
import { RouteFinder } from "../world/routeFinder";
import { NavPlace, Phone, PhoneHost, PhotoRecord } from "../ui/phone";
import { freshPhone } from "../ui/phoneData";
import { ENV_KEYS, Environment } from "../graphics/environment";
import { NightLights } from "../graphics/nightLights";
import { PostStack } from "../graphics/post";
import { QUALITY, QualityPreset, detectQuality, gpuName, isIntegratedGpu, scalingFor } from "../graphics/quality";
import { T, addressed, bn, bnNum, setAddress } from "../localization/bn";
import { Pedestrians } from "../npc/pedestrians";
import { CameraRig } from "../player/cameraRig";
import { Input } from "../player/input";
import { Player } from "../player/player";
import { defaultRegionId, regions } from "../regions/registry";
import { TrafficSystem } from "../traffic/trafficSystem";
import { Anchor, Hud, MapPlace, MapPoint } from "../ui/hud";
import { VEHICLES, VehicleId } from "../vehicles/vehicleData";
import { VehicleFleet } from "../vehicles/vehicleLibrary";
import { City } from "../world/city";
import { MetroTrain } from "../world/metroTrain";
import { SignAtlas } from "../world/signs";
import { DayPace, QualityName, Settings, TimeName, loadSettings, saveSettings } from "./settings";

type GameState = "loading" | "title" | "playing" | "paused";

const VISIBILITY_INTERVAL = 0.14;
const AUTO_WINDOW = 4; // seconds of frame rate watched before auto quality reacts
/** Game hours per real second: at normal pace a full day takes 24 minutes. */
const DAY_PACE: Record<DayPace, number> = { stop: 0, slow: 1 / 120, normal: 1 / 60, fast: 1 / 25 };

const input_radio = (i: Input): boolean => i.pressed("KeyN");

/** Owns the engine and the top-level game state, and steps every system once a frame. */
export class Game {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly settings: Settings = loadSettings();
  state: GameState = "loading";
  quality!: QualityPreset;
  env!: Environment;
  post!: PostStack;
  city!: City;
  rig!: CameraRig;
  input: Input;
  hud: Hud;
  audio = new AudioSystem();
  fleet!: VehicleFleet;
  crowd!: Crowd;
  traffic!: TrafficSystem;
  peds!: Pedestrians;
  player!: Player;
  interactions = new Interactions();
  talk!: Talk;
  tea!: TeaBreak;
  reactions!: Reactions;
  trips!: Trips;
  hail!: Hail;
  gates!: Gates;
  metro: Metro | null = null;
  playgrounds: Playground[] = [];
  /** Everything kept between visits. */
  private save = loadSave();
  wallet = new Wallet(this.save);
  life = new Life((this.save.life = completeLife(this.save.life)));
  panels!: Panels;
  bag!: Bag;
  private handOver!: HandOver;
  private overlayPaused = false;
  missions!: MissionRunner;
  tree!: TreeRunner;
  friends!: Friends;
  converse!: Converse;
  everyday!: Everyday;
  private tutorial!: Tutorial;
  extras!: Extras;
  private radio!: Radio;
  dents!: Dents;
  private crashFx!: CrashFx;
  shops!: Shops;
  private brokeTime = 0;
  private saveTimer = AUTOSAVE_SECONDS;
  private strays: Strays | null = null;
  private sirenNear = 0;
  private routes!: RouteFinder;
  private hero = heroById(undefined);
  private heroGear: RainWearer = { id: "hero_mango", x: 0, y: 0, z: 0, yaw: 0, offset: 0.09, rainHabit: 1, size: 1 };
  private heroHand = new Vector3();
  private weather!: Weather;
  private rhythm!: CityRhythm;
  private doors!: Doors;
  private catchGame!: CatchGame;
  private law!: PoliceForce;
  private phone!: Phone;
  private clock = 0;
  /** The journey that brought the hero here, until they've landed. */
  private arrival = readTravel();
  train: MetroTrain | null = null;
  night!: NightLights;

  private visTimer = 0;
  private mapTimer = 0;
  private titleAngle = 0;
  private autoTimer = 0;
  private autoFrames = 0;
  private autoLow = 0;
  private fpsAvg = 60;
  private shots: { name: string; run: () => void }[] = [];

  constructor(private canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.engine = new Engine(canvas, true, { powerPreference: "high-performance", stencil: true, preserveDrawingBuffer: false }, false);
    this.scene = new Scene(this.engine);
    this.scene.skipPointerMovePicking = true;
    this.scene.autoClear = false;
    this.scene.autoClearDepthAndStencil = true;
    this.input = new Input(canvas);
    this.hud = new Hud(ui, this.settings, {
      onPlay: () => this.play(),
      onResume: () => this.resume(),
      onRespawn: () => {
        this.player.respawn();
        this.resume();
      },
      onQuality: (q) => this.changeQuality(q),
      onTime: (t) => this.changeTime(t),
      onSensitivity: (v) => {
        this.settings.sensitivity = v;
        this.rig.sensitivity = v;
        saveSettings(this.settings);
      },
      onVolume: (v) => {
        this.settings.volume = v;
        this.audio.setVolume(v);
        saveSettings(this.settings);
      },
      onFps: (on) => {
        this.settings.showFps = on;
        this.hud.setDebug(on);
        saveSettings(this.settings);
      },
      onVoice: (on) => {
        this.settings.voice = on;
        this.audio.voiceEnabled = on;
        saveSettings(this.settings);
      },
      onChoose: (id, variant) => this.bringVehicle(id as VehicleId, variant),
      onCrowd: (v) => {
        this.settings.crowd = v;
        this.applyDensity();
        saveSettings(this.settings);
      },
      onTraffic: (v) => {
        this.settings.traffic = v;
        this.applyDensity();
        saveSettings(this.settings);
      },
      onDayPace: (p) => {
        this.settings.dayPace = p;
        this.env.speed = DAY_PACE[p];
        saveSettings(this.settings);
      },
      onSound: (kind, v) => {
        const key = { voice: "soundVoice", ambience: "soundAmbience", vehicles: "soundVehicles", effects: "soundEffects" } as const;
        this.settings[key[kind]] = v;
        this.audio.setLevel(kind, v);
        saveSettings(this.settings);
      },
      onMute: (on) => {
        this.settings.muted = on;
        this.audio.setMuted(on);
        saveSettings(this.settings);
      },
      onSubtitles: (on) => {
        this.settings.subtitles = on;
        saveSettings(this.settings);
      },
      onVoiceKind: (k) => {
        this.settings.voiceKind = k;
        this.audio.useVoicePack = k === "pack";
        saveSettings(this.settings);
      },
      onVoiceTest: () => {
        this.audio.setMuted(this.settings.muted);
        this.audio.unlock(this.settings.volume);
        // Paused or on the title screen, the context stays awake for as long as the test takes.
        this.audio.suspend(false);
        this.audio.chime();
        this.audio.speak(bn.voiceSample, voiceOf("npc_tea_banana"));
      },
      soundInfo: () => ({ status: this.audio.status, level: this.audio.level }),
      onLanguage: (l) => {
        try {
          if (this.player && this.state !== "loading" && this.settings.autosave) this.keepGame();
          localStorage.setItem("bow.lang", l);
        } catch {
          /* it stays as it is */
        }
        location.reload();
      },
      onQuit: () => {
        this.keepGame();
        location.href = location.pathname;
      },
      onNewGame: (region, slot, hero) => {
        startGame(slot, region, hero, heroById(hero).taka);
        location.href = location.pathname;
      },
      onLoadSlot: (slot) => {
        setActiveSlot(slot);
        location.href = location.pathname;
      },
      onSaveSlot: (slot) => {
        this.keepGame(slot);
      },
      onDeleteSlot: (slot) => deleteSlot(slot),
      slotsInfo: () => {
        const out: (SlotInfo | null)[] = [];
        for (let n = 1; n <= SLOTS; n++) {
          const q = readSlot(n);
          out.push(q ? { place: regions[q.region ?? ""]?.displayNameBn ?? regions[defaultRegionId].displayNameBn, taka: q.taka, playSeconds: q.playSeconds, savedAt: q.savedAt } : null);
        }
        return out;
      },
      onSetting: (key, value) => {
        (this.settings as unknown as Record<string, unknown>)[key] = value;
        saveSettings(this.settings);
        this.applyViewSettings();
        if (key === "rain" && this.weather) this.weather.setting = value as RainSetting;
        if (key === "missionsOff" && this.missions) this.missions.setOff(value as boolean);
      },
    });
    window.addEventListener("resize", () => {
      // Moving between monitors or changing Windows scaling alters the pixel ratio.
      if (this.quality) this.engine.setHardwareScalingLevel(scalingFor(this.quality));
      this.engine.resize();
    });
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.hud.say(bn.loadFailed, 8);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.state === "playing") this.pause();
    });
    this.input.onLockChange = (locked) => {
      this.hud.lookHintVisible(!locked && this.state === "playing");
      if (!locked && this.state === "playing" && this.hadLock) this.pause();
      if (locked) this.hadLock = true;
    };
  }
  private hadLock = false;
  private lookAt: { x: number; z: number; time: number } | null = null;
  private dtAverage = 1 / 60;
  private dtOwed = 0;
  private chooserPaused = false;
  private mapPaused = false;
  private personCasters = new Set<AbstractMesh>();
  private candidates: AbstractMesh[] = [];
  private candidateList = { data: this.candidates, length: 0 };

  async start(): Promise<void> {
    const gl = this.engine._gl as WebGL2RenderingContext;
    const gpu = gpuName(gl);
    console.log("[game] GPU:", gpu);
    this.quality = this.resolveQuality(this.settings.quality);
    console.log("[game] quality:", this.quality.name);
    this.engine.setHardwareScalingLevel(scalingFor(this.quality));

    const step = (f: number, text: string): Promise<void> => {
      this.hud.progress(f, text);
      // Let the browser paint the loading bar between heavy steps.
      return new Promise((r) => setTimeout(r, 16));
    };

    await step(0.02, bn.ui.loading.letters);
    await SignAtlas.loadFonts();

    // A fixed start view for the title screen; the player rig takes over on Play.
    await step(0.06, bn.ui.loading.sky);
    const asked = new URLSearchParams(location.search).get("region");
    const region = regions[this.arrival?.to ?? ""] ?? regions[asked ?? ""] ?? regions[this.save.region ?? ""] ?? regions[defaultRegionId];
    this.hud.setRegionName(region.displayNameBn);
    this.hud.setDistricts(Object.values(regions).map((q) => ({ id: q.id, name: q.shortNameBn })), region.id);
    if (this.arrival) {
      this.hud.setArrival(bn.travel.arrived(region.shortNameBn));
      this.hud.setJourney(bn.travel.journey(regions[this.arrival.from]?.shortNameBn ?? "", region.shortNameBn));
    } else this.hud.setHasSave(this.save.playSeconds > 0);
    this.city = new City(this.scene, region, this.quality.anisotropy, this.quality.signSize);
    this.rig = new CameraRig(this.scene, this.city.collision);
    this.rig.sensitivity = this.settings.sensitivity;
    this.scene.activeCamera = this.rig.camera;

    this.env = new Environment(this.scene, this.quality);
    await this.env.load(["morning", "noon", "golden", "dusk", "night"]);
    this.env.speed = DAY_PACE[this.settings.dayPace];
    // Starts a little before the chosen time, so the light is already on its way there.
    const start = ENV_KEYS.find((k) => k.name === this.settings.time)!;
    this.env.setHour(this.arrival ? this.arrival.hour : this.save.hour ?? start.hour - 1.2);
    this.post = new PostStack(this.scene, this.rig.camera, this.quality);

    await step(0.12, bn.ui.loading.props);
    await this.city.load((d, t) => this.hud.progress(0.12 + (d / t) * 0.28, bn.ui.loading.props));

    await step(0.4, bn.ui.loading.people);
    await preloadCharacters(this.scene, (d, t) => this.hud.progress(0.4 + (d / t) * 0.14, bn.ui.loading.people));

    await step(0.54, bn.ui.loading.vehicles);
    const shadow = (m: AbstractMesh): void => void this.env.shadows.addShadowCaster(m, false);
    // People only need shadows close up; beyond that they are too small to justify the draw calls.
    const personShadow = (m: AbstractMesh): void => {
      this.personCasters.add(m);
      shadow(m);
    };
    this.fleet = new VehicleFleet(this.scene, this.city.signs, shadow);
    await this.fleet.preload((d, t) => this.hud.progress(0.54 + (d / t) * 0.14, bn.ui.loading.vehicles));

    await step(0.7, bn.ui.loading.district);
    const addCaster = (m: Mesh): void => void this.env.shadows.addShadowCaster(m, false);
    const removeCaster = (m: Mesh): void => void this.env.shadows.removeShadowCaster(m, false);
    this.city.generate(addCaster, removeCaster, this.quality.macroSize, this.quality.anisotropy, this.quality.detailRadius);
    this.env.cullCascades(this.rig.camera, (m) => {
      if (this.city.isDetailMesh(m as Mesh) || this.personCasters.has(m)) return 0;
      return this.city.props.shadowLayerLimit(m as Mesh) ?? 1;
    });

    await step(0.78, bn.ui.loading.walking);
    this.crowd = new Crowd(this.scene, personShadow);
    this.crowd.build();

    await step(0.84, bn.ui.loading.lights);
    this.traffic = new TrafficSystem(this.scene, this.city, this.fleet);
    this.traffic.setTarget(Math.round(this.quality.traffic * this.settings.traffic));
    this.traffic.onHorn = (v) => this.audio.hornAt(v.spec.horn, v.x, v.z);
    this.traffic.populateParked();

    this.peds = new Pedestrians(this.scene, this.city, this.traffic, this.crowd, personShadow);
    this.peds.setTarget(Math.round(this.quality.pedestrians * this.settings.crowd));
    this.peds.onWhistle = (x, z) => this.audio.whistleAt(x, z);
    this.peds.spawnFixed();
    for (const b of this.city.bridges) this.peds.addRoutes(this.city.bridgeRoute(b.x, b.z), 7);
    this.playgrounds = this.city.parks.map((f) => new Playground(this.scene, this.peds, f, (t, who) => this.line(t, who, who.id, 1.25, true)));
    // Students crossing the yard, and groups of them standing about in it.
    for (const c of this.city.campuses) {
      const kid = c.kind === "school" ? 0.8 : 1;
      this.peds.addRoutes([[c.gateX, KERB_H, c.gateZ - 3], [c.gateX, KERB_H, c.gateZ + 3], [c.doorX, KERB_H, c.doorZ]], c.kind === "school" ? 10 : 12, ["npc_student_lemon", "npc_student_lemon", "npc_commuter_lychee"], kid);
      for (let i = 0; i < 12; i++) {
        const who = this.peds.addStanding(i % 3 === 2 ? "npc_commuter_lychee" : "npc_student_lemon", i % 2 ? "talk" : "idle_look");
        const a = (i / 12) * Math.PI * 2, group = Math.floor(i / 4);
        who.x = c.yardX0 + ((group + 0.5) / 3) * (c.yardX1 - c.yardX0) + Math.cos(a * 3) * 0.9;
        who.z = c.yardZ0 + (c.yardZ1 - c.yardZ0) * (group === 1 ? 0.7 : 0.35) + Math.sin(a * 3) * 0.9;
        who.y = KERB_H;
        who.size = kid;
        who.yaw = a * 3 + Math.PI;
        // A school is all in the one uniform.
        if (c.kind === "school") who.outfit = 1;
      }
    }
    const line = region.layout.metro;
    if (line) {
      for (const sx of [1, -1]) for (const sz of [1, -1]) this.peds.addRoutes(this.city.stationRoute(line.x, line.stationZ, sx, sz), 3);
    }
    // Shoppers pushing through the market lanes, and everyone who comes out at the same time.
    for (const lane of this.city.marketLanes) this.peds.addRoutes(lane, 9);
    for (const c of this.city.campuses) {
      const out: [number, number, number][] = [[c.doorX, KERB_H, c.doorZ], [c.gateX, KERB_H, c.gateZ + 2], [c.gateX, KERB_H, c.gateZ - 2], [c.gateX + (c.gateX > 0 ? -60 : 60), KERB_H, c.gateZ - 3]];
      this.peds.addRoutes(out, c.kind === "school" ? 34 : 18, ["npc_student_lemon", "npc_student_lemon"], c.kind === "school" ? 0.8 : 1, [c.kind === "school" ? [13, 14.2] : [16.5, 17.5]]);
    }
    for (const f of this.city.factories) {
      const out: [number, number, number][] = [[f.doorX, KERB_H, f.doorZ], [f.gateX, KERB_H, f.gateZ + 2], [f.gateX, KERB_H, f.gateZ - 2], [f.gateX + (f.gateX > 0 ? -90 : 90), KERB_H, f.gateZ - 3]];
      this.peds.addRoutes(out, 70, ["npc_commuter_lychee", "npc_worker_jackfruit"], 1, [[17, 18.3]]);
      this.peds.addRoutes([...out].reverse(), 40, ["npc_commuter_lychee", "npc_worker_jackfruit"], 1, [[7.2, 8.2]]);
    }
    // Along the footpath and in at the mosque door before each prayer, and home again afterwards.
    // At the usual pace of the day that walk takes about an hour, so they set off in good time.
    const going = bn.rhythm.prayerHours.map((t): [number, number] => [t - 1.1, t - 0.1]);
    const leaving = bn.rhythm.prayerHours.map((t): [number, number] => [t + 0.4, t + 0.85]);
    const men: CharacterId[] = ["npc_elder_date", "npc_elder_date", "npc_office_orange", "npc_shop_papaya", "npc_commuter_lychee", "npc_worker_jackfruit"];
    for (const m of this.city.mosques) {
      for (const side of [1, -1]) {
        const way: [number, number, number][] = [[m.x + side * m.reach, KERB_H, m.footpathZ], [m.x + side * 1.5, KERB_H, m.footpathZ], [m.x + side * 0.8, KERB_H, m.doorZ]];
        this.peds.addRoutes(way, 8, men, 1, going);
        this.peds.addRoutes([...way].reverse(), 8, men, 1, leaving);
      }
    }
    // Up on the steps of the open-air stage of an evening, and a song on the stage.
    for (const q of this.city.stageSeats) {
      const who = this.peds.addStanding(PEDESTRIAN_IDS[Math.floor(Math.random() * PEDESTRIAN_IDS.length)], "sit_bench");
      who.x = q.x;
      who.y = q.y;
      who.z = q.z;
      who.yaw = q.yaw;
    }
    for (const q of this.city.stagePlayers) {
      const who = this.peds.addStanding("npc_elder_date", "talk");
      who.x = q.x;
      who.y = q.y;
      who.z = q.z;
      who.yaw = q.yaw;
    }
    this.peds.addJamSellers(6);
    this.strays = new Strays(this.city);
    this.interactions.onFocus = (a) => this.hud.setFocus(a);

    this.hero = heroById(this.save.hero);
    setHeroVoice(this.hero.id);
    setAddress(this.hero.called[0], this.hero.called[1]);
    this.player = new Player(this.scene, this.city, this.traffic, this.fleet, this.peds, this.rig, this.input, this.audio, {
      say: (t, s, speak) => {
        this.hud.say(t, s);
        if (speak) this.audio.speak(t);
      },
      prompt: (h) => this.hud.prompt(h),
      line: (t, a, id, top) => this.line(t, a, id, top),
      crash: (v, impact, hit) => {
        this.reactions.crash(v, impact, hit);
        this.extras.crashed(v, impact);
        if (impact > 4) {
          this.life.hurt((impact - 4) * 1.1);
          this.life.data.stats.crashes++;
          if (impact > 8) this.panels.knock();
        }
        if (hit && impact > 6) this.law.report(bn.law.why.crash, 500);
      },
      hitBy: (v) => {
        this.reactions.heroHit(v);
        this.life.hurt(4 + Math.min(Math.abs(v.speed), 12) * 0.9);
        this.panels.knock();
      },
      hire: (v) => this.trips.hire(v),
      seated: (v) => this.trips.seated(v),
      gotOut: (v) => this.trips.gotOut(v),
      finesOwed: () => this.law.owed,
      ranRed: () => this.law.report(bn.law.why.red, 300, "post"),
      tooYoung: () => this.line(bn.heroes.kidNoDrive[Math.floor(Math.random() * bn.heroes.kidNoDrive.length)], this.player, "npc_office_orange", 1.6),
      refused: (v) => {
        const lines = v.impounded ? [bn.law.locked] : bn.law.noEntry;
        const text = lines[Math.floor(Math.random() * lines.length)];
        const officer = this.city.police.reduce((best, p) => (Math.hypot(p.x - this.player.x, p.z - this.player.z) < Math.hypot(best.x - this.player.x, best.z - this.player.z) ? p : best), this.city.police[0]);
        this.line(text, v.driverId ? seatAnchor(v) : officer ?? this.player, "npc_police_coconut", 1.72);
      },
      reset: () => {
        this.talk.stop();
        this.tea.stop();
        this.trips.stop();
        this.hail.stop();
      },
    }, personShadow, this.interactions, this.hero);
    this.peds.onLine = (t, who) => this.line(t, who, who.id, who.pose === "sit_bench" ? 1.2 : 1.72, true);
    this.peds.onBusCalling = (bus) => {
      // With the hero aboard, the helper calls the stop so they know where they've got to.
      if (this.player.vehicle === bus) {
        const place = this.city.layout.areaAt(bus.x, bus.z);
        this.line(bn.trip.thisStop(place), this.trips.conductorAt(bus), "conductor", 0);
      } else this.line(bn.trip.calling(bus.routeName.split(" — ")[1] ?? bus.routeName), seatAnchor(bus), "conductor", 0.35, true);
    };
    this.talk = new Talk(this.hud, this.audio, this.input, this.player, this.peds, this.city, this.wallet);
    this.shops = new Shops(this.city, this.peds);
    this.panels = new Panels();
    this.panels.onOverlayClosed = () => this.closeOverlay();
    this.handOver = new HandOver(this.scene, this.player, this.peds, this.audio);
    this.bag = new Bag(this.wallet, this.life, this.player, this.panels, this.hud, () => this.save.playSeconds);
    this.bag.passTime = (h) => this.env.setHour((this.env.hour + h) % 24);
    this.bag.saveGame = () => this.keepGame();
    this.talk.onBought = (key) => {
      this.handOver.goodsBack();
      this.bag.bought(key);
    };
    this.talk.useNow = (key) => (this.bag.canUseNow(key) ? this.bag.useWord(key) : null);
    this.talk.onUse = (key) => this.bag.use(key);
    this.wallet.onSpend = (n) => {
      this.panels.money(-n);
      const c = this.talk.counterpart;
      if (c) this.handOver.give(c.anchor, c.person);
      else if (this.trips?.payee) this.handOver.give(this.trips.payee, null);
    };
    this.life.onCollapse = () => this.collapse();
    this.hud.setMoney(this.wallet.taka, false);
    this.wallet.onChange = (taka) => this.hud.setMoney(taka);
    this.tea = new TeaBreak(this.scene, this.hud, this.input, this.player, this.peds, this.talk, (t, a, id, top) => this.line(t, a, id, top));
    this.reactions = new Reactions(this.city, this.city.props, this.peds, this.traffic, this.audio, (t, a, id, top) => this.line(t, a, id, top, true), () => this.player.position, (this.crashFx = new CrashFx(this.scene)), (k) => this.rig.kick(k));
    this.peds.onKnocked = (who, speed) => {
      this.reactions.knocked(who, speed, this.player.driving);
      this.life.addRep(-2);
    };
    this.city.loose.onHit = (x, y, z, k) => this.reactions.scatter(x, y, z, k);
    this.routes = new RouteFinder(this.city.layout);
    this.trips = new Trips(this.hud, this.player, this.traffic, this.talk, this.city, this.wallet, (gate, by) => this.journey(gate.to, by));
    this.gates = new Gates(this.hud, this.input, this.player, region, (gate, v) => this.journey(gate.to, "drive", v));
    this.hail = new Hail(this.hud, this.input, this.player, this.traffic, this.trips, (t, a, id, top) => this.line(t, a, id, top));
    this.traffic.onBlocked = (v) => {
      if (v.driverId) this.line(bn.blocked[Math.floor(Math.random() * bn.blocked.length)], seatAnchor(v), v.driverId, 0.35);
    };
    this.addInteractions();
    this.doors = new Doors(this.hud, this.input, this.player, this.city, this.peds, this.talk, this.wallet, this.env, this.interactions);
    this.bag.atHome = () => this.doors.inside?.kind === "home" || this.doors.inside?.kind === "hotel";
    this.doors.onSlept = () => {
      // A fan makes for a better night, and something green by the window for a better morning.
      this.life.heal(100);
      this.life.refresh(100);
      this.keepGame();
      this.hud.say(bn.life.sleptWell, 3.5);
    };
    this.doors.homeOffers = (out) => {
      if (this.life.data.home.includes("kettle")) {
        out.push({ key: "KeyG", html: bn.life.teaAtHome, priority: 74, run: () => {
          this.life.heal(4);
          this.life.refresh(40);
          this.player.gesture("tea", 2.4);
          this.hud.say(bn.life.teaMade, 2.6);
        } });
      }
      const raw = Object.keys(this.wallet.items).find((k) => itemOf(k).kind === "raw");
      if (raw) out.push({ key: "KeyH", html: bn.life.cookPrompt(this.bag.nameOf(raw)), priority: 73, run: () => this.bag.use(raw) });
    };
    if (!this.save.tickets) this.save.tickets = [];
    this.talk.tickets = this.save.tickets;
    this.law = new PoliceForce(this.city, this.traffic, this.player, this.peds, this.hud, this.audio, this.talk, this.save.tickets, (t, a, id, top) => this.line(t, a, id, top), () => writeSave(this.save));
    this.talk.onFinesPaid = () => {
      writeSave(this.save);
      for (const v of this.traffic.parked) v.impounded = false;
    };
    this.catchGame = new CatchGame(this.scene, this.city, this.player, this.hud, this.interactions, !this.hero.drives);
    this.weather = new Weather(this.scene, this.env, this.city, this.audio);
    this.weather.setting = this.settings.rain;
    this.peds.rainGear = new RainGear(this.scene);
    this.traffic.onSiren = (v) => {
      const d = Math.hypot(v.x - this.rig.camera.position.x, v.z - this.rig.camera.position.z);
      this.sirenNear = Math.max(this.sirenNear, Math.max(0, 1 - d / 110));
    };
    if (!this.save.phone) this.save.phone = freshPhone();
    this.phone = new Phone(this.phoneHost(), this.save.phone);
    this.startMissions();

    const { metro } = region.layout;
    if (metro) {
      this.train = new MetroTrain(this.scene, this.city.props, metro.x, metro.fromZ, metro.toZ, metro.stationZ, shadow);
      this.metro = new Metro(this.city, this.hud, this.player, this.talk, this.train, this.peds, this.interactions, (to) => this.journey(to, "metro"));
    }

    this.night = new NightLights(this.scene, this.city);
    this.rhythm = new CityRhythm(this.city, this.env, this.hud, this.peds, this.night, this.save);
    this.buildBigMap();
    this.city.setNightGlow(this.env.night);
    this.post.setGrade(this.env.exposure, this.env.contrast);

    await step(0.9, bn.ui.loading.near);
    const p = this.player.position;
    this.city.forceDetailAround(p.x, p.z);
    this.city.props.updateVisibility(p.x, p.z, this.quality.viewScale);
    this.env.shadows.getShadowMap()!.refreshRate = 1;

    // Fill the streets before the title appears, so the first view is already alive.
    this.traffic.playerX = p.x;
    this.traffic.playerY = this.player.y;
    this.traffic.playerZ = p.z;
    this.traffic.playerRadius = 0.34;
    // Runs the roads for a while, however long the chosen amount of traffic takes to arrive.
    const wanted = Math.round(this.quality.traffic * this.settings.traffic);
    for (let i = 0; i < 90 || (this.traffic.vehicles.length < wanted && i < 600); i++) this.traffic.update(0.1);
    this.peds.populate(p.x, p.z);
    await step(0.92, bn.ui.loading.shaders);
    this.scene.getActiveMeshCandidates = () => this.candidateList;
    await this.prewarm();

    this.env.enableFreezing();
    this.refreshCandidates();
    this.buildChooser();
    this.audio.voiceEnabled = this.settings.voice;
    this.hud.showGpuHint(isIntegratedGpu(gl));
    setTimeout(() => this.hud.showGpuHint(false), 14000);
    this.hud.progress(1, bn.ui.loading.ready);
    this.applyViewSettings();
    this.state = "title";
    this.hud.showTitle();
    this.engine.runRenderLoop(() => {
      // One bad frame mustn't end the game: it's reported, and the next one tries again.
      try {
        this.frame();
      } catch (e) {
        console.error(e);
        (window as unknown as { __errs?: string[] }).__errs?.push(String(e).slice(0, 200));
      }
    });
  }

  /** Compiles every shader and draws every kind of mesh once, behind the loading screen. Left to
   *  happen on demand, the first sight of each new kind of thing freezes the game for a moment
   *  while the graphics driver compiles, and on a first visit those moments add up to seconds. */
  private async prewarm(): Promise<void> {
    const begin = performance.now();
    this.peds.warmPool();
    const undo: (() => void)[] = [];
    const meshes: AbstractMesh[] = [];
    for (const m of this.scene.meshes) {
      if (m.getTotalVertices() === 0 || !m.material) continue;
      if (!m.isEnabled(false)) {
        m.setEnabled(true);
        undo.push(() => m.setEnabled(false));
      }
      if (m instanceof Mesh && m.thinInstanceCount === 0) {
        // Only takes effect on meshes that have an instance buffer, which is what's wanted.
        m.thinInstanceCount = 1;
        if (m.thinInstanceCount === 1) undo.push(() => (m.thinInstanceCount = 0));
      }
      if (!m.alwaysSelectAsActiveMesh) {
        m.alwaysSelectAsActiveMesh = true;
        undo.push(() => (m.alwaysSelectAsActiveMesh = false));
      }
      meshes.push(m);
    }
    const nextFrame = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
    const progress = (f: number): void => this.hud.progress(0.92 + f * 0.07, bn.ui.loading.shaders);

    // Starts the compile for everything, which the browser can do in parallel where it supports that.
    let waited = 0;
    while (!this.scene.isReady(true) && waited < 30000) {
      await new Promise((r) => setTimeout(r, 40));
      waited = performance.now() - begin;
      progress(Math.min(waited / 12000, 0.4));
    }

    // The driver still finishes some shaders only on first use, so really draw it all: first the shadow pass...
    const list = this.candidateList;
    this.candidates.length = 0;
    list.length = 0;
    this.env.drawAllCasters = true;
    this.scene.render();
    this.env.drawAllCasters = false;
    progress(0.5);
    await nextFrame();
    // ...then the main pass, in batches, so the loading bar keeps moving.
    const BATCH = 36;
    for (let i = 0; i < meshes.length; i += BATCH) {
      this.candidates.length = 0;
      for (let k = i; k < Math.min(i + BATCH, meshes.length); k++) this.candidates.push(meshes[k]);
      list.length = this.candidates.length;
      this.scene.render();
      progress(0.5 + (0.5 * i) / meshes.length);
      await nextFrame();
    }
    for (const u of undo) u();
    this.peds.coolPool();
    console.log(`[game] shaders ready in ${((performance.now() - begin) / 1000).toFixed(1)}s, ${meshes.length} meshes, parallel compile ${this.engine.getCaps().parallelShaderCompile ? "yes" : "no"}`);
  }

  private resolveQuality(q: QualityName): QualityPreset {
    return QUALITY[q === "auto" ? detectQuality(this.engine._gl as WebGL2RenderingContext) : q];
  }

  /** Off to another district. The page reloads to build it, and `arrive` picks up on the other side. */
  private journey(to: string, by: TravelPlan["by"], v?: Vehicle): void {
    leaveFor({
      from: this.city.region.id,
      to,
      by,
      vehicle: v ? { id: v.id, variant: v.arch.bodies[v.variant]?.name ?? "default" } : undefined,
      hour: this.env.hour + 0.35,
    }, this.save);
  }

  /** Where the journey lands: on the road in from where they came, or at a stop near it. */
  private arrive(plan: TravelPlan): void {
    const region = this.city.region;
    const gate = region.gates.find((g) => g.to === plan.from) ?? region.gates[0];
    if (plan.by === "drive" && plan.vehicle && gate) {
      const heading: Heading = gate.axis === "v" ? (gate.end > 0 ? 2 : 0) : gate.end > 0 ? 3 : 1;
      const road = region.layout.roads.find((q) => q.axis === gate.axis && q.at === gate.at);
      const lanes = this.city.graph.lanes.filter((l) => l.road === road && l.heading === heading && l.index === l.laneCount - 1);
      const lane = lanes.sort((p, q) => (gate.axis === "v" ? gate.end * (q.pts[1] - p.pts[1]) : gate.end * (q.pts[0] - p.pts[0])))[0];
      if (lane) {
        const start = gate.end * (region.layout.boundary + 3);
        const x = gate.axis === "v" ? lane.pts[0] : start, z = gate.axis === "v" ? start : lane.pts[1];
        const v = this.traffic.spawnParkedAt(plan.vehicle.id as VehicleId, plan.vehicle.variant, x, z, Math.atan2(DIR[heading][0], DIR[heading][1]));
        if (v) this.player.takeWheel(v);
      }
    } else if (plan.by === "metro") {
      this.metro?.land(plan.from);
    } else if (gate) {
      const out = gate.axis === "v" ? { x: gate.at, z: gate.end * 380 } : { x: gate.end * 380, z: gate.at };
      const stop = plan.by === "bus" ? this.trips.nearestStop(out.x, out.z) : null;
      if (stop) this.player.standAt(stop.x + 1.6, stop.z + 1.6);
    }
    this.hud.say(`${bn.travel.arrived(region.shortNameBn)}। ${bn.travel.by[plan.by]}`, 5);
    this.arrival = null;
  }

  private play(): void {
    this.audio.useVoicePack = this.settings.voiceKind === "pack";
    this.audio.setMuted(this.settings.muted);
    this.audio.setLevel("voice", this.settings.soundVoice);
    this.audio.setLevel("ambience", this.settings.soundAmbience);
    this.audio.setLevel("vehicles", this.settings.soundVehicles);
    this.audio.setLevel("effects", this.settings.soundEffects);
    this.audio.unlock(this.settings.volume);
    this.hud.showGame();
    this.state = "playing";
    this.input.enabled = true;
    this.input.requestLock();
    this.rig.snap(this.player.x, this.player.y, this.player.z, 0);
    if (this.arrival) this.arrive(this.arrival);
    else if (this.save.x !== undefined && this.save.z !== undefined && this.save.region === this.city.region.id) {
      // Back where they left off, on foot, out of the way of anything that has moved since.
      this.player.standAt(this.save.x, this.save.z, this.save.y ?? 0);
    }
    this.missions.resume();
    this.canvas.focus();
    this.hud.lookHintVisible(true);
    setTimeout(() => this.hud.lookHintVisible(!this.input.locked), 600);
  }

  /** What the phone needs from the rest of the game. */
  private phoneHost(): PhoneHost {
    return {
      input: this.input,
      hud: this.hud,
      audio: this.audio,
      here: () => ({ x: this.player.x, z: this.player.z, yaw: this.player.yaw, hour: this.env.hour, place: this.city.layout.areaAt(this.player.x, this.player.z) }),
      cash: () => this.wallet.taka,
      spendCash: (n) => this.wallet.spend(n),
      receiveCash: (n) => this.wallet.receive(n),
      save: () => writeSave(this.save),
      places: () => this.navPlaces(),
      route: (x, z) => this.routes.find(this.player.x, this.player.z, x, z),
      nearAgent: () => !this.player.vehicle && this.shops.near("shopAgent", this.player.x, this.player.z, 14),
      callRide: (kind) => this.hail.book(kind === "bike" ? "cng" : kind),
      subjects: () => this.inView(),
      snapshot: () => this.snapshot(),
      loadPhotos: () => loadPhotos<PhotoRecord>(),
      savePhotos: (list) => savePhotos(list),
      wallet: () => this.wallet,
    };
  }

  /** Everywhere worth asking the way to. */
  private navPlaces(): NavPlace[] {
    const out: NavPlace[] = [];
    const { city } = this;
    for (const b of city.layout.blocks) {
      const label = city.layout.areaOf(b) ?? bn.mapPlaces[b.kind];
      if (label) out.push({ label, x: (b.x0 + b.x1) / 2, z: b.z0 - 3, kind: b.kind });
    }
    for (const b of city.interiors.all) out.push({ label: b.name, x: b.outX, z: b.outZ, kind: b.kind });
    const line = city.region.layout.metro;
    if (line) out.push({ label: line.nameBn, x: line.x, z: line.stationZ, kind: "station" });
    let n = 0;
    for (const stop of city.busStops) if (n++ % 3 === 0) out.push({ label: bn.hail.stop, x: stop.x, z: stop.z, kind: "stop" });
    return out;
  }

  /** What's in front of the camera, close enough to make out in a photograph. */
  private inView(): string {
    const p = this.player;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const seen = (x: number, z: number): boolean => {
      const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
      return d < 28 && d > 0.5 && (dx * fx + dz * fz) / d > 0.55;
    };
    const parts: string[] = [];
    for (const v of this.traffic.nearby) {
      if (seen(v.x, v.z)) {
        parts.push(bn.vehicles[v.id]);
        break;
      }
    }
    for (const st of this.city.stalls) {
      if (seen(st.x, st.z)) {
        parts.push(bn.phone.subjects.stall);
        break;
      }
    }
    return parts.join(", ");
  }

  private snapshot(): Promise<string> {
    return new Promise((resolve) => {
      this.engine.onEndFrameObservable.addOnce(() => {
        const src = this.engine.getRenderingCanvas()!;
        const small = document.createElement("canvas");
        small.width = 420;
        small.height = Math.round((420 * src.height) / src.width);
        small.getContext("2d")!.drawImage(src, 0, 0, small.width, small.height);
        resolve(small.toDataURL("image/jpeg", 0.62));
      });
    });
  }

  /** Everything about the moment worth coming back to, written to the slot in use or another. */
  private keepGame(slot?: number): void {
    const s = this.save;
    const v = this.player.vehicle;
    const pos = this.player.position;
    s.region = this.city.region.id;
    // Inside a building counts as standing at its door: insides aren't on the map.
    s.x = this.doors?.inside ? this.doors.outX : pos.x;
    s.z = this.doors?.inside ? this.doors.outZ : pos.z;
    s.y = v ? v.y : this.player.y;
    s.yaw = this.player.yaw;
    s.hour = this.env.hour;
    writeSave(s, slot);
  }

  /** Settings that act straight away on the camera and the picture. */
  private applyViewSettings(): void {
    const st = this.settings;
    this.rig.invertY = st.invertY;
    this.rig.autoFollow = st.autoFollow;
    this.rig.shakeOn = st.shake;
    this.rig.firstFoot = st.viewFoot === "first";
    this.rig.firstDrive = st.viewDrive === "first";
    this.post.brightness = st.brightness;
    this.engine.setHardwareScalingLevel(scalingFor(this.quality) / st.sharpness);
    this.city.setDetailRadius(this.quality.detailRadius * { near: 0.7, mid: 1, far: 1.35 }[st.drawDistance]);
  }

  private pause(): void {
    if (this.state !== "playing") return;
    this.state = "paused";
    this.input.enabled = false;
    this.input.releaseLock();
    if (this.settings.autosave) this.keepGame();
    this.hud.setPauseInfo(this.city.layout.areaAt(this.player.position.x, this.player.position.z), this.wallet.taka, this.save.playSeconds);
    this.hud.setBag(this.bag.rows().map((r) => `${r.name} × ${bnNum(r.count)}`));
    this.hud.setPaused(true);
    this.audio.suspend(true);
  }

  private resume(): void {
    this.state = "playing";
    this.input.enabled = true;
    this.hud.setPaused(false);
    this.input.requestLock();
    this.audio.suspend(false);
  }

  private changeQuality(q: QualityName): void {
    this.settings.quality = q;
    saveSettings(this.settings);
    const preset = this.resolveQuality(q);
    this.applyQuality(preset);
  }

  /** Live changes only: texture sizes and cascade counts that need a rebuild apply next launch. */
  private applyQuality(preset: QualityPreset): void {
    this.quality = preset;
    this.env.setQuality(preset);
    this.post.apply(preset);
    this.applyDensity();
    this.applyViewSettings();
  }

  private applyDensity(): void {
    const t = this.rhythm?.traffic ?? 1, p = this.rhythm?.people ?? 1;
    this.traffic.setTarget(Math.round(this.quality.traffic * this.settings.traffic * t));
    this.peds.setTarget(Math.round(this.quality.pedestrians * this.settings.crowd * p));
  }

  private changeTime(t: TimeName): void {
    this.settings.time = t;
    saveSettings(this.settings);
    this.env.jumpTo(t, 3);
    this.hud.setTimeSelection(t);
  }

  // ---------------------------------------------------------------- people and places

  /** A line said out loud by someone: over their head, in their voice. */
  private line(text: string, anchor: Anchor, id: string, top: number, background = false): void {
    const label = id === "hero_mango" ? bn.you : id === "conductor" ? bn.trip.conductor : roleOf(id).label;
    const said = addressed(text);
    this.hud.bubble(said, label, anchor, top, lineSeconds(said) + 0.9);
    this.audio.speak(said, voiceOf(id), background, undefined, anchor);
  }

  /** What can be done on foot around the district, apart from getting into vehicles. */
  private addInteractions(): void {
    const { peds, city, interactions, hud } = this;
    // A driver who has climbed out to have a word comes first, from on foot or from the seat.
    interactions.add((x, z, _yaw, _driving, out) => {
      const who = peds.complainerNear(x, z, _driving ? 9 : 3);
      if (who) out.push({ key: "KeyE", html: bn.crash.prompt, priority: 90, focus: who, run: () => this.talk.crashTalk(who) });
    });
    // Anyone at all.
    interactions.add((x, z, yaw, driving, out) => {
      if (driving) return;
      const who = peds.nearestPerson(x, z, yaw, 2.5, this.player.y);
      if (!who) return;
      const close = Math.hypot(who.x - x, who.z - z) < 1.5;
      out.push({ key: "KeyE", html: bn.promptTalk(roleOf(who.id).label), priority: close ? 50 : 25, focus: who, run: () => this.talk.talkTo(who) });
    });
    // Shop counters along the street.
    interactions.add((x, z, yaw, driving, out) => {
      if (driving || this.player.y > 2) return;
      const shop = this.shops.at(x, z, yaw);
      if (shop) out.push({ key: "KeyE", html: bn.shop.prompt, priority: 65, focus: shop.keeper, run: () => this.talk.sell(shop.keeper, bn.shop.stock[shop.kind] ?? bn.shop.stock.shopGrocery) });
    });
    // Stalls: order tea at a tea stall, or talk to the owner of anything else across their goods.
    interactions.add((x, z, yaw, driving, out) => {
      if (driving) return;
      for (const st of city.stalls) {
        if (Math.abs(st.x - x) > 3.6 || Math.abs(st.z - z) > 3.6) continue;
        const d = Math.hypot(st.x - x, st.z - z);
        if (d > 3.6) continue;
        const vendor = peds.vendorOf(st);
        if (!vendor) return;
        // Facing the stall means the stall, whoever is walking past. Facing away, it's the people.
        const facing = ((st.x - x) * Math.sin(yaw) + (st.z - z) * Math.cos(yaw)) / Math.max(d, 0.01);
        if (st.kind !== "tea") {
          const stock = bn.shop.stock[st.prop];
          out.push({ key: "KeyE", html: stock ? bn.shop.promptCart : bn.promptTalk(roleOf(vendor.id).label), priority: facing > 0.1 ? 60 : 20, focus: vendor, run: () => (stock ? this.talk.sell(vendor, stock) : this.talk.talkTo(vendor)) });
          return;
        }
        out.push({
          key: "KeyE",
          html: bn.tea.prompt,
          priority: facing > 0.1 ? 60 : 20,
          focus: vendor,
          run: () => this.talk.orderTea(vendor, st, () => !!peds.freeSeat(st, this.player.x, this.player.z), (order, stall) => {
            this.life.heal(6);
            this.life.refresh(45);
            this.tea.begin(order, stall);
          }),
        });
        return;
      }
    });
    // Calling a ride. It's a key of its own, and the only prompt is the reminder when near a road.
    interactions.add((x, z, _yaw, driving, out) => {
      if (driving || this.player.y > 1) return;
      const near = city.layout.nearRoad(x, z, 9);
      out.push({
        key: "KeyQ",
        html: near && !this.traffic.waiting ? bn.hail.prompt : "",
        priority: 10,
        run: () => {
          if (near) this.hail.press();
          else hud.say(bn.hail.farRoad, 2.4);
        },
      });
    });
    // Places to look at.
    const sights = this.sights();
    interactions.add((x, z, _yaw, driving, out) => {
      if (driving || this.player.y > 9) return;
      for (const s of sights) {
        if (Math.abs(s.x - x) > s.range || Math.abs(s.z - z) > s.range || Math.hypot(s.x - x, s.z - z) > s.range) continue;
        const info = { ...bn.inspect.places[s.key], ...bn.regionText[city.region.id]?.[s.key] };
        out.push({
          key: "KeyE",
          html: bn.inspect.prompt(info.name),
          priority: 10,
          run: () => {
            hud.showInfo(info.title, info.text, 8);
            this.lookAt = { x: s.x, z: s.z, time: 1.6 };
          },
        });
        return;
      }
    });
  }

  /** Everything worth a closer look, drawn from this district's own layout. */
  private sights(): { key: string; x: number; z: number; range: number }[] {
    const { plaza, metro } = this.city.region.layout;
    const out: { key: string; x: number; z: number; range: number }[] = [];
    if (metro) out.push({ key: "station", x: metro.x, z: metro.stationZ, range: 22 });
    out.push({ key: "plaza", x: plaza.x, z: plaza.z, range: plaza.radius + 6 });
    out.push({ key: "footbridge", x: plaza.x, z: plaza.z - 62, range: 11 });
    for (const b of this.city.layout.blocks) {
      if (!bn.inspect.places[b.kind]) continue;
      const span = Math.max(b.x1 - b.x0, b.z1 - b.z0);
      out.push({ key: b.kind, x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, range: span * 0.55 + 3 });
    }
    for (const s of this.city.busStops) out.push({ key: "bus", x: s.x, z: s.z, range: 4.5 });
    return out;
  }

  // ---------------------------------------------------------------- big map

  private buildBigMap(): void {
    const { city } = this;
    const points: MapPoint[] = [
      ...city.busStops.map((s) => ({ x: s.x, z: s.z, kind: "bus" as const })),
      ...city.police.map((p) => ({ x: p.x, z: p.z, kind: "police" as const })),
      ...city.stalls.filter((s) => s.kind === "tea").map((s) => ({ x: s.x, z: s.z, kind: "tea" as const })),
    ];
    const places: MapPlace[] = [];
    const { plaza, metro } = city.region.layout;
    const { flyover } = city.region.layout;
    places.push({ x: plaza.x, z: plaza.z, label: plaza.nameBn });
    if (metro) places.push({ x: metro.x + 34, z: metro.stationZ, label: metro.nameBn });
    if (flyover) places.push({ x: flyover.axis === "h" ? (flyover.start + flyover.end) / 2 : flyover.at, z: flyover.axis === "h" ? flyover.at + 18 : (flyover.start + flyover.end) / 2, label: bn.mapFlyover });
    for (const b of city.bridges) places.push({ x: b.x + 30, z: b.z, label: bn.mapBridge });
    // Roads out, named at the edge of the map where they leave.
    for (const g of city.region.gates) {
      const p = g.end * (city.region.layout.boundary + 22);
      places.push(g.axis === "v" ? { x: g.at, z: p, label: `${g.nameBn} ${g.end > 0 ? "↑" : "↓"}` } : { x: p - g.end * 30, z: g.at + 22, label: g.end > 0 ? `${g.nameBn} →` : `← ${g.nameBn}` });
    }
    for (const b of city.interiors.all) if (b.kind !== "mall" && b.kind !== "thana") places.push({ x: b.outX, z: b.outZ, label: b.name });
    for (const b of city.layout.blocks) {
      // Quiet streets of houses speak for themselves: the map only names what stands out.
      const label = b.kind === "villas" ? undefined : bn.mapPlaces[b.kind];
      if (label) places.push({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, label });
    }
    this.hud.buildMap(city.layout, points, places, { buildings: city.allBuildings, lakes: city.lakes, bridges: city.bridges });
    this.hud.setWays(city.region.id, city.region.displayNameBn, city.region.gates.map((g) => ({
      name: g.nameBn,
      via: g.viaBn,
      bus: city.region.busRoutes.find((q) => q.to === g.to)?.name ?? "",
      metro: !!metro && !!regions[g.to]?.layout.metro,
    })));
  }

  private toggleBigMap(): void {
    if (this.hud.bigMapOpen) {
      this.hud.showBigMap(false);
      this.mapPaused = false;
      this.resume();
      return;
    }
    if (this.state !== "playing") return;
    this.state = "paused";
    this.mapPaused = true;
    this.input.enabled = false;
    this.input.releaseLock();
    const v = this.player.vehicle;
    const pos = this.player.position;
    const marks = this.traffic.vehicles.map((q) => ({ x: q.x, z: q.z }));
    this.hud.showBigMap(true, pos.x, pos.z, v ? v.heading : this.player.yaw, marks);
  }

  /** Watches frame rate on the Auto preset and steps down rather than letting the game crawl. */
  private autoAdjust(dt: number): void {
    if (this.settings.quality !== "auto") return;
    this.autoTimer += dt;
    this.autoFrames++;
    if (this.autoTimer < AUTO_WINDOW) return;
    const fps = this.autoFrames / this.autoTimer;
    this.autoTimer = 0;
    this.autoFrames = 0;
    if (fps < 26) this.autoLow++;
    else this.autoLow = 0;
    if (this.autoLow >= 2) {
      this.autoLow = 0;
      const order: QualityPreset["name"][] = ["ultra", "high", "medium", "low"];
      const i = order.indexOf(this.quality.name);
      if (i < order.length - 1) {
        console.log(`[game] auto quality: ${fps.toFixed(0)} fps, dropping to ${order[i + 1]}`);
        this.applyQuality(QUALITY[order[i + 1]]);
      }
    }
  }

  /** Shortlists what the engine tests each frame. Disabled and geometry-free nodes make up most
   *  of the scene, and testing them all used more of the frame than drawing did. */
  private refreshCandidates(): void {
    const out = this.candidates;
    out.length = 0;
    for (const m of this.scene.meshes) {
      if (m.getTotalVertices() === 0 || !m.isEnabled()) continue;
      out.push(m);
    }
    this.candidateList.length = out.length;
  }

  /** Time since the last frame, with the measuring error taken out. The display runs like clockwork,
   *  but timing a frame from inside it is out by a few milliseconds either way. Moved by those raw
   *  numbers, everything shimmers against the camera. Real slowdowns still come through, spread over
   *  a few frames, and no time is ever lost. */
  private steadyDt(): number {
    const raw = Math.min(this.engine.getDeltaTime() / 1000, 0.066);
    this.dtAverage += (raw - this.dtAverage) * 0.1;
    this.dtOwed = Math.max(-0.05, Math.min(0.05, this.dtOwed + raw - this.dtAverage));
    const repay = Math.max(-0.0015, Math.min(0.0015, this.dtOwed));
    this.dtOwed -= repay;
    return Math.max(0.001, this.dtAverage + repay);
  }

  private frame(): void {
    const dt = this.steadyDt();
    const input = this.input;
    this.env.update(dt, this.state === "playing" || this.state === "title" ? dt : 0);
    this.post.setGrade(this.env.exposure, this.env.contrast);
    this.city.setNightGlow(this.env.night);

    if (this.state === "playing") {
      if (this.phone.inCamera && (input.pressed("Escape") || input.pressed("KeyP"))) this.phone.backFromCamera();
      else if (input.pressed("KeyP")) this.phone.toggle();
      else if (input.pressed("Escape")) this.pause();
      if (input.pressed("KeyT")) this.nextTime();
      if (input.pressed("KeyV")) this.switchView();
      if (input.pressed("KeyB")) this.openChooser();
      if (input.pressed("KeyM")) this.toggleBigMap();
      if (input.pressed("KeyI")) this.openBag();
      if (input.pressed("KeyJ")) this.openJournal();
      this.step(dt);
      this.autoAdjust(dt);
    } else if (this.state === "title") {
      this.titleCamera(dt);
      this.stepWorld(dt, this.doors.outX, this.doors.outZ);
    } else if (this.chooserPaused && (input.pressed("Escape") || input.pressed("KeyB"))) {
      this.hud.showChooser(false);
    } else if (this.overlayPaused) {
      if (input.pressed("Escape") || input.pressed("KeyI") || input.pressed("KeyJ")) this.panels.closeOverlay();
    } else if (this.mapPaused && (input.pressed("Escape") || input.pressed("KeyM"))) {
      this.toggleBigMap();
    }
    // Built last thing before drawing: anything switched on this frame must be in it, or it flickers.
    this.refreshCandidates();
    this.scene.render();
    if (this.state === "playing") this.hud.layoutWorldText(dt, this.project, this.rig.camera.position.x, this.rig.camera.position.z, this.rig.yaw);
    input.endFrame();
  }

  /** Where a world point lands on screen, using the view just drawn. */
  private project = (x: number, y: number, z: number, out: { x: number; y: number }): boolean => {
    const m = this.scene.getTransformMatrix().m;
    const w = x * m[3] + y * m[7] + z * m[11] + m[15];
    if (w <= 0.01) return false;
    out.x = (((x * m[0] + y * m[4] + z * m[8] + m[12]) / w + 1) / 2) * window.innerWidth;
    out.y = ((1 - (x * m[1] + y * m[5] + z * m[9] + m[13]) / w) / 2) * window.innerHeight;
    return true;
  };

  private nextTime(): void {
    const i = ENV_KEYS.findIndex((k) => k.name === this.env.timeName);
    const next = ENV_KEYS[(i + 1) % ENV_KEYS.length].name;
    this.changeTime(next);
    this.hud.say(bn.times[next], 1.4);
  }

  /** Slow orbit over the golchattar, behind the title screen. */
  private titleCamera(dt: number): void {
    this.titleAngle += dt * 0.035;
    const a = this.titleAngle - 0.9;
    const { plaza } = this.city.region.layout;
    const cam = this.rig.camera;
    cam.position.set(plaza.x + Math.sin(a) * 42, 11 + Math.sin(this.titleAngle * 0.7) * 2, plaza.z + Math.cos(a) * 42);
    cam.setTarget(new Vector3(plaza.x, 5, plaza.z));
    this.city.updateStreaming(cam.position.x, cam.position.z);
  }

  private startMissions(): void {
    const host: MissionHost = {
      scene: this.scene, city: this.city, peds: this.peds, traffic: this.traffic, player: this.player, input: this.input, talk: this.talk, hud: this.hud, panels: this.panels, phone: this.phone, doors: this.doors, audio: this.audio, wallet: this.wallet, life: this.life, routes: this.routes, interactions: this.interactions,
      hour: () => this.env.hour,
      setHour: (h) => this.env.setHour(h),
      openOverlay: () => this.openOverlay(),
      snapshot: () => void this.snapshot().then((data) => {
        const list = loadPhotos<PhotoRecord>();
        list.push({ data, place: this.city.layout.areaAt(this.player.x, this.player.z), hour: this.env.hour, what: "" });
        savePhotos(list.slice(-14));
      }),
      saveNow: () => this.keepGame(),
    };
    this.missions = new MissionRunner(host, [...STORY_1, ...STORY_2], () => this.settings.missionsOff, () => this.city.region.id);
    this.collapsed = () => this.missions.fail(bn.ui.collapsedFail);
    const treeHost: TreeHost = {
      hud: this.hud, input: this.input, audio: this.audio, player: this.player, panels: this.panels, talk: this.talk, peds: this.peds, wallet: this.wallet, life: this.life,
      mobile: (n) => {
        if (this.save.phone) this.save.phone.mobile = Math.max(0, this.save.phone.mobile + n);
      },
      playSeconds: () => this.save.playSeconds,
      saveNow: () => this.keepGame(),
    };
    this.tree = new TreeRunner(treeHost);
    this.converse = new Converse(this.talk, this.life, this.wallet, this.bag, this.panels, this.peds, this.player, this.hero, () => this.missions, () => void this.snapshot().then((data) => {
      const list = loadPhotos<PhotoRecord>();
      list.push({ data, place: this.city.layout.areaAt(this.player.x, this.player.z), hour: this.env.hour, what: "" });
      savePhotos(list.slice(-14));
    }), () => this.save.playSeconds, () => this.env.hour > 11 && this.env.hour < 16, () => this.weather.rain > 0.12, () => this.env.night > 0.5, (t, who) => this.line(t, who, who.id, 1.72, true));
    this.talk.converse = this.converse;
    this.life.onRep = (_rep, change) => this.converse.repToast(change);
    this.friends = new Friends(this.city, this.peds, this.player, this.talk, this.life, this.phone, this.panels, this.tree, () => this.missions, this.interactions, () => this.save.playSeconds, (n) => this.wallet.spend(n), () => this.settings.missionsOff);
    this.tutorial = new Tutorial(this.life, this.panels, this.player, this.talk);
    this.dents = new Dents(this.scene);
    this.extras = new Extras(this.scene, this.city, this.player, this.life, this.wallet, this.panels, this.hud, this.talk, this.dents, () => this.missions, this.interactions, () => this.city.region.id, (v) => this.crashFx.burst(v.x + Math.sin(v.heading) * v.spec.length * 0.4, v.y + 1, v.z + Math.cos(v.heading) * v.spec.length * 0.4, 0.2, false), (key) => this.life.friend(key).level, (dt) => this.hud.readChoice(dt, (c) => this.input.pressed(c), this.input.wheel, this.input.clicked));
    this.law.onStopped = (ticket) => this.extras.stopped(ticket);
    this.radio = new Radio(this.audio);
    this.radio.onWords = (t) => this.hud.say(t, 4);
    this.everyday = new Everyday(this.phone, this.tree, this.hud, this.panels, this.life, this.peds, this.player, this.talk, this.interactions, () => ({ pressed: (c) => this.input.pressed(c), wheel: this.input.wheel, clicked: this.input.clicked }), () => !!this.missions.active, () => this.settings.missionsOff, () => this.save.playSeconds);
  }

  /** J: what's been done and what's next, who's a friend, and how it's all going. */
  private openJournal(): void {
    this.openOverlay();
    const j = bn.journal, s = this.life.data, m = this.missions;
    const rows = m.list.map((q, i) => {
      const done = s.story.done.includes(q.id), next = m.next === q;
      return `<div class="journal-row ${done || next ? "" : "locked"}"><div><b>${bnNum(i + 1)}. ${T(q.title)}</b><small>${done || next ? T(q.blurb) : ""}</small></div>${done ? `<button class="mini" data-do="${q.id}">${j.replay}</button>` : `<em>${next ? j.next : j.locked}</em>`}</div>`;
    }).join("");
    const stat = (a: string, b: string | number): string => `<div class="journal-row"><b>${a}</b><em>${typeof b === "number" ? bnNum(b) : b}</em></div>`;
    const stats = [
      stat(j.statStory, `${bnNum(s.story.done.length)} / ${bnNum(m.list.length)}`),
      stat(j.statRep, s.rep), stat(j.statSense, s.scams.sense), stat(j.statEarned, bn.money(s.stats.earned)),
      stat(j.statSpotted, s.scams.spotted), stat(j.statFell, s.scams.fell), stat(j.statCrashes, s.stats.crashes), stat(j.statPhotos, s.stats.photos),
    ].join("");
    const jobs = JOB_LIST.map((q) => {
      const key = q.id.slice(4);
      const mine = this.hero.jobs.includes(key);
      const rec = s.jobs[key];
      return `<div class="journal-row ${mine ? "" : "locked"}"><div><b>${T(q.title)}</b><small>${mine ? T(q.blurb) : JOB_WORDS.notYou}</small></div>${mine ? `<button class="mini" data-do="${q.id}">${JOB_WORDS.start}</button>` : ""}${rec ? `<em>${JOB_WORDS.runs(bnNum(rec.runs), bn.money(rec.earned))}</em>` : ""}</div>`;
    }).join("");
    const lessons = s.scams.lessons.map((l) => `<div class="journal-row"><small>${T(l)}</small></div>`).join("") || `<p class="none">${j.noLessons}</p>`;
    this.panels.showTabs(j.title, [
      { title: j.tabMissions, html: (this.settings.missionsOff ? `<p class="none">${j.off}</p>` : "") + rows },
      { title: JOB_WORDS.tab, html: jobs },
      { title: j.tabPeople, html: this.friendsHtml() },
      { title: this.extras.tabTitle, html: this.extras.html() },
      { title: j.tabStats, html: stats },
      { title: j.tabLessons, html: lessons },
    ], (el) => {
      if (el.dataset.do?.startsWith("race_") || el.dataset.do?.startsWith("own_")) {
        this.extras.act(el.dataset.do);
        return;
      }
      const job = JOB_LIST.find((d) => d.id === el.dataset.do);
      if (job) {
        if (m.active) {
          this.panels.toast(JOB_WORDS.busy, "bad");
          return;
        }
        this.panels.closeOverlay();
        const key = job.id.slice(4);
        const rec = (s.jobs[key] ??= { runs: 0, earned: 0, best: 0 });
        const before = s.stats.earned;
        m.afterSide = () => {
          rec.runs++;
          rec.earned += s.stats.earned - before;
        };
        m.begin(job);
        return;
      }
      const q = m.list.find((d) => d.id === el.dataset.do);
      if (!q || m.active || q.region !== this.city.region.id) {
        if (q && q.region !== this.city.region.id) this.panels.toast(bn.ui.otherDistrict, "bad");
        return;
      }
      this.panels.closeOverlay();
      m.begin(q, 0, true);
    });
  }

  private friendsHtml(): string {
    return this.friends.html();
  }

  /** Stops the game for something that's opened to be read or used. */
  openOverlay(): void {
    if (this.state !== "playing") return;
    this.state = "paused";
    this.overlayPaused = true;
    this.input.enabled = false;
    this.input.releaseLock();
  }

  private closeOverlay(): void {
    if (!this.overlayPaused) return;
    this.overlayPaused = false;
    this.resume();
  }

  private openBag(): void {
    if (this.player.stage !== "foot" && !this.player.vehicle) return;
    this.openOverlay();
    this.showBag();
  }

  private showBag(): void {
    this.panels.showBag(this.bag.rows(), (key) => {
      this.bag.use(key);
      // Reading stays open, and anything else leaves the list to come back to.
      if (this.panels.overlayOpen && itemOf(key).kind !== "read") this.showBag();
    });
  }

  /** Worn out: people carry the hero to the nearest clinic, and there's a bill. */
  private collapse(): void {
    this.hud.fade(() => {
      this.talk.stop();
      this.player.respawn();
      const clinic = this.city.interiors.all.find((b) => b.kind === "clinic");
      if (clinic) {
        this.doors.inside = clinic;
        this.player.warp(clinic.x, clinic.y, clinic.z, clinic.yaw);
      }
      this.life.data.health = 70;
      this.life.refresh(100);
      const fee = Math.min(500, this.wallet.taka);
      if (fee >= 100) {
        this.wallet.spend(fee);
        this.hud.say(bn.life.collapsed(bnNum(fee)), 6);
      } else this.hud.say(bn.life.collapsedFree, 6);
      this.env.setHour((this.env.hour + 2) % 24);
      this.collapsed?.();
    });
  }

  /** Anything in progress that a trip to the clinic ends. */
  collapsed: (() => void) | null = null;

  private step(dt: number): void {
    this.handOver.update(dt);
    this.panels.update(dt);
    this.missions.update(dt);
    this.tree.update(dt);
    this.friends.update(dt);
    this.everyday.update(dt);
    this.tutorial.update(dt);
    this.extras.update(dt, this.env.hour, this.law.chasing, Math.min(this.law.reports, 3), this.env.night);
    this.dents.update(this.player.driving);
    const earphones = (this.wallet.items.earphone ?? 0) > 0;
    const hearing = !!this.player.vehicle || earphones;
    if (input_radio(this.input) && hearing) this.hud.say(this.radio.next(), 2);
    this.radio.update(dt, hearing && !this.talk.active, this.weather.rain > 0.12);
    this.converse.update(dt);
    this.player.canRun = this.life.breathe(this.player.wantsToRun && this.player.stage === "foot", dt);
    this.panels.setVitals(this.life.health, this.life.stamina);
    this.player.update(dt);
    this.talk.update(dt);
    this.tea.update(dt);
    this.hail.update(dt);
    this.phone.update(dt);
    this.doors.update(dt);
    this.catchGame.update(dt);
    this.law.update(dt);
    if (this.rhythm.update(dt)) this.applyDensity();
    this.shops.open = this.rhythm.shopsAreOpen;
    const inFlood = this.weather.floodAt(this.player.x, this.player.z);
    // Badly run down, they can't go at their usual pace.
    this.player.groundPace = (inFlood ? 0.62 : 1) * (this.life.health < 25 ? 0.8 : 1);
    const dv = this.player.driving;
    if (dv && this.weather.floodAt(dv.x, dv.z) && Math.abs(dv.speed) > 3) dv.speed *= Math.exp(-dt * 0.9);
    this.audio.siren(this.sirenNear);
    this.sirenNear = 0;
    this.law.tick(dt);
    if (!this.doors.inside) this.gates.update(dt);
    this.save.playSeconds += dt;
    this.clock += dt;
    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = AUTOSAVE_SECONDS;
      if (this.settings.autosave) this.keepGame();
    }
    this.metro?.update(dt);
    const heroPace = this.player.vehicle ? 0 : Math.hypot(this.player.vx, this.player.vz);
    for (const p of this.playgrounds) p.update(dt, this.player.position.x, this.player.position.z, heroPace > 0.4);
    const here = this.player.position;
    this.shops.update(dt, here.x, here.z);
    // Nobody ends up stranded: if the money runs out, home sends a little.
    this.brokeTime = this.wallet.taka < 50 ? this.brokeTime + dt : 0;
    if (this.brokeTime > 40) {
      this.brokeTime = 0;
      this.wallet.receive(1000);
      this.hud.say(bn.moneyHome, 5);
    }
    this.reactions.update(dt);
    if (this.player.vehicle) this.city.loose.update(dt, this.player.x, this.player.y, this.player.z, 0, this.traffic.nearby);
    else this.city.loose.update(dt, this.player.x, this.player.y, this.player.z, this.player.character?.speed ?? 0, this.traffic.nearby);
    this.strays?.update(dt, this.player.x, this.player.z, this.player.character?.speed ?? 0, this.traffic.nearby, this.clock);
    this.city.props.flushMoves();
    const pos = this.player.position;
    const v = this.player.vehicle;
    this.stepWorld(dt, pos.x, pos.z);
    if (this.lookAt) {
      this.lookAt.time -= dt;
      this.rig.turnTowards(this.lookAt.x, this.lookAt.z, pos.x, pos.z, dt);
      if (this.lookAt.time <= 0) this.lookAt = null;
    }

    const road = this.city.layout.roadNameAt(pos.x, pos.z);
    const area = this.city.layout.areaAt(pos.x, pos.z);
    this.hud.update(dt, road, area, this.env.hour, v ? v.speed : null, v ? bn.vehicles[v.id] : null);

    this.mapTimer -= dt;
    if (this.mapTimer <= 0) {
      this.mapTimer = 0.1;
      const marks = this.traffic.vehicles.slice(0, 40).map((q) => ({ x: q.x, z: q.z, color: "#ffffff" }));
      this.hud.updateMap(pos.x, pos.z, this.rig.yaw, marks);
    }
    if (this.settings.showFps) this.drawDebug();
  }

  /** Everything that keeps the city alive, whether the player is walking it or not. */
  private stepWorld(dt: number, px: number, pz: number): void {
    const cam = this.rig.camera;
    const traffic = this.traffic;
    traffic.playerX = px;
    traffic.playerY = this.player.vehicle ? this.player.vehicle.y : this.player.y;
    traffic.playerZ = pz;
    traffic.update(dt);
    const v = this.player.driving;
    const dir = cam.getDirection(Vector3.Forward());
    const camX = cam.position.x, camZ = cam.position.z;
    traffic.viewX = dir.x;
    traffic.viewZ = dir.z;
    this.crowd.begin(dt);
    this.peds.hour = this.env.hour;
    this.peds.frozen = !!this.doors.inside;
    this.weather.update(dt, cam.position.x, cam.position.z, !!this.doors.inside);
    this.peds.rain = this.weather.rain;
    this.peds.rainGear?.setCamera(cam.position.x, cam.position.z);
    this.peds.update(dt, px, pz, v, v ? Math.abs(v.speed) : 0, camX, camZ, dir.x, dir.z);
    this.heroInRain();
    this.peds.rainGear?.end();
    this.fleet.render(traffic.visibleVehicles(camX, camZ, 150), this.crowd, camX, camZ, dir.x, dir.z);
    this.crowd.end();
    this.train?.update(dt);
    this.night.update(this.env.night, traffic.vehicles, this.player.vehicle);
    const nearStall = this.city.stalls.some((q) => q.kind === "tea" && Math.abs(q.x - px) < 16 && Math.abs(q.z - pz) < 16);
    this.audio.updateAmbience(dt, this.env.night, nearStall);
    this.audio.updateTraffic(dt, traffic.vehicles, camX, camZ, this.rig.yaw, this.player.driving);
    this.city.updateStreaming(px, pz);
    this.visTimer -= dt;
    if (this.visTimer <= 0) {
      this.visTimer = VISIBILITY_INTERVAL;
      this.city.props.updateVisibility(camX, camZ, this.quality.viewScale, dir.x, dir.z);
    }
  }

  /** An umbrella or a raincoat from a stall comes out when it rains, and goes away indoors or at the wheel. */
  private heroInRain(): void {
    const p = this.player, c = p.character;
    if (!c) return;
    const got = this.wallet.items;
    const wet = this.weather.rain > 0.12 && !p.vehicle && !this.doors.inside;
    c.umbrellaUp = wet && (got.umbrella ?? 0) > 0;
    if (!c.umbrellaUp && !(wet && (got.raincoat ?? 0) > 0)) return;
    const g = this.heroGear;
    g.id = this.hero.id;
    g.x = p.x;
    g.y = p.y;
    g.z = p.z;
    g.yaw = p.yaw;
    g.rainHabit = c.umbrellaUp ? 1 : 2;
    this.peds.rainGear?.add(g, c.umbrellaUp ? c.handPosition(-1, this.heroHand) : undefined);
  }

  // ---------------------------------------------------------------- vehicle chooser

  private buildChooser(): void {
    const swatch: Record<string, string> = {
      default: "#c9c2b4", white: "#f1f1ee", silver: "#b9bcc0", red: "#c5202c", black: "#1b1c1f", taxi: "#f2c21b", blue: "#1f56b0", green: "#1f8a4c", yellow: "#efc01a", art2: "#cf3b78", art3: "#20a39e",
    };
    const items = this.fleet.availableIds().map((id) => ({
      id,
      name: bn.vehicles[id],
      variants: this.fleet.variantsOf(id).map((key) => ({ key, color: swatch[key] ?? "#888", label: bn.paints[key] ?? key })),
    }));
    this.hud.buildChooser(items);
    this.hud.onChooserClosed = () => {
      if (this.state === "paused" && this.chooserPaused) {
        this.chooserPaused = false;
        this.resume();
      }
    };
  }

  private openChooser(): void {
    if (this.player.stage !== "foot" || this.talk.active || this.tea.active) return;
    this.state = "paused";
    this.chooserPaused = true;
    this.input.enabled = false;
    this.input.releaseLock();
    this.hud.showChooser(true);
  }

  /** Puts the chosen vehicle on the road next to the hero, ready to get into. */
  private bringVehicle(id: VehicleId, variant: string): void {
    const p = this.player;
    const spec = VEHICLES[id];
    // Beside the hero, a little ahead, turned the same way.
    const ahead = spec.length / 2 + 2.2;
    let x = p.x + Math.sin(p.yaw) * ahead, z = p.z + Math.cos(p.yaw) * ahead;
    const clear = { x, z, nx: 0, nz: 0, hit: false };
    this.city.collision.resolveCircle(x, z, spec.width, clear);
    x = clear.x;
    z = clear.z;
    this.traffic.spawnParkedAt(id, variant, x, z, p.yaw);
    this.hud.showChooser(false);
    this.hud.say(`${bn.vehicles[id]}`, 1.6);
  }

  /** V: through the hero's eyes, or back behind them. Remembered separately on foot and at the wheel. */
  private switchView(): void {
    const key = this.player.vehicle ? "viewDrive" : "viewFoot";
    const next = this.settings[key] === "first" ? "third" : "first";
    this.settings[key] = next;
    saveSettings(this.settings);
    this.applyViewSettings();
    this.hud.markSetting(key, next);
    this.hud.say(next === "first" ? bn.ui.viewFirst : bn.ui.viewThird, 1.4);
  }

  private drawDebug(): void {
    const e = this.engine;
    this.fpsAvg += (e.getFps() - this.fpsAvg) * 0.1;
    const scene = this.scene;
    this.hud.debug(
      `FPS ${this.fpsAvg.toFixed(0)}\n` +
        `Preset ${this.quality.name}  ${e.getRenderWidth()}x${e.getRenderHeight()}\n` +
        `GPU ${gpuName(e._gl as WebGL2RenderingContext).slice(0, 44)}\n` +
        `Draws ${e._drawCalls.current}  Tris ${(scene.getActiveIndices() / 3000).toFixed(0)}k  Active ${scene.getActiveMeshes().length}\n` +
        `Traffic ${this.traffic.vehicles.length}  Parked ${this.traffic.parked.length}  People ${this.peds.count} (${this.crowd.drawn} drawn, ${this.peds.liveNow} live)`,
    );
  }

  // ---------------------------------------------------------------- test hooks

  /** Console and test access: jump the camera without touching player state. */
  view(x: number, y: number, z: number, tx: number, ty: number, tz: number): void {
    const cam = this.rig.camera;
    this.state = "paused";
    this.city.forceDetailAround(x, z);
    cam.position.set(x, y, z);
    cam.setTarget(new Vector3(tx, ty, tz));
    this.visTimer = 0;
    this.stepWorld(0.001, x, z);
    this.refreshCandidates();
  }

  /** Console and test access: start playing with no pointer lock. */
  testPlay(): void {
    this.play();
  }
}

