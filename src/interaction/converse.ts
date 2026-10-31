import { HeroKind } from "../app/heroes";
import { itemOf } from "../app/items";
import type { Life, PersonMemory } from "../app/life";
import type { Wallet } from "../app/save";
import { ADDRESSED } from "../dialogue/address";
import { ROLE_TALK } from "../dialogue/street";
import type { Favour, Line, RoleTalk } from "../dialogue/types";
import { L, T, bn, bnNum } from "../localization/bn";
import { Kit, t } from "../missions/kit";
import type { MissionRunner } from "../missions/runner";
import type { Pedestrians, Person } from "../npc/pedestrians";
import type { Player } from "../player/player";
import type { Panels } from "../ui/panels";
import type { Bag } from "./bag";
import type { Item, Talk } from "./talk";

export const words = {
  chat: L("গল্প করুন", "Chat"),
  family: L("বাড়ির সবাই কেমন?", "How's the family?"),
  money: L("আয় রোজগার কেমন?", "How's business?"),
  city: L("এই শহর কেমন লাগে?", "What do you make of this city?"),
  food: L("এখানে ভালো খাবার কোথায়?", "Where's the good food round here?"),
  weather: L("আজকের দিনটা কেমন?", "How's the day treating you?"),
  joke: L("একটা মজার কথা বলুন", "Tell me something funny"),
  dream: L("কী করার ইচ্ছা?", "What would you love to do?"),
  complaint: L("কোনো সমস্যা?", "Any troubles?"),
  gossip: L("পাড়ার খবর কী?", "What's the local news?"),
  advice: L("শহরে সাবধান থাকব কীভাবে?", "How do I stay safe in this city?"),
  scamStory: L("কেউ ঠকেছে নাকি?", "Has anyone been cheated?"),
  favour: L("কিছু সাহায্য লাগবে?", "Can I help with anything?"),
  give: L("কিছু দিন", "Give something"),
  giveMoney: (a: string) => L(`${a} টাকা দিন`, `Give ${a} taka`),
  giveItem: (n: string) => L(`দিন: ${n}`, `Give: ${n}`),
  praise: L("প্রশংসা করুন", "Say something nice"),
  praiseSay: L("আপনাকে দেখে ভালো লাগল।", "It's good to see you."),
  rude: L("খারাপ কথা বলুন", "Be rude"),
  rudeSay: L("আপনার সাথে কথা বলা সময় নষ্ট।", "Talking to you is a waste of time."),
  sorry: L("ক্ষমা চান", "Apologise"),
  sorrySay: L("আগের ব্যবহারের জন্য দুঃখিত।", "I'm sorry for how I behaved."),
  photo: L("একসাথে একটা ছবি তুলি?", "Can we take a photo together?"),
  photoDone: L("ছবি উঠল। ফোনের গ্যালারিতে আছে।", "Photo taken. It's in your phone's gallery."),
  busy: L("এখন হাতে আরেকটা কাজ আছে।", "You've something else on just now."),
  back: L("অন্য কথা", "Something else"),
  repUp: (n: string) => L(`সুনাম +${n}`, `Standing +${n}`),
  repDown: (n: string) => L(`সুনাম −${n}`, `Standing −${n}`),
  favourTitle: L("একটু সাহায্য", "A small favour"),
  favourThere: L("কাজটা করুন", "Do the job"),
  favourBack: L("ফিরে গিয়ে জানান", "Go back and tell them"),
  nameIs: (n: string) => L(`উনি ${n}`, `That's ${n}`),
  freeGift: L("খুশি হয়ে একটা বিস্কুট দিলেন।", "They're pleased, and give you a biscuit for free."),
};

const GIFTS = [10, 50, 100];

/** How people remember the hero, and everything that can be said to them. Who they are decides the
 *  words, what's happened between them decides how they're said, and the hero's good name colours it all. */
export class Converse {
  private listAt = new Map<readonly Line[], number>();
  private praisedThisTalk = false;
  private ambient = 50;

  constructor(
    private talk: Talk,
    private life: Life,
    private wallet: Wallet,
    private bag: Bag,
    private panels: Panels,
    private peds: Pedestrians,
    private player: Player,
    private hero: HeroKind,
    private runner: () => MissionRunner,
    private snap: () => void,
    private playSeconds: () => number,
    private isHot: () => boolean,
    private isRaining: () => boolean,
    private isNight: () => boolean,
    private line: (text: string, who: Person) => void,
  ) {}

  private roleOf(p: Person): RoleTalk | null {
    return ROLE_TALK[p.id] ?? null;
  }

  private pick(list: readonly Line[]): string {
    const n = this.listAt.get(list) ?? Math.floor(Math.random() * list.length);
    this.listAt.set(list, n + 1);
    return T(list[n % list.length]);
  }

  /** People who stay put are remembered by where they are. Anyone just walking by is one meeting. */
  private mem(p: Person): PersonMemory {
    const fixed = !("state" in p);
    const key = fixed ? `${p.id}@${Math.round(p.x / 25)},${Math.round(p.z / 25)}` : `${p.id}~${Math.round(p.offset * 1e4)}`;
    return this.life.memory(key);
  }

  private mood(m: PersonMemory): number {
    return m.feel + this.life.rep / 8;
  }

  /** Someone who's had enough of the hero won't talk or sell. */
  refuses(p: Person): string | null {
    const r = this.roleOf(p);
    if (!r) return null;
    return this.mood(this.mem(p)) < -7 ? this.pick(r.refuse) : null;
  }

  greeting(p: Person): string | null {
    const r = this.roleOf(p);
    if (!r) return null;
    const m = this.mem(p);
    const mood = this.mood(m);
    m.met++;
    m.last = this.playSeconds();
    this.praisedThisTalk = false;
    if (mood < -2) return this.pick(r.greetDisliked);
    if (mood > 4) return this.pick(r.greetLiked);
    if (m.met > 1) return this.pick(r.greetKnown);
    // A stranger, who speaks to the hero as whoever they can see they are.
    const a = ADDRESSED[this.hero.id as keyof typeof ADDRESSED];
    if (a && Math.random() < 0.4) return this.pick(a.greet);
    return this.pick(r.greetStranger);
  }

  byeLine(p: Person): string | null {
    const r = this.roleOf(p);
    return r ? this.pick(r.bye) : null;
  }

  /** The topics under "chat". */
  chatItems(p: Person, back: () => void): Item[] {
    const r = this.roleOf(p);
    if (!r) return [];
    const m = this.mem(p);
    const topic = (text: string, list: readonly Line[]): Item => ({
      text,
      run: () => this.talk.heroSay(text, () => {
        m.feel += 0.2;
        this.talk.say(this.pick(list), back);
      }),
    });
    const weather = this.isRaining() ? r.rain : this.isNight() ? r.night : this.isHot() ? r.hot : r.city;
    return [
      topic(words.family, r.family), topic(words.money, r.money), topic(words.city, r.city), topic(words.food, r.food), topic(words.weather, weather),
      topic(words.gossip, r.gossip), topic(words.joke, r.joke), topic(words.dream, r.dream), topic(words.complaint, r.complaint),
    ];
  }

  /** A picture together, which sits with the chat. */
  photoItem(p: Person, back: () => void): Item | null {
    const r = this.roleOf(p);
    if (!r) return null;
    const m = this.mem(p);
    return { text: words.photo, run: () => this.talk.heroSay(words.photo, () => {
      this.snap();
      this.life.data.stats.photos++;
      m.feel += 0.5;
      this.panels.toast(words.photoDone, "good");
      this.talk.say(this.pick(r.thanked), back);
    }) };
  }

  /** Everything else to say or do, beside chatting. */
  items(p: Person, back: () => void): Item[] {
    const r = this.roleOf(p);
    if (!r) return [];
    const m = this.mem(p);
    const out: Item[] = [
      {
        text: words.advice,
        run: () => this.talk.heroSay(words.advice, () => {
          m.feel += 0.2;
          this.talk.say(this.pick(Math.random() < 0.4 ? r.scamStory : r.advice), back);
        }),
      },
    ];
    if (r.favours.length && !this.runner().active) {
      out.push({
        text: words.favour,
        run: () => this.talk.heroSay(words.favour, () => {
          const fav = r.favours[Math.floor(Math.random() * r.favours.length)];
          this.talk.say(T(fav.ask), () => {
            this.talk.closeNow();
            this.startFavour(p, r, fav, m);
          });
        }),
      });
    }
    out.push({ text: words.give, run: () => this.giveMenu(p, r, m, back) });
    if (m.feel < 0) {
      out.push({ text: words.sorry, run: () => this.talk.heroSay(words.sorrySay, () => {
        m.feel = Math.min(1, m.feel + 4);
        this.life.addRep(1);
        this.talk.say(this.pick(r.apologyAccepted), back);
      }) });
    } else if (!this.praisedThisTalk) {
      out.push({ text: words.praise, run: () => this.talk.heroSay(words.praiseSay, () => {
        this.praisedThisTalk = true;
        m.feel += 1.5;
        this.life.addRep(1);
        const a = ADDRESSED[this.hero.id as keyof typeof ADDRESSED];
        this.talk.say(a && Math.random() < 0.3 ? this.pick(a.compliment) : this.pick(r.praised), back);
      }) });
    }
    out.push({ text: words.rude, run: () => this.talk.heroSay(words.rudeSay, () => {
      m.feel -= 4;
      m.rude = (m.rude ?? 0) + 1;
      this.life.addRep(-2);
      this.talk.say(this.pick(r.insulted), () => this.talk.closeNow());
    }) });
    return out;
  }

  private giveMenu(p: Person, r: RoleTalk, m: PersonMemory, back: () => void): void {
    const items: Item[] = GIFTS.filter((a) => this.wallet.can(a)).map((a) => ({
      text: words.giveMoney(bnNum(a)),
      run: () => {
        this.wallet.spend(a);
        m.feel += a >= 50 ? 2 : 1;
        this.life.addRep(a >= 100 ? 2 : 1);
        const hero = ADDRESSED[this.hero.id as keyof typeof ADDRESSED];
        this.talk.say(hero && Math.random() < 0.3 ? this.pick(hero.thanks) : this.pick(r.thanked), back);
      },
    }));
    const kept = Object.keys(this.wallet.items).filter((k) => ["food", "thing", "wear"].includes(itemOf(k).kind)).slice(0, 5);
    for (const key of kept) {
      items.push({
        text: words.giveItem(this.bag.nameOf(key)),
        run: () => {
          this.bag.take(key);
          m.feel += 3;
          this.life.addRep(1);
          this.talk.say(this.pick(r.giftTaken), back);
        },
      });
    }
    items.push({ text: words.back, run: back });
    this.talk.menuOf(items);
  }

  private startFavour(p: Person, r: RoleTalk, fav: Favour, m: PersonMemory): void {
    const pay = 20 + Math.floor(Math.random() * 7) * 10;
    this.runner().begin({
      id: "favour",
      side: true,
      region: "",
      title: t(words.favourTitle, words.favourTitle),
      blurb: fav.goal,
      start: () => ({ x: p.x, z: p.z }),
      money: pay,
      rep: 2,
      stages: [{
        run: async (k: Kit) => {
          const to = k.away(70 + Math.random() * 60);
          await k.reachOnFoot(to.x, to.z, fav.goal, fav.goal, 3);
          k.note(t("হয়ে গেছে।", "Done."));
          const a = k.existing(p, t("", ""));
          await k.chase(a, t(words.favourBack, words.favourBack), t("", ""), 3, 1e5);
          await k.talk(a, [["o", fav.done]]);
          m.feel += 3;
          m.helped = (m.helped ?? 0) + 1;
          this.life.data.stats.helped++;
        },
      }],
    });
  }

  /** Now and then someone says something in passing, as they would to this particular person. */
  update(dt: number): void {
    this.ambient -= dt;
    if (this.ambient > 0 || this.player.stage !== "foot" || this.talk.active) return;
    this.ambient = 45 + Math.random() * 50;
    const who = this.peds.nearestPerson(this.player.x, this.player.z, this.player.yaw, 6, this.player.y);
    const a = ADDRESSED[this.hero.id as keyof typeof ADDRESSED];
    if (!who || !a) return;
    const lists = [a.tease, a.concern, a.offer];
    this.line(this.pick(lists[Math.floor(Math.random() * lists.length)]), who);
  }

  /** Called when something's just been bought, for the odd kindness from someone who likes the hero. */
  afterSale(p: Person | null): void {
    if (!p) return;
    const m = this.mem(p);
    m.feel += 0.3;
    if (this.mood(m) > 6 && Math.random() < 0.15) {
      this.wallet.add("biscuit");
      this.panels.toast(words.freeGift, "good");
    }
  }

  repToast(change: number): void {
    if (Math.abs(change) >= 2) this.panels.toast(change > 0 ? words.repUp(bnNum(change)) : words.repDown(bnNum(-change)), change > 0 ? "good" : "bad");
  }
}
