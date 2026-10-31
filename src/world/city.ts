import { Color3, DynamicTexture, Mesh, PBRMaterial, Scene } from "@babylonjs/core";
import type { RegionManifest, RegionStyle } from "../regions/types";
import { DIR, Heading, LaneGraph, STOP_BACK } from "../traffic/laneGraph";
import { ShopKind, cell, patch, createFacadeMaterials, FacadeMaterials } from "./atlas";
import { bn } from "../localization/bn";
import type { Field } from "./playground";
import { Decks } from "./decks";
import { asphaltMaterial, buildFlyover } from "./flyover";
import { BuildingGeo, BuildingSpec, BuildingStyle, buildDetailed, buildSimple } from "./buildings";
import { Block, CityLayout, Junction, KERB_H, Rng, roadWidth } from "./cityLayout";
import { Circle, CollisionWorld } from "./collision";
import { Geo, RGB, Rect } from "./geo";
import { InteriorKind, Interiors } from "./interiors";
import { LooseProps } from "./looseProps";
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
  /** Which placed copy of the prop this is, and what stops people walking through it. */
  instance: number;
  colliders: Circle[];
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
  /** Which way the officer faces: towards the junction. */
  yaw: number;
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
/** Past this a shop's sign is a coloured smudge in the haze, and not worth a draw call. */
const FAR_SIGNS = 260;
const FAR_BLOCKS = 700;
/** Everything that sets up on a footpath for the day. */
interface GapPlan {
  /** Rectangles to fill at most, in one block. */
  most: number;
  /** Only this far in from the edge of the block: the middle stays open. */
  band?: number;
  /** Open ground kept round the middle of the block, such as a mosque's. */
  clear?: number;
  /** Half the width of a way kept clear from the south side to the middle. */
  lane?: number;
  /** Shares of old houses, tin shops, vehicle lots, building sites; the rest is trees and benches. */
  mix: { houses: number; tin: number; lot: number; site: number };
}

type GapUse = "houses" | "tin" | "lot" | "site" | "green";
/** How many 3 m cells deep each use is. */
const GAP_DEPTH: Record<GapUse, number> = { houses: 5, tin: 3, lot: 4, site: 5, green: 4 };

const CITY_MIX = { houses: 0.42, tin: 0.26, lot: 0.14, site: 0.1 };
const LEAFY_MIX = { houses: 0.16, tin: 0.1, lot: 0.24, site: 0.02 };
const GAP_PLANS: Partial<Record<string, GapPlan>> = {
  dense: { most: 200, mix: CITY_MIX },
  commercial: { most: 200, mix: CITY_MIX },
  coaching: { most: 200, mix: CITY_MIX },
  construction: { most: 60, mix: { houses: 0.2, tin: 0.2, lot: 0.1, site: 0.45 } },
  market: { most: 80, mix: { houses: 0.2, tin: 0.55, lot: 0.15, site: 0 } },
  mall: { most: 60, lane: 10, mix: { houses: 0.3, tin: 0.3, lot: 0.3, site: 0 } },
  terminal: { most: 90, band: 34, mix: { houses: 0.3, tin: 0.5, lot: 0.12, site: 0 } },
  mosque: { most: 120, clear: 36, lane: 8, mix: { houses: 0.55, tin: 0.25, lot: 0.06, site: 0.04 } },
  garments: { most: 80, lane: 9, mix: { houses: 0.35, tin: 0.25, lot: 0.25, site: 0.05 } },
  fuel: { most: 40, band: 16, mix: { houses: 0.2, tin: 0.5, lot: 0.2, site: 0 } },
  thana: { most: 20, band: 10, mix: { houses: 0.1, tin: 0.25, lot: 0, site: 0 } },
  towers: { most: 60, mix: LEAFY_MIX },
  embassy: { most: 40, mix: LEAFY_MIX },
  villas: { most: 40, mix: { houses: 0.5, tin: 0.04, lot: 0.14, site: 0.04 } },
  school: { most: 30, band: 16, lane: 7, mix: { houses: 0.15, tin: 0.3, lot: 0.1, site: 0 } },
  university: { most: 40, band: 20, lane: 7, mix: { houses: 0.15, tin: 0.3, lot: 0.2, site: 0 } },
  stadium: { most: 40, band: 30, mix: { houses: 0, tin: 0.45, lot: 0.35, site: 0 } },
  zoo: { most: 14, band: 8, mix: { houses: 0, tin: 0.45, lot: 0.2, site: 0 } },
  park: { most: 24, band: 9, mix: { houses: 0, tin: 0.12, lot: 0, site: 0 } },
  garden: { most: 12, band: 9, mix: { houses: 0, tin: 0.1, lot: 0, site: 0 } },
};

const FOOTPATH_TRADES = ["fruit_cart", "food_cart", "umbrella_stall", "newspaper_stand", "flexi_kiosk", "clothes_rack", "shoe_stall", "plant_nursery", "paan_stall", "paan_stall", "fuchka_cart", "fuchka_cart", "jhalmuri_stand", "pitha_stall", "coconut_cart", "cane_press", "cobbler_kit", "barber_chair", "clothes_heap"];

/** The whole district: static geometry, collision and the anchor points other systems use. */
export class City {
  /** Playing fields, and places of learning, for the people who use them. */
  readonly parks: Field[] = [];
  readonly campuses: { kind: "school" | "university"; gateX: number; gateZ: number; doorX: number; doorZ: number; yardX0: number; yardX1: number; yardZ0: number; yardZ1: number }[] = [];
  /** For the map. */
  readonly lakes: [number, number][][] = [];
  readonly bridges: { x: number; z: number; half: number }[] = [];
  /** Everything raised above the street that can be stood on or driven over. */
  readonly decks = new Decks();
  readonly layout: CityLayout;
  readonly graph: LaneGraph;
  readonly collision = new CollisionWorld();
  readonly loose: LooseProps;
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
    this.loose = new LooseProps(this.props, this.collision, (x, z) => this.layout.groundHeight(x, z));
    this.facade = createFacadeMaterials(scene, anisotropy);
    this.interiors = new Interiors(scene, this.facade, this.collision, this.decks);
    this.signs = new SignAtlas(scene, signSize, region);
  }

  async load(onProgress: (done: number, total: number) => void): Promise<void> {
    await this.props.preload(onProgress);
  }

  generate(addShadow: (m: Mesh) => void, removeShadow: (m: Mesh) => void, macroSize: number, anisotropy: number, detailRadius: number): void {
    this.addShadow = addShadow;
    this.removeShadow = removeShadow;
    this.detailRadius = detailRadius;
    this.anisotropy = anisotropy;
    this.roads = buildRoads(this.scene, this.layout, this.graph, this.facade.opaque, this.collision, macroSize, anisotropy);
    for (const b of this.layout.blocks) {
      const specs = this.fillBlock(b);
      this.fillGaps(b, specs);
      this.hangDoors(b, specs);
      this.walkLoops.push({ block: b, pts: b.kind === "river" ? bankLoop(b) : walkLoop(b) });
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
    this.buildFlyoverRoad(addShadow, anisotropy);
    this.buildBoundary();
    this.clearWalkLoops();
    const fences = this.fenceBatch.build("fences", this.scene, this.facade.cutout);
    if (fences) fences.receiveShadows = true;
    this.signBatch.build("signBatch", this.scene, this.signs.material);
    this.postBatch.build("signPosts", this.scene, this.facade.opaque);
    this.doorGeo.build("doors", this.scene, this.facade.opaque);
    this.doorSigns.build("doorSigns", this.scene, this.signs.material);
    this.interiors.finish();
    this.bannerSigns.build("banners", this.scene, this.signs.material);
    // Eid banners over every main road, put up once a year.
    const eid = new Geo();
    for (const j of this.layout.junctions) {
      if (j.v.cls !== "main" || (j.id % 2 !== 0)) continue;
      const w = 8.5, y = 6.2;
      eid.wallFront(j.x - w / 2, j.x + w / 2, y, y + w * 0.2, j.z - j.halfZ - 8, this.signs.labelOf(bn.rhythm.eidBanner));
      eid.wallBack(j.x - w / 2, j.x + w / 2, y, y + w * 0.2, j.z - j.halfZ - 7.98, this.signs.labelOf(bn.rhythm.eidBanner));
    }
    this.eidGeo = eid.build("eidBanners", this.scene, this.signs.material);
    this.eidGeo?.setEnabled(false);
    this.bannerRopes.build("bannerRopes", this.scene, this.facade.opaque);
    const wireMesh = this.wires.build("wires", this.scene, this.facade.opaque);
    if (wireMesh) wireMesh.receiveShadows = false;
    this.props.finalize(addShadow);
  }

  /** Bends each block's walking route round anything big standing on the footpath, like stairs, kiosks
   *  or a bus shelter, so that nobody queues up against it. Something the size of a pole doesn't count:
   *  people just step round those. */
  private clearWalkLoops(): void {
    const test = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
    const free = (x: number, z: number): boolean => {
      this.collision.resolveCircle(x, z, 0.55, test);
      return !test.hit;
    };
    const STEP = 1.5;
    const SHIFTS = [0.8, -0.8, 1.6, -1.6, 2.4, -2.4, 3.2, -3.2, 4, -4, 5, -5, 6, -6, 7.5, -7.5, 9, -9];
    for (const loop of this.walkLoops) {
      const { pts, block: b } = loop;
      const n = pts.length / 2;
      const out: number[] = [];
      for (let k = 0; k < n; k++) {
        const ax = pts[k * 2], az = pts[k * 2 + 1];
        const bx = pts[((k + 1) % n) * 2], bz = pts[((k + 1) % n) * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.01) continue;
        const ux = (bx - ax) / len, uz = (bz - az) / len;
        const steps = Math.max(1, Math.floor(len / STEP));
        const shift = new Array<number>(steps + 1).fill(0);
        for (let i = 0; i <= steps; i++) {
          const t = (i / steps) * len;
          const x = ax + ux * t, z = az + uz * t;
          if (free(x, z)) continue;
          for (const d of SHIFTS) {
            const sx = x - uz * d, sz = z + ux * d;
            if (sx < b.x0 + 0.5 || sx > b.x1 - 0.5 || sz < b.z0 + 0.5 || sz > b.z1 - 0.5) continue;
            if (free(sx, sz)) {
              shift[i] = d;
              break;
            }
          }
        }
        // One blocked sample on its own is a pole or a tree: step round it as usual.
        for (let i = 1; i < steps; i++) if (shift[i] !== 0 && shift[i - 1] === 0 && shift[i + 1] === 0) shift[i] = 0;
        out.push(ax, az);
        for (let i = 1; i < steps; i++) {
          // A bend in the route: mark where the shift starts and stops, and the points in between.
          if (shift[i] !== 0 || shift[i - 1] !== 0 || shift[i + 1] !== 0) {
            const t = (i / steps) * len;
            out.push(ax + ux * t - uz * shift[i], az + uz * t + ux * shift[i]);
          }
        }
      }
      loop.pts = out;
    }
  }

  /** Where the station's stairs and legs fill the footpath, so buildings stand back and leave a way past. */
  private inStationYard(x: number, z: number, angle: number, w: number, d: number): boolean {
    const m = this.region.layout.metro;
    if (!m) return false;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    for (const u of [-w / 2, w / 2]) {
      for (const v of [0, d]) {
        const px = x + u * ca + v * sa, pz = z - u * sa + v * ca;
        if (Math.abs(px - m.x) < 24 && Math.abs(pz - m.stationZ) < 56) return true;
      }
    }
    return Math.abs(x - m.x) < 24 && Math.abs(z - m.stationZ) < 56;
  }

  // ---------------------------------------------------------------- blocks

  // ---------------------------------------------------------------- nothing in Dhaka stays empty

  /** Whatever a block's own plan left open gets used, the way it would be in a real city: old houses,
   *  rows of tin shops, somewhere to leave vehicles, a half-built something. Each kind of place keeps
   *  the room it needs, such as a way in to the door or the buses' yard. */
  private fillGaps(b: Block, specs: BuildingSpec[]): void {
    const plan = GAP_PLANS[b.kind];
    if (!plan) return;
    const r = this.rng;
    const STEP = 3;
    const band = plan.band ?? 0;
    const sw = b.sidewalk + 1.6;
    const x0 = b.x0 + sw, x1 = b.x1 - sw, z0 = b.z0 + sw, z1 = b.z1 - sw;
    const nx = Math.floor((x1 - x0) / STEP), nz = Math.floor((z1 - z0) / STEP);
    if (nx < 2 || nz < 2) return;
    const test = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
    const cx = (x0 + x1) / 2;
    const [cSw, cSe, cNe, cNw] = b.corners;
    const spawn = this.region.spawnPoints.default;
    const nearCorner = (x: number, z: number, ax: number, az: number, rad: number): boolean => rad > 12 && Math.hypot(x - ax, z - az) < rad * 1.3;
    const open = (x: number, z: number): boolean => {
      if (band && x > x0 + band && x < x1 - band && z > z0 + band && z < z1 - band) return false;
      if (plan.clear && Math.hypot(x - cx, z - (z0 + z1) / 2) < plan.clear) return false;
      // The way in from the road to the middle of the block.
      if (plan.lane && Math.abs(x - cx) < plan.lane && z < (z0 + z1) / 2 + 8) return false;
      if (nearCorner(x, z, b.x0, b.z0, cSw) || nearCorner(x, z, b.x1, b.z0, cSe) || nearCorner(x, z, b.x1, b.z1, cNe) || nearCorner(x, z, b.x0, b.z1, cNw)) return false;
      if (Math.hypot(x - spawn[0], z - spawn[2]) < 13) return false;
      if (this.inStationYard(x, z, 0, 1, 1)) return false;
      this.collision.resolveCircle(x, z, 1.7, test);
      if (test.hit) return false;
      for (const q of this.parked) if (Math.abs(q.x - x) < 6.5 && Math.abs(q.z - z) < 6.5) return false;
      for (const d of this.interiors.all) if (Math.abs(d.outX - x) < 8 && Math.abs(d.outZ - z) < 8) return false;
      return true;
    };
    const free: boolean[][] = [];
    for (let i = 0; i < nx; i++) {
      free[i] = [];
      for (let k = 0; k < nz; k++) free[i][k] = open(x0 + (i + 0.5) * STEP, z0 + (k + 0.5) * STEP);
    }
    // The biggest open rectangle each time, until only scraps are left.
    let stalls = 0;
    for (let round = 0; round < plan.most; round++) {
      let best = { i: 0, k: 0, w: 0, d: 0, area: 0 };
      for (let i = 0; i < nx; i++) {
        for (let k = 0; k < nz; k++) {
          if (!free[i][k]) continue;
          let limit = nz;
          for (let w = 1; i + w <= nx; w++) {
            if (!free[i + w - 1][k]) break;
            let d = 0;
            while (k + d < limit && free[i + w - 1][k + d]) d++;
            limit = k + d;
            if (w * d > best.area) best = { i, k, w, d, area: w * d };
          }
        }
      }
      if (best.area < 6 || Math.min(best.w, best.d) < 2) break;
      // A slice of the gap, as deep as what goes there needs, against whichever side faces the road.
      // One row of cells behind it stays empty, as the lane round the back.
      const m = plan.mix, roll = r.next();
      const what: GapUse = roll < m.houses ? "houses" : roll < m.houses + m.tin ? "tin" : roll < m.houses + m.tin + m.lot ? "lot" : roll < m.houses + m.tin + m.lot + m.site ? "site" : "green";
      const w = Math.min(best.w, r.int(5, 9));
      const d = Math.min(best.d, GAP_DEPTH[what]);
      const atSouth = best.k * STEP <= (nz - best.k - best.d) * STEP;
      const k0 = atSouth ? best.k : best.k + best.d - d;
      const rx0 = x0 + best.i * STEP, rz0 = z0 + k0 * STEP;
      stalls += this.fillOneGap(b, specs, what, rx0, rx0 + w * STEP, rz0, rz0 + d * STEP, stalls < 4);
      const from = atSouth ? k0 : Math.max(best.k, k0 - 2), to = atSouth ? Math.min(best.k + best.d, k0 + d + 2) : k0 + d;
      for (let i = best.i; i < best.i + w; i++) for (let k = from; k < to; k++) free[i][k] = false;
    }
  }

  /** One open rectangle. Returns how many stalls it took. */
  private fillOneGap(b: Block, specs: BuildingSpec[], what: GapUse, x0: number, x1: number, z0: number, z1: number, stallOk: boolean): number {
    const w = x1 - x0, d = z1 - z0;
    if (what === "houses" && Math.min(w, d) >= 9) {
      this.gapHouses(b, specs, x0, x1, z0, z1);
      return 0;
    }
    if (what === "tin" || what === "houses") {
      this.gapTinRow(b, specs, x0, x1, z0, z1);
      if (stallOk && w > 12) return this.gapStall((x0 + x1) / 2, this.frontOf(b, z0, z1) === 0 ? z0 - 1.6 : z1 + 1.6) ? 1 : 0;
      return 0;
    }
    if (what === "lot") {
      this.gapLot(x0, x1, z0, z1);
      return 0;
    }
    if (what === "site" && Math.min(w, d) >= 9) {
      this.gapSite(b, specs, x0, x1, z0, z1);
      return 0;
    }
    this.gapGreen(x0, x1, z0, z1, stallOk);
    return stallOk ? 1 : 0;
  }

  /** Which way a row in this block should face: 0 towards the south side, 1 towards the north. */
  private frontOf(b: Block, z0: number, z1: number): 0 | 1 {
    return z0 - b.z0 <= b.z1 - z1 ? 0 : 1;
  }

  /** Old houses of a few floors, stained and patched, side by side along the gap. */
  private gapHouses(b: Block, specs: BuildingSpec[], x0: number, x1: number, z0: number, z1: number): void {
    const r = this.rng;
    const south = this.frontOf(b, z0, z1) === 0;
    let p = x0 + 0.4;
    while (x1 - p > 7) {
      const w = Math.min(r.range(8, 14), x1 - p - 0.4);
      const depth = Math.min(z1 - z0 - 0.8, r.range(9, 15));
      const floors = r.int(2, 6);
      const style: BuildingStyle = r.chance(0.65) ? "old" : "resi";
      specs.push(this.specAt(p + w / 2, south ? z0 + 0.4 : z1 - 0.4, south ? 0 : Math.PI, w, depth, floors, style));
      p += w + r.range(1.2, 2.6);
    }
  }

  /** A line of one-room tin shops, the kind that goes up wherever there's a wall to lean on. */
  private gapTinRow(b: Block, specs: BuildingSpec[], x0: number, x1: number, z0: number, z1: number): void {
    const r = this.rng;
    const south = this.frontOf(b, z0, z1) === 0;
    let p = x0 + 0.3;
    while (x1 - p > 4) {
      const w = Math.min(r.range(5, 9), x1 - p - 0.2);
      const depth = Math.min(z1 - z0 - 0.6, r.range(5, 7.5));
      specs.push(this.specAt(p + w / 2, south ? z0 + 0.3 : z1 - 0.3, south ? 0 : Math.PI, w, depth, 1, "tin"));
      p += w + (r.chance(0.2) ? 1.6 : 0.2);
    }
  }

  private gapStall(x: number, z: number): boolean {
    const r = this.rng;
    const test = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
    this.collision.resolveCircle(x, z, 1.5, test);
    if (test.hit || !this.props.has("food_cart")) return false;
    const id = r.pick(FOOTPATH_TRADES) as Parameters<PropWorld["place"]>[0];
    if (!this.props.has(id)) return false;
    const instance = this.props.place(id, x, KERB_H, z, 0);
    const colliders = this.solid(id, x, z, 0);
    this.stalls.push({ x, z, angle: 0, kind: "cart", prop: id, instance, colliders });
    return true;
  }

  /** Somewhere everyone's left their vehicles: rickshaws in a heap, CNGs nose to tail, an old car or two. */
  private gapLot(x0: number, x1: number, z0: number, z1: number): void {
    const r = this.rng;
    const kinds = r.pick([["rickshaw", "rickshaw", "easybike", "bicycle"], ["cng", "cng", "easybike"], ["car_sedan", "car_sedan", "microbus"], ["motorbike", "motorbike", "bicycle"], ["truck", "goods_van", "microbus"]]);
    const big = kinds[0] === "truck";
    const stepX = big ? 8 : kinds[0] === "car_sedan" ? 3.4 : 2.2;
    const rows = big ? 1 : Math.max(1, Math.floor((z1 - z0) / 7));
    for (let row = 0; row < rows; row++) {
      const z = z0 + 3.2 + row * 7;
      for (let x = x0 + 2; x < x1 - 1.5; x += stepX) {
        if (r.chance(0.2)) continue;
        this.parked.push({ x, z, angle: r.chance(0.5) ? 0 : Math.PI, nx: 0, nz: 0, kinds });
      }
    }
    if (this.props.has("tin_hoarding") && r.chance(0.5)) {
      this.props.place("tin_hoarding", (x0 + x1) / 2, KERB_H, z1 - 0.4, 0);
      this.collision.addBox(x0, z1 - 0.7, x1, z1 - 0.1, 2.4);
    }
  }

  /** Something half built, with its bricks and bamboo lying about. */
  private gapSite(b: Block, specs: BuildingSpec[], x0: number, x1: number, z0: number, z1: number): void {
    const r = this.rng;
    const south = this.frontOf(b, z0, z1) === 0;
    const w = Math.min(x1 - x0 - 3, r.range(10, 16)), depth = Math.min(z1 - z0 - 3, r.range(9, 14));
    const fx = (x0 + x1) / 2;
    specs.push(this.specAt(fx, south ? z0 + 2.5 : z1 - 2.5, south ? 0 : Math.PI, w, depth, r.int(2, 5), "frame"));
    const pile = (id: string, x: number, z: number): void => {
      if (!this.props.has(id as never)) return;
      this.props.place(id as never, x, KERB_H, z, r.range(0, 6));
      this.collision.addCircle(x, z, 1.2, 1.4);
    };
    const front = south ? z0 + 1 : z1 - 1;
    pile("brick_pile", x0 + 1.6, front);
    pile("sack_pile", x1 - 1.6, front);
  }

  /** Trees and a bench or a cart, where there's no call for anything bigger. */
  private gapGreen(x0: number, x1: number, z0: number, z1: number, stallOk: boolean): void {
    const r = this.rng;
    let placedStall = !stallOk;
    for (let x = x0 + 3; x < x1 - 2; x += r.range(7, 11)) {
      for (let z = z0 + 3; z < z1 - 2; z += r.range(7, 11)) {
        const roll = r.next();
        if (roll < 0.6) this.tree(x, z, r.pick(["tree_mehgoni", "tree_raintree", "tree_krishnachura", "tree_coconut", "tree_banana"]));
        else if (roll < 0.75 && !placedStall) placedStall = this.gapStall(x, z);
        else if (roll < 0.9 && this.props.has("bench")) {
          this.props.place("bench", x, KERB_H, z, r.range(0, 6));
          this.solid("bench", x, z, 0, 0.8);
        }
      }
    }
  }

  private specAt(x: number, z: number, angle: number, w: number, d: number, floors: number, style: BuildingStyle, collide = true): BuildingSpec {
    const spec: BuildingSpec = { x, z, angle, w, d, floors, style, seed: this.rng.int(1, 1e9), base: KERB_H };
    if (style !== "frame") this.frontages.push(spec);
    if (collide) {
      // Footprint in world space, right up to the shop fronts: awnings stick out over the footpath,
      // and nobody walks in behind the counter.
      const inset = 0.1;
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
    if (b.kind === "villas") return this.fillVillas(b);
    if (b.kind === "lake") return this.fillLake(b);
    if (b.kind === "school" || b.kind === "university") return this.fillCampus(b);
    if (b.kind === "river") return this.fillRiver(b);
    if (b.kind === "mall") return this.fillMall(b);
    if (b.kind === "thana") return this.fillThana(b);
    if (b.kind === "fuel") return this.fillFuel(b);
    if (b.kind === "garments") return this.fillGarments(b);
    if (b.kind === "pond") return this.fillPond(b);
    if (b.kind === "garden") return this.fillGarden(b);
    if (b.kind === "stadium") return this.fillStadium(b);
    if (b.kind === "zoo") return this.fillZoo(b);
    if (b.kind === "embassy") return this.fillEmbassies(b);
    if (b.kind === "towers") return this.fillTowers(b);
    if (b.kind === "stage") return this.fillStage(b);
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
        const look = this.region.style;
        const style = pickStyle(r, commercial, b.kind, look);
        const floors = style === "tin" ? 1 : look ? r.int(...(commercial ? look.commercialFloors : look.floors)) : commercial ? r.int(5, 11) : style === "old" ? r.int(3, 5) : r.int(4, 7);
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
    const front = (x: number, z: number, angle: number, w: number, d: number, f: number, st: BuildingStyle): void => {
      if (this.inStationYard(x, z, angle, w, d)) return;
      const q = this.specAt(x, z, angle, w, d, f, st);
      // Coaching centres stacked up the front of everything, and elsewhere whoever else rents upstairs.
      if (b.kind === "coaching") q.boards = { kind: "coaching", share: 0.62 };
      else if (commercial && (this.region.style?.clutter ?? 1) > 0.4) q.boards = { kind: "office", share: 0.2 };
      specs.push(q);
    };
    row(backX0 + clip(sw_), backX1 - clip(se), (cx, w, d, f, st) => front(cx, z0, 0, w, d, f, st));
    row(backX0 + clip(nw), backX1 - clip(ne), (cx, w, d, f, st) => front(cx, z1, Math.PI, w, d, f, st));
    // East and west rows fill between them.
    const inner = 18;
    row(z0 + inner + clip(se) * 0.3, z1 - inner - clip(ne) * 0.3, (cz, w, d, f, st) => front(x1, cz, -Math.PI / 2, w, d, f, st));
    row(z0 + inner + clip(sw_) * 0.3, z1 - inner - clip(nw) * 0.3, (cz, w, d, f, st) => front(x0, cz, Math.PI / 2, w, d, f, st));

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

  private fenceBatch = new Geo();

  /** A mesh fence along the footpath, with a gap for a gate in the middle of each side. */
  private fence(b: Block, x0: number, x1: number, z0: number, z1: number, cx: number, cz: number): void {
    const fence = cell("mesh");
    const c = this.fenceBatch;
    const tint: RGB = [0.5, 0.55, 0.5];
    for (let x = x0; x < x1; x += 4) {
      if (Math.abs(x + 2 - cx) < 5) continue;
      c.wallFront(x, x + 4, KERB_H, KERB_H + 1.5, z0, fence, tint);
      c.wallBack(x, x + 4, KERB_H, KERB_H + 1.5, z1, fence, tint);
    }
    for (let z = z0; z < z1; z += 4) {
      if (Math.abs(z + 2 - cz) < 5) continue;
      c.wallSide(x0, z, z + 4, KERB_H, KERB_H + 1.5, false, fence, tint);
      c.wallSide(x1, z, z + 4, KERB_H, KERB_H + 1.5, true, fence, tint);
    }
    // Solid, apart from the gates: nobody walks through a fence, or drives in over the grass.
    const run = (ax: number, az: number, bx: number, bz: number): void => this.collision.addBox(Math.min(ax, bx) - 0.08, Math.min(az, bz) - 0.08, Math.max(ax, bx) + 0.08, Math.max(az, bz) + 0.08, 1.5);
    for (const fz of [z0, z1]) {
      run(x0, fz, cx - 5, fz);
      run(cx + 5, fz, x1, fz);
    }
    for (const fx of [x0, x1]) {
      run(fx, z0, fx, cz - 5);
      run(fx, cz + 5, fx, z1);
    }
  }

  private fillPark(b: Block): BuildingSpec[] {
    const r = this.rng;
    const g = this.yards;
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
    // A bare cricket strip at one end, a football field with goals at the other.
    const depth = z1 - z0;
    const pitchZ = cz + depth * 0.23, goalZ = cz - depth * 0.26;
    const L = Math.min((x1 - x0) / 2 - 8, 26), W = Math.min(depth * 0.17, 13);
    g.flat(cx - 1.6, cx + 1.6, pitchZ - 11, pitchZ + 11, KERB_H + 0.02, true, patch("roof", 4, 4, 0.2, 0.3), [dirt[0] * 1.6, dirt[1] * 1.6, dirt[2] * 1.6]);
    const chalk: RGB = [1.25, 1.25, 1.2];
    const line = cell("plasterClean", 0.1, 0.1, 0.3, 0.3);
    const y = KERB_H + 0.028;
    g.flat(cx - L, cx + L, goalZ - W - 0.06, goalZ - W + 0.06, y, true, line, chalk);
    g.flat(cx - L, cx + L, goalZ + W - 0.06, goalZ + W + 0.06, y, true, line, chalk);
    g.flat(cx - L - 0.06, cx - L + 0.06, goalZ - W, goalZ + W, y, true, line, chalk);
    g.flat(cx + L - 0.06, cx + L + 0.06, goalZ - W, goalZ + W, y, true, line, chalk);
    g.flat(cx - 0.06, cx + 0.06, goalZ - W, goalZ + W, y, true, line, chalk);
    // Goal frames and stumps, in thin white steel and wood.
    const post: RGB = [1.15, 1.15, 1.1];
    const steel = cell("plasterClean", 0.1, 0.1, 0.3, 0.3);
    for (const sx of [-1, 1]) {
      const gx = cx + sx * L;
      g.box(gx - 0.05, gx + 0.05, KERB_H, KERB_H + 2.1, goalZ - 3.6 - 0.05, goalZ - 3.6 + 0.05, steel, post);
      g.box(gx - 0.05, gx + 0.05, KERB_H, KERB_H + 2.1, goalZ + 3.6 - 0.05, goalZ + 3.6 + 0.05, steel, post);
      g.box(gx - 0.05, gx + 0.05, KERB_H + 2.05, KERB_H + 2.15, goalZ - 3.65, goalZ + 3.65, steel, post);
    }
    for (const sz of [-9.5, 9.5]) {
      for (const dx of [-0.11, 0, 0.11]) g.box(cx + dx - 0.015, cx + dx + 0.015, KERB_H, KERB_H + 0.72, pitchZ + sz - 0.015, pitchZ + sz + 0.015, cell("wood", 0, 0, 0.3, 1), [1.2, 1.05, 0.8]);
    }
    this.parks.push({ pitchX: cx, pitchZ, goalX: cx, goalZ, halfLength: L, halfWidth: W });
    this.fence(b, x0, x1, z0, z1, cx, cz);
    // Big shade trees around the edge, benches and a tea stall inside.
    for (let i = 0; i < 22; i++) {
      const edge = r.int(0, 3);
      const t = r.next();
      const inset = r.range(3, 7);
      const px = edge === 0 ? x0 + inset : edge === 1 ? x1 - inset : x0 + (x1 - x0) * t;
      const pz = edge === 2 ? z0 + inset : edge === 3 ? z1 - inset : z0 + (z1 - z0) * t;
      this.tree(px, pz, r.pick(["tree_raintree", "tree_krishnachura", "tree_mehgoni", "tree_coconut"]));
    }
    // Benches along the sides, looking on.
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const px = cx + sx * ((x1 - x0) / 2 - 3.2), pz = z0 + 14 + ((z1 - z0 - 28) * i) / 4;
        const turn = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
        this.props.place("bench", px, KERB_H, pz, turn);
        this.solid("bench", px, pz, turn, 0.8);
      }
    }
    this.stall(cx + 12, z0 + 5, 0);
    this.sign3d(cx, z0 - 0.4, 3.2, 3.2, this.signs.labelOf("খেলার মাঠ"), 0);
    return [];
  }

  private fillTerminal(b: Block): BuildingSpec[] {
    const r = this.rng;
    const sw = b.sidewalk;
    const x0 = b.x0 + sw, x1 = b.x1 - sw, z0 = b.z0 + sw, z1 = b.z1 - sw;
    const g = this.yards;
    const step = 12;
    for (let x = x0; x < x1 - 0.01; x += step) {
      for (let z = z0; z < z1 - 0.01; z += step) {
        const xe = Math.min(x + step, x1), ze = Math.min(z + step, z1);
        const tone = r.range(0.7, 1);
        g.flat(x, xe, z, ze, KERB_H + 0.012, true, patch("concrete", 4, 4, r.next(), r.next()), [tone, tone * 0.96, tone * 0.9]);
      }
    }
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
      this.solid("tin_shed", sx, sz, Math.PI, 2.4);
    }
    for (let i = 0; i < 6; i++) {
      const sx = x0 + 14 + i * 9, sz = z1 - 32 + r.range(-0.5, 0.5);
      const id = r.pick(["flexi_kiosk", "food_cart", "fruit_cart", "newspaper_stand", "clothes_rack", "umbrella_stall"]);
      const instance = this.props.place(id, sx, KERB_H, sz, Math.PI);
      const colliders = this.solid(id, sx, sz, Math.PI);
      this.stalls.push({ x: sx, z: sz, angle: Math.PI, kind: "cart", prop: id, instance, colliders });
    }
    for (let i = 0; i < 5; i++) {
      this.props.place("sack_pile", x1 - 12 - i * 2.2, KERB_H, cz + 12 + r.range(-0.6, 0.6), r.range(0, 6.28));
      this.collision.addCircle(x1 - 12 - i * 2.2, cz + 12, 0.75, 1);
    }
    return [];
  }

  /** Insides of everything with a door. */
  readonly interiors: Interiors;
  /** Where towed vehicles end up. */
  thanaYard: { x: number; y: number; z: number; angle: number } | null = null;

  /** A door on the street, its sign above it, and an inside for it. */
  private door(kind: InteriorKind, x: number, z: number, angle: number, label = bn.inside.names[kind]): void {
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const fx = x, fz = z;
    const g = this.doorGeo;
    g.setFrame(fx, fz, angle);
    g.wallFront(-1.7, 1.7, KERB_H, KERB_H + 2.7, -0.14, cell("acp"), [0.55, 0.7, 0.8]);
    g.box(-0.03, 0.03, KERB_H, KERB_H + 2.7, -0.17, -0.14, cell("metal", 0, 0, 0.3, 0.3), [0.2, 0.2, 0.22], false);
    g.box(-1.9, 1.9, KERB_H + 2.7, KERB_H + 3.5, -0.22, -0.14, cell("plasterClean"), [0.2, 0.26, 0.3], false);
    g.clearFrame();
    const sign = this.doorSigns;
    sign.setFrame(fx, fz, angle);
    sign.wallFront(-1.8, 1.8, KERB_H + 2.74, KERB_H + 3.46, -0.24, this.signs.labelOf(label));
    sign.clearFrame();
    void ca;
    void sa;
    this.interiors.add(kind, label, fx, fz, angle);
  }

  private doorGeo = new Geo();
  private doorSigns = new Geo();

  /** Picks a building on the street for each door this block is meant to have. */
  private hangDoors(b: Block, specs: BuildingSpec[]): void {
    const wanted = this.region.layout.doors?.filter((d) => d.key === b.key) ?? [];
    let n = 0;
    for (const d of wanted) {
      const candidates = specs.filter((q) => !q.back && q.w >= 9 && q.style !== "tin" && q.style !== "frame" && !q.door);
      const q = candidates[Math.floor(candidates.length * (0.3 + n * 0.2)) % Math.max(candidates.length, 1)];
      if (!q) continue;
      q.door = d.kind;
      n++;
      this.door(d.kind, q.x, q.z, q.angle);
    }
  }

  /** A big glass box with a forecourt, and everything else inside it. */
  private fillMall(b: Block): BuildingSpec[] {
    const r = this.rng;
    const sw = b.sidewalk;
    const x0 = b.x0 + sw, x1 = b.x1 - sw, z0 = b.z0 + sw, z1 = b.z1 - sw;
    const cx = (x0 + x1) / 2;
    const g = this.yards;
    for (let x = x0; x < x1 - 0.01; x += 12) {
      for (let z = z0; z < z1 - 0.01; z += 12) {
        const tone = r.range(0.76, 0.92);
        g.flat(x, Math.min(x + 12, x1), z, Math.min(z + 12, z1), KERB_H + 0.012, true, patch("concrete", 4, 4, r.next(), r.next()), [tone, tone, tone * 0.96]);
      }
    }
    const depth = Math.min(62, (z1 - z0) - 24), wide = Math.min(x1 - x0 - 12, 104);
    const front = z1 - depth - 6;
    const spec = this.specAt(cx, front, 0, wide, depth, r.int(7, 9), "glass");
    spec.plain = true;
    spec.door = "mall";
    this.door("mall", cx, front, 0);
    for (let i = 0; i < 8; i++) this.parked.push({ x: x0 + 12 + i * 6, z: z0 + 8, angle: Math.PI / 2, nx: 0, nz: 0, kinds: ["car_sedan", "car_sedan", "microbus", "motorbike"] });
    for (let i = 0; i < 6; i++) this.tree(x0 + 8 + i * 16, front - 5, "tree_mehgoni");
    return [spec];
  }

  /** The police station: a wall, a gate, a yard with their cars and whatever they've towed in. */
  private fillThana(b: Block): BuildingSpec[] {
    const r = this.rng;
    const sw = b.sidewalk;
    const x0 = b.x0 + sw, x1 = b.x1 - sw, z0 = b.z0 + sw, z1 = b.z1 - sw;
    const cx = (x0 + x1) / 2;
    const g = this.yards;
    for (let x = x0; x < x1 - 0.01; x += 12) {
      for (let z = z0; z < z1 - 0.01; z += 12) {
        const tone = r.range(0.74, 0.88);
        g.flat(x, Math.min(x + 12, x1), z, Math.min(z + 12, z1), KERB_H + 0.012, true, patch("concrete", 4, 4, r.next(), r.next()), [tone, tone, tone * 0.92]);
      }
    }
    this.wallRound(x0, x1, z0, z1, cx, 5.5, [0.72, 0.74, 0.62], 2.8);
    this.archway(cx, z0 + 0.4, 5.5, 5.4, "থানা", [0.32, 0.36, 0.5]);
    const depth = Math.min(22, (z1 - z0) * 0.34);
    const front = z1 - depth - 4;
    const q = this.specAt(cx, front, 0, Math.min(x1 - x0 - 16, 46), depth, 3, "resi");
    q.plain = true;
    q.door = "thana";
    this.door("thana", cx, front, 0);
    for (let i = 0; i < 3; i++) this.parked.push({ x: cx - 22 + i * 6.5, z: front - 9, angle: 0, nx: 0, nz: 0, kinds: ["police_car"] });
    this.thanaYard = { x: cx + 18, y: KERB_H, z: z0 + 12, angle: 0 };
    this.frontDoors.push({ x: cx, z: z0, r: 12 });
    return [q];
  }

  /** A filling station: a canopy over the pumps, and a queue back down the road for gas. */
  private fillFuel(b: Block): BuildingSpec[] {
    const r = this.rng;
    const sw = b.sidewalk;
    const x0 = b.x0 + sw, x1 = b.x1 - sw, z0 = b.z0 + sw, z1 = b.z1 - sw;
    const cx = (x0 + x1) / 2;
    const g = new Geo();
    const yd = this.yards;
    for (let x = x0; x < x1 - 0.01; x += 12) {
      for (let z = z0; z < z1 - 0.01; z += 12) {
        const tone = r.range(0.66, 0.8);
        yd.flat(x, Math.min(x + 12, x1), z, Math.min(z + 12, z1), KERB_H + 0.012, true, patch("concrete", 4, 4, r.next(), r.next()), [tone, tone, tone * 0.94]);
      }
    }
    const py = z0 + 18;
    const white = cell("plasterClean", 0.1, 0.1, 0.3, 0.3);
    g.box(cx - 16, cx + 16, KERB_H + 5.2, KERB_H + 5.9, py - 7, py + 7, white, [0.95, 0.95, 0.92], false);
    g.box(cx - 16, cx + 16, KERB_H + 5.1, KERB_H + 5.2, py - 7, py + 7, white, [0.18, 0.5, 0.3], false);
    for (const dx of [-10, 10]) {
      g.box(cx + dx - 0.3, cx + dx + 0.3, KERB_H, KERB_H + 5.2, py - 0.3, py + 0.3, white, [0.8, 0.8, 0.78], false);
      this.collision.addCircle(cx + dx, py, 0.45, 5);
    }
    for (const dx of [-11, -4, 4, 11]) {
      g.box(cx + dx - 0.5, cx + dx + 0.5, KERB_H, KERB_H + 1.7, py - 0.35, py + 0.35, white, [0.24, 0.55, 0.36], false);
      g.box(cx + dx - 0.36, cx + dx + 0.36, KERB_H + 1.05, KERB_H + 1.5, py - 0.37, py - 0.34, cell("winDark"), [0.6, 0.8, 0.7], false);
      this.collision.addCircle(cx + dx, py, 0.6, 1.8);
    }
    const mesh = g.build(`fuel${b.id}`, this.scene, this.facade.opaque);
    if (mesh) {
      mesh.receiveShadows = true;
      this.addShadow(mesh);
    }
    // The queue, and it's always a long one.
    for (let i = 0; i < 5; i++) {
      this.parked.push({ x: cx - 7.5, z: py + 3.2 + i * 3.6, angle: Math.PI, nx: 0, nz: 0, kinds: ["cng"] });
      this.parked.push({ x: cx + 7.5, z: py + 4 + i * 5.2, angle: Math.PI, nx: 0, nz: 0, kinds: ["car_sedan", "cng", "microbus"] });
    }
    const q = this.specAt(cx, z1 - 14, 0, Math.min(x1 - x0 - 20, 28), 10, 2, "commercial");
    this.sign3d(cx, z0 - 0.4, 3.4, 5.2, this.signs.labelOf("সিএনজি ফিলিং স্টেশন"), 0);
    return [q];
  }

  /** People's way through a market, for filling it with shoppers. */
  readonly marketLanes: [number, number, number][][] = [];

  /** Something for sale that a vendor stands behind. */
  private tableAt(id: string, x: number, z: number, angle: number): void {
    const instance = this.props.place(id, x, KERB_H, z, angle);
    const colliders = this.solid(id, x, z, angle);
    this.stalls.push({ x, z, angle, kind: "cart", prop: id, instance, colliders });
  }

  private fillMarket(b: Block): BuildingSpec[] {
    const r = this.rng;
    const sw = b.sidewalk;
    const x0 = b.x0 + sw, x1 = b.x1 - sw, z0 = b.z0 + sw, z1 = b.z1 - sw;
    const specs: BuildingSpec[] = [];
    const info = this.region.layout.markets?.[b.key] ?? { trade: "bazaar" as const };
    const fixed = info.trade !== "bazaar";
    const trades: Record<string, ShopKind[]> = {
      sari: ["shopSari", "shopSari", "shopSari", "shopClothes", "shopTailor"],
      electronics: ["shopElectronics", "shopElectronics", "shopMobile", "shopRepair", "shopHardware"],
      gold: ["shopGold", "shopGold", "shopGold", "shopSari", "shopClothes"],
      books: ["shopBooks", "shopBooks", "shopBooks", "shopPhoto"],
    };
    const signName = info.name ?? { bazaar: "কাঁচাবাজার", sari: "শাড়ি মার্কেট", electronics: "ইলেকট্রনিক্স মার্কেট", gold: "গহনা মার্কেট", books: "বই বাজার" }[info.trade];
    // Rows of shops and packed lanes between them.
    const gap = fixed ? 26 : 20;
    let lane = 0;
    for (let z = z0; z <= z1 - 8; z += gap, lane++) {
      let x = x0;
      while (x < x1 - 6) {
        const w = Math.min(r.range(6, 11), x1 - x);
        const q = fixed ? this.specAt(x + w / 2, z, 0, w, 10, r.int(2, 4), "commercial") : this.specAt(x + w / 2, z, 0, w, 7, 1, "tin");
        if (fixed) {
          q.trades = trades[info.trade];
          q.boards = { kind: q.trades[0], share: 0.5 };
        }
        specs.push(q);
        x += w;
        if (r.chance(0.2)) x += 2.6;
      }
      if (lane === 0) continue;
      // The lane in front of this row, with goods on both sides of a narrow way through.
      const mz = z - (fixed ? 9.5 : 6.5);
      const rows = fixed ? ["clothes_rack", "umbrella_stall", "flexi_kiosk", "clothes_heap", "shoe_stall"] : lane % 3 === 1 ? ["veg_stall", "veg_stall", "fruit_cart"] : lane % 3 === 2 ? ["fish_table", "fish_table", "meat_table"] : ["meat_table", "veg_stall", "fruit_cart", "food_cart"];
      for (let px = x0 + 4; px < x1 - 4; px += r.range(5.2, 8)) {
        if (Math.abs(px - (x0 + x1) / 2) < 2) continue;
        this.tableAt(r.pick(rows), px, mz - 2.1 + r.range(-0.25, 0.25), 0);
        if (r.chance(0.6)) this.tableAt(r.pick(rows), px + r.range(-0.6, 0.6), mz + 2.1 + r.range(-0.25, 0.25), Math.PI);
      }
      this.marketLanes.push([[x0 + 1, KERB_H, mz], [x1 - 1, KERB_H, mz]]);
    }
    this.sign3d((x0 + x1) / 2, z0 - 0.4, 3.2, 4.6, this.signs.labelOf(signName), 0);
    return specs;
  }

  /** A garment factory: a long plain block of windows behind a gate. Quiet all day, then a flood. */
  readonly factories: { gateX: number; gateZ: number; doorX: number; doorZ: number }[] = [];
  readonly mosques: { x: number; footpathZ: number; doorZ: number; reach: number }[] = [];

  private fillGarments(b: Block): BuildingSpec[] {
    const r = this.rng;
    const sw = b.sidewalk;
    const x0 = b.x0 + sw, x1 = b.x1 - sw, z0 = b.z0 + sw, z1 = b.z1 - sw;
    const cx = (x0 + x1) / 2;
    const g = this.yards;
    for (let x = x0; x < x1 - 0.01; x += 14) {
      for (let z = z0; z < z1 - 0.01; z += 14) {
        const tone = r.range(0.72, 0.88);
        g.flat(x, Math.min(x + 14, x1), z, Math.min(z + 14, z1), KERB_H + 0.012, true, patch("concrete", 4, 4, r.next(), r.next()), [tone, tone * 0.97, tone * 0.9]);
      }
    }
    this.wallRound(x0, x1, z0, z1, cx, 4.5, [0.62, 0.62, 0.58], 2.6);
    const specs: BuildingSpec[] = [];
    const wide = x1 - x0 - 14, depth = Math.min(26, (z1 - z0) * 0.4);
    // The main shed a short walk in from the gate, with another behind it on a big plot.
    const front = Math.min(z1 - depth - 6, z0 + 34);
    const main = this.specAt(cx, front, 0, wide, depth, r.int(6, 8), "resi");
    main.plain = true;
    specs.push(main);
    if (z1 - z0 > 120) {
      const second = this.specAt(cx, z1 - 26, 0, wide * 0.8, 20, r.int(5, 7), "resi");
      second.plain = true;
      specs.push(second);
    }
    this.sign3d(cx, z0 - 0.5, 3.8, 6.4, this.signs.labelOf("গার্মেন্টস কারখানা"), 0);
    this.factories.push({ gateX: cx, gateZ: z0, doorX: cx, doorZ: front - 1 });
    return specs;
  }

  private fillMosque(b: Block): BuildingSpec[] {
    const specs = this.fillDenseEdges(b);
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    if (this.props.has("mosque")) {
      this.props.place("mosque", cx, KERB_H, cz - 6, Math.PI);
      this.collision.addBox(cx - 11, cz - 14, cx + 11, cz + 3);
      this.sign3d(cx, b.z0 + b.sidewalk - 0.2, 3.2, 3.2, this.signs.labelOf("মসজিদ"), 0);
      this.mosques.push({ x: cx, footpathZ: b.z0 + b.sidewalk * 0.5, doorZ: cz - 15, reach: Math.min(48, (b.x1 - b.x0) / 2 - 3) });
    }
    return specs;
  }

  /** A school or university: a wall all round with a gate, a yard, and the main building at the back. */
  private fillCampus(b: Block): BuildingSpec[] {
    const r = this.rng;
    const big = b.kind === "university";
    const sw = b.sidewalk;
    const x0 = b.x0 + sw, x1 = b.x1 - sw, z0 = b.z0 + sw, z1 = b.z1 - sw;
    const cx = (x0 + x1) / 2;
    const g = this.yards;
    // Packed earth in the yard, a little grass round the edge.
    const step = 12;
    for (let x = x0; x < x1 - 0.01; x += step) {
      for (let z = z0; z < z1 - 0.01; z += step) {
        const edge = x < x0 + 10 || x > x1 - 22 || z < z0 + 8 || z > z1 - 22;
        const tone = r.range(0.9, 1.05);
        const c: RGB = edge ? [1 * tone, 1.28 * tone, 0.56 * tone] : [1.5 * tone, 1.28 * tone, 0.95 * tone];
        g.flat(x, Math.min(x + step, x1), z, Math.min(z + step, z1), KERB_H + 0.012, true, patch("roof", 4, 4, r.next(), r.next()), c);
      }
    }
    // The wall, with a gate in the middle of the south side.
    const paint: RGB = big ? [0.82, 0.78, 0.72] : [0.92, 0.88, 0.72];
    const H = KERB_H + 2.3;
    const gate = 4.5;
    const wallRun = (ax: number, az: number, bx: number, bz: number): void => {
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      const angle = Math.atan2(dz, dx) * -1;
      g.setFrame((ax + bx) / 2, (az + bz) / 2, angle);
      g.wallFront(-len / 2, len / 2, KERB_H, H, 0, patch("plasterClean", len, 2.3, r.next(), r.next()), paint, 0.7);
      g.wallBack(-len / 2, len / 2, KERB_H, H, 0.2, patch("plasterClean", len, 2.3, r.next(), r.next()), paint);
      g.box(-len / 2, len / 2, H, H + 0.1, -0.05, 0.25, cell("plasterStain", 0.1, 0.1, 0.3, 0.2), [paint[0] * 0.8, paint[1] * 0.8, paint[2] * 0.8]);
      g.clearFrame();
      this.collision.addBox(Math.min(ax, bx) - 0.1, Math.min(az, bz) - 0.1, Math.max(ax, bx) + 0.1, Math.max(az, bz) + 0.1, 3);
    };
    wallRun(x0, z0, cx - gate, z0);
    wallRun(cx + gate, z0, x1, z0);
    wallRun(x1, z0, x1, z1);
    wallRun(x1, z1, x0, z1);
    wallRun(x0, z1, x0, z0);
    // Gateposts, a board over the gate, and a flag in the yard.
    const name = big ? bn.campus.university : bn.campus.school;
    g.box(cx - gate - 0.35, cx - gate + 0.1, KERB_H, H + 0.9, z0 - 0.15, z0 + 0.3, cell("plasterStain", 0.1, 0.1, 0.3, 0.2), paint);
    g.box(cx + gate - 0.1, cx + gate + 0.35, KERB_H, H + 0.9, z0 - 0.15, z0 + 0.3, cell("plasterStain", 0.1, 0.1, 0.3, 0.2), paint);
    this.sign3d(cx, z0 - 0.5, 3.8, 6.4, this.signs.labelOf(name), 0);
    g.box(cx - 0.05, cx + 0.05, KERB_H, KERB_H + 8, z0 + 26, z0 + 26.1, cell("metal", 0, 0, 0.3, 0.3), [0.7, 0.7, 0.72]);
    this.collision.addCircle(cx, z0 + 26, 0.15, 8);
    // The national flag: bottle green with a red disc set a little towards the pole.
    const fy = KERB_H + 6.6, fw = 2.6, fh = 1.56;
    const green: RGB = [0.1, 0.42, 0.26], red: RGB = [0.95, 0.18, 0.2];
    const plain = cell("plasterClean", 0.1, 0.1, 0.3, 0.3);
    g.quad(cx + 0.06, fy, z0 + 26.05, cx + 0.06 + fw, fy, z0 + 26.05, cx + 0.06 + fw, fy + fh, z0 + 26.05, cx + 0.06, fy + fh, z0 + 26.05, plain, green);
    g.quad(cx + 0.06 + fw, fy, z0 + 26.05, cx + 0.06, fy, z0 + 26.05, cx + 0.06, fy + fh, z0 + 26.05, cx + 0.06 + fw, fy + fh, z0 + 26.05, plain, green);
    const dx = cx + 0.06 + fw * 0.45, dy = fy + fh / 2, dr = fh * 0.33;
    for (let k = 0; k < 14; k++) {
      const a0 = (k / 14) * Math.PI * 2, a1 = ((k + 1) / 14) * Math.PI * 2;
      for (const side of [-0.012, 0.012]) {
        const [p, q] = side < 0 ? [a0, a1] : [a1, a0];
        const [su, sv] = plain;
        g.tri(dx + Math.cos(p) * dr, dy + Math.sin(p) * dr, z0 + 26.05 + side, su, sv, dx + Math.cos(q) * dr, dy + Math.sin(q) * dr, z0 + 26.05 + side, su, sv, dx, dy, z0 + 26.05 + side, su, sv, red);
      }
    }
    // The main building and two wings, facing the yard. All windows, no shops.
    const specs: BuildingSpec[] = [];
    const house = (hx: number, hz: number, angle: number, w: number, d: number, floors: number): void => {
      const s = this.specAt(hx, hz, angle, w, d, floors, "resi");
      s.plain = true;
      specs.push(s);
    };
    const floors = big ? r.int(6, 8) : r.int(3, 4);
    const wide = x1 - x0 - 16, depth = big ? 18 : 14;
    house(cx, z1 - 6 - depth, 0, wide, depth, floors);
    const wing = Math.max((z1 - z0) * 0.42, 30);
    house(x0 + 6, z1 - 6 - depth - wing / 2, Math.PI / 2, wing, 13, floors - 1);
    house(x1 - 6, z1 - 6 - depth - wing / 2, -Math.PI / 2, wing, 13, floors - 1);
    for (let i = 0; i < 8; i++) {
      this.tree(r.range(x0 + 3, x0 + 8), r.range(z0 + 4, z0 + 30), r.pick(["tree_mehgoni", "tree_krishnachura", "tree_raintree"]));
      this.tree(r.range(x1 - 8, x1 - 3), r.range(z0 + 4, z0 + 30), r.pick(["tree_mehgoni", "tree_krishnachura", "tree_raintree"]));
    }
    this.campuses.push({ kind: big ? "university" : "school", gateX: cx, gateZ: z0, doorX: cx, doorZ: z1 - 6 - depth - 1.5, yardX0: x0 + 16, yardX1: x1 - 16, yardZ0: z0 + 6, yardZ1: z1 - depth - 12 });
    return specs;
  }

  /** Walled houses, each behind its own gate with a garden in front. Nobody builds shops here. */
  private fillVillas(b: Block): BuildingSpec[] {
    const r = this.rng;
    const specs: BuildingSpec[] = [];
    const sw = b.sidewalk;
    const x0 = b.x0 + sw, x1 = b.x1 - sw, z0 = b.z0 + sw, z1 = b.z1 - sw;
    const g = this.yards;
    // Lawns and paved yards behind the walls.
    const step = 12;
    for (let x = x0; x < x1 - 0.01; x += step) {
      for (let z = z0; z < z1 - 0.01; z += step) {
        const tone = r.range(0.85, 1.05);
        g.flat(x, Math.min(x + step, x1), z, Math.min(z + step, z1), KERB_H + 0.012, true, patch("roof", 4, 4, r.next(), r.next()), [1.02 * tone, 1.3 * tone, 0.58 * tone]);
      }
    }
    const paint: RGB[] = [[0.95, 0.93, 0.88], [0.86, 0.84, 0.8], [0.74, 0.7, 0.64], [0.92, 0.86, 0.74], [0.55, 0.57, 0.6]];
    // One plot: a wall along the footpath with a gate in it, then a garden, then the house.
    const plot = (cx: number, cz: number, angle: number, w: number): void => {
      const color = r.pick(paint);
      g.setFrame(cx, cz, angle);
      const H = KERB_H + 2.5, hw = w / 2, gate = r.range(-hw * 0.5, hw * 0.5);
      g.wallFront(-hw, gate - 1.8, KERB_H, H, 0, patch("plasterClean", hw + gate, 2.5, r.next(), r.next()), color, 0.7);
      g.wallFront(gate + 1.8, hw, KERB_H, H, 0, patch("plasterClean", hw - gate, 2.5, r.next(), r.next()), color, 0.7);
      g.wallFront(gate - 1.8, gate + 1.8, KERB_H, H - 0.1, 0.06, cell(r.chance(0.5) ? "shutter" : "shutterBlue"), [0.55, 0.55, 0.58], 0.8);
      g.box(-hw, hw, H, H + 0.12, -0.08, 0.26, cell("plasterStain", 0.1, 0.1, 0.3, 0.2), [color[0] * 0.8, color[1] * 0.8, color[2] * 0.8]);
      g.wallBack(-hw, hw, KERB_H, H, 0.2, patch("plasterClean", w, 2.5, r.next(), r.next()), color);
      g.clearFrame();
      const ca = Math.cos(angle), sa = Math.sin(angle);
      const local = (u: number, v: number): [number, number] => [cx + u * ca + v * sa, cz - u * sa + v * ca];
      const [ax, az] = local(-hw, 0), [bx, bz] = local(hw, 0.22);
      this.collision.addBox(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), 3);
      const setback = r.range(5.5, 8);
      const [hx, hz] = local(0, setback);
      const house = this.specAt(hx, hz, angle, Math.max(w - r.range(5, 8), 9), r.range(11, 15), r.int(...(this.region.style?.floors ?? [2, 4])) > 7 ? r.int(5, 7) : r.int(2, 4), "resi");
      house.plain = true;
      specs.push(house);
      for (let i = 0; i < 2; i++) {
        const [tx, tz] = local(r.range(-hw + 1.2, hw - 1.2), r.range(1.4, setback - 1.2));
        if (Math.abs(tx - hx) + Math.abs(tz - hz) > 2) this.tree(tx, tz, r.pick(["tree_mehgoni", "tree_coconut", "tree_krishnachura", "tree_banana"]));
      }
    };
    const row = (start: number, end: number, place: (center: number, w: number) => void): void => {
      let p = start;
      while (end - p > 12) {
        let w = r.range(19, 28);
        if (end - p - w < 13) w = end - p;
        place(p + w / 2, w);
        p += w;
      }
    };
    const [cSw, cSe, cNe, cNw] = b.corners;
    row(x0 + cSw, x1 - cSe, (c, w) => plot(c, z0, 0, w));
    row(x0 + cNw, x1 - cNe, (c, w) => plot(c, z1, Math.PI, w));
    row(z0 + 22, z1 - 22, (c, w) => plot(x1, c, -Math.PI / 2, w));
    row(z0 + 22, z1 - 22, (c, w) => plot(x0, c, Math.PI / 2, w));
    // Corners are closed off so the walls meet.
    for (const [px, pz] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) this.tree(px + (px < x1 ? 3 : -3), pz + (pz < z1 ? 3 : -3), "tree_raintree");
    // Further houses behind the first row.
    const ix0 = x0 + 30, ix1 = x1 - 30, iz0 = z0 + 30, iz1 = z1 - 30;
    for (let z = iz0; z < iz1 - 10; z += 24) {
      for (let x = ix0; x < ix1 - 10; x += 26) {
        const inner = this.specAt(x + 11, z, 0, 18, 16, r.int(3, 6), "resi");
        inner.back = true;
        specs.push(inner);
      }
    }
    return specs;
  }

  /** A lake with a grassy bank and a path round it. The water's edge is solid: nobody wades in. */
  private fillLake(b: Block): BuildingSpec[] {
    const r = this.rng;
    const sw = b.sidewalk;
    const x0 = b.x0 + sw, x1 = b.x1 - sw, z0 = b.z0 + sw, z1 = b.z1 - sw;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const grass = this.yards;
    const step = 14;
    for (let x = x0; x < x1 - 0.01; x += step) {
      for (let z = z0; z < z1 - 0.01; z += step) {
        const tone = r.range(0.85, 1.08);
        grass.flat(x, Math.min(x + step, x1), z, Math.min(z + step, z1), KERB_H + 0.012, true, patch("roof", 4, 4, r.next(), r.next()), [1.05 * tone, 1.36 * tone, 0.6 * tone]);
      }
    }
    this.fence(b, x0, x1, z0, z1, cx, cz);
    const ax = (x1 - x0) / 2 - 9, az = (z1 - z0) / 2 - 9;
    const rim = this.waterBody(`lake${b.id}`, cx, cz, ax, az);
    const N = rim.length;
    // Big old trees along the outer edge, benches facing the water.
    for (let i = 0; i < 26; i++) {
      const a = r.range(0, 6.28);
      const k = r.range(1.2, 1.36);
      const tx = cx + Math.cos(a) * ax * k, tz = cz + Math.sin(a) * az * k;
      if (tx < x0 + 2 || tx > x1 - 2 || tz < z0 + 2 || tz > z1 - 2) continue;
      if (Math.abs(tx - cx) < 6 || Math.abs(tz - cz) < 6) continue;
      this.tree(tx, tz, r.pick(["tree_raintree", "tree_krishnachura", "tree_mehgoni", "tree_coconut"]));
    }
    for (let i = 0; i < 10; i++) {
      const [px, pz] = rim[Math.floor((i / 10) * N)];
      const dx = px - cx, dz = pz - cz, l = Math.hypot(dx, dz) || 1;
      const bx = px + (dx / l) * 4.1, bz = pz + (dz / l) * 4.1;
      const facing = Math.atan2(-dx, -dz);
      this.props.place("bench", bx, KERB_H, bz, facing);
      this.solid("bench", bx, bz, facing, 0.8);
    }
    this.stall(cx + 14, z0 + 3.5, 0);
    this.sign3d(cx, z0 - 0.4, 3.2, 3.2, this.signs.labelOf("লেক"), 0);
    return [];
  }

  /** Still water with a rounded, slightly wandering shoreline, so it doesn't read as a swimming pool:
   *  a low stone edge, a path round it, and solid all the way round. Returns the shore. */
  private waterBody(name: string, cx: number, cz: number, ax: number, az: number): [number, number][] {
    const r = this.rng;
    const seed = r.range(0, 6.28);
    const N = Math.round(Math.min(64, Math.max(28, (ax + az) * 0.55)));
    const rim: [number, number][] = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      const wob = 1 + 0.05 * Math.sin(a * 3 + seed) + 0.03 * Math.sin(a * 7 + seed * 2);
      rim.push([cx + ax * wob * Math.sign(c) * Math.pow(Math.abs(c), 0.62), cz + az * wob * Math.sign(sn) * Math.pow(Math.abs(sn), 0.62)]);
    }
    this.lakes.push(rim);
    const water = new Geo();
    const bank = this.yards;
    const stone: RGB = [0.74, 0.72, 0.66];
    for (let i = 0; i < N; i++) {
      const [px, pz] = rim[i], [qx, qz] = rim[(i + 1) % N];
      water.tri(px, KERB_H + 0.02, pz, px / 8, pz / 8, qx, KERB_H + 0.02, qz, qx / 8, qz / 8, cx, KERB_H + 0.02, cz, cx / 8, cz / 8);
      const out = (x: number, z: number, by: number): [number, number] => {
        const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1;
        return [x + (dx / l) * by, z + (dz / l) * by];
      };
      const [p1x, p1z] = out(px, pz, 0.7), [q1x, q1z] = out(qx, qz, 0.7);
      const [p2x, p2z] = out(px, pz, 3.2), [q2x, q2z] = out(qx, qz, 3.2);
      const uv = patch("concrete", 2, 1, r.next(), r.next());
      bank.quad(px, KERB_H + 0.08, pz, qx, KERB_H + 0.08, qz, q1x, KERB_H + 0.08, q1z, p1x, KERB_H + 0.08, p1z, uv, stone);
      bank.quad(p1x, KERB_H + 0.02, p1z, q1x, KERB_H + 0.02, q1z, q2x, KERB_H + 0.02, q2z, p2x, KERB_H + 0.02, p2z, patch("concrete", 3, 2, r.next(), r.next()), [0.8, 0.74, 0.62]);
      bank.quad(qx, KERB_H + 0.02, qz, px, KERB_H + 0.02, pz, px, KERB_H + 0.08, pz, qx, KERB_H + 0.08, qz, uv, stone);
      const span = Math.hypot(qx - px, qz - pz);
      const beads = Math.max(2, Math.ceil(span / 1.1));
      for (let k = 0; k < beads; k++) this.collision.addCircle(px + ((qx - px) * k) / beads, pz + ((qz - pz) * k) / beads, 0.9, 0.5);
    }
    // The middle is water as well: nothing thrown past the edge ends up walking on it.
    const inner = 0.62;
    this.collision.addBox(cx - ax * inner, cz - az * inner, cx + ax * inner, cz + az * inner, 0.5);
    const mesh = water.build(name, this.scene, this.lakeWater());
    if (mesh) mesh.receiveShadows = true;
    return rim;
  }

  /** A grassy plot behind a fence. */
  private lawn(b: Block, x0: number, x1: number, z0: number, z1: number): void {
    const r = this.rng;
    const step = 16;
    for (let x = x0; x < x1 - 0.01; x += step) {
      for (let z = z0; z < z1 - 0.01; z += step) {
        const tone = r.range(0.82, 1.08);
        this.yards.flat(x, Math.min(x + step, x1), z, Math.min(z + step, z1), KERB_H + 0.012, true, patch("roof", 4, 4, r.next(), r.next()), [1.02 * tone, 1.34 * tone, 0.58 * tone]);
      }
    }
  }

  /** Stone steps down to the water, for washing and for sitting on. */
  private ghat(x: number, z: number, angle: number, width: number): void {
    const g = this.yards;
    const stone: RGB = [0.78, 0.76, 0.7];
    g.setFrame(x, z, angle);
    for (let i = 0; i < 5; i++) g.box(-width / 2, width / 2, KERB_H, KERB_H + 0.32 - i * 0.06, i * 0.75, (i + 1) * 0.75, patch("concrete", width, 1, this.rng.next(), this.rng.next()), stone);
    g.clearFrame();
  }

  /** A neighbourhood pond with a ghat, in a green plot, trees all round. */
  private fillPond(b: Block): BuildingSpec[] {
    const r = this.rng;
    const sw = b.sidewalk;
    const x0 = b.x0 + sw, x1 = b.x1 - sw, z0 = b.z0 + sw, z1 = b.z1 - sw;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    this.lawn(b, x0, x1, z0, z1);
    this.fence(b, x0, x1, z0, z1, cx, cz);
    const ax = (x1 - x0) * 0.32, az = (z1 - z0) * 0.32;
    const rim = this.waterBody(`pond${b.id}`, cx, cz + (z1 - z0) * 0.04, ax, az);
    this.ghat(cx, cz + (z1 - z0) * 0.04 - az - 4, 0, 9);
    for (let i = 0; i < 18; i++) {
      const a = r.range(0, 6.28), k = r.range(1.28, 1.5);
      const tx = cx + Math.cos(a) * ax * k, tz = cz + Math.sin(a) * az * k;
      if (tx < x0 + 2 || tx > x1 - 2 || tz < z0 + 2 || tz > z1 - 2 || Math.abs(tx - cx) < 8) continue;
      this.tree(tx, tz, r.pick(["tree_coconut", "tree_banana", "tree_mehgoni", "tree_raintree"]));
    }
    const [bx, bz] = rim[Math.floor(rim.length * 0.75)];
    this.props.place("bench", bx + 5, KERB_H, bz - 4, 0);
    this.solid("bench", bx + 5, bz - 4, 0, 0.8);
    this.sign3d(cx, z0 - 0.4, 3.2, 3.2, this.signs.labelOf("পুকুর"), 0);
    return [];
  }

  /** A garden: nothing but trees and a pond, with paths through them. */
  private fillGarden(b: Block): BuildingSpec[] {
    const r = this.rng;
    const sw = b.sidewalk;
    const x0 = b.x0 + sw, x1 = b.x1 - sw, z0 = b.z0 + sw, z1 = b.z1 - sw;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    this.lawn(b, x0, x1, z0, z1);
    this.fence(b, x0, x1, z0, z1, cx, cz);
    const ax = (x1 - x0) * 0.2, az = (z1 - z0) * 0.2;
    this.waterBody(`garden${b.id}`, cx, cz + (z1 - z0) * 0.14, ax, az);
    const path: RGB = [0.8, 0.74, 0.62];
    this.yards.flat(cx - 2.2, cx + 2.2, z0, cz - az + (z1 - z0) * 0.14 - 3.2, KERB_H + 0.02, true, patch("concrete", 4, 16, 0.3, 0.4), path);
    const clear = (x: number, z: number): boolean => Math.abs(x - cx) > 4 && (Math.abs(x - cx) > ax * 1.25 || Math.abs(z - cz - (z1 - z0) * 0.14) > az * 1.25);
    const trees = Math.floor(((x1 - x0) * (z1 - z0)) / 340);
    for (let i = 0; i < trees; i++) {
      const tx = r.range(x0 + 3, x1 - 3), tz = r.range(z0 + 3, z1 - 3);
      if (clear(tx, tz)) this.tree(tx, tz, r.pick(["tree_raintree", "tree_krishnachura", "tree_mehgoni", "tree_mehgoni", "tree_coconut", "tree_banana"]));
    }
    for (let i = 0; i < 6; i++) {
      const pz = z0 + 14 + i * 9;
      this.props.place("bench", cx - 4, KERB_H, pz, Math.PI / 2);
      this.solid("bench", cx - 4, pz, Math.PI / 2, 0.8);
    }
    this.stall(cx + 12, z0 + 3.5, 0);
    const name = this.region.layout.areas.find((q) => q.nameBn === "জাতীয় উদ্যান") ? "জাতীয় উদ্যান" : "উদ্যান";
    this.sign3d(cx, z0 - 0.4, 3.6, 6, this.signs.labelOf(name), 0);
    return [];
  }

  /** Walls with a gate in the south side, used by whatever needs keeping in. */
  private wallRound(x0: number, x1: number, z0: number, z1: number, gateAt: number, gate: number, paint: RGB, height: number): void {
    const r = this.rng;
    const g = this.yards;
    const H = KERB_H + height;
    const run = (ax: number, az: number, bx: number, bz: number): void => {
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      const angle = Math.atan2(dz, dx) * -1;
      g.setFrame((ax + bx) / 2, (az + bz) / 2, angle);
      g.wallFront(-len / 2, len / 2, KERB_H, H, 0, patch("plasterClean", len, height, r.next(), r.next()), paint, 0.7);
      g.wallBack(-len / 2, len / 2, KERB_H, H, 0.22, patch("plasterClean", len, height, r.next(), r.next()), paint);
      g.box(-len / 2, len / 2, H, H + 0.1, -0.05, 0.27, cell("plasterStain", 0.1, 0.1, 0.3, 0.2), [paint[0] * 0.8, paint[1] * 0.8, paint[2] * 0.8]);
      g.clearFrame();
      this.collision.addBox(Math.min(ax, bx) - 0.1, Math.min(az, bz) - 0.1, Math.max(ax, bx) + 0.1, Math.max(az, bz) + 0.1, height + 0.5);
    };
    run(x0, z0, gateAt - gate, z0);
    run(gateAt + gate, z0, x1, z0);
    run(x1, z0, x1, z1);
    run(x1, z1, x0, z1);
    run(x0, z1, x0, z0);
  }

  /** A grand entrance: two stout pillars and a board across the top. */
  private archway(x: number, z: number, half: number, height: number, label: string, paint: RGB): void {
    this.frontDoors.push({ x, z: z - 3, r: half + 7 });
    const g = this.yards;
    const side = cell("plasterStain", 0.1, 0.1, 0.3, 0.2);
    for (const sx of [-1, 1]) {
      const px = x + sx * (half + 0.5);
      g.box(px - 0.65, px + 0.65, KERB_H, KERB_H + height + 1, z - 0.65, z + 0.65, side, paint);
      this.collision.addBox(px - 0.65, z - 0.65, px + 0.65, z + 0.65, height);
    }
    g.box(x - half - 1, x + half + 1, KERB_H + height, KERB_H + height + 0.5, z - 0.55, z + 0.55, side, [paint[0] * 0.85, paint[1] * 0.85, paint[2] * 0.85]);
    this.sign3d(x, z - 0.72, height - 1.05, Math.min(half * 1.9, 11), this.signs.labelOf(label), 0);
  }

  /** The cricket stadium: a great bowl of concrete under a white roof, with floodlights you can see for
   *  miles. Match days are for later: for now the gates are shut. */
  private fillStadium(b: Block): BuildingSpec[] {
    const r = this.rng;
    const sw = b.sidewalk;
    const x0 = b.x0 + sw, x1 = b.x1 - sw, z0 = b.z0 + sw, z1 = b.z1 - sw;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    // The forecourt, swept and empty.
    const fore = this.yards;
    for (let x = x0; x < x1 - 0.01; x += 14) {
      for (let z = z0; z < z1 - 0.01; z += 14) {
        const tone = r.range(0.78, 0.95);
        fore.flat(x, Math.min(x + 14, x1), z, Math.min(z + 14, z1), KERB_H + 0.012, true, patch("concrete", 4, 4, r.next(), r.next()), [tone, tone * 0.97, tone * 0.92]);
      }
    }
    const A = Math.min((x1 - x0) / 2 - 16, 118), B = Math.min((z1 - z0) / 2 - 16, 102);
    const N = 72;
    const g = new Geo();
    const pt = (i: number, k: number): [number, number] => {
      const a = (i / N) * Math.PI * 2;
      return [cx + Math.cos(a) * A * k, cz + Math.sin(a) * B * k];
    };
    const wallTop = KERB_H + 15;
    const conc: RGB = [0.72, 0.7, 0.66];
    for (let i = 0; i < N; i++) {
      const [ax, az] = pt(i, 1), [bx, bz] = pt(i + 1, 1);
      // The outer wall, dark openings between the ribs.
      const open = i % 2 === 0;
      g.quad(bx, KERB_H, bz, ax, KERB_H, az, ax, wallTop, az, bx, wallTop, bz, patch("concrete", 8, 15, r.next(), r.next()), open ? [0.42, 0.42, 0.42] : conc);
      g.quad(ax, KERB_H, az, bx, KERB_H, bz, bx, wallTop, bz, ax, wallTop, az, patch("concrete", 8, 15, r.next(), r.next()), open ? [0.42, 0.42, 0.42] : conc);
      // Bands of seats, stepping down to the field, green and red.
      for (let t = 0; t < 7; t++) {
        const k0 = 1 - t * 0.042, k1 = k0 - 0.042;
        const y0 = wallTop - t * 1.9, y1 = y0 - 1.9;
        const [p0x, p0z] = pt(i, k0), [q0x, q0z] = pt(i + 1, k0), [p1x, p1z] = pt(i, k1), [q1x, q1z] = pt(i + 1, k1);
        const seat: RGB = t % 3 === 2 ? [0.72, 0.16, 0.16] : t % 3 === 1 ? [0.12, 0.4, 0.24] : [0.16, 0.48, 0.3];
        g.quad(p0x, y0, p0z, q0x, y0, q0z, q1x, y1, q1z, p1x, y1, p1z, patch("concrete", 6, 3, r.next(), r.next()), seat);
      }
      // The field.
      const [fx, fz] = pt(i, 0.706), [gx, gz] = pt(i + 1, 0.706);
      g.tri(fx, KERB_H + 1.8, fz, fx / 6, fz / 6, gx, KERB_H + 1.8, gz, gx / 6, gz / 6, cx, KERB_H + 1.8, cz, cx / 6, cz / 6, [0.42, 0.72, 0.3]);
      // A white roof over the top rows, on the sides of the ground only.
      const c = Math.abs(Math.sin((i / N) * Math.PI * 2));
      if (c > 0.34) {
        const [r0x, r0z] = pt(i, 1.03), [s0x, s0z] = pt(i + 1, 1.03), [r1x, r1z] = pt(i, 0.82), [s1x, s1z] = pt(i + 1, 0.82);
        const white: RGB = [1.05, 1.05, 1.02];
        const uv = patch("plasterClean", 6, 6, r.next(), r.next());
        g.quad(r0x, wallTop + 6, r0z, s0x, wallTop + 6, s0z, s1x, wallTop + 8, s1z, r1x, wallTop + 8, r1z, uv, white);
        g.quad(r1x, wallTop + 8, r1z, s1x, wallTop + 8, s1z, s0x, wallTop + 6, s0z, r0x, wallTop + 6, r0z, uv, [0.7, 0.7, 0.7]);
        if (i % 4 === 0) g.box(ax - 0.5, ax + 0.5, wallTop, wallTop + 6.2, az - 0.5, az + 0.5, cell("metal", 0, 0, 0.3, 0.3), [0.6, 0.6, 0.62]);
      }
      this.collision.addCircle(ax, az, 3.2, 40);
      this.collision.addCircle((ax + bx) / 2, (az + bz) / 2, 3.2, 40);
    }
    // Nothing gets past the wall, whatever comes through it.
    this.collision.addBox(cx - A * 0.7, cz - B * 0.7, cx + A * 0.7, cz + B * 0.7, 30);
    // The floodlights.
    const metal = cell("metal", 0, 0, 0.3, 0.3);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const mx = cx + sx * A * 0.92, mz = cz + sz * B * 0.92;
      g.box(mx - 1.1, mx + 1.1, KERB_H, KERB_H + 46, mz - 1.1, mz + 1.1, metal, [0.58, 0.6, 0.62]);
      g.box(mx - 7, mx + 7, KERB_H + 46, KERB_H + 52, mz - 0.6, mz + 0.6, patch("plasterClean", 6, 3, 0.2, 0.3), [1.25, 1.25, 1.1]);
      g.box(mx - 7.4, mx + 7.4, KERB_H + 45.6, KERB_H + 46, mz - 0.9, mz + 0.9, metal, [0.4, 0.4, 0.42]);
      this.collision.addCircle(mx, mz, 1.6, 40);
    }
    // The wicket, mown lighter down the middle of the field.
    g.flat(cx - 2, cx + 2, cz - 12, cz + 12, KERB_H + 1.84, true, patch("roof", 4, 4, 0.2, 0.3), [1.25, 1.08, 0.8]);
    const mesh = g.build(`stadium${b.id}`, this.scene, this.facade.opaque);
    if (mesh) {
      mesh.receiveShadows = true;
      this.addShadow(mesh);
    }
    const name = this.region.labels.find((q) => q.includes("স্টেডিয়াম")) ?? "স্টেডিয়াম";
    this.archway(cx, z0 + 7, 8, 8, name, [0.85, 0.83, 0.78]);
    // Ticket windows in a row along the front, and hawkers who'd be happy to have a match on.
    for (let i = 0; i < 4; i++) {
      const sx = cx - 40 + i * 9, sz = z0 + 3;
      this.props.place("tin_shed", sx, KERB_H, sz, Math.PI);
      this.solid("tin_shed", sx, sz, Math.PI, 2.4);
    }
    this.stall(cx + 28, z0 + 2.8, 0);
    this.stall(cx + 40, z0 + 2.8, 0);
    for (const [px, pz] of [[x0 + 6, z0 + 6], [x1 - 6, z0 + 6], [x0 + 6, z1 - 6], [x1 - 6, z1 - 6]]) this.tree(px, pz, "tree_raintree");
    return [];
  }

  /** The zoo: a long wall and a big gate, and tall trees over water inside, with pens along the paths. */
  private fillZoo(b: Block): BuildingSpec[] {
    const r = this.rng;
    const sw = b.sidewalk;
    const x0 = b.x0 + sw, x1 = b.x1 - sw, z0 = b.z0 + sw, z1 = b.z1 - sw;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    this.lawn(b, x0, x1, z0, z1);
    this.wallRound(x0, x1, z0, z1, cx, 6, [0.64, 0.58, 0.46], 3.2);
    this.archway(cx, z0 + 0.4, 6, 7, "জাতীয় চিড়িয়াখানা", [0.62, 0.48, 0.3]);
    const g = this.yards;
    const path: RGB = [0.8, 0.74, 0.6];
    g.flat(cx - 3, cx + 3, z0, z1 - 30, KERB_H + 0.02, true, patch("concrete", 6, 24, 0.1, 0.4), path);
    this.waterBody(`zoo${b.id}a`, x0 + (x1 - x0) * 0.26, z1 - (z1 - z0) * 0.24, (x1 - x0) * 0.17, (z1 - z0) * 0.13);
    this.waterBody(`zoo${b.id}b`, x1 - (x1 - x0) * 0.26, z1 - (z1 - z0) * 0.3, (x1 - x0) * 0.14, (z1 - z0) * 0.09);
    // Pens either side of the main path: earth, a low rail, a shed at the back.
    const pens: { x: number; z: number; w: number; d: number; sx: number; id: string }[] = [];
    for (let i = 0; i < 6; i++) {
      for (const sx of [-1, 1]) {
        pens.push({ x: cx + sx * 24, z: z0 + 26 + i * 34, w: 34, d: 24, sx, id: i % 3 === 0 ? "zoo_elephant" : "zoo_deer" });
      }
    }
    for (const q of pens) {
      if (q.z + q.d / 2 > z1 - (z1 - z0) * 0.42) continue;
      g.flat(q.x - q.w / 2, q.x + q.w / 2, q.z - q.d / 2, q.z + q.d / 2, KERB_H + 0.02, true, patch("roof", 4, 4, r.next(), r.next()), [1.55, 1.28, 0.9]);
      const rail: RGB = [0.5, 0.42, 0.3];
      const wood = cell("wood", 0, 0, 0.3, 1);
      for (const fz of [q.z - q.d / 2, q.z + q.d / 2]) {
        g.box(q.x - q.w / 2, q.x + q.w / 2, KERB_H + 1.0, KERB_H + 1.12, fz - 0.05, fz + 0.05, wood, rail);
        this.collision.addBox(q.x - q.w / 2, fz - 0.1, q.x + q.w / 2, fz + 0.1, 1.2);
      }
      for (const fx of [q.x - q.w / 2, q.x + q.w / 2]) {
        g.box(fx - 0.05, fx + 0.05, KERB_H + 1.0, KERB_H + 1.12, q.z - q.d / 2, q.z + q.d / 2, wood, rail);
        this.collision.addBox(fx - 0.1, q.z - q.d / 2, fx + 0.1, q.z + q.d / 2, 1.2);
      }
      for (let t = 0; t <= 8; t++) {
        const fx = q.x - q.w / 2 + (q.w * t) / 8;
        for (const fz of [q.z - q.d / 2, q.z + q.d / 2]) g.box(fx - 0.06, fx + 0.06, KERB_H, KERB_H + 1.15, fz - 0.06, fz + 0.06, wood, rail);
      }
      this.props.place("tin_shed", q.x + q.sx * (q.w / 2 - 3), KERB_H, q.z, q.sx > 0 ? -Math.PI / 2 : Math.PI / 2);
      this.solid("tin_shed", q.x + q.sx * (q.w / 2 - 3), q.z, q.sx > 0 ? -Math.PI / 2 : Math.PI / 2, 2.4);
      for (let n = 0; n < (q.id === "zoo_elephant" ? 2 : 4); n++) {
        const ax = q.x - q.sx * r.range(0, q.w * 0.3), az = q.z + r.range(-q.d * 0.3, q.d * 0.3), turn = r.range(0, 6.28);
        this.props.place(q.id, ax, KERB_H, az, turn);
        this.collision.addCircle(ax, az, q.id === "zoo_elephant" ? 1.5 : 0.6, 2);
      }
    }
    const trees = Math.floor(((x1 - x0) * (z1 - z0)) / 560);
    for (let i = 0; i < trees; i++) {
      const tx = r.range(x0 + 2.5, x1 - 2.5), tz = r.range(z0 + 2.5, z1 - 2.5);
      if (Math.abs(tx - cx) < 5 || pens.some((q) => Math.abs(tx - q.x) < q.w / 2 + 1 && Math.abs(tz - q.z) < q.d / 2 + 1)) continue;
      if (tz > z1 - (z1 - z0) * 0.44) {
        // Keep clear of the water.
        const near = (mx: number, mz: number, ax: number, az: number): boolean => Math.abs(tx - mx) < ax * 1.2 && Math.abs(tz - mz) < az * 1.2;
        if (near(x0 + (x1 - x0) * 0.26, z1 - (z1 - z0) * 0.24, (x1 - x0) * 0.17, (z1 - z0) * 0.13) || near(x1 - (x1 - x0) * 0.26, z1 - (z1 - z0) * 0.3, (x1 - x0) * 0.14, (z1 - z0) * 0.09)) continue;
      }
      this.tree(tx, tz, r.pick(["tree_raintree", "tree_mehgoni", "tree_krishnachura", "tree_coconut"]));
    }
    for (let i = 0; i < 8; i++) {
      const pz = z0 + 14 + i * 16;
      if (pz > z1 - 30) break;
      this.props.place("bench", cx + 4.2, KERB_H, pz, -Math.PI / 2);
      this.solid("bench", cx + 4.2, pz, -Math.PI / 2, 0.8);
    }
    this.stall(cx + 14, z0 - 2.4, Math.PI);
    return [];
  }

  /** The diplomatic quarter: quiet streets of high walls, a guard at each gate and a flag behind. */
  private fillEmbassies(b: Block): BuildingSpec[] {
    const r = this.rng;
    const specs = this.fillVillas(b);
    const g = this.yards;
    const x0 = b.x0 + b.sidewalk, x1 = b.x1 - b.sidewalk, z0 = b.z0 + b.sidewalk, z1 = b.z1 - b.sidewalk;
    const cx = (x0 + x1) / 2;
    // Made-up flags: none of these is any real country's.
    const flags: RGB[][] = [[[0.8, 0.2, 0.2], [0.95, 0.95, 0.9], [0.2, 0.3, 0.6]], [[0.15, 0.5, 0.3], [0.95, 0.85, 0.3], [0.8, 0.25, 0.2]], [[0.2, 0.25, 0.55], [0.95, 0.95, 0.9], [0.2, 0.25, 0.55]], [[0.9, 0.6, 0.2], [0.95, 0.95, 0.9], [0.2, 0.5, 0.35]]];
    const plain = cell("plasterClean", 0.1, 0.1, 0.3, 0.3);
    const flag = (fx: number, fz: number): void => {
      g.box(fx - 0.06, fx + 0.06, KERB_H, KERB_H + 9, fz - 0.06, fz + 0.06, cell("metal", 0, 0, 0.3, 0.3), [0.72, 0.72, 0.74]);
      this.collision.addCircle(fx, fz, 0.15, 9);
      const c = r.pick(flags);
      for (let i = 0; i < 3; i++) {
        const y = KERB_H + 8.8 - i * 0.5;
        g.quad(fx + 0.07, y - 0.5, fz, fx + 2.6, y - 0.5, fz, fx + 2.6, y, fz, fx + 0.07, y, fz, plain, c[i]);
        g.quad(fx + 2.6, y - 0.5, fz, fx + 0.07, y - 0.5, fz, fx + 0.07, y, fz, fx + 2.6, y, fz, plain, c[i]);
      }
    };
    for (let x = x0 + 22; x < x1 - 16; x += r.range(38, 62)) flag(x, z0 + 3.5);
    for (let x = x0 + 30; x < x1 - 16; x += r.range(38, 62)) flag(x, z1 - 3.5);
    // A guard post on the front of each block.
    for (const [bx, bz, a] of [[x0 + 14, z0 - 1.2, 0], [x1 - 14, z1 + 1.2, Math.PI]] as [number, number, number][]) {
      this.props.place("police_box", bx, KERB_H, bz, a);
      this.solid("police_box", bx, bz, a, 2.6);
    }
    this.sign3d(cx, z0 - 0.4, 3.2, 3.6, this.signs.labelOf("দূতাবাস"), 0);
    return specs;
  }

  /** Glass towers on a paved podium: the part of the city that's on the postcards. */
  private fillTowers(b: Block): BuildingSpec[] {
    const r = this.rng;
    const sw = b.sidewalk;
    const x0 = b.x0 + sw, x1 = b.x1 - sw, z0 = b.z0 + sw, z1 = b.z1 - sw;
    const g = this.yards;
    for (let x = x0; x < x1 - 0.01; x += 12) {
      for (let z = z0; z < z1 - 0.01; z += 12) {
        const tone = r.range(0.8, 0.94);
        g.flat(x, Math.min(x + 12, x1), z, Math.min(z + 12, z1), KERB_H + 0.012, true, patch("concrete", 4, 4, r.next(), r.next()), [tone, tone, tone * 0.97]);
      }
    }
    const specs: BuildingSpec[] = [];
    const { plaza } = this.region.layout;
    const place = (x: number, z: number, w: number, d: number, floors: number, angle: number): void => {
      // Clear of the big junction, and of the corners.
      if (Math.hypot(x - plaza.x, z - plaza.z) < plaza.radius + w * 0.9 || this.inStationYard(x, z, angle, w, d)) return;
      specs.push(this.specAt(x, z, angle, w, d, floors, "glass"));
    };
    const cols = Math.max(1, Math.floor((x1 - x0) / 46));
    for (let i = 0; i < cols; i++) {
      const w = (x1 - x0) / cols - 8;
      const x = x0 + ((i + 0.5) * (x1 - x0)) / cols;
      place(x, z0 + 2, w, r.range(20, 26), r.int(18, 34), 0);
      place(x, z1 - 2, w, r.range(20, 26), r.int(18, 34), Math.PI);
    }
    for (const q of specs) q.plain = false;
    for (let i = 0; i < 10; i++) {
      const px = r.range(x0 + 4, x1 - 4), pz = (z0 + z1) / 2 + r.range(-6, 6);
      this.props.place("planter", px, KERB_H, pz, 0);
      this.collision.addCircle(px, pz, 0.5, 0.9);
    }
    return specs;
  }

  private bannerSigns = new Geo();
  private bannerRopes = new Geo();

  /** A long cloth banner over the road, from one side to the other, on ropes. */
  private banner(x: number, z: number, nx: number, nz: number, span: number, kind: string): void {
    const r = this.rng;
    const mid = span / 2 + 0.4;
    const cx = x + nx * mid, cz = z + nz * mid;
    const angle = Math.atan2(nz, -nx) + Math.PI / 2;
    const y = r.range(5.4, 6.4);
    const w = Math.min(span - 2, 6.5);
    const uv = this.signs.shop(kind as Parameters<SignAtlas["shop"]>[0], r);
    this.bannerSigns.setFrame(cx, cz, angle);
    this.bannerSigns.wallFront(-w / 2, w / 2, y, y + w * 0.2, 0, uv);
    this.bannerSigns.wallBack(-w / 2, w / 2, y, y + w * 0.2, 0.02, uv);
    this.bannerSigns.clearFrame();
    this.bannerRopes.setFrame(cx, cz, angle);
    const rope = cell("metal", 0, 0, 0.3, 0.3);
    this.bannerRopes.box(-mid - 0.5, mid + 0.5, y + w * 0.2 - 0.02, y + w * 0.2, -0.01, 0.01, rope, [0.2, 0.2, 0.2]);
    this.bannerRopes.clearFrame();
  }

  /** Grand entrances: nothing gets set up on the footpath in front of them. */
  private frontDoors: { x: number; z: number; r: number }[] = [];

  /** Where to sit on the steps of the open-air stage, and where to stand on it. */
  readonly stageSeats: { x: number; y: number; z: number; yaw: number }[] = [];
  readonly stagePlayers: { x: number; y: number; z: number; yaw: number }[] = [];

  /** An open-air stage beside the lake: broad steps to sit on, facing a stage under a roof. */
  private fillStage(b: Block): BuildingSpec[] {
    const r = this.rng;
    const sw = b.sidewalk;
    const x0 = b.x0 + sw, x1 = b.x1 - sw, z0 = b.z0 + sw, z1 = b.z1 - sw;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    this.lawn(b, x0, x1, z0, z1);
    const g = new Geo();
    const stone: RGB = [0.78, 0.74, 0.66];
    // The steps run across the south half, rising away from the stage.
    const half = Math.min((x1 - x0) / 2 - 8, 34);
    const baseZ = cz + 2;
    for (let i = 0; i < 6; i++) {
      const y = KERB_H + 0.3 + i * 0.3;
      const zb = baseZ - i * 2, ze = zb - 2;
      g.box(cx - half, cx + half, KERB_H, y, ze, zb, patch("concrete", half * 2, 2, r.next(), r.next()), [stone[0] - i * 0.015, stone[1] - i * 0.015, stone[2] - i * 0.015]);
      this.decks.floor(cx - half, cx + half, ze, zb, y);
      for (let k = 0; k < 7; k++) {
        if (r.chance(0.5)) this.stageSeats.push({ x: cx - half + 4 + r.next() * (half * 2 - 8), y, z: ze + 1, yaw: 0 });
      }
    }
    // The stage itself, on the lake side.
    const sz = cz + 16;
    g.box(cx - 13, cx + 13, KERB_H, KERB_H + 1, sz, sz + 12, patch("concrete", 26, 12, 0.3, 0.2), [0.7, 0.66, 0.6]);
    this.decks.floor(cx - 13, cx + 13, sz, sz + 12, KERB_H + 1);
    for (const sx of [-1, 1]) {
      g.box(cx + sx * 12.4 - 0.3, cx + sx * 12.4 + 0.3, KERB_H + 1, KERB_H + 6.5, sz + 0.6, sz + 1.2, cell("plasterStain", 0.1, 0.1, 0.3, 0.2), [0.8, 0.78, 0.72]);
      g.box(cx + sx * 12.4 - 0.3, cx + sx * 12.4 + 0.3, KERB_H + 1, KERB_H + 6.5, sz + 10.8, sz + 11.4, cell("plasterStain", 0.1, 0.1, 0.3, 0.2), [0.8, 0.78, 0.72]);
      this.collision.addCircle(cx + sx * 12.4, sz + 0.9, 0.42, 6);
      this.collision.addCircle(cx + sx * 12.4, sz + 11.1, 0.42, 6);
    }
    g.box(cx - 14, cx + 14, KERB_H + 6.5, KERB_H + 6.9, sz - 1, sz + 13, patch("plasterClean", 26, 12, 0.2, 0.4), [0.92, 0.42, 0.22]);
    g.wallFront(cx - 12.4, cx + 12.4, KERB_H + 1, KERB_H + 6.5, sz + 11.6, patch("plasterClean", 24, 5, 0.4, 0.1), [0.76, 0.3, 0.18]);
    this.collision.addBox(cx - 12.4, sz + 11.5, cx + 12.4, sz + 11.8, 6);
    for (const px of [-7, -2, 3, 8]) this.stagePlayers.push({ x: cx + px, y: KERB_H + 1, z: sz + 7, yaw: Math.PI });
    const mesh = g.build(`stage${b.id}`, this.scene, this.facade.opaque);
    if (mesh) {
      mesh.receiveShadows = true;
      this.addShadow(mesh);
    }
    for (let i = 0; i < 20; i++) {
      const tx = r.chance(0.5) ? r.range(x0 + 2.5, cx - half - 2.5) : r.range(cx + half + 2.5, x1 - 2.5);
      this.tree(tx, r.range(z0 + 3, z1 - 3), r.pick(["tree_raintree", "tree_krishnachura", "tree_mehgoni"]));
    }
    this.stall(cx - half - 6, z0 + 3.5, 0);
    this.stall(cx + half + 6, z0 + 3.5, 0);
    this.sign3d(cx, z0 - 0.4, 3.2, 5.2, this.signs.labelOf("রবীন্দ্র সরোবর"), 0);
    return [];
  }

  /** Which side of the district a river is on, and how far it reaches, so the far bank can be left clear. */
  private riverBand: { x0: number; x1: number } | null = null;

  /** A broad river along the edge of the district, with an embankment and country boats on it. */
  private fillRiver(b: Block): BuildingSpec[] {
    const r = this.rng;
    const lim = this.region.layout.boundary + 22;
    // The road's on one side only: the water's on the other, and carries on past the edge.
    const landEast = !!b.sideRoad[1];
    const dir = landEast ? -1 : 1;
    const edge = landEast ? b.x1 : b.x0;
    const walk = edge + dir * b.sidewalk;
    const shoreAt = (z: number): number => walk + dir * (15 + Math.sin(z * 0.013) * 4 + Math.sin(z * 0.041 + 1.3) * 1.5);
    const far = dir * lim;
    this.riverBand = { x0: Math.min(walk + dir * 12, far), x1: Math.max(walk + dir * 12, far) };
    const reach = lim + 340;
    // The bank, in grass, with a paved walk along the top.
    const STEP = 14;
    const g = this.yards;
    const water = new Geo();
    const uvStone = (): Rect => patch("concrete", 3, 2, r.next(), r.next());
    const rim: [number, number][] = [];
    const y = KERB_H + 0.02;
    for (let z = -reach; z < reach; z += STEP) {
      const za = z, zb = z + STEP;
      const sa = shoreAt(za), sb = shoreAt(zb);
      // Water, right out to the far bank.
      water.quad(sa, y, za, sb, y, zb, far, y, zb, far, y, za, [sa / 8, za / 8, far / 8, zb / 8]);
      water.quad(far, y, za, far, y, zb, sb, y, zb, sa, y, za, [sa / 8, za / 8, far / 8, zb / 8]);
      if (Math.abs(za) > lim + 12) continue;
      // Stone edge.
      for (const flip of [false, true]) {
        if (flip) g.quad(sb, KERB_H + 0.3, zb, sa, KERB_H + 0.3, za, sa - dir * 1.4, KERB_H + 0.3, za, sb - dir * 1.4, KERB_H + 0.3, zb, uvStone(), [0.72, 0.7, 0.64]);
        else g.quad(sa, KERB_H + 0.3, za, sb, KERB_H + 0.3, zb, sb - dir * 1.4, KERB_H + 0.3, zb, sa - dir * 1.4, KERB_H + 0.3, za, uvStone(), [0.72, 0.7, 0.64]);
        if (flip) g.quad(sb, y, zb, sa, y, za, sa, KERB_H + 0.3, za, sb, KERB_H + 0.3, zb, uvStone(), [0.6, 0.58, 0.52]);
        else g.quad(sa, y, za, sb, y, zb, sb, KERB_H + 0.3, zb, sa, KERB_H + 0.3, za, uvStone(), [0.6, 0.58, 0.52]);
      }
      // Grass between the walk and the edge.
      const inA = walk + dir * 3.4, tone = r.range(0.85, 1.05);
      const gx0 = Math.min(inA, sa, sb), gx1 = Math.max(inA, sa, sb);
      const c: RGB = [1.02 * tone, 1.34 * tone, 0.58 * tone];
      g.flat(gx0, gx1, za, zb, KERB_H + 0.012, true, patch("roof", 4, 4, r.next(), r.next()), c);
      g.flat(Math.min(walk, inA), Math.max(walk, inA), za, zb, KERB_H + 0.016, true, patch("concrete", 3, 8, r.next(), r.next()), [0.8, 0.76, 0.66]);
      rim.push([sa, za]);
      // Solid along the water, however fast something comes at it.
      const c0 = Math.min(sa, sb) - (landEast ? 40 : 1.2), c1 = Math.max(sa, sb) + (landEast ? 1.2 : 40);
      this.collision.addBox(c0, za, c1, zb, 0.6);
    }
    rim.push([far, lim], [far, -lim]);
    this.lakes.push(rim);
    const mesh = water.build(`river${b.id}`, this.scene, this.lakeWater());
    if (mesh) mesh.receiveShadows = true;
    // The far bank, a green line with the city standing back from it.
    const farGeo = new Geo();
    const fx0 = Math.min(far, far + dir * 70), fx1 = Math.max(far, far + dir * 70);
    for (let z = -reach; z < reach; z += 40) {
      const tone = r.range(0.85, 1.05);
      farGeo.flat(fx0, fx1, z, z + 40, KERB_H + 0.2, true, patch("roof", 4, 4, r.next(), r.next()), [0.8 * tone, 1.1 * tone, 0.5 * tone]);
    }
    farGeo.build(`riverFar${b.id}`, this.scene, this.facade.opaque);
    const lim2 = this.region.layout.boundary;
    const name = this.region.labels.find((q) => q.includes("নদী")) ?? "নদী";
    for (let z = -lim2 + 20; z < lim2 - 20; z += r.range(13, 24)) {
      const tx = walk + dir * r.range(5.5, 10);
      if (r.chance(0.78)) this.tree(tx, z, r.pick(["tree_raintree", "tree_krishnachura", "tree_coconut", "tree_mehgoni", "tree_banana"]));
    }
    for (let z = -lim2 + 40; z < lim2 - 40; z += r.range(70, 130)) {
      const bx = walk + dir * 4.4, turn = landEast ? -Math.PI / 2 : Math.PI / 2;
      this.props.place("bench", bx, KERB_H, z, turn);
      this.solid("bench", bx, z, turn, 0.8);
    }
    for (let z = -lim2 + 90; z < lim2 - 60; z += r.range(180, 300)) {
      this.stall(walk + dir * 5.4, z, landEast ? -Math.PI / 2 : Math.PI / 2);
    }
    // Ghats, and boats drawn up or going by.
    for (let z = -lim2 + 70; z < lim2 - 60; z += r.range(170, 260)) {
      const sx = shoreAt(z);
      this.yards.setFrame(sx - dir * 1, z, landEast ? -Math.PI / 2 : Math.PI / 2);
      for (let i = 0; i < 4; i++) this.yards.box(-7, 7, KERB_H, KERB_H + 0.3 - i * 0.06, i * 0.8, (i + 1) * 0.8, uvStone(), [0.78, 0.76, 0.7]);
      this.yards.clearFrame();
      this.props.place("nouka", sx + dir * 9, KERB_H + 0.02, z + r.range(-4, 4), r.range(1.4, 1.74) * (landEast ? 1 : -1));
    }
    for (let i = 0; i < 18; i++) {
      this.props.place("nouka", shoreAt(0) + dir * r.range(26, Math.abs(far - shoreAt(0)) - 16), KERB_H + 0.02, r.range(-lim2 + 30, lim2 - 30), r.range(0, 6.28));
    }
    this.sign3d(walk + dir * 2, -lim2 + 60, 3.2, 4.8, this.signs.labelOf(name), landEast ? -Math.PI / 2 : Math.PI / 2);
    this.sign3d(walk + dir * 2, 90, 3.2, 4.8, this.signs.labelOf(name), landEast ? -Math.PI / 2 : Math.PI / 2);
    return [];
  }

  private lakeMaterial: PBRMaterial | null = null;
  private anisotropy = 4;

  /** Still, dark water that shows the sky, with a slight ripple drawn at load. */
  private lakeWater(): PBRMaterial {
    if (this.lakeMaterial) return this.lakeMaterial;
    const mat = new PBRMaterial("lake", this.scene);
    mat.albedoColor = new Color3(0.02, 0.075, 0.08);
    mat.metallic = 0;
    mat.roughness = 0.34;
    mat.environmentIntensity = 0.55;
    mat.specularIntensity = 0.45;
    const size = 256;
    const ripple = new DynamicTexture("lakeRipple", size, this.scene, true);
    const ctx = ripple.getContext() as unknown as CanvasRenderingContext2D;
    const image = ctx.createImageData(size, size);
    const tau = (Math.PI * 2) / size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Sums of waves that tile: slopes, stored as a normal map.
        const dx = 0.5 * Math.cos(x * tau * 5 + y * tau * 2) + 0.4 * Math.cos(x * tau * 3 - y * tau * 7) + 0.2 * Math.cos(x * tau * 11 + y * tau * 9);
        const dy = 0.25 * Math.cos(x * tau * 5 + y * tau * 2) - 0.6 * Math.cos(x * tau * 3 - y * tau * 7) + 0.2 * Math.cos(x * tau * 11 + y * tau * 9);
        const i = (y * size + x) * 4;
        image.data[i] = 128 + dx * 34;
        image.data[i + 1] = 128 + dy * 34;
        image.data[i + 2] = 245;
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    ripple.update(false);
    ripple.gammaSpace = false;
    ripple.level = 0.5;
    mat.bumpTexture = ripple;
    this.lakeMaterial = mat;
    return mat;
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
    const outer = inner + 170;
    const river = this.riverBand;
    const place = (x: number, z: number): void => {
      const w = r.range(14, 30), d = r.range(14, 24);
      const floors = r.int(6, 18);
      buildSimple({ x, z, angle: r.int(0, 3) * (Math.PI / 2), w, d, floors, style: "resi", seed: r.int(1, 1e9), base: 0 }, g);
    };
    for (let x = -outer; x < outer; x += 34) {
      for (let z = -outer; z < outer; z += 34) {
        if (Math.abs(x) < inner + 6 && Math.abs(z) < inner + 6) continue;
        // The river runs on out of sight, with the far bank clear.
        if (river && x > river.x0 - 72 && x < river.x1 + 72) continue;
        // Leave the arterial roads visibly carrying on into the haze.
        if (Math.abs(x) < 20 || Math.abs(z) < 16) continue;
        if (r.chance(0.86)) place(x + r.range(-4, 4), z + r.range(-4, 4));
      }
    }
    const mesh = g.build("backdrop", this.scene, this.facade.opaque);
    if (mesh) mesh.receiveShadows = false;
  }

  private buildBoundary(): void {
    const { boundary: lim, roads } = this.region.layout;
    const { gates } = this.region;
    const c = this.collision;
    const open = (axis: "v" | "h", end: 1 | -1): boolean => gates.some((g) => g.axis === axis && g.at === 0 && g.end === end);
    const gap = 15, past = 60;
    // A wall all round, split where a road carries on out to the next district.
    const wall = (axis: "v" | "h", end: 1 | -1): void => {
      const box = (a0: number, a1: number, b0: number, b1: number): void => {
        if (axis === "v") c.addBox(a0, Math.min(end * b0, end * b1), a1, Math.max(end * b0, end * b1));
        else c.addBox(Math.min(end * b0, end * b1), a0, Math.max(end * b0, end * b1), a1);
      };
      if (!open(axis, end)) {
        box(-lim - 40, lim + 40, lim, lim + 40);
        return;
      }
      box(-lim - 40, -gap, lim, lim + past + 10);
      box(gap, lim + 40, lim, lim + past + 10);
      box(-gap, gap, lim + past, lim + past + 10);
    };
    wall("v", 1);
    wall("v", -1);
    wall("h", 1);
    wall("h", -1);
    // Road closure boards where the arterials stop, and a big sign where they go on.
    const close = (x: number, z: number, angle: number, span: number): void => {
      for (let t = -span; t <= span; t += 2.1) {
        const ca = Math.cos(angle), sa = Math.sin(angle);
        this.loose.add("barrier", x + ca * t, 0, z - sa * t, angle);
      }
      this.sign3d(x, z, 2.8, 3.4, this.signs.labelOf("রাস্তা বন্ধ"), angle);
    };
    const road = new Geo();
    const paint = new Geo();
    const end = (axis: "v" | "h", dir: 1 | -1, span: number, x: number, z: number, angle: number): void => {
      if (!open(axis, dir)) {
        close(x, z, angle, span);
        return;
      }
      const g = gates.find((q) => q.axis === axis && q.at === 0 && q.end === dir)!;
      this.sign3d(x, z, 4.8, 10, this.signs.gateBoard(g.to), angle);
      const def = roads.find((q) => q.axis === axis && q.at === 0)!;
      const half = roadWidth(def) / 2;
      // The road itself, out past the last junction into the haze.
      const from = this.layout.junctions.reduce((m, j) => Math.max(m, dir * (axis === "v" ? j.z : j.x)), 0) + 8;
      const to = lim + past;
      const put = (g2: Geo, p0: number, p1: number, q0: number, q1: number, y: number, uv: Rect, color: RGB): void => {
        const pt = (p: number, q: number): [number, number] => (axis === "v" ? [q, dir * p] : [dir * p, q]);
        const [ax, az] = pt(p0, q0), [bx, bz] = pt(p1, q0), [cx, cz] = pt(p1, q1), [dx, dz] = pt(p0, q1);
        g2.quad(ax, y, az, bx, y, bz, cx, y, cz, dx, y, dz, uv, color);
        g2.quad(dx, y, dz, cx, y, cz, bx, y, bz, ax, y, az, uv, color);
      };
      put(road, from, to, -half, half, 0.015, [from / 6, 0, to / 6, half / 3], [0.95, 0.95, 0.95]);
      const white = cell("plasterClean", 0.1, 0.1, 0.3, 0.3);
      for (let p = from; p < to; p += 8) put(paint, p, p + 4, -0.09, 0.09, 0.025, white, [1, 1, 1]);
      for (const q of [-half + 0.6, half - 0.6]) put(paint, from, to, q - 0.07, q + 0.07, 0.025, white, [1, 1, 1]);
    };
    end("v", 1, 14, 0, lim - 1, Math.PI);
    end("v", -1, 14, 0, -lim + 1, 0);
    end("h", 1, 10, lim - 1, 0, -Math.PI / 2);
    end("h", -1, 10, -lim + 1, 0, Math.PI / 2);
    road.build("roadsOut", this.scene, asphaltMaterial(this.scene, this.anisotropy))?.getScene();
    paint.build("roadsOutPaint", this.scene, this.facade.opaque);
  }

  // ---------------------------------------------------------------- street furniture

  private tree(x: number, z: number, id: string): void {
    const r = this.rng;
    // Nothing growing through the footbridge.
    const { plaza } = this.region.layout;
    if ((Math.abs(x - plaza.x) < 24 && Math.abs(z - (plaza.z - 62)) < 19) || this.inStation(x, z)) return;
    this.props.place(id, x, KERB_H, z, r.range(0, 6.28), r.range(0.85, 1.2));
    this.collision.addCircle(x, z, 0.35, 8);
  }

  /** Blocks walking through a prop, along the whole of its real shape: a row of circles down its
   *  longest side, turned with it. Height decides whether the camera may pass over it. */
  private solid(id: string, x: number, z: number, angle: number, h = 1.6): Circle[] {
    const box = this.props.solidBox(id);
    const out: Circle[] = [];
    if (!box) return out;
    const w = box.x1 - box.x0, d = box.z1 - box.z0;
    const cx = (box.x0 + box.x1) / 2, cz = (box.z0 + box.z1) / 2;
    const r = Math.min(w, d) / 2;
    const long = Math.max(w, d);
    const n = Math.max(1, Math.ceil(long / (r * 1.5)));
    const ca = Math.cos(angle), sa = Math.sin(angle);
    for (let i = 0; i < n; i++) {
      const along = n === 1 ? 0 : -(long / 2 - r) + ((long - r * 2) * i) / (n - 1);
      const u = cx + (w >= d ? along : 0), v = cz + (w >= d ? 0 : along);
      out.push(this.collision.addCircle(x + u * ca + v * sa, z - u * sa + v * ca, r, h));
    }
    return out;
  }

  private stall(x: number, z: number, angle: number): void {
    if (!this.props.has("tea_stall")) return;
    const instance = this.props.place("tea_stall", x, KERB_H, z, angle);
    const colliders = this.solid("tea_stall", x, z, angle, 2.4);
    this.stalls.push({ x, z, angle, kind: "tea", prop: "tea_stall", instance, colliders });
  }

  /** Every sign in the district, drawn in one go: separately they'd be hundreds of draw calls. */
  private signBatch = new Geo();
  private postBatch = new Geo();

  /** A freestanding Bangla sign on two posts. */
  private sign3d(x: number, z: number, height: number, width: number, uv: readonly [number, number, number, number], angle: number): void {
    const s = this.signBatch;
    const o = this.postBatch;
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
    s.clearFrame();
    o.clearFrame();
  }

  private buildStreetFurniture(): void {
    const { layout, props, collision } = this;
    const r = this.rng;
    const poleAnchors: { x: number; z: number; angle: number }[][] = [];
    const look = this.region.style;

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
        if (!s.road) continue;
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
        const wired = (s.nz > 0 || s.nx > 0) && (!look || r.chance(look.wires));
        for (let t = margin; wired && t < len - margin; t += poleStep + r.range(-3, 3)) {
          const [px, pz] = at(t, kerbIn);
          if (this.inStation(px, pz)) continue;
          props.place("electric_pole", px, KERB_H, pz, s.angle + Math.PI / 2);
          collision.addCircle(px, pz, 0.25, 11);
          poles.push({ x: px, z: pz, angle: s.angle + Math.PI / 2 });
          // Every so often a tangle of cables crosses the road to the buildings opposite.
          if (r.chance(0.42) && !this.nearFlyover(px, pz)) props.place("cable_bundle", px, 8.4, pz, Math.atan2(-s.nz, s.nx));
        }
        poleAnchors.push(poles);

        // Street lights on bigger roads.
        if (main || secondary) {
          for (let t = margin + 8; t < len - margin; t += 30) {
            const [px, pz] = at(t, 0.5);
            if (this.inStation(px, pz)) continue;
            props.place("lamp_post", px, KERB_H, pz, s.angle);
            collision.addCircle(px, pz, 0.2, 9);
            this.lamps.push({ x: px, z: pz, angle: s.angle });
          }
        }

        // Footpath clutter and life, spaced so walkers still get through.
        let t = margin + r.range(0, 14);
        while (t < len - margin) {
          const [px, pz] = at(t, kerbIn + 0.25);
          if (this.inStation(px, pz) || this.frontDoors.some((q) => Math.hypot(q.x - px, q.z - pz) < q.r)) {
            t += 8;
            continue;
          }
          // Sellers stand at the kerb and face the people walking past.
          const [sx, sz] = at(t, 1.5);
          const faceFootpath = s.angle + Math.PI;
          let roll = r.next();
          // Quieter districts keep their footpaths clear: a street tree, or nothing.
          if (look && r.next() > look.clutter) roll = roll < 0.45 ? 0 : 1;
          const w = sw > 4.5;
          if (roll < 0.26 && b.kind !== "park" && b.kind !== "terminal" && b.kind !== "market" && b.kind !== "mosque" && b.kind !== "construction" && b.kind !== "stadium") {
            this.tree(px, pz, r.pick(["tree_mehgoni", "tree_krishnachura", "tree_raintree", "tree_coconut", "tree_banana"]));
          } else if (roll < 0.33 && w) {
            this.stall(sx, sz, faceFootpath);
          } else if (roll < 0.5) {
            const id = r.pick(FOOTPATH_TRADES);
            const instance = props.place(id, sx, KERB_H, sz, faceFootpath);
            const colliders = this.solid(id, sx, sz, faceFootpath);
            this.stalls.push({ x: sx, z: sz, angle: faceFootpath, kind: "cart", prop: id, instance, colliders });
            // On busy streets one hawker sets up right next to the next.
            if (b.kind !== "villas" && b.kind !== "embassy" && (look?.clutter ?? 1) > 0.4 && r.chance(main || b.kind === "commercial" ? 0.4 : 0.2)) {
              const [hx, hz] = at(t + 2.6, 1.5);
              if (!this.inStation(hx, hz)) this.tableAt(r.pick(FOOTPATH_TRADES), hx, hz, faceFootpath);
            }
          } else if (roll < 0.56) {
            this.loose.add("dustbin", px, KERB_H, pz, r.range(0, 6.28));
          } else if (roll < 0.62) {
            const heapAngle = r.range(0, 6.28);
            if (r.chance(0.5)) this.loose.add("crates", px, KERB_H, pz, heapAngle);
            else {
              props.place("sack_pile", px, KERB_H, pz, heapAngle);
              this.solid("sack_pile", px, pz, heapAngle, 1);
            }
          } else if (roll < 0.66) {
            const vanAngle = s.angle + Math.PI / 2 + r.range(-0.15, 0.15);
            props.place("van_cart", px, KERB_H, pz, vanAngle);
            this.solid("van_cart", px, pz, vanAngle, 1.3);
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

        // Banners strung across the road: an election, a sale, a coaching centre's results.
        if (s.road && s.road.cls !== "main" && (s.nz > 0 || s.nx > 0) && (look?.clutter ?? 1) > 0.4 && len > 50 && b.kind !== "villas" && b.kind !== "embassy") {
          for (let bt = margin + r.range(10, 40); bt < len - margin - 10; bt += r.range(55, 120)) {
            if (r.chance(0.65)) this.banner(...at(bt, 0.4), s.nx, s.nz, roadWidth(s.road), b.kind === "coaching" ? "coaching" : "office");
          }
        }

        // Parked vehicles line the side roads and can all be taken.
        if (s.road && s.road.cls !== "main") {
          const park = s.road.cls === "street" ? 0.12 : 0.1;
          for (let pt = margin + 10; pt < len - margin - 6; pt += 7.5) {
            if (!r.chance(park * 2.2)) continue;
            const [px, pz] = at(pt, 0);
            const kinds = look?.parked ?? (s.road.cls === "street" ? ["rickshaw", "rickshaw", "bicycle", "motorbike", "easybike"] : ["car_sedan", "cng", "motorbike", "microbus", "rickshaw"]);
            // Side lines run clockwise around the block, so traffic beside this kerb runs against them.
            this.parked.push({ x: px, z: pz, angle: Math.atan2(-ux, -uz), nx: s.nx, nz: s.nz, kinds });
          }
        }

        // Bus stops and billboards on the arterials.
        if ((main || (secondary && r.chance(0.34))) && len > 60) {
          const [bx, bz] = at(len * 0.4, kerbIn + 1);
          props.place("bus_stop", bx, KERB_H, bz, s.angle);
          this.solid("bus_stop", bx, bz, s.angle, 2.4);
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
          // Cones along the edge of the work.
          for (let c = -1; c <= 1; c++) this.loose.add("cone", bx + Math.cos(s.angle) * c * 1.5 + Math.sin(s.angle) * 1.6, KERB_H, bz - Math.sin(s.angle) * c * 1.5 + Math.cos(s.angle) * 1.6, r.range(0, 6.28));
          collision.addCircle(bx, bz, 0.9, 1);
        }
      }
    }
  }

  /** The ground behind the frontage: sheds, heaps, parked vans, the odd banana tree. */
  private dressYard(b: Block): void {
    if (b.kind !== "dense" && b.kind !== "commercial" && b.kind !== "construction" && b.kind !== "coaching") return;
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
          const shedAngle = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
          props.place("tin_shed", x, KERB_H, z, shedAngle);
          this.solid("tin_shed", x, z, shedAngle, 2.4);
        } else if (roll < 0.26) {
          props.place("sack_pile", x, KERB_H, z, a);
          this.solid("sack_pile", x, z, a, 1);
        } else if (roll < 0.36) {
          props.place("brick_pile", x, KERB_H, z, a);
          this.solid("brick_pile", x, z, a, 1);
        } else if (roll < 0.48) {
          this.loose.add("crates", x, KERB_H, z, a);
        } else if (roll < 0.56) {
          props.place("van_cart", x, KERB_H, z, a);
          this.solid("van_cart", x, z, a, 1.3);
        } else if (roll < 0.68) {
          this.tree(x, z, r.chance(0.7) ? "tree_banana" : "tree_mehgoni");
        } else if (roll < 0.74) {
          this.loose.add("plastic_chair", x, KERB_H, z, a);
        } else if (roll < 0.8) {
          this.loose.add("dustbin", x, KERB_H, z, a);
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
          const instance = props.place(id, x, KERB_H, z, facing);
          const colliders = this.solid(id, x, z, facing);
          this.stalls.push({ x, z, angle: facing, kind: "cart", prop: id, instance, colliders });
        } else if (roll < 0.86) {
          props.place("bench", x, KERB_H, z, facing);
          this.solid("bench", x, z, facing, 0.8);
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
    const g = this.signBatch;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    // Rotate the anchor into place, then lay the ad over the empty face.
    const fx = x + face.x * ca + face.z * sa;
    const fz = z - face.x * sa + face.z * ca;
    const front = -0.03;
    g.setFrame(fx, fz, angle + Math.PI);
    const uv = this.billboardCount++ % 3 === 0 ? this.signs.billboardIndex(Math.floor(this.billboardCount / 3)) : this.signs.billboardAd(this.rng);
    g.wallFront(-4, 4, face.y + KERB_H - 2, face.y + KERB_H + 2, front, uv);
    g.clearFrame();
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
        props.place("traffic_mast", px, KERB_H, pz, angle);
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
            this.police.push({ junction: j, x: px, y: KERB_H + (stand?.y ?? 0.4), z: pz, yaw: Math.atan2(j.x - px, j.z - pz) });
          }
        }
      }
      // An officer on foot at the kerb of every signalled junction, facing the traffic, where anyone
      // passing can see him. Two at the big roundabout.
      const corners: [number, number][] = j.isPlaza ? [[-1, -1], [1, 1]] : [[-1, 1]];
      for (const [sx, sz] of corners) this.postOfficer(j, sx, sz);
    }
  }

  /** Walks out along a diagonal from the junction to the kerb, and stands a pace inside it. */
  private postOfficer(j: Junction, sx: number, sz: number): void {
    const { layout } = this;
    const k = Math.SQRT1_2;
    for (let d = 3; d < 60; d += 0.5) {
      const x = j.x + sx * k * d, z = j.z + sz * k * d;
      if (!layout.blockAt(x, z)) continue;
      const px = x + sx * k * 1.3, pz = z + sz * k * 1.3;
      if (!layout.blockAt(px, pz)) return;
      this.police.push({ junction: j, x: px, y: KERB_H, z: pz, yaw: Math.atan2(j.x - px, j.z - pz) });
      return;
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
        // A pier that would land in a junction stands just beyond it: the deck spans across.
        let pz = z;
        for (const j of this.layout.junctions) {
          if (Math.abs(j.x - m.x) < 2 && Math.abs(z - j.z) < j.halfZ + 3.5) pz = j.z + Math.sign(z - j.z || 1) * (j.halfZ + 3.5);
        }
        props.place("metro_pier", m.x, 0, pz, 0);
        this.collision.addCircle(m.x, pz, 1.25, 30);
      }
    }
    props.place("metro_station", m.x, 0, m.stationZ, 0);
    this.stationDecks(m.x, m.stationZ);
    this.stationInside(m.x, m.stationZ);
    for (const b of props.groundFootprint("metro_station", 0.3, 2)) {
      this.collision.addBox(m.x + b.x0, m.stationZ + b.z0, m.x + b.x1, m.stationZ + b.z1);
    }
    this.placeStationSigns(m.x, m.stationZ);
  }

  private placeStationSigns(x: number, z: number): void {
    const uv = this.signs.labelOf(this.region.layout.metro!.nameBn);
    for (const name of ["sign_1", "sign_2"]) {
      const a = this.props.anchor("metro_station", name);
      if (!a) continue;
      const north = a.z > 0;
      this.anchoredSign(x + a.x, a.y, z + a.z, north ? 0 : Math.PI, uv, 10);
    }
  }

  /** Station floors and all four sets of stairs, measured from the model. */
  private stationDecks(x: number, z: number): void {
    const d = this.decks;
    const floor = 7.52, top = 7.5;
    d.floor(x - 14.3, x + 14.3, z - 46, z + 46, floor);
    for (const sx of [1, -1]) {
      // The platforms, reached from the floor below by escalator.
      const inner = x + sx * 3.9, outer = x + sx * 10.8;
      d.floor(Math.min(inner, outer), Math.max(inner, outer), z - 69, z + 69, 14.6);
      for (const sz of [1, -1]) {
        const fx = x + sx * 15.5;
        d.add(fx, KERB_H, z + sz * 54, fx, KERB_H, z + sz * 46, 1);
        d.add(fx, KERB_H, z + sz * 46, fx, top, z + sz * 33, 1);
        const zA = z + sz * 29.4, zB = z + sz * 33.1;
        d.floor(Math.min(x + sx * 14.1, x + sx * 16.6), Math.max(x + sx * 14.1, x + sx * 16.6), Math.min(zA, zB), Math.max(zA, zB), top);
      }
    }
  }

  /** The ticket counter on the floor, the gates and the stairs up, and their tops on the platforms. */
  private stationInside(x: number, z: number): void {
    const d = this.decks;
    const floor = 7.52, top = 14.6;
    const g = new Geo();
    const steel: RGB = [0.62, 0.64, 0.66];
    const dark: RGB = [0.2, 0.21, 0.23];
    const wall: RGB = [0.82, 0.82, 0.78];
    const wood = cell("wood", 0, 0, 0.6, 0.6);
    const metal = cell("metal", 0, 0, 0.3, 0.3);
    const plaster = patch("plasterClean", 3, 3, 0.2, 0.2);
    // Columns carrying the platforms, solid to walk into.
    for (const sx of [1, -1]) {
      for (const dz of [-42, -21, 21, 42]) d.solid(x + sx * 6.5 - 0.8, x + sx * 6.5 + 0.8, z + dz - 0.8, z + dz + 0.8, floor);
      for (let k = 0; k < 12; k++) {
        const pz = z - 70 + (140 / 6) * (0.25 + k * 0.5);
        d.solid(x + sx * 7.6 - 0.3, x + sx * 7.6 + 0.3, pz - 0.3, pz + 0.3, top);
      }
    }
    // Ticket counter: a booth with the window on its south side and the clerk behind it.
    const cz0 = z - 11, cz1 = z - 7.8;
    g.box(x - 6, x + 6, floor, floor + 0.92, cz0, cz0 + 0.7, wood, [0.95, 0.8, 0.62]);
    g.box(x - 6, x + 6, floor, floor + 3.3, cz1 - 0.3, cz1, plaster, wall);
    g.box(x - 6.3, x - 6, floor, floor + 3.3, cz0, cz1, plaster, wall);
    g.box(x + 6, x + 6.3, floor, floor + 3.3, cz0, cz1, plaster, wall);
    g.box(x - 6.3, x + 6.3, floor + 3.3, floor + 3.6, cz0 - 0.4, cz1, metal, steel);
    d.solid(x - 6.4, x + 6.4, cz0 - 0.05, cz1 + 0.05, floor);
    this.anchoredSign(x, floor + 3.0, cz0 - 0.44, Math.PI, this.signs.labelOf("টিকিট কাউন্টার"), 5.2);
    // On each side: a row of ticket gates, the stairs up behind them, and the stairhead on the platform above.
    for (const sx of [1, -1]) {
      const cx = x + sx * 8.4;
      const z0 = z + 4, z1 = z + 14;
      const u0 = cx - 2, u1 = cx + 2;
      g.box(u0, u1, floor, floor + 5.2, z0, z1, plaster, wall);
      g.wallFront(u0 + 0.5, u1 - 0.5, floor, floor + 2.6, z0 - 0.02, cell("winDark"), [0.5, 0.5, 0.55]);
      d.solid(u0 - 0.1, u1 + 0.1, z0 - 0.1, z1 + 0.1, floor);
      this.anchoredSign(cx, floor + 3.4, z0 - 0.05, Math.PI, this.signs.labelOf("প্ল্যাটফর্ম"), 3.4);
      for (let k = 0; k <= 4; k++) g.box(u0 + k - 0.09, u0 + k + 0.09, floor, floor + 1, z0 - 1.6, z0 - 0.5, metal, k === 2 ? dark : steel);
      d.solid(u0 - 0.1, u1 + 0.1, z0 - 1.7, z0, floor);
      // Above: walls round the stairs down.
      g.box(u0, u1, top, top + 2.3, z1 - 0.2, z1, plaster, wall);
      g.box(u0, u0 + 0.2, top, top + 2.3, z0, z1, plaster, wall);
      g.box(u1 - 0.2, u1, top, top + 2.3, z0, z1, plaster, wall);
      g.box(u0, u1, top + 2.3, top + 2.5, z0, z1, metal, steel);
      g.wallFront(u0 + 0.2, u1 - 0.2, top - 0.2, top + 2.3, z0 + 0.3, cell("winDark"), [0.4, 0.4, 0.45]);
      d.solid(u0 - 0.05, u1 + 0.05, z0, z1, top);
    }
    const mesh = g.build("stationInside", this.scene, this.facade.opaque);
    if (mesh) mesh.receiveShadows = true;
  }

  /** Under the station's floor or platforms, where nothing from the street should poke through. */
  private inStation(x: number, z: number): boolean {
    const m = this.region.layout.metro;
    return !!m && Math.abs(x - m.x) < 17 && Math.abs(z - m.stationZ) < 72;
  }

  /** The way people on foot go over the footbridge, from one footpath to the other. */
  bridgeRoute(x: number, z: number): [number, number, number][] {
    const H = 6, half = 13.2 + 1.1;
    return [
      [x + half, KERB_H, z + 14.1],
      [x + half, KERB_H, z + 13.44],
      [x + half, 3, z + 8.22],
      [x + half, 3, z + 6.82],
      [x + half, H, z + 1.35],
      [x + half - 1.2, H, z],
      [x - half + 1.2, H, z],
      [x - half, H, z - 1.35],
      [x - half, 3, z - 6.82],
      [x - half, 3, z - 8.22],
      [x - half, KERB_H, z - 13.44],
      [x - half, KERB_H, z - 14.1],
    ];
  }

  /** The way people go up to the station floor, on one of its four stairs. */
  stationRoute(x: number, z: number, sx: number, sz: number): [number, number, number][] {
    const fx = x + sx * 15.5;
    return [
      [fx, KERB_H, z + sz * 50],
      [fx, KERB_H, z + sz * 46],
      [fx, 7.5, z + sz * 33],
      [fx, 7.5, z + sz * 31],
      [x + sx * 12, 7.52, z + sz * 30],
      [x + sx * 3, 7.52, z + sz * 14],
    ];
  }

  /** The walkway and both sets of stairs, measured from the footbridge model. */
  private footbridgeDecks(x: number, z: number): void {
    const d = this.decks;
    const H = 6, half = 13.2;
    d.floor(x - half - 2.2, x + half + 2.2, z - 1.4, z + 1.4, H);
    // Flights run away from opposite ends in opposite directions, each with a landing halfway.
    for (const sign of [1, -1]) {
      const sx = x + sign * (half + 1.1);
      const at = (t: number): number => z + sign * t;
      d.add(sx, H, at(1.35), sx, 3, at(6.82), 1.05);
      d.add(sx, 3, at(6.82), sx, 3, at(8.22), 1.05);
      d.add(sx, 3, at(8.22), sx, KERB_H, at(13.44), 1.05);
      d.add(sx, KERB_H, at(13.44), sx, KERB_H, at(14.1), 1.05);
    }
  }

  private buildFlyoverRoad(addShadow: (m: Mesh) => void, anisotropy: number): void {
    const f = this.region.layout.flyover;
    if (!f) return;
    const road = this.region.layout.roads.find((q) => q.nameBn === f.roadName);
    if (!road) return;
    const passedOver = this.layout.junctions.filter((j) => (f.axis === "h" ? j.h === road : j.v === road)).map((j) => ({ at: f.axis === "h" ? j.x : j.z, half: f.axis === "h" ? j.halfX : j.halfZ }));
    buildFlyover(this.scene, f, road.median, passedOver, this.decks, this.collision, this.facade.opaque, anisotropy, addShadow);
    // Boards at the foot of each ramp, on the kerb.
    const side = roadWidth(road) / 2 + 1;
    for (const [p, q] of [[f.start - 6, -side], [f.end + 6, side]]) {
      const [x, z] = f.axis === "h" ? [p, f.at + q] : [f.at + q, p];
      this.sign3d(x, z, 3.2, 3.2, this.signs.labelOf("ফ্লাইওভার"), f.axis === "h" ? Math.PI / 2 : 0);
    }
  }

  /** Every building in the district, for the map. */
  get allBuildings(): BuildingSpec[] {
    return this.chunks.flatMap((c) => c.specs);
  }

  /** Over the flyover's road, where nothing hung across the street would clear the deck. */
  private nearFlyover(x: number, z: number): boolean {
    const f = this.region.layout.flyover;
    if (!f) return false;
    const [p, q] = f.axis === "h" ? [x, z - f.at] : [z, x - f.at];
    return p > f.start - 4 && p < f.end + 4 && Math.abs(q) < 16;
  }

  /** A Bangla board laid on a prop's blank panel. `facing` is the direction it looks, as an angle. */
  private anchoredSign(x: number, y: number, z: number, facing: number, uv: readonly [number, number, number, number], width: number): void {
    const g = this.signBatch;
    g.setFrame(x, z, facing + Math.PI);
    const h = width * ((uv[3] - uv[1]) / (uv[2] - uv[0]));
    g.wallFront(-width / 2, width / 2, y - h / 2, y + h / 2, -0.04, uv);
    g.clearFrame();
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
      this.collision.addBox(plaza.x + 12.8, fz - 1.8, plaza.x + 15.7, fz + 13.8, 8);
      this.collision.addBox(plaza.x - 15.7, fz - 13.8, plaza.x - 12.8, fz + 1.8, 8);
      this.footbridgeDecks(plaza.x, fz);
      this.bridges.push({ x: plaza.x, z: fz, half: 15.4 });
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
      if (j) this.police.push({ junction: j, x: px, y: 0.45 + (stand?.y ?? 0.4), z: pz, yaw: Math.atan2(j.x - px, j.z - pz) });
    }
  }

  // ---------------------------------------------------------------- streaming detail

  /** Swaps nearby blocks to full detail, spending a few milliseconds per call. */
  updateStreaming(x: number, z: number): void {
    for (const c of this.chunks) {
      const d = Math.hypot(c.cx - x, c.cz - z) - c.radius;
      // Lost in the haze a long way off, so there's nothing there to draw.
      if (c.simple && !c.detail) {
        const show = d < FAR_BLOCKS;
        if (c.simple.isEnabled() !== show) c.simple.setEnabled(show);
      }
      if (c.simpleSigns) {
        const show = d < FAR_SIGNS && !c.detail;
        if (c.simpleSigns.isEnabled() !== show) c.simpleSigns.setEnabled(show);
      }
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
    const g: BuildingGeo = { opaque: new Geo(), cutout: new Geo(), sign: new Geo(), shop: new Geo(), shutters: new Geo() };
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
    const shut = g.shutters.build(`block${c.block.id}_shut`, this.scene, this.facade.opaque);
    if (shut) {
      add(shut, false);
      this.shutterMeshes.add(shut);
    }
    for (const m of meshes) m.setEnabled(m !== shut || !this.shopsOpen);
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

  private shutterMeshes = new Set<Mesh>();
  private shopsOpen = true;

  /** Shutters down or up, on everything built so far and anything built from now on. */
  setShopsOpen(open: boolean): void {
    this.shopsOpen = open;
    for (const m of this.shutterMeshes) {
      if (m.isDisposed()) this.shutterMeshes.delete(m);
      else m.setEnabled(!open);
    }
  }

  private powerOn = true;
  private glowWas = 0;

  /** The lights go off all over the district, signs and shops and windows alike. */
  setPower(on: boolean): void {
    this.powerOn = on;
    this.setNightGlow(this.glowWas);
  }

  private eidGeo: Mesh | null = null;
  private eidOn = false;

  /** The banners that come out for Eid. */
  setEid(on: boolean): void {
    if (on === this.eidOn) return;
    this.eidOn = on;
    this.eidGeo?.setEnabled(on);
  }

  /** Lights up signs, shops and windows at night. */
  setNightGlow(raw: number): void {
    this.glowWas = raw;
    const k = this.powerOn ? raw : raw * 0.12;
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

function pickStyle(r: Rng, commercial: boolean, kind: Block["kind"], look?: RegionStyle): BuildingStyle {
  const roll = r.next();
  if (look && kind !== "construction") {
    let left = roll;
    const table = commercial ? look.commercial : look.street;
    for (const [style, share] of table) {
      left -= share;
      if (left <= 0) return style;
    }
    return table[0][0];
  }
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

/** Along the embankment and back: nobody walks round a river. */
function bankLoop(b: Block): number[] {
  const landEast = !!b.sideRoad[1];
  const x = landEast ? b.x1 - b.sidewalk * 0.55 : b.x0 + b.sidewalk * 0.55;
  const back = landEast ? x - 1.6 : x + 1.6;
  const lim = Math.min(b.z1, 840);
  return [x, -lim, x, lim, back, lim, back, -lim];
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
