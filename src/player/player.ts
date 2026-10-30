import { AbstractMesh, Matrix, Quaternion, Scene, Vector3 } from "@babylonjs/core";
import { Character, Pose, characterAvailable } from "../characters/character";
import type { City } from "../world/city";
import type { TrafficSystem } from "../traffic/trafficSystem";
import type { Vehicle } from "../vehicles/vehicle";
import type { VehicleFleet } from "../vehicles/vehicleLibrary";
import type { Pedestrians } from "../npc/pedestrians";
import { Rng } from "../world/cityLayout";
import { bn } from "../localization/bn";
import type { CameraRig } from "./cameraRig";
import type { Input } from "./input";
import type { AudioSystem } from "../audio/audio";
import { Heading } from "../traffic/laneGraph";

const WORK = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
const OUT = { x: 0, z: 0 };

const WALK_SPEED = 1.95;
const RUN_SPEED = 5.2;
const ACCEL = 11;
const DECEL = 16;
const RADIUS = 0.34;
const APPROACH_SPEED = 4.2;

export interface PlayerEvents {
  say: (text: string, seconds?: number, speak?: boolean) => void;
  prompt: (html: string | null) => void;
}

/** Stages of getting into or out of a vehicle. */
type Stage = "foot" | "approach" | "openDoor" | "waitDriver" | "climbIn" | "driving" | "riding" | "climbOut";

/** The mango hero: walking, and the whole sequence of getting into and out of vehicles. */
export class Player {
  readonly character: Character | null;
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx = 0;
  vz = 0;
  vy = 0;
  airborne = false;
  vehicle: Vehicle | null = null;
  stage: Stage = "foot";
  private spawn: [number, number, number];
  private rng = new Rng(7);
  private stageTime = 0;
  private asPassenger = false;
  private seatIndex = -1;
  private doorPoint = new Vector3();
  private backX = 0;
  private backZ = 0;
  /** Inside a bus the way to a seat isn't straight: up the steps, then along the aisle. */
  private route: Vector3[] = [];
  private fromPos = new Vector3();
  private toPos = new Vector3();
  private climbDuration = 0.6;
  private redLightCooldown = 0;
  private interactCooldown = 0;
  private seatM = Matrix.Identity();
  private seatQ = new Quaternion();
  private seatT = new Vector3();
  private seatS = new Vector3();

  constructor(
    scene: Scene,
    private city: City,
    private traffic: TrafficSystem,
    private fleet: VehicleFleet,
    private peds: Pedestrians,
    private rig: CameraRig,
    private input: Input,
    private audio: AudioSystem,
    private ev: PlayerEvents,
    shadow: (m: AbstractMesh) => void,
  ) {
    this.spawn = city.region.spawnPoints.default;
    this.x = this.spawn[0];
    this.y = this.spawn[1];
    this.z = this.spawn[2];
    this.yaw = 0;
    this.character = characterAvailable("hero_mango") ? new Character("hero_mango", scene, shadow) : null;
    this.character?.place(this.x, this.y, this.z, this.yaw);
    rig.snap(this.x, this.y, this.z, 0);
  }

  get position(): { x: number; z: number } {
    return this.vehicle ? { x: this.vehicle.x, z: this.vehicle.z } : { x: this.x, z: this.z };
  }

  /** The vehicle under the player's control, not one they are just riding in. */
  get driving(): Vehicle | null {
    return this.stage === "driving" ? this.vehicle : null;
  }

  respawn(): void {
    if (this.vehicle) this.endVehicle();
    this.stage = "foot";
    this.x = this.spawn[0];
    this.z = this.spawn[2];
    this.y = this.spawn[1];
    this.vx = this.vz = this.vy = 0;
    this.yaw = 0;
    this.character?.setPose("stand");
    this.rig.snap(this.x, this.y, this.z, 0);
  }

  update(dt: number): void {
    const input = this.input;
    this.rig.look(input.lookX, input.lookY);
    if (input.wheel) this.rig.addZoom(input.wheel);
    if (input.pressed("KeyC")) this.rig.cycleZoom();
    if (input.pressed("KeyR")) this.respawn();
    if (this.interactCooldown > 0) this.interactCooldown -= dt;
    if (this.redLightCooldown > 0) this.redLightCooldown -= dt;
    this.stageTime += dt;

    switch (this.stage) {
      case "foot":
        this.walk(dt);
        break;
      case "approach":
        this.approach(dt);
        break;
      case "openDoor":
        this.openDoor(dt);
        break;
      case "waitDriver":
        this.waitDriver(dt);
        break;
      case "climbIn":
        this.climbIn(dt);
        break;
      case "driving":
        this.driveVehicle(dt);
        break;
      case "riding":
        this.ride(dt);
        break;
      case "climbOut":
        this.climbOut(dt);
        break;
    }
    if (this.vehicle && this.stage !== "driving") this.vehicle.updateDoor(dt);
    this.character?.update(dt);
  }

  private setStage(s: Stage): void {
    this.stage = s;
    this.stageTime = 0;
  }

  private setPose(p: Pose, rate = 12): void {
    const c = this.character;
    if (!c) return;
    c.blendRate = rate;
    if (c.pose !== p) c.setPose(p);
  }

  // ---------------------------------------------------------------- on foot

  private walk(dt: number): void {
    const input = this.input;
    const f = (input.isDown("KeyW", "ArrowUp") ? 1 : 0) - (input.isDown("KeyS", "ArrowDown") ? 1 : 0);
    const s = (input.isDown("KeyD", "ArrowRight") ? 1 : 0) - (input.isDown("KeyA", "ArrowLeft") ? 1 : 0);
    const cy = Math.cos(this.rig.yaw), sy = Math.sin(this.rig.yaw);
    let dx = sy * f + cy * s;
    let dz = cy * f - sy * s;
    const len = Math.hypot(dx, dz);
    const running = input.isDown("ShiftLeft", "ShiftRight");
    const maxSpeed = len > 0 ? (running ? RUN_SPEED : WALK_SPEED) : 0;
    if (len > 0) {
      dx /= len;
      dz /= len;
    }
    // Build up speed gradually and stop a little quicker, so starts and stops have weight.
    const tvx = dx * maxSpeed, tvz = dz * maxSpeed;
    const diff = Math.hypot(this.vx - tvx, this.vz - tvz);
    const rate = maxSpeed > Math.hypot(this.vx, this.vz) ? ACCEL : DECEL;
    const k = diff > 0 ? Math.min(1, (rate * dt) / diff) : 1;
    this.vx += (tvx - this.vx) * k;
    this.vz += (tvz - this.vz) * k;

    let nx = this.x + this.vx * dt;
    let nz = this.z + this.vz * dt;
    this.city.collision.resolveCircle(nx, nz, RADIUS, WORK);
    nx = WORK.x;
    nz = WORK.z;
    this.traffic.blockWalker(nx, nz, RADIUS, OUT);
    nx = OUT.x;
    nz = OUT.z;
    // Velocity follows what actually happened, so sliding along a wall feels right.
    if (dt > 0) {
      this.vx = (nx - this.x) / dt;
      this.vz = (nz - this.z) / dt;
    }
    this.x = nx;
    this.z = nz;

    const ground = this.city.layout.groundHeight(this.x, this.z);
    if (input.pressed("Space") && !this.airborne) {
      this.vy = 4.3;
      this.airborne = true;
      this.audio.step(0.08);
    }
    if (this.airborne) {
      this.vy -= 13 * dt;
      this.y += this.vy * dt;
      if (this.y <= ground) {
        this.y = ground;
        this.vy = 0;
        this.airborne = false;
        this.audio.step(0.1);
      }
    } else {
      this.y += (ground - this.y) * (1 - Math.exp(-dt * 16));
    }

    const speed = Math.hypot(this.vx, this.vz);
    let turnRate = 0;
    if (speed > 0.2) {
      const target = Math.atan2(this.vx, this.vz);
      let d = target - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const step = d * (1 - Math.exp(-dt * 11));
      this.yaw += step;
      turnRate = dt > 0 ? step / dt : 0;
    }
    const c = this.character;
    if (c) {
      c.speed = speed;
      const pose: Pose = this.airborne ? "jump" : speed < 0.18 ? "stand" : speed > 3.1 ? "run" : "walk";
      this.setPose(pose, pose === "stand" ? 9 : 14);
      // Lean into acceleration and into turns; a small thing that adds a lot of weight.
      const accelTarget = maxSpeed - speed;
      const leanF = clamp((accelTarget / RUN_SPEED) * 0.32, -0.16, 0.22);
      const leanS = clamp((-turnRate * speed) / 42, -0.2, 0.2);
      c.leanForward += (leanF - c.leanForward) * (1 - Math.exp(-dt * 8));
      c.leanSide += (leanS - c.leanSide) * (1 - Math.exp(-dt * 8));
      c.place(this.x, this.y, this.z, this.yaw);
    }
    this.rig.updateOnFoot(this.x, this.y, this.z, speed > 0.5, dt);
    this.audio.footsteps(speed, this.airborne, dt);

    // What can be done here?
    const near = this.traffic.nearestVehicle(this.x, this.z, 2.4);
    if (near) {
      const canRide = near.spec.carries && !!near.driverId && near.freeSeats > 0;
      const ride = near.id === "bus_city" ? bn.promptRideBus(near.routeName) : bn.promptRide;
      this.ev.prompt(canRide ? `${bn.promptEnter(near.id)} &nbsp; ${ride}` : bn.promptEnter(near.id));
      if (input.pressed("KeyF")) this.beginEnter(near, false);
      else if (canRide && input.pressed("KeyG")) this.beginEnter(near, true);
      return;
    }
    const stall = this.city.stalls.find((q) => q.kind === "tea" && Math.hypot(q.x - this.x, q.z - this.z) < 3);
    if (stall) {
      this.ev.prompt(bn.promptTea);
      if (input.pressed("KeyE") && this.interactCooldown <= 0) {
        this.interactCooldown = 3;
        this.ev.say(this.rng.pick(bn.tea), 3.2, true);
      }
      return;
    }
    const talker = this.peds.nearestTalker(this.x, this.z, 2.4);
    if (talker) {
      this.ev.prompt(bn.promptTalk);
      if (input.pressed("KeyE") && this.interactCooldown <= 0) {
        this.interactCooldown = 3;
        this.peds.talkTo(talker);
        this.ev.say(this.rng.pick(bn.greet), 3.4, true);
      }
      return;
    }
    this.ev.prompt(null);
  }

  // ---------------------------------------------------------------- getting in

  /** Which point beside the vehicle to walk to. Doors decide it, otherwise the nearer side. */
  private boardingPoint(v: Vehicle, passenger: boolean): Vector3 {
    const arch = v.arch;
    const side = v.spec.boardSide;
    let local = arch.exitRight;
    if (side === "left" || (passenger && v.id === "bus_city")) local = arch.exitLeft;
    else if (side !== "right") {
      const l = v.worldPoint(arch.exitLeft), r = v.worldPoint(arch.exitRight);
      local = Math.hypot(l.x - this.x, l.z - this.z) < Math.hypot(r.x - this.x, r.z - this.z) ? arch.exitLeft : arch.exitRight;
    }
    return local;
  }

  private beginEnter(v: Vehicle, passenger: boolean): void {
    this.vehicle = v;
    this.asPassenger = passenger;
    this.vx = this.vz = 0;
    if (v.mode === "ai") {
      // Flagging it down: the driver pulls up rather than stopping dead.
      v.holdTime = 12;
    }
    this.ev.prompt(null);
    this.setStage("approach");
  }

  private currentDoorTarget(): Vector3 {
    const v = this.vehicle!;
    return v.worldPoint(this.boardingPoint(v, this.asPassenger));
  }

  /** Jogging up to the door. Moving away cancels it, as in any good open-world game. */
  private approach(dt: number): void {
    const v = this.vehicle!;
    const input = this.input;
    if (this.stageTime > 0.25 && input.isDown("KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight")) {
      if (v.mode === "ai") v.holdTime = 0;
      this.vehicle = null;
      this.setStage("foot");
      return;
    }
    const t = this.currentDoorTarget();
    const dx = t.x - this.x, dz = t.z - this.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.3 && Math.abs(v.speed) < 0.5) {
      this.doorPoint.copyFrom(t);
      this.x = t.x;
      this.z = t.z;
      this.setStage("openDoor");
      return;
    }
    // It got away, or something's between us: give up rather than teleport.
    if (this.stageTime > 9) {
      if (v.mode === "ai") v.holdTime = 0;
      this.vehicle = null;
      this.setStage("foot");
      return;
    }
    const step = Math.min(APPROACH_SPEED * dt, dist);
    let nx = this.x + (dx / dist) * step;
    let nz = this.z + (dz / dist) * step;
    // Only the target vehicle may be touched on the way; everything else is still solid.
    this.traffic.blockWalker(nx, nz, RADIUS, OUT, v);
    nx = OUT.x;
    nz = OUT.z;
    this.x = nx;
    this.z = nz;
    this.y += (this.city.layout.groundHeight(this.x, this.z) - this.y) * (1 - Math.exp(-dt * 16));
    let d = Math.atan2(dx, dz) - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * (1 - Math.exp(-dt * 12));
    const c = this.character;
    if (c) {
      c.speed = APPROACH_SPEED;
      this.setPose(dist < 0.9 ? "walk" : "run", 14);
      c.leanForward *= Math.exp(-dt * 8);
      c.leanSide *= Math.exp(-dt * 8);
      c.place(this.x, this.y, this.z, this.yaw);
    }
    this.rig.updateOnFoot(this.x, this.y, this.z, true, dt);
    this.audio.footsteps(APPROACH_SPEED, false, dt);
  }

  /** Face the vehicle and pull the door open, if it has one. */
  private openDoor(dt: number): void {
    const v = this.vehicle!;
    const usesDoor = v.arch.hasDoor && v.spec.doorSwing > 0 && !this.asPassenger;
    const target = v.worldPoint(v.arch.driverSeat);
    let d = Math.atan2(target.x - this.x, target.z - this.z) - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * (1 - Math.exp(-dt * 10));
    const c = this.character;
    if (c) {
      c.speed = 0;
      this.setPose(usesDoor ? "reach" : "stand", 11);
      c.place(this.x, this.y, this.z, this.yaw);
    }
    this.rig.updateOnFoot(this.x, this.y, this.z, false, dt);
    if (usesDoor && v.doorTarget === 0 && this.stageTime > 0.14) {
      v.doorTarget = v.spec.doorSwing;
      this.audio.door(false);
    }
    if (this.stageTime < (usesDoor ? 0.42 : 0.18)) return;
    if (!this.asPassenger && v.driverId) this.driverHandsOver(v);
    else this.startClimb();
  }

  /** The driver gets out and gives up the seat without any fuss; no force is ever involved. */
  private driverHandsOver(v: Vehicle): void {
    const id = v.driverId!;
    v.driverId = null;
    const seat = v.worldPoint(v.arch.driverSeat);
    // They step out on the other side of the hero, clear of the door.
    const side = this.boardingPoint(v, false);
    const exit = v.worldPoint(side);
    const awayX = exit.x - v.x, awayZ = exit.z - v.z;
    const al = Math.hypot(awayX, awayZ) || 1;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    // Straight out past the door's edge; the hero has stepped towards the back of the vehicle.
    const ox = exit.x + (awayX / al) * 1.15 + fx * 0.15;
    const oz = exit.z + (awayZ / al) * 1.15 + fz * 0.15;
    this.peds.driverLeaves(id, seat, v.spec.seatPose, ox, oz, v.heading);
    this.ev.say(this.rng.pick(v.passengers.length > 3 ? bn.busPassengers : bn.driverLeaves), 3.2, true);
    // The hero gives them room to get out, then steps back up to the door.
    this.backX = -fx * 1.15 + (awayX / al) * 0.25;
    this.backZ = -fz * 1.15 + (awayZ / al) * 0.25;
    this.setStage("waitDriver");
  }

  private waitDriver(dt: number): void {
    const c = this.character;
    const t = this.stageTime;
    const out = smooth(clamp(t / 0.34, 0, 1)) * (1 - smooth(clamp((t - 0.98) / 0.34, 0, 1)));
    const px = this.x, pz = this.z;
    this.x = this.doorPoint.x + this.backX * out;
    this.z = this.doorPoint.z + this.backZ * out;
    const moved = dt > 0 ? Math.hypot(this.x - px, this.z - pz) / dt : 0;
    if (c) {
      c.speed = moved;
      this.setPose(moved > 0.25 ? "walk" : "wave", 11);
      c.place(this.x, this.y, this.z, this.yaw);
    }
    this.rig.updateOnFoot(this.x, this.y, this.z, false, dt);
    if (t > 1.34) this.startClimb();
  }

  private seatLocal(): { pos: Vector3; yaw: number } {
    const v = this.vehicle!;
    if (this.asPassenger && this.seatIndex >= 0) {
      const s = v.arch.passengerSeats[this.seatIndex];
      return { pos: s.position, yaw: s.yaw };
    }
    return { pos: v.arch.driverSeat, yaw: 0 };
  }

  private startClimb(): void {
    const v = this.vehicle!;
    if (this.asPassenger) {
      const taken = new Set(v.passengers.map((p) => p.seat));
      this.seatIndex = -1;
      for (let i = 0; i < v.arch.passengerSeats.length; i++) {
        if (!taken.has(i)) {
          this.seatIndex = i;
          break;
        }
      }
      if (this.seatIndex < 0) {
        // Full up: back to the footpath.
        if (v.mode === "ai") v.holdTime = 0;
        this.vehicle = null;
        this.setStage("foot");
        this.ev.say(bn.vehicleFull, 2.4);
        return;
      }
      v.passengers.push({ id: "npc_office_orange", seat: this.seatIndex });
      // The hero is drawn live, so this entry only reserves the seat.
      v.passengers[v.passengers.length - 1].hidden = true;
      v.playerAboard = true;
    } else {
      this.traffic.takeOver(v);
      this.audio.startEngine(v.spec.sound);
    }
    this.fromPos.set(this.x, this.y, this.z);
    const big = v.id === "bus_city" || v.id === "truck";
    const twoWheel = v.spec.lean > 0.2 || v.id === "rickshaw";
    this.route = this.routeToSeat(v, true);
    this.climbDuration = (big ? 0.95 : twoWheel ? 0.5 : 0.62) + (this.route.length ? 0.9 : 0);
    this.setPose(twoWheel ? "mount" : "climb", 10);
    this.setStage("climbIn");
  }

  private climbIn(dt: number): void {
    const v = this.vehicle!;
    const c = this.character;
    const k = clamp(this.stageTime / this.climbDuration, 0, 1);
    const e = smooth(k);
    const { pos } = this.seatLocal();
    const hip = c?.hipHeight ?? 0.5;
    const seat = v.worldPoint(new Vector3(pos.x, pos.y - hip, pos.z));
    if (this.route.length) {
      this.followRoute(v, this.fromPos, seat, e, dt);
    } else {
      // Up and in: a hop onto a saddle, a step up into a cab.
      const arc = Math.sin(k * Math.PI) * (v.spec.lean > 0.2 ? 0.34 : 0.2);
      this.x = this.fromPos.x + (seat.x - this.fromPos.x) * e;
      this.y = this.fromPos.y + (seat.y - this.fromPos.y) * e + arc;
      this.z = this.fromPos.z + (seat.z - this.fromPos.z) * e;
      // Turn round to face the way the vehicle points as the hero settles.
      this.yaw = turnTo(this.yaw, v.heading + this.seatLocal().yaw, 1 - Math.exp(-dt * 7));
    }
    if (c) {
      c.place(this.x, this.y, this.z, this.yaw);
      const settle = this.route.length ? 0.86 : 0.5;
      if (k > settle) {
        this.setPose(this.asPassenger ? "passenger" : v.spec.seatPose, 8);
        if (this.route.length) this.yaw = turnTo(this.yaw, v.heading + this.seatLocal().yaw, 1 - Math.exp(-dt * 12));
      } else if (this.route.length && k > 0.26) {
        c.speed = 1.6;
        this.setPose("walk", 10);
      }
    }
    this.rig.updateInVehicle(v.x, v.y, v.z, v.heading, 0, v.spec.topSpeed, v.spec.camDistance, v.spec.camHeight, dt);
    if (k >= 1) {
      if (v.doorTarget !== 0) {
        v.doorTarget = 0;
        this.audio.door(true);
      }
      if (c) c.blendRate = 12;
      this.setStage(this.asPassenger ? "riding" : "driving");
      if (this.asPassenger && v.mode === "ai") v.holdTime = 0;
    }
  }

  /** The steps and aisle of a bus, in vehicle space, between the door and a seat. */
  private routeToSeat(v: Vehicle, boarding: boolean): Vector3[] {
    if (v.id !== "bus_city") return [];
    const { pos } = this.seatLocal();
    const door = this.boardingPoint(v, this.asPassenger);
    const side = Math.sign(door.x) || -1;
    const hip = this.character?.hipHeight ?? 0.5;
    const floor = pos.y - hip - 0.04;
    const steps = new Vector3(side * 0.82, floor * 0.45, door.z);
    const inside = new Vector3(side * 0.18, floor, door.z);
    const aisle = new Vector3(0, floor, pos.z);
    const route = [steps, inside, aisle];
    return boarding ? route : route.reverse();
  }

  /** Moves along the route's straight sections at an even pace, turning to walk along each one. */
  private followRoute(v: Vehicle, from: Vector3, to: Vector3, e: number, dt: number): void {
    const pts: Vector3[] = [from, ...this.route.map((p) => v.worldPoint(p)), to];
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Vector3.Distance(pts[i - 1], pts[i]);
    let d = e * total;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const len = Vector3.Distance(a, b);
      if (d <= len || i === pts.length - 1) {
        const t = len > 0 ? Math.min(d / len, 1) : 1;
        this.x = a.x + (b.x - a.x) * t;
        this.y = a.y + (b.y - a.y) * t;
        this.z = a.z + (b.z - a.z) * t;
        if (Math.hypot(b.x - a.x, b.z - a.z) > 0.05) this.yaw = turnTo(this.yaw, Math.atan2(b.x - a.x, b.z - a.z), 1 - Math.exp(-dt * 12));
        return;
      }
      d -= len;
    }
  }

  // ---------------------------------------------------------------- in a seat

  /** The hero sits exactly on the seat's transform, so they lean and bounce with the vehicle. */
  private placeInSeat(v: Vehicle): void {
    const c = this.character;
    if (!c) return;
    const { pos, yaw } = this.seatLocal();
    this.fleet.seatMatrix(v, pos.x, pos.y - c.hipHeight, pos.z, yaw, this.seatM);
    this.seatM.decompose(this.seatS, this.seatQ, this.seatT);
    c.root.position.copyFrom(this.seatT);
    if (!c.root.rotationQuaternion) c.root.rotationQuaternion = new Quaternion();
    c.root.rotationQuaternion.copyFrom(this.seatQ);
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
  }

  private driveVehicle(dt: number): void {
    const v = this.vehicle!;
    const input = this.input;
    const throttle = (input.isDown("KeyW", "ArrowUp") ? 1 : 0) - (input.isDown("KeyS", "ArrowDown") ? 1 : 0);
    const steer = (input.isDown("KeyD", "ArrowRight") ? 1 : 0) - (input.isDown("KeyA", "ArrowLeft") ? 1 : 0);
    v.drive({ throttle, steer, handbrake: input.isDown("Space") }, dt, this.city.collision, (x, z) => this.city.layout.groundHeight(x, z));
    v.updateDoor(dt);

    const vehicleHit = this.traffic.collidePlayerVehicle(v);
    const impact = Math.max(v.lastImpact, vehicleHit);
    v.lastImpact = 0;
    if (impact > 2) {
      this.rig.kick(Math.min(impact / 12, 1));
      this.audio.impact(Math.min(impact / 12, 1));
    }
    this.placeInSeat(v);
    const c = this.character;
    if (c) {
      c.speed = Math.abs(v.speed);
      c.steer = v.steerAngle;
      c.leanForward = 0;
      c.leanSide = 0;
    }
    this.rig.updateInVehicle(v.x, v.y, v.z, v.heading, v.speed, v.spec.topSpeed, v.spec.camDistance, v.spec.camHeight, dt);
    this.audio.engine(Math.abs(v.speed) / v.spec.topSpeed, throttle !== 0);
    if (input.pressed("KeyH")) this.audio.horn(v.spec.horn);
    this.checkRedLight(v);
    this.ev.prompt(Math.abs(v.speed) < 3 ? bn.promptExit : null);
    if (input.pressed("KeyF") && Math.abs(v.speed) < 7) this.beginExit();
  }

  /** Riding along: the driver goes where they're going, and the hero watches the city. */
  private ride(dt: number): void {
    const v = this.vehicle!;
    this.placeInSeat(v);
    const c = this.character;
    if (c) {
      c.speed = 0;
      c.leanForward = 0;
      c.leanSide = 0;
    }
    this.rig.updateInVehicle(v.x, v.y, v.z, v.heading, v.speed, v.spec.topSpeed, v.spec.camDistance, v.spec.camHeight, dt);
    const stopped = Math.abs(v.speed) < 0.6;
    this.ev.prompt(stopped ? bn.promptExit : bn.promptStop);
    if (this.input.pressed("KeyF")) {
      if (stopped) this.beginExit();
      else {
        // Ask the driver to pull over: they stop as soon as they safely can.
        v.holdTime = 5;
        this.ev.say(bn.askStop, 1.8, true);
      }
    }
  }

  // ---------------------------------------------------------------- getting out

  private beginExit(): void {
    const v = this.vehicle!;
    const c = this.character;
    const local = this.boardingPoint(v, this.asPassenger);
    let exit = v.worldPoint(local);
    this.city.collision.resolveCircle(exit.x, exit.z, RADIUS, WORK);
    if (WORK.hit) {
      // Something's in the way on this side, so use the other one.
      const other = v.worldPoint(local === v.arch.exitLeft ? v.arch.exitRight : v.arch.exitLeft);
      this.city.collision.resolveCircle(other.x, other.z, RADIUS, WORK);
      if (!WORK.hit) exit = other;
      else {
        exit.x = WORK.x;
        exit.z = WORK.z;
      }
    }
    this.toPos.set(exit.x, this.city.layout.groundHeight(exit.x, exit.z), exit.z);
    const { pos } = this.seatLocal();
    const hip = c?.hipHeight ?? 0.5;
    const seat = v.worldPoint(new Vector3(pos.x, pos.y - hip, pos.z));
    this.fromPos.copyFrom(seat);
    this.x = seat.x;
    this.y = seat.y;
    this.z = seat.z;
    this.yaw = v.heading + this.seatLocal().yaw;
    if (c) {
      if (c.root.rotationQuaternion) c.root.rotationQuaternion = null;
      c.root.rotation.set(0, this.yaw, 0);
      c.speed = 0;
    }
    if (!this.asPassenger) {
      this.audio.stopEngine();
      if (v.arch.hasDoor && v.spec.doorSwing > 0) {
        v.doorTarget = v.spec.doorSwing;
        this.audio.door(false);
      }
    }
    const big = v.id === "bus_city" || v.id === "truck";
    this.route = this.routeToSeat(v, false);
    this.climbDuration = (big ? 0.85 : 0.55) + (this.route.length ? 0.9 : 0);
    this.setPose(v.spec.lean > 0.2 ? "mount" : "climb", 10);
    this.setStage("climbOut");
  }

  private climbOut(dt: number): void {
    const v = this.vehicle!;
    const c = this.character;
    const delay = v.arch.hasDoor && !this.asPassenger ? 0.22 : 0.05;
    const k = clamp((this.stageTime - delay) / this.climbDuration, 0, 1);
    const e = smooth(k);
    if (this.route.length) {
      this.followRoute(v, this.fromPos, this.toPos, e, dt);
      if (c && k > 0.12 && k < 0.92) {
        c.speed = 1.6;
        this.setPose("walk", 10);
      }
    } else {
      const arc = Math.sin(k * Math.PI) * 0.16;
      this.x = this.fromPos.x + (this.toPos.x - this.fromPos.x) * e;
      this.y = this.fromPos.y + (this.toPos.y - this.fromPos.y) * e + arc;
      this.z = this.fromPos.z + (this.toPos.z - this.fromPos.z) * e;
    }
    if (c) {
      if (k > (this.route.length ? 0.92 : 0.6)) this.setPose("stand", 9);
      c.place(this.x, this.y, this.z, this.yaw);
    }
    this.rig.updateOnFoot(this.x, this.y, this.z, false, dt);
    if (k >= 1) {
      if (v.doorTarget !== 0) {
        v.doorTarget = 0;
        this.audio.door(true);
      }
      this.endVehicle();
      this.y = this.toPos.y;
      this.setStage("foot");
    }
  }

  private endVehicle(): void {
    const v = this.vehicle;
    if (!v) return;
    if (this.asPassenger) {
      v.passengers = v.passengers.filter((p) => !p.hidden);
      v.playerAboard = false;
    } else {
      this.traffic.release(v);
      this.audio.stopEngine();
    }
    const c = this.character;
    if (c?.root.rotationQuaternion) {
      c.root.rotationQuaternion = null;
      c.root.rotation.set(0, this.yaw, 0);
    }
    this.vehicle = null;
    this.asPassenger = false;
    this.seatIndex = -1;
  }

  // ---------------------------------------------------------------- traffic police

  /** Whistle and a Bangla warning from the officer if the player drives through a red light. */
  private checkRedLight(v: Vehicle): void {
    if (this.redLightCooldown > 0 || Math.abs(v.speed) < 3) return;
    const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
    const heading: Heading = Math.abs(sh) > Math.abs(ch) ? (sh > 0 ? 1 : 3) : ch > 0 ? 0 : 2;
    for (const c of this.traffic.signals.values()) {
      const j = c.junction;
      if (Math.abs(v.x - j.x) > j.halfX + 3 || Math.abs(v.z - j.z) > j.halfZ + 3) continue;
      // Only just entering counts: compare where we are along the direction of travel.
      const along = (v.x - j.x) * sh + (v.z - j.z) * ch;
      const box = heading % 2 === 0 ? j.halfZ : j.halfX;
      if (along < -box - 1 && c.stateFor(heading) === "red" && this.city.police.some((p) => Math.hypot(p.x - j.x, p.z - j.z) < 50)) {
        this.redLightCooldown = 12;
        this.audio.whistle();
        this.ev.say(this.rng.pick(bn.police), 3.2, true);
      }
      return;
    }
  }
}

function smooth(k: number): number {
  return k * k * (3 - 2 * k);
}

function turnTo(cur: number, target: number, k: number): number {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * k;
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
