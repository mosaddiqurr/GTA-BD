import { JOBS, JobKey } from "../dialogue/jobs";
import type { Line } from "../dialogue/types";
import { L, T } from "../localization/bn";
import type { Vehicle } from "../vehicles/vehicle";
import type { VehicleId } from "../vehicles/vehicleData";
import { Kit, t } from "./kit";
import type { MissionDef } from "./runner";
import { uncleStall } from "./story1";

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

export const JOB_WORDS = {
  tab: L("কাজ", "Jobs"),
  start: L("শুরু করুন", "Start"),
  runs: (n: string, m: string) => L(`${n} বার, আয় ${m}`, `${n} times, earned ${m}`),
  notYou: L("এই কাজ আপনার জন্য নয়", "Not a job for you"),
  busy: L("আগে হাতের কাজটা শেষ করুন", "Finish what you're doing first"),
  paid: (m: string) => L(`মজুরি ${m}`, `Pay: ${m}`),
};

/** Puts a vehicle down beside the hero and waits for them to get on it. */
async function getOn(k: Kit, id: VehicleId, goal: Line): Promise<Vehicle> {
  const g = k.g;
  const p = g.player.position;
  const at = k.footpathNear(p.x + 5, p.z + 5);
  const v = g.traffic.spawnParkedAt(id, "default", at.x, at.z, g.player.yaw);
  if (!v) k.fail(t("বাহন পাওয়া গেল না।", "No vehicle to be had."));
  await k.reach(at.x, at.z, t("বাহন", "Vehicle"), goal, 3.5);
  await k.until(() => g.player.vehicle === v, 0.1);
  if (k.auto) g.player.takeWheel(v!);
  return v!;
}

/** Fares: wait for a passenger, take them there, get paid by how quick it was. */
function fares(key: "rickshaw" | "cng", vehicle: VehicleId, perTrip: number, trips: number): MissionDef["stages"] {
  const lines = JOBS[key];
  return [{
    run: async (k) => {
      const v = await getOn(k, vehicle, lines.goal[0]);
      const left = k.watch(() => (k.g.player.vehicle === v ? null : t("গাড়ি ছেড়ে দিলেন। কাজ শেষ।", "You left the vehicle. That's the end of the job.")));
      k.note(lines.tips[0], 4);
      for (let i = 0; i < trips; i++) {
        const from = k.away(120 + Math.random() * 90);
        const rider = k.person(pick(["npc_commuter_lychee", "npc_office_orange", "npc_student_lemon", "npc_woman_peach", "npc_elder_date"] as const), from.x, from.z, t("যাত্রী", "Passenger"));
        await k.reach(from.x, from.z, t("যাত্রী", "Passenger"), t(`যাত্রী তুলুন (${i + 1}/${trips})`, `Pick up the passenger (${i + 1}/${trips})`), 6);
        rider.who.x = rider.who.z = 1e5;
        k.note(pick(lines.customer), 4);
        const to = k.away(210 + Math.random() * 180);
        const seconds = 45 + Math.hypot(to.x - from.x, to.z - from.z) / 3.5;
        k.timer(seconds, pick(lines.complaint));
        await k.reach(to.x, to.z, t("নামার জায়গা", "Drop-off"), pick(lines.goal), 8);
        const fast = k.timeLeft / seconds;
        k.clearTimer();
        const tip = fast > 0.4 ? perTrip : 0;
        k.note(tip ? pick(lines.praise) : pick(lines.pay), 3);
        k.g.wallet.receive(perTrip + tip);
        k.g.panels.money(perTrip + tip);
        k.g.life.data.stats.earned += perTrip + tip;
      }
      left();
    },
  }];
}

function job(key: JobKey, title: Line, stages: MissionDef["stages"], rep = 1, money = 0): MissionDef {
  return { id: `job_${key}`, side: true, region: "", title, blurb: JOBS[key].offer[0], start: (k) => k.g.player.position, money, rep, stages };
}

/** Everything the hero can do for money, any time, anywhere. */
export const JOB_LIST: MissionDef[] = [
  job("tea", JOBS.tea.name, [{
    run: async (k) => {
      const lines = JOBS.tea;
      const st = k.g.city.region.id === "dhaka_mirpur10" ? uncleStall(k) : k.teaStall();
      const menu = [t("দুধ চা", "Milk tea"), t("রং চা", "Red tea"), t("চা আর বিস্কুট", "Tea and a biscuit"), t("চা আর সিঙ্গারা", "Tea and a shingara")];
      const boss = k.person("npc_tea_banana", st.x + 1.8, st.z + 1.4, t("দোকানি", "Stall owner"));
      await k.reachOnFoot(boss.x, boss.z, lines.name, lines.goal[0], 3);
      k.faceHero(boss);
      await k.talk(boss, [["o", pick(lines.offer)], ["o", pick(lines.tips)]]);
      let right = 0;
      for (let i = 0; i < 5; i++) {
        const want = Math.floor(Math.random() * menu.length);
        const who = k.person(pick(["npc_commuter_lychee", "npc_rickshaw_watermelon", "npc_office_orange", "npc_student_lemon", "npc_worker_jackfruit", "npc_woman_plum"] as const), st.x + 3.4, st.z - 1 + i * 0.6, t("খদ্দের", "Customer"));
        k.faceHero(who);
        const words = t(`${pick(lines.customer)[0]} ${menu[want][0]} দিন।`, `${pick(lines.customer)[1]} ${menu[want][1]}, please.`);
        k.objective(words);
        const got = await k.choose(who, menu, want);
        if (got === want) right++;
        k.note(got === want ? pick(lines.praise) : pick(lines.complaint), 2.2);
        who.who.x = who.who.z = 1e5;
      }
      const pay = 40 + right * 40;
      await k.talk(boss, [["o", pick(lines.pay)]]);
      k.g.wallet.receive(pay);
      k.g.panels.money(pay);
      k.g.life.data.stats.earned += pay;
    },
  }]),
  job("rickshaw", JOBS.rickshaw.name, fares("rickshaw", "rickshaw", 90, 3)),
  job("cng", JOBS.cng.name, fares("cng", "cng", 160, 3)),
  job("bus", JOBS.bus.name, [{
    run: async (k) => {
      const lines = JOBS.bus;
      const stops = [...k.g.city.busStops].sort((a, b) => Math.hypot(a.x - k.g.player.x, a.z - k.g.player.z) - Math.hypot(b.x - k.g.player.x, b.z - k.g.player.z)).slice(0, 3);
      let total = 0;
      for (let i = 0; i < stops.length; i++) {
        const s = stops[i];
        await k.doAt(s.x + 1.5, s.z + 1.5, 0.16, t("যাত্রী ডাকুন", "Call the passengers"), lines.goal[i % lines.goal.length], 3.4);
        k.note(pick(lines.customer), 2.4);
        const rider = k.person("npc_commuter_lychee", s.x + 3, s.z + 2, t("যাত্রী", "Passenger"));
        k.faceHero(rider);
        const fares_ = [t("বিশ টাকা", "Twenty taka"), t("দশ টাকা", "Ten taka"), t("পঞ্চাশ টাকা", "Fifty taka")];
        const got = await k.choose(rider, fares_, 0);
        k.note(got === 0 ? pick(lines.praise) : pick(lines.complaint), 2.4);
        if (got === 0) total += 70;
        rider.who.x = rider.who.z = 1e5;
      }
      k.note(pick(lines.pay), 3);
      k.g.wallet.receive(total + 60);
      k.g.panels.money(total + 60);
      k.g.life.data.stats.earned += total + 60;
    },
  }]),
  job("food", JOBS.food.name, [{
    run: async (k) => {
      const lines = JOBS.food;
      const v = await getOn(k, "bicycle", lines.goal[0]);
      void v;
      let total = 0;
      for (let i = 0; i < 3; i++) {
        const shop = k.away(110);
        await k.reach(shop.x, shop.z, t("খাবার নিন", "Pick up the food"), t(`দোকান থেকে খাবার নিন (${i + 1}/3)`, `Collect the food from the shop (${i + 1}/3)`), 6);
        const home = k.away(260);
        k.timer(85, pick(lines.late));
        await k.reach(home.x, home.z, t("ঠিকানা", "The address"), pick(lines.goal), 6);
        const tip = k.timeLeft > 30 ? 40 : 0;
        k.clearTimer();
        k.note(tip ? pick(lines.praise) : pick(lines.customer), 3);
        total += 80 + tip;
      }
      k.g.wallet.receive(total);
      k.g.panels.money(total);
      k.g.life.data.stats.earned += total;
    },
  }]),
  job("courier", JOBS.courier.name, [{
    run: async (k) => {
      const lines = JOBS.courier;
      let total = 0;
      for (let i = 0; i < 3; i++) {
        const to = k.away(190 + i * 40);
        k.timer(110, pick(lines.late));
        await k.reachOnFoot(to.x, to.z, t("পার্সেল", "Parcel"), t(`পার্সেল পৌঁছে দিন (${i + 1}/3)`, `Deliver the parcel (${i + 1}/3)`), 3);
        k.clearTimer();
        k.note(pick(lines.customer), 3);
        total += 150;
      }
      k.note(pick(lines.pay), 3);
      k.g.wallet.receive(total);
      k.g.panels.money(total);
      k.g.life.data.stats.earned += total;
    },
  }]),
  job("porter", JOBS.porter.name, [{
    run: async (k) => {
      const lines = JOBS.porter;
      const m = k.block("market");
      const hasRope = (k.g.wallet.items.rope ?? 0) > 0;
      let total = 0;
      k.note(pick(lines.tips), 3.5);
      for (let i = 0; i < 3; i++) {
        await k.doAt(m.x - 12 + i * 3, m.z + 1, 0.16, t("বস্তা তুলুন", "Lift the sack"), lines.goal[0], 3);
        k.g.player.loadPace = hasRope ? 0.74 : 0.62;
        const to = k.away(70);
        await k.reachOnFoot(to.x, to.z, t("দোকান", "The shop"), t(`ভারী বস্তা দোকানে দিন (${i + 1}/3)`, `Take the heavy sack to the shop (${i + 1}/3)`), 3);
        k.g.player.loadPace = 1;
        k.g.life.stamina = Math.max(0, k.g.life.stamina - 25);
        k.note(pick(lines.customer), 2.6);
        total += hasRope ? 110 : 90;
      }
      k.g.wallet.receive(total);
      k.g.panels.money(total);
      k.g.life.data.stats.earned += total;
    },
  }]),
  job("ambulance", JOBS.ambulance.name, [{
    run: async (k) => {
      const lines = JOBS.ambulance;
      const v = await getOn(k, "ambulance", lines.goal[0]);
      v.flashing = true;
      let total = 0;
      const clinic = k.inside("clinic");
      for (let i = 0; i < 2; i++) {
        const at = k.away(300);
        await k.reach(at.x, at.z, t("রোগী", "Patient"), t("রোগীর কাছে পৌঁছান", "Get to the patient"), 8);
        k.note(pick(lines.customer), 3);
        k.timer(90, pick(lines.late));
        await k.reach(clinic.outX, clinic.outZ, t("ক্লিনিক", "Clinic"), t("দ্রুত ক্লিনিকে যান", "Get to the clinic fast"), 10);
        k.clearTimer();
        k.note(pick(lines.praise), 3);
        total += 280;
      }
      v.flashing = false;
      k.g.wallet.receive(total);
      k.g.panels.money(total);
      k.g.life.data.stats.earned += total;
      k.g.life.addRep(2);
    },
  }]),
];

export function jobName(m: MissionDef): string {
  return T(m.title);
}
