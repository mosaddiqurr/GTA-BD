import { bn } from "../localization/bn";
import type { Input } from "../player/input";
import type { Player } from "../player/player";
import type { Gate, RegionManifest } from "../regions/types";
import type { Hud } from "../ui/hud";
import type { Vehicle } from "../vehicles/vehicle";

/** How far beyond the edge of the district the road runs before it's time to decide. */
const PAST_EDGE = 6;
const ROAD_HALF = 16;

/** The roads out of the district. Driving out asks where the hero means to go. It's too far to walk,
 *  and a rickshaw isn't allowed on the big roads between areas. */
export class Gates {
  private here: Gate | null = null;
  private asking = false;

  constructor(private hud: Hud, private input: Input, private player: Player, private region: RegionManifest, private leave: (gate: Gate, v: Vehicle) => void) {}

  private gateAt(x: number, z: number): Gate | null {
    const lim = this.region.layout.boundary + PAST_EDGE;
    for (const g of this.region.gates) {
      const along = (g.axis === "v" ? z : x) * g.end;
      const across = (g.axis === "v" ? x : z) - g.at;
      if (along > lim && Math.abs(across) < ROAD_HALF) return g;
    }
    return null;
  }

  private closeMenu(): void {
    if (this.asking) this.hud.hideChoices();
    this.asking = false;
  }

  update(dt: number): void {
    const { x, z } = this.player.position;
    const gate = this.gateAt(x, z);
    if (!gate) {
      this.closeMenu();
      this.here = null;
      return;
    }
    const v = this.player.driving;
    if (gate !== this.here) {
      this.here = gate;
      if (!v) this.hud.say(bn.travel.onFoot, 4);
      else if (v.id === "rickshaw" || v.id === "easybike") this.hud.say(bn.travel.noRickshaw, 4);
      else {
        this.hud.say(bn.travel.road(gate.nameBn, gate.viaBn), 5);
        this.hud.showChoices([{ text: bn.travel.go(gate.nameBn) }, { text: bn.travel.stay }]);
        this.asking = true;
      }
    }
    if (!this.asking) return;
    const input = this.input;
    const i = this.hud.readChoice(dt, (c) => input.pressed(c), 0, input.clicked);
    if (i < 0) return;
    this.closeMenu();
    if (i === 0 && v) this.leave(gate, v);
  }
}
