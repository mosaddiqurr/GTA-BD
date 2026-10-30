import { AbstractMesh, BakedVertexAnimationManager, Material, Matrix, Mesh, PBRMaterial, Scene, VertexAnimationBaker } from "@babylonjs/core";
import { CHARACTER_IDS, Character, CharacterId, POSE_PERIOD, Pose, characterAvailable, characterContainer } from "./character";

/** Baked frames per clip. Every clip needs at least two: a single frame divides by zero in the engine's shader. */
const CLIP_FRAMES: Partial<Record<Pose, number>> = {
  walk: 32, run: 24, stand: 48, idle_look: 64, talk: 60, sit_bench: 48, tea: 48, police: 64, wave: 16, dodge: 2, shrug: 16,
  sit_drive: 2, sit_bus: 2, passenger: 40, pedal_rickshaw: 24, ride_bicycle: 24, ride_motorbike: 2,
};

const MAX_INSTANCES = 160;
const NEAR_LOD = 22; // full model inside this distance, the light one beyond it

interface Clip {
  from: number;
  to: number;
  frames: number;
  /** Frames per second to play at when the pose runs at its natural speed. */
  rate: number;
}

interface LodSet {
  mesh: Mesh;
  matrices: Float32Array;
  settings: Float32Array;
  count: number;
}

interface CrowdType {
  id: CharacterId;
  clips: Map<Pose, Clip>;
  manager: BakedVertexAnimationManager;
  lods: LodSet[];
  hipHeight: number;
}

/** Draws everyone who isn't right next to the camera in a handful of draw calls: each fruit type
 *  is one mesh with thin instances, animated by bone matrices baked into a texture. That is what
 *  allows a real crowd at a steady frame rate. */
export class Crowd {
  private types = new Map<CharacterId, CrowdType>();
  private time = 0;
  private tmp = Matrix.Identity();
  /** Mirror applied by the file's coordinate conversion: Babylon +X is glTF -X. */
  private mirror = Matrix.Scaling(-1, 1, 1);
  private mirrored = Matrix.Identity();

  constructor(private scene: Scene, private shadow: (m: AbstractMesh) => void) {}

  /** Bakes every character's clips. Takes a moment, so it happens during the loading screen. */
  build(): void {
    for (const id of CHARACTER_IDS) {
      if (id === "hero_mango" || !characterAvailable(id)) continue;
      this.types.set(id, this.buildType(id));
    }
  }

  private buildType(id: CharacterId): CrowdType {
    const rig = new Character(id, this.scene);
    const { mesh, skeleton } = rig.skinned;
    const boneCount = skeleton.bones.length;
    const clips = new Map<Pose, Clip>();
    const poses = Object.keys(CLIP_FRAMES) as Pose[];
    const totalFrames = poses.reduce((n, p) => n + (CLIP_FRAMES[p] ?? 0), 0);
    const floatsPerFrame = (boneCount + 1) * 16;
    const data = new Float32Array(floatsPerFrame * totalFrames);
    let at = 0;
    for (const pose of poses) {
      const frames = CLIP_FRAMES[pose]!;
      clips.set(pose, { from: at, to: at + frames - 1, frames, rate: frames / POSE_PERIOD[pose] });
      for (let f = 0; f < frames; f++) {
        rig.sample(pose, f / frames);
        skeleton.prepare(true);
        data.set(skeleton.getTransformMatrices(mesh), at * floatsPerFrame);
        at++;
      }
    }
    const baker = new VertexAnimationBaker(this.scene, mesh);
    const texture = baker.textureFromBakedVertexData(data);
    const manager = new BakedVertexAnimationManager(this.scene);
    manager.texture = texture;
    const hipHeight = rig.hipHeight;
    const material = mesh.material as PBRMaterial;
    const lods: LodSet[] = [];
    for (const lod of [0, 1] as const) {
      const container = characterContainer(id, lod);
      if (!container) continue;
      const entries = container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
      const root = entries.rootNodes[0];
      const skinned = root.getChildMeshes().find((m) => m.getTotalVertices() > 0) as Mesh;
      skinned.setParent(null);
      skinned.position.setAll(0);
      skinned.rotationQuaternion = null;
      skinned.rotation.setAll(0);
      skinned.scaling.setAll(1);
      skinned.isPickable = false;
      skinned.receiveShadows = lod === 0;
      skinned.material = material;
      skinned.bakedVertexAnimationManager = manager;
      skinned.alwaysSelectAsActiveMesh = true;
      // The mirror in each instance matrix reverses triangle winding, so tell the renderer.
      skinned.sideOrientation = Material.ClockWiseSideOrientation;
      const matrices = new Float32Array(MAX_INSTANCES * 16);
      const settings = new Float32Array(MAX_INSTANCES * 4);
      skinned.thinInstanceSetBuffer("matrix", matrices, 16, false);
      skinned.thinInstanceRegisterAttribute("bakedVertexAnimationSettingsInstanced", 4);
      skinned.thinInstanceSetBuffer("bakedVertexAnimationSettingsInstanced", settings, 4, false);
      skinned.thinInstanceCount = 0;
      skinned.setEnabled(false);
      lods.push({ mesh: skinned, matrices, settings, count: 0 });
      if (lod === 0) this.shadow(skinned);
      root.setEnabled(false);
    }
    rig.dispose();
    return { id, clips, manager, lods, hipHeight };
  }

  hipHeightOf(id: CharacterId): number {
    return this.types.get(id)?.hipHeight ?? 0.5;
  }

  /** Length in seconds of one loop at normal speed, for syncing to a live character. */
  begin(dt: number): void {
    this.time += dt;
    for (const t of this.types.values()) {
      t.manager.time = this.time;
      for (const l of t.lods) l.count = 0;
    }
  }

  private write(id: CharacterId, pose: Pose, distance: number, rate: number, offset: number): { lod: LodSet; i: number } | null {
    const t = this.types.get(id);
    if (!t) return null;
    const clip = t.clips.get(pose) ?? t.clips.get("stand");
    if (!clip) return null;
    const lod = t.lods[distance < NEAR_LOD || t.lods.length === 1 ? 0 : 1];
    if (lod.count >= MAX_INSTANCES) return null;
    const i = lod.count++;
    const s = lod.settings;
    s[i * 4] = clip.from;
    s[i * 4 + 1] = clip.to;
    s[i * 4 + 2] = offset * clip.frames;
    s[i * 4 + 3] = clip.rate * rate;
    return { lod, i };
  }

  /** Someone standing or walking: position and heading only. `rate` scales the clip speed, and
   *  `offset` (0..1) spreads people through the cycle so a crowd doesn't march in step. */
  add(id: CharacterId, x: number, y: number, z: number, yaw: number, pose: Pose, distance: number, rate = 1, offset = 0): void {
    const w = this.write(id, pose, distance, rate, offset);
    if (!w) return;
    const m = w.lod.matrices;
    const b = w.i * 16;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    // Mirror, then yaw, then position, written out directly because this runs for every person.
    m[b] = -c; m[b + 1] = 0; m[b + 2] = s; m[b + 3] = 0;
    m[b + 4] = 0; m[b + 5] = 1; m[b + 6] = 0; m[b + 7] = 0;
    m[b + 8] = s; m[b + 9] = 0; m[b + 10] = c; m[b + 11] = 0;
    m[b + 12] = x; m[b + 13] = y; m[b + 14] = z; m[b + 15] = 1;
  }

  /** Someone sitting in a vehicle. `world` is the seat's full transform, so riders lean with a bike. */
  addSeated(id: CharacterId, world: Matrix, pose: Pose, distance: number, rate = 1, offset = 0): void {
    const w = this.write(id, pose, distance, rate, offset);
    if (!w) return;
    this.mirror.multiplyToRef(world, this.mirrored);
    this.mirrored.copyToArray(w.lod.matrices, w.i * 16);
  }

  end(): void {
    for (const t of this.types.values()) {
      for (const l of t.lods) {
        const on = l.count > 0;
        if (l.mesh.isEnabled() !== on) l.mesh.setEnabled(on);
        l.mesh.thinInstanceCount = l.count;
        if (on) {
          l.mesh.thinInstanceBufferUpdated("matrix");
          l.mesh.thinInstanceBufferUpdated("bakedVertexAnimationSettingsInstanced");
        }
      }
    }
  }

  get drawn(): number {
    let n = 0;
    for (const t of this.types.values()) for (const l of t.lods) n += l.count;
    return n;
  }
}
