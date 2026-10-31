import { bn } from "../localization/bn";
import type { Hud } from "../ui/hud";
import type { City } from "../world/city";
import type { Environment } from "../graphics/environment";
import type { NightLights } from "../graphics/nightLights";
import type { Pedestrians } from "../npc/pedestrians";
import type { SaveData } from "./save";

const SHOPS_OPEN = 8.5;
const SHOPS_SHUT = 22.5;
const NOT_BEFORE = 18;
const NOT_AFTER = 23.5;

/** How busy the streets are by the hour, as a share of what the player's settings allow: rush hours
 *  are all of it, the small hours nearly none. */
function trafficAt(h: number): number {
  if (h < 5) return 0.25;
  if (h < 7.5) return 0.25 + ((h - 5) / 2.5) * 0.5;
  if (h < 10) return 1;
  if (h < 16.5) return 0.72;
  if (h < 20.5) return 1;
  if (h < 23) return 0.72 - ((h - 20.5) / 2.5) * 0.45;
  return 0.27;
}

function peopleAt(h: number): number {
  if (h < 5) return 0.18;
  if (h < 8) return 0.18 + ((h - 5) / 3) * 0.62;
  if (h < 16.5) return 0.8;
  if (h < 21) return 1;
  if (h < 23) return 1 - ((h - 21) / 2) * 0.78;
  return 0.22;
}

/** The city's day: rush hours, the five prayers, shops shutting at night, the power going off, and Eid. */
export class CityRhythm {
  /** What traffic and crowds are to be multiplied by, right now. */
  traffic = 1;
  people = 1;
  private shopsOpen = true;
  private powerOff = 0;
  private powerCheck = 60;
  private lastHour = -1;
  private prayerSaid = -1;
  private eid = false;
  private timer = 0;

  constructor(private city: City, private env: Environment, private hud: Hud, private peds: Pedestrians, private night: NightLights, private save: SaveData) {}

  get shopsAreOpen(): boolean {
    return this.shopsOpen;
  }

  get isPowerOff(): boolean {
    return this.powerOff > 0;
  }

  get isEid(): boolean {
    return this.eid;
  }

  /** How many days in. Every thirtieth, near enough, there's Eid. */
  private get eidToday(): boolean {
    return (this.save.day ?? 0) % 30 === 7;
  }

  update(dt: number): boolean {
    const h = this.env.hour;
    // A new day.
    if (h < this.lastHour - 12) {
      this.save.day = (this.save.day ?? 0) + 1;
      if (this.eidToday) this.hud.say(bn.rhythm.eid, 6);
    }
    this.lastHour = h;
    this.eid = this.eidToday;
    this.city.setEid(this.eid);

    if (this.powerOff > 0) {
      this.powerOff -= dt;
      if (this.powerOff <= 0) {
        this.hud.say(bn.rhythm.powerBack, 3.2);
        this.night.setPower(true);
        this.city.setPower(true);
      }
    } else if (h > NOT_BEFORE && h < NOT_AFTER) {
      this.powerCheck -= dt;
      if (this.powerCheck <= 0) {
        this.powerCheck = 200 + Math.random() * 300;
        if (Math.random() < 0.55) {
          this.powerOff = 50 + Math.random() * 120;
          this.hud.say(bn.rhythm.powerCut, 4);
          this.night.setPower(false);
          this.city.setPower(false);
        }
      }
    }

    const open = h >= SHOPS_OPEN && h < SHOPS_SHUT;
    if (open !== this.shopsOpen) {
      this.shopsOpen = open;
      this.city.setShopsOpen(open);
      this.peds.setStallsOpen(open);
    }

    const prayer = this.prayerNow(h);
    if (prayer >= 0 && prayer !== this.prayerSaid) {
      this.prayerSaid = prayer;
      this.hud.say(bn.rhythm.prayers[prayer], 4);
    }

    // Busy-ness changes slowly, and the caller only needs telling when it has.
    this.timer -= dt;
    if (this.timer > 0) return false;
    this.timer = 12;
    const quiet = this.eid ? 0.5 : 1;
    const t = trafficAt(h) * quiet, p = peopleAt(h) * (this.eid ? 0.8 : 1);
    if (Math.abs(t - this.traffic) < 0.04 && Math.abs(p - this.people) < 0.04) return false;
    this.traffic = t;
    this.people = p;
    return true;
  }

  private prayerNow(h: number): number {
    const times = bn.rhythm.prayerHours;
    for (let i = 0; i < times.length; i++) if (h >= times[i] && h < times[i] + 0.3) return i;
    return -1;
  }
}
