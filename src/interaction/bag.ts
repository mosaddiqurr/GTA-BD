import type { Wallet } from "../app/save";
import { COOKED_HEAL, itemOf } from "../app/items";
import type { Life } from "../app/life";
import { BOOKS, MAGAZINE, NEWSPAPER } from "../dialogue/books";
import type { NewsItem } from "../dialogue/types";
import { L, T, bn } from "../localization/bn";
import type { Player } from "../player/player";
import type { BagRow, Panels } from "../ui/panels";
import type { Hud } from "../ui/hud";

const w = {
  eat: L("খান", "Eat"),
  drink: L("পান করুন", "Drink"),
  take: L("নিন", "Take"),
  read: L("পড়ুন", "Read"),
  wear: L("পরুন", "Wear"),
  wearing: L("পরা আছে", "Wearing"),
  put: L("ঘরে রাখুন", "Put it at home"),
  cook: L("রান্না করুন", "Cook"),
  noteFood: (n: string) => L(`শরীর +${n}`, `Health +${n}`),
  cookNote: L("ঘরে নিয়ে রান্না করলে ভালো খাবার হবে", "Cook it at home for a proper meal"),
  cookHome: L("এটা রান্না করতে ঘরে যেতে হবে।", "You need to be at home to cook this."),
  homeOnly: L("এটা ঘরে নিয়ে গিয়ে রাখুন।", "Take it home to put it there."),
  cooked: L("ঘরের রান্না! পেট ভরে খেলেন, শরীর অনেক ভালো।", "Home cooking! A proper meal, and you feel so much better."),
  worn: L("গায়ে পরে নিলেন। মানুষের চোখে একটু ভালো লাগছে।", "You put it on. People seem to like the look of you."),
  bookTitle: L("গল্পের বই", "Storybook"),
  paperTitle: L("আজকের পত্রিকা", "Today's paper"),
  magTitle: L("ম্যাগাজিন", "Magazine"),
  notesTitle: L("আমার খাতা", "My notebook"),
  notesEmpty: L("এখনও কিছু লেখা নেই। কোনো ঠকবাজি ধরতে পারলে বা ঠকলে সেই শিক্ষা এখানে লেখা থাকবে।", "Nothing yet. When you spot a scam, or fall for one, what you learnt gets written here."),
  smarter: L("পড়ে অনেক কিছু শিখলেন।", "You learnt a lot from that."),
  kept: L("ব্যাগে রাখা হলো: I চাপলে দেখবেন", "Into the bag: press I to see it"),
  rainNote: L("বৃষ্টি নামলে নিজেই কাজে লাগবে", "Comes out by itself in the rain"),
  simQuiet: 1500,
};

const CONSUMED = new Set(["food", "medicine", "service"]);
const DRINKS = new Set(["water", "coconut", "cane", "teacup", "hotelTea", "saline"]);

function names(): Map<string, string> {
  const out = new Map<string, string>();
  for (const list of Object.values(bn.shop.stock)) for (const it of list) if (!out.has(it.key)) out.set(it.key, it.name);
  return out;
}

/** What the hero has bought, and what it does for them. Everything works. */
export class Bag {
  private names = names();
  /** Is the hero at home, with somewhere to cook and put things? */
  atHome: () => boolean = () => false;
  /** Moves the clock on, for something that takes a while. */
  passTime: (hours: number) => void = () => undefined;
  saveGame: () => void = () => undefined;

  constructor(private wallet: Wallet, private life: Life, private player: Player, private panels: Panels, private hud: Hud, private playSeconds: () => number) {}

  nameOf(key: string): string {
    return this.names.get(key) ?? key;
  }

  /** Whether this is something to eat or take now, rather than to keep. */
  canUseNow(key: string): boolean {
    const k = itemOf(key).kind;
    return k === "food" || k === "medicine";
  }

  useWord(key: string): string {
    const d = itemOf(key);
    if (d.kind === "medicine") return w.take;
    return DRINKS.has(key) ? w.drink : w.eat;
  }

  /** Just paid for: anything done on the spot happens now, and the rest goes in the bag. */
  bought(key: string): void {
    const d = itemOf(key);
    if (d.kind === "service") {
      this.take(key);
      this.applyEffects(key);
      if (d.takes) this.passTime(d.takes);
      if (key === "hotelRoom") this.saveGame();
      if (d.note) this.hud.say(d.note, 4);
      return;
    }
    if (key === "recharge") {
      this.take(key);
      this.life.data.credit += 50;
      if (d.note) this.hud.say(d.note, 3);
      return;
    }
    if (key === "sim") {
      this.take(key);
      this.life.data.scams.quietUntil = this.playSeconds() + w.simQuiet;
      if (d.note) this.hud.say(d.note, 4);
      return;
    }
    if (d.note && d.kind !== "food" && d.kind !== "medicine") this.panels.toast(d.note);
    else this.panels.toast(w.kept);
  }

  take(key: string): void {
    const items = this.wallet.items;
    if (!items[key]) return;
    items[key]--;
    if (items[key] <= 0) delete items[key];
  }

  private applyEffects(key: string): void {
    const d = itemOf(key);
    if (d.heal) this.life.heal(d.heal);
    if (d.breath) this.life.refresh(d.breath);
    if (d.rep && !this.life.data.read[`rep_${key}`]) {
      this.life.data.read[`rep_${key}`] = 1;
      this.life.addRep(d.rep);
    }
  }

  /** Using something, from the bag or straight after paying. */
  use(key: string): void {
    const d = itemOf(key);
    if (!this.wallet.items[key]) return;
    switch (d.kind) {
      case "food":
      case "medicine":
        this.take(key);
        this.applyEffects(key);
        this.player.gesture("tea", d.seconds ?? 1.8);
        if (d.note) this.hud.say(d.note, 3);
        break;
      case "read":
        this.read(key);
        return;
      case "wear":
        this.applyEffects(key);
        this.life.data.wearing = key;
        this.hud.say(w.worn, 3);
        break;
      case "raw":
        if (!this.atHome()) {
          this.hud.say(w.cookHome, 3);
          break;
        }
        this.take(key);
        this.life.heal(COOKED_HEAL);
        this.life.refresh(60);
        this.passTime(0.5);
        this.hud.say(w.cooked, 4);
        break;
      case "home":
        if (!this.atHome()) {
          this.hud.say(w.homeOnly, 3);
          break;
        }
        this.take(key);
        if (!this.life.data.home.includes(key)) this.life.data.home.push(key);
        if (d.note) this.hud.say(d.note, 3.5);
        break;
      default:
        if (d.note) this.hud.say(d.note, 4);
    }
    this.panels.closeOverlay();
  }

  private read(key: string): void {
    const seen = (list: NewsItem[], n: number): string[] => {
      const start = Math.floor(this.playSeconds() / 600) % list.length;
      const out: string[] = [];
      for (let i = 0; i < Math.min(n, list.length); i++) {
        const q = list[(start + i) % list.length];
        out.push(`<h4>${T(q.head)}</h4><p>${T(q.body)}</p>`);
      }
      return out;
    };
    if (key === "paper") return this.panels.showReader(w.paperTitle, seen(NEWSPAPER, 5));
    if (key === "magazine") return this.panels.showReader(w.magTitle, seen(MAGAZINE, 4));
    if (key === "khata") {
      const lessons = this.life.data.scams.lessons;
      const per = 4;
      const pages: string[] = [];
      for (let i = 0; i < lessons.length; i += per) pages.push(lessons.slice(i, i + per).map((l) => `<p>• ${T(l)}</p>`).join(""));
      return this.panels.showReader(w.notesTitle, pages.length ? pages : [`<p>${w.notesEmpty}</p>`]);
    }
    const book = BOOKS.find((b) => b.key === key);
    if (!book) return;
    this.panels.showReader(T(book.title), book.pages.map((p) => `<p>${T(p)}</p>`), () => {
      if (this.life.data.read[key]) return;
      this.life.data.read[key] = 1;
      if (book.sense) {
        this.life.learn(undefined, book.sense);
        this.panels.toast(w.smarter, "good");
      }
    });
  }

  /** Everything in the bag, as the panel lists it. */
  rows(): BagRow[] {
    const out: BagRow[] = [];
    for (const [key, count] of Object.entries(this.wallet.items)) {
      if (count <= 0) continue;
      const d = itemOf(key);
      if (CONSUMED.has(d.kind) && d.kind === "service") continue;
      let note = d.note ?? "";
      let action: string | null = null;
      if (d.kind === "food" || d.kind === "medicine") {
        action = this.useWord(key);
        if (d.heal) note = note || w.noteFood(String(d.heal));
      } else if (d.kind === "read") action = w.read;
      else if (d.kind === "wear") action = this.life.data.wearing === key ? null : w.wear;
      else if (d.kind === "raw") {
        action = this.atHome() ? w.cook : null;
        note = w.cookNote;
      } else if (d.kind === "home") action = this.atHome() ? w.put : null;
      else if (d.kind === "rain") note = w.rainNote;
      if (d.kind === "wear" && this.life.data.wearing === key) note = w.wearing;
      out.push({ key, name: this.nameOf(key), count, note, action });
    }
    return out;
  }
}
