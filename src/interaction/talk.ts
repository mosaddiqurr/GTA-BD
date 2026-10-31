import type { Wallet } from "../app/save";
import type { AudioSystem } from "../audio/audio";
import { TalkRole, addressed, bn, bnNum, takaWords } from "../localization/bn";
import type { Pedestrians, Person } from "../npc/pedestrians";
import type { Input } from "../player/input";
import type { Player } from "../player/player";
import type { Anchor, Hud } from "../ui/hud";
import { regions } from "../regions/registry";
import { ROUTE_INFO } from "../world/signs";
import type { City, StallSpot } from "../world/city";
import { lineSeconds, roleOf, voiceOf } from "./cast";
import { Converse, words } from "./converse";

export interface Item {
  text: string;
  dim?: boolean;
  run: () => void;
}

const HERO_ID = "hero_mango";
const HERO_TOP = 1.6;
const HERO_SEATED_TOP = 1.2;
const PERSON_TOP = 1.72;
const PERSON_SEATED_TOP = 1.2;
const ARRIVE_M = 14;

/** Conversations: who says what, in what order, and the menu of what to say next. Everything is
 *  written in advance and runs offline. People speak a line above their heads, in a voice of their
 *  own, while the world carries on around them. */
export class Talk {
  person: Person | null = null;
  /** Who's being spoken to, whether or not it's someone on foot. */
  private speaker: { id: string; anchor: Anchor; top: number; label: string } | null = null;
  /** Runs whenever a conversation has finished. */
  onClosed: (() => void) | null = null;
  private items: Item[] | null = null;
  private then: (() => void) | null = null;
  private lineTime = 0;
  private lineLong = 0;
  private voiceDone = false;
  private turn = 0;
  private seated = false;
  /** What's been asked in this conversation, shown fainter in the menu. */
  private asked = new Set<string>();
  /** How far through each list of lines this conversation has got, so nobody repeats themselves. */
  private said = new Map<string[], number>();
  private benchTopic = 0;
  /** What the next line actually says aloud, when that differs from the words on screen. */
  private spokenParts: string[] | null = null;
  private going: { x: number; z: number } | null = null;

  constructor(private hud: Hud, private audio: AudioSystem, private input: Input, private player: Player, private peds: Pedestrians, private city: City, private wallet: Wallet) {}

  get active(): boolean {
    return !!this.speaker;
  }

  // ---------------------------------------------------------------- for other systems

  /** Starts a conversation with someone who isn't on foot, such as a driver in their seat. */
  openWith(anchor: Anchor, id: string, top: number, label?: string): void {
    this.speaker = { id, anchor, top, label: label ?? roleOf(id).label };
    this.seated = false;
    this.asked.clear();
    this.said.clear();
    this.player.beginTalk(anchor, () => this.walkAway());
    this.hud.hideInfo();
  }

  say(text: string, then: () => void): void {
    this.npc(text, then);
  }

  /** A line whose spoken words differ from the words on screen, such as an amount of money. */
  sayParts(text: string, parts: string[], then: () => void): void {
    this.spokenParts = parts;
    this.npc(text, then);
  }

  heroSay(text: string, then: () => void): void {
    this.hero(text, then);
  }

  menuOf(items: Item[]): void {
    this.menu(items);
  }

  closeNow(): void {
    this.close();
  }

  /** A line said in passing from somewhere other than a person on foot. */
  lineFrom(anchor: Anchor, id: string, label: string, text: string, top: number, parts?: string[]): void {
    this.hud.bubble(text, label, anchor, top, lineSeconds(text) + 1);
    this.audio.speak(text, voiceOf(id), false, undefined, undefined, parts);
  }

  lineParts(anchor: Anchor, id: string, top: number, text: string, parts: string[]): void {
    this.lineFrom(anchor, id, roleOf(id).label, text, top, parts);
  }

  /** Every place worth asking about, from what this district actually has. */
  placeList(): { key: string; x: number; z: number }[] {
    const { x, z } = this.player.position;
    const near = <T extends { x: number; z: number }>(list: T[]): T | null => {
      let best: T | null = null, bd = Infinity;
      for (const q of list) {
        const d = Math.hypot(q.x - x, q.z - z);
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
      return best;
    };
    const { plaza, metro } = this.city.region.layout;
    const blocks = this.city.layout.blocks.map((b) => ({ kind: b.kind as string, x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 }));
    const places: { key: string; x: number; z: number }[] = [];
    if (metro) places.push({ key: "station", x: metro.x, z: metro.stationZ });
    places.push({ key: "plaza", x: plaza.x, z: plaza.z });
    for (const key of ["terminal", "market", "mosque", "park", "school", "university", "lake"]) {
      const b = near(blocks.filter((q) => q.kind === key));
      if (b) places.push({ key, x: b.x, z: b.z });
    }
    const tea = near(this.city.stalls.filter((q) => q.kind === "tea"));
    if (tea) places.push({ key: "tea", x: tea.x, z: tea.z });
    const bus = near(this.city.busStops);
    if (bus) places.push({ key: "bus", x: bus.x, z: bus.z });
    return places;
  }

  // ---------------------------------------------------------------- ways a conversation starts

  /** Anyone at all. Someone in a hurry may brush the hero off, the first time. */
  talkTo(person: Person, seated = false): void {
    if (person.talks === 0 && this.peds.inAHurry(person) && Math.random() < 0.12) {
      person.talks = 1;
      this.lineOver(this.pick(bn.talk.busy), person);
      return;
    }
    const no = this.converse?.refuses(person);
    if (no) {
      this.lineOver(no, person);
      return;
    }
    this.open(person, seated);
    const role = this.roleFor(person);
    this.npc(this.converse?.greeting(person) ?? this.pick(person.talks > 1 ? bn.talk.again : role.greet), () => this.mainMenu());
  }

  /** The back and forth of a market: an opening price, a bit off for asking, and a point they won't go past. */
  private bargain(stock: (typeof bn.shop.stock)[string], it: (typeof bn.shop.stock)[string][number], price: number, tries: number): void {
    this.spokenParts = tries === 0 ? [bn.shop.quoteSay(price)] : [bn.shop.haggleDownSay(price)];
    this.npc(tries === 0 ? bn.shop.quote(bnNum(price)) : bn.shop.haggleDown(bnNum(price)), () => {
      const floor = roundPrice(it.price * 0.8);
      this.menu([
        {
          text: `${bn.shop.haggleBuy(bnNum(price))}`,
          run: () => {
            this.spokenParts = [bn.shop.haggleBuySay(price)];
            this.hero(bn.shop.haggleBuy(bnNum(price)), () => {
              if (!this.wallet.spend(price)) {
                this.npc(bn.shop.noMoney, () => this.shopMenu(stock));
                return;
              }
              this.gotIt(it, price);
              this.spokenParts = [bn.shop.hereSay(price)];
              this.npc(bn.shop.here(bnNum(price)), () => this.shopMenu(stock));
            });
          },
        },
        {
          text: bn.shop.haggleAskShort,
          run: () =>
            this.hero(this.pick(bn.shop.haggleAsk), () => {
              // They come down less each time, and some days not at all.
              const next = roundPrice(Math.max(floor, price * (0.8 + Math.random() * 0.1)));
              if (next >= price || tries >= 3) {
                this.npc(this.pick(bn.shop.haggleFloor), () => this.afterFloor(stock, it, price));
                return;
              }
              this.bargain(stock, it, next, tries + 1);
            }),
        },
        { text: bn.shop.haggleLeave, run: () => this.hero(bn.shop.haggleLeaveLine, () => this.npc(this.pick(bn.shop.haggleCall), () => this.shopMenu(stock))) },
      ]);
    });
  }

  private afterFloor(stock: (typeof bn.shop.stock)[string], it: (typeof bn.shop.stock)[string][number], price: number): void {
    this.menu([
      {
        text: bn.shop.haggleBuy(bnNum(price)),
        run: () => {
          this.spokenParts = [bn.shop.haggleBuySay(price)];
          this.hero(bn.shop.haggleBuy(bnNum(price)), () => {
            if (!this.wallet.spend(price)) {
              this.npc(bn.shop.noMoney, () => this.shopMenu(stock));
              return;
            }
            this.gotIt(it, price);
            this.spokenParts = [bn.shop.hereSay(price)];
            this.npc(bn.shop.here(bnNum(price)), () => this.shopMenu(stock));
          });
        },
      },
      { text: bn.shop.haggleLeave, run: () => this.hero(bn.shop.haggleLeaveLine, () => this.npc(this.pick(bn.shop.haggleCall), () => this.shopMenu(stock))) },
    ]);
  }

  /** The list of fines, set by the police when the game starts. */
  tickets: { why: string; amount: number }[] = [];

  /** Stopped by an officer: what you did, what it costs, and what you say about it. */
  pulledOver(person: Person, why: string, amount: number, done: (paid: boolean) => void): void {
    this.open(person, false);
    this.spokenParts = [bn.law.chargeSay(why, amount)];
    this.npc(bn.law.charge(why, bnNum(amount)), () => {
      this.menu([
        {
          text: `${bn.law.payNow} · ${bn.money(amount)}`,
          run: () => this.hero(bn.law.payLine, () => {
            if (!this.wallet.spend(amount)) {
              this.npc(bn.law.noMoney, () => {
                this.close();
                done(false);
              });
              return;
            }
            this.npc(bn.law.paidLine, () => {
              this.close();
              done(true);
            });
          }),
        },
        {
          text: bn.law.plead,
          run: () => this.hero(bn.law.pleadLine, () => {
            if (Math.random() < 0.25) {
              this.npc(bn.law.pleadYes, () => {
                this.close();
                done(true);
              });
            } else this.npc(bn.law.pleadNo, () => this.pulledOverAgain(amount, done));
          }),
        },
        { text: bn.law.payLater, run: () => this.hero(bn.law.payLaterLine, () => this.npc(bn.law.laterLine, () => {
          this.close();
          done(false);
        })) },
      ]);
    });
  }

  private pulledOverAgain(amount: number, done: (paid: boolean) => void): void {
    this.menu([
      {
        text: `${bn.law.payNow} · ${bn.money(amount)}`,
        run: () => this.hero(bn.law.payLine, () => {
          if (!this.wallet.spend(amount)) {
            this.npc(bn.law.noMoney, () => {
              this.close();
              done(false);
            });
            return;
          }
          this.npc(bn.law.paidLine, () => {
            this.close();
            done(true);
          });
        }),
      },
      { text: bn.law.payLater, run: () => this.hero(bn.law.payLaterLine, () => this.npc(bn.law.laterLine, () => {
        this.close();
        done(false);
      })) },
    ]);
  }

  /** The duty officer: a word about what to do if something's wrong. */
  officer(person: Person): void {
    this.open(person, false);
    this.npc(bn.law.officerHello, () => {
      this.menu([
        { text: bn.law.officerAsk, run: () => this.hero(bn.law.officerAsk, () => this.npc(bn.law.officerAnswer, () => this.hero(bn.law.officerBye, () => this.close()))) },
        { text: bn.shop.leave, run: () => this.close() },
      ]);
    });
  }

  /** The fines desk at the station. Paying gets any impounded vehicle released. */
  payFines(person: Person): void {
    this.open(person, false);
    const owed = this.tickets.reduce((n, t) => n + t.amount, 0);
    if (!owed) {
      this.npc(bn.law.deskClear, () => this.close());
      return;
    }
    this.spokenParts = [bn.law.deskOwesSay(owed)];
    this.npc(bn.law.deskOwes(bnNum(owed)), () => {
      this.menu([
        {
          text: bn.law.deskPay(bnNum(owed)),
          run: () => {
            if (!this.wallet.spend(owed)) {
              this.npc(bn.shop.noMoney, () => this.close());
              return;
            }
            this.tickets.length = 0;
            this.onFinesPaid?.();
            this.npc(bn.law.deskPaid, () => this.close());
          },
        },
        { text: bn.shop.leave, run: () => this.close() },
      ]);
    });
  }

  onFinesPaid: (() => void) | null = null;

  /** Up to a shop counter or a cart, to buy something. */
  sell(person: Person, stock: (typeof bn.shop.stock)[string]): void {
    const no = this.converse?.refuses(person);
    if (no) {
      this.lineOver(no, person);
      return;
    }
    this.open(person, false);
    this.npc(this.pick(bn.shop.greet), () => this.shopMenu(stock));
  }

  /** Paid for and handed over. */
  private gotIt(it: { key: string; name: string }, price: number): void {
    this.wallet.add(it.key);
    this.hud.say(bn.shop.bought(it.name, bnNum(price)), 2.6);
    this.onBought?.(it.key);
    this.converse?.afterSale(this.person);
    this.justBought = this.useNow?.(it.key) ? it : null;
  }

  /** Something was just paid for. */
  onBought: ((key: string) => void) | null = null;
  /** What to call using this now, if it's the kind of thing to use straight away. */
  useNow: ((key: string) => string | null) | null = null;
  onUse: ((key: string) => void) | null = null;
  private justBought: { key: string; name: string } | null = null;

  /** Who money would go to right now, if any changes hands. */
  get counterpart(): { anchor: Anchor; person: Person | null } | null {
    return this.speaker ? { anchor: this.speaker.anchor, person: this.person } : null;
  }

  private shopMenu(stock: (typeof bn.shop.stock)[string]): void {
    const last = this.justBought;
    this.justBought = null;
    this.menu([
      // Hot off the stall: eat it now, or it goes in the bag.
      ...(last ? [{ text: `${this.useNow!(last.key)}: ${last.name}`, run: () => {
        this.close();
        this.onUse?.(last.key);
      } }] : []),
      ...stock.map((it) => ({
        text: `${it.name} · ${bn.money(it.price)}`,
        run: () => {
          if (it.haggle) {
            this.hero(bn.shop.askPrice(it.name), () => this.bargain(stock, it, roundPrice(it.price * (1.25 + Math.random() * 0.25)), 0));
            return;
          }
          this.hero(bn.shop.ask(it.name), () => {
            if (!this.wallet.spend(it.price)) {
              this.npc(bn.shop.noMoney, () => this.shopMenu(stock));
              return;
            }
            this.gotIt(it, it.price);
            this.spokenParts = [bn.shop.hereSay(it.price)];
            this.npc(bn.shop.here(bnNum(it.price)), () => this.shopMenu(stock));
          });
        },
      })),
      { text: bn.shop.chat, run: () => this.mainMenu() },
      { text: bn.shop.leave, run: () => this.hero(bn.shop.leaveLine, () => this.npc(this.pick(roleOf(this.person!.id).bye), () => this.close())) },
    ]);
  }

  /** At the station's ticket window. */
  ticket(person: Person, to: string, fare: number, bought: () => void): void {
    this.open(person, false);
    this.npc(bn.metro.ask, () => {
      this.menu([
        {
          text: `${to} · ${bn.money(fare)}`,
          run: () => this.hero(bn.metro.buy(to), () => {
            if (!this.wallet.spend(fare)) {
              this.npc(bn.shop.noMoney, () => this.close());
              return;
            }
            bought();
            this.npc(bn.metro.sold, () => this.close());
          }),
        },
        { text: bn.metro.never, run: () => this.close() },
      ]);
    });
  }

  /** Up to the counter of a tea stall. */
  orderTea(person: Person, stall: StallSpot, hasSeat: () => boolean, start: (order: string, stall: StallSpot) => void): void {
    this.open(person, false);
    const role = roleOf(person.id);
    const order = (o: (typeof bn.tea.menu)[number]): void => {
      this.hero(o.line, () => {
        if (!hasSeat()) {
          this.npc(bn.tea.noSeat, () => this.close());
          return;
        }
        if (!this.wallet.spend(o.price)) {
          this.npc(bn.shop.noMoney, () => this.close());
          return;
        }
        this.npc(bn.tea.okay, () => {
          this.close();
          start(o.key, stall);
        });
      });
    };
    const menu = (): void => {
      this.menu([
        ...bn.tea.menu.map((o) => ({ text: `${o.label} · ${bn.money(o.price)}`, run: () => order(o) })),
        { text: bn.tea.chat, run: () => this.mainMenu() },
        { text: bn.tea.notNow, run: () => this.hero(bn.tea.notNow, () => this.npc(this.pick(role.bye), () => this.close())) },
      ]);
    };
    this.npc(bn.tea.ask, menu);
  }

  /** Whoever's on the bench alongside, while the tea lasts. */
  benchTalk(person: Person): void {
    this.open(person, true);
    this.npc(this.pick(bn.talk.bench.greet), () => this.benchMenu());
  }

  /** Face to face with a driver the hero has just run into. */
  crashTalk(person: Person): void {
    this.open(person, false);
    this.menu(bn.crash.menu.map((m) => ({
      text: m.label,
      run: () => this.hero(m.line, () => this.npc(m.reply, () => this.npc(bn.crash.calmed, () => this.close()))),
    })));
  }

  // ---------------------------------------------------------------- menus

  /** What someone has to say depends on whether they're at work: a shopkeeper out for a walk has
   *  nothing to sell, and a driver on foot isn't going anywhere. */
  private roleFor(person: Person): TalkRole {
    const role = roleOf(person.id);
    const off = bn.talk.offDuty[person.id];
    if (!off || this.peds.atWork(person)) return role;
    return { ...role, ...off };
  }

  /** Everything newer to say to someone: memory, moods and favours. */
  converse: Converse | null = null;

  private mainMenu(): void {
    const person = this.person!;
    const role = this.roleFor(person);
    const a = role.address;
    const m = bn.talk.menu;
    const ask = bn.talk.ask;
    const c = this.converse;
    if (c) {
      const back = (): void => this.mainMenu();
      this.menu([
        { text: words.chat, run: () => this.chatMenu(person, role) },
        ...c.items(person, back),
        { text: m.place, run: () => this.hero(ask.place(a), () => this.npc(bn.talk.whereTo, () => this.placeMenu())) },
        { text: m.district, run: () => this.districtMenu() },
        { text: m.bye, run: () => this.hero(ask.bye(a), () => this.npc(c.byeLine(person) ?? this.pick(role.bye), () => this.close())) },
      ]);
      return;
    }
    this.menu([
      this.question("hello", m.hello, ask.hello(a), role.hello, role),
      this.question("work", m.work, ask.work(a), role.work, role),
      this.question("topic", role.topic.menu, role.topic.ask, role.topic.answer, role),
      this.question("news", m.news, ask.news(a), role.news, role),
      {
        text: m.name,
        dim: this.asked.has("name"),
        run: () => {
          this.asked.add("name");
          if (!person.personName) person.personName = bn.talk.names[Math.floor(Math.random() * bn.talk.names.length)];
          this.hero(ask.name(a), () => this.npc(bn.talk.myName(person.personName!), () => this.mainMenu()));
        },
      },
      { text: m.place, run: () => this.hero(ask.place(a), () => this.npc(bn.talk.whereTo, () => this.placeMenu())) },
      { text: m.district, run: () => this.districtMenu() },
      { text: m.bye, run: () => this.hero(ask.bye(a), () => this.npc(this.pick(role.bye), () => this.close())) },
    ]);
  }

  private chatMenu(person: Person, role: TalkRole): void {
    const a = role.address, m = bn.talk.menu, ask = bn.talk.ask;
    const back = (): void => this.chatMenu(person, role);
    const topic = (key: string, text: string, say: string, answers: string[]): Item => ({
      text,
      dim: this.asked.has(key),
      run: () => {
        this.asked.add(key);
        this.hero(say, () => this.npc(this.pick(answers), back));
      },
    });
    this.menu([
      topic("work", m.work, ask.work(a), role.work),
      topic("topic", role.topic.menu, role.topic.ask, role.topic.answer),
      topic("news", m.news, ask.news(a), role.news),
      {
        text: m.name,
        dim: this.asked.has("name"),
        run: () => {
          this.asked.add("name");
          if (!person.personName) person.personName = bn.talk.names[Math.floor(Math.random() * bn.talk.names.length)];
          this.hero(ask.name(a), () => this.npc(bn.talk.myName(person.personName!), back));
        },
      },
      ...(this.converse?.chatItems(person, back).sort(() => Math.random() - 0.5).slice(0, 3) ?? []),
      ...[this.converse?.photoItem(person, back)].filter((q): q is Item => !!q),
      { text: words.back, run: () => this.mainMenu() },
    ]);
  }

  private question(key: string, text: string, ask: string, answers: string[], _role: TalkRole): Item {
    return {
      text,
      dim: this.asked.has(key),
      run: () => {
        this.asked.add(key);
        this.hero(ask, () => this.npc(this.pick(answers), () => this.mainMenu()));
      },
    };
  }

  private benchMenu(): void {
    const b = bn.talk.bench;
    const topics = [0, 1, 2].map((i) => b.topics[(this.benchTopic + i) % b.topics.length]);
    const role = roleOf(this.person!.id);
    this.menu([
      ...topics.map((t) => ({
        text: t.menu,
        dim: this.asked.has(t.menu),
        run: () => {
          this.asked.add(t.menu);
          this.benchTopic++;
          this.hero(t.ask, () => this.npc(this.pick(t.answer), () => this.benchMenu()));
        },
      })),
      { text: bn.talk.menu.bye, run: () => this.hero(bn.talk.ask.bye(role.address), () => this.npc(this.pick(role.bye), () => this.close())) },
    ]);
  }

  private placeMenu(): void {
    const labels = bn.talk.places;
    this.menu([
      ...this.placeList().map((p) => ({ text: labels[p.key], run: () => this.tellWay(labels[p.key], p.x, p.z) })),
      { text: bn.talk.ask.back, run: () => this.mainMenu() },
    ]);
  }

  /** The other districts, and the way anyone round here would go. */
  private districtMenu(): void {
    const here = this.city.region;
    this.menu([
      ...here.gates.map((g) => ({
        text: bn.talk.districtAsk(g.nameBn),
        run: () => {
          this.hero(bn.talk.districtAsk(g.nameBn), () => {
            const route = ROUTE_INFO.find((q) => q.to === g.to)?.name ?? "";
            const metro = !!here.layout.metro && !!regions[g.to]?.layout.metro;
            const { x, z } = this.player.position;
            let stop = this.city.busStops[0], bd = Infinity;
            for (const s of this.city.busStops) {
              const d = Math.hypot(s.x - x, s.z - z);
              if (d < bd) {
                bd = d;
                stop = s;
              }
            }
            this.going = { x: stop.x, z: stop.z };
            this.hud.setWaypoint({ x: stop.x, z: stop.z, label: bn.hail.stop });
            this.npc(metro ? bn.talk.wayDistrictMetro(g.nameBn, route) : bn.talk.wayDistrict(g.nameBn, route), () => this.mainMenu());
          });
        },
      })),
      { text: bn.talk.ask.back, run: () => this.mainMenu() },
    ]);
  }

  /** They turn and point, and the hero's map gets a mark. */
  private tellWay(label: string, x: number, z: number): void {
    this.hero(bn.talk.placeAsk(label), () => {
      const person = this.person!;
      const dx = x - person.x, dz = z - person.z;
      const dist = Math.hypot(dx, dz);
      this.going = { x, z };
      this.hud.setWaypoint({ x, z, label });
      this.hud.say(bn.talk.marked, 3);
      let line: string;
      if (dist < 30) {
        line = bn.talk.placeNear(label);
        this.spokenParts = [line];
      } else {
        const octant = (Math.round(Math.atan2(dx, dz) / (Math.PI / 4)) + 8) % 8;
        const rounded = dist < 100 ? Math.round(dist / 10) * 10 : Math.round(dist / 50) * 50;
        line = bn.talk.placeFar(label, bn.talk.dirs[octant], bnNum(rounded));
        this.spokenParts = [`${label}?`, bn.talk.wayIs(bn.talk.dirs[octant]), bn.talk.distanceIs(takaWords(rounded))];
      }
      this.peds.facePoint({ x, z });
      this.npc(line, () => {
        this.peds.facePoint(null);
        this.mainMenu();
      }, "point");
    });
  }

  private menu(items: Item[]): void {
    this.items = items;
    this.then = null;
    const person = this.person;
    if (person) this.peds.talkPose(person, "stand");
    this.player.speaking = false;
    this.hud.showChoices(items);
  }

  // ---------------------------------------------------------------- saying things

  private open(person: Person, seated: boolean): void {
    this.person = person;
    this.speaker = { id: person.id, anchor: person, top: PERSON_TOP, label: roleOf(person.id).label };
    this.seated = seated;
    this.asked.clear();
    this.said.clear();
    this.peds.beginTalk(person);
    this.player.beginTalk(person, () => this.walkAway());
    this.hud.hideInfo();
  }

  private pick(list: string[]): string {
    const n = this.said.get(list) ?? Math.floor(Math.random() * list.length);
    this.said.set(list, n + 1);
    return list[n % list.length];
  }

  private npc(text: string, then: () => void, pose: "talk" | "point" = "talk"): void {
    const who = this.speaker!;
    const person = this.person;
    this.hud.clearBubble(this.player);
    if (person) this.peds.talkPose(person, pose);
    this.player.speaking = false;
    const top = person?.pose === "sit_bench" ? PERSON_SEATED_TOP : who.top;
    this.show(text, who.label, who.anchor, top, voiceOf(who.id), then);
  }

  private hero(text: string, then: () => void): void {
    this.hud.clearBubble(this.speaker!.anchor);
    if (this.person) this.peds.talkPose(this.person, "stand");
    this.player.speaking = true;
    this.show(text, bn.you, this.player, this.seated ? HERO_SEATED_TOP : HERO_TOP, voiceOf(HERO_ID), then);
  }

  private show(text: string, label: string, anchor: Anchor, top: number, voice: ReturnType<typeof voiceOf>, then: () => void): void {
    this.items = null;
    this.hud.hideChoices();
    text = addressed(text);
    const read = lineSeconds(text);
    // The bubble outlasts the line: the reply stays up to read while the next choice is made.
    this.hud.bubble(text, label, anchor, top, 3600);
    this.then = then;
    this.lineTime = 0;
    this.lineLong = read;
    this.voiceDone = false;
    const turn = ++this.turn;
    const parts = this.spokenParts ?? undefined;
    this.spokenParts = null;
    this.audio.speak(text, voice, false, () => {
      if (turn === this.turn) this.voiceDone = true;
    }, undefined, parts);
  }

  /** A line said in passing, not part of a conversation. */
  private lineOver(text: string, person: Person): void {
    this.hud.bubble(text, roleOf(person.id).label, person, PERSON_TOP, lineSeconds(text) + 1);
    this.audio.speak(text, voiceOf(person.id));
  }

  private close(): void {
    const who = this.speaker;
    if (!who) return;
    this.turn++;
    this.then = null;
    this.items = null;
    this.hud.hideChoices();
    this.hud.clearBubble(who.anchor);
    this.hud.clearBubble(this.player);
    this.player.speaking = false;
    if (this.person) this.peds.endTalk();
    this.player.endTalk();
    this.person = null;
    this.speaker = null;
    this.onClosed?.();
  }

  /** A mission's conversation isn't one to wander away from. */
  scriptLocked = false;

  /** For the test run: no waiting for lines to be read. */
  hurry = false;

  /** Starts a conversation for a mission, under the name that person has in the story. */
  beginScene(person: Person, label: string): void {
    this.open(person, false);
    this.speaker!.label = label;
  }

  /** The hero just walked off mid-sentence. */
  private walkAway(): void {
    const person = this.person;
    if (!this.speaker || this.scriptLocked) return;
    this.audio.hush();
    this.close();
    if (person) this.lineOver(this.pick(bn.talk.leftAlone), person);
  }

  /** Ends things at once, for a respawn or anything else that can't wait. */
  stop(): void {
    this.audio.hush();
    this.close();
  }

  update(dt: number): void {
    this.checkArrival();
    if (!this.speaker) return;
    const input = this.input;
    if (this.then) {
      this.lineTime += dt;
      const textOnly = !this.audio.hasBanglaVoice || !this.audio.voiceEnabled;
      let done = textOnly ? this.lineTime >= this.lineLong : (this.voiceDone && this.lineTime > 0.5) || this.lineTime >= this.lineLong * 2.4;
      if (this.hurry && this.lineTime > 0.02) done = true;
      // Impatient? A press moves things along.
      if (this.lineTime > 0.3 && (input.pressed("KeyE") || input.pressed("Enter") || input.clicked)) done = true;
      if (done) {
        const then = this.then;
        this.then = null;
        this.audio.hush();
        then();
      }
      return;
    }
    if (this.items) {
      const i = this.hud.readChoice(dt, (c) => input.pressed(c), input.wheel, input.clicked);
      if (i >= 0) {
        const chosen = this.items[i];
        this.items = null;
        chosen.run();
      }
    }
  }

  private checkArrival(): void {
    const g = this.going;
    if (!g) return;
    const { x, z } = this.player.position;
    if (Math.hypot(g.x - x, g.z - z) < ARRIVE_M) {
      this.going = null;
      this.hud.setWaypoint(null);
      this.hud.say(bn.talk.arrived, 2.6);
    }
  }
}

/** Prices in a market go in tens, and that's all the voices know how to say. */
function roundPrice(v: number): number {
  return Math.max(10, Math.round(v / 10) * 10);
}
