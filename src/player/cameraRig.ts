import { FreeCamera, Scene, Vector3 } from "@babylonjs/core";
import type { CollisionWorld } from "../world/collision";

const FOV_WALK = 1.02;

/** Third-person camera: orbits on foot, trails behind vehicles, pulls in rather than
 *  clipping through walls, and widens slightly with speed for a sense of pace. */
export class CameraRig {
  readonly camera: FreeCamera;
  yaw = 0;
  pitch = 0.2;
  private dist = 4.3;
  private distTarget = 4.3;
  private height = 1.55;
  private zoomLevel = 1;
  private currentDist = 4.3;
  private lookBias = 0;
  private recenterTimer = 0;
  private focus = new Vector3();
  private shake = 0;
  private shakeTime = 0;
  sensitivity = 1;

  constructor(scene: Scene, private world: CollisionWorld) {
    this.camera = new FreeCamera("playerCam", new Vector3(0, 2, -5), scene);
    this.camera.minZ = 0.2;
    this.camera.maxZ = 1500;
    this.camera.fov = FOV_WALK;
    this.camera.inputs.clear();
  }

  cycleZoom(): void {
    this.zoomLevel = this.zoomLevel === 1 ? 1.45 : this.zoomLevel === 1.45 ? 0.72 : 1;
  }

  addZoom(delta: number): void {
    this.zoomLevel = Math.max(0.55, Math.min(1.9, this.zoomLevel + delta * 0.08));
  }

  kick(amount: number): void {
    this.shake = Math.max(this.shake, Math.min(amount, 1));
  }

  snap(x: number, y: number, z: number, heading: number): void {
    this.focus.set(x, y + this.height, z);
    this.yaw = heading;
    this.currentDist = this.dist;
  }

  /** Mouse look. On foot the mouse always steers the camera. */
  look(dx: number, dy: number): void {
    const k = 0.0022 * this.sensitivity;
    this.yaw += dx * k;
    this.pitch += dy * k;
    this.pitch = Math.max(-0.5, Math.min(1.25, this.pitch));
    if (dx !== 0 || dy !== 0) this.recenterTimer = 2.2;
  }

  updateOnFoot(x: number, y: number, z: number, moving: boolean, dt: number): void {
    this.distTarget = 4.2;
    this.height = 1.42;
    this.apply(x, y, z, dt, 0, moving ? 0.34 : 0.3);
  }

  /** Vehicle camera: swings behind the direction of travel unless the player is looking around. */
  updateInVehicle(x: number, y: number, z: number, heading: number, speed: number, top: number, camDistance: number, camHeight: number, dt: number): void {
    this.distTarget = camDistance;
    this.height = camHeight * 0.62;
    if (this.recenterTimer > 0) this.recenterTimer -= dt;
    else if (Math.abs(speed) > 0.8) {
      let want = heading;
      if (speed < -1) want += Math.PI;
      let d = want - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const strength = Math.min(Math.abs(speed) / 6, 1) * 2.6;
      this.yaw += d * (1 - Math.exp(-dt * strength));
      this.pitch += (0.17 - this.pitch) * (1 - Math.exp(-dt * 1.5));
    }
    const pace = Math.min(Math.abs(speed) / Math.max(top, 1), 1);
    this.apply(x, y, z, dt, pace, 0.3);
  }

  private apply(x: number, y: number, z: number, dt: number, pace: number, _shoulder: number): void {
    const dist = this.distTarget * this.zoomLevel;
    this.dist += (dist - this.dist) * (1 - Math.exp(-dt * 4));
    const k = 1 - Math.exp(-dt * 14);
    this.focus.x += (x - this.focus.x) * k;
    this.focus.y += (y + this.height - this.focus.y) * (1 - Math.exp(-dt * 8));
    this.focus.z += (z - this.focus.z) * k;

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dirX = -Math.sin(this.yaw) * cp;
    const dirY = sp;
    const dirZ = -Math.cos(this.yaw) * cp;

    // Pull in when the view line runs into a wall, and ease back out afterwards.
    const wantX = this.focus.x + dirX * this.dist;
    const wantY = this.focus.y + dirY * this.dist;
    const wantZ = this.focus.z + dirZ * this.dist;
    const free = this.world.segmentFree(this.focus.x, this.focus.y, this.focus.z, wantX, wantY, wantZ);
    const allowed = Math.max(0.9, this.dist * free - 0.25);
    if (allowed < this.currentDist) this.currentDist = allowed;
    else this.currentDist += (allowed - this.currentDist) * (1 - Math.exp(-dt * 2.5));

    const cam = this.camera;
    const camX = this.focus.x + dirX * this.currentDist;
    const camY = Math.max(0.35, this.focus.y + dirY * this.currentDist);
    const camZ = this.focus.z + dirZ * this.currentDist;

    this.shakeTime += dt * 34;
    this.shake *= Math.exp(-dt * 6);
    const sx = Math.sin(this.shakeTime) * this.shake * 0.09;
    const sy = Math.sin(this.shakeTime * 1.3) * this.shake * 0.09;
    cam.position.set(camX + sx, camY + sy, camZ);
    cam.setTarget(new Vector3(this.focus.x + sx * 0.4, this.focus.y + 0.05 + sy * 0.4, this.focus.z));
    const fov = FOV_WALK + pace * pace * 0.2;
    cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 3));
    void this.lookBias;
  }
}
