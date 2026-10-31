import { Color3, Constants, DynamicTexture, Mesh, MeshBuilder, Scene, StandardMaterial } from "@babylonjs/core";
import type { City } from "../world/city";
import { KERB_H, Rng } from "../world/cityLayout";
import { flyoverHeight } from "../world/flyover";
import { HIT, obbVsBox, obbVsCircle, obbVsObb } from "../physics/shapes";
import { CharacterId, DRIVER_IDS, PASSENGER_IDS, characterAvailable } from "../characters/character";
import { ALSO_ON_THE_ROAD, ROAD_PACE, TRAFFIC_MIX, VEHICLES, VEHICLE_MASS, VehicleId } from "../vehicles/vehicleData";
import { Vehicle } from "../vehicles/vehicle";
import { VehicleFleet } from "../vehicles/vehicleLibrary";
import { Connector, Lane, Path, pointOn } from "./laneGraph";
import { LightState, SignalController } from "./signals";

const P = { x: 0, z: 0, dx: 0, dz: 0 };
const Q = { x: 0, z: 0, dx: 0, dz: 0 };
const SPAWN_MIN = 44;
const SPAWN_MAX = 150;
const DESPAWN = 178;
const PROBE_STEP = 2.4;
const DWELL_SECONDS = 7;
const LANE_WIDTH = 3.3;
/** Vehicles further than this from the player look ahead less often. */
const NEAR_SCAN = 48;
const APART_RANGE = 120;
const APART_CELL = 14;
const APART_NEXT: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [1, 1], [1, -1]];

/** One colour of signal lamp: the lens, and the halo around it. */
interface LampSet {
  lens: Mesh;
  glow: Mesh;
}

/** Bus stop served by one kerb lane. */
interface LaneStop {
  stopIndex: number;
  s: number;
}

/** Everything moving on the roads that isn't the player. */
export class TrafficSystem {
  readonly vehicles: Vehicle[] = [];
  readonly parked: Vehicle[] = [];
  readonly signals = new Map<number, SignalController>();
  private occupancy = new Map<number, { axis: number; count: number }>();
  private rng = new Rng(1952);
  private lamps: { red: LampSet; amber: LampSet; green: LampSet } | null = null;
  private spawnTimer = 0;
  private mainLanes: Lane[] = [];
  private laneStops = new Map<Lane, LaneStop[]>();
  private neighbours = new Map<Lane, Lane[]>();
  private target = 20;
  private plateCounter = 0;
  private visible: Vehicle[] = [];
  private scanBest = Infinity;
  private scanSpeed = 0;
  private scanSteps = 0;
  private scanHalf = 0;
  private probes = new Float64Array(160);
  /** The vehicle the scan is currently checking, and the one it found in the way. */
  private scanning: Vehicle | null = null;
  private scanLead: Vehicle | null = null;
  private hornWait = 0;
  /** Vehicles within reach of the player this frame, parked ones and the player's own included. */
  private close: Vehicle[] = [];
  /** Which way the camera is looking, so new vehicles don't appear right in the view. */
  viewX = 0;
  viewZ = 1;
  onHorn: ((v: Vehicle) => void) | null = null;
  /** Someone has been held up by the player long enough to say so. */
  onBlocked: ((v: Vehicle) => void) | null = null;
  /** A vehicle sent for has reached the player. */
  onCalledArrived: ((v: Vehicle) => void) | null = null;
  private scanForPlayer = false;
  private scanHitPlayer = false;
  /** A vehicle sent somewhere has arrived. */
  onTripDone: ((v: Vehicle) => void) | null = null;
  onPoliceArrived: ((v: Vehicle) => void) | null = null;
  /** One's near. Called every frame it's so. */
  onSiren: ((v: Vehicle) => void) | null = null;
  private lanesInto: Map<Lane, Connector[]> | null = null;
  /** The vehicle pulled up for the player, waiting for them to get in. */
  waiting: Vehicle | null = null;
  /** What the player's vehicle last ran into, and where. */
  lastHit: Vehicle | null = null;
  lastHitX = 0;
  lastHitZ = 0;
  /** The moving vehicle that last pushed someone on foot. */
  lastPush: Vehicle | null = null;
  /** A bus has pulled in at this stop: the people waiting there can board. */
  onBusDwell: ((stopIndex: number, v: Vehicle) => void) | null = null;
  playerVehicle: Vehicle | null = null;
  playerX = 0;
  playerY = 0;
  playerZ = 0;
  playerSpeed = 0;
  playerRadius = 0.5;
  /** People crossing the road; drivers stop for them. */
  pedestrianBlockers: { x: number; z: number }[] = [];

  constructor(private scene: Scene, private city: City, private fleet: VehicleFleet) {
    let offset = 0;
    for (const j of city.layout.junctions) {
      if (!j.signal) continue;
      const ctrl = new SignalController(j, offset);
      ctrl.onChange = () => this.refreshLamps();
      this.signals.set(j.id, ctrl);
      offset += 6.3;
    }
    this.mainLanes = city.graph.lanes.filter((l) => l.road.cls === "main");
    this.indexLanes();
    this.buildLamps();
    this.refreshLamps();
  }

  setTarget(n: number): void {
    this.target = n;
  }

  /** Neighbouring lanes for overtaking, and which bus stops each kerb lane passes. */
  private indexLanes(): void {
    const groups = new Map<string, Lane[]>();
    for (const l of this.city.graph.lanes) {
      const key = `${l.road.nameBn}|${l.from.id}|${l.to.id}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = []));
      g.push(l);
    }
    for (const g of groups.values()) {
      // No changing lanes on or off the flyover: there's a wall in the way.
      for (const l of g) this.neighbours.set(l, l.raised ? [] : g.filter((o) => !o.raised && Math.abs(o.index - l.index) === 1));
    }
    this.city.busStops.forEach((stop, stopIndex) => {
      for (const lane of this.city.graph.lanes) {
        if (lane.index !== lane.laneCount - 1) continue;
        const ax = lane.pts[0], az = lane.pts[1];
        const dx = lane.pts[2] - ax, dz = lane.pts[3] - az;
        const len = lane.length;
        const along = ((stop.x - ax) * dx + (stop.z - az) * dz) / len;
        if (along < 8 || along > len - 12) continue;
        const side = Math.abs((stop.x - ax) * dz - (stop.z - az) * dx) / len;
        if (side > 7) continue;
        let list = this.laneStops.get(lane);
        if (!list) this.laneStops.set(lane, (list = []));
        list.push({ stopIndex, s: along });
        list.sort((p, q) => p.s - q.s);
      }
    });
  }

  private buildLamps(): void {
    const glowTex = new DynamicTexture("lampGlow", 64, this.scene, false);
    const gc = glowTex.getContext();
    const grad = gc.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    gc.fillStyle = grad;
    gc.fillRect(0, 0, 64, 64);
    glowTex.update();
    glowTex.hasAlpha = true;
    const make = (name: string, c: Color3): LampSet => {
      const lens = MeshBuilder.CreateDisc(name, { radius: 1, tessellation: 16, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
      const mat = new StandardMaterial(`${name}Mat`, this.scene);
      mat.disableLighting = true;
      mat.emissiveColor = c;
      mat.fogEnabled = false;
      lens.material = mat;
      lens.isPickable = false;
      // A soft halo, so a signal can be read from right down the street.
      const glow = MeshBuilder.CreateDisc(`${name}Glow`, { radius: 1, tessellation: 16 }, this.scene);
      const gm = new StandardMaterial(`${name}GlowMat`, this.scene);
      gm.disableLighting = true;
      gm.emissiveColor = c.scale(0.45);
      gm.opacityTexture = glowTex;
      gm.alphaMode = Constants.ALPHA_ADD;
      gm.disableDepthWrite = true;
      gm.fogEnabled = false;
      gm.backFaceCulling = false;
      glow.material = gm;
      glow.isPickable = false;
      return { lens, glow };
    };
    this.lamps = {
      red: make("lampRed", new Color3(3.6, 0.2, 0.14)),
      amber: make("lampAmber", new Color3(3.4, 1.7, 0.12)),
      green: make("lampGreen", new Color3(0.18, 3.2, 0.85)),
    };
  }

  /** Rebuilds the lit lamps only when a light changes, so it costs almost nothing. */
  private refreshLamps(): void {
    if (!this.lamps) return;
    const lenses: Record<LightState, number[]> = { red: [], amber: [], green: [] };
    const glows: Record<LightState, number[]> = { red: [], amber: [], green: [] };
    const heads = this.headLayout();
    for (const head of this.city.signalHeads) {
      const ctrl = this.signals.get(head.junction.id);
      if (!ctrl) continue;
      const st = ctrl.stateFor(head.heading);
      const sa = Math.sin(head.angle), ca = Math.cos(head.angle);
      const lift = st === "red" ? 1 : st === "green" ? -1 : 0;
      for (const h of heads) {
        const y = h.y + lift * h.pitch;
        const fwd = h.z + 0.012;
        const wx = head.x + h.x * ca + fwd * sa;
        const wz = head.z - h.x * sa + fwd * ca;
        const put = (list: number[], s: number, nudge: number): void => {
          list.push(ca * s, 0, -sa * s, 0, 0, s, 0, 0, sa * s, 0, ca * s, 0, wx + sa * nudge, y + KERB_H, wz + ca * nudge, 1);
        };
        put(lenses[st], h.lens, 0);
        put(glows[st], h.lens * 3.4, 0.3);
      }
    }
    for (const st of ["red", "amber", "green"] as LightState[]) {
      const set = this.lamps[st];
      const write = (mesh: Mesh, list: number[]): void => {
        const data = new Float32Array(list);
        mesh.thinInstanceSetBuffer("matrix", data.length ? data : null, 16, false);
        mesh.setEnabled(data.length > 0);
        mesh.alwaysSelectAsActiveMesh = true;
      };
      write(set.lens, lenses[st]);
      write(set.glow, glows[st]);
    }
  }

  /** Where each signal head on the mast sits, read from the model's own markers. */
  private headLayout(): { x: number; y: number; z: number; pitch: number; lens: number }[] {
    const p = this.city.props;
    const out: { x: number; y: number; z: number; pitch: number; lens: number }[] = [];
    const low = p.anchor("traffic_mast", "head_low");
    if (low) out.push({ x: low.x, y: low.y, z: low.z, pitch: 0.285, lens: 0.1 });
    for (const name of ["head_mid", "head_end"]) {
      const a = p.anchor("traffic_mast", name);
      if (a) out.push({ x: a.x, y: a.y, z: a.z, pitch: 0.36, lens: 0.145 });
    }
    return out;
  }

  // ------------------------------------------------------------------ creating vehicles

  makeVehicle(id: VehicleId, r: Rng, variantName?: string): Vehicle | null {
    if (!this.fleet.available(id)) return null;
    const arch = this.fleet.archetype(id);
    const variant = variantName ? arch.variantIndex(variantName) : r.int(0, arch.bodies.length - 1);
    return new Vehicle(id, arch, variant, this.plateCounter++);
  }

  populateParked(): void {
    const r = new Rng(404);
    let count = 0;
    const spots = [...this.city.parked].sort((p, q) => Number(!!q.variant) - Number(!!p.variant));
    for (const spot of spots) {
      const options = spot.kinds.filter((k) => this.fleet.available(k as VehicleId)) as VehicleId[];
      if (!options.length) continue;
      const v = this.makeVehicle(r.pick(options), r, spot.variant);
      if (!v) continue;
      v.mode = "parked";
      const off = v.spec.width / 2 + 0.25;
      const px = spot.x + spot.nx * off, pz = spot.z + spot.nz * off;
      v.place(px, pz, spot.angle);
      v.y = this.city.layout.groundHeight(px, pz);
      this.parked.push(v);
      if (++count > 170) break;
    }
  }

  /** Puts a brand-new vehicle down for the player, from the vehicle chooser. */
  spawnParkedAt(id: VehicleId, variant: string, x: number, z: number, heading: number): Vehicle | null {
    const v = this.makeVehicle(id, this.rng, variant);
    if (!v) return null;
    v.mode = "parked";
    v.place(x, z, heading);
    v.y = this.city.layout.groundHeight(x, z);
    this.parked.push(v);
    return v;
  }

  private driverFor(id: VehicleId): CharacterId | null {
    const pick = id === "rickshaw" ? (["npc_rickshaw_watermelon"] as CharacterId[]) : id === "cng" ? (["npc_cng_guava"] as CharacterId[]) : DRIVER_IDS;
    const options = pick.filter(characterAvailable);
    return options.length ? this.rng.pick(options) : null;
  }

  private fillPassengers(v: Vehicle): void {
    const r = this.rng;
    if (!v.spec.carries && !v.isRideShare) return;
    const seats = v.arch.passengerSeats.length;
    if (!seats) return;
    // Somebody somewhere always needs one.
    if (v.id === "ambulance") v.flashing = true;
    // A full bus, and a few more hanging on at the door.
    if (v.id === "bus_city" && r.chance(0.45)) {
      const who = PASSENGER_IDS.filter(characterAvailable);
      const n = r.int(1, 2);
      for (let i = 0; i < n && who.length; i++) v.hangers.push(r.pick(who));
    }
    const fill = v.id === "bus_city" ? r.range(0.5, 1) : v.id === "car_sedan" ? (r.chance(0.3) ? 0.3 : 0) : r.range(0.3, 1);
    const ids = PASSENGER_IDS.filter(characterAvailable);
    if (!ids.length) return;
    for (let s = 0; s < seats; s++) {
      if (r.chance(fill)) v.passengers.push({ id: r.pick(ids), seat: s });
    }
  }

  private spawnFromLane(lane: Lane, s: number, id: VehicleId, variant?: string): void {
    const r = this.rng;
    const v = this.makeVehicle(id, r, variant);
    if (!v) return;
    v.mode = "ai";
    v.lane = lane;
    v.s = s;
    v.nextConnector = lane.out.length ? r.pick(lane.out) : null;
    // Everyone drives a little differently, and a few are in a real hurry.
    v.temper = r.next();
    const pacey = id === "car_sedan" || id === "microbus" || id === "motorbike" || id === "cng";
    v.aiTarget = VEHICLES[id].aiSpeed * (0.84 + v.temper * 0.34) * (pacey && r.chance(0.2) ? 1.4 : 1);
    if (pacey && v.aiTarget > VEHICLES[id].aiSpeed * 1.25) v.temper = Math.max(v.temper, 0.85);
    v.speed = v.aiTarget * 0.7;
    v.driverId = v.isTaxi && characterAvailable("npc_cng_guava") ? "npc_cng_guava" : this.driverFor(id);
    this.fillPassengers(v);
    this.poseAI(v, 0.016);
    v.y = this.roadHeight(v);
    v.lastYaw = v.heading;
    this.vehicles.push(v);
  }

  private trySpawn(dt: number): void {
    this.spawnTimer -= dt;
    const short = this.target - this.vehicles.length;
    if (this.spawnTimer > 0 || short <= 0) return;
    this.spawnTimer = short > 30 ? 0.02 : 0.1;
    const r = this.rng;
    this.findLanesNearby();
    const lanes = this.lanesNearby, mains = this.mainsNearby;
    if (!lanes.length) return;
    for (let tries = 0; tries < 24; tries++) {
      // Arterials carry most of the traffic, and most of the city's noise and colour.
      const lane = mains.length && r.chance(0.55) ? r.pick(mains) : r.pick(lanes);
      const s = r.range(3, Math.max(4, lane.length - 14));
      pointOn(lane, s, P);
      const dx = P.x - this.playerX, dz = P.z - this.playerZ;
      const d = Math.hypot(dx, dz);
      if (d < SPAWN_MIN || d > SPAWN_MAX) continue;
      // Not popping up in plain sight, unless it's a long way down the road.
      if (d < 115 && (dx * this.viewX + dz * this.viewZ) / d > 0.4) continue;
      const mix = [...(this.city.region.trafficMix?.[lane.road.cls] ?? TRAFFIC_MIX[lane.road.cls]), ...ALSO_ON_THE_ROAD[lane.road.cls]].filter(([k]) => this.fleet.available(k));
      const id = pickWeighted(r, mix);
      if (!id) return;
      // Slow vehicles and buses keep to the kerb lane; only faster ones use the inner lanes.
      const spec = VEHICLES[id];
      const kerbOnly = spec.aiSpeed < 6 || id === "bus_city" || id === "truck";
      if (kerbOnly && lane.index !== lane.laneCount - 1) continue;
      if (!this.laneClear(lane, s, spec.length + 2.6)) continue;
      this.spawnFromLane(lane, s, id);
      return;
    }
  }

  /** When the traffic setting comes down, the furthest vehicle goes first, out of the player's sight. */
  private trimExcess(): void {
    if (this.vehicles.length <= this.target) return;
    let far = -1, best = 70;
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      if (v.playerAboard) continue;
      const d = Math.hypot(v.x - this.playerX, v.z - this.playerZ);
      if (d > best) {
        best = d;
        far = i;
      }
    }
    if (far >= 0) this.vehicles.splice(far, 1);
  }

  private laneClear(lane: Lane, s: number, gap: number): boolean {
    for (const o of this.vehicles) {
      if (o.lane === lane && Math.abs(o.s - s) < gap) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ update

  update(dt: number): void {
    for (const s of this.signals.values()) s.update(dt);
    this.trySpawn(dt);
    this.trimExcess();
    this.hornWait -= dt;
    this.gatherClose();
    this.occupancy.clear();
    for (const v of this.vehicles) {
      if (v.inJunction !== null) {
        const axis = v.connector ? v.connector.lane.heading % 2 : 0;
        const o = this.occupancy.get(v.inJunction);
        if (o) o.count++;
        else this.occupancy.set(v.inJunction, { axis, count: 1 });
      }
      // A bus opens up whenever it's standing with people to let on and off.
      if (v.id === "bus_city") v.doorGoal[2] = v.holdTime > 0.5 && v.speed < 0.6 ? v.spec.doorSwing : 0;
      v.updateDoors(dt);
    }
    for (const p of this.parked) {
      p.updateDoors(dt);
      this.settleShove(p, dt);
    }
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (v.mode !== "ai") {
        this.vehicles.splice(i, 1);
        continue;
      }
      const d = Math.hypot(v.x - this.playerX, v.z - this.playerZ);
      v.dist = d;
      const behind = (v.x - this.playerX) * this.viewX + (v.z - this.playerZ) * this.viewZ < -6;
      if (!v.playerAboard && !v.called && (d > DESPAWN || (v.stuckTime > 22 && d > 45) || (v.stuckTime > 40 && d > 18 && behind))) {
        this.vehicles.splice(i, 1);
        continue;
      }
      this.stepAI(v, dt, d);
    }
    this.keepApart();
    this.makeWay();
  }

  /** Traffic in front of something with its lamps going pulls over as far as it can. */
  private makeWay(): void {
    for (const a of this.vehicles) {
      if (!a.flashing || a.id !== "ambulance" || !a.lane) continue;
      for (const q of this.vehicles) {
        if (q === a || q.lane !== a.lane || q.s <= a.s || q.s - a.s > 34) continue;
        q.filterGoal = (q.lane.index === 0 ? 1 : -1) * 1.3;
        q.filterHold = 2.5;
        if (q.wantedNow > 5) q.wantedNow = 5;
      }
      if (a.dist < 110) this.onSiren?.(a);
    }
  }

  private lanesNearby: Lane[] = [];
  private mainsNearby: Lane[] = [];
  private lanesFromX = Infinity;
  private lanesFromZ = Infinity;

  /** The roads within reach of the player. A big district has far more road than anyone can see. */
  private findLanesNearby(): void {
    if (Math.hypot(this.playerX - this.lanesFromX, this.playerZ - this.lanesFromZ) < 40) return;
    this.lanesFromX = this.playerX;
    this.lanesFromZ = this.playerZ;
    this.lanesNearby.length = 0;
    this.mainsNearby.length = 0;
    const reach = SPAWN_MAX + 40;
    for (const l of this.city.graph.lanes) {
      const n = l.pts.length - 2;
      const ax = l.pts[0], az = l.pts[1], bx = l.pts[n], bz = l.pts[n + 1];
      // Nearest point on a straight stretch of road.
      const ux = bx - ax, uz = bz - az;
      const t = clamp(((this.playerX - ax) * ux + (this.playerZ - az) * uz) / Math.max(ux * ux + uz * uz, 1), 0, 1);
      if (Math.hypot(ax + ux * t - this.playerX, az + uz * t - this.playerZ) > reach) continue;
      this.lanesNearby.push(l);
      if (l.road.cls === "main") this.mainsNearby.push(l);
    }
  }

  private cells = new Map<number, Vehicle[]>();

  /** The last word on where everything stands this frame: two vehicles never share the same space,
   *  whatever the drivers decided. It looks at the real outlines, side on as well as nose to tail,
   *  and the lighter one gives way more. Traffic out of sight doesn't need it. */
  private keepApart(): void {
    const cells = this.cells;
    for (const list of cells.values()) list.length = 0;
    const key = (ix: number, iz: number): number => (ix + 256) * 1024 + iz + 256;
    const add = (v: Vehicle): void => {
      const k = key(Math.floor(v.x / APART_CELL), Math.floor(v.z / APART_CELL));
      const list = cells.get(k);
      if (list) list.push(v);
      else cells.set(k, [v]);
    };
    for (const v of this.vehicles) {
      if (v.dist < APART_RANGE) {
        add(v);
        this.keepOutOfWalls(v);
      }
    }
    for (const v of this.parked) if (Math.abs(v.x - this.playerX) < APART_RANGE && Math.abs(v.z - this.playerZ) < APART_RANGE) add(v);
    for (const [k, list] of cells) {
      if (!list.length) continue;
      const ix = Math.floor(k / 1024), iz = k - ix * 1024;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) this.parted(list[i], list[j]);
        // Half the neighbours, so that each pair is only looked at once.
        for (const [ox, oz] of APART_NEXT) {
          const other = cells.get((ix + ox) * 1024 + iz + oz);
          if (other) for (const q of other) this.parted(list[i], q);
        }
      }
    }
  }

  private parted(a: Vehicle, b: Vehicle): void {
    const stillA = a.mode !== "ai", stillB = b.mode !== "ai";
    if (stillA && stillB) return;
    if (Math.abs(a.x - b.x) > 14 || Math.abs(a.z - b.z) > 14 || Math.abs(a.y - b.y) > 2.6) return;
    const as = Math.sin(a.heading), ac = Math.cos(a.heading), bs = Math.sin(b.heading), bc = Math.cos(b.heading);
    if (!obbVsObb(a.x, a.z, as, ac, a.spec.length * 0.5, a.spec.width * 0.5, b.x, b.z, bs, bc, b.spec.length * 0.5, b.spec.width * 0.5)) return;
    const { nx, nz, depth, px, pz } = HIT;
    const ma = VEHICLE_MASS[a.id], mb = VEHICLE_MASS[b.id];
    const shareA = stillA ? 0 : stillB ? 1 : mb / (ma + mb);
    if (shareA > 0) this.nudge(a, nx * depth * shareA, nz * depth * shareA, b);
    if (shareA < 1) this.nudge(b, -nx * depth * (1 - shareA), -nz * depth * (1 - shareA), a);
    // Something thrown off line carries on into whatever it meets, and that goes as well.
    if (thrown(a) || thrown(b)) bang(a, b, nx, nz, px, pz, 0.12);
  }

  /** Moves a driven vehicle aside: back along its lane if it ran up behind something, and otherwise
   *  off to one side. A driver forcing a way out of a jam is steered round rather than through. */
  private nudge(v: Vehicle, dx: number, dz: number, from: Vehicle): void {
    const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
    let along = dx * sh + dz * ch, across = dx * ch - dz * sh;
    if (v.ghostTime > 0) {
      across += Math.sign(across || 1) * Math.abs(along);
      along = 0;
    }
    v.s = Math.max(0, v.s + along);
    v.shoveX += ch * across;
    v.shoveZ -= sh * across;
    const off = Math.hypot(v.shoveX, v.shoveZ);
    if (off > 3.4) {
      v.shoveX *= 3.4 / off;
      v.shoveZ *= 3.4 / off;
    }
    v.x += ch * across + sh * along;
    v.z += -sh * across + ch * along;
    // Pushed back by what's in front: it can't be going any faster than that is.
    if (along < -0.001) {
      const ahead = Math.max(0, from.speed * (Math.sin(from.heading) * sh + Math.cos(from.heading) * ch));
      if (v.speed > ahead) {
        v.speed = ahead;
        v.aiAccel = Math.min(v.aiAccel, 0);
      }
    }
  }

  /** Only something thrown or steered off its line can reach a wall, so only that gets checked. */
  private keepOutOfWalls(v: Vehicle): void {
    if (Math.abs(v.shoveX) + Math.abs(v.shoveZ) + Math.abs(v.knockX) + Math.abs(v.knockZ) + Math.abs(v.filter) + Math.abs(v.lateral) < 0.04) return;
    const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
    const hl = v.spec.length * 0.5, hw = v.spec.width * 0.5;
    for (const c of this.city.collision.query(v.x, v.z, hl + hw + 0.5)) {
      if (c.kind === "circle" && c.loose) continue;
      const touching = c.kind === "box" ? obbVsBox(v.x, v.z, sh, ch, hl, hw, c.x0, c.z0, c.x1, c.z1) : obbVsCircle(v.x, v.z, sh, ch, hl, hw, c.x, c.z, c.r);
      if (!touching) continue;
      const { nx, nz, depth } = HIT;
      v.spin *= 0.8;
      v.x += nx * depth;
      v.z += nz * depth;
      v.shoveX += nx * depth;
      v.shoveZ += nz * depth;
      const into = v.knockX * nx + v.knockZ * nz;
      if (into < 0) {
        v.knockX -= nx * into;
        v.knockZ -= nz * into;
      }
      // A drift that has run out of room stops there.
      if (Math.abs(v.filter) > 0.04) v.filterGoal = v.filter * 0.5;
    }
  }

  /** Everything solid near the player, so people on foot only have to check these few. */
  private gatherClose(): void {
    const near = this.close;
    near.length = 0;
    const R = 80;
    for (const v of this.vehicles) if (Math.abs(v.x - this.playerX) < R && Math.abs(v.z - this.playerZ) < R) near.push(v);
    for (const v of this.parked) if (Math.abs(v.x - this.playerX) < R && Math.abs(v.z - this.playerZ) < R) near.push(v);
    if (this.playerVehicle) near.push(this.playerVehicle);
  }

  /** Reads a point `ahead` metres along the vehicle's planned route from its rear axle. */
  private routePoint(v: Vehicle, ahead: number, out: { x: number; z: number; dx: number; dz: number }): void {
    let path: Path = v.connector ?? v.lane!;
    let s = v.s + ahead;
    if (s > path.length) {
      s -= path.length;
      const next: Path | null = v.connector ? v.connector.next : v.nextConnector;
      if (next) path = next;
      else s = path.length;
      if (s > path.length) {
        // A short connector can be shorter than a bus: carry on into the lane after it.
        const after = (path as Connector).next as Lane | undefined;
        if (after) {
          s -= path.length;
          path = after;
        } else s = path.length;
      }
    }
    pointOn(path, s, out);
  }

  /** Looks along the planned route for the nearest thing in the way. */
  private scanAhead(v: Vehicle): void {
    const nose = this.noseFromRear(v);
    let reach = 8 + v.speed * 2.8;
    // Coming up to a junction: is there room on the far side, before going in?
    if (!v.connector && v.lane && v.nextConnector && !v.nextConnector.junction.isPlaza && !v.nextConnector.through) {
      const toStop = v.lane.length - v.s - nose;
      if (toStop < 12) reach = Math.max(reach, toStop + v.nextConnector.length + v.spec.length + 3);
    }
    const halfW = v.spec.width * 0.5 + 0.12;
    this.scanBest = Infinity;
    this.scanSpeed = 0;
    this.scanLead = null;
    this.scanHitPlayer = false;
    this.scanForPlayer = false;
    const steps = Math.min(Math.ceil(reach / PROBE_STEP), 78);
    const probes = this.probes;
    // Looks where the vehicle is really going: a lane change fading out, plus any edging past.
    const fade = v.speed * 1.5 + 3;
    for (let i = 0; i <= steps; i++) {
      const at = i * PROBE_STEP;
      this.routePoint(v, nose + at, Q);
      const off = v.lateral * Math.max(0, 1 - at / fade) + (at < 3 && v.rounding <= 0 ? v.filter : v.filterGoal);
      probes[i * 2] = Q.x - Q.dz * off;
      probes[i * 2 + 1] = Q.z + Q.dx * off;
    }
    this.scanSteps = steps;
    this.scanHalf = halfW;
    const near = reach + 12;
    if (v.ghostTime <= 0) {
      for (const o of this.vehicles) {
        if (o === v || Math.abs(o.x - v.x) > near || Math.abs(o.z - v.z) > near || Math.abs(o.y - v.y) > 2.6) continue;
        const sh = Math.sin(o.heading), ch = Math.cos(o.heading);
        const closing = Math.max(0, o.speed * (sh * Math.sin(v.heading) + ch * Math.cos(v.heading)));
        this.scanning = o;
        for (const off of o.spec.circles) this.probe(o.x + sh * off, o.z + ch * off, o.spec.radius, closing);
      }
      for (const o of this.parked) {
        if (Math.abs(o.x - v.x) > near || Math.abs(o.z - v.z) > near || Math.abs(o.y - v.y) > 2.6) continue;
        const sh = Math.sin(o.heading), ch = Math.cos(o.heading);
        this.scanning = o;
        for (const off of o.spec.circles) this.probe(o.x + sh * off, o.z + ch * off, Math.min(o.spec.width / 2, o.spec.radius), 0);
      }
    }
    this.scanning = null;
    this.scanForPlayer = true;
    if (!v.playerAboard && Math.abs(this.playerY - v.y) < 2.6) this.probe(this.playerX, this.playerZ, this.playerRadius, 0);
    const pv = this.playerVehicle;
    if (pv && pv !== v && Math.abs(pv.y - v.y) < 2.6) {
      const sh = Math.sin(pv.heading), ch = Math.cos(pv.heading);
      for (const off of pv.spec.circles) this.probe(pv.x + sh * off, pv.z + ch * off, pv.spec.radius, Math.max(0, pv.speed));
    }
    this.scanForPlayer = false;
    if (v.y < 2.6) {
      for (const b of this.pedestrianBlockers) {
        if (Math.abs(b.x - v.x) < near && Math.abs(b.z - v.z) < near) this.probe(b.x, b.z, 0.5, 0);
      }
    }
    v.leadGap = this.scanBest;
    v.leadSpeed = this.scanSpeed;
    v.lead = this.scanLead;
    v.leadIsPlayer = this.scanHitPlayer;
  }

  /** Records the distance along the current scan at which this circle blocks the route. */
  private probe(ox: number, oz: number, radius: number, speed: number): void {
    const rr = this.scanHalf + radius;
    const probes = this.probes;
    for (let i = 0; i <= this.scanSteps; i++) {
      const dx = probes[i * 2] - ox, dz = probes[i * 2 + 1] - oz;
      if (dx * dx + dz * dz < rr * rr) {
        const gap = i * PROBE_STEP - radius;
        if (gap < this.scanBest) {
          this.scanBest = gap;
          this.scanSpeed = speed;
          this.scanLead = this.scanning;
          this.scanHitPlayer = this.scanForPlayer;
        }
        return;
      }
    }
  }

  private noseFromRear(v: Vehicle): number {
    return v.spec.length / 2 - v.arch.rearAxleZ;
  }

  /** Intelligent Driver Model: the standard formula for human-like following. It accelerates
   *  smoothly, closes gaps gently and brakes progressively, with no sudden changes of speed. */
  private idm(v: Vehicle, wanted: number, gap: number, leadSpeed: number): number {
    const spec = v.spec;
    const heavy = spec.id === "bus_city" || spec.id === "truck";
    // A driver in a hurry pulls away harder and sits closer behind whoever is in front.
    const a = Math.max(spec.accel * (0.62 + 0.36 * v.temper), 1.2);
    const b = 3.2;
    const s0 = (heavy ? 2.2 : 1.25) * (1.15 - v.temper * 0.45);
    const T = (heavy ? 1.25 : 1) * (1.3 - v.temper * 0.75);
    // Over the speed wanted, such as coming into a slower road: ease off, don't stamp on the brake.
    const ratio = v.speed / Math.max(wanted, 0.1);
    const free = ratio <= 1 ? 1 - ratio * ratio * ratio * ratio : -Math.min(1.1, (ratio - 1) * 2.4);
    if (!isFinite(gap)) return a * free;
    const dv = v.speed - leadSpeed;
    const sStar = s0 + Math.max(0, v.speed * T + (v.speed * dv) / (2 * Math.sqrt(a * b)));
    const g = Math.max(gap, 0.05);
    return a * (free - (sStar / g) * (sStar / g));
  }

  private stepAI(v: Vehicle, dt: number, playerDist: number): void {
    const lane = v.lane;
    if (!v.connector && lane && !v.nextConnector) v.nextConnector = this.chooseExit(v, lane);

    // Vehicles far from the player look ahead less often; nobody can tell, and it saves time.
    v.scanTimer -= dt;
    if (v.scanTimer <= 0) {
      v.scanTimer = playerDist < NEAR_SCAN ? 0 : 0.15;
      this.scanAhead(v);
    }
    const nose = this.noseFromRear(v);
    const road = (v.connector ? v.connector.next : lane)?.road;
    // With a paying passenger aboard, a driver doesn't dawdle.
    let wanted = v.aiTarget * (road ? ROAD_PACE[road.cls] ?? 1 : 1) * (v.called || (v.playerAboard && v.trip) ? 1.4 : 1);
    if (v.connector) wanted = Math.min(wanted, v.connector.junction.isPlaza ? 6.5 : v.connector.turn === 0 ? wanted : 5);
    else if (lane && v.nextConnector && (v.nextConnector.turn !== 0 || v.nextConnector.junction.isPlaza)) {
      // Slowing for a corner begins well before it, not at the corner.
      const corner = v.nextConnector.junction.isPlaza ? 6.5 : 5;
      const left = Math.max(lane.length - v.s - nose, 0);
      wanted = Math.min(wanted, Math.sqrt(corner * corner + 2 * 2.4 * left));
    }
    v.wantedNow = wanted;
    let accel = this.idm(v, wanted, v.leadGap, v.leadSpeed);

    if (!v.connector && lane) {
      const toStop = lane.length - v.s - nose;
      const j = lane.to;
      const ctrl = lane.through ? undefined : this.signals.get(j.id);
      if (lane.through) {
        // High above the junction: nothing there to stop for.
      } else if (ctrl) {
        // Lamps on and siren going: through the red, carefully.
        const st = v.flashing ? "green" : ctrl.stateFor(lane.heading);
        if (st !== "green") {
          // An amber that can't be stopped for is run; everyone else stops at the line.
          const stopDist = (v.speed * v.speed) / (2 * 4);
          if ((st === "red" && toStop > -0.8) || (st === "amber" && toStop > stopDist)) accel = Math.min(accel, this.idm(v, wanted, toStop, 0));
        }
      } else if (toStop < 12) {
        // No signal: first in has the junction, and others hold just before it.
        const o = this.occupancy.get(j.id);
        if (o && o.axis !== lane.heading % 2) accel = Math.min(accel, this.idm(v, wanted, toStop, 0));
      }
      // Green, but the far side is full: wait at the line and don't block the junction.
      const next = v.nextConnector;
      if (next && v.ghostTime <= 0 && !next.through && !next.junction.isPlaza && toStop > -0.5 && toStop < 10 && v.leadSpeed < 1.5 && v.leadGap > toStop + 0.5 && v.leadGap < toStop + next.length + v.spec.length + 1.5) {
        accel = Math.min(accel, this.idm(v, wanted, Math.max(toStop, 0.05), 0));
      }
      if (v.id === "bus_city") accel = Math.min(accel, this.busStopBrake(v, wanted, lane, nose));
      if (v.trip) {
        accel = Math.min(accel, this.tripBrake(v, wanted, lane, nose));
        this.laneForTrip(v, lane);
      } else this.considerLaneChange(v, lane, dt);
      this.considerEdgingPast(v, lane, dt);
    }
    if (v.holdTime > 0) {
      v.holdTime -= dt;
      accel = Math.min(accel, this.idm(v, wanted, Math.max(0.05, v.speed * v.speed * 0.2), 0));
      if (v.holdTime <= 0 && this.waiting === v) this.waiting = null;
    }

    // Dhaka manners: lean on the horn when blocked.
    v.hornCooldown -= dt;
    const blocked = v.leadGap < 4 && v.speed < 1 && v.holdTime <= 0;
    if (blocked) v.stuckTime += dt;
    else v.stuckTime = Math.max(0, v.stuckTime - dt * 3);
    // Impatient drivers don't wait to be stuck for long, and lean on it behind anything slow.
    const leaning = blocked ? v.stuckTime > 1.6 - v.temper * 1.2 : v.temper > 0.7 && v.leadGap < 7 && v.leadSpeed < v.speed + 0.5 && v.speed > 1;
    if (leaning && v.hornCooldown <= 0 && playerDist < 70 && this.onHorn && this.hornWait <= 0) {
      v.hornCooldown = this.rng.range(2.5, 7);
      this.hornWait = 0.3;
      this.onHorn(v);
    }
    // Held up by the hero, or by something left standing in the road: a horn and a word, then round it.
    const byHero = v.leadIsPlayer && v.speed < 1.2 && v.leadGap < 9;
    const byParked = !!v.lead && v.lead.mode === "parked" && v.speed < 1.2 && v.leadGap < 7;
    if (byHero || byParked) v.blockTime += dt;
    else v.blockTime = Math.max(0, v.blockTime - dt * 1.5);
    if (byHero && v.blockTime > 2.2 && !v.shouted) {
      v.shouted = true;
      if (playerDist < 40) {
        this.onHorn?.(v);
        this.onBlocked?.(v);
      }
    }
    if (v.blockTime < 0.5 && !byHero) v.shouted = false;
    if (v.blockTime > 3 && v.filterGoal === 0 && v.laneT >= 1 && !v.connector && lane) this.goRound(v, lane);
    if (v.rounding > 0) {
      v.rounding -= dt;
      // Eases out at walking pace, and only speeds up once it's really alongside.
      if (Math.abs(v.filter - v.filterGoal) > 0.5) accel = Math.min(accel, this.idm(v, 1.6, Infinity, 0));
    }
    // Two vehicles nose to nose in a junction: let one creep through rather than wait forever. The same
    // goes for whoever is first in the queue into one that has locked up: jams are fine, gridlock isn't.
    const atTheLine = !v.connector && !!lane && lane.length - v.s - nose < 7;
    if ((v.stuckTime > 7 && v.inJunction !== null) || (v.stuckTime > 14 && atTheLine)) v.ghostTime = 4;
    // Easing out of a jam, at a pace that others can be nudged aside for, not ploughing through them.
    if (v.ghostTime > 0 && v.speed > 2.4) v.speed = 2.4;
    if (v.ghostTime > 0) v.ghostTime -= dt;

    // Eased in, so that speed changes never lurch, but a real emergency still gets the brakes at once.
    accel = clamp(accel, -7, Math.max(v.spec.accel, 1.2));
    v.aiAccel += (accel - v.aiAccel) * (1 - Math.exp(-dt * (accel < -3 ? 16 : 4.5)));
    v.speed = Math.max(0, v.speed + v.aiAccel * dt);
    if (v.speed === 0 && v.aiAccel < 0) v.aiAccel = 0;
    v.s += v.speed * dt;

    const path: Path = v.connector ?? v.lane!;
    if (v.s >= path.length) this.advance(v, path.length);
    this.stepSideways(v, dt);
    this.poseAI(v, dt);
  }

  /** Places the body on the route by its axles, so a long bus swings out through a corner the
   *  way a real one does instead of sliding along a line. */
  private poseAI(v: Vehicle, dt: number): void {
    const wb = Math.max(v.arch.frontAxleZ - v.arch.rearAxleZ, 0.8);
    this.routePoint(v, 0, P);
    this.routePoint(v, wb, Q);
    let dx = Q.x - P.x, dz = Q.z - P.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const rearZ = v.arch.rearAxleZ;
    // A lane change is a sideways drift easing to zero; the nose points where it's heading.
    const steerIn = Math.atan2(v.latVel, Math.max(v.speed, 3));
    const left = v.lateral + v.filter;
    // A knock carries it off line. It stays there until the driver sets off again and steers back.
    v.shoveX += v.knockX * dt;
    v.shoveZ += v.knockZ * dt;
    v.shoveYaw += v.spin * dt;
    v.rubOut(dt, 2.6);
    // Knocked well out of line, they take it gently until they're straight again.
    if (v.speed > 3 && Math.hypot(v.shoveX, v.shoveZ) + Math.abs(v.shoveYaw) * 3 > 0.7) v.speed -= Math.min(v.speed - 3, dt * 5);
    const back = Math.exp(-dt * Math.min(v.speed * 0.45, 1.6));
    v.shoveX *= back;
    v.shoveZ *= back;
    v.shoveYaw *= back;
    const x = P.x - dx * rearZ - dz * left + v.shoveX;
    const z = P.z - dz * rearZ + dx * left + v.shoveZ;
    const heading = Math.atan2(dx, dz) - steerIn + v.shoveYaw;
    // On the flyover, the road rises and falls, and the body tilts with it.
    let surface = 0;
    const onDeck = v.connector ? v.connector.through : v.lane?.raised;
    if (onDeck) {
      const f = this.city.region.layout.flyover!;
      const along = (px: number, pz: number): number => (f.axis === "h" ? px : pz);
      surface = flyoverHeight(f, along(x, z));
      v.slope = -Math.atan2(flyoverHeight(f, along(x + dx, z + dz)) - flyoverHeight(f, along(x - dx, z - dz)), 2);
    } else v.slope = 0;
    let dh = heading - v.lastYaw;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const yawRate = dt > 0 ? dh / dt : 0;
    v.lastYaw = heading;
    // Front wheels show the angle this turn really needs.
    const lock = v.spec.maxSteer;
    const angle = v.speed > 0.3 ? Math.atan((yawRate * wb) / v.speed) : 0;
    v.steerAngle += (clamp(angle / lock, -1, 1) - v.steerAngle) * (1 - Math.exp(-dt * 8));
    v.aiPose(x, z, heading, surface, dt, yawRate);
  }

  /** The height of the road under an AI vehicle, right now. */
  private roadHeight(v: Vehicle): number {
    const onDeck = v.connector ? v.connector.through : v.lane?.raised;
    if (!onDeck) return 0;
    const f = this.city.region.layout.flyover!;
    return flyoverHeight(f, f.axis === "h" ? v.x : v.z);
  }

  /** Sends for a rickshaw, CNG or taxi: the nearest one free on the road, or one from round the corner. */
  callRide(kind: "rickshaw" | "cng" | "taxi" | "bike", x: number, z: number): Vehicle | null {
    const fits = (v: Vehicle): boolean => (kind === "bike" ? v.isRideShare : kind === "taxi" ? v.isTaxi : kind === "rickshaw" ? v.id === "rickshaw" || v.id === "easybike" : v.id === kind);
    const near: Vehicle[] = [];
    for (const v of this.vehicles) {
      if (!fits(v) || v.mode !== "ai" || !v.driverId || v.trip || v.called || v.holdTime > 0 || v.playerAboard) continue;
      if (Math.hypot(v.x - x, v.z - z) < 150) near.push(v);
    }
    near.sort((p, q) => Math.hypot(p.x - x, p.z - z) - Math.hypot(q.x - x, q.z - z));
    let best: Vehicle | null = null, bd = 170;
    for (const v of near.slice(0, 4)) {
      const d = this.routeMetres(v, x, z);
      if (d !== null && d < bd) {
        bd = d;
        best = v;
      }
    }
    // A free one from round the corner, if that's clearly closer than anything on the road.
    const spot = this.spotFor(kind, x, z);
    if (spot && (!best || spot.metres < bd * 0.7)) best = this.spawnAt(spot, kind) ?? best;
    if (!best) return null;
    best.passengers.length = 0;
    best.called = true;
    this.setDestination(best, x, z);
    return best;
  }

  /** The shortest drive there is to this point by road, starting out of sight. */
  private spotFor(kind: "rickshaw" | "cng" | "taxi" | "bike", x: number, z: number): { lane: Lane; s: number; metres: number } | null {
    const id: VehicleId = kind === "taxi" ? "car_sedan" : kind === "bike" ? "motorbike" : kind;
    const route = this.routeTo(x, z, null);
    if (!route) return null;
    let best: { lane: Lane; s: number; metres: number } | null = null;
    for (const lane of this.city.graph.lanes) {
      if (lane.index !== lane.laneCount - 1 || lane.length < 20) continue;
      const toEnd = route.dist.get(lane);
      if (toEnd === undefined) continue;
      for (let at = 6; at < lane.length - 12; at += 12) {
        const metres = toEnd - at;
        if (metres < 35 || (best && metres >= best.metres)) continue;
        pointOn(lane, at, P);
        const dx = P.x - this.playerX, dz = P.z - this.playerZ;
        const d = Math.hypot(dx, dz);
        if (d < 32 || (d < 110 && (dx * this.viewX + dz * this.viewZ) / d > 0.3)) continue;
        if (!this.laneClear(lane, at, VEHICLES[id].length + 3)) continue;
        best = { lane, s: at, metres };
      }
    }
    return best;
  }

  private spawnAt(spot: { lane: Lane; s: number }, kind: "rickshaw" | "cng" | "taxi" | "bike"): Vehicle | null {
    const before = this.vehicles.length;
    this.spawnFromLane(spot.lane, spot.s, kind === "taxi" ? "car_sedan" : kind === "bike" ? "motorbike" : kind, kind === "taxi" ? "taxi" : kind === "bike" ? "rideshare" : undefined);
    return this.vehicles.length > before ? this.vehicles[this.vehicles.length - 1] : null;
  }

  /** The nearest bus, whatever it's doing. */
  nearestBus(x: number, z: number, range: number): Vehicle | null {
    let best: Vehicle | null = null, bd = range;
    for (const v of this.vehicles) {
      if (v.id !== "bus_city" || v.mode !== "ai") continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  private busStopBrake(v: Vehicle, wanted: number, lane: Lane, nose: number): number {
    const stops = this.laneStops.get(lane);
    if (!stops) return Infinity;
    for (const stop of stops) {
      if (stop.stopIndex === v.servedStop) continue;
      const gap = stop.s - (v.s + nose);
      if (gap < -2) continue;
      if (gap > 40) break;
      if (v.speed < 0.25 && gap < 3) {
        v.servedStop = stop.stopIndex;
        v.holdTime = DWELL_SECONDS;
        this.onBusDwell?.(stop.stopIndex, v);
        break;
      }
      return this.idm(v, wanted, Math.max(gap, 0.05), 0);
    }
    return Infinity;
  }

  /** Pull out past something slow when the next lane has room, as long as it isn't near the junction.
   *  Those in a hurry do it sooner and more often, and a move takes a couple of seconds, as it should. */
  private considerLaneChange(v: Vehicle, lane: Lane, dt: number): void {
    if (v.laneT < 1 || v.id === "bus_city" || v.id === "truck" || v.spec.aiSpeed < 6) return;
    if (v.leadGap > 14 + v.temper * 16 || v.leadSpeed > v.wantedNow * 0.82) return;
    if (lane.length - v.s < 18 || v.s < 5) return;
    const options = this.neighbours.get(lane);
    if (!options?.length || !this.rng.chance(dt * (0.5 + v.temper * 2.4))) return;
    for (const n of options) {
      if (!this.laneOpen(n, v)) continue;
      // Lanes further from the centre are further to the left of the direction of travel.
      v.laneFrom = v.lateral = -(n.index - lane.index) * LANE_WIDTH;
      v.laneT = 0;
      v.laneDur = clamp(3 - v.temper * 1.3 - v.speed * 0.04, 1.3, 3);
      v.lane = n;
      v.nextConnector = this.chooseExit(v, n);
      return;
    }
  }

  /** Pulls out round whatever is standing in the way, into the next lane if it's free, or else across
   *  the white line. Nobody waits long behind someone who isn't going anywhere. */
  private goRound(v: Vehicle, lane: Lane): void {
    v.blockTime = 1.5;
    for (const n of this.neighbours.get(lane) ?? []) {
      if (!this.laneOpen(n, v)) continue;
      v.laneFrom = v.lateral = -(n.index - lane.index) * LANE_WIDTH;
      v.laneT = 0;
      v.laneDur = 2.4;
      v.lane = n;
      v.nextConnector = this.chooseExit(v, n);
      v.rounding = 2.5;
      return;
    }
    // How far off the lane's centre the obstacle stands, to the left, and how far it reaches.
    const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
    const pv = this.playerVehicle;
    const lead = v.lead ?? (v.leadIsPlayer && pv ? pv : null);
    const ox = lead ? lead.x : this.playerX, oz = lead ? lead.z : this.playerZ;
    const leftOf = -((ox - v.x) * ch - (oz - v.z) * sh);
    const reach = (lead ? lead.spec.width * 0.5 : this.playerRadius) + v.spec.width * 0.5 + 0.5;
    const roomLeft = (lane.laneCount - 1 - lane.index) * LANE_WIDTH + (LANE_WIDTH - v.spec.width) * 0.5 + 0.1;
    // The road side is the usual way round. The kerb side only if that's the shorter way and there's room.
    const goLeft = leftOf + reach, goRight = leftOf - reach;
    const goal = goLeft <= roomLeft && Math.abs(goLeft) < Math.abs(goRight) ? goLeft : goRight;
    if (Math.abs(goal) > 4.6) return;
    v.filterGoal = goal;
    const len = lead ? lead.spec.length : 1;
    v.filterHold = clamp((Math.max(v.leadGap, 0) + len + v.spec.length + 5) / 2.2, 3, 9);
    v.rounding = 3;
  }

  /** Is there room in that lane, allowing for what's closing in on the gap from behind? */
  private laneOpen(n: Lane, v: Vehicle): boolean {
    for (const o of this.vehicles) {
      if (o === v || o.lane !== n) continue;
      const ds = o.s - v.s;
      if (ds >= 0) {
        if (ds < v.spec.length + Math.max(3.5, (v.speed - o.speed) * 2)) return false;
      } else if (-ds < o.spec.length + Math.max(3, (o.speed - v.speed) * 2.6)) return false;
    }
    const pv = this.playerVehicle;
    if (!pv || Math.hypot(pv.x - v.x, pv.z - v.z) > 12) return true;
    // Only the part of the road it would actually move into.
    pointOn(n, Math.min(v.s, n.length), P);
    const across = (pv.x - P.x) * P.dz - (pv.z - P.z) * P.dx;
    return Math.abs(across) > pv.spec.width * 0.5 + v.spec.width * 0.5 + 0.4;
  }

  /** Squeezing past without changing lanes. Bikes thread through anything, and on a narrow road
   *  anyone stuck behind a rickshaw swings out round it when nothing is coming the other way. */
  private considerEdgingPast(v: Vehicle, lane: Lane, dt: number): void {
    if (v.filterGoal !== 0) {
      v.filterHold -= dt;
      if (v.filterHold <= 0) {
        // Past it, or at least not getting any further: back into line.
        v.filterGoal = 0;
      }
      return;
    }
    const lead = v.lead;
    if (!lead || v.laneT < 1 || v.leadGap > 8 + v.temper * 6 || lane.length - v.s < 8) return;
    const twoWheels = v.id === "motorbike" || v.id === "bicycle";
    const canSwing = !twoWheels && v.id !== "bus_city" && v.id !== "truck" && v.spec.aiSpeed >= 6 && lead.spec.aiSpeed < 6 && lane.laneCount === 1;
    if (!twoWheels && !canSwing) return;
    if (twoWheels && v.leadSpeed > v.wantedNow * 0.85) return;
    if (!this.rng.chance(dt * (twoWheels ? 2.6 : 1.1 + v.temper * 2))) return;
    const clearance = lead.spec.radius + v.spec.width * 0.5 + 0.34;
    // Kerb lanes pass on the road side; a lane next to the centre passes on the kerb side if there is one.
    const onLeft = twoWheels && lane.index < lane.laneCount - 1;
    if (canSwing && !this.oncomingClear(v, 30)) return;
    v.filterGoal = (onLeft ? 1 : -1) * Math.min(clearance, 2.5);
    v.filterHold = clamp((v.leadGap + lead.spec.length + v.spec.length + 3) / Math.max(v.speed - v.leadSpeed, 2.2), 1.4, 4.5);
  }

  /** Nothing coming the other way on the road side, for this far ahead. */
  private oncomingClear(v: Vehicle, ahead: number): boolean {
    const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
    for (const o of this.vehicles) {
      if (o === v) continue;
      const dx = o.x - v.x, dz = o.z - v.z;
      if (Math.abs(dx) > ahead + 4 || Math.abs(dz) > ahead + 4) continue;
      const along = dx * sh + dz * ch, across = dx * ch - dz * sh;
      if (along > -4 && along < ahead && across > 0.5 && across < 5.5) return false;
    }
    return true;
  }

  /** Eases any sideways movement: an S-curve for a lane change, a steady drift for edging past. */
  private stepSideways(v: Vehicle, dt: number): void {
    let vel = 0;
    if (v.laneT < 1) {
      const before = v.lateral;
      v.laneT = Math.min(1, v.laneT + dt / v.laneDur);
      const t = v.laneT;
      v.lateral = v.laneFrom * (1 - t * t * t * (t * (t * 6 - 15) + 10));
      if (dt > 0) vel = (v.lateral - before) / dt;
    } else v.lateral = 0;
    const was = v.filter;
    // Nobody slides sideways on the spot.
    v.filter += (v.filterGoal - v.filter) * (1 - Math.exp(-dt * 1.9 * clamp(v.speed / 1.6, 0.18, 1)));
    if (Math.abs(v.filter) < 0.005 && v.filterGoal === 0) v.filter = 0;
    if (dt > 0) vel += (v.filter - was) / dt;
    v.latVel += (vel - v.latVel) * (1 - Math.exp(-dt * 10));
  }

  /** Which way to leave a lane at its far end: towards the destination, if it has one. */
  private chooseExit(v: Vehicle, lane: Lane): Connector | null {
    if (!lane.out.length) return null;
    const trip = v.trip;
    if (!trip) return this.rng.pick(lane.out);
    let best = lane.out[0], bd = Infinity;
    for (const c of lane.out) {
      const d = (trip.dist.get(c.next) ?? 1e9) + c.length;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /** How far every lane is from a point along the roads, worked out backwards from there. A place can
   *  be reached from the road on either side of it, so both are tried and the shorter trip wins. */
  private routeTo(x: number, z: number, from: Lane | null): { lane: Lane; s: number; dist: Map<Lane, number> } | null {
    // The nearest stretches of kerb lane, pulling up well clear of the junctions at either end.
    const spots: { lane: Lane; s: number; d: number }[] = [];
    for (const l of this.city.graph.lanes) {
      if (l.index !== l.laneCount - 1 || l.length < 14) continue;
      const ax = l.pts[0], az = l.pts[1];
      const dx = (l.pts[2] - ax) / l.length, dz = (l.pts[3] - az) / l.length;
      const along = Math.max(7, Math.min(l.length - 7, (x - ax) * dx + (z - az) * dz));
      spots.push({ lane: l, s: along, d: Math.hypot(ax + dx * along - x, az + dz * along - z) });
    }
    spots.sort((p, q) => p.d - q.d);
    const nearest = spots.filter((q) => q.d < spots[0].d + 16).slice(0, 3);
    let best: { lane: Lane; s: number; dist: Map<Lane, number> } | null = null;
    let shortest = Infinity;
    for (const spot of nearest) {
      const dist = this.distancesTo(spot.lane, spot.s);
      const here = from ? dist.get(from) ?? Infinity : spot.d;
      if (here < shortest) {
        shortest = here;
        best = { lane: spot.lane, s: spot.s, dist };
      }
    }
    return best;
  }

  private distancesTo(target: Lane, ts: number): Map<Lane, number> {
    if (!this.lanesInto) {
      this.lanesInto = new Map();
      for (const l of this.city.graph.lanes) {
        for (const c of l.out) {
          const list = this.lanesInto.get(c.next);
          if (list) list.push(c);
          else this.lanesInto.set(c.next, [c]);
        }
      }
    }
    const dist = new Map<Lane, number>();
    dist.set(target, ts);
    const open: Lane[] = [target];
    while (open.length) {
      // The list is short: this city has a few hundred lanes, and it only runs when someone hires a ride.
      let k = 0;
      for (let i = 1; i < open.length; i++) if (dist.get(open[i])! < dist.get(open[k])!) k = i;
      const l = open.splice(k, 1)[0];
      const here = dist.get(l)!;
      for (const c of this.lanesInto.get(l) ?? []) {
        const d = here + c.length + c.lane.length;
        if (d < (dist.get(c.lane) ?? Infinity)) {
          dist.set(c.lane, d);
          open.push(c.lane);
        }
      }
      // Moving across to the next lane along costs a little, but not much.
      for (const n of this.neighbours.get(l) ?? []) {
        if (here + 8 < (dist.get(n) ?? Infinity)) {
          dist.set(n, here + 8);
          open.push(n);
        }
      }
    }
    return dist;
  }

  /** How far a vehicle would have to go by road to reach a point. */
  routeMetres(v: Vehicle, x: number, z: number): number | null {
    const lane = v.connector ? v.connector.next : v.lane;
    const route = this.routeTo(x, z, lane);
    if (!route) return null;
    const here = lane ? route.dist.get(lane) : undefined;
    if (here === undefined) return null;
    const left = here - (v.connector ? 0 : v.s);
    if (left > 8 || v.connector || !lane) return Math.max(left, 0);
    // On the right road already, but past the spot or too close to stop: it has to go round the block.
    let around = Infinity;
    for (const c of lane.out) around = Math.min(around, c.length + (route.dist.get(c.next) ?? Infinity));
    return around === Infinity ? null : around + lane.length - v.s;
  }

  /** Sends a vehicle somewhere. It finds its own way, and calls `onTripDone` when it pulls up there. */
  setDestination(v: Vehicle, x: number, z: number, police = false): void {
    v.onPoliceJob = police;
    const route = this.routeTo(x, z, v.connector ? v.connector.next : v.lane);
    if (!route) return;
    v.trip = route;
    if (!v.connector && v.lane) v.nextConnector = this.chooseExit(v, v.lane);
  }

  clearDestination(v: Vehicle): void {
    v.trip = null;
  }

  /** On a trip: slows for the spot, and stops. */
  private tripBrake(v: Vehicle, wanted: number, lane: Lane, nose: number): number {
    const trip = v.trip!;
    if (lane.road !== trip.lane.road || lane.from !== trip.lane.from || lane.to !== trip.lane.to) return Infinity;
    const gap = trip.s - (v.s + nose);
    if (gap < -3) return Infinity;
    if (v.speed < 0.3 && gap < 2.5) {
      v.trip = null;
      v.holdTime = 40;
      if (v.called) {
        v.called = false;
        this.waiting = v;
        this.onCalledArrived?.(v);
      } else if (v.onPoliceJob) this.onPoliceArrived?.(v);
      else this.onTripDone?.(v);
      return Infinity;
    }
    return gap > 45 ? Infinity : this.idm(v, wanted, Math.max(gap, 0.05), 0);
  }

  /** On a trip and in the wrong lane for the next turn: moves over as soon as there's room. */
  private laneForTrip(v: Vehicle, lane: Lane): void {
    const trip = v.trip;
    if (!trip || v.laneT < 1 || lane.length - v.s < 10) return;
    const here = trip.dist.get(lane) ?? Infinity;
    for (const n of this.neighbours.get(lane) ?? []) {
      if ((trip.dist.get(n) ?? Infinity) + 4 < here && this.laneOpen(n, v)) {
        v.laneFrom = v.lateral = -(n.index - lane.index) * LANE_WIDTH;
        v.laneT = 0;
        v.laneDur = 2.2;
        v.lane = n;
        v.nextConnector = this.chooseExit(v, n);
        return;
      }
    }
  }

  private advance(v: Vehicle, pathLen: number): void {
    const over = v.s - pathLen;
    if (v.connector) {
      v.lane = v.connector.next;
      v.connector = null;
      v.inJunction = null;
      v.nextConnector = this.chooseExit(v, v.lane);
      v.s = over;
    } else if (v.lane) {
      const next = v.nextConnector;
      if (!next) {
        v.s = pathLen;
        v.speed = 0;
        return;
      }
      v.connector = next;
      v.nextConnector = null;
      v.inJunction = next.through ? null : next.junction.id;
      v.s = over;
    }
  }

  /** A parked vehicle that's been knocked rolls on a little, and stops. */
  private settleShove(p: Vehicle, dt: number): void {
    if (p.knockX === 0 && p.knockZ === 0 && p.spin === 0) {
      // On its way over, or being lifted back up.
      if (p.isLying ? p.fallen < 1.41 : p.fallen > 0) p.settle(dt);
      return;
    }
    p.x += p.knockX * dt;
    p.z += p.knockZ * dt;
    p.heading += p.spin * dt;
    p.rubOut(dt, 5);
    this.keepOutOfWalls(p);
    p.settle(dt);
  }

  /** The player's vehicle against everything else on the road. A real knock: the lighter one comes off
   *  worse, both are thrown off line, and a hit off-centre swings them round. Nothing is ever damaged.
   *  Returns the hit strength; `lastHit` says what with, and `lastHitAt` where. */
  collidePlayerVehicle(pv: Vehicle): number {
    let strongest = 0;
    this.lastHit = null;
    const phl = pv.spec.length * 0.5, phw = pv.spec.width * 0.5;
    const check = (o: Vehicle): void => {
      if (o === pv || Math.abs(o.x - pv.x) > 18 || Math.abs(o.z - pv.z) > 18 || Math.abs(o.y - pv.y) > 2.6) return;
      const psh = Math.sin(pv.heading), pch = Math.cos(pv.heading);
      const sh = Math.sin(o.heading), ch = Math.cos(o.heading);
      if (!obbVsObb(pv.x, pv.z, psh, pch, phl, phw, o.x, o.z, sh, ch, o.spec.length * 0.5, o.spec.width * 0.5)) return;
      const { nx, nz, depth, px, pz } = HIT;
      const m1 = VEHICLE_MASS[pv.id], m2 = VEHICLE_MASS[o.id];
      // Both are moved clear at once, the lighter one further.
      const mine = m2 / (m1 + m2);
      pv.x += nx * depth * mine;
      pv.z += nz * depth * mine;
      o.x -= nx * depth * (1 - mine);
      o.z -= nz * depth * (1 - mine);
      if (o.mode === "ai") {
        o.shoveX -= nx * depth * (1 - mine);
        o.shoveZ -= nz * depth * (1 - mine);
      }
      const closing = bang(pv, o, nx, nz, px, pz, 0.28);
      if (closing <= 0.1) return;
      o.jolt(-nx, -nz, (closing * m1) / (m1 + m2));
      pv.jolt(nx, nz, (closing * m2) / (m1 + m2));
      if (closing > strongest) {
        strongest = closing;
        this.lastHit = o;
        this.lastHitX = px;
        this.lastHitZ = pz;
      }
    };
    for (const o of this.vehicles) check(o);
    for (const o of this.parked) check(o);
    return strongest;
  }

  /** A new vehicle on the road near a point, out of sight of the player. */
  spawnNear(id: VehicleId, x: number, z: number, reach: number): Vehicle | null {
    if (!this.fleet.available(id)) return null;
    const spec = VEHICLES[id];
    for (let tries = 0; tries < 80; tries++) {
      const lane = this.rng.pick(this.lanesNearby.length && reach < 300 ? this.lanesNearby : this.city.graph.lanes);
      if (lane.raised || lane.index !== lane.laneCount - 1) continue;
      const s = this.rng.range(3, Math.max(4, lane.length - 14));
      pointOn(lane, s, P);
      if (Math.hypot(P.x - x, P.z - z) > reach) continue;
      const dx = P.x - this.playerX, dz = P.z - this.playerZ, d = Math.hypot(dx, dz);
      if (d < 34 || (d < 110 && (dx * this.viewX + dz * this.viewZ) / d > 0.3)) continue;
      if (!this.laneClear(lane, s, spec.length + 3)) continue;
      const before = this.vehicles.length;
      this.spawnFromLane(lane, s, id);
      return this.vehicles.length > before ? this.vehicles[this.vehicles.length - 1] : null;
    }
    return null;
  }

  /** Sitting in a running lane, rather than pulled up at the kerb. */
  standingInLane(v: Vehicle): boolean {
    if (v.impounded || Math.abs(v.y) > 1) return false;
    const road = this.city.layout.roadNameAt(v.x, v.z);
    if (!road) return false;
    // Close into the kerb is parking; further out than that, it's in the way.
    return Math.abs(this.city.layout.kerbDistance(v.x, v.z)) > v.spec.width + 0.6 && !this.city.layout.blockAt(v.x, v.z);
  }

  /** Busy lanes standing at a red light near here. */
  redApproaches(x: number, z: number, reach: number): Lane[] {
    const out: Lane[] = [];
    for (const l of this.lanesNearby) {
      if (l.road.cls === "street" || l.laneCount < 2 || l.index !== 0 || l.raised) continue;
      const n = l.pts.length - 2;
      const ex = l.pts[n], ez = l.pts[n + 1];
      if (Math.abs(ex - x) > reach || Math.abs(ez - z) > reach) continue;
      const c = this.signals.get(l.to.id);
      if (c && c.stateFor(l.heading) === "red") out.push(l);
    }
    return out;
  }

  /** Everything on wheels near the player, for whatever else might get in its way. */
  get nearby(): readonly Vehicle[] {
    return this.close;
  }

  /** Nearest vehicle the player can get into. */
  nearestVehicle(x: number, z: number, maxDist: number, y = 0): Vehicle | null {
    let best: Vehicle | null = null;
    let bd = maxDist;
    for (const list of [this.parked, this.vehicles]) {
      for (const v of list) {
        if (Math.abs(v.y - y) > 2.6) continue;
        const half = v.spec.length * 0.5;
        const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
        const along = clamp((x - v.x) * sh + (z - v.z) * ch, -half, half);
        const cx = v.x + sh * along, cz = v.z + ch * along;
        const d = Math.hypot(x - cx, z - cz) - v.spec.width * 0.5;
        if (d < bd) {
          bd = d;
          best = v;
        }
      }
    }
    return best;
  }

  /** Is anything moving fast near this point? Pedestrians check before stepping off the kerb. */
  roadClearAt(x: number, z: number, range: number): boolean {
    for (const v of this.vehicles) {
      if (v.speed > 1.5 && Math.hypot(v.x - x, v.z - z) < range) return false;
    }
    const pv = this.playerVehicle;
    return !(pv && Math.abs(pv.speed) > 1.5 && Math.hypot(pv.x - x, pv.z - z) < range);
  }

  /** Sends a vehicle back to being ordinary traffic. */
  retire(v: Vehicle): void {
    this.clearDestination(v);
    v.holdTime = 0;
  }

  /** Whatever moving vehicle will reach this spot in the next second or so. */
  bearingDown(x: number, z: number, y: number): Vehicle | null {
    for (const v of this.close) {
      const sp = Math.abs(v.speed);
      if (sp < 0.6 || Math.abs(v.x - x) > 18 || Math.abs(v.z - z) > 18 || Math.abs(v.y - y) > 2.6) continue;
      const sn = Math.sin(v.heading), cs = Math.cos(v.heading);
      const dx = x - v.x, dz = z - v.z;
      const along = (dx * sn + dz * cs) * Math.sign(v.speed), across = dx * cs - dz * sn;
      if (along > -v.spec.length * 0.5 && along < v.spec.length * 0.5 + 1 + sp * 1.1 && Math.abs(across) < v.spec.width * 0.5 + 0.6) return v;
    }
    return null;
  }

  /** The vehicle the last person checked was touching, moving or not. */
  lastTouch: Vehicle | null = null;

  /** Pushes someone on foot out of vehicles. Each one is treated as its whole outline, so nobody ends
   *  up standing inside it, and it goes round twice in case the way out of one leads into another. */
  blockWalker(x: number, z: number, r: number, out: { x: number; z: number }, ignore: Vehicle | null = null, y = 0): void {
    let px = x, pz = z;
    this.lastPush = null;
    this.lastTouch = null;
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const v of this.close) {
        if (v === ignore || Math.abs(v.x - px) > 12 || Math.abs(v.z - pz) > 12 || Math.abs(v.y - y) > 2.6) continue;
        const sn = Math.sin(v.heading), cs = Math.cos(v.heading);
        const dx = px - v.x, dz = pz - v.z;
        const along = dx * sn + dz * cs, across = dx * cs - dz * sn;
        const hl = v.spec.length * 0.5 + r, hw = v.spec.width * 0.5 + r;
        const inA = hl - Math.abs(along), inW = hw - Math.abs(across);
        if (inA <= 0 || inW <= 0) continue;
        // Out by the nearest side. Wedged between two, the only way out is along them.
        if (inW < inA && pass < 2) {
          const sign = across >= 0 ? 1 : -1;
          px += cs * sign * inW;
          pz -= sn * sign * inW;
        } else {
          const sign = along >= 0 ? 1 : -1;
          px += sn * sign * inA;
          pz += cs * sign * inA;
        }
        moved = true;
        this.lastTouch = v;
        if (Math.abs(v.speed) > 1.5) this.lastPush = v;
      }
      if (!moved) break;
    }
    out.x = px;
    out.z = pz;
  }

  /** Takes a vehicle out of traffic control for the player. */
  takeOver(v: Vehicle): void {
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
    const k = this.parked.indexOf(v);
    if (k >= 0) this.parked.splice(k, 1);
    v.connector = null;
    v.lane = null;
    v.nextConnector = null;
    v.inJunction = null;
    v.lateral = 0;
    v.holdTime = 0;
    v.mode = "player";
    this.playerVehicle = v;
  }

  /** The player left it: it stays where it stopped. */
  release(v: Vehicle): void {
    v.mode = "parked";
    // Still rolling a little, it runs on until the brake catches it.
    const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
    v.knockX = sh * v.speed + ch * v.sideSpeed;
    v.knockZ = ch * v.speed - sh * v.sideSpeed;
    v.speed = 0;
    v.sideSpeed = 0;
    this.parked.push(v);
    this.playerVehicle = null;
    if (this.parked.length > 90) {
      for (const p of this.parked) {
        if (p !== v && Math.hypot(p.x - this.playerX, p.z - this.playerZ) > 120) {
          this.parked.splice(this.parked.indexOf(p), 1);
          break;
        }
      }
    }
  }

  /** Every vehicle that should be drawn around this point. The array is reused from frame to frame. */
  visibleVehicles(x: number, z: number, parkedRange: number): Vehicle[] {
    const out = this.visible;
    out.length = 0;
    for (const v of this.vehicles) out.push(v);
    for (const v of this.parked) {
      if (Math.abs(v.x - x) < parkedRange && Math.abs(v.z - z) < parkedRange) out.push(v);
    }
    if (this.playerVehicle) out.push(this.playerVehicle);
    return out;
  }
}

/** Thrown off line by a knock, and still moving from it. */
function thrown(v: Vehicle): boolean {
  return Math.abs(v.knockX) + Math.abs(v.knockZ) + Math.abs(v.spin) > 0.6;
}

/** One knock between two vehicles, from what each weighs and where on each body it lands. The normal
 *  points from b towards a. Returns how fast they came together. */
function bang(a: Vehicle, b: Vehicle, nx: number, nz: number, px: number, pz: number, bounce: number): number {
  const ax = a.velX + a.spin * (pz - a.z), az = a.velZ - a.spin * (px - a.x);
  const bx = b.velX + b.spin * (pz - b.z), bz = b.velZ - b.spin * (px - b.x);
  const rvx = ax - bx, rvz = az - bz;
  const closing = -(rvx * nx + rvz * nz);
  if (closing <= 0.05) return 0;
  const inv = 1 / a.mass + 1 / b.mass;
  const armA = (pz - a.z) * nx - (px - a.x) * nz, armB = (pz - b.z) * nx - (px - b.x) * nz;
  const j = ((1 + (closing > 2.5 ? bounce : 0)) * closing) / (inv + (armA * armA) / a.inertia + (armB * armB) / b.inertia);
  // The two rub against each other as well, and that's most of what sets a glancing blow spinning.
  const tx = -nz, tz = nx;
  const armTA = (pz - a.z) * tx - (px - a.x) * tz, armTB = (pz - b.z) * tx - (px - b.x) * tz;
  const rub = clamp(-(rvx * tx + rvz * tz) / (inv + (armTA * armTA) / a.inertia + (armTB * armTB) / b.inertia), -j * 0.35, j * 0.35);
  const jx = j * nx + rub * tx, jz = j * nz + rub * tz;
  a.push(jx, jz, px, pz);
  b.push(-jx, -jz, px, pz);
  return closing;
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

function pickWeighted<T>(r: Rng, items: [T, number][]): T | null {
  if (!items.length) return null;
  const sum = items.reduce((t, [, w]) => t + w, 0);
  let roll = r.next() * sum;
  for (const [k, w] of items) {
    roll -= w;
    if (roll <= 0) return k;
  }
  return items[items.length - 1][0];
}
