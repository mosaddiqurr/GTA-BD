// All player-facing text lives here so an English pack can be added later.
export const bn = {
  title: "বাংলাদেশ ওপেন ওয়ার্ল্ড",
  subtitle: "মিরপুর ১০, ঢাকা",
  build: "দ্বিতীয় সংস্করণ",
  play: "খেলা শুরু করুন",
  resume: "চালিয়ে যান",
  loading: "লোড হচ্ছে",
  paused: "বিরতি",
  settings: "সেটিংস",
  graphics: "গ্রাফিক্সের মান",
  time: "দিনের সময়",
  sensitivity: "মাউসের গতি",
  volume: "শব্দ",
  fps: "এফপিএস দেখান",
  respawn: "নিরাপদ জায়গায় ফিরে যান",
  controlsTitle: "নিয়ন্ত্রণ",
  on: "চালু",
  off: "বন্ধ",
  quality: {
    auto: "অটো",
    low: "কম",
    medium: "মাঝারি",
    high: "উচ্চ",
    ultra: "সর্বোচ্চ",
  },
  times: {
    morning: "সকাল",
    noon: "দুপুর",
    golden: "বিকাল",
    dusk: "সন্ধ্যা",
    night: "রাত",
  },
  controls: [
    ["W A S D", "হাঁটা / চালানো"],
    ["Shift", "দৌড়ানো"],
    ["Space", "লাফ / হ্যান্ডব্রেক"],
    ["F", "গাড়িতে ওঠা / নামা"],
    ["G", "যাত্রী হয়ে ওঠা"],
    ["V", "গাড়ি বেছে নেওয়া"],
    ["E", "কথা বলা"],
    ["H", "হর্ন / বেল"],
    ["মাউস", "ক্যামেরা ঘোরানো"],
    ["C", "ক্যামেরার দূরত্ব"],
    ["T", "দিনের সময় বদলানো"],
    ["R", "নিরাপদ জায়গায় ফেরা"],
    ["Esc", "বিরতি"],
  ] as [string, string][],
  // Bangla locative endings differ by word, so each vehicle has its own written form.
  promptEnter: (id: string) => `<kbd>F</kbd> ${bn.vehiclesIn[id] ?? bn.vehicles[id]} উঠুন`,
  promptExit: "<kbd>F</kbd> নামুন",
  promptRide: "<kbd>G</kbd> যাত্রী হয়ে উঠুন",
  promptRideBus: (route: string) => `<kbd>G</kbd> ${route} বাসে উঠুন`,
  paints: {
    default: "আসল রং", white: "সাদা", silver: "রুপালি", red: "লাল", black: "কালো", taxi: "ট্যাক্সি", blue: "নীল", green: "সবুজ", yellow: "হলুদ", art2: "নকশা ২", art3: "নকশা ৩",
  } as Record<string, string>,
  busPassengers: ["ওস্তাদ নামলো কেন? নতুন ড্রাইভার নাকি?", "আরে ভাই, বাস কই যায় তাহলে?", "ঠিক আছে, আপনিই চালান। আস্তে কিন্তু!"],
  promptStop: "<kbd>F</kbd> থামতে বলুন",
  askStop: "মামা, এখানে একটু রাখেন!",
  vehicleFull: "ভাই, ভেতরে আর জায়গা নেই!",
  chooserTitle: "গাড়ি বেছে নিন",
  chooserHint: "যে গাড়ি চান বেছে নিন, আপনার সামনে চলে আসবে",
  paint: "রং",
  bring: "আনুন",
  close: "বন্ধ করুন",
  voice: "বাংলা কণ্ঠ",
  gpuHint: "গেমটি ল্যাপটপের দুর্বল গ্রাফিক্সে চলছে। আরও মসৃণ ও স্পষ্ট ছবির জন্য Windows Settings → Display → Graphics থেকে ব্রাউজারকে High performance করুন।",
  promptTalk: "<kbd>E</kbd> কথা বলুন",
  promptTea: "<kbd>E</kbd> চা খান",
  speedUnit: "কিমি/ঘণ্টা",
  clickToLook: "ক্যামেরা ঘোরাতে ক্লিক করুন",
  unsupported: "দুঃখিত, এই ব্রাউজারে WebGL2 চালু নেই। গেমটি চালাতে Chrome বা Edge-এর নতুন সংস্করণ ব্যবহার করুন।",
  loadFailed: "গেমের ফাইল লোড করা যায়নি। পাতাটি আবার খুলে দেখুন।",
  tips: [
    "বাংলাদেশে গাড়ি চলে রাস্তার বাঁ দিকে।",
    "ট্রাফিক পুলিশের সামনে লাল বাতি পার হলে বাঁশি শুনবেন!",
    "যে কোনো রিকশা, সিএনজি বা বাসের কাছে গিয়ে F চাপুন।",
    "চায়ের দোকানে থেমে এক কাপ চা খেয়ে নিন।",
    "মেট্রোরেলের ওপর দিয়ে ট্রেন যায়, মাঝে মাঝে ওপরে তাকান।",
    "সামনের সংস্করণে আসছে সাইবার নিরাপত্তার মিশন।",
  ],
  vehicles: {
    bicycle: "সাইকেল",
    rickshaw: "রিকশা",
    easybike: "ব্যাটারি রিকশা",
    cng: "সিএনজি",
    motorbike: "মোটরসাইকেল",
    car_sedan: "প্রাইভেট কার",
    microbus: "মাইক্রোবাস",
    bus_city: "সিটি বাস",
    truck: "ট্রাক",
  } as Record<string, string>,
  vehiclesIn: {
    bicycle: "সাইকেলে",
    rickshaw: "রিকশায়",
    easybike: "ব্যাটারি রিকশায়",
    cng: "সিএনজিতে",
    motorbike: "মোটরসাইকেলে",
    car_sedan: "প্রাইভেট কারে",
    microbus: "মাইক্রোবাসে",
    bus_city: "সিটি বাসে",
    truck: "ট্রাকে",
  } as Record<string, string>,
  // A driver hands the vehicle over peacefully. No force is involved.
  driverLeaves: [
    "ঠিক আছে ভাই, নিয়ে যান। সাবধানে চালাবেন!",
    "আরে ভাই, এত তাড়া? আচ্ছা নেন।",
    "তাড়াহুড়ো করবেন না ভাই, ফেরত দিয়েন কিন্তু!",
    "নিয়ে যান, নিয়ে যান। আমি চা খেয়ে আসি।",
    "মামা, ভাড়াটা পরে দিয়েন!",
  ],
  dodge: [
    "আরে ভাই, দেখে চালান!",
    "ওই মিয়া, চোখ কই!",
    "আস্তে চালান ভাই!",
    "আল্লাহ, আরেকটু হলেই গেছিলাম!",
  ],
  police: [
    "এই! লাল বাতি দেখেন নাই?",
    "থামেন ভাই, সিগন্যাল লাল!",
    "ট্রাফিক আইন মানেন, ভাই!",
  ],
  greet: [
    "ভাই, কেমন আছেন?",
    "আজকে রাস্তায় অনেক জ্যাম।",
    "সামনে মেট্রো স্টেশনের রাস্তা।",
    "গরম খুব, ভাই। একটু ছায়ায় দাঁড়ান।",
    "অপরিচিত নম্বর থেকে ফোন এলে সাবধান, ভাই।",
    "ওটিপি কাউকে দেবেন না, বুঝলেন?",
    "মামা, কোথায় যাবেন?",
    "কী খুঁজছেন, ভাই?",
  ],
  tea: [
    "ভাই, চা খাবেন? গরম চা আছে।",
    "ঠিক আছে ভাই, একটু দাঁড়ান। চিনি কম না বেশি?",
    "দুধ চা না লাল চা, ভাই?",
  ],
};

const DIGITS = "০১২৩৪৫৬৭৮৯";

/** Writes ASCII digits in a string as Bangla digits. */
export function bnNum(value: number | string): string {
  return String(value).replace(/[0-9]/g, (d) => DIGITS[Number(d)]);
}

/** Clock text such as "বিকাল ৪:৩০" from an hour value in 0..24. */
export function bnClock(hours: number): string {
  const h24 = Math.floor(hours) % 24;
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  const part = h24 < 5 ? "রাত" : h24 < 11 ? "সকাল" : h24 < 15 ? "দুপুর" : h24 < 18 ? "বিকাল" : h24 < 20 ? "সন্ধ্যা" : "রাত";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${part} ${bnNum(h12)}:${bnNum(String(m).padStart(2, "0"))}`;
}
