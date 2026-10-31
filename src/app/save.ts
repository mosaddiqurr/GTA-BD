import type { LifeData } from "./life";
import { PhoneData } from "../ui/phoneData";

/** What carries over from one place and one visit to the next. Kept to this browser, in a few slots
 *  so that more than one game can be going at once. */
export interface SaveData {
  taka: number;
  items: Record<string, number>;
  region: string | null;
  /** Where the hero was, and when: left out for a game that hasn't been played yet. */
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  hour?: number;
  playSeconds: number;
  savedAt: number;
  phone?: PhoneData;
  tickets?: { why: string; amount: number }[];
  /** Which of the playable cast this game is. */
  hero?: string;
  /** How many days in. */
  day?: number;
  /** Health, standing, friends, the story and everything else about how it's going. */
  life?: LifeData;
}

export const SLOTS = 3;
const LEGACY = "bow.save.v1";
const ACTIVE = "bow.slot";
const START_TAKA = 5000;

const slotKey = (n: number): string => `bow.save.slot${n}`;

function blank(region: string | null = null): SaveData {
  return { taka: START_TAKA, items: {}, region, playSeconds: 0, savedAt: 0 };
}

export function activeSlot(): number {
  try {
    const n = Number(localStorage.getItem(ACTIVE));
    return n >= 1 && n <= SLOTS ? n : 1;
  } catch {
    return 1;
  }
}

export function setActiveSlot(n: number): void {
  try {
    localStorage.setItem(ACTIVE, String(n));
  } catch {
    // Without storage there is only this session anyway.
  }
}

export function readSlot(n: number): SaveData | null {
  try {
    const raw = localStorage.getItem(slotKey(n));
    return raw ? { ...blank(), ...(JSON.parse(raw) as Partial<SaveData>) } : null;
  } catch {
    return null;
  }
}

export function loadSave(): SaveData {
  const here = readSlot(activeSlot());
  if (here) return here;
  // A game from before there were slots.
  try {
    const old = localStorage.getItem(LEGACY);
    if (old) return { ...blank(), ...(JSON.parse(old) as Partial<SaveData>) };
  } catch {
    // Starts fresh.
  }
  return blank();
}

/** Writes to the slot in use, or to another if one is named, which then becomes the one in use. */
export function writeSave(data: SaveData, slot?: number): void {
  data.savedAt = Date.now();
  if (slot) setActiveSlot(slot);
  try {
    localStorage.setItem(slotKey(slot ?? activeSlot()), JSON.stringify(data));
  } catch {
    // Private windows can refuse this. The game simply starts fresh next time.
  }
}

export function deleteSlot(n: number): void {
  try {
    localStorage.removeItem(slotKey(n));
  } catch {
    // Nothing was kept in the first place.
  }
}

/** A new game in this slot, starting in this district. */
export function startGame(slot: number, region: string, hero: string, taka: number): void {
  writeSave({ ...blank(region), hero, taka }, slot);
}

/** A game's photographs, kept apart from the rest because they're big. */
export function loadPhotos<T>(): T[] {
  try {
    return JSON.parse(localStorage.getItem(`bow.photos.slot${activeSlot()}`) ?? "[]") as T[];
  } catch {
    return [];
  }
}

export function savePhotos<T>(list: T[]): void {
  try {
    localStorage.setItem(`bow.photos.slot${activeSlot()}`, JSON.stringify(list));
  } catch {
    // Storage is full: the photographs stay in memory until the page closes.
  }
}

/** The hero's money and what they've bought. */
export class Wallet {
  onChange: ((taka: number) => void) | null = null;
  /** Money just went out of the purse. */
  onSpend: ((amount: number) => void) | null = null;

  constructor(private data: SaveData) {}

  get taka(): number {
    return this.data.taka;
  }

  get items(): Record<string, number> {
    return this.data.items;
  }

  can(amount: number): boolean {
    return this.data.taka >= amount;
  }

  spend(amount: number): boolean {
    if (!this.can(amount)) return false;
    this.data.taka -= amount;
    writeSave(this.data);
    this.onChange?.(this.data.taka);
    this.onSpend?.(amount);
    return true;
  }

  receive(amount: number): void {
    this.data.taka += amount;
    writeSave(this.data);
    this.onChange?.(this.data.taka);
  }

  add(item: string): void {
    this.data.items[item] = (this.data.items[item] ?? 0) + 1;
    writeSave(this.data);
  }
}
