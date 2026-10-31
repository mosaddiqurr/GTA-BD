import type { Environment } from "../graphics/environment";
import { bn, bnNum } from "../localization/bn";
import type { Pedestrians, Person } from "../npc/pedestrians";
import type { Player } from "../player/player";
import type { Input } from "../player/input";
import type { Choice, Hud } from "../ui/hud";
import type { City } from "../world/city";
import type { Inside, InsidePerson } from "../world/interiors";
import type { Interactions } from "./interactions";
import type { Talk } from "./talk";
import type { Wallet } from "../app/save";

const DOOR_REACH = 2.6;
const SPOT_REACH = 1.8;

/** Going in and out of buildings: the door on the street, the lift, the bed, the people inside. */
export class Doors {
  /** Which building the hero's in, if any. */
  inside: Inside | null = null;
  private peopleOf = new Map<InsidePerson, Person>();
  private liftOpen = false;
  private liftChoices: (() => void)[] = [];

  constructor(
    private hud: Hud,
    private input: Input,
    private player: Player,
    private city: City,
    private peds: Pedestrians,
    private talk: Talk,
    private wallet: Wallet,
    private env: Environment,
    interactions: Interactions,
  ) {
    for (const b of city.interiors.all) {
      for (const q of b.people) {
        const who = peds.addStanding(q.id, q.pose);
        who.x = q.x;
        who.y = q.y;
        who.z = q.z;
        who.yaw = q.yaw;
        this.peopleOf.set(q, who);
      }
    }
    interactions.add((x, z, yaw, driving, out) => {
      if (driving) return;
      const here = this.inside;
      if (!here) {
        for (const b of city.interiors.all) {
          if (Math.abs(b.outX - x) > DOOR_REACH * 1.6 || Math.abs(b.outZ - z) > DOOR_REACH * 1.6) continue;
          out.push({ key: "KeyE", html: bn.inside.enter(b.name), priority: 70, run: () => this.goIn(b) });
          return;
        }
        return;
      }
      const py = player.y;
      for (const s of here.spots) {
        if (Math.abs(s.x - x) > SPOT_REACH || Math.abs(s.z - z) > SPOT_REACH || Math.abs(s.y - py) > 1) continue;
        if (s.kind === "exit") out.push({ key: "KeyE", html: bn.inside.exit, priority: 80, run: () => this.goOut() });
        else if (s.kind === "lift") out.push({ key: "KeyE", html: bn.inside.lift, priority: 75, run: () => this.openLift() });
        else if (s.kind === "sleep") {
          out.push({ key: "KeyE", html: bn.inside.sleep, priority: 75, run: () => this.sleep() });
          if (here.kind === "home" || here.kind === "hotel") this.homeOffers?.(out);
        }
      }
      for (const q of here.people) {
        if (!q.role) continue;
        const who = this.peopleOf.get(q);
        if (!who || Math.abs(q.x - x) > 3 || Math.abs(q.z - z) > 3 || Math.abs(q.y - py) > 1) continue;
        const facing = (q.x - x) * Math.sin(yaw) + (q.z - z) * Math.cos(yaw);
        if (facing < 0) continue;
        if (q.role === "sell" && q.stock) out.push({ key: "KeyE", html: bn.shop.promptCart, priority: 72, focus: who, run: () => this.talk.sell(who, bn.shop.stock[q.stock!]) });
        else if (q.role === "doctor") out.push({ key: "KeyE", html: bn.inside.doctor, priority: 72, focus: who, run: () => this.talk.sell(who, bn.shop.stock.doctor) });
        else if (q.role === "bank") out.push({ key: "KeyE", html: bn.inside.bank, priority: 72, focus: who, run: () => this.talk.sell(who, bn.shop.stock.bankDesk) });
        else if (q.role === "officer") out.push({ key: "KeyE", html: bn.inside.officer, priority: 72, focus: who, run: () => this.talk.officer(who) });
        else if (q.role === "fineDesk") out.push({ key: "KeyE", html: bn.inside.fineDesk, priority: 72, focus: who, run: () => this.talk.payFines(who) });
      }
    });
  }

  /** Where the street thinks the hero is, so everything out there carries on as it was. */
  get outX(): number {
    return this.inside ? this.inside.outX : this.player.x;
  }

  get outZ(): number {
    return this.inside ? this.inside.outZ : this.player.z;
  }

  /** Lying down did some good. */
  onSlept: (() => void) | null = null;
  /** Something to do at home: the bag's cooking, and tea if there's a kettle. */
  homeOffers: ((out: { key: string; html: string; priority: number; run: () => void }[]) => void) | null = null;

  goIn(b: Inside): void {
    this.hud.fade(() => {
      this.inside = b;
      this.player.warp(b.x, b.y, b.z, b.yaw);
      this.hud.say(b.name, 2.4);
    });
  }

  goOut(): void {
    const b = this.inside;
    if (!b) return;
    this.closeLift();
    this.hud.fade(() => {
      this.inside = null;
      this.player.warp(b.outX, this.city.layout.groundHeight(b.outX, b.outZ), b.outZ, b.outYaw);
    });
  }

  private openLift(): void {
    const b = this.inside;
    if (!b) return;
    const items: Choice[] = [];
    this.liftChoices = [];
    for (const stop of b.lift) {
      items.push({ text: stop.label });
      this.liftChoices.push(() => this.hud.fade(() => this.player.warp(stop.x, stop.y, stop.z, stop.yaw)));
    }
    items.push({ text: bn.inside.liftStay });
    this.liftChoices.push(() => undefined);
    this.liftOpen = true;
    this.hud.showChoices(items);
  }

  private closeLift(): void {
    if (!this.liftOpen) return;
    this.liftOpen = false;
    this.hud.hideChoices();
  }

  /** Lie down, and it's morning. */
  private sleep(): void {
    this.hud.fade(() => {
      const h = this.env.hour;
      this.env.setHour(h > 6.5 ? 7 : h + 8);
      this.hud.say(bn.inside.slept, 3);
      this.onSlept?.();
    });
  }

  update(dt: number): void {
    if (!this.liftOpen) return;
    const input = this.input;
    if (input.isDown("KeyW", "KeyA", "KeyS", "KeyD")) {
      this.closeLift();
      return;
    }
    const i = this.hud.readChoice(dt, (c) => input.pressed(c), input.wheel, input.clicked);
    if (i >= 0) {
      const run = this.liftChoices[i];
      this.closeLift();
      run?.();
    }
  }

  /** A bit of the map for a building's sign. */
  labelFor(n: number): string {
    return bnNum(n);
  }
}
