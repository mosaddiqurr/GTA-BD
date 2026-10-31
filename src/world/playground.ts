import { Color3, Mesh, MeshBuilder, PBRMaterial, Scene } from "@babylonjs/core";
import { CharacterId, characterAvailable } from "../characters/character";
import { bn } from "../localization/bn";
import type { Pedestrians, Person } from "../npc/pedestrians";
import { KERB_H } from "./cityLayout";

const BOY = 0.72;
const ACTIVE = 130;
const BALL_R = 0.1;
const RUN = 3.6;
const G = 9.8;

export interface Field {
  /** Where the cricket pitch and the football field lie. */
  pitchX: number;
  pitchZ: number;
  goalX: number;
  goalZ: number;
  halfLength: number;
  halfWidth: number;
}

type Say = (text: string, who: Person) => void;

interface Boy {
  who: Person;
  homeX: number;
  homeZ: number;
}

/** Boys playing cricket at one end of the ground and football at the other. It all runs by itself,
 *  and only while the hero is close enough to see it. The ball moves for real, and on the football
 *  side the hero can give it a kick. */
export class Playground {
  private ball: Mesh;
  private foot: Mesh;
  private bat: Mesh;
  // Cricket.
  private bowler: Person | null = null;
  private batter: Person | null = null;
  private keeper: Person | null = null;
  private fielders: Boy[] = [];
  private cState: "runup" | "bowl" | "flight" | "hit" | "fetch" | "throw" = "runup";
  private cTime = 0;
  private bx = 0;
  private by = 0;
  private bz = 0;
  private fromX = 0;
  private fromZ = 0;
  private toX = 0;
  private toZ = 0;
  private flightTime = 1;
  private flightUp = 0;
  private chasing: Boy | null = null;
  // Football.
  private team: Boy[] = [];
  private fx = 0;
  private fz = 0;
  private fvx = 0;
  private fvz = 0;
  private fy = 0;
  private fvy = 0;
  private spin = 0;
  private talkCool = 4;

  constructor(scene: Scene, peds: Pedestrians, private field: Field, private say: Say) {
    const ids = (["npc_student_lemon", "npc_commuter_lychee", "npc_student_lemon", "npc_tea_banana", "npc_office_orange"] as CharacterId[]).filter(characterAvailable);
    const mat = new PBRMaterial("playBall", scene);
    mat.albedoColor = new Color3(0.72, 0.1, 0.08);
    mat.metallic = 0;
    mat.roughness = 0.45;
    this.ball = MeshBuilder.CreateSphere("cricketBall", { diameter: BALL_R * 2.4, segments: 8 }, scene);
    this.ball.material = mat;
    this.ball.isPickable = false;
    const white = new PBRMaterial("playFootball", scene);
    white.albedoColor = new Color3(0.9, 0.9, 0.86);
    white.metallic = 0;
    white.roughness = 0.5;
    this.foot = MeshBuilder.CreateSphere("football", { diameter: 0.36, segments: 8 }, scene);
    this.foot.material = white;
    this.foot.isPickable = false;
    const wood = new PBRMaterial("playBat", scene);
    wood.albedoColor = new Color3(0.72, 0.54, 0.3);
    wood.metallic = 0;
    wood.roughness = 0.7;
    this.bat = MeshBuilder.CreateBox("cricketBat", { width: 0.08, height: 0.72, depth: 0.03 }, scene);
    this.bat.material = wood;
    this.bat.isPickable = false;
    if (!ids.length) return;
    const boy = (i: number, x: number, z: number, pose: Person["pose"] = "stand"): Person => {
      const who = peds.addStanding(ids[i % ids.length], pose);
      who.x = x;
      who.y = KERB_H;
      who.z = z;
      who.size = BOY + (i % 3) * 0.03;
      return who;
    };
    const { pitchX: px, pitchZ: pz } = field;
    this.bowler = boy(0, px, pz - 15);
    this.batter = boy(1, px, pz + 9.5, "bat");
    this.batter.yaw = Math.PI;
    this.keeper = boy(2, px, pz + 12, "crouch");
    this.keeper.yaw = Math.PI;
    const spots: [number, number][] = [[-14, 4], [14, 6], [-18, -6], [17, -8], [-9, 16], [9, 18], [0, -24]];
    spots.forEach(([dx, dz], i) => {
      const who = boy(i + 3, px + dx, pz + dz, "idle_look");
      who.yaw = Math.atan2(px - who.x, pz - who.z);
      this.fielders.push({ who, homeX: who.x, homeZ: who.z });
    });
    this.bx = px;
    this.bz = pz - 9;
    this.by = KERB_H + 0.9;
    // Football: five a side, spread over the field either side of the middle.
    const { goalX: gx, goalZ: gz, halfLength: L, halfWidth: W } = field;
    for (let i = 0; i < 10; i++) {
      const side = i < 5 ? -1 : 1;
      const row = (i % 5) / 4 - 0.5;
      const depth = i % 5 === 0 ? 0.82 : i % 5 === 4 ? 0.2 : 0.5;
      const who = boy(i + 10, gx + side * L * depth, gz + row * W * 1.5, "stand");
      who.outfit = side < 0 ? 1 : 2;
      this.team.push({ who, homeX: who.x, homeZ: who.z });
    }
    this.fx = gx;
    this.fz = gz;
  }

  private face(a: Person, x: number, z: number): void {
    a.yaw = Math.atan2(x - a.x, z - a.z);
  }

  private runTo(b: Boy | Person, x: number, z: number, dt: number, speed = RUN): boolean {
    const a = "who" in b ? b.who : b;
    const dx = x - a.x, dz = z - a.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.35) {
      a.speed = 0;
      if (a.pose === "run" || a.pose === "walk") a.pose = "stand";
      return true;
    }
    const step = Math.min(speed * dt, d);
    a.x += (dx / d) * step;
    a.z += (dz / d) * step;
    a.yaw = Math.atan2(dx, dz);
    a.speed = speed;
    a.pose = speed > 2.4 ? "run" : "walk";
    return false;
  }

  /** Sends the ball along an arc to a point on the ground. */
  private throwBall(fromX: number, fromZ: number, toX: number, toZ: number, time: number, up: number): void {
    this.fromX = fromX;
    this.fromZ = fromZ;
    this.toX = toX;
    this.toZ = toZ;
    this.flightTime = time;
    this.flightUp = up;
    this.cTime = 0;
  }

  private stepFlight(dt: number): boolean {
    this.cTime += dt;
    const t = Math.min(this.cTime / this.flightTime, 1);
    this.bx = this.fromX + (this.toX - this.fromX) * t;
    this.bz = this.fromZ + (this.toZ - this.fromZ) * t;
    this.by = KERB_H + BALL_R + Math.max(0, 0.9 * (1 - t) + 4 * t * (1 - t) * this.flightUp);
    return t >= 1;
  }

  private cricket(dt: number): void {
    const bowler = this.bowler, batter = this.batter;
    if (!bowler || !batter) return;
    const { pitchX: px, pitchZ: pz } = this.field;
    const creaseZ = pz - 9;
    this.cTime += dt;
    switch (this.cState) {
      case "runup": {
        const there = this.runTo(bowler, px, creaseZ, dt, 3.8);
        this.bx = bowler.x + 0.2;
        this.bz = bowler.z;
        this.by = KERB_H + 0.75;
        if (there) {
          this.cState = "bowl";
          bowler.pose = "bowl";
          bowler.speed = 0;
          this.face(bowler, px, pz + 9.5);
          this.cTime = 0;
        }
        break;
      }
      case "bowl": {
        const k = Math.min(this.cTime / 0.5, 1);
        this.by = KERB_H + 0.8 + k * 0.5;
        if (this.cTime > 0.5) {
          this.throwBall(px + 0.1, creaseZ, px + 0.1, pz + 9.5, 0.75, 0.15);
          this.cState = "flight";
        }
        break;
      }
      case "flight":
        if (this.stepFlight(dt)) {
          bowler.pose = "stand";
          // Most are hit away. Now and then it beats the bat, and the keeper has it.
          if (Math.random() < 0.28) {
            this.throwBall(this.bx, this.bz, px, pz + 12, 0.3, 0.1);
            this.chasing = null;
            this.cState = "throw";
            if (this.talkCool <= 0 && Math.random() < 0.6) this.shout(bn.playground.missed, this.keeper!);
          } else {
            const f = this.fielders[Math.floor(Math.random() * this.fielders.length)];
            this.chasing = f;
            const big = Math.random() < 0.25;
            const tx = f.homeX + (Math.random() - 0.5) * 8, tz = f.homeZ + (Math.random() - 0.5) * 8;
            this.throwBall(this.bx, this.bz, tx, tz, big ? 2.2 : 1.4, big ? 5 : 1.4);
            this.cState = "hit";
            batter.pose = "bat";
            this.swing = 0.5;
            if (this.talkCool <= 0) this.shout(big ? bn.playground.six : bn.playground.run, batter);
          }
        }
        break;
      case "hit":
        this.stepFlight(dt);
        if (this.chasing) this.runTo(this.chasing, this.toX, this.toZ, dt);
        if (this.cTime >= this.flightTime) this.cState = "fetch";
        break;
      case "fetch":
        if (!this.chasing || this.runTo(this.chasing, this.bx, this.bz, dt)) {
          const f = this.chasing;
          if (f) {
            f.who.pose = "bowl";
            this.throwBall(f.who.x, f.who.z, px, pz - 15, 1.1, 1.5);
          }
          this.cState = "throw";
        }
        break;
      case "throw":
        if (this.stepFlight(dt)) {
          this.cState = "runup";
          this.cTime = 0;
          // Back to the top of the run-up, and everyone to their places.
          bowler.x = px;
          bowler.z = pz - 22;
          bowler.pose = "walk";
        }
        break;
    }
    // Fielders who aren't after the ball walk back to where they belong.
    for (const f of this.fielders) {
      if (f === this.chasing && this.cState !== "runup") continue;
      if (this.runTo(f, f.homeX, f.homeZ, dt, 2)) {
        f.who.pose = "idle_look";
        this.face(f.who, px, pz);
      }
    }
    if (this.swing > 0) {
      this.swing -= dt;
      if (this.swing <= 0) batter.pose = "stand";
    }
    this.ball.position.set(this.bx, this.by, this.bz);
    // The bat in the batter's hands: down by his side, and round through the swing.
    const sw = this.swing > 0 ? (0.5 - this.swing) / 0.5 : 0;
    this.bat.position.set(batter.x + 0.1, batter.y + 0.46, batter.z - 0.22 - sw * 0.1);
    this.bat.rotation.set(0.6 - sw * 2.3, 0, 0);
  }

  private swing = 0;

  private football(dt: number, px: number, pz: number, heroMoving: boolean): void {
    const { goalX: gx, goalZ: gz, halfLength: L, halfWidth: W } = this.field;
    // Rolls, bounces a little, and slows on the rough ground.
    this.fx += this.fvx * dt;
    this.fz += this.fvz * dt;
    this.fvy -= G * dt;
    this.fy += this.fvy * dt;
    if (this.fy <= 0) {
      this.fy = 0;
      this.fvy = Math.abs(this.fvy) > 1 ? -this.fvy * 0.45 : 0;
    }
    const drag = Math.exp(-dt * 0.7);
    this.fvx *= drag;
    this.fvz *= drag;
    if (Math.abs(this.fz - gz) > W) {
      this.fz = gz + Math.sign(this.fz - gz) * W;
      this.fvz *= -0.5;
    }
    if (Math.abs(this.fx - gx) > L) {
      // Between the posts, and it's a goal. Either way it comes back to the middle.
      const inGoal = Math.abs(this.fz - gz) < 3.6;
      if (inGoal && this.talkCool <= 0) {
        const scorer = this.team[Math.floor(Math.random() * this.team.length)].who;
        this.shout(bn.playground.goal, scorer);
        scorer.pose = "cheer";
      }
      this.fx = gx;
      this.fz = gz + (Math.random() - 0.5) * 4;
      this.fvx = this.fvz = 0;
    }
    // The hero can have a go at it too.
    const hd = Math.hypot(this.fx - px, this.fz - pz);
    if (heroMoving && hd < 0.7) {
      const k = 8 / Math.max(hd, 0.1);
      this.fvx = (this.fx - px) * k;
      this.fvz = (this.fz - pz) * k;
      this.fvy = 2.5;
    }
    // Whoever is nearest goes for it; the rest keep to their part of the field.
    let near = this.team[0], bd = Infinity;
    for (const b of this.team) {
      const d = Math.hypot(b.who.x - this.fx, b.who.z - this.fz);
      if (d < bd) {
        bd = d;
        near = b;
      }
    }
    for (const b of this.team) {
      if (b === near) {
        if (this.runTo(b, this.fx, this.fz, dt) || bd < 0.6) {
          // Kicks it on towards the far goal.
          const side = this.team.indexOf(b) < 5 ? 1 : -1;
          const tx = gx + side * (L + 2), tz = gz + (Math.random() - 0.5) * W;
          const dx = tx - this.fx, dz = tz - this.fz;
          const l = Math.hypot(dx, dz) || 1;
          const power = 7 + Math.random() * 6;
          this.fvx = (dx / l) * power;
          this.fvz = (dz / l) * power;
          this.fvy = Math.random() < 0.3 ? 3 : 0.5;
          b.who.pose = "kick";
          b.who.speed = 0;
          if (this.talkCool <= 0 && Math.random() < 0.3) this.shout(bn.playground.pass, b.who);
        }
      } else {
        const hx = b.homeX + (this.fx - gx) * 0.35, hz = b.homeZ + (this.fz - gz) * 0.35;
        if (this.runTo(b, hx, hz, dt, Math.hypot(hx - b.who.x, hz - b.who.z) > 4 ? RUN * 0.8 : 1.6)) {
          b.who.pose = "stand";
          this.face(b.who, this.fx, this.fz);
        }
      }
    }
    this.spin += Math.hypot(this.fvx, this.fvz) * dt * 5;
    this.foot.position.set(this.fx, KERB_H + 0.18 + this.fy, this.fz);
    this.foot.rotation.x = this.spin;
  }

  private shout(text: string, who: Person): void {
    this.talkCool = 7 + Math.random() * 7;
    this.say(text, who);
  }

  update(dt: number, px: number, pz: number, heroMoving: boolean): void {
    const f = this.field;
    const near = Math.hypot(f.goalX - px, f.goalZ - pz) < ACTIVE || Math.hypot(f.pitchX - px, f.pitchZ - pz) < ACTIVE;
    this.ball.setEnabled(near);
    this.foot.setEnabled(near);
    this.bat.setEnabled(near);
    if (!near) return;
    this.talkCool -= dt;
    this.cricket(dt);
    this.football(dt, px, pz, heroMoving);
  }
}
