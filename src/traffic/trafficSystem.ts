import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial } from "@babylonjs/core";
import type { City } from "../world/city";
import { Rng } from "../world/cityLayout";
import { CharacterId, DRIVER_IDS, PASSENGER_IDS, characterAvailable } from "../characters/character";
import { TRAFFIC_MIX, VEHICLES, VehicleId } from "../vehicles/vehicleData";
import { Vehicle } from "../vehicles/vehicle";
import { VehicleFleet } from "../vehicles/vehicleLibrary";
import { Connector, Lane, Path, pointOn } from "./laneGraph";
import { LightState, SignalController } from "./signals";

const P = { x: 0, z: 0, dx: 0, dz: 0 };
const Q = { x: 0, z: 0, dx: 0, dz: 0 };
const SPAWN_MIN = 55;
const SPAWN_MAX = 190;
const DESPAWN = 230;
const PROBE_STEP = 2.4;
const DWELL_SECONDS = 7;

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
  private lamps: { red: Mesh; amber: Mesh; green: Mesh } | null = null;
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
  onHorn: ((v: Vehicle) => void) | null = null;
  /** A bus has pulled in at this stop: the people waiting there can board. */
  onBusDwell: ((stopIndex: number, v: Vehicle) => void) | null = null;
  playerVehicle: Vehicle | null = null;
  playerX = 0;
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
      for (const l of g) this.neighbours.set(l, g.filter((o) => Math.abs(o.index - l.index) === 1));
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
    const make = (name: string, c: Color3): Mesh => {
      const m = MeshBuilder.CreateDisc(name, { radius: 0.085, tessellation: 12, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
      const mat = new StandardMaterial(`${name}Mat`, this.scene);
      mat.disableLighting = true;
      mat.emissiveColor = c;
      mat.fogEnabled = false;
      m.material = mat;
      m.isPickable = false;
      return m;
    };
    this.lamps = {
      red: make("lampRed", new Color3(3.2, 0.18, 0.12)),
      amber: make("lampAmber", new Color3(3.0, 1.5, 0.1)),
      green: make("lampGreen", new Color3(0.15, 2.8, 0.75)),
    };
  }

  /** Rebuilds the lit lamps only when a light changes, so it costs almost nothing. */
  private refreshLamps(): void {
    if (!this.lamps) return;
    const buckets: Record<LightState, number[]> = { red: [], amber: [], green: [] };
    const props = this.city.props.get("traffic_light");
    const lens = (state: LightState): { x: number; y: number; z: number } => {
      const m = props?.meshes.find((q) => q.name === `lamp_${state}`);
      if (m) {
        const c = m.getBoundingInfo().boundingBox.center;
        return { x: c.x, y: c.y, z: c.z + 0.07 };
      }
      const yy = state === "red" ? 3.4 : state === "amber" ? 3.15 : 2.9;
      return { x: 0, y: yy, z: 0.1 };
    };
    for (const head of this.city.signalHeads) {
      const ctrl = this.signals.get(head.junction.id);
      if (!ctrl) continue;
      const st = ctrl.stateFor(head.heading);
      const o = lens(st);
      const sa = Math.sin(head.angle), ca = Math.cos(head.angle);
      const wx = head.x + o.x * ca + o.z * sa;
      const wz = head.z - o.x * sa + o.z * ca;
      buckets[st].push(ca, 0, -sa, 0, 0, 1, 0, 0, sa, 0, ca, 0, wx, o.y + 0.16, wz, 1);
    }
    for (const st of ["red", "amber", "green"] as LightState[]) {
      const mesh = this.lamps[st];
      const data = new Float32Array(buckets[st]);
      mesh.thinInstanceSetBuffer("matrix", data.length ? data : null, 16, false);
      mesh.setEnabled(data.length > 0);
      mesh.alwaysSelectAsActiveMesh = true;
    }
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
      if (++count > 100) break;
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
    if (!v.spec.carries) return;
    const seats = v.arch.passengerSeats.length;
    if (!seats) return;
    const fill = v.id === "bus_city" ? r.range(0.5, 1) : v.id === "car_sedan" ? (r.chance(0.3) ? 0.3 : 0) : r.range(0.3, 1);
    const ids = PASSENGER_IDS.filter(characterAvailable);
    if (!ids.length) return;
    for (let s = 0; s < seats; s++) {
      if (r.chance(fill)) v.passengers.push({ id: r.pick(ids), seat: s });
    }
  }

  private spawnFromLane(lane: Lane, s: number, id: VehicleId): void {
    const r = this.rng;
    const v = this.makeVehicle(id, r);
    if (!v) return;
    v.mode = "ai";
    v.lane = lane;
    v.s = s;
    v.nextConnector = lane.out.length ? r.pick(lane.out) : null;
    v.aiTarget = VEHICLES[id].aiSpeed * r.range(0.88, 1.14);
    v.speed = v.aiTarget * 0.7;
    v.driverId = this.driverFor(id);
    this.fillPassengers(v);
    this.poseAI(v, 0.016);
    v.lastYaw = v.heading;
    this.vehicles.push(v);
  }

  private trySpawn(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0 || this.vehicles.length >= this.target) return;
    this.spawnTimer = 0.2;
    const r = this.rng;
    const lanes = this.city.graph.lanes;
    for (let tries = 0; tries < 16; tries++) {
      // Arterials carry most of the traffic, and most of the city's noise and colour.
      const lane = r.chance(0.55) ? r.pick(this.mainLanes) : r.pick(lanes);
      const s = r.range(3, Math.max(4, lane.length - 14));
      pointOn(lane, s, P);
      const d = Math.hypot(P.x - this.playerX, P.z - this.playerZ);
      if (d < SPAWN_MIN || d > SPAWN_MAX) continue;
      const mix = TRAFFIC_MIX[lane.road.cls].filter(([k]) => this.fleet.available(k));
      const id = pickWeighted(r, mix);
      if (!id) return;
      // Slow vehicles and buses keep to the kerb lane; only faster ones use the inner lanes.
      const spec = VEHICLES[id];
      const kerbOnly = spec.aiSpeed < 6 || id === "bus_city" || id === "truck";
      if (kerbOnly && lane.index !== lane.laneCount - 1) continue;
      if (!this.laneClear(lane, s, spec.length + 10)) continue;
      this.spawnFromLane(lane, s, id);
      return;
    }
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
    this.occupancy.clear();
    for (const v of this.vehicles) {
      if (v.inJunction !== null) {
        const axis = v.connector ? v.connector.lane.heading % 2 : 0;
        const o = this.occupancy.get(v.inJunction);
        if (o) o.count++;
        else this.occupancy.set(v.inJunction, { axis, count: 1 });
      }
      v.updateDoor(dt);
    }
    for (const p of this.parked) p.updateDoor(dt);
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (v.mode !== "ai") {
        this.vehicles.splice(i, 1);
        continue;
      }
      const d = Math.hypot(v.x - this.playerX, v.z - this.playerZ);
      if (!v.playerAboard && (d > DESPAWN || (v.stuckTime > 22 && d > 45))) {
        this.vehicles.splice(i, 1);
        continue;
      }
      this.stepAI(v, dt, d);
    }
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
    const reach = 8 + v.speed * 2.8;
    const halfW = v.spec.width * 0.5 + 0.12;
    this.scanBest = Infinity;
    this.scanSpeed = 0;
    const steps = Math.min(Math.ceil(reach / PROBE_STEP), 78);
    const probes = this.probes;
    for (let i = 0; i <= steps; i++) {
      this.routePoint(v, nose + i * PROBE_STEP, Q);
      probes[i * 2] = Q.x;
      probes[i * 2 + 1] = Q.z;
    }
    this.scanSteps = steps;
    this.scanHalf = halfW;
    const near = reach + 12;
    if (v.ghostTime <= 0) {
      for (const o of this.vehicles) {
        if (o === v || Math.abs(o.x - v.x) > near || Math.abs(o.z - v.z) > near) continue;
        const sh = Math.sin(o.heading), ch = Math.cos(o.heading);
        const closing = Math.max(0, o.speed * (sh * Math.sin(v.heading) + ch * Math.cos(v.heading)));
        for (const off of o.spec.circles) this.probe(o.x + sh * off, o.z + ch * off, o.spec.radius, closing);
      }
      for (const o of this.parked) {
        if (Math.abs(o.x - v.x) > near || Math.abs(o.z - v.z) > near) continue;
        const sh = Math.sin(o.heading), ch = Math.cos(o.heading);
        for (const off of o.spec.circles) this.probe(o.x + sh * off, o.z + ch * off, Math.min(o.spec.width / 2, o.spec.radius), 0);
      }
    }
    if (!v.playerAboard) this.probe(this.playerX, this.playerZ, this.playerRadius, 0);
    const pv = this.playerVehicle;
    if (pv && pv !== v) {
      const sh = Math.sin(pv.heading), ch = Math.cos(pv.heading);
      for (const off of pv.spec.circles) this.probe(pv.x + sh * off, pv.z + ch * off, pv.spec.radius, Math.max(0, pv.speed));
    }
    for (const b of this.pedestrianBlockers) {
      if (Math.abs(b.x - v.x) < near && Math.abs(b.z - v.z) < near) this.probe(b.x, b.z, 0.5, 0);
    }
    v.leadGap = this.scanBest;
    v.leadSpeed = this.scanSpeed;
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
    const a = Math.max(spec.accel * 0.75, 1.2);
    const b = 3.2;
    const heavy = spec.id === "bus_city" || spec.id === "truck";
    const s0 = heavy ? 2.2 : 1.3;
    const T = heavy ? 1.2 : 0.85;
    const free = 1 - Math.pow(Math.min(v.speed / Math.max(wanted, 0.1), 2), 4);
    if (!isFinite(gap)) return a * free;
    const dv = v.speed - leadSpeed;
    const sStar = s0 + Math.max(0, v.speed * T + (v.speed * dv) / (2 * Math.sqrt(a * b)));
    const g = Math.max(gap, 0.05);
    return a * (free - (sStar / g) * (sStar / g));
  }

  private stepAI(v: Vehicle, dt: number, playerDist: number): void {
    const lane = v.lane;
    if (!v.connector && lane && !v.nextConnector) v.nextConnector = lane.out.length ? this.rng.pick(lane.out) : null;

    // Vehicles far from the player look ahead less often; nobody can tell, and it saves time.
    v.scanTimer -= dt;
    if (v.scanTimer <= 0) {
      v.scanTimer = playerDist < 70 ? 0 : 0.15;
      this.scanAhead(v);
    }
    let wanted = v.aiTarget;
    if (v.connector) wanted = Math.min(wanted, v.connector.junction.isPlaza ? 6.5 : v.connector.turn === 0 ? wanted : 5);
    let accel = this.idm(v, wanted, v.leadGap, v.leadSpeed);

    const nose = this.noseFromRear(v);
    if (!v.connector && lane) {
      const toStop = lane.length - v.s - nose;
      const j = lane.to;
      const ctrl = this.signals.get(j.id);
      if (ctrl) {
        const st = ctrl.stateFor(lane.heading);
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
      if (v.id === "bus_city") accel = Math.min(accel, this.busStopBrake(v, wanted, lane, nose));
      this.considerLaneChange(v, lane);
    }
    if (v.holdTime > 0) {
      v.holdTime -= dt;
      accel = Math.min(accel, this.idm(v, wanted, Math.max(0.05, v.speed * v.speed * 0.2), 0));
    }

    // Dhaka manners: lean on the horn when blocked.
    v.hornCooldown -= dt;
    const blocked = v.leadGap < 4 && v.speed < 1 && v.holdTime <= 0;
    if (blocked) v.stuckTime += dt;
    else v.stuckTime = Math.max(0, v.stuckTime - dt * 3);
    if (blocked && v.stuckTime > 1.6 && v.hornCooldown <= 0 && playerDist < 70 && this.onHorn) {
      v.hornCooldown = this.rng.range(2.5, 7);
      this.onHorn(v);
    }
    // Two vehicles nose to nose in a junction: let one creep through rather than wait forever.
    if (v.stuckTime > 7 && v.inJunction !== null) v.ghostTime = 2.5;
    if (v.ghostTime > 0) v.ghostTime -= dt;

    accel = clamp(accel, -7, Math.max(v.spec.accel, 1.2));
    v.speed = Math.max(0, v.speed + accel * dt);
    v.s += v.speed * dt;

    const path: Path = v.connector ?? v.lane!;
    if (v.s >= path.length) this.advance(v, path.length);
    v.lateral *= Math.exp(-dt * 0.95);
    if (Math.abs(v.lateral) < 0.01) v.lateral = 0;
    this.poseAI(v, dt, accel);
  }

  /** Places the body on the route by its axles, so a long bus swings out through a corner the
   *  way a real one does instead of sliding along a line. */
  private poseAI(v: Vehicle, dt: number, accel = 0): void {
    const wb = Math.max(v.arch.frontAxleZ - v.arch.rearAxleZ, 0.8);
    this.routePoint(v, 0, P);
    this.routePoint(v, wb, Q);
    let dx = Q.x - P.x, dz = Q.z - P.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const rearZ = v.arch.rearAxleZ;
    // A lane change is a sideways drift easing to zero; the nose points where it's heading.
    const latVel = -0.95 * v.lateral;
    const steerIn = Math.atan2(latVel, Math.max(v.speed, 2));
    const left = v.lateral;
    const x = P.x - dx * rearZ - dz * left + v.shoveX;
    const z = P.z - dz * rearZ + dx * left + v.shoveZ;
    v.shoveX *= Math.exp(-dt * 2.2);
    v.shoveZ *= Math.exp(-dt * 2.2);
    const heading = Math.atan2(dx, dz) - steerIn;
    let dh = heading - v.lastYaw;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const yawRate = dt > 0 ? dh / dt : 0;
    v.lastYaw = heading;
    // Front wheels show the angle this turn really needs.
    const lock = v.spec.maxSteer;
    const angle = v.speed > 0.3 ? Math.atan((yawRate * wb) / v.speed) : 0;
    v.steerAngle += (clamp(angle / lock, -1, 1) - v.steerAngle) * (1 - Math.exp(-dt * 8));
    v.aiPose(x, z, heading, 0, dt, accel * 0.012, yawRate);
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

  /** Pull out past something slow when the next lane has room, as long as it isn't near the junction. */
  private considerLaneChange(v: Vehicle, lane: Lane): void {
    if (v.lateral !== 0 || v.id === "bus_city" || v.id === "truck" || v.spec.aiSpeed < 6) return;
    if (v.leadGap > 14 || v.leadSpeed > v.aiTarget * 0.7) return;
    if (lane.length - v.s < 22 || v.s < 6) return;
    const options = this.neighbours.get(lane);
    if (!options?.length || !this.rng.chance(0.03)) return;
    for (const n of options) {
      if (!this.laneClear(n, v.s, v.spec.length + 6)) continue;
      // Lanes further from the centre are further to the left of the direction of travel.
      v.lateral = -(n.index - lane.index) * 3.3;
      v.lane = n;
      v.nextConnector = n.out.length ? this.rng.pick(n.out) : null;
      return;
    }
  }

  private advance(v: Vehicle, pathLen: number): void {
    const over = v.s - pathLen;
    if (v.connector) {
      v.lane = v.connector.next;
      v.connector = null;
      v.inJunction = null;
      v.nextConnector = v.lane.out.length ? this.rng.pick(v.lane.out) : null;
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
      v.inJunction = next.junction.id;
      v.s = over;
    }
  }

  /** The player's vehicle shoves what it hits, softly. Returns the hit strength. */
  collidePlayerVehicle(pv: Vehicle): number {
    let strongest = 0;
    const check = (o: Vehicle): void => {
      if (o === pv || Math.abs(o.x - pv.x) > 18 || Math.abs(o.z - pv.z) > 18) return;
      for (const a of pv.spec.circles) {
        for (const b of o.spec.circles) {
          const ax = pv.x + Math.sin(pv.heading) * a, az = pv.z + Math.cos(pv.heading) * a;
          const bx = o.x + Math.sin(o.heading) * b, bz = o.z + Math.cos(o.heading) * b;
          const dx = ax - bx, dz = az - bz;
          const d = Math.hypot(dx, dz);
          const rr = pv.spec.radius + o.spec.radius;
          if (d >= rr || d < 1e-4) continue;
          const nx = dx / d, nz = dz / d;
          const depth = rr - d;
          const closing = -(Math.sin(pv.heading) * pv.speed * nx + Math.cos(pv.heading) * pv.speed * nz);
          pv.x += nx * depth * 0.7;
          pv.z += nz * depth * 0.7;
          if (closing > 0) {
            pv.speed *= 0.65;
            strongest = Math.max(strongest, closing);
            const heavy = o.spec.radius > pv.spec.radius ? 0.35 : 1;
            if (o.mode === "ai") {
              o.shoveX -= nx * closing * 0.12 * heavy;
              o.shoveZ -= nz * closing * 0.12 * heavy;
              o.speed *= 0.4;
            } else {
              o.x -= nx * depth * 0.3 * heavy;
              o.z -= nz * depth * 0.3 * heavy;
            }
          }
        }
      }
    };
    for (const o of this.vehicles) check(o);
    for (const o of this.parked) check(o);
    return strongest;
  }

  /** Nearest vehicle the player can get into. */
  nearestVehicle(x: number, z: number, maxDist: number): Vehicle | null {
    let best: Vehicle | null = null;
    let bd = maxDist;
    for (const list of [this.parked, this.vehicles]) {
      for (const v of list) {
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

  /** Push a walking character out of vehicles. */
  blockWalker(x: number, z: number, r: number, out: { x: number; z: number }, ignore: Vehicle | null = null): void {
    let px = x, pz = z;
    for (const list of [this.parked, this.vehicles]) {
      for (const v of list) {
        if (v === ignore || Math.abs(v.x - px) > 12 || Math.abs(v.z - pz) > 12) continue;
        for (const c of v.spec.circles) {
          const cx = v.x + Math.sin(v.heading) * c, cz = v.z + Math.cos(v.heading) * c;
          const dx = px - cx, dz = pz - cz;
          const d = Math.hypot(dx, dz);
          const rr = r + v.spec.radius;
          if (d < rr && d > 1e-4) {
            px = cx + (dx / d) * rr;
            pz = cz + (dz / d) * rr;
          }
        }
      }
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
