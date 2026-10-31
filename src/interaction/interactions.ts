import type { Anchor } from "../ui/hud";

/** Something the player could do right now. */
export interface Offer {
  key: string;
  /** The prompt, with its key shown. Empty when it's worth doing but not worth mentioning. */
  html: string;
  /** When two things want the same key, the higher number gets it. */
  priority: number;
  run: () => void;
  /** Who or what this is about, marked on screen. */
  focus?: Anchor;
}

/** Adds what's available at this spot. When `driving`, only what can be done from the seat. */
export type OfferSource = (x: number, z: number, yaw: number, driving: boolean, out: Offer[]) => void;

const KEY_ORDER = ["KeyF", "KeyG", "KeyE", "KeyQ"];

/** The one place that decides what can be done nearby. New things to interact with register a
 *  source here, and the prompts and keys work the same for all of them. */
export class Interactions {
  private sources: OfferSource[] = [];
  private offers: Offer[] = [];
  private best = new Map<string, Offer>();
  private focus: Anchor | null = null;
  onFocus: ((a: Anchor | null) => void) | null = null;

  add(source: OfferSource): void {
    this.sources.push(source);
  }

  /** Returns the prompt to show, and runs whatever was asked for this frame. */
  update(x: number, z: number, yaw: number, driving: boolean, pressed: (code: string) => boolean): string | null {
    const offers = this.offers;
    offers.length = 0;
    for (const s of this.sources) s(x, z, yaw, driving, offers);
    const best = this.best;
    best.clear();
    for (const o of offers) {
      const cur = best.get(o.key);
      if (!cur || o.priority > cur.priority) best.set(o.key, o);
    }
    this.setFocus(best.get("KeyE")?.focus ?? null);
    let html: string | null = null;
    for (const key of KEY_ORDER) {
      const o = best.get(key);
      if (!o) continue;
      if (pressed(key)) {
        this.setFocus(null);
        o.run();
        return null;
      }
      if (o.html) html = html ? `${html} &nbsp; ${o.html}` : o.html;
    }
    return html;
  }

  clear(): void {
    this.setFocus(null);
  }

  private setFocus(a: Anchor | null): void {
    if (a === this.focus) return;
    this.focus = a;
    this.onFocus?.(a);
  }
}
