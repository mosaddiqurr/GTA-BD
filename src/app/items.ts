import { L } from "../localization/bn";

export type ItemKind =
  /** Eaten or drunk there and then, or kept in the bag for later. */
  | "food"
  | "medicine"
  /** Opens to be read. */
  | "read"
  /** Put on. */
  | "wear"
  /** Comes out by itself when it rains. */
  | "rain"
  /** Cooked at home into a proper meal. */
  | "raw"
  /** Something done for the hero on the spot: paid for, done, and nothing to carry away. */
  | "service"
  /** Taken home, where it makes the place better. */
  | "home"
  /** Does something for the phone. */
  | "phone"
  /** Just useful to have about, or to give away. */
  | "thing";

export interface ItemDef {
  kind: ItemKind;
  heal?: number;
  breath?: number;
  /** How long eating or drinking it takes, in seconds. */
  seconds?: number;
  /** What it says when used. */
  note?: string;
  /** How much better people think of you for it, the first time. */
  rep?: number;
  /** How far the clock moves while it's done, in game hours. */
  takes?: number;
}

const food = (heal: number, breath: number, seconds = 1.8): ItemDef => ({ kind: "food", heal, breath, seconds });

export const ITEMS: Record<string, ItemDef> = {
  // Quick bites
  teacup: food(4, 25, 2.4),
  hotelTea: food(5, 30, 2.4),
  biscuit: food(3, 8),
  bun: food(6, 10),
  chips: food(3, 6),
  shingara: food(7, 10),
  chotpoti: food(10, 10),
  fuchka: food(10, 12),
  jhalmuri: food(7, 10),
  bhapa: food(8, 10),
  chitoi: food(8, 10),
  paan: food(1, 15, 1.2),
  sweetPaan: food(2, 15, 1.2),
  rosogolla: food(6, 10),
  jilapi: food(6, 10),
  shondesh: food(7, 10),
  guava: food(5, 8),
  mango: food(8, 10),
  banana: food(8, 12),
  // Drinks
  water: food(2, 30, 1.2),
  coconut: food(10, 40, 2.4),
  cane: food(8, 35, 2),
  // Meals
  riceDal: food(22, 25, 3.5),
  riceFish: food(32, 30, 3.5),
  tehari: food(38, 30, 3.5),
  kacchi: food(50, 35, 4),
  // Medicine
  saline: { kind: "medicine", heal: 15, breath: 50, seconds: 1.8, note: L("স্যালাইনে শরীরটা ফিরল।", "The saline brings you round.") },
  para: { kind: "medicine", heal: 15, seconds: 1.2, note: L("মাথাব্যথাটা কমে গেল।", "The headache eases off.") },
  bandage: { kind: "medicine", heal: 12, seconds: 1.5, note: L("ব্যথার জায়গাটা বেঁধে নিলেন।", "You strap up the sore spot.") },
  medicine: { kind: "medicine", heal: 30, seconds: 1.5, note: L("ওষুধে অনেকটা ভালো লাগছে।", "The medicine helps a lot.") },
  // Done on the spot
  checkup: { kind: "service", heal: 100, takes: 0.5, note: L("ডাক্তার দেখে ওষুধ দিলেন। একদম ঠিক হয়ে গেছেন।", "The doctor sees to you. You're right as rain.") },
  bloodTest: { kind: "service", heal: 25, takes: 0.8, note: L("রিপোর্ট ভালো। চিন্তার কিছু নেই।", "The report's fine. Nothing to worry about.") },
  bpCheck: { kind: "service", heal: 5, takes: 0.1, note: L("প্রেসার ঠিক আছে।", "Your blood pressure's fine.") },
  haircut: { kind: "service", rep: 2, takes: 0.4, note: L("চুল কেটে বেশ ভদ্র লাগছে।", "A haircut. You look quite respectable.") },
  shave: { kind: "service", rep: 1, takes: 0.2, note: L("দাড়ি কামিয়ে মুখটা হালকা লাগছে।", "A clean shave, and a lighter face.") },
  polish: { kind: "service", rep: 1, takes: 0.1, note: L("জুতা চকচক করছে।", "Your shoes are gleaming.") },
  stitchShoe: { kind: "service", rep: 1, takes: 0.2, note: L("জুতা আবার হাঁটার মতো হলো।", "Your shoes are fit to walk in again.") },
  stitchShirt: { kind: "service", rep: 2, takes: 0.3, note: L("নতুন জামা গায়ে ঠিকঠাক বসেছে।", "The new shirt fits just right.") },
  photocopy: { kind: "service", takes: 0.05, note: L("কাগজপত্রের কপি হয়ে গেল।", "Your papers are copied.") },
  photo: { kind: "service", takes: 0.1, note: L("ছবি হাতে পেলেন। লাইসেন্সের জন্য কাজে লাগবে।", "Photos in hand, useful for the licence.") },
  depositSlip: { kind: "service", takes: 0.05, note: L("জমা স্লিপ পূরণ হলো। এখন ফোনের ব্যাংকে টাকা জমা দিতে পারবেন।", "Slip filled in. You can pay in through the phone's bank.") },
  hotelRoom: { kind: "service", heal: 100, breath: 100, takes: 8, note: L("নরম বিছানায় ঘুম। সকালে ঝরঝরে লাগছে।", "A soft bed all night, and you wake up fresh.") },
  screenFix: { kind: "service", takes: 0.5, note: L("ফোনের স্ক্রিন নতুনের মতো।", "Your phone screen is as good as new.") },
  recharge: { kind: "phone", note: L("ফোনে কথা বলার টাকা ভরা হলো।", "Your phone's topped up for calls.") },
  sim: { kind: "phone", note: L("নতুন সিম। ঠকবাজরা নতুন নম্বর জানে না, কিছুদিন শান্তি।", "A new SIM. The scammers don't have this number, so you get some peace.") },
  charger: { kind: "phone", note: L("চার্জার। ফোনের চার্জ আর ফুরাবে না।", "A charger. Your phone won't run down now.") },
  earphone: { kind: "phone", note: L("ইয়ারফোন। এখন হাঁটতে হাঁটতেও রেডিও শোনা যাবে: N চাপুন।", "Earphones. Now you can hear the radio on foot: press N.") },
  // To read
  storybook: { kind: "read" },
  paper: { kind: "read" },
  magazine: { kind: "read" },
  khata: { kind: "read" },
  pen: { kind: "thing", note: L("কলম। খাতায় নিজের শেখা জিনিস লিখে রাখেন।", "A pen. It's what your notes get written with.") },
  // To put on
  tshirt: { kind: "wear", rep: 1 },
  shirt: { kind: "wear", rep: 3 },
  panjabi: { kind: "wear", rep: 4 },
  lungi: { kind: "wear", rep: 1 },
  gamcha: { kind: "wear", rep: 1 },
  usedShirt: { kind: "wear" },
  usedJacket: { kind: "wear", rep: 1 },
  sandal: { kind: "wear", rep: 1 },
  shoes: { kind: "wear", rep: 3 },
  sari: { kind: "wear", rep: 4 },
  orna: { kind: "wear", rep: 2 },
  ring: { kind: "thing", note: L("ছোট সোনার আংটি। কেউ বিপদে পড়লে কাজে লাগবে, বা কাউকে উপহার দিন।", "A little gold ring. Keep it for a rainy day, or give it to someone.") },
  umbrella: { kind: "rain", note: L("বৃষ্টি নামলে ছাতা নিজেই খুলে যাবে।", "It'll come out by itself when it rains.") },
  raincoat: { kind: "rain", note: L("বৃষ্টি নামলে রেইনকোট গায়ে উঠবে।", "You'll put it on when it rains.") },
  // To cook at home
  hilsa: { kind: "raw" },
  rui: { kind: "raw" },
  shrimp: { kind: "raw" },
  beef: { kind: "raw" },
  chicken: { kind: "raw" },
  potato: { kind: "raw" },
  chili: { kind: "raw" },
  pumpkin: { kind: "raw" },
  // For the home
  fan: { kind: "home", note: L("ফ্যানটা ঘরে থাকবে। গরমে ঘুম ভালো হবে।", "It stays at home. You'll sleep better in the heat.") },
  kettle: { kind: "home", note: L("কেটলিটা ঘরে থাকবে। ঘরে বসেই চা খেতে পারবেন।", "It stays at home. Now you can make tea there.") },
  sapling: { kind: "home", note: L("চারাগাছটা ঘরের বারান্দায় লাগালেন।", "You plant it on your balcony.") },
  flowerpot: { kind: "home", note: L("ফুলের টবটা জানালায় রাখলেন। ঘরটা হাসছে।", "The flowerpot goes in the window. The room looks happier.") },
  // Bits and pieces
  soap: { kind: "food", heal: 4, seconds: 1.5, note: L("হাত মুখ ধুয়ে ঝরঝরে লাগছে।", "A wash, and you feel fresh.") },
  rope: { kind: "thing", note: L("দড়ি। মালপত্র বাঁধতে: মিনতির কাজে একটু বেশি বইতে পারবেন।", "Rope, for tying loads: you can carry a bit more as a porter.") },
  lock: { kind: "thing", note: L("তালা। সাইকেলে লাগালে কেউ নিতে পারবে না।", "A lock. Nobody can take your bicycle with this on it.") },
  torch: { kind: "thing", note: L("টর্চ। রাতে পায়ের সামনে আলো দেখায়।", "A torch. It lights the ground in front of you at night.") },
};

export function itemOf(key: string): ItemDef {
  return ITEMS[key] ?? { kind: "thing" };
}

/** A meal cooked at home does more than anything from a stall. */
export const COOKED_HEAL = 55;
