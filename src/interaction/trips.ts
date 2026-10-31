import type { Wallet } from "../app/save";
import { bn, bnNum } from "../localization/bn";
import type { Gate } from "../regions/types";
import type { Player } from "../player/player";
import type { TrafficSystem } from "../traffic/trafficSystem";
import type { Anchor, Hud } from "../ui/hud";
import type { Vehicle } from "../vehicles/vehicle";
import { ROUTE_INFO } from "../world/signs";
import { roadWidth } from "../world/cityLayout";
import type { City } from "../world/city";
import type { Talk } from "./talk";

const RATE: Record<string, [number, number]> = {
  // Starting fare and taka per kilometre, scaled to a district you can cross in a few minutes.
  rickshaw: [20, 90],
  leguna: [20, 25],
  motorbike: [60, 110],
  easybike: [20, 70],
  cng: [60, 160],
  taxi: [120, 260],
};
const BUS_FARE = 15;
/** What it costs to go on to another district. */
const FAR_FARE: Record<string, number> = { cng: 400, taxi: 650 };
const FAR_BUS_FARE = 40;
const TOO_CLOSE_M = 70;

/** Above the driver's seat, wherever the vehicle has got to. */
export function seatAnchor(v: Vehicle): Anchor {
  return {
    get x() {
      return v.x;
    },
    get y() {
      return v.y + v.spec.height;
    },
    get z() {
      return v.z;
    },
  };
}

function round10(n: number): number {
  return Math.max(10, Math.round(n / 10) * 10);
}

/** Going somewhere as a passenger. A rickshaw or CNG is agreed with the driver first: where to, how
 *  much, and a bit of haggling. On a bus the conductor asks once you're aboard. The vehicle then
 *  really drives there, by the roads, and stops. */
export class Trips {
  /** The vehicle the hero is being taken somewhere in. */
  private ride: Vehicle | null = null;
  private place = "";

  constructor(private hud: Hud, private player: Player, private traffic: TrafficSystem, private talk: Talk, private city: City, private wallet: Wallet, private travel: (gate: Gate, by: "bus" | "hire") => void) {
    traffic.onTripDone = (v) => this.arrived(v);
  }

  /** A point on the road out to another district, on the outbound side, short of the last junction. */
  private roadOut(g: Gate): { x: number; z: number } {
    const road = this.city.region.layout.roads.find((q) => q.axis === g.axis && q.at === g.at)!;
    const side = roadWidth(road) / 2 - 2.2;
    // Traffic keeps left: heading east that's the north side, heading north that's the west side.
    const p = g.end * (this.city.region.layout.boundary - 42);
    return g.axis === "v" ? { x: g.at - g.end * side, z: p } : { x: p, z: g.at + g.end * side };
  }

  /** Up to a rickshaw or CNG with a driver in it, and asking to go somewhere. */
  hire(v: Vehicle): void {
    const id = v.driverId;
    if (!id) return;
    v.holdTime = Math.max(v.holdTime, 45);
    this.talk.openWith(seatAnchor(v), id, 0.35);
    this.talk.say(bn.trip.whereTo, () => this.askWhere(v));
  }

  private askWhere(v: Vehicle): void {
    this.talk.menuOf([
      ...this.talk.placeList().map((p) => ({
        text: bn.talk.places[p.key],
        run: () => {
          const label = bn.talk.places[p.key];
          this.talk.heroSay(bn.trip.goTo(label), () => this.quote(v, label, p.x, p.z));
        },
      })),
      { text: bn.trip.farMenu, run: () => this.askFar(v) },
      { text: bn.trip.never, run: () => this.talk.heroSay(bn.trip.never, () => this.walkAway(v)) },
    ]);
  }

  /** Further than this district: only something with an engine goes that far. */
  private askFar(v: Vehicle): void {
    this.talk.menuOf([
      ...this.city.region.gates.map((g) => ({
        text: g.nameBn,
        run: () => {
          this.talk.heroSay(bn.trip.goTo(g.nameBn), () => {
            if (v.id === "rickshaw" || v.id === "easybike") {
              this.talk.say(bn.trip.tooFar, () => this.askWhere(v));
              return;
            }
            const out = this.roadOut(g);
            this.quote(v, g.nameBn, out.x, out.z, g);
          });
        },
      })),
      { text: bn.trip.back, run: () => this.askWhere(v) },
    ]);
  }

  private quote(v: Vehicle, label: string, x: number, z: number, gate: Gate | null = null): void {
    const metres = this.traffic.routeMetres(v, x, z);
    if (!gate && metres !== null && metres < TOO_CLOSE_M) {
      this.talk.say(bn.trip.tooClose, () => this.askWhere(v));
      return;
    }
    const [base, perKm] = (v.isTaxi ? RATE.taxi : RATE[v.id]) ?? RATE.rickshaw;
    const fare = gate ? FAR_FARE[v.isTaxi ? "taxi" : "cng"] : round10(base + ((metres ?? 300) / 1000) * perKm);
    const go = (agreed: number): void => this.agree(v, label, x, z, agreed, gate);
    const low = round10(fare * 0.6), mid = round10(fare * 0.8);
    const offer = (amount: number, willing: number, counter: number): void => {
      this.talk.heroSay(bn.trip.offer(bnNum(amount)), () => {
        if (Math.random() < willing) {
          go(amount);
          return;
        }
        this.talk.sayParts(bn.trip.counter(bnNum(counter)), [bn.trip.counterSay(counter)], () => {
          this.talk.menuOf([
            { text: bn.trip.deal(bnNum(counter)), run: () => this.talk.heroSay(bn.trip.dealSay, () => go(counter)) },
            { text: bn.trip.never, run: () => this.talk.heroSay(bn.trip.never, () => this.walkAway(v)) },
          ]);
        });
      });
    };
    this.talk.sayParts(bn.trip.quote(bnNum(fare)), [bn.trip.quoteSay(fare)], () => {
      this.talk.menuOf([
        { text: bn.trip.deal(bnNum(fare)), run: () => this.talk.heroSay(bn.trip.dealSay, () => go(fare)) },
        { text: bn.trip.offerMenu(bnNum(mid)), run: () => offer(mid, 0.6, round10(fare * 0.9)) },
        { text: bn.trip.offerMenu(bnNum(low)), run: () => offer(low, 0.2, round10(fare * 0.85)) },
        { text: bn.trip.never, run: () => this.talk.heroSay(bn.trip.never, () => this.walkAway(v)) },
      ]);
    });
  }

  private agree(v: Vehicle, label: string, x: number, z: number, fare: number, gate: Gate | null): void {
    if (!this.wallet.can(fare)) {
      this.talk.say(bn.trip.noMoney, () => this.walkAway(v));
      return;
    }
    this.talk.say(bn.trip.okay, () => {
      this.talk.closeNow();
      this.ride = v;
      this.place = label;
      this.pending = { x, z, fare, gate };
      this.player.beginEnter(v, true);
    });
  }

  private walkAway(v: Vehicle): void {
    this.talk.say(bn.trip.yourLoss, () => {
      this.talk.closeNow();
      v.holdTime = 0;
    });
  }

  private pending: { x: number; z: number; fare: number; gate: Gate | null } | null = null;

  /** The hero has just sat down in a vehicle as a passenger. */
  seated(v: Vehicle): void {
    if (this.pending && this.ride === v) {
      const { x, z } = this.pending;
      this.traffic.setDestination(v, x, z);
      this.hud.setWaypoint({ x, z, label: this.place });
      return;
    }
    if (v.id === "bus_city") this.askConductor(v);
  }

  /** On a bus: the conductor comes along for the fare and asks where you're getting off. */
  private askConductor(v: Vehicle): void {
    this.talk.openWith(this.conductorAt(v), "conductor", 0, bn.trip.conductor);
    this.talk.say(bn.trip.busAsk, () => {
      this.talk.menuOf([
        ...this.talk.placeList().filter((p) => p.key !== "bus").map((p) => ({
          text: bn.talk.places[p.key],
          run: () => {
            const label = bn.talk.places[p.key];
            this.talk.heroSay(bn.trip.busGetOff(label), () => {
              const stop = this.nearestStop(p.x, p.z);
              this.ride = v;
              this.place = label;
              this.pending = { x: stop.x, z: stop.z, fare: BUS_FARE, gate: null };
              this.traffic.setDestination(v, stop.x, stop.z);
              this.hud.setWaypoint({ x: p.x, z: p.z, label });
              this.wallet.spend(BUS_FARE);
              this.talk.sayParts(bn.trip.busFare(bnNum(BUS_FARE)), [bn.trip.busFare(bn.trip.busFareWords)], () => this.talk.closeNow());
            });
          },
        })),
        ...this.city.region.gates.map((g) => ({ text: bn.trip.busToMenu(g.nameBn), run: () => this.busFar(v, g) })),
        { text: bn.trip.justRiding, run: () => this.talk.heroSay(bn.trip.justRiding, () => this.talk.say(bn.trip.busFare(bn.trip.busFareWords), () => this.talk.closeNow())) },
      ]);
    });
  }

  /** Only some buses leave the district, and the conductor knows which. */
  private busFar(v: Vehicle, g: Gate): void {
    this.talk.heroSay(bn.trip.busToAsk(g.nameBn), () => {
      if (v.routeTo !== g.to) {
        const line = ROUTE_INFO.find((q) => q.to === g.to)?.name ?? "";
        this.talk.say(bn.trip.busNotGoing(g.nameBn, line), () => this.talk.closeNow());
        return;
      }
      if (!this.wallet.spend(FAR_BUS_FARE)) {
        this.talk.say(bn.trip.noMoney, () => this.talk.closeNow());
        return;
      }
      const out = this.roadOut(g);
      this.ride = v;
      this.place = g.nameBn;
      this.pending = { x: out.x, z: out.z, fare: 0, gate: g };
      this.traffic.setDestination(v, out.x, out.z);
      this.hud.setWaypoint({ x: out.x, z: out.z, label: g.nameBn });
      this.talk.say(bn.trip.busGoes(g.nameBn), () => this.talk.closeNow());
    });
  }

  conductorAt(v: Vehicle): Anchor {
    const door = v.arch.doors[2];
    const dz = door ? door.pivot.z : v.spec.length * 0.3;
    return {
      get x() {
        return v.x + Math.sin(v.heading) * dz;
      },
      get y() {
        return v.y + v.spec.height * 0.8;
      },
      get z() {
        return v.z + Math.cos(v.heading) * dz;
      },
    };
  }

  nearestStop(x: number, z: number): { x: number; z: number } {
    let best = this.city.busStops[0], bd = Infinity;
    for (const s of this.city.busStops) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  private arrived(v: Vehicle): void {
    if (v !== this.ride) return;
    this.hud.setWaypoint(null);
    const label = this.place, fare = this.pending?.fare ?? 0, gate = this.pending?.gate ?? null;
    this.pending = null;
    if (fare && v.id !== "bus_city" && gate) this.payDriver(v, fare);
    else if (fare && v.id !== "bus_city") this.owed = fare;
    if (gate) {
      // Out of this district: a word from whoever's in charge, and on to the next place.
      if (v.id === "bus_city") this.talk.lineFrom(this.conductorAt(v), "conductor", bn.trip.conductor, bn.trip.farArrived(label), 0);
      else if (v.driverId) this.talk.lineParts(seatAnchor(v), v.driverId, 0.35, bn.trip.arrived(bnNum(fare)), [bn.trip.arrivedSay(fare)]);
      setTimeout(() => {
        if (this.ride === v) this.travel(gate, v.id === "bus_city" ? "bus" : "hire");
      }, 2200);
      return;
    }
    if (v.id === "bus_city") {
      this.talk.lineFrom(this.conductorAt(v), "conductor", bn.trip.conductor, bn.trip.busArrived(label), 0);
      return;
    }
    const id = v.driverId;
    if (id) this.talk.lineParts(seatAnchor(v), id, 0.35, bn.trip.arrived(bnNum(fare)), [bn.trip.arrivedSay(fare)]);
  }

  /** The hero has got out, whether they arrived or not. */
  gotOut(v: Vehicle): void {
    if (v !== this.ride) return;
    // Out on the road, and over to the driver with the money.
    if (this.owed) {
      v.holdTime = Math.max(v.holdTime, 3.5);
      this.payDriver(v, this.owed);
      this.owed = 0;
    }
    this.ride = null;
    this.pending = null;
    this.traffic.clearDestination(v);
    this.hud.setWaypoint(null);
  }

  /** Who's being paid right now, when it's not someone in a conversation. */
  payee: Anchor | null = null;
  private owed = 0;

  private payDriver(v: Vehicle, fare: number): void {
    this.payee = seatAnchor(v);
    this.wallet.spend(fare);
    this.payee = null;
  }

  /** Ends at once, for a respawn. */
  stop(): void {
    this.owed = 0;
    if (this.ride) this.traffic.clearDestination(this.ride);
    if (this.ride) this.hud.setWaypoint(null);
    this.ride = null;
    this.pending = null;
  }
}
