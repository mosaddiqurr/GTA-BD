import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import type { AudioSystem } from "../audio/audio";
import type { Person, Pedestrians } from "../npc/pedestrians";
import type { Player } from "../player/player";
import type { Anchor } from "../ui/hud";

const FLIGHT = 0.62;
const BACK = 0.5;
const HOLD = 0.32;

interface Pass {
  to: Anchor;
  person: Person | null;
  /** How long the hand has been out for. */
  time: number;
  /** Something comes back the other way once the money's gone over. */
  goods: boolean;
}

/** Money changing hands: the arm goes out, the note crosses over, and what was bought comes back. */
export class HandOver {
  private note: Mesh;
  private parcel: Mesh;
  private pass: Pass | null = null;
  private hand = new Vector3();
  private grabbing = false;

  constructor(scene: Scene, private player: Player, private peds: Pedestrians, private audio: AudioSystem) {
    const paper = new StandardMaterial("noteMat", scene);
    paper.diffuseColor = new Color3(0.62, 0.78, 0.55);
    paper.emissiveColor = new Color3(0.1, 0.14, 0.09);
    paper.specularColor = new Color3(0, 0, 0);
    this.note = MeshBuilder.CreateBox("moneyNote", { width: 0.17, height: 0.012, depth: 0.08 }, scene);
    this.note.material = paper;
    this.note.isPickable = false;
    this.note.setEnabled(false);
    const brown = new StandardMaterial("parcelMat", scene);
    brown.diffuseColor = new Color3(0.62, 0.46, 0.28);
    brown.specularColor = new Color3(0, 0, 0);
    this.parcel = MeshBuilder.CreateBox("goodsParcel", { width: 0.15, height: 0.11, depth: 0.12 }, scene);
    this.parcel.material = brown;
    this.parcel.isPickable = false;
    this.parcel.setEnabled(false);
  }

  /** Pays someone. `person` is set if they're on foot, so they can reach out for it too. */
  give(to: Anchor, person: Person | null): void {
    if (this.pass) this.finish();
    this.pass = { to, person, time: 0, goods: false };
    if (person) this.peds.talkPose(person, "reach");
    this.audio.cash();
  }

  /** What was paid for comes back across. */
  goodsBack(): void {
    if (this.pass) this.pass.goods = true;
  }

  private finish(): void {
    this.note.setEnabled(false);
    this.parcel.setEnabled(false);
    const c = this.player.character;
    if (c && this.grabbing) c.grasp = null;
    this.grabbing = false;
    this.pass = null;
  }

  update(dt: number): void {
    const p = this.pass;
    if (!p) return;
    p.time += dt;
    const c = this.player.character;
    if (!c) {
      this.finish();
      return;
    }
    const tx = p.to.x, tz = p.to.z;
    // Their hand, about chest high, and for someone sitting in a vehicle just where they are.
    const ty = p.to.y + (p.person ? 1.02 : 0.1);
    // The hero's arm goes out to meet it, between the two of them.
    if (!c.grasp || this.grabbing) {
      const mx = this.player.x + (tx - this.player.x) * 0.55, mz = this.player.z + (tz - this.player.z) * 0.55;
      c.grasp = { side: -1, x: mx, y: this.player.y + 1.02, z: mz };
      this.grabbing = true;
    }
    c.handPosition(-1, this.hand);
    const goods = p.goods ? BACK : 0;
    if (p.time < HOLD) {
      this.note.setEnabled(false);
      return;
    }
    const t = p.time - HOLD;
    if (t < FLIGHT) {
      this.fly(this.note, this.hand.x, this.hand.y, this.hand.z, tx, ty, tz, t / FLIGHT);
      return;
    }
    this.note.setEnabled(false);
    if (t < FLIGHT + goods) {
      this.fly(this.parcel, tx, ty, tz, this.hand.x, this.hand.y, this.hand.z, (t - FLIGHT) / BACK);
      return;
    }
    this.finish();
  }

  private fly(m: Mesh, ax: number, ay: number, az: number, bx: number, by: number, bz: number, f: number): void {
    const s = f * f * (3 - 2 * f);
    m.setEnabled(true);
    m.position.set(ax + (bx - ax) * s, ay + (by - ay) * s + Math.sin(f * Math.PI) * 0.1, az + (bz - az) * s);
    m.rotation.y = Math.atan2(bx - ax, bz - az);
  }
}
