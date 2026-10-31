import { RADIO } from "../dialogue/radio";
import type { Line } from "../dialogue/types";
import { L, T } from "../localization/bn";
import type { AudioSystem, VoiceStyle } from "./audio";

const STATIONS = [L("রেডিও বন্ধ", "Radio off"), L("ঢাকা বাতাস: খবর আর আড্ডা", "Dhaka Breeze: news and chat"), L("মেঠো সুর: দোতারার গান", "Field Tunes: dotara music"), L("রিকশা বিট: শহরের তাল", "Rickshaw Beat: city rhythm")];
const SCALE = [146.8, 164.8, 174.6, 196, 220, 233.1, 261.6, 293.7];
const VOICE: VoiceStyle = { pitch: 1, rate: 1.04, actor: "mid" };
const DJ: VoiceStyle = { pitch: 1.1, rate: 1.05, actor: "young" };

/** A car radio that needs no recordings: the talk's in the game's own voices, and the music's played here, note by note. */
export class Radio {
  station = 0;
  private bus: GainNode | null = null;
  private nextNote = 0;
  private step = 0;
  private talkIn = 2;
  private seen = new Map<readonly Line[], number>();
  private clock = 0;
  /** Words from the talk station, for the bottom of the screen. */
  onWords: ((text: string) => void) | null = null;

  constructor(private audio: AudioSystem) {}

  /** N: on to the next station. */
  next(): string {
    this.station = (this.station + 1) % STATIONS.length;
    this.step = 0;
    this.talkIn = 0.6;
    return STATIONS[this.station];
  }

  off(): void {
    this.station = 0;
  }

  private bucket(): GainNode | null {
    const ctx = this.audio.context;
    if (!ctx) return null;
    if (!this.bus) {
      this.bus = ctx.createGain();
      this.bus.gain.value = 0.42;
      this.bus.connect(this.audio.musicOut!);
    }
    return this.bus;
  }

  private pluck(ctx: AudioContext, at: number, hz: number, length: number, level: number, type: OscillatorType): void {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = hz;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + length);
    o.connect(g);
    g.connect(this.bus!);
    o.start(at);
    o.stop(at + length + 0.02);
  }

  private thump(ctx: AudioContext, at: number, hz: number, level: number): void {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(hz * 2, at);
    o.frequency.exponentialRampToValueAtTime(hz, at + 0.07);
    g.gain.setValueAtTime(level, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
    o.connect(g);
    g.connect(this.bus!);
    o.start(at);
    o.stop(at + 0.24);
  }

  /** A wandering tune over a drone, like a dotara on a riverbank. */
  private folk(ctx: AudioContext): void {
    const beat = 0.27;
    while (this.nextNote < ctx.currentTime + 0.5) {
      const at = Math.max(this.nextNote, ctx.currentTime + 0.01);
      const s = this.step++;
      const phrase = [0, 2, 4, 5, 4, 2, 3, 1, 0, 2, 4, 7, 6, 4, 2, 0];
      const degree = phrase[s % 16] + (Math.floor(s / 32) % 2 ? 1 : 0);
      if (s % 16 !== 7 && s % 16 !== 15) this.pluck(ctx, at, SCALE[degree % 8] * 2, 0.5, 0.2, "triangle");
      if (s % 4 === 0) this.pluck(ctx, at, SCALE[0], 1.1, 0.13, "sine");
      if (s % 8 === 2 || s % 8 === 6) this.thump(ctx, at, 110, 0.25);
      this.nextNote = at + beat;
    }
  }

  private beat(ctx: AudioContext): void {
    const beat = 0.2;
    while (this.nextNote < ctx.currentTime + 0.5) {
      const at = Math.max(this.nextNote, ctx.currentTime + 0.01);
      const s = this.step++;
      if (s % 4 === 0) this.thump(ctx, at, 58, 0.55);
      if (s % 8 === 4) this.pluck(ctx, at, 900, 0.09, 0.09, "square");
      const bass = [0, 0, 3, 0, 4, 0, 2, 1][Math.floor(s / 2) % 8];
      if (s % 2 === 0) this.pluck(ctx, at, SCALE[bass] / 2, 0.2, 0.18, "sawtooth");
      if (s % 16 === 10 || s % 16 === 13) this.pluck(ctx, at, SCALE[(s >> 2) % 8] * 2, 0.28, 0.1, "triangle");
      this.nextNote = at + beat;
    }
  }

  private next_(list: readonly Line[]): string {
    const n = this.seen.get(list) ?? Math.floor(Math.random() * list.length);
    this.seen.set(list, n + 1);
    return T(list[n % list.length]);
  }

  /** `listening` is false when the hero's got no radio to hear, and the music fades away. */
  update(dt: number, listening: boolean, rain: boolean): void {
    this.clock += dt;
    const ctx = this.audio.context;
    if (!ctx) return;
    const on = listening && this.station > 0;
    if (this.bus) this.bus.gain.setTargetAtTime(on && this.station !== 1 ? 0.42 : 0, ctx.currentTime, 0.2);
    if (!on) return;
    if (!this.bucket()) return;
    if (this.station === 2) this.folk(ctx);
    else if (this.station === 3) this.beat(ctx);
    else {
      this.talkIn -= dt;
      if (this.talkIn > 0) return;
      this.talkIn = 7 + Math.random() * 5;
      const r = Math.random();
      const list = r < 0.36 ? RADIO.news : r < 0.56 ? RADIO.ads : r < 0.7 ? RADIO.scamTips : r < 0.8 ? RADIO.talk : r < 0.9 ? RADIO.traffic : rain ? RADIO.weather.rain : RADIO.weather.clear;
      const text = this.next_(list);
      this.onWords?.(text);
      this.audio.speak(text, list === RADIO.ads ? DJ : VOICE, true);
    }
  }
}
