import type { StreetEvent } from "./types";

export const EVENTS_3: StreetEvent[] = [
  {
    key: "event_heat_faint",
    id: "npc_rickshaw_watermelon",
    hint: ["গরমে একজন রিকশাচালকের মাথা ঘুরছে", "A rickshaw puller is feeling dizzy in the heat"],
    place: "road",
    nodes: {
      start: {
        who: "o",
        say: ["মাথাটা ঘুরছে, চারদিক কেমন সাদা লাগছে। একটু বসি। রিকশাটা একটু ধরবেন?", "My head's spinning, everything's gone white. Let me sit. Could you hold the rickshaw?"],
        options: [
          { text: ["ছায়ায় চলেন, বসেন।", "Come into the shade and sit."], go: "shade" },
          { text: ["পানি আনছি।", "I'll get water."], go: "water" },
          { text: ["অন্য কেউ দেখবে।", "Someone else will see to it."], go: "leave" },
        ],
      },
      shade: { who: "h", say: ["গাছের নিচে বসেন, গামছাটা ভিজিয়ে দিই।", "Sit under the tree, I'll wet your towel."], next: "saline" },
      water: { who: "o", say: ["পানি পেয়ে ভালো লাগছে। দোকানদার বলল, স্যালাইন হলে আরও ভালো।", "That water helps. The shopkeeper says saline would be even better."], next: "saline" },
      saline: {
        who: "o",
        say: ["আহ, একটু আরাম লাগছে। ওই দোকানে খাওয়ার স্যালাইন আছে, তবে আজ রোজগারই হয়নি।", "Ah, that's a bit better. That shop has drinking saline, but I've earned nothing today."],
        options: [
          { text: ["আমি কিনে আনি।", "I'll buy it."], go: "buy", out: { money: -10, rep: 4 } },
          { text: ["আজ আর চালাবেন না।", "Don't drive any more today."], go: "rest", out: { rep: 2 } },
        ],
      },
      buy: {
        who: "o",
        say: ["এক গ্লাস খেতেই শরীরে জান এল। টাকাটা কাল ফেরত দিব, ওই মোড়েই থাকি।", "One glass and the life's come back to me. I'll repay you tomorrow, I'm always on that corner."],
        next: "better",
        out: { lesson: ["গরমে মাথা ঘুরলে আগে ছায়ায় বসান, তারপর খাওয়ার স্যালাইন দিন।", "If someone's dizzy from heat, sit them in the shade first, then give drinking saline."] },
      },
      rest: { who: "o", say: ["না চালালে জমা দিব কী দিয়ে? আচ্ছা, দুপুরটা জিরিয়ে বিকেলে বের হব।", "If I don't drive, how do I pay the rent? All right, I'll rest through midday and go out this afternoon."], next: "better" },
      better: { who: "o", say: ["বেশি খারাপ লাগলে হাসপাতালে যাব, কথা দিলাম। আজ রোদটা সত্যিই ডাকাত।", "If it gets worse I'll go to the hospital, I promise. Today's sun is a real bandit."] },
      leave: { who: "o", say: ["আচ্ছা, যান। একটু বসলেই ঠিক হয়ে যাব, ইনশাআল্লাহ।", "All right, go on. I'll be fine after a little sit, God willing."], out: { rep: -2 } },
    },
  },
  {
    key: "event_tourist",
    id: "npc_student_lemon",
    hint: ["একজন পর্যটক পথ হারিয়েছেন", "A tourist has lost their way"],
    place: "park",
    nodes: {
      start: {
        who: "o",
        say: ["আমি বিদেশি, বাংলা শিখছি। ধন্যবাদ, জ্যাম আর কত দূর, এই তিনটা জানি। জাদুঘর কই?", "I'm a foreigner, learning Bangla. I know thank you, traffic jam and how much further. Where's the museum?"],
        options: [
          { text: ["সোজা গিয়ে বামে, রিকশা নেন।", "Straight on then left. Take a rickshaw."], go: "fare" },
          { text: ["এখানে এলেন কীভাবে?", "How did you end up here?"], go: "how" },
          { text: ["আমিও ওই তিনটাই জানি।", "Those three are all I know as well."], go: "joke" },
        ],
      },
      how: { who: "o", say: ["গাইড বলেছিল পাঁচ মিনিট। তিন ঘণ্টা হলো। গাইডও হারিয়ে গেছে, আমিও।", "The guide said five minutes. It's been three hours. The guide's lost too, and so am I."], next: "fare" },
      joke: { who: "o", say: ["আপনিও? তাহলে আমরা প্রস্তুত। জ্যামে বসে ধন্যবাদ বলব, আর কত দূর জিজ্ঞেস করব।", "You too? Then we're ready. We'll sit in traffic saying thank you and asking how much further."], next: "fare" },
      fare: {
        who: "o",
        say: ["এক লোক বলল, জাদুঘর যেতে পাঁচ হাজার টাকা ভাড়া। এটা কি ঠিক?", "A man told me the fare to the museum is five thousand taka. Is that right?"],
        options: [
          { text: ["না। আগে দোকানে দাম জেনে নেন।", "No. Ask a shop what it should cost first."], go: "fair", out: { rep: 2, sense: 1 } },
          { text: ["হ্যাঁ, ঠিকই বলেছে।", "Yes, that's right."], go: "wrong", out: { rep: -2 } },
        ],
      },
      fair: {
        who: "o",
        say: ["তাই তো! ওই লোকের নাম দিলাম দামি বন্ধু। আমার চতুর্থ শব্দ কী শিখব?", "Of course! I'll call that man my expensive friend. What should my fourth word be?"],
        out: { lesson: ["অচেনা কেউ ভাড়া বললে যাচাই করুন। কাছের দোকানে জিজ্ঞেস করলেই আসল দাম জানা যায়।", "When a stranger quotes a fare, check it. Ask a nearby shop and you'll hear the real price."] },
        options: [
          { text: ["ভাঙতি।", "Change, as in small change."], go: "word_change" },
          { text: ["আস্তে।", "Slowly."], go: "word_slow" },
        ],
      },
      word_change: { who: "o", say: ["ভাঙতি! ভাঙতি! এই এক শব্দে মনে হয় এই দেশে পুরো জীবন চলে যায়।", "Bhangti! Bhangti! It seems you could get through a whole life here on that one word."], out: { rep: 3 } },
      word_slow: { who: "o", say: ["আস্তে! হর্নের শহরে আস্তে! দারুণ মজার শব্দ। ধন্যবাদ, আর কত দূর!", "Aste! Slowly, in the city of horns! What a funny word. Thank you, how much further!"], out: { rep: 3 } },
      wrong: { who: "o", say: ["ঠিক আছে। তাহলে আমার টাকা শেষ, আমি হেঁটে যাই। আর কত দূর?", "All right. Then my money's gone, so I'll walk. How much further?"] },
    },
  },
  {
    key: "event_fake_charity",
    id: "npc_commuter_lychee",
    hint: ["একজন দানের বাক্স নিয়ে টাকা তুলছেন", "Someone's collecting money with a donation box"],
    place: "market",
    nodes: {
      start: {
        who: "o",
        say: ["বন্যার্তদের জন্য দিন! আমরা সবার জন্য সবকিছু কল্যাণ সংঘ। আজ না দিলে কাল আফসোস।", "Give for the flood victims! We're the Everything For Everyone Welfare Society. Don't give today, regret it tomorrow."],
        options: [
          { text: ["রসিদ দেন, আর নিবন্ধন নম্বর কত?", "Give me a receipt. And what's your registration number?"], go: "receipt" },
          { text: ["এই নেন কুড়ি টাকা।", "Here's twenty taka."], go: "gave", out: { money: -20 } },
          { text: ["কোন এলাকায় বন্যা?", "Where's the flood?"], go: "where" },
        ],
      },
      where: {
        who: "o",
        say: ["বন্যা? সবখানে। মানে উত্তরে। মানে গত বছর যেখানে হয়েছিল, ওখানেই।", "The flood? Everywhere. I mean the north. I mean wherever it was last year."],
        options: [
          { text: ["রসিদটা দেখি।", "Let's see the receipt."], go: "receipt" },
          { text: ["তবু এই কুড়ি টাকা রাখেন।", "Still, take this twenty."], go: "gave", out: { money: -20 } },
        ],
      },
      receipt: {
        who: "o",
        say: ["রসিদ? এই যে। ওহ, এটা তো চায়ের দোকানের। নিবন্ধন হচ্ছে, মানে হবে, মানে ফাইল চলছে।", "A receipt? Here. Oh, that's from a tea stall. Registration's coming, I mean it will, I mean the file's moving."],
        options: [
          { text: ["থানায় একটু জিজ্ঞেস করে আসি?", "Shall I just ask at the police station?"], go: "thana", out: { rep: 2, sense: 3 } },
          { text: ["ত্রাণ দিলে আমি নিজেই দিব।", "If I give relief, I'll give it myself."], go: "self", out: { sense: 2 } },
        ],
      },
      thana: {
        who: "o",
        say: ["থানা? না না, থানাকে আজ বিরক্ত না করি। আমি বরং ওপাশে যাই, ওদিকে বন্যা বেশি।", "The police? No, no, let's not bother them today. I'd best go that way, there's more flood over there."],
        out: { lesson: ["দানের আগে নিবন্ধন, রসিদ আর ঠিকানা দেখুন। আসল সংগঠন প্রশ্ন শুনে পালায় না।", "Before giving, check the registration, receipt and address. A real charity doesn't run from questions."] },
      },
      self: {
        who: "o",
        say: ["নিজে? এত কষ্ট করবেন কেন? আচ্ছা থাক, আমার বাস এসে গেছে।", "Yourself? Why go to such trouble? Never mind, here's my bus."],
        out: { lesson: ["সাহায্য করতে চাইলে চেনা সংগঠন বা নিজের হাত সবচেয়ে নিরাপদ।", "If you want to help, a charity you know or your own two hands are safest."] },
      },
      gave: {
        who: "o",
        say: ["আল্লাহ বরকত দিন! আর পঞ্চাশ দিলে আপনার নাম বাক্সে লিখে দিব।", "God bless you! Another fifty and I'll write your name on the box."],
        options: [
          { text: ["না, আর না। রসিদটা দেন।", "No more. Give me the receipt."], go: "receipt" },
          { text: ["আচ্ছা, লিখে দেন।", "All right, write it."], go: "gave2", out: { money: -50, sense: 1 } },
        ],
      },
      gave2: {
        who: "o",
        say: ["লিখলাম। আসলে লিখিনি, কলম নাই। মনে মনে লিখলাম। আসি।", "Written. Well, not written, I've got no pen. Written in my heart. Bye."],
        out: { lesson: ["রসিদ নাই, ঠিকানা নাই, শুধু তাড়া আছে, এমন দানের বাক্সে টাকা দেবেন না।", "No receipt, no address, only hurry: don't put money in a box like that."] },
      },
    },
  },
  {
    key: "event_wedding_lane",
    id: "npc_office_orange",
    hint: ["বিয়ের মিছিলে গলি আটকে গেছে", "A wedding procession is blocking the lane"],
    place: "road",
    nodes: {
      start: {
        who: "o",
        say: ["আমি বরের বড় ভাই। গলি আটকে গেছে, কারণ বর গাড়ি থেকে নামছে না। সে নাকি ভয় পাচ্ছে।", "I'm the groom's elder brother. The lane's blocked because he won't get out of the car. Nervous, apparently."],
        options: [
          { text: ["হর্ন দিই, রাস্তা ছাড়েন।", "I'll sound the horn, clear the road."], go: "horn", out: { rep: -1 } },
          { text: ["বরকে একটু সাহস দিই।", "Let me give the groom some courage."], go: "groom" },
          { text: ["অন্য গলি দিয়ে যাই।", "I'll take another lane."], go: "detour" },
        ],
      },
      horn: { who: "o", say: ["দেন। ব্যান্ড পার্টি ভাববে তালে বাজাচ্ছেন, ওরাও সঙ্গে বাজাবে।", "Go on. The band will think you're keeping time and join in."], next: "band" },
      band: {
        who: "o",
        say: ["দেখলেন? হর্ন, ঢোল আর সানাই একসঙ্গে! আপনি তো বিয়েরই অংশ। মিষ্টি খান।", "See? Horn, drum and shehnai together! You're part of the wedding now. Have a sweet."],
        options: [
          { text: ["একটা মিষ্টি নিই।", "I'll take one sweet."], go: "sweet", out: { rep: 2 } },
          { text: ["আমাকে যেতে দেন।", "Just let me through."], go: "leave" },
        ],
      },
      groom: { who: "h", say: ["ভয় কিসের? ভেতরে শুধু রোস্ট আর আত্মীয়স্বজন।", "What's to fear? It's only roast chicken and relatives in there."], next: "groom2" },
      groom2: {
        who: "o",
        say: ["রোস্ট শুনেই বর নেমে গেল! এবার গেটে ফিতা ধরে টাকা চাইছে। একটু দর করবেন?", "He heard roast and got out! Now they're holding a ribbon at the gate and asking for money. Will you haggle?"],
        options: [
          { text: ["করি, ফিতা কত?", "I will, how much for the ribbon?"], go: "gate", out: { rep: 3, money: 20 } },
          { text: ["ওখানে আমি থাকতে চাই না।", "I'd rather stay out of that."], go: "sweet" },
        ],
      },
      gate: { who: "o", say: ["ওরা বলল পাঁচ হাজার, আপনি বললেন পাঁচশো, সবাই রাজি! আপনার বাজারে দোকান থাকা উচিত। এই বকশিশ নেন।", "They said five thousand, you said five hundred, and everyone agreed! You should have a stall in the market. Here's a tip."], next: "sweet" },
      sweet: { who: "o", say: ["রসগোল্লা নেন। গলিটা দশ মিনিটে ছাড়ব, মানে এক ঘণ্টায়।", "Have a rasgulla. We'll clear the lane in ten minutes, meaning an hour."] },
      leave: { who: "o", say: ["ঠিক আছে, ব্যান্ড পার্টি, একটু চাপেন! রাস্তা তো আমাদের একার না।", "All right, band, squeeze over! The road isn't ours alone."] },
      detour: { who: "o", say: ["যান, তবে ওই গলিতেও আমাদের দ্বিতীয় গাড়ি আটকে আছে। এই শহরে সবাই কারও না কারও বিয়েতে।", "Go on, but our second car's stuck in that lane too. In this city, everyone's at somebody's wedding."] },
    },
  },
  {
    key: "event_water_child",
    id: "npc_kid_berry",
    hint: ["একটা বাচ্চা পানির বোতল বিক্রি করছে", "A child is selling bottles of water"],
    place: "busstop",
    nodes: {
      start: {
        who: "o",
        say: ["ঠান্ডা পানি! ঠান্ডা পানি! একদম সত্যিকারের ঠান্ডা, বরফের সঙ্গে ঘুমিয়েছে!", "Cold water! Cold water! Truly cold, it slept with the ice!"],
        options: [
          { text: ["দাম কত?", "How much?"], go: "price" },
          { text: ["একটা দাও।", "Give me one."], go: "buy", out: { money: -20 } },
          { text: ["আজ না।", "Not today."], go: "no" },
        ],
      },
      price: {
        who: "o",
        say: ["বিশ টাকা। জ্যামে ত্রিশ, কিন্তু আপনি তো হাঁটছেন, তাই বিশ। আমি হিসাব জানি।", "Twenty taka. In traffic it's thirty, but you're walking, so twenty. I know my sums."],
        options: [
          { text: ["সিল ঠিক আছে তো?", "Is the seal intact?"], go: "seal" },
          { text: ["দাও একটা।", "Give me one."], go: "buy", out: { money: -20 } },
        ],
      },
      seal: {
        who: "o",
        say: ["দেখে নেন! আম্মু বলেছে, সিল ভাঙা পানি কেউ যেন না কেনে।", "See for yourself! Mum says nobody should ever buy water with a broken seal."],
        out: { sense: 1, lesson: ["বোতলের পানি কেনার আগে সিল দেখে নিন। ভাঙা সিলের পানি এড়িয়ে চলুন।", "Check the seal before buying bottled water. Avoid any with a broken seal."] },
        options: [
          { text: ["তাহলে দাও একটা।", "Give me one then."], go: "buy", out: { money: -20 } },
          { text: ["ঠিক আছে, তবু আজ না।", "Good, but not today."], go: "no" },
        ],
      },
      buy: {
        who: "o",
        say: ["এই নেন। খুচরা নাই? আমি পরে দিয়ে দিব, স্কুলের পরে এখানেই থাকি।", "Here you are. No change? I'll give it to you later, I'm here after school."],
        options: [
          { text: ["বাকিটা তুমি রাখো।", "You keep the rest."], go: "keep", out: { money: -10, rep: 3 } },
          { text: ["স্কুল কেমন চলছে?", "How's school going?"], go: "school", out: { rep: 1 } },
        ],
      },
      keep: { who: "o", say: ["সত্যি? খাতা কিনব! গণিতের খাতা। আমার হিসাব ভালো, দেখলেন তো।", "Really? I'll buy an exercise book! For maths. I'm good at sums, you saw."] },
      school: { who: "o", say: ["ভালো! সকালে স্কুল, বিকেলে পানি। বড় হয়ে কোম্পানি দিব, ঠান্ডা পানির।", "Good! School in the morning, water in the afternoon. When I grow up I'll start a cold water company."] },
      no: { who: "o", say: ["আচ্ছা। গরম তো কমবে না, আবার আসবেন। আমি অপেক্ষা করব।", "All right. The heat won't go away, so you'll be back. I'll wait."] },
    },
  },
  {
    key: "event_stuck_kite",
    id: "npc_girl_pear",
    hint: ["গাছে একটা ঘুড়ি আটকে আছে", "A kite is stuck up a tree"],
    place: "park",
    nodes: {
      start: {
        who: "o",
        say: ["আমার ঘুড়ি! লালটা গাছের ডালে আটকে গেছে। ডালের পাশেই আবার বিদ্যুতের তার।", "My kite! The red one's stuck in the branches. And there's a power line right beside them."],
        options: [
          { text: ["লম্বা বাঁশ দিয়ে টানি।", "I'll pull it with a long bamboo pole."], go: "bamboo" },
          { text: ["গাছে উঠি।", "I'll climb the tree."], go: "climb" },
          { text: ["তারের কাছে যাব না। অন্য উপায় দেখি।", "I won't go near that line. Let's find another way."], go: "safe", out: { rep: 1 } },
        ],
      },
      bamboo: { who: "o", say: ["না না, বাঁশ তারে লাগলে ভয়ের কথা! আম্মু বলেছে, তারের কাছে কিছু নিতে নেই।", "No, no, a pole near that line is a scary thought! Mum says never to take anything near the wires."], next: "safe" },
      climb: { who: "o", say: ["ওই ডালটা তো তারের একদম পাশে। থাক, ঘুড়ির চেয়ে আপনি দামি।", "That branch is right by the wire. Leave it, you're worth more than a kite."], next: "safe" },
      safe: {
        who: "o",
        say: ["তাহলে ঘুড়িটা ওখানেই থাকবে? ও তো আমার সবচেয়ে উঁচু ঘুড়ি ছিল।", "So it stays up there? It was the highest kite I ever had."],
        options: [
          { text: ["বিদ্যুৎ অফিসে খবর দিই।", "I'll let the power office know."], go: "office", out: { rep: 2 } },
          { text: ["নতুন একটা কিনে দিই।", "I'll buy you a new one."], go: "new_kite", out: { money: -15, rep: 3 } },
        ],
      },
      office: {
        who: "o",
        say: ["আচ্ছা। ততক্ষণ ঘুড়িটা পতাকার মতো থাক। বলব, এই পাড়াটা আমার।", "All right. Until then it can fly like a flag. I'll say this neighbourhood's mine."],
        out: { lesson: ["বিদ্যুতের তারের কাছে আটকানো জিনিস নিজে নামাতে যাবেন না। বিদ্যুৎ অফিসকে জানান।", "Don't try to fetch anything caught near power lines yourself. Tell the power office."] },
      },
      new_kite: {
        who: "o",
        say: ["এটা তো আরও লাল! এবার মাঠের মাঝখানে ওড়াব, গাছ আর তার থেকে দূরে।", "This one's even redder! I'll fly it mid-field this time, far from trees and wires."],
        out: { lesson: ["ঘুড়ি ওড়ান খোলা মাঠে, তার থেকে দূরে। আটকে গেলে ঘুড়ি আবার কেনা যায়।", "Fly kites in an open field, far from wires. If one gets stuck, you can always buy another."] },
      },
    },
  },
];
