/** Surfaces above the ground: footbridges, station floors, flyovers. Each is a straight strip with a
 *  height at either end, so it can be a level walkway, a flight of stairs or a ramp. Anyone on one
 *  stays on it until they reach somewhere they can really step off. */
export interface Deck {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  half: number;
  /** Extra height along the strip, for a ramp that eases in and out rather than a straight slope. */
  profile?: (t: number) => number;
  wheels: boolean;
  foot: boolean;
  ux: number;
  uz: number;
  len: number;
}

interface Solid {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
}

/** How far up a step can be taken, and how far down, without falling off the edge. */
const UP = 0.75;
const DOWN = 1.1;

export class Decks {
  readonly list: Deck[] = [];
  private solids: Solid[] = [];

  add(ax: number, ay: number, az: number, bx: number, by: number, bz: number, half: number, opts: { wheels?: boolean; foot?: boolean; profile?: (t: number) => number } = {}): Deck {
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const d: Deck = { ax, ay, az, bx, by, bz, half, wheels: !!opts.wheels, foot: opts.foot ?? true, profile: opts.profile, ux: (bx - ax) / len, uz: (bz - az) / len, len };
    this.list.push(d);
    return d;
  }

  /** A level floor between two corners. */
  floor(x0: number, x1: number, z0: number, z1: number, y: number): Deck {
    const cx = (x0 + x1) / 2;
    return this.add(cx, y, z0, cx, y, z1, (x1 - x0) / 2);
  }

  /** Something solid standing on a deck, like a ticket counter. */
  solid(x0: number, x1: number, z0: number, z1: number, y: number): void {
    this.solids.push({ x0, x1, z0, z1, y });
  }

  heightAt(d: Deck, x: number, z: number): number {
    const t = Math.max(0, Math.min(1, ((x - d.ax) * d.ux + (z - d.az) * d.uz) / d.len));
    return d.profile ? d.profile(t) : d.ay + (d.by - d.ay) * t;
  }

  private contains(d: Deck, x: number, z: number, margin: number): boolean {
    const px = x - d.ax, pz = z - d.az;
    const along = px * d.ux + pz * d.uz;
    if (along < -0.02 || along > d.len + 0.02) return false;
    return Math.abs(px * d.uz - pz * d.ux) <= d.half - margin;
  }

  /** The surface someone at this height could be standing on here, if there is one. */
  find(x: number, z: number, y: number, wheels: boolean, margin = 0): Deck | null {
    let best: Deck | null = null, bh = -Infinity;
    for (const d of this.list) {
      if (wheels ? !d.wheels : !d.foot) continue;
      if (!this.contains(d, x, z, margin)) continue;
      const h = this.heightAt(d, x, z);
      if (h > y + UP || h < y - DOWN || h <= bh) continue;
      bh = h;
      best = d;
    }
    return best;
  }

  /** Brings a point back onto a deck, for someone who has reached the rail. */
  clamp(d: Deck, x: number, z: number, margin: number, out: { x: number; z: number }): void {
    const px = x - d.ax, pz = z - d.az;
    const along = Math.max(0, Math.min(d.len, px * d.ux + pz * d.uz));
    const room = Math.max(d.half - margin, 0);
    const across = Math.max(-room, Math.min(room, px * d.uz - pz * d.ux));
    out.x = d.ax + d.ux * along + d.uz * across;
    out.z = d.az + d.uz * along - d.ux * across;
  }

  /** Pushes a walker out of anything standing on the deck at this height. */
  pushOut(x: number, z: number, r: number, y: number, out: { x: number; z: number }): void {
    out.x = x;
    out.z = z;
    for (const s of this.solids) {
      if (Math.abs(s.y - y) > 1.2) continue;
      const inL = out.x - (s.x0 - r), inR = s.x1 + r - out.x, inB = out.z - (s.z0 - r), inT = s.z1 + r - out.z;
      if (inL <= 0 || inR <= 0 || inB <= 0 || inT <= 0) continue;
      const least = Math.min(inL, inR, inB, inT);
      if (least === inL) out.x -= inL;
      else if (least === inR) out.x += inR;
      else if (least === inB) out.z -= inB;
      else out.z += inT;
    }
  }

  /** Height of the highest surface here at or below `y`, or 0, for the camera's sake. */
  surfaceBelow(x: number, z: number, y: number): number {
    let h = 0;
    for (const d of this.list) {
      if (!this.contains(d, x, z, 0)) continue;
      const q = this.heightAt(d, x, z);
      if (q <= y + 0.2 && q > h) h = q;
    }
    return h;
  }
}
