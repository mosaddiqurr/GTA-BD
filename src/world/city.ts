import { Mesh, PBRMaterial, Scene } from "@babylonjs/core";
import type { RegionManifest } from "../regions/types";
import { DIR, Heading, LaneGraph, STOP_BACK } from "../traffic/laneGraph";
import { cell, patch, createFacadeMaterials, FacadeMaterials } from "./atlas";
import { BuildingGeo, BuildingSpec, BuildingStyle, buildDetailed, buildSimple } from "./buildings";
import { Block, CityLayout, Junction, KERB_H, Rng, roadWidth } from "./cityLayout";
import { CollisionWorld } from "./collision";
import { Geo, RGB } from "./geo";
import { PropWorld } from "./props";
import { RoadSurfaces, buildRoads } from "./roads";
import { SignAtlas } from "./signs";

export interface ParkedSpot {
  x: number;
  z: number;
  angle: number;
  /** Direction from the kerb out into the road; the vehicle's own width sets how far it sits. */
  nx: number;
  nz: number;
  /** Which vehicle ids fit here. */
  kinds: string[];
  /** A specific paint job, and a spot that is filled before ordinary kerbside parking. */
  variant?: string;
}

export interface StallSpot {
  x: number;
  z: number;
  angle: number;
  kind: "tea" | "cart";
  prop: string;
}

export interface SignalHead {
  junction: Junction;
  heading: Heading; // heading of the traffic it controls
  x: number;
  z: number;
  angle: number;
}

export interface PoliceSpot {
  junction: Junction;
  x: number;
  y: number;
  z: number;
}

interface BlockChunk {
  block: Block;
  specs: BuildingSpec[];
  simple: Mesh | null;
  simpleSigns: Mesh | null;
  detail: Mesh[] | null;
  cx: number;
  cz: number;
  radius: number;
}

const DETAIL_BUDGET_MS = 2.5;
export const SHADOW_ONLY_LAYER = 0x10000000;

/** The whole district: static geometry, collision and the anchor points other systems use. */
export class City {
  readonly layout: CityLayout;
  readonly graph: LaneGraph;
  readonly collision = new CollisionWorld();
  readonly props: PropWorld;
  readonly facade: FacadeMaterials;
  readonly signs: SignAtlas;
  roads!: RoadSurfaces;
  readonly parked: ParkedSpot[] = [];
  readonly stalls: StallSpot[] = [];
  readonly signalHeads: SignalHead[] = [];
  readonly police: PoliceSpot[] = [];
  readonly busStops: { x: number; z: number; angle: number }[] = [];
  /** Street lights and lit shop frontages, for the night lighting. */
  readonly lamps: { x: number; z: number; angle: number }[] = [];
  readonly frontages: BuildingSpec[] = [];
  /** Walkable loops for pedestrians, one per block, as x,z pairs. */
  readonly walkLoops: { block: Block; pts: number[] }[] = [];

  private chunks: BlockChunk[] = [];
  private detailQueue: BlockChunk[] = [];
  private building: Generator<void, void, void> | null = null;
  private buildingChunk: BlockChunk | null = null;
  private detailRadius = 170;
  private addShadow: (m: Mesh) => void = () => {};
  private removeShadow: (m: Mesh) => void = () => {};
  private rng = new Rng(2604);
  private wires = new Geo();
  private shopMeshes = new Set<Mesh>();
  private yards = new Geo();
  private detailSet = new Set<Mesh>();
  private lastGlow = -1;

  constructor(private scene: Scene, readonly region: RegionManifest, anisotropy: number, signSize: number) {
    this.layout = new CityLayout(region.layout);
    this.graph = new LaneGraph(this.layout);
    this.props = new PropWorld(scene);
    this.facade = createFacadeMaterials(scene, anisotropy);
    this.signs = new SignAtlas(scene, signSize);
  }

  async load(onProgress: (done: number, total: number) => void): Promise<void> {
    await this.props.preload(onProgress);
  }

  generate(addShadow: (m: Mesh) => void, removeShadow: (m: Mesh) => void, macroSize: number, anisotropy: number, detailRadius: number): void {
    this.addShadow = addShadow;
    this.removeShadow = removeShadow;
    this.detailRadius = detailRadius;
    this.roads = buildRoads(this.scene, this.layout, this.graph, this.facade.opaque, this.collision, macroSize, anisotropy);
    for (const b of this.layout.blocks) {
      const specs = this.fillBlock(b);
      this.walkLoops.push({ block: b, pts: walkLoop(b) });
      const g = new Geo();
      const sg = new Geo();
      for (const s of specs) buildSimple(s, g, sg, this.signs);
      const simple = g.build(`block${b.id}_simple`, this.scene, this.facade.opaque);
      const simpleSigns = sg.build(`block${b.id}_simpleSigns`, this.scene, this.signs.material);
      if (simple) {
        simple.receiveShadows = true;
        addShadow(simple);
      }
      this.chunks.push({
        block: b,
        specs,
        simple,
        simpleSigns,
        detail: null,
        cx: (b.x0 + b.x1) / 2,
        cz: (b.z0 + b.z1) / 2,
        radius: Math.hypot(b.x1 - b.x0, b.z1 - b.z0) / 2,
      });
    }
    const yardMesh = this.yards.build("yards", this.scene, this.facade.opaque);
    if (yardMesh) yardMesh.receiveShadows = true;
    this.buildBackdrop();
    this.buildStreetFurniture();
    this.buildMetro();
    this.buildPlaza();
    this.buildBoundary();
    const wireMesh = this.wires.build("wires", this.scene, this.facade.opaque);
    if (wireMesh) wireMesh.receiveShadows = false;
    this.props.finalize(addShadow);
  }

  // ---------------------------------------------------------------- blocks

  private specAt(x: number, z: number, angle: number, w: number, d: number, floors: number, style: BuildingStyle, collide = true): BuildingSpec {
    const spec: BuildingSpec = { x, z, angle, w, d, floors, style, seed: this.rng.int(1, 1e9), base: KERB_H };
    if (style !== "frame") this.frontages.push(spec);
    if (collide) {
      // Footprint in world space. The front is inset so the player can step under awnings.
      const inset = style === "tin" || style === "commercial" || style === "resi" || style === "old" ? 1.2 : 0.3;
      const ca = Math.cos(angle), sa = Math.sin(angle);
      const corner = (u: number, v: number): [number, number] => [x + u * ca + v * sa, z - u * sa + v * ca];
      const [ax, az] = corner(-w / 2, inset);
      const [bx, bz] = corner(w / 2, d);
      this.collision.addBox(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
    }
    return spec;
  }

  private fillBlock(b: Block): BuildingSpec[] {
    const r = this.rng;
    if (b.kind === "park") return this.fillPark(b);
    if (b.kind === "terminal") return this.fillTerminal(b);
    if (b.kind === "market") return this.fillMarket(b);
    if (b.kind === "mosque") return this.fillMosque(b);
    const specs: BuildingSpec[] = [];
    const sw = b.sidewalk;
    const x0 = b.x0 + sw, x1 = b.x1 - sw, z0 = b.z0 + sw, z1 = b.z1 - sw;
    const commercial = b.kind === "commercial";
    this.pourYard(b, x0, x1, z0, z1);

    const row = (start: number, end: number, place: (center: number, w: number, d: number, floors: number, style: BuildingStyle) => void): void => {
      let p = start;
      while (end - p > 6) {
        let w = r.range(10, commercial ? 24 : 18);
        if (end - p - w < 8) w = end - p;
        // Narrow alleys ("goli") break up the frontage every so often.
        const style = pickStyle(r, commercial, b.kind);
        const floors = style === "tin" ? 1 : commercial ? r.int(5, 11) : style === "old" ? r.int(3, 5) : r.int(4, 7);
        const d = style === "tin" ? r.range(6, 9) : r.range(12, 18);
        place(p + w / 2, w, d, floors, style);
        p += w;
        if (r.chance(0.1) && end - p > 16) p += r.range(3, 4.4);
      }
    };

    const backX0 = x0, backX1 = x1;
    const [sw_, se, ne, nw] = b.corners;
    const clip = (rad: number): number => (rad > 12 ? rad * 0.9 : 0);
    // North and south rows take the full width, except where the plaza's big curve cuts in.
    row(backX0 + clip(sw_), backX1 - clip(se), (cx, w, d, f, st) => {
      specs.push(this.specAt(cx, z0, 0, w, d, f, st));
    });
    row(backX0 + clip(nw), backX1 - clip(ne), (cx, w, d, f, st) => {
      specs.push(this.specAt(cx, z1, Math.PI, w, d, f, st));
    });
    // East and west rows fill between them.
    const inner = 18;
    row(z0 + inner + clip(se) * 0.3, z1 - inner - clip(ne) * 0.3, (cz, w, d, f, st) => {
      specs.push(this.specAt(x1, cz, -Math.PI / 2, w, d, f, st));
    });
    row(z0 + inner + clip(sw_) * 0.3, z1 - inner - clip(nw) * 0.3, (cz, w, d, f, st) => {
      specs.push(this.specAt(x0, cz, Math.PI / 2, w, d, f, st));
    });

    // Block interior: taller, simpler buildings that make the skyline dense.
    const ix0 = x0 + 22, ix1 = x1 - 22, iz0 = z0 + 22, iz1 = z1 - 22;
    if (ix1 - ix0 > 12 && iz1 - iz0 > 12) {
      for (let z = iz0; z < iz1 - 8; ) {
        const dz = Math.min(r.range(14, 22), iz1 - z);
        for (let x = ix0; x < ix1 - 8; ) {
          const dx = Math.min(r.range(14, 24), ix1 - x);
          const floors = commercial ? r.int(7, 13) : r.int(5, 9);
          const inner = this.specAt(x + dx / 2, z, 0, dx - 0.6, dz - 0.6, floors, "resi");
          inner.back = true;
          specs.push(inner);
          x += dx;
        }
        z += dz;
      }
    }
    return specs;
  }

  /** Patchy concrete and dirt over the ground behind the street frontage. Stops short of the big
   *  curved corners at junctions, which stay paved. */
  private pourYard(b: Block, x0: number, x1: number, z0: number, z1: number): void {
    const r = this.rng;
    const g = this.yards;
    const [cSw, cSe, cNe, cNw] = b.corners;
    const step = 7;
    const open = (x: number, z: number, cx: number, cz: number, rad: number): boolean =>
      rad <= 12 || Math.hypot(x - cx, z - cz) > rad * 1.25;
    for (let x = x0 + 1.2; x < x1 - 1.2; x += step) {
      for (let z = z0 + 1.2; z < z1 - 1.2; z += step) {
        const xe = Math.min(x + step, x1 - 1.2), ze = Math.min(z + step, z1 - 1.2);
        const mx = (x + xe) / 2, mz = (z + ze) / 2;
        if (!open(mx, mz, x0, z0, cSw) || !open(mx, mz, x1, z0, cSe) || !open(mx, mz, x1, z1, cNe) || !open(mx, mz, x0, z1, cNw)) continue;
        const tone = r.range(0.66, 0.8);
        const color: RGB = [tone, tone * 0.95, tone * 0.87];
        g.flat(x, xe, z, ze, KERB_H + 0.01, true, patch("concrete", 4, 4, r.next(), r.next()), color);
      }
    }
  }

  private fillPark(b: Block): BuildingSpec[] {
    const r = this.rng;
    const g = new Geo();
    const sw = b.sidewalk;
    const x0 = b.x0 + sw, x1 = b.x1 - sw, z0 = b.z0 + sw, z1 = b.z1 - sw;
    // Dusty field: faded grass with a bare cricket strip down the middle.
    const grass: RGB = [0.46, 0.58, 0.26];
    const dirt: RGB = [0.78, 0.66, 0.5];
    const step = 16;
    for (let x = x0; x < x1 - 0.01; x += step) {
      for (let z = z0; z < z1 - 0.01; z += step) {
        const xe = Math.min(x + step, x1), ze = Math.min(z + step, z1);
        const tone = r.range(0.78, 1.08);
        g.flat(x, xe, z, ze, KERB_H + 0.012, true, patch("roof", 4, 4, r.next(), r.next()), [grass[0] * tone * 1.6, grass[1] * tone * 1.6, grass[2] * tone * 1.6]);
      }
    }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    g.flat(cx - 2, cx + 2, cz - 14, cz + 14, KERB_H + 0.02, true, patch("roof", 4, 4, 0.2, 0.3), [dirt[0] * 1.6, dirt[1] * 1.6, dirt[2] * 1.6]);
    // Fence along the footpath, with gaps for gates.
    const fence = cell("mesh");
    const c = new Geo();
    for (let x = x0; x < x1; x += 4) {
      if (Math.abs(x + 2 - cx) < 5) continue;
      c.wallFront(x, x + 4, KERB_H, KERB_H + 1.5, z0, fence, [0.5, 0.55, 0.5]);
      c.wallBack(x, x + 4, KERB_H, KERB_H + 1.5, z1, fence, [0.5, 0.55, 0.5]);
    }
    for (let z = z0; z < z1; z += 4) {
      if (Math.abs(z + 2 - cz) < 5) continue;
      c.wallSide(x0, z, z + 4, KERB_H, KERB_H + 1.5, false, fence, [0.5, 0.55, 0.5]);
      c.wallSide(x1, z, z + 4, KERB_H, KERB_H + 1.5, true, fence, [0.5, 0.55, 0.5]);
    }
    const mesh = g.build(`park${b.id}`, this.scene, this.facade.opaque);
    if (mesh) mesh.receiveShadows = true;
    const fm = c.build(`parkFence${b.id}`, this.scene, this.facade.cutout);
    if (fm) fm.receiveShadows = true;
    // Big shade trees around the edge, benches and a tea stall inside.
    for (let i = 0; i < 22; i++) {
      const edge = r.int(0, 3);
      const t = r.next();
      const inset = r.range(3, 7);
      const px = edge === 0 ? x0 + inset : edge === 1 ? x1 - inset : x0 + (x1 - x0) * t;
      const pz = edge === 2 ? z0 + inset : edge === 3 ? z1 - inset : z0 + (z1 - z0) * t;
      if (Math.abs(px - cx) < 6 && Math.abs(pz - cz) < 16) continue;
      this.tree(px, pz, r.pick(["tree_raintree", "tree_krishnachura", "tree_mehgoni", "tree_coconut"]));
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const px = cx + Math.cos(a) * (x1 - x0) * 0.38;
      const pz = cz + Math.sin(a) * (z1 - z0) * 0.38;
      this.props.place("bench", px, KERB_H, pz, a + Math.PI / 2);
      this.collision.addCircle(px, pz, 0.8, 0.8);
    }
    this.stall(cx + 12, z0 + 5, 0);
    this.sign3d(cx, z0 - 0.4, 3.2, 3.2, this.signs.labelOf("খেলার মাঠ"), 0);
    return [];
  }

  private fillTerminal(b: Block): BuildingSpec[] {
    const r = this.rng;
    const sw = b.sidewalk;
    const x0 = b.x0 + sw, x1 = b.x1 - sw, z0 = b.z0 + sw, z1 = b.z1 - sw;
    const g = new Geo();
    const step = 12;
    for (let x = x0; x < x1 - 0.01; x += step) {
      for (let z = z0; z < z1 - 0.01; z += step) {
        const xe = Math.min(x + step, x1), ze = Math.min(z + step, z1);
        const tone = r.range(0.7, 1);
        g.flat(x, xe, z, ze, KERB_H + 0.012, true, patch("concrete", 4, 4, r.next(), r.next()), [tone, tone * 0.96, tone * 0.9]);
      }
    }
    const mesh = g.build(`terminal${b.id}`, this.scene, this.facade.opaque);
    if (mesh) mesh.receiveShadows = true;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    // Bus bays down one side, a CNG stand on the other: all of them can be driven.
    const bays: [string, string][] = [["bus_city", "default"], ["bus_city", "blue"], ["bus_city", "yellow"], ["bus_city", "default"], ["bus_city", "blue"], ["microbus", "white"], ["truck", "default"]];
    bays.forEach(([kind, variant], i) => {
      this.parked.push({ x: x0 + 12 + i * 7, z: z1 - 12, angle: Math.PI, nx: 0, nz: 0, kinds: [kind], variant });
    });
    this.sign3d(x0 + 30, z1 - 2.5, 3.2, 3.2, this.signs.labelOf("বাস স্টপ"), Math.PI);
    for (let i = 0; i < 8; i++) {
      this.parked.push({ x: x0 + 12 + i * 6, z: cz - 6 + r.range(-0.3, 0.3), angle: 0.25, nx: 0, nz: 0, kinds: ["cng", "easybike"] });
    }
    for (let i = 0; i < 8; i++) {
      this.parked.push({ x: x0 + 12 + i * 4.5, z: z0 + 10 + r.range(-0.3, 0.3), angle: Math.PI / 2, nx: 0, nz: 0, kinds: ["rickshaw", "motorbike", "bicycle"] });
    }
    this.sign3d(cx, z0 - 0.4, 3.2, 3.2, this.signs.labelOf("সিএনজি স্ট্যান্ড"), 0);
    this.stall(x1 - 6, z0 + 5, -Math.PI / 2);
    // Ticket sheds along the back, sellers working the queue.
    for (let i = 0; i < 4; i++) {
      const sx = x0 + 18 + i * 13, sz = z1 - 24;
      this.props.place("tin_shed", sx, KERB_H, sz, Math.PI);
      this.collision.addCircle(sx, sz, 1.9, 2.4);
    }
    for (let i = 0; i < 6; i++) {
      const sx = x0 + 14 + i * 9, sz = z1 - 32 + r.range(-0.5, 0.5);
      const id = r.pick(["flexi_kiosk", "food_cart", "fruit_cart", "newspaper_stand", "clothes_rack", "umbrella_stall"]);
      this.props.place(id, sx, KERB_H, sz, Math.PI);
      this.collision.addCircle(sx, sz, 1, 1.6);
      this.stalls.push({ x: sx, z: sz, angle: Math.PI, kind: "cart", prop: id });
    }
    for (let i = 0; i < 5; i++) {
      this.props.place("sack_pile", x1 - 12 - i * 2.2, KERB_H, cz + 12 + r.range(-0.6, 0.6), r.range(0, 6.28));
      this.collision.addCircle(x1 - 12 - i * 2.2, cz + 12, 0.75, 1);
    }
    return [];
  }

  private fillMarket(b: Block): BuildingSpec[] {
    const r = this.rng;
    const sw = b.sidewalk;
    const x0 = b.x0 + sw, x1 = b.x1 - sw, z0 = b.z0 + sw, z1 = b.z1 - sw;
    const specs: BuildingSpec[] = [];
    // Tin-shed bazaar rows around a packed lane.
    const lanes = [z0, z0 + 22, z0 + 44, z0 + 66, z0 + 88];
    for (const z of lanes) {
      if (z > z1 - 8) break;
      let x = x0;
      while (x < x1 - 6) {
        const w = Math.min(r.range(6, 11), x1 - x);
        specs.push(this.specAt(x + w / 2, z, 0, w, 7, 1, "tin"));
        x += w;
        if (r.chance(0.2)) x += 2.6;
      }
      for (let i = 0; i < 4; i++) {
        const px = r.range(x0 + 4, x1 - 4);
        this.props.place(r.pick(["fruit_cart", "crates", "umbrella_stall", "food_cart"]), px, KERB_H, z - r.range(3, 7), r.range(0, 6.28));
        this.collision.addCircle(px, z - 5, 0.9, 1.6);
      }
    }
    this.sign3d((x0 + x1) / 2, z0 - 0.4, 3.2, 3.2, this.signs.labelOf("কাঁচাবাজার"), 0);
    return specs;
  }

  private fillMosque(b: Block): BuildingSpec[] {
    const specs = this.fillDenseEdges(b);
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    if (this.props.has("mosque")) {
      this.props.place("mosque", cx, KERB_H, cz - 6, Math.PI);
      this.collision.addBox(cx - 11, cz - 14, cx + 11, cz + 3);
      this.sign3d(cx, b.z0 + b.sidewalk - 0.2, 3.2, 3.2, this.signs.labelOf("মসজিদ"), 0);
    }
    return specs;
  }

  /** Buildings on the north half only, leaving the front of the block open. */
  private fillDenseEdges(b: Block): BuildingSpec[] {
    const r = this.rng;
    const specs: BuildingSpec[] = [];
    const x0 = b.x0 + b.sidewalk, x1 = b.x1 - b.sidewalk, z1 = b.z1 - b.sidewalk;
    let x = x0;
    while (x < x1 - 6) {
      const w = Math.min(r.range(10, 18), x1 - x);
      specs.push(this.specAt(x + w / 2, z1, Math.PI, w, r.range(12, 18), r.int(4, 7), "resi"));
      x += w;
    }
    return specs;
  }

  // ---------------------------------------------------------------- backdrop

  /** Tall buildings beyond the boundary road. Never reached; they sell the city's size. */
  private buildBackdrop(): void {
    const r = this.rng;
    const g = new Geo();
    const inner = this.region.layout.boundary + 12;
    const outer = inner + 200;
    const place = (x: number, z: number): void => {
      const w = r.range(14, 30), d = r.range(14, 24);
      const floors = r.int(6, 18);
      buildSimple({ x, z, angle: r.int(0, 3) * (Math.PI / 2), w, d, floors, style: "resi", seed: r.int(1, 1e9), base: 0 }, g);
    };
    for (let x = -outer; x < outer; x += 30) {
      for (let z = -outer; z < outer; z += 30) {
        if (Math.abs(x) < inner + 6 && Math.abs(z) < inner + 6) continue;
        // Leave the arterial roads visibly carrying on into the haze.
        if (Math.abs(x) < 20 || Math.abs(z) < 16) continue;
        if (r.chance(0.86)) place(x + r.range(-4, 4), z + r.range(-4, 4));
      }
    }
    const mesh = g.build("backdrop", this.scene, this.facade.opaque);
    if (mesh) mesh.receiveShadows = false;
  }

  private buildBoundary(): void {
    const lim = this.region.layout.boundary;
    const c = this.collision;
    c.addBox(-lim - 40, lim, lim + 40, lim + 40);
    c.addBox(-lim - 40, -lim - 40, lim + 40, -lim);
    c.addBox(lim, -lim - 40, lim + 40, lim + 40);
    c.addBox(-lim - 40, -lim - 40, -lim, lim + 40);
    // Road closure boards where the arterials leave the playable area.
    const r = this.rng;
    const close = (x: number, z: number, angle: number, span: number): void => {
      for (let t = -span; t <= span; t += 2.1) {
        const ca = Math.cos(angle), sa = Math.sin(angle);
        this.props.place("barrier", x + ca * t, 0, z - sa * t, angle);
      }
      this.sign3d(x, z, 2.8, 3.4, this.signs.labelOf("রাস্তা বন্ধ"), angle);
    };
    close(0, lim - 1, Math.PI, 14);
    close(0, -lim + 1, 0, 14);
    close(lim - 1, 0, -Math.PI / 2, 10);
    close(-lim + 1, 0, Math.PI / 2, 10);
    void r;
  }

  // ---------------------------------------------------------------- street furniture

  private tree(x: number, z: number, id: string): void {
    const r = this.rng;
    this.props.place(id, x, KERB_H, z, r.range(0, 6.28), r.range(0.85, 1.2));
    this.collision.addCircle(x, z, 0.35, 8);
  }

  private stall(x: number, z: number, angle: number): void {
    if (!this.props.has("tea_stall")) return;
    this.props.place("tea_stall", x, KERB_H, z, angle);
    this.collision.addCircle(x, z, 1.1, 2.4);
    this.stalls.push({ x, z, angle, kind: "tea", prop: "tea_stall" });
  }

  /** A freestanding Bangla sign on two posts. */
  private sign3d(x: number, z: number, height: number, width: number, uv: readonly [number, number, number, number], angle: number): void {
    const s = new Geo();
    const o = new Geo();
    s.setFrame(x, z, angle);
    o.setFrame(x, z, angle);
    const h = width * ((uv[3] - uv[1]) / (uv[2] - uv[0]));
    const w2 = width / 2;
    s.wallFront(-w2, w2, height, height + h, -0.05, uv);
    s.wallBack(-w2, w2, height, height + h, 0.05, uv);
    const metal = cell("metal", 0, 0, 0.3, 0.3);
    const grey: RGB = [0.3, 0.3, 0.32];
    o.box(-w2 + 0.1, -w2 + 0.2, KERB_H, height + h, -0.05, 0.05, metal, grey);
    o.box(w2 - 0.2, w2 - 0.1, KERB_H, height + h, -0.05, 0.05, metal, grey);
    s.build("sign3d", this.scene, this.signs.material);
    o.build("sign3dPosts", this.scene, this.facade.opaque)?.getScene();
  }

  private buildStreetFurniture(): void {
    const { layout, props, collision } = this;
    const r = this.rng;
    const poleAnchors: { x: number; z: number; angle: number }[][] = [];

    for (const b of layout.blocks) {
      const sw = b.sidewalk;
      const kerbIn = 0.75; // furniture sits close to the road, leaving the footpath free
      const sides: { ax: number; az: number; bx: number; bz: number; nx: number; nz: number; angle: number; road: Block["sideRoad"][number] }[] = [
        { ax: b.x0, az: b.z1, bx: b.x1, bz: b.z1, nx: 0, nz: 1, angle: 0, road: b.sideRoad[0] },
        { ax: b.x1, az: b.z1, bx: b.x1, bz: b.z0, nx: 1, nz: 0, angle: Math.PI / 2, road: b.sideRoad[1] },
        { ax: b.x1, az: b.z0, bx: b.x0, bz: b.z0, nx: 0, nz: -1, angle: Math.PI, road: b.sideRoad[2] },
        { ax: b.x0, az: b.z0, bx: b.x0, bz: b.z1, nx: -1, nz: 0, angle: -Math.PI / 2, road: b.sideRoad[3] },
      ];
      for (const s of sides) {
        const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
        const ux = (s.bx - s.ax) / len, uz = (s.bz - s.az) / len;
        const at = (t: number, inset: number): [number, number] => [s.ax + ux * t - s.nx * inset, s.az + uz * t - s.nz * inset];
        const margin = 12;
        const main = s.road?.cls === "main";
        const secondary = s.road?.cls === "secondary";

        // Utility poles with the overhead wire mess: the most Dhaka thing on any street.
        const poles: { x: number; z: number; angle: number }[] = [];
        const poleStep = 36;
        // One row per road: the block on the far side of the street keeps its own trees instead.
        const wired = s.nz > 0 || s.nx > 0;
        for (let t = margin; wired && t < len - margin; t += poleStep + r.range(-3, 3)) {
          const [px, pz] = at(t, kerbIn);
          props.place("electric_pole", px, KERB_H, pz, s.angle + Math.PI / 2);
          collision.addCircle(px, pz, 0.25, 11);
          poles.push({ x: px, z: pz, angle: s.angle + Math.PI / 2 });
          // Every so often a tangle of cables crosses the road to the buildings opposite.
          if (r.chance(0.42)) props.place("cable_bundle", px, 8.4, pz, Math.atan2(-s.nz, s.nx));
        }
        poleAnchors.push(poles);

        // Street lights on bigger roads.
        if (main || secondary) {
          for (let t = margin + 8; t < len - margin; t += 30) {
            const [px, pz] = at(t, 0.5);
            props.place("lamp_post", px, KERB_H, pz, s.angle);
            collision.addCircle(px, pz, 0.2, 9);
            this.lamps.push({ x: px, z: pz, angle: s.angle });
          }
        }

        // Footpath clutter and life, spaced so walkers still get through.
        let t = margin + r.range(0, 14);
        while (t < len - margin) {
          const [px, pz] = at(t, kerbIn + 0.25);
          // Sellers stand at the kerb and face the people walking past.
          const [sx, sz] = at(t, 1.5);
          const faceFootpath = s.angle + Math.PI;
          const roll = r.next();
          const w = sw > 4.5;
          if (roll < 0.26 && (b.kind === "dense" || b.kind === "commercial")) {
            this.tree(px, pz, r.pick(["tree_mehgoni", "tree_krishnachura", "tree_raintree", "tree_coconut", "tree_banana"]));
          } else if (roll < 0.33 && w) {
            this.stall(sx, sz, faceFootpath);
          } else if (roll < 0.5) {
            const id = r.pick(["fruit_cart", "food_cart", "umbrella_stall", "newspaper_stand", "flexi_kiosk", "clothes_rack", "shoe_stall", "plant_nursery"]);
            props.place(id, sx, KERB_H, sz, faceFootpath);
            collision.addCircle(sx, sz, 0.9, 1.6);
            this.stalls.push({ x: sx, z: sz, angle: faceFootpath, kind: "cart", prop: id });
          } else if (roll < 0.56) {
            props.place("dustbin", px, KERB_H, pz, r.range(0, 6.28));
            collision.addCircle(px, pz, 0.35, 1.1);
          } else if (roll < 0.62) {
            props.place(r.pick(["crates", "sack_pile"]), px, KERB_H, pz, r.range(0, 6.28));
            collision.addCircle(px, pz, 0.65, 1);
          } else if (roll < 0.66) {
            props.place("van_cart", px, KERB_H, pz, s.angle + Math.PI / 2 + r.range(-0.15, 0.15));
            collision.addCircle(px, pz, 0.95, 1.3);
          } else if (roll < 0.7) {
            props.place("electric_box", px, KERB_H, pz, s.angle);
            collision.addCircle(px, pz, 0.4, 1.4);
          } else if (roll < 0.78 && (main || secondary)) {
            props.place("planter", px, KERB_H, pz, 0);
            collision.addCircle(px, pz, 0.5, 0.9);
          }
          t += main || secondary ? r.range(8, 18) : r.range(12, 26);
        }

        // Paper bunting strung across the smaller streets, for no particular occasion.
        if (wired && s.road && s.road.cls !== "main" && len > 40) {
          for (let bt = margin + r.range(6, 30); bt < len - margin; bt += r.range(60, 110)) {
            const [kx, kz] = at(bt, 0);
            const across = 8;
            props.place("bunting", kx + s.nx * across, 0, kz + s.nz * across, Math.atan2(-s.nz, s.nx));
          }
        }

        // Parked vehicles line the side roads and can all be taken.
        if (s.road && s.road.cls !== "main") {
          const park = s.road.cls === "street" ? 0.12 : 0.1;
          for (let pt = margin + 10; pt < len - margin - 6; pt += 7.5) {
            if (!r.chance(park * 2.2)) continue;
            const [px, pz] = at(pt, 0);
            const kinds = s.road.cls === "street" ? ["rickshaw", "rickshaw", "bicycle", "motorbike", "easybike"] : ["car_sedan", "cng", "motorbike", "microbus", "rickshaw"];
            // Side lines run clockwise around the block, so traffic beside this kerb runs against them.
            this.parked.push({ x: px, z: pz, angle: Math.atan2(-ux, -uz), nx: s.nx, nz: s.nz, kinds });
          }
        }

        // Bus stops and billboards on the arterials.
        if (main && len > 60) {
          const [bx, bz] = at(len * 0.4, kerbIn + 1);
          props.place("bus_stop", bx, KERB_H, bz, s.angle);
          collision.addCircle(bx, bz, 1.2, 2.4);
          this.busStops.push({ x: bx, z: bz, angle: s.angle });
          const signAt = props.anchor("bus_stop", "sign");
          if (signAt) {
            const ca = Math.cos(s.angle), sa = Math.sin(s.angle);
            this.anchoredSign(bx + signAt.x * ca + signAt.z * sa, KERB_H + signAt.y, bz - signAt.x * sa + signAt.z * ca, s.angle, this.signs.labelOf("বাস স্টপ"), 1.7);
          }
        }
        if ((main || secondary) && len > 70 && r.chance(0.55)) {
          const [bx, bz] = at(len * r.range(0.25, 0.75), 1.1);
          this.billboard(bx, bz, s.angle);
        }
      }
    }
    for (const poles of poleAnchors) this.hangWires(poles);
    this.buildJunctionFurniture();
    for (const c of this.chunks) {
      this.dressBuildingSites(c.specs);
      this.dressYard(c.block);
      this.dressCorners(c.block);
    }
  }

  /** Unfinished concrete frames get bamboo scaffolding, a tin fence and heaps of bricks. */
  private dressBuildingSites(specs: BuildingSpec[]): void {
    const { props, collision } = this;
    const r = this.rng;
    for (const s of specs) {
      if (s.style !== "frame") continue;
      const ca = Math.cos(s.angle), sa = Math.sin(s.angle);
      const local = (u: number, v: number): [number, number] => [s.x + u * ca + v * sa, s.z - u * sa + v * ca];
      // Across the front face, one panel every six metres.
      const n = Math.max(1, Math.floor(s.w / 6));
      for (let i = 0; i < n; i++) {
        const u = -s.w / 2 + (i + 0.5) * (s.w / n);
        const [x, z] = local(u, -0.08);
        props.place("scaffold_bamboo", x, KERB_H, z, s.angle + Math.PI);
        if (r.chance(0.7)) {
          const [fx, fz] = local(u, -2.3);
          props.place("tin_hoarding", fx, KERB_H, fz, s.angle);
          collision.addBox(Math.min(fx - ca * 3, fx + ca * 3) - 0.1, Math.min(fz + sa * 3, fz - sa * 3) - 0.1, Math.max(fx - ca * 3, fx + ca * 3) + 0.1, Math.max(fz + sa * 3, fz - sa * 3) + 0.1);
        } else {
          const [bx, bz] = local(u, -1.7);
          props.place("brick_pile", bx, KERB_H, bz, s.angle + r.range(-0.3, 0.3));
          collision.addCircle(bx, bz, 0.9, 1);
        }
      }
    }
  }

  /** The ground behind the frontage: sheds, heaps, parked vans, the odd banana tree. */
  private dressYard(b: Block): void {
    if (b.kind === "park" || b.kind === "terminal" || b.kind === "mosque" || b.kind === "market") return;
    const { props, collision } = this;
    const r = this.rng;
    const sw = b.sidewalk;
    const x0 = b.x0 + sw + 2, x1 = b.x1 - sw - 2, z0 = b.z0 + sw + 2, z1 = b.z1 - sw - 2;
    const test = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
    const [cSw, cSe, cNe, cNw] = b.corners;
    const clearOfCorner = (x: number, z: number, cx: number, cz: number, rad: number): boolean => rad <= 12 || Math.hypot(x - cx, z - cz) > rad * 1.25;
    const step = 7.5;
    for (let gx = x0; gx < x1; gx += step) {
      for (let gz = z0; gz < z1; gz += step) {
        const x = gx + r.range(-1.5, 1.5), z = gz + r.range(-1.5, 1.5);
        if (x < x0 || x > x1 || z < z0 || z > z1) continue;
        if (!clearOfCorner(x, z, b.x0, b.z0, cSw) || !clearOfCorner(x, z, b.x1, b.z0, cSe) || !clearOfCorner(x, z, b.x1, b.z1, cNe) || !clearOfCorner(x, z, b.x0, b.z1, cNw)) continue;
        collision.resolveCircle(x, z, 2.2, test);
        if (test.hit) continue;
        const roll = r.next();
        const a = r.range(0, 6.28);
        if (roll < 0.14) {
          props.place("tin_shed", x, KERB_H, z, Math.round(a / (Math.PI / 2)) * (Math.PI / 2));
          collision.addCircle(x, z, 1.9, 2.4);
        } else if (roll < 0.26) {
          props.place("sack_pile", x, KERB_H, z, a);
          collision.addCircle(x, z, 0.75, 1);
        } else if (roll < 0.36) {
          props.place("brick_pile", x, KERB_H, z, a);
          collision.addCircle(x, z, 0.9, 1);
        } else if (roll < 0.48) {
          props.place("crates", x, KERB_H, z, a);
          collision.addCircle(x, z, 0.6, 1);
        } else if (roll < 0.56) {
          props.place("van_cart", x, KERB_H, z, a);
          collision.addCircle(x, z, 0.95, 1.3);
        } else if (roll < 0.68) {
          this.tree(x, z, r.chance(0.7) ? "tree_banana" : "tree_mehgoni");
        } else if (roll < 0.74) {
          props.place("plastic_chair", x, KERB_H, z, a);
        } else if (roll < 0.8) {
          props.place("dustbin", x, KERB_H, z, a);
          collision.addCircle(x, z, 0.35, 1.1);
        }
      }
    }
  }

  /** The big paved corners round the golchattar: sellers along the kerb and a little shade. */
  private dressCorners(b: Block): void {
    const { props, collision } = this;
    const r = this.rng;
    const corners: [number, number, number, number, number][] = [
      [b.corners[0], b.x0 + b.corners[0], b.z0 + b.corners[0], Math.PI, Math.PI * 1.5],
      [b.corners[1], b.x1 - b.corners[1], b.z0 + b.corners[1], Math.PI * 1.5, Math.PI * 2],
      [b.corners[2], b.x1 - b.corners[2], b.z1 - b.corners[2], 0, Math.PI * 0.5],
      [b.corners[3], b.x0 + b.corners[3], b.z1 - b.corners[3], Math.PI * 0.5, Math.PI],
    ];
    const test = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
    for (const [rad, cx, cz, a0, a1] of corners) {
      if (rad <= 12) continue;
      const ring = rad - 2.4;
      const steps = Math.floor(((a1 - a0) * ring) / 6.5);
      for (let i = 1; i < steps; i++) {
        const a = a0 + ((a1 - a0) * i) / steps;
        const x = cx + Math.cos(a) * ring, z = cz + Math.sin(a) * ring;
        collision.resolveCircle(x, z, 1.5, test);
        if (test.hit) continue;
        // Facing inwards, across the paving.
        const facing = Math.atan2(cx - x, cz - z);
        const roll = r.next();
        if (roll < 0.26) {
          this.tree(x, z, r.pick(["tree_krishnachura", "tree_mehgoni", "tree_raintree"]));
        } else if (roll < 0.72) {
          const id = r.pick(["clothes_rack", "shoe_stall", "plant_nursery", "fruit_cart", "food_cart", "umbrella_stall", "flexi_kiosk"]);
          props.place(id, x, KERB_H, z, facing);
          collision.addCircle(x, z, 1.05, 1.6);
          this.stalls.push({ x, z, angle: facing, kind: "cart", prop: id });
        } else if (roll < 0.86) {
          props.place("bench", x, KERB_H, z, facing);
          collision.addCircle(x, z, 0.8, 0.8);
        } else {
          props.place("planter", x, KERB_H, z, 0);
          collision.addCircle(x, z, 0.5, 0.9);
        }
      }
    }
  }

  private billboard(x: number, z: number, angle: number): void {
    if (!this.props.has("billboard")) return;
    this.props.place("billboard", x, KERB_H, z, angle);
    this.collision.addCircle(x, z, 0.4, 12);
    const face = this.props.anchor("billboard", "face");
    if (!face) return;
    const g = new Geo();
    const ca = Math.cos(angle), sa = Math.sin(angle);
    // Rotate the anchor into place, then lay the ad over the empty face.
    const fx = x + face.x * ca + face.z * sa;
    const fz = z - face.x * sa + face.z * ca;
    const front = -0.03;
    g.setFrame(fx, fz, angle + Math.PI);
    const uv = this.billboardCount++ % 3 === 0 ? this.signs.billboardIndex(Math.floor(this.billboardCount / 3)) : this.signs.billboardAd(this.rng);
    g.wallFront(-4, 4, face.y + KERB_H - 2, face.y + KERB_H + 2, front, uv);
    g.build("billboardAd", this.scene, this.signs.material);
  }
  private billboardCount = 0;

  private hangWires(poles: { x: number; z: number; angle: number }[]): void {
    if (poles.length < 2) return;
    const r = this.rng;
    const color: RGB = [0.05, 0.05, 0.055];
    const uv = cell("tar", 0.4, 0.4, 0.45, 0.45);
    const anchors: (readonly [number, number, number])[] = [];
    for (let i = 1; i <= 4; i++) {
      const a = this.props.anchor("electric_pole", `wire_${i}`);
      anchors.push(a ? [a.x, a.y, a.z] : [(i - 3.5) * 0.35, 8.4 - i * 0.28, 0]);
    }
    const world = (p: { x: number; z: number; angle: number }, a: readonly [number, number, number]): [number, number, number] => {
      const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
      return [p.x + a[0] * ca + a[2] * sa, a[1] + KERB_H, p.z - a[0] * sa + a[2] * ca];
    };
    for (let k = 0; k + 1 < poles.length; k++) {
      const p = poles[k], q = poles[k + 1];
      const dist = Math.hypot(q.x - p.x, q.z - p.z);
      if (dist > 60) continue;
      for (const a of anchors) {
        const s = world(p, a), e = world(q, a);
        const sag = r.range(0.35, 1.0);
        const pts: number[][] = [];
        const n = 5;
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const dip = 4 * t * (1 - t) * sag;
          pts.push([s[0] + (e[0] - s[0]) * t + (i > 0 && i < n ? r.range(-0.02, 0.02) : 0), s[1] + (e[1] - s[1]) * t - dip, s[2] + (e[2] - s[2]) * t]);
        }
        this.wires.tube(pts, 0.016, 3, uv, color);
      }
      // Bundled cable drooping between poles, thicker and lower.
      const a0 = anchors[r.int(0, anchors.length - 1)];
      const s = world(p, a0), e = world(q, a0);
      const pts: number[][] = [];
      for (let i = 0; i <= 5; i++) {
        const t = i / 5;
        pts.push([s[0] + (e[0] - s[0]) * t, s[1] - 0.2 + (e[1] - s[1]) * t - 4 * t * (1 - t) * r.range(0.9, 1.2), s[2] + (e[2] - s[2]) * t]);
      }
      this.wires.tube(pts, 0.03, 3, uv, color);
    }
  }

  private buildJunctionFurniture(): void {
    const { layout, props } = this;
    for (const j of layout.junctions) {
      if (!j.signal) continue;
      for (let h = 0 as Heading; h < 4; h = (h + 1) as Heading) {
        // h is the heading of traffic arriving here; it arrives along the opposite arm.
        const arm = ((h + 2) % 4) as Heading;
        if (!j.arms[arm]) continue;
        const road = h % 2 === 0 ? j.v : j.h;
        const dir = DIR[h];
        const left: [number, number] = [-dir[1], dir[0]];
        const box = (h % 2 === 0 ? j.halfZ : j.halfX) + (j.isPlaza ? 0 : STOP_BACK);
        // Pole on the driver's left at the stop line, on the kerb.
        const off = roadWidth(road) / 2 + 0.6;
        const px = j.x - dir[0] * (box + 0.2) + left[0] * off;
        const pz = j.z - dir[1] * (box + 0.2) + left[1] * off;
        // The head faces against the traffic, so turn the asset's +Z towards the driver.
        const angle = Math.atan2(-dir[0], -dir[1]);
        props.place("traffic_light", px, KERB_H, pz, angle);
        this.collision.addCircle(px, pz, 0.18, 3.5);
        this.signalHeads.push({ junction: j, heading: h, x: px, z: pz, angle });
      }
      // Police box on one corner at the arterials.
      if (j.v.cls === "main" || j.h.cls === "main") {
        const off = j.isPlaza ? 0 : 1;
        if (!j.isPlaza) {
          const px = j.x + (j.halfX + 2.2) * off;
          const pz = j.z - (j.halfZ + 2.2) * off;
          if (props.has("police_box")) {
            props.place("police_box", px, KERB_H, pz, -Math.PI / 4);
            this.collision.addCircle(px, pz, 1.2, 2.5);
            const stand = props.anchor("police_box", "stand");
            this.police.push({ junction: j, x: px, y: KERB_H + (stand?.y ?? 0.4), z: pz });
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- landmarks

  private buildMetro(): void {
    const m = this.region.layout.metro;
    if (!m) return;
    const { props } = this;
    const stationStart = m.stationZ - 70, stationEnd = m.stationZ + 70;
    for (let z = m.fromZ; z <= m.toZ; z += m.spacing) {
      // The station carries the line itself between its two ends.
      const spanEnd = z + m.spacing;
      if (spanEnd <= stationStart || z >= stationEnd) props.place("metro_span", m.x, 0, z + m.spacing / 2, 0);
      if (z <= stationStart || z >= stationEnd) {
        props.place("metro_pier", m.x, 0, z, 0);
        this.collision.addCircle(m.x, z, 1.25, 30);
      }
    }
    props.place("metro_station", m.x, 0, m.stationZ, 0);
    for (const b of props.groundFootprint("metro_station", 0.3, 2)) {
      this.collision.addBox(m.x + b.x0, m.stationZ + b.z0, m.x + b.x1, m.stationZ + b.z1);
    }
    this.placeStationSigns(m.x, m.stationZ);
  }

  private placeStationSigns(x: number, z: number): void {
    const uv = this.signs.labelOf("মিরপুর ১০ মেট্রো স্টেশন");
    for (const name of ["sign_1", "sign_2"]) {
      const a = this.props.anchor("metro_station", name);
      if (!a) continue;
      const north = a.z > 0;
      this.anchoredSign(x + a.x, a.y, z + a.z, north ? 0 : Math.PI, uv, 10);
    }
  }

  /** A Bangla board laid on a prop's blank panel. `facing` is the direction it looks, as an angle. */
  private anchoredSign(x: number, y: number, z: number, facing: number, uv: readonly [number, number, number, number], width: number): void {
    const g = new Geo();
    g.setFrame(x, z, facing + Math.PI);
    const h = width * ((uv[3] - uv[1]) / (uv[2] - uv[0]));
    g.wallFront(-width / 2, width / 2, y - h / 2, y + h / 2, -0.04, uv);
    g.build("anchoredSign", this.scene, this.signs.material);
  }

  private buildPlaza(): void {
    const { plaza } = this.region.layout;
    if (this.props.has("golchattar")) {
      this.props.place("golchattar", plaza.x, 0, plaza.z, 0);
      this.collision.addCircle(plaza.x, plaza.z, plaza.islandRadius, 1.1);
    }
    // Footbridge over the main road just south of the plaza, and landmark billboards.
    if (this.props.has("footbridge")) {
      const fz = plaza.z - 62;
      this.props.place("footbridge", plaza.x, 0, fz, 0);
      // The stairs land on both footpaths; the deck itself is well above traffic.
      this.collision.addBox(plaza.x + 12.8, fz - 14, plaza.x + 15.7, fz + 14, 8);
      this.collision.addBox(plaza.x - 15.7, fz - 14, plaza.x - 12.8, fz + 14, 8);
      const a = this.props.anchor("footbridge", "sign_1");
      if (a) this.anchoredSign(plaza.x + a.x, a.y, fz + a.z, 0, this.signs.labelOf("নিরাপদে রাস্তা পার হোন"), 5.4);
    }
    this.billboard(30, -30, Math.PI / 4);
    this.billboard(-30, 30, -(3 * Math.PI) / 4);
    this.sign3d(-14.5, 27, 3.4, 4.2, this.signs.road(0), Math.PI);
    this.sign3d(15, -32, 3.4, 4.2, this.signs.road(1), 0);
    if (this.props.has("police_box")) {
      const px = plaza.x + 3.4, pz = plaza.z - 2.6;
      const stand = this.props.anchor("police_box", "stand");
      this.props.place("police_box", px, 0.45, pz, -Math.PI / 2);
      void stand;
      const j = this.layout.junctions.find((q) => q.isPlaza);
      if (j) this.police.push({ junction: j, x: px, y: 0.45 + (stand?.y ?? 0.4), z: pz });
    }
  }

  // ---------------------------------------------------------------- streaming detail

  /** Swaps nearby blocks to full detail, spending a few milliseconds per call. */
  updateStreaming(x: number, z: number): void {
    for (const c of this.chunks) {
      const d = Math.hypot(c.cx - x, c.cz - z) - c.radius;
      const wantDetail = d < this.detailRadius;
      if (wantDetail && !c.detail && c !== this.buildingChunk && !this.detailQueue.includes(c)) this.detailQueue.push(c);
      else if (!wantDetail && c.detail && d > this.detailRadius + 50) this.dropDetail(c);
    }
    if (this.detailQueue.length === 0 && !this.building) return;
    // Nearest first, so the street the player can see fills in before anything else.
    this.detailQueue.sort((a, b) => Math.hypot(a.cx - x, a.cz - z) - a.radius - (Math.hypot(b.cx - x, b.cz - z) - b.radius));
    this.pumpDetail();
  }

  /** Spends a slice of this frame on the block being built, always moving it on at least one step. */
  private pumpDetail(): void {
    const start = performance.now();
    do {
      if (!this.building) {
        const next = this.detailQueue.shift();
        if (!next) return;
        this.buildingChunk = next;
        this.building = this.detailSteps(next);
      }
      if (this.building.next().done) {
        this.building = null;
        this.buildingChunk = null;
      }
    } while (performance.now() - start < DETAIL_BUDGET_MS);
  }

  /** Which far-mesh proxy stands in for a detail mesh in the outer shadow cascades. */
  isDetailMesh(m: Mesh): boolean {
    return this.detailSet.has(m);
  }

  /** Blocks everything until the surroundings of a spawn point have full detail. */
  forceDetailAround(x: number, z: number): void {
    // Finish whatever was part-built first, so nothing is left half done.
    while (this.building && !this.building.next().done) {
      /* keep going */
    }
    this.building = null;
    this.buildingChunk = null;
    for (const c of this.chunks) {
      if (Math.hypot(c.cx - x, c.cz - z) - c.radius < this.detailRadius && !c.detail && c !== this.buildingChunk) {
        const q = this.detailQueue.indexOf(c);
        if (q >= 0) this.detailQueue.splice(q, 1);
        this.buildChunkDetail(c);
      }
    }
  }

  private buildChunkDetail(c: BlockChunk): void {
    for (const _ of this.detailSteps(c)) {
      /* run it all at once */
    }
  }

  /** Builds one block's full detail a building at a time, so moving through the city never stalls.
   *  Every few buildings becomes its own set of meshes, which the camera can also cull separately.
   *  Nothing shows until the whole block is ready, then the far mesh swaps out in one frame. */
  private *detailSteps(c: BlockChunk): Generator<void, void, void> {
    const meshes: Mesh[] = [];
    const g: BuildingGeo = { opaque: new Geo(), cutout: new Geo(), sign: new Geo(), shop: new Geo() };
    let part = 0;
    const add = (m: Mesh | null, castsShadow: boolean): void => {
      if (!m) return;
      m.receiveShadows = true;
      m.setEnabled(false);
      meshes.push(m);
      this.detailSet.add(m);
      if (castsShadow) this.addShadow(m);
      else this.shopMeshes.add(m);
    };
    // Only the walls are split up; everything else stays one mesh per block, because each extra
    // mesh costs more per frame than culling it saves.
    const flushWalls = (): void => {
      add(g.opaque.build(`block${c.block.id}_${part++}_detail`, this.scene, this.facade.opaque), true);
      g.opaque = new Geo();
    };
    for (const s of c.specs) {
      buildDetailed(s, g, this.signs);
      yield;
      if (g.opaque.vertexCount > 110000) {
        flushWalls();
        yield;
      }
    }
    flushWalls();
    yield;
    add(g.cutout.build(`block${c.block.id}_cutout`, this.scene, this.facade.cutout), true);
    add(g.sign.build(`block${c.block.id}_signs`, this.scene, this.signs.material), true);
    yield;
    // The back walls of shops never throw a shadow anyone could see.
    add(g.shop.build(`block${c.block.id}_shops`, this.scene, this.facade.shop), false);
    for (const m of meshes) m.setEnabled(true);
    c.detail = meshes;
    c.simpleSigns?.setEnabled(false);
    // The far mesh stays alive as a shadow-only proxy for the outer cascades.
    if (c.simple) c.simple.layerMask = SHADOW_ONLY_LAYER;
  }

  private dropDetail(c: BlockChunk): void {
    if (!c.detail) return;
    for (const m of c.detail) {
      if (!this.shopMeshes.delete(m)) this.removeShadow(m);
      this.detailSet.delete(m);
      m.dispose(false, false);
    }
    c.detail = null;
    c.simpleSigns?.setEnabled(true);
    if (c.simple) c.simple.layerMask = 0x0fffffff;
  }

  setDetailRadius(r: number): void {
    this.detailRadius = r;
  }

  /** Lights up signs, shops and windows at night. */
  setNightGlow(k: number): void {
    if (k === this.lastGlow) return;
    this.lastGlow = k;
    const set = (m: PBRMaterial, v: number): void => {
      m.emissiveIntensity = v;
    };
    set(this.facade.opaque, k * 1.1);
    set(this.facade.cutout, k * 0.2);
    set(this.facade.shop, k * 0.62);
    set(this.signs.material, k * 0.85);
  }
}

function pickStyle(r: Rng, commercial: boolean, kind: Block["kind"]): BuildingStyle {
  const roll = r.next();
  if (kind === "construction") return roll < 0.5 ? "frame" : "old";
  if (commercial) {
    if (roll < 0.14) return "glass";
    if (roll < 0.72) return "commercial";
    if (roll < 0.9) return "resi";
    return "old";
  }
  if (roll < 0.08) return "tin";
  if (roll < 0.14) return "frame";
  if (roll < 0.36) return "old";
  if (roll < 0.5) return "commercial";
  return "resi";
}

function walkLoop(b: Block): number[] {
  const m = Math.min(b.sidewalk * 0.56, 2.6);
  const c = (i: number): number => Math.max(b.corners[i] * 0.5, 2.5);
  const x0 = b.x0 + m, x1 = b.x1 - m, z0 = b.z0 + m, z1 = b.z1 - m;
  return [
    x0 + c(0), z0, x1 - c(1), z0,
    x1, z0 + c(1), x1, z1 - c(2),
    x1 - c(2), z1, x0 + c(3), z1,
    x0, z1 - c(3), x0, z0 + c(0),
  ];
}
