import { Vector3 } from "@babylonjs/core";
import type { CharacterId } from "../characters/character";
import type { CollisionWorld } from "../world/collision";
import type { Connector, Lane } from "../traffic/laneGraph";
import { VEHICLES, VehicleId, VehicleSpec } from "./vehicleData";
import type { Archetype } from "./vehicleLibrary";
import { ROUTES } from "../world/signs";

export type VehicleMode = "ai" | "player" | "parked";

export interface DriveInput {
  throttle: number; // -1..1
  steer: number; // -1 left .. 1 right
  handbrake: boolean;
}

const WORK = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
const GRAVITY_FEEL = 9.8;

/** One vehicle in the world. It holds state only: the fleet renderer draws it. Physics are arcade
 *  on purpose: responsive, stable and never destructive. Collisions stop and shove; nothing breaks. */
export class Vehicle {
  readonly spec: VehicleSpec;
  x = 0;
  y = 0;
  z = 0;
  heading = 0; // radians, 0 is +Z, positive turns towards +X
  speed = 0; // along the body
  sideSpeed = 0;
  steerAngle = 0; // -1..1 of full lock
  mode: VehicleMode = "parked";
  /** Who is at the wheel, when it isn't the hero. Drawn by the crowd system. */
  driverId: CharacterId | null = null;
  passengers: { id: CharacterId; seat: number; hidden?: boolean }[] = [];
  playerAboard = false;

  roll = 0;
  pitch = 0;
  bump = 0;
  wheelSpin = 0;
  doorAngle = 0;
  doorTarget = 0;
  private rollVel = 0;
  private pitchVel = 0;
  private bumpVel = 0;
  private lastGround = 0;
  private throttleSmooth = 0;

  // AI state, owned by the traffic system.
  lane: Lane | null = null;
  connector: Connector | null = null;
  s = 0;
  aiTarget = 0;
  /** Sideways shift being eased out after a lane change, in metres. */
  lateral = 0;
  nextConnector: Connector | null = null;
  stuckTime = 0;
  hornCooldown = 0;
  shoveX = 0;
  shoveZ = 0;
  inJunction: number | null = null;
  /** Hold still: for boarding, or dwelling at a stop. */
  holdTime = 0;
  /** Ignore other traffic briefly, the last resort for breaking a deadlock. */
  ghostTime = 0;
  /** The bus stop it just served, so it doesn't stop there twice. */
  servedStop = -1;
  scanTimer = 0;
  leadGap = Infinity;
  leadSpeed = 0;
  lastYaw = 0;
  /** Spawn fade: nothing pops in right in front of the player. */

  lastImpact = 0;
  private impactCooldown = 0;

  constructor(readonly id: VehicleId, readonly arch: Archetype, public variant: number, public plateIndex: number) {
    this.spec = VEHICLES[id];
  }

  place(x: number, z: number, heading: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
  }

  /** Player driving model: a bicycle model with front wheel steering and a little slip. */
  drive(input: DriveInput, dt: number, world: CollisionWorld, ground: (x: number, z: number) => number): void {
    const s = this.spec;
    this.throttleSmooth += (input.throttle - this.throttleSmooth) * (1 - Math.exp(-dt * 9));
    const fwd = this.throttleSmooth;
    const braking = (input.throttle < 0 && this.speed > 0.4) || (input.throttle > 0 && this.speed < -0.4);
    if (input.handbrake) {
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), s.brake * 1.1 * dt);
    } else if (braking) {
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), s.brake * dt);
    } else if (fwd > 0.02) {
      // Plenty of pull from rest that fades towards top speed, like a real gearbox.
      const headroom = Math.max(0, 1 - this.speed / s.topSpeed);
      this.speed += s.accel * fwd * (0.4 + 0.6 * headroom) * dt;
      if (this.speed > s.topSpeed) this.speed = s.topSpeed;
    } else if (fwd < -0.02) {
      this.speed -= s.accel * 0.7 * -fwd * dt;
      if (this.speed < -s.reverseSpeed) this.speed = -s.reverseSpeed;
    } else {
      const drag = 0.5 + Math.abs(this.speed) * 0.05;
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), drag * dt);
    }

    // Wheels turn quickly into a corner and return a little slower, like hands on a wheel.
    const speedAbs = Math.abs(this.speed);
    const steerRate = input.steer === 0 ? 5 : 7.5;
    this.steerAngle += (input.steer - this.steerAngle) * (1 - Math.exp(-dt * steerRate));

    // The real turning circle from wheelbase and wheel angle, limited by sideways grip so that
    // a fast corner widens rather than snapping round.
    const wb = Math.max(this.arch.frontAxleZ - this.arch.rearAxleZ, 0.8);
    const gripLimit = (input.handbrake ? s.grip * 0.55 : s.grip) / Math.max(speedAbs * speedAbs, 0.5);
    const maxAngle = Math.min(s.maxSteer, Math.atan(wb * gripLimit));
    const yawRate = (this.speed * Math.tan(this.steerAngle * maxAngle)) / wb;
    this.heading += yawRate * dt;

    // Slip: the body turns slightly ahead of where it's travelling, and grip pulls it back.
    this.sideSpeed += yawRate * this.speed * (input.handbrake ? 0.5 : 0.2) * dt;
    this.sideSpeed -= this.sideSpeed * Math.min(1, (input.handbrake ? 1.4 : 5.5) * dt);

    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    let nx = this.x + (sh * this.speed + ch * this.sideSpeed) * dt;
    let nz = this.z + (ch * this.speed - sh * this.sideSpeed) * dt;

    if (this.impactCooldown > 0) this.impactCooldown -= dt;
    let pushX = 0, pushZ = 0, hit = false, normalX = 0, normalZ = 0;
    for (const c of s.circles) {
      const cx = nx + sh * c + pushX;
      const cz = nz + ch * c + pushZ;
      world.resolveCircle(cx, cz, s.radius, WORK);
      if (WORK.hit) {
        pushX += WORK.x - cx;
        pushZ += WORK.z - cz;
        normalX = WORK.nx;
        normalZ = WORK.nz;
        hit = true;
      }
    }
    if (hit) {
      nx += pushX;
      nz += pushZ;
      const velX = sh * this.speed, velZ = ch * this.speed;
      const into = velX * normalX + velZ * normalZ;
      if (into < 0) {
        const glancing = 1 - Math.min(1, -into / Math.max(speedAbs, 0.01));
        this.speed *= 0.55 + 0.44 * glancing;
        if (-into > 2.5 && this.impactCooldown <= 0) {
          this.lastImpact = -into;
          this.impactCooldown = 0.35;
          this.bumpVel += Math.min(-into * 0.12, 1.1);
          this.pitchVel -= Math.sign(this.speed || 1) * Math.min(-into * 0.05, 0.7);
        }
      }
    }
    this.x = nx;
    this.z = nz;
    const g = ground(this.x, this.z);
    if (g !== this.lastGround) {
      this.bumpVel += Math.min(speedAbs * 0.12, 1.2);
      this.pitchVel += Math.sign(this.speed) * Math.min(speedAbs * 0.03, 0.4) * (g > this.lastGround ? -1 : 1);
      this.lastGround = g;
    }
    this.y += (g - this.y) * (1 - Math.exp(-dt * 18));

    const accelFeel = (fwd > 0 ? s.accel * fwd * 0.016 : 0) - (braking || input.handbrake ? s.brake * 0.017 : 0);
    this.syncSprings(dt, accelFeel, yawRate * speedAbs);
    this.wheelSpin += (this.speed / this.arch.wheelRadius) * dt;
  }

  private syncSprings(rawDt: number, accelFeel: number, cornerAccel: number): void {
    const s = this.spec;
    const dt = Math.min(rawDt, 0.033); // these stiff springs go unstable on long steps
    const kS = 90, kD = 13;
    // Bikes lean into the turn by the angle physics asks for; cars roll gently the other way.
    // In this coordinate frame a positive roll tips the top of the vehicle towards -X.
    const bikeLike = s.lean > 0.2;
    const physical = Math.atan2(cornerAccel, GRAVITY_FEEL);
    const rollTarget = bikeLike ? clamp(-physical, -s.lean, s.lean) : clamp(cornerAccel * 0.018, -s.lean * 2, s.lean * 2);
    const pitchTarget = -accelFeel;
    this.rollVel += ((rollTarget - this.roll) * kS - this.rollVel * kD) * dt;
    this.roll += this.rollVel * dt;
    this.pitchVel += ((pitchTarget - this.pitch) * kS - this.pitchVel * kD) * dt;
    this.pitch += this.pitchVel * dt;
    this.bumpVel += (-this.bump * 120 - this.bumpVel * 14) * dt;
    this.bump += this.bumpVel * dt;
  }

  /** Called by traffic for vehicles it controls. */
  aiPose(x: number, z: number, heading: number, ground: number, dt: number, accelFeel: number, yawRate: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.y += (ground - this.y) * (1 - Math.exp(-dt * 18));
    this.syncSprings(dt, accelFeel, yawRate * Math.abs(this.speed));
    this.wheelSpin += (this.speed / this.arch.wheelRadius) * dt;
  }

  updateDoor(dt: number): void {
    if (this.doorAngle !== this.doorTarget) {
      const step = dt * 3.6;
      const d = this.doorTarget - this.doorAngle;
      this.doorAngle = Math.abs(d) <= step ? this.doorTarget : this.doorAngle + Math.sign(d) * step;
    }
  }

  worldPoint(local: Vector3): Vector3 {
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    return new Vector3(this.x + local.z * sh + local.x * ch, this.y + local.y, this.z + local.z * ch - local.x * sh);
  }

  /** Where this bus says it's going, on the board above its windscreen. */
  get routeName(): string {
    return ROUTES[this.plateIndex % ROUTES.length];
  }

  get freeSeats(): number {
    return this.arch.passengerSeats.length - this.passengers.length;
  }
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
