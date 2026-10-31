import { AbstractMesh, Mesh, Scene, TransformNode } from "@babylonjs/core";
import type { PropWorld } from "./props";

const CARS = 6;
const CAR_LEN = 22;
const SPEED = 18;
const BRAKE = 1.1;
const PULL_AWAY = 0.9;
const DWELL = 16;
const TRACK_X = 2.4; // trains keep left, like the roads
const RAIL_Y = 13.5;
/** Far enough down the line to come in from out of the haze. */
const COME_FROM = 300;

interface Train {
  root: TransformNode;
  z: number;
  dir: 1 | -1;
  dwell: number;
  offset: number;
  speed: number;
  /** Has stopped at the station on this trip. */
  served: boolean;
}

/** Six-car trains shuttling above the avenue, one in each direction. They ease in to the platform
 *  and pull away from it, because people can stand right next to them now. */
export class MetroTrain {
  private trains: Train[] = [];

  constructor(scene: Scene, props: PropWorld, private x: number, private fromZ: number, private toZ: number, private stationZ: number, shadow: (m: AbstractMesh) => void) {
    const plain = props.get("metro_train");
    const cab = props.get("metro_train_cab") ?? plain;
    if (!plain || !cab) return;
    for (const [dir, side] of [[1, -TRACK_X], [-1, TRACK_X]] as [1 | -1, number][]) {
      const root = new TransformNode(`train${dir}`, scene);
      for (let c = 0; c < CARS; c++) {
        const isEnd = c === 0 || c === CARS - 1;
        const asset = isEnd ? cab : plain;
        for (const src of asset.meshes) {
          // A pantograph on every car is wrong; real trains carry only a few.
          if (src.name === "pantograph" && c !== 2) continue;
          const m = src.clone(`trainCar${c}`, root, false) as Mesh;
          m.isVisible = true;
          m.setEnabled(true);
          m.position.z = (c - (CARS - 1) / 2) * CAR_LEN;
          m.position.y = RAIL_Y;
          // The cab model's nose points +Z; the rear cab is turned to point the other way.
          if (c === 0) m.rotation.y = Math.PI;
          if (c === 2) shadow(m);
        }
      }
      this.trains.push({ root, z: dir === 1 ? fromZ - 200 : toZ + 200, dir, dwell: 0, offset: side, speed: SPEED, served: false });
    }
  }

  private of(dir: 1 | -1): Train | undefined {
    return this.trains.find((t) => t.dir === dir);
  }

  /** Standing at the platform with its doors open, and for how much longer. */
  standing(dir: 1 | -1): boolean {
    const t = this.of(dir);
    return !!t && t.dwell > 0.5;
  }

  /** Where it is now, for the camera to follow. */
  where(dir: 1 | -1): { x: number; y: number; z: number; heading: number; speed: number } {
    const t = this.of(dir);
    return { x: this.x + (t?.offset ?? 0), y: RAIL_Y, z: t?.z ?? this.stationZ, heading: dir > 0 ? 0 : Math.PI, speed: t?.speed ?? 0 };
  }

  /** How far from the platform it is, so the next one isn't a minute and a half away for someone waiting. */
  comeSoon(dir: 1 | -1): void {
    const t = this.of(dir);
    if (!t || t.dwell > 0) return;
    const ahead = (this.stationZ - t.z) * t.dir;
    if (t.served || ahead > COME_FROM) {
      t.z = this.stationZ - t.dir * COME_FROM;
      t.speed = SPEED;
      t.served = false;
    }
  }

  /** Keeps the doors open a little longer for someone on the platform. */
  holdDoors(dir: 1 | -1, seconds: number): void {
    const t = this.of(dir);
    if (t && t.dwell > 0) t.dwell = Math.max(t.dwell, seconds);
  }

  /** Lets it go at once: everyone's aboard. */
  depart(dir: 1 | -1): void {
    const t = this.of(dir);
    if (t && t.dwell > 1.5) t.dwell = 1.5;
  }

  /** Puts it at the platform as if it had just pulled in. */
  arriveNow(dir: 1 | -1, seconds: number): void {
    const t = this.of(dir);
    if (!t) return;
    t.z = this.stationZ;
    t.dwell = seconds;
    t.speed = 0;
    t.served = true;
    t.root.position.set(this.x + t.offset, 0, t.z);
  }

  update(dt: number): void {
    for (const t of this.trains) {
      if (t.dwell > 0) {
        t.dwell -= dt;
        t.speed = 0;
      } else {
        const ahead = (this.stationZ - t.z) * t.dir;
        const stopping = !t.served && ahead > 0;
        const wanted = stopping ? Math.min(SPEED, Math.sqrt(2 * BRAKE * ahead) + 0.25) : SPEED;
        t.speed = wanted < t.speed ? Math.max(wanted, t.speed - BRAKE * 1.6 * dt) : Math.min(wanted, t.speed + PULL_AWAY * dt);
        t.z += t.dir * t.speed * dt;
        if (stopping && (this.stationZ - t.z) * t.dir <= 0.03) {
          t.z = this.stationZ;
          t.speed = 0;
          t.dwell = DWELL;
          t.served = true;
        }
      }
      const margin = 340;
      if ((t.dir === 1 && t.z > this.toZ + margin) || (t.dir === -1 && t.z < this.fromZ - margin)) {
        t.z = t.dir === 1 ? this.fromZ - margin : this.toZ + margin;
        t.served = false;
        t.speed = SPEED;
      }
      t.root.position.set(this.x + t.offset, 0, t.z);
    }
  }
}
