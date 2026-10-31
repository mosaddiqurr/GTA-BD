import { Mesh, Quaternion, Scene, VertexBuffer, VertexData } from "@babylonjs/core";
import type { Vehicle } from "./vehicle";

/** The vehicle the hero's driving has its own copy of the body, so that knocks can really bend it.
 *  Only ever this one: traffic all shares one model, drawn thousands of times over. */
export class Dents {
  private mesh: Mesh | null = null;
  private owner: Vehicle | null = null;
  private pristine: Float32Array | null = null;
  private q = new Quaternion();

  constructor(private scene: Scene) {}

  private adopt(v: Vehicle): void {
    this.drop();
    const body = v.arch.bodies[v.variant] ?? v.arch.bodies[0];
    if (!body) return;
    const vd = VertexData.ExtractFromMesh(body.mesh, true, true);
    const m = new Mesh("heroBody", this.scene);
    vd.applyToMesh(m, true);
    m.material = body.mesh.material;
    m.receiveShadows = true;
    m.isPickable = false;
    m.rotationQuaternion = new Quaternion();
    this.mesh = m;
    this.owner = v;
    this.pristine = new Float32Array(m.getVerticesData(VertexBuffer.PositionKind)!);
    v.ownBody = true;
  }

  private drop(): void {
    if (this.owner) this.owner.ownBody = false;
    this.mesh?.dispose();
    this.mesh = null;
    this.owner = null;
    this.pristine = null;
  }

  /** Follows whichever vehicle the hero's at the wheel of. */
  update(v: Vehicle | null): void {
    if (v !== this.owner) {
      if (v) this.adopt(v);
      else this.drop();
    }
    const m = this.mesh, o = this.owner;
    if (!m || !o) return;
    Quaternion.RotationYawPitchRollToRef(o.heading, o.pitch + o.slope, o.roll + o.fallRoll, this.q);
    m.rotationQuaternion!.copyFrom(this.q);
    m.position.set(o.x, o.y + o.bump * 0.08 + o.fallLift, o.z);
  }

  /** Pushes the body in around a point on it. `along` and `across` are in metres from the middle. */
  hit(along: number, across: number, strength: number): void {
    const m = this.mesh;
    if (!m) return;
    const pos = m.getVerticesData(VertexBuffer.PositionKind);
    if (!pos) return;
    const radius = 0.45 + strength * 0.35, depth = Math.min(0.2, 0.05 + strength * 0.14);
    const r2 = radius * radius;
    const midY = 0.55;
    for (let i = 0; i < pos.length; i += 3) {
      const dz = pos[i + 2] - along, dx = pos[i] - across;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const k = 1 - d2 / r2;
      // Inwards towards the middle, and a bit of a crumple that varies by the point.
      const lenIn = Math.hypot(pos[i], pos[i + 2]) || 1;
      pos[i] -= (pos[i] / lenIn) * depth * k;
      pos[i + 2] -= (pos[i + 2] / lenIn) * depth * k;
      if (pos[i + 1] > midY) pos[i + 1] -= depth * 0.35 * k * (0.6 + 0.4 * Math.sin(i));
    }
    // The model's own normals stay: it's a mirrored model, and worked out afresh they'd come out wrong.
    m.updateVerticesData(VertexBuffer.PositionKind, pos);
  }

  /** Good as new. */
  repair(): void {
    if (this.mesh && this.pristine) this.mesh.updateVerticesData(VertexBuffer.PositionKind, new Float32Array(this.pristine));
  }
}
