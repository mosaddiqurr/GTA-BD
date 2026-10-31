import { AbstractMesh, AssetContainer, InstantiatedEntries, Mesh, PBRMaterial, Quaternion, Scene, Skeleton, Texture, TransformNode, Vector3 } from "@babylonjs/core";
import { loadContainer } from "../world/assets";

export const CHARACTER_IDS = [
  "hero_mango", "npc_rickshaw_watermelon", "npc_tea_banana", "npc_shop_papaya", "npc_student_lemon", "npc_cng_guava",
  "npc_office_orange", "npc_elder_date", "npc_vendor_pineapple", "npc_police_coconut", "npc_worker_jackfruit", "npc_commuter_lychee",
  "npc_woman_apple", "npc_woman_peach", "npc_woman_plum", "npc_girl_pear", "npc_kid_berry", "npc_granny_fig", "npc_doctor_kiwi", "npc_guard_melon", "npc_sweeper_tamarind", "npc_boss_quince",
] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];

export const PEDESTRIAN_IDS: CharacterId[] = ["npc_student_lemon", "npc_office_orange", "npc_elder_date", "npc_shop_papaya", "npc_commuter_lychee", "npc_worker_jackfruit", "npc_vendor_pineapple", "npc_tea_banana", "npc_cng_guava", "npc_rickshaw_watermelon", "npc_woman_apple", "npc_woman_peach", "npc_woman_plum", "npc_woman_peach", "npc_woman_apple", "npc_girl_pear", "npc_kid_berry", "npc_granny_fig", "npc_boss_quince", "npc_sweeper_tamarind", "npc_doctor_kiwi"];
export const DRIVER_IDS: CharacterId[] = ["npc_cng_guava", "npc_commuter_lychee", "npc_office_orange", "npc_worker_jackfruit"];
export const PASSENGER_IDS: CharacterId[] = ["npc_student_lemon", "npc_office_orange", "npc_elder_date", "npc_commuter_lychee", "npc_shop_papaya", "npc_worker_jackfruit", "npc_woman_apple", "npc_woman_peach", "npc_woman_plum", "npc_granny_fig"];

const JOINTS = ["hips", "spine", "chest", "head", "upperarm.L", "forearm.L", "hand.L", "upperarm.R", "forearm.R", "hand.R", "thigh.L", "shin.L", "foot.L", "thigh.R", "shin.R", "foot.R"] as const;
const J = {
  hips: 0, spine: 1, chest: 2, head: 3,
  armL: 4, foreL: 5, handL: 6, armR: 7, foreR: 8, handR: 9,
  thighL: 10, shinL: 11, footL: 12, thighR: 13, shinR: 14, footR: 15,
} as const;

export type Pose =
  | "stand" | "walk" | "run" | "jump" | "drive_car" | "drive_micro" | "drive_bus" | "drive_truck" | "drive_cng" | "drive_easybike" | "ride_bicycle" | "ride_motorbike" | "pedal_rickshaw"
  | "walk_u" | "hang" | "sit_bench" | "sit_tea" | "police" | "wave" | "dodge" | "tea" | "talk" | "idle_look" | "shrug" | "passenger" | "reach" | "pull" | "point" | "climb" | "mount" | "bowl" | "bat" | "kick" | "cheer" | "crouch" | "dodge2" | "dodge3" | "shrug2";

/** Metres covered by one full walk or run cycle. Sets the leg speed so feet do not slide. */
export const WALK_CYCLE_M = 0.92;
export const RUN_CYCLE_M = 1.85;

/** Loop length of each pose in seconds. Everything periodic in a pose repeats exactly over this. */
export const POSE_PERIOD: Record<Pose, number> = {
  hang: 4,
  walk_u: 1,
  stand: 8, idle_look: 8, talk: 6, sit_bench: 8, tea: 6, police: 8, wave: 1.1, dodge: 1, shrug: 1.6, jump: 1, drive_car: 1, drive_micro: 1, drive_bus: 1, drive_truck: 1, drive_cng: 1, drive_easybike: 1, passenger: 8,
  walk: 1, run: 1, ride_bicycle: 1, pedal_rickshaw: 1, ride_motorbike: 1, reach: 1, climb: 1, mount: 1, sit_tea: 7, pull: 2, point: 3, bowl: 1, bat: 1.2, kick: 0.8, cheer: 1.1, crouch: 5, dodge2: 1, dodge3: 1, shrug2: 1.5,
};

const library = new Map<string, AssetContainer | null>();
const lodLibrary = new Map<string, AssetContainer | null>();

export async function preloadCharacters(scene: Scene, onProgress?: (done: number, total: number) => void): Promise<void> {
  let done = 0;
  await Promise.all(
    CHARACTER_IDS.map(async (id) => {
      library.set(id, await loadContainer(scene, `assets/characters/${id}.glb`));
      lodLibrary.set(id, await loadContainer(scene, `assets/characters/${id}_lod1.glb`));
      onProgress?.(++done, CHARACTER_IDS.length);
    }),
  );
}

export function characterAvailable(id: string): boolean {
  return !!library.get(id);
}

/** Most people come in a few outfits: the clothes recoloured, by `tools/textures/build_outfits.py`.
 *  Police stay in uniform, and the hero always looks like the hero. */
export function outfitsOf(id: string): number {
  // Uniforms stay as they are, and so does anyone new until their other clothes are painted.
  return id === "npc_police_coconut" || id === "hero_mango" || id === "npc_guard_melon" || id === "npc_doctor_kiwi" ? 1 : id.startsWith("npc_woman") || id === "npc_girl_pear" || id === "npc_kid_berry" || id === "npc_granny_fig" || id === "npc_sweeper_tamarind" || id === "npc_boss_quince" ? 1 : 3;
}

const outfitSets = new Map<string, PBRMaterial[]>();

/** The material for one outfit, made once and shared by the crowd and the close-up characters. */
export function outfitMaterial(id: string, outfit: number, base: PBRMaterial, scene: Scene): PBRMaterial {
  let set = outfitSets.get(id);
  if (!set) outfitSets.set(id, (set = [base]));
  if (outfit <= 0 || outfit >= outfitsOf(id)) return base;
  if (set[outfit]) return set[outfit];
  const mat = base.clone(`${id}_outfit${outfit}`) as PBRMaterial;
  const file = `assets/characters/${id}__${outfit === 1 ? "a" : "b"}_albedo.webp`;
  // Only swapped in once it's loaded: a missing file would show the engine's checker pattern.
  const tex: Texture = new Texture(file, scene, false, false, Texture.TRILINEAR_SAMPLINGMODE, () => {
    tex.anisotropicFilteringLevel = 8;
    mat.albedoTexture = tex;
  });
  set[outfit] = mat;
  return mat;
}

export function characterContainer(id: string, lod: 0 | 1): AssetContainer | null {
  return (lod === 0 ? library.get(id) : lodLibrary.get(id)) ?? null;
}

const REST_ARM = 0.82; // the model's arms start this far above hanging straight down
const TAU = Math.PI * 2;

type V3 = readonly [number, number, number];

/** Where a driver's hands and feet go, relative to the hips on the seat, in vehicle axes
 *  (+X to the vehicle's right, +Z forward). The fleet fills these in from each model. */
export interface SeatRig {
  handL: V3;
  handR: V3;
  footL?: V3;
  footR?: V3;
  /** Forward lean of the chest, in radians. */
  lean?: number;
}

const seatRigs = new Map<Pose, SeatRig>();

export function setSeatRig(pose: Pose, rig: SeatRig): void {
  seatRigs.set(pose, rig);
}

/** Rest position of every joint in character space, per character type. */
const restPositions = new Map<string, Vector3[]>();

const QA = new Quaternion(), QB = new Quaternion(), QC = new Quaternion(), QD = new Quaternion();
const VA = new Vector3(), VB = new Vector3(), VC = new Vector3(), VD = new Vector3(), VE = new Vector3();

/** Rotates a vector by a quaternion, in the same algebra the skeleton chain uses. */
function rotate(q: Quaternion, v: Vector3, out: Vector3): Vector3 {
  const cx = q.y * v.z - q.z * v.y, cy = q.z * v.x - q.x * v.z, cz = q.x * v.y - q.y * v.x;
  const dx = cx + q.w * v.x, dy = cy + q.w * v.y, dz = cz + q.w * v.z;
  const ex = q.y * dz - q.z * dy, ey = q.z * dx - q.x * dz, ez = q.x * dy - q.y * dx;
  return out.set(v.x + 2 * ex, v.y + 2 * ey, v.z + 2 * ez);
}

function smoothstep(a: number, b: number, x: number): number {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
}

/** Shortest rotation taking unit vector a to unit vector b. */
function arc(a: Vector3, b: Vector3, out: Quaternion): void {
  const d = Vector3.Dot(a, b);
  if (d < -0.9999) {
    out.set(1, 0, 0, 0);
    return;
  }
  out.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x, 1 + d);
  out.normalize();
}

/** One live character: a clone of the skinned model, driven by code, with smooth blending.
 *  Rotations are written in character space (glTF: +Z forward, +Y up, +X the character's left)
 *  and converted per joint, so bone roll in the file does not matter. */
export class Character {
  readonly root: TransformNode;
  readonly meshes: AbstractMesh[] = [];
  private entries: InstantiatedEntries;
  private nodes: (TransformNode | null)[] = [];
  private restLocal: Quaternion[] = [];
  private restWorld: Quaternion[] = [];
  private restWorldInv: Quaternion[] = [];
  private hipRest = { x: 0, y: 0, z: 0 };
  /** Height of the hips above the feet in the rest pose. */
  hipHeight = 0.5;

  // Current and target Euler per joint: x, y, z, packed.
  private cur = new Float32Array(JOINTS.length * 3);
  private tgt = new Float32Array(JOINTS.length * 3);
  private hipCur = new Float32Array(3);
  private hipTgt = new Float32Array(3);
  private phase = 0;
  private time = Math.random() * 100;
  private tmpA = new Quaternion();
  private tmpB = new Quaternion();
  private tmpD = new Quaternion();

  pose: Pose = "stand";
  /** Metres per second over the ground, or wheel speed when riding. */
  speed = 0;
  /** Steering, -1..1, for handlebar poses. */
  steer = 0;
  /** Drinking, in the `sit_tea` pose. When false the glass has run out or hasn't arrived. */
  sipping = false;
  /** How far up towards the face the glass is, 0..1. */
  sipLift = 0;
  /** Lean into acceleration and turns, in radians. Set by the player controller. */
  leanForward = 0;
  leanSide = 0;
  /** A hand on something in the world, such as a door handle, on top of whatever the pose is
   *  doing. `side` is 1 for the left hand and -1 for the right. Blends in and out like any pose. */
  grasp: { side: 1 | -1; x: number; y: number; z: number } | null = null;
  /** One arm up holding an umbrella, whether walking, running or standing. */
  umbrellaUp = false;
  /** How quickly poses blend into one another. Raised for snappy moves, lowered for slow ones. */
  blendRate = 12;
  animate = true;
  private updateEvery = 1;
  private frame = Math.floor(Math.random() * 8);

  constructor(readonly id: CharacterId, scene: Scene, shadow?: (m: AbstractMesh) => void) {
    const c = library.get(id);
    if (!c) throw new Error(`character ${id} not loaded`);
    this.entries = c.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
    this.root = new TransformNode(`char_${id}`, scene);
    this.root.rotationQuaternion = null;
    const gltfRoot = this.entries.rootNodes[0] as TransformNode;
    gltfRoot.parent = this.root;
    const byName = new Map<string, TransformNode>();
    const collect = (n: TransformNode): void => {
      byName.set(n.name, n);
      if (n instanceof AbstractMesh) this.meshes.push(n);
      for (const ch of n.getChildren()) if (ch instanceof TransformNode) collect(ch);
    };
    collect(gltfRoot);
    for (const m of this.meshes) {
      m.isPickable = false;
      m.receiveShadows = true;
      if (m.getTotalVertices() > 0) shadow?.(m);
    }
    const worldOf = (n: TransformNode | null | undefined): Quaternion => {
      let q = Quaternion.Identity();
      let p: TransformNode | null | undefined = n;
      const chain: TransformNode[] = [];
      while (p && p !== gltfRoot) {
        chain.unshift(p);
        p = p.parent as TransformNode | null;
      }
      for (const link of chain) {
        const local = link.rotationQuaternion ?? Quaternion.FromEulerVector(link.rotation);
        q = q.multiply(local);
      }
      return q;
    };
    JOINTS.forEach((name) => {
      const node = byName.get(name) ?? null;
      this.nodes.push(node);
      if (node && !node.rotationQuaternion) node.rotationQuaternion = Quaternion.FromEulerVector(node.rotation);
      this.restLocal.push(node?.rotationQuaternion?.clone() ?? Quaternion.Identity());
      const w = worldOf(node);
      this.restWorld.push(w);
      this.restWorldInv.push(Quaternion.Inverse(w));
    });
    const hips = this.nodes[J.hips];
    if (hips) {
      this.hipRest = { x: hips.position.x, y: hips.position.y, z: hips.position.z };
      this.root.computeWorldMatrix(true);
      hips.computeWorldMatrix(true);
      this.hipHeight = hips.getAbsolutePosition().y;
    }
    if (!restPositions.has(id)) {
      // Stored in character space: the file's mirror makes Babylon's +X the character's right.
      this.root.computeWorldMatrix(true);
      gltfRoot.computeWorldMatrix(true);
      const rest = this.nodes.map((n) => {
        if (!n) return new Vector3();
        const chain: TransformNode[] = [];
        for (let p: TransformNode | null = n; p && p !== gltfRoot; p = p.parent as TransformNode | null) chain.unshift(p);
        for (const link of chain) link.computeWorldMatrix(true);
        const w = n.getAbsolutePosition();
        return new Vector3(-w.x, w.y, w.z);
      });
      restPositions.set(id, rest);
    }
    this.setPose("stand", true);
    this.apply();
  }

  /** The skinned mesh and its skeleton, used to bake crowd animation. */
  get skinned(): { mesh: Mesh; skeleton: Skeleton } {
    const mesh = this.meshes.find((m) => m.getTotalVertices() > 0) as Mesh;
    return { mesh, skeleton: mesh.skeleton as Skeleton };
  }

  dispose(): void {
    this.entries.dispose();
    this.root.dispose();
  }

  setEnabled(on: boolean): void {
    this.root.setEnabled(on);
  }

  private plainMaterial: PBRMaterial | null = null;

  /** Dresses this character, to match how the crowd has been drawing them. */
  setOutfit(outfit: number): void {
    const mesh = this.skinned.mesh;
    this.plainMaterial ??= mesh.material as PBRMaterial;
    mesh.material = outfitMaterial(this.id, outfit, this.plainMaterial, mesh.getScene());
  }

  isEnabled(): boolean {
    return this.root.isEnabled();
  }

  /** Near characters update every frame, further ones every few frames. */
  setDetail(distance: number): void {
    this.updateEvery = distance < 25 ? 1 : distance < 60 ? 2 : 4;
    this.animate = distance < 110;
  }

  setPose(p: Pose, snap = false): void {
    this.pose = p;
    if (snap) {
      this.computeTargets();
      this.cur.set(this.tgt);
      this.hipCur.set(this.hipTgt);
    }
  }

  /** Starts the current pose at a given point of its cycle, so taking over from a crowd copy is invisible. */
  setPhase(fraction: number): void {
    this.phase = fraction * TAU;
    this.time = fraction * POSE_PERIOD[this.pose];
  }

  /** How far through its loop the current pose is, 0..1. */
  get cycle(): number {
    const p = this.pose;
    const f = p === "walk" || p === "run" ? this.phase / TAU : this.time / POSE_PERIOD[p];
    return f - Math.floor(f);
  }

  private set(j: number, x: number, y = 0, z = 0): void {
    const i = j * 3;
    this.tgt[i] = x;
    this.tgt[i + 1] = y;
    this.tgt[i + 2] = z;
  }

  private hip(x: number, y: number, z = 0): void {
    this.hipTgt[0] = x;
    this.hipTgt[1] = y;
    this.hipTgt[2] = z;
  }

  /** Target pose for this instant. Positive thigh X swings a leg back, so forward is negative.
   *  Arms hang by rotating Z towards the body. */
  private computeTargets(): void {
    const t = this.time;
    const w = TAU / POSE_PERIOD[this.pose]; // one full loop of this pose
    const hang = REST_ARM;
    this.tgt.fill(0);
    this.hip(0, 0);
    this.set(J.armL, 0, 0, -hang);
    this.set(J.armR, 0, 0, hang);
    switch (this.pose) {
      case "stand":
      case "idle_look": {
        const look = this.pose === "idle_look";
        const b = Math.sin(t * w * 2); // about 1.5 rad/s: a relaxed breath
        const shift = Math.sin(t * w);
        this.set(J.chest, b * 0.016, look ? Math.sin(t * w) * 0.22 : 0);
        this.set(J.head, b * 0.01 + 0.02, look ? Math.sin(t * w) * 0.6 : shift * 0.09);
        this.set(J.armL, 0.04 * b, 0, -hang + 0.03 * b);
        this.set(J.armR, -0.04 * b, 0, hang - 0.03 * b);
        this.set(J.foreL, -0.16);
        this.set(J.foreR, -0.16);
        // Weight shifts lazily from foot to foot.
        this.set(J.hips, 0, 0, shift * 0.018);
        this.set(J.thighL, 0.015, 0, 0.05 - shift * 0.018);
        this.set(J.thighR, -0.015, 0, -0.05 - shift * 0.018);
        this.hip(shift * 0.008, 0.005 * b);
        break;
      }
      case "walk":
      case "walk_u":
      case "run": {
        const run = this.pose === "run";
        const ph = this.phase;
        const a = Math.sin(ph);
        const b = Math.cos(ph);
        const reach = run ? 0.92 : 0.6;
        // Each leg: forward swing with a bent knee, then a straight leg pushing the body along.
        const leg = (thigh: number, shin: number, foot: number, s: number, c: number): void => {
          const swing = Math.max(0, c);
          this.set(thigh, -s * reach - (run ? 0.2 : 0.05));
          this.set(shin, swing * swing * (run ? 1.7 : 0.95) + (run ? 0.26 : 0.1));
          // Toes lift as the heel lands, and the foot rolls over to push off behind.
          this.set(foot, -Math.max(0, s) * (run ? 0.3 : 0.34) + Math.max(0, -s) * (run ? 0.5 : 0.4));
        };
        leg(J.thighL, J.shinL, J.footL, a, b);
        leg(J.thighR, J.shinR, J.footR, -a, -b);
        if (!run) {
          this.set(J.armL, a * 0.46, 0, -hang + 0.07);
          if (this.pose !== "walk_u") this.set(J.armR, -a * 0.46, 0, hang - 0.07);
          this.set(J.foreL, -0.42 - Math.max(0, -a) * 0.2);
          this.set(J.foreR, -0.42 - Math.max(0, a) * 0.2);
        }
        // The mascot waddle: hips roll over the standing leg, chest twists against them.
        const twist = a * (run ? 0.16 : 0.1);
        const roll = b * (run ? 0.045 : 0.07);
        this.set(J.hips, run ? 0.06 : 0.015, -twist, roll);
        this.set(J.spine, 0, twist * 0.5, -roll * 0.5);
        this.set(J.chest, run ? 0.16 : 0.035, twist * 1.1, -roll * 0.6);
        this.set(J.head, run ? -0.12 : -0.025, -twist * 0.7, roll * 0.25);
        const bounce = Math.cos(ph * 2); // up twice per cycle, highest as the legs pass
        this.hip(b * (run ? 0.012 : 0.018), bounce * (run ? 0.045 : 0.022) - (run ? 0.03 : 0.012));
        // One arm up, holding the umbrella over their head.
        if (this.pose === "walk_u") this.handFromShoulder(-1, 0.08, 0.36, 0.12);
        if (run) {
          // Elbows bent and close in, fists pumping from the hip up to the chest, each against its leg.
          const pump = (side: 1 | -1, f: number): void => this.handFromShoulder(side, 0.07 - f * 0.015, -0.2 + f * 0.1, 0.1 + f * 0.17);
          pump(1, -a);
          pump(-1, a);
        }
        break;
      }
      case "jump":
        this.set(J.thighL, -0.95);
        this.set(J.thighR, -0.25);
        this.set(J.shinL, 1.15);
        this.set(J.shinR, 0.55);
        this.set(J.armL, 0.35, 0, -hang + 0.65);
        this.set(J.armR, -0.35, 0, hang - 0.65);
        this.set(J.foreL, -0.9);
        this.set(J.foreR, -0.9);
        this.set(J.chest, 0.08);
        break;
      case "drive_car":
      case "drive_micro":
      case "drive_bus":
      case "drive_truck":
      case "drive_cng":
      case "drive_easybike": {
        // Sitting: a fallback for the legs, then both hands and feet are placed on the real controls.
        this.set(J.thighL, -1.45, -0.05);
        this.set(J.thighR, -1.45, 0.05);
        this.set(J.shinL, 1.35);
        this.set(J.shinR, 1.35);
        const rig = seatRigs.get(this.pose);
        this.set(J.chest, rig?.lean ?? 0);
        this.set(J.head, -(rig?.lean ?? 0) * 0.6, this.steer * 0.25);
        this.reachControls(rig);
        break;
      }
      case "passenger": {
        const b = Math.sin(t * w);
        this.set(J.thighL, -1.45, -0.08);
        this.set(J.thighR, -1.45, 0.08);
        this.set(J.shinL, 1.4);
        this.set(J.shinR, 1.4);
        this.set(J.armL, -0.5, 0, -hang + 0.1);
        this.set(J.armR, -0.5, 0, hang - 0.1);
        this.set(J.foreL, -0.75);
        this.set(J.foreR, -0.75);
        this.set(J.head, 0, b * 0.35);
        break;
      }
      case "ride_bicycle":
      case "pedal_rickshaw":
      case "ride_motorbike": {
        const moto = this.pose === "ride_motorbike";
        const ph = this.phase;
        if (moto) {
          this.set(J.thighL, -1.2, -0.12);
          this.set(J.thighR, -1.2, 0.12);
          this.set(J.shinL, 1.5);
          this.set(J.shinR, 1.5);
        } else {
          const up = Math.sin(ph);
          this.set(J.thighL, -1.05 - up * 0.42);
          this.set(J.thighR, -1.05 + up * 0.42);
          this.set(J.shinL, 1.05 + up * 0.45);
          this.set(J.shinR, 1.05 - up * 0.45);
          this.set(J.footL, -0.1);
          this.set(J.footR, -0.1);
          this.set(J.hips, 0.14, 0, up * 0.035);
        }
        if (moto) this.set(J.hips, 0.14);
        this.set(J.chest, moto ? 0.25 : 0.18);
        this.set(J.head, -0.15, this.steer * 0.3);
        this.reachControls(seatRigs.get(this.pose));
        break;
      }
      case "sit_bench":
        this.set(J.thighL, -1.5, -0.1);
        this.set(J.thighR, -1.5, 0.1);
        this.set(J.shinL, 1.5);
        this.set(J.shinR, 1.5);
        this.set(J.armL, -0.55, 0, -hang + 0.12);
        this.set(J.armR, -0.55, 0, hang - 0.12);
        this.set(J.foreL, -1.1 - Math.max(0, Math.sin(t * w)) * 0.6);
        this.set(J.foreR, -0.5);
        this.set(J.head, 0, Math.sin(t * w * 2) * 0.25);
        break;
      case "sit_tea": {
        // On the bench with a glass: it rests low, then lifts to the face for a sip every few seconds.
        this.set(J.thighL, -1.5, -0.1);
        this.set(J.thighR, -1.5, 0.1);
        this.set(J.shinL, 1.5);
        this.set(J.shinR, 1.5);
        this.set(J.armL, -0.55, 0, -hang + 0.12);
        this.set(J.foreL, -1.05);
        const cycle = (t * w) / TAU;
        const f = cycle - Math.floor(cycle);
        const lift = this.sipping ? smoothstep(0.52, 0.64, f) * (1 - smoothstep(0.84, 0.94, f)) : 0;
        this.sipLift = lift;
        this.set(J.chest, lift * 0.03);
        this.set(J.head, -lift * 0.14, lift > 0 ? 0 : Math.sin(t * w * 2) * 0.22);
        // The glass rests over the knee, and comes up in front of the face.
        const rest = restPositions.get(this.id);
        if (rest) {
          const faceY = rest[J.head].y + 0.05;
          this.armTo(-1, VE.set(-0.12 + lift * 0.08, 0.58 + (faceY - 0.58) * lift, 0.26 + lift * 0.05));
        }
        break;
      }
      case "hang": {
        // One foot on the step, the other out over the road, and an arm through the door rail.
        const sway = Math.sin(t * w);
        this.handFromShoulder(1, 0.02, 0.42 + sway * 0.01, 0.1);
        this.set(J.armR, 0.24 + sway * 0.05, 0, hang - 0.28);
        this.set(J.foreR, -0.3);
        this.set(J.chest, -0.06, 0, -0.14 + sway * 0.02);
        this.set(J.thighL, -0.08);
        this.set(J.thighR, 0.34, 0, -0.22);
        this.set(J.shinR, 0.26);
        break;
      }
      case "pull":
        // Weight on the back foot, leaning away from the door being pulled open.
        this.set(J.thighR, -0.2);
        this.set(J.shinR, 0.16);
        this.set(J.thighL, 0.14);
        this.set(J.shinL, 0.06);
        this.set(J.chest, 0.06);
        this.set(J.armL, 0.05, 0, -hang + 0.06);
        this.set(J.armR, 0.05, 0, hang - 0.06);
        this.set(J.foreL, -0.3);
        this.set(J.foreR, -0.3);
        break;
      case "point": {
        // An arm held out towards the place being described, with a little emphasis.
        const nod = Math.sin(t * w * 2);
        this.set(J.armR, -1.42 + nod * 0.03, 0, hang * 0.72);
        this.set(J.foreR, -0.1);
        this.set(J.armL, 0.02, 0, -hang + 0.06);
        this.set(J.foreL, -0.3);
        this.set(J.chest, 0.02, -0.08);
        this.set(J.head, nod * 0.02, -0.06);
        break;
      }
      case "tea": {
        const pour = Math.sin(t * w);
        this.set(J.armR, -1.0, 0, hang * 0.5);
        this.set(J.foreR, -1.1 + pour * 0.5);
        this.set(J.armL, -0.7, 0, -hang * 0.55);
        this.set(J.foreL, -1.3 - pour * 0.3);
        this.set(J.head, 0.15 + pour * 0.05, Math.sin(t * w * 2) * 0.2);
        this.set(J.chest, 0.08);
        break;
      }
      case "talk": {
        const g = Math.sin(t * w * 3);
        this.set(J.armR, -0.7 + g * 0.3, 0, hang * 0.5);
        this.set(J.foreR, -1 + Math.sin(t * w * 4) * 0.35);
        this.set(J.armL, -0.15, 0, -hang + 0.1);
        this.set(J.foreL, -0.5);
        this.set(J.head, Math.sin(t * w * 2) * 0.08, Math.sin(t * w) * 0.2);
        this.set(J.chest, g * 0.02);
        break;
      }
      case "wave": {
        // The hand goes up and well out to the side, clear of the head, and the wrist does the waving.
        const g = Math.sin(t * w);
        this.handFromShoulder(-1, 0.25 + g * 0.05, 0.25, 0.1);
        this.set(J.head, 0, -0.12);
        this.set(J.chest, -0.03, 0, 0.05);
        this.hip(0, 0.006 * g);
        break;
      }
      case "dodge2": {
        // Both arms up in front of the face, leaning away.
        this.handFromShoulder(1, 0.02, 0.2, 0.28);
        this.handFromShoulder(-1, 0.02, 0.2, 0.28);
        this.set(J.chest, -0.28);
        this.set(J.head, -0.12, 0.35);
        this.set(J.thighR, -0.5);
        this.set(J.shinR, 0.8);
        this.hip(0, -0.02);
        break;
      }
      case "dodge3": {
        // One arm flung out for balance, a big step to the side.
        this.handFromShoulder(1, 0.34, 0.05, 0.05);
        this.handFromShoulder(-1, 0.05, -0.1, 0.3);
        this.set(J.chest, 0.08, 0.3, -0.14);
        this.set(J.head, 0, -0.45);
        this.set(J.thighL, -0.45, 0, -0.35);
        this.set(J.shinL, 0.5);
        this.set(J.thighR, 0.2, 0, 0.1);
        this.hip(0, -0.03);
        break;
      }
      case "shrug2": {
        // A hand on the hip, and the other one going: "what was that?"
        const g = Math.sin(t * w);
        this.handFromShoulder(1, 0.09, -0.28, -0.03);
        this.handFromShoulder(-1, 0.14, 0.03 + g * 0.05, 0.24);
        this.set(J.head, 0.05 * g, 0.2, 0.08);
        this.set(J.chest, 0, -0.1);
        break;
      }
      case "bowl": {
        // One arm right over the top, the other reaching out, and the weight coming through.
        const a = t * w;
        const g = Math.sin(a);
        this.set(J.armR, -a, 0, hang * 0.15);
        this.set(J.foreR, -0.05);
        this.set(J.armL, -1 + g * 0.5, 0, -hang + 0.1);
        this.set(J.foreL, -0.4);
        this.set(J.chest, 0.18 + g * 0.14);
        this.set(J.head, -0.1);
        this.set(J.thighL, -0.5);
        this.set(J.shinL, 0.3);
        this.set(J.thighR, 0.25);
        this.set(J.shinR, 0.2);
        this.hip(0, -0.02);
        break;
      }
      case "bat": {
        // Knees bent, both hands together, swinging across the body.
        const g = Math.sin(t * w);
        this.set(J.armR, -0.95, 0.45 * g, hang * 0.45);
        this.set(J.armL, -0.95, 0.45 * g, -hang * 0.45);
        this.set(J.foreR, -0.45);
        this.set(J.foreL, -0.45);
        this.set(J.chest, 0.28, g * 0.55);
        this.set(J.spine, 0.1, g * 0.3);
        this.set(J.hips, 0, g * 0.18);
        this.set(J.head, -0.12, -g * 0.4);
        this.set(J.thighL, -0.4);
        this.set(J.shinL, 0.55);
        this.set(J.thighR, -0.25);
        this.set(J.shinR, 0.45);
        this.hip(0, -0.05);
        break;
      }
      case "kick": {
        const g = Math.sin(t * w);
        this.set(J.thighR, -0.3 - g * 0.95);
        this.set(J.shinR, 0.3 + Math.max(0, g) * 0.9);
        this.set(J.thighL, -0.12);
        this.set(J.shinL, 0.2);
        this.set(J.armL, g * 0.7, 0, -hang + 0.25);
        this.set(J.armR, -g * 0.5, 0, hang - 0.25);
        this.set(J.foreL, -0.7);
        this.set(J.foreR, -0.7);
        this.set(J.chest, 0.12);
        this.hip(0, -0.01);
        break;
      }
      case "cheer": {
        // Both arms in the air, and a little jump.
        const g = Math.sin(t * w);
        this.set(J.armR, -0.2, 0, hang + 1.85 + g * 0.18);
        this.set(J.armL, -0.2, 0, -hang - 1.85 - g * 0.18);
        this.set(J.foreR, 0, 0, 0.2);
        this.set(J.foreL, 0, 0, -0.2);
        this.set(J.head, -0.15);
        this.hip(0, 0.03 * Math.abs(g));
        break;
      }
      case "crouch": {
        // Down behind the stumps with hands ready.
        const b = Math.sin(t * w);
        this.set(J.armR, -0.75, 0, hang * 0.5);
        this.set(J.armL, -0.75, 0, -hang * 0.5);
        this.set(J.foreR, -0.6);
        this.set(J.foreL, -0.6);
        this.set(J.chest, 0.5 + b * 0.015);
        this.set(J.spine, 0.2);
        this.set(J.head, -0.42);
        this.set(J.thighL, -1.05);
        this.set(J.shinL, 1.45);
        this.set(J.thighR, -1.05);
        this.set(J.shinR, 1.45);
        this.hip(0, -0.16);
        break;
      }
      case "shrug": {
        // Arms out, palms up, shoulders lifted: "fine, take it, what can I do?"
        const k = 0.5 + 0.5 * Math.sin(t * w);
        this.set(J.armL, -0.5, 0.3, -hang + 0.55 + k * 0.1);
        this.set(J.armR, -0.5, -0.3, hang - 0.55 - k * 0.1);
        this.set(J.foreL, -1.05);
        this.set(J.foreR, -1.05);
        this.set(J.chest, -0.06);
        this.set(J.head, 0.08 * k, 0, 0.14 * (k - 0.5));
        break;
      }
      case "reach": {
        // Hand out towards a door handle, weight on the front foot.
        this.set(J.armR, -1.25, 0, hang * 0.72);
        this.set(J.foreR, -0.5);
        this.set(J.armL, 0.12, 0, -hang + 0.08);
        this.set(J.foreL, -0.3);
        this.set(J.thighR, -0.28);
        this.set(J.shinR, 0.2);
        this.set(J.thighL, 0.16);
        this.set(J.chest, 0.12, -0.25);
        this.set(J.head, 0.05, -0.1);
        break;
      }
      case "climb": {
        // One knee up onto the sill, hands pulling on the frame.
        this.set(J.thighR, -1.3);
        this.set(J.shinR, 1.35);
        this.set(J.thighL, -0.2);
        this.set(J.shinL, 0.35);
        this.set(J.armR, -1.5, 0, hang * 0.5);
        this.set(J.armL, -1.3, 0, -hang * 0.5);
        this.set(J.foreR, -0.8);
        this.set(J.foreL, -0.8);
        this.set(J.chest, 0.22);
        this.set(J.head, -0.1);
        break;
      }
      case "mount": {
        // Swinging one leg up and over a saddle.
        this.set(J.thighL, -0.9, 0, -0.75);
        this.set(J.shinL, 0.8);
        this.set(J.thighR, -0.1);
        this.set(J.shinR, 0.15);
        this.set(J.armL, -0.9, 0, -hang * 0.6);
        this.set(J.armR, -0.9, 0, hang * 0.6);
        this.set(J.foreL, -0.5);
        this.set(J.foreR, -0.5);
        this.set(J.chest, 0.2);
        break;
      }
      case "dodge": {
        this.set(J.armL, -0.3, 0, -hang + 1.5);
        this.set(J.armR, -0.3, 0, hang - 1.5);
        this.set(J.foreL, -0.9);
        this.set(J.foreR, -0.9);
        this.set(J.thighL, -0.7);
        this.set(J.shinL, 1.1);
        this.set(J.chest, -0.2);
        this.set(J.head, -0.2);
        break;
      }
      case "police": {
        // Traffic hand signals: a slow beckoning arm and a raised stop palm.
        const beck = Math.sin(t * w * 3);
        this.set(J.armR, -0.15, 0, hang + 1.35);
        this.set(J.foreR, 0, 0, 0.25 + beck * 0.55);
        this.set(J.armL, -1.35, 0, -hang * 0.15);
        this.set(J.foreL, -0.45);
        this.set(J.chest, 0, Math.sin(t * w) * 0.5);
        this.set(J.head, 0, Math.sin(t * w) * 0.75);
        break;
      }
    }
    // Live lean from the controller, on top of whatever the pose is doing.
    if (this.leanForward !== 0 || this.leanSide !== 0) {
      this.tgt[J.spine * 3] += this.leanForward * 0.55;
      this.tgt[J.chest * 3] += this.leanForward * 0.45;
      this.tgt[J.spine * 3 + 2] += this.leanSide * 0.6;
      this.tgt[J.chest * 3 + 2] += this.leanSide * 0.4;
    }
    if (this.grasp) this.reachOut(this.grasp);
    if (this.umbrellaUp && (this.pose === "stand" || this.pose === "walk" || this.pose === "run")) this.handFromShoulder(-1, 0.08, 0.36, 0.12);
  }

  /** Puts one hand on a point in the world, whichever way the character is standing or sitting. */
  private reachOut(g: { side: 1 | -1; x: number; y: number; z: number }): void {
    const root = this.root;
    const yaw = root.rotationQuaternion ? root.rotationQuaternion.toEulerAngles().y : root.rotation.y;
    const dx = g.x - root.position.x, dz = g.z - root.position.z;
    const sn = Math.sin(yaw), cs = Math.cos(yaw);
    // Character space: +Z forward, +Y up, +X the character's left.
    this.armTo(g.side, VE.set(-(dx * cs - dz * sn), g.y - root.position.y, dx * sn + dz * cs));
  }

  /** Bends an arm so its hand is at a point in character space. */
  private armTo(side: 1 | -1, to: Vector3): void {
    const rest = restPositions.get(this.id);
    if (!rest) return;
    const qh = this.euler(J.hips, new Quaternion());
    const qs = qh.multiply(this.euler(J.spine, QA));
    const qc = qs.multiply(this.euler(J.chest, QA));
    const hip = new Vector3(rest[J.hips].x + this.hipTgt[0], rest[J.hips].y + this.hipTgt[1], rest[J.hips].z + this.hipTgt[2]);
    const spine = hip.add(rotate(qh, rest[J.spine].subtract(rest[J.hips]), VA));
    const chest = spine.add(rotate(qs, rest[J.chest].subtract(rest[J.spine]), VA));
    const a = side === 1 ? J.armL : J.armR, f = side === 1 ? J.foreL : J.foreR, h = side === 1 ? J.handL : J.handR;
    const shoulder = chest.add(rotate(qc, rest[a].subtract(rest[J.chest]), VA));
    const target = to.clone();
    const lower = this.limb(a, f, h, qc, shoulder, target, VD.set(side * 0.7, -1, -0.1));
    Quaternion.InverseToRef(lower, QB);
    const restHand = rest[h].subtract(rest[f]).normalize();
    const want = rotate(QB, target.subtract(shoulder).normalize(), new Vector3());
    arc(restHand, want, QD);
    const e = QD.toEulerAngles();
    this.set(h, e.x, e.y, e.z);
  }

  /** Puts a hand somewhere relative to its own shoulder, out to the side, up, and forward. It's measured
   *  from the shoulder so that it works for every body and always clears the fruit. */
  private handFromShoulder(side: 1 | -1, out: number, up: number, forward: number): void {
    const rest = restPositions.get(this.id);
    if (!rest) return;
    const a = rest[side === 1 ? J.armL : J.armR];
    this.armTo(side, new Vector3(a.x + side * out, a.y + up, a.z + forward));
  }

  /** Where a hand is in the world right now, for something held in it. */
  handPosition(side: 1 | -1, out: Vector3): Vector3 {
    const node = this.nodes[side === 1 ? J.handL : J.handR];
    if (!node) return out.copyFrom(this.root.position);
    // Top down, so the answer belongs to this frame and not the last one.
    const chain: TransformNode[] = [];
    for (let p: TransformNode | null = node; p; p = p.parent as TransformNode | null) chain.unshift(p);
    for (const link of chain) link.computeWorldMatrix(true);
    return out.copyFrom(node.getAbsolutePosition());
  }

  private euler(j: number, out: Quaternion): Quaternion {
    const i = j * 3;
    Quaternion.FromEulerAnglesToRef(this.tgt[i], this.tgt[i + 1], this.tgt[i + 2], out);
    return out;
  }

  /** Puts hands on the grips or the wheel, and feet on the floor, whatever this character's size. */
  private reachControls(rig: SeatRig | undefined): void {
    const rest = restPositions.get(this.id);
    if (!rig || !rest) return;
    // Pose of the torso so far, joint by joint from the hips.
    const qh = this.euler(J.hips, new Quaternion());
    const qs = qh.multiply(this.euler(J.spine, QA));
    const qc = qs.multiply(this.euler(J.chest, QA));
    const hip = new Vector3(rest[J.hips].x + this.hipTgt[0], rest[J.hips].y + this.hipTgt[1], rest[J.hips].z + this.hipTgt[2]);
    const spine = hip.add(rotate(qh, rest[J.spine].subtract(rest[J.hips]), VA));
    const chest = spine.add(rotate(qs, rest[J.chest].subtract(rest[J.spine]), VA));
    const base = this.hipHeight;
    const toChar = (p: V3, out: Vector3): Vector3 => out.set(-p[0], base + p[1], p[2]);
    const steerTurn = this.steer * 0.32;

    const arm = (a: number, f: number, h: number, target: V3, side: number): void => {
      const shoulder = chest.add(rotate(qc, rest[a].subtract(rest[J.chest]), VA));
      toChar(target, VE);
      // Turning a wheel carries the hands round it, a little.
      VE.y += side * steerTurn * 0.09;
      const lower = this.limb(a, f, h, qc, shoulder, VE, VD.set(side * 0.55, -1, -0.15));
      // Fingers wrap forward over the grip, instead of carrying on in line with the forearm.
      Quaternion.InverseToRef(lower, QB);
      const restHand = rest[h].subtract(rest[f]).normalize();
      const want = rotate(QB, VA.set(side * 0.2, -0.3, 0.93).normalize(), new Vector3());
      arc(restHand, want, QD);
      const e = QD.toEulerAngles();
      this.set(h, e.x, e.y, e.z);
    };
    arm(J.armL, J.foreL, J.handL, rig.handL, 1);
    arm(J.armR, J.foreR, J.handR, rig.handR, -1);

    const leg = (a: number, f: number, h: number, target: V3 | undefined, side: number): void => {
      if (!target) return;
      const hipJoint = hip.add(rotate(qh, rest[a].subtract(rest[J.hips]), VA));
      toChar(target, VE);
      const qEnd = this.limb(a, f, h, qh, hipJoint, VE, VD.set(side * 0.08, 0.7, 1));
      // Feet stay flat on the floor whatever the shin is doing.
      qEnd.invertInPlace();
      const e = qEnd.toEulerAngles();
      this.set(h, e.x, e.y, e.z);
    };
    leg(J.thighL, J.shinL, J.footL, rig.footL, 1);
    leg(J.thighR, J.shinR, J.footR, rig.footR, -1);
  }

  /** Two-bone IK. Writes the root and middle joints, and returns the world rotation of the lower bone. */
  private limb(rootJ: number, midJ: number, endJ: number, parent: Quaternion, from: Vector3, to: Vector3, pole: Vector3): Quaternion {
    const rest = restPositions.get(this.id)!;
    const l1 = Vector3.Distance(rest[rootJ], rest[midJ]);
    const l2 = Vector3.Distance(rest[midJ], rest[endJ]);
    to.subtractToRef(from, VA);
    const dist = Math.max(Math.min(VA.length(), (l1 + l2) * 0.995), Math.abs(l1 - l2) + 0.005);
    VA.normalize();
    const along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
    const out = Math.sqrt(Math.max(l1 * l1 - along * along, 0));
    // The bend lies towards the pole, square to the reach.
    VB.copyFrom(pole).subtractInPlace(VA.scale(Vector3.Dot(pole, VA)));
    if (VB.lengthSquared() < 1e-6) VB.set(0, 0, 1);
    VB.normalize();
    // Directions the two bones must end up pointing, in character space.
    VC.set(VA.x * along + VB.x * out, VA.y * along + VB.y * out, VA.z * along + VB.z * out).scaleInPlace(1 / l1);
    VB.set(VA.x * dist - VC.x * l1, VA.y * dist - VC.y * l1, VA.z * dist - VC.z * l1).scaleInPlace(1 / l2);

    // Root joint: from its rest direction to the wanted one, seen from the parent's frame.
    const restU = rest[midJ].subtract(rest[rootJ]).normalize();
    Quaternion.InverseToRef(parent, QB);
    const wantU = rotate(QB, VC, new Vector3());
    arc(restU, wantU, QC);
    const a = QC.toEulerAngles();
    this.set(rootJ, a.x, a.y, a.z);

    // Middle joint: the same again, with the root's turn included.
    const upper = parent.multiply(QC);
    Quaternion.InverseToRef(upper, QB);
    const restF = rest[endJ].subtract(rest[midJ]).normalize();
    const wantF = rotate(QB, VB, new Vector3());
    arc(restF, wantF, QD);
    const b = QD.toEulerAngles();
    this.set(midJ, b.x, b.y, b.z);
    return upper.multiply(QD);
  }

  update(dt: number): void {
    this.time += dt;
    const p = this.pose;
    if (p === "walk") this.phase += (dt * this.speed * TAU) / WALK_CYCLE_M;
    else if (p === "run") this.phase += (dt * this.speed * TAU) / RUN_CYCLE_M;
    else if (p === "ride_bicycle" || p === "pedal_rickshaw") this.phase += dt * Math.min(this.speed / 0.45, 12);
    if (!this.animate) return;
    this.frame++;
    if (this.frame % this.updateEvery !== 0) return;
    const step = dt * this.updateEvery;
    this.computeTargets();
    const rate = p === "walk" || p === "run" ? Math.max(this.blendRate, 18) : this.blendRate;
    const k = 1 - Math.exp(-step * rate);
    for (let i = 0; i < this.cur.length; i++) this.cur[i] += (this.tgt[i] - this.cur[i]) * k;
    for (let i = 0; i < 3; i++) this.hipCur[i] += (this.hipTgt[i] - this.hipCur[i]) * k;
    this.apply();
  }

  /** Seeing through the hero's eyes, their own head mustn't be in the way. */
  hideHead(on: boolean): void {
    if (on === this.headHidden) return;
    this.headHidden = on;
    this.nodes[J.head]?.scaling.setAll(on ? 0.001 : 1);
  }

  private headHidden = false;

  /** How far the eyes would be above the feet, if there were any eyes. */
  get eyeHeight(): number {
    const rest = restPositions.get(this.id);
    return rest ? rest[J.head].y + 0.38 : 1.2;
  }

  /** Sets the skeleton to one exact moment of a pose, for baking crowd animation. */
  sample(pose: Pose, fraction: number): void {
    this.pose = pose;
    this.phase = fraction * TAU;
    this.time = fraction * POSE_PERIOD[pose];
    this.computeTargets();
    this.cur.set(this.tgt);
    this.hipCur.set(this.hipTgt);
    this.apply();
  }

  /** Converts the character-space Euler of every joint into its local bone rotation. */
  private apply(): void {
    const { tmpD, tmpA, tmpB } = this;
    for (let j = 0; j < JOINTS.length; j++) {
      const node = this.nodes[j];
      if (!node) continue;
      const i = j * 3;
      Quaternion.FromEulerAnglesToRef(this.cur[i], this.cur[i + 1], this.cur[i + 2], tmpD);
      // local = rest * (restWorld^-1 * delta * restWorld)
      this.restWorldInv[j].multiplyToRef(tmpD, tmpA);
      tmpA.multiplyToRef(this.restWorld[j], tmpB);
      this.restLocal[j].multiplyToRef(tmpB, node.rotationQuaternion!);
    }
    const hips = this.nodes[J.hips];
    if (hips) {
      hips.position.x = this.hipRest.x + this.hipCur[0];
      hips.position.y = this.hipRest.y + this.hipCur[1];
      hips.position.z = this.hipRest.z + this.hipCur[2];
    }
  }

  /** Place the character in the world; `yaw` turns +Z towards heading. */
  place(x: number, y: number, z: number, yaw: number): void {
    this.root.position.set(x, y, z);
    this.root.rotationQuaternion = null;
    this.root.rotation.set(0, yaw, 0);
  }
}
