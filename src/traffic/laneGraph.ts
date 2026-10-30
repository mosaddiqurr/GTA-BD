import type { RoadDef } from "../regions/types";
import { CityLayout, Junction, LANE_W } from "../world/cityLayout";

export type Heading = 0 | 1 | 2 | 3; // north, east, south, west
export const DIR: readonly (readonly [number, number])[] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/** Bangladesh keeps left. Left of a heading (dx, dz) is (-dz, dx). */
export const leftOf = (h: Heading): readonly [number, number] => [-DIR[h][1], DIR[h][0]];

export const STOP_BACK = 4.2;

export interface Path {
  /** x, z pairs along the path. */
  pts: Float32Array;
  /** Distance from the start at each point. */
  cum: Float32Array;
  length: number;
}

export interface Lane extends Path {
  id: number;
  road: RoadDef;
  heading: Heading;
  index: number; // 0 is next to the road centre, last is the kerb side
  laneCount: number;
  from: Junction;
  to: Junction;
  out: Connector[];
  kind: "lane";
}

export interface Connector extends Path {
  id: number;
  lane: Lane;
  next: Lane;
  junction: Junction;
  turn: 0 | 1 | 3; // straight, right, left
  kind: "connector";
}

export function pointOn(p: Path, s: number, out: { x: number; z: number; dx: number; dz: number }): void {
  const clamped = s <= 0 ? 0 : s >= p.length ? p.length : s;
  const n = p.cum.length;
  let i = 0;
  if (n === 2) i = 0;
  else {
    // Paths are short and walked forward, so a linear scan is fine.
    while (i < n - 2 && p.cum[i + 1] < clamped) i++;
  }
  const a = i * 2;
  const seg = p.cum[i + 1] - p.cum[i] || 1;
  const t = (clamped - p.cum[i]) / seg;
  const dx = p.pts[a + 2] - p.pts[a];
  const dz = p.pts[a + 3] - p.pts[a + 1];
  out.x = p.pts[a] + dx * t;
  out.z = p.pts[a + 1] + dz * t;
  const l = Math.hypot(dx, dz) || 1;
  out.dx = dx / l;
  out.dz = dz / l;
}

function makePath(flat: number[]): { pts: Float32Array; cum: Float32Array; length: number } {
  const pts = new Float32Array(flat);
  const n = flat.length / 2;
  const cum = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(flat[i * 2] - flat[i * 2 - 2], flat[i * 2 + 1] - flat[i * 2 - 1]);
  }
  return { pts, cum, length: cum[n - 1] };
}

export class LaneGraph {
  readonly lanes: Lane[] = [];
  readonly connectors: Connector[] = [];
  /** Lanes arriving at a junction, by junction id then heading. */
  readonly incoming = new Map<number, Lane[]>();

  constructor(readonly layout: CityLayout) {
    this.buildLanes();
    this.buildConnectors();
  }

  private addLaneSet(road: RoadDef, a: Junction, b: Junction, heading: Heading): void {
    const along = road.axis === "v";
    const left = leftOf(heading);
    const dir = DIR[heading];
    for (let i = 0; i < road.lanesPerDir; i++) {
      const off = road.median / 2 + (i + 0.5) * LANE_W;
      const startBack = (along ? a.halfZ : a.halfX) + (a.isPlaza ? 0 : STOP_BACK);
      const endBack = (along ? b.halfZ : b.halfX) + (b.isPlaza ? 0 : STOP_BACK);
      const ox = (along ? road.at : 0) + left[0] * off;
      const oz = (along ? 0 : road.at) + left[1] * off;
      const ax = along ? ox : a.x + dir[0] * startBack;
      const az = along ? a.z + dir[1] * startBack : oz;
      const bx = along ? ox : b.x - dir[0] * endBack;
      const bz = along ? b.z - dir[1] * endBack : oz;
      if ((bx - ax) * dir[0] + (bz - az) * dir[1] <= 1) continue;
      this.lanes.push({
        ...makePath([ax, az, bx, bz]),
        id: this.lanes.length,
        road,
        heading,
        index: i,
        laneCount: road.lanesPerDir,
        from: a,
        to: b,
        out: [],
        kind: "lane",
      });
    }
  }

  private buildLanes(): void {
    const { layout } = this;
    for (const road of layout.data.roads) {
      const along = road.axis === "v";
      const list = layout.junctions
        .filter((j) => (along ? j.v === road : j.h === road))
        .sort((p, q) => (along ? p.z - q.z : p.x - q.x));
      for (let k = 0; k + 1 < list.length; k++) {
        const a = list[k], b = list[k + 1];
        if (along) {
          this.addLaneSet(road, a, b, 0);
          this.addLaneSet(road, b, a, 2);
        } else {
          this.addLaneSet(road, a, b, 1);
          this.addLaneSet(road, b, a, 3);
        }
      }
    }
    for (const lane of this.lanes) {
      let arr = this.incoming.get(lane.to.id);
      if (!arr) this.incoming.set(lane.to.id, (arr = []));
      arr.push(lane);
    }
  }

  private buildConnectors(): void {
    const byFrom = new Map<number, Lane[]>();
    for (const lane of this.lanes) {
      let arr = byFrom.get(lane.from.id);
      if (!arr) byFrom.set(lane.from.id, (arr = []));
      arr.push(lane);
    }
    for (const lane of this.lanes) {
      const exits = byFrom.get(lane.to.id) ?? [];
      const made: Connector[] = [];
      const attempt = (strict: boolean): void => {
        for (const m of exits) {
          const turn = ((m.heading - lane.heading + 4) % 4) as 0 | 1 | 2 | 3;
          if (turn === 2) continue;
          if (strict) {
            const outerL = lane.index === lane.laneCount - 1;
            const outerM = m.index === m.laneCount - 1;
            if (turn === 3 && !(outerL && outerM)) continue;
            if (turn === 1 && !(lane.index === 0 && m.index === 0)) continue;
            if (turn === 0 && m.index !== Math.min(lane.index, m.laneCount - 1)) continue;
          }
          made.push(this.makeConnector(lane, m, lane.to, turn as 0 | 1 | 3));
        }
      };
      attempt(true);
      if (made.length === 0) attempt(false);
      lane.out = made;
    }
  }

  private makeConnector(lane: Lane, next: Lane, junction: Junction, turn: 0 | 1 | 3): Connector {
    const n = lane.pts.length;
    const p0x = lane.pts[n - 2], p0z = lane.pts[n - 1];
    const p3x = next.pts[0], p3z = next.pts[1];
    const flat: number[] = [];
    if (junction.isPlaza) {
      const { plaza } = this.layout.data;
      const r0 = Math.hypot(p0x - plaza.x, p0z - plaza.z);
      const r1 = Math.hypot(p3x - plaza.x, p3z - plaza.z);
      const a0 = Math.atan2(p0z - plaza.z, p0x - plaza.x);
      let a1 = Math.atan2(p3z - plaza.z, p3x - plaza.x);
      // Keeping left means circling the island clockwise, so the angle decreases.
      if (a1 > a0) a1 -= Math.PI * 2;
      const ring = plaza.ringRadius + (lane.index === lane.laneCount - 1 ? 1.7 : -1.7);
      const steps = Math.max(12, Math.ceil((Math.abs(a1 - a0) * ring) / 2));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const ease = smooth(0, 0.28, t) * (1 - smooth(0.72, 1, t));
        const rad = lerp(lerp(r0, r1, t), ring, ease);
        const ang = lerp(a0, a1, t);
        flat.push(plaza.x + Math.cos(ang) * rad, plaza.z + Math.sin(ang) * rad);
      }
    } else if (turn === 0) {
      flat.push(p0x, p0z, p3x, p3z);
    } else {
      const d = Math.hypot(p3x - p0x, p3z - p0z) * 0.48;
      const h0 = DIR[lane.heading], h1 = DIR[next.heading];
      const c1x = p0x + h0[0] * d, c1z = p0z + h0[1] * d;
      const c2x = p3x - h1[0] * d, c2z = p3z - h1[1] * d;
      for (let i = 0; i <= 12; i++) {
        const t = i / 12, u = 1 - t;
        flat.push(
          u * u * u * p0x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * p3x,
          u * u * u * p0z + 3 * u * u * t * c1z + 3 * u * t * t * c2z + t * t * t * p3z,
        );
      }
    }
    const conn: Connector = { ...makePath(flat), id: this.connectors.length, lane, next, junction, turn, kind: "connector" };
    this.connectors.push(conn);
    return conn;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
