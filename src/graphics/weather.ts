import { Color3, DynamicTexture, GPUParticleSystem, Mesh, ParticleSystem, PBRMaterial, Scene, Vector3 } from "@babylonjs/core";
import type { AudioSystem } from "../audio/audio";
import { ROAD } from "../vehicles/vehicle";
import type { City } from "../world/city";
import { Geo } from "../world/geo";
import { Rng } from "../world/cityLayout";
import type { Environment } from "./environment";

export type RainSetting = "never" | "rare" | "normal" | "often";

/** Seconds of dry weather between showers, roughly. */
const DRY_FOR: Record<RainSetting, number> = { never: Infinity, rare: 1500, normal: 560, often: 170 };
const CAPACITY = 6000;
const RISES = 45;
const DRAINS = 110;

/** Monsoon weather: it clouds over, comes down hard, and the low streets fill up. Roads get slippery and
 *  stay wet for a while after, and people deal with it as they can. */
export class Weather {
  /** How hard it's raining, 0 to 1. */
  rain = 0;
  /** How wet the roads are: slower to change than the rain itself. */
  wet = 0;
  /** How deep the low places are. */
  flood = 0;
  setting: RainSetting = "normal";
  private goal = 0;
  private timer = 0;
  private heavyLeft = 0;
  private drops: ParticleSystem | GPUParticleSystem;
  private floodMesh: Mesh | null = null;
  private floodPatches: { x0: number; x1: number; z0: number; z1: number }[] = [];
  private thunder = 30;
  private shade = 0;
  private lastWet = -1;
  private rng = new Rng(4242);

  constructor(private scene: Scene, private env: Environment, private city: City, private audio: AudioSystem) {
    const size = 32;
    const tex = new DynamicTexture("raindrop", { width: size, height: size }, scene, false);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, "rgba(220,235,255,0)");
    g.addColorStop(0.5, "rgba(220,235,255,0.75)");
    g.addColorStop(1, "rgba(220,235,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(size * 0.44, 0, size * 0.12, size);
    tex.update();
    tex.hasAlpha = true;
    const s: ParticleSystem | GPUParticleSystem = GPUParticleSystem.IsSupported ? new GPUParticleSystem("rain", { capacity: CAPACITY }, scene) : new ParticleSystem("rain", CAPACITY, scene);
    s.particleTexture = tex;
    s.emitter = new Vector3(0, 0, 0);
    s.minEmitBox = new Vector3(-26, 14, -26);
    s.maxEmitBox = new Vector3(26, 22, 26);
    s.direction1 = new Vector3(-0.8, -19, 0.8);
    s.direction2 = new Vector3(-1.4, -24, 1.4);
    s.minEmitPower = 1;
    s.maxEmitPower = 1;
    s.minLifeTime = 0.9;
    s.maxLifeTime = 1.1;
    s.minSize = 0.045;
    s.maxSize = 0.08;
    s.minScaleY = 14;
    s.maxScaleY = 22;
    s.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    s.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    s.color1.set(0.86, 0.9, 0.98, 0.6);
    s.color2.set(0.86, 0.9, 0.98, 0.42);
    s.colorDead.set(0.82, 0.88, 0.96, 0);
    s.emitRate = 0;
    s.gravity = new Vector3(0, 0, 0);
    s.updateSpeed = 1 / 60;
    this.drops = s;
    this.buildFlood();
    this.timer = 90 + this.rng.next() * 120;
  }

  /** Low stretches of road that fill first. */
  private buildFlood(): void {
    const r = this.rng;
    const g = new Geo();
    const uv = [0, 0, 4, 4] as const;
    const low: { x0: number; x1: number; z0: number; z1: number }[] = [];
    for (const road of this.city.region.layout.roads) {
      if (road.cls === "main") continue;
      const halfW = road.lanesPerDir * 3.3 + road.median / 2 + 0.8;
      const span = road.to - road.from;
      const n = Math.floor(span / 240);
      for (let i = 0; i < n; i++) {
        if (!r.chance(0.72)) continue;
        const at = road.from + (span * (i + 0.5)) / n + r.range(-30, 30);
        const len = r.range(14, 40);
        if (road.axis === "v") low.push({ x0: road.at - halfW, x1: road.at + halfW, z0: at - len / 2, z1: at + len / 2 });
        else low.push({ x0: at - len / 2, x1: at + len / 2, z0: road.at - halfW, z1: road.at + halfW });
      }
    }
    this.floodPatches = low;
    for (const q of low) g.flat(q.x0, q.x1, q.z0, q.z1, 0.035, true, uv, [1, 1, 1]);
    const mat = new PBRMaterial("floodWater", this.scene);
    // Muddy, and not a mirror: it's what came off the road.
    mat.albedoColor = new Color3(0.11, 0.09, 0.055);
    mat.roughness = 0.3;
    mat.metallic = 0;
    mat.alpha = 0.86;
    mat.environmentIntensity = 0.28;
    mat.specularIntensity = 0.35;
    const mesh = g.build("flood", this.scene, mat);
    if (mesh) {
      mesh.setEnabled(false);
      mesh.receiveShadows = false;
      this.floodMesh = mesh;
    }
  }

  /** Standing in deep water? Slows people and traffic alike. */
  floodAt(x: number, z: number): boolean {
    if (this.flood < 0.35) return false;
    for (const q of this.floodPatches) if (x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1) return true;
    return false;
  }

  update(dt: number, camX: number, camZ: number, indoors: boolean): void {
    this.timer -= dt;
    if (this.setting === "never") {
      this.goal = 0;
    } else if (this.timer <= 0) {
      if (this.goal > 0) {
        // Over, for now.
        this.goal = 0;
        this.timer = DRY_FOR[this.setting] * (0.6 + this.rng.next() * 0.8);
      } else {
        this.goal = this.rng.chance(0.3) ? 0.34 : this.rng.range(0.62, 1);
        this.timer = this.rng.range(120, 300);
      }
    }
    this.rain += Math.max(-dt / 18, Math.min(dt / 14, this.goal - this.rain));
    this.wet += (this.rain > 0.05 ? dt / 50 : -dt / 200);
    this.wet = Math.max(0, Math.min(1, this.wet));
    if (this.rain > 0.55) this.heavyLeft += dt / RISES;
    else this.heavyLeft -= dt / DRAINS;
    this.heavyLeft = Math.max(0, Math.min(1, this.heavyLeft));
    this.flood = this.heavyLeft;

    // The road loses its grip as soon as it's damp.
    ROAD.grip = 1 - 0.38 * Math.min(1, this.wet * 2.5);

    const e = this.drops as ParticleSystem;
    (e.emitter as Vector3).set(camX, 0, camZ);
    const showing = !indoors && this.rain > 0.02;
    if (showing !== e.isStarted()) {
      if (showing) e.start();
      else e.stop();
    }
    e.emitRate = indoors ? 0 : this.rain * CAPACITY;
    this.audio.setRain(indoors ? this.rain * 0.25 : this.rain);

    const m = this.floodMesh;
    if (m) {
      const on = this.flood > 0.02;
      if (m.isEnabled() !== on) m.setEnabled(on);
      if (on) m.visibility = Math.min(1, this.flood * 1.2);
    }
    // Skies and roads only need touching when they've changed by enough to see.
    const shade = Math.max(this.rain, this.wet * 0.25);
    if (Math.abs(shade - this.shade) > 0.03) {
      this.shade = shade;
      this.env.setOvercast(shade);
    }
    if (Math.abs(this.wet - this.lastWet) > 0.04) {
      this.lastWet = this.wet;
      this.city.roads.setWet(this.wet);
      this.env.setOvercast(this.shade);
    }
    // Thunder, a long way off.
    if (this.rain > 0.7 && !indoors) {
      this.thunder -= dt;
      if (this.thunder <= 0) {
        this.thunder = this.rng.range(18, 60);
        this.audio.thunder();
      }
    }
  }

  /** Set straight away, for testing and for when the game's loaded in the rain. */
  force(rain: number): void {
    this.goal = rain;
    this.rain = rain;
    this.timer = 120;
  }
}
