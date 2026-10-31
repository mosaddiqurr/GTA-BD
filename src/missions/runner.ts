import { T, L, bn } from "../localization/bn";
import type { Line } from "../dialogue/types";
import { Kit, MissionFailed, MissionHost, Point } from "./kit";

export interface Stage {
  /** Which district this part happens in. Getting there comes first, and it's where a journey resumes. */
  region?: string;
  run: (k: Kit) => Promise<void>;
}

export interface MissionDef {
  id: string;
  title: Line;
  /** Who sends word about it and what they say, as it opens up on the phone. */
  blurb: Line;
  region: string;
  /** Where it starts in that district. */
  start: (k: Kit) => Point;
  stages: Stage[];
  money: number;
  rep?: number;
  sense?: number;
  /** What the player's taught, kept in the notebook. */
  lesson?: Line;
  /** Runs the job or side thing, rather than a story mission. */
  side?: boolean;
}

const w = {
  missionWord: L("মিশন", "Mission"),
  passed: L("মিশন সফল", "Mission passed"),
  failed: L("মিশন ব্যর্থ", "Mission failed"),
  retry: L("আবার চেষ্টা করুন", "Try again"),
  giveUp: L("এখনকার মতো থাক", "Leave it for now"),
  start: (n: string) => L(`<kbd>E</kbd> মিশন শুরু: ${n}`, `<kbd>E</kbd> Start mission: ${n}`),
  goTo: (n: string) => L(`পরের মিশন: ${n} যান`, `Next mission: go to ${n}`),
  nextUp: L("পরের মিশন", "Next mission"),
  reward: (t: string) => L(`পুরস্কার ${t}`, `Reward: ${t}`),
  newMission: L("নতুন মিশন খুলেছে: J চাপলে দেখবেন", "New mission open: press J to see it"),
  allDone: L("গল্প শেষ। শহর এখন পুরোটাই আপনার।", "The story's done. The city is yours now."),
  sorryFar: L("এই মিশন অন্য জেলায়।", "That mission's in another district."),
};

/** The story in order, and whatever mission is running now. */
export class MissionRunner {
  readonly kit: Kit;
  private running: MissionDef | null = null;
  private stageIndex = 0;
  private menu: (() => void)[] | null = null;
  private openNow: MissionDef | null = null;
  private startPoint: Point | null = null;
  private hintTimer = 0;
  /** When set, this is a replay and nothing in the story moves. */
  private replay = false;
  /** Called after the last story mission's rewards. */
  onFinished: (() => void) | null = null;

  constructor(private g: MissionHost, readonly list: MissionDef[], private missionsOff: () => boolean, private here: () => string) {
    this.kit = new Kit(g);
    g.interactions.add((x, z, _yaw, driving, out) => {
      const m = this.openNow, p = this.startPoint;
      if (!m || !p || driving || this.running || this.missionsOff()) return;
      if (Math.hypot(p.x - x, p.z - z) > 4.5) return;
      out.push({ key: "KeyE", html: w.start(T(m.title)), priority: 96, run: () => this.begin(m) });
    });
  }

  get active(): MissionDef | null {
    return this.running;
  }

  get done(): string[] {
    return this.g.life.data.story.done;
  }

  /** The next story mission not yet done. */
  get next(): MissionDef | null {
    return this.list.find((m) => !m.side && !this.done.includes(m.id)) ?? null;
  }

  /** After a page load: back to where a journey left off, or else put up what comes next. */
  resume(): void {
    const s = this.g.life.data.story;
    if (s.current && !this.missionsOff()) {
      const m = this.list.find((q) => q.id === s.current);
      if (m) {
        this.begin(m, s.stage);
        return;
      }
    }
    this.refreshNext();
  }

  private refreshNext(): void {
    this.openNow = null;
    this.startPoint = null;
    this.kit.title = null;
    this.kit.clearMarker();
    this.g.panels.setObjective(null);
    if (this.missionsOff() || this.running) return;
    const m = this.next;
    if (!m) return;
    if (m.region !== this.here()) {
      this.g.panels.setObjective(w.nextUp, w.goTo(regionWord(m.region)));
      return;
    }
    this.g.phone.addJob(m.id, T(m.title), "chacha", T(m.blurb));
    this.openNow = m;
    this.startPoint = m.start(this.kit);
    this.kit.marker(this.startPoint.x, this.startPoint.z, m.title);
    this.g.panels.setObjective(w.nextUp, T(m.title));
  }

  /** The menu switch in the settings. */
  setOff(off: boolean): void {
    if (off && this.running) this.stop();
    this.refreshNext();
  }

  /** Starts a mission from wherever it's got to. */
  begin(m: MissionDef, stage = 0, replay = false): void {
    if (this.running) return;
    this.running = m;
    this.stageIndex = stage;
    this.replay = replay;
    this.openNow = null;
    this.kit.clearMarker();
    this.kit.title = T(m.title);
    void this.play(m);
  }

  private async play(m: MissionDef): Promise<void> {
    const k = this.kit;
    const story = this.g.life.data.story;
    try {
      while (this.stageIndex < m.stages.length) {
        const st = m.stages[this.stageIndex];
        if (!this.replay && !m.side) {
          story.current = m.id;
          story.stage = this.stageIndex;
        }
        if (st.region && st.region !== this.here()) {
          // Stays open across the journey: the page reloads, and `resume` picks it up over there.
          k.objective([`${regionWord(st.region)} যান`, `Go to ${regionWord(st.region)}`]);
          await k.until(() => false, 1e9);
        }
        await st.run(k);
        this.stageIndex++;
      }
      this.won(m);
    } catch (e) {
      if (e instanceof MissionFailed) this.lost(m, e.why);
      else {
        console.error("mission", m.id, e);
        (window as unknown as { __errs?: string[] }).__errs?.push(`mission ${m.id}: ${String(e).slice(0, 200)}`);
        this.lost(m, ["কিছু একটা ভুল হয়ে গেছে।", "Something went wrong."]);
      }
    }
  }

  private won(m: MissionDef): void {
    const g = this.g, k = this.kit;
    k.tidy();
    this.running = null;
    const story = g.life.data.story;
    if (m.side) {
      k.title = null;
      if (m.money) {
        g.wallet.receive(m.money);
        g.panels.money(m.money);
        g.life.data.stats.earned += m.money;
        g.audio.chime();
      }
      if (m.rep) g.life.addRep(m.rep);
      this.refreshNext();
      this.afterSide?.();
      return;
    }
    const first = !this.replay && !story.done.includes(m.id);
    const pay = first ? m.money : Math.round(m.money * 0.25);
    if (pay) {
      g.wallet.receive(pay);
      g.panels.money(pay);
      g.life.data.stats.earned += pay;
    }
    if (first) {
      story.done.push(m.id);
      g.phone.finishJob(m.id);
      if (m.rep) g.life.addRep(m.rep);
      g.life.learn(m.lesson, m.sense ?? 1);
    }
    story.current = null;
    story.stage = 0;
    k.title = null;
    g.audio.chime();
    g.panels.banner(w.passed, pay ? w.reward(bn.money(pay)) : "", 5);
    if (first && m.lesson) g.panels.toast(T(m.lesson), "good");
    g.saveNow();
    if (first && !this.next && !story.finished) {
      story.finished = true;
      this.onFinished?.();
      g.panels.toast(w.allDone, "good");
    } else if (first) g.panels.toast(w.newMission);
    this.refreshNext();
  }

  /** Runs after a side job finishes, for whatever comes next in it. */
  afterSide: (() => void) | null = null;

  private lost(m: MissionDef, why: Line): void {
    const g = this.g, k = this.kit;
    k.tidy();
    this.running = null;
    k.title = null;
    if (m.side) {
      g.panels.toast(T(why), "bad");
      this.refreshNext();
      return;
    }
    g.audio.thud(0.3);
    g.panels.banner(w.failed, T(why), 4.5);
    // Try that part again, or go and do something else first.
    const stage = this.stageIndex, replay = this.replay;
    this.menu = [
      () => this.begin(m, stage, replay),
      () => {
        g.life.data.story.current = null;
        g.life.data.story.stage = 0;
        this.refreshNext();
      },
    ];
    g.hud.showChoices([{ text: w.retry }, { text: w.giveUp }]);
    if (k.auto) this.pickMenu(1);
  }

  private pickMenu(i: number): void {
    const list = this.menu;
    this.menu = null;
    this.g.hud.hideChoices();
    list?.[i]?.();
  }

  /** Ends whatever's running without a fuss. */
  stop(): void {
    if (!this.running) return;
    this.kit.abort(["বন্ধ করা হয়েছে", "Stopped"]);
    this.menu = null;
    this.g.hud.hideChoices();
  }

  /** The hero collapsed, or something else outside it has stopped it. */
  fail(why: Line): void {
    if (this.running) this.kit.abort(why);
  }

  update(dt: number): void {
    this.kit.tick(dt);
    if (this.menu) {
      const input = this.g.input;
      const i = this.g.hud.readChoice(dt, (c) => input.pressed(c), input.wheel, input.clicked);
      if (i >= 0) this.pickMenu(i);
    }
    // The marker keeps a little distance from what the hero's up to.
    this.hintTimer -= dt;
    if (this.hintTimer <= 0 && !this.running && !this.menu) {
      this.hintTimer = 3;
      if (this.missionsOff() && (this.openNow || this.startPoint)) this.refreshNext();
      else if (!this.missionsOff() && !this.openNow && this.next?.region === this.here()) this.refreshNext();
    }
  }
}

function regionWord(id: string): string {
  return { dhaka_mirpur10: L("মিরপুর", "Mirpur"), dhaka_gulshan: L("গুলশান", "Gulshan"), dhaka_dhanmondi: L("ধানমন্ডি", "Dhanmondi") }[id] ?? id;
}
