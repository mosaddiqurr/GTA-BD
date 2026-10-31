import { bn, bnNum } from "../localization/bn";
import type { AudioSystem } from "../audio/audio";
import type { Pedestrians, Person } from "../npc/pedestrians";
import type { Player } from "../player/player";
import type { TrafficSystem } from "../traffic/trafficSystem";
import type { Anchor, Hud } from "../ui/hud";
import type { Vehicle } from "../vehicles/vehicle";
import type { City } from "../world/city";
import { seatAnchor } from "./trips";
import type { Talk } from "./talk";

/** Fines the hero owes, kept with the saved game. */
export interface Ticket {
  why: string;
  amount: number;
}

const PATROLS = 3;
const PATROL_RANGE = 240;
/** How long something can sit in a running lane before someone comes for it, in seconds. */
const TOW_AFTER = 40;
const FOOTPATH_SECONDS = 2.2;
const STOPPED_FOR = 8;

type Say = (text: string, anchor: Anchor, id: string, top: number) => void;

/** The law: patrol cars on the road, an officer who gets out to have a word when the hero does something
 *  wrong, and a wrecker for anything left blocking a lane. Nobody here is armed and nobody gets hurt: the
 *  worst that happens is a fine, and a long walk to the station to get the vehicle back. */
export class PoliceForce {
  private patrols: Vehicle[] = [];
  private spawnCool = 2;
  private footpathTime = 0;
  private complaint: string | null = null;
  private complaintAmount = 0;
  private chaser: Vehicle | null = null;
  private chaseTime = 0;
  private officer: Person | null = null;
  private officerFrom: Vehicle | null = null;
  private cool = 0;
  private wrecker: { v: Vehicle; target: Vehicle; state: "going" | "towing"; time: number } | null = null;
  private lastInLane = new Map<Vehicle, number>();
  private scanTimer = 0;

  constructor(
    private city: City,
    private traffic: TrafficSystem,
    private player: Player,
    private peds: Pedestrians,
    private hud: Hud,
    private audio: AudioSystem,
    private talk: Talk,
    private tickets: Ticket[],
    private say: Say,
    private saveNow: () => void,
  ) {
    traffic.onPoliceArrived = (v) => this.arrived(v);
  }

  /** Something was just seen. Most of it only matters if somebody with a badge was looking. */
  /** The officer's just got to the hero. */
  onStopped: ((ticket: (why: string, amount: number) => void) => void) | null = null;
  /** How many times they've come after the hero lately. */
  reports = 0;

  get chasing(): boolean {
    return !!this.chaser;
  }

  report(why: string, amount: number, seenBy: "post" | "any" = "any"): void {
    if (this.cool > 0 || this.complaint) return;
    this.reports++;
    const near = this.patrols.find((q) => q.mode === "ai" && Math.hypot(q.x - this.player.x, q.z - this.player.z) < 70);
    if (!near && seenBy !== "post") return;
    this.complaint = why;
    this.complaintAmount = amount;
    this.cool = 40;
    if (near) {
      this.chaser = near;
      this.chaseTime = 0;
      near.flashing = true;
      this.hud.say(bn.law.flashed, 3);
      this.audio.whistle();
    } else {
      // An officer on the junction saw it. A whistle, and it goes on the record.
      this.addTicket(why, amount);
      this.complaint = null;
    }
  }

  private addTicket(why: string, amount: number): void {
    this.tickets.push({ why, amount });
    this.saveNow();
    this.hud.say(bn.law.ticketed(why, bnNum(amount)), 4.2);
  }

  get owed(): number {
    return this.tickets.reduce((n, t) => n + t.amount, 0);
  }

  update(dt: number): void {
    if (this.cool > 0) this.cool -= dt;
    this.keepPatrols(dt);
    this.watchHero(dt);
    this.stepChase(dt);
    this.stepTow(dt);
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 2;
      this.scanForBlockers();
    }
  }

  /** A few patrol cars always somewhere about, going where traffic goes. */
  private keepPatrols(dt: number): void {
    this.spawnCool -= dt;
    const x = this.traffic.playerX, z = this.traffic.playerZ;
    this.patrols = this.patrols.filter((q) => q.mode === "ai" && this.traffic.vehicles.includes(q));
    if (this.spawnCool > 0 || this.patrols.length >= PATROLS) return;
    this.spawnCool = 6;
    const v = this.traffic.spawnNear("police_car", x, z, PATROL_RANGE);
    if (v) {
      v.driverId = "npc_police_coconut";
      v.passengers.length = 0;
      v.hangers.length = 0;
      this.patrols.push(v);
    }
  }

  /** Driving along the footpath, or through someone's stall. */
  private watchHero(dt: number): void {
    const v = this.player.vehicle;
    if (!v || !this.player.driving) {
      this.footpathTime = 0;
      return;
    }
    const onPath = this.city.layout.blockAt(v.x, v.z) && Math.abs(v.speed) > 1.5;
    this.footpathTime = onPath ? this.footpathTime + dt : Math.max(0, this.footpathTime - dt * 0.5);
    if (this.footpathTime > FOOTPATH_SECONDS) {
      this.footpathTime = 0;
      this.report(bn.law.why.footpath, 500);
    }
  }

  /** The patrol comes up behind and, once the hero's stopped, an officer gets out. */
  private stepChase(dt: number): void {
    const c = this.chaser;
    if (!c) return;
    this.chaseTime += dt;
    const hero = this.player.vehicle ?? this.player;
    const d = Math.hypot(c.x - hero.x, c.z - hero.z);
    this.traffic.setDestination(c, hero.x, hero.z);
    const stopped = !this.player.vehicle || Math.abs(this.player.vehicle.speed) < 1;
    if (this.officer) return;
    if (d < 14 && stopped) {
      this.chaseTime = Math.max(this.chaseTime, STOPPED_FOR);
      c.holdTime = 30;
      this.traffic.clearDestination(c);
      this.getOut(c);
      return;
    }
    // Lost them. They've got the number plate.
    if (this.chaseTime > 45 || d > 170) {
      this.addTicket(this.complaint ?? bn.law.why.fled, this.complaintAmount * 2);
      this.endChase();
    }
  }

  private getOut(c: Vehicle): void {
    const who = this.peds.driverComplains(c, this.player.x, this.player.z);
    this.officer = who;
    this.officerFrom = c;
    this.after(1.8, () => {
      if (!who) {
        this.endChase();
        return;
      }
      this.say(bn.law.approach, who, who.id, 1.72);
      this.onStopped?.((why, amount) => this.addTicket(why, amount));
      this.talk.pulledOver(who, this.complaint ?? bn.law.why.footpath, this.complaintAmount, (paid) => {
        if (!paid) this.addTicket(this.complaint ?? bn.law.why.footpath, this.complaintAmount);
        this.endChase();
      });
    });
  }

  private endChase(): void {
    if (this.chaser) this.chaser.flashing = false;
    this.chaser = null;
    this.officer = null;
    this.officerFrom = null;
    this.complaint = null;
  }

  private later: { t: number; run: () => void }[] = [];
  private after(t: number, run: () => void): void {
    this.later.push({ t, run });
  }

  /** Called at the end of each frame's updates, for what was put off. */
  tick(dt: number): void {
    for (let i = this.later.length - 1; i >= 0; i--) {
      this.later[i].t -= dt;
      if (this.later[i].t <= 0) {
        const run = this.later[i].run;
        this.later.splice(i, 1);
        run();
      }
    }
  }

  // ---------------------------------------------------------------- towing

  /** Anything standing in a lane with nobody at the wheel gets noticed in the end. */
  private scanForBlockers(): void {
    for (const v of this.traffic.parked) {
      if (v === this.player.vehicle) continue;
      if (!this.traffic.standingInLane(v)) {
        this.lastInLane.delete(v);
        continue;
      }
      const since = (this.lastInLane.get(v) ?? 0) + 2;
      this.lastInLane.set(v, since);
      if (since >= TOW_AFTER && !this.wrecker && Math.hypot(v.x - this.player.x, v.z - this.player.z) < 220) this.sendWrecker(v);
    }
  }

  private sendWrecker(target: Vehicle): void {
    const w = this.traffic.spawnNear("wrecker", target.x, target.z, 180);
    if (!w) {
      // Nothing free nearby. It's gone by the time anyone looks again.
      if (Math.hypot(target.x - this.player.x, target.z - this.player.z) > 60) this.impound(target);
      return;
    }
    w.driverId = "npc_police_coconut";
    w.passengers.length = 0;
    w.hangers.length = 0;
    w.flashing = true;
    this.wrecker = { v: w, target, state: "going", time: 0 };
    this.traffic.setDestination(w, target.x, target.z, true);
  }

  private arrived(v: Vehicle): void {
    const t = this.wrecker;
    if (!t || t.v !== v) return;
    if (t.state === "going") {
      t.state = "towing";
      t.time = 0;
      v.holdTime = 2.5;
      this.say(bn.law.towing, seatAnchor(v), "npc_police_coconut", 0.4);
      const yard = this.city.thanaYard;
      if (yard) this.traffic.setDestination(v, yard.x, yard.z, true);
    } else {
      this.impound(t.target);
      v.flashing = false;
      this.wrecker = null;
    }
  }

  private stepTow(dt: number): void {
    const t = this.wrecker;
    if (!t) return;
    t.time += dt;
    if (t.v.mode !== "ai" || !this.traffic.vehicles.includes(t.v)) {
      this.wrecker = null;
      return;
    }
    if (t.state === "towing") {
      // On the hook behind it, nose in the air.
      const v = t.v, q = t.target;
      const back = v.spec.length * 0.5 + q.spec.length * 0.5 + 0.5;
      const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
      q.x = v.x - sh * back;
      q.z = v.z - ch * back;
      q.heading = v.heading;
      q.y = v.y;
      q.pitch = -0.07;
      this.lastInLane.delete(q);
    } else if (t.time > 170) {
      this.traffic.clearDestination(t.v);
      t.v.flashing = false;
      this.wrecker = null;
    }
    if (t.time > 320) {
      this.impound(t.target);
      this.traffic.clearDestination(t.v);
      t.v.flashing = false;
      this.wrecker = null;
    }
  }

  /** Lined up in the station yard. If it's the hero's, it's theirs again for a fine. */
  private impound(v: Vehicle): void {
    const yard = this.city.thanaYard;
    this.lastInLane.delete(v);
    if (!yard) return;
    const n = this.traffic.parked.filter((q) => q.impounded).length;
    v.x = yard.x + (n % 5) * 3.4 - 7;
    v.z = yard.z + Math.floor(n / 5) * 6;
    v.heading = yard.angle;
    v.y = yard.y;
    v.pitch = 0;
    v.impounded = true;
    v.knockX = v.knockZ = v.spin = 0;
    if (v === this.player.lastDriven) {
      this.tickets.push({ why: bn.law.why.towed, amount: 800 });
      this.saveNow();
      this.hud.say(bn.law.yourTowed, 5);
    }
  }
}
