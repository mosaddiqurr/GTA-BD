import type { Vehicle } from "../vehicles/vehicle";

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

/** All game sound is synthesised at runtime with Web Audio: no recordings, so no rights
 *  issues and nothing to download. It unlocks from the Play button, and if the browser
 *  refuses audio entirely the game simply runs silent. */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
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
      this.master.gain.value = volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 6;
      this.master.connect(comp);
      comp.connect(ctx.destination);
      this.noiseBuf = this.makeNoise(3);
      this.startAmbience();
      for (let i = 0; i < TRAFFIC_VOICES; i++) this.traffic.push(this.makeVoice("car"));
    } catch {
      this.ctx = null;
    }
    this.findVoice();
  }

  /** Spoken Bangla through the browser's own voices, where it has one. Edge ships a Bangladeshi
   *  Bangla voice; elsewhere the game simply shows the subtitle. */
  private findVoice(): void {
    if (!("speechSynthesis" in window)) return;
    const pick = (): void => {
      const voices = speechSynthesis.getVoices();
      const bn = voices.filter((v) => v.lang.toLowerCase().startsWith("bn"));
      this.bnVoice = bn.find((v) => /bd/i.test(v.lang) && /pradeep/i.test(v.name)) ?? bn.find((v) => /bd/i.test(v.lang)) ?? bn[0] ?? null;
    };
    pick();
    speechSynthesis.addEventListener?.("voiceschanged", pick);
  }

  get hasBanglaVoice(): boolean {
    return !!this.bnVoice;
  }

  speak(text: string): void {
    if (!this.voiceEnabled || !this.bnVoice || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.voice = this.bnVoice;
    u.lang = this.bnVoice.lang;
    u.volume = Math.min(1, this.volume * 1.1);
    u.rate = 1.02;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  suspend(on: boolean): void {
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
    gain.connect(this.master!);
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
  }

  private out(pan: number): AudioNode {
    if (pan === 0) return this.master!;
    const p = this.ctx!.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.master!);
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
    const dest = this.out(pan);
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
    const dest = this.out(pan);
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
    g.connect(this.master!);
    o.start(t);
    trill.start(t);
    o.stop(t + 0.64);
    trill.stop(t + 0.64);
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
    g.gain.setValueAtTime(0.32 * strength + 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master!);
    src.start(t);
    src.stop(t + 0.3);
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
    g.connect(this.master!);
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
    g.connect(this.master!);
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
    pan.connect(this.master!);
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
    g.connect(this.master!);
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
