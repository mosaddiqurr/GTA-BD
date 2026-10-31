import { FreeCamera, Scene, Vector3 } from "@babylonjs/core";
import type { CollisionWorld } from "../world/collision";

const FOV_WALK = 1.02;
const FOV_FIRST = 1.16;
const EYE_FORWARD = 0.3;

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
  private talkSide = 0.42;
  /** In a vehicle the view is fixed to it, with a slow drift for speed, so it can't shimmer. */
  private riding = false;
  private lagX = 0;
  private lagZ = 0;
  private offX = 0;
  private offZ = 0;
  private talkTimer = 0;
  private lastHeading = 0;
  private lookAtPoint = new Vector3();
  sensitivity = 1;
  invertY = false;
  /** Swings round behind a vehicle by itself. */
  autoFollow = true;
  shakeOn = true;
  /** Through the hero's own eyes, on foot and in a vehicle. */
  firstFoot = false;
  firstDrive = false;
  /** How high the hero's eyes are above their feet, and above their hips when sitting. */
  eyeHeight = 1.2;
  eyeOverHip = 0.62;
  private bob = 0;

  constructor(scene: Scene, private world: CollisionWorld) {
    this.camera = new FreeCamera("playerCam", new Vector3(0, 2, -5), scene);
    this.camera.minZ = 0.2;
    this.camera.maxZ = 2600;
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
    if (this.shakeOn) this.shake = Math.max(this.shake, Math.min(amount, 1));
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
    this.pitch += (this.invertY ? -dy : dy) * k;
    this.pitch = Math.max(this.firstFoot || this.firstDrive ? -1.1 : -0.5, Math.min(1.25, this.pitch));
    if (dx !== 0 || dy !== 0) this.recenterTimer = 2.2;
  }

  /** Looking out from a point, whichever way the mouse has it. The head stays just behind the view. */
  private lookFrom(x: number, y: number, z: number, dt: number, pace: number): void {
    const cam = this.camera;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.shakeTime += dt * 34;
    this.shake *= Math.exp(-dt * 6);
    const sx = Math.sin(this.shakeTime) * this.shake * 0.05, sy = Math.sin(this.shakeTime * 1.3) * this.shake * 0.05;
    cam.minZ = 0.1;
    cam.position.set(x + sx, y + sy, z);
    this.lookAtPoint.set(x + sx + Math.sin(this.yaw) * cp * 5, y + sy - sp * 5, z + Math.cos(this.yaw) * cp * 5);
    cam.setTarget(this.lookAtPoint);
    const fov = FOV_FIRST + pace * pace * 0.16;
    cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 3));
    this.focus.set(x, y, z);
    this.currentDist = 0.9;
  }

  /** Eyes forward through the hero's own head, a step in front of it. */
  private eyesOnFoot(x: number, y: number, z: number, speed: number, dt: number): void {
    this.bob += dt * speed * 3.2;
    const up = Math.sin(this.bob * 2) * Math.min(speed, 4) * 0.008;
    this.lookFrom(x + Math.sin(this.yaw) * EYE_FORWARD, y + this.eyeHeight + up, z + Math.cos(this.yaw) * EYE_FORWARD, dt, 0);
  }

  /** Sitting in a vehicle looking out: the view turns with it, and comes back to the road when the mouse rests. */
  updateEyes(x: number, y: number, z: number, heading: number, speed: number, top: number, dt: number): void {
    let turn = heading - this.lastHeading;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    this.lastHeading = heading;
    if (Math.abs(turn) < 1) this.yaw += turn;
    if (this.recenterTimer > 0) this.recenterTimer -= dt;
    else {
      let d = heading - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const k = 1 - Math.exp(-dt * 2.2);
      this.yaw += d * k;
      this.pitch += (0.04 - this.pitch) * k;
    }
    this.riding = false;
    this.lookFrom(x, y, z, dt, Math.min(Math.abs(speed) / Math.max(top, 1), 1));
  }

  updateOnFoot(x: number, y: number, z: number, moving: boolean, dt: number, speed = 0): void {
    if (this.firstFoot) {
      this.eyesOnFoot(x, y, z, speed, dt);
      return;
    }
    this.riding = false;
    this.distTarget = 4.2;
    this.height = 1.42;
    this.apply(x, y, z, dt, 0, moving ? 0.34 : 0.3);
  }

  /** Vehicle camera: swings behind the direction of travel unless the player is looking around. */
  updateInVehicle(x: number, y: number, z: number, heading: number, speed: number, top: number, camDistance: number, camHeight: number, dt: number): void {
    this.distTarget = camDistance;
    this.height = camHeight * 0.62;
    if (this.recenterTimer > 0) this.recenterTimer -= dt;
    else if (this.autoFollow && Math.abs(speed) > 0.8) {
      let want = heading;
      if (speed < -1) want += Math.PI;
      let d = want - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const strength = Math.min(Math.abs(speed) / 6, 1) * 3;
      this.yaw += d * (1 - Math.exp(-dt * strength));
      this.pitch += (0.17 - this.pitch) * (1 - Math.exp(-dt * 1.5));
    }
    const pace = Math.min(Math.abs(speed) / Math.max(top, 1), 1);
    // The view hangs back a little as speed builds, but smoothly, however uneven the frames are.
    const ease = 1 - Math.exp(-dt * 3.5);
    const trail = -0.06;
    this.lagX += (Math.sin(heading) * speed * trail - this.lagX) * ease;
    this.lagZ += (Math.cos(heading) * speed * trail - this.lagZ) * ease;
    if (!this.riding) {
      // Getting in: glide across from wherever the view was.
      this.riding = true;
      this.offX = this.focus.x - (x + this.lagX);
      this.offZ = this.focus.z - (z + this.lagZ);
    }
    const settle = Math.exp(-dt * 4);
    this.offX *= settle;
    this.offZ *= settle;
    this.focus.x = x + this.lagX + this.offX;
    this.focus.z = z + this.lagZ + this.offZ;
    this.apply(this.focus.x, y, this.focus.z, dt, pace, 0.3);
  }

  /** A conversation: over the hero's shoulder, with whoever they're talking to in frame. Looking
   *  around still works, and the shot comes back a moment after the mouse stops. */
  updateTalk(x: number, y: number, z: number, otherX: number, otherZ: number, dt: number): void {
    this.distTarget = 3 / this.zoomLevel;
    this.height = 1.18;
    const fx = x + (otherX - x) * 0.4, fz = z + (otherZ - z) * 0.4, fy = y + this.height;
    const toOther = Math.atan2(otherX - x, otherZ - z);
    if (this.recenterTimer > 0) this.recenterTimer -= dt;
    else {
      // Whichever shoulder has room behind it: a tree or a wall right there would push the camera
      // through the hero's head.
      this.talkTimer -= dt;
      if (this.talkTimer <= 0) {
        this.talkTimer = 0.6;
        const room = (yaw: number): number => this.world.segmentFree(fx, fy, fz, fx - Math.sin(yaw) * 3, fy + 0.3, fz - Math.cos(yaw) * 3);
        const here = room(toOther + this.talkSide);
        const there = room(toOther - this.talkSide);
        if (here < 0.8 && there > here + 0.1) this.talkSide = -this.talkSide;
      }
      let d = toOther + this.talkSide - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const k = 1 - Math.exp(-dt * 2.8);
      this.yaw += d * k;
      this.pitch += (0.1 - this.pitch) * k;
    }
    this.apply(fx, y, fz, dt, 0, 0.3);
  }

  /** On a bench: a little closer and lower than walking. */
  updateSeated(x: number, y: number, z: number, dt: number): void {
    this.distTarget = 3.1 / this.zoomLevel;
    this.height = 1.05;
    this.apply(x, y, z, dt, 0, 0.3);
  }

  /** Turns the view towards something, gently, for as long as it's called. */
  turnTowards(x: number, z: number, fromX: number, fromZ: number, dt: number): void {
    if (this.recenterTimer > 0) return;
    let d = Math.atan2(x - fromX, z - fromZ) - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * (1 - Math.exp(-dt * 1.8));
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
    // In quickly, but not in one jump, unless it's right up against something.
    if (allowed < this.currentDist * 0.45) this.currentDist = allowed;
    else if (allowed < this.currentDist) this.currentDist += (allowed - this.currentDist) * (1 - Math.exp(-dt * 16));
    else this.currentDist += (allowed - this.currentDist) * (1 - Math.exp(-dt * 2.5));

    const cam = this.camera;
    cam.minZ = 0.2;
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
