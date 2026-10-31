import { Vector3 } from "@babylonjs/core";
import type { CharacterId } from "../characters/character";
import type { CollisionWorld } from "../world/collision";
import type { Connector, Lane } from "../traffic/laneGraph";
import { VEHICLES, VEHICLE_MASS, VehicleId, VehicleSpec } from "./vehicleData";
import type { Archetype, DoorInfo } from "./vehicleLibrary";
import { ROUTES, ROUTE_INFO } from "../world/signs";
import { HIT, obbVsBox, obbVsCircle } from "../physics/shapes";

export type VehicleMode = "ai" | "player" | "parked";

export interface DriveInput {
  throttle: number; // -1..1
  steer: number; // -1 left .. 1 right
  handbrake: boolean;
}

const GRAVITY = 9.8;
/** The body is stepped this finely, so stiff tyres stay steady and nothing gets jumped through. */
const STEP = 1 / 240;
const MAX_STEPS = 16;
/** The shape of a tyre's grip against how far it's sliding: it builds fast, peaks, and falls off a little. */
const TYRE_B = 9, TYRE_C = 1.35;
/** Below this speed slip is measured against it, so a car at rest doesn't shiver. */
const SLIP_FLOOR = 2;
/** More grip at the back than the front: a car pushes wide at the limit, rather than spinning round. */
const REAR_GRIP = 1.14;
/** Beyond the wheel angle a corner needs, how much more the steering may ask of the tyres. */
const SLIP_ROOM = 0.14;
const WALL_BOUNCE = 0.16;
const WALL_RUB = 0.22;
/** Hits turn a vehicle by less than they would a free box: it has tyres holding it to the road. */
const TURN_FROM_HIT = 0.65;
const MAX_SPIN = 4.2;
/** How far a fallen bike is over, in radians: its handlebar and pedal stop it lying quite flat. */
const LYING = 1.42;

/** How well the road holds right now: 1 when it's dry, less in the rain. */
export const ROAD = { grip: 1 };

/** One vehicle in the world. It holds state only: the fleet renderer draws it. The one being driven
 *  has real weight on real tyres: it pushes wide when it asks too much of them, slides on the
 *  handbrake, and bounces and turns when it hits something. Nothing is ever damaged and nobody hurt. */
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
  /** On its way somewhere for the police. */
  onPoliceJob = false;
  /** Lamps going: an ambulance on a call, or the police wanting a word. */
  flashing = false;
  /** Taken to the police station's yard. */
  impounded = false;
  /** Who's hanging off the door of a bus with no room left inside. */
  hangers: CharacterId[] = [];
  /** Has its own bent copy of the body, drawn separately. */
  ownBody = false;
  playerAboard = false;

  roll = 0;
  pitch = 0;
  bump = 0;
  /** A bike on its side: how far over, and which way. */
  fallen = 0;
  private fallVel = 0;
  private fallSide = 1;
  private lying = false;
  wheelSpin = 0;
  /** How far open each door is and where it's going, in radians. See `DOOR_INDEX`. */
  readonly doorAngle = [0, 0, 0, 0];
  readonly doorGoal = [0, 0, 0, 0];
  /** Heading somewhere in particular: the spot, and how far each lane is from it. */
  trip: { lane: Lane; s: number; dist: Map<Lane, number> } | null = null;
  private rollVel = 0;
  private pitchVel = 0;
  private bumpVel = 0;
  private lastGround = 0;
  private throttleSmooth = 0;
  private lastSpeed = 0;
  private accelNow = 0;
  /** What the tyres are doing, eased a little: along the body, for the weight on each axle, and across it. */
  private axNow = 0;
  private ayNow = 0;
  /** How far round the pedals are, 0..1, for riders drawn in bulk. */
  pedalPhase = 0;

  // AI state, owned by the traffic system.
  lane: Lane | null = null;
  connector: Connector | null = null;
  s = 0;
  aiTarget = 0;
  /** Sideways shift being eased out after a lane change, in metres. */
  lateral = 0;
  /** Where the lane change started from, how far through it is, 0..1, and how long it takes. */
  laneFrom = 0;
  laneT = 1;
  laneDur = 2.5;
  /** Edging sideways within the road to get past something, in metres to the left. */
  filter = 0;
  filterGoal = 0;
  filterHold = 0;
  /** Sideways speed right now, for pointing the nose where it's going. */
  latVel = 0;
  /** This driver: 0 is calm and careful, 1 is in a hurry and pushes in. */
  /** Tilt of the road under it, in radians. Positive is nose down, as `pitch` is. */
  slope = 0;
  /** The player is what's in the way. */
  leadIsPlayer = false;
  /** How long it's been held up by the player, or by something parked in its road. */
  blockTime = 0;
  /** Has already told the player what it thinks. */
  shouted = false;
  /** Pulling out round something: creeps until it's clear. */
  rounding = 0;
  /** On its way to pick the player up. */
  called = false;
  temper = 0.5;
  /** Actual acceleration, eased, so nobody lurches. */
  aiAccel = 0;
  nextConnector: Connector | null = null;
  stuckTime = 0;
  hornCooldown = 0;
  /** Knocked off line by a collision: how far, and how fast it's still moving. */
  shoveX = 0;
  shoveZ = 0;
  knockX = 0;
  knockZ = 0;
  /** Knocked round by a collision: how far, and how fast. */
  shoveYaw = 0;
  spin = 0;
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
  /** How far from the player, as of the last look. */
  dist = 999;
  /** What's in the way, if it's another vehicle. */
  lead: Vehicle | null = null;
  /** The speed this driver is after right now. */
  wantedNow = 8;
  lastYaw = 0;
  /** Spawn fade: nothing pops in right in front of the player. */

  lastImpact = 0;
  private impactCooldown = 0;

  readonly mass: number;
  /** How hard it is to turn, about its middle. */
  readonly inertia: number;

  constructor(readonly id: VehicleId, readonly arch: Archetype, public variant: number, public plateIndex: number) {
    this.spec = VEHICLES[id];
    this.mass = VEHICLE_MASS[id];
    this.inertia = (this.mass * (this.spec.length * this.spec.length + this.spec.width * this.spec.width)) / 12;
  }

  /** On two wheels, so a hard enough knock puts it on its side. */
  get tips(): boolean {
    return this.id === "bicycle" || this.id === "motorbike";
  }

  get isLying(): boolean {
    return this.lying;
  }

  fall(side: number): void {
    if (!this.tips || this.lying) return;
    this.lying = true;
    this.fallSide = side >= 0 ? 1 : -1;
    this.fallVel = 0.8;
  }

  /** Someone has picked it up. */
  rightUp(): void {
    this.lying = false;
  }

  /** Its whole-body speed across the map. */
  get velX(): number {
    return Math.sin(this.heading) * this.speed + Math.cos(this.heading) * this.sideSpeed + this.knockX;
  }

  get velZ(): number {
    return Math.cos(this.heading) * this.speed - Math.sin(this.heading) * this.sideSpeed + this.knockZ;
  }

  /** A blow from outside, at a point on the body. Someone being driven by the hero takes it straight on
   *  the body. A driver in traffic keeps rolling on what's along their lane, and the rest throws them
   *  off line. */
  push(jx: number, jz: number, px: number, pz: number): void {
    const dvx = jx / this.mass, dvz = jz / this.mass;
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    if (this.mode === "player") {
      const vx = sh * this.speed + ch * this.sideSpeed + dvx, vz = ch * this.speed - sh * this.sideSpeed + dvz;
      this.speed = vx * sh + vz * ch;
      this.sideSpeed = vx * ch - vz * sh;
    } else if (this.mode === "ai") {
      const along = dvx * sh + dvz * ch;
      const taken = Math.max(along, -this.speed);
      this.speed += taken;
      this.aiAccel = Math.min(this.aiAccel, 0);
      this.knockX += dvx - taken * sh;
      this.knockZ += dvz - taken * ch;
    } else {
      this.knockX += dvx;
      this.knockZ += dvz;
    }
    const turn = (((pz - this.z) * jx - (px - this.x) * jz) / this.inertia) * TURN_FROM_HIT;
    this.spin = clamp(this.spin + turn, -MAX_SPIN, MAX_SPIN);
  }

  /** What's left of a knock once the tyres have had their say: it rolls on along the body, and scrubs off fast across it. */
  rubOut(dt: number, rolling: number): void {
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    const grip = ROAD.grip;
    const along = this.knockX * sh + this.knockZ * ch, across = this.knockX * ch - this.knockZ * sh;
    const a = toward0(along, rolling * grip * dt), w = toward0(across, 7.5 * grip * dt);
    this.knockX = sh * a + ch * w;
    this.knockZ = ch * a - sh * w;
    if (Math.abs(this.knockX) + Math.abs(this.knockZ) < 0.02) this.knockX = this.knockZ = 0;
    this.spin = toward0(this.spin, (1.4 + Math.abs(this.spin) * 1.2) * grip * dt);
  }

  place(x: number, z: number, heading: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
  }

  /** The player's vehicle, for one frame. */
  drive(input: DriveInput, dt: number, world: CollisionWorld | null, ground: (x: number, z: number) => number): void {
    const s = this.spec;
    const heavy = Math.min(this.mass / 8000, 1);
    this.throttleSmooth += (input.throttle - this.throttleSmooth) * (1 - Math.exp(-dt * (input.throttle === 0 ? 7 : 4.5 - heavy * 1.6)));

    // Wheels turn quickly into a corner and return a little slower, like hands on a wheel.
    // Quick at parking speed, calmer on the open road, so a tap of the key doesn't throw the car.
    const pace = Math.min(Math.abs(this.speed) / Math.max(s.topSpeed, 1), 1);
    const reversing = input.steer !== 0 && input.steer * this.steerAngle < 0;
    const steerRate = (input.steer === 0 ? 6.5 - pace * 2.5 : reversing ? 9 - pace * 5 : 6 - pace * 3.4) * (1 - heavy * 0.38);
    this.steerAngle += (input.steer - this.steerAngle) * (1 - Math.exp(-dt * steerRate));

    if (this.impactCooldown > 0) this.impactCooldown -= dt;
    const steps = Math.min(MAX_STEPS, Math.max(1, Math.ceil(dt / STEP)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.stepBody(input, h, world);

    const speedAbs = Math.abs(this.speed);
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    const g = ground(this.x, this.z);
    if (g !== this.lastGround) {
      this.bumpVel += Math.min(speedAbs * 0.05, 0.6);
      this.pitchVel += Math.sign(this.speed) * Math.min(speedAbs * 0.012, 0.18) * (g > this.lastGround ? -1 : 1);
      this.lastGround = g;
    }
    this.y += (g - this.y) * (1 - Math.exp(-dt * 18));
    // Nose up a ramp, nose down the far side.
    const wb = Math.max(this.arch.frontAxleZ - this.arch.rearAxleZ, 0.8);
    const reach = wb * 0.5;
    const rise = ground(this.x + sh * reach, this.z + ch * reach) - ground(this.x - sh * reach, this.z - ch * reach);
    const lean = world ? 0 : -Math.atan2(rise, wb);
    this.slope += (lean - this.slope) * (1 - Math.exp(-dt * 12));

    this.syncSprings(dt, this.ayNow);
    this.wheelSpin += (this.speed / this.arch.wheelRadius) * dt;
  }

  /** One small step of a body on two axles: how the weight sits, what each tyre can give, and where that takes it. */
  private stepBody(input: DriveInput, h: number, world: CollisionWorld | null): void {
    const s = this.spec, m = this.mass;
    const a = Math.max(this.arch.frontAxleZ, 0.25), b = Math.max(-this.arch.rearAxleZ, 0.25), L = a + b;
    let vx = this.speed, vy = this.sideSpeed, w = this.spin;
    const grip = s.grip * ROAD.grip;
    const muY = grip / GRAVITY, muX = (Math.max(s.grip, s.brake) * ROAD.grip) / GRAVITY;

    // Only as much lock as these tyres can use at this speed.
    const lock = Math.min(s.maxSteer, Math.atan((L * grip) / Math.max(vx * vx, 0.5)) + SLIP_ROOM);
    const delta = this.steerAngle * lock;
    const cd = Math.cos(delta), sd = Math.sin(delta);

    // Braking loads the front wheels, and accelerating the back.
    const mg = m * GRAVITY;
    const shift = (m * this.axNow * s.height * 0.42) / L;
    const zf = Math.max((mg * b) / L - shift, mg * 0.12), zr = Math.max((mg * a) / L + shift, mg * 0.12);

    const vyf = vy + w * a, vyr = vy - w * b;
    const wf = vx * cd + vyf * sd, nf = -vx * sd + vyf * cd;

    // What the driver is asking of the wheels.
    const fwd = this.throttleSmooth;
    const braking = (input.throttle < 0 && vx > 0.4) || (input.throttle > 0 && vx < -0.4);
    let ff = 0, fr = 0;
    if (braking) {
      ff = -Math.sign(wf) * m * s.brake * 0.62;
      fr = -Math.sign(vx) * m * s.brake * 0.38;
    } else if (fwd > 0.02 && vx < s.topSpeed) {
      // Plenty of pull from rest that fades towards top speed, like a real gearbox.
      fr = m * s.accel * fwd * (0.4 + 0.6 * Math.max(0, 1 - vx / s.topSpeed));
    } else if (fwd < -0.02 && vx > -s.reverseSpeed) {
      fr = m * s.accel * 0.7 * fwd;
    } else {
      fr = -Math.sign(vx) * m * (0.5 + Math.abs(vx) * 0.05);
    }
    if (input.handbrake) {
      ff = 0;
      // On two wheels a locked back wheel would have it over: a rider only drags it.
      fr = -Math.sign(vx) * muX * zr * (this.tips ? 0.5 : 0.85);
    }
    // Stopping is as far as a brake goes: it never pushes a vehicle backwards.
    const stop = (m * 0.5) / h;
    ff = clamp(ff, -Math.abs(wf) * stop, Math.abs(wf) * stop);
    if (braking || input.handbrake || Math.abs(fwd) <= 0.02) fr = clamp(fr, -Math.abs(vx) * stop, Math.abs(vx) * stop);

    // What the tyres give back sideways, and between the two directions no more than they have.
    let fnf = -muY * zf * tyre(nf / Math.max(Math.abs(wf), SLIP_FLOOR));
    let fnr = -muY * REAR_GRIP * zr * tyre(vyr / Math.max(Math.abs(vx), SLIP_FLOOR));
    const useF = Math.hypot(ff / (muX * zf), fnf / (muY * zf)), useR = Math.hypot(fr / (muX * zr), fnr / (muY * REAR_GRIP * zr));
    if (useF > 1) {
      ff /= useF;
      fnf /= useF;
    }
    if (useR > 1) {
      fr /= useR;
      fnr /= useR;
    }

    const fx = ff * cd - fnf * sd + fr;
    const side = ff * sd + fnf * cd;
    const fy = side + fnr;
    const ax = fx / m, ay = fy / m;
    this.axNow += (ax - this.axNow) * (1 - Math.exp(-h * 14));
    this.ayNow += (ay - this.ayNow) * (1 - Math.exp(-h * 14));
    vx += (ax + w * vy) * h;
    vy += (ay - w * vx) * h;
    w += ((a * side - b * fnr) / this.inertia) * h;
    // Stopped means stopped: no creeping about on what's left of the sums.
    if (input.throttle === 0 && Math.abs(vx) < 0.03) {
      vx = 0;
      if (Math.abs(vy) < 0.02) vy = 0;
      if (Math.abs(w) < 0.01) w = 0;
    }
    this.heading += w * h;

    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    let nx = this.x + (sh * vx + ch * vy) * h, nz = this.z + (ch * vx - sh * vy) * h;
    if (world) {
      const hl = s.length * 0.5, hw = s.width * 0.5;
      let hardest = 0;
      // Round again if the way out of one thing led into another, as it can along a row of buildings.
      for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        for (const c of world.query(nx, nz, hl + hw + 0.4)) {
          if (c.kind === "circle" && c.loose) continue;
          const touching = c.kind === "box" ? obbVsBox(nx, nz, sh, ch, hl, hw, c.x0, c.z0, c.x1, c.z1) : obbVsCircle(nx, nz, sh, ch, hl, hw, c.x, c.z, c.r);
          if (!touching) continue;
          const { nx: cx, nz: cz, depth, px, pz } = HIT;
          nx += cx * depth;
          nz += cz * depth;
          moved = true;
          // How fast the point that touched was going into it: the body turning counts as well.
          const rx = px - nx, rz = pz - nz;
          let wx = sh * vx + ch * vy, wz = ch * vx - sh * vy;
          const px1 = wx + w * rz, pz1 = wz - w * rx;
          const into = px1 * cx + pz1 * cz;
          if (into >= 0) continue;
          const arm = rz * cx - rx * cz;
          const j = (-(1 + (into < -4 ? WALL_BOUNCE : 0)) * into) / (1 / m + (arm * arm) / this.inertia);
          const tx = -cz, tz = cx;
          const arm2 = rz * tx - rx * tz;
          const slide = px1 * tx + pz1 * tz;
          const rub = clamp(-slide / (1 / m + (arm2 * arm2) / this.inertia), -j * WALL_RUB, j * WALL_RUB);
          wx += (j * cx + rub * tx) / m;
          wz += (j * cz + rub * tz) / m;
          w = clamp(w + ((j * arm + rub * arm2) / this.inertia) * TURN_FROM_HIT, -MAX_SPIN, MAX_SPIN);
          vx = wx * sh + wz * ch;
          vy = wx * ch - wz * sh;
          hardest = Math.max(hardest, -into);
        }
        if (!moved) break;
      }
      if (hardest > 2.5 && this.impactCooldown <= 0) {
        this.lastImpact = hardest;
        this.impactCooldown = 0.35;
        this.bumpVel += Math.min(hardest * 0.08, 0.8);
        this.pitchVel += Math.sign(vx || 1) * Math.min(hardest * 0.03, 0.4);
      }
    }
    this.x = nx;
    this.z = nz;
    this.speed = vx;
    this.sideSpeed = vy;
    this.spin = w;
  }

  private syncSprings(rawDt: number, cornerAccel: number): void {
    const s = this.spec;
    const dt = Math.min(rawDt, 0.033); // these stiff springs go unstable on long steps
    const kS = 70, kD = 12;
    // Body pitch follows what the vehicle is really doing, so it sits level at rest and at a steady speed.
    if (rawDt > 0) {
      const a = (this.speed - this.lastSpeed) / rawDt;
      this.lastSpeed = this.speed;
      this.accelNow += (a - this.accelNow) * (1 - Math.exp(-rawDt * 7));
    }
    const forward = Math.sign(this.speed || 1) * this.accelNow;
    const pitchTarget = clamp(-forward * 0.0042, -0.03, 0.045);
    this.pedalPhase = (this.pedalPhase + (Math.abs(this.speed) / 2.6) * rawDt) % 1;
    // Bikes lean into the turn by the angle physics asks for; cars roll gently the other way.
    // In this coordinate frame a positive roll tips the top of the vehicle towards -X.
    const bikeLike = s.lean > 0.2;
    const physical = Math.atan2(cornerAccel, GRAVITY);
    let rollTarget = bikeLike ? clamp(-physical, -s.lean, s.lean) : clamp(cornerAccel * 0.0055, -s.lean, s.lean);
    // Over it goes, faster the further it's gone, and it bounces once; lifted, it comes straight back up.
    if (this.lying) {
      this.fallVel += (GRAVITY / 0.9) * Math.sin(Math.max(this.fallen, 0.1)) * dt;
      this.fallen += this.fallVel * dt;
      if (this.fallen >= LYING) {
        this.fallen = LYING;
        this.fallVel *= -0.22;
        if (Math.abs(this.fallVel) < 0.3) this.fallVel = 0;
      }
    } else if (this.fallen > 0) this.fallen = Math.max(0, this.fallen - dt * 2.4);
    if (this.fallen > 0) rollTarget = 0;
    // A bike falls into a lean and rises out of it; it doesn't snap over.
    this.rollVel += ((rollTarget - this.roll) * (bikeLike ? 42 : kS) - this.rollVel * (bikeLike ? 11.5 : kD)) * dt;
    this.roll += this.rollVel * dt;
    this.pitchVel += ((pitchTarget - this.pitch) * kS - this.pitchVel * kD) * dt;
    this.pitch += this.pitchVel * dt;
    this.bumpVel += (-this.bump * 120 - this.bumpVel * 14) * dt;
    this.bump += this.bumpVel * dt;
  }

  /** How it's turned to one side when it's lying down, and how far that lifts it clear of the road. */
  get fallRoll(): number {
    return this.fallSide * this.fallen;
  }

  get fallLift(): number {
    return Math.sin(this.fallen) * this.spec.width * 0.42;
  }

  /** Lets the suspension settle on a vehicle nothing else is moving, such as a parked one. */
  settle(dt: number): void {
    this.syncSprings(dt, 0);
  }

  /** Called by traffic for vehicles it controls. */
  aiPose(x: number, z: number, heading: number, ground: number, dt: number, yawRate: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.y += (ground - this.y) * (1 - Math.exp(-dt * 18));
    this.syncSprings(dt, yawRate * Math.abs(this.speed));
    this.wheelSpin += (this.speed / this.arch.wheelRadius) * dt;
  }

  updateDoors(dt: number): void {
    const step = dt * 3.2;
    for (let i = 0; i < this.doorAngle.length; i++) {
      const d = this.doorGoal[i] - this.doorAngle[i];
      if (d !== 0) this.doorAngle[i] = Math.abs(d) <= step ? this.doorGoal[i] : this.doorAngle[i] + Math.sign(d) * step;
    }
  }

  /** Where a door's handle is right now, in the world. */
  doorHandle(door: DoorInfo): Vector3 {
    const a = door.sign * this.doorAngle[door.index];
    const sn = Math.sin(a), cs = Math.cos(a);
    const h = door.handle;
    return this.worldPoint(new Vector3(door.pivot.x + h.x * cs + h.z * sn, door.pivot.y + h.y, door.pivot.z - h.x * sn + h.z * cs));
  }

  /** A knock from outside: the body rocks on its springs, away from the blow. */
  jolt(nx: number, nz: number, strength: number): void {
    const s = Math.min(strength, 14);
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    const along = nx * sh + nz * ch, across = nx * ch - nz * sh;
    this.pitchVel += along * s * 0.05;
    this.rollVel += across * s * 0.07;
    this.bumpVel += s * 0.05;
  }

  worldPoint(local: Vector3): Vector3 {
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    return new Vector3(this.x + local.z * sh + local.x * ch, this.y + local.y, this.z + local.z * ch - local.x * sh);
  }

  /** Where this bus says it's going, on the board above its windscreen. */
  get routeName(): string {
    return ROUTES[this.plateIndex % ROUTES.length];
  }

  /** The district this bus goes on to, if it leaves this one at all. */
  get routeTo(): string | undefined {
    return ROUTE_INFO[this.plateIndex % ROUTE_INFO.length]?.to;
  }

  /** A sedan in taxi paint: the only car that takes fares. */
  get isTaxi(): boolean {
    return this.id === "car_sedan" && this.arch.bodies[this.variant]?.name === "taxi";
  }

  /** Something the player can ride in without being a guest: bus, CNG, rickshaw, battery rickshaw or taxi. */
  get takesFares(): boolean {
    return this.id === "bus_city" || this.id === "cng" || this.id === "rickshaw" || this.id === "easybike" || this.id === "leguna" || this.isTaxi || this.isRideShare;
  }

  /** A motorbike in the ride-share company's green, whose rider takes a passenger for money. */
  get isRideShare(): boolean {
    return this.id === "motorbike" && this.arch.bodies[this.variant]?.name === "rideshare";
  }

  /** Belongs to the police, and nobody but the police drives it. */
  get official(): boolean {
    return this.id === "police_car" || this.id === "wrecker";
  }

  get freeSeats(): number {
    return this.arch.passengerSeats.length - this.passengers.length;
  }
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

function tyre(slip: number): number {
  return Math.sin(TYRE_C * Math.atan(TYRE_B * slip));
}

function toward0(v: number, by: number): number {
  return v > by ? v - by : v < -by ? v + by : 0;
}
