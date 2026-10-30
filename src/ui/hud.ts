import type { Settings, TimeName, QualityName } from "../app/settings";
import { bn, bnClock, bnNum } from "../localization/bn";
import type { CityLayout } from "../world/cityLayout";
import { roadWidth } from "../world/cityLayout";

export interface HudCallbacks {
  onPlay: () => void;
  onResume: () => void;
  onRespawn: () => void;
  onQuality: (q: QualityName) => void;
  onTime: (t: TimeName) => void;
  onSensitivity: (v: number) => void;
  onVolume: (v: number) => void;
  onFps: (on: boolean) => void;
  onVoice: (on: boolean) => void;
  onChoose: (id: string, variant: string) => void;
}

/** Everything drawn over the 3D view. All DOM, so Bangla text is shaped by the browser. */
export class Hud {
  private loading: HTMLElement;
  private title: HTMLElement;
  private pauseEl: HTMLElement;
  private hud: HTMLElement;
  private bar: HTMLElement;
  private statusEl: HTMLElement;
  private tipEl: HTMLElement;
  private promptEl: HTMLElement;
  private subtitleEl: HTMLElement;
  private toastEl: HTMLElement;
  private roadEl: HTMLElement;
  private areaEl: HTMLElement;
  private clockEl: HTMLElement;
  private speedo: HTMLElement;
  private speedVal: HTMLElement;
  private vehName: HTMLElement;
  private debugEl: HTMLElement;
  private lookHint: HTMLElement;
  private northDot: HTMLElement;
  private mapCtx: CanvasRenderingContext2D;
  private mapBase: HTMLCanvasElement | null = null;
  private subtitleTimer = 0;
  private toastTimer = 0;
  private lastArea = "";
  private lastRoad = "";
  private lastPrompt: string | null = "";
  private tipTimer: number | null = null;
  private mapScale = 1;
  private chooserEl!: HTMLElement;
  private rick!: SVGElement;
  private gpuHintEl!: HTMLElement;
  private chooserGrid!: HTMLElement;
  onChooserClosed: (() => void) | null = null;

  constructor(root: HTMLElement, private settings: Settings, private cb: HudCallbacks) {
    root.innerHTML = `
      <div class="hud hidden" id="hud">
        <div class="mapwrap"><canvas id="minimap" width="392" height="392"></canvas></div>
        <div class="north"><span id="north">উ</span></div>
        <div class="place"><div class="road" id="road"></div><div class="area" id="area"></div></div>
        <div class="clock" id="clock"></div>
        <div class="area-toast" id="toast"></div>
        <div class="speedo" id="speedo"><div class="veh" id="vehName"></div><div class="val" id="speedVal">০</div><div class="unit">${bn.speedUnit}</div></div>
        <div class="prompt" id="prompt"></div>
        <div class="subtitle" id="subtitle"></div>
        <div class="lookhint" id="lookHint">${bn.clickToLook}</div>
        <div class="debug" id="debug"></div>
      </div>
      <div class="screen title hidden" id="title">
        <h1>${bn.title}</h1>
        <div class="where">${bn.subtitle} · ${bn.build}</div>
        <button class="btn" id="play">${bn.play}</button>
        <div class="controls">${bn.controls.map(([k, v]) => `<b>${k}</b><span>${v}</span>`).join("")}</div>
      </div>
      <div class="screen pause hidden" id="pause">
        <h2>${bn.paused}</h2>
        <div class="rows">
          <div class="row"><label>${bn.graphics}</label><div class="seg" id="qualitySeg"></div></div>
          <div class="row"><label>${bn.time}</label><div class="seg" id="timeSeg"></div></div>
          <div class="row"><label>${bn.sensitivity}</label><input type="range" id="sens" min="0.3" max="2.5" step="0.05" /></div>
          <div class="row"><label>${bn.volume}</label><input type="range" id="vol" min="0" max="1" step="0.02" /></div>
          <div class="row"><label>${bn.voice}</label><div class="seg" id="voiceSeg"></div></div>
          <div class="row"><label>${bn.fps}</label><div class="seg" id="fpsSeg"></div></div>
        </div>
        <div class="actions">
          <button class="btn" id="resume">${bn.resume}</button>
          <button class="btn ghost" id="respawn">${bn.respawn}</button>
        </div>
      </div>
      <div class="screen chooser hidden" id="chooser">
        <h2>${bn.chooserTitle}</h2>
        <p class="chooser-hint">${bn.chooserHint}</p>
        <div class="chooser-grid" id="chooserGrid"></div>
        <div class="actions"><button class="btn ghost" id="chooserClose">${bn.close}</button></div>
      </div>
      <div class="gpu-hint hidden" id="gpuHint">${bn.gpuHint}</div>
      <div class="screen loading" id="loading">
        <div class="brand">${bn.title}</div>
        <div class="brand-sub">${bn.subtitle}</div>
        <div class="bar"><i id="bar"></i><svg id="rick" class="rick" viewBox="0 0 64 40" aria-hidden="true"><path d="M21 24h22l6-13c-4-6-16-9-24-6l-6 3z" fill="#e0263c"/><path d="M15 26h34l3 3H15z" fill="#f6b93b"/><path d="M45 25l9-12h5" fill="none" stroke="#f7f3e8" stroke-width="2.4" stroke-linecap="round"/><g fill="none" stroke="#f7f3e8" stroke-width="2.6"><circle class="w" cx="15" cy="30" r="8"/><circle class="w" cx="51" cy="30" r="8"/></g><path d="M15 22v16M7 30h16M51 22v16M43 30h16" stroke="#f7f3e8" stroke-width="1"/></svg></div>
        <div class="status" id="status">${bn.loading}</div>
        <div class="tip" id="tip">${bn.tips[0]}</div>
      </div>`;
    const $ = <T extends HTMLElement>(id: string): T => root.querySelector(`#${id}`) as T;
    this.hud = $("hud");
    this.loading = $("loading");
    this.title = $("title");
    this.pauseEl = $("pause");
    this.bar = $("bar");
    this.rick = root.querySelector("#rick") as unknown as SVGElement;
    this.statusEl = $("status");
    this.tipEl = $("tip");
    this.promptEl = $("prompt");
    this.subtitleEl = $("subtitle");
    this.toastEl = $("toast");
    this.roadEl = $("road");
    this.areaEl = $("area");
    this.clockEl = $("clock");
    this.speedo = $("speedo");
    this.speedVal = $("speedVal");
    this.vehName = $("vehName");
    this.debugEl = $("debug");
    this.lookHint = $("lookHint");
    this.northDot = $("north");
    this.mapCtx = $<HTMLCanvasElement>("minimap").getContext("2d")!;

    $("play").addEventListener("click", () => cb.onPlay());
    $("resume").addEventListener("click", () => cb.onResume());
    $("respawn").addEventListener("click", () => cb.onRespawn());

    this.segment($("qualitySeg"), ["auto", "low", "medium", "high", "ultra"], (k) => bn.quality[k as QualityName], settings.quality, (k) => cb.onQuality(k as QualityName));
    this.segment($("timeSeg"), ["morning", "noon", "golden", "dusk", "night"], (k) => bn.times[k as TimeName], settings.time, (k) => cb.onTime(k as TimeName));
    this.segment($("voiceSeg"), ["off", "on"], (k) => (k === "on" ? bn.on : bn.off), settings.voice ? "on" : "off", (k) => cb.onVoice(k === "on"));
    this.segment($("fpsSeg"), ["off", "on"], (k) => (k === "on" ? bn.on : bn.off), settings.showFps ? "on" : "off", (k) => cb.onFps(k === "on"));
    const sens = $<HTMLInputElement>("sens");
    sens.value = String(settings.sensitivity);
    sens.addEventListener("input", () => cb.onSensitivity(Number(sens.value)));
    const vol = $<HTMLInputElement>("vol");
    vol.value = String(settings.volume);
    vol.addEventListener("input", () => cb.onVolume(Number(vol.value)));
    this.debugEl.classList.toggle("on", settings.showFps);
    this.chooserEl = $("chooser");
    this.gpuHintEl = $("gpuHint");
    this.chooserGrid = $("chooserGrid");
    $("chooserClose").addEventListener("click", () => this.showChooser(false));
    this.chooserGrid.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b || !b.dataset.id) return;
      cb.onChoose(b.dataset.id, b.dataset.variant ?? "default");
    });

    let tip = 0;
    this.tipTimer = window.setInterval(() => {
      tip = (tip + 1) % bn.tips.length;
      this.tipEl.textContent = bn.tips[tip];
    }, 3500);
  }

  private segment(el: HTMLElement, keys: string[], label: (k: string) => string, current: string, onPick: (k: string) => void): void {
    el.innerHTML = keys.map((k) => `<button data-k="${k}" class="${k === current ? "on" : ""}">${label(k)}</button>`).join("");
    el.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      el.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      onPick(b.dataset.k!);
    });
  }

  setTimeSelection(name: TimeName): void {
    const seg = this.pauseEl.querySelector("#timeSeg");
    seg?.querySelectorAll("button").forEach((b) => b.classList.toggle("on", (b as HTMLElement).dataset.k === name));
  }

  /** Lists every vehicle with its paint jobs. */
  buildChooser(items: { id: string; name: string; variants: { key: string; color: string; label: string }[] }[]): void {
    this.chooserGrid.innerHTML = items
      .map(
        (v) => `<div class="chooser-card"><div class="chooser-name">${v.name}</div><div class="chooser-paints">${v.variants
          .map((p) => `<button data-id="${v.id}" data-variant="${p.key}" title="${p.label}" style="--paint:${p.color}"><i></i><span>${p.label}</span></button>`)
          .join("")}</div></div>`,
      )
      .join("");
  }

  showChooser(on: boolean): void {
    this.chooserEl.classList.toggle("hidden", !on);
    this.hud.classList.toggle("hidden", on);
    if (!on) this.onChooserClosed?.();
  }

  get chooserOpen(): boolean {
    return !this.chooserEl.classList.contains("hidden");
  }

  showGpuHint(on: boolean): void {
    this.gpuHintEl.classList.toggle("hidden", !on);
  }

  progress(fraction: number, text: string): void {
    this.bar.style.width = `${Math.round(fraction * 100)}%`;
    this.rick.style.left = `${Math.round(fraction * 100)}%`;
    this.statusEl.textContent = `${text} · ${bnNum(Math.round(fraction * 100))}%`;
  }

  showTitle(): void {
    this.loading.classList.add("hidden");
    this.title.classList.remove("hidden");
    if (this.tipTimer !== null) clearInterval(this.tipTimer);
  }

  showGame(): void {
    this.title.classList.add("hidden");
    this.hud.classList.remove("hidden");
  }

  setPaused(on: boolean): void {
    this.pauseEl.classList.toggle("hidden", !on);
    this.hud.classList.toggle("hidden", on);
  }

  prompt(html: string | null): void {
    if (html === this.lastPrompt) return;
    this.lastPrompt = html;
    this.promptEl.classList.toggle("on", !!html);
    if (html) this.promptEl.innerHTML = html;
  }

  say(text: string, seconds = 3, _speak = false): void {
    this.subtitleEl.textContent = text;
    this.subtitleEl.classList.add("on");
    this.subtitleTimer = seconds;
  }

  lookHintVisible(on: boolean): void {
    this.lookHint.classList.toggle("on", on);
  }

  setDebug(on: boolean): void {
    this.debugEl.classList.toggle("on", on);
  }

  debug(text: string): void {
    this.debugEl.textContent = text;
  }

  update(dt: number, road: string | null, area: string, hour: number, speedMs: number | null, vehicleName: string | null): void {
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.subtitleEl.classList.remove("on");
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove("on");
    }
    if (area !== this.lastArea) {
      this.lastArea = area;
      this.areaEl.textContent = area;
      this.toastEl.textContent = area;
      this.toastEl.classList.add("on");
      this.toastTimer = 3.2;
    }
    const roadText = road ?? "";
    if (roadText !== this.lastRoad) {
      this.lastRoad = roadText;
      this.roadEl.textContent = roadText;
    }
    this.clockEl.textContent = bnClock(hour);
    const inVehicle = speedMs !== null;
    this.speedo.classList.toggle("on", inVehicle);
    if (inVehicle) {
      this.speedVal.textContent = bnNum(Math.round(Math.abs(speedMs!) * 3.6));
      if (vehicleName && this.vehName.textContent !== vehicleName) this.vehName.textContent = vehicleName;
    }
  }

  /** Pre-draws the road map once; the minimap then just pans and rotates it. */
  buildMap(layout: CityLayout): void {
    const size = 1024;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d")!;
    const half = layout.data.boundary + 60;
    const k = size / (half * 2);
    this.mapScale = k;
    const X = (x: number): number => (x + half) * k;
    const Y = (z: number): number => (half - z) * k;
    ctx.fillStyle = "#1c2422";
    ctx.fillRect(0, 0, size, size);
    for (const b of layout.blocks) {
      ctx.fillStyle = b.kind === "park" ? "#2f4b2d" : b.kind === "terminal" ? "#37383a" : b.kind === "market" ? "#4a3b2c" : "#2a312f";
      ctx.fillRect(X(b.x0), Y(b.z1), (b.x1 - b.x0) * k, (b.z1 - b.z0) * k);
    }
    for (const r of layout.data.roads) {
      const w = roadWidth(r) * k;
      ctx.fillStyle = r.cls === "main" ? "#d8c99a" : r.cls === "secondary" ? "#a8a59a" : "#7c7a72";
      if (r.axis === "v") ctx.fillRect(X(r.at) - w / 2, Y(r.to), w, (r.to - r.from) * k);
      else ctx.fillRect(X(r.from), Y(r.at) - w / 2, (r.to - r.from) * k, w);
    }
    const { plaza, metro } = layout.data;
    ctx.fillStyle = "#d8c99a";
    ctx.beginPath();
    ctx.arc(X(plaza.x), Y(plaza.z), plaza.radius * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3d6b3b";
    ctx.beginPath();
    ctx.arc(X(plaza.x), Y(plaza.z), plaza.islandRadius * k, 0, Math.PI * 2);
    ctx.fill();
    if (metro) {
      ctx.strokeStyle = "#e0263c";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(X(metro.x), Y(metro.toZ));
      ctx.lineTo(X(metro.x), Y(metro.fromZ));
      ctx.stroke();
      ctx.fillStyle = "#e0263c";
      ctx.fillRect(X(metro.x) - 5, Y(metro.stationZ + 70), 10, 140 * k);
    }
    this.mapBase = c;
  }

  /** Rotating minimap: the view direction is always up. */
  updateMap(x: number, z: number, yaw: number, marks: { x: number; z: number; color: string }[]): void {
    const ctx = this.mapCtx;
    const base = this.mapBase;
    if (!base) return;
    const size = ctx.canvas.width;
    const half = size / 2;
    const zoom = 2.2;
    const k = this.mapScale;
    const baseHalf = base.width / 2;
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.translate(half, half);
    ctx.rotate(-yaw);
    ctx.scale(zoom, zoom);
    ctx.translate(-(baseHalf + x * k), -(baseHalf - z * k));
    ctx.drawImage(base, 0, 0);
    for (const m of marks) {
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(baseHalf + m.x * k, baseHalf - m.z * k, 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // Player arrow is fixed at the centre.
    ctx.fillStyle = "#f6b93b";
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(half, half - 15);
    ctx.lineTo(half + 10, half + 11);
    ctx.lineTo(half, half + 5);
    ctx.lineTo(half - 10, half + 11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // North marker runs around the rim.
    const r = 88;
    this.northDot.style.transform = `translate(${Math.sin(-yaw) * r}px, ${-Math.cos(-yaw) * r}px)`;
  }
}
