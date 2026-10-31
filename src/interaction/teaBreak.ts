import { Color3, Mesh, MeshBuilder, PBRMaterial, Scene, Vector3 } from "@babylonjs/core";
import { bn, bnNum } from "../localization/bn";
import type { Pedestrians, Person, TeaSeat } from "../npc/pedestrians";
import type { Input } from "../player/input";
import type { Player } from "../player/player";
import type { Anchor, Hud } from "../ui/hud";
import type { StallSpot } from "../world/city";
import type { Talk } from "./talk";

const SERVE_SECONDS = 2.6;
const HURRY = 3.5;
const HERO_SEATED_TOP = 1.2;

/** A glass of tea and something to eat with it. Small, and only ever seen in the hero's hands. */
class TeaProps {
  private glass: Mesh;
  private liquid: Mesh;
  private milk: PBRMaterial;
  private red: PBRMaterial;
  private biscuit: Mesh;
  private singara: Mesh;
  private snack: Mesh | null = null;
  private at = new Vector3();

  constructor(scene: Scene) {
    const pbr = (name: string, color: Color3, rough: number): PBRMaterial => {
      const m = new PBRMaterial(name, scene);
      m.albedoColor = color;
      m.roughness = rough;
      m.metallic = 0;
      return m;
    };
    const glassMat = pbr("teaGlass", new Color3(0.9, 0.93, 0.92), 0.08);
    glassMat.alpha = 0.32;
    this.milk = pbr("teaMilk", new Color3(0.55, 0.32, 0.15), 0.25);
    this.red = pbr("teaRed", new Color3(0.3, 0.09, 0.03), 0.18);
    const hidden = (m: Mesh, mat: PBRMaterial): Mesh => {
      m.material = mat;
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true;
      m.setEnabled(false);
      return m;
    };
    this.glass = hidden(MeshBuilder.CreateCylinder("teaGlass", { height: 0.12, diameterTop: 0.092, diameterBottom: 0.07, tessellation: 14 }, scene), glassMat);
    this.liquid = hidden(MeshBuilder.CreateCylinder("teaLiquid", { height: 0.09, diameterTop: 0.078, diameterBottom: 0.064, tessellation: 12 }, scene), this.milk);
    this.biscuit = hidden(MeshBuilder.CreateCylinder("teaBiscuit", { height: 0.016, diameter: 0.1, tessellation: 12 }, scene), pbr("teaBiscuitMat", new Color3(0.72, 0.48, 0.2), 0.8));
    this.singara = hidden(MeshBuilder.CreatePolyhedron("teaSingara", { type: 0, size: 0.05 }, scene), pbr("teaSingaraMat", new Color3(0.68, 0.4, 0.1), 0.65));
  }

  show(order: string): void {
    this.glass.setEnabled(true);
    this.liquid.setEnabled(true);
    this.liquid.material = order === "red" ? this.red : this.milk;
    this.snack = order === "biscuit" ? this.biscuit : order === "singara" ? this.singara : null;
    this.snack?.setEnabled(true);
  }

  hide(): void {
    for (const m of [this.glass, this.liquid, this.biscuit, this.singara]) m.setEnabled(false);
    this.snack = null;
  }

  /** Keeps the glass upright in one hand and the snack in the other. `left` runs from 1 to 0. */
  update(player: Player, left: number): void {
    const c = player.character;
    if (!c) return;
    const yaw = c.root.rotation.y;
    const fx = Math.sin(yaw) * 0.045, fz = Math.cos(yaw) * 0.045;
    c.handPosition(-1, this.at);
    this.glass.position.set(this.at.x + fx, this.at.y + 0.03, this.at.z + fz);
    const level = 0.12 + 0.88 * left;
    this.liquid.scaling.y = level;
    this.liquid.position.set(this.glass.position.x, this.glass.position.y - 0.012 - 0.045 * (1 - level), this.glass.position.z);
    // Tips towards the face for a sip.
    const tip = -0.7 * c.sipLift;
    this.glass.rotation.set(tip, yaw, 0);
    this.liquid.rotation.set(tip, yaw, 0);
    if (this.snack) {
      c.handPosition(1, this.at);
      this.snack.position.set(this.at.x + fx, this.at.y + 0.03, this.at.z + fz);
      this.snack.scaling.setAll(Math.max(0.05, Math.min(1, left * 1.6)));
    }
  }
}

/** Sitting down at a tea stall: order, wait, drink against a clock, and in the meantime talk to the
 *  person alongside or the man behind the counter, or hurry up and go. */
export class TeaBreak {
  private phase: "off" | "sitting" | "waiting" | "drinking" | "afterTalk" | "leaving" = "off";
  private props: TeaProps;
  private stall: StallSpot | null = null;
  private vendor: Person | null = null;
  private neighbour: Person | null = null;
  private seat: TeaSeat | null = null;
  private order = "milk";
  private time = 0;
  private total = 20;
  private speed = 1;
  private menuOn = false;

  constructor(scene: Scene, private hud: Hud, private input: Input, private player: Player, private peds: Pedestrians, private talk: Talk, private line: (text: string, anchor: Anchor, id: string, top: number) => void) {
    this.props = new TeaProps(scene);
    // A conversation borrows the menu, and it comes back afterwards.
    talk.onClosed = () => {
      if (this.phase === "drinking") this.showMenu();
    };
  }

  get active(): boolean {
    return this.phase !== "off";
  }

  begin(order: string, stall: StallSpot): void {
    const seat = this.peds.freeSeat(stall, this.player.x, this.player.z);
    if (!seat) return;
    seat.who = "hero";
    this.seat = seat;
    this.stall = stall;
    this.vendor = this.peds.vendorOf(stall);
    this.neighbour = this.peds.neighbourOf(stall, seat);
    this.order = order;
    this.time = 0;
    this.speed = 1;
    this.total = bn.tea.menu.find((m) => m.key === order)?.seconds ?? 20;
    this.phase = "sitting";
    this.player.sitAt(seat, () => {
      this.phase = "waiting";
      this.time = 0;
      this.hud.showActivity(bn.tea.waiting);
    });
  }

  private showMenu(): void {
    const items: { text: string; dim?: boolean }[] = [];
    if (this.neighbour) items.push({ text: bn.tea.talkNeighbour });
    if (this.vendor) items.push({ text: bn.tea.talkVendor });
    items.push({ text: this.speed > 1 ? bn.tea.hurrying : bn.tea.hurry, dim: this.speed > 1 });
    items.push({ text: bn.tea.leave });
    this.hud.showChoices(items);
    this.menuOn = true;
  }

  private choose(i: number): void {
    const first = this.neighbour ? 1 : 0;
    const second = first + (this.vendor ? 1 : 0);
    this.hud.hideChoices();
    this.menuOn = false;
    if (this.neighbour && i === 0) this.talk.benchTalk(this.neighbour);
    else if (this.vendor && i === first) this.talk.talkTo(this.vendor, true);
    else if (i === second) {
      this.speed = HURRY;
      this.showMenu();
    } else this.leave(false);
  }

  private leave(finished: boolean): void {
    if (this.phase === "leaving" || this.phase === "off") return;
    this.phase = "leaving";
    this.menuOn = false;
    this.hud.hideChoices();
    this.hud.hideActivity();
    this.props.hide();
    this.player.sipping(false);
    this.line(finished ? bn.tea.done : bn.tea.leftEarly, this.player, "hero_mango", HERO_SEATED_TOP);
    const vendor = this.vendor;
    if (finished && vendor) setTimeout(() => this.line(bn.tea.bill, vendor, vendor.id, 1.72), 1700);
    this.player.standUp(() => {
      if (this.seat) this.seat.who = null;
      this.seat = null;
      this.phase = "off";
    });
  }

  /** Ends at once, for a respawn or anything else that can't wait. */
  stop(): void {
    if (this.phase === "off") return;
    this.hud.hideChoices();
    this.hud.hideActivity();
    this.props.hide();
    this.player.sipping(false);
    if (this.seat) this.seat.who = null;
    this.seat = null;
    this.menuOn = false;
    this.phase = "off";
  }

  update(dt: number): void {
    const input = this.input;
    switch (this.phase) {
      case "waiting": {
        this.time += dt;
        this.hud.setActivity(Math.min(this.time / SERVE_SECONDS, 1), "");
        if (this.time >= SERVE_SECONDS) {
          this.phase = "drinking";
          this.time = 0;
          this.hud.showActivity(bn.tea.drinking[this.order]);
          this.props.show(this.order);
          this.player.sipping(true);
          const vendor = this.vendor;
          if (vendor) this.line(bn.tea.serve, vendor, vendor.id, 1.72);
          this.showMenu();
        }
        break;
      }
      case "drinking": {
        this.time += dt * this.speed;
        const left = Math.max(0, 1 - this.time / this.total);
        this.hud.setActivity(1 - left, bn.tea.left(bnNum(Math.ceil((this.total - this.time) / this.speed))));
        this.props.update(this.player, left);
        if (left <= 0) {
          this.menuOn = false;
          if (this.talk.active) {
            // The tea's gone, but it would be rude to walk off mid-sentence.
            this.phase = "afterTalk";
            this.hud.hideActivity();
            this.props.hide();
            this.player.sipping(false);
          } else this.leave(true);
          break;
        }
        if (this.talk.active || !this.menuOn) break;
        const i = this.hud.readChoice(dt, (c) => input.pressed(c), input.wheel, input.clicked);
        if (i >= 0) this.choose(i);
        else if (input.isDown("KeyW", "KeyA", "KeyS", "KeyD")) this.leave(false);
        break;
      }
      case "afterTalk":
        if (!this.talk.active) this.leave(true);
        break;
    }
  }
}
