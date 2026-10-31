import type { DayPace, Settings, TimeName, QualityName } from "../app/settings";
import { Lang, bn, bnClock, bnNum, lang, N } from "../localization/bn";
import { HEROES } from "../app/heroes";
import type { CityLayout } from "../world/cityLayout";
import { MapExtras, paintDhaka, paintDistrict } from "./mapArt";

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
  onCrowd: (v: number) => void;
  onTraffic: (v: number) => void;
  onDayPace: (p: DayPace) => void;
  onSound: (kind: "voice" | "ambience" | "vehicles" | "effects", v: number) => void;
  onMute: (on: boolean) => void;
  onSubtitles: (on: boolean) => void;
  onVoiceKind: (k: "pack" | "browser") => void;
  onVoiceTest: () => void;
  onQuit: () => void;
  onNewGame: (region: string, slot: number, hero: string) => void;
  onLoadSlot: (slot: number) => void;
  onSaveSlot: (slot: number) => void;
  onDeleteSlot: (slot: number) => void;
  slotsInfo: () => (SlotInfo | null)[];
  onSetting: (key: string, value: boolean | number | string) => void;
  /** Whether sound is getting out and how loud it is, for the meter in the menu. */
  soundInfo: () => { status: "none" | "muted" | "blocked" | "running"; level: number };
  onLanguage: (l: Lang) => void;
}

/** What a saved game shows in the list. */
export interface SlotInfo {
  place: string;
  taka: number;
  playSeconds: number;
  savedAt: number;
}

/** Anything a line of speech or a marker can hang above. Live objects work directly. */
export interface Anchor {
  x: number;
  y: number;
  z: number;
}

/** Finds where a world point falls on screen, in CSS pixels. False when it's behind the camera. */
export type Project = (x: number, y: number, z: number, out: { x: number; y: number }) => boolean;

export interface Choice {
  text: string;
  /** Already asked; still available, but shown fainter. */
  dim?: boolean;
}

interface Bubble {
  el: HTMLElement;
  label: HTMLElement;
  text: HTMLElement;
  anchor: Anchor | null;
  top: number;
  time: number;
  x: number;
  y: number;
}

const BUBBLES = 5;

/** Things shown on the big map. */
export interface MapPoint {
  x: number;
  z: number;
  kind: "bus" | "tea" | "police";
}

export interface MapPlace {
  x: number;
  z: number;
  label: string;
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
  private bigSizeEl!: HTMLElement;
  private tipTimer: number | null = null;
  private mapScale = 1;
  private chooserEl!: HTMLElement;
  private rick!: SVGElement;
  private gpuHintEl!: HTMLElement;
  private chooserGrid!: HTMLElement;
  onChooserClosed: (() => void) | null = null;
  private bigMapEl!: HTMLElement;
  private bigCanvas!: HTMLCanvasElement;
  private bigBase: HTMLCanvasElement | null = null;
  private bigHalf = 500;
  private bigScale = 1;
  private layout: CityLayout | null = null;
  private points: MapPoint[] = [];
  private places: MapPlace[] = [];
  private view = { x: 0, z: 0, zoom: 1, fit: 1 };
  private mapNow = { x: 0, z: 0, yaw: 0, marks: [] as { x: number; z: number }[] };
  private bubbles: Bubble[] = [];
  private showWords = true;
  private spot = { x: 0, y: 0 };
  private focusEl!: HTMLElement;
  private focusAnchor: Anchor | null = null;
  private choicesEl!: HTMLElement;
  private choiceListEl!: HTMLElement;
  private choiceCount = 0;
  private choiceIndex = 0;
  private choiceAge = 0;
  private clickedChoice = -1;
  private activityEl!: HTMLElement;
  private activityTitle!: HTMLElement;
  private activityFill!: HTMLElement;
  private activityTime!: HTMLElement;
  private infoEl!: HTMLElement;
  private infoTimer = 0;
  private waypointEl!: HTMLElement;
  private waypointText!: HTMLElement;
  private waypoint: { x: number; z: number; label: string } | null = null;

  constructor(root: HTMLElement, private settings: Settings, private cb: HudCallbacks) {
    root.innerHTML = `
      <div class="fade" id="fade"></div>
      <div class="hud hidden" id="hud">
        <div class="mapwrap"><canvas id="minimap" width="392" height="392"></canvas></div>
        <div class="map-key"><kbd>M</kbd></div>
        <div class="north"><span id="north">${N("উ")}</span></div>
        <div class="sound-pill" id="soundPill"></div>
        <div class="place"><div class="road" id="road"></div><div class="area" id="area"></div></div>
        <div class="clock" id="clock"></div>
        <div class="money" id="money"></div>
        <div class="area-toast" id="toast"></div>
        <div class="speedo" id="speedo"><div class="veh" id="vehName"></div><div class="val" id="speedVal">${bnNum(0)}</div><div class="unit">${bn.speedUnit}</div></div>
        <div class="prompt" id="prompt"></div>
        <div class="subtitle" id="subtitle"></div>
        <div class="bubbles" id="bubbles"></div>
        <div class="focus" id="focus"></div>
        <div class="waypoint" id="waypoint"><i></i><span id="waypointText"></span></div>
        <div class="activity" id="activity"><div class="activity-head"><b id="activityTitle"></b><span id="activityTime"></span></div><div class="activity-bar"><i id="activityFill"></i></div></div>
        <div class="choices" id="choices"><div id="choiceList"></div><div class="choices-hint">${bn.menuHint}</div></div>
        <div class="info" id="info"><h3 id="infoTitle"></h3><p id="infoText"></p></div>
        <div class="lookhint" id="lookHint">${bn.clickToLook}</div>
        <div class="debug" id="debug"></div>
      </div>
      <div class="screen title hidden" id="title">
        <div class="title-inner">
          <h1>${bn.title}</h1>
          <div class="where"><span id="whereName">${bn.subtitle}</span> · ${bn.build}</div>
          <div class="menu" id="titleMenu">
            <button class="btn" id="play">${bn.play}</button>
            <button class="menu-btn" data-go="new">${bn.menu.newGame}<small>${bn.ui.menuHints.newGame}</small></button>
            <button class="menu-btn" data-go="load">${bn.menu.load}<small>${bn.ui.menuHints.load}</small></button>
            <button class="menu-btn" data-go="settings">${bn.settings}<small>${bn.ui.menuHints.settings}</small></button>
            <button class="menu-btn" data-go="controls">${bn.controlsTitle}<small>${bn.ui.menuHints.controls}</small></button>
          </div>
          <div class="lang-switch" data-lang-switch><span>${bn.ui.language}</span><button data-lang="bn">বাংলা</button><button data-lang="en">English</button></div>
        </div>
      </div>
      <div class="screen pause hidden" id="pause">
        <div class="pause-inner">
          <h2>${bn.paused}</h2>
          <div class="menu">
            <button class="btn" id="resume">${bn.resume}</button>
            <button class="menu-btn" data-go="save">${bn.menu.save}<small>${bn.ui.menuHints.save}</small></button>
            <button class="menu-btn" data-go="load">${bn.menu.load}<small>${bn.ui.menuHints.load}</small></button>
            <button class="menu-btn" data-go="settings">${bn.settings}<small>${bn.ui.menuHints.settings}</small></button>
            <button class="menu-btn" data-go="controls">${bn.controlsTitle}<small>${bn.ui.menuHints.controls}</small></button>
            <button class="menu-btn" id="respawn">${bn.respawn}<small>${bn.ui.menuHints.respawn}</small></button>
            <button class="menu-btn" id="quit">${bn.menu.quit}<small>${bn.ui.menuHints.quit}</small></button>
          </div>
          <div class="lang-switch" data-lang-switch><span>${bn.ui.language}</span><button data-lang="bn">বাংলা</button><button data-lang="en">English</button></div>
        </div>
        <aside class="pause-card">
          <h3 id="pausePlace"></h3>
          <div class="stat"><small>${bn.mapLegend.you}</small><b id="pauseMoney"></b></div>
          <div class="stat"><small>${bn.menu.played}</small><b id="pausePlayed"></b></div>
          <div class="stat"><small>${bn.bag}</small><span id="bag"></span></div>
        </aside>
      </div>
      <div class="screen panel-screen hidden" id="panelSettings">
        <div class="panel">
          <header><h2>${bn.settings}</h2><button class="x" data-close>✕</button></header>
          <nav class="tabs" id="setTabs"><button data-tab="easy" class="on">${bn.ui.easyTab}</button>${["sound", "gfx", "game", "controls", "display"].map((t) => `<button data-tab="${t}">${bn.menu.tabs[t]}</button>`).join("")}</nav>
          <div class="panel-body">
            <section class="rows" data-page="easy">
              <div class="row"><label>${bn.ui.language}<small>${bn.ui.languageHint}</small></label><div class="seg" id="langSeg"></div></div>
              <div class="row"><label>${bn.ui.soundOn}<small>${bn.ui.soundHint}</small></label><div class="seg-with"><div class="seg" data-sound-seg></div><button class="mini" data-sound-test>${bn.ui.test}</button></div></div>
              <div class="row"><label>${bn.ui.volume}</label><input type="range" id="volEasy" min="0" max="1" step="0.02" /></div>
              <div class="row sound-state"><label></label><div><div class="sound-meter"><i data-sound-bar></i></div><small data-sound-text></small></div></div>
              <div class="row"><label>${bn.graphics}<small>${bn.ui.graphicsHint}</small></label><div class="seg" id="qualityEasy"></div></div>
              <div class="row"><label>${bn.crowdPeople}<small>${bn.ui.crowdHint}</small></label><input type="range" id="crowdEasy" min="0.2" max="3" step="0.05" /></div>
              <div class="row"><label>${bn.crowdTraffic}<small>${bn.ui.trafficHint}</small></label><input type="range" id="trafficEasy" min="0.2" max="3" step="0.05" /></div>
              <div class="row"><label>${bn.menu.rain}<small>${bn.ui.rainHint}</small></label><div class="seg" id="rainEasy"></div></div>
              <div class="row"><label>${bn.ui.viewFoot}<small>${bn.ui.viewHint}</small></label><div class="seg" id="viewFootSeg"></div></div>
              <div class="row"><label>${bn.ui.viewDrive}</label><div class="seg" id="viewDriveSeg"></div></div>
              <div class="row"><label>${bn.ui.missionsLabel}<small>${bn.ui.missionsHint}</small></label><div class="seg" id="missionsSeg"></div></div>
            </section>
            <section class="rows" data-page="gfx" hidden>
              <div class="row"><label>${bn.graphics}</label><div class="seg" id="qualitySeg"></div></div>
              <div class="row"><label>${bn.menu.sharpness}</label><input type="range" id="sharpness" min="0.6" max="1" step="0.05" /></div>
              <div class="row"><label>${bn.menu.brightness}</label><input type="range" id="brightness" min="0.7" max="1.4" step="0.02" /></div>
              <div class="row"><label>${bn.menu.drawDistance}</label><div class="seg" id="distanceSeg"></div></div>
              <div class="row"><label>${bn.fps}</label><div class="seg" id="fpsSeg"></div></div>
            </section>
            <section class="rows" data-page="sound" hidden>
              <div class="row"><label>${bn.soundMaster}</label><input type="range" id="vol" min="0" max="1" step="0.02" /></div>
              <div class="row"><label>${bn.soundVoice}</label><input type="range" id="sndVoice" min="0" max="1" step="0.02" /></div>
              <div class="row"><label>${bn.soundAmbience}</label><input type="range" id="sndAmbience" min="0" max="1" step="0.02" /></div>
              <div class="row"><label>${bn.soundVehicles}</label><input type="range" id="sndVehicles" min="0" max="1" step="0.02" /></div>
              <div class="row"><label>${bn.soundEffects}</label><input type="range" id="sndEffects" min="0" max="1" step="0.02" /></div>
              <div class="row"><label>${bn.ui.soundOn}<small>${bn.ui.soundHint}</small></label><div class="seg-with"><div class="seg" data-sound-seg></div><button class="mini" data-sound-test>${bn.ui.test}</button></div></div>
              <div class="row sound-state"><label></label><div><div class="sound-meter"><i data-sound-bar></i></div><small data-sound-text></small></div></div>
              <div class="row"><label>${bn.voice}</label><div class="seg" id="voiceSeg"></div></div>
              <div class="row"><label>${bn.voiceKind}</label><div class="seg" id="voiceKindSeg"></div></div>
            </section>
            <section class="rows" data-page="game" hidden>
              <div class="row"><label>${bn.time}</label><div class="seg" id="timeSeg"></div></div>
              <div class="row"><label>${bn.dayPace}</label><div class="seg" id="paceSeg"></div></div>
              <div class="row"><label>${bn.crowdPeople}</label><input type="range" id="crowd" min="0.2" max="3" step="0.05" /></div>
              <div class="row"><label>${bn.crowdTraffic}</label><input type="range" id="traffic" min="0.2" max="3" step="0.05" /></div>
              <div class="row"><label>${bn.menu.rain}</label><div class="seg" id="rainSeg"></div></div>
              <div class="row"><label>${bn.menu.autosave}</label><div class="seg" id="autosaveSeg"></div></div>
            </section>
            <section class="rows" data-page="controls" hidden>
              <div class="row"><label>${bn.sensitivity}</label><input type="range" id="sens" min="0.3" max="2.5" step="0.05" /></div>
              <div class="row"><label>${bn.menu.invertY}</label><div class="seg" id="invertSeg"></div></div>
              <div class="row"><label>${bn.menu.autoFollow}</label><div class="seg" id="followSeg"></div></div>
              <div class="row"><label>${bn.menu.shake}</label><div class="seg" id="shakeSeg"></div></div>
            </section>
            <section class="rows" data-page="display" hidden>
              <div class="row"><label>${bn.menu.uiSize}</label><div class="seg" id="uiSizeSeg"></div></div>
              <div class="row"><label>${bn.subtitles}</label><div class="seg" id="subsSeg"></div></div>
              <div class="row"><label>${bn.menu.subtitleSize}</label><div class="seg" id="subSizeSeg"></div></div>
              <div class="row"><label>${bn.menu.minimap}</label><div class="seg" id="minimapSeg"></div></div>
            </section>
          </div>
          <footer><button class="btn" data-close>${bn.close}</button></footer>
        </div>
      </div>
      <div class="screen panel-screen hidden" id="panelControls">
        <div class="panel">
          <header><h2>${bn.controlsTitle}</h2><button class="x" data-close>✕</button></header>
          <div class="panel-body"><div class="controls">${bn.controls.map(([k, v]) => `<b>${k}</b><span>${v}</span>`).join("")}</div></div>
          <footer><button class="btn" data-close>${bn.close}</button></footer>
        </div>
      </div>
      <div class="screen panel-screen hidden" id="panelSlots">
        <div class="panel">
          <header><h2 id="slotsTitle"></h2><button class="x" data-close>✕</button></header>
          <div class="panel-body"><div class="slots" id="slotsList"></div></div>
          <footer><button class="btn ghost" data-close>${bn.menu.back}</button></footer>
        </div>
      </div>
      <div class="screen panel-screen hidden" id="panelNew">
        <div class="panel">
          <header><h2>${bn.menu.newTitle}</h2><button class="x" data-close>✕</button></header>
          <div class="panel-body">
            <h4>${bn.menu.pickDistrict}</h4>
            <div class="cards" id="districts"></div>
            <h4>${bn.heroes.title}</h4>
            <div class="cards heroes" id="newHeroes"></div>
            <h4>${bn.menu.pickSlot}</h4>
            <div class="slots compact" id="newSlots"></div>
          </div>
          <footer><button class="btn" id="newStart">${bn.menu.start}</button><button class="btn ghost" data-close>${bn.menu.back}</button></footer>
        </div>
      </div>
      <div class="screen chooser hidden" id="chooser">
        <h2>${bn.chooserTitle}</h2>
        <p class="chooser-hint">${bn.chooserHint}</p>
        <div class="chooser-grid" id="chooserGrid"></div>
        <div class="actions"><button class="btn ghost" id="chooserClose">${bn.close}</button></div>
      </div>
      <div class="screen bigmap hidden" id="bigMap">
        <canvas id="bigCanvas"></canvas>
        <div class="bigmap-head"><h2 id="bigTitle">${bn.mapTitle}</h2><p id="bigSize"></p></div>
        <div class="bigmap-legend">
          <span><i class="k-you"></i>${bn.mapLegend.you}</span><span><i class="k-bus"></i>${bn.mapLegend.bus}</span><span><i class="k-tea"></i>${bn.mapLegend.tea}</span><span><i class="k-police"></i>${bn.mapLegend.police}</span><span><i class="k-vehicle"></i>${bn.mapLegend.vehicle}</span><span><i class="k-flyover"></i>${bn.mapLegend.flyover}</span><span><i class="k-metro"></i>${bn.mapLegend.metro}</span>
        </div>
        <div class="bigmap-side">
          <h3>${bn.mapDhaka}</h3>
          <canvas id="dhakaInset"></canvas>
          <h4>${bn.mapWays}</h4>
          <div id="bigWays"></div>
        </div>
        <div class="bigmap-zoom"><button id="mapPlus">+</button><button id="mapMinus">−</button><button id="mapHome">⌖</button></div>
        <div class="bigmap-hint">${bn.mapHint}</div>
      </div>
      <div class="gpu-hint hidden" id="gpuHint">${bn.gpuHint}</div>
      <div class="screen loading" id="loading">
        <div class="brand">${bn.title}</div>
        <div class="brand-sub" id="brandSub">${bn.subtitle}</div>
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
    const bubbleBox = $("bubbles");
    for (let i = 0; i < BUBBLES; i++) {
      const el = document.createElement("div");
      el.className = "bubble";
      const label = document.createElement("small");
      const text = document.createElement("span");
      el.append(label, text);
      bubbleBox.append(el);
      this.bubbles.push({ el, label, text, anchor: null, top: 0, time: 0, x: -1, y: -1 });
    }
    this.focusEl = $("focus");
    this.choicesEl = $("choices");
    this.choiceListEl = $("choiceList");
    this.choiceListEl.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (b) this.clickedChoice = Number(b.dataset.i);
    });
    this.activityEl = $("activity");
    this.activityTitle = $("activityTitle");
    this.activityFill = $("activityFill");
    this.activityTime = $("activityTime");
    this.infoEl = $("info");
    this.waypointEl = $("waypoint");
    this.waypointText = $("waypointText");

    $("play").addEventListener("click", () => cb.onPlay());
    $("resume").addEventListener("click", () => cb.onResume());
    $("respawn").addEventListener("click", () => cb.onRespawn());
    $("quit").addEventListener("click", () => cb.onQuit());
    // Any button that opens a panel, and any that closes one.
    root.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const go = t.closest("[data-go]") as HTMLElement | null;
      if (go) this.openPanel(go.dataset.go!);
      if (t.closest("[data-close]")) this.closeTopPanel();
    });
    $("setTabs").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      $("setTabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      $("panelSettings").querySelectorAll("section").forEach((sec) => (sec.hidden = sec.dataset.page !== b.dataset.tab));
    });
    window.addEventListener("keydown", (e) => {
      if (e.code === "Escape" && this.closeTopPanel()) e.stopPropagation();
    }, true);
    window.addEventListener("resize", () => this.applyScale());
    $("newStart").addEventListener("click", () => {
      if (this.newRegion) cb.onNewGame(this.newRegion, this.newSlot, this.newHero);
    });
    const flag = (id: string, now: boolean, change: (on: boolean) => void): void => this.segment($(id), ["off", "on"], (k) => (k === "on" ? bn.on : bn.off), now ? "on" : "off", (k) => change(k === "on"));
    const slide = (id: string, now: number, change: (v: number) => void): void => {
      const el = $<HTMLInputElement>(id);
      el.value = String(now);
      el.addEventListener("input", () => change(Number(el.value)));
    };
    flag("autosaveSeg", settings.autosave, (on) => cb.onSetting("autosave", on));
    this.segment($("rainSeg"), ["never", "rare", "normal", "often"], (k) => bn.menu.rainKinds[k], settings.rain, (k) => cb.onSetting("rain", k));
    flag("invertSeg", settings.invertY, (on) => cb.onSetting("invertY", on));
    flag("followSeg", settings.autoFollow, (on) => cb.onSetting("autoFollow", on));
    flag("shakeSeg", settings.shake, (on) => cb.onSetting("shake", on));
    flag("minimapSeg", settings.minimap, (on) => {
      cb.onSetting("minimap", on);
      this.applyDisplay();
    });
    slide("brightness", settings.brightness, (v) => cb.onSetting("brightness", v));
    slide("sharpness", settings.sharpness, (v) => cb.onSetting("sharpness", v));
    this.segment($("distanceSeg"), ["near", "mid", "far"], (k) => bn.menu.distances[k], settings.drawDistance, (k) => cb.onSetting("drawDistance", k));
    this.segment($("uiSizeSeg"), ["auto", "small", "medium", "large", "xlarge"], (k) => bn.menu.uiSizes[k], settings.uiSize, (k) => {
      cb.onSetting("uiSize", k);
      this.applyScale();
    });
    this.segment($("subSizeSeg"), ["small", "medium", "large"], (k) => bn.menu.sizes[k], settings.subtitleSize, (k) => {
      cb.onSetting("subtitleSize", k);
      this.applyDisplay();
    });

    this.segment($("qualitySeg"), ["auto", "low", "medium", "high", "ultra"], (k) => bn.quality[k as QualityName], settings.quality, (k) => cb.onQuality(k as QualityName));
    this.segment($("timeSeg"), ["morning", "noon", "golden", "dusk", "night"], (k) => bn.times[k as TimeName], settings.time, (k) => cb.onTime(k as TimeName));
    this.segment($("paceSeg"), ["stop", "slow", "normal", "fast"], (k) => bn.dayPaces[k], settings.dayPace, (k) => cb.onDayPace(k as DayPace));
    const crowd = $<HTMLInputElement>("crowd");
    crowd.value = String(settings.crowd);
    crowd.addEventListener("input", () => cb.onCrowd(Number(crowd.value)));
    const traffic = $<HTMLInputElement>("traffic");
    traffic.value = String(settings.traffic);
    traffic.addEventListener("input", () => cb.onTraffic(Number(traffic.value)));
    this.bigMapEl = $("bigMap");
    this.bigCanvas = $<HTMLCanvasElement>("bigCanvas");
    this.wireBigMap($("bigSize"));
    this.segment($("voiceSeg"), ["off", "on"], (k) => (k === "on" ? bn.on : bn.off), settings.voice ? "on" : "off", (k) => cb.onVoice(k === "on"));
    this.segment($("voiceKindSeg"), ["pack", "browser"], (k) => bn.voiceKinds[k], settings.voiceKind, (k) => cb.onVoiceKind(k as "pack" | "browser"));
    // Plain words: sound on means you hear it. Both copies of the switch stay the same.
    const soundSegs = [...root.querySelectorAll("[data-sound-seg]")] as HTMLElement[];
    for (const el of soundSegs) {
      this.segment(el, ["on", "off"], (k) => (k === "on" ? bn.on : bn.off), settings.muted ? "off" : "on", (k) => {
        cb.onMute(k === "off");
        for (const other of soundSegs) other.querySelectorAll("button").forEach((x) => x.classList.toggle("on", (x as HTMLElement).dataset.k === k));
      });
    }
    root.querySelectorAll("[data-sound-test]").forEach((b) => b.addEventListener("click", () => cb.onVoiceTest()));
    // The same few settings on the easy page, staying in step with their full versions.
    const twin = (id: string, other: string, now: number, change: (v: number) => void): void => {
      const a = $<HTMLInputElement>(id), b = $<HTMLInputElement>(other);
      a.value = String(now);
      a.addEventListener("input", () => {
        b.value = a.value;
        change(Number(a.value));
      });
      b.addEventListener("input", () => {
        a.value = b.value;
      });
    };
    twin("volEasy", "vol", settings.volume, (v) => cb.onVolume(v));
    twin("crowdEasy", "crowd", settings.crowd, (v) => cb.onCrowd(v));
    twin("trafficEasy", "traffic", settings.traffic, (v) => cb.onTraffic(v));
    this.segment($("qualityEasy"), ["auto", "low", "medium", "high", "ultra"], (k) => bn.quality[k as QualityName], settings.quality, (k) => {
      $("qualitySeg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", (x as HTMLElement).dataset.k === k));
      cb.onQuality(k as QualityName);
    });
    this.segment($("rainEasy"), ["never", "rare", "normal", "often"], (k) => bn.menu.rainKinds[k], settings.rain, (k) => {
      $("rainSeg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", (x as HTMLElement).dataset.k === k));
      cb.onSetting("rain", k);
    });
    const views = (k: string): string => (k === "first" ? bn.ui.viewFirst : bn.ui.viewThird);
    this.segment($("viewFootSeg"), ["third", "first"], views, settings.viewFoot, (k) => cb.onSetting("viewFoot", k));
    this.segment($("viewDriveSeg"), ["third", "first"], views, settings.viewDrive, (k) => cb.onSetting("viewDrive", k));
    this.segment($("missionsSeg"), ["on", "off"], (k) => (k === "on" ? bn.on : bn.off), settings.missionsOff ? "off" : "on", (k) => cb.onSetting("missionsOff", k === "off"));
    this.segment($("langSeg"), ["bn", "en"], (k) => (k === "bn" ? "বাংলা" : "English"), lang, (k) => {
      if (k !== lang) cb.onLanguage(k as Lang);
    });
    root.querySelectorAll("[data-lang-switch]").forEach((box) => {
      box.querySelectorAll("button").forEach((b) => b.classList.toggle("on", (b as HTMLElement).dataset.lang === lang));
      box.addEventListener("click", (e) => {
        const l = (e.target as HTMLElement).closest("button")?.dataset.lang;
        if (l && l !== lang) cb.onLanguage(l as Lang);
      });
    });
    window.setInterval(() => this.paintSound(), 90);
    this.segment($("subsSeg"), ["off", "on"], (k) => (k === "on" ? bn.on : bn.off), settings.subtitles ? "on" : "off", (k) => {
      this.showWords = k === "on";
      cb.onSubtitles(this.showWords);
    });
    this.showWords = settings.subtitles;
    const level = (id: string, kind: "voice" | "ambience" | "vehicles" | "effects", now: number): void => {
      const el = $<HTMLInputElement>(id);
      el.value = String(now);
      el.addEventListener("input", () => cb.onSound(kind, Number(el.value)));
    };
    level("sndVoice", "voice", settings.soundVoice);
    level("sndAmbience", "ambience", settings.soundAmbience);
    level("sndVehicles", "vehicles", settings.soundVehicles);
    level("sndEffects", "effects", settings.soundEffects);
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

    this.applyScale();
    this.applyDisplay();
    let tip = 0;
    this.tipTimer = window.setInterval(() => {
      tip = (tip + 1) % bn.tips.length;
      this.tipEl.textContent = bn.tips[tip];
    }, 3500);
  }

  /** A setting changed from inside the game, shown correctly when the menu is next opened. */
  markSetting(key: "viewFoot" | "viewDrive", value: string): void {
    document.getElementById(`${key}Seg`)?.querySelectorAll("button").forEach((x) => x.classList.toggle("on", (x as HTMLElement).dataset.k === value));
  }

  private soundTip = 0;

  /** The meter in the menu while it's open, and the warning during play if sound isn't getting out. */
  private paintSound(): void {
    const info = this.cb.soundInfo();
    const pill = document.getElementById("soundPill");
    if (pill) {
      this.soundTip = info.status === "blocked" ? this.soundTip + 1 : 0;
      const text = info.status === "muted" ? bn.ui.soundOffPill : this.soundTip > 30 ? bn.ui.soundBad : "";
      if (pill.textContent !== text) pill.textContent = text;
      pill.classList.toggle("on", !!text);
    }
    if (document.getElementById("panelSettings")!.classList.contains("hidden")) return;
    const words = info.status === "running" ? `${bn.ui.soundRunning}. ${bn.ui.soundTip}` : info.status === "muted" ? bn.ui.soundMuted : info.status === "blocked" ? bn.ui.soundBlocked : bn.ui.soundNotYet;
    document.querySelectorAll("[data-sound-bar]").forEach((b) => ((b as HTMLElement).style.width = `${Math.round(Math.min(1, info.level * 1.6) * 100)}%`));
    document.querySelectorAll("[data-sound-text]").forEach((b) => {
      if (b.textContent !== words) b.textContent = words;
    });
  }

  /** Menus are sized to the window so that every button is always on screen, whatever the display. */
  private applyScale(): void {
    const auto = Math.max(0.62, Math.min(1.25, Math.min(window.innerHeight / 860, window.innerWidth / 1280)));
    const sizes = { auto, small: auto * 0.85, medium: auto, large: auto * 1.15, xlarge: auto * 1.3 };
    const ui = sizes[this.settings.uiSize];
    document.documentElement.style.setProperty("--ui", ui.toFixed(3));
    document.documentElement.style.setProperty("--hud", Math.max(0.7, ui).toFixed(3));
  }

  private applyDisplay(): void {
    const px = { small: 16, medium: 20, large: 25 }[this.settings.subtitleSize];
    document.documentElement.style.setProperty("--subtitle", `${px}px`);
    this.hud.classList.toggle("no-minimap", !this.settings.minimap);
  }

  private panels: string[] = [];
  private newRegion = "";
  private newSlot = 1;
  private newHero = "hero_mango";

  private panelOf(name: string): HTMLElement {
    const id = name === "settings" ? "panelSettings" : name === "controls" ? "panelControls" : name === "new" ? "panelNew" : "panelSlots";
    return document.getElementById(id)!;
  }

  openPanel(name: string): void {
    if (name === "save" || name === "load") this.fillSlots(name);
    if (name === "new") this.fillNew();
    this.panelOf(name).classList.remove("hidden");
    this.panels.push(name);
  }

  /** Closes the panel on top, if there is one. */
  closeTopPanel(): boolean {
    const name = this.panels.pop();
    if (!name) return false;
    this.panelOf(name).classList.add("hidden");
    return true;
  }

  private slotCard(n: number, info: SlotInfo | null, extra = ""): string {
    const head = bn.menu.slot(bnNum(n));
    if (!info) return `<div class="slot empty" data-slot="${n}"><b>${head}</b><small>${bn.menu.empty}</small>${extra}</div>`;
    const m = Math.floor(info.playSeconds / 60), h = Math.floor(m / 60);
    const played = h ? bn.menu.hoursMinutes(bnNum(h), bnNum(m % 60)) : bn.menu.minutes(bnNum(m));
    const when = info.savedAt ? new Date(info.savedAt).toLocaleString("bn-BD", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "";
    return `<div class="slot" data-slot="${n}"><b>${head}</b><span>${info.place}</span><span>${bn.money(info.taka)} · ${played}</span><small>${when}</small>${extra}</div>`;
  }

  /** Save or load: every slot, what's in it, and a button to clear it. */
  private fillSlots(mode: "save" | "load"): void {
    document.getElementById("slotsTitle")!.textContent = mode === "save" ? bn.menu.saveTitle : bn.menu.loadTitle;
    const list = document.getElementById("slotsList")!;
    const slots = this.cb.slotsInfo();
    list.innerHTML = slots.map((info, i) => this.slotCard(i + 1, info, info ? `<button class="mini" data-remove="${i + 1}">${bn.menu.remove}</button>` : "")).join("");
    list.onclick = (e) => {
      const t = e.target as HTMLElement;
      const del = t.closest("[data-remove]") as HTMLElement | null;
      if (del) {
        // Asked twice: there's no getting a deleted game back.
        if (del.dataset.sure) {
          this.cb.onDeleteSlot(Number(del.dataset.remove));
          this.fillSlots(mode);
        } else {
          del.dataset.sure = "1";
          del.textContent = bn.menu.removeSure;
        }
        return;
      }
      const card = t.closest(".slot") as HTMLElement | null;
      if (!card) return;
      const n = Number(card.dataset.slot);
      const used = !!slots[n - 1];
      if (mode === "load") {
        if (used) this.cb.onLoadSlot(n);
        return;
      }
      if (used && !card.dataset.sure) {
        card.dataset.sure = "1";
        card.querySelector("small")!.textContent = bn.menu.overwriteSure;
        return;
      }
      this.cb.onSaveSlot(n);
      this.fillSlots(mode);
      this.say(bn.menu.saved, 2.4);
    };
  }

  private fillNew(): void {
    const heroes = document.getElementById("newHeroes")!;
    const paintHeroes = (): void => {
      heroes.innerHTML = HEROES.map((h) => {
        const t = bn.heroes[h.key];
        return `<button data-id="${h.id}" class="card ${h.id === this.newHero ? "on" : ""}"><b>${t.name}</b><small>${t.age}</small><small>${t.note}</small><em>${bn.money(h.taka)}</em></button>`;
      }).join("");
    };
    paintHeroes();
    heroes.onclick = (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      this.newHero = b.dataset.id!;
      paintHeroes();
    };
    const slots = this.cb.slotsInfo();
    const list = document.getElementById("newSlots")!;
    const firstFree = slots.findIndex((q) => !q);
    this.newSlot = firstFree >= 0 ? firstFree + 1 : 1;
    const paint = (): void => {
      list.innerHTML = slots.map((info, i) => this.slotCard(i + 1, info)).join("");
      list.querySelectorAll(".slot").forEach((c) => c.classList.toggle("on", Number((c as HTMLElement).dataset.slot) === this.newSlot));
    };
    paint();
    list.onclick = (e) => {
      const card = (e.target as HTMLElement).closest(".slot") as HTMLElement | null;
      if (!card) return;
      this.newSlot = Number(card.dataset.slot);
      paint();
    };
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
    const seg = document.getElementById("timeSeg");
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
    if (!this.showWords) return;
    this.subtitleEl.textContent = text;
    this.subtitleEl.classList.add("on");
    this.subtitleTimer = seconds;
  }

  // ---------------------------------------------------------------- speech over people's heads

  /** Hangs a line of speech above someone. One speaker has one bubble at a time. */
  bubble(text: string, label: string, anchor: Anchor, top: number, seconds: number): void {
    if (!this.showWords) return;
    let b = this.bubbles.find((q) => q.anchor === anchor);
    if (!b) b = this.bubbles.find((q) => !q.anchor);
    // All in use: the one closest to finishing makes way.
    if (!b) b = this.bubbles.reduce((p, q) => (q.time < p.time ? q : p));
    b.anchor = anchor;
    b.top = top;
    b.time = seconds;
    b.label.textContent = label;
    b.label.style.display = label ? "" : "none";
    b.text.textContent = text;
    b.el.classList.add("on");
    b.x = b.y = -1;
  }

  clearBubble(anchor: Anchor): void {
    for (const b of this.bubbles) {
      if (b.anchor === anchor) {
        b.anchor = null;
        b.el.classList.remove("on");
      }
    }
  }

  /** The small marker over whoever pressing E would talk to. */
  setFocus(anchor: Anchor | null): void {
    this.focusAnchor = anchor;
    this.focusEl.classList.toggle("on", !!anchor);
  }

  /** Moves everything pinned to the world into place. Runs once per drawn frame. */
  layoutWorldText(dt: number, project: Project, camX: number, camZ: number, camYaw: number): void {
    const p = this.spot;
    const w = window.innerWidth, h = window.innerHeight;
    for (const b of this.bubbles) {
      if (!b.anchor) continue;
      b.time -= dt;
      if (b.time <= 0) {
        b.anchor = null;
        b.el.classList.remove("on");
        continue;
      }
      const a = b.anchor;
      const seen = project(a.x, a.y + b.top, a.z, p) && Math.hypot(a.x - camX, a.z - camZ) < 42;
      b.el.classList.toggle("off", !seen);
      if (!seen) continue;
      // Stays on screen, and keeps still for the sub-pixel wobble of a moving camera.
      const x = Math.max(150, Math.min(w - 150, p.x)), y = Math.max(90, Math.min(h - 150, p.y));
      if (Math.abs(x - b.x) > 0.4 || Math.abs(y - b.y) > 0.4) {
        b.x = x;
        b.y = y;
        b.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      }
    }
    const f = this.focusAnchor;
    if (f) {
      const seen = project(f.x, f.y + 1.86, f.z, p);
      this.focusEl.style.opacity = seen ? "" : "0";
      if (seen) this.focusEl.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    const wp = this.waypoint;
    if (wp) {
      const dist = Math.hypot(wp.x - camX, wp.z - camZ);
      let seen = project(wp.x, 2.2, wp.z, p);
      if (seen && (p.x < 40 || p.x > w - 40 || p.y < 40 || p.y > h - 90)) seen = false;
      if (!seen) {
        // Off screen: a marker round the edge, in the direction to turn.
        const bearing = Math.atan2(wp.x - camX, wp.z - camZ) - camYaw;
        p.x = w / 2 + Math.sin(bearing) * (w * 0.44);
        p.y = h / 2 - Math.cos(bearing) * (h * 0.4);
      }
      this.waypointEl.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
      this.waypointText.textContent = `${wp.label} · ${bn.talk.metres(bnNum(Math.round(dist)))}`;
    }
  }

  /** What's in the hero's pocket. A small pulse when it changes, so it gets noticed. */
  setMoney(taka: number, changed = true): void {
    const el = document.getElementById("money")!;
    el.textContent = bn.money(taka);
    if (!changed) return;
    el.classList.remove("pulse");
    void el.offsetWidth;
    el.classList.add("pulse");
  }

  /** What's been bought, listed on the pause screen. */
  setBag(names: string[]): void {
    document.getElementById("bag")!.textContent = names.length ? names.join(", ") : bn.bagEmpty;
  }

  /** A quick dip to black, for anything that jumps from one place to another. */
  fade(mid: () => void): void {
    const el = document.getElementById("fade")!;
    el.classList.add("on");
    setTimeout(() => {
      mid();
      setTimeout(() => el.classList.remove("on"), 120);
    }, 340);
  }

  /** The districts a new game can start in. */
  setDistricts(list: { id: string; name: string }[], current: string): void {
    this.newRegion = current;
    const box = document.getElementById("districts")!;
    const paint = (): void => {
      box.innerHTML = list.map((d) => `<button data-id="${d.id}" class="card ${d.id === this.newRegion ? "on" : ""}"><b>${d.name}</b><small>${bn.menu.taglines[d.id] ?? ""}</small></button>`).join("");
    };
    paint();
    box.onclick = (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      this.newRegion = b.dataset.id!;
      paint();
    };
  }

  /** Whether there's a game to carry on, which is what the first button on the title screen says. */
  setHasSave(has: boolean): void {
    document.getElementById("play")!.textContent = has ? bn.resume : bn.play;
  }

  /** Just arrived from somewhere: the title screen says so, and the only choice is to carry on. */
  setArrival(head: string): void {
    document.getElementById("whereName")!.textContent = head;
    document.getElementById("play")!.textContent = bn.travel.goOn;
    document.querySelectorAll("#titleMenu .menu-btn:not([data-go=settings])").forEach((b) => ((b as HTMLElement).style.display = "none"));
  }

  /** What the pause screen shows about the game in progress. */
  setPauseInfo(place: string, taka: number, seconds: number): void {
    const m = Math.floor(seconds / 60), h = Math.floor(m / 60);
    document.getElementById("pausePlace")!.textContent = place;
    document.getElementById("pauseMoney")!.textContent = bn.money(taka);
    document.getElementById("pausePlayed")!.textContent = h ? bn.menu.hoursMinutes(bnNum(h), bnNum(m % 60)) : bn.menu.minutes(bnNum(m));
  }

  /** While loading a journey: where from, and where to. */
  setJourney(text: string): void {
    document.getElementById("brandSub")!.textContent = text;
  }

  /** Which district the title and loading screens name. */
  setRegionName(name: string): void {
    document.getElementById("whereName")!.textContent = name;
    document.getElementById("brandSub")!.textContent = name;
  }

  private route: [number, number][] | null = null;
  /** No phone, no map. */
  mapDisabled = false;

  setMapDisabled(on: boolean): void {
    this.mapDisabled = on;
    this.hud.classList.toggle("no-minimap", on || !this.settings.minimap);
  }

  /** The way to go, drawn along the roads on the maps. */
  setRoute(points: [number, number][] | null): void {
    this.route = points;
  }

  setWaypoint(wp: { x: number; z: number; label: string } | null): void {
    this.waypoint = wp;
    this.waypointEl.classList.toggle("on", !!wp);
  }

  // ---------------------------------------------------------------- the choice menu

  showChoices(items: Choice[]): void {
    this.choiceListEl.innerHTML = items
      .map((c, i) => `<button data-i="${i}" class="${c.dim ? "dim" : ""}${i === 0 ? " sel" : ""}"><kbd>${bnNum(i + 1)}</kbd>${c.text}</button>`)
      .join("");
    this.choiceCount = items.length;
    this.choiceIndex = 0;
    this.choiceAge = 0;
    this.clickedChoice = -1;
    this.choicesEl.classList.add("on");
  }

  hideChoices(): void {
    this.choiceCount = 0;
    this.choicesEl.classList.remove("on");
  }

  get choicesOpen(): boolean {
    return this.choiceCount > 0;
  }

  /** Reads the menu's controls. Returns the choice made this frame, or -1. Number keys pick
   *  directly; the wheel or arrow keys move the highlight, and E, Enter or a click confirms it. */
  readChoice(dt: number, pressed: (code: string) => boolean, wheel: number, clicked: boolean): number {
    if (!this.choiceCount) return -1;
    this.choiceAge += dt;
    if (this.clickedChoice >= 0) {
      const c = this.clickedChoice;
      this.clickedChoice = -1;
      return c;
    }
    for (let i = 0; i < Math.min(this.choiceCount, 9); i++) {
      if (pressed(`Digit${i + 1}`) || pressed(`Numpad${i + 1}`)) return i;
    }
    const step = (pressed("ArrowDown") ? 1 : 0) - (pressed("ArrowUp") ? 1 : 0) + Math.sign(wheel);
    if (step !== 0) {
      this.choiceIndex = (this.choiceIndex + step + this.choiceCount) % this.choiceCount;
      this.choiceListEl.querySelectorAll("button").forEach((b, i) => b.classList.toggle("sel", i === this.choiceIndex));
    }
    // A short wait, so the key press that ended the last line can't pick from this menu too.
    if (this.choiceAge > 0.25 && (pressed("KeyE") || pressed("Enter") || clicked)) return this.choiceIndex;
    return -1;
  }

  // ---------------------------------------------------------------- timers and information

  showActivity(title: string): void {
    this.activityTitle.textContent = title;
    this.activityEl.classList.add("on");
  }

  setActivity(fraction: number, time: string): void {
    this.activityFill.style.width = `${(fraction * 100).toFixed(1)}%`;
    this.activityTime.textContent = time;
  }

  hideActivity(): void {
    this.activityEl.classList.remove("on");
  }

  showInfo(title: string, text: string, seconds: number): void {
    this.infoEl.querySelector("h3")!.textContent = title;
    this.infoEl.querySelector("p")!.textContent = text;
    this.infoEl.classList.add("on");
    this.infoTimer = seconds;
  }

  hideInfo(): void {
    this.infoTimer = 0;
    this.infoEl.classList.remove("on");
  }

  get infoOpen(): boolean {
    return this.infoTimer > 0;
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
    if (this.infoTimer > 0) {
      this.infoTimer -= dt;
      if (this.infoTimer <= 0) this.infoEl.classList.remove("on");
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

  // ---------------------------------------------------------------- the big map

  private wireBigMap(sizeEl: HTMLElement): void {
    this.bigSizeEl = sizeEl;
    const c = this.bigCanvas;
    const zoomBy = (factor: number, px = c.width / 2, py = c.height / 2): void => {
      const v = this.view;
      // Whatever is under the pointer stays under it.
      const wx = v.x + (px - c.width / 2) / v.zoom, wz = v.z - (py - c.height / 2) / v.zoom;
      v.zoom = Math.max(v.fit, Math.min(v.fit * 12, v.zoom * factor));
      v.x = wx - (px - c.width / 2) / v.zoom;
      v.z = wz + (py - c.height / 2) / v.zoom;
      this.drawBigMap();
    };
    const dprOf = (): number => c.width / Math.max(c.clientWidth, 1);
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const d = dprOf();
      zoomBy(e.deltaY < 0 ? 1.18 : 0.85, e.offsetX * d, e.offsetY * d);
    }, { passive: false });
    let dragging = false, travelled = 0;
    c.addEventListener("mousedown", () => {
      dragging = true;
      travelled = 0;
    });
    window.addEventListener("mouseup", () => (dragging = false));
    window.addEventListener("mousemove", (e) => {
      if (!dragging || !this.bigMapOpen) return;
      travelled += Math.abs(e.movementX) + Math.abs(e.movementY);
      const dpr = dprOf();
      this.view.x -= (e.movementX * dpr) / this.view.zoom;
      this.view.z += (e.movementY * dpr) / this.view.zoom;
      this.drawBigMap();
    });
    // A click, not a drag: marks a place to go, or clears the mark if it's on it already.
    c.addEventListener("click", (e) => {
      if (travelled > 6) return;
      const d = dprOf(), v = this.view;
      const x = v.x + (e.offsetX * d - c.width / 2) / v.zoom, z = v.z - (e.offsetY * d - c.height / 2) / v.zoom;
      const old = this.waypoint;
      if (old && Math.hypot(old.x - x, old.z - z) * v.zoom < 16 * d) this.setWaypoint(null);
      else this.setWaypoint({ x, z, label: bn.mapMark });
      this.userMark = !!this.waypoint;
      this.drawBigMap();
    });
    document.getElementById("mapPlus")!.addEventListener("click", () => zoomBy(1.4));
    document.getElementById("mapMinus")!.addEventListener("click", () => zoomBy(0.7));
    document.getElementById("mapHome")!.addEventListener("click", () => {
      this.view.x = this.mapNow.x;
      this.view.z = this.mapNow.z;
      this.view.zoom = Math.max(this.view.zoom, this.view.fit * 3);
      this.drawBigMap();
    });
  }

  /** The other districts, and how to get to them. */
  setWays(here: string, name: string, ways: { name: string; via: string; bus: string; metro: boolean }[]): void {
    this.dhakaHere = here;
    document.getElementById("bigTitle")!.textContent = name;
    document.getElementById("bigWays")!.innerHTML = ways
      .map((w) => `<div class="way"><b>${w.name}</b><small>${w.via}</small><span>${bn.mapWayCar}</span><span>${bn.mapWayBus(w.bus)}</span>${w.metro ? `<span class="m">${bn.mapWayMetro}</span>` : ""}</div>`)
      .join("");
  }

  get bigMapOpen(): boolean {
    return !this.bigMapEl.classList.contains("hidden");
  }

  showBigMap(on: boolean, x = 0, z = 0, yaw = 0, marks: { x: number; z: number }[] = []): void {
    this.bigMapEl.classList.toggle("hidden", !on);
    this.hud.classList.toggle("hidden", on);
    if (!on || !this.layout) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const c = this.bigCanvas;
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
    this.mapNow = { x, z, yaw, marks };
    if (!this.bigBase && this.mapExtras) this.bigBase = paintDistrict(4096, this.layout, this.mapExtras, this.bigHalf);
    const inset = document.getElementById("dhakaInset") as HTMLCanvasElement;
    inset.width = inset.clientWidth * dpr;
    inset.height = inset.clientHeight * dpr;
    paintDhaka(inset, this.dhakaHere);
    // Opens with the whole district in view, so its size is obvious at once.
    const span = this.bigHalf * 2;
    const v = this.view;
    v.fit = Math.min(c.width, c.height) / span;
    v.zoom = v.fit;
    v.x = 0;
    v.z = 0;
    this.drawBigMap();
  }

  private drawBigMap(): void {
    const base = this.bigBase;
    const c = this.bigCanvas;
    const ctx = c.getContext("2d");
    if (!base || !ctx) return;
    const v = this.view;
    const maxOff = this.bigHalf;
    v.x = Math.max(-maxOff, Math.min(maxOff, v.x));
    v.z = Math.max(-maxOff, Math.min(maxOff, v.z));
    const sx = (x: number): number => c.width / 2 + (x - v.x) * v.zoom;
    const sy = (z: number): number => c.height / 2 - (z - v.z) * v.zoom;
    const dpr = c.width / Math.max(c.clientWidth, 1);
    ctx.fillStyle = "#0d1211";
    ctx.fillRect(0, 0, c.width, c.height);
    const size = this.bigHalf * 2 * v.zoom;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(base, sx(-this.bigHalf), sy(this.bigHalf), size, size);

    const dot = (x: number, z: number, r: number, fill: string): void => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(sx(x), sy(z), r * dpr, 0, Math.PI * 2);
      ctx.fill();
    };
    const detail = v.zoom / v.fit;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    if (this.layout) {
      // Neighbourhoods first, faint and large, under everything else.
      if (detail < 3) {
        ctx.font = `700 ${Math.min(16 + detail * 5, 30) * dpr}px "Anek Bangla", "Hind Siliguri", sans-serif`;
        for (const a of this.layout.data.areas.slice(0, -1)) {
          if (a.x1 - a.x0 < 150) continue;
          ctx.fillStyle = "rgba(247, 243, 232, 0.2)";
          ctx.fillText(a.nameBn, sx((a.x0 + a.x1) / 2), sy((a.z0 + a.z1) / 2));
        }
      }
      // Road names lie along their roads, once there is room to read them.
      ctx.fillStyle = "rgba(247, 243, 232, 0.92)";
      ctx.font = `600 ${Math.min(11 + detail * 1.2, 16) * dpr}px "Hind Siliguri", sans-serif`;
      const seen = new Set<string>();
      for (const r of this.layout.data.roads) {
        if (r.cls === "street" && detail < 1.5) continue;
        if (seen.has(r.nameBn)) continue;
        seen.add(r.nameBn);
        const mid = (r.from + r.to) / 2;
        ctx.save();
        // Off to one side of the middle, so names don't all stack up on the centre of the map.
        const along = mid + (r.at >= 0 ? 150 : -150);
        if (r.axis === "v") {
          ctx.translate(sx(r.at), sy(along));
          ctx.rotate(-Math.PI / 2);
        } else {
          ctx.translate(sx(along), sy(r.at));
        }
        ctx.lineWidth = 3.4 * dpr;
        ctx.strokeStyle = "rgba(10, 13, 17, 0.9)";
        ctx.strokeText(r.nameBn, 0, 0);
        ctx.fillText(r.nameBn, 0, 0);
        ctx.restore();
      }
    }
    for (const m of this.mapNow.marks) dot(m.x, m.z, 1.6, "rgba(255, 255, 255, 0.7)");
    const colors = { bus: "#f6b93b", tea: "#e8843c", police: "#4aa8ff" };
    const iconR = Math.min(3 + detail * 0.5, 6);
    for (const p of this.points) {
      if (p.kind === "tea" && detail < 1.6) continue;
      ctx.beginPath();
      ctx.arc(sx(p.x), sy(p.z), iconR * dpr, 0, Math.PI * 2);
      ctx.fillStyle = colors[p.kind];
      ctx.fill();
      ctx.lineWidth = 1.3 * dpr;
      ctx.strokeStyle = "rgba(10, 13, 13, 0.9)";
      ctx.stroke();
    }
    // The way there along the roads, if the phone's working one out.
    if (this.route) {
      ctx.lineWidth = 4 * dpr;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(246, 185, 59, 0.95)";
      ctx.beginPath();
      this.route.forEach(([rx, rz], i) => (i ? ctx.lineTo(sx(rx), sy(rz)) : ctx.moveTo(sx(rx), sy(rz))));
      ctx.stroke();
    }
    // The dashed line from the hero to wherever they've marked.
    const mark = this.route ? null : this.waypoint;
    if (mark) {
      ctx.setLineDash([7 * dpr, 6 * dpr]);
      ctx.lineWidth = 2.2 * dpr;
      ctx.strokeStyle = "rgba(246, 185, 59, 0.9)";
      ctx.beginPath();
      ctx.moveTo(sx(this.mapNow.x), sy(this.mapNow.z));
      ctx.lineTo(sx(mark.x), sy(mark.z));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Landmarks, always named.
    ctx.font = `700 ${13 * dpr}px "Anek Bangla", "Hind Siliguri", sans-serif`;
    for (const p of this.places) {
      const x = sx(p.x), y = sy(p.z);
      ctx.lineWidth = 4 * dpr;
      ctx.strokeStyle = "rgba(10, 13, 17, 0.9)";
      ctx.strokeText(p.label, x, y);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(p.label, x, y);
    }
    const wp = this.waypoint;
    if (wp) {
      const a = 9 * dpr, x = sx(wp.x), y = sy(wp.z);
      ctx.fillStyle = "#f6b93b";
      ctx.strokeStyle = "#12100a";
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(x, y - a);
      ctx.lineTo(x + a, y);
      ctx.lineTo(x, y + a);
      ctx.lineTo(x - a, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // You are here.
    ctx.save();
    ctx.translate(sx(this.mapNow.x), sy(this.mapNow.z));
    ctx.rotate(this.mapNow.yaw);
    const a = 11 * dpr;
    ctx.fillStyle = "#e0263c";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(0, -a * 1.3);
    ctx.lineTo(a * 0.85, a);
    ctx.lineTo(0, a * 0.5);
    ctx.lineTo(-a * 0.85, a);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // Scale bar: a round number of metres.
    const want = 150 * dpr;
    const metres = [50, 100, 200, 500].find((m) => m * v.zoom >= want) ?? 500;
    const len = metres * v.zoom;
    const bx = c.width - len - 90 * dpr, by = c.height - 34 * dpr;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(bx, by, len, 3 * dpr);
    ctx.fillRect(bx, by - 5 * dpr, 2 * dpr, 8 * dpr);
    ctx.fillRect(bx + len - 2 * dpr, by - 5 * dpr, 2 * dpr, 8 * dpr);
    ctx.font = `600 ${13 * dpr}px "Hind Siliguri", sans-serif`;
    ctx.fillText(bn.mapMetres(bnNum(metres)), bx + len / 2, by - 14 * dpr);
  }

  /** Pre-draws the district once; the minimap then just pans and rotates it. The full-size map is
   *  painted the first time it's opened. */
  buildMap(layout: CityLayout, points: MapPoint[] = [], places: MapPlace[] = [], extras: MapExtras = { buildings: [], lakes: [], bridges: [] }): void {
    this.layout = layout;
    this.points = points;
    this.places = places;
    this.mapExtras = extras;
    const xs = layout.blocks.flatMap((b) => [b.x0, b.x1]), zs = layout.blocks.flatMap((b) => [b.z0, b.z1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...zs) - Math.min(...zs);
    this.bigSizeEl.textContent = bn.mapSize(bnNum(Math.round(w)), bnNum(Math.round(h)));
    const half = layout.data.boundary + 60;
    const size = 2048;
    this.mapScale = size / (half * 2);
    this.mapBase = paintDistrict(size, layout, extras, half);
    this.bigBase = null;
    this.bigHalf = half;
  }

  private mapExtras: MapExtras | null = null;
  private dhakaHere = "";
  /** The hero marked this place on the map themselves, so it clears when they get there. */
  private userMark = false;

  /** Rotating minimap: the view direction is always up. */
  updateMap(x: number, z: number, yaw: number, marks: { x: number; z: number; color: string }[]): void {
    const ctx = this.mapCtx;
    const base = this.mapBase;
    if (!base) return;
    const size = ctx.canvas.width;
    const half = size / 2;
    const zoom = 1.55;
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
    if (this.route) {
      ctx.strokeStyle = "rgba(246, 185, 59, 0.92)";
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.beginPath();
      this.route.forEach(([rx, rz], i) => (i ? ctx.lineTo(baseHalf + rx * k, baseHalf - rz * k) : ctx.moveTo(baseHalf + rx * k, baseHalf - rz * k)));
      ctx.stroke();
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
    const wp = this.waypoint;
    if (wp && this.userMark && Math.hypot(wp.x - x, wp.z - z) < 14) {
      this.userMark = false;
      this.setWaypoint(null);
      this.say(bn.talk.arrived, 2.6);
    }
    if (wp) {
      const dx = (wp.x - x) * k * zoom, dz = (wp.z - z) * k * zoom;
      let mx = dx * Math.cos(-yaw) + dz * Math.sin(-yaw);
      let my = dx * Math.sin(-yaw) - dz * Math.cos(-yaw);
      const rim = half - 16;
      const d = Math.hypot(mx, my);
      if (d > rim) {
        mx *= rim / d;
        my *= rim / d;
      }
      const a = 13;
      ctx.fillStyle = "#f6b93b";
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(half + mx, half + my - a);
      ctx.lineTo(half + mx + a, half + my);
      ctx.lineTo(half + mx, half + my + a);
      ctx.lineTo(half + mx - a, half + my);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // North marker runs around the rim.
    const r = 88;
    this.northDot.style.transform = `translate(${Math.sin(-yaw) * r}px, ${-Math.cos(-yaw) * r}px)`;
  }
}
