import { L, T, bn, bnNum } from "../localization/bn";

export interface BagRow {
  key: string;
  name: string;
  count: number;
  note: string;
  /** What the button says, if it can be used. */
  action: string | null;
}

/** A piece of a message or letter. One with a `flag` is something wrong, and says why when tapped. */
export interface InspectPart {
  text: readonly [string, string];
  flag?: readonly [string, string];
}

export interface JournalTab {
  title: string;
  html: string;
}

const words = {
  health: L("শরীর", "Health"),
  breath: L("দম", "Breath"),
  bagTitle: L("ব্যাগ", "Bag"),
  bagEmpty: L("ব্যাগ খালি। দোকান থেকে কিছু কিনলে এখানে থাকবে।", "Your bag is empty. Whatever you buy ends up here."),
  close: L("বন্ধ করুন", "Close"),
  next: L("পরের পাতা", "Next page"),
  prev: L("আগের পাতা", "Previous page"),
  page: (a: string, b: string) => L(`পাতা ${a} / ${b}`, `Page ${a} of ${b}`),
};

/** The parts of the screen that belong to the game rather than the street: how the hero's doing,
 *  what they're meant to be doing, and anything that opens to be read or used. */
export class Panels {
  private healthBar: HTMLElement;
  private breathBar: HTMLElement;
  private vitals: HTMLElement;
  private hurtEl: HTMLElement;
  private objective: HTMLElement;
  private objectiveTitle: HTMLElement;
  private objectiveText: HTMLElement;
  private timerEl: HTMLElement;
  private bannerEl: HTMLElement;
  private barsEl: HTMLElement;
  private meterEl: HTMLElement;
  private meterFill: HTMLElement;
  private toasts: HTMLElement;
  private floats: HTMLElement;
  private overlay: HTMLElement;
  private overlayBody: HTMLElement;
  private overlayTitle: HTMLElement;
  private overlayFoot: HTMLElement;
  private starsEl: HTMLElement;
  private bannerTimer = 0;
  private flashHurt = 0;
  private shownHealth = -1;
  private shownBreath = -1;
  /** Runs when an overlay is shut, however it was shut. */
  onOverlayClosed: (() => void) | null = null;
  private overlayOn = false;

  constructor() {
    const hud = document.getElementById("hud")!;
    const inHud = document.createElement("div");
    inHud.innerHTML = `
      <div class="vitals" id="vitals">
        <div class="vital"><small>${words.health}</small><div class="vbar health"><i id="healthBar"></i></div></div>
        <div class="vital"><small>${words.breath}</small><div class="vbar breath"><i id="breathBar"></i></div></div>
      </div>
      <div class="objective" id="objective"><small id="objectiveTitle"></small><b id="objectiveText"></b></div>
      <div class="mtimer" id="mtimer"></div>
      <div class="stars" id="stars"></div>
      <div class="signal" id="signalMeter"><small id="signalLabel"></small><div class="vbar signal-bar"><i id="signalFill"></i></div></div>
      <div class="hint-card" id="hintCard"></div>
      <div class="toasts" id="toasts"></div>
      <div class="floats" id="floats"></div>`;
    while (inHud.firstChild) hud.appendChild(inHud.firstChild);
    const root = document.getElementById("ui")!;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="hurt-veil" id="hurtVeil"></div>
      <div class="cine-bars" id="cineBars"><i></i><i></i></div>
      <div class="banner" id="banner"></div>
      <div class="screen panel-screen hidden" id="overlay">
        <div class="panel">
          <header><h2 id="overlayTitle"></h2><button class="x" id="overlayX">✕</button></header>
          <div class="panel-body" id="overlayBody"></div>
          <footer id="overlayFoot"></footer>
        </div>
      </div>`;
    while (wrap.firstChild) root.appendChild(wrap.firstChild);
    const $ = (id: string): HTMLElement => document.getElementById(id)!;
    this.vitals = $("vitals");
    this.healthBar = $("healthBar");
    this.breathBar = $("breathBar");
    this.hurtEl = $("hurtVeil");
    this.objective = $("objective");
    this.objectiveTitle = $("objectiveTitle");
    this.objectiveText = $("objectiveText");
    this.timerEl = $("mtimer");
    this.starsEl = $("stars");
    this.bannerEl = $("banner");
    this.barsEl = $("cineBars");
    this.meterEl = $("signalMeter");
    this.meterFill = $("signalFill");
    this.toasts = $("toasts");
    this.floats = $("floats");
    this.overlay = $("overlay");
    this.overlayBody = $("overlayBody");
    this.overlayTitle = $("overlayTitle");
    this.overlayFoot = $("overlayFoot");
    $("overlayX").addEventListener("click", () => this.closeOverlay());
    this.setVitals(100, 100);
  }

  // ---------------------------------------------------------------- how the hero's doing

  setVitals(health: number, breath: number): void {
    const h = Math.round(health), b = Math.round(breath);
    if (h !== this.shownHealth) {
      this.healthBar.style.width = `${h}%`;
      this.healthBar.classList.toggle("low", h < 30);
      this.shownHealth = h;
      // Nothing gory: the picture just goes dim and tired round the edges.
      this.hurtEl.style.opacity = String(h < 40 ? (40 - h) / 55 : 0);
    }
    if (b !== this.shownBreath) {
      this.breathBar.style.width = `${b}%`;
      this.breathBar.classList.toggle("low", b < 26);
      this.shownBreath = b;
    }
  }

  /** The screen dips for a moment on a hard knock. */
  knock(): void {
    this.flashHurt = 1;
    this.vitals.classList.remove("hit");
    void this.vitals.offsetWidth;
    this.vitals.classList.add("hit");
  }

  /** Money going out or coming in, floating up beside the purse. */
  money(amount: number): void {
    const el = document.createElement("div");
    el.className = `float ${amount < 0 ? "out" : "in"}`;
    el.textContent = `${amount < 0 ? "−" : "+"}${bn.money(Math.abs(amount))}`;
    this.floats.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  toast(text: string, kind: "plain" | "good" | "bad" = "plain"): void {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toasts.appendChild(el);
    setTimeout(() => el.classList.add("on"), 20);
    setTimeout(() => el.classList.remove("on"), 4200);
    setTimeout(() => el.remove(), 4700);
    while (this.toasts.children.length > 4) this.toasts.firstChild!.remove();
  }

  // ---------------------------------------------------------------- what they're meant to be doing

  setObjective(title: string | null, text = ""): void {
    this.objective.classList.toggle("on", !!title || !!text);
    this.objectiveTitle.textContent = title ?? "";
    this.objectiveText.textContent = text;
  }

  setTimer(seconds: number | null): void {
    this.timerEl.classList.toggle("on", seconds !== null);
    if (seconds === null) return;
    const s = Math.max(0, Math.ceil(seconds));
    this.timerEl.textContent = `${bnNum(Math.floor(s / 60))}:${bnNum(String(s % 60).padStart(2, "0"))}`;
    this.timerEl.classList.toggle("urgent", s <= 15);
  }

  /** A helpful word in the corner for a little while. */
  hint(html: string, seconds: number): void {
    const el = document.getElementById("hintCard")!;
    el.innerHTML = html;
    el.classList.add("on");
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => el.classList.remove("on"), seconds * 1000);
  }

  private hintTimer = 0;

  /** Attention from the law, as a row of lamps. */
  setStars(n: number): void {
    this.starsEl.innerHTML = n > 0 ? "◆".repeat(n) : "";
  }

  banner(head: string, sub = "", seconds = 4): void {
    this.bannerEl.innerHTML = `<b>${head}</b>${sub ? `<small>${sub}</small>` : ""}`;
    this.bannerEl.classList.add("on");
    this.bannerTimer = seconds;
  }

  setCinema(on: boolean): void {
    this.barsEl.classList.toggle("on", on);
  }

  /** A hot-and-cold meter, for looking for a signal. Null puts it away. */
  setSignal(strength: number | null, label = ""): void {
    this.meterEl.classList.toggle("on", strength !== null);
    if (strength === null) return;
    (this.meterEl.querySelector("#signalLabel") as HTMLElement).textContent = label;
    this.meterFill.style.width = `${Math.round(Math.max(0, Math.min(1, strength)) * 100)}%`;
  }

  update(dt: number): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.classList.remove("on");
    }
  }

  // ---------------------------------------------------------------- things that open

  get overlayOpen(): boolean {
    return this.overlayOn;
  }

  private show(title: string, body: string, foot = ""): void {
    this.overlayTitle.textContent = title;
    this.overlayBody.innerHTML = body;
    this.overlayBody.scrollTop = 0;
    this.overlayFoot.innerHTML = `${foot}<button class="btn ghost" data-shut>${words.close}</button>`;
    this.overlayFoot.querySelector("[data-shut]")!.addEventListener("click", () => this.closeOverlay());
    this.overlay.classList.remove("hidden");
    this.overlayOn = true;
  }

  closeOverlay(): void {
    if (!this.overlayOn) return;
    this.overlayOn = false;
    this.overlay.classList.add("hidden");
    this.overlayBody.onclick = null;
    this.onOverlayClosed?.();
  }

  showBag(rows: BagRow[], use: (key: string) => void): void {
    const body = rows.length
      ? `<div class="bag-list">${rows.map((r) => `<div class="bag-row"><div><b>${r.name}${r.count > 1 ? ` × ${bnNum(r.count)}` : ""}</b><small>${r.note}</small></div>${r.action ? `<button class="mini" data-use="${r.key}">${r.action}</button>` : ""}</div>`).join("")}</div>`
      : `<p class="none">${words.bagEmpty}</p>`;
    this.show(words.bagTitle, body);
    this.overlayBody.onclick = (e) => {
      const key = (e.target as HTMLElement).closest("button")?.dataset.use;
      if (key) use(key);
    };
  }

  /** A book, a paper or a notebook. `finished` runs once on reaching the last page. */
  showReader(title: string, pages: string[], finished?: () => void): void {
    let at = 0;
    const paint = (): void => {
      this.show(title, `<article class="reader">${pages[at]}</article><p class="reader-page">${words.page(bnNum(at + 1), bnNum(pages.length))}</p>`,
        `<button class="btn ghost" data-prev ${at === 0 ? "disabled" : ""}>${words.prev}</button><button class="btn" data-next ${at >= pages.length - 1 ? "disabled" : ""}>${words.next}</button>`);
      this.overlayFoot.querySelector("[data-prev]")!.addEventListener("click", () => {
        at = Math.max(0, at - 1);
        paint();
      });
      this.overlayFoot.querySelector("[data-next]")!.addEventListener("click", () => {
        at = Math.min(pages.length - 1, at + 1);
        paint();
      });
      if (at === pages.length - 1) {
        finished?.();
        finished = undefined;
      }
    };
    paint();
  }

  /** A message to go through: tap everything that's wrong with it. All found, and it can be closed. */
  showInspect(title: string, parts: InspectPart[], hint: string, done: () => void): void {
    const total = parts.filter((p) => p.flag).length;
    let found = 0;
    this.show(title, `<p class="inspect-hint">${hint}</p><div class="inspect">${parts.map((p, i) => `<span class="${p.flag ? "bad" : "ok"}" data-i="${i}">${T(p.text)}</span>`).join("")}</div><div class="inspect-why" id="inspectWhy"></div>`,
      `<span class="inspect-count" id="inspectCount">${bnNum(0)} / ${bnNum(total)}</span>`);
    const finish = (): void => {
      this.onOverlayClosed?.();
      done();
    };
    const shut = this.overlayFoot.querySelector("[data-shut]") as HTMLElement;
    shut.style.display = "none";
    this.overlayBody.onclick = (e) => {
      const el = (e.target as HTMLElement).closest("[data-i]") as HTMLElement | null;
      if (!el) return;
      const part = parts[Number(el.dataset.i)];
      const why = document.getElementById("inspectWhy")!;
      if (!part.flag) {
        el.classList.add("nope");
        return;
      }
      if (el.classList.contains("found")) return;
      el.classList.add("found");
      found++;
      why.insertAdjacentHTML("beforeend", `<p>• ${T(part.flag)}</p>`);
      document.getElementById("inspectCount")!.textContent = `${bnNum(found)} / ${bnNum(total)}`;
      if (found >= total) {
        shut.style.display = "";
        shut.textContent = L("ঠিক আছে", "OK");
        this.overlayOn = true;
        const old = this.onOverlayClosed;
        shut.onclick = () => {
          this.onOverlayClosed = old;
          finish();
        };
      }
    };
  }

  /** The thank-yous at the end, over the game. */
  showCredits(lines: readonly (readonly [string, string])[]): void {
    this.show(L("ধন্যবাদ", "Thank you"), `<article class="reader">${lines.map((l) => `<p>${T(l)}</p>`).join("")}</article>`);
    this.overlayBody.onclick = null;
  }

  /** Several pages of information under tabs: missions, friends, how it's going. */
  showTabs(title: string, tabs: JournalTab[], onClick?: (el: HTMLElement) => void): void {
    const paint = (at: number): void => {
      this.show(title, `<nav class="tabs inner">${tabs.map((t, i) => `<button data-tab="${i}" class="${i === at ? "on" : ""}">${t.title}</button>`).join("")}</nav><div class="rows-page">${tabs[at].html}</div>`);
      this.overlayBody.onclick = (e) => {
        const t = e.target as HTMLElement;
        const tab = t.closest("[data-tab]") as HTMLElement | null;
        if (tab) {
          paint(Number(tab.dataset.tab));
          return;
        }
        const act = t.closest("[data-do]") as HTMLElement | null;
        if (act) onClick?.(act);
      };
    };
    paint(0);
  }
}
