import type { CharacterId } from "../characters/character";

/** Who you can be, and what's different about being them. */
export interface HeroKind {
  id: CharacterId;
  /** Key into `bn.heroes`. */
  key: string;
  taka: number;
  /** How quick on their feet, compared with the mango. */
  pace: number;
  /** Allowed to drive anything with an engine. */
  drives: boolean;
  /** Fares are kinder to the old. */
  fareShare: number;
  /** What strangers call them, in place of "ভাই". */
  called: readonly [string, string];
  /** Which jobs suit them. */
  jobs: readonly string[];
}

export const HEROES: HeroKind[] = [
  { id: "hero_mango", key: "mango", taka: 5000, pace: 1, drives: true, fareShare: 1, called: ["ভাই", "bhai"], jobs: ["tea", "rickshaw", "cng", "bus", "food", "courier", "porter", "ambulance"] },
  { id: "npc_woman_peach", key: "peach", taka: 8000, pace: 0.96, drives: true, fareShare: 1, called: ["আপা", "apa"], jobs: ["tea", "cng", "food", "courier", "ambulance"] },
  { id: "npc_office_orange", key: "orange", taka: 15000, pace: 0.92, drives: true, fareShare: 1, called: ["ভাই", "bhai"], jobs: ["cng", "courier", "food", "ambulance", "bus"] },
  { id: "npc_elder_date", key: "date", taka: 6000, pace: 0.74, drives: true, fareShare: 0.8, called: ["চাচা", "chacha"], jobs: ["tea", "cng", "bus"] },
  { id: "npc_kid_berry", key: "berry", taka: 500, pace: 1.12, drives: false, fareShare: 0.5, called: ["বাবু", "babu"], jobs: ["tea", "food"] },
];

export function heroById(id: string | undefined): HeroKind {
  return HEROES.find((h) => h.id === id) ?? HEROES[0];
}
