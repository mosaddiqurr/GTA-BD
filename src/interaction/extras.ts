import { Color3, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import type { Life } from "../app/life";
import type { Wallet } from "../app/save";
import { LICENCE_LINES, LICENCE_QUIZ } from "../dialogue/licence";
import { L, T, bn, bnNum } from "../localization/bn";
import { Kit, t } from "../missions/kit";
import type { MissionDef, MissionRunner } from "../missions/runner";
import type { Player } from "../player/player";
import type { Hud } from "../ui/hud";
import type { Panels } from "../ui/panels";
import type { Dents } from "../vehicles/dents";
import type { Vehicle } from "../vehicles/vehicle";
import type { City } from "../world/city";
import type { Interactions } from "./interactions";
import type { Talk } from "./talk";

const w = {
  garage: (n: string) => L(`<kbd>E</kbd> গ্যারেজে সারান: ${n} টাকা`, `<kbd>E</kbd> Garage repair: ${n} taka`),
  garageFine: L("গ্যারেজ: গাড়ি একদম ঠিক আছে", "Garage: nothing wrong with this one"),
  repaired: L("মেকানিক সব ঠুকে ঠিক করে দিল। নতুনের মতো।", "The mechanic hammers it all out. Good as new."),
  noMoney: L("মেরামতের টাকা নেই।", "You can't afford the repair."),
  smoking: L("ইঞ্জিন থেকে ধোঁয়া! গ্যারেজে নিন।", "Smoke from the engine! Get it to a garage."),
  dead: L("গাড়ি একদম বসে গেছে। গ্যারেজ ছাড়া চলবে না।", "It's finished. It won't go far without a garage."),
  licencePrompt: L("<kbd>E</kbd> লাইসেন্স অফিস", "<kbd>E</kbd> Licence office"),
  licenceHave: L("আপনার ড্রাইভিং লাইসেন্স আছে।", "You've got your driving licence."),
  licenceTitle: L("ড্রাইভিং লাইসেন্স পরীক্ষা", "Driving licence test"),
  licenceFee: L("পরীক্ষার ফি ৩০০ টাকা। পাঁচটা প্রশ্ন, চারটা ঠিক হলে পাস।", "The test fee is 300 taka. Five questions, four right to pass."),
  licenceGot: L("পাস! লাইসেন্স হাতে পেলেন।", "Passed! The licence is yours."),
  licenceFail: (n: string) => L(`${n}টা ঠিক হয়েছে। আবার আসুন।`, `${n} right. Come back and try again.`),
  noLicence: L("লাইসেন্স নেই: জরিমানা ৩০০ টাকা বেশি।", "No licence: 300 taka more on the fine."),
  foundOne: (a: string, b: string) => L(`লুকানো স্টিকার পেলেন! ${a} / ${b}`, `Hidden sticker found! ${a} of ${b}`),
  foundAll: L("সবগুলো স্টিকার! পুরস্কার ৫০০০ টাকা।", "All the stickers! Reward: 5000 taka."),
  pickPrompt: L("<kbd>E</kbd> স্টিকার তুলুন", "<kbd>E</kbd> Pick up the sticker"),
  raceTitle: (n: string) => L(`রেস: ${n}`, `Race: ${n}`),
  raceGoal: (a: string, b: string) => L(`পরের চেকপয়েন্ট (${a}/${b})`, `Next checkpoint (${a}/${b})`),
  raceBest: (s: string) => L(`সেরা সময় ${s} সেকেন্ড`, `Best time ${s} seconds`),
  raceFailed: L("সময় শেষ। রেস হেরে গেলেন।", "Out of time. You lost the race."),
  tabExtras: L("আরও", "More"),
  races: L("রেস", "Races"),
  business: L("ব্যবসা", "Businesses"),
  awards: L("পুরস্কার", "Awards"),
  go: L("শুরু", "Go"),
  buy: (n: string) => L(`কিনুন ${n}`, `Buy ${n}`),
  owned: L("আপনার", "Yours"),
  payDay: (n: string) => L(`ব্যবসার আয় এসেছে: ${n}`, `Business income in: ${n}`),
  needMoney: L("এত টাকা নেই।", "You haven't got that much."),
  award: (n: string) => L(`পুরস্কার: ${n}`, `Award: ${n}`),
  found: (a: string, b: string) => L(`লুকানো স্টিকার ${a} / ${b}`, `Hidden stickers ${a} of ${b}`),
  garageMap: L("গ্যারেজ", "Garage"),
};

const RACES: { key: string; vehicle: "motorbike" | "bicycle" | "cng"; name: readonly [string, string]; points: number; length: number; seconds: number; pay: number }[] = [
  { key: "bike", vehicle: "motorbike", name: ["মোটরবাইক রেস", "Motorbike race"], points: 6, length: 180, seconds: 75, pay: 500 },
  { key: "cycle", vehicle: "bicycle", name: ["সাইকেল রেস", "Bicycle race"], points: 5, length: 130, seconds: 95, pay: 350 },
  { key: "cng", vehicle: "cng", name: ["সিএনজি রেস", "CNG race"], points: 6, length: 200, seconds: 95, pay: 600 },
];

const BUSINESSES: { key: string; name: readonly [string, string]; cost: number; daily: number }[] = [
  { key: "stall", name: ["চায়ের দোকানে অংশীদারি", "A share in a tea stall"], cost: 5000, daily: 150 },
  { key: "cngs", name: ["ভাড়ার সিএনজি", "A CNG to rent out"], cost: 15000, daily: 500 },
  { key: "shop", name: ["বাজারে একটা দোকান", "A shop in the market"], cost: 30000, daily: 1100 },
];

const AWARDS: { key: string; name: readonly [string, string]; got: (l: Life) => boolean }[] = [
  { key: "first", name: ["প্রথম মিশন", "First mission"], got: (l) => l.data.story.done.length >= 1 },
  { key: "half", name: ["অর্ধেক পথ", "Halfway there"], got: (l) => l.data.story.done.length >= 10 },
  { key: "story", name: ["গল্প শেষ", "The whole story"], got: (l) => l.data.story.finished },
  { key: "spot5", name: ["সজাগ চোখ: পাঁচটা ঠকবাজি ধরেছেন", "Sharp eyes: five scams spotted"], got: (l) => l.data.scams.spotted >= 5 },
  { key: "spot20", name: ["কেউ ঠকাতে পারে না: বিশটা", "Nobody's fool: twenty"], got: (l) => l.data.scams.spotted >= 20 },
  { key: "liked", name: ["এলাকার প্রিয় মুখ", "A favourite round here"], got: (l) => l.rep >= 30 },
  { key: "help10", name: ["মানুষের পাশে: দশবার সাহায্য", "A helping hand: ten favours"], got: (l) => l.data.stats.helped >= 10 },
  { key: "friends3", name: ["তিন বন্ধু", "Three friends"], got: (l) => Object.values(l.data.friends).filter((f) => f.met).length >= 3 },
  { key: "licence", name: ["বৈধ চালক", "Legal driver"], got: (l) => l.data.licence },
  { key: "stickers", name: ["সব স্টিকার", "All the stickers"], got: (l) => l.data.found.length >= STICKERS_TOTAL },
  { key: "owner", name: ["ব্যবসায়ী", "In business"], got: (l) => l.data.owned.length >= 1 },
  { key: "earner", name: ["এক লাখ টাকা আয়", "A hundred thousand earned"], got: (l) => l.data.stats.earned >= 100000 },
];

const STICKERS_EACH = 12;
const STICKERS_TOTAL = STICKERS_EACH * 3;

/** The garage, the licence, and the things a player goes looking for once the street's familiar. */
export class Extras {
  private garages: { x: number; z: number }[] = [];
  private stickers: { id: string; x: number; z: number }[] = [];
  private mesh: Mesh | null = null;
  private spin = 0;
  private buffer = new Float32Array(0);
  private lastHour = 0;
  private awardTimer = 4;
  private damageFx = 0;
  private quiz: { left: number; right: number; asked: number[] } | null = null;
  /** Current attention from the police, shown as lamps. */
  private lamps = 0;
  private lampTimer = 0;

  constructor(
    private scene: Scene,
    private city: City,
    private player: Player,
    private life: Life,
    private wallet: Wallet,
    private panels: Panels,
    private hud: Hud,
    private talk: Talk,
    private dents: Dents,
    private runner: () => MissionRunner,
    interactions: Interactions,
    private regionId: () => string,
    private smoke: (v: Vehicle) => void,
    private friendLevel: (key: string) => number,
    private readChoice: (dt: number) => number,
  ) {
    const fuels = city.layout.blocks.filter((b) => b.kind === "fuel" || b.kind === "construction" || b.kind === "garments").slice(0, 3);
    for (const b of fuels) this.garages.push({ x: (b.x0 + b.x1) / 2 - 18, z: b.z0 + b.sidewalk * 0.5 });
    interactions.add((x, z, _yaw, driving, out) => {
      const v = this.player.driving;
      if (!driving || !v) return;
      for (const g of this.garages) {
        if (Math.hypot(g.x - x, g.z - z) > 11) continue;
        const dmg = this.life.data.damage[v.id] ?? 0;
        if (dmg < 0.02) {
          out.push({ key: "", html: w.garageFine, priority: 5, run: () => undefined });
          return;
        }
        const cost = this.repairCost(dmg);
        out.push({ key: "KeyE", html: w.garage(bnNum(cost)), priority: 70, run: () => this.repair(v, cost) });
        return;
      }
    });
    interactions.add((x, z, _yaw, driving, out) => {
      if (driving) return;
      const b = this.city.interiors.all.find((q) => q.kind === "thana");
      if (!b || Math.hypot(b.outX + 6 - x, b.outZ - z) > 3.2) return;
      out.push({ key: "KeyE", html: w.licencePrompt, priority: 66, run: () => this.licenceOffice() });
    });
    interactions.add((x, z, _yaw, driving, out) => {
      if (driving) return;
      const s = this.stickers.find((q) => Math.abs(q.x - x) < 2 && Math.abs(q.z - z) < 2);
      if (s) out.push({ key: "KeyE", html: w.pickPrompt, priority: 92, run: () => this.pickUp(s) });
    });
    this.placeStickers();
  }

  get garagePoints(): { x: number; z: number; label: string }[] {
    return this.garages.map((g) => ({ ...g, label: w.garageMap }));
  }

  private repairCost(dmg: number): number {
    const raw = 200 + dmg * 1800;
    return Math.round((this.friendLevel("hasan") >= 4 ? raw * 0.5 : raw) / 10) * 10;
  }

  private repair(v: Vehicle, cost: number): void {
    if (!this.wallet.spend(cost)) {
      this.hud.say(w.noMoney, 3);
      return;
    }
    this.hud.fade(() => {
      this.life.data.damage[v.id] = 0;
      this.dents.repair();
      this.hud.say(w.repaired, 3.5);
    });
  }

  /** The hero's vehicle has just hit something. */
  crashed(v: Vehicle, impact: number): void {
    if (impact < 3) return;
    const d = this.life.data.damage;
    d[v.id] = Math.min(1, (d[v.id] ?? 0) + impact * 0.012);
    const front = v.speed >= 0 ? 1 : -1;
    this.dents.hit(front * v.spec.length * 0.46, (Math.random() - 0.5) * v.spec.width * 0.8, Math.min(impact / 14, 1));
  }

  // ---------------------------------------------------------------- the licence

  private licenceOffice(): void {
    if (this.life.data.licence) {
      this.hud.say(w.licenceHave, 3);
      return;
    }
    if (!this.wallet.spend(300)) {
      this.hud.say(w.noMoney, 3);
      return;
    }
    this.panels.toast(w.licenceFee);
    this.quiz = { left: 5, right: 0, asked: [] };
    this.askNext();
  }

  private current = 0;

  private askNext(): void {
    const q = this.quiz!;
    let i = Math.floor(Math.random() * LICENCE_QUIZ.length);
    while (q.asked.includes(i)) i = (i + 1) % LICENCE_QUIZ.length;
    q.asked.push(i);
    this.current = i;
    const item = LICENCE_QUIZ[i];
    this.hud.showInfo(w.licenceTitle, T(item.q), 60);
    this.hud.showChoices(item.options.map((o) => ({ text: T(o) })));
  }

  private stepQuiz(dt: number): void {
    const q = this.quiz;
    if (!q) return;
    const got = this.readChoice(dt);
    if (got < 0) return;
    if (got === LICENCE_QUIZ[this.current].right) q.right++;
    q.left--;
    this.hud.hideChoices();
    if (q.left > 0) {
      this.askNext();
      return;
    }
    this.hud.hideInfo();
    this.quiz = null;
    if (q.right >= 4) {
      this.life.data.licence = true;
      this.panels.banner(w.licenceGot, T(LICENCE_LINES.passed[0]), 4);
    } else this.hud.say(`${w.licenceFail(bnNum(q.right))} ${T(LICENCE_LINES.failed[0])}`, 5);
  }

  get quizzing(): boolean {
    return !!this.quiz;
  }

  /** Caught by the police: without a licence it costs extra. */
  stopped(addTicket: (why: string, amount: number) => void): void {
    if (this.life.data.licence || !this.player.lastDriven) return;
    this.panels.toast(w.noLicence, "bad");
    addTicket(w.noLicence, 300);
  }

  // ---------------------------------------------------------------- hidden stickers

  private placeStickers(): void {
    const city = this.city;
    const seed = this.regionId().length * 137;
    const blocks = city.layout.blocks.filter((b) => !["river", "pond", "lake"].includes(b.kind));
    const test = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
    for (let i = 0; i < STICKERS_EACH; i++) {
      const id = `${this.regionId()}_${i}`;
      if (this.life.data.found.includes(id)) continue;
      const b = blocks[(seed + i * 53) % blocks.length];
      const fx = ((seed * (i + 3) * 17) % 97) / 97, fz = ((seed * (i + 7) * 29) % 89) / 89;
      let x = b.x0 + b.sidewalk + fx * (b.x1 - b.x0 - b.sidewalk * 2), z = b.z0 + b.sidewalk + fz * (b.z1 - b.z0 - b.sidewalk * 2);
      city.collision.resolveCircle(x, z, 1, test);
      x = test.x;
      z = test.z;
      this.stickers.push({ id, x, z });
    }
    if (!this.stickers.length) return;
    const m = MeshBuilder.CreatePolyhedron("sticker", { type: 1, size: 0.17 }, this.scene);
    const mat = new StandardMaterial("stickerMat", this.scene);
    mat.emissiveColor = new Color3(1, 0.62, 0.12);
    mat.disableLighting = true;
    m.material = mat;
    m.isPickable = false;
    m.alwaysSelectAsActiveMesh = true;
    this.buffer = new Float32Array(this.stickers.length * 16);
    m.thinInstanceSetBuffer("matrix", this.buffer, 16, false);
    this.mesh = m;
    this.writeStickers();
  }

  private writeStickers(): void {
    const m = this.mesh;
    if (!m) return;
    const q = Quaternion.RotationYawPitchRoll(this.spin, 0, 0);
    this.stickers.forEach((s, i) => {
      Matrix.ComposeToRef(UNIT, q, HERE.set(s.x, 1.05 + Math.sin(this.spin + i) * 0.08, s.z), TMP);
      TMP.copyToArray(this.buffer, i * 16);
    });
    m.thinInstanceCount = this.stickers.length;
    m.thinInstanceBufferUpdated("matrix");
  }

  private pickUp(s: { id: string; x: number; z: number }): void {
    this.stickers.splice(this.stickers.indexOf(s), 1);
    this.life.data.found.push(s.id);
    const n = this.life.data.found.length;
    this.wallet.receive(100);
    this.panels.money(100);
    this.panels.toast(w.foundOne(bnNum(n), bnNum(STICKERS_TOTAL)), "good");
    if (n >= STICKERS_TOTAL) {
      this.wallet.receive(5000);
      this.panels.banner(w.foundAll, "", 4);
    }
    this.writeStickers();
  }

  // ---------------------------------------------------------------- races and businesses

  private raceDef(r: (typeof RACES)[number]): MissionDef {
    return {
      id: `race_${r.key}`,
      side: true,
      region: "",
      title: t(w.raceTitle(r.name[0]), w.raceTitle(r.name[1])),
      blurb: r.name,
      start: (k) => k.g.player.position,
      money: 0,
      stages: [{
        run: async (k: Kit) => {
          const g = k.g;
          const p = g.player.position;
          const at = k.footpathNear(p.x + 4, p.z + 4);
          const v = g.traffic.spawnParkedAt(r.vehicle, "default", at.x, at.z, g.player.yaw);
          if (!v) return;
          await k.reach(at.x, at.z, t("বাহন", "Vehicle"), t("বাহনে উঠুন", "Get on"), 3.5);
          await k.until(() => g.player.vehicle === v, 0.1);
          if (k.auto) g.player.takeWheel(v);
          k.timer(r.seconds, t(w.raceFailed, w.raceFailed));
          const started = performance.now();
          let dir = Math.random() * 6.28;
          for (let i = 0; i < r.points; i++) {
            dir += (Math.random() - 0.5) * 1.6;
            const cp = k.away(r.length, dir);
            await k.reach(cp.x, cp.z, t("চেকপয়েন্ট", "Checkpoint"), t(w.raceGoal(bnNum(i + 1), bnNum(r.points)), w.raceGoal(bnNum(i + 1), bnNum(r.points))), 11);
          }
          k.clearTimer();
          const secs = Math.round((performance.now() - started) / 1000);
          const best = g.life.data.raceBest[r.key];
          if (!best || secs < best) g.life.data.raceBest[r.key] = secs;
          g.wallet.receive(r.pay);
          g.panels.money(r.pay);
          g.life.data.stats.earned += r.pay;
          g.panels.banner(T(t("রেস জিতলেন!", "Race won!")), w.raceBest(bnNum(g.life.data.raceBest[r.key])), 4);
        },
      }],
    };
  }

  /** The journal's page of everything else. */
  html(): string {
    const d = this.life.data;
    const heading = (s: string): string => `<h4>${s}</h4>`;
    const races = RACES.map((r) => `<div class="journal-row"><div><b>${T(r.name)}</b><small>${d.raceBest[r.key] ? w.raceBest(bnNum(d.raceBest[r.key])) : bn.money(r.pay)}</small></div><button class="mini" data-do="race_${r.key}">${w.go}</button></div>`).join("");
    const shops = BUSINESSES.map((b) => `<div class="journal-row"><div><b>${T(b.name)}</b><small>${bn.money(b.daily)} / ${L("দিন", "day")}</small></div>${d.owned.includes(b.key) ? `<em>${w.owned}</em>` : `<button class="mini" data-do="own_${b.key}">${w.buy(bn.money(b.cost))}</button>`}</div>`).join("");
    const awards = AWARDS.map((a) => `<div class="journal-row ${d.awards.includes(a.key) ? "" : "locked"}"><b>${T(a.name)}</b>${d.awards.includes(a.key) ? "<em>★</em>" : ""}</div>`).join("");
    const found = `<div class="journal-row"><b>${w.found(bnNum(d.found.length), bnNum(STICKERS_TOTAL))}</b></div>`;
    return `${heading(w.races)}${races}${heading(w.business)}${shops}${heading(w.awards)}${found}${awards}`;
  }

  get tabTitle(): string {
    return w.tabExtras;
  }

  /** A button on that page. */
  act(what: string): void {
    if (what.startsWith("race_")) {
      const r = RACES.find((q) => q.key === what.slice(5));
      if (r && !this.runner().active) {
        this.panels.closeOverlay();
        this.runner().begin(this.raceDef(r));
      }
    } else if (what.startsWith("own_")) {
      const b = BUSINESSES.find((q) => q.key === what.slice(4));
      if (!b) return;
      if (!this.wallet.spend(b.cost)) {
        this.panels.toast(w.needMoney, "bad");
        return;
      }
      this.life.data.owned.push(b.key);
      this.panels.closeOverlay();
    }
  }

  // ---------------------------------------------------------------- every frame

  /** A pool of light on the ground ahead, for anyone with a torch after dark. */
  private stepTorch(night: number): void {
    const on = night > 0.5 && (this.wallet.items.torch ?? 0) > 0 && this.player.stage === "foot";
    if (on && !this.torchPool) {
      const m = MeshBuilder.CreateDisc("torchPool", { radius: 1.5, tessellation: 20 }, this.scene);
      const mat = new StandardMaterial("torchMat", this.scene);
      mat.disableLighting = true;
      mat.emissiveColor = new Color3(0.95, 0.85, 0.55);
      mat.alpha = 0.3;
      m.material = mat;
      m.rotation.x = Math.PI / 2;
      m.isPickable = false;
      this.torchPool = m;
    }
    const t = this.torchPool;
    if (!t) return;
    if (t.isEnabled() !== on) t.setEnabled(on);
    if (on) t.position.set(this.player.x + Math.sin(this.player.yaw) * 3, this.player.y + 0.06, this.player.z + Math.cos(this.player.yaw) * 3);
  }

  private torchPool: Mesh | null = null;

  update(dt: number, hour: number, chased: boolean, reports: number, night = 0): void {
    this.stepQuiz(dt);
    this.stepTorch(night);
    if (this.mesh && this.stickers.length) {
      this.spin += dt;
      if (this.stickers.some((s) => Math.abs(s.x - this.player.x) < 60 && Math.abs(s.z - this.player.z) < 60)) this.writeStickers();
    }
    // Pay day, when the clock goes round past six in the morning.
    if (this.lastHour < 6 && hour >= 6 && this.life.data.owned.length) {
      const pay = BUSINESSES.filter((b) => this.life.data.owned.includes(b.key)).reduce((n, b) => n + b.daily, 0);
      this.wallet.receive(pay);
      this.life.data.stats.earned += pay;
      this.panels.toast(w.payDay(bn.money(pay)), "good");
    }
    this.lastHour = hour;
    // The law's interest, as lamps: more for being chased, more again for repeat offences. It fades with time.
    this.lampTimer -= dt;
    if (this.lampTimer <= 0) {
      this.lampTimer = 0.5;
      const lamps = chased ? Math.min(3, 1 + reports) : 0;
      if (lamps !== this.lamps) {
        this.lamps = lamps;
        this.panels.setStars(lamps);
      }
    }
    const v = this.player.driving;
    if (v) {
      const dmg = this.life.data.damage[v.id] ?? 0;
      if (dmg > 0.6) {
        this.damageFx -= dt;
        if (this.damageFx <= 0) {
          this.damageFx = 0.5;
          this.smoke(v);
          if (dmg > 0.98) this.hud.say(w.dead, 1);
        }
      }
      // Badly smashed, it won't get going properly.
      if (dmg > 0.98 && Math.abs(v.speed) > 3.5) v.speed *= Math.exp(-dt * 2.2);
      else if (dmg > 0.6 && Math.abs(v.speed) > v.spec.topSpeed * 0.7) v.speed *= Math.exp(-dt * 0.6);
    }
    this.awardTimer -= dt;
    if (this.awardTimer <= 0) {
      this.awardTimer = 5;
      for (const a of AWARDS) {
        if (this.life.data.awards.includes(a.key) || !a.got(this.life)) continue;
        this.life.data.awards.push(a.key);
        this.panels.toast(w.award(T(a.name)), "good");
      }
    }
    void this.talk;
  }
}

const UNIT = Vector3.One();
const HERE = new Vector3();
const TMP = new Matrix();
