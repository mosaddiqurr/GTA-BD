import {
  AbstractMesh, Camera, Color3, CascadedShadowGenerator, Constants, DirectionalLight, Effect, HDRCubeTexture, Mesh, MeshBuilder, Scene, ShaderMaterial, Texture, Vector3, HemisphericLight,
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
}

/** Reach of each shadow cascade in metres, nearest first. */
const CASCADE_REACH = [38, 95, 190, 300];

export const ENV_KEYS: EnvKey[] = [
  { name: "morning", hour: 8, el: 22, az: 108, sun: [1.0, 0.86, 0.68], sunPower: 4.6, env: 0.9, fog: [0.74, 0.76, 0.76], exposure: 1.0, night: 0, contrast: 1.12 },
  { name: "noon", hour: 12.5, el: 66, az: 175, sun: [1.0, 0.95, 0.86], sunPower: 6.0, env: 0.95, fog: [0.76, 0.8, 0.84], exposure: 0.92, night: 0, contrast: 1.1 },
  { name: "golden", hour: 16.75, el: 11, az: 258, sun: [1.0, 0.62, 0.32], sunPower: 6.6, env: 0.72, fog: [0.74, 0.65, 0.57], exposure: 1.02, night: 0, contrast: 1.22 },
  { name: "dusk", hour: 18.1, el: 1.5, az: 272, sun: [1.0, 0.42, 0.26], sunPower: 1.6, env: 0.85, fog: [0.5, 0.36, 0.38], exposure: 1.2, night: 0.75, contrast: 1.15 },
  { name: "night", hour: 21, el: 42, az: 200, sun: [0.55, 0.65, 0.95], sunPower: 0.34, env: 3.4, fog: [0.11, 0.09, 0.1], exposure: 1.3, night: 1, contrast: 1.14 },
];

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
  /** Frozen materials skip per-frame uniform work; they thaw only while the light is changing. */
  private frozen = false;
  private canFreeze = false;
  private settleTimer = 0;

  /** Current look; other systems read these. */
  fogColor = new Color3(0.8, 0.7, 0.55);
  exposure = 1;
  contrast = 1.1;
  night = 0;
  private fogDensity: number;
  private from: EnvKey;
  private to: EnvKey;
  private t = 1;
  private transition = 6;

  constructor(private scene: Scene, q: QualityPreset) {
    this.fogDensity = q.fogDensity;
    this.from = this.to = ENV_KEYS[2];
    this.sun = new DirectionalLight("sun", new Vector3(-0.5, -0.5, 0.5), scene);
    this.sun.intensity = 5;
    this.sun.shadowMinZ = 1;
    this.sun.shadowMaxZ = 600;
    this.sun.autoUpdateExtends = true;

    // A gentle fill keeps shadow sides readable if the environment map is still loading.
    this.fill = new HemisphericLight("fill", Vector3.Up(), scene);
    this.fill.intensity = 0.0;

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

  /** Blends to a time-of-day key over `seconds`; zero snaps. */
  async goTo(name: TimeName, seconds: number): Promise<void> {
    await this.loadKey(name);
    this.setMaterialsFrozen(false);
    const key = ENV_KEYS.find((k) => k.name === name)!;
    this.from = seconds > 0 ? this.current() : key;
    this.to = key;
    this.t = seconds > 0 ? 0 : 1;
    this.transition = Math.max(seconds, 0.001);
    this.apply();
  }

  /** A hour for the HUD clock, derived from the blend between keys. */
  get hour(): number {
    return lerp(this.from.hour, this.to.hour, this.t);
  }

  get timeName(): TimeName {
    return this.to.name;
  }

  private current(): EnvKey {
    const t = this.t, a = this.from, b = this.to;
    return {
      name: b.name, hour: lerp(a.hour, b.hour, t), el: lerp(a.el, b.el, t), az: lerpAngle(a.az, b.az, t),
      sun: mix3(a.sun, b.sun, t), sunPower: lerp(a.sunPower, b.sunPower, t), env: lerp(a.env, b.env, t),
      fog: mix3(a.fog, b.fog, t), exposure: lerp(a.exposure, b.exposure, t), night: lerp(a.night, b.night, t), contrast: lerp(a.contrast, b.contrast, t),
    };
  }

  update(dt: number): void {
    if (this.t < 1) {
      this.setMaterialsFrozen(false);
      this.t = Math.min(1, this.t + dt / this.transition);
      this.apply();
      this.settleTimer = 0.5;
    } else if (!this.frozen && this.canFreeze) {
      // Give the last blended values a moment to reach every material before locking them.
      this.settleTimer -= dt;
      if (this.settleTimer <= 0) this.setMaterialsFrozen(true);
    }
  }

  /** Called once loading has finished and every effect is compiled. */
  enableFreezing(): void {
    this.canFreeze = true;
    this.settleTimer = 1;
  }

  private setMaterialsFrozen(on: boolean): void {
    if (this.frozen === on) return;
    this.frozen = on;
    for (const m of this.scene.materials) {
      if (on) m.freeze();
      else m.unfreeze();
    }
  }

  private apply(): void {
    const k = this.current();
    const t = this.t;
    const el = (k.el * Math.PI) / 180;
    const az = (k.az * Math.PI) / 180;
    // Direction towards the sun: north is +Z, east is +X.
    const to = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    this.sun.direction = to.scale(-1);
    this.sun.diffuse = new Color3(k.sun[0], k.sun[1], k.sun[2]);
    this.sun.specular = this.sun.diffuse;
    this.sun.intensity = k.sunPower;
    this.sun.shadowEnabled = k.sunPower > 0.05;

    this.fogColor.set(k.fog[0], k.fog[1], k.fog[2]);
    this.scene.fogColor = this.fogColor;
    this.exposure = k.exposure;
    this.contrast = k.contrast;
    this.night = k.night;
    this.scene.environmentIntensity = k.env;
    // The lighting map swaps halfway through a blend; intensities cover the change.
    const want = t < 0.5 ? this.from.name : this.to.name;
    if (this.iblName !== want) {
      const hdr = this.ibl.get(want);
      if (hdr) {
        this.scene.environmentTexture = hdr;
        this.iblName = want;
      }
    }
    const a = this.skyTex.get(this.from.name) ?? this.skyTex.get(this.to.name);
    const b = this.skyTex.get(this.to.name);
    if (a && b) {
      this.domeMat.setTexture("skyA", a);
      this.domeMat.setTexture("skyB", b);
    }
    this.domeMat.setFloat("blend", t);
    this.domeMat.setVector3("sunDir", to);
    this.domeMat.setColor3("sunColor", new Color3(k.sun[0], k.sun[1], k.sun[2]));
    this.domeMat.setFloat("sunGlow", k.el > -2 && k.night < 0.9 ? 1 : 0);
    // Below the horizon band the dome should match fog exactly; fog is display-referred linear here.
    this.domeMat.setColor3("fogColor", new Color3(k.fog[0], k.fog[1], k.fog[2]));
    this.domeMat.setFloat("skyGain", 1.0);
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
