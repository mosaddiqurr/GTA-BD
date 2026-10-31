import type { Scam } from "../types";

/** The second half of the people in the street. Use STRANGERS from strangers.ts, which already includes these. */
export const STRANGERS2: Scam[] = [
  {
    key: "stranger_cng_fine",
    kind: "stranger",
    from: ["সিএনজি চালক", "CNG auto driver"],
    body: ["ট্রাফিক মামলা: আপনার গাড়িতে জরিমানা ২,৫০০ টাকা। ২৪ ঘন্টায় না দিলে লাইসেন্স বাতিল। পে করুন: http://traffic-fine.onlinee/pay", "Traffic case: Tk 2,500 fine on your vehicle. Pay within 24 hours or your licence is cancelled. Pay at: http://traffic-fine.onlinee/pay"],
    nodes: {
      start: {
        who: "o",
        say: ["ট্রাফিকের জরিমানা নাকি! আজ তো কোনো মামলাই খাইনি। দিয়ে দেব, নইলে লাইসেন্স যাবে?", "A traffic fine, it says! I had no case today. Should I pay, or will I lose my licence?"],
        options: [
          { text: ["লিংকে দেবেন না, ট্রাফিক অফিসে যান।", "Don't pay at the link, go to the traffic office."], go: "right" },
          { text: ["লাইসেন্সের ব্যাপার, দিয়ে দিন।", "It's your licence, pay it."], go: "wrong" },
          { text: ["গাড়ির নম্বর লেখা আছে?", "Does it give your vehicle's number?"], go: "ask" },
        ],
      },
      ask: {
        who: "o",
        say: ["না, নম্বর নেই। শুধু লিখেছে আপনার গাড়ি। আসল মামলার কাগজ তো হাতে দেয়।", "No, there's no number. It just says your vehicle. For a real case they hand you a paper."],
        options: [
          { text: ["নম্বর ছাড়া জরিমানা হয় না। অফিসে জিজ্ঞেস করুন।", "No number, no fine. Ask at the office."], go: "right" },
          { text: ["ঝামেলা না বাড়িয়ে দিয়ে দিন।", "Don't make trouble, just pay."], go: "wrong" },
        ],
      },
      right: {
        who: "o",
        say: ["অফিসে দেখালাম, হাসল। বলল, এমন মেসেজ সবার কাছেই যাচ্ছে। দিনের জমা বাঁচল।", "I showed it at the office and they laughed. They say it's going to everyone. My day's takings are safe."],
        out: {
          rep: 3,
          sense: 2,
          lesson: ["গাড়ির নম্বর নেই, লিংকে টাকা, ভয়ের সময়সীমা, তিনটাই চিহ্ন। আসল জরিমানা কাগজে আসে।", "No vehicle number, payment by link and a scary deadline are all signs. A real fine comes on paper."],
        },
      },
      wrong: {
        who: "o",
        say: ["লিংকে কার্ড দিলাম। আড়াই হাজারের জায়গায় অনেক বেশি কেটে নিল। এখন কী হবে?", "I gave my card at the link. They took far more than 2,500. What now?"],
        out: {
          rep: -3,
          sense: 1,
          lesson: ["ভয় দেখিয়ে লিংকে পাঠানোই ফাঁদ। ব্যাংকে কার্ড বন্ধ করতে আর অফিসে যাচাই করতে বলুন।", "Scaring people to a link is the trap. Tell him to block the card at the bank and check at the office."],
        },
      },
    },
  },
  {
    key: "stranger_student_wifi",
    kind: "stranger",
    from: ["চায়ের দোকানে এক ছাত্রী", "Student at a tea stall"],
    nodes: {
      start: {
        who: "o",
        say: ["অ্যাসাইনমেন্ট পাঠাতে হবে। ফ্রি ওয়াইফাই পেলাম, কিন্তু ঝটপট টাকার নম্বর আর কোড চাইছে। দেব?", "I have to send my assignment. I found free Wi-Fi, but it wants my Jhotpot Taka number and code. Should I?"],
        options: [
          { text: ["দেবেন না, ওটা ফাঁদ।", "Don't, that's a trap."], go: "right" },
          { text: ["ফ্রি তো, দিয়ে কাজ সেরে নিন।", "It's free, give it and get on with your work."], go: "wrong" },
          { text: ["দোকান ওই ওয়াইফাই চেনে?", "Does the stall know that Wi-Fi?"], go: "ask" },
        ],
      },
      ask: {
        who: "o",
        say: ["দোকানি বলল, ওদের ওয়াইফাইয়ের পাসওয়ার্ড আছে, ওই নামটা ওদের না। তাহলে ওটা কার?", "The stall owner says theirs has a password, and that name isn't theirs. So whose is it?"],
        options: [
          { text: ["কেউ ফাঁদ পেতেছে। দোকানের পাসওয়ার্ড নিন।", "Someone's set a trap. Get the stall's password."], go: "right" },
          { text: ["যারই হোক, কাজ তো হবে।", "Whoever's it is, it'll do the job."], go: "wrong" },
        ],
      },
      right: {
        who: "o",
        say: ["ভাগ্যিস জিজ্ঞেস করলাম! দোকানের পাসওয়ার্ড নিয়ে পাঠিয়ে দিলাম।", "Lucky I asked! I got the stall's password and sent it."],
        out: {
          rep: 3,
          sense: 2,
          lesson: ["ইন্টারনেটের জন্য টাকার কোড লাগে না। ওয়াইফাইয়ের নাম যে কেউ বানাতে পারে, দোকানে জিজ্ঞেস করুন।", "Internet access doesn't need a money code. Anyone can name a Wi-Fi anything, so ask at the shop."],
        },
      },
      wrong: {
        who: "o",
        say: ["কোড দিলাম। অ্যাসাইনমেন্ট গেল, সাথে মাসের হাতখরচের টাকাও গেল।", "I gave the code. The assignment went, and so did my month's pocket money."],
        out: {
          rep: -3,
          sense: 1,
          lesson: ["ফ্রি ওয়াইফাই ফ্রি নয়, যদি কোড চায়। টাকার অ্যাকাউন্ট আর ইন্টারনেটের কোনো সম্পর্ক নেই।", "Free Wi-Fi isn't free if it wants a code. Your money account has nothing to do with the internet."],
        },
      },
    },
  },
  {
    key: "stranger_shop_stock",
    kind: "stranger",
    real: true,
    from: ["স্টেশনারি দোকানের মালিক", "Stationery shop owner"],
    body: ["কুরিয়ার: আপনার পার্সেল নং ৩০৯১ শাখায় পৌঁছেছে। রসিদ ও পরিচয়পত্র নিয়ে এসে নিন। অতিরিক্ত ফি নেই।", "Courier: your parcel no. 3091 has reached the branch. Bring your receipt and ID to collect it. No extra fee."],
    nodes: {
      start: {
        who: "o",
        say: ["দোকানের মাল কুরিয়ারে এসেছে বলছে। সবাই বলে পার্সেলের মেসেজ ভুয়া হয়। আনতে যাব?", "It says my shop's stock has come by courier. Everyone says parcel messages are fake. Should I go and get it?"],
        options: [
          { text: ["যান, টাকা বা লিংক চায়নি।", "Go, it asks for no money and no link."], go: "right" },
          { text: ["ভুয়া, যাবেন না।", "It's fake, don't go."], go: "wrong" },
          { text: ["আপনি কি অর্ডার দিয়েছিলেন?", "Did you place an order?"], go: "ask" },
        ],
      },
      ask: {
        who: "o",
        say: ["হ্যাঁ, গত সপ্তাহে মাল পাঠাতে বলেছিলাম। রসিদের নম্বরও একই।", "Yes, I asked for stock last week. The number on the receipt is the same too."],
        options: [
          { text: ["তাহলে আসল। গিয়ে নিয়ে আসুন।", "Then it's real. Go and get it."], go: "right" },
          { text: ["নম্বর মিললেও বিশ্বাস নেই, যাবেন না।", "Even if it matches, don't trust it. Don't go."], go: "wrong" },
        ],
      },
      right: {
        who: "o",
        say: ["মাল পেয়ে গেছি। স্কুল খোলার আগেই খাতা কলম দোকানে উঠল, ধন্যবাদ।", "I've got my stock. It's on the shelves before the schools open, thank you."],
        out: {
          rep: 3,
          sense: 2,
          lesson: ["নিজের অর্ডার, রসিদের নম্বর মেলে, বাড়তি ফি নেই। এভাবে আসল মেসেজ চেনা যায়।", "His own order, a matching receipt number, no extra fee. That's how you know a real message."],
        },
      },
      wrong: {
        who: "o",
        say: ["গেলাম না। তিন দিন পর মাল ফেরত গেছে, দোকান ফাঁকা পড়ে আছে।", "I didn't go. Three days later the stock went back, and my shop sits empty."],
        out: {
          rep: -3,
          sense: 1,
          lesson: ["সবকিছু ভুয়া বলাও ভুল। রসিদের নম্বর মেলালেই জানা যেত, টাকাও চায়নি।", "Calling everything fake is wrong too. Matching the receipt would have told him, and no money was asked."],
        },
      },
    },
  },
  {
    key: "stranger_mother_bureau",
    kind: "stranger",
    from: ["মেয়ের বিয়ে নিয়ে চিন্তিত মা", "Mother worried about her daughter's wedding"],
    nodes: {
      start: {
        who: "o",
        say: ["মেয়ের জন্য ব্যুরো ফোন করল। প্রবাসী পাত্র, তিন হাজার টাকা ফি দিলে ছবি দেবে। দিয়ে দেব?", "A bureau rang about my daughter. An expat groom, and they'll send a photo for a 3,000 taka fee. Should I pay?"],
        options: [
          { text: ["ফি দেবেন না। আগে ওদের ঠিকানা নিন।", "Don't pay. Get their address first."], go: "ask" },
          { text: ["ভালো পাত্র, দিয়ে দিন।", "He sounds good, pay it."], go: "wrong" },
          { text: ["এটা ফাঁদ, চেনা লোকে খোঁজ নিন।", "It's a trap. Ask through people you know."], go: "right" },
        ],
      },
      ask: {
        who: "o",
        say: ["চেয়েছিলাম। বলল ফি ছাড়া কিছুই দেবে না, আজ না দিলে পাত্র অন্য পরিবারে যাবে।", "I asked. They said nothing without the fee, and if I don't pay today he goes to another family."],
        options: [
          { text: ["ঠিকানা নেই মানে ভুয়া। আত্মীয়দের জানান।", "No address means fake. Tell your relatives."], go: "right" },
          { text: ["হাতছাড়া না করে দিয়ে দিন।", "Don't let him slip, pay it."], go: "wrong" },
        ],
      },
      right: {
        who: "o",
        say: ["ঠিকই বলেছেন। মেয়ের বাবাকে বললাম, চেনা ঘটকের মাধ্যমেই খোঁজ নেব।", "You're right. I told her father, we'll ask through a matchmaker we know."],
        out: {
          rep: 3,
          sense: 2,
          lesson: ["ঠিকানা নেই, ফি আগে, সময়ের তাড়া, এই তিনেই ধরা পড়ে। বিয়ের খোঁজ নিন চেনা লোকের মাধ্যমে।", "No address, a fee first and a rush give it away. Look for a match through people you know."],
        },
      },
      wrong: {
        who: "o",
        say: ["ফি দিলাম। এখন বলছে উপহার আর দেখার খরচও লাগবে। পাত্রের ছবিটাও ইন্টারনেট থেকে নেওয়া।", "I paid. Now they want gift and visit costs too. Even the groom's photo was taken off the internet."],
        out: {
          rep: -3,
          sense: 1,
          lesson: ["প্রথম ফি দিলেই পরের ফি আসে। চিন্তিত মায়ের ভরসাটা ভাঙল, আগে যাচাই করতে বলুন।", "Pay one fee and the next one comes. A worried mother's trust was broken, so tell people to check first."],
        },
      },
    },
  },
  {
    key: "stranger_elder_sugar",
    kind: "stranger",
    from: ["ডায়াবেটিসের রোগী প্রবীণ", "Elderly man with diabetes"],
    nodes: {
      start: {
        who: "o",
        say: ["এক হাকিম ফোনে বললেন, সাত দিনে ডায়াবেটিস সারবে, ডাক্তারের ওষুধ বন্ধ করতে হবে। শুরু করব?", "A healer rang and said my diabetes will be cured in seven days if I stop the doctor's medicine. Shall I start?"],
        options: [
          { text: ["ওষুধ বন্ধ করবেন না, ডাক্তারকে জিজ্ঞেস করুন।", "Don't stop your medicine, ask your doctor."], go: "right" },
          { text: ["চেষ্টা করে দেখুন, ভেষজ তো।", "Give it a try, it's herbal."], go: "wrong" },
          { text: ["ওষুধের অনুমোদন নম্বর আছে?", "Does the medicine have an approval number?"], go: "ask" },
        ],
      },
      ask: {
        who: "o",
        say: ["বোতলের গায়ে কিছুই লেখা নেই। বললেন, এটা গোপন সূত্র, তাই লেখা যায় না।", "There's nothing on the bottle. He said it's a secret formula, so it can't be written."],
        options: [
          { text: ["তাহলে খাবেন না। ডাক্তারকে বোতলটা দেখান।", "Then don't take it. Show the bottle to your doctor."], go: "right" },
          { text: ["গোপন সূত্রই ভালো হয়, খান।", "Secret formulas are the best kind, take it."], go: "wrong" },
        ],
      },
      right: {
        who: "o",
        say: ["ডাক্তারকে দেখালাম। বললেন, ভালো করেছি। বোতলটা ফেলে দিলাম, টাকাটাও বাঁচল।", "I showed my doctor, who said I did well. I threw out the bottle and saved my money too."],
        out: {
          rep: 3,
          sense: 2,
          lesson: ["চিরতরে সারানোর দাবি আর ওষুধ বন্ধের পরামর্শ, দুটোই বিপদের চিহ্ন। ডাক্তারই আগে।", "A claim of a lasting cure and advice to stop medicine are both danger signs. The doctor comes first."],
        },
      },
      wrong: {
        who: "o",
        say: ["ওষুধ বন্ধ করলাম। সুগার অনেক বেড়ে গেছে, ডাক্তার খুব রাগ করলেন। টাকাও গেল।", "I stopped my medicine. My sugar's gone very high and the doctor was angry. The money's gone as well."],
        out: {
          rep: -4,
          sense: 1,
          lesson: ["ওষুধ বন্ধ করলে টাকার সাথে শরীরেরও ক্ষতি। ওষুধের কথায় ডাক্তারকেই জিজ্ঞেস করতে বলুন।", "Stopping prescribed medicine costs health as well as money. On medicine, always send people to the doctor."],
        },
      },
    },
  },
  {
    key: "stranger_worker_dubai",
    kind: "stranger",
    from: ["বিদেশে যেতে চাওয়া যুবক", "Young man hoping to go abroad"],
    nodes: {
      start: {
        who: "o",
        say: ["জমি বন্ধক রেখে দালালকে চার লাখ দিতে যাচ্ছি। দুবাইয়ে কাজ, পাসপোর্টও জমা নেবে। ঠিক করছি?", "I'm mortgaging land to give an agent four lakh. It's a job in Dubai, and he'll keep my passport. Is this right?"],
        options: [
          { text: ["থামুন, আগে সরকারি অফিসে যাচাই করুন।", "Stop, check at the government office first."], go: "right" },
          { text: ["বিদেশ তো, ঝুঁকি নিতেই হবে।", "It's abroad, you have to take risks."], go: "wrong" },
          { text: ["চুক্তি আর লাইসেন্স দেখেছেন?", "Have you seen a contract and a licence?"], go: "ask" },
        ],
      },
      ask: {
        who: "o",
        say: ["না, মুখে বলেছে। গ্রামের অনেকেই নাকি গেছে, কাগজ লাগে না।", "No, it's only by word of mouth. He says many from the village went, and no papers are needed."],
        options: [
          { text: ["কাগজ ছাড়া এক টাকাও দেবেন না।", "Not one taka without papers."], go: "right" },
          { text: ["গ্রামের লোক গেলে সমস্যা নেই।", "If villagers went, it must be fine."], go: "wrong" },
        ],
      },
      right: {
        who: "o",
        say: ["সরকারি অফিসে গেলাম। ওই লোকের কোনো লাইসেন্সই নেই! জমিটা বেঁচে গেল।", "I went to the government office. That man has no licence at all! My land is safe."],
        out: {
          rep: 4,
          sense: 2,
          lesson: ["বিদেশের কাজে চুক্তি আর লাইসেন্স লাগবেই। সরকারি অফিসে নিবন্ধন যাচাই করা বিনা খরচের কাজ।", "A job abroad must have a contract and a licence. Checking registration at the government office costs nothing."],
        },
      },
      wrong: {
        who: "o",
        say: ["টাকা আর পাসপোর্ট দিলাম। দালালের ফোন এখন বন্ধ, জমিটাও বন্ধকে আটকে গেল।", "I gave the money and passport. The agent's phone is off now, and my land is stuck in mortgage."],
        out: {
          rep: -5,
          sense: 1,
          lesson: ["একটা পরিবারের সব গেল। পাসপোর্ট আর টাকা কাউকে দেওয়ার আগে সরকারি অফিসে যাচাই করতে বলুন।", "A whole family has lost everything. Before anyone hands over a passport and money, send them to the government office."],
        },
      },
    },
  },
  {
    key: "stranger_student_atm",
    kind: "stranger",
    real: true,
    from: ["ভয় পাওয়া কলেজছাত্র", "Frightened college student"],
    body: ["আপনার অ্যাকাউন্ট থেকে এটিএমে ২,০০০ টাকা তোলা হয়েছে। ব্যালান্স ৫,৩২০ টাকা। আপনি না হলে কার্ডের পেছনের নম্বরে ফোন করুন।", "Tk 2,000 was withdrawn from your account at an ATM. Balance Tk 5,320. If this wasn't you, call the number on the back of your card."],
    nodes: {
      start: {
        who: "o",
        say: ["টাকা তোলার মেসেজ এল! ভয় পেয়ে গেছি। হ্যাক হলো নাকি? কার্ডটা বন্ধ করে দেব?", "A withdrawal message came! I'm scared. Have I been hacked? Should I stop the card?"],
        options: [
          { text: ["আজ এটিএমে গিয়েছিলেন?", "Did you go to an ATM today?"], go: "ask" },
          { text: ["হ্যাক হয়েছে, এখনই কার্ড বন্ধ করুন।", "You've been hacked, stop the card right now."], go: "wrong" },
          { text: ["মেসেজটা আসল, ভয় নেই।", "The message is real, don't worry."], go: "right" },
        ],
      },
      ask: {
        who: "o",
        say: ["হ্যাঁ, ঘণ্টাখানেক আগেই তো দুই হাজার তুললাম! এই যে টাকা পকেটে। ওহ।", "Yes, I took out two thousand about an hour ago! Here it is in my pocket. Oh."],
        options: [
          { text: ["মেসেজটা আপনার নিজের লেনদেনের।", "The message is about your own withdrawal."], go: "right" },
          { text: ["তবু কার্ড বন্ধ করাই ভালো।", "Better to stop the card anyway."], go: "wrong" },
        ],
      },
      right: {
        who: "o",
        say: ["হা হা, নিজেই ভয় পেলাম! মেসেজে তো কিছু চায়ওনি। ধন্যবাদ।", "Ha ha, I scared myself! The message didn't even ask for anything. Thanks."],
        out: {
          rep: 3,
          sense: 2,
          lesson: ["নিজের লেনদেনের সাথে মেলালেই হয়। লিংক নেই, কোড চায়নি, নম্বরটা কার্ডের পেছনের। এটা আসল।", "Just match it with your own transactions. No link, no code, and the number's the one on the card: it's real."],
        },
      },
      wrong: {
        who: "o",
        say: ["কার্ড বন্ধ করলাম। নতুন কার্ডে পাঁচশো টাকা আর দুই সপ্তাহ লাগবে। পরীক্ষার ফি কীভাবে দেব?", "I stopped the card. A new one costs 500 taka and two weeks. How do I pay my exam fee now?"],
        out: {
          rep: -2,
          sense: 1,
          lesson: ["ভয় পাওয়ার আগে জিজ্ঞেস করুন, লেনদেনটা নিজের কি না। প্রশ্ন করলে এই ঝামেলা হতো না।", "Before panicking, ask whether the transaction was your own. One question would have saved this trouble."],
        },
      },
    },
  },
  {
    key: "stranger_tailor_relief",
    kind: "stranger",
    real: true,
    from: ["পাড়ার দরজি", "Local tailor"],
    nodes: {
      start: {
        who: "o",
        say: ["পাড়ার ক্লাব বন্যার ত্রাণ তুলছে, চেনা ছেলেরা, রসিদও দিচ্ছে। দেব? জালিয়াতির কথা অনেক শুনি।", "The local club is collecting for the floods. Boys I know, and they give receipts. Shall I give? I hear of so much relief fraud."],
        options: [
          { text: ["দিন, চেনা মানুষ, রসিদও আছে।", "Give. You know them, and there's a receipt."], go: "right" },
          { text: ["সবই ভুয়া, দেবেন না।", "It's all fake, don't give."], go: "wrong" },
          { text: ["ক্লাবের হিসাব দেখা যায়?", "Can you see the club's accounts?"], go: "ask" },
        ],
      },
      ask: {
        who: "o",
        say: ["হ্যাঁ, মোড়ের ঘরটাই অফিস। বোর্ডে রোজ হিসাব টাঙায়, কে কত দিল লেখা থাকে।", "Yes, the room at the corner is their office. They post the accounts on a board daily, with who gave what."],
        options: [
          { text: ["তাহলে নিশ্চিন্তে দিন।", "Then give without worry."], go: "right" },
          { text: ["বোর্ডে তো যা খুশি লেখা যায়।", "Anyone can write anything on a board."], go: "wrong" },
        ],
      },
      right: {
        who: "o",
        say: ["দিলাম, রসিদও নিলাম। কাল ওরা নৌকা ভরে চাল পাঠাচ্ছে, আমিও যাব বস্তা তুলতে।", "I gave and took a receipt. Tomorrow they send a boatload of rice, and I'll help load the sacks."],
        out: {
          rep: 3,
          sense: 2,
          lesson: ["চেনা মানুষ, খোলা হিসাব, রসিদ, এই তিনটা থাকলে দান ঠিক জায়গায় যায়। ভালো কাজ থামাবেন না।", "People you know, open accounts and a receipt: with those, a gift reaches the right place. Don't hold back good work."],
        },
      },
      wrong: {
        who: "o",
        say: ["দিলাম না। পরে দেখি ওরা সত্যিই নৌকা ভরে চাল পাঠিয়েছে। মনটা খারাপ হয়ে গেল।", "I didn't give. Then I saw they really did send a boatload of rice. I feel bad now."],
        out: {
          rep: -2,
          sense: 1,
          lesson: ["সব দানকে সন্দেহ করলে সত্যিকারের মানুষ সাহায্য পায় না। চিহ্নগুলো দেখুন, তারপর বিচার করুন।", "If you doubt every gift, people in real need get no help. Look at the signs, then judge."],
        },
      },
    },
  },
  {
    key: "stranger_vendor_rumour",
    kind: "stranger",
    from: ["সবজি বিক্রেতা", "Vegetable seller"],
    body: ["সাবধান! কাল থেকে লবণ ৫০০ টাকা কেজি! দেশে লবণ শেষ! এখনই কিনে রাখুন। সবাইকে শেয়ার করুন।", "Warning! From tomorrow salt is Tk 500 a kilo! The country's out of salt! Buy now. Share with everyone."],
    nodes: {
      start: {
        who: "o",
        say: ["গ্রুপে দেখলাম, কাল থেকে লবণের দাম দশ গুণ! বস্তা কিনে রাখি? লোকজন লাইন দিচ্ছে।", "I saw in a group that salt goes up tenfold tomorrow! Shall I stock up a sack? People are queuing."],
        options: [
          { text: ["গুজব। আড়তে জিজ্ঞেস করে দেখুন।", "It's a rumour. Ask at the wholesale market."], go: "right" },
          { text: ["কিনে ফেলুন, পরে পাবেন না।", "Buy now, you won't get any later."], go: "wrong" },
          { text: ["খবরটা কে দিল?", "Who gave this news?"], go: "ask" },
        ],
      },
      ask: {
        who: "o",
        say: ["গ্রুপে কেউ একজন ফরোয়ার্ড করেছে। নাম নেই, তারিখ নেই, শুধু লাল লেখা।", "Someone forwarded it to the group. No name, no date, only red letters."],
        options: [
          { text: ["উৎস নেই মানে গুজব। শেয়ার করবেন না।", "No source means a rumour. Don't share it."], go: "right" },
          { text: ["সবাই বলছে যখন, সত্যি হবেই।", "If everyone's saying it, it must be true."], go: "wrong" },
        ],
      },
      right: {
        who: "o",
        say: ["আড়তে বলল, গুদাম ভর্তি লবণ! আমি গ্রুপে লিখে দিলাম, সবাই শান্ত হলো।", "The wholesaler says the warehouses are full of salt! I wrote that in the group and everyone calmed down."],
        out: {
          rep: 3,
          sense: 2,
          lesson: ["উৎস ছাড়া ভয়ের খবর শেয়ার করবেন না। বাজারে বা বিশ্বাসযোগ্য খবরে মিলিয়ে নিন।", "Don't share frightening news with no source. Check at the market or with news you can trust."],
        },
      },
      wrong: {
        who: "o",
        say: ["তিন গুণ দামে বস্তা কিনলাম। পরদিন দাম আগের মতো। টাকা আর লবণ দুটোই আটকে গেল।", "I bought a sack at triple the price. Next day the price was back to normal. Money and salt, both stuck."],
        out: {
          rep: -3,
          sense: 1,
          lesson: ["গুজবে লাভ হয় শুধু যে দাম বাড়িয়ে বেচে তার। আতঙ্কে কিনলে অন্যদের ক্ষতিও বাড়ে।", "A rumour only profits those who sell at inflated prices. Panic buying hurts others as well."],
        },
      },
    },
  },
  {
    key: "stranger_nurse_phone",
    kind: "stranger",
    from: ["ক্লিনিকের নার্স", "Clinic nurse"],
    nodes: {
      start: {
        who: "o",
        say: ["অনলাইনে নতুনের মতো ফোন, মাত্র আট হাজার। বিক্রেতা বলছে দুই হাজার অগ্রিম পাঠান। দেব?", "A phone good as new online, only eight thousand. The seller says send two thousand in advance. Should I?"],
        options: [
          { text: ["না দেখে অগ্রিম দেবেন না।", "Don't pay an advance without seeing it."], go: "right" },
          { text: ["এই দামে পাবেন না, দিয়ে দিন।", "You won't get this price again, pay it."], go: "wrong" },
          { text: ["দেখা করতে চায় না কেন?", "Why won't the seller meet you?"], go: "ask" },
        ],
      },
      ask: {
        who: "o",
        say: ["বলল সে চট্টগ্রামে, কুরিয়ারে পাঠাবে। আরও দুজন নাকি লাইনে আছে।", "He says he's in Chattogram and will send it by courier. Apparently two more people are waiting."],
        options: [
          { text: ["তাড়া দিচ্ছে মানেই সাবধান। দোকানে কিনুন।", "Rushing you means be careful. Buy at a shop."], go: "right" },
          { text: ["কুরিয়ার তো নিরাপদ, পাঠান।", "Couriers are safe, send it."], go: "wrong" },
        ],
      },
      right: {
        who: "o",
        say: ["ঠিক আছে, ছুটির দিনে মার্কেটে গিয়ে দেখে কিনব। রাতের ডিউটির টাকা, এভাবে দিতে পারি না।", "All right, I'll go to the market on my day off and buy after looking. That's night-shift money, I can't throw it away."],
        out: {
          rep: 3,
          sense: 2,
          lesson: ["দাম কম, তাড়া বেশি, দেখা নেই, এই তিনেই সন্দেহ করুন। জিনিস হাতে নিয়ে দাম দিন।", "A low price, a rush and no meeting should all make you suspicious. Pay with the goods in your hand."],
        },
      },
      wrong: {
        who: "o",
        say: ["অগ্রিম দিলাম। বিক্রেতা আমাকে ব্লক করে দিয়েছে। কত রাতের ডিউটির টাকা ছিল।", "I paid the advance. The seller's blocked me. That was so many nights' duty."],
        out: {
          rep: -3,
          sense: 1,
          lesson: ["অগ্রিম মানে সব ঝুঁকি ক্রেতার। অচেনা বিক্রেতার সাথে দেখে তবে লেনদেন, এটাই বলুন।", "An advance puts all the risk on the buyer. See the goods before dealing with an unknown seller, that's the advice."],
        },
      },
    },
  },
  {
    key: "stranger_elder_remittance",
    kind: "stranger",
    real: true,
    from: ["প্রবাসীর বৃদ্ধ পিতা", "Old father of a son abroad"],
    body: ["আপনার অ্যাকাউন্টে বিদেশ থেকে ৩৫,০০০ টাকা জমা হয়েছে। ব্যালান্স দেখতে শাখায় আসুন বা কার্ডের পেছনের নম্বরে ফোন করুন।", "Tk 35,000 from abroad has been credited to your account. Visit the branch or call the number on the back of your card for your balance."],
    nodes: {
      start: {
        who: "o",
        say: ["ছেলে বিদেশ থেকে টাকা পাঠাল বলছে। এত টাকার মেসেজ দেখে ভয় লাগে। ব্যাংকে গিয়ে তুলব?", "It says my son sent money from abroad. So much money in a message scares me. Should I go to the bank?"],
        options: [
          { text: ["যান, শাখায় গেলে সব মিলিয়ে নেবে।", "Go, the branch will check it all with you."], go: "right" },
          { text: ["ভুয়া, ব্যাংকে যাবেন না।", "It's fake, don't go to the bank."], go: "wrong" },
          { text: ["ছেলেকে জিজ্ঞেস করেছেন?", "Have you asked your son?"], go: "ask" },
        ],
      },
      ask: {
        who: "o",
        say: ["কাল ফোনে বলল, গতকালই পাঠিয়েছে, ওই টাকাই। মেসেজে তো কোনো কোডও চায়নি।", "He told me by phone that he sent it yesterday, this same money. And the message asks for no code."],
        options: [
          { text: ["মিলে গেছে। শাখায় গিয়ে নিন।", "It all matches. Collect it at the branch."], go: "right" },
          { text: ["এত টাকা, তবু বিশ্বাস নেই। যাবেন না।", "So much money, I still wouldn't trust it. Don't go."], go: "wrong" },
        ],
      },
      right: {
        who: "o",
        say: ["শাখায় গিয়ে পেয়ে গেলাম। এ মাসের ঘরভাড়া আর ওষুধের চিন্তা গেল। ভালো থাকুন।", "I went to the branch and got it. This month's rent and medicine are taken care of. Be well."],
        out: {
          rep: 3,
          sense: 2,
          lesson: ["ছেলের কথায় মিলেছে, কোড চায়নি, লিংক নেই। টাকা এলে শাখায় বা ব্যালান্সে দেখা যায়।", "It matched what his son said, with no code and no link. Real money can be seen at the branch or in the balance."],
        },
      },
      wrong: {
        who: "o",
        say: ["গেলাম না। ঘরভাড়া দিতে পারলাম না, মালিক খুব কথা শোনাল। পরে শুনি টাকাটা আসলই ছিল।", "I didn't go. I couldn't pay the rent and the landlord gave me an earful. Later I heard the money was real."],
        out: {
          rep: -3,
          sense: 1,
          lesson: ["ভয়ে আসল টাকাও আটকে থাকে। ব্যাংকে গিয়ে জিজ্ঞেস করায় কোনো ঝুঁকি নেই, এটাই বলুন।", "Fear can hold back real money too. Asking at the bank carries no risk, so tell people that."],
        },
      },
    },
  },
];
