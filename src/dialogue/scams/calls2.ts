import type { Scam } from "../types";

/** The second half of the scam phone calls. Use CALLS from calls.ts, which already includes these. */
export const CALLS2: Scam[] = [
  {
    key: "call_sim_upgrade",
    kind: "call",
    from: ["আপনার মোবাইল কোম্পানি", "Your Mobile Company"],
    nodes: {
      start: {
        who: "o",
        say: ["আপনার মোবাইল কোম্পানি থেকে বলছি। পুরোনো সিম আজ রাতে বন্ধ হবে। ফোনেই নতুন সিমে নিয়ে যাচ্ছি।", "This is your mobile company. Old SIMs stop working tonight. We're moving you to a new one by phone."],
        options: [
          { text: ["কী করতে হবে?", "What do I have to do?"], go: "how" },
          { text: ["দোকানে গিয়ে বদলে নেব।", "I'll change it at the shop."], go: "shop" },
          { text: ["আমার সিম তো ঠিকই চলছে।", "My SIM's working fine."], go: "fine" },
        ],
      },
      how: {
        who: "o",
        say: ["আপনার জন্মতারিখ আর পরিচয়পত্রের শেষ চার সংখ্যা বলুন। তারপর একটা কোড আসবে।", "Tell me your date of birth and the last four digits of your ID. A code will come after that."],
        options: [
          { text: ["বলছি।", "I'll tell you."], go: "code" },
          { text: ["ওসব তো আপনাদের কাছে থাকার কথা।", "You should have all that already."], go: "caught" },
        ],
      },
      shop: {
        who: "o",
        say: ["দোকানে আজ প্রচণ্ড ভিড়, আর সিম বন্ধ হলে ঝটপট টাকাও বন্ধ। ফোনে মাত্র দুই মিনিট।", "The shops are packed today, and if your SIM stops so does Jhotpot Taka. By phone it's two minutes."],
        options: [
          { text: ["ঠিক আছে, ফোনেই করুন।", "All right, do it by phone."], go: "how" },
          { text: ["ভিড় হোক, দোকানেই যাব।", "Crowded or not, I'm going to the shop."], go: "caught" },
        ],
      },
      fine: {
        who: "o",
        say: ["চলছে, তবে আজ রাত পর্যন্ত। নতুন সিম না নিলে নম্বরটাই হারাবেন, কত দিনের নম্বর!", "It works, but only till tonight. Without a new SIM you'll lose the number, after all these years!"],
        options: [
          { text: ["আচ্ছা, কী করতে হবে?", "All right, what do I do?"], go: "how" },
          { text: ["নম্বর গেলে দোকানে যাব।", "If the number goes, I'll go to the shop."], go: "caught" },
        ],
      },
      code: {
        who: "o",
        say: ["এইমাত্র আসা কোডটা বলুন। তারপর ফোন আধঘণ্টা বন্ধ রাখবেন, নেটওয়ার্ক আসতে সময় লাগে।", "Read me the code that just came. Then keep your phone off for half an hour, the network takes time."],
        options: [
          { text: ["কোডটা বলছি।", "I'll read the code."], go: "lost" },
          { text: ["ফোন বন্ধ রাখব কেন?", "Why should I switch my phone off?"], go: "off" },
        ],
      },
      off: {
        who: "o",
        say: ["নতুন সিম চালু হওয়ার নিয়মই ওটা। এত ভাববেন না, লাখ লাখ গ্রাহক করছেন।", "That's how a new SIM starts up. Don't think so much, lakhs of customers are doing it."],
        options: [
          { text: ["কোডটা বলে দিই।", "I'll read out the code."], go: "lost" },
          { text: ["বুঝেছি, ফোন খোলা রেখে দোকানে যাচ্ছি।", "I see. Phone stays on, and I'm going to the shop."], go: "caught" },
        ],
      },
      lost: {
        who: "o",
        say: ["ধন্যবাদ, সিম বদল শুরু হলো। এখন ফোনটা বন্ধ করে দিন।", "Thank you, the SIM change has begun. Switch your phone off now."],
        out: {
          mobile: -3000,
          sense: 1,
          later: "later_sim_dead",
          lesson: ["ফোন বন্ধ রাখতে বলে, যাতে টাকা কাটার মেসেজ না দেখেন। সিম বদলায় শুধু দোকানে, আঙুলের ছাপে।", "They have you switch off so you miss the deduction messages. SIMs change only at a shop, by fingerprint."],
        },
      },
      caught: {
        who: "o",
        say: ["ঠিক আছে, নম্বর বন্ধ হলে আমাদের দোষ দেবেন না।", "Fine, don't blame us when the number stops."],
        out: {
          sense: 3,
          lesson: ["সিম বদলাতে কোড বা জন্মতারিখ ফোনে লাগে না। পরিচয়পত্র নিয়ে কোম্পানির দোকানে যান।", "Changing a SIM needs no code or birth date by phone. Take your ID to the company's shop."],
        },
      },
    },
  },
  {
    key: "call_used_phone",
    kind: "call",
    from: ["+880 1521 00837", "+880 1521 00837"],
    nodes: {
      start: {
        who: "o",
        say: ["দামি ফোনটার খোঁজ করেছিলেন না? নয় হাজারে দিচ্ছি। আরেকজন আসছে, তবে আপনাকে আগে বলছি।", "You were asking about the expensive phone, weren't you? It's yours for 9,000. Someone else is coming, but I'm telling you first."],
        options: [
          { text: ["হ্যাঁ, চাই। কোথায় দেখতে পারি?", "Yes, I want it. Where can I see it?"], go: "see" },
          { text: ["আমি তো খোঁজ করিনি।", "I never asked about any phone."], go: "no" },
          { text: ["অগ্রিম কত?", "How much advance?"], go: "advance" },
        ],
      },
      see: {
        who: "o",
        say: ["আমি এখন চট্টগ্রামে, ফোন কুরিয়ারে যাবে। হাজার দুই অগ্রিম দিলে আজই পাঠিয়ে দিই।", "I'm in Chattogram now, the phone goes by courier. Pay 2,000 in advance and I'll send it today."],
        options: [
          { text: ["পাঠাচ্ছি।", "I'm sending it."], go: "lost" },
          { text: ["হাতে পেয়ে টাকা দেব।", "I'll pay when I have it in my hand."], go: "cod" },
        ],
      },
      no: {
        who: "o",
        say: ["কারো নম্বর ভুল এসেছে হয়তো। কিন্তু এই দামে এমন ফোন আর পাবেন না, দেখবেন নাকি?", "Maybe someone's number got mixed up. But you won't find this phone at this price, want to see it?"],
        options: [
          { text: ["দেখি, কোথায় পাব?", "Let's see, where can I get it?"], go: "see" },
          { text: ["দরকার নেই।", "No need."], out: { sense: 2, lesson: ["খোঁজ না করেও ফোন আসা নিজেই সন্দেহের। অচেনা বিক্রেতাকে না দেখে টাকা দেবেন না।", "A call about something you never asked for is itself suspicious. Give no money to an unknown seller without seeing the goods."] } },
        ],
      },
      advance: {
        who: "o",
        say: ["মাত্র দুই হাজার। বাকিটা ফোন হাতে পেয়ে দেবেন, এর চেয়ে ভালো নিয়ম হয় না।", "Only 2,000. The rest when the phone's in your hand, you can't get a fairer deal."],
        options: [
          { text: ["পাঠাচ্ছি।", "I'm sending it."], go: "lost" },
          { text: ["অগ্রিম নয়, দেখে কিনব।", "No advance, I'll see it and buy."], go: "cod" },
        ],
      },
      cod: {
        who: "o",
        say: ["ওভাবে হবে না, লোকে ফেরত দিয়ে দেয়। না নিলে অন্যজনকে দিই, তাতে আমারই লাভ।", "That won't do, people send them back. If you don't take it I'll sell to the other one, better for me."],
        options: [
          { text: ["না না, অগ্রিম পাঠাচ্ছি।", "No, no, I'm sending the advance."], go: "lost" },
          { text: ["দিয়ে দিন। না দেখে কিনি না।", "Go ahead and sell it. I don't buy unseen."], go: "caught" },
        ],
      },
      lost: {
        who: "o",
        say: ["পেয়েছি, কাল সকালে কুরিয়ার হবে। রসিদের ছবি পাঠাব।", "Received, it goes by courier tomorrow morning. I'll send a picture of the receipt."],
        out: {
          mobile: -2000,
          sense: 1,
          lesson: ["ফোন দেখেননি, মানুষ চেনেন না, তবু টাকা গেল। পুরোনো জিনিস কিনুন সামনাসামনি, দেখে, তারপর টাকা।", "You never saw the phone or knew the seller, yet the money's gone. Buy second-hand in person: see it, then pay."],
        },
      },
      caught: {
        who: "o",
        say: ["ঠিক আছে, ফোন কিন্তু আর থাকবে না।", "All right, but the phone won't be here for long."],
        out: {
          sense: 2,
          lesson: ["দাম কম, তাড়া বেশি, দেখা নেই, এই তিনেই সন্দেহ করুন। জিনিস হাতে না পেয়ে টাকা দেবেন না।", "A low price, a rush and no meeting should all make you suspicious. Don't pay until it's in your hand."],
        },
      },
    },
  },
  {
    key: "call_flood_relief",
    kind: "call",
    from: ["বন্যা ত্রাণ তহবিল", "Flood Relief Fund"],
    nodes: {
      start: {
        who: "o",
        say: ["উত্তরের বন্যায় লাখো মানুষ ঘরছাড়া। আমরা ত্রাণ তহবিল থেকে বলছি। একটু সাহায্য করবেন?", "Lakhs of people have lost their homes in the northern floods. This is the relief fund. Will you help a little?"],
        options: [
          { text: ["অবশ্যই, কীভাবে দেব?", "Of course, how do I give?"], go: "how" },
          { text: ["আপনাদের অফিস কোথায়?", "Where's your office?"], go: "where" },
          { text: ["আমি পাড়ার দলকে দেব।", "I'll give through my local group."], go: "local" },
        ],
      },
      how: {
        who: "o",
        say: ["এই নম্বরে ঝটপট টাকা পাঠান। এক হাজার টাকায় একটা পরিবারের এক সপ্তাহের খাবার।", "Send Jhotpot Taka to this number. A thousand taka feeds a family for a week."],
        options: [
          { text: ["পাঠাচ্ছি।", "I'm sending it."], go: "lost" },
          { text: ["এটা তো ব্যক্তিগত নম্বর মনে হচ্ছে।", "This looks like a personal number."], go: "personal" },
        ],
      },
      where: {
        who: "o",
        say: ["অফিস এখন পানির নিচে, সবাই ত্রাণে ব্যস্ত। আজ না দিলে কাল অনেক দেরি হয়ে যাবে।", "The office is under water now, everyone's busy with relief. If not today, tomorrow will be too late."],
        options: [
          { text: ["আচ্ছা, কীভাবে দেব?", "All right, how do I give?"], go: "how" },
          { text: ["সংগঠনের নিবন্ধন নম্বর বলুন।", "Tell me your registration number."], go: "reg" },
        ],
      },
      personal: {
        who: "o",
        say: ["এখন কাজের চাপে আমার নম্বরেই নিচ্ছি। মানুষ বিপদে, আর আপনি এসব দেখছেন?", "With all this work I'm taking it on my own number. People are in danger and you're looking at this?"],
        options: [
          { text: ["ঠিক আছে, রাগ করবেন না।", "All right, don't be cross."], go: "lost" },
          { text: ["রসিদ ছাড়া দেব না।", "Not without a receipt."], go: "reg" },
        ],
      },
      reg: {
        who: "o",
        say: ["রসিদ পরে পাবেন, নিবন্ধন চলছে। আপনার মতো মানুষ না দিলে আর কে দেবে?", "You'll get a receipt later, registration's in progress. If people like you don't give, who will?"],
        options: [
          { text: ["তবু পাড়ার চেনা দলকেই দেব।", "I'll still give through people I know."], go: "local" },
          { text: ["আচ্ছা, দিচ্ছি।", "All right, I'll give."], go: "lost" },
        ],
      },
      lost: {
        who: "o",
        say: ["ধন্যবাদ। আপনার মতো মানুষ আছেন বলেই দেশ চলছে।", "Thank you. It's people like you who keep this country going."],
        out: {
          mobile: -1000,
          sense: 1,
          later: "later_charity_again",
          lesson: ["বিপদের সময় মায়াকে কাজে লাগিয়েই এরা টাকা তোলে। দান করুন চেনা দলে, রসিদ নিয়ে।", "They use your kindness in hard times to raise money. Give to people you know, and take a receipt."],
        },
      },
      local: {
        who: "h",
        say: ["আমি পাড়ার চেনা দলের হাতে দেব, রসিদও নেব।", "I'll give it to the local group I know, and take a receipt."],
        out: {
          sense: 3,
          rep: 2,
          lesson: ["দান করার ইচ্ছাটা ঠিকই ছিল। ত্রাণ দিন চেনা সংগঠনে, ফোনে আসা ব্যক্তিগত নম্বরে নয়।", "Wanting to give was right. Give relief to groups you know, not to a personal number from a phone call."],
        },
      },
    },
  },
  {
    key: "call_marriage_bureau",
    kind: "call",
    from: ["বিয়ের ব্যুরো", "Marriage Bureau"],
    nodes: {
      start: {
        who: "o",
        say: ["আপনার পরিবারের বিয়ের জন্য চমৎকার একটা সম্বন্ধ এসেছে। বিদেশে থাকেন, পরিবার খুব ভালো।", "A wonderful match has come up for a wedding in your family. Settled abroad, and a very good family."],
        options: [
          { text: ["কীভাবে খবর পেলেন?", "How did you hear about us?"], go: "how" },
          { text: ["তাই? কথা বলা যাবে?", "Really? Can we talk to them?"], go: "talk" },
          { text: ["আমাদের দরকার নেই।", "We don't need this."], out: { sense: 1, lesson: ["নিজে না চাইতে বিয়ের ব্যুরোর ফোন এলে সন্দেহ করুন। সম্বন্ধের খোঁজ নিন চেনা লোকের মাধ্যমে।", "Be wary when a bureau rings without being asked. Look for matches through people you know."] } },
        ],
      },
      how: {
        who: "o",
        say: ["আমাদের তালিকায় হাজারো পরিবার আছে, আপনার নম্বরও সেখানেই। সেটা বড় কথা নয়।", "We have thousands of families on our list, your number's there too. That's not the point."],
        options: [
          { text: ["তালিকায় আমরা নাম দিইনি।", "We never put our names on any list."], go: "caught" },
          { text: ["আচ্ছা, কথা বলা যাবে?", "All right, can we talk to them?"], go: "talk" },
        ],
      },
      talk: {
        who: "o",
        say: ["অবশ্যই। রেজিস্ট্রেশন ফি দুই হাজার টাকা দিলেই ছবি আর নম্বর পাঠাব। ফি ছাড়া হবে না।", "Of course. Pay the 2,000 taka registration fee and I'll send photos and numbers. Not without the fee."],
        options: [
          { text: ["পাঠাচ্ছি।", "I'm sending it."], go: "lost" },
          { text: ["আগে পরিবারের ঠিকানা দিন।", "Give me the family's address first."], go: "addr" },
          { text: ["বাড়িতে আলোচনা করে জানাব।", "I'll talk at home and let you know."], go: "discuss" },
        ],
      },
      addr: {
        who: "o",
        say: ["ফি ছাড়া ঠিকানা দেওয়া নিয়মে নেই। ওই পরিবারের সম্মানের ব্যাপার, বুঝতেই পারছেন।", "Addresses aren't given without the fee. It's a matter of that family's honour, you understand."],
        options: [
          { text: ["ঠিক আছে, ফি দিচ্ছি।", "All right, I'll pay the fee."], go: "lost" },
          { text: ["ঠিকানা ছাড়া কথা নেই।", "No address, no talk."], go: "caught" },
        ],
      },
      discuss: {
        who: "o",
        say: ["আজই তাঁরা ফিরে যাচ্ছেন, দেরি করলে অন্য পরিবারে কথা পাকা হবে। হাতছাড়া করবেন না।", "They leave today, and if you delay they'll settle with another family. Don't let it slip."],
        options: [
          { text: ["আচ্ছা, দিচ্ছি।", "All right, I'll pay."], go: "lost" },
          { text: ["তাড়াহুড়োয় বিয়ে হয় না।", "Weddings aren't arranged in a rush."], go: "caught" },
        ],
      },
      lost: {
        who: "o",
        say: ["পেয়েছি। ছবি শিগগির পাঠাচ্ছি। ওঁরা খুব আগ্রহী, আবার ফোন করব।", "Received. Photos coming soon. They're very interested, I'll ring again."],
        out: {
          mobile: -2000,
          sense: 1,
          later: "later_bureau_more",
          lesson: ["বিদেশি সম্বন্ধের গল্প আর আগে ফি, এই জোড়াই ফাঁদ। ঠিকানা দেখে, চেনা লোকের মাধ্যমে খোঁজ নিন।", "A tale of a match abroad plus a fee first is the trap. Look through people you know, and see the address."],
        },
      },
      caught: {
        who: "o",
        say: ["যেমন ইচ্ছা। এমন পরিবার আর পাবেন না।", "As you wish. You won't find a family like this again."],
        out: {
          sense: 3,
          lesson: ["আসল সম্বন্ধে পরিবারের ঠিকানা আর মানুষ দেখা যায়। ফি ছাড়া দেখা হবে না মানে ব্যবসা ওই ফি।", "A real match has a family and an address you can see. No meeting without a fee means the fee is the business."],
        },
      },
    },
  },
  {
    key: "call_herbal_medicine",
    kind: "call",
    from: ["ভেষজ চিকিৎসা কেন্দ্র", "Herbal Care Centre"],
    nodes: {
      start: {
        who: "o",
        say: ["পরিবারের কারো ডায়াবেটিস বা গ্যাস্ট্রিক আছে? আমাদের ভেষজ কোর্সে সাত দিনে চিরতরে সেরে যায়।", "Does anyone in your family have diabetes or gastric trouble? Our herbal course cures it for good in seven days."],
        options: [
          { text: ["সত্যি সারে? দাম কত?", "It really cures it? How much?"], go: "price" },
          { text: ["ডাক্তার কে? অনুমোদন আছে?", "Who's the doctor? Is it approved?"], go: "doc" },
          { text: ["আমরা ডাক্তার দেখাই, লাগবে না।", "We see a doctor, no need."], out: { sense: 1, lesson: ["ফোনে রোগ সারানোর গল্প শুনবেন না। ওষুধের সিদ্ধান্ত নিন ডাক্তারের সাথে কথা বলে।", "Don't believe cures sold by phone. Decide about medicine by talking to your doctor."] } },
        ],
      },
      price: {
        who: "o",
        say: ["পুরো কোর্স মাত্র আঠারোশো টাকা, অগ্রিম দিলেই বাড়িতে পৌঁছে যাবে। আর ইনসুলিন লাগবে না।", "The full course is only 1,800 taka, delivered home with advance payment. And no more insulin."],
        options: [
          { text: ["পাঠাচ্ছি।", "I'm sending it."], go: "lost" },
          { text: ["ডাক্তারের ওষুধ বন্ধ করব?", "Should I stop the doctor's medicine?"], go: "stop" },
          { text: ["ডাক্তারকে জিজ্ঞেস করে জানাব।", "I'll ask the doctor and let you know."], go: "ask" },
        ],
      },
      doc: {
        who: "o",
        say: ["আমাদের হাকিম বিদেশে পড়েছেন, অনুমোদন প্রক্রিয়াধীন। হাজার রোগী ভালো হয়েছেন।", "Our healer trained abroad, and approval is in process. Thousands of patients have recovered."],
        options: [
          { text: ["অনুমোদন নেই মানে খাওয়া যাবে না।", "No approval means nobody should take it."], go: "caught" },
          { text: ["আচ্ছা, দাম কত?", "All right, how much is it?"], go: "price" },
        ],
      },
      stop: {
        who: "o",
        say: ["হ্যাঁ, হাসপাতালের ওষুধ সব বন্ধ। ওরা তো ব্যবসা করে, রোগ সারাতে চায় না।", "Yes, stop all the hospital's medicine. They're in it for business, they don't want to cure you."],
        options: [
          { text: ["ঠিকই বলেছেন, পাঠাচ্ছি।", "You're right, I'm sending it."], go: "lost" },
          { text: ["ওষুধ বন্ধ করতে বলা বিপদের কথা।", "Telling people to stop medicine is dangerous."], go: "caught" },
        ],
      },
      ask: {
        who: "o",
        say: ["ডাক্তার তো না করবেই, তাঁর ব্যবসা নষ্ট হবে। আজকের ছাড় শুধু আজই।", "Of course the doctor will say no, it would ruin the practice. Today's discount is for today only."],
        options: [
          { text: ["ছাড় হারাব না, পাঠাচ্ছি।", "I won't miss the discount, I'm sending it."], go: "lost" },
          { text: ["তবু ডাক্তারকেই জিজ্ঞেস করব।", "I'll still ask the doctor."], go: "caught" },
        ],
      },
      lost: {
        who: "o",
        say: ["অগ্রিম পেয়েছি। কোর্স আসছে, নিয়মিত খাবেন, আমাদের কথা ছাড়া কিছু খাবেন না।", "Advance received. The course is on its way. Take it regularly, and nothing else unless we say."],
        out: {
          money: -1800,
          sense: 1,
          later: "later_medicine_more",
          lesson: ["সাত দিনে চিরতরে সারে এমন ওষুধ নেই। ডাক্তারের ওষুধ নিজে বন্ধ করবেন না, আগে জিজ্ঞেস করুন।", "No medicine cures for good in seven days. Never stop a doctor's medicine yourself, ask first."],
        },
      },
      caught: {
        who: "o",
        say: ["ঠিক আছে, রোগ নিয়েই থাকুন তাহলে।", "Fine, go on living with the illness then."],
        out: {
          sense: 3,
          lesson: ["চিরতরে সারানোর দাবি আর ওষুধ বন্ধের পরামর্শই ধরিয়ে দিল। মোড়কে অনুমোদন নম্বর দেখে নিন।", "The claim of a lasting cure and the advice to stop medicine gave it away. Look for an approval number on the packet."],
        },
      },
    },
  },
  {
    key: "call_wrong_send",
    kind: "call",
    from: ["+880 1309 00756", "+880 1309 00756"],
    nodes: {
      start: {
        who: "o",
        say: ["ভুল করে আপনার নম্বরে বারোশো টাকা চলে গেছে। ব্যালান্স দেখুন, সত্যিই গেছে। একটু পাঠিয়ে দেবেন?", "By mistake 1,200 taka went to your number. Check your balance, it really did. Would you send it back?"],
        options: [
          { text: ["দেখছি, হ্যাঁ টাকা এসেছে।", "Let me see. Yes, the money's here."], go: "came" },
          { text: ["হেল্পলাইনের মাধ্যমে ফেরত হোক।", "Let the helpline return it."], go: "helpline" },
          { text: ["চিনি না, হেল্পলাইনে জানান।", "I don't know you. Tell the helpline."], go: "helpline" },
        ],
      },
      came: {
        who: "o",
        say: ["তাহলে এই অন্য নম্বরে পাঠান, আগের সিমটা চালু নেই। আপনি খুব ভালো মানুষ।", "Then send it to this other number, the old SIM isn't working. You're a very good person."],
        options: [
          { text: ["পাঠিয়ে দিই।", "I'll send it."], go: "lost" },
          { text: ["যেখান থেকে এসেছে, সেখানে নয় কেন?", "Why not to the number it came from?"], go: "other" },
        ],
      },
      other: {
        who: "o",
        say: ["বললাম তো সিম বন্ধ। হেল্পলাইনে গেলে তিন দিন লাগবে, ততক্ষণে আমি বিপদে পড়ব।", "I told you, that SIM is dead. The helpline takes three days, and by then I'll be in trouble."],
        options: [
          { text: ["আচ্ছা, ওই নম্বরেই দিই।", "All right, I'll send it to that number."], go: "lost" },
          { text: ["তিন দিনই লাগুক, হেল্পলাইনেই যাবে।", "Let it take three days. It goes through the helpline."], go: "helpline" },
        ],
      },
      helpline: {
        who: "o",
        say: ["হেল্পলাইনে জানালে আপনার অ্যাকাউন্টও তদন্তে পড়বে, টাকা আটকে যাবে। শুধু শুধু ঝামেলা কেন?", "Tell the helpline and your account gets investigated too, your money frozen. Why ask for trouble?"],
        options: [
          { text: ["ঝামেলা চাই না, পাঠাই।", "I don't want trouble, I'll send it."], go: "lost" },
          { text: ["আমি হেল্পলাইনেই জানাচ্ছি।", "I'm telling the helpline."], go: "done" },
        ],
      },
      lost: {
        who: "o",
        say: ["পেয়েছি, ধন্যবাদ। আপনার উপকার মনে থাকবে।", "Got it, thank you. I won't forget your kindness."],
        out: {
          mobile: -1200,
          sense: 1,
          later: "later_sucker_list",
          lesson: ["যে টাকা এসেছিল তা চুরির অ্যাকাউন্টের হতে পারে, পরে কেটে যায়। ভুলের টাকা ফেরায় হেল্পলাইন।", "The money that came may be from a stolen account and get reversed later. The helpline returns mistakes, not you."],
        },
      },
      done: {
        who: "h",
        say: ["হেল্পলাইনে জানালাম। তারাই নিয়ম মেনে টাকাটা ফিরিয়ে নিল।", "I told the helpline. They took the money back by their own rules."],
        out: {
          sense: 3,
          lesson: ["সত্যি ভুলে টাকা এলে হেল্পলাইনই সমাধান করে। অন্য নম্বরে পাঠালে দুই দিকেই লোকসান।", "If money really comes by mistake, the helpline sorts it out. Sending it to another number loses you both ways."],
        },
      },
    },
  },
  {
    key: "call_electric_bill",
    kind: "call",
    from: ["বিদ্যুৎ অফিস", "Electricity Office"],
    nodes: {
      start: {
        who: "o",
        say: ["বিদ্যুৎ অফিস থেকে বলছি। আপনার মিটারের তিন মাসের বিল বাকি। আজ সন্ধ্যায় লাইন কেটে দেওয়া হবে।", "This is the electricity office. Three months' bills are due on your meter. Your line gets cut this evening."],
        options: [
          { text: ["সে কী! কত বাকি?", "What! How much is due?"], go: "due" },
          { text: ["আমার মিটার নম্বর কত বলুন।", "Tell me my meter number."], go: "meter" },
          { text: ["আমি তো বিল দিয়েছি।", "But I've paid my bills."], go: "paid" },
        ],
      },
      due: {
        who: "o",
        say: ["আটশো টাকা। এই নম্বরে পাঠালে লাইন কাটার তালিকা থেকে নাম তুলে দিচ্ছি।", "800 taka. Send it to this number and I'll take your name off the cut-off list."],
        options: [
          { text: ["পাঠাচ্ছি।", "I'm sending it."], go: "lost" },
          { text: ["অফিসে গিয়ে বিল দেব।", "I'll pay at the office."], go: "office" },
        ],
      },
      meter: {
        who: "o",
        say: ["মিটার নম্বর এই মুহূর্তে হাতে নেই, লাইনম্যান মাঠে আছে। আপনি আগে টাকা দিন।", "I don't have the meter number on hand, the lineman's out in the field. You pay first."],
        options: [
          { text: ["নম্বরই জানেন না, লাইন কাটবেন কীভাবে?", "You don't know the number, so how will you cut it?"], go: "caught" },
          { text: ["আচ্ছা, কত বাকি?", "All right, how much is due?"], go: "due" },
        ],
      },
      paid: {
        who: "o",
        say: ["খাতায় তো ওঠেনি। আবার সংযোগ নিতে হাজার টাকা লাগবে, তার চেয়ে এখনই মিটিয়ে ফেলুন।", "It's not in the book. Reconnecting costs a thousand, so better settle it right now."],
        options: [
          { text: ["তাহলে কত দিতে হবে?", "Then how much do I pay?"], go: "due" },
          { text: ["রসিদ নিয়ে অফিসে যাচ্ছি।", "I'm taking my receipt to the office."], go: "office" },
        ],
      },
      office: {
        who: "o",
        say: ["অফিসে এখন লম্বা লাইন। আমার কথা শুনুন, এখানেই শেষ করে নিন।", "There's a long queue at the office. Listen to me and finish it here."],
        options: [
          { text: ["আচ্ছা, পাঠাই।", "All right, I'll send it."], go: "lost" },
          { text: ["না, অফিসেই যাব।", "No, I'm going to the office."], go: "caught" },
        ],
      },
      lost: {
        who: "o",
        say: ["পেয়েছি। আজ আর লাইন কাটবে না, চিন্তা করবেন না।", "Received. Your line won't be cut today, don't worry."],
        out: {
          mobile: -800,
          sense: 1,
          lesson: ["বিদ্যুৎ অফিস ব্যক্তিগত নম্বরে বিল নেয় না। বিল দিন মিটার নম্বর দিয়ে, রসিদ রেখে।", "The electricity office takes no bills on a personal number. Pay using your meter number, and keep the receipt."],
        },
      },
      caught: {
        who: "o",
        say: ["ঠিক আছে, সন্ধ্যায় অন্ধকারে বসে থাকবেন।", "Fine, you can sit in the dark this evening."],
        out: {
          sense: 2,
          lesson: ["মিটার নম্বরও বলতে পারেনি। বিল নিয়ে সন্দেহ হলে আগের রসিদ দেখুন, অফিসে গিয়ে জানুন।", "It couldn't even name your meter number. If you doubt a bill, check your receipt and ask at the office."],
        },
      },
    },
  },
  {
    key: "call_govt_allowance",
    kind: "call",
    from: ["সরকারি ভাতা অফিস", "Government Allowance Office"],
    nodes: {
      start: {
        who: "o",
        say: ["সরকারি ভাতা অফিস থেকে বলছি। আপনার পরিবারের নামে বারো হাজার টাকার ভাতা এসেছে, আজই নিতে হবে।", "This is the government allowance office. A 12,000 taka allowance has come for your family, take it today."],
        options: [
          { text: ["ভালো খবর! কীভাবে পাব?", "Good news! How do I get it?"], go: "how" },
          { text: ["কোন ভাতা, কে আবেদন করেছে?", "Which allowance, who applied?"], go: "which" },
          { text: ["ওয়ার্ড অফিসে জিজ্ঞেস করব।", "I'll ask at the ward office."], go: "ward" },
        ],
      },
      how: {
        who: "o",
        say: ["পরিচয়পত্রের নম্বর বলুন। তারপর ফোনে একটা কোড আসবে, ওটা বললেই টাকা ঢুকবে।", "Tell me your ID number. Then a code will come to your phone. Read it out and the money comes in."],
        options: [
          { text: ["নম্বরটা বলছি।", "I'll read the number."], go: "code" },
          { text: ["টাকা পেতে কোড লাগবে কেন?", "Why would getting money need a code?"], go: "why" },
        ],
      },
      which: {
        who: "o",
        say: ["দুর্যোগ সহায়তা ভাতা, আবেদন লাগে না। আমরা তালিকা থেকে নিজেরাই খুঁজে ফোন করি।", "Disaster support, no application needed. We look people up on the list and ring them ourselves."],
        options: [
          { text: ["আচ্ছা, কীভাবে পাব?", "All right, how do I get it?"], go: "how" },
          { text: ["ওয়ার্ড অফিসে জিজ্ঞেস করব।", "I'll ask at the ward office."], go: "ward" },
        ],
      },
      why: {
        who: "o",
        say: ["কোডটাই সরকারের নতুন নিরাপত্তা। এটা ছাড়া টাকা ফেরত চলে যাবে, আজই শেষ দিন।", "The code is the government's new security. Without it the money goes back, and today's the last day."],
        options: [
          { text: ["তাহলে বলে দিই।", "Then I'll tell you."], go: "code" },
          { text: ["টাকা দিতে কোড লাগে না।", "Giving money needs no code."], go: "caught" },
        ],
      },
      code: {
        who: "o",
        say: ["পরিচয়পত্র মিলেছে। এবার কোডটা পড়ে শোনান, একটা একটা করে।", "The ID matches. Now read me the code, one digit at a time."],
        options: [
          { text: ["পড়ে শোনাচ্ছি।", "I'll read it out."], go: "lost" },
          { text: ["না, ওয়ার্ড অফিসেই যাব।", "No, I'm going to the ward office."], go: "ward" },
        ],
      },
      ward: {
        who: "o",
        say: ["ওখানে গেলে লাইন দিতে হবে, টাকাও কমে যাবে। বোকামি করবেন না।", "Go there and you'll queue, and the money will shrink. Don't be foolish."],
        options: [
          { text: ["আচ্ছা, কোডটা বলি।", "All right, I'll read the code."], go: "lost" },
          { text: ["তবু যাব।", "I'm going anyway."], go: "caught" },
        ],
      },
      lost: {
        who: "o",
        say: ["ধন্যবাদ, ভাতা প্রক্রিয়ায় গেল। মেসেজ এলে কাউকে দেখাবেন না।", "Thank you, the allowance is in process. If a message comes, don't show anyone."],
        out: {
          mobile: -2000,
          sense: 1,
          later: "later_loan_in_name",
          lesson: ["টাকা পেতে কোড লাগে না, লাগে টাকা তুলতে। পরিচয়পত্রের নম্বর গেলে নামে ঋণও নেওয়া যায়।", "Receiving money needs no code; taking it does. With your ID number, they can even take a loan in your name."],
        },
      },
      caught: {
        who: "o",
        say: ["ঠিক আছে, আপনার ভাতা ফেরত গেল।", "Fine, your allowance has gone back."],
        out: {
          sense: 3,
          lesson: ["সরকারি ভাতা নিতে হয় অফিসে গিয়ে কাগজে, ফোনে কোড দিয়ে নয়। ওয়ার্ড অফিসে জেনে নিন।", "Government allowances are claimed on paper at an office, not with a code by phone. Ask at the ward office."],
        },
      },
    },
  },
  {
    key: "call_double_money",
    kind: "call",
    from: ["বিনিয়োগ ক্লাব", "Investment Club"],
    nodes: {
      start: {
        who: "o",
        say: ["আমাদের বিনিয়োগ ক্লাবে এক মাসে টাকা দ্বিগুণ! আপনার পাড়ার অনেকেই লাভ পাচ্ছেন। একটু শুনবেন?", "In our investment club your money doubles in a month! Many in your area are profiting. Will you listen?"],
        options: [
          { text: ["শুনি, কীভাবে হয়?", "Go on, how does it work?"], go: "how" },
          { text: ["পাড়ার কে কে লাভ পেল, নাম বলুন।", "Who in my area? Name them."], go: "names" },
          { text: ["না, লাগবে না।", "No, thanks."], out: { sense: 1, lesson: ["নিশ্চিত দ্বিগুণ লাভের কথা শুনলেই সাবধান। আসল ব্যবসায় লাভের মতো ক্ষতিও থাকে।", "Be careful whenever you hear of guaranteed doubling. A real business can lose as well as gain."] } },
        ],
      },
      how: {
        who: "o",
        say: ["বিদেশের ব্যবসায় খাটাই। আজ পাঁচ হাজার দিলে আগামী মাসে দশ হাজার, রোজ অ্যাপে দেখবেন।", "We put it into business abroad. Pay 5,000 today and get 10,000 next month, watch it daily in the app."],
        options: [
          { text: ["পাঁচ হাজার দিই।", "I'll pay the 5,000."], go: "lost" },
          { text: ["অল্প দিয়ে দেখি আগে।", "Let me try with a little first."], go: "small" },
          { text: ["কোম্পানির নিবন্ধন দেখান।", "Show me the company's registration."], go: "reg" },
        ],
      },
      names: {
        who: "o",
        say: ["গোপনীয়তার কারণে নাম বলা যায় না। গ্রুপে ঢুকলে লাভের ছবি দেখতে পাবেন।", "Names can't be shared, for privacy. Join the group and you'll see pictures of the profits."],
        options: [
          { text: ["ছবি তো যে কেউ বানাতে পারে।", "Anyone can make a picture."], go: "caught" },
          { text: ["আচ্ছা, কীভাবে হয়?", "All right, how does it work?"], go: "how" },
        ],
      },
      small: {
        who: "o",
        say: ["পাঁচশো টাকা দিলে কালই সাতশো ফেরত দেব, বিশ্বাস হবে। তারপর বড় অঙ্কে আসবেন।", "Pay 500 and I'll return 700 tomorrow, then you'll believe. After that you can come in big."],
        options: [
          { text: ["আচ্ছা, পাঁচশো দিয়ে দেখি।", "All right, I'll try with 500."], go: "hook", out: { mobile: 200 } },
          { text: ["এত লাভ কীভাবে? থাক।", "How can it pay so much? Forget it."], go: "caught" },
        ],
      },
      hook: {
        who: "o",
        say: ["দেখলেন তো, সাতশো পেয়েছেন! এবার পাঁচ হাজার দিলেই আপনি বিশেষ সদস্য।", "You see, you got your 700! Now pay 5,000 and you're a special member."],
        options: [
          { text: ["দিয়ে দিই!", "I'll pay it!"], go: "lost" },
          { text: ["দুইশো লাভই যথেষ্ট, আর না।", "Two hundred's enough. No more."], go: "caught" },
        ],
      },
      reg: {
        who: "o",
        say: ["নিবন্ধন চলছে, সরকার এসব বোঝে না। লাভ তো হাতেনাতেই পাবেন।", "Registration's in progress, the government doesn't understand this stuff. You'll see the profit yourself."],
        options: [
          { text: ["পাঁচ হাজার দিই।", "I'll pay the 5,000."], go: "lost" },
          { text: ["নিবন্ধন ছাড়া নয়।", "Not without registration."], go: "caught" },
        ],
      },
      lost: {
        who: "o",
        say: ["স্বাগতম! আপনার টাকা খাটতে শুরু করেছে। আরও লোক আনলে বোনাস পাবেন।", "Welcome! Your money has started working. Bring more people and you get a bonus."],
        out: {
          mobile: -5000,
          sense: 1,
          later: "later_recovery_agent",
          lesson: ["প্রথম লাভটা টোপ, নতুনদের টাকা থেকেই দেওয়া। এক মাসে দ্বিগুণ হয় এমন ব্যবসা নেই।", "The first profit is bait, paid from newcomers' money. No business doubles your money in a month."],
        },
      },
      caught: {
        who: "o",
        say: ["ঠিক আছে, পরে আফসোস করবেন। এমন সুযোগ আর আসবে না।", "Fine, you'll regret it. A chance like this won't come again."],
        out: {
          sense: 3,
          lesson: ["নিবন্ধন নেই, নিশ্চিত লাভ, লোক আনলে বোনাস, এটাই ঠকানোর ছক। টাকা রাখুন চেনা ব্যাংকে।", "No registration, sure profit, a bonus for bringing people: that's the pattern. Keep your money in a bank you know."],
        },
      },
    },
  },
  {
    key: "call_home_tasks",
    kind: "call",
    from: ["অনলাইন কাজ নিয়োগ", "Online Jobs Hiring"],
    nodes: {
      start: {
        who: "o",
        say: ["ঘরে বসে দিনে তিন হাজার টাকা আয়! শুধু ভিডিও দেখে রেটিং দেওয়া। আপনার নম্বর বাছাই হয়েছে।", "Earn 3,000 taka a day from home! Just watch videos and rate them. Your number has been chosen."],
        options: [
          { text: ["বলেন কী, কীভাবে শুরু করব?", "You don't say, how do I begin?"], go: "begin" },
          { text: ["কোন কোম্পানি, অফিস কোথায়?", "Which company, where's the office?"], go: "company" },
          { text: ["লাগবে না।", "No thanks."], out: { sense: 1, lesson: ["এত সহজে এত আয়ের কাজ অচেনা ফোনে আসে না। কাজ খুঁজুন চেনা জায়গায়, অফিস দেখে।", "Easy money like this doesn't come from strange calls. Look for work at places you know, with an office you can see."] } },
        ],
      },
      begin: {
        who: "o",
        say: ["প্রথম কাজ বিনামূল্যে, এই নিন তিনশো টাকা বোনাস। পরের ধাপে সদস্য হতে পনেরোশো টাকা জমা।", "The first task is free, here's a 300 taka bonus. For the next stage, it's a 1,500 taka member's deposit."],
        options: [
          { text: ["জমা দিই।", "I'll deposit it."], go: "lost" },
          { text: ["কাজ করলে আমি পাব, জমা কেন দেব?", "I'm the one to be paid, why deposit?"], go: "why" },
          { text: ["বোনাসটা নিয়ে থামি।", "I'll take the bonus and stop."], go: "stop" },
        ],
      },
      company: {
        who: "o",
        say: ["আমরা বিদেশি অনলাইন কোম্পানি, অফিসের দরকার হয় না। সব কাজ ফোনেই হয়।", "We're a foreign online company, we don't need an office. All the work's done by phone."],
        options: [
          { text: ["ঠিকানা ছাড়া কোম্পানিতে কাজ নয়।", "No work for a company with no address."], go: "caught" },
          { text: ["আচ্ছা, কীভাবে শুরু করব?", "All right, how do I begin?"], go: "begin" },
        ],
      },
      why: {
        who: "o",
        say: ["জমাটা ফেরতযোগ্য, প্রথম বেতনের সাথে পেয়ে যাবেন। সবাই এভাবেই শুরু করেছে।", "The deposit's refundable, it comes back with your first pay. Everyone started this way."],
        options: [
          { text: ["ঠিক আছে, জমা দিই।", "All right, I'll deposit it."], go: "lost" },
          { text: ["আগে বেতন, তারপর কথা।", "Pay first, then we'll talk."], go: "caught" },
        ],
      },
      stop: {
        who: "o",
        say: ["বোনাস তোলারও নিয়ম আছে, সদস্য না হলে তোলা যাবে না। দেখুন, মাত্র পনেরোশো টাকা।", "The bonus has rules too, it can't be withdrawn unless you're a member. Look, only 1,500 taka."],
        options: [
          { text: ["আচ্ছা, দিই।", "All right, I'll pay."], go: "lost" },
          { text: ["তাহলে বোনাসও লাগবে না।", "Then I don't want the bonus either."], go: "caught" },
        ],
      },
      lost: {
        who: "o",
        say: ["স্বাগতম, আপনি এখন সদস্য। কাজের লিংক আসছে, আরও আয় করতে পরের ধাপে উঠুন।", "Welcome, you're a member now. The task link is coming. Move up a stage to earn more."],
        out: {
          mobile: -1500,
          sense: 1,
          later: "later_task_more",
          lesson: ["কাজের জন্য টাকা নিলে সেটা চাকরি নয়। পর্দায় দেখানো আয় তোলা যায় না, শুধু জমা বাড়ে।", "If they take money for work, it isn't a job. Earnings on a screen can't be withdrawn, only deposits grow."],
        },
      },
      caught: {
        who: "o",
        say: ["ঠিক আছে, যাদের লাগে তাদের দিয়ে দিচ্ছি।", "Fine, I'll give it to those who need it."],
        out: {
          sense: 3,
          lesson: ["যে চাকরি দিতে আগে জমা চায়, সে আপনার টাকাই চায়। আসল কাজে অফিস, চুক্তি আর বেতন থাকে।", "Whoever wants a deposit before giving a job just wants your money. Real work has an office, a contract and pay."],
        },
      },
    },
  },
  {
    key: "call_remote_support",
    kind: "call",
    from: ["ফোন নিরাপত্তা দল", "Phone Security Team"],
    nodes: {
      start: {
        who: "o",
        say: ["ফোন নিরাপত্তা দল থেকে বলছি। আপনার ফোন থেকে অস্বাভাবিক লেনদেনের চেষ্টা হচ্ছে, হ্যাক হয়েছে।", "This is the phone security team. Unusual transactions are being tried from your phone. It's been hacked."],
        options: [
          { text: ["সর্বনাশ! কী করব?", "Oh no! What do I do?"], go: "fix" },
          { text: ["কীভাবে বুঝলেন এটা আমার ফোন?", "How do you know it's my phone?"], go: "how" },
          { text: ["ফোনের দোকানে দেখিয়ে নেব।", "I'll show it at a phone shop."], go: "shop" },
        ],
      },
      fix: {
        who: "o",
        say: ["একটা সহায়তা অ্যাপ নামান, নাম পাঠাচ্ছি। আমরা দূর থেকেই সব ঠিক করে দেব।", "Download a support app, I'm sending the name. We'll fix everything from here."],
        options: [
          { text: ["নামাচ্ছি।", "I'm downloading it."], go: "perm" },
          { text: ["অ্যাপ কী কী দেখতে পারবে?", "What will the app be able to see?"], go: "what" },
        ],
      },
      how: {
        who: "o",
        say: ["আমাদের সিস্টেমে সব ফোন দেখা যায়, আপনার নম্বর লাল হয়ে আছে। দেরি করলে সব টাকা যাবে।", "Our system sees every phone, and your number is showing red. Delay and all your money goes."],
        options: [
          { text: ["সব ফোন দেখা যায়? এ তো মিথ্যা।", "Sees every phone? That's a lie."], go: "caught" },
          { text: ["আচ্ছা, কী করব?", "All right, what do I do?"], go: "fix" },
        ],
      },
      what: {
        who: "o",
        say: ["শুধু আপনার পর্দা, ক্ষতিকর কিছু আছে কি না দেখার জন্য। ডাক্তার যেমন রোগী দেখেন।", "Just your screen, to look for anything harmful. The way a doctor looks at a patient."],
        options: [
          { text: ["ঠিক আছে।", "All right."], go: "perm" },
          { text: ["পর্দায় তো আমার পিনও দেখা যাবে।", "But then you'd see my PIN on the screen."], go: "caught" },
        ],
      },
      shop: {
        who: "o",
        say: ["দোকানের লোকেরা এই ভাইরাস ধরতে পারবে না, উল্টো তথ্য চুরি করবে। আমরাই ভরসা।", "Shop people can't catch this virus, they'd steal your data instead. We're the ones to trust."],
        options: [
          { text: ["আচ্ছা, কী করব?", "All right, what do I do?"], go: "fix" },
          { text: ["তবু দোকানেই যাব।", "I'm going to the shop anyway."], go: "caught" },
        ],
      },
      perm: {
        who: "o",
        say: ["অ্যাপ খুলে কোডটা বলুন। তারপর ঝটপট টাকা খুলে ব্যালান্স মিলিয়ে নিন, আমি পাশে আছি।", "Open the app and read me the code. Then open Jhotpot Taka and check your balance, I'm right here."],
        options: [
          { text: ["আচ্ছা, খুলছি।", "All right, I'm opening it."], go: "lost" },
          { text: ["না, আপনার সামনে পিন দেব না।", "No, I won't enter my PIN in front of you."], go: "caught" },
        ],
      },
      lost: {
        who: "o",
        say: ["ঠিক আছে, দেখছি। ফোনটা এখন একটু রেখে দিন, নিজে নিজে কাজ হবে।", "All right, I can see it. Put your phone down for a bit, it'll work by itself."],
        out: {
          mobile: -3000,
          sense: 1,
          later: "later_phone_watched",
          lesson: ["সহায়তা অ্যাপে অচেনা লোক আপনার পর্দা আর পিন দেখে ফেলে। ফোনের সমস্যায় দোকানে নিন।", "With a support app, a stranger sees your screen and PIN. Take phone troubles to a shop instead."],
        },
      },
      caught: {
        who: "o",
        say: ["ঠিক আছে, হ্যাক হলে আমাদের দোষ নেই।", "Fine, if you're hacked it's not our fault."],
        out: {
          sense: 3,
          lesson: ["কেউ দূর থেকে ফোন দেখতে পায় না, অ্যাপ নামালে তবেই পায়। ফোনের সমস্যায় চেনা দোকানে যান।", "Nobody can see your phone from afar unless you install their app. Take phone troubles to a shop you know."],
        },
      },
    },
  },
  {
    key: "call_relative_airport",
    kind: "call",
    from: ["বিমানবন্দর ইমিগ্রেশন", "Airport Immigration"],
    nodes: {
      start: {
        who: "o",
        say: ["বিমানবন্দর থেকে বলছি। বিদেশফেরত আপনার এক আত্মীয় কাগজের ঝামেলায় আটকে আছেন। এখনই জরিমানা লাগবে।", "This is the airport. A relative of yours back from abroad is held up over papers. A fine is needed now."],
        options: [
          { text: ["কে আটকে আছে? নামটা বলুন।", "Who's held up? Tell me the name."], go: "name" },
          { text: ["কত জরিমানা?", "How much is the fine?"], go: "fine" },
          { text: ["আত্মীয়দের ফোন করে দেখি।", "Let me ring my relatives and see."], go: "call" },
        ],
      },
      name: {
        who: "o",
        say: ["উনি খুব ভেঙে পড়েছেন, নাম বলতে পারছেন না। আপনার নম্বরটাই শুধু দিয়েছেন।", "They're very upset, they can't say the name. They only gave your number."],
        options: [
          { text: ["নাম ছাড়া টাকা নয়।", "No name, no money."], go: "caught" },
          { text: ["আচ্ছা, কত জরিমানা?", "All right, how much is the fine?"], go: "fine" },
        ],
      },
      fine: {
        who: "o",
        say: ["তিন হাজার টাকা। এক ঘণ্টার মধ্যে না দিলে ফেরত পাঠিয়ে দেবে, মামলাও হতে পারে।", "Three thousand taka. If it isn't paid within an hour they'll be sent back, maybe with a case too."],
        options: [
          { text: ["পাঠাচ্ছি।", "I'm sending it."], go: "lost" },
          { text: ["তাঁর সাথে একটু কথা বলিয়ে দিন।", "Let me speak to them."], go: "talk" },
          { text: ["আত্মীয়দের ফোন করে দেখি।", "Let me ring my relatives and see."], go: "call" },
        ],
      },
      talk: {
        who: "o",
        say: ["এখন কথা বলা নিষেধ, উনি অফিসারের ঘরে। আপনি সময় নষ্ট করছেন, ওনার বিপদ বাড়ছে।", "No calls are allowed, they're in the officer's room. You're wasting time and it's getting worse for them."],
        options: [
          { text: ["বিপদ বাড়াতে চাই না, পাঠাই।", "I don't want to make it worse, I'll send it."], go: "lost" },
          { text: ["কথা না বললে কিছুই দেব না।", "If I can't speak to them, I'm giving nothing."], go: "caught" },
        ],
      },
      call: {
        who: "o",
        say: ["ফোন করে লাভ নেই, ওনার ফোন আমাদের কাছে জমা। এখনই দিলে আধঘণ্টায় বেরিয়ে আসবেন।", "Ringing won't help, we're holding that phone. Pay now and they'll be out in half an hour."],
        options: [
          { text: ["ঠিক আছে, দিচ্ছি।", "All right, I'll pay."], go: "lost" },
          { text: ["তবু পরিবারে খোঁজ নিই।", "I'll still ask around the family."], go: "caught" },
        ],
      },
      lost: {
        who: "o",
        say: ["পেয়েছি। উনি বের হলে আপনাকে ফোন করবেন। ধন্যবাদ।", "Received. They'll ring you once they're out. Thank you."],
        out: {
          mobile: -3000,
          sense: 1,
          lesson: ["আত্মীয়ের বিপদের ভয়ে মানুষ ভাবে না, এটাই ওদের ভরসা। আগে পরিবারে খোঁজ নিন, তারপর টাকা।", "Fear for a relative stops people thinking, and they count on that. Ask the family first, then think of money."],
        },
      },
      caught: {
        who: "h",
        say: ["পরিবারে ফোন করলাম। কেউ তো বিদেশ থেকে আসেইনি!", "I rang the family. Nobody's come back from abroad at all!"],
        out: {
          sense: 3,
          lesson: ["নাম বলতে পারে না, কথা বলতে দেয় না, শুধু টাকা চায়। আত্মীয়ের খবর সব সময় পরিবারে যাচাই করুন।", "No name, no talking to them, only money. Always check news of a relative with your family."],
        },
      },
    },
  },
];
