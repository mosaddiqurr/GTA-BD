import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import type { Life } from "../app/life";
import type { Wallet } from "../app/save";
import type { AudioSystem } from "../audio/audio";
import { CharacterId } from "../characters/character";
import type { Line } from "../dialogue/types";
import { lineSeconds, voiceOf } from "../interaction/cast";
import type { Doors } from "../interaction/doors";
import type { Interactions } from "../interaction/interactions";
import type { Talk } from "../interaction/talk";
import { N, T, bn, spokenFor } from "../localization/bn";
import type { Pedestrians, Person } from "../npc/pedestrians";
import type { Player } from "../player/player";
import type { Input } from "../player/input";
import type { TrafficSystem } from "../traffic/trafficSystem";
import type { Hud } from "../ui/hud";
import type { InspectPart, Panels } from "../ui/panels";
import type { Phone } from "../ui/phone";
import type { Vehicle } from "../vehicles/vehicle";
import type { VehicleId } from "../vehicles/vehicleData";
import type { City } from "../world/city";
import type { Inside } from "../world/interiors";
import type { RouteFinder } from "../world/routeFinder";

export { Line };

/** What a mission script is allowed to reach. */
export interface MissionHost {
  scene: Scene;
  city: City;
  peds: Pedestrians;
  traffic: TrafficSystem;
  player: Player;
  input: Input;
  talk: Talk;
  hud: Hud;
  panels: Panels;
  phone: Phone;
  doors: Doors;
  audio: AudioSystem;
  wallet: Wallet;
  life: Life;
  routes: RouteFinder;
  interactions: Interactions;
  hour: () => number;
  setHour: (h: number) => void;
  openOverlay: () => void;
  snapshot: () => void;
  saveNow: () => void;
}

/** A line said by the other person in a conversation. */
export const o = (b: string, e: string): ["o", Line] => ["o", [b, e]];
/** A line said by the hero. */
export const h = (b: string, e: string): ["h", Line] => ["h", [b, e]];
/** Words on screen in both languages. */
export const t = (b: string, e: string): Line => [b, e];

export class MissionFailed extends Error {
  constructor(readonly why: Line) {
    super(why[1]);
  }
}

export interface Point {
  x: number;
  z: number;
}

/** Someone a mission has put in the world. */
export class Actor {
  path: [number, number][] = [];
  pace = 1.4;
  onArrive: (() => void) | null = null;
  constructor(readonly who: Person, readonly label: string) {}
  get x(): number {
    return this.who.x;
  }
  get y(): number {
    return this.who.y;
  }
  get z(): number {
    return this.who.z;
  }
  get id(): string {
    return this.who.id;
  }
  get moving(): boolean {
    return this.path.length > 0;
  }
}

const TOP = 1.72;

/** Everything a mission script does, as things it can wait for. A script is one long async function:
 *  it runs along, and each `await` here holds it until that thing has happened in the game. Failing
 *  throws, so that whatever it's in the middle of simply stops. */
export class Kit {
  /** For the test run: everything happens by itself and quickly. */
  auto = false;
  private waiter: { done: () => boolean; res: () => void; rej: (e: unknown) => void; age: number; autoAfter: number } | null = null;
  private watches: (() => Line | null)[] = [];
  private actors: Actor[] = [];
  private vehicles: Vehicle[] = [];
  private timerLeft: number | null = null;
  private timerFail: Line | null = null;
  private beam: Mesh | null = null;
  private beamAt: { x: number; z: number; y: number } | null = null;
  private offer: { x: number; z: number; y: number; r: number; html: string; run: () => void } | null = null;
  private pending: unknown = null;
  /** How the mission has gone so far, for what it says at the end. */
  score = 0;

  constructor(readonly g: MissionHost) {
    g.interactions.add((x, z, yaw, driving, out) => {
      const q = this.offer;
      if (!q || driving || Math.abs(q.y - g.player.y) > 2.2 || Math.hypot(q.x - x, q.z - z) > q.r) return;
      void yaw;
      out.push({ key: "KeyE", html: q.html, priority: 95, run: q.run });
    });
  }

  // ---------------------------------------------------------------- running

  tick(dt: number): void {
    for (const a of this.actors) this.stepActor(a, dt);
    if (this.beam && this.beamAt) {
      this.beam.position.set(this.beamAt.x, this.beamAt.y + 15, this.beamAt.z);
      this.beam.rotation.y += dt;
    }
    if (this.timerLeft !== null && !this.auto) {
      this.timerLeft -= dt;
      this.g.panels.setTimer(this.timerLeft);
      if (this.timerLeft <= 0) {
        const why = this.timerFail ?? t("সময় শেষ।", "Time's up.");
        this.clearTimer();
        this.failNow(why);
      }
    }
    if (!this.auto) {
      for (const w of this.watches) {
        const why = w();
        if (why) {
          this.failNow(why);
          break;
        }
      }
    }
    const q = this.waiter;
    if (!q) return;
    q.age += dt;
    if (q.done() || (this.auto && q.age > q.autoAfter)) {
      this.waiter = null;
      q.res();
    }
  }

  private failNow(why: Line): void {
    const q = this.waiter;
    this.waiter = null;
    if (q) q.rej(new MissionFailed(why));
    else this.pending = new MissionFailed(why);
  }

  /** Ends whatever's going on from outside: the hero collapsed, say. */
  abort(why: Line): void {
    this.failNow(why);
  }

  /** Holds the script until this is true. */
  until(done: () => boolean, autoAfter = 0.4): Promise<void> {
    if (this.pending) {
      const e = this.pending;
      this.pending = null;
      return Promise.reject(e);
    }
    return new Promise((res, rej) => {
      this.waiter = { done, res, rej, age: 0, autoAfter };
    });
  }

  wait(seconds: number): Promise<void> {
    let left = seconds;
    let last = performance.now();
    return this.until(() => {
      const now = performance.now();
      left -= (now - last) / 1000;
      last = now;
      return left <= 0;
    }, 0.05);
  }

  fail(why: Line): never {
    throw new MissionFailed(why);
  }

  /** Fails the mission if this ever has something to say. */
  watch(check: () => Line | null): () => void {
    this.watches.push(check);
    return () => {
      const i = this.watches.indexOf(check);
      if (i >= 0) this.watches.splice(i, 1);
    };
  }

  /** Puts away everything the mission had out, whether it ended well or not. */
  tidy(): void {
    this.waiter = null;
    this.pending = null;
    this.watches.length = 0;
    this.clearTimer();
    this.clearMarker();
    this.offer = null;
    this.g.panels.setSignal(null);
    this.g.panels.setCinema(false);
    this.g.player.loadPace = 1;
    this.g.talk.scriptLocked = false;
    this.g.talk.stop();
    for (const a of this.actors) {
      a.who.forceLive = false;
      a.who.x = a.who.z = 1e5;
      this.g.peds.release(a.who);
    }
    this.actors.length = 0;
    for (const v of this.vehicles) this.g.traffic.retire(v);
    this.vehicles.length = 0;
    this.objective(null);
  }

  // ---------------------------------------------------------------- what the player's told

  objective(text: Line | null): void {
    this.g.panels.setObjective(this.title, text ? T(text) : "");
    if (!text && !this.title) this.g.panels.setObjective(null);
  }

  title: string | null = null;

  note(line: Line, seconds = 3.5): void {
    this.g.hud.say(T(line), seconds);
  }

  timer(seconds: number, fail: Line): void {
    this.timerLeft = seconds;
    this.timerFail = fail;
  }

  get timeLeft(): number {
    return this.timerLeft ?? 0;
  }

  clearTimer(): void {
    this.timerLeft = null;
    this.g.panels.setTimer(null);
  }

  /** A column of light over a spot, a route on the map, and a marker at the edge of the screen. */
  marker(x: number, z: number, label: Line, y = 0): void {
    if (!this.beam) {
      const m = MeshBuilder.CreateCylinder("missionBeam", { height: 30, diameter: 2.2, tessellation: 14, cap: Mesh.NO_CAP }, this.g.scene);
      const mat = new StandardMaterial("missionBeamMat", this.g.scene);
      mat.disableLighting = true;
      mat.emissiveColor = new Color3(1, 0.72, 0.18);
      mat.alpha = 0.3;
      mat.backFaceCulling = false;
      m.material = mat;
      m.isPickable = false;
      this.beam = m;
    }
    this.beam.setEnabled(true);
    this.beamAt = { x, z, y };
    this.g.hud.setWaypoint({ x, z, label: T(label) });
    // Indoors there's no road to draw.
    if (x < 4000 && this.g.player.x < 4000) this.g.hud.setRoute(this.g.routes.find(this.g.player.x, this.g.player.z, x, z));
  }

  /** A column of light and nothing else, for when there's no phone to show the way. */
  light(x: number, z: number): void {
    this.marker(x, z, t("", ""));
    this.g.hud.setWaypoint(null);
    this.g.hud.setRoute(null);
  }

  clearMarker(): void {
    this.beam?.setEnabled(false);
    this.beamAt = null;
    this.g.hud.setWaypoint(null);
    this.g.hud.setRoute(null);
  }

  // ---------------------------------------------------------------- going places

  private dist(x: number, z: number): number {
    const p = this.g.player.position;
    return Math.hypot(x - p.x, z - p.z);
  }

  /** Gets there, on foot or by whatever they can find. */
  async reach(x: number, z: number, label: Line, goal: Line, r = 5): Promise<void> {
    this.objective(goal);
    this.marker(x, z, label);
    await this.until(() => {
      if (this.auto) return false;
      return this.dist(x, z) < r;
    }, 0.1);
    if (this.auto) this.moveHero(x, z);
    this.clearMarker();
  }

  /** On foot, and out of any vehicle, at this spot: for walking up to something. */
  async reachOnFoot(x: number, z: number, label: Line, goal: Line, r = 3, y = 0): Promise<void> {
    this.objective(goal);
    this.marker(x, z, label, y);
    await this.until(() => !this.g.player.vehicle && this.dist(x, z) < r && Math.abs(this.g.player.y - y) < 2.5, 0.1);
    if (this.auto) this.moveHero(x, z, y);
    this.clearMarker();
  }

  moveHero(x: number, z: number, y?: number): void {
    const pl = this.g.player;
    if (pl.vehicle) pl.endVehicle();
    pl.warp(x, y ?? this.g.city.layout.groundHeight(x, z), z, pl.yaw);
  }

  /** Through a door of this kind and inside. */
  async goInside(kind: Inside["kind"], goal: Line): Promise<Inside> {
    const b = this.inside(kind);
    this.objective(goal);
    this.marker(b.outX, b.outZ, t(b.name, N(b.name)));
    await this.until(() => this.g.doors.inside === b, 0.1);
    if (this.auto) this.g.doors.goIn(b);
    await this.wait(0.6);
    this.clearMarker();
    return b;
  }

  async goOutside(goal: Line): Promise<void> {
    this.objective(goal);
    await this.until(() => !this.g.doors.inside, 0.1);
    if (this.auto) this.g.doors.goOut();
    await this.wait(0.6);
  }

  /** Waits for E at a spot, with a prompt: doing something there. */
  async doAt(x: number, z: number, y: number, prompt: Line, goal: Line, r = 2.4): Promise<void> {
    this.objective(goal);
    this.marker(x, z, prompt, y);
    let pressed = false;
    this.offer = { x, z, y, r, html: `<kbd>E</kbd> ${T(prompt)}`, run: () => (pressed = true) };
    await this.until(() => pressed, 0.1);
    this.offer = null;
    this.clearMarker();
  }

  /** Takes a picture of something, with the phone: walk up, face it and press E. */
  async photo(x: number, z: number, y: number, what: Line, goal: Line, r = 5): Promise<void> {
    await this.doAt(x, z, y, t(`ছবি তুলুন: ${what[0]}`, `Take a photo: ${what[1]}`), goal, r);
    this.g.audio.thud(0.2);
    this.g.snapshot();
    this.g.life.data.stats.photos++;
    this.g.panels.toast(T(t(`ছবি উঠল: ${what[0]}`, `Photo taken: ${what[1]}`)), "good");
  }

  // ---------------------------------------------------------------- places in this district

  inside(kind: Inside["kind"], n = 0): Inside {
    const list = this.g.city.interiors.all.filter((b) => b.kind === kind);
    return list[n % Math.max(list.length, 1)] ?? this.g.city.interiors.all[0];
  }

  /** A spot on the footpath in front of a block of this kind. */
  block(kind: string, n = 0): Point {
    const list = this.g.city.layout.blocks.filter((b) => b.kind === kind);
    const b = list[n % Math.max(list.length, 1)] ?? this.g.city.layout.blocks[0];
    return { x: (b.x0 + b.x1) / 2, z: b.z0 + b.sidewalk * 0.5 };
  }

  /** The nth tea stall from a point. */
  teaStall(from: Point = this.g.player.position, n = 0): (typeof this.g.city.stalls)[number] {
    const list = this.g.city.stalls.filter((s) => s.kind === "tea").sort((p, q) => Math.hypot(p.x - from.x, p.z - from.z) - Math.hypot(q.x - from.x, q.z - from.z));
    return list[n % list.length];
  }

  /** The nearest stall of any kind but tea. */
  cartNear(from: Point, n = 0): (typeof this.g.city.stalls)[number] {
    const list = this.g.city.stalls.filter((s) => s.kind !== "tea").sort((p, q) => Math.hypot(p.x - from.x, p.z - from.z) - Math.hypot(q.x - from.x, q.z - from.z));
    return list[n % list.length];
  }

  /** Somewhere on the footpath a good walk from here, in roughly this direction. */
  footpathNear(x: number, z: number): Point {
    let best: Point = { x, z }, bd = Infinity;
    for (const b of this.g.city.layout.blocks) {
      const cands: Point[] = [
        { x: Math.max(b.x0, Math.min(b.x1, x)), z: b.z0 + b.sidewalk * 0.5 },
        { x: Math.max(b.x0, Math.min(b.x1, x)), z: b.z1 - b.sidewalk * 0.5 },
        { x: b.x0 + b.sidewalk * 0.5, z: Math.max(b.z0, Math.min(b.z1, z)) },
        { x: b.x1 - b.sidewalk * 0.5, z: Math.max(b.z0, Math.min(b.z1, z)) },
      ];
      for (const q of cands) {
        const d = Math.hypot(q.x - x, q.z - z);
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
    }
    return best;
  }

  /** How far from here, for picking somewhere a good way off. */
  away(metres: number, angle = Math.random() * 6.28): Point {
    const p = this.g.player.position;
    const limit = this.g.city.region.layout.boundary - 40;
    const x = Math.max(-limit, Math.min(limit, p.x + Math.sin(angle) * metres));
    const z = Math.max(-limit, Math.min(limit, p.z + Math.cos(angle) * metres));
    return this.footpathNear(x, z);
  }

  // ---------------------------------------------------------------- people

  person(id: CharacterId, x: number, z: number, label: Line, opts: { yaw?: number; pose?: Person["pose"]; y?: number } = {}): Actor {
    const who = this.g.peds.addStanding(id, opts.pose ?? "stand");
    who.x = x;
    who.y = opts.y ?? this.g.city.layout.groundHeight(x, z);
    who.z = z;
    who.yaw = opts.yaw ?? 0;
    who.forceLive = true;
    const a = new Actor(who, T(label));
    this.actors.push(a);
    return a;
  }

  /** Someone already standing there, such as whoever minds a stall. */
  existing(who: Person, label: Line): Actor {
    return new Actor(who, T(label));
  }

  faceHero(a: Actor): void {
    a.who.yaw = Math.atan2(this.g.player.x - a.x, this.g.player.z - a.z);
  }

  /** Off along these points at this pace. Fast enough, and they run. */
  walk(a: Actor, points: [number, number][], pace = 1.4): void {
    a.path = [...points];
    a.pace = pace;
  }

  /** Along the roads to somewhere, keeping to the footpath edge as near as makes no odds. */
  walkTo(a: Actor, x: number, z: number, pace = 1.4): void {
    const way = this.g.routes.find(a.x, a.z, x, z);
    this.walk(a, [...way, [x, z]], pace);
  }

  private stepActor(a: Actor, dt: number): void {
    if (!a.path.length) {
      if (a.who.pose === "walk" || a.who.pose === "run") {
        a.who.pose = "stand";
        a.who.speed = 0;
        const done = a.onArrive;
        a.onArrive = null;
        done?.();
      }
      return;
    }
    const [tx, tz] = a.path[0];
    const dx = tx - a.who.x, dz = tz - a.who.z, d = Math.hypot(dx, dz);
    const step = a.pace * dt;
    if (d <= step) {
      a.who.x = tx;
      a.who.z = tz;
      a.path.shift();
    } else {
      a.who.x += (dx / d) * step;
      a.who.z += (dz / d) * step;
      a.who.yaw = Math.atan2(dx, dz);
    }
    a.who.y = a.who.y > 1.5 ? a.who.y : this.g.city.layout.groundHeight(a.who.x, a.who.z);
    a.who.speed = a.pace;
    a.who.pose = a.pace > 3 ? "run" : "walk";
  }

  // ---------------------------------------------------------------- talking

  private sayLine(fn: (then: () => void) => void): Promise<void> {
    return new Promise<void>((res, rej) => {
      let over = false;
      fn(() => {
        over = true;
      });
      this.until(() => over, 0.02).then(res, rej);
    });
  }

  /** A conversation face to face, with the view brought in and the hero held still. */
  async talk(a: Actor, lines: readonly (readonly ["o" | "h", Line])[]): Promise<void> {
    this.open(a);
    for (const [who, line] of lines) {
      await this.sayLine((then) => {
        if (who === "o") this.g.talk.say(T(line), then);
        else this.g.talk.heroSay(T(line), then);
      });
    }
    this.close();
  }

  private openWith: Actor | null = null;

  private open(a: Actor): void {
    const talk = this.g.talk;
    if (this.openWith === a && talk.active) return;
    talk.scriptLocked = true;
    talk.beginScene(a.who, a.label);
    this.openWith = a;
    this.g.panels.setCinema(true);
    this.g.panels.setObjective(null);
  }

  private close(): void {
    const talk = this.g.talk;
    talk.scriptLocked = false;
    talk.closeNow();
    this.openWith = null;
    this.g.panels.setCinema(false);
  }

  /** A question with answers, partway through a conversation. Hands back which one was picked. */
  choose(a: Actor, options: readonly Line[], right = 0): Promise<number> {
    this.open(a);
    return new Promise((res, rej) => {
      let picked = -1;
      this.g.talk.menuOf(options.map((l, i) => ({ text: T(l), run: () => (picked = i) })));
      const started = this.auto;
      this.until(() => picked >= 0, 0.05).then(() => {
        this.close();
        res(started && picked < 0 ? right : picked);
      }, rej);
    });
  }

  /** A phone call: it rings, and it's said over the hero's head while they keep moving. */
  async call(id: CharacterId | "hero_mango", label: Line, lines: readonly (readonly ["o" | "h", Line])[]): Promise<void> {
    const g = this.g;
    g.audio.ring();
    g.panels.toast(T(t(`ফোন: ${label[0]}`, `Call: ${label[1]}`)));
    await this.wait(1.3);
    for (const [who, line] of lines) {
      const text = T(line);
      const voice = who === "o" ? voiceOf(id) : voiceOf("hero_mango");
      let over = false;
      g.hud.bubble(text, who === "o" ? T(label) : bn.you, g.player, 1.72, lineSeconds(text) + 0.6);
      g.audio.speak(text, voice, false, () => (over = true));
      const start = performance.now();
      await this.until(() => over && performance.now() - start > 500 || performance.now() - start > (lineSeconds(text) + 0.4) * 2000, 0.02);
    }
    g.hud.clearBubble(g.player);
  }

  /** Words on screen for a moment, without anyone saying them. */
  async caption(line: Line, seconds = 3): Promise<void> {
    this.note(line, seconds);
    await this.wait(seconds);
  }

  /** Opens a message or a page to go through and tap what's wrong with it. */
  inspect(title: Line, parts: InspectPart[], hint: Line): Promise<void> {
    const g = this.g;
    return new Promise((res, rej) => {
      let over = false;
      g.openOverlay();
      g.panels.showInspect(T(title), parts, T(hint), () => (over = true));
      this.untilPaused(() => over).then(res, rej);
    });
  }

  /** The same as `until`, for something the game's paused for: the overlay's own buttons move it on. */
  private untilPaused(done: () => boolean): Promise<void> {
    return new Promise((res) => {
      const check = (): void => {
        if (done() || this.auto) {
          if (this.auto) this.g.panels.closeOverlay();
          res();
        } else setTimeout(check, 60);
      };
      check();
    });
  }

  // ---------------------------------------------------------------- following and catching

  /** Keeps up with someone on foot until they're caught. */
  async chase(a: Actor, goal: Line, lost: Line, reach = 2, far = 70): Promise<void> {
    this.objective(goal);
    const stop = this.watch(() => (Math.hypot(a.x - this.g.player.x, a.z - this.g.player.z) > far ? lost : null));
    this.beamOn(a);
    await this.until(() => Math.hypot(a.x - this.g.player.x, a.z - this.g.player.z) < reach, 0.3);
    stop();
    this.beamOff();
  }

  private following: Point | null = null;

  private beamOn(p: Point): void {
    this.following = p;
    this.marker(p.x, p.z, t("এখানে", "Here"));
    const again = (): void => {
      if (!this.following) return;
      this.beamAt = { x: this.following.x, z: this.following.z, y: 0 };
      this.g.hud.setWaypoint({ x: this.following.x, z: this.following.z, label: T(t("পিছু নিন", "Follow")) });
      setTimeout(again, 120);
    };
    again();
  }

  private beamOff(): void {
    this.following = null;
    this.clearMarker();
  }

  /** Follows someone or something without being noticed or falling behind, until `done`. */
  async tail(what: Point, goal: Line, opts: { near: number; far: number; seen: Line; lost: Line; done: () => boolean }): Promise<void> {
    this.objective(goal);
    let tooClose = 0, tooFar = 0, last = performance.now();
    const stop = this.watch(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const d = this.dist(what.x, what.z);
      this.g.panels.setSignal(Math.max(0, 1 - d / opts.far), T(d < opts.near ? t("বেশি কাছে!", "Too close!") : d > opts.far * 0.8 ? t("দূরে চলে যাচ্ছে!", "Getting away!") : t("ঠিক আছে", "Good distance")));
      tooClose = d < opts.near ? tooClose + dt : 0;
      tooFar = d > opts.far ? tooFar + dt : 0;
      if (tooClose > 4) return opts.seen;
      if (tooFar > 7) return opts.lost;
      return null;
    });
    this.beamOn(what);
    await this.until(opts.done, 0.4);
    stop();
    this.beamOff();
    this.g.panels.setSignal(null);
  }

  /** Walks about with the phone's signal meter until they're standing right by the source of it. */
  async hunt(x: number, z: number, y: number, label: Line, goal: Line, r = 5): Promise<void> {
    this.objective(goal);
    const span = 90;
    await this.until(() => {
      const d = Math.hypot(x - this.g.player.x, z - this.g.player.z) + Math.abs(y - this.g.player.y) * 6;
      this.g.panels.setSignal(Math.max(0, 1 - d / span), T(label));
      return d < r;
    }, 0.2);
    if (this.auto) this.moveHero(x, z, y);
    this.g.panels.setSignal(null);
  }

  // ---------------------------------------------------------------- vehicles

  /** A vehicle in traffic near here, with a driver, going where it's sent. */
  car(id: VehicleId, near: Point, within = 120): Vehicle | null {
    const v = this.g.traffic.spawnNear(id, near.x, near.z, within);
    if (v) this.vehicles.push(v);
    return v;
  }

  send(v: Vehicle, x: number, z: number): void {
    this.g.traffic.setDestination(v, x, z);
  }

  /** How far a vehicle is from somewhere. */
  distOf(p: Point, x: number, z: number): number {
    return Math.hypot(p.x - x, p.z - z);
  }

  // ---------------------------------------------------------------- what the phone's doing

  /** Takes away the phone and the map, for when the SIM has gone. */
  noPhone(on: boolean): void {
    this.g.phone.disabled = on;
    this.g.hud.setMapDisabled(on);
  }

  message(from: string, line: Line): void {
    this.g.phone.receive(from, T(line));
  }

  spoken(text: string): string {
    return spokenFor(text);
  }

  vec(x: number, y: number, z: number): Vector3 {
    return new Vector3(x, y, z);
  }
}
