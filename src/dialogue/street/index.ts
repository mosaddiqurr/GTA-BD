import type { RoleTalk } from "../types";
import { BOSS } from "./boss";
import { CNG } from "./cng";
import { COMMUTER } from "./commuter";
import { DOCTOR } from "./doctor";
import { ELDER } from "./elder";
import { GIRL_PEAR } from "./girlPear";
import { GRANNY_FIG } from "./grannyFig";
import { GUARD } from "./guard";
import { KID_BERRY } from "./kidBerry";
import { OFFICE } from "./office";
import { POLICE } from "./police";
import { RICKSHAW } from "./rickshaw";
import { SHOP } from "./shop";
import { STUDENT } from "./student";
import { SWEEPER } from "./sweeper";
import { TEA } from "./tea";
import { VENDOR } from "./vendor";
import { WOMAN_APPLE } from "./womanApple";
import { WOMAN_PEACH } from "./womanPeach";
import { WOMAN_PLUM } from "./womanPlum";
import { WORKER } from "./worker";

/** What each member of the cast has to say for themselves. */
export const ROLE_TALK: Record<string, RoleTalk> = {
  npc_rickshaw_watermelon: RICKSHAW,
  npc_tea_banana: TEA,
  npc_shop_papaya: SHOP,
  npc_vendor_pineapple: VENDOR,
  npc_cng_guava: CNG,
  npc_worker_jackfruit: WORKER,
  npc_sweeper_tamarind: SWEEPER,
  npc_student_lemon: STUDENT,
  npc_office_orange: OFFICE,
  npc_elder_date: ELDER,
  npc_commuter_lychee: COMMUTER,
  npc_doctor_kiwi: DOCTOR,
  npc_guard_melon: GUARD,
  npc_boss_quince: BOSS,
  npc_police_coconut: POLICE,
  npc_woman_apple: WOMAN_APPLE,
  npc_woman_peach: WOMAN_PEACH,
  npc_woman_plum: WOMAN_PLUM,
  npc_girl_pear: GIRL_PEAR,
  npc_kid_berry: KID_BERRY,
  npc_granny_fig: GRANNY_FIG,
};
