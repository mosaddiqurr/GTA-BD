import type { CharacterId } from "../characters/character";
import { EVENTS } from "../dialogue/events";
import { CALLS } from "../dialogue/scams/calls";
import { FOLLOWUPS } from "../dialogue/scams/followups";
import { MESSAGES } from "../dialogue/scams/messages";
import { STRANGERS, STRANGER_SPEAKER } from "../dialogue/scams/strangers";
import type { Scam, StreetEvent, Tree } from "../dialogue/types";
import { L, T } from "../localization/bn";
import type { Hud } from "../ui/hud";
import type { Phone } from "../ui/phone";
import type { Panels } from "../ui/panels";
import type { Life } from "../app/life";
import type { Pedestrians, Person } from "../npc/pedestrians";
import type { Player } from "../player/player";
import type { Talk } from "./talk";
import type { TreeRunner } from "./treeRunner";
import type { Interactions } from "./interactions";

const w = {
  prompt: (n: string) => L(`<kbd>E</kbd> ${n}`, `<kbd>E</kbd> ${n}`),
  incoming: (n: string) => L(`ফোন আসছে: ${n}`, `Incoming call: ${n}`),
  smsFrom: (n: string) => L(`মেসেজ: ${n}`, `Message: ${n}`),
  answer: L("ফোন ধরুন", "Answer"),
  decline: L("কেটে দিন", "Decline"),
  looksOdd: L("আপনার মনে হচ্ছে এই নম্বরটা সন্দেহজনক।", "Something about this number looks off to you."),
  strangerHint: L("একজন আপনাকে কিছু দেখাতে চান", "Someone wants to show you something"),
};

const ACTOR_PERSON: Record<string, CharacterId> = {
  woman: "npc_woman_apple", girl: "npc_girl_pear", granny: "npc_granny_fig", elder: "npc_elder_date", young: "npc_student_lemon", mid: "npc_office_orange", seller: "npc_shop_papaya", deep: "npc_worker_jackfruit", kid: "npc_kid_berry", hero: "npc_commuter_lychee",
};

/** Scams that turn up by themselves in ordinary play, and what happens on the street around the hero. */
export class Everyday {
  private scamTimer = 170;
  private strangerTimer = 240;
  private eventTimer = 130;
  private offer: { who: Person; hint: string; tree: Tree; label: string; left: number; counts: boolean } | null = null;
  private answering: Scam | null = null;
  private answerLeft = 0;

  constructor(
    private phone: Phone,
    private tree: TreeRunner,
    private hud: Hud,
    private panels: Panels,
    private life: Life,
    private peds: Pedestrians,
    private player: Player,
    private talk: Talk,
    interactions: Interactions,
    private input: () => { pressed: (c: string) => boolean; wheel: number; clicked: boolean },
    private busy: () => boolean,
    private off: () => boolean,
    private playSeconds: () => number,
  ) {
    interactions.add((x, z, _yaw, driving, out) => {
      const q = this.offer;
      if (!q || driving || Math.hypot(q.who.x - x, q.who.z - z) > 3.4) return;
      out.push({ key: "KeyE", html: w.prompt(q.hint), priority: 88, focus: q.who, run: () => this.takeOffer() });
    });
  }

  private takeOffer(): void {
    const q = this.offer;
    if (!q) return;
    this.offer = null;
    q.who.forceLive = true;
    void this.tree.inPerson(q.tree, q.who, q.label, undefined, q.counts).then(() => {
      q.who.forceLive = false;
      setTimeout(() => {
        q.who.x = q.who.z = 1e5;
        this.peds.release(q.who);
      }, 2500);
    });
  }

  private unseen(list: Scam[]): Scam {
    const seen = this.life.data.scams.seen;
    const fresh = list.filter((q) => !seen.includes(q.key) && !q.followUp);
    if (!fresh.length) {
      seen.length = 0;
      return list[Math.floor(Math.random() * list.length)];
    }
    const q = fresh[Math.floor(Math.random() * fresh.length)];
    seen.push(q.key);
    return q;
  }

  /** It rings: pick up, or don't. Someone who's learnt a bit gets a feeling about it first. */
  private ring(q: Scam): void {
    this.phone.host.audio.ring();
    this.panels.toast(w.incoming(T(q.from)));
    if (this.life.sense >= 6 && !q.real) this.panels.toast(w.looksOdd, "bad");
    this.answering = q;
    this.answerLeft = 12;
    this.hud.showChoices([{ text: `${w.answer}: ${T(q.from)}` }, { text: w.decline }]);
  }

  private sms(q: Scam): void {
    this.phone.host.audio.thud(0.12);
    const body = q.body ? T(q.body) : "";
    this.phone.receive("unknown", body);
    this.hud.showInfo(w.smsFrom(T(q.from)), body, 9);
    if (this.life.sense >= 6 && !q.real) this.panels.toast(w.looksOdd, "bad");
    void this.tree.phone(q, "npc_office_orange", T(q.from));
  }

  pickCall(): Scam[] {
    return CALLS;
  }

  pickSms(): Scam {
    return this.unseen(MESSAGES);
  }

  private nextScam(): void {
    const s = this.life.data.scams;
    const now = this.playSeconds();
    const due = s.pending.find((p) => p.at <= now);
    if (due) {
      s.pending.splice(s.pending.indexOf(due), 1);
      const q = FOLLOWUPS.find((f) => f.key === due.key);
      if (q) {
        if (q.kind === "sms") this.sms(q);
        else this.ring(q);
        return;
      }
    }
    if (now < s.quietUntil) return;
    if (Math.random() < 0.5) this.ring(this.unseen(CALLS));
    else this.sms(this.unseen(MESSAGES));
  }

  private spawnNear(id: CharacterId): Person {
    const who = this.peds.addStanding(id, "wave");
    const a = this.player.yaw + (Math.random() - 0.5) * 1.2;
    who.x = this.player.x + Math.sin(a) * 4.5;
    who.z = this.player.z + Math.cos(a) * 4.5;
    who.y = this.player.y;
    who.yaw = a + Math.PI;
    who.forceLive = true;
    return who;
  }

  private nextStranger(): void {
    const q = this.unseen(STRANGERS);
    const who = this.spawnNear(ACTOR_PERSON[STRANGER_SPEAKER[q.key]] ?? "npc_office_orange");
    this.offer = { who, hint: w.strangerHint, tree: q, label: T(q.from), left: 40, counts: true };
  }

  private nextEvent(): void {
    const q: StreetEvent = EVENTS[Math.floor(Math.random() * EVENTS.length)];
    const who = this.spawnNear(q.id as CharacterId);
    this.offer = { who, hint: T(q.hint), tree: q, label: "", left: 40, counts: false };
  }

  /** The "is this real?" and street things are for someone on foot and not in the middle of anything. */
  update(dt: number): void {
    if (this.answering) {
      this.answerLeft -= dt;
      const input = this.input();
      const i = this.hud.readChoice(dt, input.pressed, input.wheel, input.clicked);
      if (i >= 0 || this.answerLeft <= 0) {
        const q = this.answering;
        this.answering = null;
        this.hud.hideChoices();
        if (i === 0) void this.tree.phone(q, "npc_office_orange", T(q.from));
        else if (!q.real) {
          this.life.data.scams.spotted++;
        }
      }
      return;
    }
    const q = this.offer;
    if (q) {
      q.left -= dt;
      if (q.left <= 0 && !this.talk.active) {
        q.who.x = q.who.z = 1e5;
        this.peds.release(q.who);
        this.offer = null;
      }
    }
    if (this.off() || this.busy() || this.tree.active || this.talk.active) return;
    this.scamTimer -= dt;
    this.strangerTimer -= dt;
    this.eventTimer -= dt;
    if (this.scamTimer <= 0) {
      this.scamTimer = 150 + Math.random() * 200;
      this.nextScam();
      return;
    }
    if (this.player.stage !== "foot" || this.offer || this.player.x > 4000) return;
    if (this.strangerTimer <= 0) {
      this.strangerTimer = 220 + Math.random() * 240;
      this.nextStranger();
    } else if (this.eventTimer <= 0) {
      this.eventTimer = 150 + Math.random() * 180;
      this.nextEvent();
    }
  }
}
