import type { BlockKind, RegionLayout, RoadDef } from "../regions/types";

export const LANE_W = 3.3;
const SHOULDER = 0.8;
export const KERB_H = 0.16;

export function roadWidth(r: RoadDef): number {
  return r.median + r.lanesPerDir * 2 * LANE_W + SHOULDER * 2;
}

export interface Junction {
  id: number;
  x: number;
  z: number;
  v: RoadDef;
  h: RoadDef;
  halfX: number; // half size of the junction box
  halfZ: number;
  isPlaza: boolean;
  /** Arms present, as headings out of the junction: 0 N, 1 E, 2 S, 3 W. */
  arms: boolean[];
  signal: boolean;
}

export interface Block {
  id: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  kind: BlockKind;
  sidewalk: number;
  /** Radius of the rounded kerb at each corner: SW, SE, NE, NW. */
  corners: [number, number, number, number];
  /** Name of the road on each side: N, E, S, W. */
  sideRoad: (RoadDef | null)[];
}

export class CityLayout {
  readonly junctions: Junction[] = [];
  readonly blocks: Block[] = [];
  readonly roadsByLine = new Map<string, RoadDef>();

  constructor(readonly data: RegionLayout) {
    this.buildJunctions();
    this.buildBlocks();
  }

  roadAt(axis: "v" | "h", at: number, along: number): RoadDef | null {
    return this.data.roads.find((r) => r.axis === axis && r.at === at && along >= r.from - 0.01 && along <= r.to + 0.01) ?? null;
  }

  private buildJunctions(): void {
    const { xLines, zLines, plaza } = this.data;
    for (const x of xLines) {
      for (const z of zLines) {
        const v = this.roadAt("v", x, z);
        const h = this.roadAt("h", z, x);
        if (!v || !h) continue;
        const isPlaza = plaza.x === x && plaza.z === z;
        const arms = [
          z + 1 <= v.to, // north
          x + 1 <= h.to, // east
          z - 1 >= v.from, // south
          x - 1 >= h.from, // west
        ];
        const armCount = arms.filter(Boolean).length;
        const signal = isPlaza || (armCount >= 3 && v.cls !== "street" && h.cls !== "street") || ((v.cls === "main" || h.cls === "main") && armCount >= 3);
        this.junctions.push({
          id: this.junctions.length,
          x,
          z,
          v,
          h,
          halfX: isPlaza ? plaza.radius : roadWidth(v) / 2,
          halfZ: isPlaza ? plaza.radius : roadWidth(h) / 2,
          isPlaza,
          arms,
          signal,
        });
      }
    }
  }

  private buildBlocks(): void {
    const { xLines, zLines, blocks: kinds } = this.data;
    const nx = xLines.length - 1;
    const nz = zLines.length - 1;
    const owner: number[][] = Array.from({ length: nx }, () => new Array(nz).fill(-1));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        if (owner[i][j] >= 0) continue;
        let i1 = i;
        let j1 = j;
        const midZ = (zLines[j] + zLines[j + 1]) / 2;
        const midX = (xLines[i] + xLines[i + 1]) / 2;
        // A missing road between two cells merges them into one larger block.
        while (i1 + 1 < nx && !this.roadAt("v", xLines[i1 + 1], midZ)) i1++;
        while (j1 + 1 < nz && !this.roadAt("h", zLines[j1 + 1], midX)) j1++;
        const id = this.blocks.length;
        for (let a = i; a <= i1; a++) for (let b = j; b <= j1; b++) owner[a][b] = id;
        const west = this.roadAt("v", xLines[i], midZ);
        const east = this.roadAt("v", xLines[i1 + 1], midZ);
        const south = this.roadAt("h", zLines[j], midX);
        const north = this.roadAt("h", zLines[j1 + 1], midX);
        const x0 = xLines[i] + (west ? roadWidth(west) / 2 : 0);
        const x1 = xLines[i1 + 1] - (east ? roadWidth(east) / 2 : 0);
        const z0 = zLines[j] + (south ? roadWidth(south) / 2 : 0);
        const z1 = zLines[j1 + 1] - (north ? roadWidth(north) / 2 : 0);
        const main = [west, east, south, north].some((r) => r?.cls === "main");
        const sec = [west, east, south, north].some((r) => r?.cls === "secondary");
        const kind: BlockKind = kinds[`${i},${j}`] ?? (main ? "commercial" : "dense");
        const cornerRadius = (a: RoadDef | null, b: RoadDef | null): number => {
          if (!a || !b) return 3;
          const big = Math.max(a.lanesPerDir, b.lanesPerDir);
          return big >= 3 ? 9 : big === 2 ? 7 : 4;
        };
        const corners: [number, number, number, number] = [
          cornerRadius(south, west),
          cornerRadius(south, east),
          cornerRadius(north, east),
          cornerRadius(north, west),
        ];
        // The plaza eats big rounded corners out of the four blocks that touch it.
        const { plaza } = this.data;
        const touchesPlaza = (cx: number, cz: number): boolean => Math.hypot(cx - plaza.x, cz - plaza.z) < plaza.radius * 1.3;
        const plazaR = plaza.radius * 0.72;
        if (touchesPlaza(x0, z0)) corners[0] = plazaR;
        if (touchesPlaza(x1, z0)) corners[1] = plazaR;
        if (touchesPlaza(x1, z1)) corners[2] = plazaR;
        if (touchesPlaza(x0, z1)) corners[3] = plazaR;
        this.blocks.push({
          id,
          x0,
          x1,
          z0,
          z1,
          kind,
          sidewalk: main ? 5.2 : sec ? 4.2 : 3.2,
          corners,
          sideRoad: [north, east, south, west],
        });
      }
    }
  }

  /** True if a world point stands on a raised block (footpath or building lot). */
  blockAt(x: number, z: number): Block | null {
    for (const b of this.blocks) {
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) {
        return insideRounded(b, x, z) ? b : null;
      }
    }
    return null;
  }

  groundHeight(x: number, z: number): number {
    return this.blockAt(x, z) ? KERB_H : 0;
  }

  roadNameAt(x: number, z: number): string | null {
    for (const r of this.data.roads) {
      const half = roadWidth(r) / 2;
      if (r.axis === "v" && Math.abs(x - r.at) < half && z >= r.from && z <= r.to) return r.nameBn;
      if (r.axis === "h" && Math.abs(z - r.at) < half && x >= r.from && x <= r.to) return r.nameBn;
    }
    return null;
  }

  areaAt(x: number, z: number): string {
    for (const a of this.data.areas) {
      if (x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1) return a.nameBn;
    }
    return this.data.areas[this.data.areas.length - 1].nameBn;
  }
}

function insideRounded(b: Block, x: number, z: number): boolean {
  const check = (cx: number, cz: number, r: number, inX: boolean, inZ: boolean): boolean => {
    if (!inX || !inZ) return true;
    return Math.hypot(x - cx, z - cz) <= r;
  };
  const [sw, se, ne, nw] = b.corners;
  return (
    check(b.x0 + sw, b.z0 + sw, sw, x < b.x0 + sw, z < b.z0 + sw) &&
    check(b.x1 - se, b.z0 + se, se, x > b.x1 - se, z < b.z0 + se) &&
    check(b.x1 - ne, b.z1 - ne, ne, x > b.x1 - ne, z > b.z1 - ne) &&
    check(b.x0 + nw, b.z1 - nw, nw, x < b.x0 + nw, z > b.z1 - nw)
  );
}

/** Small seeded RNG so a region regenerates identically every run. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}
