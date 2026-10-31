import { Mesh, PBRMaterial, Scene } from "@babylonjs/core";
import { bn } from "../localization/bn";
import type { CharacterId, Pose } from "../characters/character";
import { ShopKind, cell, patch, shopCell } from "./atlas";
import type { BuildingSpec } from "./buildings";
import type { CollisionWorld } from "./collision";
import type { Decks } from "./decks";
import { Geo, RGB } from "./geo";
import type { FacadeMaterials } from "./atlas";

export type InteriorKind = "mall" | "restaurant" | "hotel" | "clinic" | "bank" | "home" | "office" | "thana";

/** Somewhere to stand and do something. */
export interface InsideSpot {
  x: number;
  y: number;
  z: number;
  kind: "sell" | "sleep" | "doctor" | "bank" | "exit" | "lift" | "officer" | "fineDesk";
  stock?: string;
  label?: string;
}

export interface InsidePerson {
  id: CharacterId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pose: Pose;
  /** What they sell, or do, for the hero. */
  stock?: string;
  role?: InsideSpot["kind"];
}

export interface LiftStop {
  y: number;
  label: string;
  x: number;
  z: number;
  yaw: number;
}

/** One building's inside, a long way off the map where nothing else can get at it. */
export interface Inside {
  kind: InteriorKind;
  name: string;
  /** The door on the street, and where to come back out to. */
  doorX: number;
  doorZ: number;
  outX: number;
  outZ: number;
  outYaw: number;
  /** Where you are on coming in. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  spots: InsideSpot[];
  people: InsidePerson[];
  lift: LiftStop[];
  /** Fake frontages for shops inside, so the shopkeepers can find them. */
  shops: BuildingSpec[];
}

const OFF_MAP_X = 4600;
const WIDTH = 150;
const STOREY = 3.6;

const FLOOR_TILE = (n: number): RGB => [0.86 - n * 0.03, 0.84 - n * 0.03, 0.8 - n * 0.02];

/** Inside the buildings that open. The city has one of each per door, drawn lit by tube lights whatever
 *  the hour outside, so they are made of the same atlases but take no notice of the sun. */
export class Interiors {
  readonly all: Inside[] = [];
  private unlit: PBRMaterial;
  private unlitShop: PBRMaterial;
  private geo = new Geo();
  private shopGeo = new Geo();
  private next = 0;

  constructor(private scene: Scene, facade: FacadeMaterials, private collision: CollisionWorld, private decks: Decks) {
    this.unlit = facade.opaque.clone("interior") as PBRMaterial;
    this.unlit.unlit = true;
    this.unlitShop = facade.shop.clone("interiorShop") as PBRMaterial;
    this.unlitShop.unlit = true;
  }

  /** Puts the meshes together once all the insides have been laid out. */
  finish(): void {
    for (const [g, mat, name] of [[this.geo, this.unlit, "interiors"], [this.shopGeo, this.unlitShop, "interiorShops"]] as [Geo, PBRMaterial, string][]) {
      const m: Mesh | null = g.build(name, this.scene, mat);
      if (m) m.alwaysSelectAsActiveMesh = false;
    }
  }

  // ---------------------------------------------------------------- pieces

  /** A room facing inwards: floor, ceiling, four walls. `gaps` are ways through, on the walls by name. */
  private room(x0: number, x1: number, z0: number, z1: number, y: number, h: number, wall: RGB, floor: RGB, gaps: { side: "n" | "s" | "e" | "w"; at: number; w: number }[] = []): void {
    const g = this.geo, c = this.collision;
    // Small tiles, cut smaller than the atlas draws them.
    for (let tx = x0; tx < x1 - 0.01; tx += 6) {
      for (let tz = z0; tz < z1 - 0.01; tz += 6) {
        const ex = Math.min(tx + 6, x1), ez = Math.min(tz + 6, z1);
        g.flat(tx, ex, tz, ez, y + 0.01, true, patch("tileMosaic", ex - tx, ez - tz, 0.1, 0.2), floor);
      }
    }
    g.flat(x0, x1, z0, z1, y + h, false, patch("plasterClean", x1 - x0, z1 - z0, 0.3, 0.1), [0.96, 0.96, 0.94]);
    const plaster = (a: number) => patch("plasterClean", a, h, 0.4, 0.3);
    const lengthwise = (side: "n" | "s" | "e" | "w", a0: number, a1: number): void => {
      const span = a1 - a0;
      if (span <= 0.01) return;
      // Painted plaster above, a darker dado below it, as any Dhaka office has.
      const dado: RGB = [wall[0] * 0.62, wall[1] * 0.68, wall[2] * 0.66];
      const low = patch("plasterClean", span, 1, 0.2, 0.1);
      if (side === "n") {
        g.wallFront(a0, a1, y, y + h, z1, plaster(span), wall, 0.8);
        g.wallFront(a0, a1, y, y + 1, z1 - 0.012, low, dado);
        c.addBox(a0, z1, a1, z1 + 0.3, 8);
      } else if (side === "s") {
        g.wallBack(a0, a1, y, y + h, z0, plaster(span), wall);
        g.wallBack(a0, a1, y, y + 1, z0 + 0.012, low, dado);
        c.addBox(a0, z0 - 0.3, a1, z0, 8);
      } else if (side === "e") {
        g.wallSide(x1, a0, a1, y, y + h, false, plaster(span), wall);
        g.wallSide(x1 - 0.012, a0, a1, y, y + 1, false, low, dado);
        c.addBox(x1, a0, x1 + 0.3, a1, 8);
      } else {
        g.wallSide(x0, a0, a1, y, y + h, true, plaster(span), wall);
        g.wallSide(x0 + 0.012, a0, a1, y, y + 1, true, low, dado);
        c.addBox(x0 - 0.3, a0, x0, a1, 8);
      }
    };
    for (const side of ["n", "s", "e", "w"] as const) {
      const lo = side === "n" || side === "s" ? x0 : z0, hi = side === "n" || side === "s" ? x1 : z1;
      let at = lo;
      for (const q of gaps.filter((k) => k.side === side).sort((a, b) => a.at - b.at)) {
        lengthwise(side, at, q.at - q.w / 2);
        at = q.at + q.w / 2;
      }
      lengthwise(side, at, hi);
    }
    if (y > 0.5) this.decks.floor(x0, x1, z0, z1, y);
  }

  private box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, name: Parameters<typeof cell>[0], color: RGB, solid = true): void {
    this.geo.box(x0, x1, y0, y1, z0, z1, cell(name), color, false);
    if (solid) this.collision.addBox(x0, z0, x1, z1, y1 - y0);
  }

  private table(x: number, z: number, y: number, top: RGB = [0.72, 0.52, 0.34]): void {
    this.box(x - 0.7, x + 0.7, y + 0.72, y + 0.78, z - 0.5, z + 0.5, "wood", top, false);
    this.box(x - 0.08, x + 0.08, y, y + 0.72, z - 0.08, z + 0.08, "metal", [0.34, 0.34, 0.36], false);
    this.collision.addCircle(x, z, 0.72, 0.8);
    for (const dz of [-0.95, 0.95]) {
      this.box(x - 0.24, x + 0.24, y + 0.42, y + 0.48, z + dz - 0.22, z + dz + 0.22, "wood", [0.4, 0.26, 0.16], false);
      this.box(x - 0.24, x + 0.24, y, y + 0.42, z + dz - 0.03, z + dz + 0.03, "metal", [0.3, 0.3, 0.32], false);
    }
  }

  /** A row of shops along a wall: their goods behind the counter, a sign overhead. */
  private shopfront(inside: Inside, x: number, z: number, y: number, angle: number, w: number, kind: ShopKind): void {
    const g = this.shopGeo;
    g.setFrame(x, z, angle);
    g.wallFront(-w / 2, w / 2, y, y + 3, 2.2, shopCell(kind, Math.random()), [0.96, 0.95, 0.92]);
    g.wallSide(-w / 2, 0, 2.2, y, y + 3, true, shopCell(kind, Math.random(), 0, 0, 0.5, 1), [0.74, 0.72, 0.7]);
    g.wallSide(w / 2, 0, 2.2, y, y + 3, false, shopCell(kind, Math.random(), 0.5, 0, 1, 1), [0.74, 0.72, 0.7]);
    g.clearFrame();
    const o = this.geo;
    o.setFrame(x, z, angle);
    o.flat(-w / 2, w / 2, 0, 2.2, y + 0.02, true, cell("concrete", 0, 0, 0.5, 0.5), [0.58, 0.56, 0.52]);
    o.flat(-w / 2, w / 2, 0, 2.2, y + 3, false, cell("plasterClean", 0, 0, 0.4, 0.4), [0.96, 0.96, 0.94]);
    o.clearFrame();
    inside.shops.push({ x, z, angle, w, d: 2.2, floors: 1, style: "commercial", seed: 1, base: y, shops: [{ u: 0, w, kind }] });
  }

  /** A flight up to the next floor. */
  private stairs(x: number, z0: number, z1: number, half: number, y0: number, y1: number): void {
    const g = this.geo;
    const n = Math.round((y1 - y0) / 0.18);
    const stepZ = (z1 - z0) / n, stepY = (y1 - y0) / n;
    for (let i = 0; i < n; i++) {
      const a = z0 + stepZ * i, b = a + stepZ;
      g.box(x - half, x + half, y0 + stepY * i, y0 + stepY * (i + 1), Math.min(a, b), Math.max(a, b), patch("concrete", half * 2, 1, 0.1, i * 0.03), [0.72, 0.7, 0.66]);
    }
    this.decks.add(x, y0, z0, x, y1, z1, half);
    for (const sx of [-1, 1]) {
      g.tube([[x + sx * half, y0 + 1, z0], [x + sx * half, y1 + 1, z1]], 0.03, 5, cell("metal", 0, 0, 0.3, 0.3), [0.55, 0.55, 0.58]);
      this.collision.addBox(Math.min(x + sx * half, x + sx * (half + 0.15)), Math.min(z0, z1), Math.max(x + sx * half, x + sx * (half + 0.15)), Math.max(z0, z1), 0);
    }
  }

  /** A lift's doors on one floor, with room to stand in front of them. */
  private liftDoors(x: number, z: number, y: number): void {
    const g = this.geo;
    g.wallFront(x - 1, x + 1, y, y + 2.4, z, cell("acp"), [0.72, 0.74, 0.76]);
    g.wallFront(x - 0.02, x + 0.02, y, y + 2.4, z - 0.01, cell("metal", 0, 0, 0.3, 0.3), [0.25, 0.25, 0.28]);
    g.box(x + 1.2, x + 1.34, y + 1.1, y + 1.4, z - 0.04, z, cell("metal", 0, 0, 0.3, 0.3), [0.82, 0.76, 0.3]);
  }

  private lamp(x0: number, x1: number, z: number, y: number): void {
    this.box(x0, x1, y - 0.05, y, z - 0.08, z + 0.08, "plasterClean", [1.5, 1.5, 1.42], false);
  }

  private makeInside(kind: InteriorKind, name: string, doorX: number, doorZ: number, angle: number): { inside: Inside; ox: number; oz: number } {
    const n = this.next++;
    const ox = OFF_MAP_X + (n % 8) * WIDTH, oz = 300 + Math.floor(n / 8) * WIDTH;
    const sa = Math.sin(angle), ca = Math.cos(angle);
    const inside: Inside = { kind, name, doorX, doorZ, outX: doorX - sa * 1.5, outZ: doorZ - ca * 1.5, outYaw: angle + Math.PI, x: ox, y: 0, z: oz, yaw: 0, spots: [], people: [], lift: [], shops: [] };
    this.all.push(inside);
    return { inside, ox, oz };
  }

  private exitAt(inside: Inside, x: number, z: number, y = 0): void {
    inside.x = x;
    inside.z = z + 1.4;
    inside.y = y;
    inside.yaw = 0;
    inside.spots.push({ x, y, z: z + 0.5, kind: "exit" });
    // The doors themselves, with the daylight behind them.
    this.geo.wallBack(x - 1.5, x + 1.5, y, y + 2.6, z, cell("acp"), [1.5, 1.6, 1.7]);
    this.box(x - 0.04, x + 0.04, y, y + 2.6, z, z + 0.04, "metal", [0.2, 0.2, 0.2], false);
  }

  // ---------------------------------------------------------------- the buildings

  add(kind: InteriorKind, name: string, doorX: number, doorZ: number, angle: number): Inside {
    const made = this.makeInside(kind, name, doorX, doorZ, angle);
    const { inside, ox, oz } = made;
    if (kind === "mall") this.mall(inside, ox, oz);
    else if (kind === "restaurant") this.restaurant(inside, ox, oz);
    else if (kind === "clinic") this.clinic(inside, ox, oz);
    else if (kind === "bank") this.bank(inside, ox, oz);
    else if (kind === "thana") this.thana(inside, ox, oz);
    else this.tower(inside, ox, oz, kind);
    return inside;
  }

  private mall(q: Inside, ox: number, oz: number): void {
    const wall: RGB = [0.88, 0.9, 0.92], floor: RGB = [0.88, 0.86, 0.82];
    const hw = 34, D = 44, H = 5.2;
    // Two floors round an open middle.
    this.room(ox - hw, ox + hw, oz, oz + D, 0, H, wall, floor);
    const y1 = H;
    this.geo.flat(ox - hw, ox + hw, oz, oz + D, y1 + 0.01, true, patch("tileWhite", 68, 44, 0.1, 0.2), floor);
    this.room(ox - hw, ox + hw, oz, oz + D, y1, H, wall, floor);
    this.exitAt(q, ox, oz);
    const trades: ShopKind[] = ["shopClothes", "shopSari", "shopElectronics", "shopMobile", "shopGold", "shopBooks", "shopSweets", "shopPharmacy", "shopClothes", "shopRepair"];
    let t = 0;
    for (let i = 0; i < 6; i++) {
      const x = ox - hw + 6 + i * 11;
      // Along the back of each floor, and on the upper floor at the front too.
      this.shopfront(q, x, oz + D - 2.2, 0, 0, 10, trades[t++ % trades.length]);
      this.collision.addBox(x - 5, oz + D - 1.9, x + 5, oz + D, 3);
      this.shopfront(q, x, oz + D - 2.2, y1, 0, 10, trades[t++ % trades.length]);
    }
    for (let i = 0; i < 3; i++) {
      const z = oz + 8 + i * 11;
      this.shopfront(q, ox + hw - 2.2, z, 0, Math.PI / 2, 10, trades[t++ % trades.length]);
      this.collision.addBox(ox + hw - 1.9, z - 5, ox + hw, z + 5, 3);
      this.shopfront(q, ox - hw + 2.2, z, 0, -Math.PI / 2, 10, trades[t++ % trades.length]);
      this.collision.addBox(ox - hw, z - 5, ox - hw + 1.9, z + 5, 3);
    }
    // The food court upstairs.
    for (let i = 0; i < 6; i++) this.table(ox - 18 + i * 7, oz + 10 + (i % 2) * 8, y1);
    for (const [x, stock] of [[-20, "shopBiryani"], [20, "shopRice"]] as [number, string][]) {
      this.box(ox + x - 3, ox + x + 3, y1, y1 + 1, oz + 22, oz + 23, "wood", [0.6, 0.4, 0.26]);
      q.people.push({ id: "npc_shop_papaya", x: ox + x, y: y1, z: oz + 23.8, yaw: Math.PI, pose: "idle_look", stock, role: "sell" });
    }
    // Stairs from ground to first, and a lift.
    this.stairs(ox - 14, oz + 6, oz + 26, 1.4, 0, y1);
    q.lift = [
      { y: 0, label: bn.inside.floor(0), x: ox + 10, z: oz + 30, yaw: 0 },
      { y: y1, label: bn.inside.floor(1), x: ox + 10, z: oz + 30, yaw: 0 },
    ];
    for (const s of q.lift) {
      this.liftDoors(ox + 10, oz + 31.6, s.y);
      q.spots.push({ x: ox + 10, y: s.y, z: oz + 30.6, kind: "lift" });
    }
    this.collision.addBox(ox + 8.9, oz + 31.6, ox + 11.1, oz + 34, 8);
    for (let i = 0; i < 12; i++) this.lamp(ox - 24 + i * 4.4, ox - 22 + i * 4.4, oz + 16, H - 0.1);
    for (let i = 0; i < 12; i++) this.lamp(ox - 24 + i * 4.4, ox - 22 + i * 4.4, oz + 16, H * 2 - 0.1);
    // Shoppers standing about.
    const ids: CharacterId[] = ["npc_woman_peach", "npc_woman_apple", "npc_office_orange", "npc_student_lemon", "npc_girl_pear", "npc_woman_plum"];
    for (let i = 0; i < 14; i++) {
      q.people.push({ id: ids[i % ids.length], x: ox - 26 + Math.random() * 52, y: i % 2 ? y1 : 0, z: oz + 8 + Math.random() * 24, yaw: Math.random() * 6.28, pose: i % 3 ? "idle_look" : "talk" });
    }
    q.people.push({ id: "npc_guard_melon", x: ox + 4, y: 0, z: oz + 2.2, yaw: 0, pose: "stand" });
  }

  private restaurant(q: Inside, ox: number, oz: number): void {
    this.room(ox - 11, ox + 11, oz, oz + 14, 0, 3.4, [0.92, 0.84, 0.7], FLOOR_TILE(1));
    this.exitAt(q, ox, oz);
    for (let i = 0; i < 6; i++) this.table(ox - 7.5 + (i % 3) * 7.5, oz + 4 + Math.floor(i / 3) * 4, 0);
    this.box(ox - 8, ox + 8, 0, 0.86, oz + 11.8, oz + 12.6, "wood", [0.55, 0.36, 0.22]);
    q.people.push({ id: "npc_shop_papaya", x: ox, y: 0, z: oz + 13.1, yaw: Math.PI, pose: "idle_look", stock: "shopBiryani", role: "sell" });
    q.people.push({ id: "npc_commuter_lychee", x: ox - 7.5, y: 0.2, z: oz + 3.05, yaw: 0, pose: "sit_bench" });
    q.people.push({ id: "npc_woman_peach", x: ox + 7.5, y: 0.2, z: oz + 7.05, yaw: 0, pose: "sit_bench" });
    q.people.push({ id: "npc_office_orange", x: ox, y: 0.2, z: oz + 8.95, yaw: Math.PI, pose: "sit_bench" });
    for (let i = 0; i < 4; i++) this.lamp(ox - 8 + i * 5, ox - 6.5 + i * 5, oz + 7, 3.3);
  }

  private clinic(q: Inside, ox: number, oz: number): void {
    this.room(ox - 11, ox + 11, oz, oz + 9, 0, 3.2, [0.92, 0.96, 0.96], FLOOR_TILE(0), [{ side: "n", at: ox + 6, w: 1.6 }]);
    this.exitAt(q, ox, oz);
    // Reception, and a row of chairs for waiting in.
    this.box(ox - 9, ox - 3, 0, 0.86, oz + 6.2, oz + 7, "plasterClean", [0.82, 0.88, 0.92]);
    q.people.push({ id: "npc_woman_peach", x: ox - 6, y: 0, z: oz + 7.6, yaw: Math.PI, pose: "idle_look" });
    for (let i = 0; i < 6; i++) {
      const x = ox + 1.2 + i * 1.3;
      this.box(x - 0.5, x + 0.5, 0.42, 0.48, oz + 1.2, oz + 1.8, "metal", [0.26, 0.42, 0.64]);
      if (i % 2 === 0) q.people.push({ id: i === 2 ? "npc_granny_fig" : "npc_commuter_lychee", x, y: 0.05, z: oz + 1.55, yaw: 0, pose: "sit_bench" });
    }
    // The doctor's room through the door at the back.
    this.room(ox + 1, ox + 11, oz + 9.3, oz + 16, 0, 3.2, [0.96, 0.98, 0.98], FLOOR_TILE(0), [{ side: "s", at: ox + 6, w: 1.6 }]);
    this.box(ox + 3.5, ox + 8.5, 0, 0.8, oz + 13, oz + 14, "wood", [0.62, 0.48, 0.34]);
    q.people.push({ id: "npc_doctor_kiwi", x: ox + 6, y: 0, z: oz + 14.6, yaw: Math.PI, pose: "talk", role: "doctor" });
    for (let i = 0; i < 3; i++) this.lamp(ox - 8 + i * 8, ox - 6.5 + i * 8, oz + 4.5, 3.1);
  }

  private bank(q: Inside, ox: number, oz: number): void {
    this.room(ox - 12, ox + 12, oz, oz + 14, 0, 3.8, [0.88, 0.88, 0.82], [0.76, 0.74, 0.7]);
    this.exitAt(q, ox, oz);
    this.box(ox - 11, ox + 11, 0, 0.86, oz + 9, oz + 9.8, "wood", [0.44, 0.3, 0.2]);
    for (let i = 0; i < 4; i++) {
      const x = ox - 8 + i * 5.2;
      this.geo.wallFront(x - 2, x + 2, 0.86, 2.1, oz + 9.1, cell("winDark"), [0.7, 0.8, 0.85]);
      q.people.push({ id: i % 2 ? "npc_office_orange" : "npc_woman_peach", x, y: 0, z: oz + 10.6, yaw: Math.PI, pose: "idle_look", role: i === 1 ? "bank" : undefined });
      this.collision.addBox(x - 0.1, oz + 9.8, x + 0.1, oz + 14, 3);
    }
    q.people.push({ id: "npc_guard_melon", x: ox - 9, y: 0, z: oz + 2.2, yaw: 0.6, pose: "stand" });
    for (let i = 0; i < 4; i++) q.people.push({ id: i % 2 ? "npc_boss_quince" : "npc_commuter_lychee", x: ox - 2.8, y: 0, z: oz + 7.8 - i * 1.1, yaw: 0, pose: "stand" });
    for (let i = 0; i < 4; i++) this.lamp(ox - 8 + i * 5.2, ox - 6.5 + i * 5.2, oz + 5, 3.7);
  }

  /** A police station: the duty officer's counter, and the desk where fines get paid. */
  private thana(q: Inside, ox: number, oz: number): void {
    this.room(ox - 10, ox + 10, oz, oz + 12, 0, 3.4, [0.82, 0.84, 0.74], [0.62, 0.62, 0.58]);
    this.exitAt(q, ox, oz);
    this.box(ox - 8, ox + 2, 0, 0.86, oz + 7.6, oz + 8.4, "wood", [0.36, 0.28, 0.2]);
    q.people.push({ id: "npc_police_coconut", x: ox - 5, y: 0, z: oz + 9.2, yaw: Math.PI, pose: "idle_look", role: "officer" });
    q.people.push({ id: "npc_police_coconut", x: ox - 1, y: 0, z: oz + 9.2, yaw: Math.PI, pose: "talk", role: "fineDesk" });
    q.people.push({ id: "npc_police_coconut", x: ox + 7, y: 0, z: oz + 3.4, yaw: -1.2, pose: "police" });
    for (let i = 0; i < 4; i++) {
      const x = ox + 3.5 + i * 1.3;
      this.box(x - 0.5, x + 0.5, 0.42, 0.48, oz + 9.4, oz + 10, "metal", [0.3, 0.32, 0.34]);
    }
    q.people.push({ id: "npc_worker_jackfruit", x: ox + 4.8, y: 0.05, z: oz + 9.7, yaw: Math.PI, pose: "sit_bench" });
    for (let i = 0; i < 3; i++) this.lamp(ox - 7 + i * 7, ox - 5.5 + i * 7, oz + 6, 3.3);
  }

  /** Anything of several storeys: a lobby, stairs and a lift, and what each floor is for. */
  private tower(q: Inside, ox: number, oz: number, kind: InteriorKind): void {
    const W = 16, D = 16;
    const floors = kind === "home" ? 3 : 3;
    this.room(ox - W, ox + W, oz, oz + D, 0, STOREY, [0.9, 0.88, 0.82], FLOOR_TILE(0));
    this.exitAt(q, ox, oz);
    // The stair well in one corner, each flight straight up beside the last.
    const sx = ox - W + 3;
    for (let i = 0; i < floors - 1; i++) {
      const y0 = i * STOREY, y1 = y0 + STOREY;
      const up = i % 2 === 0;
      this.stairs(sx, up ? oz + 3 : oz + 11, up ? oz + 11 : oz + 3, 1.3, y0, y1);
    }
    // Lift doors in the same place on every floor.
    const lx = ox - W + 10;
    const labels = kind === "home" ? [bn.inside.floor(0), bn.inside.floor(1), bn.inside.homeFloor] : kind === "hotel" ? [bn.inside.floor(0), bn.inside.floor(1), bn.inside.floor(2)] : [bn.inside.floor(0), bn.inside.floor(1), bn.inside.floor(2)];
    for (let i = 0; i < floors; i++) {
      const y = i * STOREY;
      this.liftDoors(lx, oz + D, y);
      q.lift.push({ y, label: labels[i], x: lx, z: oz + D - 1.4, yaw: Math.PI });
      q.spots.push({ x: lx, y, z: oz + D - 1, kind: "lift" });
      if (i > 0) this.room(ox - W, ox + W, oz, oz + D, y, STOREY, [0.9, 0.88, 0.82], FLOOR_TILE(i));
      for (let k = 0; k < 4; k++) this.lamp(ox - 10 + k * 7, ox - 8.5 + k * 7, oz + 8, y + STOREY - 0.1);
    }
    if (kind === "home") {
      q.people.push({ id: "npc_guard_melon", x: ox + 6, y: 0, z: oz + 3, yaw: -0.7, pose: "stand" });
      const y = 2 * STOREY;
      // The hero's flat, on the top floor: a bed, a table, a stove, a window.
      this.box(ox + 2, ox + 2.2, y, y + STOREY - 0.1, oz + 0.5, oz + 6, "plasterClean", [0.92, 0.88, 0.76]);
      this.box(ox + 2, ox + 2.2, y, y + STOREY - 0.1, oz + 8, oz + D, "plasterClean", [0.92, 0.88, 0.76]);
      this.box(ox + 12, ox + 15.6, y, y + 0.62, oz + 11, oz + 15.5, "wood", [0.58, 0.44, 0.34]);
      this.box(ox + 12.1, ox + 15.5, y + 0.62, y + 0.72, oz + 11.1, oz + 15.4, "plasterClean", [0.9, 0.76, 0.66], false);
      q.spots.push({ x: ox + 11, y, z: oz + 13, kind: "sleep" });
      this.table(ox + 7, oz + 11, y);
      this.box(ox + 3, ox + 6, y, y + 0.9, oz + 15, oz + 15.9, "tileWhite", [0.86, 0.86, 0.84]);
      this.box(ox + 3.6, ox + 4.4, y + 0.9, y + 1.04, oz + 15.2, oz + 15.8, "metal", [0.3, 0.3, 0.32], false);
      this.box(ox + 8, ox + 10, y + 1, y + 2.2, oz + 15.9, oz + 16, "winCurtainA", [1.1, 1.1, 1.1], false);
    } else if (kind === "hotel") {
      this.box(ox + 2, ox + 10, 0, 0.86, oz + 9, oz + 9.8, "wood", [0.5, 0.32, 0.2]);
      q.people.push({ id: "npc_office_orange", x: ox + 6, y: 0, z: oz + 10.6, yaw: Math.PI, pose: "idle_look", stock: "hotelDesk", role: "sell" });
      for (let i = 1; i < floors; i++) {
        const y = i * STOREY;
        for (let k = 0; k < 2; k++) {
          const x0 = ox - 2 + k * 9;
          this.box(x0, x0 + 0.2, y, y + STOREY - 0.1, oz + 7, oz + D, "plasterClean", [0.88, 0.84, 0.74]);
          this.box(x0 + 3, x0 + 7, y, y + 0.62, oz + 12, oz + 15.6, "wood", [0.56, 0.42, 0.32]);
          this.box(x0 + 3.1, x0 + 6.9, y + 0.62, y + 0.72, oz + 12.1, oz + 15.5, "plasterClean", [0.92, 0.9, 0.8], false);
          q.spots.push({ x: x0 + 5, y, z: oz + 11, kind: "sleep" });
        }
      }
    } else {
      q.people.push({ id: "npc_guard_melon", x: ox + 8, y: 0, z: oz + 4, yaw: -0.7, pose: "stand" });
      this.box(ox + 2, ox + 12, 0, 0.86, oz + 9, oz + 9.8, "acp", [0.5, 0.56, 0.62]);
      q.people.push({ id: "npc_woman_peach", x: ox + 7, y: 0, z: oz + 10.6, yaw: Math.PI, pose: "idle_look" });
      for (let i = 1; i < floors; i++) {
        const y = i * STOREY;
        for (let k = 0; k < 12; k++) {
          const dx = ox - 4 + (k % 4) * 5, dz = oz + 3 + Math.floor(k / 4) * 4;
          this.box(dx - 1, dx + 1, y + 0.72, y + 0.78, dz - 0.5, dz + 0.5, "wood", [0.66, 0.56, 0.42]);
          this.box(dx - 0.3, dx + 0.3, y + 0.78, y + 1.2, dz - 0.3, dz - 0.26, "winDark", [0.5, 0.6, 0.7], false);
          q.people.push({ id: k % 3 === 0 ? "npc_woman_plum" : k % 3 === 1 ? "npc_office_orange" : "npc_boss_quince", x: dx, y: y + 0.05, z: dz + 1, yaw: Math.PI, pose: "sit_bench" });
        }
      }
    }
  }
}
