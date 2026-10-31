import { Color3, Mesh, PBRMaterial, Scene, Texture } from "@babylonjs/core";
import type { RegionLayout } from "../regions/types";
import { patch, cell } from "./atlas";
import { LANE_W } from "./cityLayout";
import type { CollisionWorld } from "./collision";
import type { Decks } from "./decks";
import { Geo, RGB } from "./geo";

type Spec = NonNullable<RegionLayout["flyover"]>;

const SLAB = 0.75;
const PARAPET = 0.95;
const PIER_EVERY = 30;

/** Height of the road surface at a point along the flyover. The ramps ease in and out, as a real
 *  road's vertical curves do, so nothing bottoms out at the foot or lifts off at the crest. */
export function flyoverHeight(f: Spec, p: number): number {
  if (p <= f.start || p >= f.end) return 0;
  const up = (p - f.start) / f.ramp, down = (f.end - p) / f.ramp;
  const t = Math.min(up, down, 1);
  return f.height * t * t * (3 - 2 * t);
}

/** Half the deck's width: the inner lane each way, the median between them, and the parapets. */
export function flyoverHalf(median: number): number {
  return median / 2 + LANE_W + 0.75;
}

/** Builds the deck, ramps, piers and everything that makes it solid. Traffic gets on and off through
 *  the lane graph; the hero through `decks`. Everything is along a road's axis, so it's written in
 *  (p, y, q): p along the road, q across it. */
export function buildFlyover(scene: Scene, f: Spec, median: number, skipOver: { at: number; half: number }[], decks: Decks, collision: CollisionWorld, facade: PBRMaterial, anisotropy: number, addShadow: (m: Mesh) => void): void {
  const half = flyoverHalf(median);
  const along = f.axis === "h";
  const world = (p: number, q: number): [number, number] => (along ? [p, f.at + q] : [f.at + q, p]);
  const road = new Geo();
  const conc = new Geo();
  const paint = new Geo();
  const H = (p: number): number => flyoverHeight(f, p);

  // A strip across the road between two points, in both windings when it could be seen from either side.
  const strip = (g: Geo, p0: number, y0: number, p1: number, y1: number, q0: number, q1: number, uv: readonly [number, number, number, number], c: RGB): void => {
    const [ax, az] = world(p0, q0), [bx, bz] = world(p1, q0), [cx, cz] = world(p1, q1), [dx, dz] = world(p0, q1);
    g.quad(ax, y0, az, bx, y1, bz, cx, y1, cz, dx, y0, dz, uv, c);
    g.quad(dx, y0, dz, cx, y1, cz, bx, y1, bz, ax, y0, az, uv, c);
  };
  // A wall along the road at one side, with its top and bottom following the ramp.
  const side = (g: Geo, p0: number, p1: number, q: number, b0: number, t0: number, b1: number, t1: number, uv: readonly [number, number, number, number], c: RGB): void => {
    const [ax, az] = world(p0, q), [bx, bz] = world(p1, q);
    g.quad(ax, b0, az, bx, b1, bz, bx, t1, bz, ax, t0, az, uv, c);
    g.quad(bx, b1, bz, ax, b0, az, ax, t0, az, bx, t1, bz, uv, c);
  };

  const step = 4;
  const grey: RGB = [0.72, 0.71, 0.67];
  const dark: RGB = [0.46, 0.45, 0.42];
  const solidTo = 4.6; // up to this height a ramp is a filled embankment; above it, it stands on piers
  for (let p = f.start; p < f.end - 0.01; p += step) {
    const pe = Math.min(p + step, f.end);
    const y0 = H(p), y1 = H(pe);
    const metres = pe - p;
    strip(road, p, y0, pe, y1, -half, half, [p / 6, 0, pe / 6, half / 3], [0.92, 0.92, 0.92]);
    const u = patch("concrete", metres, 1.2, (p * 0.013) % 1, 0.3);
    for (const q of [-half, half]) {
      // Parapet, its outer and inner faces and its top.
      side(conc, p, pe, q, y0 - SLAB, y0 + PARAPET, y1 - SLAB, y1 + PARAPET, u, grey);
      side(conc, p, pe, q - Math.sign(q) * 0.3, y0, y0 + PARAPET, y1, y1 + PARAPET, u, grey);
      strip(conc, p, y0 + PARAPET, pe, y1 + PARAPET, Math.min(q, q - Math.sign(q) * 0.3), Math.max(q, q - Math.sign(q) * 0.3), u, grey);
      // Filled ramp: walls right down to the road.
      if (y0 < solidTo || y1 < solidTo) side(conc, p, pe, q, 0, y0 - SLAB + 0.01, 0, y1 - SLAB + 0.01, patch("concrete", metres, 3, (p * 0.02) % 1, 0.1), dark);
    }
    strip(conc, p, y0 - SLAB, pe, y1 - SLAB, -half, half, patch("concrete", metres, half * 2, (p * 0.017) % 1, 0.6), dark);

    // Lane paint: a dashed centre line and a solid edge either side.
    const c = cell("plasterClean", 0.1, 0.1, 0.3, 0.3);
    const white: RGB = [1, 1, 1];
    if (Math.floor(p / step) % 2 === 0) strip(paint, p, y0 + 0.02, pe, y1 + 0.02, -0.07, 0.07, c, white);
    for (const q of [-half + 0.55, half - 0.55]) strip(paint, p, y0 + 0.02, pe, y1 + 0.02, q - 0.06, q + 0.06, c, [0.95, 0.8, 0.25]);
  }

  // Solid where the ramp is filled in, closed off where it lifts clear of the road.
  const rampEnd = (from: number, dir: 1 | -1): void => {
    let p = from;
    while (H(p) < solidTo && Math.abs(p - from) < f.ramp) p += dir;
    // Open at the foot, where it can be driven onto.
    let foot = from;
    while (H(foot) < 0.7 && Math.abs(foot - from) < f.ramp) foot += dir;
    const p0 = Math.min(foot, p), p1 = Math.max(foot, p);
    const [ax, az] = world(p0, -half), [bx, bz] = world(p1, half);
    collision.addBox(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), 4);
    const y = H(p);
    const [ex, ez] = world(p, -half), [gx, gz] = world(p, half);
    const u = patch("concrete", half * 2, y, 0.2, 0.2);
    conc.quad(ex, 0, ez, gx, 0, gz, gx, y - SLAB, gz, ex, y - SLAB, ez, u, dark);
    conc.quad(gx, 0, gz, ex, 0, ez, ex, y - SLAB, ez, gx, y - SLAB, gz, u, dark);
  };
  rampEnd(f.start, 1);
  rampEnd(f.end, -1);

  // Piers down the median, standing clear of the roads that pass underneath.
  for (let p = f.start + f.ramp * 0.6; p < f.end - f.ramp * 0.6; p += PIER_EVERY) {
    if (skipOver.some((s) => Math.abs(p - s.at) < s.half + 2)) continue;
    const y = H(p);
    if (y < solidTo) continue;
    const top = y - SLAB;
    const [x, z] = world(p, 0);
    const pw = 0.85, pd = 0.6;
    const hw = along ? pd : pw, hd = along ? pw : pd;
    const u = patch("concrete", 2, top, (p * 0.03) % 1, 0.1);
    conc.quad(x - hw, 0, z - hd, x + hw, 0, z - hd, x + hw, top - 0.9, z - hd, x - hw, top - 0.9, z - hd, u, grey);
    conc.quad(x + hw, 0, z + hd, x - hw, 0, z + hd, x - hw, top - 0.9, z + hd, x + hw, top - 0.9, z + hd, u, grey);
    conc.quad(x - hw, 0, z + hd, x - hw, 0, z - hd, x - hw, top - 0.9, z - hd, x - hw, top - 0.9, z + hd, u, grey);
    conc.quad(x + hw, 0, z - hd, x + hw, 0, z + hd, x + hw, top - 0.9, z + hd, x + hw, top - 0.9, z - hd, u, grey);
    // A crosshead spreading out to carry the deck.
    const wide = half - 0.3;
    const ch = along ? pd : wide, cd = along ? wide : pd;
    const low = top - 0.9;
    conc.quad(x - ch, low, z - cd, x + ch, low, z - cd, x + ch, top, z - cd, x - ch, top, z - cd, u, grey);
    conc.quad(x + ch, low, z + cd, x - ch, low, z + cd, x - ch, top, z + cd, x + ch, top, z + cd, u, grey);
    conc.quad(x - ch, low, z + cd, x - ch, low, z - cd, x - ch, top, z - cd, x - ch, top, z + cd, u, grey);
    conc.quad(x + ch, low, z - cd, x + ch, low, z + cd, x + ch, top, z + cd, x + ch, top, z - cd, u, grey);
    conc.quad(x - ch, low, z + cd, x + ch, low, z + cd, x + ch, low, z - cd, x - ch, low, z - cd, u, dark);
    collision.addCircle(x, z, 0.95, top);
  }

  const asphalt = asphaltMaterial(scene, anisotropy);
  const roadMesh = road.build("flyoverRoad", scene, asphalt);
  if (roadMesh) roadMesh.receiveShadows = true;
  const concMesh = conc.build("flyover", scene, facade);
  if (concMesh) {
    concMesh.receiveShadows = true;
    addShadow(concMesh);
  }
  const paintMesh = paint.build("flyoverPaint", scene, facade);
  if (paintMesh) paintMesh.receiveShadows = true;

  const [ax, az] = world(f.start, 0), [bx, bz] = world(f.end, 0);
  decks.add(ax, 0, az, bx, 0, bz, half - 0.3, { wheels: true, foot: true, profile: (t) => H(f.start + (f.end - f.start) * t) });
}

/** Asphalt that repeats in metres, not the road plane's single baked picture. UVs run in sixes of metres. */
export function asphaltMaterial(scene: Scene, anisotropy: number): PBRMaterial {
  const asphalt = new PBRMaterial("asphaltStrip", scene);
  asphalt.albedoColor = new Color3(0.105, 0.105, 0.11);
  asphalt.metallic = 0;
  asphalt.roughness = 0.86;
  const detail = new Texture("assets/textures/asphalt_detail.png", scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
  detail.anisotropicFilteringLevel = anisotropy;
  detail.gammaSpace = false;
  detail.uScale = detail.vScale = 2;
  asphalt.detailMap.isEnabled = true;
  asphalt.detailMap.texture = detail;
  asphalt.detailMap.diffuseBlendLevel = 0.32;
  asphalt.detailMap.roughnessBlendLevel = 0.5;
  asphalt.detailMap.bumpLevel = 0.42;
  return asphalt;
}
