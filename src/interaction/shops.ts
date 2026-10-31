import { characterAvailable } from "../characters/character";
import type { Pedestrians, Person } from "../npc/pedestrians";
import type { BuildingSpec } from "../world/buildings";
import type { City } from "../world/city";

const KEEPERS = 20;
const KEEPER_RANGE = 38;
const REACH = 3.2;
const STAND_IN = 1.25; // how far back from the shop front the owner stands

interface Bay {
  x: number;
  y: number;
  z: number;
  yaw: number;
  kind: string;
  keeper: Person | null;
}

/** Whoever is minding the shops near the hero. There are far more shops than can be seen at once, so
 *  a small team of shopkeepers moves to the nearest ones. Buildings only list their shops once they're
 *  built in detail, so nobody appears in a shop that isn't there. */
export class Shops {
  private pool: Person[] = [];
  private bays = new Map<BuildingSpec, { count: number; list: Bay[] }>();
  private active: Bay[] = [];
  private timer = 0;
  private indoors: BuildingSpec[] = [];
  /** Open for business. */
  open = true;

  constructor(private city: City, peds: Pedestrians) {
    if (!characterAvailable("npc_shop_papaya")) return;
    for (let i = 0; i < KEEPERS; i++) this.pool.push(peds.addStanding("npc_shop_papaya"));
    for (const b of city.interiors.all) this.indoors.push(...b.shops);
  }

  private baysOf(s: BuildingSpec): Bay[] {
    const shops = s.shops ?? [];
    let entry = this.bays.get(s);
    if (entry && entry.count === shops.length) return entry.list;
    const ca = Math.cos(s.angle), sa = Math.sin(s.angle);
    entry = {
      count: shops.length,
      list: shops.map((b) => ({ x: s.x + b.u * ca + STAND_IN * sa, y: s.base, z: s.z - b.u * sa + STAND_IN * ca, yaw: s.angle + Math.PI, kind: b.kind, keeper: null })),
    };
    this.bays.set(s, entry);
    return entry.list;
  }

  /** Moves shopkeepers to the nearest open shops, a couple of times a second. */
  update(dt: number, px: number, pz: number): void {
    this.timer -= dt;
    if (this.timer > 0 || !this.pool.length) return;
    this.timer = 0.45;
    // Shut for the night: nobody's minding anything, though the mall stays open a little.
    if (!this.open) {
      for (const k of this.pool) if (!k.forceLive) k.x = k.z = 1e5;
      for (const b of this.active) b.keeper = null;
      this.active = [];
      return;
    }
    const near: { bay: Bay; d: number }[] = [];
    const everywhere = this.indoors.length ? [...this.city.frontages, ...this.indoors] : this.city.frontages;
    for (const s of everywhere) {
      if (!s.shops || Math.abs(s.x - px) > KEEPER_RANGE + s.w || Math.abs(s.z - pz) > KEEPER_RANGE + s.w) continue;
      for (const bay of this.baysOf(s)) {
        const d = Math.hypot(bay.x - px, bay.z - pz);
        if (d < KEEPER_RANGE) near.push({ bay, d });
      }
    }
    near.sort((p, q) => p.d - q.d);
    const wanted = new Set(near.slice(0, this.pool.length).map((n) => n.bay));
    // Anyone at a shop that's still wanted stays put: nobody jumps about in plain sight.
    const busy = new Set<Person>();
    for (const bay of this.active) {
      if (bay.keeper && wanted.has(bay)) busy.add(bay.keeper);
      else bay.keeper = null;
    }
    const free = this.pool.filter((k) => !busy.has(k) && !k.forceLive);
    for (const k of free) k.x = k.z = 1e5;
    for (const bay of wanted) {
      if (bay.keeper) continue;
      const k = free.pop();
      if (!k) break;
      bay.keeper = k;
      k.x = bay.x;
      k.y = bay.y;
      k.z = bay.z;
      k.yaw = bay.yaw;
    }
    this.active = [...wanted];
  }

  /** A shop of this kind close by. */
  near(kind: string, x: number, z: number, reach: number): boolean {
    return this.active.some((bay) => bay.kind === kind && Math.abs(bay.x - x) < reach && Math.abs(bay.z - z) < reach);
  }

  /** The shop the hero is standing at and more or less facing. */
  at(x: number, z: number, yaw: number): { keeper: Person; kind: string } | null {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let best: Bay | null = null, bd = REACH;
    for (const bay of this.active) {
      if (!bay.keeper) continue;
      const dx = bay.x - x, dz = bay.z - z;
      if (Math.abs(dx) > REACH || Math.abs(dz) > REACH) continue;
      const d = Math.hypot(dx, dz);
      if (d > bd || (dx * fx + dz * fz) / Math.max(d, 0.01) < 0.1) continue;
      bd = d;
      best = bay;
    }
    return best ? { keeper: best.keeper!, kind: best.kind } : null;
  }
}
