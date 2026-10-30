import { Color3, DynamicTexture, Material, Mesh, PBRMaterial, Scene, Texture, VertexData } from "@babylonjs/core";
import { cell, patch } from "./atlas";
import { Block, CityLayout, Junction, KERB_H, LANE_W, Rng, roadWidth } from "./cityLayout";
import { Geo, RGB, Rect } from "./geo";
import { DIR, Heading, LaneGraph, STOP_BACK, leftOf } from "../traffic/laneGraph";
import type { CollisionWorld } from "./collision";

const WORLD = 700; // half size of the ground plane

/** Outline of a block's kerb, counter-clockwise from above, with rounded corners. */
export function blockOutline(b: Block, segs = 8): [number, number][] {
  const out: [number, number][] = [];
  const arc = (cx: number, cz: number, r: number, a0: number): void => {
    const n = r > 10 ? segs * 2 : segs;
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * (Math.PI / 2);
      out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  };
  const [sw, se, ne, nw] = b.corners;
  arc(b.x0 + sw, b.z0 + sw, sw, Math.PI);
  arc(b.x1 - se, b.z0 + se, se, -Math.PI / 2);
  arc(b.x1 - ne, b.z1 - ne, ne, 0);
  arc(b.x0 + nw, b.z1 - nw, nw, Math.PI / 2);
  return out;
}

export interface RoadSurfaces {
  ground: Mesh;
  markings: Mesh | null;
  footpath: Mesh | null;
  kerbs: Mesh | null;
  groundMaterial: PBRMaterial;
  paverMaterial: PBRMaterial;
}

export function buildRoads(
  scene: Scene,
  layout: CityLayout,
  graph: LaneGraph,
  facade: PBRMaterial,
  collision: CollisionWorld,
  macroSize: number,
  anisotropy: number,
): RoadSurfaces {
  const groundMaterial = groundMat(scene, layout, graph, macroSize, anisotropy);
  const ground = new Mesh("ground", scene);
  const vd = new VertexData();
  const s = WORLD;
  vd.positions = [-s, 0, -s, s, 0, -s, s, 0, s, -s, 0, s];
  vd.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  vd.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
  vd.indices = [0, 1, 2, 0, 2, 3];
  vd.applyToMesh(ground);
  ground.material = groundMaterial;
  ground.receiveShadows = true;
  ground.isPickable = false;
  ground.freezeWorldMatrix();

  // Footpaths and kerbs.
  const paverMaterial = new PBRMaterial("paver", scene);
  const loadTile = (f: string, linear: boolean): Texture => {
    const t = new Texture(`assets/textures/${f}`, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
    t.anisotropicFilteringLevel = anisotropy;
    t.gammaSpace = !linear;
    return t;
  };
  paverMaterial.albedoTexture = loadTile("paver_albedo.webp", false);
  paverMaterial.bumpTexture = loadTile("paver_normal.webp", true);
  paverMaterial.metallicTexture = loadTile("paver_orm.webp", true);
  paverMaterial.useRoughnessFromMetallicTextureAlpha = false;
  paverMaterial.useRoughnessFromMetallicTextureGreen = true;
  paverMaterial.useMetallnessFromMetallicTextureBlue = true;
  paverMaterial.useAmbientOcclusionFromMetallicTextureRed = true;
  paverMaterial.metallic = 1;
  paverMaterial.roughness = 1;

  const walk = new Geo();
  const kerb = new Geo();
  const r = new Rng(77);
  for (const b of layout.blocks) buildBlockSurface(b, walk, kerb, r, layout);
  buildMedians(layout, kerb, collision, r);

  const footpath = walk.build("footpath", scene, paverMaterial);
  if (footpath) footpath.receiveShadows = true;
  const kerbs = kerb.build("kerbs", scene, facade);
  if (kerbs) kerbs.receiveShadows = true;

  const markings = buildMarkings(scene, layout, anisotropy);
  return { ground, markings, footpath, kerbs, groundMaterial, paverMaterial };
}

function buildBlockSurface(b: Block, walk: Geo, kerb: Geo, r: Rng, layout: CityLayout): void {
  const outline = blockOutline(b);
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const tile = 2; // metres per texture repeat
  const tone = r.range(0.86, 1.02);
  const col: RGB = [tone, tone * 0.985, tone * 0.96];
  const inset = 0.24;
  const inner: [number, number][] = outline.map(([x, z]) => {
    const dx = x - cx, dz = z - cz;
    // Shrink toward the block's own axes so straight kerbs stay straight.
    return [x - Math.sign(dx) * inset, z - Math.sign(dz) * inset];
  });
  for (let i = 0; i < inner.length; i++) {
    const [ax, az] = inner[i];
    const [bx, bz] = inner[(i + 1) % inner.length];
    walk.tri(ax, KERB_H, az, ax / tile, az / tile, bx, KERB_H, bz, bx / tile, bz / tile, cx, KERB_H, cz, cx / tile, cz / tile, col);
  }
  // Kerb stone, cut into short lengths so paint bands and patches can vary along it.
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = outline[i];
    const [bx, bz] = outline[(i + 1) % n];
    const len = Math.hypot(bx - ax, bz - az);
    const pieces = Math.max(1, Math.round(len / 2));
    const [iax, iaz] = inner[i];
    const [ibx, ibz] = inner[(i + 1) % n];
    for (let p = 0; p < pieces; p++) {
      const t0 = p / pieces, t1 = (p + 1) / pieces;
      const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0;
      const x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
      const ix0 = iax + (ibx - iax) * t0, iz0 = iaz + (ibz - iaz) * t0;
      const ix1 = iax + (ibx - iax) * t1, iz1 = iaz + (ibz - iaz) * t1;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      // Near junctions the kerb gets the familiar black and yellow bands.
      const nearJunction = layout.junctions.some((j) => Math.hypot(mx - j.x, mz - j.z) < (j.isPlaza ? 42 : 24));
      const band = Math.floor((i * 3 + p) / 1) % 2 === 0;
      const stone: RGB = nearJunction ? (band ? [0.95, 0.72, 0.1] : [0.09, 0.09, 0.09]) : [0.62, 0.61, 0.58];
      const uv = patch("concrete", 2, 0.5, r.next(), r.next());
      kerb.quad(x0, 0, z0, x1, 0, z1, x1, KERB_H, z1, x0, KERB_H, z0, uv, stone, 0.65);
      kerb.quad(x0, KERB_H, z0, x1, KERB_H, z1, ix1, KERB_H, iz1, ix0, KERB_H, iz0, uv, stone);
    }
  }
}

function buildMedians(layout: CityLayout, kerb: Geo, collision: CollisionWorld, r: Rng): void {
  const h = 0.32;
  for (const road of layout.data.roads) {
    if (road.median <= 0) continue;
    const along = road.axis === "v";
    const stops = layout.junctions.filter((j) => (along ? j.v === road : j.h === road)).sort((a, b) => (along ? a.z - b.z : a.x - b.x));
    for (let k = 0; k + 1 < stops.length; k++) {
      const a = stops[k], c = stops[k + 1];
      const start = (along ? a.z + a.halfZ : a.x + a.halfX) + (a.isPlaza ? 2 : STOP_BACK + 0.8);
      const end = (along ? c.z - c.halfZ : c.x - c.halfX) - (c.isPlaza ? 2 : STOP_BACK + 0.8);
      if (end <= start) continue;
      const half = road.median / 2 - 0.05;
      for (let p = start; p < end - 0.01; p += 4) {
        const pe = Math.min(p + 4, end);
        const uv = patch("concrete", 4, 1, r.next(), r.next());
        const tint: RGB = [0.82, 0.8, 0.75];
        const painted: RGB = [0.92, 0.9, 0.82];
        if (along) {
          const x0 = road.at - half, x1 = road.at + half;
          kerb.clearFrame();
          kerb.quad(x0, 0, pe, x0, 0, p, x0, h, p, x0, h, pe, uv, painted, 0.6);
          kerb.quad(x1, 0, p, x1, 0, pe, x1, h, pe, x1, h, p, uv, painted, 0.6);
          kerb.quad(x0, h, p, x1, h, p, x1, h, pe, x0, h, pe, uv, tint);
        } else {
          const z0 = road.at - half, z1 = road.at + half;
          kerb.clearFrame();
          kerb.quad(p, 0, z0, pe, 0, z0, pe, h, z0, p, h, z0, uv, painted, 0.6);
          kerb.quad(pe, 0, z1, p, 0, z1, p, h, z1, pe, h, z1, uv, painted, 0.6);
          kerb.quad(p, h, z0, pe, h, z0, pe, h, z1, p, h, z1, uv, tint);
        }
      }
      if (along) collision.addBox(road.at - half, start, road.at + half, end, h);
      else collision.addBox(start, road.at - half, end, road.at + half, h);
    }
  }
}

function buildMarkings(scene: Scene, layout: CityLayout, anisotropy: number): Mesh | null {
  const g = new Geo();
  const y = 0.012;
  const FULL: Rect = [0, 0, 1, 1];
  const r = new Rng(19);
  const dash = (x0: number, z0: number, x1: number, z1: number, w: number, color: RGB): void => {
    const dx = x1 - x0, dz = z1 - z0;
    const l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * (w / 2), nz = (dx / l) * (w / 2);
    // Random window of the worn paint texture so no two dashes match.
    const u = r.next() * 0.7, v = r.next() * 0.7;
    const uv: Rect = [u, v, u + 0.3, v + 0.3];
    // Order is counter-clockwise from above whichever way the dash runs.
    const cross = dx * nz - dz * nx;
    if (cross > 0) g.quad(x0 - nx, y, z0 - nz, x1 - nx, y, z1 - nz, x1 + nx, y, z1 + nz, x0 + nx, y, z0 + nz, uv, color);
    else g.quad(x0 + nx, y, z0 + nz, x1 + nx, y, z1 + nz, x1 - nx, y, z1 - nz, x0 - nx, y, z0 - nz, uv, color);
  };
  const WHITE: RGB = [1, 1, 1];
  for (const road of layout.data.roads) {
    const along = road.axis === "v";
    const stops = layout.junctions.filter((j) => (along ? j.v === road : j.h === road)).sort((a, b) => (along ? a.z - b.z : a.x - b.x));
    for (let k = 0; k + 1 < stops.length; k++) {
      const a = stops[k], c = stops[k + 1];
      const start = (along ? a.z + a.halfZ : a.x + a.halfX) + (a.isPlaza ? 0 : STOP_BACK);
      const end = (along ? c.z - c.halfZ : c.x - c.halfX) - (c.isPlaza ? 0 : STOP_BACK);
      const line = (off: number, on: number, gap: number, w: number): void => {
        for (let p = start; p < end; p += on + gap) {
          const pe = Math.min(p + on, end);
          if (along) dash(road.at + off, p, road.at + off, pe, w, WHITE);
          else dash(p, road.at + off, pe, road.at + off, w, WHITE);
        }
      };
      const half = roadWidth(road) / 2;
      if (road.median <= 0) line(0, 3, 4, 0.14);
      for (let side = -1; side <= 1; side += 2) {
        for (let i = 1; i < road.lanesPerDir; i++) line(side * (road.median / 2 + i * LANE_W), 3, 5, 0.12);
        if (road.cls !== "street") line(side * (half - 0.45), 2000, 0, 0.12);
      }
    }
  }
  // Stop lines and zebra crossings on each junction arm.
  for (const j of layout.junctions) {
    for (let h = 0 as Heading; h < 4; h = (h + 1) as Heading) {
      if (!j.arms[h]) continue;
      const road = h % 2 === 0 ? j.v : j.h;
      const dir = DIR[h];
      const box = (h % 2 === 0 ? j.halfZ : j.halfX);
      const half = roadWidth(road) / 2 - 0.3;
      const side: [number, number] = [dir[1], -dir[0]];
      if (j.isPlaza) {
        const zebraAt = box - 3.5;
        zebra(dash, j.x + dir[0] * zebraAt, j.z + dir[1] * zebraAt, side, dir, half);
        continue;
      }
      if (!j.signal && road.cls === "street") continue;
      const zebraAt = box + 2.2;
      zebra(dash, j.x + dir[0] * zebraAt, j.z + dir[1] * zebraAt, side, dir, half);
      if (j.signal) {
        // The stop line crosses the half of the road that arrives at this junction.
        const inboundH = ((h + 2) % 4) as Heading;
        const l = leftOf(inboundH);
        const at = box + STOP_BACK;
        const mx = j.x + dir[0] * at, mz = j.z + dir[1] * at;
        const from = road.median / 2 + 0.2;
        const to = road.median / 2 + road.lanesPerDir * LANE_W;
        dash(mx + l[0] * from, mz + l[1] * from, mx + l[0] * to, mz + l[1] * to, 0.42, WHITE);
      }
    }
  }
  const mat = new PBRMaterial("marking", scene);
  const tex = new Texture("assets/textures/marking.webp", scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
  tex.hasAlpha = true;
  tex.anisotropicFilteringLevel = anisotropy;
  mat.albedoTexture = tex;
  mat.useAlphaFromAlbedoTexture = true;
  mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
  mat.metallic = 0;
  mat.roughness = 0.75;
  mat.zOffset = -2;
  const mesh = g.build("markings", scene, mat);
  if (mesh) {
    mesh.receiveShadows = true;
    mesh.alphaIndex = 1;
  }
  return mesh;
  void FULL;
}

function zebra(
  dash: (x0: number, z0: number, x1: number, z1: number, w: number, c: RGB) => void,
  cx: number, cz: number, side: readonly [number, number], dir: readonly [number, number], half: number,
): void {
  const WHITE: RGB = [1, 1, 1];
  const n = Math.floor((half * 2) / 1.1);
  for (let i = 0; i < n; i++) {
    const t = -half + (i + 0.5) * 1.1;
    const x = cx + side[0] * t, z = cz + side[1] * t;
    dash(x - dir[0] * 1.5, z - dir[1] * 1.5, x + dir[0] * 1.5, z + dir[1] * 1.5, 0.55, WHITE);
  }
}

function groundMat(scene: Scene, layout: CityLayout, graph: LaneGraph, size: number, anisotropy: number): PBRMaterial {
  const tex = new DynamicTexture("groundMacro", { width: size, height: size }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  tex.anisotropicFilteringLevel = anisotropy;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  paintMacro(ctx, size, layout, graph);
  tex.update(true);

  const mat = new PBRMaterial("asphalt", scene);
  mat.albedoTexture = tex;
  mat.metallic = 0;
  mat.roughness = 0.82;
  mat.albedoColor = new Color3(1, 1, 1);
  const detail = new Texture("assets/textures/asphalt_detail.png", scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
  detail.anisotropicFilteringLevel = anisotropy;
  detail.uScale = detail.vScale = (WORLD * 2) / 3.2; // one repeat every 3.2 m
  detail.gammaSpace = false;
  mat.detailMap.isEnabled = true;
  mat.detailMap.texture = detail;
  mat.detailMap.diffuseBlendLevel = 0.32;
  mat.detailMap.roughnessBlendLevel = 0.5;
  mat.detailMap.bumpLevel = 0.42;
  return mat;
}

/** Hand-painted world map for the road surface: wear, patches, dust and oil. */
function paintMacro(ctx: CanvasRenderingContext2D, size: number, layout: CityLayout, graph: LaneGraph): void {
  const k = size / (WORLD * 2);
  const X = (x: number): number => (x + WORLD) * k;
  const Z = (z: number): number => (WORLD - z) * k; // canvas y runs south, texture flips on upload
  const r = new Rng(909);

  ctx.fillStyle = "#514f4c";
  ctx.fillRect(0, 0, size, size);

  // Large soft tonal drift so the road never reads as a single flat colour.
  for (let i = 0; i < 600; i++) {
    const x = r.range(0, size), y = r.range(0, size), rad = r.range(10, 70) * k * 2;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r.chance(0.5);
    g.addColorStop(0, dark ? "rgba(25,24,22,0.10)" : "rgba(120,112,98,0.08)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  // Repair patches: sharply cut rectangles of darker or newer tar.
  for (const road of layout.data.roads) {
    const along = road.axis === "v";
    const half = roadWidth(road) / 2;
    const count = Math.floor((road.to - road.from) / 22);
    for (let i = 0; i < count; i++) {
      const p = r.range(road.from, road.to);
      const off = r.range(-half + 1, half - 1);
      const w = r.range(1.2, 3.4), l = r.range(1.5, 7);
      ctx.fillStyle = r.pick(["#3f3d3b", "#454340", "#5a5753", "#38373a"]);
      if (along) ctx.fillRect(X(road.at + off - w / 2), Z(p + l / 2), w * k, l * k);
      else ctx.fillRect(X(p - l / 2), Z(road.at + off + w / 2), l * k, w * k);
    }
  }

  // Tyre polish: two faint dark tracks per lane, with the oil line between them.
  ctx.lineCap = "round";
  for (const lane of graph.lanes) {
    const ax = lane.pts[0], az = lane.pts[1], bx = lane.pts[2], bz = lane.pts[3];
    const dir = DIR[lane.heading];
    const sx = dir[1], sz = -dir[0];
    for (const [off, w, col] of [[-0.75, 0.5, "rgba(30,29,28,0.22)"], [0.75, 0.5, "rgba(30,29,28,0.22)"], [0, 0.42, "rgba(12,11,10,0.16)"]] as [number, number, string][]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w * k;
      ctx.beginPath();
      ctx.moveTo(X(ax + sx * off), Z(az + sz * off));
      ctx.lineTo(X(bx + sx * off), Z(bz + sz * off));
      ctx.stroke();
    }
  }
  // Oil pools where traffic queues at stop lines.
  for (const lane of graph.lanes) {
    const bx = lane.pts[2], bz = lane.pts[3];
    const dir = DIR[lane.heading];
    for (let i = 0; i < 9; i++) {
      const d = r.range(0.5, 22);
      const x = bx - dir[0] * d + r.range(-0.5, 0.5), z = bz - dir[1] * d + r.range(-0.5, 0.5);
      const rad = r.range(0.25, 0.9) * k;
      ctx.fillStyle = `rgba(10,10,12,${r.range(0.08, 0.28)})`;
      ctx.beginPath();
      ctx.ellipse(X(x), Z(z), rad, rad * r.range(0.5, 1), r.range(0, 3), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Dust banks collect along kerbs in the dry season.
  for (const b of layout.blocks) {
    const outline = blockOutline(b, 6);
    for (const [w, a] of [[9, 0.05], [6, 0.07], [3.5, 0.09], [1.8, 0.14]] as [number, number][]) {
      ctx.strokeStyle = `rgba(148,128,98,${a})`;
      ctx.lineWidth = w * k;
      ctx.beginPath();
      outline.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
      ctx.closePath();
      ctx.stroke();
    }
    // Contact shadow right against the kerb.
    ctx.strokeStyle = "rgba(10,9,8,0.35)";
    ctx.lineWidth = 0.35 * k;
    ctx.beginPath();
    outline.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
    ctx.closePath();
    ctx.stroke();
  }

  // Cracks.
  ctx.lineCap = "butt";
  for (let i = 0; i < 2500; i++) {
    let x = r.range(-WORLD, WORLD), z = r.range(-WORLD, WORLD);
    let a = r.range(0, Math.PI * 2);
    ctx.strokeStyle = `rgba(14,13,12,${r.range(0.2, 0.5)})`;
    ctx.lineWidth = Math.max(0.6, r.range(0.03, 0.09) * k);
    ctx.beginPath();
    ctx.moveTo(X(x), Z(z));
    const n = r.int(3, 10);
    for (let s = 0; s < n; s++) {
      a += r.range(-0.7, 0.7);
      x += Math.cos(a) * r.range(0.4, 1.4);
      z += Math.sin(a) * r.range(0.4, 1.4);
      ctx.lineTo(X(x), Z(z));
    }
    ctx.stroke();
  }

  // Manholes.
  for (const road of layout.data.roads) {
    const along = road.axis === "v";
    for (let p = road.from + 18; p < road.to; p += r.range(35, 70)) {
      const off = r.range(-3, 3);
      const x = along ? road.at + off : p;
      const z = along ? p : road.at + off;
      ctx.fillStyle = "#26252a";
      ctx.beginPath();
      ctx.arc(X(x), Z(z), 0.42 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#6d6a63";
      ctx.lineWidth = 0.08 * k;
      ctx.stroke();
    }
  }
}
