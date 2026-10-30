import { AbstractMesh, Mesh, Scene, TransformNode } from "@babylonjs/core";
import type { PropWorld } from "./props";

const CARS = 6;
const CAR_LEN = 22;
const SPEED = 18;
const TRACK_X = 2.4; // trains keep left, like the roads
const RAIL_Y = 13.5;

/** Six-car trains shuttling above the avenue, one in each direction. */
export class MetroTrain {
  private trains: { root: TransformNode; z: number; dir: 1 | -1; dwell: number; offset: number }[] = [];

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
      this.trains.push({ root, z: dir === 1 ? fromZ - 200 : toZ + 200, dir, dwell: 0, offset: side });
    }
  }

  update(dt: number): void {
    for (const t of this.trains) {
      const wasBefore = (this.stationZ - t.z) * t.dir > 0;
      if (t.dwell > 0) t.dwell -= dt;
      else t.z += t.dir * SPEED * dt;
      const nowPast = (this.stationZ - t.z) * t.dir <= 0;
      if (wasBefore && nowPast) t.dwell = 16;
      const margin = 340;
      if (t.dir === 1 && t.z > this.toZ + margin) t.z = this.fromZ - margin;
      if (t.dir === -1 && t.z < this.fromZ - margin) t.z = this.toZ + margin;
      t.root.position.set(this.x + t.offset, 0, t.z);
    }
  }
}
