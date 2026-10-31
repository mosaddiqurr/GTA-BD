import type { StreetEvent } from "./types";

export const EVENTS_2: StreetEvent[] = [
  {
    key: "event_flower_seller",
    id: "npc_woman_plum",
    hint: ["একজন বেলি ফুলের মালা বিক্রি করছেন", "Someone is selling jasmine garlands"],
    place: "footpath",
    nodes: {
      start: {
        who: "o",
        say: ["বেলি ফুলের মালা! কিনলে বাসায় ঝগড়া কমে, না কিনলে বাড়ে। একটা নিবেন?", "Jasmine garlands! Buy one and there's less arguing at home. Don't, and there's more. One for you?"],
        options: [
          { text: ["একটা দেন।", "I'll have one."], go: "buy", out: { money: -20 } },
          { text: ["কার জন্য নিব, সেটাই তো জানি না।", "I don't even know who I'd buy it for."], go: "who" },
          { text: ["লাগবে না।", "No need."], go: "no" },
        ],
      },
      buy: { who: "o", say: ["এই নেন, সবচেয়ে তাজাটা। সকালে নিজের হাতে গেঁথেছি।", "Here, the freshest one. I strung it myself this morning."], next: "gave" },
      gave: { who: "o", say: ["যাকে দিবেন, বলবেন অনেক দাম দিয়ে কিনেছেন। ফুলের অর্ধেক দাম কথায়।", "Whoever you give it to, say it cost a fortune. Half a flower's worth is in the telling."], out: { rep: 1 } },
      who: {
        who: "o",
        say: ["কেউ না থাকলে নিজের জন্য নেন। ঘরে ফুলের গন্ধ থাকলে রাগ কম হয়।", "If there's nobody, buy it for yourself. A room that smells of flowers has less temper in it."],
        options: [
          { text: ["তাহলে দেন একটা।", "Give me one then."], go: "buy", out: { money: -20 } },
          { text: ["মালা থাক, টাকাটা রাখেন।", "Keep the garland, just take the money."], go: "give", out: { money: -20, rep: 3 } },
        ],
      },
      give: { who: "o", say: ["বিনা ফুলে টাকা নিব কেন? আমি ব্যবসা করি, ভিক্ষা না। এই নেন মালা।", "Why would I take money with no flowers? I run a business, I don't beg. Here's your garland."], next: "gave" },
      no: { who: "o", say: ["ঠিক আছে। কাল ফুলও থাকবে, ঝগড়াও থাকবে। তখন আসবেন।", "All right. Tomorrow there'll be flowers, and arguments too. Come then."] },
    },
  },
  {
    key: "event_lost_delivery",
    id: "npc_worker_jackfruit",
    hint: ["একজন ডেলিভারি কর্মী ঠিকানা খুঁজে পাচ্ছেন না", "A delivery man can't find the address"],
    place: "footpath",
    nodes: {
      start: {
        who: "o",
        say: ["সবুজ গেট, নিচে পানের দোকান, পাশে কাঁঠাল গাছ। এই শহরে তো সব গেটই সবুজ!", "Green gate, paan shop below, jackfruit tree beside it. Every gate in this city is green!"],
        options: [
          { text: ["ফোনে কাস্টমারকে ধরেন।", "Ring the customer."], go: "phone" },
          { text: ["ওই দোকানদার জানবে, চলেন।", "That shopkeeper will know, come on."], go: "shop" },
          { text: ["আমিও এখানে নতুন।", "I'm new here too."], go: "no" },
        ],
      },
      phone: {
        who: "o",
        say: ["ধরার আগেই আরেক ফোন এল! বলছে, কোম্পানি থেকে, বেতন পেতে ওটিপি বলেন।", "Before I could, another call came! They say they're the company, and to give an OTP to get my pay."],
        options: [
          { text: ["বলবেন না, কেটে দেন।", "Don't tell them, hang up."], go: "cut", out: { rep: 2, sense: 2 } },
          { text: ["বলে দেন, বেতন তো দরকার।", "Tell them, you need your pay."], go: "told", out: { rep: -2, sense: 1 } },
        ],
      },
      cut: {
        who: "o",
        say: ["কেটে দিলাম! ঠিকই তো, বেতন দিতে ওটিপি লাগে নাকি? আজ বেঁচে গেলাম।", "Hung up! You're right, why would paying me need an OTP? That was a close thing."],
        next: "shop",
        out: { lesson: ["ওটিপি দিয়ে টাকা পাওয়া যায় না, যায় চলে। যে ওটিপি চায়, সে আপনার টাকা নিতে চায়।", "An OTP never brings money in, it lets money out. Whoever asks for one wants your money."] },
      },
      told: {
        who: "o",
        say: ["বলে দিলাম। হায় হায়, টাকা কাটার মেসেজ এল! এখন আমি কী করি?", "I told them. Oh no, a message says money's been taken! What do I do now?"],
        next: "shop",
        out: { lesson: ["ওটিপি কাউকে বলতে নেই। ভুল হলে সঙ্গে সঙ্গে ঝটপট টাকার আসল নাম্বারে জানান।", "Never tell anyone an OTP. If it happens, ring Jhotpot Taka's real number right away."] },
      },
      shop: { who: "o", say: ["দোকানদার বলছে, ওই সবুজ গেট না, এই সবুজ গেট। পান কিনলে আরও ভালো করে বলবে।", "The shopkeeper says not that green gate, this green gate. Buy a paan and he'll be clearer."], next: "done" },
      done: { who: "o", say: ["পেয়েছি! খাবার এখনো একটু গরম। এই শিঙাড়াটা নেন, বাড়তি ছিল।", "Found it! The food's still a little warm. Have this shingara, it was extra."], out: { rep: 2 } },
      no: { who: "o", say: ["আপনিও নতুন? দুই নতুন মিলে তো পুরনো হয় না। আচ্ছা, যাই।", "You too? Two new people don't add up to an old hand. All right, I'm off."] },
    },
  },
  {
    key: "event_two_beggars",
    id: "npc_commuter_lychee",
    hint: ["একজন ভাড়া চাইছেন, পাশেই এক বৃদ্ধ চুপ করে বসে আছেন", "A man's asking for his fare, and an old man sits quietly nearby"],
    place: "busstop",
    nodes: {
      start: {
        who: "o",
        say: ["মানিব্যাগ চুরি গেছে। বাড়ি বরিশাল, লঞ্চ ধরতে পাঁচশো টাকা লাগবে। একটু দিবেন?", "My wallet's been stolen. Home's Barishal, and I need five hundred for the launch. Can you help?"],
        options: [
          { text: ["কাল তো শুনলাম বাড়ি রংপুর।", "Yesterday I heard your home was Rangpur."], go: "caught", out: { sense: 1 } },
          { text: ["টাকা না, চলেন টিকিট কেটে দিই।", "Not money. Come on, I'll buy you the ticket."], go: "ticket", out: { sense: 1 } },
          { text: ["এই পঞ্চাশ টাকা রাখেন।", "Here, take fifty."], go: "paid", out: { money: -50 } },
        ],
      },
      caught: { who: "o", say: ["রংপুর? ওহ, ওটা আমার ভায়রার বাড়ি। মানে তার বাড়ি রংপুর, আজ আমি বরিশাল।", "Rangpur? Oh, that's my brother-in-law's. I mean his home's Rangpur. Today I'm Barishal."], next: "left" },
      ticket: { who: "o", say: ["টিকিট? না মানে, হাতে টাকা হলে ভালো হতো। ঘাটটা আজ মনে হয় বন্ধ।", "A ticket? Well, money in hand would be better. I think the ghat's closed today."], next: "left" },
      paid: {
        who: "o",
        say: ["অনেক ধন্যবাদ! আর পঞ্চাশ হলে লঞ্চের কাছাকাছি চলে যাব।", "Thanks so much! Another fifty and I'll be near the launch."],
        next: "left",
        out: { lesson: ["কান্নার গল্প রোজ অন্য জেলায় গেলে সাবধান। হাতে টাকা না দিয়ে টিকিট বা খাবার কিনে দিন।", "If the sad story moves district daily, be careful. Buy a ticket or food instead of handing over money."] },
      },
      left: { who: "o", say: ["আচ্ছা, আমার বাস এসে গেছে। বরিশালের বাস। ওই দিকে। আসি।", "Right, here's my bus. The Barishal bus. That way. Bye."], next: "old" },
      old: {
        who: "h",
        say: ["পাশের মুরুব্বি এতক্ষণ বসে আছেন, কিছুই চাননি। পাশে শুধু একটা খালি বাটি।", "That old man's been sitting there all this time and hasn't asked for a thing. Just an empty bowl beside him."],
        options: [
          { text: ["ওনাকে রুটি আর কলা কিনে দিই।", "I'll buy him bread and a banana."], go: "food", out: { money: -20, rep: 3 } },
          { text: ["আজ থাক।", "Not today."], go: "skip" },
        ],
      },
      food: {
        who: "h",
        say: ["উনি কিছু বললেন না, শুধু হাতটা একটু ধরে রাখলেন।", "He said nothing. He only held my hand for a moment."],
        out: { lesson: ["যে জোরে চায়, সে সবসময় সবচেয়ে অভাবী না। সাহায্য করলে নিজের হাতে করুন।", "The loudest asker isn't always the neediest. If you help, do it with your own hands."] },
      },
      skip: { who: "h", say: ["বাস এসে গেল। কাল আবার এই পথে আসব।", "The bus is here. I'll come this way again tomorrow."] },
    },
  },
  {
    key: "event_form_fee",
    id: "npc_girl_pear",
    hint: ["এক ছাত্রী ফর্মের টাকা নিয়ে চিন্তায় আছে", "A schoolgirl is worried about her form fee"],
    place: "footpath",
    nodes: {
      start: {
        who: "o",
        say: ["পরীক্ষার ফর্মের টাকা কম পড়েছে, কাল শেষ দিন। আর একজন ফোনে বলছে উপবৃত্তি পাব।", "I'm short for the exam form and tomorrow's the last day. And someone on the phone says I've won a stipend."],
        options: [
          { text: ["উপবৃত্তি? সে কী চাইল?", "A stipend? What did they ask for?"], go: "ask" },
          { text: ["টাকা কত কম পড়েছে?", "How much are you short?"], go: "short" },
          { text: ["শিক্ষককে বলেছ?", "Have you told your teacher?"], go: "teacher" },
        ],
      },
      ask: {
        who: "o",
        say: ["বলল, ওটিপিটা বলো, টাকা এখনই চলে আসবে। আব্বার ফোনে এসেছে।", "They said to read out the OTP and the money comes at once. It came to my father's phone."],
        options: [
          { text: ["বলবে না। টাকা দিতে ওটিপি লাগে না।", "Don't. Nobody needs an OTP to give you money."], go: "good", out: { rep: 2, sense: 2 } },
          { text: ["বলেই দেখো না।", "Why not try telling them?"], go: "bad", out: { rep: -1, sense: 1 } },
        ],
      },
      good: {
        who: "o",
        say: ["তাই তো! টাকা দিতে গোপন নাম্বার লাগলে টাকা তো ওর কাছেই যাবে!", "Of course! If giving money needs a secret number, the money must be going to them!"],
        next: "short",
        out: { lesson: ["উপবৃত্তি বা পুরস্কারের নামে ওটিপি চাইলে সেটা প্রতারণা। স্কুলে গিয়ে জেনে নিন।", "A stipend or prize that wants your OTP is a scam. Ask at the school instead."] },
      },
      bad: {
        who: "o",
        say: ["আব্বা শুনেই ফোনটা নিয়ে কেটে দিলেন। বললেন, ওটিপি মানে বাড়ির চাবি।", "Father heard and took the phone and hung up. He says an OTP is the key to the house."],
        next: "short",
        out: { lesson: ["ওটিপি বাড়ির চাবির মতো। অচেনা কারো হাতে দেওয়া যায় না।", "An OTP is like a house key. You don't hand it to a stranger."] },
      },
      short: {
        who: "o",
        say: ["পঞ্চাশ টাকা কম। টিফিনের টাকা জমাচ্ছি, কিন্তু সময় তো কাল পর্যন্ত।", "Fifty short. I'm saving my lunch money, but I only have till tomorrow."],
        options: [
          { text: ["এই নাও, পঞ্চাশ টাকা।", "Here, fifty."], go: "give", out: { money: -50, rep: 4 } },
          { text: ["শিক্ষককে বলো, সময় দিবেন।", "Tell your teacher, they'll give you time."], go: "teacher" },
        ],
      },
      give: { who: "o", say: ["সত্যি? রসিদ এনে দেখাব! পাস করলে মিষ্টিও আনব।", "Really? I'll bring you the receipt to see! And sweets if I pass."] },
      teacher: { who: "o", say: ["বলব? আচ্ছা, কালই বলব। লজ্জার চেয়ে পরীক্ষা বড়।", "Should I? All right, I'll tell them tomorrow. The exam matters more than being shy."], out: { rep: 1 } },
    },
  },
  {
    key: "event_scratched_car",
    id: "npc_boss_quince",
    hint: ["গাড়ির দাগ নিয়ে তর্ক চলছে", "There's an argument over a scratched car"],
    place: "road",
    nodes: {
      start: {
        who: "o",
        say: ["দেখেন তো, রিকশাটা আমার নতুন গাড়িতে দাগ দিয়ে দিল! পুরো দুই লাখ টাকার দাগ!", "Look, that rickshaw's scratched my new car! A two-lakh scratch!"],
        options: [
          { text: ["আগে দাগটা দেখি।", "Let me see the scratch first."], go: "look" },
          { text: ["রিকশাচালক কী বলছেন?", "What does the rickshaw driver say?"], go: "other" },
          { text: ["পুলিশ ডাকেন।", "Call the police."], go: "police" },
        ],
      },
      look: { who: "h", say: ["দাঁড়ান, আঙুল দিয়ে একটু ঘষে দেখি।", "Wait, let me rub it with a finger."], next: "rubbed" },
      rubbed: {
        who: "o",
        say: ["আরে, দাগ তো উঠে গেল! এটা কাদা ছিল? মানে, আমি আগেই সন্দেহ করছিলাম।", "Oh, the scratch came off! It was mud? I mean, I suspected as much."],
        options: [
          { text: ["রিকশাচালককে কিছু বলবেন না?", "Won't you say something to the driver?"], go: "sorry", out: { money: 20, rep: 3 } },
          { text: ["যাক, ভালোয় ভালোয় মিটল।", "Well, that ended nicely."], go: "over", out: { rep: 2 } },
        ],
      },
      sorry: { who: "o", say: ["হ্যাঁ, মানে, ওনার ভাড়াটা আমি দিচ্ছি। আপনিও এই চায়ের টাকাটা রাখেন।", "Yes, well, I'll pay his fare for today. And you take this for a tea."] },
      over: { who: "o", say: ["আমার দেরি হয়ে গেল। এত বড় গাড়ি, এত ছোট কাদা, আর এত বড় মেজাজ।", "I'm late now. Such a big car, such a little mud, and such a big temper."] },
      other: {
        who: "o",
        say: ["উনি বলছেন, উনি গাড়ি ছোঁননি, রিকশা ছুঁয়েছে। এটা কোনো যুক্তি হলো?", "He says he didn't touch the car, the rickshaw did. Is that even an argument?"],
        options: [
          { text: ["দাগটা একবার দেখি।", "Let me take a look at the scratch."], go: "look" },
          { text: ["দুজনেই একটু ছাড় দেন।", "Both of you give a little."], go: "halfway", out: { rep: 2 } },
        ],
      },
      halfway: { who: "o", say: ["ছাড়? আচ্ছা, দুই লাখ থেকে কমিয়ে বিশ টাকা। উনি দশ, আমি দশ। শেষ।", "Give a little? Fine, down from two lakh to twenty taka. Ten from him, ten from me. Done."] },
      police: { who: "o", say: ["পুলিশ এলে আমার মিটিং শেষ। থাক, আপনিই দাগটা একটু দেখেন।", "If the police come, my meeting's gone. Forget it, you take a look at the scratch."], next: "look" },
    },
  },
  {
    key: "event_dog_gate",
    id: "npc_woman_peach",
    hint: ["একটা কুকুর গেটের ওপাশে আটকে গেছে", "A dog is stuck behind a gate"],
    place: "footpath",
    nodes: {
      start: {
        who: "o",
        say: ["লালু গেটের ফাঁক দিয়ে ঢুকেছে, এখন আর বের হতে পারছে না। সারা সকাল কাঁদছে।", "Lalu squeezed through the gate and can't get out. He's been crying all morning."],
        options: [
          { text: ["দারোয়ানকে ডাকি।", "I'll call the guard."], go: "guard" },
          { text: ["বিস্কুট দিয়ে টেনে আনি।", "I'll tempt him out with a biscuit."], go: "biscuit", out: { money: -5 } },
          { text: ["গেট টপকে যাই।", "I'll climb the gate."], go: "climb" },
        ],
      },
      guard: {
        who: "o",
        say: ["দারোয়ান বলছে, মালিকের অনুমতি ছাড়া গেট খোলা নিষেধ। মালিক থাকেন কানাডায়।", "The guard says he can't open it without the owner's say-so. The owner lives in Canada."],
        options: [
          { text: ["বিস্কুট দিয়ে চেষ্টা করি।", "I'll try a biscuit."], go: "biscuit", out: { money: -5 } },
          { text: ["মালিককে ফোন করতে বলেন।", "Tell him to ring the owner."], go: "call" },
        ],
      },
      call: { who: "o", say: ["ফোন করল। মালিক জিজ্ঞেস করছেন, কুকুরটা ভাড়া দেয় কি না। এখন খুলতে বলেছেন।", "He rang. The owner asked if the dog pays rent. Now he's said to open up."], next: "open" },
      biscuit: { who: "h", say: ["লালু, আয় আয়! এই যে বিস্কুট!", "Lalu, come on, come on! Here's a biscuit!"], next: "open" },
      climb: {
        who: "o",
        say: ["না না, গেট অনেক উঁচু। লালুর সঙ্গে আপনাকেও নামাতে হবে নাকি?", "No, no, that gate's too high. Do we have to get you down as well as Lalu?"],
        options: [
          { text: ["তাহলে বিস্কুট।", "A biscuit then."], go: "biscuit", out: { money: -5 } },
          { text: ["দারোয়ানকে ডাকি।", "I'll call the guard."], go: "guard" },
        ],
      },
      open: {
        who: "o",
        say: ["বের হয়েছে! লেজ নাড়ছে! আরে দেখেন, আবার ঢুকে যাচ্ছে!", "He's out! Tail's wagging! Oh, look, he's going back in!"],
        next: "end",
        out: { rep: 3 },
      },
      end: { who: "o", say: ["ওপাশে ছায়া বেশি, দারোয়ান ভাতও দেয়। আমিই বোকা, আপনাকেও বানালাম। ধন্যবাদ।", "There's more shade that side, and the guard feeds him. I'm the fool, and I've made you one too. Thanks."] },
    },
  },
];
