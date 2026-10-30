import { AbstractMesh, AssetContainer, InstantiatedEntries, Mesh, Quaternion, Scene, Skeleton, TransformNode } from "@babylonjs/core";
import { loadContainer } from "../world/assets";

export const CHARACTER_IDS = [
  "hero_mango", "npc_rickshaw_watermelon", "npc_tea_banana", "npc_shop_papaya", "npc_student_lemon", "npc_cng_guava",
  "npc_office_orange", "npc_elder_date", "npc_vendor_pineapple", "npc_police_coconut", "npc_worker_jackfruit", "npc_commuter_lychee",
] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];

export const PEDESTRIAN_IDS: CharacterId[] = ["npc_student_lemon", "npc_office_orange", "npc_elder_date", "npc_shop_papaya", "npc_commuter_lychee", "npc_worker_jackfruit", "npc_vendor_pineapple", "npc_tea_banana", "npc_cng_guava", "npc_rickshaw_watermelon"];
export const DRIVER_IDS: CharacterId[] = ["npc_cng_guava", "npc_commuter_lychee", "npc_office_orange", "npc_worker_jackfruit"];
export const PASSENGER_IDS: CharacterId[] = ["npc_student_lemon", "npc_office_orange", "npc_elder_date", "npc_commuter_lychee", "npc_shop_papaya", "npc_worker_jackfruit"];

const JOINTS = ["hips", "spine", "chest", "head", "upperarm.L", "forearm.L", "hand.L", "upperarm.R", "forearm.R", "hand.R", "thigh.L", "shin.L", "foot.L", "thigh.R", "shin.R", "foot.R"] as const;
const J = {
  hips: 0, spine: 1, chest: 2, head: 3,
  armL: 4, foreL: 5, handL: 6, armR: 7, foreR: 8, handR: 9,
  thighL: 10, shinL: 11, footL: 12, thighR: 13, shinR: 14, footR: 15,
} as const;

export type Pose =
  | "stand" | "walk" | "run" | "jump" | "sit_drive" | "sit_bus" | "ride_bicycle" | "ride_motorbike" | "pedal_rickshaw"
  | "sit_bench" | "police" | "wave" | "dodge" | "tea" | "talk" | "idle_look" | "shrug" | "passenger" | "reach" | "climb" | "mount";

/** Metres covered by one full walk or run cycle. Sets the leg speed so feet do not slide. */
export const WALK_CYCLE_M = 0.92;
export const RUN_CYCLE_M = 1.85;

/** Loop length of each pose in seconds. Everything periodic in a pose repeats exactly over this. */
export const POSE_PERIOD: Record<Pose, number> = {
  stand: 8, idle_look: 8, talk: 6, sit_bench: 8, tea: 6, police: 8, wave: 1.1, dodge: 1, shrug: 1.6, jump: 1, sit_drive: 1, sit_bus: 1, passenger: 8,
  walk: 1, run: 1, ride_bicycle: 1, pedal_rickshaw: 1, ride_motorbike: 1, reach: 1, climb: 1, mount: 1,
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

export function characterContainer(id: string, lod: 0 | 1): AssetContainer | null {
  return (lod === 0 ? library.get(id) : lodLibrary.get(id)) ?? null;
}

const REST_ARM = 0.82; // the model's arms start this far above hanging straight down
const TAU = Math.PI * 2;

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
  /** Lean into acceleration and turns, in radians. Set by the player controller. */
  leanForward = 0;
  leanSide = 0;
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

  /** Starts a walk or run at a given point of its cycle, so taking over from a crowd copy is invisible. */
  setPhase(fraction: number): void {
    this.phase = fraction * TAU;
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
        const arm = run ? 0.95 : 0.46;
        this.set(J.armL, a * arm, 0, -hang + (run ? 0.26 : 0.07));
        this.set(J.armR, -a * arm, 0, hang - (run ? 0.26 : 0.07));
        this.set(J.foreL, run ? -1.35 : -0.42 - Math.max(0, -a) * 0.2);
        this.set(J.foreR, run ? -1.35 : -0.42 - Math.max(0, a) * 0.2);
        // The mascot waddle: hips roll over the standing leg, chest twists against them.
        const twist = a * (run ? 0.16 : 0.1);
        const roll = b * (run ? 0.045 : 0.07);
        this.set(J.hips, run ? 0.06 : 0.015, -twist, roll);
        this.set(J.spine, 0, twist * 0.5, -roll * 0.5);
        this.set(J.chest, run ? 0.16 : 0.035, twist * 1.1, -roll * 0.6);
        this.set(J.head, run ? -0.12 : -0.025, -twist * 0.7, roll * 0.25);
        const bounce = Math.cos(ph * 2); // up twice per cycle, highest as the legs pass
        this.hip(b * (run ? 0.012 : 0.018), bounce * (run ? 0.045 : 0.022) - (run ? 0.03 : 0.012));
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
      case "sit_drive":
      case "sit_bus": {
        const bus = this.pose === "sit_bus";
        this.set(J.thighL, -1.45, -0.05);
        this.set(J.thighR, -1.45, 0.05);
        this.set(J.shinL, 1.35);
        this.set(J.shinR, 1.35);
        this.set(J.footL, 0.1);
        this.set(J.footR, 0.1);
        const st = this.steer * 0.3;
        this.set(J.armL, -1.0 + st, 0.2, -hang * 0.62);
        this.set(J.armR, -1.0 - st, -0.2, hang * 0.62);
        this.set(J.foreL, -0.75);
        this.set(J.foreR, -0.75);
        this.set(J.chest, bus ? 0.02 : -0.03);
        this.set(J.head, 0, this.steer * 0.25);
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
        const st = this.steer * 0.35;
        if (moto) this.set(J.hips, 0.14);
        this.set(J.chest, moto ? 0.25 : 0.18);
        this.set(J.head, -0.15, this.steer * 0.3);
        this.set(J.armL, -1.1 + st, 0.15, -hang * 0.55);
        this.set(J.armR, -1.1 - st, -0.15, hang * 0.55);
        this.set(J.foreL, -0.45);
        this.set(J.foreR, -0.45);
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
        const g = Math.sin(t * w);
        this.set(J.armR, -0.2, 0, hang + 1.7);
        this.set(J.foreR, 0, 0, 0.5 + g * 0.4);
        this.set(J.head, 0, 0.1);
        this.hip(0, 0.006 * g);
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
