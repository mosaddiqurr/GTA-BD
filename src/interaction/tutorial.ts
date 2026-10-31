import type { Life } from "../app/life";
import { TUTORIAL } from "../dialogue/tutorial";
import { T } from "../localization/bn";
import type { Player } from "../player/player";
import type { Panels } from "../ui/panels";
import type { Talk } from "./talk";

const AT_WHEEL = new Set(["tut_drive", "tut_horn", "tut_exit", "tut_law"]);
const EVERY = 16;

/** Hints that come up as the player goes along, each only once in a game. Driving hints wait until they're driving. */
export class Tutorial {
  private timer = 3;

  constructor(private life: Life, private panels: Panels, private player: Player, private talk: Talk) {}

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0 || this.talk.active) return;
    const seen = this.life.data.tips;
    const driving = !!this.player.driving;
    if (!driving && this.player.stage !== "foot") return;
    const next = TUTORIAL.find((q) => !seen.includes(q.key) && AT_WHEEL.has(q.key) === driving);
    if (!next) return;
    seen.push(next.key);
    this.timer = EVERY;
    this.panels.hint(T(next.text).replace(/\{(\w+)\}/g, "<kbd>$1</kbd>"), EVERY - 3);
  }
}
