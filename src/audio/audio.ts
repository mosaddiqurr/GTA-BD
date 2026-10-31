import type { Vehicle } from "../vehicles/vehicle";
import { lang, spokenFor } from "../localization/bn";
import { lineKey } from "./lineKey";

type HornKind = "bell" | "squeak" | "horn" | "airhorn";

interface EngineVoice {
  gain: GainNode;
  pan: StereoPannerNode;
  osc: OscillatorNode;
  osc2: OscillatorNode;
  filter: BiquadFilterNode;
  noise: GainNode;
  noiseSrc: AudioBufferSourceNode;
  kind: string;
  /** Vehicle currently using this voice. */
  owner: Vehicle | null;
}

const PROFILES: Record<string, [number, number, number, number, number]> = {
  // base Hz, rev Hz, filter Hz, level, noise
  twostroke: [62, 125, 1500, 0.1, 0.1],
  bike: [48, 150, 1300, 0.11, 0.05],
  car: [38, 105, 620, 0.09, 0.03],
  diesel: [26, 52, 430, 0.16, 0.05],
  electric: [240, 620, 2400, 0.022, 0.006],
};

const TRAFFIC_VOICES = 6;
const VOICE_RANGE = 55;

/** How one character sounds. `alt` picks the second male voice, where the browser has one. */
export interface VoiceStyle {
  /** A woman's or girl's voice: if there's no clip, no voice at all rather than a man's. */
  female?: boolean;
  pitch: number;
  rate: number;
  alt?: boolean;
  /** Which voice in the game's own pack. */
  actor?: string;
}

/** Where someone is, so a line said down the street sounds like it. */
interface SpokenAt {
  x: number;
  z: number;
}

const MAX_CLIPS = 160;

const PLAIN_VOICE: VoiceStyle = { pitch: 1, rate: 1.02 };
// Edge's names are in Bangla script. Only these are known to be men's voices.
const MALE_BD = /প্রদ্বীপ|প্রদীপ|pradeep/i;
const MALE_IN = /ভাস্কর|bashkar|bhaskar/i;

/** All game sound is synthesised at runtime with Web Audio: no recordings, so no rights
 *  issues and nothing to download. It unlocks from the Play button, and if the browser
 *  refuses audio entirely the game simply runs silent. */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  // Each kind of sound has its own level, set in the pause menu.
  private voiceBus: GainNode | null = null;
  private ambienceBus: GainNode | null = null;
  private vehicleBus: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private levels = { voice: 1, ambience: 0.8, vehicles: 0.8, effects: 0.9 };
  private meter: AnalyserNode | null = null;
  private meterData: Float32Array | null = null;
  private paused = false;
  private muted = false;
  /** The game's own voices: which lines exist for which actor, and any already loaded. */
  private pack: Record<string, Record<string, 1>> | null = null;
  private clips = new Map<string, AudioBuffer>();
  private playing: AudioBufferSourceNode | null = null;
  private backgroundPlaying = 0;
  useVoicePack = true;
  private ambience: GainNode | null = null;
  private murmur: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private engineNodes: EngineVoice | null = null;
  private traffic: EngineVoice[] = [];
  private stepTimer = 0;
  private birdTimer = 6;
  private hornTimer = 3;
  private clinkTimer = 2;
  private voiceTimer = 0;
  private listenerYaw = 0;
  private listenerX = 0;
  private listenerZ = 0;
  private bnVoice: SpeechSynthesisVoice | null = null;
  private bnVoiceAlt: SpeechSynthesisVoice | null = null;
  /** A conversation line is being said. */
  private foreground = false;
  private speechTurn = 0;
  voiceEnabled = true;
  private volume = 0.8;

  unlock(volume: number): void {
    this.volume = volume;
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 6;
      this.master.connect(comp);
      // The compressor takes the top off, so what comes out of it can stand to be louder.
      const lift = ctx.createGain();
      lift.gain.value = 1.7;
      comp.connect(lift);
      lift.connect(ctx.destination);
      this.meter = ctx.createAnalyser();
      this.meter.fftSize = 1024;
      lift.connect(this.meter);
      this.meterData = new Float32Array(this.meter.fftSize);
      const bus = (level: number): GainNode => {
        const g = ctx.createGain();
        g.gain.value = level;
        g.connect(this.master!);
        return g;
      };
      this.voiceBus = bus(this.levels.voice);
      this.ambienceBus = bus(this.levels.ambience);
      this.vehicleBus = bus(this.levels.vehicles);
      this.effectsBus = bus(this.levels.effects);
      this.noiseBuf = this.makeNoise(3);
      this.startAmbience();
      for (let i = 0; i < TRAFFIC_VOICES; i++) this.traffic.push(this.makeVoice("car"));
    } catch {
      this.ctx = null;
    }
    this.findVoice();
    void this.loadPack();
    this.listenForWake();
  }

  /** Browsers hold sound back until someone clicks or presses a key, and can stop it again when the
   *  device changes. Any press at all brings it back, unless it was paused on purpose. */
  private listenForWake(): void {
    const wake = (): void => {
      if (this.ctx && !this.paused && this.ctx.state !== "running") void this.ctx.resume();
    };
    for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, wake, true);
    if (this.ctx) this.ctx.onstatechange = () => {
      if (this.ctx?.state !== "running") wake();
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", wake);
    wake();
  }

  /** Whether sound is getting out, for the menu and the warning on screen. */
  get status(): "none" | "muted" | "blocked" | "running" {
    if (!this.ctx) return "none";
    if (this.muted) return "muted";
    return this.ctx.state === "running" ? "running" : "blocked";
  }

  /** How loud it is right now, from 0 to 1. */
  get level(): number {
    if (!this.meter || !this.meterData || this.ctx?.state !== "running") return 0;
    this.meter.getFloatTimeDomainData(this.meterData as Float32Array<ArrayBuffer>);
    let peak = 0;
    for (const v of this.meterData) peak = Math.max(peak, Math.abs(v));
    return Math.min(1, peak);
  }

  private async loadPack(): Promise<void> {
    try {
      const res = await fetch("assets/voice/manifest.json");
      if (res.ok) this.pack = await res.json();
    } catch {
      /* the browser's voice, or text alone */
    }
  }

  get hasVoicePack(): boolean {
    return !!this.pack;
  }

  /** Sets one kind of sound's level. */
  setLevel(kind: "voice" | "ambience" | "vehicles" | "effects", v: number): void {
    this.levels[kind] = v;
    const bus = { voice: this.voiceBus, ambience: this.ambienceBus, vehicles: this.vehicleBus, effects: this.effectsBus }[kind];
    if (bus && this.ctx) bus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setMuted(on: boolean): void {
    this.muted = on;
    if (on) this.hush();
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  /** The recording of one line, loaded when first needed. Null if there isn't one. */
  private async clip(actor: string, text: string): Promise<AudioBuffer | null> {
    const ctx = this.ctx;
    const key = lineKey(text);
    if (!ctx || !this.pack?.[actor]?.[key]) return null;
    const id = `${actor}/${key}`;
    const have = this.clips.get(id);
    if (have) {
      // Most recently used goes to the back of the queue.
      this.clips.delete(id);
      this.clips.set(id, have);
      return have;
    }
    try {
      const res = await fetch(`assets/voice/${id}.mp3`);
      if (!res.ok) return null;
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      this.clips.set(id, buf);
      if (this.clips.size > MAX_CLIPS) this.clips.delete(this.clips.keys().next().value as string);
      return buf;
    } catch {
      return null;
    }
  }

  /** Plays a run of recordings one after another. Returns false if any of them doesn't exist. */
  private async playClips(parts: string[], actor: string, background: boolean, at: SpokenAt | undefined, turn: number, onEnd?: () => void): Promise<boolean> {
    const ctx = this.ctx!;
    const buffers: AudioBuffer[] = [];
    for (const part of parts) {
      const b = await this.clip(actor, part);
      if (!b) return false;
      buffers.push(b);
    }
    // Something else was said in the time that took to load.
    if (!background && turn !== this.speechTurn) return true;
    if (background && this.foreground) return true;
    let dest: AudioNode = this.voiceBus!;
    if (at) {
      const dist = Math.hypot(at.x - this.listenerX, at.z - this.listenerZ);
      const g = ctx.createGain();
      g.gain.value = Math.max(0.12, 1 - dist / 28) * (background ? 0.75 : 1);
      const p = ctx.createStereoPanner();
      p.pan.value = this.panFor(at.x, at.z) * 0.7;
      g.connect(p);
      p.connect(this.voiceBus!);
      dest = g;
    }
    let time = ctx.currentTime + 0.01;
    let last: AudioBufferSourceNode | null = null;
    for (const b of buffers) {
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.connect(dest);
      src.start(time);
      time += b.duration;
      last = src;
    }
    if (!last) return false;
    if (background) this.backgroundPlaying++;
    else this.playing = last;
    last.onended = () => {
      if (background) this.backgroundPlaying--;
      else if (this.playing === last) {
        this.playing = null;
        if (turn === this.speechTurn) this.foreground = false;
      }
      onEnd?.();
    };
    return true;
  }

  /** Spoken Bangla through the browser's own voices. The whole cast is male, so only voices known
   *  to be male are ever used: Edge lists them in Bangla script, other browsers may use Latin. If
   *  there is no male Bangla voice, nothing is spoken and the on-screen text carries the line. */
  private findVoice(): void {
    if (!("speechSynthesis" in window)) return;
    const pick = (): void => {
      const bn = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("bn"));
      this.bnVoice = bn.find((v) => MALE_BD.test(v.name)) ?? bn.find((v) => MALE_IN.test(v.name)) ?? null;
      this.bnVoiceAlt = bn.find((v) => MALE_IN.test(v.name) && v !== this.bnVoice) ?? null;
    };
    pick();
    speechSynthesis.addEventListener?.("voiceschanged", pick);
  }

  get hasBanglaVoice(): boolean {
    return !!this.bnVoice;
  }

  /** Name of the voice in use, or null when the game is showing text only. */
  get voiceName(): string | null {
    return this.bnVoice?.name ?? null;
  }

  /** Says a line in a character's voice, from the game's own recordings if it has them, and otherwise
   *  the browser's. `parts` is what's actually said when that differs from the words on screen.
   *  A background line waits its turn: it never cuts off a conversation. `onEnd` fires when it
   *  finishes, or at once if nothing will be spoken. */
  speak(shown: string, style: VoiceStyle = PLAIN_VOICE, background = false, onEnd?: () => void, at?: SpokenAt, parts?: string[]): void {
    // The voices only have Bangla: with English on screen, they still say the Bangla it came from.
    const text = spokenFor(shown);
    if (!this.voiceEnabled || this.muted || (lang === "en" && !parts && text === shown)) {
      onEnd?.();
      return;
    }
    if (background && (this.foreground || this.backgroundPlaying >= 2)) {
      onEnd?.();
      return;
    }
    if (this.useVoicePack && this.pack && style.actor && this.ctx) {
      const turn = background ? this.speechTurn : ++this.speechTurn;
      if (!background) {
        this.foreground = true;
        this.stopPlaying();
      }
      void this.playClips(parts ?? [text], style.actor, background, at, turn, onEnd).then((played) => {
        if (played) return;
        // No recording of this line: the browser says it instead, if the conversation is still on it.
        if (!background && turn !== this.speechTurn) return;
        if (!background) this.foreground = false;
        if (style.female) {
          onEnd?.();
          return;
        }
        this.speakBrowser((parts ?? [text]).join(" "), style, background, onEnd);
      });
      return;
    }
    if (style.female) {
      onEnd?.();
      return;
    }
    this.speakBrowser((parts ?? [text]).join(" "), style, background, onEnd);
  }

  private stopPlaying(): void {
    const p = this.playing;
    this.playing = null;
    if (!p) return;
    p.onended = null;
    try {
      p.stop();
    } catch {
      /* already finished */
    }
  }

  private speakBrowser(text: string, style: VoiceStyle, background: boolean, onEnd?: () => void): void {
    const skip = !this.bnVoice || !("speechSynthesis" in window) || (background && (this.foreground || speechSynthesis.speaking));
    if (skip) {
      onEnd?.();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    const voice = (style.alt && this.bnVoiceAlt) || this.bnVoice!;
    u.voice = voice;
    u.lang = voice.lang;
    u.volume = Math.min(1, this.volume * (background ? 0.55 : 1.1));
    u.rate = style.rate;
    u.pitch = style.pitch;
    // Cancelling a line reports its end later on, which mustn't clear the one that replaced it.
    const turn = background ? 0 : ++this.speechTurn;
    const done = (): void => {
      if (turn === this.speechTurn) this.foreground = false;
      onEnd?.();
    };
    u.onend = done;
    u.onerror = done;
    if (!background) {
      this.foreground = true;
      speechSynthesis.cancel();
    }
    speechSynthesis.speak(u);
  }

  /** Stops whatever is being said. */
  hush(): void {
    this.speechTurn++;
    this.foreground = false;
    this.stopPlaying();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  suspend(on: boolean): void {
    this.paused = on;
    if (!this.ctx) return;
    void (on ? this.ctx.suspend() : this.ctx.resume());
    if (on && "speechSynthesis" in window) speechSynthesis.cancel();
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    return src;
  }

  /** City bed: a low rumble of distant traffic and a band of crowd murmur. */
  private startAmbience(): void {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0.16;
    gain.connect(this.ambienceBus!);
    this.ambience = gain;
    const rumble = this.noiseSource();
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 170;
    const rg = ctx.createGain();
    rg.gain.value = 1.6;
    rumble.connect(low);
    low.connect(rg);
    rg.connect(gain);
    rumble.start();
    const murmur = this.noiseSource();
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 780;
    band.Q.value = 0.8;
    const mg = ctx.createGain();
    mg.gain.value = 0.22;
    this.murmur = mg;
    // Slow swells so the crowd never reads as static hiss.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.09;
    lfo.connect(lfoGain);
    lfoGain.connect(mg.gain);
    lfo.start();
    murmur.connect(band);
    band.connect(mg);
    mg.connect(gain);
    murmur.start();
  }

  /** Random distant events: crows, far-off horns, rickshaw bells, tea glasses. */
  updateAmbience(dt: number, night: number, nearStall: boolean): void {
    if (!this.ctx) return;
    this.birdTimer -= dt;
    this.hornTimer -= dt;
    this.clinkTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 7 + Math.random() * 16;
      if (night < 0.5) this.crow();
    }
    this.outBus = this.ambienceBus;
    if (this.hornTimer <= 0) {
      this.hornTimer = 1.2 + Math.random() * 4.5;
      const roll = Math.random();
      const pan = Math.random() * 1.6 - 0.8;
      if (roll < 0.4) this.bell(0.05 + Math.random() * 0.07, pan);
      else this.hornBlip(0.03 + Math.random() * 0.06, 340 + Math.random() * 180, 0.14 + Math.random() * 0.3, pan);
    }
    if (nearStall && this.clinkTimer <= 0) {
      this.clinkTimer = 2 + Math.random() * 5;
      this.clink();
    }
    this.outBus = null;
  }

  /** Where a one-off sound goes: the ambience while the background is being filled in. */
  private outBus: GainNode | null = null;

  private out(pan: number, bus?: GainNode | null): AudioNode {
    const to = bus ?? this.outBus ?? this.effectsBus!;
    if (pan === 0) return to;
    const p = this.ctx!.createStereoPanner();
    p.pan.value = pan;
    p.connect(to);
    return p;
  }

  /** A tea glass set down on the counter. */
  private clink(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const dest = this.out(Math.random() * 1 - 0.5);
    for (const [f, a] of [[3300, 0.05], [5100, 0.025]] as [number, number][]) {
      const o = ctx.createOscillator();
      o.frequency.value = f + Math.random() * 300;
      const g = ctx.createGain();
      g.gain.setValueAtTime(a, t);
      g.gain.exponentialRampToValueAtTime(0.0004, t + 0.12);
      o.connect(g);
      g.connect(dest);
      o.start(t);
      o.stop(t + 0.14);
    }
  }

  private crow(): void {
    const ctx = this.ctx!;
    const count = 1 + Math.floor(Math.random() * 3);
    const dest = this.out(Math.random() * 1.6 - 0.8);
    for (let i = 0; i < count; i++) {
      const t = ctx.currentTime + i * 0.42;
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(620, t);
      osc.frequency.exponentialRampToValueAtTime(420, t + 0.22);
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 1200;
      f.Q.value = 2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.26);
      osc.connect(f);
      f.connect(g);
      g.connect(dest);
      osc.start(t);
      osc.stop(t + 0.28);
    }
  }

  /** The two-note ting-ting of a rickshaw bell. */
  bell(level = 0.22, pan = 0): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const dest = this.out(pan, this.outBus ?? this.vehicleBus);
    for (let i = 0; i < 2; i++) {
      const t = ctx.currentTime + i * 0.13;
      for (const [freq, amp] of [[2650, 1], [3980, 0.5], [6100, 0.25]] as [number, number][]) {
        const o = ctx.createOscillator();
        o.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.setValueAtTime(level * amp, t);
        g.gain.exponentialRampToValueAtTime(0.0006, t + 0.32);
        o.connect(g);
        g.connect(dest);
        o.start(t);
        o.stop(t + 0.34);
      }
    }
  }

  private hornBlip(level: number, freq: number, dur: number, pan = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const dest = this.out(pan, this.outBus ?? this.vehicleBus);
    for (const mul of [1, 1.26]) {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = freq * mul;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1700;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + 0.012);
      g.gain.setValueAtTime(level, t + dur);
      g.gain.linearRampToValueAtTime(0, t + dur + 0.04);
      o.connect(lp);
      lp.connect(g);
      g.connect(dest);
      o.start(t);
      o.stop(t + dur + 0.06);
    }
  }

  horn(kind: HornKind): void {
    if (!this.ctx) return;
    if (kind === "bell") this.bell();
    else if (kind === "squeak") this.hornBlip(0.14, 720, 0.2);
    else if (kind === "airhorn") this.hornBlip(0.24, 230, 0.55);
    else this.hornBlip(0.18, 420, 0.32);
  }

  private held: { stop: () => void } | null = null;
  private nextBell = 0;

  /** The hero's own horn, sounding for as long as it's held. A rickshaw bell keeps ringing instead. */
  hornHold(kind: HornKind, on: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!on) {
      this.held?.stop();
      this.held = null;
      return;
    }
    if (kind === "bell") {
      if (ctx.currentTime >= this.nextBell) {
        this.nextBell = ctx.currentTime + 0.32;
        this.bell();
      }
      return;
    }
    if (this.held) return;
    const t = ctx.currentTime;
    const [freq, level] = kind === "squeak" ? [720, 0.3] : kind === "airhorn" ? [230, 0.5] : [420, 0.38];
    const bus = this.out(0, this.vehicleBus);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.015);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1900;
    lp.connect(g);
    g.connect(bus);
    const voices = [1, 1.26].map((mul) => {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = freq * mul;
      o.connect(lp);
      o.start(t);
      return o;
    });
    this.held = {
      stop: () => {
        const end = ctx.currentTime;
        g.gain.cancelScheduledValues(end);
        g.gain.setValueAtTime(g.gain.value, end);
        g.gain.linearRampToValueAtTime(0, end + 0.05);
        for (const o of voices) o.stop(end + 0.06);
      },
    };
  }

  /** A horn from another vehicle: quieter with distance, and placed left or right of the camera. */
  hornAt(kind: HornKind, x: number, z: number): void {
    if (!this.ctx) return;
    const dist = Math.hypot(x - this.listenerX, z - this.listenerZ);
    const near = Math.max(0.1, 1 - dist / 70);
    const pan = this.panFor(x, z);
    if (kind === "bell") this.bell(0.16 * near, pan);
    else if (kind === "squeak") this.hornBlip(0.09 * near, 720, 0.16, pan);
    else if (kind === "airhorn") this.hornBlip(0.14 * near, 230, 0.45, pan);
    else this.hornBlip(0.11 * near, 420, 0.24, pan);
  }

  private panFor(x: number, z: number): number {
    const dx = x - this.listenerX, dz = z - this.listenerZ;
    const d = Math.hypot(dx, dz) || 1;
    // The camera's right is (cos yaw, -sin yaw) in the ground plane.
    const right = (dx * Math.cos(this.listenerYaw) - dz * Math.sin(this.listenerYaw)) / d;
    return Math.max(-0.85, Math.min(0.85, right));
  }

  whistle(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(2900, t);
    const trill = ctx.createOscillator();
    trill.frequency.value = 32;
    const depth = ctx.createGain();
    depth.gain.value = 170;
    trill.connect(depth);
    depth.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.02);
    g.gain.setValueAtTime(0.16, t + 0.5);
    g.gain.linearRampToValueAtTime(0, t + 0.62);
    o.connect(g);
    g.connect(this.effectsBus!);
    o.start(t);
    trill.start(t);
    o.stop(t + 0.64);
    trill.stop(t + 0.64);
  }

  /** An officer's whistle from over there: quieter with distance, placed left or right. */
  whistleAt(x: number, z: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const dist = Math.hypot(x - this.listenerX, z - this.listenerZ);
    const level = 0.1 * Math.max(0.12, 1 - dist / 60);
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(2900, t);
    const trill = ctx.createOscillator();
    trill.frequency.value = 32;
    const depth = ctx.createGain();
    depth.gain.value = 170;
    trill.connect(depth);
    depth.connect(o.frequency);
    const g = ctx.createGain();
    const blasts = Math.random() < 0.5 ? 1 : 2;
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < blasts; i++) {
      const s = t + i * 0.42;
      g.gain.linearRampToValueAtTime(level, s + 0.02);
      g.gain.setValueAtTime(level, s + 0.26);
      g.gain.linearRampToValueAtTime(0, s + 0.33);
    }
    o.connect(g);
    g.connect(this.out(this.panFor(x, z)));
    const end = t + blasts * 0.45;
    o.start(t);
    trill.start(t);
    o.stop(end);
    trill.stop(end);
  }

  impact(strength: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this.noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900 + strength * 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4 * strength + 0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.effectsBus!);
    src.start(t);
    src.stop(t + 0.36);
    // A low thump underneath, and on a hard hit the ring of panels flexing.
    const body = ctx.createOscillator();
    body.frequency.setValueAtTime(86, t);
    body.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.4 * strength + 0.1, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    body.connect(bg);
    bg.connect(this.effectsBus!);
    body.start(t);
    body.stop(t + 0.24);
    if (strength < 0.3) return;
    for (const [f, a] of [[410, 0.05], [677, 0.04], [1130, 0.025]] as [number, number][]) {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = f * (0.94 + Math.random() * 0.12);
      const hp = ctx.createBiquadFilter();
      hp.type = "bandpass";
      hp.frequency.value = f * 1.4;
      const og = ctx.createGain();
      og.gain.setValueAtTime(a * (0.5 + strength), t);
      og.gain.exponentialRampToValueAtTime(0.0005, t + 0.2 + strength * 0.2);
      o.connect(hp);
      hp.connect(og);
      og.connect(this.effectsBus!);
      o.start(t);
      o.stop(t + 0.45);
    }
  }

  private rainGain: GainNode | null = null;

  /** The steady hiss of rain on everything. */
  setRain(k: number): void {
    if (!this.ctx) return;
    if (!this.rainGain) {
      if (k <= 0.01) return;
      const ctx = this.ctx;
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 900;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 7500;
      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = 0;
      src.connect(hp);
      hp.connect(lp);
      lp.connect(this.rainGain);
      this.rainGain.connect(this.effectsBus!);
      src.start();
    }
    this.rainGain.gain.value = k * 0.16;
  }

  /** A long roll, far away. */
  thunder(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(58, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 2.2);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 170;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.8);
    o.connect(lp);
    lp.connect(g);
    g.connect(this.effectsBus!);
    o.start(t);
    o.stop(t + 2.9);
  }

  private sirenOsc: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;

  /** The two-tone wail of an ambulance, as loud as it is close. Pass 0 when none is near. */
  siren(k: number): void {
    if (!this.ctx) return;
    if (!this.sirenOsc) {
      if (k <= 0) return;
      const ctx = this.ctx;
      this.sirenOsc = ctx.createOscillator();
      this.sirenOsc.type = "triangle";
      this.sirenGain = ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain);
      this.sirenGain.connect(this.effectsBus!);
      this.sirenOsc.start();
    }
    const t = this.ctx.currentTime;
    this.sirenOsc.frequency.setTargetAtTime(Math.floor(t * 1.4) % 2 ? 620 : 860, t, 0.04);
    this.sirenGain!.gain.setTargetAtTime(k * 0.12, t, 0.2);
  }

  /** A cheap phone's two-note ring. */
  /** For the radio, which makes its own sounds. */
  get context(): AudioContext | null {
    return this.ctx;
  }

  get musicOut(): GainNode | null {
    return this.effectsBus;
  }

  /** Paper and a coin or two changing hands. */
  cash(): void {
    const ctx = this.ctx;
    if (!ctx || !this.effectsBus || !this.noiseBuf) return;
    const t = ctx.currentTime + 0.28;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 3400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    src.connect(band);
    band.connect(g);
    g.connect(this.effectsBus);
    src.start(t, Math.random());
    src.stop(t + 0.22);
    [3100, 4300].forEach((hz, i) => {
      const at = t + 0.3 + i * 0.07;
      const o = ctx.createOscillator();
      const v = ctx.createGain();
      o.frequency.value = hz;
      v.gain.setValueAtTime(0.09, at);
      v.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
      o.connect(v);
      v.connect(this.effectsBus!);
      o.start(at);
      o.stop(at + 0.15);
    });
  }

  /** A clear two-note chime: the sound of something having worked. */
  chime(): void {
    const ctx = this.ctx;
    if (!ctx || !this.effectsBus) return;
    [660, 880].forEach((hz, i) => {
      const t = ctx.currentTime + i * 0.14;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      o.connect(g);
      g.connect(this.effectsBus!);
      o.start(t);
      o.stop(t + 0.36);
    });
  }

  ring(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = i % 2 ? 660 : 880;
      const g = ctx.createGain();
      const at = t + i * 0.2;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.05, at + 0.01);
      g.gain.setValueAtTime(0.05, at + 0.16);
      g.gain.linearRampToValueAtTime(0, at + 0.19);
      o.connect(g);
      g.connect(this.effectsBus!);
      o.start(at);
      o.stop(at + 0.2);
    }
  }

  /** Something soft and heavy being bumped. */
  thud(strength: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g);
    g.connect(this.effectsBus!);
    o.start(t);
    o.stop(t + 0.18);
  }

  /** A car door: a soft click opening, a heavier thunk closing. */
  door(closing: boolean): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this.noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = closing ? 420 : 1500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(closing ? 0.36 : 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (closing ? 0.16 : 0.08));
    src.connect(lp);
    lp.connect(g);
    g.connect(this.effectsBus!);
    src.start(t, Math.random() * 2);
    src.stop(t + 0.18);
  }

  step(level: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 420 + Math.random() * 180;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.08);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.effectsBus!);
    src.start(t, Math.random() * 2);
    src.stop(t + 0.1);
  }

  footsteps(speed: number, airborne: boolean, dt: number): void {
    if (!this.ctx || airborne || speed < 0.4) {
      this.stepTimer = 0;
      return;
    }
    this.stepTimer -= dt;
    if (this.stepTimer > 0) return;
    // Two footfalls per walk cycle, matched to the leg animation.
    this.stepTimer = speed > 3.1 ? 1.85 / speed / 2 : 0.92 / speed / 2;
    this.step(speed > 3.1 ? 0.06 : 0.035);
  }

  private makeVoice(kind: string): EngineVoice {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const noiseGain = ctx.createGain();
    const noise = this.noiseSource();
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = kind === "twostroke" ? 1300 : 500;
    noiseFilter.Q.value = 0.8;
    osc.type = kind === "electric" ? "sine" : "sawtooth";
    osc2.type = kind === "electric" ? "triangle" : "square";
    osc.connect(filter);
    osc2.connect(filter);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(this.vehicleBus!);
    osc.start();
    osc2.start();
    noise.start();
    return { gain, pan, osc, osc2, filter, noise: noiseGain, noiseSrc: noise, kind, owner: null };
  }

  private setKind(v: EngineVoice, kind: string): void {
    if (v.kind === kind) return;
    v.kind = kind;
    const electric = kind === "electric";
    v.osc.type = electric ? "sine" : "sawtooth";
    v.osc2.type = electric ? "triangle" : "square";
  }

  private driveVoice(e: EngineVoice, rev: number, load: number, level: number, pan: number): void {
    const t = this.ctx!.currentTime;
    const [base, range, cutoff, lvl, noise] = PROFILES[e.kind] ?? PROFILES.car;
    const f = base + range * rev;
    e.osc.frequency.setTargetAtTime(f, t, 0.06);
    e.osc2.frequency.setTargetAtTime(f * 0.5 + 1.5, t, 0.06);
    e.filter.frequency.setTargetAtTime(cutoff * (0.6 + rev * 0.8), t, 0.1);
    e.gain.gain.setTargetAtTime(lvl * load * (0.75 + rev * 0.5) * level, t, 0.08);
    e.noise.gain.setTargetAtTime(noise * (0.5 + rev) * 2, t, 0.1);
    e.pan.pan.setTargetAtTime(pan, t, 0.1);
  }

  /** Each vehicle class has its own synthesised engine character. */
  startEngine(kind: string): void {
    if (!this.ctx) return;
    this.stopEngine();
    if (kind === "pedal") return;
    this.engineNodes = this.makeVoice(kind);
    this.engine(0, false);
    // A quick starter churn as the engine catches.
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(70, t);
    o.frequency.linearRampToValueAtTime(150, t + 0.3);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.1, t);
    g.gain.linearRampToValueAtTime(0, t + 0.34);
    o.connect(lp);
    lp.connect(g);
    g.connect(this.vehicleBus!);
    o.start(t);
    o.stop(t + 0.36);
  }

  engine(rev: number, onThrottle: boolean): void {
    const e = this.engineNodes;
    if (!e || !this.ctx) return;
    this.driveVoice(e, rev, onThrottle ? 1 : 0.65, 1, 0);
  }

  stopEngine(): void {
    const e = this.engineNodes;
    if (!e || !this.ctx) return;
    const t = this.ctx.currentTime;
    e.gain.gain.setTargetAtTime(0, t, 0.08);
    e.osc.stop(t + 0.5);
    e.osc2.stop(t + 0.5);
    e.noiseSrc.stop(t + 0.5);
    this.engineNodes = null;
  }

  /** Gives the nearest few vehicles an audible engine, panned to where they really are. */
  updateTraffic(dt: number, vehicles: Vehicle[], x: number, z: number, yaw: number, playerVehicle: Vehicle | null): void {
    if (!this.ctx) return;
    this.listenerX = x;
    this.listenerZ = z;
    this.listenerYaw = yaw;
    this.voiceTimer -= dt;
    if (this.voiceTimer > 0) return;
    this.voiceTimer = 0.1;
    const nearby: { v: Vehicle; d: number }[] = [];
    for (const v of vehicles) {
      if (v === playerVehicle || v.spec.sound === "pedal") continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < VOICE_RANGE) nearby.push({ v, d });
    }
    nearby.sort((a, b) => a.d - b.d);
    const chosen = nearby.slice(0, this.traffic.length);
    for (let i = 0; i < this.traffic.length; i++) {
      const voice = this.traffic[i];
      const item = chosen[i];
      if (!item) {
        voice.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
        voice.owner = null;
        continue;
      }
      voice.owner = item.v;
      this.setKind(voice, item.v.spec.sound);
      const level = Math.pow(1 - item.d / VOICE_RANGE, 2) * 0.75;
      this.driveVoice(voice, item.v.speed / item.v.spec.topSpeed, 0.8, level, this.panFor(item.v.x, item.v.z));
    }
    // Crowds and streets sound busier when there is plenty going on close by.
    if (this.murmur) {
      this.murmur.gain.setTargetAtTime(0.16 + Math.min(0.2, nearby.length * 0.02), this.ctx.currentTime, 0.8);
    }
  }
}
