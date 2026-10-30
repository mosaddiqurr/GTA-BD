import { CellName, cell, patch, shopCell } from "./atlas";
import { Rng } from "./cityLayout";
import { Geo, RGB } from "./geo";
import type { SignAtlas } from "./signs";

export type BuildingStyle = "resi" | "old" | "commercial" | "glass" | "tin" | "frame";

export interface BuildingSpec {
  /** Centre of the street frontage, on the ground. */
  x: number;
  z: number;
  angle: number;
  w: number;
  d: number;
  floors: number;
  style: BuildingStyle;
  seed: number;
  base: number; // ground level under the building
  /** Stands behind the street frontage, so it needs no shopfronts or balconies. */
  back?: boolean;
}

const PAINTS: RGB[] = [
  [0.96, 0.9, 0.74], [0.93, 0.84, 0.62], [0.9, 0.72, 0.66], [0.72, 0.82, 0.86],
  [0.76, 0.86, 0.74], [0.95, 0.94, 0.9], [0.86, 0.8, 0.7], [0.82, 0.62, 0.5],
  [0.74, 0.74, 0.74], [0.95, 0.78, 0.5], [0.66, 0.76, 0.66], [0.9, 0.9, 0.82],
];

const WINDOW_CELLS: CellName[] = ["winGrillA", "winGrillA", "winGrillB", "winGrillB", "winSlideB", "winCurtainA", "winCurtainB", "winSlideA", "winDark"];
const SHOP_KINDS: CellName[] = ["shopGrocery", "shopPharmacy", "shopMobile", "shopClothes", "shopTea", "shopHardware", "shopSweets", "shopBooks"];

const GROUND_H = 4.25;
const FLOOR_H = 3.05;
const SHOP_DEPTH = 2.6;

export function buildingHeight(s: BuildingSpec): number {
  if (s.style === "tin") return s.base + 3.6;
  return s.base + GROUND_H + FLOOR_H * (s.floors - 1) + 1;
}

export interface BuildingGeo {
  opaque: Geo;
  cutout: Geo;
  sign: Geo;
  shop: Geo;
}

/** Full-detail building, with real recesses, slabs and hung signs. Used near the player. */
export function buildDetailed(s: BuildingSpec, g: BuildingGeo, signs: SignAtlas): void {
  const r = new Rng(s.seed);
  g.opaque.setFrame(s.x, s.z, s.angle);
  g.cutout.setFrame(s.x, s.z, s.angle);
  g.sign.setFrame(s.x, s.z, s.angle);
  g.shop.setFrame(s.x, s.z, s.angle);
  if (s.style === "tin") return tinShed(s, r, g, signs);
  const paint = r.pick(PAINTS);
  const grime = r.range(0.72, 1);
  const tint: RGB = [paint[0] * grime, paint[1] * grime, paint[2] * grime];
  const wallCell: CellName = s.style === "frame" ? "concrete" : r.pick<CellName>(s.style === "old" ? ["plasterHeavy", "plasterHeavy", "plasterStain"] : ["plasterStain", "plasterStain", "plasterClean", "plasterHeavy"]);
  const nBays = Math.max(1, Math.round(s.w / 3.7));
  const bay = s.w / nBays;
  const x0 = -s.w / 2;
  const y0 = s.base;
  if (s.back) {
    const height = y0 + GROUND_H + FLOOR_H * (s.floors - 1);
    sides(s, r, g, signs, tint, wallCell, x0, y0, height);
    roof(s, r, g, tint, x0, height, signs);
    return;
  }

  // Ground floor.
  if (s.style === "frame") frameGround(s, r, g, bay, nBays, x0, y0);
  else shopRow(s, r, g, signs, tint, wallCell, bay, nBays, x0, y0);

  // Upper floors.
  const recipe = facadeRecipe(r, nBays, s.style);
  const winA = r.pick(WINDOW_CELLS);
  const winB = r.pick(WINDOW_CELLS);
  for (let f = 1; f < s.floors; f++) {
    const fy = y0 + GROUND_H + FLOOR_H * (f - 1);
    for (let b = 0; b < nBays; b++) {
      const bx0 = x0 + b * bay;
      const bx1 = bx0 + bay;
      if (s.style === "frame") {
        frameBay(r, g, bx0, bx1, fy);
        continue;
      }
      if (s.style === "glass") {
        g.opaque.wallFront(bx0 + 0.3, bx1 - 0.3, fy, fy + FLOOR_H, 0.06, cell("curtainWall", 0, 0, 0.75, 0.75));
        g.opaque.wallFront(bx0, bx0 + 0.3, fy, fy + FLOOR_H, 0, patch("acp", 0.3, FLOOR_H, r.next(), r.next()), tint);
        g.opaque.wallFront(bx1 - 0.3, bx1, fy, fy + FLOOR_H, 0, patch("acp", 0.3, FLOOR_H, r.next(), r.next()), tint);
        continue;
      }
      const type = recipe[b];
      // Commercial lower floors get banners over them, the usual Dhaka signage pile-up.
      if (s.style === "commercial" && f <= 2 && r.chance(0.42)) {
        wall(g.opaque, r, wallCell, tint, bx0, bx1, fy, fy + FLOOR_H);
        hangSign(g, bx0 + 0.15, bx1 - 0.15, fy + 0.4, fy + FLOOR_H - 0.3, -0.12, r.chance(0.7) ? signs.office(r) : cell(r.pick<CellName>(["vinylA", "vinylB", "vinylC"])));
        continue;
      }
      if (type === "balcony") balconyBay(r, g, tint, wallCell, bx0, bx1, fy, f === s.floors - 1);
      else if (type === "window") windowBay(r, g, tint, wallCell, bx0, bx1, fy, r.chance(0.75) ? winA : winB);
      else plainBay(r, g, tint, wallCell, bx0, bx1, fy);
    }
    // Floor band: a slim ledge that gives each storey a clean shadow line.
    if (s.style !== "frame" && s.style !== "glass") {
      g.opaque.box(x0, x0 + s.w, fy - 0.07, fy + 0.07, -0.07, 0, cell("plasterClean", 0.1, 0.1, 0.3, 0.2), shade(tint, 0.9));
    }
  }

  // Tall vertical signs bolted on commercial corners.
  if (s.style === "commercial" && s.floors >= 4 && r.chance(0.55)) {
    const sy = y0 + GROUND_H + 0.3;
    const side = r.chance(0.5) ? x0 + 0.25 : x0 + s.w - 1.05;
    hangSign(g, side, side + 0.8, sy, sy + 5.2, -0.45, signs.tallSign(r));
    g.opaque.box(side + 0.3, side + 0.5, sy + 1, sy + 1.1, -0.45, 0, cell("metal"), [0.3, 0.3, 0.3]);
    g.opaque.box(side + 0.3, side + 0.5, sy + 4, sy + 4.1, -0.45, 0, cell("metal"), [0.3, 0.3, 0.3]);
  }

  // Rental and tutoring notices pasted on the pillars between shops.
  for (let b = 0; b <= nBays; b++) {
    if (!r.chance(0.3)) continue;
    const px = x0 + b * bay;
    const py = y0 + r.range(1.2, 2);
    g.sign.wallFront(px - 0.14, px + 0.14, py, py + 0.4, -0.012, signs.poster2(r));
  }

  const top = y0 + GROUND_H + FLOOR_H * (s.floors - 1);
  sides(s, r, g, signs, tint, wallCell, x0, y0, top);
  roof(s, r, g, tint, x0, top, signs);
}

type BayKind = "balcony" | "window" | "plain";

function facadeRecipe(r: Rng, n: number, style: BuildingStyle): BayKind[] {
  const out: BayKind[] = [];
  const pattern = r.next();
  for (let b = 0; b < n; b++) {
    const mirror = Math.min(b, n - 1 - b);
    if (style === "commercial") out.push(pattern < 0.7 ? "window" : mirror % 2 === 0 ? "window" : "plain");
    else if (pattern < 0.4) out.push(mirror % 2 === 0 ? "balcony" : "window");
    else if (pattern < 0.7) out.push(mirror === 0 ? "window" : "balcony");
    else out.push(b % 3 === 2 ? "plain" : mirror % 2 === 0 ? "window" : "balcony");
  }
  return out;
}

function shade(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}

function wall(g: Geo, r: Rng, c: CellName, tint: RGB, x0: number, x1: number, y0: number, y1: number, v = 0, bottomShade = 1): void {
  if (x1 - x0 < 0.001 || y1 - y0 < 0.001) return;
  g.wallFront(x0, x1, y0, y1, v, patch(c, x1 - x0, y1 - y0, r.next(), r.next()), tint, bottomShade);
}

function hangSign(g: BuildingGeo, x0: number, x1: number, y0: number, y1: number, v: number, uv: readonly [number, number, number, number]): void {
  g.sign.wallFront(x0, x1, y0, y1, v, uv);
  // Rear box so the board has thickness and catches a shadow line.
  g.opaque.box(x0 + 0.03, x1 - 0.03, y0 + 0.03, y1 - 0.03, v + 0.01, 0.02, cell("metal", 0, 0, 0.2, 0.2), [0.2, 0.2, 0.22]);
}

function shopRow(s: BuildingSpec, r: Rng, g: BuildingGeo, signs: SignAtlas, tint: RGB, wallCell: CellName, bay: number, nBays: number, x0: number, y0: number): void {
  const openH = 3.05;
  let b = 0;
  while (b < nBays) {
    const span = nBays - b >= 2 && r.chance(0.3) ? 2 : 1;
    const bx0 = x0 + b * bay;
    const bx1 = bx0 + span * bay;
    const kind = r.pick(SHOP_KINDS);
    const pil = 0.26;
    wall(g.opaque, r, wallCell, tint, bx0, bx0 + pil, y0, y0 + GROUND_H, 0, 0.7);
    wall(g.opaque, r, wallCell, tint, bx1 - pil, bx1, y0, y0 + GROUND_H, 0, 0.7);
    wall(g.opaque, r, wallCell, tint, bx0 + pil, bx1 - pil, y0 + openH, y0 + GROUND_H);
    const ix0 = bx0 + pil, ix1 = bx1 - pil;
    const closed = r.chance(0.14);
    if (closed) {
      g.opaque.wallFront(ix0, ix1, y0, y0 + openH, 0.1, cell(r.chance(0.5) ? "shutter" : "shutterBlue"), [1, 1, 1], 0.75);
    } else {
      // Recessed shop: back wall of goods, sides, ceiling, floor and the rolled-up shutter.
      const pick = r.next();
      g.shop.wallFront(ix0, ix1, y0, y0 + openH, SHOP_DEPTH, shopCell(kind, pick), [0.92, 0.9, 0.86]);
      g.shop.wallSide(ix0, 0, SHOP_DEPTH, y0, y0 + openH, true, shopCell(kind, pick, 0, 0, 0.5, 1), [0.68, 0.66, 0.63]);
      g.shop.wallSide(ix1, 0, SHOP_DEPTH, y0, y0 + openH, false, shopCell(kind, pick, 0.5, 0, 1, 1), [0.68, 0.66, 0.63]);
      g.opaque.flat(ix0, ix1, 0, SHOP_DEPTH, y0 + 0.02, true, cell("concrete", 0, 0, 0.5, 0.5), [0.5, 0.48, 0.44]);
      g.opaque.flat(ix0, ix1, 0, SHOP_DEPTH, y0 + openH, false, cell("plasterClean", 0, 0, 0.4, 0.4), [0.95, 0.95, 0.92]);
      const roll = r.range(0.12, 0.5);
      g.opaque.wallFront(ix0, ix1, y0 + openH - roll, y0 + openH, 0.04, cell("shutter", 0, 0, 1, roll / 3), [0.9, 0.9, 0.9]);
      // Fluorescent tube, the signature light of every shop at dusk.
      g.opaque.box(ix0 + 0.5, ix1 - 0.5, y0 + openH - 0.1, y0 + openH - 0.04, 0.9, 1.0, cell("winCurtainB", 0.3, 0.3, 0.5, 0.5), [1, 1, 1], false);
    }
    const signRect = signs.shop(kind, r);
    hangSign(g, bx0 + 0.08, bx1 - 0.08, y0 + openH + 0.1, y0 + GROUND_H - 0.1, -0.14, signRect);
    // Awnings: tarp or striped.
    if (!closed && r.chance(0.6)) {
      const dep = r.range(0.9, 1.5);
      const drop = r.range(0.35, 0.6);
      const tarp = r.chance(0.35);
      const color: RGB = tarp ? [1, 1, 1] : r.pick<RGB>([[0.8, 0.15, 0.12], [0.1, 0.45, 0.2], [0.85, 0.65, 0.1], [0.12, 0.3, 0.6]]);
      const uv = cell(tarp ? "tarp" : "awning");
      const low = y0 + openH - drop;
      const high = y0 + openH;
      g.opaque.quad(ix0, low, -dep, ix1, low, -dep, ix1, high, 0, ix0, high, 0, uv, color);
      g.opaque.quad(ix1, low, -dep, ix0, low, -dep, ix0, high, 0, ix1, high, 0, uv, shade(color, 0.75));
      g.opaque.quad(ix0, low - 0.18, -dep, ix1, low - 0.18, -dep, ix1, low, -dep, ix0, low, -dep, uv, shade(color, 0.85));
    }
    b += span;
  }
}

function windowBay(r: Rng, g: BuildingGeo, tint: RGB, wallCell: CellName, x0: number, x1: number, y0: number, win: CellName): void {
  const o = g.opaque;
  const w = Math.min(x1 - x0 - 0.9, 2.0);
  const cx = (x0 + x1) / 2;
  const wx0 = cx - w / 2, wx1 = cx + w / 2;
  const sill = y0 + 0.95, head = y0 + 2.4, top = y0 + FLOOR_H;
  const depth = 0.17;
  wall(o, r, wallCell, tint, x0, wx0, y0, top);
  wall(o, r, wallCell, tint, wx1, x1, y0, top);
  wall(o, r, wallCell, tint, wx0, wx1, y0, sill);
  wall(o, r, wallCell, tint, wx0, wx1, head, top);
  const rev = cell("plasterClean", 0.1, 0.1, 0.2, 0.2);
  const dark = shade(tint, 0.62);
  o.wallSide(wx0, 0, depth, sill, head, true, rev, dark);
  o.wallSide(wx1, 0, depth, sill, head, false, rev, dark);
  o.flat(wx0, wx1, 0, depth, sill, true, rev, dark);
  o.flat(wx0, wx1, 0, depth, head, false, rev, dark);
  o.wallFront(wx0, wx1, sill, head, depth, cell(win));
  // Sill and sun-shade: the projecting concrete lip over each Dhaka window.
  o.box(wx0 - 0.06, wx1 + 0.06, sill - 0.06, sill, -0.09, 0, rev, shade(tint, 0.85));
  const c = 0.45;
  o.box(wx0 - 0.28, wx1 + 0.28, head + 0.1, head + 0.2, -c, 0, rev, shade(tint, 0.92), false);
  if (r.chance(0.22)) acUnit(o, cx + r.range(-0.3, 0.3), sill - 0.72, -0.34);
}

function acUnit(o: Geo, cx: number, y: number, v: number): void {
  const w = 0.42, h = 0.3, d = 0.34;
  o.box(cx - w, cx + w, y, y + h * 2, v, v + d, cell("metal", 0, 0, 0.3, 0.3), [0.72, 0.72, 0.7]);
  o.wallFront(cx - w, cx + w, y, y + h * 2, v - 0.005, cell("ac"));
}

function plainBay(r: Rng, g: BuildingGeo, tint: RGB, wallCell: CellName, x0: number, x1: number, y0: number): void {
  const o = g.opaque;
  wall(o, r, wallCell, tint, x0, x1, y0, y0 + FLOOR_H);
  // Small bathroom vent, with a drain pipe down most of them.
  const cx = (x0 + x1) / 2;
  o.wallFront(cx - 0.3, cx + 0.3, y0 + 1.9, y0 + 2.5, -0.015, cell("winDark", 0.05, 0.05, 0.48, 0.95));
  if (r.chance(0.7)) o.box(cx + 0.5, cx + 0.56, y0, y0 + FLOOR_H, -0.08, -0.02, cell("metal", 0, 0, 0.2, 0.2), [0.3, 0.3, 0.32]);
}

function balconyBay(r: Rng, g: BuildingGeo, tint: RGB, wallCell: CellName, x0: number, x1: number, y0: number, isTop: boolean): void {
  const o = g.opaque, c = g.cutout;
  const top = y0 + FLOOR_H;
  const dep = r.range(0.95, 1.25);
  const xa = x0 + 0.08, xb = x1 - 0.08;
  // Back wall with a door and a window.
  const doorX0 = x0 + 0.35, doorX1 = doorX0 + 0.95;
  wall(o, r, wallCell, shade(tint, 0.92), x0, doorX0, y0, top);
  wall(o, r, wallCell, shade(tint, 0.92), doorX0, doorX1, y0 + 2.15, top);
  o.wallFront(doorX0, doorX1, y0, y0 + 2.15, 0.08, cell("door"));
  const wx0 = doorX1 + 0.3, wx1 = x1 - 0.3;
  wall(o, r, wallCell, shade(tint, 0.92), doorX1, wx0, y0, top);
  wall(o, r, wallCell, shade(tint, 0.92), wx1, x1, y0, top);
  if (wx1 - wx0 > 0.5) {
    wall(o, r, wallCell, shade(tint, 0.92), wx0, wx1, y0, y0 + 0.95);
    wall(o, r, wallCell, shade(tint, 0.92), wx0, wx1, y0 + 2.4, top);
    o.wallFront(wx0, wx1, y0 + 0.95, y0 + 2.4, 0.08, cell(r.pick<CellName>(["winGrillA", "winCurtainA", "winCurtainB", "winSlideB"])));
  } else {
    wall(o, r, wallCell, shade(tint, 0.92), wx0, wx1, y0, top);
  }
  // Slab, with a slab above on the top floor (the next floor's slab otherwise).
  // Plaster slab with a tiled floor on top only; from the street you see its pale underside.
  o.box(xa, xb, y0 - 0.14, y0, -dep, 0, cell("plasterClean", 0, 0, 0.4, 0.4), shade(tint, 0.85), false);
  o.flat(xa, xb, -dep, 0, y0 + 0.005, true, cell("balconyFloor"), [0.92, 0.9, 0.85]);
  if (isTop) o.box(xa, xb, top - 0.14, top, -dep, 0, cell("plasterClean", 0, 0, 0.3, 0.3), tint, false);
  const railH = 1.0;
  if (r.chance(0.32)) {
    // Solid parapet, often faced with tile.
    const faced = r.chance(0.5);
    const uv = faced ? cell("tileMosaic", 0, 0, 0.3, 0.2) : patch(wallCell, 1, 0.5, r.next(), r.next());
    o.box(xa, xb, y0, y0 + railH, -dep, -dep + 0.1, uv, faced ? [0.9, 0.95, 1] : tint);
    o.box(xa, xa + 0.1, y0, y0 + railH, -dep, 0, patch(wallCell, 1, 0.5, r.next(), r.next()), tint);
    o.box(xb - 0.1, xb, y0, y0 + railH, -dep, 0, patch(wallCell, 1, 0.5, r.next(), r.next()), tint);
  } else {
    const rail = cell(r.chance(0.5) ? "railPlain" : "railOrnate");
    c.wallFront(xa, xb, y0, y0 + railH, -dep, rail);
    c.wallSide(xa, -dep, 0, y0, y0 + railH, false, rail);
    c.wallSide(xb, -dep, 0, y0, y0 + railH, true, rail);
  }
  if (r.chance(0.55)) {
    // Washing on a line: thin cloth hanging just inside the rail.
    c.wallFront(xa + 0.1, xb - 0.1, y0 + 1.0, top - 0.25, -dep + 0.25, cell(r.chance(0.5) ? "laundryA" : "laundryB"));
  }
  if (r.chance(0.4)) c.wallFront(xa + 0.1, xb - 0.1, y0 + 0.75, y0 + 1.35, -dep - 0.02, cell("plants"));
}

function frameGround(s: BuildingSpec, r: Rng, g: BuildingGeo, bay: number, nBays: number, x0: number, y0: number): void {
  const o = g.opaque;
  for (let b = 0; b <= nBays; b++) {
    const x = x0 + b * bay;
    o.box(x - 0.2, x + 0.2, y0, y0 + GROUND_H, 0.1, 0.5, patch("concrete", 0.4, 4, r.next(), r.next()), [1, 1, 1]);
    o.box(x - 0.2, x + 0.2, y0, y0 + GROUND_H, s.d - 0.5, s.d - 0.1, patch("concrete", 0.4, 4, r.next(), r.next()), [1, 1, 1]);
  }
  o.wallBack(x0, x0 + s.w, y0, y0 + GROUND_H, s.d - 0.2, patch("brick", 4, 4, r.next(), r.next()));
  o.flat(x0, x0 + s.w, 0, s.d, y0 + 0.03, true, cell("concrete", 0, 0, 0.5, 0.5), [0.8, 0.78, 0.74]);
  o.flat(x0, x0 + s.w, 0, s.d, y0 + GROUND_H, false, cell("concrete", 0, 0, 0.5, 0.5), [0.7, 0.7, 0.7]);
}

function frameBay(r: Rng, g: BuildingGeo, x0: number, x1: number, y0: number): void {
  const o = g.opaque;
  const top = y0 + FLOOR_H;
  o.box(x0 - 0.2, x0 + 0.2, y0, top, 0.1, 0.5, patch("concrete", 0.4, 3, r.next(), r.next()));
  o.box(x1 - 0.2, x1 + 0.2, y0, top, 0.1, 0.5, patch("concrete", 0.4, 3, r.next(), r.next()));
  o.box(x0, x1, top - 0.28, top, 0.1, 0.5, patch("concrete", 3, 0.3, r.next(), r.next()), [1, 1, 1], false);
  o.flat(x0, x1, 0.1, 6, y0 + 0.02, true, cell("concrete", 0, 0, 0.5, 0.5), [0.82, 0.8, 0.76]);
  // Half-built brick infill.
  if (r.chance(0.5)) o.wallFront(x0 + 0.2, x1 - 0.2, y0, y0 + r.range(0.8, 2.6), 0.4, patch("brick", 3, 2.6, r.next(), r.next()));
  // Bamboo scaffolding and safety mesh on some bays.
  if (r.chance(0.55)) {
    g.cutout.wallFront(x0, x1, y0, top, -0.7, cell("mesh"), [0.85, 0.85, 0.85]);
    o.box(x0 - 0.04, x0 + 0.04, y0, top, -0.74, -0.66, cell("wood", 0, 0, 0.2, 1), [1, 0.9, 0.62]);
    o.box(x0, x1, top - 0.04, top + 0.04, -0.74, -0.66, cell("wood", 0, 0, 1, 0.2), [1, 0.9, 0.62]);
  }
}

function tinShed(s: BuildingSpec, r: Rng, g: BuildingGeo, signs: SignAtlas): void {
  const o = g.opaque;
  const x0 = -s.w / 2, x1 = s.w / 2, y0 = s.base;
  const h = 2.9;
  const rust = r.pick<RGB>([[0.8, 0.72, 0.66], [0.55, 0.65, 0.72], [0.72, 0.6, 0.5]]);
  const n = Math.max(1, Math.round(s.w / 3));
  const bay = s.w / n;
  for (let b = 0; b < n; b++) {
    const bx0 = x0 + b * bay, bx1 = bx0 + bay;
    const kind = r.pick(SHOP_KINDS);
    if (r.chance(0.2)) {
      o.wallFront(bx0 + 0.1, bx1 - 0.1, y0, y0 + h, 0.08, cell("shutterBlue"), [1, 1, 1], 0.8);
    } else {
      g.shop.wallFront(bx0 + 0.1, bx1 - 0.1, y0, y0 + h, 2.0, shopCell(kind, r.next()), [0.92, 0.9, 0.86]);
      o.wallSide(bx0 + 0.1, 0, 2, y0, y0 + h, true, cell("wood", 0, 0, 0.5, 1));
      o.wallSide(bx1 - 0.1, 0, 2, y0, y0 + h, false, cell("wood", 0, 0, 0.5, 1));
      o.flat(bx0 + 0.1, bx1 - 0.1, 0, 2, y0 + 0.02, true, cell("concrete", 0, 0, 0.4, 0.4));
    }
    o.box(bx0, bx0 + 0.1, y0, y0 + h, 0, 0.1, cell("wood", 0, 0, 0.3, 1));
    o.box(bx1 - 0.1, bx1, y0, y0 + h, 0, 0.1, cell("wood", 0, 0, 0.3, 1));
    hangSign(g, bx0 + 0.1, bx1 - 0.1, y0 + h - 0.05, y0 + h + 0.55, -0.1, signs.shop(kind, r));
  }
  // Corrugated sheet roof pitched back, overhanging the front.
  const rise = 0.5;
  const uv = cell("rust", 0, 0, 1, 1);
  o.quad(x0 - 0.1, y0 + h + 0.1, -1.1, x1 + 0.1, y0 + h + 0.1, -1.1, x1 + 0.1, y0 + h + rise, s.d, x0 - 0.1, y0 + h + rise, s.d, uv, rust);
  o.quad(x1 + 0.1, y0 + h + 0.1, -1.1, x0 - 0.1, y0 + h + 0.1, -1.1, x0 - 0.1, y0 + h + rise, s.d, x1 + 0.1, y0 + h + rise, s.d, uv, shade(rust, 0.6));
  const wallUv = cell("rust", 0, 0, 1, 0.5);
  o.wallSide(x0, 0, s.d, y0, y0 + h + 0.3, false, wallUv, rust);
  o.wallSide(x1, 0, s.d, y0, y0 + h + 0.3, true, wallUv, rust);
  o.wallBack(x0, x1, y0, y0 + h + 0.4, s.d, wallUv, rust);
}

/** Side and back walls, which players do walk right up to down the alleys: real window openings
 *  near the ground, simple ones above, with drain pipes, vents and the odd air conditioner. */
function sides(s: BuildingSpec, r: Rng, g: BuildingGeo, signs: SignAtlas, tint: RGB, wallCell: CellName, x0: number, y0: number, top: number): void {
  const o = g.opaque;
  const x1 = x0 + s.w;
  const raw = s.style !== "commercial" && s.style !== "glass" && r.chance(0.3);
  const sideCell: CellName = raw ? r.pick<CellName>(["brick", "concrete"]) : wallCell;
  const sideTint: RGB = raw ? [0.95, 0.92, 0.9] : tint;
  const win = r.pick(WINDOW_CELLS);
  const rev = cell("plasterClean", 0.1, 0.1, 0.2, 0.2);
  const dark = shade(sideTint, 0.62);
  const lip = shade(sideTint, 0.86);
  const depth = 0.16;
  // Ground floor is mostly blank: boundary wall height, then the floors above carry the openings.
  const floorAt = (f: number): number => (f === 0 ? y0 : y0 + GROUND_H + FLOOR_H * (f - 1));
  const floorH = (f: number): number => (f === 0 ? GROUND_H : FLOOR_H);
  const bayW = 3.3;
  const seedU = r.next(), seedV = r.next();

  /** One wall bay; `place` maps a rect in along-wall/up coordinates onto this wall. */
  const bay = (
    a0: number, a1: number, y: number, h: number, near: boolean,
    face: (p0: number, p1: number, q0: number, q1: number, inset: number, uv: readonly [number, number, number, number], c: RGB) => void,
    jamb: (p: number, q0: number, q1: number, atEnd: boolean, c: RGB) => void,
    ledge: (p0: number, p1: number, q: number, faceUp: boolean, c: RGB) => void,
    lump: (p0: number, p1: number, q0: number, q1: number, out: number, uv: readonly [number, number, number, number], c: RGB) => void,
    poster: (p: number, q: number) => void,
  ): void => {
    // Texture follows position on the wall, so the pieces around a window line up with each other.
    const wallPart = (p0: number, p1: number, q0: number, q1: number): void => {
      const fw = Math.min((p1 - p0) / 4, 1), fh = Math.min((q1 - q0) / 4, 1);
      const fu = Math.min(frac(p0 / 4 + seedU), 1 - fw), fv = Math.min(frac(-q1 / 4 + seedV), 1 - fh);
      face(p0, p1, q0, q1, 0, cell(sideCell, fu, fv, fu + fw, fv + fh), sideTint);
    };
    const roll = r.next();
    const mid = (a0 + a1) / 2;
    if (y === y0) {
      // Street level along an alley: barred windows, a back door, and the posters that grow on any wall.
      if (roll < 0.34) {
        const w = Math.min(a1 - a0 - 1, 1.4);
        const p0 = mid - w / 2, p1 = mid + w / 2;
        wallPart(a0, p0, y, y + h);
        wallPart(p1, a1, y, y + h);
        wallPart(p0, p1, y, y + 1.2);
        wallPart(p0, p1, y + 2.3, y + h);
        face(p0, p1, y + 1.2, y + 2.3, -0.01, cell("winGrillA"), [0.85, 0.85, 0.85]);
      } else if (roll < 0.46) {
        const p0 = mid - 0.5, p1 = mid + 0.5;
        wallPart(a0, p0, y, y + h);
        wallPart(p1, a1, y, y + h);
        wallPart(p0, p1, y + 2.15, y + h);
        face(p0, p1, y, y + 2.15, -0.01, cell("door"), [0.9, 0.9, 0.9]);
      } else {
        wallPart(a0, a1, y, y + h);
        if (roll > 0.72) poster(mid + r.range(-0.8, 0.8), y + r.range(1.15, 1.6));
      }
      return;
    }
    if (roll < 0.14) {
      wallPart(a0, a1, y, y + h);
      return;
    }
    if (!near) {
      // High up only the outline matters: one wall quad with the window laid over it.
      wallPart(a0, a1, y, y + h);
      const w = Math.min(a1 - a0 - 0.8, 1.9);
      face(mid - w / 2, mid + w / 2, y + 0.95, y + 2.35, -0.01, cell(win), [1, 1, 1]);
      return;
    }
    if (roll < 0.3) {
      // Bathroom vent.
      wallPart(a0, a1, y, y + h);
      face(mid - 0.3, mid + 0.3, y + 1.9, y + 2.45, -0.015, cell("winDark", 0.05, 0.05, 0.48, 0.95), [1, 1, 1]);
      return;
    }
    const w = Math.min(a1 - a0 - 0.8, 1.9);
    const p0 = mid - w / 2, p1 = mid + w / 2;
    const sill = y + 0.95, head = y + 2.35;
    wallPart(a0, p0, y, y + h);
    wallPart(p1, a1, y, y + h);
    wallPart(p0, p1, y, sill);
    wallPart(p0, p1, head, y + h);
    face(p0, p1, sill, head, depth, cell(win), [1, 1, 1]);
    jamb(p0, sill, head, false, dark);
    jamb(p1, sill, head, true, dark);
    ledge(p0, p1, sill, true, dark);
    ledge(p0, p1, head, false, dark);
    // Concrete lip over the window.
    lump(p0 - 0.1, p1 + 0.1, head + 0.08, head + 0.16, 0.26, rev, lip);
    if (r.chance(0.16)) lump(mid - 0.42, mid + 0.42, sill - 0.66, sill - 0.08, 0.34, cell("ac"), [0.8, 0.8, 0.78]);
  };

  const floors = s.floors;
  // Left wall, faces -u; right wall, faces +u; the back wall faces +v.
  const leftFace = (p0: number, p1: number, q0: number, q1: number, inset: number, uv: readonly [number, number, number, number], c: RGB): void =>
    o.wallSide(x0 + inset, p0, p1, q0, q1, false, uv, c);
  const rightFace = (p0: number, p1: number, q0: number, q1: number, inset: number, uv: readonly [number, number, number, number], c: RGB): void =>
    o.wallSide(x1 - inset, p0, p1, q0, q1, true, uv, c);
  const backFace = (p0: number, p1: number, q0: number, q1: number, inset: number, uv: readonly [number, number, number, number], c: RGB): void =>
    o.wallBack(p0, p1, q0, q1, s.d - inset, uv, c);
  const frontFace = (p0: number, p1: number, q0: number, q1: number, inset: number, uv: readonly [number, number, number, number], c: RGB): void =>
    o.wallFront(p0, p1, q0, q1, inset, uv, c);

  for (let f = 0; f < floors; f++) {
    const y = floorAt(f);
    const h = Math.min(floorH(f), top - y);
    if (h <= 0.05) continue;
    const near = f <= 2;
    const nSide = Math.max(1, Math.round(s.d / bayW));
    const stepSide = s.d / nSide;
    for (let i = 0; i < nSide; i++) {
      const a0 = i * stepSide, a1 = a0 + stepSide;
      bay(a0, a1, y, h, near, leftFace,
        (p, q0, q1, atEnd, c) => (atEnd ? o.wallFront(x0, x0 + depth, q0, q1, p, rev, c) : o.wallBack(x0, x0 + depth, q0, q1, p, rev, c)),
        (p0, p1, q, up, c) => o.flat(x0, x0 + depth, p0, p1, q, up, rev, c),
        (p0, p1, q0, q1, out, uv, c) => o.box(x0 - out, x0, q0, q1, p0, p1, uv, c),
        (p, q) => g.sign.wallSide(x0 - 0.012, p - 0.14, p + 0.14, q, q + 0.4, false, signs.poster2(r)),
      );
      bay(a0, a1, y, h, near, rightFace,
        (p, q0, q1, atEnd, c) => (atEnd ? o.wallFront(x1 - depth, x1, q0, q1, p, rev, c) : o.wallBack(x1 - depth, x1, q0, q1, p, rev, c)),
        (p0, p1, q, up, c) => o.flat(x1 - depth, x1, p0, p1, q, up, rev, c),
        (p0, p1, q0, q1, out, uv, c) => o.box(x1, x1 + out, q0, q1, p0, p1, uv, c),
        (p, q) => g.sign.wallSide(x1 + 0.012, p - 0.14, p + 0.14, q, q + 0.4, true, signs.poster2(r)),
      );
    }
    const nBack = Math.max(1, Math.round(s.w / bayW));
    const stepBack = s.w / nBack;
    for (let i = 0; i < nBack; i++) {
      const a0 = x0 + i * stepBack, a1 = a0 + stepBack;
      bay(a0, a1, y, h, near, backFace,
        (p, q0, q1, atEnd, c) => o.wallSide(p, s.d - depth, s.d, q0, q1, !atEnd, rev, c),
        (p0, p1, q, up, c) => o.flat(p0, p1, s.d - depth, s.d, q, up, rev, c),
        (p0, p1, q0, q1, out, uv, c) => o.box(p0, p1, q0, q1, s.d, s.d + out, uv, c),
        (p, q) => g.sign.wallBack(p - 0.14, p + 0.14, q, q + 0.4, s.d + 0.012, signs.poster2(r)),
      );
      if (s.back) {
        bay(a0, a1, y, h, near, frontFace,
          (p, q0, q1, atEnd, c) => o.wallSide(p, 0, depth, q0, q1, !atEnd, rev, c),
          (p0, p1, q, up, c) => o.flat(p0, p1, 0, depth, q, up, rev, c),
          (p0, p1, q0, q1, out, uv, c) => o.box(p0, p1, q0, q1, -out, 0, uv, c),
          (p, q) => g.sign.wallFront(p - 0.14, p + 0.14, q, q + 0.4, -0.012, signs.poster2(r)),
        );
      }
    }
  }
  // Drain pipes down the corners of the back and sides.
  const pipe = cell("metal", 0, 0, 0.2, 0.2);
  const pipeTint: RGB = [0.3, 0.3, 0.32];
  o.box(x0 - 0.1, x0 - 0.02, y0, top, r.range(1, s.d - 1), r.range(1, s.d - 1) + 0.08, pipe, pipeTint);
  const pz = r.range(1, s.d - 1);
  o.box(x1 + 0.02, x1 + 0.1, y0, top, pz, pz + 0.08, pipe, pipeTint);
  const px = r.range(x0 + 1, x1 - 1);
  o.box(px, px + 0.08, y0, top, s.d + 0.02, s.d + 0.1, pipe, pipeTint);
}

function roof(s: BuildingSpec, r: Rng, g: BuildingGeo, tint: RGB, x0: number, top: number, signs: SignAtlas): void {
  const o = g.opaque;
  const x1 = x0 + s.w;
  const para = 0.95;
  const t = 0.16;
  const wallUv = (w: number): readonly [number, number, number, number] => patch("plasterStain", Math.min(w, 4), para, r.next(), r.next());
  // Front parapet is split to keep the plaster detail at scale.
  for (let x = x0; x < x1 - 0.01; x += 4) {
    const xe = Math.min(x + 4, x1);
    o.box(x, xe, top, top + para, 0, t, wallUv(xe - x), tint);
    o.box(x, xe, top, top + para, s.d - t, s.d, wallUv(xe - x), tint);
  }
  for (let v = 0; v < s.d - 0.01; v += 4) {
    const ve = Math.min(v + 4, s.d);
    o.box(x0, x0 + t, top, top + para, v, ve, wallUv(ve - v), tint);
    o.box(x1 - t, x1, top, top + para, v, ve, wallUv(ve - v), tint);
  }
  o.flat(x0 + t, x1 - t, t, s.d - t, top + 0.05, true, cell("roof"), [0.8, 0.78, 0.76]);

  // Stair room.
  const sw = 3.2, sd = 3.4;
  const sx = r.range(x0 + 1, Math.max(x0 + 1.2, x1 - sw - 1));
  const sv = r.range(s.d * 0.4, Math.max(s.d * 0.4 + 0.1, s.d - sd - 0.5));
  o.box(sx, sx + sw, top, top + 2.6, sv, sv + sd, patch("plasterHeavy", 3, 2.6, r.next(), r.next()), tint);
  o.flat(sx - 0.1, sx + sw + 0.1, sv - 0.1, sv + sd + 0.1, top + 2.65, true, cell("roof"), [0.7, 0.7, 0.68]);

  // Water tank, on nearly every Dhaka roof.
  if (r.chance(0.85)) {
    const tx = sx + sw / 2, tv = sv + sd / 2;
    octagon(o, tx, tv, 0.62, top + 2.65, top + 4.0, cell("tar"), [0.55, 0.55, 0.58]);
  }
  // Rebar left sticking up for a future floor.
  if (r.chance(0.35) && s.style !== "glass") {
    for (const [cx, cv] of [[x0 + 0.3, 0.3], [x1 - 0.3, 0.3], [x0 + 0.3, s.d - 0.3], [x1 - 0.3, s.d - 0.3]]) {
      for (let i = 0; i < 3; i++) {
        const px = cx + (i - 1) * 0.07;
        o.box(px - 0.012, px + 0.012, top + para * 0.5, top + para + 0.9, cv - 0.012, cv + 0.012, cell("rust", 0, 0, 0.2, 0.2), [0.5, 0.35, 0.28]);
      }
    }
  }
  // Rooftop billboard on commercial buildings, an ever-present feature of main roads.
  if ((s.style === "commercial" || s.style === "glass") && r.chance(0.42)) {
    const bw = Math.min(s.w - 1, r.range(7, 11));
    const bh = bw * 0.5;
    const by = top + 1.2;
    const bx = -bw / 2;
    g.sign.wallFront(bx, bx + bw, by, by + bh, 0.5, signs.billboardAd(r));
    o.box(bx, bx + bw, by, by + bh, 0.5, 0.6, cell("metal", 0, 0, 0.3, 0.3), [0.25, 0.25, 0.27]);
    for (const p of [bx + 0.5, bx + bw - 0.6]) o.box(p, p + 0.12, top, by + bh, 0.6, 0.72, cell("rust", 0, 0, 0.3, 1), [0.55, 0.5, 0.48]);
  }
}

function octagon(o: Geo, cx: number, cv: number, rad: number, y0: number, y1: number, uv: readonly [number, number, number, number], color: RGB): void {
  const pts: [number, number][] = [];
  for (let i = 0; i < 8; i++) pts.push([cx + Math.cos((i / 8) * Math.PI * 2) * rad, cv + Math.sin((i / 8) * Math.PI * 2) * rad]);
  for (let i = 0; i < 8; i++) {
    const a = pts[i], b = pts[(i + 1) % 8];
    o.quad(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1], uv, color);
  }
  for (let i = 1; i < 7; i++) {
    const a = pts[0], b = pts[i], c = pts[i + 1];
    o.quad(a[0], y1, a[1], b[0], y1, b[1], c[0], y1, c[1], c[0], y1, c[1], uv, color);
  }
}

/** Far version: one painted facade per wall, about 30 triangles a building.
 *  Also the shadow caster for blocks that are not in full detail. */
export function buildSimple(s: BuildingSpec, g: Geo, signs?: Geo, atlas?: SignAtlas): void {
  const r = new Rng(s.seed);
  g.setFrame(s.x, s.z, s.angle);
  signs?.setFrame(s.x, s.z, s.angle);
  const x0 = -s.w / 2, x1 = s.w / 2, y0 = s.base;
  if (s.style === "tin") {
    g.box(x0, x1, y0, y0 + 3.3, 0, s.d, cell("rust", 0, 0, 1, 0.5), [0.7, 0.62, 0.55]);
    return;
  }
  // Consume the same first draws as buildDetailed so a building keeps its paint between versions.
  const paint = r.pick(PAINTS);
  const grime = r.range(0.72, 1);
  const tint: RGB = [paint[0] * grime, paint[1] * grime, paint[2] * grime];
  const hasShops = s.floors > 1 && s.base > 0;
  const groundTop = y0 + (hasShops ? GROUND_H : 0);
  const top = y0 + GROUND_H + FLOOR_H * (s.floors - 1);
  const far: CellName = s.style === "frame" ? "concrete" : r.chance(0.5) ? "farA" : "farB";
  const upper = s.style === "glass" ? cell("curtainWall", 0, 0, 0.75, 0.75) : cell(far);
  const color: RGB = s.style === "glass" ? [1, 1, 1] : tint;
  const chunks = Math.max(1, Math.round((top - groundTop) / (FLOOR_H * 6)));
  const span = (top - groundTop) / chunks;
  for (let c = 0; c < chunks; c++) {
    const a = groundTop + c * span, b = a + span;
    g.wallFront(x0, x1, a, b, 0, upper, color);
    g.wallBack(x0, x1, a, b, s.d, upper, color);
    g.wallSide(x0, 0, s.d, a, b, false, upper, color);
    g.wallSide(x1, 0, s.d, a, b, true, upper, color);
  }
  if (hasShops) {
    const n = Math.max(1, Math.round(s.w / 7));
    const w = s.w / n;
    for (let i = 0; i < n; i++) {
      const kind = SHOP_KINDS[(s.seed + i) % SHOP_KINDS.length];
      g.wallFront(x0 + i * w, x0 + (i + 1) * w, y0, y0 + 3.05, 0, cell(kind));
      if (signs && atlas) signs.wallFront(x0 + i * w + 0.1, x0 + (i + 1) * w - 0.1, y0 + 3.1, y0 + 4.15, -0.05, atlas.shop(kind, r));
    }
    const stone = cell("plasterStain");
    g.wallFront(x0, x1, y0 + 3.05, y0 + GROUND_H, 0, stone, tint);
    g.wallBack(x0, x1, y0, y0 + GROUND_H, s.d, stone, tint);
    g.wallSide(x0, 0, s.d, y0, y0 + GROUND_H, false, stone, tint);
    g.wallSide(x1, 0, s.d, y0, y0 + GROUND_H, true, stone, tint);
  }
  g.box(x0, x1, top, top + 0.95, 0, s.d, cell("plasterStain", 0, 0.7, 1, 1), tint);
  g.box(-1.5, 1.5, top + 0.95, top + 3.2, s.d * 0.5, s.d * 0.5 + 3, cell("plasterHeavy"), tint);
  g.box(-0.6, 0.6, top + 3.2, top + 4.4, s.d * 0.5 + 0.8, s.d * 0.5 + 2, cell("tar"), [0.5, 0.5, 0.55]);
}

function frac(v: number): number {
  return v - Math.floor(v);
}
