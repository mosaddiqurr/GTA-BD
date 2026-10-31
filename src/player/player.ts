import { AbstractMesh, Matrix, Quaternion, Scene, Vector3 } from "@babylonjs/core";
import { Character, Pose, characterAvailable, CharacterId } from "../characters/character";
import type { City } from "../world/city";
import type { TrafficSystem } from "../traffic/trafficSystem";
import type { Vehicle } from "../vehicles/vehicle";
import type { DoorInfo, VehicleFleet } from "../vehicles/vehicleLibrary";
import type { Pedestrians, TeaSeat } from "../npc/pedestrians";
import type { Interactions } from "../interaction/interactions";
import type { Anchor } from "../ui/hud";
import { Rng } from "../world/cityLayout";
import type { HeroKind } from "../app/heroes";
import { bn } from "../localization/bn";
import type { CameraRig } from "./cameraRig";
import type { Input } from "./input";
import type { AudioSystem } from "../audio/audio";
import { Heading } from "../traffic/laneGraph";

const EYE = new Vector3();
const WORK = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
const OUT = { x: 0, z: 0 };

const WALK_SPEED = 1.95;
const RUN_SPEED = 5.2;
const ACCEL = 11;
const DECEL = 16;
const RADIUS = 0.34;
/** How hard a knock, in metres per second, puts a bike on its side with the hero on it. */
const THROWN_OFF = 6.5;
const APPROACH_SPEED = 4.2;
const HAND_TO_DOOR = 0.26; // seconds to get a hand on the handle
const DOOR_PULL = 0.42; // seconds of hauling it open
const DOOR_SHUT = 0.55;
const SIT_DOWN = 0.55;
const WAVE_SECONDS = 1.25;
const MOVE_KEYS = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
/** Ends a conversation. Not the arrow keys: those move around the menu. */
const LEAVE_KEYS = ["KeyW", "KeyA", "KeyS", "KeyD"];

export interface PlayerEvents {
  say: (text: string, seconds?: number, speak?: boolean) => void;
  prompt: (html: string | null) => void;
  /** A line said out loud by someone in particular. */
  line: (text: string, anchor: Anchor, id: string, top: number) => void;
  /** The hero's vehicle has hit something. */
  crash: (v: Vehicle, impact: number, hit: Vehicle | null) => void;
  /** A moving vehicle has bumped the hero, on foot. */
  hitBy: (v: Vehicle) => void;
  /** Asking a rickshaw or CNG to go somewhere, which comes before getting in. */
  hire: (v: Vehicle) => void;
  /** Just sat down in a vehicle as a passenger. */
  seated: (v: Vehicle) => void;
  /** Just got out of a vehicle. */
  gotOut: (v: Vehicle) => void;
  /** Went through a red light in front of an officer. */
  ranRed: () => void;
  /** Fines still to be paid. */
  finesOwed: () => number;
  /** A child at the wheel of anything but a bicycle. */
  tooYoung: () => void;
  /** Tried to get into something they can't. */
  refused: (v: Vehicle) => void;
  /** Anything in progress has to end at once. */
  reset: () => void;
}

/** What the hero is doing: on foot, in a conversation, on a bench, or getting into or out of a vehicle. */
type Stage = "thrown" | "train" | "foot" | "approach" | "openDoor" | "waitDriver" | "climbIn" | "driving" | "riding" | "climbOut" | "shutDoor" | "talk" | "toSeat" | "seated" | "standUp" | "waving";

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
  private flyX = 0;
  private flyY = 0;
  private flyZ = 0;
  /** Wading through deep water slows anyone down. */
  groundPace = 1;
  /** Carrying something heavy. */
  loadPace = 1;
  /** Whether they've the breath to run, and whether they're trying to. */
  canRun = true;
  wantsToRun = false;
  /** A short action while standing, such as eating something. */
  private gesturePose: Pose | null = null;
  private gestureTime = 0;
  /** The last vehicle the hero was at the wheel of, whatever's become of it. */
  lastDriven: Vehicle | null = null;
  /** Asked to get out while still rolling. */
  private pullUp = false;
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
  /** The door in use for this trip in or out, if the vehicle has one. */
  private door: DoorInfo | null = null;
  private doorPulled = false;
  private doorHand: 1 | -1 | 0 = 0;
  /** A door on its way shut: the hand follows it, and the thunk comes when it gets there. */
  private closing: { v: Vehicle; door: DoorInfo; hand: 1 | -1 | 0 } | null = null;
  /** Who the hero is talking to, from wherever they happen to be. */
  private talkWith: Anchor | null = null;
  private onTalkLeave: (() => void) | null = null;
  /** The hero's line is being said. */
  speaking = false;
  private benchSeat: TeaSeat | null = null;
  private onSeatDone: (() => void) | null = null;
  private seatFrom = new Vector3();
  private sittingDown = false;
  private shutVehicle: Vehicle | null = null;

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
    private interactions: Interactions,
    private hero: HeroKind,
  ) {
    this.spawn = city.region.spawnPoints.default;
    this.x = this.spawn[0];
    this.y = this.spawn[1];
    this.z = this.spawn[2];
    this.yaw = 0;
    const who = (characterAvailable(hero.id) ? hero.id : "hero_mango") as CharacterId;
    this.character = characterAvailable(who) ? new Character(who, scene, shadow) : null;
    this.character?.place(this.x, this.y, this.z, this.yaw);
    rig.snap(this.x, this.y, this.z, 0);
    if (this.character) {
      rig.eyeHeight = this.character.eyeHeight;
      rig.eyeOverHip = this.character.eyeHeight - this.character.hipHeight;
    }
    interactions.add((x, z, _yaw, driving, out) => {
      if (driving) return;
      // Whatever was waved down is the one on offer, even with something else parked closer.
      const wait = this.traffic.waiting;
      const waiting = wait && Math.hypot(wait.x - x, wait.z - z) < 11 ? wait : null;
      const near = waiting ?? this.traffic.nearestVehicle(x, z, 2.4, this.y);
      if (!near) return;
      out.push({ key: "KeyF", html: bn.promptEnter(near.isTaxi ? "taxi" : near.id), priority: 50, run: () => {
        if (near.official || (near.impounded && this.ev.finesOwed() > 0)) this.ev.refused(near);
        else if (!this.hero.drives && near.id !== "bicycle") this.ev.tooYoung();
        else this.beginEnter(near, false);
      } });
      // Only what takes fares: nobody climbs into a stranger's private car.
      if (near.takesFares && !!near.driverId && near.freeSeats > 0) {
        const ride = near.id === "bus_city" ? bn.promptRideBus(near.routeName) : bn.promptRide;
        const hired = near.id !== "bus_city";
        out.push({ key: "KeyG", html: ride, priority: 50, run: () => (hired ? this.ev.hire(near) : this.beginEnter(near, true)) });
      }
    });
  }

  get position(): { x: number; z: number } {
    return this.vehicle ? { x: this.vehicle.x, z: this.vehicle.z } : { x: this.x, z: this.z };
  }

  /** The vehicle under the player's control, not one they are just riding in. */
  get driving(): Vehicle | null {
    return this.stage === "driving" ? this.vehicle : null;
  }

  /** Straight to a spot, up on a platform or wherever the story needs them. */
  warp(x: number, y: number, z: number, yaw: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = yaw;
    this.vx = this.vz = this.vy = 0;
    this.airborne = false;
    this.setStage("foot");
    this.character?.setEnabled(true);
    this.character?.place(x, y, z, yaw);
    this.rig.snap(x, y, z, yaw);
  }

  /** Aboard a train: out of sight, with the view following it down the line. */
  boardTrain(where: () => { x: number; y: number; z: number; heading: number; speed: number }): void {
    this.trainAt = where;
    this.character?.setEnabled(false);
    this.setStage("train");
    this.ev.prompt(null);
    const p = where();
    this.rig.snap(p.x, p.y, p.z, p.heading);
  }

  private trainAt: (() => { x: number; y: number; z: number; heading: number; speed: number }) | null = null;

  /** Does something with their hands for a moment, if they stand still for it. */
  gesture(pose: Pose, seconds: number): void {
    this.gesturePose = pose;
    this.gestureTime = seconds;
  }

  /** Put down somewhere on foot, facing the way they were. */
  standAt(x: number, z: number, y = 0): void {
    this.x = x;
    this.z = z;
    // Up on a walkway if they were up on one, and otherwise on the street, clear of anything solid.
    const deck = y > 1 ? this.city.decks.find(x, z, y, false) : null;
    if (deck) {
      this.y = this.city.decks.heightAt(deck, x, z);
    } else {
      this.city.collision.resolveCircle(x, z, RADIUS, WORK);
      this.x = WORK.x;
      this.z = WORK.z;
      this.y = this.city.layout.groundHeight(this.x, this.z);
    }
    this.character?.place(this.x, this.y, this.z, this.yaw);
    this.rig.snap(this.x, this.y, this.z, this.yaw);
  }

  /** Already at the wheel: arriving somewhere by road. */
  takeWheel(v: Vehicle): void {
    this.traffic.takeOver(v);
    v.rightUp();
    v.driverId = null;
    v.passengers.length = 0;
    v.playerAboard = true;
    this.vehicle = v;
    this.asPassenger = false;
    this.door = null;
    this.audio.startEngine(v.spec.sound);
    this.character?.setPose(v.spec.seatPose, true);
    this.setStage("driving");
    this.placeInSeat(v);
    this.rig.snap(v.x, v.y, v.z, v.heading);
  }

  respawn(): void {
    this.ev.reset();
    this.audio.hornHold("horn", false);
    if (this.vehicle) this.endVehicle();
    if (this.character) {
      this.character.grasp = null;
      this.character.sipping = false;
    }
    this.closing = null;
    this.door = null;
    this.talkWith = null;
    this.benchSeat = null;
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
    // Whatever took the vehicle away, a seat with nothing under it is just standing.
    if (!this.vehicle && (this.stage === "driving" || this.stage === "riding")) this.setStage("foot");

    switch (this.stage) {
      case "thrown":
        this.thrown(dt);
        break;
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
      case "shutDoor":
        this.shutDoor(dt);
        break;
      case "talk":
        this.talk(dt);
        break;
      case "toSeat":
        this.toSeat(dt);
        break;
      case "seated":
        this.seated(dt);
        break;
      case "standUp":
        this.getUp(dt);
        break;
      case "waving":
        this.waving(dt);
        break;
      case "train": {
        const p = this.trainAt!();
        this.x = p.x;
        this.y = p.y;
        this.z = p.z;
        this.rig.updateInVehicle(p.x, p.y + 1, p.z, p.heading, p.speed, 18, 24, 2.6, dt);
        break;
      }
    }
    if (this.stage !== "foot" && this.stage !== "driving") this.interactions.clear();
    // Traffic looks after the doors of everything but the vehicle the hero has taken.
    const taken = this.traffic.playerVehicle;
    if (taken && this.stage !== "driving") taken.updateDoors(dt);
    this.followDoorShut();
    // Conversations and benches keep their over-the-shoulder view.
    const thirdAnyway = this.stage === "talk" || this.stage === "toSeat" || this.stage === "seated" || this.stage === "standUp" || !!this.talkWith;
    this.character?.hideHead(!thirdAnyway && (this.vehicle ? this.rig.firstDrive : this.rig.firstFoot));
    this.character?.update(dt);
  }

  /** Keeps a hand on a door as it closes, and lets it bang when it arrives. */
  private followDoorShut(): void {
    const cl = this.closing;
    if (!cl) return;
    const c = this.character;
    if (cl.v.doorAngle[cl.door.index] <= 0.001) {
      this.audio.door(true);
      if (c) c.grasp = null;
      this.closing = null;
      return;
    }
    if (c && cl.hand !== 0) {
      const h = cl.v.doorHandle(cl.door);
      c.grasp = { side: cl.hand, x: h.x, y: h.y, z: h.z };
    }
  }

  setStage(s: Stage): void {
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

  /** The height underfoot: a raised walkway if the hero is up on one, or else the street. */
  private groundAt(x: number, z: number): number {
    const d = this.city.decks.find(x, z, this.y, false);
    return d ? this.city.decks.heightAt(d, x, z) : this.city.layout.groundHeight(x, z);
  }

  private walk(dt: number): void {
    const input = this.input;
    const f = (input.isDown("KeyW", "ArrowUp") ? 1 : 0) - (input.isDown("KeyS", "ArrowDown") ? 1 : 0);
    const s = (input.isDown("KeyD", "ArrowRight") ? 1 : 0) - (input.isDown("KeyA", "ArrowLeft") ? 1 : 0);
    const cy = Math.cos(this.rig.yaw), sy = Math.sin(this.rig.yaw);
    let dx = sy * f + cy * s;
    let dz = cy * f - sy * s;
    const len = Math.hypot(dx, dz);
    this.wantsToRun = input.isDown("ShiftLeft", "ShiftRight") && len > 0;
    const running = this.wantsToRun && this.canRun;
    const maxSpeed = (len > 0 ? (running ? RUN_SPEED : WALK_SPEED) : 0) * this.hero.pace * this.groundPace * this.loadPace;
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
    // Up on a walkway it's the rails that keep the hero in, not the street's walls and posts.
    const decks = this.city.decks;
    const standing = decks.find(this.x, this.z, this.y, false);
    let onDeck = decks.find(nx, nz, this.y, false);
    if (!onDeck && standing && this.y - this.city.layout.groundHeight(nx, nz) > 0.9) {
      decks.clamp(standing, nx, nz, 0.3, WORK);
      nx = WORK.x;
      nz = WORK.z;
      onDeck = standing;
    }
    if (onDeck) {
      decks.pushOut(nx, nz, RADIUS, this.y, WORK);
    } else this.city.collision.resolveCircle(nx, nz, RADIUS, WORK);
    nx = WORK.x;
    nz = WORK.z;
    this.traffic.blockWalker(nx, nz, RADIUS, OUT, null, this.y);
    // Run into by a moving vehicle: thrown clear with a jump, not hurt, and it gets a piece of the hero's mind.
    const pusher = this.traffic.lastPush;
    if (pusher && this.interactCooldown <= 0) {
      this.interactCooldown = 2.5;
      this.vy = 3.6;
      this.airborne = true;
      this.ev.hitBy(pusher);
    }
    nx = OUT.x;
    nz = OUT.z;
    this.peds.shoveFromPlayer(nx, nz, RADIUS, Math.hypot(this.vx, this.vz), OUT, this.y);
    nx = OUT.x;
    nz = OUT.z;
    // Whatever just shoved the hero mustn't shove them into a wall.
    if (!onDeck) {
      this.city.collision.resolveCircle(nx, nz, RADIUS, WORK);
      nx = WORK.x;
      nz = WORK.z;
    }
    // Velocity follows what actually happened, so sliding along a wall feels right.
    if (dt > 0) {
      this.vx = (nx - this.x) / dt;
      this.vz = (nz - this.z) / dt;
      // Being shoved clear of something isn't running: it mustn't carry on as speed.
      const fast = Math.hypot(this.vx, this.vz);
      if (fast > RUN_SPEED) {
        this.vx *= RUN_SPEED / fast;
        this.vz *= RUN_SPEED / fast;
      }
    }
    this.x = nx;
    this.z = nz;

    const ground = this.groundAt(this.x, this.z);
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
    if (this.rig.firstFoot) {
      // Through their own eyes, they face the way they're looking.
      this.yaw = this.rig.yaw;
    } else if (speed > 0.2) {
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
      if (this.gestureTime > 0) this.gestureTime -= dt;
      const pose: Pose = this.airborne ? "jump" : speed < 0.18 ? (this.gestureTime > 0 && this.gesturePose ? this.gesturePose : "stand") : speed > 3.1 ? "run" : "walk";
      this.setPose(pose, pose === "stand" ? 9 : 14);
      // Lean into acceleration and into turns; a small thing that adds a lot of weight.
      const accelTarget = maxSpeed - speed;
      const leanF = clamp((accelTarget / RUN_SPEED) * 0.32, -0.16, 0.22);
      const leanS = clamp((-turnRate * speed) / 42, -0.2, 0.2);
      c.leanForward += (leanF - c.leanForward) * (1 - Math.exp(-dt * 8));
      c.leanSide += (leanS - c.leanSide) * (1 - Math.exp(-dt * 8));
      c.place(this.x, this.y, this.z, this.yaw);
    }
    this.rig.updateOnFoot(this.x, this.y, this.z, speed > 0.5, dt, speed);
    this.audio.footsteps(speed, this.airborne, dt);

    // What can be done here?
    this.ev.prompt(this.interactions.update(this.x, this.z, this.yaw, false, (code) => input.pressed(code)));
  }

  // ---------------------------------------------------------------- talking

  /** Turns to whoever it is and stays put. On a bench or in a vehicle the hero stays where they are. */
  beginTalk(who: Anchor, onLeave: () => void): void {
    this.talkWith = who;
    this.onTalkLeave = onLeave;
    this.vx = this.vz = 0;
    this.ev.prompt(null);
    if (this.stage === "foot") this.setStage("talk");
  }

  endTalk(): void {
    this.talkWith = null;
    this.onTalkLeave = null;
    this.speaking = false;
    if (this.stage === "talk") this.setStage("foot");
  }

  private talk(dt: number): void {
    const who = this.talkWith;
    if (!who) {
      this.setStage("foot");
      return;
    }
    if (this.stageTime > 0.25 && this.input.isDown(...LEAVE_KEYS)) {
      this.onTalkLeave?.();
      return;
    }
    this.yaw = turnTo(this.yaw, Math.atan2(who.x - this.x, who.z - this.z), 1 - Math.exp(-dt * 8));
    const c = this.character;
    if (c) {
      c.speed = 0;
      this.setPose(this.speaking ? "talk" : "stand", 9);
      c.leanForward *= Math.exp(-dt * 8);
      c.leanSide *= Math.exp(-dt * 8);
      c.place(this.x, this.y, this.z, this.yaw);
    }
    this.rig.updateTalk(this.x, this.y, this.z, who.x, who.z, dt);
  }

  // ---------------------------------------------------------------- waving something down

  wave(): void {
    if (this.stage !== "foot") return;
    this.vx = this.vz = 0;
    this.ev.prompt(null);
    this.setStage("waving");
  }

  private waving(dt: number): void {
    const c = this.character;
    if (c) {
      c.speed = 0;
      this.setPose("wave", 12);
      c.place(this.x, this.y, this.z, this.yaw);
    }
    this.rig.updateOnFoot(this.x, this.y, this.z, false, dt);
    if (this.stageTime > WAVE_SECONDS || (this.stageTime > 0.3 && this.input.isDown(...MOVE_KEYS))) this.setStage("foot");
  }

  // ---------------------------------------------------------------- on a bench

  /** Walks to a place on a bench and sits down. */
  sitAt(seat: TeaSeat, done: () => void): void {
    this.benchSeat = seat;
    this.onSeatDone = done;
    this.sittingDown = false;
    this.vx = this.vz = 0;
    this.ev.prompt(null);
    this.setStage("toSeat");
  }

  sipping(on: boolean): void {
    if (this.character) this.character.sipping = on;
  }

  /** Stands up from the bench, and lets the player move again. */
  standUp(done: () => void): void {
    this.onSeatDone = done;
    this.seatFrom.set(this.x, this.y, this.z);
    this.setPose("stand", 8);
    this.setStage("standUp");
  }

  /** The spot just in front of a bench, where someone stands before sitting. */
  private benchFront(seat: TeaSeat): { x: number; z: number } {
    return { x: seat.x + Math.sin(seat.yaw) * 0.42, z: seat.z + Math.cos(seat.yaw) * 0.42 };
  }

  private toSeat(dt: number): void {
    const seat = this.benchSeat!;
    const c = this.character;
    const front = this.benchFront(seat);
    const dx = front.x - this.x, dz = front.z - this.z;
    const d = Math.hypot(dx, dz);
    const hip = c?.hipHeight ?? 0.5;
    // A few steps over, a turn, and down onto the bench.
    if (!this.sittingDown) {
      if (d > 0.12 && this.stageTime < 3.5) {
        const step = Math.min(WALK_SPEED * 1.25 * dt, d);
        this.x += (dx / d) * step;
        this.z += (dz / d) * step;
        this.y += (this.groundAt(this.x, this.z) - this.y) * (1 - Math.exp(-dt * 16));
        this.yaw = turnTo(this.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * 10));
        if (c) {
          c.speed = WALK_SPEED * 1.25;
          this.setPose("walk", 12);
          c.place(this.x, this.y, this.z, this.yaw);
        }
        this.rig.updateOnFoot(this.x, this.y, this.z, true, dt);
        return;
      }
      this.sittingDown = true;
      this.seatFrom.set(this.x, this.y, this.z);
      this.stageTime = 0;
    }
    const k = clamp(this.stageTime / SIT_DOWN, 0, 1);
    const e = smooth(k);
    this.x = this.seatFrom.x + (seat.x - this.seatFrom.x) * e;
    this.z = this.seatFrom.z + (seat.z - this.seatFrom.z) * e;
    this.y = this.seatFrom.y + (seat.y - hip - this.seatFrom.y) * e;
    this.yaw = turnTo(this.yaw, seat.yaw, 1 - Math.exp(-dt * 9));
    if (c) {
      c.speed = 0;
      this.setPose(k > 0.3 ? "sit_tea" : "stand", 9);
      c.place(this.x, this.y, this.z, this.yaw);
    }
    this.rig.updateSeated(this.x, this.y, this.z, dt);
    if (k >= 1) {
      this.setStage("seated");
      this.onSeatDone?.();
    }
  }

  private seated(dt: number): void {
    const c = this.character;
    if (c) {
      c.speed = 0;
      this.setPose("sit_tea", 8);
      c.place(this.x, this.y, this.z, this.yaw);
    }
    const who = this.talkWith;
    if (who) {
      this.rig.updateTalk(this.x, this.y, this.z, who.x, who.z, dt);
      if (this.input.isDown(...LEAVE_KEYS)) this.onTalkLeave?.();
    } else this.rig.updateSeated(this.x, this.y, this.z, dt);
  }

  private getUp(dt: number): void {
    const seat = this.benchSeat;
    const c = this.character;
    const k = clamp(this.stageTime / SIT_DOWN, 0, 1);
    const e = smooth(k);
    if (seat) {
      const front = this.benchFront(seat);
      const ground = this.groundAt(front.x, front.z);
      this.x = this.seatFrom.x + (front.x - this.seatFrom.x) * e;
      this.z = this.seatFrom.z + (front.z - this.seatFrom.z) * e;
      this.y = this.seatFrom.y + (ground - this.seatFrom.y) * e;
    }
    if (c) {
      c.speed = 0;
      this.setPose("stand", 8);
      c.place(this.x, this.y, this.z, this.yaw);
    }
    this.rig.updateOnFoot(this.x, this.y, this.z, false, dt);
    if (k >= 1) {
      this.benchSeat = null;
      this.setStage("foot");
      const done = this.onSeatDone;
      this.onSeatDone = null;
      done?.();
    }
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

  /** Which side of the vehicle the hero is on: positive is its right. */
  private sideOf(v: Vehicle): number {
    return (this.x - v.x) * Math.cos(v.heading) - (this.z - v.z) * Math.sin(v.heading);
  }

  /** The nearest empty passenger seat, by how far it is from the hero's side of the vehicle. */
  private pickSeat(v: Vehicle): number {
    const taken = new Set(v.passengers.map((p) => p.seat));
    const side = this.sideOf(v) >= 0 ? 1 : -1;
    let best = -1, score = Infinity;
    v.arch.passengerSeats.forEach((seat, i) => {
      if (taken.has(i)) return;
      // Near side first, then front to back.
      const q = (Math.sign(seat.position.x) === side ? 0 : 100) - seat.position.z;
      if (q < score) {
        score = q;
        best = i;
      }
    });
    return best;
  }

  beginEnter(v: Vehicle, passenger: boolean): void {
    this.vehicle = v;
    this.asPassenger = passenger;
    this.vx = this.vz = 0;
    if (v.mode === "ai") {
      // Flagging it down: the driver pulls up rather than stopping dead.
      v.holdTime = Math.max(v.holdTime, 12);
    }
    if (this.traffic.waiting === v) this.traffic.waiting = null;
    this.seatIndex = passenger ? this.pickSeat(v) : -1;
    if (passenger && this.seatIndex >= 0) this.door = v.arch.passengerDoor(v.arch.passengerSeats[this.seatIndex].position.x);
    else this.door = v.arch.driverDoor(this.sideOf(v));
    this.doorPulled = false;
    this.doorHand = 0;
    this.ev.prompt(null);
    this.setStage("approach");
  }

  /** Where to stand to use the door: an arm's length from the handle, just past its free edge. */
  private doorStand(door: DoorInfo): Vector3 {
    const out = Math.sign(door.pivot.x);
    return new Vector3(door.pivot.x + out * (door.inward ? 0.3 : 0.36), 0, door.pivot.z + door.handle.z + door.extent * 0.12);
  }

  /** Where someone ends up after climbing out: further back than `doorStand`, clear of the open door. */
  private doorExit(door: DoorInfo): Vector3 {
    return new Vector3(door.pivot.x + Math.sign(door.pivot.x) * 0.5, 0, door.pivot.z + door.handle.z + door.extent * 0.3);
  }

  private currentDoorTarget(): Vector3 {
    const v = this.vehicle!;
    const door = this.door;
    if (door) return v.worldPoint(this.doorStand(door));
    return v.worldPoint(this.boardingPoint(v, this.asPassenger));
  }

  /** Jogging up to the door. Moving away cancels it, as in any good open-world game. */
  private approach(dt: number): void {
    const v = this.vehicle!;
    const input = this.input;
    if (this.stageTime > 0.25 && input.isDown(...MOVE_KEYS)) {
      if (v.mode === "ai") v.holdTime = 0;
      this.vehicle = null;
      this.setStage("foot");
      return;
    }
    const t = this.currentDoorTarget();
    const dx = t.x - this.x, dz = t.z - this.z;
    const dist = Math.hypot(dx, dz);
    if (dist < (this.door ? 0.07 : 0.3) && Math.abs(v.speed) < 0.5) {
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
    this.y += (this.groundAt(this.x, this.z) - this.y) * (1 - Math.exp(-dt * 16));
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

  /** Which hand reaches the door most easily from here: the one on the side of its hinge. */
  private handFor(v: Vehicle, door: DoorInfo): 1 | -1 {
    const hinge = v.worldPoint(door.pivot);
    const right = (hinge.x - this.x) * Math.cos(this.yaw) - (hinge.z - this.z) * Math.sin(this.yaw);
    return right >= 0 ? -1 : 1;
  }

  /** Up to the door: a hand on the handle, then haul it open, leaning back as it comes. */
  private openDoor(dt: number): void {
    const v = this.vehicle!;
    const c = this.character;
    const door = this.door;
    const t = this.stageTime;
    if (!door) {
      const target = v.worldPoint(v.arch.driverSeat);
      this.yaw = turnTo(this.yaw, Math.atan2(target.x - this.x, target.z - this.z), 1 - Math.exp(-dt * 10));
      if (c) {
        c.speed = 0;
        this.setPose("stand", 11);
        c.place(this.x, this.y, this.z, this.yaw);
      }
      this.rig.updateOnFoot(this.x, this.y, this.z, false, dt);
      if (t >= 0.18) this.afterDoor(v);
      return;
    }
    const i = door.index;
    const h = v.doorHandle(door);
    this.yaw = turnTo(this.yaw, Math.atan2(h.x - this.x, h.z - this.z), 1 - Math.exp(-dt * 12));
    const alreadyOpen = !this.doorPulled && v.doorAngle[i] > 0.3;
    if (c) {
      c.speed = 0;
      this.setPose("pull", 12);
      c.blendRate = 14;
      // Decided once: the arms mustn't swap as the body turns.
      if (!this.doorHand) this.doorHand = this.handFor(v, door);
      c.grasp = { side: this.doorHand, x: h.x, y: h.y, z: h.z };
      c.place(this.x, this.y, this.z, this.yaw);
    }
    this.rig.updateOnFoot(this.x, this.y, this.z, false, dt);
    if (t < HAND_TO_DOOR) return;
    if (!alreadyOpen) {
      if (!this.doorPulled) {
        this.doorPulled = true;
        this.audio.door(false);
      }
      const k = clamp((t - HAND_TO_DOOR) / DOOR_PULL, 0, 1);
      // The hand can only follow so far before the door has swung out of reach.
      const arc = Math.abs(door.handle.z) * door.swing;
      const followed = door.inward ? 0.45 : clamp(0.6 / arc, 0.35, 1);
      v.doorAngle[i] = v.doorGoal[i] = door.swing * followed * smooth(k);
      // A step back and out of its way as it comes.
      if (!door.inward && k < 1) {
        const away = (0.3 * dt) / DOOR_PULL;
        const out = Math.sign(door.pivot.x) * 0.45;
        this.x += (Math.sin(v.heading) * door.extent + Math.cos(v.heading) * out) * away;
        this.z += (Math.cos(v.heading) * door.extent - Math.sin(v.heading) * out) * away;
      }
      if (k < 1) return;
    }
    // Let go, and it swings the rest of the way by itself.
    v.doorGoal[i] = door.swing;
    if (c) c.grasp = null;
    this.afterDoor(v);
  }

  private afterDoor(v: Vehicle): void {
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
    const driver = this.peds.driverLeaves(id, seat, v.spec.seatPose, ox, oz, v.heading);
    this.ev.line(this.rng.pick(v.passengers.length > 3 ? bn.busPassengers : bn.driverLeaves), driver, id, 1.72);
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
      // Someone may have taken the seat in the time it took to get here.
      if (this.seatIndex < 0 || v.passengers.some((p) => p.seat === this.seatIndex)) this.seatIndex = this.pickSeat(v);
      if (this.seatIndex < 0) {
        // Full up: back to the footpath.
        if (v.mode === "ai") v.holdTime = 0;
        if (this.door) v.doorGoal[this.door.index] = 0;
        this.vehicle = null;
        this.door = null;
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
    this.seatCamera(v, 0, dt);
    // Sat down: reach out and pull the door to. The bus's door folds shut by itself.
    const door = this.door;
    if (door && !this.closing && k > 0.72 && v.doorGoal[door.index] !== 0) this.pullShut(v, door);
    if (k >= 1) {
      if (c) c.blendRate = 12;
      this.setStage(this.asPassenger ? "riding" : "driving");
      if (this.asPassenger) this.ev.seated(v);
      if (this.asPassenger && v.mode === "ai") v.holdTime = 0;
    }
  }

  private pullShut(v: Vehicle, door: DoorInfo): void {
    v.doorGoal[door.index] = 0;
    this.closing = { v, door, hand: door.inward ? 0 : door.pivot.x >= 0 ? -1 : 1 };
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

  /** On a bike a hard knock puts it on its side. The hero comes off, lands unhurt on their feet, and
   *  it lies where it fell until someone picks it up. */
  private thrownOff(v: Vehicle, was: number): void {
    const side = this.rng.chance(0.5) ? 1 : -1;
    v.fall(side);
    this.audio.hornHold(v.spec.horn, false);
    const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
    const seat = v.worldPoint(this.seatLocal().pos);
    const on = Math.max(-3, Math.min(was * 0.32, 5));
    this.flyX = sh * on - ch * side * 1.5;
    this.flyZ = ch * on + sh * side * 1.5;
    this.flyY = 1.8;
    this.endVehicle();
    this.x = seat.x;
    this.z = seat.z;
    this.y = seat.y - (this.character?.hipHeight ?? 0.5);
    this.setPose("dodge", 12);
    this.setStage("thrown");
  }

  private thrown(dt: number): void {
    this.flyY -= 9.8 * dt;
    this.y += this.flyY * dt;
    const k = Math.exp(-dt * (this.flyY === 0 ? 7 : 0.6));
    this.flyX *= k;
    this.flyZ *= k;
    this.city.collision.resolveCircle(this.x + this.flyX * dt, this.z + this.flyZ * dt, RADIUS, WORK);
    this.traffic.blockWalker(WORK.x, WORK.z, RADIUS, OUT, null, this.y);
    this.x = OUT.x;
    this.z = OUT.z;
    const ground = this.groundAt(this.x, this.z);
    if (this.y <= ground) {
      this.y = ground;
      this.flyY = 0;
      this.setPose("crouch", 10);
    }
    if (this.stageTime > 1.05) this.setPose("stand", 8);
    this.character?.place(this.x, this.y, this.z, this.yaw);
    this.rig.updateOnFoot(this.x, this.y, this.z, false, dt);
    if (this.stageTime > 1.4) this.setStage("foot");
  }

  private driveVehicle(dt: number): void {
    const v = this.vehicle!;
    const input = this.input;
    const was = v.speed;
    const throttle = (input.isDown("KeyW", "ArrowUp") ? 1 : 0) - (input.isDown("KeyS", "ArrowDown") ? 1 : 0);
    const steer = (input.isDown("KeyD", "ArrowRight") ? 1 : 0) - (input.isDown("KeyA", "ArrowLeft") ? 1 : 0);
    // Having words through the window: stay put, and pulling away ends it.
    const talking = !!this.talkWith;
    if (talking && input.isDown(...LEAVE_KEYS)) this.onTalkLeave?.();
    const decks = this.city.decks;
    const margin = v.spec.width * 0.5 + 0.1;
    const wasOn = decks.find(v.x, v.z, v.y, true, margin);
    // Getting out: stop first.
    if (this.pullUp && Math.abs(v.speed) < 0.7) {
      this.pullUp = false;
      this.beginExit();
      return;
    }
    if (input.isDown(...MOVE_KEYS)) this.pullUp = false;
    const hold = talking || this.pullUp;
    v.drive({ throttle: hold ? (this.pullUp ? -Math.sign(v.speed) : 0) : throttle, steer: hold ? 0 : steer, handbrake: talking || input.isDown("Space") }, dt, wasOn ? null : this.city.collision, (x, z) => {
      const d = decks.find(x, z, v.y, true);
      return d ? decks.heightAt(d, x, z) : this.city.layout.groundHeight(x, z);
    });
    // Up on the flyover the parapets are what stop it.
    if (wasOn && !decks.find(v.x, v.z, v.y, true, margin) && v.y - this.city.layout.groundHeight(v.x, v.z) > 0.9) {
      decks.clamp(wasOn, v.x, v.z, margin, WORK);
      const hit = Math.hypot(v.x - WORK.x, v.z - WORK.z) / Math.max(dt, 0.001);
      v.x = WORK.x;
      v.z = WORK.z;
      v.speed *= 0.985;
      v.sideSpeed *= 0.5;
      if (hit > 5) v.lastImpact = Math.max(v.lastImpact, hit * 0.5);
    }
    v.updateDoors(dt);

    const vehicleHit = this.traffic.collidePlayerVehicle(v);
    const impact = Math.max(v.lastImpact, vehicleHit);
    const hitVehicle = vehicleHit >= v.lastImpact ? this.traffic.lastHit : null;
    v.lastImpact = 0;
    if (impact > 2) {
      this.rig.kick(Math.min(impact / 12, 1));
      this.audio.impact(Math.min(impact / 12, 1));
      this.ev.crash(v, impact, hitVehicle);
      if (v.tips && impact >= THROWN_OFF) {
        this.thrownOff(v, was);
        return;
      }
    }
    this.placeInSeat(v);
    const c = this.character;
    if (c) {
      c.speed = Math.abs(v.speed);
      c.steer = v.steerAngle;
      c.leanForward = 0;
      c.leanSide = 0;
    }
    this.seatCamera(v, v.speed, dt);
    this.audio.engine(Math.abs(v.speed) / v.spec.topSpeed, throttle !== 0);
    // The H key or the left mouse button, in case a keyboard can't take H along with the others held.
    this.audio.hornHold(v.spec.horn, input.isDown("KeyH") || (input.locked && input.dragging));
    if (v.y < 2) this.checkRedLight(v);
    if (talking) return;
    const offer = this.interactions.update(v.x, v.z, v.heading, true, (code) => input.pressed(code));
    const exit = Math.abs(v.speed) < 3 ? bn.promptExit : null;
    this.ev.prompt(offer && exit ? `${exit} &nbsp; ${offer}` : offer ?? exit);
    if (input.pressed("KeyF")) {
      if (Math.abs(v.speed) < 0.7) this.beginExit();
      else if (Math.abs(v.speed) < 9) this.pullUp = true;
    }
  }

  /** The view from a vehicle: trailing behind it, or out through the hero's own eyes from their seat. */
  private seatCamera(v: Vehicle, speed: number, dt: number): void {
    if (!this.rig.firstDrive) {
      this.rig.updateInVehicle(v.x, v.y, v.z, v.heading, speed, v.spec.topSpeed, v.spec.camDistance, v.spec.camHeight, dt);
      return;
    }
    const seat = this.asPassenger && this.seatIndex >= 0 ? v.arch.passengerSeats[this.seatIndex]?.position ?? v.arch.driverSeat : v.arch.driverSeat;
    const eye = v.worldPoint(EYE.set(seat.x, seat.y + this.rig.eyeOverHip, seat.z + 0.1));
    this.rig.updateEyes(eye.x, eye.y + v.bump * 0.08 + v.fallLift, eye.z, v.heading, speed, v.spec.topSpeed, dt);
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
    this.seatCamera(v, v.speed, dt);
    const stopped = Math.abs(v.speed) < 0.6;
    this.ev.prompt(this.talkWith ? null : stopped ? bn.promptExit : bn.promptStop);
    if (!this.talkWith && this.input.pressed("KeyF")) {
      if (stopped) this.beginExit();
      else {
        // Ask the driver to pull over: they stop as soon as they safely can.
        v.holdTime = 5;
        this.ev.line(bn.askStop, this, "hero_mango", 1.2);
      }
    }
  }

  // ---------------------------------------------------------------- getting out

  private beginExit(): void {
    const v = this.vehicle!;
    this.audio.hornHold(v.spec.horn, false);
    const c = this.character;
    const seatX = this.seatLocal().pos.x;
    let door = this.asPassenger ? v.arch.passengerDoor(seatX) : v.arch.driverDoor(seatX === 0 ? 1 : seatX);
    const local = door && !door.inward ? this.doorExit(door) : this.boardingPoint(v, this.asPassenger);
    let exit = v.worldPoint(local);
    // A wall, or another vehicle pulled up alongside; up on the flyover, the parapet.
    const decks = this.city.decks;
    const high = v.y > 1.5;
    const room = (p: Vector3): boolean => {
      this.traffic.blockWalker(p.x, p.z, RADIUS, OUT, v, v.y);
      if (Math.hypot(OUT.x - p.x, OUT.z - p.z) > 0.01) return false;
      if (high) return !!decks.find(p.x, p.z, v.y, false, 0.3);
      this.city.collision.resolveCircle(p.x, p.z, RADIUS, WORK);
      return !WORK.hit;
    };
    if (!room(exit)) {
      // No room on this side. The other side has a door of its own on some vehicles.
      const across = this.asPassenger ? v.arch.passengerDoor(-seatX) : v.arch.driverDoor(seatX === 0 ? -1 : -seatX);
      door = across && across !== door ? across : null;
      // Something's in the way on this side, so use the other one.
      const other = v.worldPoint(door ? this.doorExit(door) : local === v.arch.exitLeft ? v.arch.exitRight : v.arch.exitLeft);
      if (room(other)) exit = other;
      else if (high) {
        const on = decks.find(v.x, v.z, v.y, false);
        if (on) decks.clamp(on, exit.x, exit.z, 0.4, WORK);
        exit.x = WORK.x;
        exit.z = WORK.z;
      } else {
        this.city.collision.resolveCircle(exit.x, exit.z, RADIUS, WORK);
        this.traffic.blockWalker(WORK.x, WORK.z, RADIUS, OUT, v, v.y);
        exit.x = OUT.x;
        exit.z = OUT.z;
      }
    }
    const onDeck = decks.find(exit.x, exit.z, v.y, false);
    this.toPos.set(exit.x, onDeck ? decks.heightAt(onDeck, exit.x, exit.z) : this.city.layout.groundHeight(exit.x, exit.z), exit.z);
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
    if (!this.asPassenger) this.audio.stopEngine();
    this.door = door;
    this.closing = null;
    if (door) {
      v.doorGoal[door.index] = door.swing;
      this.audio.door(false);
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
    const door = this.door;
    const delay = door ? 0.3 : 0.05;
    // A hand pushes the door open from the inside before anyone moves.
    if (c && door && !door.inward) {
      const h = v.doorHandle(door);
      c.grasp = this.stageTime < delay ? { side: door.pivot.x >= 0 ? -1 : 1, x: h.x, y: h.y, z: h.z } : null;
    }
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
      this.y = this.toPos.y;
      if (door && !door.inward) {
        this.shutVehicle = v;
        this.endVehicle();
        this.setStage("shutDoor");
        return;
      }
      if (door) v.doorGoal[door.index] = 0;
      this.endVehicle();
      this.door = null;
      this.setStage("foot");
    }
  }

  /** Out, then a turn back to push the door shut. Walking off leaves it to swing to by itself. */
  private shutDoor(dt: number): void {
    const v = this.shutVehicle;
    const door = this.door;
    const c = this.character;
    if (!v || !door || this.stageTime > DOOR_SHUT + 0.35 || this.input.isDown(...MOVE_KEYS)) {
      if (v && door) {
        v.doorGoal[door.index] = 0;
        if (!this.closing) this.closing = { v, door, hand: 0 };
        else this.closing.hand = 0;
      }
      if (c) c.grasp = null;
      this.shutVehicle = null;
      this.door = null;
      this.setStage("foot");
      return;
    }
    const h = v.doorHandle(door);
    this.yaw = turnTo(this.yaw, Math.atan2(h.x - this.x, h.z - this.z), 1 - Math.exp(-dt * 11));
    if (c) {
      c.speed = 0;
      this.setPose("pull", 12);
      c.place(this.x, this.y, this.z, this.yaw);
    }
    this.rig.updateOnFoot(this.x, this.y, this.z, false, dt);
    // Turned round and got a hand to it: now it can go.
    if (this.stageTime > 0.22 && !this.closing) {
      v.doorGoal[door.index] = 0;
      this.closing = { v, door, hand: this.handFor(v, door) };
    }
  }

  endVehicle(): void {
    const v = this.vehicle;
    if (!v) return;
    this.ev.gotOut(v);
    if (this.asPassenger) {
      v.passengers = v.passengers.filter((p) => !p.hidden);
      v.playerAboard = false;
    } else {
      this.traffic.release(v);
      this.lastDriven = v;
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
        this.ev.ranRed();
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
