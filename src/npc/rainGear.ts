import { Color3, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import type { Person } from "./pedestrians";

const MAX = 140;
const REACH = 58;
const COLOURS: [number, number, number][] = [[0.08, 0.08, 0.1], [0.08, 0.08, 0.1], [0.55, 0.1, 0.14], [0.1, 0.22, 0.48], [0.1, 0.36, 0.22], [0.6, 0.42, 0.08]];
const COATS: [number, number, number][] = [[0.82, 0.68, 0.1], [0.1, 0.26, 0.58], [0.22, 0.32, 0.26], [0.7, 0.16, 0.14]];
// Where the hand holding the umbrella is in the "walk_u" pose, and how far above it the canopy sits.
const HAND_OUT = 0.28;
const HAND_FORWARD = 0.12;
const GRIP = 0.72;
// The shorter bodies, from tools/blender/build_characters.py. Everyone else is about the same height.
const USUAL_HEIGHT = 1.42;
const HEIGHT: Record<string, number> = { npc_kid_berry: 1.02, npc_girl_pear: 1.12, npc_granny_fig: 1.24, npc_commuter_lychee: 1.26, npc_elder_date: 1.3, npc_student_lemon: 1.32 };

export type RainWearer = Pick<Person, "id" | "x" | "y" | "z" | "yaw" | "offset" | "rainHabit" | "size">;

/** Umbrellas over heads and raincoats over clothes, drawn for whoever's near. Nobody has to own one:
 *  they're laid over the crowd each frame, and only while it's raining. */
export class RainGear {
  private canopy: Mesh;
  private coat: Mesh;
  private cm = new Float32Array(MAX * 16);
  private cc = new Float32Array(MAX * 4);
  private km = new Float32Array(MAX * 16);
  private kc = new Float32Array(MAX * 4);
  private nC = 0;
  private nK = 0;
  private camX = 0;
  private camZ = 0;

  constructor(scene: Scene) {
    const mat = (name: string): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = new Color3(1, 1, 1);
      m.specularColor = new Color3(0.2, 0.2, 0.2);
      return m;
    };
    const part = MeshBuilder.CreateCylinder("umbrellaTop", { height: 0.26, diameterTop: 0.04, diameterBottom: 1.04, tessellation: 9 }, scene);
    // Long enough to come down to the hand, which grips it GRIP below the canopy.
    const stick = MeshBuilder.CreateCylinder("umbrellaStick", { height: 0.8, diameter: 0.024, tessellation: 5 }, scene);
    stick.position.y = -0.48;
    stick.bakeCurrentTransformIntoVertices();
    this.canopy = Mesh.MergeMeshes([part, stick], true, true) as Mesh;
    this.canopy.name = "umbrellas";
    this.canopy.material = mat("umbrellaMat");
    // A poncho turned on a lathe: from the hem up over the arms and shoulders to the neck.
    const coatShape = [[0.41, 0.26], [0.37, 0.42], [0.35, 0.6], [0.37, 0.72], [0.3, 0.79], [0.2, 0.84], [0.15, 0.88]].map(([r, y]) => new Vector3(r, y, 0));
    this.coat = MeshBuilder.CreateLathe("raincoats", { shape: coatShape, tessellation: 12, sideOrientation: Mesh.DOUBLESIDE }, scene);
    this.coat.material = mat("coatMat");
    this.coat.material.backFaceCulling = false;
    for (const [m, data, colour] of [[this.canopy, this.cm, this.cc], [this.coat, this.km, this.kc]] as [Mesh, Float32Array, Float32Array][]) {
      m.thinInstanceSetBuffer("matrix", data, 16, false);
      m.thinInstanceSetBuffer("color", colour, 4, false);
      m.thinInstanceCount = 0;
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true;
      m.setEnabled(false);
    }
  }

  setCamera(x: number, z: number): void {
    this.camX = x;
    this.camZ = z;
  }

  begin(): void {
    this.nC = this.nK = 0;
  }

  /** After everyone's been added, so nothing trails a frame behind the person wearing it. */
  end(): void {
    for (const [m, n] of [[this.canopy, this.nC], [this.coat, this.nK]] as [Mesh, number][]) {
      m.thinInstanceCount = n;
      if (n) {
        m.thinInstanceBufferUpdated("matrix");
        m.thinInstanceBufferUpdated("color");
      }
      const on = n > 0;
      if (m.isEnabled() !== on) m.setEnabled(on);
    }
  }

  /** `hand` is where the holding hand really is, for a full model. The crowd's pose has it in a known place. */
  add(a: RainWearer, hand?: Vector3): void {
    if (Math.abs(a.x - this.camX) > REACH || Math.abs(a.z - this.camZ) > REACH) return;
    const k = ((a.size ?? 1) * (HEIGHT[a.id] ?? USUAL_HEIGHT)) / USUAL_HEIGHT;
    const pick = Math.floor(a.offset * 97);
    if (a.rainHabit === 1) {
      if (this.nC >= MAX) return;
      // Held in the right hand, so that's where the stick comes down.
      const cs = Math.cos(a.yaw), sn = Math.sin(a.yaw);
      if (hand) HERE.set(hand.x, hand.y + GRIP, hand.z);
      else HERE.set(a.x + (cs * HAND_OUT + sn * HAND_FORWARD) * k, a.y + 1.88 * k, a.z + (cs * HAND_FORWARD - sn * HAND_OUT) * k);
      Matrix.ComposeToRef(UNIT, IDENT, HERE, TMP);
      TMP.copyToArray(this.cm, this.nC * 16);
      const c = COLOURS[pick % COLOURS.length];
      this.cc.set([c[0], c[1], c[2], 1], this.nC * 4);
      this.nC++;
    } else {
      if (this.nK >= MAX) return;
      Matrix.ComposeToRef(HERE2.set(k, k, k), IDENT, HERE.set(a.x, a.y, a.z), TMP);
      TMP.copyToArray(this.km, this.nK * 16);
      const c = COATS[pick % COATS.length];
      this.kc.set([c[0], c[1], c[2], 1], this.nK * 4);
      this.nK++;
    }
  }
}

const UNIT = Vector3.One();
const IDENT = Quaternion.Identity();
const HERE = new Vector3();
const HERE2 = new Vector3();
const TMP = new Matrix();
