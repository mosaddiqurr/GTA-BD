import { SaveData, writeSave } from "./save";

/** A journey to another district. The page reloads to build the new place, so this waits in the
 *  browser's session storage for the other side. */
export interface TravelPlan {
  from: string;
  to: string;
  by: "drive" | "bus" | "hire" | "metro";
  /** What the hero is driving, if they're driving. */
  vehicle?: { id: string; variant: string };
  hour: number;
}

const KEY = "bow.travel";

export function readTravel(): TravelPlan | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw) as TravelPlan;
  } catch {
    return null;
  }
}

export function leaveFor(plan: TravelPlan, save: SaveData): void {
  save.region = plan.to;
  writeSave(save);
  try {
    sessionStorage.setItem(KEY, JSON.stringify(plan));
  } catch {
    // Without session storage the new district simply opens at its usual start.
  }
  location.href = location.pathname;
}
