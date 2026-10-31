import type { Line } from "../dialogue/types";

/** What someone remembers about the hero. */
export interface PersonMemory {
  met: number;
  /** How they feel about the hero: below zero is badly. */
  feel: number;
  name?: string;
  helped?: number;
  rude?: number;
  /** Given their number. */
  number?: boolean;
  /** When they last saw the hero, in play seconds. */
  last?: number;
}

export interface FriendState {
  met: boolean;
  /** How close: goes up with tea, favours and calls answered. */
  level: number;
  teas: number;
  favours: number;
  /** Play seconds at the last call either way. */
  lastCall: number;
  /** Let down lately: they're cooler until it's put right. */
  hurt: number;
}

export interface LifeData {
  /** 0 to 100. Nobody bleeds: at nought, the hero wakes up at the clinic. */
  health: number;
  /** Standing with people in general, from -100 to 100. */
  rep: number;
  people: Record<string, PersonMemory>;
  friends: Record<string, FriendState>;
  story: {
    done: string[];
    /** Where a mission in progress has got to, kept across a journey between districts. */
    current: string | null;
    stage: number;
    flags: Record<string, number>;
    finished: boolean;
  };
  jobs: Record<string, { runs: number; earned: number; best: number }>;
  scams: {
    fell: number;
    spotted: number;
    lost: number;
    seen: string[];
    /** Rises as the hero learns: the phone starts flagging what looks wrong. */
    sense: number;
    /** Things waiting to come back, due at this many play seconds. */
    pending: { key: string; at: number }[];
    /** A new SIM keeps the scammers off until this many play seconds. */
    quietUntil: number;
    lessons: Line[];
  };
  licence: boolean;
  /** Phone credit for calls. */
  credit: number;
  wearing: string;
  /** How dented each vehicle kind the hero has driven is, from 0 to 1. */
  damage: Record<string, number>;
  stats: { walked: number; driven: number; crashes: number; fines: number; earned: number; helped: number; photos: number };
  /** Hidden things found around the city. */
  found: string[];
  read: Record<string, number>;
  tips: string[];
  awards: string[];
  /** Bits of property owned, which pay a little every day. */
  owned: string[];
  lastPayDay: number;
  raceBest: Record<string, number>;
  /** What's been cooked or brought home, which makes staying in better. */
  home: string[];
}

export function freshLife(): LifeData {
  return {
    health: 100,
    rep: 0,
    people: {},
    friends: {},
    story: { done: [], current: null, stage: 0, flags: {}, finished: false },
    jobs: {},
    scams: { fell: 0, spotted: 0, lost: 0, seen: [], sense: 0, pending: [], quietUntil: 0, lessons: [] },
    licence: false,
    credit: 50,
    wearing: "",
    damage: {},
    stats: { walked: 0, driven: 0, crashes: 0, fines: 0, earned: 0, helped: 0, photos: 0 },
    found: [],
    read: {},
    tips: [],
    awards: [],
    owned: [],
    lastPayDay: 0,
    raceBest: {},
    home: [],
  };
}

/** Fills in anything an older saved game doesn't have yet. */
export function completeLife(old: Partial<LifeData> | undefined): LifeData {
  const fresh = freshLife();
  if (!old) return fresh;
  return { ...fresh, ...old, story: { ...fresh.story, ...old.story }, scams: { ...fresh.scams, ...old.scams }, stats: { ...fresh.stats, ...old.stats } };
}

export const RUN_DRAIN = 7;
export const RUN_RECOVER = 13;

/** The hero's body and good name. Everything here is kept in the saved game, apart from how out of breath they are. */
export class Life {
  stamina = 100;
  /** Out of breath, and not running again until they've got it back. */
  winded = false;
  onHealth: ((health: number, change: number) => void) | null = null;
  onRep: ((rep: number, change: number) => void) | null = null;
  /** The hero's health ran out. */
  onCollapse: (() => void) | null = null;

  constructor(readonly data: LifeData) {}

  get health(): number {
    return this.data.health;
  }

  heal(n: number): void {
    const before = this.data.health;
    this.data.health = Math.min(100, before + n);
    if (this.data.health !== before) this.onHealth?.(this.data.health, this.data.health - before);
  }

  hurt(n: number): void {
    if (n <= 0 || this.data.health <= 0) return;
    this.data.health = Math.max(0, this.data.health - n);
    this.onHealth?.(this.data.health, -n);
    if (this.data.health <= 0) this.onCollapse?.();
  }

  refresh(n: number): void {
    this.stamina = Math.min(100, this.stamina + n);
    if (this.stamina > 25) this.winded = false;
  }

  /** A run costs breath, and a rest gets it back. Returns whether they can run right now. */
  breathe(running: boolean, dt: number): boolean {
    if (running && !this.winded) {
      this.stamina = Math.max(0, this.stamina - RUN_DRAIN * dt);
      if (this.stamina <= 0) this.winded = true;
    } else {
      this.stamina = Math.min(100, this.stamina + RUN_RECOVER * dt);
      if (this.stamina > 25) this.winded = false;
    }
    return !this.winded;
  }

  get rep(): number {
    return this.data.rep;
  }

  addRep(n: number): void {
    if (!n) return;
    const before = this.data.rep;
    this.data.rep = Math.max(-100, Math.min(100, before + n));
    if (this.data.rep !== before) this.onRep?.(this.data.rep, this.data.rep - before);
  }

  /** Someone particular's memory of the hero. */
  memory(key: string): PersonMemory {
    let m = this.data.people[key];
    if (!m) {
      m = { met: 0, feel: 0 };
      this.data.people[key] = m;
      // Only the most recent few hundred people are worth keeping in a saved game.
      const keys = Object.keys(this.data.people);
      if (keys.length > 400) delete this.data.people[keys[0]];
    }
    return m;
  }

  friend(key: string): FriendState {
    let f = this.data.friends[key];
    if (!f) {
      f = { met: false, level: 0, teas: 0, favours: 0, lastCall: 0, hurt: 0 };
      this.data.friends[key] = f;
    }
    return f;
  }

  get sense(): number {
    return this.data.scams.sense;
  }

  /** Something learnt, kept in the notebook. */
  learn(line: Line | undefined, sense = 0): void {
    this.data.scams.sense += sense;
    if (line && !this.data.scams.lessons.some((l) => l[0] === line[0])) this.data.scams.lessons.push(line);
  }

  flag(name: string): number {
    return this.data.story.flags[name] ?? 0;
  }

  setFlag(name: string, value = 1): void {
    this.data.story.flags[name] = value;
  }
}
