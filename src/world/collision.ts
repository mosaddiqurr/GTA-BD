/** Static world collision on the ground plane: axis-aligned boxes and circles in a
 *  spatial hash. The city is flat, so 2D is enough and stays fast and predictable. */

export interface Box {
  kind: "box";
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Top height. Lets the camera pass over low objects. */
  h: number;
}

export interface Circle {
  kind: "circle";
  x: number;
  z: number;
  r: number;
  h: number;
  /** Something light: vehicles knock it flying rather than stopping for it. */
  loose?: boolean;
}

export type Collider = Box | Circle;

const CELL = 24;

export class CollisionWorld {
  private grid = new Map<number, Collider[]>();
  private stamp = new Map<Collider, number>();
  private queryId = 0;
  private scratch: Collider[] = [];

  private key(ix: number, iz: number): number {
    return (ix + 512) * 4096 + (iz + 512);
  }

  private insert(c: Collider, x0: number, x1: number, z0: number, z1: number): void {
    for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) {
      for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
        const k = this.key(ix, iz);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(c);
      }
    }
  }

  addBox(x0: number, z0: number, x1: number, z1: number, h = 30): void {
    this.insert({ kind: "box", x0, x1, z0, z1, h }, x0, x1, z0, z1);
  }

  addCircle(x: number, z: number, r: number, h = 30): Circle {
    const c: Circle = { kind: "circle", x, z, r, h };
    this.insert(c, x - r, x + r, z - r, z + r);
    return c;
  }

  /** Slides a circle to a new spot, for the few things that can get pushed about. */
  moveCircle(c: Circle, x: number, z: number): void {
    for (let ix = Math.floor((c.x - c.r) / CELL); ix <= Math.floor((c.x + c.r) / CELL); ix++) {
      for (let iz = Math.floor((c.z - c.r) / CELL); iz <= Math.floor((c.z + c.r) / CELL); iz++) {
        const list = this.grid.get(this.key(ix, iz));
        const i = list ? list.indexOf(c) : -1;
        if (i >= 0) list!.splice(i, 1);
      }
    }
    c.x = x;
    c.z = z;
    this.insert(c, x - c.r, x + c.r, z - c.r, z + c.r);
  }

  query(x: number, z: number, radius: number): Collider[] {
    const out = this.scratch;
    out.length = 0;
    this.queryId++;
    const id = this.queryId;
    for (let ix = Math.floor((x - radius) / CELL); ix <= Math.floor((x + radius) / CELL); ix++) {
      for (let iz = Math.floor((z - radius) / CELL); iz <= Math.floor((z + radius) / CELL); iz++) {
        const list = this.grid.get(this.key(ix, iz));
        if (!list) continue;
        for (const c of list) {
          if (this.stamp.get(c) !== id) {
            this.stamp.set(c, id);
            out.push(c);
          }
        }
      }
    }
    return out;
  }

  /** Pushes a circle out of everything it overlaps. Returns the deepest contact normal,
   *  or null if there was no contact. Fills result with the corrected position. */
  resolveCircle(x: number, z: number, r: number, result: { x: number; z: number; nx: number; nz: number; hit: boolean }): void {
    let px = x, pz = z;
    let hit = false;
    let bestDepth = 0, nx = 0, nz = 0;
    // Round again if the way out of one thing led into another: a gap between two walls, say.
    for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const c of this.query(px, pz, r + 0.5)) {
      let dx: number, dz: number, depth: number;
      if (c.kind === "box") {
        const cx = Math.max(c.x0, Math.min(px, c.x1));
        const cz = Math.max(c.z0, Math.min(pz, c.z1));
        dx = px - cx;
        dz = pz - cz;
        const d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d > 1e-5) {
          dx /= d;
          dz /= d;
          depth = r - d;
        } else {
          // Centre is inside the box: leave by the nearest face.
          const left = px - c.x0, right = c.x1 - px, down = pz - c.z0, up = c.z1 - pz;
          const m = Math.min(left, right, down, up);
          if (m === left) { dx = -1; dz = 0; }
          else if (m === right) { dx = 1; dz = 0; }
          else if (m === down) { dx = 0; dz = -1; }
          else { dx = 0; dz = 1; }
          depth = m + r;
        }
      } else {
        dx = px - c.x;
        dz = pz - c.z;
        const d = Math.hypot(dx, dz);
        const rr = r + c.r;
        if (d >= rr) continue;
        if (d > 1e-5) {
          dx /= d;
          dz /= d;
        } else {
          dx = 1;
          dz = 0;
        }
        depth = rr - d;
      }
      px += dx * depth;
      pz += dz * depth;
      hit = true;
      moved = true;
      if (depth > bestDepth) {
        bestDepth = depth;
        nx = dx;
        nz = dz;
      }
    }
    if (!moved) break;
    }
    result.x = px;
    result.z = pz;
    result.nx = nx;
    result.nz = nz;
    result.hit = hit;
  }

  /** Fraction of the segment from a to b that is free, for pulling the camera in front
   *  of walls. Objects lower than the segment at that point do not block it. */
  segmentFree(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return 1;
    let best = 1;
    const steps = Math.ceil(len / (CELL * 0.75));
    const seen = new Set<Collider>();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      for (const c of this.query(ax + dx * t, az + dz * t, CELL * 0.5)) {
        if (seen.has(c)) continue;
        seen.add(c);
        // Low stalls and carts don't block the view either: a close camera behind the hero is worse.
        if (c.kind === "circle" && (c.r < 0.7 || (c.r < 1.3 && c.h < 3))) continue;
        const hit = c.kind === "box" ? rayBox(ax, az, dx, dz, c) : rayCircle(ax, az, dx, dz, c);
        if (hit !== null && hit < best) {
          const yAt = ay + (by - ay) * hit;
          if (yAt < c.h) best = hit;
        }
      }
    }
    return best;
  }
}

function rayBox(ax: number, az: number, dx: number, dz: number, b: Box): number | null {
  let t0 = 0, t1 = 1;
  if (Math.abs(dx) < 1e-8) {
    if (ax < b.x0 || ax > b.x1) return null;
  } else {
    const a = (b.x0 - ax) / dx, c = (b.x1 - ax) / dx;
    t0 = Math.max(t0, Math.min(a, c));
    t1 = Math.min(t1, Math.max(a, c));
  }
  if (Math.abs(dz) < 1e-8) {
    if (az < b.z0 || az > b.z1) return null;
  } else {
    const a = (b.z0 - az) / dz, c = (b.z1 - az) / dz;
    t0 = Math.max(t0, Math.min(a, c));
    t1 = Math.min(t1, Math.max(a, c));
  }
  return t0 <= t1 ? t0 : null;
}

function rayCircle(ax: number, az: number, dx: number, dz: number, c: Circle): number | null {
  const fx = ax - c.x, fz = az - c.z;
  const a = dx * dx + dz * dz;
  const b = 2 * (fx * dx + fz * dz);
  const k = fx * fx + fz * fz - c.r * c.r;
  const disc = b * b - 4 * a * k;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
