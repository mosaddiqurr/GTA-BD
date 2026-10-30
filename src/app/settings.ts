export type QualityName = "auto" | "low" | "medium" | "high" | "ultra";
export type TimeName = "morning" | "noon" | "golden" | "dusk" | "night";

export interface Settings {
  version: 1;
  quality: QualityName;
  time: TimeName;
  sensitivity: number;
  volume: number;
  showFps: boolean;
  voice: boolean;
}

const KEY = "bow.settings.v1";
const DEFAULTS: Settings = { version: 1, quality: "auto", time: "golden", sensitivity: 1, volume: 0.8, showFps: false, voice: true };

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
