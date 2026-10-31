import type { AudioSystem } from "../audio/audio";
import type { CrashFx } from "../graphics/crashFx";
import { bn } from "../localization/bn";
import type { Pedestrians, Person } from "../npc/pedestrians";
import type { TrafficSystem } from "../traffic/trafficSystem";
import type { Anchor } from "../ui/hud";
import type { Vehicle } from "../vehicles/vehicle";
import type { City, StallSpot } from "../world/city";
import { KERB_H } from "../world/cityLayout";
import type { PropWorld } from "../world/props";

const COOLDOWN = 1.5;
/** How hard a knock has to be, in metres per second, for the other driver to climb out. */
const HARD_KNOCK = 6.5;
/** How hard, for a bike to go over. */
const BIKE_FALLS = 4;
const CART_MAX_SLIDE = 1.5;
const CART_WHEELED_BACK_AFTER = 7;
const CART_RETURN_SPEED = 0.5;
const HEARD_FROM = 16;
const POLICE_HEAR = 42;

/** A stall that's been knocked: how far it has been moved from its place. */
interface PushedCart {
  stall: StallSpot;
  ox: number;
  oz: number;
  vx: number;
  vz: number;
  spin: number;
  spinV: number;
  rest: number;
  offsets: { c: StallSpot["colliders"][number]; x: number; z: number }[];
}

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/** What happens when the hero's vehicle hits something. It's never violent and nobody is hurt: things
 *  get shoved, drivers lean on the horn and say what they think, people turn to look, and an officer
 *  nearby blows his whistle. */
export class Reactions {
  private cool = 0;
  private carts = new Map<StallSpot, PushedCart>();
  private later: { t: number; run: () => void }[] = [];

  constructor(
    private city: City,
    private props: PropWorld,
    private peds: Pedestrians,
    private traffic: TrafficSystem,
    private audio: AudioSystem,
    private line: (text: string, anchor: Anchor, id: string, top: number) => void,
    private px: () => { x: number; z: number },
    private fx: CrashFx,
    private kick: (amount: number) => void,
  ) {}

  /** A vehicle clipped someone on foot, the hero's own. They hop aside, unhurt, and everyone has a view. */
  knocked(who: Person, speed: number, v: Vehicle | null): void {
    const k = Math.min(speed / 14, 1);
    this.fx.burst(who.x, who.y + 0.3, who.z, k * 0.45, false);
    this.audio.thud(0.25 + k * 0.5);
    this.kick(0.1 + k * 0.22);
    if (v) v.speed *= 0.93;
    if (this.cool > 0) return;
    this.cool = COOLDOWN;
    const bystander = this.peds.reactToCrash(who.x, who.z, HEARD_FROM);
    if (bystander && bystander !== who) this.after(1.1, () => this.line(pick(bn.crash.knocked), bystander, bystander.id, 1.72));
    if (v) this.policeReact(v);
  }

  /** A moving vehicle bumped the hero, on foot. The driver stands on the brakes and says so. */
  heroHit(v: Vehicle): void {
    const id = v.driverId;
    v.holdTime = Math.max(v.holdTime, 1.8);
    this.audio.thud(0.4);
    this.kick(0.3);
    this.traffic.onHorn?.(v);
    if (id && this.cool <= 0) {
      this.cool = COOLDOWN;
      const anchor = seatAnchor(v);
      this.after(0.4, () => this.line(pick(bn.crash.pedestrian), anchor, id, 0.45));
    }
  }

  crash(v: Vehicle, impact: number, hit: Vehicle | null): void {
    const stall = hit ? null : this.cartNear(v);
    // The cart moves every time; the talking has a cooldown.
    if (stall) this.pushCart(stall, v, impact);
    const k = Math.min(impact / 13, 1);
    // A bike goes over away from the blow, whatever else is going on.
    if (hit && hit.tips && impact >= BIKE_FALLS && !hit.isLying) {
      hit.fall((v.x - hit.x) * Math.cos(hit.heading) - (v.z - hit.z) * Math.sin(hit.heading));
      if (hit.mode === "ai" && hit.driverId) {
        const rider = this.peds.driverComplains(hit, v.x, v.z);
        this.traffic.onHorn?.(hit);
        if (rider) this.after(1.4, () => this.line(pick(bn.crash.driverOut), rider, rider.id, 1.72));
      }
    }
    if (hit) this.fx.burst(this.traffic.lastHitX, v.y + 0.6, this.traffic.lastHitZ, k, true);
    else {
      const sign = Math.sign(v.speed) || 1;
      const reach = (v.spec.length / 2) * sign;
      this.fx.burst(v.x + Math.sin(v.heading) * reach, v.y + 0.5, v.z + Math.cos(v.heading) * reach, k, !stall);
    }
    if (this.cool > 0) return;
    this.cool = COOLDOWN;
    if (hit) this.vehicleHit(v, hit, impact);
    else if (stall) {
      const who = this.peds.vendorOf(stall);
      if (who) {
        this.peds.startle(who);
        this.line(pick(bn.crash.cart), who, who.id, 1.72);
      }
    }
    const bystander = this.peds.reactToCrash(v.x, v.z, HEARD_FROM);
    if (bystander) {
      const lines = hit || stall ? bn.crash.bystander : bn.crash.wall;
      this.after(0.8, () => this.line(pick(lines), bystander, bystander.id, 1.72));
    }
    this.policeReact(v);
  }

  /** Something small sent flying. */
  scatter(x: number, y: number, z: number, k: number): void {
    this.fx.burst(x, y, z, k * 0.4, false);
    this.audio.thud(0.15 + k * 0.4);
  }

  private vehicleHit(v: Vehicle, other: Vehicle, impact: number): void {
    const moving = other.mode === "ai";
    if (moving) {
      other.holdTime = Math.max(other.holdTime, 2 + impact * 0.2);
      this.traffic.onHorn?.(other);
    }
    if (other.driverId) {
      const id = other.driverId;
      if (moving && impact >= HARD_KNOCK) {
        const who: Person | null = this.peds.driverComplains(other, v.x, v.z);
        if (who) this.after(1.2, () => this.line(pick(bn.crash.driverOut), who, who.id, 1.72));
      } else {
        const anchor = seatAnchor(other);
        this.after(0.35, () => this.line(pick(bn.crash.driver), anchor, id, 0.45));
      }
    }
    const rider = other.passengers.find((p) => !p.hidden);
    if (rider && Math.random() < 0.6) {
      const anchor = seatAnchor(other);
      this.after(1.6, () => this.line(pick(bn.crash.passenger), anchor, rider.id, 0.45));
    }
  }

  private policeReact(v: Vehicle): void {
    for (const p of this.city.police) {
      if (Math.abs(p.x - v.x) > POLICE_HEAR || Math.abs(p.z - v.z) > POLICE_HEAR) continue;
      this.audio.whistleAt(p.x, p.z);
      this.after(0.9, () => this.line(pick(bn.crash.police), { x: p.x, y: p.y, z: p.z }, "npc_police_coconut", 1.72));
      return;
    }
  }

  private cartNear(v: Vehicle): StallSpot | null {
    let best: StallSpot | null = null;
    let bd = v.spec.length * 0.5 + 2.2;
    for (const st of this.city.stalls) {
      if (st.kind !== "cart") continue;
      const d = Math.hypot(st.x - v.x, st.z - v.z);
      if (d < bd) {
        bd = d;
        best = st;
      }
    }
    return best;
  }

  private pushCart(st: StallSpot, v: Vehicle, impact: number): void {
    let c = this.carts.get(st);
    if (!c) {
      c = { stall: st, ox: 0, oz: 0, vx: 0, vz: 0, spin: 0, spinV: 0, rest: 0, offsets: st.colliders.map((q) => ({ c: q, x: q.x - st.x, z: q.z - st.z })) };
      this.carts.set(st, c);
    }
    const dx = st.x + c.ox - v.x, dz = st.z + c.oz - v.z;
    const d = Math.hypot(dx, dz) || 1;
    const push = Math.min(impact * 0.28, 2.6);
    c.vx += (dx / d) * push;
    c.vz += (dz / d) * push;
    c.spinV += (Math.random() - 0.5) * Math.min(impact * 0.1, 0.9);
    c.rest = 0;
  }

  private moveCart(c: PushedCart): void {
    const st = c.stall;
    this.props.moveInstance(st.prop, st.instance, st.x + c.ox, KERB_H, st.z + c.oz, st.angle + c.spin);
    const cs = Math.cos(c.spin), sn = Math.sin(c.spin);
    for (const o of c.offsets) {
      this.city.collision.moveCircle(o.c, st.x + c.ox + o.x * cs + o.z * sn, st.z + c.oz - o.x * sn + o.z * cs);
    }
  }

  update(dt: number): void {
    if (this.cool > 0) this.cool -= dt;
    for (let i = this.later.length - 1; i >= 0; i--) {
      this.later[i].t -= dt;
      if (this.later[i].t <= 0) {
        const run = this.later[i].run;
        this.later.splice(i, 1);
        run();
      }
    }
    for (const c of this.carts.values()) this.stepCart(c, dt);
  }

  private stepCart(c: PushedCart, dt: number): void {
    const speed = Math.hypot(c.vx, c.vz);
    if (speed > 0.01 || Math.abs(c.spinV) > 0.01) {
      c.ox += c.vx * dt;
      c.oz += c.vz * dt;
      const off = Math.hypot(c.ox, c.oz);
      if (off > CART_MAX_SLIDE) {
        c.ox *= CART_MAX_SLIDE / off;
        c.oz *= CART_MAX_SLIDE / off;
        c.vx = c.vz = 0;
      }
      c.spin += c.spinV * dt;
      const k = Math.exp(-dt * 3.4);
      c.vx *= k;
      c.vz *= k;
      c.spinV *= k;
      this.moveCart(c);
      return;
    }
    // Once the hero has gone, the owner wheels it back where it belongs.
    c.rest += dt;
    if (c.rest < CART_WHEELED_BACK_AFTER) return;
    const hero = this.px();
    if (Math.hypot(c.stall.x + c.ox - hero.x, c.stall.z + c.oz - hero.z) < 3.5) return;
    const off = Math.hypot(c.ox, c.oz);
    const step = CART_RETURN_SPEED * dt;
    if (off <= step && Math.abs(c.spin) < 0.01) {
      c.ox = c.oz = c.spin = 0;
      this.moveCart(c);
      this.carts.delete(c.stall);
      return;
    }
    if (off > 0) {
      c.ox -= (c.ox / off) * Math.min(step, off);
      c.oz -= (c.oz / off) * Math.min(step, off);
    }
    c.spin *= Math.exp(-dt * 0.8);
    this.moveCart(c);
  }

  private after(t: number, run: () => void): void {
    this.later.push({ t, run });
  }
}

/** Above a vehicle's cab, wherever it has got to by now. */
function seatAnchor(v: Vehicle): Anchor {
  return {
    get x() {
      return v.x;
    },
    get y() {
      return v.y + v.spec.height;
    },
    get z() {
      return v.z;
    },
  };
}
