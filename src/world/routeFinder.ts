import type { CityLayout, Junction } from "./cityLayout";

interface Edge {
  to: number;
  length: number;
}

/** The way from here to there along the roads, for the phone to draw on the map. It's the road network
 *  as junctions and the stretches between them, and it ignores which way the lanes run. */
export class RouteFinder {
  private edges: Edge[][] = [];

  constructor(private layout: CityLayout) {
    this.edges = layout.junctions.map(() => []);
    const link = (list: Junction[], along: (j: Junction) => number): void => {
      const line = [...list].sort((a, b) => along(a) - along(b));
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i];
        const length = Math.abs(along(b) - along(a));
        this.edges[a.id].push({ to: b.id, length });
        this.edges[b.id].push({ to: a.id, length });
      }
    };
    for (const road of layout.data.roads) {
      const on = layout.junctions.filter((j) => (road.axis === "v" ? j.v === road : j.h === road));
      link(on, (j) => (road.axis === "v" ? j.z : j.x));
    }
  }

  private nearest(x: number, z: number): number {
    let best = 0, bd = Infinity;
    for (const j of this.layout.junctions) {
      const d = Math.abs(j.x - x) + Math.abs(j.z - z);
      if (d < bd) {
        bd = d;
        best = j.id;
      }
    }
    return best;
  }

  find(x0: number, z0: number, x1: number, z1: number): [number, number][] {
    const js = this.layout.junctions;
    const from = this.nearest(x0, z0), to = this.nearest(x1, z1);
    const dist = new Float64Array(js.length).fill(Infinity);
    const prev = new Int32Array(js.length).fill(-1);
    const done = new Uint8Array(js.length);
    dist[from] = 0;
    for (let n = 0; n < js.length; n++) {
      let u = -1, bd = Infinity;
      for (let i = 0; i < js.length; i++) {
        if (!done[i] && dist[i] < bd) {
          bd = dist[i];
          u = i;
        }
      }
      if (u < 0 || u === to) break;
      done[u] = 1;
      for (const e of this.edges[u]) {
        if (dist[u] + e.length < dist[e.to]) {
          dist[e.to] = dist[u] + e.length;
          prev[e.to] = u;
        }
      }
    }
    const way: [number, number][] = [[x1, z1]];
    for (let at = to; at >= 0; at = prev[at]) way.push([js[at].x, js[at].z]);
    way.push([x0, z0]);
    return way.reverse();
  }
}
