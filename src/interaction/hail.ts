import { bn } from "../localization/bn";
import type { Input } from "../player/input";
import type { Player } from "../player/player";
import type { TrafficSystem } from "../traffic/trafficSystem";
import type { Anchor, Choice, Hud } from "../ui/hud";
import type { Vehicle } from "../vehicles/vehicle";
import { seatAnchor, Trips } from "./trips";

type Say = (text: string, anchor: Anchor, id: string, top: number) => void;

const LOOK_FOR_BUS_M = 60;
const GIVE_UP_SECONDS = 100;

/** Calling for a ride. A rickshaw, CNG or taxi drives over and pulls up. A bus goes where its route goes:
 *  the helper shouts whether there's room, and it's up to the hero to get to the stop. */
export class Hail {
  private open = false;
  private actions: (() => void)[] = [];
  private coming: { v: Vehicle; kind: string; time: number } | null = null;

  constructor(private hud: Hud, private input: Input, private player: Player, private traffic: TrafficSystem, private trips: Trips, private say: Say) {
    traffic.onCalledArrived = (v) => this.arrived(v);
  }

  get menuOpen(): boolean {
    return this.open;
  }

  /** Q. Pressing it again with a menu up or something on its way calls it off. */
  press(): void {
    if (this.open) {
      this.closeMenu();
      return;
    }
    const items: Choice[] = [];
    this.actions = [];
    const add = (text: string, run: () => void): void => {
      items.push({ text });
      this.actions.push(run);
    };
    for (const kind of ["rickshaw", "cng", "taxi"] as const) add(bn.hail.menu[kind], () => this.callFor(kind));
    add(bn.hail.menu.bus, () => this.lookForBus());
    add(bn.hail.menu.never, () => undefined);
    this.open = true;
    this.hud.showChoices(items);
  }

  private closeMenu(): void {
    this.open = false;
    this.hud.hideChoices();
  }

  /** Booked from the phone: no need to shout. Says whether anyone's coming. */
  book(kind: "rickshaw" | "cng" | "taxi" | "bike"): boolean {
    const { x, z } = this.player;
    this.cancel();
    const v = this.traffic.callRide(kind, x, z);
    if (!v) return false;
    this.coming = { v, kind, time: 0 };
    this.hud.setWaypoint({ x: v.x, z: v.z, label: bn.hail.coming[kind] });
    return true;
  }

  private callFor(kind: "rickshaw" | "cng" | "taxi"): void {
    const { x, z } = this.player;
    this.cancel();
    this.player.wave();
    this.say(bn.hail.call[kind], this.player, "hero_mango", 1.6);
    const v = this.traffic.callRide(kind, x, z);
    if (!v) {
      this.hud.say(bn.hail.none, 2.6);
      return;
    }
    this.coming = { v, kind, time: 0 };
    this.hud.setWaypoint({ x: v.x, z: v.z, label: bn.hail.coming[kind] });
  }

  private lookForBus(): void {
    const { x, z } = this.player;
    this.player.wave();
    this.say(bn.hail.busCall, this.player, "hero_mango", 1.6);
    const bus = this.traffic.nearestBus(x, z, LOOK_FOR_BUS_M);
    const stop = this.trips.nearestStop(x, z);
    this.hud.setWaypoint({ x: stop.x, z: stop.z, label: bn.hail.stop });
    if (!bus) {
      this.hud.say(bn.hail.noBus, 3);
      return;
    }
    const lines = bus.freeSeats > 0 ? bn.hail.busRoom : bn.hail.busFull;
    this.say(lines[Math.floor(Math.random() * lines.length)], this.trips.conductorAt(bus), "conductor", 0);
    // Standing at a stop already: the driver gives them a moment to get there.
    if (bus.freeSeats > 0 && bus.holdTime > 0) bus.holdTime = Math.max(bus.holdTime, 10);
  }

  private arrived(v: Vehicle): void {
    const c = this.coming;
    if (!c || c.v !== v) return;
    this.coming = null;
    v.holdTime = 45;
    this.hud.setWaypoint(null);
    if (v.driverId) this.say(bn.hail.reply, seatAnchor(v), v.driverId, 0.35);
  }

  /** Calls it off: the driver goes back to looking for fares. */
  cancel(): void {
    const c = this.coming;
    if (!c) return;
    this.coming = null;
    c.v.called = false;
    this.traffic.clearDestination(c.v);
    this.hud.setWaypoint(null);
  }

  stop(): void {
    this.closeMenu();
    this.cancel();
  }

  update(dt: number): void {
    const input = this.input;
    if (this.open) {
      if (input.isDown("KeyW", "KeyA", "KeyS", "KeyD")) {
        this.closeMenu();
      } else {
        const i = this.hud.readChoice(dt, (c) => input.pressed(c), input.wheel, input.clicked);
        if (i >= 0) {
          const run = this.actions[i];
          this.closeMenu();
          run?.();
        }
      }
    }
    const c = this.coming;
    if (!c) return;
    c.time += dt;
    // Keeps the mark on the vehicle as it comes.
    this.hud.setWaypoint({ x: c.v.x, z: c.v.z, label: bn.hail.coming[c.kind] });
    // It's been taken, or it can't get here.
    if (c.v.mode !== "ai" || c.time > GIVE_UP_SECONDS) {
      if (c.v.mode === "ai") this.hud.say(bn.hail.gaveUp, 3);
      this.cancel();
    }
  }
}
