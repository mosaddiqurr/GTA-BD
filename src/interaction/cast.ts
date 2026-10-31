import type { VoiceStyle } from "../audio/audio";
import { TalkRole, bn } from "../localization/bn";

/** How each kind of person sounds. Until real recordings arrive these are the browser's two male
 *  Bangla voices, varied by pitch and pace so that people don't all sound alike. */
const VOICES: Record<string, VoiceStyle> = {
  hero_mango: { pitch: 1.04, rate: 1.03, actor: "hero" },
  conductor: { pitch: 1.1, rate: 1.1, actor: "young" },
  npc_student_lemon: { pitch: 1.14, rate: 1.1, actor: "young" },
  npc_office_orange: { pitch: 1, rate: 1.04, actor: "mid" },
  npc_elder_date: { pitch: 0.82, rate: 0.9, alt: true, actor: "elder" },
  npc_shop_papaya: { pitch: 0.96, rate: 1, alt: true, actor: "seller" },
  npc_commuter_lychee: { pitch: 1.06, rate: 1.05, actor: "young" },
  npc_worker_jackfruit: { pitch: 0.86, rate: 0.98, actor: "deep" },
  npc_vendor_pineapple: { pitch: 1.02, rate: 1.08, alt: true, actor: "seller" },
  npc_tea_banana: { pitch: 1.08, rate: 1.06, alt: true, actor: "seller" },
  npc_cng_guava: { pitch: 0.92, rate: 1.06, actor: "mid" },
  npc_rickshaw_watermelon: { pitch: 0.94, rate: 1, alt: true, actor: "seller" },
  npc_police_coconut: { pitch: 0.88, rate: 0.98, actor: "deep" },
  npc_doctor_kiwi: { pitch: 0.98, rate: 1, actor: "mid" },
  npc_guard_melon: { pitch: 0.86, rate: 0.96, actor: "deep" },
  npc_sweeper_tamarind: { pitch: 0.92, rate: 0.98, actor: "seller" },
  npc_boss_quince: { pitch: 0.94, rate: 1.05, actor: "mid" },
  npc_kid_berry: { pitch: 1.3, rate: 1.14, actor: "kid", female: false },
  npc_woman_apple: { pitch: 1.3, rate: 1, actor: "woman", female: true },
  npc_woman_peach: { pitch: 1.36, rate: 1.04, actor: "woman", female: true },
  npc_woman_plum: { pitch: 1.26, rate: 1, actor: "woman", female: true },
  npc_girl_pear: { pitch: 1.48, rate: 1.12, actor: "girl", female: true },
  npc_granny_fig: { pitch: 1.14, rate: 0.92, actor: "granny", female: true },
};

/** Everyone in the game's voice pack, and which of them each kind of person uses. */
export const ACTORS = ["hero", "young", "mid", "deep", "elder", "seller", "woman", "girl", "granny", "kid"];
export const ACTOR_OF: Record<string, string> = Object.fromEntries(Object.entries(VOICES).map(([id, v]) => [id, v.actor ?? "mid"]));

/** The hero speaks in the voice of whoever they're playing. */
export function setHeroVoice(id: string): void {
  if (VOICES[id]) VOICES.hero_mango = VOICES[id];
}

export function voiceOf(id: string): VoiceStyle {
  return VOICES[id] ?? VOICES.npc_office_orange;
}

export function roleOf(id: string): TalkRole {
  return bn.talk.roles[id] ?? bn.talk.roles.npc_commuter_lychee;
}

/** How long a line stays up if nothing else decides, in seconds: about a reading pace. */
export function lineSeconds(text: string): number {
  return Math.max(1.6, Math.min(7, text.length * 0.075));
}
