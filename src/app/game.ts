import { AbstractMesh, Engine, Mesh, Scene, Vector3 } from "@babylonjs/core";
import { AudioSystem } from "../audio/audio";
import { preloadCharacters } from "../characters/character";
import { Crowd } from "../characters/crowd";
import { ENV_KEYS, Environment } from "../graphics/environment";
import { NightLights } from "../graphics/nightLights";
import { PostStack } from "../graphics/post";
import { QUALITY, QualityPreset, detectQuality, gpuName, isIntegratedGpu, scalingFor } from "../graphics/quality";
import { bn } from "../localization/bn";
import { Pedestrians } from "../npc/pedestrians";
import { CameraRig } from "../player/cameraRig";
import { Input } from "../player/input";
import { Player } from "../player/player";
import { defaultRegionId, regions } from "../regions/registry";
import { TrafficSystem } from "../traffic/trafficSystem";
import { Hud } from "../ui/hud";
import { VEHICLES, VehicleId } from "../vehicles/vehicleData";
import { VehicleFleet } from "../vehicles/vehicleLibrary";
import { City } from "../world/city";
import { MetroTrain } from "../world/metroTrain";
import { SignAtlas } from "../world/signs";
import { QualityName, Settings, TimeName, loadSettings, saveSettings } from "./settings";

type GameState = "loading" | "title" | "playing" | "paused";

const VISIBILITY_INTERVAL = 0.14;
const AUTO_WINDOW = 4; // seconds of frame rate watched before auto quality reacts

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
  private chooserPaused = false;
  private personCasters = new Set<AbstractMesh>();
  private candidates: AbstractMesh[] = [];
  private candidateList = { data: this.candidates, length: 0 };
  private candidateTimer = 0;

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

    await step(0.02, "অক্ষর সাজানো হচ্ছে");
    await SignAtlas.loadFonts();

    // A fixed start view for the title screen; the player rig takes over on Play.
    await step(0.06, "আকাশ আঁকা হচ্ছে");
    const region = regions[defaultRegionId];
    this.city = new City(this.scene, region, this.quality.anisotropy, this.quality.signSize);
    this.rig = new CameraRig(this.scene, this.city.collision);
    this.rig.sensitivity = this.settings.sensitivity;
    this.scene.activeCamera = this.rig.camera;

    this.env = new Environment(this.scene, this.quality);
    await this.env.load([this.settings.time]);
    await this.env.goTo(this.settings.time, 0);
    this.post = new PostStack(this.scene, this.rig.camera, this.quality);

    await step(0.12, "রাস্তার জিনিসপত্র আনা হচ্ছে");
    await this.city.load((d, t) => this.hud.progress(0.12 + (d / t) * 0.28, "রাস্তার জিনিসপত্র আনা হচ্ছে"));

    await step(0.4, "মানুষজন ডাকা হচ্ছে");
    await preloadCharacters(this.scene, (d, t) => this.hud.progress(0.4 + (d / t) * 0.14, "মানুষজন ডাকা হচ্ছে"));

    await step(0.54, "গাড়ি আনা হচ্ছে");
    const shadow = (m: AbstractMesh): void => void this.env.shadows.addShadowCaster(m, false);
    // People only need shadows close up; beyond that they are too small to justify the draw calls.
    const personShadow = (m: AbstractMesh): void => {
      this.personCasters.add(m);
      shadow(m);
    };
    this.fleet = new VehicleFleet(this.scene, this.city.signs, shadow);
    await this.fleet.preload((d, t) => this.hud.progress(0.54 + (d / t) * 0.14, "গাড়ি আনা হচ্ছে"));

    await step(0.7, "মিরপুর ১০ বানানো হচ্ছে");
    const addCaster = (m: Mesh): void => void this.env.shadows.addShadowCaster(m, false);
    const removeCaster = (m: Mesh): void => void this.env.shadows.removeShadowCaster(m, false);
    this.city.generate(addCaster, removeCaster, this.quality.macroSize, this.quality.anisotropy, this.quality.detailRadius);
    this.env.cullCascades(this.rig.camera, (m) => {
      if (this.city.isDetailMesh(m as Mesh) || this.personCasters.has(m)) return 0;
      return this.city.props.shadowLayerLimit(m as Mesh) ?? 1;
    });

    await step(0.78, "হাঁটার ভঙ্গি শেখানো হচ্ছে");
    this.crowd = new Crowd(this.scene, personShadow);
    this.crowd.build();

    await step(0.84, "ট্রাফিক সিগন্যাল চালু হচ্ছে");
    this.traffic = new TrafficSystem(this.scene, this.city, this.fleet);
    this.traffic.setTarget(this.quality.traffic);
    this.traffic.onHorn = (v) => this.audio.hornAt(v.spec.horn, v.x, v.z);
    this.traffic.populateParked();

    this.peds = new Pedestrians(this.scene, this.city, this.traffic, this.crowd, personShadow);
    this.peds.setTarget(this.quality.pedestrians);
    this.peds.spawnFixed();

    this.player = new Player(this.scene, this.city, this.traffic, this.fleet, this.peds, this.rig, this.input, this.audio, {
      say: (t, s, speak) => {
        this.hud.say(t, s);
        if (speak) this.audio.speak(t);
      },
      prompt: (h) => this.hud.prompt(h),
    }, personShadow);
    this.peds.onShout = (t) => {
      this.hud.say(t, 2.4);
      this.audio.speak(t);
    };

    const { metro } = region.layout;
    if (metro) this.train = new MetroTrain(this.scene, this.city.props, metro.x, metro.fromZ, metro.toZ, metro.stationZ, shadow);

    this.night = new NightLights(this.scene, this.city);
    this.hud.buildMap(this.city.layout);
    this.city.setNightGlow(this.env.night);
    this.post.setGrade(this.env.exposure, this.env.contrast);

    await step(0.9, "কাছের দালানগুলো সাজানো হচ্ছে");
    const p = this.player.position;
    this.city.forceDetailAround(p.x, p.z);
    this.city.props.updateVisibility(p.x, p.z, this.quality.viewScale);
    this.env.shadows.getShadowMap()!.refreshRate = 1;

    // Fill the streets before the title appears, so the first view is already alive.
    this.traffic.playerX = p.x;
    this.traffic.playerZ = p.z;
    this.traffic.playerRadius = 0.34;
    for (let i = 0; i < 90; i++) this.traffic.update(0.12);
    this.peds.populate(p.x, p.z);
    await step(0.92, "ছবি আঁকার প্রস্তুতি চলছে");
    this.scene.getActiveMeshCandidates = () => this.candidateList;
    await this.prewarm();

    this.env.enableFreezing();
    this.refreshCandidates();
    this.buildChooser();
    this.audio.voiceEnabled = this.settings.voice;
    this.hud.showGpuHint(isIntegratedGpu(gl));
    setTimeout(() => this.hud.showGpuHint(false), 14000);
    this.hud.progress(1, "প্রস্তুত");
    this.state = "title";
    this.hud.showTitle();
    this.engine.runRenderLoop(() => this.frame());
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
    const progress = (f: number): void => this.hud.progress(0.92 + f * 0.07, "ছবি আঁকার প্রস্তুতি চলছে");

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

  private play(): void {
    this.audio.unlock(this.settings.volume);
    this.hud.showGame();
    this.state = "playing";
    this.input.enabled = true;
    this.input.requestLock();
    this.rig.snap(this.player.x, this.player.y, this.player.z, 0);
    this.canvas.focus();
    this.hud.lookHintVisible(true);
    setTimeout(() => this.hud.lookHintVisible(!this.input.locked), 600);
  }

  private pause(): void {
    if (this.state !== "playing") return;
    this.state = "paused";
    this.input.enabled = false;
    this.input.releaseLock();
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
    this.engine.setHardwareScalingLevel(scalingFor(preset));
    this.env.setQuality(preset);
    this.post.apply(preset);
    this.traffic.setTarget(preset.traffic);
    this.peds.setTarget(preset.pedestrians);
    this.city.setDetailRadius(preset.detailRadius);
  }

  private changeTime(t: TimeName): void {
    this.settings.time = t;
    saveSettings(this.settings);
    void this.env.goTo(t, 4);
    this.hud.setTimeSelection(t);
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

  private frame(): void {
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.066);
    const input = this.input;
    this.candidateTimer -= dt;
    if (this.candidateTimer <= 0) {
      this.candidateTimer = 0.2;
      this.refreshCandidates();
    }
    this.env.update(dt);
    this.post.setGrade(this.env.exposure, this.env.contrast);
    this.city.setNightGlow(this.env.night);

    if (this.state === "playing") {
      if (input.pressed("Escape") || input.pressed("KeyP")) this.pause();
      if (input.pressed("KeyT")) this.nextTime();
      if (input.pressed("KeyV")) this.openChooser();
      this.step(dt);
      this.autoAdjust(dt);
    } else if (this.state === "title") {
      this.titleCamera(dt);
      this.stepWorld(dt, this.player.x, this.player.z);
    } else if (this.chooserPaused && (input.pressed("Escape") || input.pressed("KeyV"))) {
      this.hud.showChooser(false);
    }
    this.scene.render();
    input.endFrame();
  }

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

  private step(dt: number): void {
    this.player.update(dt);
    const pos = this.player.position;
    const v = this.player.vehicle;
    this.stepWorld(dt, pos.x, pos.z);

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
    traffic.playerZ = pz;
    traffic.update(dt);
    const v = this.player.driving;
    const dir = cam.getDirection(Vector3.Forward());
    const camX = cam.position.x, camZ = cam.position.z;
    this.crowd.begin(dt);
    this.peds.update(dt, px, pz, v, v ? Math.abs(v.speed) : 0, camX, camZ, dir.x, dir.z);
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
    if (this.player.stage !== "foot") return;
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

