import { bn, bnNum } from "../localization/bn";
import type { Pedestrians, Person } from "../npc/pedestrians";
import type { Player } from "../player/player";
import type { Hud } from "../ui/hud";
import type { City } from "../world/city";
import type { MetroTrain } from "../world/metroTrain";
import type { Interactions } from "./interactions";
import type { Talk } from "./talk";

const FLOOR = 7.52;
const PLATFORM = 14.6;
const REACH = 3.4;
/** How long the view stays with the train before the next district loads. */
const RIDE_SECONDS = 9;

/** The way through a station: buy a ticket at the counter, go through the gates, up to the platform,
 *  wait for the train and get on. It really leaves, and the journey lands at the other station. */
export class Metro {
  private clerk: Person;
  private ticket = false;
  private aboard = 0;
  private dir: 1 | -1 = 1;

  constructor(private city: City, private hud: Hud, private player: Player, private talk: Talk, private train: MetroTrain, peds: Pedestrians, interactions: Interactions, private journey: (to: string) => void) {
    const m = city.region.layout.metro!;
    this.clerk = peds.addStanding("npc_office_orange", "stand");
    this.clerk.x = m.x;
    this.clerk.y = FLOOR;
    this.clerk.z = m.stationZ - 9.5;
    this.clerk.yaw = Math.PI;
    interactions.add((x, z, _yaw, driving, out) => {
      if (driving) return;
      const y = this.player.y;
      if (Math.abs(y - FLOOR) < 1) this.offersBelow(x, z, out);
      else if (Math.abs(y - PLATFORM) < 1) this.offersAbove(x, z, out);
    });
  }

  private get line() {
    return this.city.region.layout.metro!;
  }

  private offersBelow(x: number, z: number, out: Parameters<Parameters<Interactions["add"]>[0]>[4]): void {
    const m = this.line;
    if (Math.hypot(this.clerk.x - x, this.clerk.z - z) < REACH) {
      out.push({ key: "KeyE", html: bn.metro.promptTicket, priority: 80, focus: this.clerk, run: () => this.buy() });
      return;
    }
    for (const sx of [1, -1]) {
      if (Math.hypot(m.x + sx * 8.4 - x, m.stationZ + 2 - z) > REACH) continue;
      out.push({ key: "KeyE", html: bn.metro.promptUp, priority: 80, run: () => this.goUp(sx) });
      return;
    }
  }

  private offersAbove(x: number, z: number, out: Parameters<Parameters<Interactions["add"]>[0]>[4]): void {
    const m = this.line;
    for (const sx of [1, -1]) {
      if (Math.hypot(m.x + sx * 8.4 - x, m.stationZ + 2 - z) < REACH) {
        out.push({ key: "KeyE", html: bn.metro.promptDown, priority: 80, run: () => this.goDown(sx) });
        break;
      }
    }
    // A train in at this side of the platform.
    const dir: 1 | -1 = x > m.x ? -1 : 1;
    if (this.train.standing(dir) && Math.abs(z - m.stationZ) < 66) {
      const line = m.lines.find((l) => l.dir === dir);
      if (line && this.ticket) out.push({ key: "KeyF", html: bn.metro.promptBoard(line.nameBn), priority: 90, run: () => this.board(line.to, dir) });
      else if (line) out.push({ key: "KeyF", html: bn.metro.promptNoTicket, priority: 90, run: () => this.hud.say(bn.metro.needTicket, 3) });
      else out.push({ key: "KeyF", html: bn.metro.promptWrong, priority: 90, run: () => this.hud.say(bn.metro.wrongSide, 3.5) });
    }
  }

  private buy(): void {
    const line = this.line.lines[0];
    if (!line) return;
    if (this.ticket) {
      this.hud.say(bn.metro.haveTicket, 3);
      return;
    }
    this.talk.ticket(this.clerk, line.nameBn, line.fare, () => {
      this.ticket = true;
      this.hud.say(bn.metro.gotTicket(line.nameBn, bnNum(line.fare)), 3.5);
    });
  }

  private goUp(sx: number): void {
    if (!this.ticket) {
      this.hud.say(bn.metro.needTicket, 3);
      return;
    }
    const m = this.line;
    const line = m.lines[0];
    const right = line && (line.dir < 0 ? 1 : -1) === sx;
    if (!right) {
      this.hud.say(bn.metro.wrongSide, 3.5);
      return;
    }
    this.hud.fade(() => {
      this.player.warp(m.x + sx * 6.2, PLATFORM, m.stationZ - 3, Math.PI);
      this.train.comeSoon(line.dir);
    });
  }

  private goDown(sx: number): void {
    const m = this.line;
    this.hud.fade(() => this.player.warp(m.x + sx * 8.4, FLOOR, m.stationZ - 0.5, Math.PI));
  }

  private board(to: string, dir: 1 | -1): void {
    this.ticket = false;
    this.dir = dir;
    this.aboard = RIDE_SECONDS;
    this.pendingTo = to;
    this.hud.fade(() => {
      this.player.boardTrain(() => this.train.where(dir));
      this.train.depart(dir);
    });
  }

  private pendingTo = "";

  update(dt: number): void {
    // Anyone waiting on the platform gets a moment longer to reach the doors.
    if (this.aboard > 0) {
      this.aboard -= dt;
      if (this.aboard <= 0) this.hud.fade(() => this.journey(this.pendingTo));
    }
  }

  /** Stepping off at this end of a journey. */
  land(from: string): void {
    const m = this.line;
    const back = m.lines.find((l) => l.to === from);
    const dir: 1 | -1 = back ? (back.dir > 0 ? -1 : 1) : 1;
    const sx = dir < 0 ? 1 : -1;
    this.train.arriveNow(dir, 9);
    this.player.warp(m.x + sx * 6.2, PLATFORM, m.stationZ - 8, 0);
    void this.dir;
  }
}
