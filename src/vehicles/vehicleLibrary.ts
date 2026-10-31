import { AbstractMesh, AssetContainer, Color3, InstancedMesh, Matrix, Mesh, PBRMaterial, Quaternion, Scene, Texture, Vector3, VertexData, MeshBuilder, StandardMaterial } from "@babylonjs/core";
import { outfitsOf, setSeatRig } from "../characters/character";
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

const MAX_PER_ARCHETYPE = 240;
// The bus's seat rows along its length, a body's width in front of each seat back, and hip height on the cushion.
const BUS_ROWS = [3.1, 2.35, 1.65, 0.85, 0.15, -0.6, -1.35, -2.05, -2.85, -3.55];
const BUS_SEAT_Y = 1.28;
const DOOR_STEP_Y = 0.42;
const MAX_ON_DOOR = 2;
const FAR_MODEL = 30; // beyond this a vehicle is drawn with its light model, as one mesh
const RIDER_VIEW = 62; // people in seats are only drawn within this distance

type PartKind = "wheel" | "frontWheel" | "steer" | "steerWheel" | "crank" | "door" | "glass";

interface Part {
  kind: PartKind;
  mesh: Mesh;
  data: Float32Array;
  count: number;
  /** Where the part's own origin sits on the vehicle. */
  pivot: Vector3;
  /** For doors: which one it belongs to, and which way it turns. */
  doorIndex: number;
  doorSign: number;
  /** Painted to match this paint job only, or -1 for any. */
  paint: number;
}

/** Which slot each door uses on a vehicle. `door_P2` is the second leaf of the bus's door. */
export const DOOR_INDEX: Record<string, number> = { door_D: 0, door_DL: 1, door_P: 2, door_P2: 2, door_PL: 3 };

/** One door that opens, in vehicle space. */
export interface DoorInfo {
  index: number;
  /** The hinge. */
  pivot: Vector3;
  /** Which way a positive angle turns it, so that it swings the right way. */
  sign: number;
  /** The handle when shut, relative to the hinge. */
  handle: Vector3;
  /** Which way the panel runs from its hinge along the body: +1 forwards, -1 backwards. */
  extent: number;
  /** Folds into the vehicle rather than swinging out, as a bus door does. */
  inward: boolean;
  /** How far it opens. */
  swing: number;
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
  /** The doors that open, by slot. */
  readonly doors: (DoorInfo | null)[] = [null, null, null, null];

  constructor(readonly id: VehicleId) {}

  /** The door to use for the driver's seat. Two-sided vehicles use whichever is nearer `sideX`. */
  driverDoor(sideX: number): DoorInfo | null {
    const right = this.doors[0], left = this.doors[1];
    if (right && left) return sideX >= 0 ? right : left;
    return right ?? left ?? this.doors[2];
  }

  /** The door to use for a passenger seat: on the seat's own side where there's a choice. */
  passengerDoor(seatX: number): DoorInfo | null {
    const right = this.doors[2], left = this.doors[3];
    if (right && left) return seatX >= 0 ? right : left;
    return right ?? left;
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
      const w = worldOf(`seat_p${i}`) ?? worldOf(`seat_p${i}.001`);
      if (!w) break;
      // Rear-facing benches have the marker turned round.
      arch.passengerSeats.push({ position: w.getTranslation(), yaw: w.m[10] < 0 ? Math.PI : 0 });
    }
    if (id === "bus_city" && arch.passengerSeats.length) {
      // The model marks a few seats; fill the rows so a full bus looks full. One to a side, because these
      // heads are wide, each with their back against the seat back of their own row and hips on the cushion.
      arch.passengerSeats = [];
      for (const z of BUS_ROWS) {
        for (const x of [-0.7, 0.7]) arch.passengerSeats.push({ position: new Vector3(x, BUS_SEAT_Y, z), yaw: 0 });
      }
    }
    arch.frontLights = ["light_FL", "light_FR"].map(posOf).filter((p): p is Vector3 => !!p);
    arch.rearLights = ["light_RL", "light_RR"].map(posOf).filter((p): p is Vector3 => !!p);
    arch.plateFront = id === "bicycle" || id === "rickshaw" ? null : posOf("plate_F");
    arch.plateRear = id === "bicycle" ? null : posOf("plate_R");
    arch.routeFront = posOf("route_F");

    // Tell the seated pose where this vehicle's controls are, relative to the hips on the seat.
    if (spec.controls.seatShift) arch.driverSeat.addInPlaceFromFloats(...spec.controls.seatShift);
    const seat = arch.driverSeat;
    const rel = (p: Vector3): [number, number, number] => [p.x - seat.x, p.y - seat.y, p.z - seat.z];
    const gripL = posOf("grip_L"), gripR = posOf("grip_R");
    const ctl = spec.controls;
    const feet = ctl.floorDrop > 0
      ? { footL: [-0.15, -ctl.floorDrop, ctl.footForward] as const, footR: [0.15, -ctl.floorDrop, ctl.footForward] as const }
      : {};
    if (gripL && gripR) {
      setSeatRig(spec.seatPose, { handL: rel(gripL), handR: rel(gripR), ...feet, lean: ctl.lean });
    } else if (ctl.wheel) {
      // Ten and two on the rim; the rim's "up" leans back towards the driver.
      const [wx, wy, wz, r, tilt] = ctl.wheel;
      const t = (tilt * Math.PI) / 180;
      const upY = Math.sin(Math.PI / 2 - t), upZ = -Math.cos(Math.PI / 2 - t);
      const hand = (side: number): [number, number, number] => rel(new Vector3(wx + side * r * 0.86, wy + upY * r * 0.5, wz + upZ * r * 0.5 - 0.03));
      setSeatRig(spec.seatPose, { handL: hand(-1), handR: hand(1), ...feet, lean: ctl.lean });
    }

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
    // The leaf or panel is seen before or after its glass, so whichever comes first sets the turn.
    const doorGeometry = new Map<string, { sign: number }>();
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
      const doorName = name.replace("_glass", "");
      if (name === "glass") kind = "glass";
      else if (DOOR_INDEX[doorName] !== undefined) kind = "door";
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
      let doorIndex = 0, doorSign = 0;
      if (kind === "door") {
        doorIndex = DOOR_INDEX[doorName];
        doorSign = doorGeometry.get(doorName)?.sign ?? this.addDoor(arch, doorName, mesh, pivot, doorGeometry);
      }
      arch.parts.push({ kind, mesh, data: this.makeInstanced(mesh), count: 0, pivot, doorIndex, doorSign, paint: -1 });
    }
    this.paintDoors(arch);
    arch.frontAxleZ = wheelZ.length ? Math.max(...wheelZ) : spec.length * 0.3;
    arch.rearAxleZ = wheelZ.length ? Math.min(...wheelZ) : -spec.length * 0.3;
    root.setEnabled(false);
    return arch;
  }

  /** A door is cut from the body, so it has to wear the same paint: one copy for each paint job. Each
   *  needs its own geometry, because thin instances live on the geometry. Only those in use are drawn. */
  private paintDoors(arch: Archetype): void {
    if (arch.bodies.length < 2) return;
    for (const part of [...arch.parts]) {
      if (part.kind !== "door" || part.mesh.material?.name.startsWith("glass")) continue;
      part.paint = 0;
      arch.bodies.forEach((body, i) => {
        if (i === 0) return;
        const mesh = part.mesh.clone(`${part.mesh.name}_${body.name}`, null, true) as Mesh;
        mesh.makeGeometryUnique();
        mesh.material = body.mesh.material;
        arch.parts.push({ ...part, mesh, data: this.makeInstanced(mesh), count: 0, paint: i });
      });
    }
  }

  /** Works out how a door moves from where its hinge is and which way the panel runs from it. */
  private addDoor(arch: Archetype, name: string, mesh: Mesh, pivot: Vector3, seen: Map<string, { sign: number }>): number {
    const spec = VEHICLES[arch.id];
    const box = mesh.getBoundingInfo().boundingBox;
    const extent = box.maximum.z + box.minimum.z > 0 ? 1 : -1;
    const inward = arch.id === "bus_city";
    const out = Math.sign(pivot.x) * (inward ? -1 : 1);
    // A turn of +a takes a point at +Z towards +X, so this makes the free edge travel `out`.
    const sign = out * extent;
    seen.set(name, { sign });
    const index = DOOR_INDEX[name];
    if (!arch.doors[index]) {
      const far = extent > 0 ? box.maximum.z : box.minimum.z;
      const handle = new Vector3(0, spec.handleY - pivot.y, far - extent * 0.07);
      arch.doors[index] = { index, pivot: pivot.clone(), sign, handle, extent, inward, swing: spec.doorSwing };
    }
    return sign;
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
    Quaternion.RotationYawPitchRollToRef(v.heading, v.pitch + v.slope, v.roll + v.fallRoll, this.q);
    this.pos.set(v.x, v.y + v.bump * 0.08 + v.fallLift, v.z);
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
  private flashRed: Mesh | null = null;
  private flashBlue: Mesh | null = null;
  private flashClock = 0;

  /** The roof lamps of anything with somewhere urgent to be: two bright dots, turn about. */
  private drawFlashers(vehicles: Iterable<Vehicle>): void {
    if (!this.flashRed) {
      const make = (name: string, r: number, g: number, b: number): Mesh => {
        const m = MeshBuilder.CreateBox(name, { size: 0.3 }, this.scene);
        const mat = new StandardMaterial(name, this.scene);
        mat.disableLighting = true;
        mat.emissiveColor = new Color3(r, g, b);
        m.material = mat;
        m.isPickable = false;
        m.thinInstanceSetBuffer("matrix", new Float32Array(16 * 16), 16, false);
        m.thinInstanceCount = 0;
        m.alwaysSelectAsActiveMesh = true;
        return m;
      };
      this.flashRed = make("flashRed", 5, 0.25, 0.25);
      this.flashBlue = make("flashBlue", 0.3, 0.5, 6);
    }
    this.flashClock += 1 / 60;
    const on = Math.floor(this.flashClock * 5) % 2 === 0;
    let nr = 0, nb = 0;
    const put = (mesh: Mesh, i: number, v: Vehicle, side: number, blink: boolean): void => {
      const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
      const wide = v.spec.width * 0.24 * side;
      const scale = blink ? 1 : 0.0001;
      const m = Matrix.Compose(new Vector3(scale, scale, scale), Quaternion.Identity(), new Vector3(v.x + ch * wide, v.y + v.spec.height + 0.14, v.z - sh * wide));
      mesh.thinInstanceSetMatrixAt(i, m, false);
    };
    for (const v of vehicles) {
      if (!v.flashing || nr >= 16) continue;
      put(this.flashRed!, nr++, v, 1, on);
      put(this.flashBlue!, nb++, v, -1, !on);
    }
    for (const [mesh, n] of [[this.flashRed!, nr], [this.flashBlue!, nb]] as [Mesh, number][]) {
      mesh.thinInstanceCount = n;
      if (n) mesh.thinInstanceBufferUpdated("matrix");
      mesh.setEnabled(n > 0);
    }
  }

  render(vehicles: Iterable<Vehicle>, crowd: Crowd, camX: number, camZ: number, dirX: number, dirZ: number): void {
    this.drawFlashers(vehicles);
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
        if (body && !v.ownBody) this.place(body, M);
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
      if (part.paint >= 0 && part.paint !== v.variant) continue;
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
          Matrix.RotationYToRef(part.doorSign * v.doorAngle[part.doorIndex], a);
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
      // Pedalling is steered by position in the loop, not by speed: changing a baked clip's speed
      // while it plays makes the legs jump.
      const pedals = v.spec.seatPose === "pedal_rickshaw" || v.spec.seatPose === "ride_bicycle";
      crowd.addSeated(v.driverId, b, v.spec.seatPose, dist, pedals ? 0 : 1, pedals ? v.pedalPhase : 0, v.plateIndex % outfitsOf(v.driverId));
    }
    for (const rider of v.passengers) {
      const seat = arch.passengerSeats[rider.seat];
      if (!seat || rider.hidden) continue;
      const hip = crowd.hipHeightOf(rider.id);
      Matrix.RotationYToRef(seat.yaw, a);
      Matrix.TranslationToRef(seat.position.x, seat.position.y - hip, seat.position.z, b);
      a.multiplyToRef(b, c);
      c.multiplyToRef(M, a);
      crowd.addSeated(rider.id, a, "passenger", dist, 1, rider.seat * 0.17, (v.plateIndex + rider.seat) % outfitsOf(rider.id));
    }
    if (v.hangers.length) {
      const door = arch.passengerDoor(1);
      if (door) {
        const side = door.pivot.x >= 0 ? 1 : -1;
        v.hangers.forEach((id, i) => {
          // In the doorway with their feet on the steps, the first on the bottom one and the next up behind,
          // turned to look out along the road. The doorway only has room for two.
          if (i >= MAX_ON_DOOR) return;
          Matrix.RotationYToRef(side * (i === 0 ? 1.05 : 0.7), a);
          Matrix.TranslationToRef(door.pivot.x - side * (0.14 + i * 0.26), DOOR_STEP_Y + i * 0.2, door.pivot.z + door.extent * (0.32 + i * 0.4), b);
          a.multiplyToRef(b, c);
          c.multiplyToRef(M, a);
          crowd.addSeated(id, a, "hang", dist, 1, i * 0.3, (v.plateIndex + i) % outfitsOf(id));
        });
      }
    }
  }

  private commit(p: { mesh: Mesh; count: number }): void {
    const on = p.count > 0;
    if (p.mesh.isEnabled() !== on) p.mesh.setEnabled(on);
    p.mesh.thinInstanceCount = p.count;
    if (on) p.mesh.thinInstanceBufferUpdated("matrix");
  }
}
