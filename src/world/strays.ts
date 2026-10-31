import { Matrix, Quaternion, Vector3 } from "@babylonjs/core";
import type { Vehicle } from "../vehicles/vehicle";
import type { City } from "./city";
import { Rng } from "./cityLayout";

const DOGS = 14;
const CROWS = 30;
const RANGE = 70;
const HERE = new Vector3();
const UNIT = Vector3.One();
const UP = Vector3.Up();
const Q = new Quaternion();
const M = new Matrix();

interface Stray {
  index: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Which way and how fast it's going, and what it's up to. */
  speed: number;
  goal: number;
  rest: number;
  /** A crow's height off the ground while it's up, and how fast that's changing. */
  fly: number;
  phase: number;
  lying?: boolean;
}

/** The ones who really own the street: dogs asleep in the shade who get up and trot off when something
 *  comes near, and crows on the ground who go up when disturbed and come down again a little further on.
 *  Nothing ever touches them. There's a small group, and it follows the hero about. */
export class Strays {
  private dogs: Stray[] = [];
  private crows: Stray[] = [];
  private rng = new Rng(77);
  private ready = false;

  constructor(private city: City) {
    const r = this.rng;
    const make = (id: "dog" | "crow", n: number, list: Stray[]): void => {
      if (!city.props.has(id)) return;
      for (let i = 0; i < n; i++) {
        const index = city.props.place(id, 1e5, 0, 1e5, 0);
        list.push({ index, x: 1e5, y: 0, z: 1e5, yaw: r.range(0, 6.28), speed: 0, goal: 0, rest: r.range(0, 6), fly: 0, phase: r.next() * 6.28 });
      }
      this.ready = true;
    };
    make("dog", DOGS, this.dogs);
    make("crow", CROWS, this.crows);
  }

  /** Somewhere on a footpath near this point, in view or not: they're there already when you turn round. */
  private settle(s: Stray, px: number, pz: number): void {
    const r = this.rng;
    for (let k = 0; k < 8; k++) {
      const a = r.range(0, 6.28), d = r.range(26, RANGE - 6);
      const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      const b = this.city.layout.blockAt(x, z);
      if (!b) continue;
      // On the footpath: within a few steps of the road.
      const edge = Math.min(x - b.x0, b.x1 - x, z - b.z0, b.z1 - z);
      if (edge > b.sidewalk) continue;
      this.city.collision.resolveCircle(x, z, 0.35, TEST);
      if (TEST.hit) continue;
      s.x = x;
      s.z = z;
      s.y = this.city.layout.groundHeight(x, z);
      s.yaw = r.range(0, 6.28);
      s.speed = 0;
      s.fly = 0;
      s.rest = r.range(2, 18);
      return;
    }
  }

  update(dt: number, px: number, pz: number, heroSpeed: number, vehicles: readonly Vehicle[], clock: number): void {
    if (!this.ready) return;
    const r = this.rng;
    for (const d of this.dogs) {
      if (Math.abs(d.x - px) > RANGE || Math.abs(d.z - pz) > RANGE) {
        this.settle(d, px, pz);
        this.draw("dog", d, d.y, 0);
        continue;
      }
      // Anything coming, and it's up and off.
      let flee = false;
      const dx = d.x - px, dz = d.z - pz;
      if (Math.hypot(dx, dz) < (heroSpeed > 3 ? 4.5 : 2)) {
        d.goal = Math.atan2(dx, dz);
        flee = true;
      }
      for (const v of vehicles) {
        if (Math.abs(v.x - d.x) > 7 || Math.abs(v.z - d.z) > 7 || Math.abs(v.speed) < 0.8) continue;
        d.goal = Math.atan2(d.x - v.x, d.z - v.z);
        flee = true;
        break;
      }
      if (flee) {
        d.speed = 3.6;
        d.rest = r.range(1.5, 4);
      } else if (d.rest > 0) {
        d.rest -= dt;
        d.speed += (0 - d.speed) * (1 - Math.exp(-dt * 4));
        if (d.rest <= 0) {
          // A little trot along the footpath, then down again somewhere else.
          d.goal = d.yaw + r.range(-1.2, 1.2);
          d.speed = r.range(0.7, 1.3);
          d.rest = -r.range(2, 7);
        }
      } else {
        d.rest += dt;
        if (d.rest >= 0) d.rest = r.range(5, 30);
      }
      let turn = d.goal - d.yaw;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      d.yaw += turn * (1 - Math.exp(-dt * 5));
      if (d.speed > 0.05) {
        const nx = d.x + Math.sin(d.yaw) * d.speed * dt, nz = d.z + Math.cos(d.yaw) * d.speed * dt;
        this.city.collision.resolveCircle(nx, nz, 0.3, TEST);
        if (TEST.hit) d.goal = d.yaw + (r.chance(0.5) ? 1.4 : -1.4);
        d.x = TEST.x;
        d.z = TEST.z;
        d.y = this.city.layout.groundHeight(d.x, d.z);
        // A trot: it bobs at the pace of its feet. Lying down it just sits low.
        this.draw("dog", d, d.y + Math.abs(Math.sin(clock * 9 + d.phase)) * 0.04, 0);
        d.lying = false;
      } else if (!d.lying) {
        // Lying down: only worth writing once.
        d.lying = true;
        this.draw("dog", d, d.y - 0.12, 0);
      }
    }
    for (const c of this.crows) {
      if (Math.abs(c.x - px) > RANGE || Math.abs(c.z - pz) > RANGE) {
        this.settle(c, px, pz);
        this.draw("crow", c, c.y, 0);
        continue;
      }
      let scared = Math.hypot(c.x - px, c.z - pz) < 3.5;
      if (!scared) {
        for (const v of vehicles) {
          if (Math.abs(v.x - c.x) < 6 && Math.abs(v.z - c.z) < 6 && Math.abs(v.speed) > 0.8) {
            scared = true;
            break;
          }
        }
      }
      if (scared && c.fly === 0) {
        c.fly = 0.01;
        c.speed = 5.5;
        c.goal = r.range(0, 6.28);
        c.yaw = c.goal;
        c.rest = r.range(1.2, 2.6);
      }
      if (c.fly > 0) {
        c.rest -= dt;
        c.fly += (c.rest > 0 ? 3.4 : -2.6) * dt;
        c.x += Math.sin(c.yaw) * c.speed * dt;
        c.z += Math.cos(c.yaw) * c.speed * dt;
        if (c.fly <= 0) {
          c.fly = 0;
          c.y = this.city.layout.groundHeight(c.x, c.z);
          c.rest = r.range(1, 5);
        }
        this.draw("crow", c, c.y + c.fly + Math.sin(clock * 22 + c.phase) * 0.03, 0.2);
        continue;
      }
      // Hops about on the ground, a peck here and there.
      c.rest -= dt;
      if (c.rest <= 0) {
        c.rest = r.range(0.5, 4);
        c.yaw += r.range(-1.6, 1.6);
        c.x += Math.sin(c.yaw) * 0.18;
        c.z += Math.cos(c.yaw) * 0.18;
        c.y = this.city.layout.groundHeight(c.x, c.z);
        this.draw("crow", c, c.y, 0);
      }
    }
  }

  private draw(id: string, s: Stray, y: number, lean: number): void {
    Quaternion.RotationAxisToRef(UP, s.yaw, Q);
    HERE.set(s.x, y, s.z);
    Matrix.ComposeToRef(UNIT, Q, HERE, M);
    this.city.props.setInstance(id, s.index, M);
    void lean;
  }
}

const TEST = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
