import { bn, bnNum } from "../localization/bn";
import { lineSeconds, voiceOf } from "../interaction/cast";
import type { AudioSystem } from "../audio/audio";
import type { Input } from "../player/input";
import type { Hud } from "./hud";
import { CONTACTS, Contact, PhoneData, freshPhone } from "./phoneData";

export interface NavPlace {
  label: string;
  x: number;
  z: number;
  kind: string;
}

/** Everything the phone needs from the game around it. */
export interface PhoneHost {
  input: Input;
  hud: Hud;
  audio: AudioSystem;
  /** Where the hero is, and when. */
  here: () => { x: number; z: number; yaw: number; hour: number; place: string };
  /** Cash in hand. */
  cash: () => number;
  spendCash: (n: number) => boolean;
  receiveCash: (n: number) => void;
  /** Saved with the rest of the game. */
  save: () => void;
  places: () => NavPlace[];
  route: (x: number, z: number) => [number, number][];
  /** A mobile money agent within reach. */
  nearAgent: () => boolean;
  /** Sends for a ride, and says whether anyone's coming. */
  callRide: (kind: "rickshaw" | "cng" | "taxi" | "bike") => boolean;
  /** Whatever's in view and close enough to matter as evidence. */
  subjects: () => string;
  /** The view right now, small enough to keep. */
  snapshot: () => Promise<string>;
  loadPhotos: () => PhotoRecord[];
  savePhotos: (list: PhotoRecord[]) => void;
  wallet: () => { items: Record<string, number> };
}

export interface PhotoRecord {
  data: string;
  place: string;
  hour: number;
  what: string;
}

const NUDGE_EVERY = [150, 320];
const MAX_PHOTOS = 14;

type Screen = () => string;

/** The hero's phone. It's a screen with its own small apps, drawn over the game, which carries on around it. */
export class Phone {
  private el: HTMLElement;
  private body: HTMLElement;
  private top: HTMLElement;
  private cameraEl: HTMLElement;
  private toastEl: HTMLElement;
  private stack: Screen[] = [];
  private actions = new Map<string, () => void>();
  private act = 0;
  private opened = false;
  private shooting = false;
  private nudge = NUDGE_EVERY[0];
  private ringing: { contact: Contact; left: number; lines: readonly string[] } | null = null;
  private ringTimer = 0;
  private call: { contact: Contact; lines: readonly string[]; at: number; next: number; time: number; incoming: boolean } | null = null;
  private pinEntry = "";
  private clockTimer = 0;
  private navTo: NavPlace | null = null;
  private navTimer = 0;
  private photos: PhotoRecord[] = [];
  private seen = false;

  constructor(readonly host: PhoneHost, private data: PhoneData) {
    const root = document.getElementById("ui")!;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="phone hidden" id="phone">
        <div class="phone-top" id="phoneTop"></div>
        <div class="phone-body" id="phoneBody"></div>
        <div class="phone-foot"><button id="phoneBack">‹</button><button id="phoneHome">○</button><button id="phoneOff">✕</button></div>
      </div>
      <div class="phone-camera hidden" id="phoneCamera"><i></i><i></i><i></i><i></i><div class="cam-hint"></div><div class="cam-flash"></div></div>
      <div class="phone-toast" id="phoneToast"></div>`;
    while (wrap.firstChild) root.appendChild(wrap.firstChild);
    this.el = document.getElementById("phone")!;
    this.body = document.getElementById("phoneBody")!;
    this.top = document.getElementById("phoneTop")!;
    this.cameraEl = document.getElementById("phoneCamera")!;
    this.toastEl = document.getElementById("phoneToast")!;
    this.cameraEl.querySelector(".cam-hint")!.innerHTML = bn.phone.cameraHint;
    this.el.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
      if (t) {
        host.audio.thud(0.06);
        this.actions.get(t.dataset.act!)?.();
      }
    });
    document.getElementById("phoneBack")!.addEventListener("click", () => this.back());
    document.getElementById("phoneHome")!.addEventListener("click", () => this.home());
    document.getElementById("phoneOff")!.addEventListener("click", () => this.close());
    window.addEventListener("keydown", (e) => {
      if (!this.opened) return;
      if (e.code === "Escape" || e.code === "KeyP") {
        e.stopPropagation();
        if (e.code === "Escape" && this.stack.length > 1) this.back();
        else this.close();
      } else if (/^Digit[0-9]$/.test(e.code) && this.pinKeys) this.pinKeys(e.code.slice(5));
    }, true);
    window.addEventListener("mousedown", () => {
      if (this.shooting) void this.takePhoto();
    });
    this.photos = host.loadPhotos();
  }

  private pinKeys: ((d: string) => void) | null = null;

  get isOpen(): boolean {
    return this.opened;
  }

  get inCamera(): boolean {
    return this.shooting;
  }

  /** No SIM: the phone's a brick for now. */
  disabled = false;

  /** P. */
  toggle(): void {
    if (this.disabled) {
      this.host.hud.say(bn.phone.noService, 2.4);
      return;
    }
    if (this.shooting) {
      this.endCamera();
      return;
    }
    if (this.opened) this.close();
    else this.open();
  }

  /** Esc from the viewfinder goes back to the phone, not to the pause screen. */
  backFromCamera(): void {
    this.endCamera();
  }

  private open(): void {
    this.opened = true;
    this.el.classList.remove("hidden");
    this.host.input.enabled = false;
    this.host.input.releaseLock();
    this.host.audio.thud(0.08);
    if (this.ringing) this.answer();
    else if (!this.stack.length) this.home();
    else this.render();
  }

  close(): void {
    if (this.call) this.hangUp();
    this.opened = false;
    this.pinKeys = null;
    this.el.classList.add("hidden");
    this.host.input.enabled = true;
    this.host.input.requestLock();
  }

  stop(): void {
    if (this.opened) this.close();
    if (this.shooting) this.endCamera();
  }

  // ---------------------------------------------------------------- moving between screens

  private go(s: Screen): void {
    this.stack.push(s);
    this.render();
  }

  private home(): void {
    this.pinKeys = null;
    this.stack = [() => this.homeScreen()];
    this.render();
  }

  private back(): void {
    if (this.call) return;
    this.pinKeys = null;
    if (this.stack.length > 1) this.stack.pop();
    this.render();
  }

  private render(): void {
    this.actions.clear();
    this.act = 0;
    this.body.innerHTML = this.stack[this.stack.length - 1]();
    this.body.scrollTop = 0;
    this.renderTop();
  }

  private on(run: () => void): string {
    const id = `a${this.act++}`;
    this.actions.set(id, run);
    return `data-act="${id}"`;
  }

  private renderTop(): void {
    const h = this.host.here().hour;
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    this.top.innerHTML = `<b>${bnNum(hh.toString().padStart(2, "0"))}:${bnNum(mm.toString().padStart(2, "0"))}</b><span>${bn.phone.network}</span>`;
  }

  // ---------------------------------------------------------------- home

  private homeScreen(): string {
    const unread = this.data.threads.reduce((n, t) => n + (t.read ? 0 : 1), 0);
    const missed = this.data.missed;
    const openJobs = this.data.jobs.filter((j) => !j.done).length;
    const icon = (key: string, label: string, colour: string, run: () => void, badge = 0): string =>
      `<button class="app" ${this.on(run)}><i style="background:${colour}">${ICONS[key]}</i><span>${label}</span>${badge ? `<em>${bnNum(badge)}</em>` : ""}</button>`;
    return `<div class="apps">
      ${icon("call", bn.phone.apps.call, "#2fa35a", () => this.go(() => this.callsScreen()), missed)}
      ${icon("msg", bn.phone.apps.messages, "#2d7fc4", () => this.go(() => this.threadsScreen()), unread)}
      ${icon("people", bn.phone.apps.contacts, "#d0822a", () => this.go(() => this.contactsScreen()))}
      ${icon("map", bn.phone.apps.map, "#3f9a8f", () => this.go(() => this.mapScreen()))}
      ${icon("money", bn.phone.apps.bank, "#d43c7c", () => this.go(() => this.bankHome()))}
      ${icon("ride", bn.phone.apps.ride, "#7a58c4", () => this.go(() => this.rideScreen()))}
      ${icon("camera", bn.phone.apps.camera, "#555d66", () => this.go(() => this.cameraScreen()))}
      ${icon("jobs", bn.phone.apps.jobs, "#b5472f", () => this.go(() => this.jobsScreen()), openJobs)}
    </div>`;
  }

  // ---------------------------------------------------------------- calls and contacts

  private callsScreen(): string {
    const log = this.data.calls.slice(-12).reverse().map((c) => {
      const who = contactOf(c.who);
      return `<button class="row" ${this.on(() => this.dial(who))}><b>${who.name}</b><small class="${c.kind === "missed" ? "bad" : ""}">${bn.phone.callKinds[c.kind]} · ${timeWords(c.hour)}</small></button>`;
    }).join("");
    this.data.missed = 0;
    return `<h3>${bn.phone.apps.call}</h3>${log || `<p class="none">${bn.phone.noCalls}</p>`}<button class="btn-line" ${this.on(() => this.go(() => this.contactsScreen()))}>${bn.phone.apps.contacts}</button>`;
  }

  private contactsScreen(): string {
    return `<h3>${bn.phone.apps.contacts}</h3>${CONTACTS.filter((c) => !c.hidden).map((c) =>
      `<div class="row split"><div><b>${c.name}</b><small>${c.about}</small></div><div class="acts"><button ${this.on(() => this.dial(c))}>${ICONS.call}</button><button ${this.on(() => this.go(() => this.threadScreen(c.id)))}>${ICONS.msg}</button></div></div>`).join("")}`;
  }

  private dial(c: Contact): void {
    this.startCall(c, c.calls[Math.floor(Math.random() * c.calls.length)], false);
  }

  private startCall(c: Contact, lines: readonly string[], incoming: boolean): void {
    this.call = { contact: c, lines, at: 0, next: incoming ? 0.4 : 2.2, time: 0, incoming };
    this.stack.push(() => this.callScreen());
    this.render();
    this.data.calls.push({ who: c.id, kind: incoming ? "in" : "out", hour: this.host.here().hour });
    if (this.data.calls.length > 40) this.data.calls.shift();
    this.host.save();
  }

  private callScreen(): string {
    const c = this.call;
    if (!c) return "";
    const said = c.at > 0 ? c.lines[c.at - 1] : c.incoming ? "" : bn.phone.dialling;
    return `<div class="call"><div class="avatar">${c.contact.name[0]}</div><h3>${c.contact.name}</h3><small id="callTime">০০:০০</small>
      <p class="said" id="callSaid">${said}</p><button class="end" ${this.on(() => this.hangUp())}>${ICONS.call}</button></div>`;
  }

  private hangUp(): void {
    if (!this.call) return;
    const who = this.call.contact.id, mine = !this.call.incoming;
    this.call = null;
    if (mine) this.onCallEnded?.(who);
    this.host.audio.thud(0.1);
    if (this.stack.length > 1) this.stack.pop();
    if (this.opened) this.render();
  }

  private answer(): void {
    const r = this.ringing!;
    this.ringing = null;
    if (!this.stack.length) this.stack = [() => this.homeScreen()];
    this.startCall(r.contact, r.lines, true);
  }

  /** The phone rings. It stays quiet if they're already on it. */
  ring(contact: Contact, lines: readonly string[]): void {
    if (this.call || this.ringing) return;
    this.ringing = { contact, lines, left: 16 };
    this.ringTimer = 0;
    this.toast(bn.phone.ringing(contact.name), 4);
  }

  // ---------------------------------------------------------------- messages

  private threadsScreen(): string {
    const list = [...this.data.threads].sort((a, b) => b.last - a.last);
    return `<h3>${bn.phone.apps.messages}</h3>${list.map((t) => {
      const last = t.msgs[t.msgs.length - 1];
      return `<button class="row ${t.read ? "" : "unread"}" ${this.on(() => this.go(() => this.threadScreen(t.who)))}><b>${contactOf(t.who).name}</b><small>${last ? clip(last.text) : ""}</small></button>`;
    }).join("") || `<p class="none">${bn.phone.noMessages}</p>`}`;
  }

  private threadScreen(who: string): string {
    const t = this.threadOf(who);
    t.read = true;
    this.host.save();
    const c = contactOf(who);
    const replies = (c.replies ?? []).filter((q) => !t.msgs.some((m) => m.mine && m.text === q));
    return `<h3>${c.name}</h3><div class="thread">${t.msgs.map((m) => `<p class="${m.mine ? "mine" : ""}">${m.text}</p>`).join("") || `<p class="none">${bn.phone.noMessages}</p>`}</div>
      ${replies.map((q) => `<button class="btn-line small" ${this.on(() => {
        t.msgs.push({ mine: true, text: q });
        t.last = Date.now();
        this.host.save();
        this.render();
      })}>${q}</button>`).join("")}`;
  }

  private threadOf(who: string): PhoneData["threads"][number] {
    let t = this.data.threads.find((q) => q.who === who);
    if (!t) {
      t = { who, read: true, last: 0, msgs: [] };
      this.data.threads.push(t);
    }
    return t;
  }

  /** A text comes in. */
  receive(who: string, text: string): void {
    const t = this.threadOf(who);
    t.msgs.push({ mine: false, text });
    t.read = false;
    t.last = Date.now();
    this.host.save();
    this.host.audio.thud(0.12);
    this.toast(bn.phone.newMessage(contactOf(who).name), 3.6);
    if (this.opened) this.render();
  }

  /** A call the hero made has ended. */
  onCallEnded: ((id: string) => void) | null = null;

  finishJob(id: string): void {
    const j = this.data.jobs.find((q) => q.id === id);
    if (j) j.done = true;
  }

  /** A job from someone, for the inbox. */
  addJob(id: string, title: string, from: string, text: string): void {
    if (this.data.jobs.some((j) => j.id === id)) return;
    this.data.jobs.push({ id, title, from, text, done: false });
    this.host.save();
    this.toast(bn.phone.newJob, 3.6);
  }

  // ---------------------------------------------------------------- navigation

  private mapScreen(): string {
    const { x, z } = this.host.here();
    const near = this.host.places().map((p) => ({ p, d: Math.hypot(p.x - x, p.z - z) })).sort((a, b) => a.d - b.d);
    const current = this.navTo;
    return `<h3>${bn.phone.apps.map}</h3>
      ${current ? `<div class="nav-on"><b>${current.label}</b><small>${bn.talk.metres(bnNum(Math.round(Math.hypot(current.x - x, current.z - z))))}</small><button class="btn-line small" ${this.on(() => this.stopNav())}>${bn.phone.navStop}</button></div>` : ""}
      ${near.slice(0, 30).map(({ p, d }) => `<button class="row split" ${this.on(() => this.navigate(p))}><div><b>${p.label}</b></div><small>${bn.talk.metres(bnNum(Math.round(d)))}</small></button>`).join("")}`;
  }

  private navigate(p: NavPlace): void {
    this.navTo = p;
    this.navTimer = 0;
    this.host.hud.setWaypoint({ x: p.x, z: p.z, label: p.label });
    this.host.hud.setRoute(this.host.route(p.x, p.z));
    this.close();
  }

  private stopNav(): void {
    this.navTo = null;
    this.host.hud.setWaypoint(null);
    this.host.hud.setRoute(null);
    this.render();
  }

  // ---------------------------------------------------------------- mobile money

  private bankHome(): string {
    if (!this.data.pin) return this.pinScreen(bn.phone.setPin, (pin) => {
      this.data.pin = pin;
      this.host.save();
      this.toast(bn.phone.pinSet, 3);
      this.stack.pop();
      this.go(() => this.bankHome());
    });
    return `<h3>${bn.phone.bankName}</h3>
      <div class="balance"><small>${bn.phone.balance}</small><b>${bn.money(this.data.mobile)}</b><small>${bn.phone.cashInHand}: ${bn.money(this.host.cash())}</small></div>
      <button class="btn-line" ${this.on(() => this.go(() => this.sendPick()))}>${bn.phone.send}</button>
      <button class="btn-line" ${this.on(() => this.go(() => this.agentScreen()))}>${bn.phone.agent}</button>
      <button class="btn-line" ${this.on(() => this.go(() => this.statementScreen()))}>${bn.phone.statement}</button>
      <p class="warn">${bn.phone.pinWarning}</p>`;
  }

  private sendPick(): string {
    return `<h3>${bn.phone.send}</h3>${CONTACTS.filter((c) => !c.hidden && c.bank).map((c) => `<button class="row" ${this.on(() => this.go(() => this.amountScreen((n) => this.withPin(() => this.sendMoney(c, n)))))}><b>${c.name}</b><small>${c.number}</small></button>`).join("")}`;
  }

  private amountScreen(then: (n: number) => void): string {
    return `<h3>${bn.phone.howMuch}</h3><div class="amounts">${[50, 100, 200, 500, 1000, 2000].map((n) => `<button ${this.on(() => then(n))}>${bn.money(n)}</button>`).join("")}</div>`;
  }

  private withPin(then: () => void): void {
    this.go(() => this.pinScreen(bn.phone.enterPin, (pin) => {
      if (pin !== this.data.pin) {
        this.toast(bn.phone.wrongPin, 3);
        return;
      }
      this.stack.pop();
      then();
    }));
  }

  private pinScreen(title: string, done: (pin: string) => void): string {
    this.pinEntry = "";
    const press = (d: string): void => {
      if (d === "del") this.pinEntry = this.pinEntry.slice(0, -1);
      else if (this.pinEntry.length < 4) this.pinEntry += d;
      const dots = document.getElementById("pinDots");
      if (dots) dots.textContent = "●".repeat(this.pinEntry.length) + "○".repeat(4 - this.pinEntry.length);
      if (this.pinEntry.length === 4) {
        const pin = this.pinEntry;
        this.pinEntry = "";
        this.pinKeys = null;
        done(pin);
      }
    };
    this.pinKeys = press;
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
    return `<h3>${title}</h3><div class="pin-dots" id="pinDots">○○○○</div><div class="pinpad">${keys.map((k) => (k ? `<button ${this.on(() => press(k))}>${k === "del" ? "⌫" : bnNum(k)}</button>` : "<span></span>")).join("")}</div>`;
  }

  private sendMoney(c: Contact, n: number): void {
    if (this.data.mobile < n) {
      this.toast(bn.phone.notEnough, 3);
      this.stack.pop();
      this.render();
      return;
    }
    this.data.mobile -= n;
    this.data.statement.push({ text: bn.phone.sentTo(c.name), amount: -n, hour: this.host.here().hour });
    this.host.save();
    this.toast(bn.phone.sent(bnNum(n), c.name), 3.4);
    this.stack.pop();
    this.stack.pop();
    this.render();
  }

  private agentScreen(): string {
    const near = this.host.nearAgent();
    if (!near) return `<h3>${bn.phone.agent}</h3><p class="none">${bn.phone.noAgent}</p>`;
    const cashIn = (n: number): void => {
      if (!this.host.spendCash(n)) {
        this.toast(bn.phone.notEnoughCash, 3);
        return;
      }
      this.data.mobile += n;
      this.data.statement.push({ text: bn.phone.cashIn, amount: n, hour: this.host.here().hour });
      this.host.save();
      this.toast(bn.phone.cashedIn(bnNum(n)), 3);
      this.render();
    };
    const cashOut = (n: number): void => this.withPin(() => {
      // The agent takes a small fee, as they do.
      const fee = Math.ceil(n * 0.02);
      if (this.data.mobile < n + fee) {
        this.toast(bn.phone.notEnough, 3);
        return;
      }
      this.data.mobile -= n + fee;
      this.host.receiveCash(n);
      this.data.statement.push({ text: bn.phone.cashOut, amount: -(n + fee), hour: this.host.here().hour });
      this.host.save();
      this.toast(bn.phone.cashedOut(bnNum(n), bnNum(fee)), 3.4);
      this.render();
    });
    return `<h3>${bn.phone.agent}</h3><p class="none">${bn.phone.atAgent}</p><h4>${bn.phone.cashIn}</h4><div class="amounts">${[100, 500, 1000].map((n) => `<button ${this.on(() => cashIn(n))}>${bn.money(n)}</button>`).join("")}</div>
      <h4>${bn.phone.cashOut}</h4><div class="amounts">${[100, 500, 1000].map((n) => `<button ${this.on(() => cashOut(n))}>${bn.money(n)}</button>`).join("")}</div>`;
  }

  private statementScreen(): string {
    const rows = this.data.statement.slice(-20).reverse().map((s) => `<div class="row split"><div><b>${s.text}</b><small>${timeWords(s.hour)}</small></div><b class="${s.amount < 0 ? "bad" : "good"}">${s.amount < 0 ? "−" : "+"}${bn.money(Math.abs(s.amount))}</b></div>`).join("");
    return `<h3>${bn.phone.statement}</h3>${rows || `<p class="none">${bn.phone.noStatement}</p>`}`;
  }

  // ---------------------------------------------------------------- rides

  private rideScreen(): string {
    const book = (kind: "rickshaw" | "cng" | "taxi" | "bike"): void => {
      if (this.host.callRide(kind)) this.close();
      else this.toast(bn.hail.none, 3);
    };
    const row = (kind: "rickshaw" | "cng" | "taxi" | "bike", label: string, sub: string): string => `<button class="row split" ${this.on(() => book(kind))}><div><b>${label}</b><small>${sub}</small></div>${ICONS.ride}</button>`;
    return `<h3>${bn.phone.apps.ride}</h3>
      ${row("bike", bn.phone.rides.bike, bn.phone.rides.bikeSub)}
      ${row("cng", bn.phone.rides.cng, bn.phone.rides.cngSub)}
      ${row("taxi", bn.phone.rides.taxi, bn.phone.rides.taxiSub)}
      ${row("rickshaw", bn.phone.rides.rickshaw, bn.phone.rides.rickshawSub)}`;
  }

  // ---------------------------------------------------------------- camera

  private cameraScreen(): string {
    const shots = [...this.photos].reverse().map((p) => `<figure><img src="${p.data}" alt="" /><figcaption>${p.place} · ${timeWords(p.hour)}${p.what ? `<br>${p.what}` : ""}</figcaption></figure>`).join("");
    return `<h3>${bn.phone.apps.camera}</h3><button class="btn-line" ${this.on(() => this.startCamera())}>${bn.phone.takePhoto}</button>
      <div class="gallery">${shots || `<p class="none">${bn.phone.noPhotos}</p>`}</div>`;
  }

  private startCamera(): void {
    this.opened = false;
    this.el.classList.add("hidden");
    this.cameraEl.classList.remove("hidden");
    this.shooting = true;
    this.host.input.enabled = true;
    this.host.input.requestLock();
  }

  private endCamera(): void {
    this.shooting = false;
    this.cameraEl.classList.add("hidden");
    this.open();
  }

  private async takePhoto(): Promise<void> {
    if (!this.host.input.locked) return;
    const flash = this.cameraEl.querySelector(".cam-flash") as HTMLElement;
    flash.classList.remove("go");
    void flash.offsetWidth;
    flash.classList.add("go");
    this.host.audio.thud(0.2);
    const here = this.host.here();
    const what = this.host.subjects();
    const data = await this.host.snapshot();
    this.photos.push({ data, place: here.place, hour: here.hour, what });
    if (this.photos.length > MAX_PHOTOS) this.photos.shift();
    this.host.savePhotos(this.photos);
    this.toast(bn.phone.photoSaved, 2.4);
  }

  // ---------------------------------------------------------------- jobs

  private jobsScreen(): string {
    const open = this.data.jobs.filter((j) => !j.done), done = this.data.jobs.filter((j) => j.done);
    const row = (j: PhoneData["jobs"][number]): string => `<div class="job ${j.done ? "done" : ""}"><b>${j.title}</b><small>${contactOf(j.from).name}</small><p>${j.text}</p></div>`;
    return `<h3>${bn.phone.apps.jobs}</h3>${open.map(row).join("") || `<p class="none">${bn.phone.noJobs}</p>`}${done.length ? `<h4>${bn.phone.jobsDone}</h4>${done.map(row).join("")}` : ""}`;
  }

  // ---------------------------------------------------------------- over time

  toast(text: string, seconds: number): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add("on");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("on"), seconds * 1000);
  }

  private toastTimer = 0;

  update(dt: number): void {
    this.clockTimer -= dt;
    if (this.opened && this.clockTimer <= 0) {
      this.clockTimer = 1;
      this.renderTop();
    }
    if (!this.seen) {
      this.seen = true;
      if (!this.data.welcomed) {
        this.data.welcomed = true;
        this.receive("chacha", bn.phone.firstText);
        this.host.save();
      }
    }
    // Someone on the line.
    const c = this.call;
    if (c) {
      c.time += dt;
      const clock = document.getElementById("callTime");
      if (clock) {
        const s = Math.floor(c.time);
        clock.textContent = `${bnNum(Math.floor(s / 60).toString().padStart(2, "0"))}:${bnNum((s % 60).toString().padStart(2, "0"))}`;
      }
      c.next -= dt;
      if (c.next <= 0) {
        if (c.at >= c.lines.length) {
          this.hangUp();
        } else {
          const text = c.lines[c.at++];
          // Odd lines are them, even lines the hero's own.
          const hero = c.at % 2 === 0;
          this.host.audio.speak(text, voiceOf(hero ? "hero_mango" : c.contact.voice), false);
          const said = document.getElementById("callSaid");
          if (said) said.innerHTML = `<small>${hero ? bn.you : c.contact.name}</small>${text}`;
          c.next = lineSeconds(text) + 0.35;
        }
      }
    }
    // Ringing.
    const r = this.ringing;
    if (r) {
      r.left -= dt;
      this.ringTimer -= dt;
      if (this.ringTimer <= 0) {
        this.ringTimer = 2.4;
        this.host.audio.ring();
        this.host.hud.prompt(bn.phone.answer);
      }
      if (r.left <= 0) {
        this.ringing = null;
        this.data.missed++;
        this.data.calls.push({ who: r.contact.id, kind: "missed", hour: this.host.here().hour });
        this.host.hud.prompt(null);
        this.host.save();
      }
    }
    // Arriving somewhere.
    const nav = this.navTo;
    if (nav) {
      this.navTimer -= dt;
      if (this.navTimer <= 0) {
        this.navTimer = 2.5;
        const { x, z } = this.host.here();
        if (Math.hypot(nav.x - x, nav.z - z) < 22) {
          this.navTo = null;
          this.host.hud.setWaypoint(null);
          this.host.hud.setRoute(null);
          this.toast(bn.phone.navArrived(nav.label), 3.4);
        } else this.host.hud.setRoute(this.host.route(nav.x, nav.z));
      }
    }
    // Now and then the phone has something to say for itself.
    this.nudge -= dt;
    if (this.nudge <= 0) {
      this.nudge = NUDGE_EVERY[0] + Math.random() * (NUDGE_EVERY[1] - NUDGE_EVERY[0]);
      const roll = Math.random();
      if (roll < 0.6) {
        const m = bn.phone.texts[Math.floor(Math.random() * bn.phone.texts.length)];
        this.receive(m.who, m.text);
      } else {
        const list = CONTACTS.filter((q) => q.incoming);
        const who = list[Math.floor(Math.random() * list.length)];
        this.ring(who, who.incoming![Math.floor(Math.random() * who.incoming!.length)]);
      }
    }
  }
}

function contactOf(id: string): Contact {
  return CONTACTS.find((c) => c.id === id) ?? CONTACTS[0];
}

function clip(t: string): string {
  return t.length > 34 ? `${t.slice(0, 34)}…` : t;
}

function timeWords(h: number): string {
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${bnNum(hh.toString().padStart(2, "0"))}:${bnNum(mm.toString().padStart(2, "0"))}`;
}

export { freshPhone };

const svg = (d: string): string => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
const ICONS: Record<string, string> = {
  call: svg("M6 3l3 5-2 2a12 12 0 0 0 7 7l2-2 5 3-1 3c-1 1-3 1-5 1C9 22 2 15 2 8c0-2 0-3 1-4z"),
  msg: svg("M3 4h18v13H8l-5 4z"),
  people: svg("M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm-8 9c0-4 4-7 8-7s8 3 8 7z"),
  map: svg("M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"),
  money: svg("M3 6h18v12H3zm9 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"),
  ride: svg("M5 16l2-7h10l2 7v4h-3v-2H8v2H5zm2.5-2a1.5 1.5 0 1 0 0-.01zm9 0a1.5 1.5 0 1 0 0-.01zM8 8l1-3h6l1 3z"),
  camera: svg("M4 7h4l2-3h4l2 3h4v13H4zm8 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"),
  jobs: svg("M9 3h6v3h6v15H3V6h6zm2 2v1h2V5z"),
};
