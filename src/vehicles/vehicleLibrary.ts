import { AbstractMesh, AssetContainer, Color3, InstancedMesh, Matrix, Mesh, PBRMaterial, Quaternion, Scene, Texture, Vector3, VertexData } from "@babylonjs/core";
import type { Crowd } from "../characters/crowd";
import { Rng } from "../world/cityLayout";
import { loadContainer } from "../world/assets";
import { ROUTES, SignAtlas } from "../world/signs";
import { VEHICLES, VehicleId } from "./vehicleData";
import type { Vehicle } from "./vehicle";

export interface VehicleManifestEntry {
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  wheelRadius: number;
  seatPose: string;
  variants: string[];
}

const MAX_PER_ARCHETYPE = 64;
const FAR_MODEL = 46; // beyond this a vehicle is drawn with its light model, as one mesh
const RIDER_VIEW = 64; // people in seats are only drawn within this distance

type PartKind = "wheel" | "frontWheel" | "steer" | "steerWheel" | "crank" | "door" | "glass";

interface Part {
  kind: PartKind;
  mesh: Mesh;
  data: Float32Array;
  count: number;
  /** Where the part's own origin sits on the vehicle. */
  pivot: Vector3;
}

interface BodyVariant {
  name: string;
  mesh: Mesh;
  data: Float32Array;
  count: number;
}

export interface Seat {
  position: Vector3;
  yaw: number;
}

interface PlateMesh {
  mesh: Mesh;
  data: Float32Array;
  count: number;
}

/** Everything shared by all vehicles of one model. Each mesh is drawn once with thin instances,
 *  so forty vehicles on screen cost the same draw calls as one. */
export class Archetype {
  readonly bodies: BodyVariant[] = [];
  readonly parts: Part[] = [];
  /** The light model: one body per paint job, matching `bodies`, and a shared mesh of wheels. */
  readonly farBodies: BodyVariant[] = [];
  farWheels: PlateMesh | null = null;
  driverSeat = new Vector3();
  passengerSeats: Seat[] = [];
  exitLeft = new Vector3();
  exitRight = new Vector3();
  frontLights: Vector3[] = [];
  rearLights: Vector3[] = [];
  plateFront: Vector3 | null = null;
  plateRear: Vector3 | null = null;
  routeFront: Vector3 | null = null;
  steerPivot = new Vector3();
  steerAxis = Vector3.Up();
  rearAxleZ = 0;
  frontAxleZ = 0;
  wheelRadius = 0.3;

  constructor(readonly id: VehicleId) {}

  get hasDoor(): boolean {
    return this.parts.some((p) => p.kind === "door");
  }

  variantIndex(name: string): number {
    const i = this.bodies.findIndex((b) => b.name === name);
    return i < 0 ? 0 : i;
  }
}

/** Loads every vehicle model and draws the whole fleet each frame. */
export class VehicleFleet {
  private archetypes = new Map<VehicleId, Archetype>();
  private plates: PlateMesh[] = [];
  private greenPlates: PlateMesh[] = [];
  private routes: PlateMesh[] = [];
  manifest: Record<string, VehicleManifestEntry> = {};

  private m = Matrix.Identity();
  private a = Matrix.Identity();
  private b = Matrix.Identity();
  private c = Matrix.Identity();
  private d = Matrix.Identity();
  private q = new Quaternion();
  private unit = Vector3.One();
  private pos = new Vector3();

  constructor(private scene: Scene, private signs: SignAtlas, private shadow: (m: AbstractMesh) => void) {}

  async preload(onProgress?: (done: number, total: number) => void): Promise<void> {
    try {
      const res = await fetch("assets/vehicles/manifest.json");
      if (res.ok) this.manifest = await res.json();
    } catch {
      /* the spec table has fallback sizes */
    }
    const ids = Object.keys(VEHICLES) as VehicleId[];
    let done = 0;
    await Promise.all(
      ids.map(async (id) => {
        const c = await loadContainer(this.scene, `assets/vehicles/${id}.glb`);
        if (c) {
          const arch = this.buildArchetype(id, c);
          this.archetypes.set(id, arch);
          const far = await loadContainer(this.scene, `assets/vehicles/${id}_lod1.glb`);
          if (far) this.addFarModel(arch, far);
        }
        onProgress?.(++done, ids.length);
      }),
    );
    this.buildPlates();
  }

  available(id: VehicleId): boolean {
    return this.archetypes.has(id);
  }

  availableIds(): VehicleId[] {
    return (Object.keys(VEHICLES) as VehicleId[]).filter((id) => this.available(id));
  }

  archetype(id: VehicleId): Archetype {
    return this.archetypes.get(id)!;
  }

  variantsOf(id: VehicleId): string[] {
    return this.manifest[id]?.variants ?? ["default"];
  }

  private makeInstanced(mesh: Mesh): Float32Array {
    const data = new Float32Array(MAX_PER_ARCHETYPE * 16);
    mesh.thinInstanceSetBuffer("matrix", data, 16, false);
    mesh.thinInstanceCount = 0;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    mesh.setEnabled(false);
    return data;
  }

  private buildArchetype(id: VehicleId, c: AssetContainer): Archetype {
    c.addAllToScene();
    const arch = new Archetype(id);
    const spec = VEHICLES[id];
    const info = this.manifest[id];
    arch.wheelRadius = info?.wheelRadius ?? spec.wheelRadius;
    const root = c.rootNodes[0];
    root.computeWorldMatrix(true);
    const nodes = new Map(root.getDescendants(false).map((n) => [n.name, n as AbstractMesh]));
    const worldOf = (name: string): Matrix | null => {
      const n = nodes.get(name);
      if (!n) return null;
      n.computeWorldMatrix(true);
      return n.getWorldMatrix().clone();
    };
    const posOf = (name: string): Vector3 | null => worldOf(name)?.getTranslation() ?? null;

    arch.driverSeat = posOf("seat_driver") ?? new Vector3(0, spec.height * 0.45, 0);
    arch.exitLeft = posOf("exit_L") ?? new Vector3(-(spec.width / 2 + 0.5), 0, 0);
    arch.exitRight = posOf("exit_R") ?? new Vector3(spec.width / 2 + 0.5, 0, 0);
    for (let i = 1; i < 16; i++) {
      const w = worldOf(`seat_p${i}`);
      if (!w) break;
      // Rear-facing benches have the marker turned round.
      arch.passengerSeats.push({ position: w.getTranslation(), yaw: w.m[10] < 0 ? Math.PI : 0 });
    }
    if (id === "bus_city" && arch.passengerSeats.length) {
      // The model marks a few seats; fill the rows so a full bus looks full. Two a row: these heads are wide.
      const y = arch.passengerSeats[0].position.y;
      arch.passengerSeats = [];
      for (let z = 3.0; z > -3.8; z -= 0.86) {
        for (const x of [-0.7, 0.7]) arch.passengerSeats.push({ position: new Vector3(x, y, z), yaw: 0 });
      }
    }
    arch.frontLights = ["light_FL", "light_FR"].map(posOf).filter((p): p is Vector3 => !!p);
    arch.rearLights = ["light_RL", "light_RR"].map(posOf).filter((p): p is Vector3 => !!p);
    arch.plateFront = id === "bicycle" || id === "rickshaw" ? null : posOf("plate_F");
    arch.plateRear = id === "bicycle" ? null : posOf("plate_R");
    arch.routeFront = posOf("route_F");

    const axis = worldOf("steer");
    if (axis) {
      arch.steerPivot = axis.getTranslation();
      arch.steerAxis = Vector3.TransformNormal(Vector3.Up(), axis).normalize();
    }

    // Nodes sharing one mesh (usually wheels) arrive as engine instances. Each needs geometry of its
    // own here, taken before anything gets baked, because thin instances live on the geometry.
    const pieces: { mesh: Mesh; world: Matrix }[] = [];
    for (const mesh of [...c.meshes]) {
      if (mesh.getTotalVertices() === 0) continue;
      mesh.computeWorldMatrix(true);
      const world = mesh.getWorldMatrix().clone();
      if (mesh instanceof InstancedMesh) {
        const own = mesh.sourceMesh.clone(mesh.name, null, true) as Mesh;
        own.makeGeometryUnique();
        pieces.push({ mesh: own, world });
        mesh.dispose();
      } else if (mesh instanceof Mesh) pieces.push({ mesh, world });
    }

    const wheelZ: number[] = [];
    for (const { mesh, world } of pieces) {
      const name = mesh.name;
      const pivot = world.getTranslation();
      const isBaked = name === "body" || name === "glass";
      mesh.setParent(null);
      mesh.position.setAll(0);
      mesh.rotationQuaternion = null;
      mesh.rotation.setAll(0);
      mesh.scaling.setAll(1);
      mesh.computeWorldMatrix(true);
      // Static parts go straight into vehicle space; moving parts keep their pivot at the origin.
      const bake = world.clone();
      if (!isBaked) bake.setTranslationFromFloats(0, 0, 0);
      mesh.bakeTransformIntoVertices(bake);
      mesh.refreshBoundingInfo();
      if (name === "body") {
        this.addBodies(arch, mesh);
        continue;
      }
      let kind: PartKind | null = null;
      if (name === "glass") kind = "glass";
      else if (name === "door_D" || name === "door_D_glass") kind = "door";
      else if (name === "steer") kind = "steer";
      else if (name === "crank") kind = "crank";
      else if (name === "wheel_FL" || name === "wheel_FR") kind = "frontWheel";
      else if (name === "wheel_F") kind = "steerWheel";
      else if (name.startsWith("wheel_")) kind = "wheel";
      if (!kind) {
        mesh.dispose();
        continue;
      }
      if (name.startsWith("wheel_")) wheelZ.push(pivot.z);
      if (mesh.material?.name.startsWith("glass")) mesh.material.alpha = Math.min(mesh.material.alpha, 0.42);
      arch.parts.push({ kind, mesh, data: this.makeInstanced(mesh), count: 0, pivot });
    }
    arch.frontAxleZ = wheelZ.length ? Math.max(...wheelZ) : spec.length * 0.3;
    arch.rearAxleZ = wheelZ.length ? Math.min(...wheelZ) : -spec.length * 0.3;
    root.setEnabled(false);
    return arch;
  }

  private addFarModel(arch: Archetype, c: AssetContainer): void {
    c.addAllToScene();
    const root = c.rootNodes[0];
    root.computeWorldMatrix(true);
    for (const mesh of [...c.meshes]) {
      if (!(mesh instanceof Mesh) || mesh.getTotalVertices() === 0) continue;
      mesh.computeWorldMatrix(true);
      const world = mesh.getWorldMatrix().clone();
      mesh.setParent(null);
      mesh.position.setAll(0);
      mesh.rotationQuaternion = null;
      mesh.rotation.setAll(0);
      mesh.scaling.setAll(1);
      mesh.computeWorldMatrix(true);
      mesh.bakeTransformIntoVertices(world);
      mesh.refreshBoundingInfo();
      if (mesh.name === "wheels_lod") {
        mesh.material = this.tireMaterial();
        arch.farWheels = { mesh, data: this.makeInstanced(mesh), count: 0 };
        continue;
      }
      arch.bodies.forEach((near, i) => {
        let body = mesh;
        if (i > 0) {
          body = mesh.clone(`${mesh.name}_${near.name}`, null, true) as Mesh;
          body.makeGeometryUnique();
        }
        body.material = near.mesh.material;
        const data = this.makeInstanced(body);
        this.shadow(body);
        arch.farBodies.push({ name: near.name, mesh: body, data, count: 0 });
      });
    }
    root.setEnabled(false);
  }

  private tire: PBRMaterial | null = null;

  private tireMaterial(): PBRMaterial {
    if (!this.tire) {
      this.tire = new PBRMaterial("tireFar", this.scene);
      this.tire.albedoColor = new Color3(0.035, 0.035, 0.04);
      this.tire.metallic = 0;
      this.tire.roughness = 0.9;
    }
    return this.tire;
  }

  /** One thin-instanced body per paint job. A paint job needs its own geometry object because
   *  Babylon stores thin-instance data on the geometry, and a clone would overwrite the original. */
  private addBodies(arch: Archetype, base: Mesh): void {
    const names = this.variantsOf(arch.id);
    names.forEach((name, i) => {
      let mesh = base;
      if (i > 0) {
        mesh = base.clone(`${base.name}_${name}`, null, true) as Mesh;
        mesh.makeGeometryUnique();
        this.applyPaint(mesh, arch.id, name, base.material as PBRMaterial);
      }
      const data = this.makeInstanced(mesh);
      this.shadow(mesh);
      arch.bodies.push({ name, mesh, data, count: 0 });
    });
  }

  private applyPaint(mesh: Mesh, id: VehicleId, variant: string, base: PBRMaterial): void {
    const mat = base.clone(`${id}_${variant}`) as PBRMaterial;
    // Swap the paint in only once it has loaded: a failed texture would show the engine's checker.
    const tex: Texture = new Texture(
      `assets/vehicles/${id}__${variant}_albedo.webp`, this.scene, false, false, Texture.TRILINEAR_SAMPLINGMODE,
      () => {
        tex.anisotropicFilteringLevel = 8;
        mat.albedoTexture = tex;
      },
      () => console.warn(`[vehicles] no paint file for ${id} ${variant}, keeping the base colours`),
    );
    mesh.material = mat;
  }

  /** Bangla number plates and route boards: one small quad per design, drawn wherever needed. */
  private buildPlates(): void {
    const make = (uv: readonly [number, number, number, number], name: string): PlateMesh => {
      const mesh = new Mesh(name, this.scene);
      const vd = new VertexData();
      // A unit quad facing +Z, readable by a viewer looking at the front of a vehicle.
      vd.positions = [0.5, -0.5, 0, -0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0];
      vd.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
      vd.uvs = [uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]];
      vd.indices = [0, 1, 2, 0, 2, 3];
      vd.applyToMesh(mesh);
      mesh.material = this.signs.material;
      return { mesh, data: this.makeInstanced(mesh), count: 0 };
    };
    const r = new Rng(88);
    for (let i = 0; i < 4; i++) {
      this.plates.push(make(this.signs.plateOf(false, r), `plate${i}`));
      this.greenPlates.push(make(this.signs.plateOf(true, r), `plateG${i}`));
    }
    ROUTES.forEach((_, i) => this.routes.push(make(this.signs.route(i), `route${i}`)));
  }

  private place(p: { data: Float32Array; count: number }, m: Matrix): void {
    if (p.count >= MAX_PER_ARCHETYPE) return;
    m.copyToArray(p.data, p.count * 16);
    p.count++;
  }

  private placeQuad(list: PlateMesh[], index: number, at: Vector3, w: number, h: number, rear: boolean, vehicle: Matrix): void {
    const p = list[index % list.length];
    // Scale to size, flip for the rear, then sit it on the vehicle just proud of the body.
    Matrix.ScalingToRef(w, h, 1, this.a);
    if (rear) {
      Matrix.RotationYToRef(Math.PI, this.b);
      this.a.multiplyToRef(this.b, this.c);
      this.a.copyFrom(this.c);
    }
    Matrix.TranslationToRef(at.x, at.y, at.z + (rear ? -0.012 : 0.012), this.b);
    this.a.multiplyToRef(this.b, this.c);
    this.c.multiplyToRef(vehicle, this.a);
    this.place(p, this.a);
  }

  private vehicleMatrix(v: Vehicle, out: Matrix): void {
    Quaternion.RotationYawPitchRollToRef(v.heading, v.pitch, v.roll, this.q);
    this.pos.set(v.x, v.y + v.bump * 0.08, v.z);
    Matrix.ComposeToRef(this.unit, this.q, this.pos, out);
  }

  /** Full transform of a point on a vehicle, for placing the hero in a seat. */
  seatMatrix(v: Vehicle, x: number, y: number, z: number, yaw: number, out: Matrix): void {
    this.vehicleMatrix(v, this.d);
    Matrix.RotationYToRef(yaw, this.a);
    Matrix.TranslationToRef(x, y, z, this.b);
    this.a.multiplyToRef(this.b, this.c);
    this.c.multiplyToRef(this.d, out);
  }

  /** Writes every vehicle (and everyone sitting in one) into the instance buffers. */
  render(vehicles: Iterable<Vehicle>, crowd: Crowd, camX: number, camZ: number, dirX: number, dirZ: number): void {
    for (const arch of this.archetypes.values()) {
      for (const b of arch.bodies) b.count = 0;
      for (const p of arch.parts) p.count = 0;
      for (const b of arch.farBodies) b.count = 0;
      if (arch.farWheels) arch.farWheels.count = 0;
    }
    for (const p of this.plates) p.count = 0;
    for (const p of this.greenPlates) p.count = 0;
    for (const p of this.routes) p.count = 0;

    const M = this.m;
    for (const v of vehicles) {
      const dx = v.x - camX, dz = v.z - camZ;
      const dist = Math.hypot(dx, dz);
      // Skip what's behind the camera, with margin for long vehicles and quick turns.
      if (dist > 22 && dx * dirX + dz * dirZ < -14) continue;
      const arch = v.arch;
      this.vehicleMatrix(v, M);
      if (dist < FAR_MODEL || v.mode === "player" || !arch.farBodies.length) {
        const body = arch.bodies[v.variant] ?? arch.bodies[0];
        if (body) this.place(body, M);
        this.renderParts(arch, v, M);
      } else {
        const body = arch.farBodies[v.variant] ?? arch.farBodies[0];
        this.place(body, M);
        if (arch.farWheels) this.place(arch.farWheels, M);
      }
      if (dist < RIDER_VIEW) this.renderRiders(arch, v, M, crowd, dist);
    }
    for (const arch of this.archetypes.values()) {
      for (const b of arch.bodies) this.commit(b);
      for (const p of arch.parts) this.commit(p);
      for (const b of arch.farBodies) this.commit(b);
      if (arch.farWheels) this.commit(arch.farWheels);
    }
    for (const p of this.plates) this.commit(p);
    for (const p of this.greenPlates) this.commit(p);
    for (const p of this.routes) this.commit(p);
  }

  private renderParts(arch: Archetype, v: Vehicle, M: Matrix): void {
    const { a, b, c, d } = this;
    const steer = v.steerAngle * VEHICLES[v.id].maxSteer;
    const spin = v.wheelSpin;
    for (const part of arch.parts) {
      switch (part.kind) {
        case "glass":
          this.place(part, M);
          break;
        case "wheel":
          Matrix.RotationXToRef(spin, a);
          Matrix.TranslationToRef(part.pivot.x, part.pivot.y, part.pivot.z, b);
          a.multiplyToRef(b, c);
          c.multiplyToRef(M, a);
          this.place(part, a);
          break;
        case "frontWheel":
          Matrix.RotationXToRef(spin, a);
          Matrix.RotationYToRef(steer, b);
          a.multiplyToRef(b, c);
          Matrix.TranslationToRef(part.pivot.x, part.pivot.y, part.pivot.z, b);
          c.multiplyToRef(b, a);
          a.multiplyToRef(M, c);
          this.place(part, c);
          break;
        case "steer":
          this.steerMatrix(arch, steer, a);
          a.multiplyToRef(M, c);
          this.place(part, c);
          break;
        case "steerWheel":
          // Spins on its own axle, then swings with the fork about the raked steering axis.
          Matrix.RotationXToRef(spin, a);
          Matrix.TranslationToRef(part.pivot.x - arch.steerPivot.x, part.pivot.y - arch.steerPivot.y, part.pivot.z - arch.steerPivot.z, b);
          a.multiplyToRef(b, c);
          this.steerMatrix(arch, steer, d);
          c.multiplyToRef(d, b);
          b.multiplyToRef(M, c);
          this.place(part, c);
          break;
        case "crank":
          Matrix.RotationXToRef(spin * 0.42, a);
          Matrix.TranslationToRef(part.pivot.x, part.pivot.y, part.pivot.z, b);
          a.multiplyToRef(b, c);
          c.multiplyToRef(M, a);
          this.place(part, a);
          break;
        case "door":
          // The driver's door is on the vehicle's right; a negative turn swings its back edge outwards.
          Matrix.RotationYToRef(-v.doorAngle, a);
          Matrix.TranslationToRef(part.pivot.x, part.pivot.y, part.pivot.z, b);
          a.multiplyToRef(b, c);
          c.multiplyToRef(M, a);
          this.place(part, a);
          break;
      }
    }
    const spec = v.spec;
    if (arch.plateFront) this.placeQuad(spec.green ? this.greenPlates : this.plates, v.plateIndex, arch.plateFront, 0.34, 0.17, false, M);
    if (arch.plateRear) this.placeQuad(spec.green ? this.greenPlates : this.plates, v.plateIndex, arch.plateRear, 0.34, 0.17, true, M);
    if (arch.routeFront) this.placeQuad(this.routes, v.plateIndex, arch.routeFront, 1.25, 0.26, false, M);
  }

  private steerMatrix(arch: Archetype, steer: number, out: Matrix): void {
    Matrix.RotationAxisToRef(arch.steerAxis, steer, this.a);
    Matrix.TranslationToRef(arch.steerPivot.x, arch.steerPivot.y, arch.steerPivot.z, this.b);
    this.a.multiplyToRef(this.b, out);
  }

  private renderRiders(arch: Archetype, v: Vehicle, M: Matrix, crowd: Crowd, dist: number): void {
    const { a, b, c } = this;
    if (v.driverId) {
      const hip = crowd.hipHeightOf(v.driverId);
      const s = arch.driverSeat;
      Matrix.TranslationToRef(s.x, s.y - hip, s.z, a);
      a.multiplyToRef(M, b);
      const pedals = v.spec.seatPose === "pedal_rickshaw" || v.spec.seatPose === "ride_bicycle";
      crowd.addSeated(v.driverId, b, v.spec.seatPose, dist, pedals ? Math.min(Math.abs(v.speed) / 2.6, 2) : 1);
    }
    for (const rider of v.passengers) {
      const seat = arch.passengerSeats[rider.seat];
      if (!seat || rider.hidden) continue;
      const hip = crowd.hipHeightOf(rider.id);
      Matrix.RotationYToRef(seat.yaw, a);
      Matrix.TranslationToRef(seat.position.x, seat.position.y - hip, seat.position.z, b);
      a.multiplyToRef(b, c);
      c.multiplyToRef(M, a);
      crowd.addSeated(rider.id, a, "passenger", dist, 1, rider.seat * 0.17);
    }
  }

  private commit(p: { mesh: Mesh; count: number }): void {
    const on = p.count > 0;
    if (p.mesh.isEnabled() !== on) p.mesh.setEnabled(on);
    p.mesh.thinInstanceCount = p.count;
    if (on) p.mesh.thinInstanceBufferUpdated("matrix");
  }
}
