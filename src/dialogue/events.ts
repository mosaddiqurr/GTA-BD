import type { StreetEvent } from "./types";
import { EVENTS_2 } from "./events2";
import { EVENTS_3 } from "./events3";

const EVENTS_1: StreetEvent[] = [
  {
    key: "event_crossing",
    id: "npc_elder_date",
    hint: ["এক মুরুব্বি রাস্তা পার হতে পারছেন না", "An old man can't get across the road"],
    place: "road",
    nodes: {
      start: {
        who: "o",
        say: ["সেই দুপুর থেকে পার হতে চাইছি। গাড়িগুলো কি আমাকে দেখে না?", "I've been trying to cross since noon. Can't these cars see me?"],
        options: [
          { text: ["হাত ধরেন, একসঙ্গে যাই।", "Take my arm, we'll go together."], go: "together" },
          { text: ["সামনে জেব্রা ক্রসিং আছে, চলেন।", "There's a zebra crossing just ahead. Come on."], go: "zebra" },
          { text: ["আমার তাড়া আছে।", "I'm in a hurry."], go: "hurry" },
        ],
      },
      together: { who: "h", say: ["আমি হাত তুলে রাখি, আপনি আস্তে হাঁটেন।", "I'll keep a hand up, you walk slowly."], next: "stopped" },
      stopped: { who: "o", say: ["আরে, বাসটা থেমে গেল! চল্লিশ বছরে এই প্রথম।", "Look, the bus stopped! First time in forty years."], next: "sweet" },
      zebra: {
        who: "o",
        say: ["জেব্রা ক্রসিং? আমি তো ভেবেছি ওটা রাস্তার নকশা।", "A zebra crossing? I thought that was just a pattern on the road."],
        next: "sweet",
        out: { lesson: ["জেব্রা ক্রসিংয়ে গাড়ির থামার কথা। রাস্তা পার হতে ওখানেই যাওয়া ভালো।", "Vehicles should stop at a zebra crossing. It's the best place to cross."] },
      },
      sweet: {
        who: "o",
        say: ["এই লজেন্সটা নেন। পকেটে আছে সেই গত ঈদ থেকে।", "Have this sweet. It's been in my pocket since last Eid."],
        options: [
          { text: ["নিলাম, ধন্যবাদ।", "I'll take it, thanks."], go: "bye", out: { rep: 2 } },
          { text: ["আপনিই রাখেন, পথে লাগবে।", "You keep it, you'll need it on the way."], go: "bye", out: { rep: 3 } },
        ],
      },
      bye: { who: "o", say: ["আল্লাহ ভালো রাখুন। এবার ওপারে গিয়ে মনে করি, কেন এসেছিলাম।", "God keep you well. Now I'll get to the other side and try to remember why I came."] },
      hurry: { who: "o", say: ["আচ্ছা, যান। তাড়া তো সবারই। আমি আরেকটু সাধনা করি।", "All right, go. Everyone's in a hurry. I'll meditate on it a little longer."], out: { rep: -1 } },
    },
  },
  {
    key: "event_lost_child",
    id: "npc_kid_berry",
    hint: ["একটা বাচ্চা একা দাঁড়িয়ে কাঁদছে", "A small child is standing alone, crying"],
    place: "market",
    nodes: {
      start: {
        who: "o",
        say: ["আম্মু হারিয়ে গেছে! আমি এখানেই ছিলাম, আম্মুই কোথায় যেন চলে গেছে।", "Mum's got lost! I was right here, she's the one who wandered off."],
        options: [
          { text: ["শেষ কোথায় দেখেছিলে?", "Where did you last see her?"], go: "where" },
          { text: ["চলো, দোকানদারকে বলি।", "Come on, let's tell a shopkeeper."], go: "shop" },
          { text: ["চলো, তোমাকে বাসায় দিয়ে আসি।", "Come on, I'll take you home."], go: "home" },
        ],
      },
      where: {
        who: "o",
        say: ["মাছের দোকানে। একটা লোক বলল, চকলেট দিবে, সঙ্গে চলো।", "At the fish stall. A man said he'd give me chocolate if I went with him."],
        options: [
          { text: ["অচেনা কারো সঙ্গে যাবে না। এখানেই থাকো।", "Never go with a stranger. Stay right here."], go: "shop", out: { sense: 1 } },
          { text: ["তুমি কী বললে?", "What did you say?"], go: "man" },
        ],
      },
      man: { who: "o", say: ["বললাম, আম্মু নিষেধ করেছে। লোকটা তখন চলে গেল।", "I said Mum told me not to. So he went away."], next: "shop" },
      home: {
        who: "o",
        say: ["ঠিকানা তো জানি না। আম্মু বলেছে, হারালে এক জায়গায় দাঁড়াতে।", "I don't know the address. Mum said if I get lost, to stay in one place."],
        next: "shop",
        out: { lesson: ["হারানো বাচ্চাকে অন্য কোথাও নেবেন না। কাছেই থেকে দোকানদার বা পাহারাদারকে জানান।", "Don't lead a lost child away. Stay close and tell a shopkeeper or guard."] },
      },
      shop: { who: "h", say: ["দোকানের মাইকে একটু ঘোষণা দেন, একটা বাচ্চা তার আম্মুকে খুঁজছে।", "Please announce on the shop's loudspeaker that a child is looking for her mother."], next: "found" },
      found: {
        who: "o",
        say: ["ওই তো আম্মু, হাতে মাছ! আম্মু, আমি তোমাকে খুঁজে পেয়েছি!", "There's Mum, with a fish! Mum, I found you!"],
        out: { rep: 3 },
      },
    },
  },
  {
    key: "event_burst_bag",
    id: "npc_woman_apple",
    hint: ["কারও বাজারের ব্যাগ ফেটে গেছে", "Someone's shopping bag has burst"],
    place: "market",
    nodes: {
      start: {
        who: "o",
        say: ["হায় হায়, আলু সব রাস্তায়! টমেটো কই? ওই যে, ড্রেনের দিকে যাচ্ছে!", "Oh no, potatoes everywhere! Where are the tomatoes? There, heading for the drain!"],
        options: [
          { text: ["আমি আলু ধরি, আপনি টমেটো দেখেন।", "I'll get the potatoes, you see to the tomatoes."], go: "catch" },
          { text: ["আমার ব্যাগটা নেন।", "Have my bag."], go: "give_bag", out: { money: -5 } },
          { text: ["দৃশ্যটা কিন্তু সুন্দর।", "It's quite a pretty sight, though."], go: "laugh" },
        ],
      },
      catch: { who: "h", say: ["ধরেছি! একটা আলু রিকশার নিচে, আনছি।", "Got them! There's one under a rickshaw, I'm getting it."], next: "chase" },
      chase: {
        who: "o",
        say: ["আরে, লাউটা বাসের দিকে গড়াচ্ছে! ওটা আমার শাশুড়ির পছন্দের লাউ!", "Oh no, the gourd's rolling towards the bus! That's my mother-in-law's favourite gourd!"],
        options: [
          { text: ["ছুট দিই!", "I'll run for it!"], go: "lau", out: { rep: 3 } },
          { text: ["লাউ যাক, ডিমগুলো সামলান।", "Let the gourd go, save the eggs."], go: "eggs", out: { rep: 2 } },
        ],
      },
      lau: { who: "o", say: ["ধরে ফেলেছেন! লাউটা বেঁচে গেল, আমার সংসারও।", "You caught it! The gourd is saved, and so is my marriage."], next: "thanks" },
      eggs: { who: "o", say: ["ঠিক বলেছেন, ডিম ফাটেনি! লাউয়ের কথা বলব, বাজারে ছিলই না।", "You're right, the eggs are fine! As for the gourd, I'll say there were none at the market."], next: "thanks" },
      give_bag: { who: "o", say: ["নিজের ব্যাগ দিয়ে দিলেন? আজকাল এটা তো খবরে দেওয়ার মতো ঘটনা।", "You're giving me your own bag? These days that's front page news."], next: "thanks", out: { rep: 4 } },
      thanks: { who: "o", say: ["এই লেবুটা রাখেন, না বলবেন না। কাল বাজারে দেখা হবে, শক্ত ব্যাগ নিয়ে।", "Keep this lemon, don't say no. See you at the market tomorrow, with a stronger bag."] },
      laugh: { who: "o", say: ["সুন্দর? আপনিও এসে আলুর পাশে দাঁড়ান, আরও সুন্দর লাগবে।", "Pretty? Come and stand with the potatoes, it'll look even prettier."], out: { rep: -2 } },
    },
  },
  {
    key: "event_cng_push",
    id: "npc_cng_guava",
    hint: ["একটা সিএনজি রাস্তায় থেমে গেছে", "A CNG has broken down on the road"],
    place: "road",
    nodes: {
      start: {
        who: "o",
        say: ["গাড়ি আর নড়ে না। ইঞ্জিন বলছে আজ ছুটি, পেছনের হর্নগুলো বলছে অন্য কথা।", "She won't budge. The engine says it's a holiday. The horns behind me say otherwise."],
        options: [
          { text: ["আমি ঠেলি, আপনি হাতল ধরেন।", "I'll push, you steer."], go: "push" },
          { text: ["গ্যাস আছে তো?", "Have you got gas?"], go: "gas" },
          { text: ["গ্যারেজে ফোন করেন।", "Ring a garage."], go: "garage" },
        ],
      },
      push: { who: "h", say: ["এক, দুই, তিন, ঠেলা!", "One, two, three, push!"], next: "moved" },
      moved: {
        who: "o",
        say: ["নড়েছে, নড়েছে! ওই ফাঁকা জায়গা পর্যন্ত! ধুর, আবার থেমে গেল।", "She's moving, she's moving! Up to that gap! Oh no, she's stopped again."],
        options: [
          { text: ["আরেকবার ঠেলি।", "One more push."], go: "again", out: { rep: 3 } },
          { text: ["এবার গ্যাসটা দেখেন।", "Now check the gas."], go: "gas" },
        ],
      },
      again: { who: "o", say: ["চালু হয়েছে! শোনেন কী সুন্দর শব্দ, একদম ট্রাক্টরের মতো।", "She's running! Listen to that lovely sound, just like a tractor."], next: "offer" },
      gas: { who: "o", say: ["গ্যাস? আরে, কাঁটা তো শূন্যে! সকালে বলেছিলাম কাল নিব। কালটা আজই এসে গেল।", "The gas? Oh, the needle's on zero! I said I'd fill up tomorrow. Tomorrow came today."], next: "offer", out: { rep: 1 } },
      garage: {
        who: "o",
        say: ["ওর ফোন বন্ধ, কারও ইঞ্জিন সারাচ্ছে নিশ্চয়। একটু সাইডে ঠেলতে ধরবেন?", "His phone's off, must be fixing someone's engine. Will you help me push her to the side?"],
        options: [
          { text: ["ধরলাম।", "Got it."], go: "push" },
          { text: ["আমি পারব না।", "I can't."], go: "leave" },
        ],
      },
      offer: {
        who: "o",
        say: ["বলেন কোথায় যাবেন, আজ আপনার ভাড়া নাই। মিটারও রাজি।", "Tell me where you're going, no fare for you today. Even the meter agrees."],
        options: [
          { text: ["লাগবে না, আপনি যান।", "No need, you carry on."], go: "bye", out: { rep: 2 } },
          { text: ["চায়ের টাকাটা দিলেই হবে।", "The price of a tea will do."], go: "tea", out: { money: 20 } },
        ],
      },
      tea: { who: "o", say: ["এই নেন। আমার হয়েও এক কাপ খেয়ে নিবেন।", "Here you go. Have a cup for me while you're at it."] },
      bye: { who: "o", say: ["ভালো মানুষ এখনো আছে তাহলে। পেছনের হর্নগুলো অবশ্য ধন্যবাদ দিচ্ছে না।", "So there are still good people. The horns behind aren't saying thanks, mind."] },
      leave: { who: "o", say: ["আচ্ছা, যান। আমি তাহলে এখানেই বাসা বানাই।", "All right, go on. I'll just build a house here then."], out: { rep: -1 } },
    },
  },
  {
    key: "event_wallet",
    id: "npc_shop_papaya",
    hint: ["মাটিতে একটা মানিব্যাগ পড়ে আছে", "A wallet is lying on the ground"],
    place: "footpath",
    nodes: {
      start: {
        who: "h",
        say: ["আরে, একটা মানিব্যাগ! সামনের ওই লোকটার পকেট থেকেই পড়ল মনে হয়।", "Hey, a wallet! It must have fallen from that man's pocket up ahead."],
        options: [
          { text: ["এই যে, আপনার মানিব্যাগ পড়ে গেছে!", "Excuse me, you've dropped your wallet!"], go: "call" },
          { text: ["দেখি ভেতরে কী আছে।", "Let's see what's inside."], go: "peek" },
          { text: ["পকেটে রেখে দিই।", "I'll just pocket it."], go: "pocket" },
        ],
      },
      call: {
        who: "o",
        say: ["আমার মানিব্যাগ? হায় হায়, এর মধ্যে দোকানের সারা দিনের টাকা!", "My wallet? Oh no, the shop's whole day's money is in there!"],
        next: "reward",
      },
      reward: {
        who: "o",
        say: ["এই নেন, চায়ের টাকা। না নিলে আমি সত্যিই রাগ করব।", "Here, for a cup of tea. Say no and I'll truly be cross."],
        options: [
          { text: ["নিলাম, ধন্যবাদ।", "I'll take it, thanks."], go: "taken", out: { money: 30, rep: 2 } },
          { text: ["না থাক, ওটা আপনার।", "No, keep it, it's yours."], go: "refused", out: { rep: 4 } },
        ],
      },
      taken: { who: "o", say: ["বেশ। দোকানে এলে আরেক কাপ পাবেন, ওটা বিনা টাকায়।", "Good. Come by the shop for another cup, that one's free."] },
      refused: { who: "o", say: ["আজকালকার দিনে এমন মানুষ! খাতায় আপনার নাম লিখে রাখব, ভালো পাতায়।", "Someone like you, in this day and age! I'll write your name in my book, on the good page."] },
      peek: {
        who: "h",
        say: ["ভেতরে টাকা, ওষুধের কাগজ, আর একটা নাম লেখা কার্ড।", "Money, a prescription and a card with a name inside."],
        options: [
          { text: ["লোকটাকে ডাকি।", "I'll call the man."], go: "call" },
          { text: ["তাও পকেটে রাখি।", "I'll pocket it anyway."], go: "pocket" },
        ],
      },
      pocket: { who: "h", say: ["রাখলাম। ওই লোকটা এদিকেই ফিরে আসছে।", "Done. That man's coming back this way."], next: "back" },
      back: {
        who: "o",
        say: ["একটা মানিব্যাগ দেখেছেন? এর মধ্যে আব্বার ওষুধের টাকা ছিল।", "Have you seen a wallet? It had the money for my father's medicine."],
        options: [
          { text: ["এই যে, নিচে পড়ে ছিল।", "Here it is, it was on the ground."], go: "call" },
          { text: ["দেখিনি।", "I haven't seen it."], go: "lie", out: { money: 50, rep: -5 } },
        ],
      },
      lie: { who: "o", say: ["আচ্ছা। আল্লাহ করুন, ওটা যেন ভালো কারো হাতে পড়ে।", "All right. God willing, it's fallen into good hands."] },
    },
  },
  {
    key: "event_bus_fare",
    id: "npc_granny_fig",
    hint: ["এক বৃদ্ধার ভাড়ার টাকা কম পড়েছে", "An old woman is short of her bus fare"],
    place: "busstop",
    nodes: {
      start: {
        who: "o",
        say: ["বাসে উঠতে গিয়ে দেখি টাকা কম। পান কিনে ফেলেছি। পানটা অবশ্য ভালো ছিল।", "Went to board and found I'm short. I bought paan. Mind you, it was good paan."],
        options: [
          { text: ["ভাড়াটা আমি দিচ্ছি।", "I'll pay your fare."], go: "pay", out: { money: -20 } },
          { text: ["হেলপারকে বুঝিয়ে বলি?", "Shall I have a word with the helper?"], go: "helper" },
          { text: ["আমার কাছেও নাই।", "I haven't got any either."], go: "none" },
        ],
      },
      pay: {
        who: "o",
        say: ["দিলেন? আল্লাহ বরকত দিন। ব্যাগে নারকেলের মোয়া আছে, নিবেন?", "You did? God bless you. There's coconut sweet in my bag, will you have one?"],
        options: [
          { text: ["লাগবে না, ভালোভাবে যান।", "No need, go safely."], go: "bye", out: { rep: 3 } },
          { text: ["মোয়া হলে নিব।", "For coconut sweet, I will."], go: "moya", out: { rep: 2 } },
        ],
      },
      moya: { who: "o", say: ["এই নেন। ব্যাগে টাকা ছিল না, মোয়া ছিল। এই আমার হিসাব।", "Here you are. My bag had no money, but it had sweets. That's my kind of accounts."], next: "bye" },
      bye: { who: "o", say: ["যাই, বাস ছাড়ছে। হ্যাঁ হ্যাঁ, বাম পা আগে, জানি জানি!", "I'm off, the bus is leaving. Yes, yes, left foot first, I know!"] },
      helper: { who: "h", say: ["শোনেন, মুরুব্বি মানুষ, ভাড়াটা একটু কম নেওয়া যায়?", "Listen, she's an elderly person. Could you take a little less?"], next: "helper2" },
      helper2: { who: "o", say: ["হেলপার বলছে, ওঠেন ওঠেন! তবে একটা পান চেয়েছে। দিয়ে দিলাম।", "The helper says get on, get on! But he wanted a paan. I gave him one."], out: { rep: 2 } },
      none: { who: "o", say: ["তাহলে আরেকটু দাঁড়াই। পরের বাসে কেউ না কেউ চিনবেই।", "Then I'll wait a little. Someone on the next bus is bound to know me."] },
    },
  },
];

export const EVENTS: StreetEvent[] = [...EVENTS_1, ...EVENTS_2, ...EVENTS_3];
