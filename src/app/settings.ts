export type QualityName = "auto" | "low" | "medium" | "high" | "ultra";
export type TimeName = "morning" | "noon" | "golden" | "dusk" | "night";
export type DayPace = "stop" | "slow" | "normal" | "fast";

export interface Settings {
  version: 1;
  quality: QualityName;
  time: TimeName;
  sensitivity: number;
  volume: number;
  showFps: boolean;
  voice: boolean;
  /** Share of the normal number of people on the streets, and of vehicles on the roads. */
  crowd: number;
  traffic: number;
  /** How fast the day passes. */
  dayPace: DayPace;
  /** Separate levels under the main volume. */
  soundVoice: number;
  soundAmbience: number;
  soundVehicles: number;
  soundEffects: number;
  muted: boolean;
  /** Words over people's heads and along the bottom of the screen. */
  subtitles: boolean;
  /** Which voices: the game's own AI voice pack, or the browser's. */
  voiceKind: "pack" | "browser";
  rain: "never" | "rare" | "normal" | "often";
  uiSize: "auto" | "small" | "medium" | "large" | "xlarge";
  subtitleSize: "small" | "medium" | "large";
  minimap: boolean;
  invertY: boolean;
  autoFollow: boolean;
  shake: boolean;
  autosave: boolean;
  brightness: number;
  sharpness: number;
  drawDistance: "near" | "mid" | "far";
  /** Which view on foot and in vehicles: behind the hero, or through their eyes. */
  viewFoot: "third" | "first";
  viewDrive: "third" | "first";
  /** For testing: no missions, jobs or scam calls. */
  missionsOff: boolean;
}

const KEY = "bow.settings.v1";
const DEFAULTS: Settings = { version: 1, quality: "auto", time: "golden", sensitivity: 1, volume: 0.8, showFps: false, voice: true, crowd: 1, traffic: 1, dayPace: "normal", soundVoice: 1, soundAmbience: 0.8, soundVehicles: 0.8, soundEffects: 0.9, muted: false, subtitles: true, voiceKind: "pack", rain: "normal", uiSize: "auto", subtitleSize: "medium", minimap: true, invertY: false, autoFollow: true, shake: true, autosave: true, brightness: 1, sharpness: 1, drawDistance: "mid", viewFoot: "third", viewDrive: "third", missionsOff: false };

// Storage can throw in private windows, so settings must survive without it.
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.version === 1) return { ...DEFAULTS, ...parsed };
    }
  } catch {
    /* defaults are fine */
  }
  return { ...DEFAULTS };
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* preference simply isn't remembered */
  }
}
