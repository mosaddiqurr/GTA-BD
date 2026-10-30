import { AbstractMesh, Scene } from "@babylonjs/core";
import { Character, CharacterId, PEDESTRIAN_IDS, Pose, RUN_CYCLE_M, WALK_CYCLE_M, characterAvailable } from "../characters/character";
import type { Crowd } from "../characters/crowd";
import type { City } from "../world/city";
import { KERB_H, Rng } from "../world/cityLayout";
import type { TrafficSystem } from "../traffic/trafficSystem";
import type { Vehicle } from "../vehicles/vehicle";
import { bn } from "../localization/bn";

type State = "walk" | "idle" | "chat" | "waitCross" | "cross" | "dodge" | "talkToPlayer" | "boardBus" | "leaveVehicle" | "handOver";

/** Anyone drawn on foot, whether by the crowd system or as a live character. */
interface Actor {
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
}

interface Walker extends Actor {
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
}

const ACTIVE_RADIUS = 96;
const LIVE_RADIUS = 13;
const LIVE_MAX = 10;
const DRAW_RADIUS = 125;
const LEAVE_SECONDS = 1.05;

/** Fruit people across the district. Most are drawn in bulk by the crowd system; the handful
 *  beside the camera become full characters with smooth blending. Nobody can be hurt. */
export class Pedestrians {
  private walkers: Walker[] = [];
  private fixed: Actor[] = [];
  private busQueues: Walker[][] = [];
  private rng = new Rng(1205);
  private target = 24;
  private frame = 0;
  private liveTimer = 0;
  private livePool = new Map<CharacterId, Character[]>();
  private liveCount = 0;
  private sortBuf: Actor[] = [];
  onShout: ((text: string, x: number, z: number) => void) | null = null;

  constructor(private scene: Scene, private city: City, private traffic: TrafficSystem, private crowd: Crowd, private shadow: (m: AbstractMesh) => void) {
    traffic.onBusDwell = (stopIndex, bus) => this.busArrived(stopIndex, bus);
  }

  setTarget(n: number): void {
    this.target = n;
  }

  /** Stall owners, tea drinkers, traffic police and people at bus stops. */
  spawnFixed(): void {
    const r = this.rng;
    const add = (ids: CharacterId[], x: number, y: number, z: number, yaw: number, pose: Pose): void => {
      const usable = ids.filter(characterAvailable);
      if (!usable.length) return;
      this.fixed.push({ id: r.pick(usable), x, y, z, yaw, pose, speed: 0, offset: r.next(), dist: 999, live: null, forceLive: false });
    };
    for (const p of this.city.police) add(["npc_police_coconut"], p.x, p.y, p.z, r.range(0, 6.28), "police");
    for (const s of this.city.stalls) {
      const sn = Math.sin(s.angle), cs = Math.cos(s.angle);
      const spot = this.city.props.anchor(s.prop, "vendor");
      // The vendor stands behind the goods, looking out over them.
      const lx = spot?.x ?? 0, lz = spot?.z ?? -1.1;
      const vx = s.x + lx * cs + lz * sn, vz = s.z - lx * sn + lz * cs;
      if (s.kind === "tea") add(["npc_tea_banana"], vx, KERB_H, vz, s.angle, "tea");
      else add(["npc_vendor_pineapple", "npc_shop_papaya"], vx, KERB_H, vz, s.angle, "idle_look");
      if (s.kind !== "tea") continue;
      // Customers on the benches.
      for (let i = 1; i <= 4; i++) {
        const a = this.city.props.anchor("tea_stall", `seat_${i}`);
        if (!a || !r.chance(0.55)) continue;
        const sx = s.x + a.x * cs + a.z * sn;
        const sz = s.z - a.x * sn + a.z * cs;
        const id = r.pick(PEDESTRIAN_IDS.filter((q) => q !== "npc_tea_banana" && characterAvailable(q)));
        if (!id) continue;
        const y = KERB_H + a.y - this.crowd.hipHeightOf(id);
        this.fixed.push({ id, x: sx, y, z: sz, yaw: Math.atan2(s.x - sx, s.z - sz), pose: "sit_bench", speed: 0, offset: r.next(), dist: 999, live: null, forceLive: false });
      }
    }
    // A queue at every bus stop, who really do climb aboard when a bus pulls in.
    this.city.busStops.forEach((stop, i) => {
      this.busQueues[i] = [];
      const n = r.int(2, 5);
      for (let k = 0; k < n; k++) this.addWaiter(i, stop, k);
    });
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
      id, x, z, y: KERB_H, yaw: r.range(0, 6.28), pose: "walk", speed: 0, offset: r.next(), dist: 999, live: null, forceLive: false,
      state: "walk", timer: r.range(4, 20), walkSpeed: r.range(1.05, 1.55), loop: 0, wp: 0, cross: null, vx: 0, vz: 0, shouted: 0,
      target: null, seat: null, seatPose: "stand", bus: null,
    };
  }

  /** People at the stop walk to the door and get on; a few others get off. */
  private busArrived(stopIndex: number, bus: Vehicle): void {
    const queue = this.busQueues[stopIndex];
    if (!queue) return;
    const r = this.rng;
    const door = bus.worldPoint(bus.arch.exitLeft);
    let boarding = 0;
    for (const w of queue) {
      if (w.state === "idle" && boarding < 3 && bus.freeSeats > boarding) {
        w.state = "boardBus";
        w.bus = bus;
        w.target = { x: door.x, z: door.z };
        w.timer = 7;
        boarding++;
      }
    }
    // Passengers getting off become ordinary pedestrians.
    const off = Math.min(r.int(0, 2), bus.passengers.length);
    for (let i = 0; i < off; i++) {
      const rider = bus.passengers.pop();
      if (!rider) break;
      const w = this.newWalker(rider.id, door.x + r.range(-0.4, 0.4), door.z + r.range(-0.4, 0.4));
      this.attachToNearestLoop(w);
      this.walkers.push(w);
    }
    // More people drift to the stop after the bus has gone.
    const stop = this.city.busStops[stopIndex];
    if (queue.length - boarding < 3) this.addWaiter(stopIndex, stop, queue.length);
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
    w.wp = nxt;
    this.walkers.push(w);
    // Friends stop to talk: a second person standing with them, facing them.
    if (r.chance(0.16)) {
      const partner = this.newWalker(r.pick(options), x + r.range(0.7, 1), z + r.range(-0.6, 0.6));
      partner.loop = loop;
      partner.wp = nxt;
      for (const q of [w, partner]) {
        q.state = "chat";
        q.pose = "talk";
        q.timer = r.range(14, 40);
      }
      w.yaw = Math.atan2(partner.x - w.x, partner.z - w.z);
      partner.yaw = w.yaw + Math.PI;
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
    // People queueing at distant stops don't count towards the crowd on the streets around the player.
    let free = 0;
    for (const w of this.walkers) if (!this.isQueued(w)) free++;
    if (free < this.target) this.spawnWalker(px, pz, false);
    const blockers = this.traffic.pedestrianBlockers;
    blockers.length = 0;
    const r = this.rng;
    const f = this.frame % 3;
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i];
      w.dist = Math.hypot(w.x - camX, w.z - camZ);
      if (w.dist > ACTIVE_RADIUS * 1.35 && w.state !== "leaveVehicle" && !w.forceLive && !this.isQueued(w)) {
        this.releaseLive(w);
        this.walkers.splice(i, 1);
        continue;
      }
      // Distant people only need a third of the updates; nobody can tell.
      if (w.dist < 50 || i % 3 === f) this.stepWalker(w, w.dist < 50 ? dt : dt * 3, px, pz, pv, playerSpeed, r);
      if (w.state === "cross") blockers.push({ x: w.x, z: w.z });
    }
    this.assignLive(dt, camX, camZ);
    this.draw(dt, camX, camZ, dirX, dirZ);
  }

  private isQueued(w: Walker): boolean {
    return w.state === "idle" && w.timer > 1e6;
  }

  private draw(dt: number, camX: number, camZ: number, dirX: number, dirZ: number): void {
    const crowd = this.crowd;
    const one = (a: Actor): void => {
      if (a.live) {
        const c = a.live;
        c.speed = a.speed;
        if (c.pose !== a.pose) c.setPose(a.pose);
        c.place(a.x, a.y, a.z, a.yaw);
        c.setDetail(a.dist);
        c.update(dt);
        return;
      }
      if (a.dist > DRAW_RADIUS) return;
      const dx = a.x - camX, dz = a.z - camZ;
      if (a.dist > 16 && dx * dirX + dz * dirZ < -6) return;
      let rate = 1;
      if (a.pose === "walk") rate = a.speed / WALK_CYCLE_M;
      else if (a.pose === "run") rate = a.speed / RUN_CYCLE_M;
      crowd.add(a.id, a.x, a.y, a.z, a.yaw, a.pose, a.dist, rate, a.offset);
    };
    for (const a of this.fixed) {
      a.dist = Math.hypot(a.x - camX, a.z - camZ);
      one(a);
    }
    for (const w of this.walkers) one(w);
  }

  /** Gives the nearest handful a full skeleton, so they blend smoothly right beside the camera. */
  private assignLive(dt: number, camX: number, camZ: number): void {
    this.liveTimer -= dt;
    if (this.liveTimer > 0) return;
    this.liveTimer = 0.2;
    const near = this.sortBuf;
    near.length = 0;
    for (const a of this.fixed) {
      a.dist = Math.hypot(a.x - camX, a.z - camZ);
      if (a.dist < LIVE_RADIUS) near.push(a);
    }
    for (const w of this.walkers) if (w.dist < LIVE_RADIUS || w.forceLive) near.push(w);
    near.sort((p, q) => Number(q.forceLive) - Number(p.forceLive) || p.dist - q.dist);
    const keep = new Set<Actor>(near.slice(0, LIVE_MAX));
    const release = (a: Actor): void => {
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
      c.setPose(a.pose, true);
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

  private releaseLive(a: Actor): void {
    if (!a.live) return;
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

    // Hop out of the way of anything moving fast and aimed at us.
    if (w.state !== "dodge" && w.state !== "leaveVehicle" && w.dist < 40) {
      const threat = this.threat(w, pv, playerSpeed);
      if (threat) {
        w.state = "dodge";
        w.timer = 0.75;
        w.vx = threat.x * 3.8;
        w.vz = threat.z * 3.8;
        w.pose = "dodge";
        w.speed = 0;
        if (w.shouted <= 0 && pv) {
          w.shouted = 10;
          this.onShout?.(r.pick(bn.dodge), w.x, w.z);
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
      case "idle":
      case "chat":
        w.speed = 0;
        if (w.timer <= 0) {
          w.state = "walk";
          w.timer = r.range(6, 22);
          w.pose = "walk";
        }
        break;
      case "talkToPlayer":
        w.speed = 0;
        w.yaw = turn(w.yaw, Math.atan2(px - w.x, pz - w.z), dt * 6);
        if (w.timer <= 0) {
          w.state = "walk";
          w.timer = r.range(6, 22);
          w.pose = "walk";
        }
        break;
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
      case "boardBus": {
        const t = w.target!;
        const dx = t.x - w.x, dz = t.z - w.z;
        const d = Math.hypot(dx, dz);
        const bus = w.bus;
        if (d < 0.7 || w.timer <= 0 || !bus || bus.holdTime <= 0) {
          // Up the steps and into a seat.
          if (bus && d < 2.5) {
            const taken = new Set(bus.passengers.map((p) => p.seat));
            for (let s = 0; s < bus.arch.passengerSeats.length; s++) {
              if (!taken.has(s)) {
                bus.passengers.push({ id: w.id, seat: s });
                break;
              }
            }
          }
          this.releaseLive(w);
          for (const q of this.busQueues) {
            const k = q.indexOf(w);
            if (k >= 0) q.splice(k, 1);
          }
          this.walkers.splice(this.walkers.indexOf(w), 1);
          return;
        }
        w.yaw = turn(w.yaw, Math.atan2(dx, dz), dt * 7);
        const step = w.walkSpeed * 1.5;
        w.x += (dx / d) * step * dt;
        w.z += (dz / d) * step * dt;
        w.speed = step;
        w.pose = "walk";
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
          w.state = "handOver";
          w.pose = "shrug";
          w.timer = 2.2;
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
        const tx = pts[w.wp * 2], tz = pts[w.wp * 2 + 1];
        const dx = tx - w.x, dz = tz - w.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.8) {
          // Reaching a corner: sometimes cross to the neighbouring block.
          if (r.chance(0.3) && this.tryStartCross(w)) break;
          w.wp = (w.wp + 1) % n;
        } else {
          w.yaw = turn(w.yaw, Math.atan2(dx, dz), dt * 6);
          const sep = w.dist < 40 ? this.separation(w, px, pz) : ZERO;
          const step = w.walkSpeed * dt;
          w.x += (dx / dist) * step + sep.x * dt;
          w.z += (dz / dist) * step + sep.z * dt;
          w.speed = w.walkSpeed;
          w.pose = "walk";
        }
        if (w.timer <= 0) {
          if (r.chance(0.6)) {
            w.state = "idle";
            w.pose = r.chance(0.5) ? "idle_look" : "stand";
            w.timer = r.range(1.5, 6);
          } else {
            w.state = "chat";
            w.pose = "talk";
            w.timer = r.range(3, 8);
          }
        }
        break;
      }
    }
    w.y = this.city.layout.groundHeight(w.x, w.z);

    // Solid scenery applies up close, so nobody walks through a stall.
    if (w.dist < 45 && w.state !== "cross" && w.state !== "boardBus") {
      this.city.collision.resolveCircle(w.x, w.z, 0.32, WORK);
      if (WORK.hit) {
        w.x = WORK.x;
        w.z = WORK.z;
      }
    }
  }

  private threat(w: Walker, pv: Vehicle | null, playerSpeed: number): { x: number; z: number } | null {
    if (pv && playerSpeed > 2.5) {
      const dx = w.x - pv.x, dz = w.z - pv.z;
      const sh = Math.sin(pv.heading), ch = Math.cos(pv.heading);
      const along = dx * sh + dz * ch;
      const side = dx * ch - dz * sh;
      const reach = pv.spec.length * 0.5 + 1 + Math.abs(pv.speed) * 0.55;
      if (along * Math.sign(pv.speed) > -pv.spec.length * 0.5 && Math.abs(along) < reach && Math.abs(side) < pv.spec.width * 0.5 + 0.8) {
        const s = side >= 0 ? 1 : -1;
        return { x: ch * s, z: -sh * s };
      }
    }
    return null;
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
    w.cross = { x0: w.x, z0: w.z, x1: b.x, z1: b.z, toLoop: b.loop, toWp: (b.wp + 1) % n, t: 0, len: Math.max(b.d, 0.1) };
    return true;
  }

  private separation(w: Walker, px: number, pz: number): { x: number; z: number } {
    let x = 0, z = 0;
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
    for (const o of this.walkers) if (o !== w && o.dist < 45) push(o.x, o.z, 1.0, 1.4);
    push(px, pz, 1.2, 2.2);
    SEP.x = x;
    SEP.z = z;
    return SEP;
  }

  /** Nearest person the player could talk to. */
  nearestTalker(x: number, z: number, range: number): Walker | null {
    let best: Walker | null = null;
    let bd = range;
    for (const w of this.walkers) {
      const d = Math.hypot(w.x - x, w.z - z);
      if (d < bd && (w.state === "walk" || w.state === "idle" || w.state === "chat" || w.state === "talkToPlayer")) {
        bd = d;
        best = w;
      }
    }
    return best;
  }

  talkTo(w: Walker): void {
    // Someone waiting for a bus goes back to waiting after the chat.
    if (this.isQueued(w)) return;
    w.state = "talkToPlayer";
    w.timer = 4;
    w.pose = "talk";
    w.speed = 0;
  }

  /** The driver climbs out as a full character, hands over with a shrug, and walks off. */
  driverLeaves(id: CharacterId, seat: { x: number; y: number; z: number }, seatPose: Pose, exitX: number, exitZ: number, yaw: number): void {
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
  }

  get count(): number {
    return this.walkers.length + this.fixed.length;
  }

  get liveNow(): number {
    return this.liveCount;
  }
}

const WORK = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
const ZERO = { x: 0, z: 0 };
const SEP = { x: 0, z: 0 };

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
