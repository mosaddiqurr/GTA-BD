import { AbstractMesh, Scene, Vector3 } from "@babylonjs/core";
import { Character, CharacterId, PEDESTRIAN_IDS, Pose, RUN_CYCLE_M, WALK_CYCLE_M, characterAvailable, outfitsOf } from "../characters/character";
import type { Crowd } from "../characters/crowd";
import type { City, StallSpot } from "../world/city";
import { KERB_H, Rng, roadWidth } from "../world/cityLayout";
import type { Lane } from "../traffic/laneGraph";
import type { RainGear } from "./rainGear";
import type { TrafficSystem } from "../traffic/trafficSystem";
import type { Vehicle } from "../vehicles/vehicle";
import { bn } from "../localization/bn";

type State = "walk" | "idle" | "chat" | "waitCross" | "cross" | "dodge" | "bumped" | "talkToPlayer" | "boardBus" | "leaveVehicle" | "handOver" | "browse" | "atStall" | "look" | "complain" | "returning" | "climbBack" | "hop" | "busSteps";

/** Anyone drawn on foot, whether by the crowd system or as a live character. */
export interface Person {
  id: CharacterId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pose: Pose;
  speed: number;
  offset: number;
  dist: number;
  live: Character | null;
  /** Keep this one as a full character regardless of distance, for scripted moments. */
  forceLive: boolean;
  /** Uses the full bulk model. Holds its state a little past the switching distance, so nobody flickers on the line. */
  lodNear: boolean;
  /** How many times the hero has talked to them. */
  talks: number;
  /** Given the first time anyone asks. */
  personName: string | null;
  /** What they do when it rains: 1 an umbrella, 2 a raincoat, 3 run for it, 0 just get wet. */
  rainHabit?: number;
  /** How big, where that isn't 1: boys on the playing field, and everyone a little different. */
  size?: number;
  /** Which of their outfits they're wearing. */
  outfit?: number;
  /** How far through a step they are, 0..1. Baked walks are driven by this, not by a playback speed:
   *  changing a clip's speed while it plays makes the legs jump, which reads as flicker. */
  phase: number;
}

/** A place on a tea stall's bench. `y` is the height of the sitter's hips. */
export interface TeaSeat {
  x: number;
  y: number;
  z: number;
  yaw: number;
  who: Person | "hero" | null;
}

interface Walker extends Person {
  state: State;
  timer: number;
  walkSpeed: number;
  loop: number;
  wp: number;
  cross: { x0: number; z0: number; x1: number; z1: number; toLoop: number; toWp: number; t: number; len: number } | null;
  vx: number;
  vz: number;
  shouted: number;
  target: { x: number; z: number } | null;
  seat: { x: number; y: number; z: number } | null;
  /** How they were sitting before getting up. */
  seatPose: Pose;
  bus: Vehicle | null;
  /** +1 or -1: which way round the block this person is walking. */
  dir: 1 | -1;
  /** How far to the left of the path's centre they keep, in metres. People keep left, as traffic does. */
  side: number;
  /** Time until this person will complain about being bumped again. */
  bumpCool: number;
  /** Whoever they've stopped to talk with. */
  partner: Walker | null;
  /** The stall they've gone to look at. */
  stall: StallSpot | null;
  /** The vehicle they've climbed out of and will go back to. */
  own: Vehicle | null;
  /** Actual velocity, eased: nobody changes direction in a single frame. */
  mx: number;
  mz: number;
  /** How early they notice a vehicle coming, 0..1. */
  alert: number;
  /** The way up the steps and along the aisle of a bus, in the bus's own space, and how far along. */
  busPath: Vector3[] | null;
  busDone: number;
  /** Getting off, and not on. */
  alighting: boolean;
  /** The seat being gone to. */
  busSeat: number;
  /** Height above the ground during a hop out of the way, and its upward speed. */
  hopY: number;
  hopV: number;
  /** For noticing when someone isn't getting anywhere. */
  lastX: number;
  lastZ: number;
  stallTime: number;
  /** The footpath's full, so they walk in the gutter, out in the edge of the road. */
  spill: boolean;
  /** Running to catch something. */
  hurry: boolean;
}

function isWalker(a: Person): a is Walker {
  return (a as Walker).state !== undefined;
}

/** Ways of getting out of the way, and of being annoyed about it, so a street doesn't move as one. */
const DODGES: Pose[] = ["dodge", "dodge2", "dodge3", "cheer"];
const UPSET: Pose[] = ["shrug", "shrug2", "talk", "idle_look"];

const ACTIVE_RADIUS = 90;
const LIVE_RADIUS = 13;
const LIVE_KEEP = 16; // someone already live stays live until here, so the choice doesn't flip-flop
const LIVE_MAX = 12;
const LOD_IN = 15;
const LOD_OUT = 20;
const PERSON_R = 0.3;
const DRAW_RADIUS = 130;
const GRID_CELL = 3;
const LEAVE_SECONDS = 1.05;
const COMPLAIN_SECONDS = 13;
const STEP_GAP = 1.5; // seconds between one person and the next on the bus steps

/** Fruit people across the district. Most are drawn in bulk by the crowd system; the handful
 *  beside the camera become full characters with smooth blending. Nobody can be hurt. */
export class Pedestrians {
  private walkers: Walker[] = [];
  private fixed: Person[] = [];
  private routed: { who: Person; way: [number, number, number][]; leg: number; t: number; dir: 1 | -1; wait: number; pace: number; hours?: [number, number][]; oneWay?: boolean }[] = [];
  /** The hero's indoors, a long way from any street. */
  frozen = false;
  /** How hard it's raining, and what people have got with them. */
  rain = 0;
  rainGear: RainGear | null = null;
  /** The time of day, for those who only come out at certain hours. */
  hour = 12;
  private vendors = new Map<StallSpot, Person>();
  private teaSeats = new Map<StallSpot, TeaSeat[]>();
  /** Who the hero is talking to, and how to put them back afterwards. */
  private talker: Person | null = null;
  private talkSaved: { state: State; pose: Pose; timer: number; yaw: number } | null = null;
  private faceTarget: { x: number; z: number } | null = null;
  private exchange: { a: Walker; b: Walker; lines: string[]; next: number; wait: number } | null = null;
  private chatterTimer = 6;
  private callTimer = 10;
  /** Stall people reacting for a moment, with the pose to go back to. */
  private startled: { who: Person; pose: Pose; time: number }[] = [];
  /** Everyone near the camera by map square, so looking for neighbours doesn't mean checking everybody. */
  private grid = new Map<number, Walker[]>();
  private dodgeCool = 0;
  /** A vehicle has hit someone. They're fine: they hop aside. */
  onKnocked: ((who: Person, speed: number) => void) | null = null;
  private busQueues: Walker[][] = [];
  private rng = new Rng(1205);
  private target = 24;
  private frame = 0;
  private liveTimer = 0;
  private livePool = new Map<CharacterId, Character[]>();
  private liveCount = 0;
  private sortBuf: Person[] = [];
  private keep = new Set<Person>();
  private speakCool = 0;
  private whistleTimer = 6;
  /** Someone says something out loud, for whoever's near to hear. */
  onLine: ((text: string, who: Person) => void) | null = null;
  /** An officer nearby blows a whistle now and then, from where he stands. */
  onWhistle: ((x: number, z: number) => void) | null = null;

  constructor(private scene: Scene, private city: City, private traffic: TrafficSystem, private crowd: Crowd, private shadow: (m: AbstractMesh) => void) {
    traffic.onBusDwell = (stopIndex, bus) => this.busArrived(stopIndex, bus);
  }

  setTarget(n: number): void {
    this.target = n;
  }

  /** Stall owners, tea drinkers, traffic police and people at bus stops. */
  spawnFixed(): void {
    const r = this.rng;
    const person = (id: CharacterId, x: number, y: number, z: number, yaw: number, pose: Pose): Person => ({ id, x, y, z, yaw, pose, speed: 0, offset: r.next(), dist: 999, live: null, forceLive: false, lodNear: false, talks: 0, personName: null, phase: r.next(), outfit: r.int(0, outfitsOf(id) - 1) });
    const add = (ids: CharacterId[], x: number, y: number, z: number, yaw: number, pose: Pose): Person | null => {
      const usable = ids.filter(characterAvailable);
      if (!usable.length) return null;
      const a = person(r.pick(usable), x, y, z, yaw, pose);
      this.fixed.push(a);
      // People standing at a stall are solid too, so nobody walks through them.
      this.city.collision.addCircle(x, z, PERSON_R, 1.6);
      return a;
    };
    for (const p of this.city.police) add(["npc_police_coconut"], p.x, p.y, p.z, p.yaw, "police");
    for (const s of this.city.stalls) {
      const sn = Math.sin(s.angle), cs = Math.cos(s.angle);
      const spot = this.city.props.anchor(s.prop, "vendor");
      // The vendor stands behind the goods, looking out over them.
      const lx = spot?.x ?? 0, lz = spot?.z ?? -1.1;
      const vx = s.x + lx * cs + lz * sn, vz = s.z - lx * sn + lz * cs;
      const vendor = s.kind === "tea" ? add(["npc_tea_banana"], vx, KERB_H, vz, s.angle, "tea") : add(["npc_vendor_pineapple", "npc_shop_papaya"], vx, KERB_H, vz, s.angle, "idle_look");
      if (vendor) this.vendors.set(s, vendor);
      if (s.kind !== "tea") continue;
      // Customers on the benches, always leaving somewhere for the hero to sit.
      const seats: TeaSeat[] = [];
      this.teaSeats.set(s, seats);
      for (let i = 1; i <= 4; i++) {
        const a = this.city.props.anchor("tea_stall", `seat_${i}`);
        if (!a) continue;
        const sx = s.x + a.x * cs + a.z * sn;
        const sz = s.z - a.x * sn + a.z * cs;
        const yaw = Math.atan2(s.x - sx, s.z - sz);
        const seat: TeaSeat = { x: sx, y: KERB_H + a.y, z: sz, yaw, who: null };
        seats.push(seat);
        if (!r.chance(0.55) || seats.filter((q) => q.who).length >= 3) continue;
        const id = r.pick(PEDESTRIAN_IDS.filter((q) => q !== "npc_tea_banana" && characterAvailable(q)));
        if (!id) continue;
        const customer = person(id, sx, seat.y - this.crowd.hipHeightOf(id), sz, yaw, "sit_bench");
        this.fixed.push(customer);
        seat.who = customer;
      }
    }
    // A queue at every bus stop, who really do climb aboard when a bus pulls in.
    this.city.busStops.forEach((stop, i) => {
      this.busQueues[i] = [];
      const n = r.int(2, 6);
      for (let k = 0; k < n; k++) this.addWaiter(i, stop, k);
    });
  }

  private jamSellers: { who: Person; lane: Lane | null; s: number; dir: number; lineX: number; lineZ: number; ux: number; uz: number; len: number; rest: number }[] = [];

  /** Water bottles, boiled eggs and phone covers, sold between the bumpers while the lights are red. */
  addJamSellers(n: number): void {
    const ids = (["npc_vendor_pineapple", "npc_worker_jackfruit", "npc_commuter_lychee", "npc_shop_papaya"] as CharacterId[]).filter(characterAvailable);
    if (!ids.length) return;
    for (let i = 0; i < n; i++) {
      const who = this.addStanding(this.rng.pick(ids), "walk");
      who.speed = 0.9;
      this.jamSellers.push({ who, lane: null, s: 0, dir: 1, lineX: 0, lineZ: 0, ux: 0, uz: 1, len: 0, rest: this.rng.range(0, 2) });
    }
  }

  private stepJamSellers(dt: number, camX: number, camZ: number): void {
    if (!this.jamSellers.length) return;
    const r = this.rng;
    for (const q of this.jamSellers) {
      const a = q.who;
      if (a === this.talker || a.forceLive) continue;
      q.rest -= dt;
      const signal = q.lane ? this.traffic.signals.get(q.lane.to.id) : null;
      const red = !!q.lane && !!signal && signal.stateFor(q.lane.heading) === "red";
      const far = Math.abs(a.x - camX) > 110 || Math.abs(a.z - camZ) > 110;
      if ((!q.lane || far || !red) && q.rest <= 0) {
        // Off to wherever the traffic's standing still.
        q.rest = r.range(1.5, 4);
        const near = this.traffic.redApproaches(camX, camZ, 95);
        const lane = near.length ? r.pick(near) : null;
        q.lane = lane;
        if (lane) {
          const n = lane.pts.length - 2;
          const ex = lane.pts[n], ez = lane.pts[n + 1];
          const dx = ex - lane.pts[0], dz = ez - lane.pts[1], l = Math.hypot(dx, dz) || 1;
          q.ux = dx / l;
          q.uz = dz / l;
          // Along the white line beside this lane, towards the kerb from it.
          const road = lane.road;
          const sideX = road.axis === "v" ? Math.sign(ex - road.at) : 0, sideZ = road.axis === "h" ? Math.sign(ez - road.at) : 0;
          q.lineX = ex + sideX * 1.65 - q.ux * 8;
          q.lineZ = ez + sideZ * 1.65 - q.uz * 8;
          q.len = Math.min(l - 10, 42);
          q.s = r.range(0, q.len);
          q.dir = r.chance(0.5) ? 1 : -1;
          a.x = q.lineX - q.ux * q.s;
          a.z = q.lineZ - q.uz * q.s;
          a.y = 0;
        } else a.x = a.z = 1e5;
      }
      if (!q.lane) continue;
      if (red) {
        q.s += q.dir * 0.9 * dt;
        if (q.s < 0 || q.s > q.len) q.dir = -q.dir;
        a.x = q.lineX - q.ux * q.s;
        a.z = q.lineZ - q.uz * q.s;
        a.yaw = Math.atan2(-q.ux * q.dir, -q.uz * q.dir);
        a.pose = "walk";
        a.speed = 0.9;
      } else {
        // Green: hop up on to the kerb and wait.
        const road = q.lane.road;
        const half = roadWidth(road) / 2 + 0.7;
        const gx = road.axis === "v" ? road.at + Math.sign(a.x - road.at) * half : a.x;
        const gz = road.axis === "h" ? road.at + Math.sign(a.z - road.at) * half : a.z;
        const dx = gx - a.x, dz = gz - a.z, d = Math.hypot(dx, dz);
        if (d > 0.2) {
          a.x += (dx / d) * 3 * dt;
          a.z += (dz / d) * 3 * dt;
          a.yaw = Math.atan2(dx, dz);
          a.pose = "run";
          a.speed = 3;
        } else {
          a.pose = "stand";
          a.speed = 0;
          a.y = KERB_H;
        }
      }
    }
  }

  /** Stall owners pack up at night and are back in the morning. */
  setStallsOpen(open: boolean): void {
    for (const a of this.vendors.values()) {
      const home = this.vendorHome.get(a) ?? { x: a.x, z: a.z };
      this.vendorHome.set(a, home);
      a.x = open ? home.x : 1e5;
      a.z = open ? home.z : 1e5;
    }
  }

  private vendorHome = new Map<Person, { x: number; z: number }>();

  /** Someone who stands wherever they're put, out of the way until then. */
  addStanding(id: CharacterId, pose: Pose = "idle_look"): Person {
    const a: Person = { id, x: 1e5, y: 0, z: 1e5, yaw: 0, pose, speed: 0, offset: this.rng.next(), dist: 1e5, live: null, forceLive: false, lodNear: false, talks: 0, personName: null, phase: this.rng.next(), outfit: this.rng.int(0, outfitsOf(id) - 1) };
    this.fixed.push(a);
    return a;
  }

  /** Done with someone made for a mission: they stop being anybody. */
  release(a: Person): void {
    this.releaseLive(a);
    const i = this.fixed.indexOf(a);
    if (i >= 0) this.fixed.splice(i, 1);
    const k = this.fixedNear.indexOf(a);
    if (k >= 0) this.fixedNear.splice(k, 1);
  }

  /** People who walk a set way over and back: up the footbridge, or to the station. */
  addRoutes(path: [number, number, number][], count: number, who_: CharacterId[] = ["npc_commuter_lychee", "npc_student_lemon", "npc_office_orange", "npc_worker_jackfruit"], size = 1, hours?: [number, number][]): void {
    const r = this.rng;
    const ids = who_.filter(characterAvailable);
    if (!ids.length) return;
    const across = 0.55;
    for (let i = 0; i < count; i++) {
      const side = r.range(-across, across);
      // Keeps the same distance to one side all the way along.
      const way = path.map((q): [number, number, number] => [q[0] + side, q[1], q[2] + side * 0.6]);
      const who: Person = { id: r.pick(ids), x: way[0][0], y: way[0][1], z: way[0][2], yaw: 0, pose: "walk", speed: 1.3, offset: r.next(), dist: 999, live: null, forceLive: false, lodNear: false, talks: 0, personName: null, phase: r.next(), size, rainHabit: r.next() < 0.45 ? 1 : r.next() < 0.3 ? 2 : 0 };
      who.outfit = r.int(0, outfitsOf(who.id) - 1);
      this.fixed.push(who);
      // Going home at the end of a shift is one way only, and they're gone when it's over.
      if (hours) {
        who.x = who.z = 1e5;
        this.routed.push({ who, way, leg: 0, t: 0, dir: 1, wait: r.range(0, 28), pace: r.range(1.25, 1.7), hours, oneWay: true });
      } else this.routed.push({ who, way, leg: r.int(0, way.length - 2), t: r.next(), dir: r.chance(0.5) ? 1 : -1, wait: 0, pace: r.range(1.1, 1.5) });
    }
  }

  private withinHours(hours: [number, number][]): boolean {
    for (const w of hours) if (this.hour >= w[0] && this.hour <= w[1]) return true;
    return false;
  }

  private stepRoutes(dt: number, camX: number, camZ: number): void {
    for (const q of this.routed) {
      const a = q.who;
      if (a === this.talker || a.forceLive) continue;
      if (q.hours) {
        // The door may be well back from the gate, so either end of the first stretch will do.
        const d0 = q.way[0], d1 = q.way[1];
        if ((Math.abs(d0[0] - camX) > 220 || Math.abs(d0[2] - camZ) > 220) && (Math.abs(d1[0] - camX) > 220 || Math.abs(d1[2] - camZ) > 220)) {
          q.leg = 0;
          q.t = 0;
          a.x = a.z = 1e5;
          continue;
        }
        // Anyone already on their way when the time's up finishes the walk.
        if (q.leg === 0 && q.t === 0 && !this.withinHours(q.hours)) {
          a.x = a.z = 1e5;
          continue;
        }
        if (q.wait > 0) {
          q.wait -= dt;
          a.x = a.z = 1e5;
          continue;
        }
      } else if (Math.abs(a.x - camX) > 170 || Math.abs(a.z - camZ) > 170) continue;
      if (q.wait > 0) {
        q.wait -= dt;
        a.speed = 0;
        a.pose = "stand";
        continue;
      }
      const from = q.way[q.leg], to = q.way[q.leg + 1];
      const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
      const flat = Math.hypot(dx, dz) || 0.01;
      q.t += (q.dir * q.pace * dt) / Math.hypot(flat, dy);
      if (q.t > 1 || q.t < 0) {
        q.leg += q.dir;
        q.t = q.dir > 0 ? 0 : 1;
        if (q.oneWay && q.leg > q.way.length - 2) {
          q.leg = 0;
          q.t = 0;
          q.wait = this.rng.range(0.4, 14);
          continue;
        }
        if (q.leg < 0 || q.leg > q.way.length - 2) {
          // At the end: a moment's pause, and back the other way.
          q.dir = q.dir > 0 ? -1 : 1;
          q.leg = Math.max(0, Math.min(q.way.length - 2, q.leg));
          q.t = q.dir > 0 ? 0 : 1;
          q.wait = this.rng.range(1.5, 7);
        }
        continue;
      }
      a.x = from[0] + dx * q.t;
      a.y = from[1] + dy * q.t;
      a.z = from[2] + dz * q.t;
      a.yaw = Math.atan2(dx * q.dir, dz * q.dir);
      a.speed = q.pace;
      a.pose = "walk";
    }
  }

  /** Standing at their post, rather than out and about. */
  atWork(a: Person): boolean {
    return !isWalker(a);
  }

  /** The person minding a stall. */
  vendorOf(stall: StallSpot): Person | null {
    return this.vendors.get(stall) ?? null;
  }

  /** The nearest empty place on a stall's bench. */
  freeSeat(stall: StallSpot, x: number, z: number): TeaSeat | null {
    let best: TeaSeat | null = null, bd = Infinity;
    for (const seat of this.teaSeats.get(stall) ?? []) {
      const d = Math.hypot(seat.x - x, seat.z - z);
      if (!seat.who && d < bd) {
        bd = d;
        best = seat;
      }
    }
    return best;
  }

  /** Whoever's sitting closest to this place on the same bench. */
  neighbourOf(stall: StallSpot, seat: TeaSeat): Person | null {
    let best: Person | null = null, bd = Infinity;
    for (const q of this.teaSeats.get(stall) ?? []) {
      if (q === seat || !q.who || q.who === "hero") continue;
      const d = Math.hypot(q.x - seat.x, q.z - seat.z);
      if (d < bd) {
        bd = d;
        best = q.who;
      }
    }
    return best;
  }

  private addWaiter(stopIndex: number, stop: { x: number; z: number; angle: number }, slot: number): void {
    const r = this.rng;
    const options = PEDESTRIAN_IDS.filter(characterAvailable);
    if (!options.length) return;
    const ca = Math.cos(stop.angle), sa = Math.sin(stop.angle);
    const along = -1.2 + slot * 0.95 + r.range(-0.2, 0.2);
    const out = r.range(0.2, 1.0);
    const x = stop.x + along * ca + out * sa;
    const z = stop.z - along * sa + out * ca;
    const w = this.newWalker(r.pick(options), x, z);
    w.state = "idle";
    w.timer = 1e9;
    w.pose = r.chance(0.5) ? "stand" : "idle_look";
    w.yaw = stop.angle + r.range(-0.5, 0.5);
    this.walkers.push(w);
    this.busQueues[stopIndex].push(w);
  }

  private newWalker(id: CharacterId, x: number, z: number): Walker {
    const r = this.rng;
    return {
      id, x, z, y: KERB_H, yaw: r.range(0, 6.28), pose: "walk", speed: 0, offset: r.next(), dist: 999, live: null, forceLive: false, lodNear: false, talks: 0, personName: null, phase: r.next(),
      rainHabit: r.next() < 0.42 ? 1 : r.next() < 0.3 ? 2 : r.next() < 0.45 ? 3 : 0,
      // Nobody is quite the same height, and most people own more than one shirt.
      size: r.range(0.93, 1.08), outfit: r.int(0, outfitsOf(id) - 1),
      state: "walk", timer: r.range(4, 20), walkSpeed: r.range(1.05, 1.55), loop: 0, wp: 0, cross: null, vx: 0, vz: 0, shouted: 0,
      target: null, seat: null, seatPose: "stand", bus: null,
      dir: r.chance(0.5) ? 1 : -1, side: r.range(0.1, 1.5), bumpCool: 0, partner: null, stall: null, own: null, mx: 0, mz: 0, alert: r.next(), hopY: 0, hopV: 0, busPath: null, busDone: 0, alighting: false, busSeat: -1, lastX: x, lastZ: z, stallTime: 0, spill: false, hurry: false,
    };
  }

  /** People get off first, down the steps one at a time, then those waiting climb on. */
  private busArrived(stopIndex: number, bus: Vehicle): void {
    const queue = this.busQueues[stopIndex];
    if (!queue) return;
    const r = this.rng;
    const door = bus.worldPoint(bus.arch.exitLeft);
    const off = Math.min(r.int(0, 3), bus.passengers.filter((p) => !p.hidden).length);
    let boarding = 0;
    for (const w of queue) {
      if (w.state === "idle" && boarding < 5 && bus.freeSeats + off > boarding) {
        w.state = "boardBus";
        w.bus = bus;
        w.target = { x: door.x, z: door.z };
        // Waits for the door to clear: those getting off go first, then one at a time.
        w.timer = 14;
        w.hopY = (off + boarding) * STEP_GAP;
        boarding++;
      }
    }
    // Anyone on the street nearby who wants this bus sees it and runs.
    let runners = 0;
    for (const w of this.walkers) {
      if (runners >= 3 || w.state !== "walk" || Math.abs(w.x - door.x) > 26 || Math.abs(w.z - door.z) > 26) continue;
      if (!r.chance(0.2) || bus.freeSeats + off <= boarding) continue;
      w.state = "boardBus";
      w.bus = bus;
      w.hurry = true;
      w.target = { x: door.x, z: door.z };
      w.timer = 14;
      w.hopY = (off + boarding) * STEP_GAP;
      boarding++;
      runners++;
    }
    for (let i = 0; i < off; i++) this.alightQueue.push({ bus, wait: 0.5 + i * STEP_GAP });
    bus.holdTime = Math.max(bus.holdTime, 3.5 + (off + boarding) * STEP_GAP);
    if (bus.dist < 45) this.onBusCalling?.(bus);
    // More people drift to the stop after the bus has gone.
    const stop = this.city.busStops[stopIndex];
    if (queue.length - boarding < 4) this.addWaiter(stopIndex, stop, queue.length);
  }

  private alightQueue: { bus: Vehicle; wait: number }[] = [];
  /** A bus has pulled in close by, and its conductor is shouting the route. */
  onBusCalling: ((bus: Vehicle) => void) | null = null;

  /** The way between the door and a seat, in the bus's own space, from the ground up. */
  private busWay(bus: Vehicle, seatIndex: number, hip: number): Vector3[] {
    const door = bus.arch.exitLeft;
    const seat = bus.arch.passengerSeats[seatIndex];
    const side = Math.sign(door.x) || -1;
    const floor = seat.position.y - hip - 0.04;
    return [
      new Vector3(door.x, 0, door.z),
      new Vector3(side * 0.95, floor * 0.45, door.z),
      new Vector3(side * 0.2, floor, door.z),
      new Vector3(0, floor, seat.position.z),
      new Vector3(seat.position.x, floor + 0.04, seat.position.z),
    ];
  }

  private stepAlighting(dt: number): void {
    for (let i = this.alightQueue.length - 1; i >= 0; i--) {
      const q = this.alightQueue[i];
      q.wait -= dt;
      if (q.wait > 0) continue;
      this.alightQueue.splice(i, 1);
      const bus = q.bus;
      const k = bus.passengers.findIndex((p) => !p.hidden);
      if (k < 0 || bus.speed > 0.5) continue;
      const rider = bus.passengers.splice(k, 1)[0];
      const w = this.newWalker(rider.id, bus.x, bus.z);
      w.state = "busSteps";
      w.bus = bus;
      w.alighting = true;
      w.busPath = this.busWay(bus, rider.seat, this.crowd.hipHeightOf(rider.id)).reverse();
      w.busDone = 0;
      w.pose = "walk";
      this.walkers.push(w);
    }
  }

  /** Up or down the steps of a bus, a walk along the aisle, and into a seat or off into the street. */
  private stepBusSteps(w: Walker, dt: number, r: Rng): void {
    const bus = w.bus!;
    const path = w.busPath!;
    w.busDone += (dt * 1.5) / 1;
    let left = w.busDone;
    let i = 0;
    while (i < path.length - 1) {
      const len = Vector3.Distance(path[i], path[i + 1]);
      if (left <= len) break;
      left -= len;
      i++;
    }
    if (i >= path.length - 1) {
      if (w.alighting) {
        // Down on the footpath, an ordinary pedestrian again.
        const end = bus.worldPoint(path[path.length - 1]);
        w.x = end.x;
        w.z = end.z;
        w.y = this.city.layout.groundHeight(end.x, end.z);
        w.bus = null;
        w.busPath = null;
        w.alighting = false;
        w.hopY = 0;
        this.backToWalking(w, r);
        return;
      }
      if (w.busSeat >= 0) bus.passengers.push({ id: w.id, seat: w.busSeat });
      this.removeWalker(w);
      return;
    }
    const a = path[i], b = path[i + 1];
    const len = Vector3.Distance(a, b) || 1;
    const t = left / len;
    const lx = a.x + (b.x - a.x) * t, ly = a.y + (b.y - a.y) * t, lz = a.z + (b.z - a.z) * t;
    const p = bus.worldPoint(ZERO_POINT.set(lx, ly, lz));
    w.x = p.x;
    w.y = p.y;
    w.z = p.z;
    const sh = Math.sin(bus.heading), ch = Math.cos(bus.heading);
    const dx = b.x - a.x, dz = b.z - a.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.02) w.yaw = turn(w.yaw, Math.atan2(dz * sh + dx * ch, dz * ch - dx * sh), dt * 10);
    w.pose = "walk";
    w.speed = 1.5;
  }

  private removeWalker(w: Walker): void {
    this.releaseLive(w);
    for (const q of this.busQueues) {
      const k = q.indexOf(w);
      if (k >= 0) q.splice(k, 1);
    }
    const k = this.walkers.indexOf(w);
    if (k >= 0) this.walkers.splice(k, 1);
  }

  private attachToNearestLoop(w: Walker): void {
    let best = 0, bd = Infinity;
    this.city.walkLoops.forEach((l, i) => {
      const b = l.block;
      const d = Math.hypot(Math.max(b.x0 - w.x, 0, w.x - b.x1), Math.max(b.z0 - w.z, 0, w.z - b.z1));
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    w.loop = best;
    const pts = this.city.walkLoops[best].pts;
    let wp = 0, wd = Infinity;
    for (let k = 0; k < pts.length / 2; k++) {
      const d = Math.hypot(pts[k * 2] - w.x, pts[k * 2 + 1] - w.z);
      if (d < wd) {
        wd = d;
        wp = k;
      }
    }
    w.wp = wp;
  }

  private spawnWalker(px: number, pz: number, anywhere: boolean): void {
    const r = this.rng;
    const options = PEDESTRIAN_IDS.filter(characterAvailable);
    if (!options.length) return;
    const nearby: number[] = [];
    this.city.walkLoops.forEach((l, i) => {
      const b = l.block;
      const d = Math.hypot(Math.max(b.x0 - px, 0, px - b.x1), Math.max(b.z0 - pz, 0, pz - b.z1));
      if (d < ACTIVE_RADIUS * 0.85 && b.kind !== "terminal") {
        nearby.push(i);
        // Busy streets get more people: the arterials are the crowded ones.
        if (b.kind === "commercial" || b.kind === "market") nearby.push(i, i);
      }
    });
    if (!nearby.length) return;
    const loop = r.pick(nearby);
    const pts = this.city.walkLoops[loop].pts;
    const n = pts.length / 2;
    const wp = r.int(0, n - 1);
    const nxt = (wp + 1) % n;
    const t = r.next();
    const x = pts[wp * 2] + (pts[nxt * 2] - pts[wp * 2]) * t;
    const z = pts[wp * 2 + 1] + (pts[nxt * 2 + 1] - pts[wp * 2 + 1]) * t;
    const away = Math.hypot(x - px, z - pz);
    // Don't let anyone appear from thin air right beside the player, or waste them far away.
    if ((!anywhere && away < 45) || away > ACTIVE_RADIUS) return;
    const w = this.newWalker(r.pick(options), x, z);
    w.loop = loop;
    w.wp = w.dir > 0 ? nxt : wp;
    // Where hawkers have the footpath, people walk in the road.
    const kind = this.city.walkLoops[loop].block.kind;
    const crush = (this.city.region.style?.clutter ?? 1) * (kind === "market" ? 0.34 : kind === "commercial" || kind === "coaching" ? 0.17 : kind === "dense" ? 0.08 : 0);
    w.spill = r.chance(crush);
    this.walkers.push(w);
    // Friends stop to talk: a second person standing with them, facing them.
    if (r.chance(0.16)) {
      const partner = this.newWalker(r.pick(options), x + r.range(0.7, 1), z + r.range(-0.6, 0.6));
      partner.loop = loop;
      partner.wp = partner.dir > 0 ? nxt : wp;
      for (const q of [w, partner]) {
        q.state = "chat";
        q.pose = "talk";
        q.timer = r.range(14, 40);
      }
      w.yaw = Math.atan2(partner.x - w.x, partner.z - w.z);
      partner.yaw = w.yaw + Math.PI;
      w.partner = partner;
      partner.partner = w;
      partner.timer = w.timer;
      this.walkers.push(partner);
    }
  }

  /** Fills the streets at once, used while the game loads. */
  populate(px: number, pz: number): void {
    const queued = this.walkers.length;
    for (let i = 0; i < this.target * 3 && this.walkers.length - queued < this.target; i++) this.spawnWalker(px, pz, true);
  }

  update(dt: number, px: number, pz: number, pv: Vehicle | null, playerSpeed: number, camX: number, camZ: number, dirX: number, dirZ: number): void {
    this.frame++;
    // Indoors the street waits where it is, and only whoever's in the room gets drawn.
    if (this.frozen) {
      this.turnFixedTalker(dt, px, pz);
      this.assignLive(dt, camX, camZ);
      this.draw(dt, camX, camZ, dirX, dirZ);
      return;
    }
    // People queueing at distant stops don't count towards the crowd on the streets around the player.
    let free = 0;
    for (const w of this.walkers) if (!this.isQueued(w)) free++;
    if (free < this.target) {
      // Quicker when the street is well short of people, such as when the slider has just gone up.
      const fill = free < this.target - 60 ? 5 : 1;
      for (let i = 0; i < fill; i++) this.spawnWalker(px, pz, false);
    } else if (free > this.target + 4) this.trimFurthest();
    if (this.speakCool > 0) this.speakCool -= dt;
    if (this.dodgeCool > 0) this.dodgeCool -= dt;
    this.policeWhistles(dt, camX, camZ);
    this.chatter(dt);
    this.stepStartled(dt);
    this.stepAlighting(dt);
    const blockers = this.traffic.pedestrianBlockers;
    blockers.length = 0;
    const r = this.rng;
    this.buildGrid(camX, camZ);
    if (pv) this.knockFromVehicle(pv, playerSpeed);
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i];
      w.dist = Math.hypot(w.x - camX, w.z - camZ);
      if (w.dist > ACTIVE_RADIUS * 1.35 && w.state !== "leaveVehicle" && w.state !== "busSteps" && !w.forceLive && !w.own && !this.isQueued(w)) {
        this.releaseLive(w);
        this.walkers.splice(i, 1);
        continue;
      }
      // Distant people decide what to do less often; nobody can tell. They still move every frame.
      const every = w.dist < 30 || w.state === "cross" ? 1 : w.dist < 60 ? 2 : 4;
      if (every === 1 || (i + this.frame) % every === 0) this.stepWalker(w, dt * every, px, pz, pv, playerSpeed, r);
      if (w.state === "walk") {
        w.x += w.mx * dt;
        w.z += w.mz * dt;
        this.watchStall(w, dt);
      }
      // Anyone out on the carriageway is something for drivers to brake for.
      if (w.state === "cross" || (w.spill && w.state === "walk" && w.dist < 90)) blockers.push({ x: w.x, z: w.z });
    }
    this.stepRoutes(dt, camX, camZ);
    this.stepJamSellers(dt, camX, camZ);
    this.turnFixedTalker(dt, px, pz);
    this.assignLive(dt, camX, camZ);
    this.draw(dt, camX, camZ, dirX, dirZ);
  }

  /** Someone walking who hasn't got anywhere for a moment has been aiming at a spot they can't reach:
   *  behind a stall, inside a crowd. They give up on it and head for the next one, closer to the line. */
  private watchStall(w: Walker, dt: number): void {
    w.stallTime += dt;
    if (w.stallTime < 1.2) return;
    const moved = Math.hypot(w.x - w.lastX, w.z - w.lastZ);
    w.lastX = w.x;
    w.lastZ = w.z;
    w.stallTime = 0;
    if (moved > 0.5) return;
    const n = this.city.walkLoops[w.loop].pts.length / 2;
    w.wp = (w.wp + w.dir + n) % n;
    w.side *= 0.4;
    w.mx = w.mz = 0;
  }

  /** When the crowd setting comes down, people leave from the edge of what can be seen. */
  private trimFurthest(): void {
    let far = -1, best = 45;
    for (let i = 0; i < this.walkers.length; i++) {
      const w = this.walkers[i];
      if (this.isQueued(w) || w.forceLive || w.live || w.own) continue;
      if (w.dist > best) {
        best = w.dist;
        far = i;
      }
    }
    if (far >= 0) this.walkers.splice(far, 1);
  }

  private policeWhistles(dt: number, camX: number, camZ: number): void {
    this.whistleTimer -= dt;
    if (this.whistleTimer > 0) return;
    this.whistleTimer = this.rng.range(9, 22);
    for (const p of this.city.police) {
      if (Math.hypot(p.x - camX, p.z - camZ) < 55) {
        this.onWhistle?.(p.x, p.z);
        return;
      }
    }
  }

  private isQueued(w: Walker): boolean {
    return w.state === "idle" && w.timer > 1e6;
  }

  private draw(dt: number, camX: number, camZ: number, dirX: number, dirZ: number): void {
    this.rainGear?.begin();
    const crowd = this.crowd;
    const one = (a: Person): void => {
      if (a.live) {
        const c = a.live;
        c.speed = a.speed;
        if (c.pose !== a.pose) c.setPose(a.pose);
        c.place(a.x, a.y, a.z, a.yaw);
        c.root.scaling.setAll(a.size ?? 1);
        c.setDetail(a.dist);
        // Up close they're a full model, so the rain gear has to come out here as well.
        const wet = this.rain > 0.12;
        c.umbrellaUp = wet && a.pose === "walk" && a.rainHabit === 1;
        if (c.umbrellaUp) this.rainGear?.add(a, c.handPosition(-1, HAND));
        else if (wet && a.rainHabit === 2 && (a.pose === "walk" || a.pose === "run")) this.rainGear?.add(a);
        c.update(dt);
        return;
      }
      if (a.dist > DRAW_RADIUS) return;
      const dx = a.x - camX, dz = a.z - camZ;
      if (a.dist > 16 && dx * dirX + dz * dirZ < -6) return;
      if (a.lodNear ? a.dist > LOD_OUT : a.dist < LOD_IN) a.lodNear = !a.lodNear;
      // In the rain the umbrella comes out, and that's a walk with one arm up.
      if (a.pose === "walk" && this.rain > 0.12 && a.rainHabit === 1) {
        a.phase += (a.speed / WALK_CYCLE_M) * dt;
        a.phase -= Math.floor(a.phase);
        crowd.add(a.id, a.x, a.y, a.z, a.yaw, "walk_u", a.lodNear, 0, a.phase, a.size, a.outfit);
        this.rainGear?.add(a);
      } else if (a.pose === "walk" || a.pose === "run") {
        if (this.rain > 0.12 && a.rainHabit === 2) this.rainGear?.add(a);
        // Feet match the ground, by position in the step rather than by playback speed.
        a.phase += (a.speed / (a.pose === "walk" ? WALK_CYCLE_M : RUN_CYCLE_M)) * dt;
        a.phase -= Math.floor(a.phase);
        crowd.add(a.id, a.x, a.y, a.z, a.yaw, a.pose, a.lodNear, 0, a.phase, a.size, a.outfit);
      } else crowd.add(a.id, a.x, a.y, a.z, a.yaw, a.pose, a.lodNear, 1, a.offset, a.size, a.outfit);
    };
    // Thousands stand at their stalls across the district, and only a few hundred are ever in range.
    this.fixedTimer -= dt;
    if (this.fixedTimer <= 0) {
      this.fixedTimer = 0.3;
      this.fixedNear.length = 0;
      for (const a of this.fixed) if (a.live || a.forceLive || (Math.abs(a.x - camX) < DRAW_RADIUS + 25 && Math.abs(a.z - camZ) < DRAW_RADIUS + 25)) this.fixedNear.push(a);
    }
    for (const a of this.fixedNear) {
      a.dist = Math.hypot(a.x - camX, a.z - camZ);
      one(a);
    }
    for (const w of this.walkers) one(w);
  }

  private fixedNear: Person[] = [];
  private fixedTimer = 0;

  /** Gives the nearest handful a full skeleton, so they blend smoothly right beside the camera. */
  private assignLive(dt: number, camX: number, camZ: number): void {
    this.liveTimer -= dt;
    if (this.liveTimer > 0) return;
    this.liveTimer = 0.2;
    const near = this.sortBuf;
    near.length = 0;
    for (const a of this.fixed) {
      a.dist = Math.hypot(a.x - camX, a.z - camZ);
      if (a.dist < (a.live ? LIVE_KEEP : LIVE_RADIUS) || a.forceLive) near.push(a);
    }
    for (const w of this.walkers) if (w.dist < (w.live ? LIVE_KEEP : LIVE_RADIUS) || w.forceLive) near.push(w);
    // Whoever is already live gets a head start, so two people at similar distances don't keep swapping.
    const score = (a: Person): number => a.dist - (a.live ? 3 : 0);
    near.sort((p, q) => Number(q.forceLive) - Number(p.forceLive) || score(p) - score(q));
    const keep = this.keep;
    keep.clear();
    for (let i = 0; i < Math.min(near.length, LIVE_MAX); i++) keep.add(near[i]);
    const release = (a: Person): void => {
      if (a.live && !keep.has(a)) this.releaseLive(a);
    };
    this.fixed.forEach(release);
    this.walkers.forEach(release);
    let made = 0;
    for (const a of keep) {
      if (a.live) continue;
      // Pool first; creating a new skeleton is the one thing here that costs real time.
      const pool = this.livePool.get(a.id);
      let c = pool?.pop();
      if (!c) {
        if (made > 0) continue;
        made++;
        c = new Character(a.id, this.scene, this.shadow);
      }
      c.setEnabled(true);
      c.setOutfit(a.outfit ?? 0);
      c.setPose(a.pose);
      c.setPhase(a.pose === "walk" || a.pose === "run" ? a.phase : this.crowd.cycleOf(a.pose, 1, a.offset));
      c.setPose(a.pose, true);
      c.place(a.x, a.y, a.z, a.yaw);
      a.live = c;
      this.liveCount++;
    }
  }

  /** One ready-made character of each kind, so nobody has to be built in the middle of play.
   *  They stay switched on until `coolPool`, so the shader warm-up draws them too. */
  warmPool(): void {
    for (const id of PEDESTRIAN_IDS) {
      if (!characterAvailable(id) || this.livePool.get(id)?.length) continue;
      this.livePool.set(id, [new Character(id, this.scene, this.shadow)]);
    }
  }

  coolPool(): void {
    for (const pool of this.livePool.values()) for (const c of pool) c.setEnabled(false);
  }

  private releaseLive(a: Person): void {
    if (!a.live) return;
    // Bulk animation carries on from the same point of the step.
    if (a.pose === "walk" || a.pose === "run") a.phase = a.live.cycle;
    else a.offset = this.crowd.offsetFor(a.pose, 1, a.live.cycle);
    a.live.umbrellaUp = false;
    a.live.setEnabled(false);
    let pool = this.livePool.get(a.id);
    if (!pool) this.livePool.set(a.id, (pool = []));
    pool.push(a.live);
    a.live = null;
    this.liveCount--;
  }

  private stepWalker(w: Walker, dt: number, px: number, pz: number, pv: Vehicle | null, playerSpeed: number, r: Rng): void {
    w.timer -= dt;
    if (w.shouted > 0) w.shouted -= dt;
    if (w.bumpCool > 0) w.bumpCool -= dt;

    // Hop out of the way of anything moving fast and aimed at us.
    if (w.state !== "dodge" && w.state !== "hop" && w.state !== "leaveVehicle" && w.state !== "climbBack" && w.state !== "talkToPlayer" && w.dist < 40) {
      const threat = this.threat(w, pv, playerSpeed) ?? this.trafficThreat(w);
      if (threat) {
        w.state = "dodge";
        w.timer = 0.75;
        w.mx = w.mz = 0;
        // Quick ones jump clear, slow ones barely make a step, and nobody moves quite like anyone else.
        const pace = 2.6 + w.alert * 2.2;
        w.vx = threat.x * pace;
        w.vz = threat.z * pace;
        w.timer = r.range(0.55, 1.05);
        w.pose = r.pick(DODGES);
        w.offset = r.next();
        w.speed = 0;
        // One voice is enough: a whole street shouting at once is just noise.
        if (w.shouted <= 0 && pv && this.dodgeCool <= 0) {
          w.shouted = 10;
          this.dodgeCool = 2.5;
          this.onLine?.(r.pick(bn.dodge), w);
        }
      }
    }

    switch (w.state) {
      case "dodge": {
        w.x += w.vx * dt;
        w.z += w.vz * dt;
        w.vx *= Math.exp(-dt * 3);
        w.vz *= Math.exp(-dt * 3);
        if (w.timer <= 0) {
          w.state = "walk";
          w.timer = r.range(4, 16);
          w.pose = "walk";
          this.attachToNearestLoop(w);
        }
        break;
      }
      case "hop": {
        // Clipped by a vehicle: a startled leap out of the way, landing on both feet, unhurt.
        w.x += w.vx * dt;
        w.z += w.vz * dt;
        w.vx *= Math.exp(-dt * 1.2);
        w.vz *= Math.exp(-dt * 1.2);
        w.hopV -= 13 * dt;
        w.hopY += w.hopV * dt;
        w.speed = 0;
        if (w.hopY <= 0) {
          w.hopY = 0;
          w.state = "bumped";
          w.timer = r.range(1.8, 3);
          w.pose = r.pick(UPSET);
          w.vx *= 0.35;
          w.vz *= 0.35;
          this.onLine?.(r.pick(bn.bumpedHard), w);
        }
        w.y = this.city.layout.groundHeight(w.x, w.z) + w.hopY;
        // Thrown clear, but not through a wall.
        this.city.collision.resolveCircle(w.x, w.z, 0.32, WORK);
        if (WORK.hit) {
          w.x = WORK.x;
          w.z = WORK.z;
          w.vx *= 0.3;
          w.vz *= 0.3;
        }
        return;
      }
      case "bumped": {
        // Knocked aside: a stagger, a look at whoever did it, and on their way.
        w.x += w.vx * dt;
        w.z += w.vz * dt;
        w.vx *= Math.exp(-dt * 5);
        w.vz *= Math.exp(-dt * 5);
        w.speed = 0;
        w.yaw = turn(w.yaw, Math.atan2(px - w.x, pz - w.z), dt * 7);
        if (w.timer <= 0) {
          w.state = "walk";
          w.timer = r.range(5, 16);
          w.pose = "walk";
          this.attachToNearestLoop(w);
        }
        break;
      }
      case "idle":
      case "chat":
        w.speed = 0;
        if (w.timer <= 0) {
          w.state = "walk";
          w.timer = r.range(6, 22);
          w.pose = "walk";
        }
        break;
      case "talkToPlayer": {
        w.speed = 0;
        const face = this.faceTarget;
        w.yaw = turn(w.yaw, Math.atan2((face?.x ?? px) - w.x, (face?.z ?? pz) - w.z), dt * 6);
        break;
      }
      case "browse": {
        // Over to a stall to see what's on it.
        const t = w.target!;
        const dx = t.x - w.x, dz = t.z - w.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.25 || w.timer <= 0) {
          if (w.timer <= 0) {
            this.backToWalking(w, r);
            break;
          }
          w.state = "atStall";
          w.timer = r.range(4, 10);
          w.pose = r.chance(0.6) ? "idle_look" : "stand";
          w.speed = 0;
          break;
        }
        const step = w.walkSpeed;
        w.x += (dx / d) * step * dt;
        w.z += (dz / d) * step * dt;
        w.yaw = turn(w.yaw, Math.atan2(dx, dz), dt * 6);
        w.speed = step;
        w.pose = "walk";
        break;
      }
      case "atStall": {
        w.speed = 0;
        const st = w.stall;
        if (st) w.yaw = turn(w.yaw, Math.atan2(st.x - w.x, st.z - w.z), dt * 5);
        if (w.timer <= 0) this.backToWalking(w, r);
        else if (st && w.dist < 12 && this.speakCool <= 0 && r.chance(dt * 0.12)) {
          this.speakCool = 6;
          this.onLine?.(r.pick(bn.browse), w);
          w.pose = "talk";
        }
        break;
      }
      case "look": {
        // Stopped to see what the noise was.
        w.speed = 0;
        const t = w.target!;
        w.yaw = turn(w.yaw, Math.atan2(t.x - w.x, t.z - w.z), dt * 6);
        if (w.timer <= 0) this.backToWalking(w, r);
        break;
      }
      case "complain":
        // Out of the vehicle to have a word with whoever hit it.
        w.speed = 0;
        w.yaw = turn(w.yaw, Math.atan2(px - w.x, pz - w.z), dt * 5);
        w.pose = Math.sin(w.timer * 2.1) > -0.2 ? "shrug" : "talk";
        if (w.timer <= 0 || Math.hypot(px - w.x, pz - w.z) > 30) {
          if (Math.hypot(px - w.x, pz - w.z) > 30) this.onLine?.(r.pick(bn.crash.fled), w);
          this.goBackToVehicle(w);
        }
        break;
      case "returning": {
        const v = w.own;
        if (!v || v.mode !== "ai") {
          w.own = null;
          this.backToWalking(w, r);
          break;
        }
        const t = v.worldPoint(v.arch.driverSeat);
        const side = w.side > 0 ? v.arch.exitRight : v.arch.exitLeft;
        const door = v.worldPoint(side);
        const dx = door.x - w.x, dz = door.z - w.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.3) {
          w.state = "climbBack";
          w.timer = LEAVE_SECONDS;
          v.rightUp();
          w.seat = { x: t.x, y: t.y - this.crowd.hipHeightOf(w.id), z: t.z };
          w.target = { x: w.x, z: w.z };
          return;
        }
        const step = w.walkSpeed * 1.3;
        w.x += (dx / d) * step * dt;
        w.z += (dz / d) * step * dt;
        w.yaw = turn(w.yaw, Math.atan2(dx, dz), dt * 7);
        w.speed = step;
        w.pose = "walk";
        break;
      }
      case "climbBack": {
        // Back up into the seat, door shut behind them, and off they go.
        const s = w.seat!, t = w.target!;
        const v = w.own;
        const k = clamp01(1 - w.timer / LEAVE_SECONDS);
        const e = smooth(k);
        w.x = t.x + (s.x - t.x) * e;
        w.z = t.z + (s.z - t.z) * e;
        const ground = this.city.layout.groundHeight(t.x, t.z);
        w.y = ground + (s.y - ground) * e + Math.sin(e * Math.PI) * 0.12;
        w.pose = "climb";
        if (k >= 1 || !v || v.mode !== "ai") {
          this.releaseLive(w);
          if (v && v.mode === "ai") {
            v.driverId = w.id;
            v.holdTime = 0;
            v.doorGoal.fill(0);
          }
          w.own = null;
          w.forceLive = false;
          this.walkers.splice(this.walkers.indexOf(w), 1);
        }
        return;
      }
      case "waitCross": {
        w.speed = 0;
        w.pose = "idle_look";
        const c = w.cross!;
        const midX = (c.x0 + c.x1) / 2, midZ = (c.z0 + c.z1) / 2;
        w.yaw = turn(w.yaw, Math.atan2(c.x1 - c.x0, c.z1 - c.z0), dt * 5);
        // Dhaka pedestrians don't wait long: they go at the first decent gap.
        if (this.traffic.roadClearAt(midX, midZ, 14) || w.timer <= 0) {
          w.state = "cross";
          w.pose = "walk";
        }
        break;
      }
      case "cross": {
        const c = w.cross!;
        const pace = w.walkSpeed * 1.25;
        c.t += (pace * dt) / c.len;
        w.x = c.x0 + (c.x1 - c.x0) * c.t;
        w.z = c.z0 + (c.z1 - c.z0) * c.t;
        w.yaw = turn(w.yaw, Math.atan2(c.x1 - c.x0, c.z1 - c.z0), dt * 8);
        w.speed = pace;
        w.pose = "walk";
        if (c.t >= 1) {
          w.loop = c.toLoop;
          w.wp = c.toWp;
          w.cross = null;
          w.state = "walk";
          w.timer = r.range(6, 18);
        }
        break;
      }
      case "busSteps":
        this.stepBusSteps(w, dt, r);
        return;
      case "boardBus": {
        const t = w.target!;
        const dx = t.x - w.x, dz = t.z - w.z;
        const d = Math.hypot(dx, dz);
        const bus = w.bus;
        w.hopY -= dt;
        if (!bus || bus.speed > 0.6 || w.timer <= 0) {
          // Missed it: back to waiting, or off down the street.
          w.bus = null;
          w.hopY = 0;
          this.removeWalker(w);
          return;
        }
        if (d < 0.5) {
          w.speed = 0;
          w.pose = "stand";
          // Their turn at the door: up the steps, along the aisle and into a seat.
          if (w.hopY <= 0) {
            const taken = new Set(bus.passengers.map((p) => p.seat));
            const reserved = new Set(this.walkers.filter((q) => q.state === "busSteps" && q.bus === bus && !q.alighting).map((q) => q.busSeat));
            let seat = -1;
            for (let s = 0; s < bus.arch.passengerSeats.length; s++) {
              if (!taken.has(s) && !reserved.has(s)) {
                seat = s;
                break;
              }
            }
            if (seat < 0) {
              this.removeWalker(w);
              return;
            }
            w.hopY = 0;
            w.busSeat = seat;
            w.alighting = false;
            w.busPath = this.busWay(bus, seat, this.crowd.hipHeightOf(w.id));
            w.busDone = 0;
            w.state = "busSteps";
          }
          return;
        }
        w.yaw = turn(w.yaw, Math.atan2(dx, dz), dt * 7);
        // Those a little way off make a run for it, bags and all.
        const run = w.hurry && d > 2;
        const step = run ? 3.8 : w.walkSpeed * 1.5;
        w.x += (dx / d) * step * dt;
        w.z += (dz / d) * step * dt;
        w.speed = step;
        w.pose = run ? "run" : "walk";
        break;
      }
      case "leaveVehicle": {
        // Climbing down from the seat to the road.
        const s = w.seat!, t = w.target!;
        const k = clamp01(1 - w.timer / LEAVE_SECONDS);
        // A moment to undo the belt and shift across, then out and down.
        const e = smooth(clamp01((k - 0.14) / 0.86));
        w.x = s.x + (t.x - s.x) * e;
        w.z = s.z + (t.z - s.z) * e;
        const ground = this.city.layout.groundHeight(t.x, t.z);
        w.y = s.y + (ground - s.y) * e + Math.sin(e * Math.PI) * 0.12;
        w.yaw = turn(w.yaw, Math.atan2(t.x - s.x, t.z - s.z), dt * 5);
        w.pose = k < 0.14 ? w.seatPose : k < 0.72 ? "climb" : "stand";
        if (k >= 1) {
          w.state = w.own ? "complain" : "handOver";
          w.pose = "shrug";
          w.timer = w.own ? COMPLAIN_SECONDS : 2.2;
          w.y = ground;
        }
        return;
      }
      case "handOver":
        w.speed = 0;
        w.pose = "shrug";
        w.yaw = turn(w.yaw, Math.atan2(px - w.x, pz - w.z), dt * 5);
        if (w.timer <= 0) {
          w.state = "walk";
          w.pose = "walk";
          w.timer = r.range(8, 20);
          w.forceLive = false;
          this.attachToNearestLoop(w);
        }
        break;
      case "walk": {
        const pts = this.city.walkLoops[w.loop].pts;
        const n = pts.length / 2;
        // Walk to the left of the path's centre, so people going each way pass each other.
        const prev = (w.wp - w.dir + n) % n;
        const ex = pts[w.wp * 2] - pts[prev * 2], ez = pts[w.wp * 2 + 1] - pts[prev * 2 + 1];
        const el = Math.hypot(ex, ez) || 1;
        let tx = pts[w.wp * 2] + (-ez / el) * w.side, tz = pts[w.wp * 2 + 1] + (ex / el) * w.side;
        if (w.spill) {
          // Out past the kerb, on whichever side of this stretch the road is.
          const bk = this.city.walkLoops[w.loop].block;
          let ox = -ez / el, oz = ex / el;
          if ((tx - (bk.x0 + bk.x1) / 2) * ox + (tz - (bk.z0 + bk.z1) / 2) * oz < 0) {
            ox = -ox;
            oz = -oz;
          }
          const out = Math.min(bk.sidewalk * 0.56, 2.6) + 0.85;
          tx = pts[w.wp * 2] + ox * out;
          tz = pts[w.wp * 2 + 1] + oz * out;
        }
        const dx = tx - w.x, dz = tz - w.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.9) {
          // Reaching a corner: sometimes cross to the neighbouring block.
          if (r.chance(0.16) && this.tryStartCross(w)) break;
          w.wp = (w.wp + w.dir + n) % n;
        } else {
          const sep = w.dist < 40 ? this.separation(w, px, pz) : ZERO;
          // Caught out with nothing, some just run for it.
          const dash = this.rain > 0.45 && w.rainHabit === 3;
          const step = w.walkSpeed * sep.pace * (dash ? 2.3 : 1);
          const vx = (dx / dist) * step + sep.x, vz = (dz / dist) * step + sep.z;
          // Eased, so that squeezing through a crowd is a smooth sway and not a shudder.
          const ease = 1 - Math.exp(-dt * 5);
          w.mx += (vx - w.mx) * ease;
          w.mz += (vz - w.mz) * ease;
          // Faces where they are really going, so stepping aside reads as a turn of the shoulders.
          w.yaw = turn(w.yaw, Math.atan2(w.mx, w.mz), dt * 6);
          w.speed = Math.hypot(w.mx, w.mz);
          w.pose = w.speed > 2.4 ? "run" : "walk";
          if (sep.sayAside) this.sayAside(w);
        }
        if (w.timer <= 0) {
          // Someone to stop and talk to, a stall worth a look, or just a moment's pause.
          if (w.dist < 70 && r.chance(0.25) && this.jaywalk(w)) break;
          if (w.dist < 70 && r.chance(0.3) && this.stopForChat(w, r)) break;
          if (w.dist < 70 && r.chance(0.7) && this.goToStall(w, r)) break;
          w.state = "idle";
          w.pose = r.chance(0.5) ? "idle_look" : "stand";
          w.timer = r.range(1.5, 6);
        }
        break;
      }
    }
    w.y = this.city.layout.groundHeight(w.x, w.z);

    // Solid scenery applies up close, so nobody walks through a stall.
    if (w.dist < 45 && w.state !== "boardBus" && w.state !== "returning") {
      if (w.state !== "cross" && w.state !== "chat" && w.state !== "idle") {
        this.city.collision.resolveCircle(w.x, w.z, 0.32, WORK);
        if (WORK.hit) {
          w.x = WORK.x;
          w.z = WORK.z;
        }
      }
      // Vehicles are solid to people on foot too, even when one is only creeping along.
      this.traffic.blockWalker(w.x, w.z, PERSON_R, OUT, null, w.y);
      w.x = OUT.x;
      w.z = OUT.z;
      // Nobody gets slid along by a bumper: touched by anything moving, they step smartly out of the way.
      const by = this.traffic.lastTouch;
      if (by && Math.abs(by.speed) > 0.3 && (w.state === "walk" || w.state === "idle" || w.state === "chat" || w.state === "cross" || w.state === "bumped" || w.state === "waitCross")) this.stepClear(w, by);
    }
  }

  private stepClear(w: Walker, v: Vehicle): void {
    const sn = Math.sin(v.heading), cs = Math.cos(v.heading);
    const s = (w.x - v.x) * cs - (w.z - v.z) * sn >= 0 ? 1 : -1;
    const pace = 2.8 + w.alert * 1.8;
    w.state = "dodge";
    w.timer = this.rng.range(0.5, 0.85);
    w.mx = w.mz = 0;
    w.vx = cs * s * pace;
    w.vz = -sn * s * pace;
    w.pose = this.rng.pick(DODGES);
    w.offset = this.rng.next();
    w.speed = 0;
    w.partner = null;
  }

  /** Out in the road with something coming: back on to the footpath in good time, and they stay there. */
  private trafficThreat(w: Walker): { x: number; z: number } | null {
    if (!w.spill || w.state !== "walk") return null;
    const v = this.traffic.bearingDown(w.x, w.z, w.y);
    if (!v) return null;
    w.spill = false;
    const sn = Math.sin(v.heading), cs = Math.cos(v.heading);
    const s = (w.x - v.x) * cs - (w.z - v.z) * sn >= 0 ? 1 : -1;
    return { x: cs * s, z: -sn * s };
  }

  private threat(w: Walker, pv: Vehicle | null, playerSpeed: number): { x: number; z: number } | null {
    if (pv && playerSpeed > 2.5) {
      const dx = w.x - pv.x, dz = w.z - pv.z;
      const sh = Math.sin(pv.heading), ch = Math.cos(pv.heading);
      const along = dx * sh + dz * ch;
      const side = dx * ch - dz * sh;
      // Some see it coming from well back, and some only at the last moment, or not in time at all.
      const reach = pv.spec.length * 0.5 + 0.4 + Math.abs(pv.speed) * (0.2 + w.alert * 0.42);
      if (along * Math.sign(pv.speed) > -pv.spec.length * 0.5 && Math.abs(along) < reach && Math.abs(side) < pv.spec.width * 0.5 + 0.8) {
        const s = side >= 0 ? 1 : -1;
        return { x: ch * s, z: -sh * s };
      }
    }
    return null;
  }

  /** Straight across here, wherever here is, with a hand out at the traffic. Not over a road with a
   *  divider down it: for that even Dhaka uses the gaps. */
  private jaywalk(w: Walker): boolean {
    const here = this.city.walkLoops[w.loop].block;
    const toW = w.x - here.x0, toE = here.x1 - w.x, toS = w.z - here.z0, toN = here.z1 - w.z;
    const near = Math.min(toW, toE, toS, toN);
    if (near > here.sidewalk + 0.5) return false;
    const road = near === toN ? here.sideRoad[0] : near === toE ? here.sideRoad[1] : near === toS ? here.sideRoad[2] : here.sideRoad[3];
    if (!road || road.median > 0 || w.spill) return false;
    const width = roadWidth(road) + near * 2;
    const dirX = near === toE ? 1 : near === toW ? -1 : 0, dirZ = near === toN ? 1 : near === toS ? -1 : 0;
    const tx = w.x + dirX * width, tz = w.z + dirZ * width;
    const there = this.city.layout.blockAt(tx, tz);
    // Not at a junction, and only if there's somewhere to get to.
    if (!there || there === here || there.kind === "river") return false;
    const toLoop = this.city.walkLoops.findIndex((l) => l.block === there);
    if (toLoop < 0) return false;
    const pts = this.city.walkLoops[toLoop].pts;
    let wp = 0, wd = Infinity;
    for (let k = 0; k < pts.length / 2; k++) {
      const d = Math.hypot(pts[k * 2] - tx, pts[k * 2 + 1] - tz);
      if (d < wd) {
        wd = d;
        wp = k;
      }
    }
    w.state = "cross";
    w.cross = { x0: w.x, z0: w.z, x1: tx, z1: tz, toLoop, toWp: wp, t: 0, len: Math.max(width, 0.1) };
    return true;
  }

  private tryStartCross(w: Walker): boolean {
    const here = this.city.walkLoops[w.loop].block;
    // Pick another block whose walk loop has a corner close across the road.
    let best: { loop: number; wp: number; x: number; z: number; d: number } | null = null;
    this.city.walkLoops.forEach((l, i) => {
      if (l.block === here) return;
      const n = l.pts.length / 2;
      for (let k = 0; k < n; k++) {
        const x = l.pts[k * 2], z = l.pts[k * 2 + 1];
        const d = Math.hypot(x - w.x, z - w.z);
        if (d < 32 && (!best || d < best.d)) {
          const axisAligned = Math.abs(x - w.x) < 5 || Math.abs(z - w.z) < 5;
          if (axisAligned) best = { loop: i, wp: k, x, z, d };
        }
      }
    });
    if (!best) return false;
    const b = best as { loop: number; wp: number; x: number; z: number; d: number };
    const n = this.city.walkLoops[b.loop].pts.length / 2;
    w.state = "waitCross";
    w.timer = this.rng.range(2, 9);
    w.cross = { x0: w.x, z0: w.z, x1: b.x, z1: b.z, toLoop: b.loop, toWp: (b.wp + w.dir + n) % n, t: 0, len: Math.max(b.d, 0.1) };
    return true;
  }

  /** Sorts everyone near the camera into map squares for this frame. */
  private buildGrid(camX: number, camZ: number): void {
    const grid = this.grid;
    for (const list of grid.values()) list.length = 0;
    for (const w of this.walkers) {
      if (Math.abs(w.x - camX) > 46 || Math.abs(w.z - camZ) > 46) continue;
      const key = cellKey(w.x, w.z);
      const list = grid.get(key);
      if (list) list.push(w);
      else grid.set(key, [w]);
    }
  }

  /** The hero's vehicle against people on foot. Anyone it actually reaches hops out of the way. */
  private knockFromVehicle(pv: Vehicle, speed: number): void {
    if (speed < 0.7) return;
    const sh = Math.sin(pv.heading), ch = Math.cos(pv.heading);
    const half = pv.spec.length * 0.5 + 0.2, wide = pv.spec.width * 0.5 + 0.25;
    const reach = Math.ceil((half + 1) / GRID_CELL);
    const cx = Math.floor(pv.x / GRID_CELL), cz = Math.floor(pv.z / GRID_CELL);
    for (let ix = cx - reach; ix <= cx + reach; ix++) {
      for (let iz = cz - reach; iz <= cz + reach; iz++) {
        const list = this.grid.get(cellKeyOf(ix, iz));
        if (!list) continue;
        for (const w of list) {
          if (w.state === "hop" || w.state === "leaveVehicle" || w.state === "climbBack" || w.state === "boardBus" || w.state === "busSteps") continue;
          const dx = w.x - pv.x, dz = w.z - pv.z;
          const along = dx * sh + dz * ch, across = dx * ch - dz * sh;
          if (Math.abs(along) > half || Math.abs(across) > wide || Math.abs(w.y - pv.y) > 2) continue;
          const side = across >= 0 ? 1 : -1;
          if (speed < 2.5) {
            // A nudge at walking pace: pushed clear, and not best pleased.
            if (w.bumpCool <= 0) {
              w.bumpCool = 5;
              if (w.state !== "talkToPlayer") {
                w.state = "bumped";
                w.timer = this.rng.range(0.9, 1.7);
                w.pose = this.rng.pick(UPSET);
                w.vx = ch * side * 1.8;
                w.vz = -sh * side * 1.8;
              }
              if (this.speakCool <= 0) {
                this.speakCool = 3;
                this.onLine?.(this.rng.pick(bn.bumped), w);
              }
            }
            continue;
          }
          if (w.state === "talkToPlayer") continue;
          // Aside, not along: the vehicle mustn't look as if it's carrying them down the road.
          const carry = Math.min(speed, 14) * 0.14 * Math.sign(pv.speed || 1);
          w.state = "hop";
          w.pose = this.rng.pick(DODGES);
          w.offset = this.rng.next();
          w.partner = null;
          w.hopY = 0.02;
          w.hopV = 2.6 + Math.min(speed, 14) * 0.17;
          w.vx = sh * carry + ch * side * (3 + speed * 0.3);
          w.vz = ch * carry - sh * side * (3 + speed * 0.3);
          w.mx = w.mz = 0;
          this.onKnocked?.(w, speed);
        }
      }
    }
  }

  /** Keeping clear of others: a shove apart when close, stepping left for anyone coming the other
   *  way, and slowing behind someone who is in the way. */
  private separation(w: Walker, px: number, pz: number): typeof SEP {
    let x = 0, z = 0, pace = 1;
    const fx = Math.sin(w.yaw), fz = Math.cos(w.yaw);
    const lookAhead = (ox: number, oz: number, strength: number): boolean => {
      const rx = ox - w.x, rz = oz - w.z;
      if (Math.abs(rx) > 2.8 || Math.abs(rz) > 2.8) return false;
      const ahead = rx * fx + rz * fz;
      if (ahead < 0.1 || ahead > 2.8) return false;
      const across = rx * fz - rz * fx;
      if (Math.abs(across) > 0.95) return false;
      // Left of the direction of travel is (-fz, fx).
      const k = (1 - ahead / 2.8) * strength;
      x += -fz * k;
      z += fx * k;
      if (ahead < 1.1) pace = Math.min(pace, 0.45 + (ahead / 1.1) * 0.55);
      return true;
    };
    const push = (ox: number, oz: number, range: number, k: number): void => {
      const dx = w.x - ox, dz = w.z - oz;
      if (Math.abs(dx) > range || Math.abs(dz) > range) return;
      const d = Math.hypot(dx, dz);
      if (d < range && d > 1e-3) {
        const f = (1 - d / range) * k;
        x += (dx / d) * f;
        z += (dz / d) * f;
      }
    };
    const cx = Math.floor(w.x / GRID_CELL), cz = Math.floor(w.z / GRID_CELL);
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const list = this.grid.get(cellKeyOf(ix, iz));
        if (!list) continue;
        for (const o of list) {
          if (o === w) continue;
          push(o.x, o.z, 0.85, 1.5);
          lookAhead(o.x, o.z, 0.9);
        }
      }
    }
    push(px, pz, 1.1, 2.2);
    SEP.sayAside = lookAhead(px, pz, 1.7) && Math.hypot(px - w.x, pz - w.z) < 1.5;
    SEP.x = x;
    SEP.z = z;
    SEP.pace = pace;
    return SEP;
  }

  private sayAside(w: Walker): void {
    if (this.speakCool > 0 || w.dist > 12) return;
    this.speakCool = 7;
    this.onLine?.(this.rng.pick(bn.sideIn), w);
  }

  private backToWalking(w: Walker, r: Rng): void {
    w.state = "walk";
    w.pose = "walk";
    w.forceLive = false;
    w.timer = r.range(6, 20);
    w.stall = null;
    w.partner = null;
    this.attachToNearestLoop(w);
  }

  /** Finds someone close by to stop and talk with. The two stand facing each other for a while. */
  private stopForChat(w: Walker, r: Rng): boolean {
    const near = this.grid.get(cellKey(w.x, w.z));
    if (!near) return false;
    for (const o of near) {
      if (o === w || o.state !== "walk" || Math.abs(o.x - w.x) > 2.6 || Math.abs(o.z - w.z) > 2.6) continue;
      const time = r.range(8, 20);
      for (const [a, b] of [[w, o], [o, w]] as [Walker, Walker][]) {
        a.state = "chat";
        a.pose = "talk";
        a.timer = time;
        a.speed = 0;
        a.partner = b;
        a.yaw = Math.atan2(b.x - a.x, b.z - a.z);
      }
      return true;
    }
    return false;
  }

  /** Sends someone over to a stall nearby, to the side the goods face. */
  private goToStall(w: Walker, r: Rng): boolean {
    let best: StallSpot | null = null, bd = 11;
    for (const st of this.city.stalls) {
      if (Math.abs(st.x - w.x) > bd || Math.abs(st.z - w.z) > bd) continue;
      const d = Math.hypot(st.x - w.x, st.z - w.z);
      if (d < bd) {
        bd = d;
        best = st;
      }
    }
    if (!best) return false;
    const box = this.city.props.solidBox(best.prop);
    const depth = box ? Math.max(box.z1, -box.z0) : 1;
    const out = depth + 0.7, across = r.range(-0.8, 0.8);
    const sn = Math.sin(best.angle), cs = Math.cos(best.angle);
    w.state = "browse";
    w.stall = best;
    w.target = { x: best.x + sn * out + cs * across, z: best.z + cs * out - sn * across };
    w.timer = 12;
    return true;
  }

  /** People talking among themselves are overheard now and then, one line each in turn, and
   *  stall owners call out. Kept sparse: a street where everyone talks at once is just noise. */
  private chatter(dt: number): void {
    const r = this.rng;
    if (this.talker) return;
    const x = this.exchange;
    if (x) {
      x.wait -= dt;
      if (x.wait > 0) return;
      if (x.next >= x.lines.length || x.a.state !== "chat" || x.b.state !== "chat" || x.a.dist > 22) {
        this.exchange = null;
        this.chatterTimer = r.range(8, 22);
        return;
      }
      const speaker = x.next % 2 === 0 ? x.a : x.b;
      const other = x.next % 2 === 0 ? x.b : x.a;
      speaker.pose = "talk";
      other.pose = "stand";
      this.onLine?.(x.lines[x.next], speaker);
      x.next++;
      x.wait = 1.2 + x.lines[x.next - 1].length * 0.075;
      return;
    }
    this.chatterTimer -= dt;
    this.callTimer -= dt;
    if (this.chatterTimer <= 0) {
      this.chatterTimer = 3;
      for (const w of this.walkers) {
        if (w.state === "chat" && w.partner && w.partner.state === "chat" && w.dist < 16 && w.timer > 3) {
          this.exchange = { a: w, b: w.partner, lines: r.pick(bn.overheard), next: 0, wait: 0 };
          return;
        }
      }
    }
    if (this.callTimer <= 0) {
      this.callTimer = r.range(15, 35);
      for (const [stall, who] of this.vendors) {
        if (who.dist > 16) continue;
        const lines = stall.kind === "tea" ? bn.tea.calls : bn.stallCalls[stall.prop] ?? bn.stallCalls.other;
        this.onLine?.(r.pick(lines), who);
        return;
      }
    }
  }

  private stepStartled(dt: number): void {
    for (let i = this.startled.length - 1; i >= 0; i--) {
      const q = this.startled[i];
      q.time -= dt;
      if (q.time <= 0) {
        q.who.pose = q.pose;
        this.startled.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------- reacting to a crash

  /** Heads turn towards a bang. Returns someone in earshot who has something to say about it. */
  reactToCrash(x: number, z: number, range: number): Person | null {
    const r = this.rng;
    let voice: Person | null = null, turned = 0;
    for (const w of this.walkers) {
      if (Math.abs(w.x - x) > range || Math.abs(w.z - z) > range) continue;
      if (w.state !== "walk" && w.state !== "idle" && w.state !== "chat" && w.state !== "atStall") continue;
      if (this.isQueued(w)) {
        // Still in the queue, but they do look round.
        w.yaw = Math.atan2(x - w.x, z - w.z);
        continue;
      }
      if (turned >= 6) break;
      turned++;
      w.state = "look";
      w.timer = r.range(1.6, 3.4);
      w.target = { x, z };
      w.pose = r.chance(0.45) ? "shrug" : "idle_look";
      w.speed = 0;
      if (!voice || r.chance(0.3)) voice = w;
    }
    return voice;
  }

  /** The person minding a stall throws up their hands for a moment. */
  startle(who: Person): void {
    if (this.startled.some((q) => q.who === who)) return;
    this.startled.push({ who, pose: who.pose, time: 3 });
    who.pose = "shrug";
    who.forceLive = false;
  }

  /** After a hard knock the other driver climbs out, door and all, to have a word. Nobody touches
   *  anybody: they stand and gesture for a few seconds, then get back in and drive on. */
  driverComplains(v: Vehicle, px: number, pz: number): Person | null {
    if (!v.driverId || v.mode !== "ai") return null;
    const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
    const sideX = (px - v.x) * ch - (pz - v.z) * sh;
    // A door on the far side from the road is no use: get out on the side the other vehicle is on.
    const local = sideX >= 0 ? v.arch.exitRight : v.arch.exitLeft;
    const door = v.arch.driverDoor(sideX);
    if (door) v.doorGoal[door.index] = door.swing;
    const seat = v.worldPoint(v.arch.driverSeat);
    const exit = v.worldPoint(local);
    const id = v.driverId;
    v.driverId = null;
    v.holdTime = COMPLAIN_SECONDS + 16;
    const w = this.driverLeaves(id, seat, v.spec.seatPose, exit.x, exit.z, v.heading);
    w.own = v;
    w.side = sideX >= 0 ? 1 : -1;
    return w;
  }

  /** The driver standing beside their vehicle waiting for a word, if there's one near. */
  complainerNear(x: number, z: number, range: number): Person | null {
    for (const w of this.walkers) {
      if (w.state === "complain" && Math.hypot(w.x - x, w.z - z) < range) return w;
    }
    return null;
  }

  private goBackToVehicle(w: Walker): void {
    w.state = "returning";
    w.pose = "walk";
    w.timer = 30;
  }

  // ---------------------------------------------------------------- talking with the hero

  /** Takes someone out of whatever they're doing to talk. Stays a full character until it's over. */
  beginTalk(a: Person): void {
    if (this.talker) this.endTalk();
    this.talker = a;
    a.talks++;
    a.forceLive = true;
    this.liveTimer = 0;
    this.faceTarget = null;
    this.exchange = null;
    if (isWalker(a)) {
      this.talkSaved = { state: a.state, pose: a.pose, timer: a.timer, yaw: a.yaw };
      a.state = "talkToPlayer";
      a.pose = "stand";
      a.speed = 0;
    } else {
      this.talkSaved = { state: "idle", pose: a.pose, timer: 0, yaw: a.yaw };
    }
  }

  /** A pose for while they talk. Whoever's sitting stays sitting. */
  talkPose(a: Person, pose: Pose): void {
    if (this.talkSaved?.pose === "sit_bench") return;
    a.pose = pose;
  }

  /** Has them turn and point towards somewhere, or back to the hero with null. */
  facePoint(target: { x: number; z: number } | null): void {
    this.faceTarget = target;
  }

  endTalk(): void {
    const a = this.talker;
    const saved = this.talkSaved;
    this.talker = null;
    this.talkSaved = null;
    this.faceTarget = null;
    if (!a || !saved) return;
    a.forceLive = false;
    if (!isWalker(a)) {
      a.pose = saved.pose;
      a.yaw = saved.yaw;
      return;
    }
    if (a.own) {
      a.forceLive = true;
      this.goBackToVehicle(a);
      return;
    }
    if (saved.state === "idle" && saved.timer > 1e6) {
      // Back to the queue.
      a.state = "idle";
      a.timer = saved.timer;
      a.pose = saved.pose;
      return;
    }
    this.backToWalking(a, this.rng);
  }

  /** A fixed person's whole body turns to face the hero, unless they're sitting down. */
  private turnFixedTalker(dt: number, px: number, pz: number): void {
    const a = this.talker;
    if (!a || isWalker(a) || this.talkSaved?.pose === "sit_bench") return;
    const face = this.faceTarget;
    a.yaw = turn(a.yaw, Math.atan2((face?.x ?? px) - a.x, (face?.z ?? pz) - a.z), dt * 6);
  }

  /** Is this one going about their business, and willing to brush the hero off? */
  inAHurry(a: Person): boolean {
    return isWalker(a) && a.state === "walk";
  }

  /** The hero is solid to people. Pushes both apart and returns where the hero ends up; anyone
   *  walked into staggers aside and says something about it. */
  shoveFromPlayer(x: number, z: number, r: number, speed: number, out: { x: number; z: number }, y = 0): void {
    let hx = x, hz = z;
    for (const w of this.walkers) {
      if (w.dist > 30 || Math.abs(w.y - y) > 1.6 || w.state === "leaveVehicle" || w.state === "boardBus" || w.state === "busSteps" || w.state === "climbBack" || w.state === "hop" || w === this.talker) continue;
      const dx = w.x - hx, dz = w.z - hz;
      if (Math.abs(dx) > 1 || Math.abs(dz) > 1) continue;
      const d = Math.hypot(dx, dz);
      const rr = r + PERSON_R;
      if (d >= rr) continue;
      const nx = d > 1e-3 ? dx / d : 1, nz = d > 1e-3 ? dz / d : 0;
      const depth = rr - d;
      // People give way more than the hero does, but both feel it.
      w.x += nx * depth * 0.7;
      w.z += nz * depth * 0.7;
      hx -= nx * depth * 0.3;
      hz -= nz * depth * 0.3;
      if (speed > 0.9 && w.bumpCool <= 0 && !this.isQueued(w) && (speed > 3 || this.rng.chance(0.3))) {
        w.bumpCool = 6;
        w.state = "bumped";
        w.timer = speed > 3.5 ? 1.5 : 1.15;
        w.pose = this.rng.pick(speed > 3.5 ? DODGES : UPSET);
        w.vx = nx * (1 + speed * 0.3);
        w.vz = nz * (1 + speed * 0.3);
        if (this.speakCool <= 0) {
          this.speakCool = 3;
          this.onLine?.(this.rng.pick(speed > 3.5 ? bn.bumpedHard : bn.bumped), w);
        }
      }
    }
    out.x = hx;
    out.z = hz;
  }

  /** The person the hero is most likely to mean: near, and in front of them. */
  nearestPerson(x: number, z: number, yaw: number, range: number, y = 0): Person | null {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let best: Person | null = null;
    let bs = Infinity;
    const consider = (a: Person, reach: number): void => {
      const dx = a.x - x, dz = a.z - z;
      if (Math.abs(dx) > reach || Math.abs(dz) > reach || Math.abs(a.y - y) > 2.2) return;
      const d = Math.hypot(dx, dz);
      if (d > reach) return;
      const facing = d > 1e-3 ? (dx * fx + dz * fz) / d : 1;
      const score = d - facing * 0.8;
      if (score < bs) {
        bs = score;
        best = a;
      }
    };
    const cx = Math.floor(x / GRID_CELL), cz = Math.floor(z / GRID_CELL);
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const list = this.grid.get(cellKeyOf(ix, iz));
        if (!list) continue;
        for (const w of list) {
          if (w.state === "walk" || w.state === "idle" || w.state === "chat" || w.state === "atStall" || w.state === "look" || w.state === "handOver" || w.state === "waitCross") consider(w, range);
        }
      }
    }
    // Stall owners stand behind their goods, so they can be spoken to from across the cart.
    for (const a of this.fixed) consider(a, range + 1.2);
    return best;
  }

  /** The driver climbs out as a full character, hands over with a shrug, and walks off. */
  driverLeaves(id: CharacterId, seat: { x: number; y: number; z: number }, seatPose: Pose, exitX: number, exitZ: number, yaw: number): Walker {
    const w = this.newWalker(id, seat.x, seat.z);
    const y = seat.y - this.crowd.hipHeightOf(id);
    w.y = y;
    w.yaw = yaw;
    w.state = "leaveVehicle";
    w.timer = LEAVE_SECONDS;
    w.pose = seatPose;
    w.seatPose = seatPose;
    w.seat = { x: seat.x, y, z: seat.z };
    w.target = { x: exitX, z: exitZ };
    w.forceLive = true;
    w.dist = 0;
    this.attachToNearestLoop(w);
    this.walkers.push(w);
    this.liveTimer = 0;
    return w;
  }

  get count(): number {
    return this.walkers.length + this.fixed.length;
  }

  get liveNow(): number {
    return this.liveCount;
  }
}

const ZERO_POINT = new Vector3();

function cellKeyOf(ix: number, iz: number): number {
  return (ix + 2048) * 4096 + iz + 2048;
}

function cellKey(x: number, z: number): number {
  return cellKeyOf(Math.floor(x / GRID_CELL), Math.floor(z / GRID_CELL));
}

const WORK = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
const ZERO = { x: 0, z: 0, pace: 1, sayAside: false };
const SEP = { x: 0, z: 0, pace: 1, sayAside: false };
const OUT = { x: 0, z: 0 };
const HAND = new Vector3();

function smooth(k: number): number {
  return k * k * (3 - 2 * k);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function turn(cur: number, target: number, k: number): number {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * Math.min(1, k);
}
