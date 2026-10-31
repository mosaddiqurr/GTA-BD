import { Matrix, Quaternion, Vector3 } from "@babylonjs/core";
import { HIT, obbVsCircle } from "../physics/shapes";
import type { Vehicle } from "../vehicles/vehicle";
import type { Circle, CollisionWorld } from "./collision";
import type { PropWorld } from "./props";

interface Kind {
  mass: number;
  r: number;
  /** How far over it ends up when it falls. */
  lay: number;
  h: number;
}

/** What's light enough to be sent flying. */
const KINDS: Record<string, Kind> = {
  cone: { mass: 3, r: 0.2, lay: 1.25, h: 0.6 },
  dustbin: { mass: 9, r: 0.32, lay: 1.5, h: 1.1 },
  plastic_chair: { mass: 3, r: 0.3, lay: 1.45, h: 0.9 },
  crates: { mass: 14, r: 0.5, lay: 1.5, h: 1 },
  barrier: { mass: 16, r: 0.42, lay: 1.5, h: 1.1 },
};

const GRAVITY = 9.8;
const CELL = 16;
/** Out of the hero's sight for this far, what was knocked over gets put back. */
const TIDIED_FROM = 58;
const MAX_ACTIVE = 40;

interface Item {
  id: string;
  kind: Kind;
  index: number;
  collider: Circle;
  homeX: number;
  homeY: number;
  homeZ: number;
  homeYaw: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  spinV: number;
  /** Tipped this far, towards this direction. */
  tilt: number;
  tiltV: number;
  tiltDir: number;
  active: boolean;
  away: boolean;
}

const Q1 = new Quaternion();
const Q2 = new Quaternion();
const AXIS = new Vector3();
const POS = new Vector3();
const M = new Matrix();
const UNIT = Vector3.One();
const UP = Vector3.Up();

/** Bins, chairs, crates and cones: things that a vehicle knocks flying and the hero can kick over.
 *  Each one's a body of its own while it's moving and costs nothing at all once it stops. */
export class LooseProps {
  private cells = new Map<number, Item[]>();
  private all: Item[] = [];
  private active: Item[] = [];
  private away: Item[] = [];
  private tidy = 0;
  /** Something got hit: for a noise, and a puff of dust. */
  onHit: ((x: number, y: number, z: number, strength: number) => void) | null = null;

  constructor(private props: PropWorld, private world: CollisionWorld, private ground: (x: number, z: number) => number) {}

  private key(x: number, z: number): number {
    return (Math.floor(x / CELL) + 512) * 4096 + Math.floor(z / CELL) + 512;
  }

  add(id: string, x: number, y: number, z: number, angle: number): void {
    const kind = KINDS[id];
    const index = this.props.place(id, x, y, z, angle);
    if (index < 0) return;
    const collider = this.world.addCircle(x, z, kind.r, kind.h);
    collider.loose = true;
    const item: Item = { id, kind, index, collider, homeX: x, homeY: y, homeZ: z, homeYaw: angle, x, y, z, yaw: angle, vx: 0, vy: 0, vz: 0, spinV: 0, tilt: 0, tiltV: 0, tiltDir: 0, active: false, away: false };
    this.all.push(item);
    const k = this.key(x, z);
    const list = this.cells.get(k);
    if (list) list.push(item);
    else this.cells.set(k, [item]);
  }

  private wake(it: Item): void {
    if (!it.away) {
      it.away = true;
      this.away.push(it);
    }
    if (it.active) return;
    // Too many going at once: the oldest has flown far enough.
    if (this.active.length >= MAX_ACTIVE) this.sleep(this.active[0]);
    it.active = true;
    this.active.push(it);
  }

  private sleep(it: Item): void {
    it.active = false;
    it.vx = it.vy = it.vz = it.spinV = it.tiltV = 0;
    this.active.splice(this.active.indexOf(it), 1);
  }

  /** A vehicle against whatever it can reach. */
  private strike(v: Vehicle, it: Item): void {
    if (Math.abs(v.y - it.y) > 2.2) return;
    const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
    if (!obbVsCircle(v.x, v.z, sh, ch, v.spec.length * 0.5, v.spec.width * 0.5, it.x, it.z, it.kind.r)) return;
    const { nx, nz, depth, px, pz } = HIT;
    it.x -= nx * depth;
    it.z -= nz * depth;
    const vx = v.velX + v.spin * (pz - v.z), vz = v.velZ - v.spin * (px - v.x);
    const closing = -((vx - it.vx) * nx + (vz - it.vz) * nz);
    if (closing <= 0.05) {
      this.wake(it);
      return;
    }
    const m = it.kind.mass, mv = v.mass;
    // Thrown clear rather than across the district: it tumbles and catches the air.
    const flung = Math.min((1.3 * mv * closing) / (mv + m), 10 - m * 0.2);
    it.vx += -nx * flung + (vx - it.vx) * 0.12;
    it.vz += -nz * flung + (vz - it.vz) * 0.12;
    it.vy += Math.min(closing * 0.24, 4.5) * (0.6 + Math.random() * 0.5);
    it.spinV += (Math.random() - 0.5) * Math.min(closing, 11);
    it.tiltDir = Math.atan2(-nx, -nz);
    it.tiltV += Math.min(closing * 0.8, 9);
    this.wake(it);
    const j = (1.4 * mv * m * closing) / (mv + m);
    v.push(nx * j, nz * j, px, pz);
    if (closing > 1.2) this.onHit?.(px, it.y + 0.3, pz, Math.min(closing / 10, 1));
  }

  update(dt: number, hx: number, hy: number, hz: number, heroSpeed: number, vehicles: readonly Vehicle[]): void {
    for (const v of vehicles) {
      const moving = Math.abs(v.speed) + Math.abs(v.sideSpeed) + Math.abs(v.knockX) + Math.abs(v.knockZ) + Math.abs(v.spin);
      if (moving < 0.4) continue;
      // Traffic keeps to the road, so it only meets what has already been knocked into it.
      if (v.mode === "player" || v.knockX !== 0 || v.knockZ !== 0) {
        const reach = v.spec.length * 0.5 + 1;
        for (let ix = Math.floor((v.x - reach) / CELL); ix <= Math.floor((v.x + reach) / CELL); ix++) {
          for (let iz = Math.floor((v.z - reach) / CELL); iz <= Math.floor((v.z + reach) / CELL); iz++) {
            const list = this.cells.get((ix + 512) * 4096 + iz + 512);
            if (list) for (const it of list) if (!it.away) this.strike(v, it);
          }
        }
      }
      for (const it of this.away) this.strike(v, it);
    }
    // The hero on foot, up against one: a shove if they're walking, and over it goes if they're running.
    if (heroSpeed > 1) {
      const list = this.cells.get(this.key(hx, hz));
      if (list) for (const it of list) this.kick(it, hx, hy, hz, heroSpeed);
      for (const it of this.away) this.kick(it, hx, hy, hz, heroSpeed);
    }
    for (let i = this.active.length - 1; i >= 0; i--) this.step(this.active[i], dt);
    // Now and then, what's been lying about gets tidied away while nobody's looking.
    this.tidy -= dt;
    if (this.tidy <= 0 && this.away.length) {
      this.tidy = 1.5;
      for (let i = this.away.length - 1; i >= 0; i--) {
        const it = this.away[i];
        if (it.active || Math.hypot(it.x - hx, it.z - hz) < TIDIED_FROM || Math.hypot(it.homeX - hx, it.homeZ - hz) < TIDIED_FROM) continue;
        it.x = it.homeX;
        it.y = it.homeY;
        it.z = it.homeZ;
        it.yaw = it.homeYaw;
        it.tilt = 0;
        it.away = false;
        this.away.splice(i, 1);
        this.world.moveCircle(it.collider, it.x, it.z);
        this.draw(it);
      }
    }
  }

  private kick(it: Item, hx: number, hy: number, hz: number, speed: number): void {
    const dx = it.x - hx, dz = it.z - hz;
    const d = Math.hypot(dx, dz);
    if (d > it.kind.r + 0.42 || d < 1e-4 || Math.abs(hy - it.y) > 1.2) return;
    const push = (speed * 0.5 * 8) / (8 + it.kind.mass);
    it.vx = (dx / d) * Math.max(push, Math.hypot(it.vx, it.vz));
    it.vz = (dz / d) * Math.max(push, Math.hypot(it.vx, it.vz));
    if (speed > 3.2 && it.kind.mass < 12) {
      it.tiltDir = Math.atan2(dx, dz);
      it.tiltV = Math.max(it.tiltV, 3.2);
    }
    this.wake(it);
  }

  private step(it: Item, dt: number): void {
    const k = it.kind;
    it.vy -= GRAVITY * dt;
    it.x += it.vx * dt;
    it.y += it.vy * dt;
    it.z += it.vz * dt;
    it.yaw += it.spinV * dt;
    // Walls and anything else that isn't going anywhere.
    for (const c of this.world.query(it.x, it.z, k.r + 0.4)) {
      if (c === it.collider || (c.kind === "circle" && c.loose)) continue;
      let dx: number, dz: number, reach: number;
      if (c.kind === "box") {
        dx = it.x - Math.max(c.x0, Math.min(it.x, c.x1));
        dz = it.z - Math.max(c.z0, Math.min(it.z, c.z1));
        reach = k.r;
        if (dx === 0 && dz === 0) dx = it.x - (c.x0 + c.x1) / 2 || 1;
      } else {
        dx = it.x - c.x;
        dz = it.z - c.z;
        reach = k.r + c.r;
      }
      const d = Math.hypot(dx, dz);
      if (d >= reach || d < 1e-5) continue;
      const nx = dx / d, nz = dz / d;
      it.x += nx * (reach - d);
      it.z += nz * (reach - d);
      const into = it.vx * nx + it.vz * nz;
      if (into < 0) {
        it.vx -= nx * into * 1.35;
        it.vz -= nz * into * 1.35;
      }
    }
    const ground = this.ground(it.x, it.z);
    const landed = it.y <= ground;
    if (landed) {
      it.y = ground;
      if (it.vy < -1.4) {
        it.vy *= -0.32;
        it.spinV *= 0.7;
      } else it.vy = 0;
      // Dragging along the ground: it stops quite soon.
      const speed = Math.hypot(it.vx, it.vz);
      if (speed > 0) {
        const slow = Math.max(0, speed - 7 * dt) / speed;
        it.vx *= slow;
        it.vz *= slow;
      }
      it.spinV *= Math.exp(-dt * 5);
    }
    // Once past the balance point it goes right over; short of it, it rocks back on to its base.
    const balance = 0.55;
    it.tiltV += (it.tilt > balance ? 6 : -6) * dt;
    it.tilt += it.tiltV * dt;
    if (it.tilt <= 0) {
      it.tilt = 0;
      it.tiltV = Math.max(0, -it.tiltV * 0.3);
      if (it.tiltV < 0.25) it.tiltV = 0;
    } else if (it.tilt >= k.lay) {
      it.tilt = k.lay;
      it.tiltV = -Math.abs(it.tiltV) * 0.22;
      if (Math.abs(it.tiltV) < 0.3) it.tiltV = 0;
    }
    this.world.moveCircle(it.collider, it.x, it.z);
    this.draw(it);
    if (landed && it.vy === 0 && Math.hypot(it.vx, it.vz) < 0.04 && it.tiltV === 0 && Math.abs(it.spinV) < 0.1) this.sleep(it);
  }

  private draw(it: Item): void {
    Quaternion.RotationAxisToRef(UP, it.yaw, Q1);
    AXIS.set(Math.cos(it.tiltDir), 0, -Math.sin(it.tiltDir));
    Quaternion.RotationAxisToRef(AXIS, it.tilt, Q2);
    Q2.multiplyToRef(Q1, Q1);
    POS.set(it.x, it.y + Math.sin(it.tilt) * it.kind.r * 0.8, it.z);
    Matrix.ComposeToRef(UNIT, Q1, POS, M);
    this.props.setInstance(it.id, it.index, M);
  }
}
