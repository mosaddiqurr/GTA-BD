import { Mesh, Scene, VertexData, Material } from "@babylonjs/core";

export type Rect = readonly [number, number, number, number]; // u0, v0, u1, v1
export type RGB = readonly [number, number, number];

const WHITE: RGB = [1, 1, 1];

/** Grows geometry into flat arrays, then becomes one mesh. Used for everything
 *  merged per block: facades, roads, kerbs, wires. */
export class Geo {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  // Local-to-world placement for building-space coordinates: u along the frontage,
  // y up, v into the building. Always a pure rotation, so winding stays correct.
  private ox = 0;
  private oz = 0;
  private ca = 1;
  private sa = 0;

  setFrame(ox: number, oz: number, angle: number): void {
    this.ox = ox;
    this.oz = oz;
    this.ca = Math.cos(angle);
    this.sa = Math.sin(angle);
  }

  clearFrame(): void {
    this.setFrame(0, 0, 0);
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  /** Emits a quad from local points listed counter-clockwise on screen as seen by a
   *  viewer on its visible side. In Babylon's left-handed world (b-a) x (d-a) then
   *  points away from that viewer, so the normal is its negative. */
  quad(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    uv: Rect,
    color: RGB = WHITE,
    bottomShade = 1,
  ): void {
    const { ca, sa, ox, oz } = this;
    const wx = (u: number, v: number): number => ox + u * ca + v * sa;
    const wz = (u: number, v: number): number => oz - u * sa + v * ca;
    const px = [wx(ax, az), wx(bx, bz), wx(cx, cz), wx(dx, dz)];
    const pz = [wz(ax, az), wz(bx, bz), wz(cx, cz), wz(dx, dz)];
    const py = [ay, by, cy, dy];
    const e1x = px[1] - px[0], e1y = py[1] - py[0], e1z = pz[1] - pz[0];
    const e2x = px[3] - px[0], e2y = py[3] - py[0], e2z = pz[3] - pz[0];
    let nx = -(e1y * e2z - e1z * e2y);
    let ny = -(e1z * e2x - e1x * e2z);
    let nz = -(e1x * e2y - e1y * e2x);
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const base = this.vertexCount;
    const us = [uv[0], uv[2], uv[2], uv[0]];
    const vs = [uv[1], uv[1], uv[3], uv[3]];
    for (let i = 0; i < 4; i++) {
      this.pos.push(px[i], py[i], pz[i]);
      this.nor.push(nx, ny, nz);
      this.uv.push(us[i], vs[i]);
      const shade = i < 2 ? bottomShade : 1;
      this.col.push(color[0] * shade, color[1] * shade, color[2] * shade, 1);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** World-space triangle with its own texture coordinates; a, b, c counter-clockwise from the visible side. */
  tri(
    ax: number, ay: number, az: number, au: number, av: number,
    bx: number, by: number, bz: number, bu: number, bv: number,
    cx: number, cy: number, cz: number, cu: number, cv: number,
    color: RGB = WHITE,
  ): void {
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let nx = -(e1y * e2z - e1z * e2y);
    let ny = -(e1z * e2x - e1x * e2z);
    let nz = -(e1x * e2y - e1y * e2x);
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const base = this.vertexCount;
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.nor.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.uv.push(au, av, bu, bv, cu, cv);
    for (let i = 0; i < 3; i++) this.col.push(color[0], color[1], color[2], 1);
    this.idx.push(base, base + 1, base + 2);
  }

  /** Wall in the plane v = const facing the street (towards -v). x0 < x1 left to right from outside. */
  wallFront(x0: number, x1: number, y0: number, y1: number, v: number, uv: Rect, color: RGB = WHITE, bottomShade = 1): void {
    this.quad(x0, y0, v, x1, y0, v, x1, y1, v, x0, y1, v, uv, color, bottomShade);
  }

  /** Same plane, facing into the building (towards +v). */
  wallBack(x0: number, x1: number, y0: number, y1: number, v: number, uv: Rect, color: RGB = WHITE): void {
    this.quad(x1, y0, v, x0, y0, v, x0, y1, v, x1, y1, v, uv, color);
  }

  /** Wall in the plane u = const. faceRight: faces +u, else -u. */
  wallSide(u: number, v0: number, v1: number, y0: number, y1: number, faceRight: boolean, uv: Rect, color: RGB = WHITE): void {
    if (faceRight) this.quad(u, y0, v0, u, y0, v1, u, y1, v1, u, y1, v0, uv, color);
    else this.quad(u, y0, v1, u, y0, v0, u, y1, v0, u, y1, v1, uv, color);
  }

  /** Horizontal face. faceUp: visible from above, else from below. */
  flat(x0: number, x1: number, v0: number, v1: number, y: number, faceUp: boolean, uv: Rect, color: RGB = WHITE): void {
    if (faceUp) this.quad(x0, y, v0, x1, y, v0, x1, y, v1, x0, y, v1, uv, color);
    else this.quad(x1, y, v0, x0, y, v0, x0, y, v1, x1, y, v1, uv, color);
  }

  /** Box from x0..x1, y0..y1, v0..v1 with one texture rect on every side. */
  box(x0: number, x1: number, y0: number, y1: number, v0: number, v1: number, uv: Rect, color: RGB = WHITE, skipBottom = true): void {
    this.wallFront(x0, x1, y0, y1, v0, uv, color);
    this.wallBack(x0, x1, y0, y1, v1, uv, color);
    this.wallSide(x0, v0, v1, y0, y1, false, uv, color);
    this.wallSide(x1, v0, v1, y0, y1, true, uv, color);
    this.flat(x0, x1, v0, v1, y1, true, uv, color);
    if (!skipBottom) this.flat(x0, x1, v0, v1, y0, false, uv, color);
  }

  /** Round tube along a world-space polyline, used for hanging wires. */
  tube(points: number[][], radius: number, sides: number, uv: Rect, color: RGB): void {
    const base = this.vertexCount;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const q = points[Math.min(i + 1, points.length - 1)];
      const r = points[Math.max(i - 1, 0)];
      let dx = q[0] - r[0], dy = q[1] - r[1], dz = q[2] - r[2];
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      // Side vector perpendicular to the tube in the horizontal plane; up from their cross.
      let sx = -dz, sz = dx;
      const sl = Math.hypot(sx, sz) || 1;
      sx /= sl; sz /= sl;
      const ux = -dy * sz, uy = dx * sz - dz * sx, uz = dy * sx;
      for (let s = 0; s < sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const nx = sx * ca + ux * sa, ny = uy * sa, nz = sz * ca + uz * sa;
        this.pos.push(p[0] + nx * radius, p[1] + ny * radius, p[2] + nz * radius);
        this.nor.push(nx, ny, nz);
        this.uv.push(uv[0], uv[1]);
        this.col.push(color[0], color[1], color[2], 1);
      }
    }
    for (let i = 0; i < points.length - 1; i++) {
      for (let s = 0; s < sides; s++) {
        const a = base + i * sides + s;
        const b = base + i * sides + (s + 1) % sides;
        const c = a + sides;
        const d = b + sides;
        this.idx.push(a, b, d, a, d, c);
      }
    }
  }

  build(name: string, scene: Scene, material: Material): Mesh | null {
    if (this.idx.length === 0) return null;
    const mesh = new Mesh(name, scene);
    const data = new VertexData();
    data.positions = this.pos;
    data.normals = this.nor;
    data.uvs = this.uv;
    data.colors = this.col;
    data.indices = this.vertexCount > 65535 ? new Uint32Array(this.idx) : this.idx;
    data.applyToMesh(mesh, false);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    return mesh;
  }
}
