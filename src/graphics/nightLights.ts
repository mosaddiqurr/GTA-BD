import { Color3, DynamicTexture, Engine, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3, VertexData } from "@babylonjs/core";
import type { Vehicle } from "../vehicles/vehicle";
import type { City } from "../world/city";
import { Geo } from "../world/geo";
import { KERB_H } from "../world/cityLayout";

const MAX_VEHICLES = 48;

/** The city after dark. Real point lights would be far too expensive, so lit ground is drawn
 *  as additive decals: lamp pools, spill from shopfronts, and headlight beams. */
export class NightLights {
  private pools: Mesh | null;
  private poolMat: StandardMaterial;
  private spillMat: StandardMaterial;
  private spill: Mesh | null;
  private lampHeads: Mesh;
  private front: Mesh;
  private rear: Mesh;
  private beams: Mesh;
  private beamMat: StandardMaterial;
  private frontData = new Float32Array(MAX_VEHICLES * 2 * 16);
  private rearData = new Float32Array(MAX_VEHICLES * 2 * 16);
  private beamData = new Float32Array(MAX_VEHICLES * 16);
  private tmp = Matrix.Identity();
  private level = -1;

  constructor(private scene: Scene, city: City) {
    const radial = softTexture(scene, "glowRadial", (ctx, s) => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, s, s);
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgb(255,226,180)");
      g.addColorStop(0.35, "rgb(140,120,92)");
      g.addColorStop(1, "rgb(0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
    const band = softTexture(scene, "glowBand", (ctx, s) => {
      // Bright along the wall (bottom of the texture), fading out across the footpath.
      const g = ctx.createLinearGradient(0, s, 0, 0);
      g.addColorStop(0, "rgb(255,240,210)");
      g.addColorStop(1, "rgb(0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      const edge = ctx.createLinearGradient(0, 0, s, 0);
      edge.addColorStop(0, "rgba(0,0,0,1)");
      edge.addColorStop(0.08, "rgba(0,0,0,0)");
      edge.addColorStop(0.92, "rgba(0,0,0,0)");
      edge.addColorStop(1, "rgba(0,0,0,1)");
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, s, s);
    });
    const cone = softTexture(scene, "glowCone", (ctx, s) => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, s, s);
      // Narrow near the vehicle (bottom), spreading and fading with distance.
      const g = ctx.createLinearGradient(0, s, 0, 0);
      g.addColorStop(0, "rgba(255,255,255,0.9)");
      g.addColorStop(0.55, "rgba(255,255,255,0.4)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(s * 0.34, s);
      ctx.lineTo(s * 0.66, s);
      ctx.lineTo(s, 0);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fill();
    });

    this.poolMat = additive(scene, "lampPool", radial, Color3.Black());
    this.spillMat = additive(scene, "shopSpill", band, Color3.Black());
    this.beamMat = additive(scene, "beam", cone, Color3.Black());

    const y = 0.035;
    const g = new Geo();
    for (const lamp of city.lamps) {
      const r = 15;
      // The arm reaches out over the road, so the pool is centred away from the kerb.
      const cx = lamp.x + Math.sin(lamp.angle) * 3.4;
      const cz = lamp.z + Math.cos(lamp.angle) * 3.4;
      g.clearFrame();
      g.flat(cx - r, cx + r, cz - r, cz + r, y, true, [0, 0, 1, 1]);
    }
    this.pools = g.build("lampPools", scene, this.poolMat);

    const s = new Geo();
    for (const b of city.frontages) {
      // Houses behind their walls don't light up the pavement.
      if (b.plain) continue;
      s.setFrame(b.x, b.z, b.angle);
      // The texture's bright edge goes against the shop wall (v = 0 here).
      s.flat(-b.w / 2, b.w / 2, -3.8, 0, KERB_H + 0.03, true, [0, 1, 1, 0]);
    }
    this.spill = s.build("shopSpill", scene, this.spillMat);

    const headMat = new StandardMaterial("lampHead", scene);
    headMat.disableLighting = true;
    headMat.emissiveColor = new Color3(1, 0.82, 0.52);
    headMat.fogEnabled = false;
    this.lampHeads = MeshBuilder.CreateSphere("lampHeads", { segments: 3, diameter: 0.46 }, scene);
    this.lampHeads.material = headMat;
    this.lampHeads.isPickable = false;
    const anchor = city.props.anchor("lamp_post", "lamp");
    const heads = new Float32Array(city.lamps.length * 16);
    city.lamps.forEach((lamp, i) => {
      const ax = anchor?.x ?? 0, ay = anchor?.y ?? 8.8, az = anchor?.z ?? 3;
      const sa = Math.sin(lamp.angle), ca = Math.cos(lamp.angle);
      const m = Matrix.Translation(lamp.x + ax * ca + az * sa, KERB_H + ay, lamp.z - ax * sa + az * ca);
      m.copyToArray(heads, i * 16);
    });
    this.lampHeads.thinInstanceSetBuffer("matrix", heads, 16, true);
    this.lampHeads.alwaysSelectAsActiveMesh = true;

    const lensMat = (name: string, c: Color3): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      m.disableLighting = true;
      m.emissiveColor = c;
      m.fogEnabled = false;
      return m;
    };
    this.front = MeshBuilder.CreateSphere("vehFront", { segments: 3, diameter: 0.17 }, scene);
    this.front.material = lensMat("vehFrontMat", new Color3(1, 0.96, 0.82));
    this.rear = MeshBuilder.CreateSphere("vehRear", { segments: 3, diameter: 0.14 }, scene);
    this.rear.material = lensMat("vehRearMat", new Color3(1, 0.06, 0.04));
    for (const m of [this.front, this.rear]) {
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true;
    }
    this.front.thinInstanceSetBuffer("matrix", this.frontData, 16, false);
    this.rear.thinInstanceSetBuffer("matrix", this.rearData, 16, false);

    this.beams = new Mesh("beams", scene);
    const vd = new VertexData();
    // A unit quad reaching forward from the origin along +Z.
    vd.positions = [-0.5, 0, 0, 0.5, 0, 0, 0.5, 0, 1, -0.5, 0, 1];
    vd.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
    vd.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
    vd.indices = [0, 1, 2, 0, 2, 3];
    vd.applyToMesh(this.beams);
    this.beams.material = this.beamMat;
    this.beams.isPickable = false;
    this.beams.alwaysSelectAsActiveMesh = true;
    this.beams.thinInstanceSetBuffer("matrix", this.beamData, 16, false);
    this.setLevel(0);
  }

  private setLevel(k: number, force = false): void {
    if (k === this.level && !force) return;
    this.level = k;
    const on = k > 0.08;
    const lit = on && this.power;
    this.pools?.setEnabled(lit);
    this.spill?.setEnabled(lit);
    this.lampHeads.setEnabled(lit);
    this.front.setEnabled(on);
    this.rear.setEnabled(on);
    this.beams.setEnabled(on);
    this.poolMat.alpha = 0.42 * k;
    this.spillMat.alpha = 0.26 * k;
    this.beamMat.alpha = 0.5 * k;
  }

  private power = true;

  /** Street lamps and lit shop fronts go off together when the power does. Headlights don't. */
  setPower(on: boolean): void {
    this.power = on;
    this.setLevel(this.level, true);
  }

  update(night: number, vehicles: Vehicle[], own: Vehicle | null): void {
    this.setLevel(Math.round(night * 50) / 50);
    if (this.level <= 0.08) return;
    let fronts = 0, rears = 0, beams = 0;
    const tmp = this.tmp;
    for (let i = -1; i < vehicles.length; i++) {
      const v = i < 0 ? own : vehicles[i];
      if (!v) continue;
      if (beams >= MAX_VEHICLES) break;
      const spec = v.spec;
      const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
      const halfL = spec.length / 2;
      const front = v.arch.frontLights;
      if (front.length) {
        for (const l of front) {
          const w = v.worldPoint(l);
          Matrix.TranslationToRef(w.x, w.y, w.z, tmp);
          tmp.copyToArray(this.frontData, fronts++ * 16);
        }
      } else if (spec.id !== "bicycle") {
        const w = v.worldPoint(new Vector3(0, spec.height * 0.5, halfL));
        Matrix.TranslationToRef(w.x, w.y, w.z, tmp);
        tmp.copyToArray(this.frontData, fronts++ * 16);
      }
      for (const l of v.arch.rearLights) {
        const w = v.worldPoint(l);
        Matrix.TranslationToRef(w.x, w.y, w.z, tmp);
        tmp.copyToArray(this.rearData, rears++ * 16);
      }
      // Beam on the road ahead, scaled to the width of the vehicle.
      const q = Quaternion.FromEulerAngles(0, v.heading, 0);
      const width = Math.max(spec.width * 2.6, 2.2);
      const reach = spec.id === "bicycle" ? 5 : 13;
      Matrix.ComposeToRef(new Vector3(width, 1, reach), q, new Vector3(v.x + sh * halfL * 0.9, v.y + 0.04, v.z + ch * halfL * 0.9), tmp);
      tmp.copyToArray(this.beamData, beams++ * 16);
    }
    this.commit(this.front, fronts);
    this.commit(this.rear, rears);
    this.commit(this.beams, beams);
  }

  private commit(mesh: Mesh, count: number): void {
    mesh.thinInstanceCount = count;
    if (count > 0) mesh.thinInstanceBufferUpdated("matrix");
  }
}

function softTexture(scene: Scene, name: string, paint: (ctx: CanvasRenderingContext2D, size: number) => void): DynamicTexture {
  const size = 128;
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true);
  paint(tex.getContext() as unknown as CanvasRenderingContext2D, size);
  tex.update(true);
  return tex;
}

function additive(scene: Scene, name: string, tex: DynamicTexture, color: Color3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.emissiveTexture = tex;
  m.emissiveColor = Color3.Black();
  m.diffuseColor = color;
  m.specularColor = Color3.Black();
  m.alphaMode = Engine.ALPHA_ADD;
  m.disableDepthWrite = true;
  m.fogEnabled = false;
  m.zOffset = -3;
  m.alpha = 0.5;
  return m;
}
