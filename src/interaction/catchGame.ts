import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial } from "@babylonjs/core";
import { bn, bnNum } from "../localization/bn";
import type { Player } from "../player/player";
import type { Hud } from "../ui/hud";
import type { City } from "../world/city";
import type { Interactions } from "./interactions";

const BALLS = 6;
const AIR_TIME = 2.5;
const CATCH_REACH = 1.7;
const REACH_FIELD = 16;

/** A child on the cricket pitch: the big boys hit it up in the air, and you run under it. Six balls. */
export class CatchGame {
  private ball: Mesh | null = null;
  private mark: Mesh | null = null;
  private on = false;
  private left = 0;
  private caught = 0;
  private t = 0;
  private wait = 0;
  private fromX = 0;
  private fromZ = 0;
  private toX = 0;
  private toZ = 0;
  private height = 12;

  constructor(private scene: Scene, private city: City, private player: Player, private hud: Hud, interactions: Interactions, allowed: boolean) {
    if (!allowed) return;
    interactions.add((x, z, _yaw, driving, out) => {
      if (driving || this.on) return;
      for (const f of city.parks) {
        if (Math.abs(f.pitchX - x) > REACH_FIELD || Math.abs(f.pitchZ - z) > REACH_FIELD) continue;
        out.push({ key: "KeyE", html: bn.cricketGame.prompt, priority: 40, run: () => this.start(f.pitchX, f.pitchZ) });
        return;
      }
    });
  }

  private start(x: number, z: number): void {
    if (!this.ball) {
      this.ball = MeshBuilder.CreateSphere("catchBall", { diameter: 0.14, segments: 8 }, this.scene);
      const red = new StandardMaterial("catchBallMat", this.scene);
      red.diffuseColor = new Color3(0.72, 0.1, 0.1);
      this.ball.material = red;
      this.mark = MeshBuilder.CreateDisc("catchMark", { radius: CATCH_REACH, tessellation: 24 }, this.scene);
      this.mark.rotation.x = Math.PI / 2;
      const gold = new StandardMaterial("catchMarkMat", this.scene);
      gold.disableLighting = true;
      gold.emissiveColor = new Color3(1, 0.72, 0.2);
      gold.alpha = 0.38;
      this.mark.material = gold;
    }
    this.on = true;
    this.left = BALLS;
    this.caught = 0;
    this.fromX = x;
    this.fromZ = z;
    this.wait = 1.2;
    this.hud.say(bn.cricketGame.start, 3.4);
    this.show(false);
  }

  private show(v: boolean): void {
    this.ball?.setEnabled(v);
    this.mark?.setEnabled(v);
  }

  private hit(): void {
    const a = Math.random() * Math.PI * 2, d = 9 + Math.random() * 9;
    this.toX = this.fromX + Math.cos(a) * d;
    this.toZ = this.fromZ + Math.sin(a) * d;
    this.height = 9 + Math.random() * 5;
    this.t = 0;
    this.show(true);
    this.mark!.position.set(this.toX, this.city.layout.groundHeight(this.toX, this.toZ) + 0.06, this.toZ);
  }

  update(dt: number): void {
    if (!this.on) return;
    if (Math.hypot(this.player.x - this.fromX, this.player.z - this.fromZ) > 40 || this.player.vehicle) {
      this.on = false;
      this.show(false);
      return;
    }
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait <= 0) {
        if (this.left <= 0) {
          this.on = false;
          this.show(false);
          this.hud.say(bn.cricketGame.score(bnNum(this.caught), bnNum(BALLS)), 4);
          return;
        }
        this.left--;
        this.hit();
      }
      return;
    }
    this.t += dt / AIR_TIME;
    const k = Math.min(this.t, 1);
    this.ball!.position.set(this.fromX + (this.toX - this.fromX) * k, 0.9 + Math.sin(k * Math.PI) * this.height, this.fromZ + (this.toZ - this.fromZ) * k);
    if (k >= 1) {
      const got = Math.hypot(this.player.x - this.toX, this.player.z - this.toZ) < CATCH_REACH;
      if (got) this.caught++;
      this.hud.say(got ? bn.cricketGame.caught : bn.cricketGame.dropped, 1.4);
      this.show(false);
      this.wait = 1.3;
    }
  }
}
