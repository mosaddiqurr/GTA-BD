import type { Life } from "../app/life";
import type { Wallet } from "../app/save";
import type { AudioSystem } from "../audio/audio";
import type { Line, Outcome, Tree, TreeNode, TreeOption } from "../dialogue/types";
import { T, bn } from "../localization/bn";
import type { Pedestrians, Person } from "../npc/pedestrians";
import type { Input } from "../player/input";
import type { Player } from "../player/player";
import type { Hud } from "../ui/hud";
import type { Panels } from "../ui/panels";
import { lineSeconds, voiceOf } from "./cast";
import type { Talk } from "./talk";

export interface TreeHost {
  hud: Hud;
  input: Input;
  audio: AudioSystem;
  player: Player;
  panels: Panels;
  talk: Talk;
  peds: Pedestrians;
  wallet: Wallet;
  life: Life;
  /** Changes the mobile-money balance, and says whether there was enough. */
  mobile: (change: number) => void;
  playSeconds: () => number;
  saveNow: () => void;
}

/** What it's all gone to, once something's been said and chosen. Falling for a scam really costs money. */
export function applyOutcome(g: TreeHost, out: Outcome | undefined, counts = true): void {
  if (!out) return;
  const s = g.life.data.scams;
  if (out.money) {
    if (out.money > 0) {
      g.wallet.receive(out.money);
      g.panels.money(out.money);
    } else {
      const take = Math.min(-out.money, g.wallet.taka);
      if (take) g.wallet.spend(take);
    }
  }
  if (out.mobile) g.mobile(out.mobile);
  const lost = Math.max(0, -(out.money ?? 0)) + Math.max(0, -(out.mobile ?? 0));
  if (counts && lost) {
    s.fell++;
    s.lost += lost;
  }
  if (counts && out.sense && !lost) s.spotted++;
  if (out.rep) g.life.addRep(out.rep);
  if (out.later) s.pending.push({ key: out.later, at: g.playSeconds() + 180 + Math.random() * 360 });
  g.life.learn(out.lesson, out.sense ?? 0);
  if (out.lesson) g.panels.toast(T(out.lesson), lost ? "bad" : "good");
  g.saveNow();
}

/** Plays out a little branching exchange: on the phone with the hero carrying on, or face to face. */
export class TreeRunner {
  active = false;
  private picking: ((i: number) => void) | null = null;

  constructor(private g: TreeHost) {}

  /** The menu in a phone call is read here, since nothing else is listening. */
  update(dt: number): void {
    if (!this.picking) return;
    const input = this.g.input;
    const i = this.g.hud.readChoice(dt, (c) => input.pressed(c), input.wheel, input.clicked);
    if (i >= 0) {
      const done = this.picking;
      this.picking = null;
      this.g.hud.hideChoices();
      done(i);
    }
  }

  private sayOver(line: Line, who: "o" | "h", label: string, voice: string): Promise<void> {
    const g = this.g;
    const text = T(line);
    return new Promise((res) => {
      g.hud.bubble(text, who === "o" ? label : bn.you, g.player, 1.72, lineSeconds(text) + 0.5);
      let over = false;
      const finish = (): void => {
        if (over) return;
        over = true;
        res();
      };
      g.audio.speak(text, voiceOf(who === "o" ? voice : "hero_mango"), false, () => setTimeout(finish, 250));
      setTimeout(finish, (lineSeconds(text) + 0.5) * 1500);
    });
  }

  private sayFace(line: Line, who: "o" | "h"): Promise<void> {
    return new Promise((res) => {
      if (who === "o") this.g.talk.say(T(line), res);
      else this.g.talk.heroSay(T(line), res);
    });
  }

  /** On the phone. `first` starts the conversation at a node other than "start". */
  async phone(tree: Tree, voice: string, label: string, onOut?: (o: Outcome) => void, counts = true): Promise<void> {
    if (this.active) return;
    this.active = true;
    await this.walk(tree, (l, w) => this.sayOver(l, w, label, voice), (node) => this.askBelow(node), onOut, counts);
    this.g.hud.clearBubble(this.g.player);
    this.active = false;
  }

  /** Face to face, stopped in the street. */
  async inPerson(tree: Tree, person: Person, label: string, onOut?: (o: Outcome) => void, counts = true): Promise<void> {
    if (this.active) return;
    this.active = true;
    const talk = this.g.talk;
    talk.scriptLocked = true;
    talk.beginScene(person, label);
    await this.walk(tree, (l, w) => this.sayFace(l, w), (node) => this.askInTalk(node), onOut, counts);
    talk.scriptLocked = false;
    talk.closeNow();
    this.active = false;
  }

  private askBelow(node: TreeNode): Promise<number> {
    return new Promise((res) => {
      this.g.hud.showChoices(node.options!.map((o) => ({ text: T(o.text) })));
      this.picking = res;
    });
  }

  private askInTalk(node: TreeNode): Promise<number> {
    return new Promise((res) => {
      this.g.talk.menuOf(node.options!.map((o, i) => ({ text: T(o.text), run: () => res(i) })));
    });
  }

  private async walk(tree: Tree, say: (l: Line, who: "o" | "h") => Promise<void>, ask: (n: TreeNode) => Promise<number>, onOut: ((o: Outcome) => void) | undefined, counts: boolean): Promise<void> {
    let at: string | undefined = "start";
    let hops = 0;
    const apply = (o: Outcome | undefined): void => {
      applyOutcome(this.g, o, counts);
      if (o) onOut?.(o);
    };
    while (at && hops++ < 40) {
      const node: TreeNode | undefined = tree.nodes[at];
      if (!node) break;
      await say(node.say, node.who);
      apply(node.out);
      if (node.options?.length) {
        const opt: TreeOption = node.options[await ask(node)];
        apply(opt.out);
        at = opt.go;
      } else at = node.next;
    }
  }
}
