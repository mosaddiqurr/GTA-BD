import {
  AbstractMesh, Camera, Color3, CascadedShadowGenerator, Constants, DirectionalLight, Effect, HDRCubeTexture, Mesh, MeshBuilder, Scene, ShaderMaterial, SphericalHarmonics, SphericalPolynomial, Texture, Vector3, HemisphericLight,
} from "@babylonjs/core";
import type { TimeName } from "../app/settings";
import type { QualityPreset } from "./quality";

export interface EnvKey {
  name: TimeName;
  hour: number;
  /** degrees above the horizon; azimuth clockwise from north. Must match tools/blender/build_sky.py */
  el: number;
  az: number;
  sun: [number, number, number];
  sunPower: number;
  env: number;
  fog: [number, number, number];
  exposure: number;
  night: number;
  contrast: number;
  /** Which painted sky this moment uses, and how bright it is drawn. */
  sky: TimeName;
  gain: number;
  /** Height of the visible sun disc, separate from the light: at night the light is the moon. */
  discEl: number;
  discAz: number;
}

/** Reach of each shadow cascade in metres, nearest first. */
const CASCADE_REACH = [38, 95, 190, 300];

/** The five times of day the player can jump to. */
export const ENV_KEYS: EnvKey[] = [
  { name: "morning", hour: 8, el: 22, az: 108, sun: [1.0, 0.84, 0.64], sunPower: 4.2, env: 0.85, fog: [0.74, 0.76, 0.76], exposure: 1.0, night: 0, contrast: 1.12, sky: "morning", gain: 1, discEl: 22, discAz: 108 },
  { name: "noon", hour: 12.5, el: 66, az: 175, sun: [1.0, 0.94, 0.82], sunPower: 5.0, env: 0.9, fog: [0.76, 0.8, 0.84], exposure: 0.92, night: 0, contrast: 1.1, sky: "noon", gain: 1, discEl: 66, discAz: 175 },
  { name: "golden", hour: 16.75, el: 11, az: 258, sun: [1.0, 0.62, 0.32], sunPower: 6.6, env: 0.72, fog: [0.74, 0.65, 0.57], exposure: 1.02, night: 0, contrast: 1.22, sky: "golden", gain: 1, discEl: 11, discAz: 258 },
  { name: "dusk", hour: 18.1, el: 1.5, az: 272, sun: [1.0, 0.42, 0.26], sunPower: 1.6, env: 0.85, fog: [0.5, 0.36, 0.38], exposure: 1.2, night: 0.75, contrast: 1.15, sky: "dusk", gain: 1, discEl: 1.5, discAz: 272 },
  { name: "night", hour: 21, el: 42, az: 200, sun: [0.62, 0.72, 1.0], sunPower: 0.75, env: 6.2, fog: [0.14, 0.13, 0.17], exposure: 1.55, night: 1, contrast: 1.1, sky: "night", gain: 1, discEl: -20, discAz: 272 },
];

const KEY = (name: TimeName): EnvKey => ENV_KEYS.find((k) => k.name === name)!;

/** First light: there is no painted dawn sky, so it is the morning sky held back. */
const DAWN: EnvKey = { name: "morning", hour: 5.9, el: 6, az: 98, sun: [1.0, 0.56, 0.42], sunPower: 1.3, env: 0.55, fog: [0.42, 0.38, 0.42], exposure: 1.12, night: 0.5, contrast: 1.12, sky: "morning", gain: 0.5, discEl: 1, discAz: 100 };

/** The day: each moment blends into the next. Night is held from dusk until before dawn. */
const DAY: { hour: number; key: EnvKey }[] = [
  { hour: 0, key: KEY("night") },
  { hour: 4.5, key: KEY("night") },
  { hour: 5.9, key: DAWN },
  { hour: 8, key: KEY("morning") },
  { hour: 12.5, key: KEY("noon") },
  { hour: 16.75, key: KEY("golden") },
  { hour: 18.1, key: KEY("dusk") },
  { hour: 19.6, key: KEY("night") },
  { hour: 24, key: KEY("night") },
];

const HARMONIC_BANDS = ["l00", "l1_1", "l10", "l11", "l2_2", "l2_1", "l20", "l21", "l22"] as const;

/** How often lit values reach the materials. Light moves so slowly that nobody can see the steps. */
const LIGHT_STEP = 0.4;

Effect.ShadersStore["skyDomeVertexShader"] = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main(void) {
  vDir = position;
  vec4 p = worldViewProjection * vec4(position, 1.0);
  gl_Position = p.xyww; // stay on the far plane
}`;

Effect.ShadersStore["skyDomeFragmentShader"] = `
precision highp float;
varying vec3 vDir;
uniform sampler2D skyA;
uniform sampler2D skyB;
uniform float blend;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float sunGlow;
uniform vec3 fogColor;
uniform float skyGain;
const float PI = 3.14159265;

vec3 fromSRGB(vec3 c) { return pow(c, vec3(2.2)); }

void main(void) {
  vec3 d = normalize(vDir);
  vec2 uv = vec2(atan(d.x, d.z) / (2.0 * PI) + 0.5, 0.5 + asin(clamp(d.y, -1.0, 1.0)) / PI);
  vec3 a = fromSRGB(texture2D(skyA, uv).rgb);
  vec3 b = fromSRGB(texture2D(skyB, uv).rgb);
  vec3 col = mix(a, b, blend) * skyGain;

  // Sun disc and bloom are drawn here so the sun can move smoothly between sky keys.
  float c = max(dot(d, sunDir), 0.0);
  float disc = smoothstep(0.99985, 0.99995, c);
  col += sunColor * disc * 26.0 * sunGlow;
  col += sunColor * pow(c, 900.0) * 1.6 * sunGlow;
  col += sunColor * pow(c, 48.0) * 0.32 * sunGlow;

  // Melt into haze at the horizon, so distant buildings fade into the same colour.
  float h = smoothstep(-0.01, 0.085, d.y);
  col = mix(fogColor, col, h);

  // Dither to hide banding in the smooth gradient.
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

/** Owns the sun, sky dome, image-based light and fog, and blends them through the day. */
export class Environment {
  readonly sun: DirectionalLight;
  readonly shadows: CascadedShadowGenerator;
  private dome: Mesh;
  private domeMat: ShaderMaterial;
  private fill: HemisphericLight;
  private skyTex = new Map<string, Texture>();
  private ibl = new Map<string, HDRCubeTexture>();
  private iblName = "";
  /** Frozen materials skip per-frame uniform work; see `thaw`. */
  private canFreeze = false;

  /** Current look; other systems read these. */
  fogColor = new Color3(0.8, 0.7, 0.55);
  exposure = 1;
  contrast = 1.1;
  night = 0;
  private fogDensity: number;
  private from: EnvKey;
  private to: EnvKey;
  private t = 1;
  /** The clock, in hours. */
  private clock = 16.75;
  /** Game hours per real second; zero stops the clock. */
  speed = 1 / 60;
  private jumpTarget = 0;
  private jumpRate = 0;
  private jumpLeft = 0;
  private lightTimer = 0;
  private thawAt = 0;
  private skyA = "";
  private skyB = "";
  private ambient = new Map<string, SphericalHarmonics>();

  constructor(private scene: Scene, q: QualityPreset) {
    this.fogDensity = q.fogDensity;
    this.from = this.to = KEY("golden");
    this.sun = new DirectionalLight("sun", new Vector3(-0.5, -0.5, 0.5), scene);
    this.sun.intensity = 5;
    this.sun.shadowMinZ = 1;
    this.sun.shadowMaxZ = 600;
    this.sun.autoUpdateExtends = true;

    // A gentle fill keeps shadow sides readable if the environment map is still loading.
    this.fill = new HemisphericLight("fill", Vector3.Up(), scene);
    this.fill.intensity = 0.0;
    this.fill.diffuse = new Color3(0.62, 0.68, 0.9);
    this.fill.groundColor = new Color3(0.3, 0.3, 0.36);
    this.fill.specular = Color3.Black();

    this.shadows = new CascadedShadowGenerator(q.shadowSize, this.sun);
    this.shadows.numCascades = q.cascades;
    this.shadows.lambda = 0.82;
    this.shadows.shadowMaxZ = q.shadowDistance;
    this.shadows.stabilizeCascades = true;
    this.shadows.cascadeBlendPercentage = 0.08;
    this.shadows.filteringQuality = q.name === "low" ? CascadedShadowGenerator.QUALITY_LOW : q.name === "ultra" ? CascadedShadowGenerator.QUALITY_HIGH : CascadedShadowGenerator.QUALITY_MEDIUM;
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.bias = 0.0016;
    this.shadows.normalBias = 0.012;
    this.shadows.depthClamp = true;
    this.shadows.getShadowMap()!.refreshRate = 1;

    this.dome = MeshBuilder.CreateBox("skyDome", { size: 1, sideOrientation: Mesh.BACKSIDE }, scene);
    this.dome.infiniteDistance = true;
    this.dome.scaling.setAll(800);
    this.dome.isPickable = false;
    this.dome.applyFog = false;
    this.dome.renderingGroupId = 0;
    this.domeMat = new ShaderMaterial("skyDomeMat", scene, { vertex: "skyDome", fragment: "skyDome" }, {
      attributes: ["position"],
      uniforms: ["worldViewProjection", "blend", "sunDir", "sunColor", "sunGlow", "fogColor", "skyGain"],
      samplers: ["skyA", "skyB"],
    });
    this.domeMat.backFaceCulling = false;
    this.domeMat.depthFunction = Constants.LEQUAL;
    this.domeMat.disableDepthWrite = true;
    this.dome.material = this.domeMat;
    this.dome.alwaysSelectAsActiveMesh = true;

    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = q.fogDensity;
    scene.fogColor = this.fogColor;
  }

  /** Each cascade draws only nearby casters, and the outer ones skip full-detail facades
   *  (their far-mesh proxies stand in). This removes most of the cost of shadows. */
  /** Set for one frame while warming shaders, so every caster goes through the shadow pass. */
  drawAllCasters = false;

  cullCascades(camera: Camera, layerLimit: (m: AbstractMesh) => number): void {
    const map = this.shadows.getShadowMap()!;
    const lists: AbstractMesh[][] = [[], [], [], []];
    map.getCustomRenderList = (layer, renderList, length) => {
      const out = lists[layer] ?? (lists[layer] = []);
      out.length = 0;
      if (!renderList) return out;
      if (this.drawAllCasters) return renderList as AbstractMesh[];
      const reach = CASCADE_REACH[Math.min(layer, CASCADE_REACH.length - 1)];
      const cam = camera.globalPosition;
      for (let i = 0; i < length; i++) {
        const m = renderList[i] as AbstractMesh;
        if (layer > layerLimit(m)) continue;
        // Vehicles and crowds are spread over the whole district as instances of one mesh, so that
        // mesh's own bounding sphere says nothing about where they are.
        if (m.alwaysSelectAsActiveMesh) {
          out.push(m);
          continue;
        }
        const sphere = m.getBoundingInfo().boundingSphere;
        const dx = sphere.centerWorld.x - cam.x, dz = sphere.centerWorld.z - cam.z;
        const limit = reach + sphere.radiusWorld;
        if (dx * dx + dz * dz < limit * limit) out.push(m);
      }
      return out;
    };
  }

  setQuality(q: QualityPreset): void {
    this.fogDensity = q.fogDensity;
    this.scene.fogDensity = q.fogDensity;
    this.shadows.numCascades = q.cascades;
    this.shadows.shadowMaxZ = q.shadowDistance;
  }

  async load(keys: TimeName[]): Promise<void> {
    const unique = [...new Set(keys)];
    await Promise.all(unique.map((k) => this.loadKey(k)));
  }

  private loadKey(name: TimeName): Promise<void> {
    if (this.skyTex.has(name)) return Promise.resolve();
    const tasks: Promise<void>[] = [];
    tasks.push(new Promise((resolve) => {
      const tex = new Texture(`assets/sky/${name}.webp`, this.scene, true, true, Texture.BILINEAR_SAMPLINGMODE, () => resolve(), () => resolve());
      tex.wrapU = Texture.WRAP_ADDRESSMODE;
      tex.wrapV = Texture.CLAMP_ADDRESSMODE;
      this.skyTex.set(name, tex);
    }));
    tasks.push(new Promise((resolve) => {
      const hdr = new HDRCubeTexture(`assets/sky/${name}.hdr`, this.scene, 128, false, true, false, true, () => resolve(), () => resolve());
      // Panorama centre faces north (+Z) in both the dome and this cube.
      this.ibl.set(name, hdr);
    }));
    return Promise.all(tasks).then(() => undefined);
  }

  /** Sets the clock at once. */
  setHour(hour: number): void {
    this.clock = ((hour % 24) + 24) % 24;
    this.jumpLeft = 0;
    this.apply();
    this.thaw();
  }

  /** Moves the clock to a named time, racing through whatever lies between. */
  jumpTo(name: TimeName, seconds: number): void {
    const target = KEY(name).hour;
    let span = target - this.clock;
    if (span < 0) span += 24;
    this.jumpTarget = target;
    this.jumpRate = span / Math.max(seconds, 0.01);
    this.jumpLeft = seconds;
  }

  get hour(): number {
    return this.clock;
  }

  /** The named time most recently passed, for stepping to the next one. */
  get timeName(): TimeName {
    let best = ENV_KEYS[ENV_KEYS.length - 1];
    for (const k of ENV_KEYS) if (k.hour <= this.clock) best = k;
    return best.name;
  }

  private current(): EnvKey {
    const t = this.t, a = this.from, b = this.to;
    return {
      name: b.name, hour: this.clock, el: lerp(a.el, b.el, t), az: lerpAngle(a.az, b.az, t),
      sun: mix3(a.sun, b.sun, t), sunPower: lerp(a.sunPower, b.sunPower, t), env: lerp(a.env, b.env, t),
      fog: mix3(a.fog, b.fog, t), exposure: lerp(a.exposure, b.exposure, t), night: lerp(a.night, b.night, t), contrast: lerp(a.contrast, b.contrast, t),
      sky: b.sky, gain: lerp(a.gain, b.gain, t), discEl: lerp(a.discEl, b.discEl, t), discAz: lerpAngle(a.discAz, b.discAz, t),
    };
  }

  /** `clockDt` is zero while the game is paused, so the sun waits too. */
  update(dt: number, clockDt: number): void {
    if (this.jumpLeft > 0) {
      this.jumpLeft -= dt;
      this.clock = this.jumpLeft <= 0 ? this.jumpTarget : (this.clock + this.jumpRate * dt) % 24;
      this.apply();
      this.thaw();
    } else if (this.speed > 0 && clockDt > 0) {
      // The small hours pass quicker: nobody wants ten minutes of the same dark street.
      const deepNight = this.clock >= 20.5 || this.clock < 4;
      this.clock = (this.clock + clockDt * this.speed * (deepNight ? 2 : 1)) % 24;
      this.lightTimer -= clockDt;
      if (this.lightTimer <= 0) {
        this.lightTimer = LIGHT_STEP;
        this.apply();
      }
      this.thaw(2);
    }
  }

  /** How far overcast it is, 0 to 1. */
  overcast = 0;

  setOvercast(k: number): void {
    this.overcast = k;
    this.apply();
    this.thaw();
  }

  /** Called once loading has finished and every effect is compiled. */
  enableFreezing(): void {
    this.canFreeze = true;
    for (const m of this.scene.materials) m.freeze();
  }

  /** Lets new light values reach frozen materials. Thawing them would make the engine re-check every
   *  mesh, a 50 ms stall each time. Marking their uniform buffers out of date costs nothing, and doing
   *  a few each frame spreads out what's left; the light moves too slowly for anyone to see the order. */
  private thaw(count = Infinity): void {
    if (!this.canFreeze) return;
    const all = this.scene.materials;
    const n = Math.min(count, all.length);
    for (let i = 0; i < n; i++) {
      this.thawAt = (this.thawAt + 1) % all.length;
      const ubo = (all[this.thawAt] as unknown as { _uniformBuffer?: { _needSync: boolean } })._uniformBuffer;
      if (ubo) ubo._needSync = true;
    }
  }

  /** Blends the soft ambient light between two lighting maps, so it never steps as the day passes. */
  private blendAmbient(a: TimeName, b: TimeName, t: number, gainA: number, gainB: number, gainNow: number): void {
    const texA = this.ibl.get(a), texB = this.ibl.get(b);
    const active = this.scene.environmentTexture;
    if (!texA || !texB || !active) return;
    const shA = this.harmonics(a, texA), shB = this.harmonics(b, texB);
    if (!shA || !shB) return;
    const out = new SphericalHarmonics();
    out.preScaled = true;
    // Each map's brightness goes in with it: the maps differ hugely, so blending them bare would flash.
    const ka = ((1 - t) * gainA) / gainNow, kb = (t * gainB) / gainNow;
    for (const f of HARMONIC_BANDS) {
      const p = shA[f], q = shB[f], o = out[f];
      o.set(p.x * ka + q.x * kb, p.y * ka + q.y * kb, p.z * ka + q.z * kb);
    }
    const poly = new SphericalPolynomial();
    (poly as unknown as { _harmonics: SphericalHarmonics })._harmonics = out;
    active.sphericalPolynomial = poly;
  }

  /** A lighting map's own ambient values, remembered before they are overwritten by a blend. */
  private harmonics(name: string, tex: HDRCubeTexture): SphericalHarmonics | null {
    const known = this.ambient.get(name);
    if (known) return known;
    const poly = tex.sphericalPolynomial;
    if (!poly) return null;
    const src = poly.preScaledHarmonics;
    const own = new SphericalHarmonics();
    own.preScaled = true;
    for (const f of HARMONIC_BANDS) own[f].copyFrom(src[f]);
    this.ambient.set(name, own);
    return own;
  }

  private apply(): void {
    let i = 0;
    while (i < DAY.length - 2 && this.clock >= DAY[i + 1].hour) i++;
    this.from = DAY[i].key;
    this.to = DAY[i + 1].key;
    this.t = (this.clock - DAY[i].hour) / (DAY[i + 1].hour - DAY[i].hour);
    const k = this.current();
    const t = this.t;
    const el = (k.el * Math.PI) / 180;
    const az = (k.az * Math.PI) / 180;
    // Direction towards the sun: north is +Z, east is +X.
    const to = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    this.sun.direction = to.scale(-1);
    this.sun.diffuse = new Color3(k.sun[0], k.sun[1], k.sun[2]);
    this.sun.specular = this.sun.diffuse;
    // Cloud takes the sun away first, and brings the far distance in.
    const cloud = this.overcast;
    this.sun.intensity = k.sunPower * (1 - 0.86 * cloud);
    this.sun.shadowEnabled = this.sun.intensity > 0.05;

    this.fogColor.set(k.fog[0] + (0.42 - k.fog[0]) * cloud * 0.8, k.fog[1] + (0.45 - k.fog[1]) * cloud * 0.8, k.fog[2] + (0.5 - k.fog[2]) * cloud * 0.8);
    this.scene.fogColor = this.fogColor;
    this.scene.fogDensity = this.fogDensity * (1 + 1.7 * cloud);
    this.exposure = k.exposure * (1 - 0.14 * cloud);
    this.contrast = k.contrast;
    this.night = k.night;
    this.scene.environmentIntensity = k.env;
    // Reflections swap partway through a blend, later when the next map is far brighter; the soft
    // ambient light blends the whole way.
    const swapAt = this.from.env > this.to.env * 2 ? 0.85 : this.to.env > this.from.env * 2 ? 0.15 : 0.5;
    const want = t < swapAt ? this.from.sky : this.to.sky;
    if (this.iblName !== want) {
      const hdr = this.ibl.get(want);
      if (hdr) {
        this.scene.environmentTexture = hdr;
        this.iblName = want;
      }
    }
    this.blendAmbient(this.from.sky, this.to.sky, t, this.from.env, this.to.env, Math.max(k.env, 0.01));
    // Moonlight on the ground: enough to see the pavement and read the street away from the lamps.
    this.fill.intensity = k.night * 0.14;
    if (this.skyA !== this.from.sky || this.skyB !== this.to.sky) {
      const a = this.skyTex.get(this.from.sky) ?? this.skyTex.get(this.to.sky);
      const b = this.skyTex.get(this.to.sky);
      if (a && b) {
        this.domeMat.setTexture("skyA", a);
        this.domeMat.setTexture("skyB", b);
        this.skyA = this.from.sky;
        this.skyB = this.to.sky;
      }
    }
    this.domeMat.setFloat("blend", t);
    const dEl = (k.discEl * Math.PI) / 180, dAz = (k.discAz * Math.PI) / 180;
    this.domeMat.setVector3("sunDir", new Vector3(Math.sin(dAz) * Math.cos(dEl), Math.sin(dEl), Math.cos(dAz) * Math.cos(dEl)));
    this.domeMat.setColor3("sunColor", new Color3(k.sun[0], k.sun[1], k.sun[2]));
    this.domeMat.setFloat("sunGlow", Math.max(0, Math.min(1, (k.discEl + 3) / 4)));
    // Below the horizon band the dome should match fog exactly; fog is display-referred linear here.
    this.domeMat.setColor3("fogColor", new Color3(k.fog[0], k.fog[1], k.fog[2]));
    this.domeMat.setFloat("skyGain", k.gain);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + 540) % 360) - 180;
  if (Math.abs(d) > 170) d = b - a;
  return a + d * t;
}

function mix3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
