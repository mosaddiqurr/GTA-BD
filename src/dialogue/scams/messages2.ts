import type { Scam } from "../types";

/** The second half of the scam text messages. Use MESSAGES from messages.ts, which already includes these. */
export const MESSAGES2: Scam[] = [
  {
    key: "sms_sim_block",
    kind: "sms",
    from: ["SIM-Update", "SIM-Update"],
    body: ["আপনার SIM এর তথ্য অসম্পূর্ণ। ২ ঘন্টার মধ্যে NID নম্বর ও জন্মতারিখ ফিরতি SMS এ না দিলে সিম বন্ধ হবে।", "Your SIM information is incomplete. Reply by SMS with your NID number and date of birth within 2 hours or the SIM will be closed."],
    nodes: {
      start: {
        who: "h",
        say: ["সিম বন্ধ হবে? ফিরতি মেসেজে পরিচয়পত্র চাইছে।", "My SIM will close? They want my ID by return message."],
        options: [
          { text: ["লিখে পাঠিয়ে দিই।", "Write it and send it."], go: "sent" },
          { text: ["কোম্পানির দোকানে যাই।", "Go to the company's shop."], go: "shop" },
          { text: ["রিপোর্ট করে মুছে দিই।", "Report it and delete it."], out: { sense: 2, rep: 1, lesson: ["পরিচয়পত্রের নম্বর মেসেজে কখনো দেবেন না। সিমের তথ্য লাগলে দোকানে আঙুলের ছাপ দিতে হয়।", "Never send your ID number by message. If SIM details are needed, you give a fingerprint at a shop."] } },
        ],
      },
      sent: {
        who: "o",
        say: ["তথ্য পেয়েছি। যাচাইয়ের জন্য ফোনে আসা ছয় সংখ্যার কোডটাও পাঠান।", "Details received. To verify, also send the six digit code on your phone."],
        options: [
          { text: ["কোডও পাঠাই।", "Send the code too."], go: "lost" },
          { text: ["কোড দেব না, দোকানে যাই।", "No code. I'll go to the shop."], go: "shopLate" },
        ],
      },
      lost: {
        who: "h",
        say: ["কিছুক্ষণ পর ফোনের নেটওয়ার্কই চলে গেল।", "A little later my phone lost its signal altogether."],
        out: {
          mobile: -2500,
          sense: 1,
          later: "later_sim_dead",
          lesson: ["ওই কোড দিয়ে আপনার সিম অন্যের হাতে গেল। কোম্পানি মেসেজে পরিচয়পত্র বা কোড চায় না।", "With that code your SIM went to someone else. Your company never asks for ID or codes by message."],
        },
      },
      shopLate: {
        who: "h",
        say: ["দোকানে জানালাম, পরিচয়পত্রের নম্বর দিয়ে ফেলেছি। তারা সতর্ক করে রাখল।", "I told the shop I'd given out my ID number. They've put a warning on it."],
        out: {
          sense: 2,
          later: "later_loan_in_name",
          lesson: ["কোড আটকে ভালো করলেন, তবে পরিচয়পত্রের নম্বর গেছে। কেউ এ নিয়ে ভয় দেখালে থানায় জানাবেন।", "Good that you held back the code, but your ID number is out. If someone threatens you with it, tell the police."],
        },
      },
      shop: {
        who: "h",
        say: ["দোকান বলল, সিম ঠিক আছে। এসব তথ্য মেসেজে চাওয়া হয় না।", "The shop says the SIM's fine. Those details are never asked for by message."],
        out: {
          sense: 3,
          lesson: ["দুই ঘণ্টার ভয় দেখিয়ে তথ্য নেওয়াই ফাঁদ। সিমের সব কাজ হয় কোম্পানির দোকানে।", "Scaring you with two hours to get your details is the trap. All SIM matters are done at the company's shop."],
        },
      },
    },
  },
  {
    key: "sms_eid_voucher",
    kind: "sms",
    from: ["Eid-Offer", "Eid-Offer"],
    body: ["ঈদ উপহার! ১০০০ টাকার শপিং ভাউচার পেতে এই মেসেজ ৫টি গ্রুপে শেয়ার করুন, তারপর ডেলিভারি চার্জ ৫০ টাকা দিন: http://eid-gift.winn/claim", "Eid gift! To get a Tk 1000 shopping voucher, share this message with 5 groups, then pay a Tk 50 delivery charge: http://eid-gift.winn/claim"],
    nodes: {
      start: {
        who: "h",
        say: ["হাজার টাকার ভাউচার, শুধু পাঁচটা গ্রুপে শেয়ার করলেই?", "A thousand taka voucher, just for sharing with five groups?"],
        options: [
          { text: ["শেয়ার করে ফি দিই।", "Share it and pay the fee."], go: "share" },
          { text: ["কোন দোকানের ভাউচার, খোঁজ নিই।", "Find out which shop's voucher it is."], go: "which" },
          { text: ["মুছে দিই।", "Delete it."], out: { sense: 2, lesson: ["শেয়ার করতে বলা উপহার আসলে ফাঁদ ছড়ানোর কৌশল। মুছে দিয়ে ভালোই করলেন।", "A gift you must share is a way of spreading the trap. Deleting it was good."] } },
        ],
      },
      share: {
        who: "h",
        say: ["শেয়ার হলো। এখন পঞ্চাশ টাকা দিতে কার্ডের নম্বর চাইছে।", "It's shared. Now it wants my card number for the fifty taka."],
        options: [
          { text: ["নম্বর দিয়ে দিই।", "Give the number."], go: "lost" },
          { text: ["বন্ধ করে গ্রুপে সাবধান করি।", "Close it and warn the groups."], go: "warn" },
        ],
      },
      which: {
        who: "h",
        say: ["দোকানের নামই নেই কোথাও, লিংকটাও অদ্ভুত।", "There's no shop's name anywhere, and the link looks strange."],
        out: {
          sense: 3,
          lesson: ["কে দিচ্ছে, সেটাই নেই। আসল ছাড় দোকানে গিয়ে পাওয়া যায়, লিংকে কার্ড দিয়ে নয়।", "It doesn't even say who's giving it. Real discounts are had at a shop, not by giving your card to a link."],
        },
      },
      lost: {
        who: "h",
        say: ["পঞ্চাশ নয়, ছয়শো টাকা গেল। আর আমার শেয়ারে আরও অনেকে ফাঁদে পড়ল।", "Not fifty: six hundred's gone. And many more fell for it through my share."],
        out: {
          money: -600,
          rep: -2,
          sense: 1,
          lesson: ["শেয়ার করলে ফাঁদে আপনার নামও জড়ায়। অজানা উপহার পাঠানোর আগে একবার ভাবুন।", "Sharing puts your name on the trap too. Think before you pass on a gift you know nothing about."],
        },
      },
      warn: {
        who: "h",
        say: ["গ্রুপে লিখে দিলাম, এটা ভুয়া। কেউ যেন ক্লিক না করে।", "I wrote in the groups that it's fake, so that nobody clicks."],
        out: {
          sense: 3,
          rep: 1,
          lesson: ["ভুল হলে শুধরে নেওয়াই আসল কাজ। আপনি জানালেন বলে অনেকে বেঁচে গেল।", "Fixing a mistake is what counts. Because you spoke up, many people were spared."],
        },
      },
    },
  },
  {
    key: "sms_rumour_banks",
    kind: "sms",
    from: ["পাড়ার গ্রুপ", "Neighbourhood group"],
    body: ["জরুরি! সবাইকে জানান!! কাল থেকে সব ব্যাংক বন্ধ হয়ে যাবে, আজই টাকা তুলে ফেলুন। পরিচিত একজন ব্যাংকে চাকরি করে, সে বলেছে। ফরোয়ার্ড করুন।", "Urgent! Tell everyone!! All banks will close from tomorrow, take your money out today. Someone I know works in a bank and said so. Forward this."],
    nodes: {
      start: {
        who: "h",
        say: ["সব ব্যাংক বন্ধ? সবাই তো আতঙ্কে পড়ে যাবে।", "All the banks closing? Everyone's going to panic."],
        options: [
          { text: ["ফরোয়ার্ড করে টাকা তুলি।", "Forward it and take out my money."], go: "fwd" },
          { text: ["ব্যাংকে গিয়ে খোঁজ নিই।", "Go and ask at the bank."], go: "check" },
          { text: ["গ্রুপে প্রমাণ চাই।", "Ask the group for proof."], go: "ask" },
        ],
      },
      fwd: {
        who: "h",
        say: ["এটিএমে লম্বা লাইন, রিকশা ভাড়াও গেল। পরে জানলাম খবরটা মিথ্যা।", "Long queue at the ATM, and rickshaw fare gone too. Later I learned the news was false."],
        out: {
          money: -200,
          rep: -3,
          sense: 1,
          lesson: ["ভয়ের খবর ফরোয়ার্ড করলে আপনিও গুজব ছড়ান। আগে ব্যাংকে বা চেনা কাউকে জিজ্ঞেস করুন।", "Forwarding scary news makes you part of the rumour. Ask at the bank or someone you trust first."],
        },
      },
      ask: {
        who: "o",
        say: ["প্রমাণ লাগবে কেন? সবাই তো বলছে। শেয়ার করলে ক্ষতি কী?", "Why would you need proof? Everyone's saying it. What's the harm in sharing?"],
        options: [
          { text: ["তাহলে শেয়ার করি।", "Then I'll share it."], go: "fwd" },
          { text: ["আগে খোঁজ নিই।", "I'll find out first."], go: "check" },
        ],
      },
      check: {
        who: "h",
        say: ["ব্যাংকে জিজ্ঞেস করলাম, এমন কিছুই নেই। গ্রুপে সত্যিটা জানালাম।", "I asked at the bank and there's nothing of the kind. I told the group the truth."],
        out: {
          sense: 3,
          rep: 2,
          lesson: ["নাম নেই, তারিখ নেই, শুধু তাড়া, এটাই গুজবের চেহারা। যাচাই করে জানালে পাড়া শান্ত থাকে।", "No name, no date, only urgency: that's what a rumour looks like. Checking and speaking up keeps the area calm."],
        },
      },
    },
  },
  {
    key: "sms_court_notice",
    kind: "sms",
    from: ["Court-Notice", "Court-Notice"],
    body: ["লিগ্যাল নোটিশ: আপনার বিরুদ্ধে মামলা নং ৪৪১৭/২৬ দায়ের হয়েছে। ২৪ ঘণ্টায় যোগাযোগ না করলে গ্রেফতারি পরোয়ানা। যোগাযোগ: অ্যাডভোকেট 01731 00286", "Legal notice: case no. 4417/26 has been filed against you. If you don't make contact within 24 hours, an arrest warrant follows. Contact: Advocate 01731 00286"],
    nodes: {
      start: {
        who: "h",
        say: ["আমার নামে মামলা? নামই তো লেখেনি।", "A case against me? It doesn't even give my name."],
        options: [
          { text: ["উকিলকে ফোন করি।", "Ring the lawyer."], go: "phone" },
          { text: ["থানায় গিয়ে জিজ্ঞেস করি।", "Go and ask at the police station."], go: "police" },
          { text: ["মুছে দিই।", "Delete it."], out: { sense: 1, lesson: ["আসল মামলার নোটিশ নাম লিখে কাগজে আসে। ভয় থাকলে থানায় একবার জিজ্ঞেস করে নিন।", "A real notice comes on paper with your name on it. If you're worried, ask at the police station."] } },
        ],
      },
      phone: {
        who: "o",
        say: ["মামলা গুরুতর। চার হাজার টাকা খরচ দিলে আমি আজই আপসে মিটিয়ে দেব।", "It's a serious case. Pay 4,000 taka costs and I'll settle it out of court today."],
        options: [
          { text: ["পাঠাই।", "Send it."], go: "lost" },
          { text: ["মামলার কাগজ পাঠান।", "Send the case papers."], go: "paper" },
        ],
      },
      paper: {
        who: "o",
        say: ["কাগজ আদালতে গেলে বিপদ বাড়বে। চুপচাপ মিটিয়ে নিন, কেউ জানবে না।", "If papers go to court, it only gets worse. Settle it quietly and nobody will know."],
        options: [
          { text: ["আচ্ছা, পাঠাই।", "All right, send it."], go: "lost" },
          { text: ["থানায় যাচ্ছি।", "I'm going to the police."], go: "police" },
        ],
      },
      lost: {
        who: "o",
        say: ["পেয়েছি। আর কাউকে বলবেন না।", "Received. Don't tell anyone else."],
        out: {
          mobile: -4000,
          sense: 1,
          later: "later_fake_lawyer",
          lesson: ["মেসেজে নাম নেই, উকিলের নিজের নম্বর, চুপ থাকতে বলা, সবই চিহ্ন। মামলা যাচাই হয় থানায়।", "No name in the message, a lawyer's own number, a demand for silence: all signs. Cases are checked at the police station."],
        },
      },
      police: {
        who: "h",
        say: ["থানা বলল, এমন কোনো মামলা নেই। নম্বরটা তারা লিখে নিল।", "The police say there's no such case. They wrote down the number."],
        out: {
          sense: 3,
          rep: 1,
          lesson: ["ভয় পেলে থানায় যাওয়াই সঠিক পথ। আসল মামলায় ফোনে টাকা দিয়ে মেটানো যায় না।", "When you're frightened, going to the police is right. A real case can't be settled by money over the phone."],
        },
      },
    },
  },
  {
    key: "sms_marriage_media",
    kind: "sms",
    from: ["Marriage-Media", "Marriage-Media"],
    body: ["ভালো পরিবারে বিয়ে! প্রবাসী ও সরকারি চাকুরিজীবী পাত্রপাত্রী। রেজিঃ ফি মাত্র ১৫০০ টাকা। ফোন করুন: 01552 00491", "Marry into a good family! Expat and government-job brides and grooms. Registration fee only Tk 1500. Call: 01552 00491"],
    nodes: {
      start: {
        who: "h",
        say: ["আমাদের পরিবারে বিয়ের খোঁজ এরা জানল কীভাবে?", "How would they know my family is looking for a match?"],
        options: [
          { text: ["ফোন করে জিজ্ঞেস করি।", "Ring and ask."], go: "phone" },
          { text: ["চেনা আত্মীয়কে জিজ্ঞেস করি।", "Ask a relative I trust."], go: "ask" },
          { text: ["মুছে দিই।", "Delete it."], out: { sense: 2, lesson: ["এমন মেসেজ সবার কাছেই যায়। বিয়ের খোঁজ চেনা লোকের মাধ্যমে নেওয়াই ভালো।", "Messages like this go to everyone. It's best to look for a match through people you know."] } },
        ],
      },
      phone: {
        who: "o",
        say: ["অনেক প্রবাসী পরিবার অপেক্ষায়। ফি দিলেই ছবি পাঠাব, এই সপ্তাহেই দেখা।", "Many expat families are waiting. Pay the fee and I'll send photos, you could meet this week."],
        options: [
          { text: ["পাঠাই।", "Send it."], go: "lost" },
          { text: ["অফিসে এসে দেব, ঠিকানা দিন।", "I'll pay at the office. Give me the address."], go: "addr" },
        ],
      },
      addr: {
        who: "o",
        say: ["অফিস অনলাইনে চলে, আসার দরকার নেই। এই নম্বরেই ফি দিন।", "The office runs online, no need to come. Pay the fee to this number."],
        options: [
          { text: ["আচ্ছা, পাঠাই।", "All right, send it."], go: "lost" },
          { text: ["থাক, আত্মীয়কে জিজ্ঞেস করি।", "Forget it, I'll ask a relative."], go: "ask" },
        ],
      },
      lost: {
        who: "o",
        say: ["পেয়েছি। আপনার জন্য বিশেষ প্রস্তাব আসছে, শিগগিরই ফোন করব।", "Received. A special offer's coming for you, I'll ring soon."],
        out: {
          mobile: -1500,
          sense: 1,
          later: "later_bureau_more",
          lesson: ["অফিস নেই, মানুষ নেই, শুধু ফি। বিয়ের ব্যুরো সত্যি হলে তার ঠিকানায় গিয়ে দেখা যায়।", "No office, no people, only a fee. If a bureau is real, you can go to its address and see."],
        },
      },
      ask: {
        who: "h",
        say: ["আত্মীয় বলল, এমন মেসেজ সবাই পায়। ফি দিলে আর খোঁজ মেলে না।", "My relative says everyone gets these. Pay the fee and you never hear back."],
        out: {
          sense: 3,
          lesson: ["চেনা মানুষকে জিজ্ঞেস করলে অন্যের ঠকার গল্পও জানা যায়। ফি দেওয়ার আগে এটুকু করুন।", "Asking people you know brings out others' stories of being cheated. Do that before you pay a fee."],
        },
      },
    },
  },
  {
    key: "sms_used_phone",
    kind: "sms",
    from: ["+880 1405 00672", "+880 1405 00672"],
    body: ["স্টকে নতুনের মত দামি স্মার্টফোন মাত্র ৯,০০০ টাকা!! ১০ টা বাকি। ২,০০০ অগ্রিম দিয়ে বুকিং দিন। ঢাকার বাইরে কুরিয়ার। কল: 01405 00672", "Expensive smartphones, good as new, only Tk 9,000!! 10 left. Pay Tk 2,000 advance to book. Courier outside Dhaka. Call: 01405 00672"],
    nodes: {
      start: {
        who: "h",
        say: ["এই দামে এমন ফোন? বাজারে তো তিন গুণ দাম।", "A phone like that at this price? It's three times that in the market."],
        options: [
          { text: ["ফোন করে বুকিং দিই।", "Ring and book one."], go: "phone" },
          { text: ["দোকানে গিয়ে দেখতে চাই বলি।", "Say I want to see it at the shop."], go: "see" },
          { text: ["মুছে দিই।", "Delete it."], out: { sense: 2, lesson: ["দাম অবিশ্বাস্য হলে বিশ্বাস করবেন না। পুরোনো ফোন কিনুন দেখে, সামনাসামনি।", "If the price is unbelievable, don't believe it. Buy second-hand phones in person, after seeing them."] } },
        ],
      },
      phone: {
        who: "o",
        say: ["আজকেই শেষ স্টক। দুই হাজার পাঠান, বিকেলেই কুরিয়ারে তুলে দেব।", "It's the last stock today. Send 2,000 and I'll put it on the courier this afternoon."],
        options: [
          { text: ["পাঠাই।", "Send it."], go: "lost" },
          { text: ["হাতে পেয়ে টাকা দেব।", "I'll pay when it's in my hand."], go: "cod" },
        ],
      },
      cod: {
        who: "o",
        say: ["ওভাবে দিলে ফোন ফেরত আসে, তাই নিয়ম নেই। আরও পাঁচজন লাইনে আছে।", "That way phones come back, so it isn't allowed. Five more people are waiting."],
        options: [
          { text: ["আচ্ছা, পাঠাই।", "All right, send it."], go: "lost" },
          { text: ["তাহলে থাক।", "Then forget it."], go: "see" },
        ],
      },
      see: {
        who: "h",
        say: ["দোকানের ঠিকানা চাইলাম, উত্তর এল না। বুঝে গেলাম।", "I asked for the shop's address and got no reply. That told me all I needed."],
        out: {
          sense: 3,
          lesson: ["যে জিনিস দেখাতে পারে না, তাকে টাকা নয়। হাতে নিয়ে দেখে তবে দাম দিন।", "No money to someone who can't show you the goods. See it in your hand, then pay."],
        },
      },
      lost: {
        who: "h",
        say: ["টাকা পাঠালাম। এখন নম্বরটাই বন্ধ।", "I sent the money. Now the number's switched off."],
        out: {
          mobile: -2000,
          sense: 1,
          lesson: ["অগ্রিম মানে ঝুঁকি পুরোটাই আপনার। অচেনা বিক্রেতার সাথে জিনিস দেখে তবে লেনদেন করুন।", "An advance puts all the risk on you. With unknown sellers, see the goods before any money moves."],
        },
      },
    },
  },
  {
    key: "sms_flood_relief",
    kind: "sms",
    from: ["ত্রাণ সহায়তা", "Relief Help"],
    body: ["বন্যার্তদের পাশে দাঁড়ান। আপনার ৫০০ টাকায় একটি পরিবার খেতে পাবে। ঝটপট টাকা পার্সোনাল: 01988 00317। শেয়ার করুন।", "Stand by the flood victims. Your Tk 500 feeds one family. Jhotpot Taka personal: 01988 00317. Please share."],
    nodes: {
      start: {
        who: "h",
        say: ["বন্যার খবর তো সত্যি। কিন্তু এই নম্বরটা কার?", "The floods are real, all right. But whose number is this?"],
        options: [
          { text: ["পাঁচশো পাঠিয়ে দিই।", "Send five hundred."], go: "lost" },
          { text: ["কোন সংগঠন জানতে চাই।", "Ask which organisation it is."], go: "ask" },
          { text: ["পাড়ার ত্রাণ দলে দিই।", "Give to the local relief group."], go: "local" },
        ],
      },
      ask: {
        who: "o",
        say: ["আমরা কয়েকজন স্বেচ্ছাসেবী, সংগঠনের নাম লাগে না। মানুষ বিপদে, দেরি করবেন না।", "We're just a few volunteers, we don't need a name. People are in trouble, don't delay."],
        options: [
          { text: ["ঠিক আছে, পাঠাই।", "All right, send it."], go: "lost" },
          { text: ["চেনা দলকেই দেব।", "I'll give to people I know."], go: "local" },
        ],
      },
      lost: {
        who: "h",
        say: ["পাঠালাম। পরে শুনলাম, এই নম্বর নিয়ে অনেকের অভিযোগ আছে।", "I sent it. Later I heard many people have complained about this number."],
        out: {
          mobile: -500,
          sense: 1,
          later: "later_charity_again",
          lesson: ["ব্যক্তিগত নম্বর, নাম নেই, রসিদ নেই। দান করুন চেনা দলের হাতে, যাদের হিসাব দেখা যায়।", "A personal number, no name, no receipt. Give to a group you know, whose accounts you can see."],
        },
      },
      local: {
        who: "h",
        say: ["পাড়ার দলের হাতে দিলাম, রসিদও পেলাম।", "I gave to the local group, and got a receipt too."],
        out: {
          sense: 3,
          rep: 2,
          lesson: ["ভালো কাজের ইচ্ছাটাও পাহারা দিতে হয়। রসিদ আর চেনা মানুষ থাকলে দান ঠিক জায়গায় যায়।", "Even a wish to do good needs guarding. With a receipt and people you know, the gift reaches the right place."],
        },
      },
    },
  },
  {
    key: "sms_sugar_cure",
    kind: "sms",
    from: ["Herbal-Care", "Herbal-Care"],
    body: ["ডায়াবেটিস, প্রেসার, গ্যাস্ট্রিক ৭ দিনে চিরতরে নির্মূল!! ১০০% গ্যারান্টি। অগ্রিম ১২০০ টাকা। হোম ডেলিভারি। কল: 01864 00529", "Diabetes, pressure, gastric: gone for good in 7 days!! 100% guarantee. Tk 1200 in advance. Home delivery. Call: 01864 00529"],
    nodes: {
      start: {
        who: "h",
        say: ["সাত দিনে সব রোগ সেরে যাবে? একশো ভাগ নিশ্চিত?", "All these illnesses cured in seven days? One hundred percent sure?"],
        options: [
          { text: ["ফোন করে অর্ডার দিই।", "Ring and order."], go: "phone" },
          { text: ["ডাক্তার বা ফার্মেসিতে জিজ্ঞেস করি।", "Ask a doctor or a pharmacy."], go: "doc" },
          { text: ["মুছে দিই।", "Delete it."], out: { sense: 2, lesson: ["তিন রোগের এক ওষুধ আর একশো ভাগ নিশ্চয়তা, দুটোই মিথ্যা। মুছে দেওয়াই ঠিক হলো।", "One medicine for three illnesses and a hundred percent guarantee are both lies. Deleting it was right."] } },
        ],
      },
      phone: {
        who: "o",
        say: ["অগ্রিম দিলেই পাঠাব। ডাক্তারের ওষুধ বন্ধ রাখবেন, নইলে এটা কাজ করবে না।", "Pay the advance and we'll send it. Stop the doctor's medicine, or this won't work."],
        options: [
          { text: ["পাঠাই।", "Send it."], go: "lost" },
          { text: ["ডাক্তারের ওষুধ বন্ধ করব না।", "I won't stop the doctor's medicine."], go: "doc" },
        ],
      },
      lost: {
        who: "h",
        say: ["বোতল এল, গায়ে কোনো অনুমোদন নম্বরই নেই।", "A bottle came, with no approval number on it at all."],
        out: {
          money: -1200,
          sense: 1,
          later: "later_medicine_more",
          lesson: ["অনুমোদন নেই এমন ওষুধ খাবেন না। ডাক্তারের ওষুধ বন্ধ করতে বললে আরও সাবধান হন।", "Don't take medicine with no approval. Be even more careful if told to stop a doctor's medicine."],
        },
      },
      doc: {
        who: "h",
        say: ["ফার্মেসি বলল, এমন ওষুধ হয় না, খাওয়াও ঠিক নয়।", "The pharmacy says no such medicine exists, and it's not safe to take."],
        out: {
          sense: 3,
          lesson: ["ওষুধের প্রশ্ন ডাক্তার বা ফার্মেসিতে করুন, মেসেজে নয়। মোড়কে অনুমোদন নম্বর দেখে নিন।", "Take medicine questions to a doctor or pharmacy, not a message. Look for an approval number on the packet."],
        },
      },
    },
  },
  {
    key: "sms_wrong_person",
    kind: "sms",
    from: ["+880 1790 00845", "+880 1790 00845"],
    body: ["হাই রিমি, কাল বিনিয়োগের লাভটা পেয়েছ তো? ৪০% উঠেছে। ওহ সরি, মনে হয় ভুল নম্বরে গেল!", "Hi Rimi, did you get yesterday's investment profit? It went up 40%. Oh sorry, I think this went to the wrong number!"],
    nodes: {
      start: {
        who: "h",
        say: ["ভুল নম্বর? কিন্তু চল্লিশ ভাগ লাভ কীসের?", "Wrong number? But forty percent profit on what?"],
        options: [
          { text: ["লিখি, ভুল নম্বর। কীসের লাভ?", "Write back: wrong number. What profit?"], go: "reply" },
          { text: ["উত্তর না দিয়ে মুছে দিই।", "Delete it without answering."], out: { sense: 2, lesson: ["ভুল নম্বরের ভদ্র মেসেজও ফাঁদের শুরু হতে পারে। উত্তর না দেওয়াই নিরাপদ।", "A polite wrong-number message can be the start of a trap. Not replying is safest."] } },
        ],
      },
      reply: {
        who: "o",
        say: ["দুঃখিত! আমাদের একটা ছোট বিনিয়োগ গ্রুপ। চাইলে আপনাকেও যুক্ত করি, ভালো মানুষ মনে হচ্ছে।", "Sorry! We have a small investment group. I can add you too, you seem like a nice person."],
        options: [
          { text: ["যুক্ত করুন।", "Add me."], go: "group" },
          { text: ["অচেনা কারো সাথে টাকার কথা নয়।", "No money talk with strangers."], go: "stop" },
        ],
      },
      group: {
        who: "o",
        say: ["আজ আড়াই হাজার দিয়ে শুরু করুন, কাল দেখবেন সাড়ে তিন হাজার। আমি নিজে দেখিয়ে দেব।", "Start with 2,500 today and tomorrow you'll see 3,500. I'll show you myself."],
        options: [
          { text: ["পাঠাই।", "Send it."], go: "lost" },
          { text: ["আগে সামনাসামনি দেখা করি।", "Let's meet in person first."], go: "meet" },
        ],
      },
      meet: {
        who: "o",
        say: ["আমি এখন দেশের বাইরে, দেখা হবে না। তবে আমরা তো এখন বন্ধুই, তাই না?", "I'm abroad right now, we can't meet. But we're friends now, aren't we?"],
        options: [
          { text: ["ঠিক, পাঠাই।", "True, I'll send it."], go: "lost" },
          { text: ["দেখা ছাড়া টাকা নয়।", "No meeting, no money."], go: "stop" },
        ],
      },
      lost: {
        who: "o",
        say: ["দারুণ! দেখুন, আপনার হিসাবে লাভ উঠছে। আরও দিলে আরও বাড়বে।", "Great! Look, profit's rising in your account. Put in more and it grows more."],
        out: {
          mobile: -2500,
          sense: 1,
          later: "later_recovery_agent",
          lesson: ["ভুল নম্বরের আলাপ, বন্ধুত্ব, তারপর বিনিয়োগ, এটাই ছক। অচেনা মানুষের কথায় টাকা খাটাবেন না।", "A wrong number, a friendship, then an investment: that's the pattern. Don't invest on a stranger's word."],
        },
      },
      stop: {
        who: "h",
        say: ["নম্বরটা ব্লক করে দিলাম।", "I blocked the number."],
        out: {
          sense: 3,
          lesson: ["ধীরে বন্ধুত্ব গড়ে পরে টাকা চাওয়া হয়। অচেনা মানুষের সাথে টাকার কথা উঠলেই থামুন।", "They build a friendship slowly and ask for money later. Stop as soon as a stranger brings up money."],
        },
      },
    },
  },
  {
    key: "sms_dubai_visa",
    kind: "sms",
    from: ["Visa-Agent", "Visa-Agent"],
    body: ["দুবাই ভিসা ৪০% ছাড়!! বেতন ৭০,০০০+। মেডিক্যাল ফ্রি। মাত্র ২টি সিট। পাসপোর্ট কপি পাঠান এই নম্বরে: 01866 00912", "Dubai visa 40% off!! Salary 70,000+. Free medical. Only 2 seats. Send a passport copy to this number: 01866 00912"],
    nodes: {
      start: {
        who: "h",
        say: ["দুবাই ভিসায় ছাড়? পাসপোর্টের ছবি চাইছে।", "A discount on a Dubai visa? They want a picture of my passport."],
        options: [
          { text: ["পাসপোর্টের ছবি পাঠাই।", "Send a picture of the passport."], go: "sent" },
          { text: ["প্রবাসী কল্যাণ অফিসে খোঁজ নিই।", "Ask at the overseas welfare office."], go: "office" },
          { text: ["মুছে দিই।", "Delete it."], out: { sense: 2, lesson: ["ভিসায় ছাড় বলে কিছু নেই। পাসপোর্টের ছবি অচেনা নম্বরে কখনো পাঠাবেন না।", "There's no such thing as a visa discount. Never send a passport picture to an unknown number."] } },
        ],
      },
      sent: {
        who: "o",
        say: ["পেয়েছি, আপনার নাম তালিকায় উঠেছে। আজ তিন হাজার টাকা দিলেই ভিসার কাজ শুরু।", "Got it, your name is on the list. Pay 3,000 taka today and the visa work begins."],
        options: [
          { text: ["পাঠাই।", "Send it."], go: "lost" },
          { text: ["আগে এজেন্সির লাইসেন্স দিন।", "First give me the agency's licence."], go: "lic" },
        ],
      },
      lic: {
        who: "o",
        say: ["লাইসেন্স দেখে কী করবেন? আপনার পাসপোর্টের ছবি তো আমাদের কাছেই আছে।", "What will you do with a licence? Your passport picture's with us, after all."],
        options: [
          { text: ["ভয় পেলাম, পাঠাই।", "That frightens me, I'll send it."], go: "lost" },
          { text: ["ভয় দেখাচ্ছেন? অভিযোগ করব।", "Is that a threat? I'm complaining."], go: "office" },
        ],
      },
      lost: {
        who: "o",
        say: ["পেয়েছি। ভিসা হলে জানাব, আসল পাসপোর্টটা তৈরি রাখবেন।", "Received. I'll tell you when the visa's done. Keep the real passport ready."],
        out: {
          mobile: -3000,
          sense: 1,
          later: "later_passport_misuse",
          lesson: ["ছাড়, কম সিট আর পাসপোর্টের ছবি চাওয়াই ফাঁদ। এজেন্সি যাচাই করুন সরকারি অফিসে।", "A discount, few seats and asking for a passport picture is the trap. Check the agency at the government office."],
        },
      },
      office: {
        who: "h",
        say: ["প্রবাসী কল্যাণ অফিসে দেখালাম। তারা বলল, এমন এজেন্সি নিবন্ধিত নেই।", "I showed it at the overseas welfare office. They say no such agency is registered."],
        out: {
          sense: 3,
          rep: 1,
          lesson: ["বিদেশে যাওয়ার আগে এজেন্সির নিবন্ধন দেখা সবচেয়ে বড় সুরক্ষা। অফিসে গেলেই জানা যায়।", "Checking an agency's registration is the best protection before going abroad. The office can tell you."],
        },
      },
    },
  },
  {
    key: "sms_otp_unasked",
    kind: "sms",
    from: ["ঝটপট টাকা", "Jhotpot Taka"],
    body: ["আপনার ঝটপট টাকা যাচাই কোড ৪৮২৯১৩। কাউকে বলবেন না।", "Your Jhotpot Taka verification code is 482913. Do not tell anyone."],
    nodes: {
      start: {
        who: "h",
        say: ["কোড এল, আমি তো কিছু চাইনি। পরের মুহূর্তে একটা ফোন।", "A code's come, though I asked for nothing. And a moment later, a call."],
        next: "second",
      },
      second: {
        who: "o",
        say: ["দুঃখিত, ভুলে আমার কোড আপনার নম্বরে চলে গেছে। একটু বলে দিন না, খুব দরকার।", "Sorry, my code went to your number by mistake. Could you just read it to me? It's urgent."],
        options: [
          { text: ["আচ্ছা, বলে দিই।", "All right, I'll read it."], go: "lost" },
          { text: ["আমি কোড কাউকে বলি না।", "I don't tell anyone my codes."], go: "caught" },
          { text: ["কেটে দিয়ে পিন বদলে নিই।", "Hang up and change my PIN."], go: "pin" },
        ],
      },
      lost: {
        who: "o",
        say: ["অনেক উপকার করলেন, ধন্যবাদ।", "You've been a great help, thank you."],
        out: {
          mobile: -2000,
          sense: 1,
          later: "later_sucker_list",
          lesson: ["অন্যের কোড ভুলে আপনার কাছে আসে না। ওটা আপনার অ্যাকাউন্টে ঢোকার চাবিই ছিল।", "Someone else's code doesn't come to you by mistake. That was the key to your own account."],
        },
      },
      caught: {
        who: "o",
        say: ["এটুকু উপকার করতে পারলেন না? ঠিক আছে।", "You couldn't do this one small favour? Fine."],
        out: {
          sense: 2,
          lesson: ["ঠিক উত্তর। না চাইতে কোড এলে কেউ আপনার অ্যাকাউন্টে ঢোকার চেষ্টা করছে, পিন বদলে নিন।", "Right answer. A code you didn't ask for means someone's trying to enter your account, so change your PIN."],
        },
      },
      pin: {
        who: "h",
        say: ["পিন বদলালাম, হেল্পলাইনকেও জানালাম।", "I changed my PIN and told the helpline too."],
        out: {
          sense: 3,
          lesson: ["না চাইতে কোড আসা মানে সতর্কতা। পিন বদলে হেল্পলাইনে জানালে আর ভয় থাকে না।", "An unasked-for code is a warning. Change your PIN and tell the helpline, and there's nothing more to fear."],
        },
      },
    },
  },
  {
    key: "sms_refund_qr",
    kind: "sms",
    from: ["Shop-Refund", "Shop-Refund"],
    body: ["আপনার অর্ডারের ১,২০০ টাকা রিফান্ড রেডি। টাকা পেতে এই লিংকের QR স্ক্যান করুন ও পিন দিন: http://shop-refund.clikk/qr", "Your order's Tk 1,200 refund is ready. To receive it, scan the QR at this link and enter your PIN: http://shop-refund.clikk/qr"],
    nodes: {
      start: {
        who: "h",
        say: ["কোন অর্ডারের ফেরত টাকা? আমি তো কিছু বাতিল করিনি।", "A refund for which order? I haven't cancelled anything."],
        options: [
          { text: ["লিংকের কিউআর স্ক্যান করি।", "Scan the QR at the link."], go: "scan" },
          { text: ["যে দোকান থেকে কিনি, তাদের জিজ্ঞেস করি।", "Ask the shop I buy from."], go: "shop" },
          { text: ["মুছে দিই।", "Delete it."], out: { sense: 2, lesson: ["যা বাতিল করেননি তার ফেরত হয় না। মুছে ভালোই করলেন।", "There's no refund for what you never cancelled. Deleting it was good."] } },
        ],
      },
      scan: {
        who: "h",
        say: ["স্ক্যান করতেই লেখা এল, বারোশো টাকা পাঠান। নিচে পিন চাইছে।", "When I scan it, it says: send 1,200 taka. Below that it wants my PIN."],
        options: [
          { text: ["পিন দিলেই তো টাকা আসবে।", "Enter the PIN, then the money will come."], go: "lost" },
          { text: ["পাঠান লেখা! থামি।", "It says send! I'll stop."], go: "stop" },
        ],
      },
      lost: {
        who: "h",
        say: ["টাকা এল না, গেল। ফেরত পাওয়ার কথা ছিল উল্টো।", "Money didn't come, it went. It was the opposite of a refund."],
        out: {
          mobile: -1200,
          sense: 1,
          lesson: ["টাকা পেতে পিন বা স্ক্যান লাগে না। কিউআর আর পিন শুধু টাকা পাঠাতেই লাগে।", "Receiving money needs no PIN or scan. A QR and PIN are only for sending money."],
        },
      },
      stop: {
        who: "h",
        say: ["কিউআর বন্ধ করলাম। এক পয়সাও গেল না।", "I closed the QR. Not a paisa went."],
        out: {
          sense: 3,
          lesson: ["পিন দেওয়ার আগে পর্দার লেখা পড়লেই ফাঁদ ধরা পড়ে। পাঠান লেখা থাকলে টাকা যাবে, আসবে না।", "Reading the screen before entering a PIN catches the trap. If it says send, money goes out, it doesn't come in."],
        },
      },
      shop: {
        who: "h",
        say: ["দোকান বলল, আমার কোনো ফেরত টাকা নেই।", "The shop says I have no refund coming."],
        out: {
          sense: 3,
          lesson: ["ফেরত টাকা এলে নিজে নিজেই ব্যালান্সে আসে। দোকানে জিজ্ঞেস করলেই সত্যিটা মেলে।", "A real refund lands in your balance by itself. Asking the shop gets you the truth."],
        },
      },
    },
  },
];
