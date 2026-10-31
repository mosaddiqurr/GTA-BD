import type { FriendState, Life } from "../app/life";
import { FRIENDS } from "../dialogue/friends";
import type { FriendDef, Line, Scene } from "../dialogue/types";
import { L, T, bn, bnNum } from "../localization/bn";
import { Kit, t } from "../missions/kit";
import type { MissionRunner } from "../missions/runner";
import type { Pedestrians, Person } from "../npc/pedestrians";
import type { Player } from "../player/player";
import { CONTACTS } from "../ui/phoneData";
import type { Phone } from "../ui/phone";
import type { Panels } from "../ui/panels";
import type { City } from "../world/city";
import type { Interactions } from "./interactions";
import type { Talk } from "./talk";
import type { TreeRunner } from "./treeRunner";

const w = {
  prompt: (n: string) => L(`<kbd>E</kbd> ${n}-এর সাথে কথা বলুন`, `<kbd>E</kbd> Talk to ${n}`),
  meet: (n: string) => L(`<kbd>E</kbd> আলাপ করুন: ${n}`, `<kbd>E</kbd> Say hello: ${n}`),
  chat: L("গল্প করুন", "Chat"),
  tea: L("চলো, চা খাই", "Let's have tea"),
  favour: L("কোনো কাজ আছে?", "Anything I can do?"),
  gift: L("একটা উপহার দিন", "Give a present"),
  bye: L("পরে কথা হবে", "Talk later"),
  madeFriend: (n: string) => L(`নতুন বন্ধু: ${n}। ফোনে নম্বর আছে।`, `New friend: ${n}. Their number's in your phone.`),
  closer: (n: string) => L(`${n}-এর সাথে বন্ধুত্ব আরও গভীর হলো`, `You and ${n} have grown closer`),
  teaGoal: (n: string) => L(`চায়ের দোকানে ${n}-এর সাথে দেখা করুন`, `Meet ${n} at the tea stall`),
  teaTitle: L("বন্ধুর সাথে চা", "Tea with a friend"),
  favourTitle: L("বন্ধুর কাজ", "A friend's favour"),
  favourBack: L("ফিরে গিয়ে জানান", "Go back and tell them"),
  stall: L("চায়ের দোকান", "Tea stall"),
  comeTea: L("চা খেতে আসবে?", "Fancy some tea?"),
  missed: (n: string) => L(`${n}-এর ফোন ধরলেন না`, `You missed a call from ${n}`),
  level: (n: string) => L(`বন্ধুত্ব ${n}`, `Closeness ${n}`),
  where: (n: string) => L(`থাকে: ${n}`, `Lives in: ${n}`),
  notMet: L("এখনও দেখা হয়নি", "Not met yet"),
};

const EVERY = [260, 520];

/** People the hero gets to know: found around the city, phoned, met for tea, and they ring back. */
export class Friends {
  private here: { def: FriendDef; who: Person; label: string }[] = [];
  private timer = EVERY[0];
  private invited: FriendDef | null = null;

  constructor(
    private city: City,
    private peds: Pedestrians,
    private player: Player,
    private talk: Talk,
    private life: Life,
    private phone: Phone,
    private panels: Panels,
    private tree: TreeRunner,
    private runner: () => MissionRunner,
    interactions: Interactions,
    private playSeconds: () => number,
    private spend: (n: number) => boolean,
    private off: () => boolean,
  ) {
    for (const def of FRIENDS) if (life.friend(def.key).met) this.addContact(def);
    for (const def of FRIENDS) {
      if (def.region !== city.region.id) continue;
      const at = this.spotFor(def);
      const who = peds.addStanding(def.id as Person["id"], "idle_look");
      who.x = at.x;
      who.y = city.layout.groundHeight(at.x, at.z);
      who.z = at.z;
      who.yaw = Math.random() * 6;
      this.here.push({ def, who, label: T(def.name) });
    }
    interactions.add((x, z, yaw, driving, out) => {
      if (driving || this.runner().active) return;
      void yaw;
      for (const f of this.here) {
        if (Math.abs(f.who.x - x) > 3 || Math.abs(f.who.z - z) > 3) continue;
        const state = this.life.friend(f.def.key);
        out.push({ key: "KeyE", html: state.met ? w.prompt(f.label) : w.meet(f.label), priority: 82, focus: f.who, run: () => this.meet(f) });
        return;
      }
    });
    phone.onCallEnded = (id) => {
      const def = FRIENDS.find((d) => d.key === id);
      if (def) this.comeForTea(def);
    };
  }

  private spotFor(def: FriendDef): { x: number; z: number } {
    const city = this.city;
    if (def.hangout === "tea") {
      const s = city.region.spawnPoints.default;
      const list = city.stalls.filter((q) => q.kind === "tea").sort((a, b) => Math.hypot(a.x - s[0], a.z - s[2]) - Math.hypot(b.x - s[0], b.z - s[2]));
      const st = list[3 % list.length];
      return { x: st.x + 3, z: st.z + 2.4 };
    }
    const b = city.layout.blocks.find((q) => q.kind === def.hangout) ?? city.layout.blocks[0];
    return { x: (b.x0 + b.x1) / 2 + 6, z: b.z0 + b.sidewalk * 0.5 };
  }

  private addContact(def: FriendDef): void {
    if (CONTACTS.some((c) => c.id === def.key)) return;
    const pickOne = (l: Line[]): string => T(l[Math.floor(Math.random() * l.length)]);
    CONTACTS.push({
      id: def.key,
      name: T(def.name),
      about: T(def.bio),
      number: `০১৭০০-০০${String(10 + FRIENDS.indexOf(def)).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)])}০০`,
      voice: def.id,
      bank: true,
      calls: def.callHello.map((_, i) => [T(def.callHello[i]), w.comeTea, pickOne(def.callYes)]),
    });
  }

  private scene(f: { def: FriendDef; who: Person; label: string }, lines: Scene, then: () => void): void {
    const talk = this.talk;
    talk.beginScene(f.who, f.label);
    const go = (i: number): void => {
      if (i >= lines.length) {
        then();
        return;
      }
      const [who, line] = lines[i];
      if (who === "o") talk.say(T(line), () => go(i + 1));
      else talk.heroSay(T(line), () => go(i + 1));
    };
    go(0);
  }

  private meet(f: { def: FriendDef; who: Person; label: string }): void {
    const state = this.life.friend(f.def.key);
    if (!state.met) {
      this.scene(f, f.def.firstMeet, () => {
        state.met = true;
        this.addContact(f.def);
        this.panels.toast(w.madeFriend(f.label), "good");
        this.menu(f, state);
      });
      return;
    }
    this.talk.beginScene(f.who, f.label);
    this.talk.say(T(f.def.smallTalk[Math.floor(Math.random() * f.def.smallTalk.length)]), () => this.menu(f, state));
  }

  private said = 0;

  private menu(f: { def: FriendDef; who: Person; label: string }, state: FriendState): void {
    const talk = this.talk;
    const items = [
      { text: w.chat, run: () => talk.say(T(f.def.smallTalk[this.said++ % f.def.smallTalk.length]), () => this.menu(f, state)) },
      { text: w.tea, run: () => {
        talk.closeNow();
        this.comeForTea(f.def);
      } },
      { text: w.favour, run: () => {
        const fav = f.def.favours[state.favours % f.def.favours.length];
        talk.say(T(fav.ask), () => {
          talk.closeNow();
          this.favour(f, state, fav);
        });
      } },
      { text: w.gift, run: () => {
        const key = Object.keys(this.phone.host.wallet().items)[0];
        if (!key) {
          this.panels.toast(bn.bagEmpty);
          this.menu(f, state);
          return;
        }
        this.phone.host.wallet().items[key]--;
        if (this.phone.host.wallet().items[key] <= 0) delete this.phone.host.wallet().items[key];
        talk.say(T(f.def.gift[Math.floor(Math.random() * f.def.gift.length)]), () => {
          this.closer(f.def, state, 1);
          this.menu(f, state);
        });
      } },
      { text: w.bye, run: () => talk.closeNow() },
    ];
    talk.menuOf(items);
  }

  private closer(def: FriendDef, state: FriendState, by: number): void {
    const before = Math.floor(state.level / 4);
    state.level += by;
    state.hurt = 0;
    if (Math.floor(state.level / 4) > before) {
      this.panels.toast(w.closer(T(def.name)), "good");
      this.life.addRep(1);
    }
  }

  private favour(f: { def: FriendDef; who: Person; label: string }, state: FriendState, fav: FriendDef["favours"][number]): void {
    this.runner().begin({
      id: "friendFavour",
      side: true,
      region: "",
      title: t(w.favourTitle, w.favourTitle),
      blurb: fav.goal,
      start: () => ({ x: f.who.x, z: f.who.z }),
      money: 0,
      rep: 2,
      stages: [{
        run: async (k: Kit) => {
          const to = k.away(90 + Math.random() * 90);
          await k.reachOnFoot(to.x, to.z, fav.goal, fav.goal, 3);
          const a = k.existing(f.who, [T(f.def.name), T(f.def.name)]);
          await k.reachOnFoot(f.who.x, f.who.z, f.def.name, t(w.favourBack, w.favourBack), 3);
          await k.talk(a, [["o", fav.done]]);
          state.favours++;
          this.closer(f.def, state, 3);
        },
      }],
    });
  }

  /** They'll be at the nearest tea stall to wherever the hero is. */
  comeForTea(def: FriendDef): void {
    if (this.runner().active || this.off()) return;
    this.invited = def;
    const state = this.life.friend(def.key);
    state.lastCall = this.playSeconds();
    const name = T(def.name);
    this.runner().begin({
      id: "friendTea",
      side: true,
      region: "",
      title: t(w.teaTitle, w.teaTitle),
      blurb: def.bio,
      start: () => this.player.position,
      money: 0,
      stages: [{
        run: async (k: Kit) => {
          const st = k.teaStall();
          const friend = k.person(def.id as Person["id"], st.x + 2.4, st.z + 2, def.name);
          await k.reachOnFoot(friend.x, friend.z, def.name, t(w.teaGoal(name), w.teaGoal(name)), 3.2);
          k.faceHero(friend);
          const talks = def.teaTalks;
          await k.talk(friend, talks[state.teas % talks.length]);
          this.spend(40);
          k.g.life.refresh(45);
          k.g.life.heal(6);
          state.teas++;
          this.closer(def, state, 2);
        },
      }],
    });
  }

  /** Who's a friend, for the journal. */
  html(): string {
    return FRIENDS.map((d) => {
      const s = this.life.friend(d.key);
      return `<div class="journal-row ${s.met ? "" : "locked"}"><div><b>${s.met ? T(d.name) : "?"}</b><small>${s.met ? T(d.bio) : w.notMet}</small></div>${s.met ? `<em>${w.level(bnNum(s.level))}</em>` : ""}</div>`;
    }).join("");
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0 || this.off() || this.tree.active || this.runner().active || this.talk.active) return;
    this.timer = EVERY[0] + Math.random() * (EVERY[1] - EVERY[0]);
    const known = FRIENDS.filter((d) => this.life.friend(d.key).met);
    if (!known.length) return;
    const def = known[Math.floor(Math.random() * known.length)];
    const state = this.life.friend(def.key);
    state.lastCall = this.playSeconds();
    const call = def.theyCall[Math.floor(Math.random() * def.theyCall.length)];
    this.phone.host.audio.ring();
    this.panels.toast(T(t(`ফোন: ${def.name[0]}`, `Call: ${def.name[1]}`)));
    void this.tree.phone(call, def.id, T(def.name), undefined, false).then(() => this.closer(def, state, 1));
  }
}
