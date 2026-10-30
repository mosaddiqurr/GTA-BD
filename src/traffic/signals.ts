import type { Junction } from "../world/cityLayout";
import type { Heading } from "./laneGraph";

export type LightState = "red" | "amber" | "green";

const GREEN = 13;
const AMBER = 2.2;
const ALL_RED = 1.3;

/** One signalised junction. Each phase is the set of arriving headings that may go.
 *  The round plaza runs one arm at a time so the ring always clears; ordinary
 *  junctions alternate the two road axes. */
export class SignalController {
  readonly phases: Heading[][];
  private phase = 0;
  private t = 0;
  private stage: 0 | 1 | 2 = 0; // green, amber, all red
  onChange: (() => void) | null = null;

  constructor(readonly junction: Junction, offset: number) {
    this.phases = junction.isPlaza ? [[0], [1], [2], [3]] : [[0, 2], [1, 3]];
    this.t = -offset % (GREEN + AMBER + ALL_RED);
  }

  private get greenTime(): number {
    return this.junction.isPlaza ? GREEN * 0.75 : GREEN;
  }

  update(dt: number): void {
    this.t += dt;
    const limit = this.stage === 0 ? this.greenTime : this.stage === 1 ? AMBER : ALL_RED;
    if (this.t < limit) return;
    this.t -= limit;
    if (this.stage === 2) {
      this.stage = 0;
      this.phase = (this.phase + 1) % this.phases.length;
    } else {
      this.stage = (this.stage + 1) as 1 | 2;
    }
    this.onChange?.();
  }

  stateFor(heading: Heading): LightState {
    if (this.stage === 2 || !this.phases[this.phase].includes(heading)) return "red";
    return this.stage === 0 ? "green" : "amber";
  }

  /** Used by the officer's arm signals. */
  get activeHeadings(): Heading[] {
    return this.stage === 2 ? [] : this.phases[this.phase];
  }
}
