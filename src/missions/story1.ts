import { Kit, h, o, t } from "./kit";
import type { MissionDef } from "./runner";

export const MIR = "dhaka_mirpur10", GUL = "dhaka_gulshan", DHA = "dhaka_dhanmondi";
export const UNCLE = t("চাচা", "Uncle");

/** The uncle's stall: always the tea stall nearest the start of the district. */
export function uncleStall(k: Kit) {
  const s = k.g.city.region.spawnPoints.default;
  return k.teaStall({ x: s[0], z: s[2] });
}

const lost = t("হারিয়ে ফেললেন।", "You lost them.");

export const STORY_1: MissionDef[] = [
  {
    id: "m01",
    title: t("ঢাকায় প্রথম দিন", "First day in Dhaka"),
    blurb: t("বাস টার্মিনালে নেমে চাচার চায়ের দোকান খুঁজে বের করুন।", "Get off at the bus terminal and find Uncle's tea stall."),
    region: MIR,
    start: (k) => k.block("terminal"),
    money: 300,
    rep: 2,
    stages: [
      {
        run: async (k) => {
          const st = uncleStall(k);
          const uncle = k.person("npc_elder_date", st.x + 1.8, st.z + 1.4, UNCLE);
          k.faceHero(uncle);
          await k.reachOnFoot(uncle.x, uncle.z, UNCLE, t("চাচার চায়ের দোকানে যান", "Walk to Uncle's tea stall"), 3);
          await k.talk(uncle, [
            o("এই তো এসে গেছ! পথে কোনো কষ্ট হয়নি তো?", "There you are! Was the road all right?"),
            h("ঢাকায় এত মানুষ আগে দেখিনি।", "I've never seen so many people."),
            o("এটাই ঢাকা। এখানে মানুষ বেশি, সময় কম, আর ঠকানোর লোক তার চেয়েও বেশি।", "That's Dhaka. Plenty of people, little time, and even more people out to cheat you."),
            o("আজ থেকে দোকানে আমার হাত হবে তুমি। আগে চা দেওয়া শেখো।", "From today you're my right hand at the stall. Start by learning to serve."),
          ]);
          const orders = [
            { who: k.person("npc_commuter_lychee", st.x + 3.6, st.z - 0.8, t("যাত্রী", "Commuter")), want: 0 },
            { who: k.person("npc_office_orange", st.x + 3.6, st.z + 1.4, t("অফিসের লোক", "Office worker")), want: 1 },
            { who: k.person("npc_rickshaw_watermelon", st.x + 3.2, st.z + 3.2, t("রিকশাওয়ালা", "Rickshaw puller")), want: 2 },
          ];
          const menu = [t("দুধ চা", "Milk tea"), t("রং চা, চিনি কম", "Red tea, less sugar"), t("চা আর বিস্কুট", "Tea and a biscuit")];
          const [first, second, third] = orders;
          k.objective(t("তিনজন খদ্দেরকে ঠিকঠাক চা দিন", "Serve three customers the right order"));
          k.faceHero(first.who);
          await k.talk(first.who, [o("এক কাপ দুধ চা দেন তো, তাড়া আছে।", "One milk tea, quick, I'm in a hurry.")]);
          if ((await k.choose(first.who, menu, 0)) === 0) k.score++;
          k.faceHero(second.who);
          await k.talk(second.who, [o("ডাক্তার চিনি কমাতে বলেছে। রং চা দেন, চিনি কম।", "Doctor says cut the sugar. Red tea, go easy on it.")]);
          if ((await k.choose(second.who, menu, 1)) === 1) k.score++;
          k.faceHero(third.who);
          await k.talk(third.who, [o("সকাল থেকে পেটে কিছু পড়েনি। চায়ের সাথে একটা বিস্কুট দিয়েন।", "Nothing in my stomach since morning. Tea, and put a biscuit with it.")]);
          if ((await k.choose(third.who, menu, 2)) === 2) k.score++;
          await k.talk(uncle, k.score >= 2
            ? [o("বাহ, হাত ভালো! খদ্দের মনে রাখলেই দোকান চলে।", "Good hands! A stall runs on remembering customers.")]
            : [o("একটু গুলিয়ে গেছে, ব্যাপার না। কান খোলা রাখলেই শিখে যাবে।", "A bit muddled, never mind. Keep your ears open and you'll learn.")]);
          await k.talk(uncle, [
            o("শোনো, টাকা জমাচ্ছি অনেক বছর ধরে। একদিন এই দোকানটা পাকা করব।", "Listen, I've been saving for years. One day this stall gets real walls."),
            o("এই নাও, আজকের মজুরি। শহরটা একটু ঘুরে দেখো।", "Here's today's pay. Go and see a bit of the city."),
          ]);
        },
      },
    ],
  },
  {
    id: "m02",
    title: t("ভুয়া এসএমএস", "The fake SMS"),
    blurb: t("চাচা ডাকছেন। দোকানে কিছু একটা গোলমাল হচ্ছে।", "Uncle's calling for you. Something's going on at the stall."),
    region: MIR,
    start: (k) => {
      const st = uncleStall(k);
      return { x: st.x + 2.5, z: st.z + 2.5 };
    },
    money: 500,
    rep: 3,
    sense: 2,
    lesson: t("টাকা এসেছে কিনা নিজের ব্যালান্সে দেখুন। অন্যের দেখানো এসএমএসে নয়।", "Check your own balance to see if money came in, never a message someone shows you."),
    stages: [
      {
        run: async (k) => {
          const st = uncleStall(k);
          const uncle = k.person("npc_elder_date", st.x + 1.8, st.z + 1.4, UNCLE);
          const crook = k.person("npc_commuter_lychee", st.x + 4, st.z - 1, t("খদ্দের", "Customer"));
          k.faceHero(uncle);
          await k.talk(crook, [
            o("পাঁচশো টাকার জিনিস নিলাম। ঝটপট টাকায় পাঠিয়ে দিয়েছি, এই দেখেন মেসেজ।", "That's five hundred taka of goods. I've sent it by Jhotpot Taka, here's the message."),
            h("দেখি একটু।", "Let me see."),
          ]);
          await k.inspect(t("খদ্দেরের ফোনের মেসেজ", "The message on his phone"), [
            { text: t("অভিনন্দন! ", "Congratulations! ") },
            { text: t("Tk 500.00 received", "Tk 500.00 received"), flag: t("আসল বার্তা বাংলা-ইংরেজি মিশিয়ে এমন লেখে না, আর ব্যালান্স থাকে।", "A real notice has your balance and a transaction ID, and this has neither.") },
            { text: t(" from 01712-xxxxx ", " from 01712-xxxxx ") },
            { text: t("Sender: +8801911-204477", "Sender: +8801911-204477"), flag: t("আসল সেবা সবসময় নিজের নামে পাঠায়, সাধারণ নম্বর থেকে নয়।", "The real service sends from its own name, never from an ordinary number.") },
            { text: t(" Kindly ", " Kindly ") },
            { text: t("confirm to customar now", "confirm to customar now"), flag: t("বানান ভুল আর তাড়াহুড়ো: ঠকবাজির চেনা লক্ষণ।", "Misspelt and in a rush: the usual marks of a scam.") },
          ], t("যা যা সন্দেহজনক, তাতে চাপ দিন", "Tap whatever looks wrong"));
          await k.talk(uncle, [
            o("আমার ফোনে তো কোনো টাকা আসেনি! ব্যালান্স যা ছিল তাই।", "Nothing has reached my phone! The balance hasn't moved."),
            h("এই মেসেজ ভুয়া। টাকাটা দিয়ে যান।", "That message is fake. Pay up, please."),
          ]);
          k.walkTo(crook, crook.x + 160, crook.z + 120, 4.1);
          await k.caption(t("লোকটা জিনিস নিয়ে দৌড় দিল!", "He's running off with the goods!"), 1.2);
          await k.chase(crook, t("লোকটাকে ধরুন! Shift চেপে দৌড়ান", "Catch him! Hold Shift to run"), lost);
          crook.path = [];
          await k.talk(crook, [
            o("আরে থামেন থামেন! লোকজন দেখছে। এই নিন আপনাদের টাকা।", "All right, stop! People are looking. Here's your money."),
            h("পরের বার কেউ এই ফাঁদে পড়বে না। সবাইকে বলব।", "Nobody here falls for this again. I'll tell them all."),
            o("মাফ করেন। আর এই বাজারে আসব না।", "Forgive me. I won't come to this market again."),
          ]);
          await k.reachOnFoot(uncle.x, uncle.z, UNCLE, t("চাচার কাছে ফিরে যান", "Go back to Uncle"), 3);
          await k.talk(uncle, [
            o("শাবাশ! ওই লোক গত মাসে তিনটা দোকান ঠকিয়েছে।", "Well done! He cheated three shops last month."),
            o("মনে রেখো, নিজের ফোনে ব্যালান্স না দেখে মাল ছাড়বে না।", "Remember: never hand over goods till you've seen your own balance."),
          ]);
        },
      },
    ],
  },
  {
    id: "m03",
    title: t("চাচার ফোন উধাও", "Uncle's phone is gone"),
    blurb: t("চাচার ফোন চুরি গেছে। ওই ফোনেই তাঁর সারা জীবনের সঞ্চয়।", "Uncle's phone has been taken. His life's savings are on it."),
    region: MIR,
    start: (k) => {
      const st = uncleStall(k);
      return { x: st.x + 2.5, z: st.z + 2.5 };
    },
    money: 700,
    rep: 3,
    sense: 2,
    lesson: t("ফোন হারালে আগে সিম আর মোবাইল ব্যাংকিং বন্ধ করুন, তারপর থানায় জিডি।", "Lose your phone? Block the SIM and mobile banking first, then report it to the police."),
    stages: [
      {
        run: async (k) => {
          const st = uncleStall(k);
          const uncle = k.person("npc_elder_date", st.x + 1.8, st.z + 1.4, UNCLE);
          k.faceHero(uncle);
          await k.talk(uncle, [
            o("সর্বনাশ! ফোনটা এখানেই রেখেছিলাম, নেই। ওতেই সব টাকা।", "Disaster! I left my phone right here and it's gone. All my money's on it."),
            h("পিন কি কাউকে দিয়েছিলেন?", "Have you told anyone the PIN?"),
            o("পিনটা ফোনের কভারের ভেতরে কাগজে লেখা ছিল।", "The PIN's on a slip inside the phone case."),
            h("তাহলে হাতে বেশি সময় নেই। ফোনের সিগন্যাল খুঁজে দেখি।", "Then there isn't much time. I'll track the phone's signal."),
          ]);
          const market = k.block("market");
          k.timer(170, t("দেরি হয়ে গেল। চোর টাকা তুলে নিল।", "Too late. The thief has emptied the account."));
          await k.hunt(market.x, market.z + 4, 0, t("চাচার ফোনের সিগন্যাল", "Uncle's phone signal"), t("সিগন্যাল মিটার দেখে ফোনটা খুঁজুন", "Follow the signal meter to the phone"), 14);
          const fixer = k.person("npc_shop_papaya", market.x + 1, market.z + 3, t("মেরামতের দোকানদার", "Repair man"));
          k.faceHero(fixer);
          await k.talk(fixer, [
            o("একটা ছেলে এইমাত্র ফোনটা বিক্রি করে গেল। লক ভাঙতে বলছিল।", "A lad just sold it to me and wanted the lock broken."),
            h("ওটা চুরির ফোন। আমাদের দিন।", "It's stolen. Please give it to us."),
            o("চুরির মাল আমি রাখি না। নিন, আগে টাকা বাঁচান।", "I don't keep stolen goods. Take it, and save your money first."),
          ]);
          k.clearTimer();
          k.objective(t("ঠিক কাজটা আগে করুন", "Do the right thing first"));
          k.timer(50, t("দেরি হয়ে গেল। কেউ আগেই লগইন করেছে।", "Too late. Someone has already logged in."));
          const pick = await k.choose(fixer, [t("আগে পিন বদলাই আর ঝটপট টাকার হেল্পলাইনে ফোন দিই", "Change the PIN and ring the Jhotpot Taka helpline first"), t("আগে থানায় যাই", "Go to the police station first"), t("ফেসবুকে পোস্ট দিই", "Post about it on social media")], 0);
          if (pick !== 0) k.fail(t("ওই সময়ে চোরের সাঙ্গপাঙ্গ টাকা সরিয়ে ফেলল।", "In that time the thief's friends moved the money."));
          k.clearTimer();
          k.note(t("পিন বদলানো হলো, হেল্পলাইনে জানানো হলো।", "PIN changed, helpline told."));
          await k.reachOnFoot(uncle.x, uncle.z, UNCLE, t("ফোন নিয়ে চাচার কাছে যান", "Take the phone back to Uncle"), 3);
          await k.talk(uncle, [
            o("বেঁচে গেছি! আর কখনো পিন কাগজে লিখব না।", "Saved! I'll never write a PIN on paper again."),
            o("কিন্তু দেখো তো, এই ফোনে গত সপ্তাহে একটা অদ্ভুত লিঙ্কে চাপ পড়েছিল।", "But look, last week someone tapped a strange link on this phone."),
            h("এর পেছনে কি বড় কেউ আছে?", "Is someone bigger behind this?"),
            o("আল্লাহই জানেন। সাবধানে থেকো।", "God knows. Take care."),
          ]);
        },
      },
    ],
  },
  {
    id: "m04",
    title: t("ওপরতলার প্রতিবেশী", "The neighbour upstairs"),
    blurb: t("পাশের বাসার করিম সাহেব ফোনে 'ব্যাংক অফিসার'-এর সাথে কথা বলছেন।", "Mr Karim next door is on the phone to a 'bank officer'."),
    region: MIR,
    start: (k) => {
      const b = k.inside("home");
      return { x: b.outX + 3, z: b.outZ + 3 };
    },
    money: 800,
    rep: 4,
    sense: 2,
    lesson: t("ব্যাংক কখনো ফোনে কোড চায় না। ফোন কেটে কার্ডের পেছনের নম্বরে নিজে ফোন করুন।", "A bank never asks for a code by phone. Hang up and ring the number on your card yourself."),
    stages: [
      {
        run: async (k) => {
          const boy = k.person("npc_kid_berry", k.inside("home").outX + 2, k.inside("home").outZ + 1, t("পাশের বাসার ছেলে", "Boy from next door"));
          k.faceHero(boy);
          await k.talk(boy, [
            o("দাদু ফোনে কাকে যেন কোড পড়ে শোনাচ্ছেন! লোকটা বলছে ব্যাংক থেকে।", "Grandpa's reading out some code on the phone! The man says he's from the bank."),
            h("কোন তলায়?", "Which floor?"),
            o("একদম ওপরে। তাড়াতাড়ি! লিফট খুব ধীর।", "Right at the top. Quickly! The lift's slow."),
          ]);
          k.timer(75, t("কোড বলা হয়ে গেল। করিম সাহেবের পেনশন গেল।", "The code's been read out. Mr Karim's pension is gone."));
          const b = await k.goInside("home", t("দালানে ঢুকুন", "Get into the building"));
          const top = b.lift[b.lift.length - 1] ?? { x: b.x, y: b.y, z: b.z };
          const karim = k.person("npc_elder_date", top.x + 2, top.z + 3, t("করিম সাহেব", "Mr Karim"), { y: top.y });
          await k.reachOnFoot(karim.x, karim.z, t("করিম সাহেব", "Mr Karim"), t("লিফটে বা সিঁড়িতে ওপরে গিয়ে তাঁকে থামান", "Up by the lift or stairs and stop him"), 3, top.y);
          k.clearTimer();
          await k.talk(karim, [
            o("দাঁড়াও, ব্যাংকের অফিসার। আমার কার্ড নাকি বন্ধ হয়ে যাচ্ছে। ছয়টা সংখ্যা চেয়েছে।", "Wait, it's the bank's officer. He says my card's being blocked. He wants six digits."),
          ]);
          const pick = await k.choose(karim, [t("ফোন কেটে দিন! ব্যাংক কখনো কোড চায় না", "Hang up! A bank never asks for a code"), t("কোডটা বলে দিন, কার্ড বাঁচুক", "Read him the code, save the card"), t("অর্ধেক কোড বলুন", "Tell him half the code")], 0);
          if (pick !== 0) k.fail(t("কোড শুনেই লোকটা টাকা তুলে নিল।", "The moment he heard the code, he took the money."));
          await k.talk(karim, [
            o("কেটে দিলাম। কিন্তু লোকটা আমার নাম, হিসাব নম্বর সব জানত!", "I've hung up. But he knew my name, my account number, everything!"),
            h("ওসব ফাঁস হওয়া তথ্য। আপনি কার্ডের পেছনের নম্বরে নিজে ফোন করুন।", "That's leaked data. Ring the number on the back of your card yourself."),
            o("তুমি আজ আমার পেনশন বাঁচালে। এই নাও, একটু মিষ্টি খেও।", "You saved my pension today. Here, buy yourself some sweets."),
            o("শুনেছি মিরপুরে আরও অনেকে এমন ফোন পেয়েছে। গুলশানের কোনো অফিস থেকে আসে।", "I hear many in Mirpur have had these calls. They come from some office in Gulshan."),
          ]);
          await k.goOutside(t("নিচে নেমে বাইরে আসুন", "Go back down and outside"));
        },
      },
    ],
  },
  {
    id: "m05",
    title: t("মলের ফোন বিক্রেতা", "The phone seller at the mall"),
    blurb: t("গুলশানের এক মলে কম দামে ফোন বেচে একজন। তার পেছনে কে আছে দেখুন।", "Someone's selling cheap phones at a Gulshan mall. See who's behind him."),
    region: GUL,
    start: (k) => {
      const b = k.inside("mall");
      return { x: b.outX + 3, z: b.outZ + 2 };
    },
    money: 1000,
    rep: 3,
    sense: 2,
    lesson: t("না দেখে অগ্রিম টাকা নয়। হাতে নিয়ে পরখ করে তবেই দাম দিন।", "No advance payment for anything unseen. Check it in your hands, then pay."),
    stages: [
      {
        run: async (k) => {
          const b = await k.goInside("mall", t("মলে ঢুকুন", "Go into the mall"));
          const seller = k.person("npc_boss_quince", b.x + 3, b.z + 9, t("ফোন বিক্রেতা", "Phone seller"), { y: b.y });
          await k.reachOnFoot(seller.x, seller.z, t("ফোন বিক্রেতা", "Phone seller"), t("ফোন বিক্রেতাকে খুঁজে বের করুন", "Find the phone seller"), 3, b.y);
          k.faceHero(seller);
          await k.talk(seller, [
            o("একদম নতুন ফোন, অর্ধেক দাম। আজই শেষ, কাল আর পাবেন না।", "Brand new phone, half price. Today only, gone tomorrow."),
            h("ফোনটা হাতে দেখা যাবে?", "Can I hold it?"),
            o("স্টকে নেই। এখন দুই হাজার অগ্রিম দিন, কাল ডেলিভারি।", "Not in stock. Two thousand in advance now, delivered tomorrow."),
          ]);
          await k.inspect(t("বিক্রেতার কাগজ", "The seller's flyer"), [
            { text: t("অরিজিনাল ফোন ", "Original phone ") },
            { text: t("৫০% ছাড়", "50% off"), flag: t("বাজারের অর্ধেক দাম মানেই সন্দেহ।", "Half the market price is itself the warning.") },
            { text: t(" মাত্র ", " only ") },
            { text: t("আজকের জন্য", "today"), flag: t("ভাবার সময় না দেওয়া ঠকবাজির কৌশল।", "Leaving you no time to think is the trick.") },
            { text: t(", ", ", ") },
            { text: t("অগ্রিম দিলে তবেই ডেলিভারি", "delivery only after advance"), flag: t("না দেখে অগ্রিম দেওয়া টাকা আর ফেরে না।", "Money paid in advance for the unseen doesn't come back.") },
          ], t("কোন কথাগুলো ঠিক লাগছে না? চাপ দিন", "Which parts don't sit right? Tap them"));
          await k.talk(seller, [h("একটু ভেবে দেখি।", "Let me think about it."), o("যা খুশি। অন্য কেউ নিয়ে নেবে।", "Suit yourself. Someone else will take it.")]);
          k.note(t("লোকটা তাড়াহুড়ো করে বেরিয়ে যাচ্ছে। পিছু নিন।", "He's hurrying out. Follow him."));
          seller.who.x = seller.who.z = 1e5;
          await k.goOutside(t("মল থেকে বের হন", "Leave the mall"));
          const p = k.g.player.position;
          const cng = k.car("cng", p, 70);
          if (!cng) return;
          const dest = k.away(450, Math.atan2(-p.x, -p.z));
          k.send(cng, dest.x, dest.z);
          k.note(t("ওই সিএনজিতে উঠেছে। Q চেপে বাহন ডাকুন অথবা কিছু একটা নিয়ে পিছু নিন।", "He's in that CNG. Press Q for a ride, or take something and follow."));
          await k.tail(cng, t("সিএনজির পিছু নিন, বেশি কাছে যাবেন না", "Follow the CNG, without getting too close"), {
            near: 7,
            far: 170,
            seen: t("সে টের পেয়ে গেল।", "He noticed you."),
            lost: t("সিএনজিটা হারিয়ে গেল।", "You lost the CNG."),
            done: () => k.distOf(cng, dest.x, dest.z) < 28 || Math.abs(cng.speed) < 0.1 && k.distOf(cng, dest.x, dest.z) < 70,
          });
          await k.photo(dest.x, dest.z, 0, t("অফিসের ঠিকানা", "the office's address"), t("কাছে গিয়ে জায়গাটার ছবি তুলুন", "Go close and photograph the place"), 28);
          await k.call("npc_elder_date", UNCLE, [
            h("লোকটা একটা অফিসে ঢুকল। ছবি তুলেছি।", "He went into an office. I've a photo."),
            o("সাবধান। এসব একা করতে যেও না।", "Careful. Don't do this sort of thing alone."),
          ]);
        },
      },
    ],
  },
  {
    id: "m06",
    title: t("টাওয়ারের কুরিয়ার", "Courier in the tower"),
    blurb: t("রাসেলের চেনা কুরিয়ার অফিসে লোক কম। আসল পার্সেল দিন, ভুয়া লোক ধরুন।", "A courier office is short-handed. Deliver real parcels and catch a fake courier."),
    region: GUL,
    start: (k) => {
      const b = k.inside("office");
      return { x: b.outX + 3, z: b.outZ + 2 };
    },
    money: 900,
    rep: 3,
    sense: 2,
    lesson: t("পার্সেল নিতে কোড লাগে না, ফিও লাগে না। না চাইলে কিছু দেবেন না।", "A parcel needs no code and no fee you weren't told about. Give neither."),
    stages: [
      {
        run: async (k) => {
          const b = await k.goInside("office", t("অফিস টাওয়ারে ঢুকুন", "Go into the office tower"));
          const clerk = k.person("npc_woman_peach", b.x + 2, b.z + 6, t("রিসেপশন", "Reception"), { y: b.y });
          k.faceHero(clerk);
          await k.reachOnFoot(clerk.x, clerk.z, t("রিসেপশন", "Reception"), t("রিসেপশনে কথা বলুন", "Talk to reception"), 3, b.y);
          await k.talk(clerk, [
            o("ওপরের তলায় দুটো পার্সেল আছে। আর একটা কথা, একজন কুরিয়ারের লোক সবার কাছে কোড চাইছে।", "Two parcels for upstairs. And one thing: some courier man has been asking people for a code."),
            h("আমি নজর রাখব।", "I'll keep an eye out."),
          ]);
          const top = b.lift[b.lift.length - 1] ?? { x: b.x, y: b.y, z: b.z };
          const one = k.person("npc_office_orange", top.x + 3, top.z + 2, t("প্রাপক", "Recipient"), { y: top.y });
          const fake = k.person("npc_commuter_lychee", top.x - 3, top.z + 4, t("কুরিয়ারের লোক", "Courier man"), { y: top.y });
          const victim = k.person("npc_woman_apple", top.x - 4.6, top.z + 4.6, t("কর্মচারী", "Employee"), { y: top.y });
          await k.reachOnFoot(one.x, one.z, t("প্রথম পার্সেল", "First parcel"), t("লিফটে উঠে প্রথম পার্সেল দিন", "Take the lift and deliver the first parcel"), 3, top.y);
          k.faceHero(one);
          await k.talk(one, [o("ধন্যবাদ। পাশের ডেস্কে একটু গোলমাল শোনা যাচ্ছে, দেখুন তো।", "Thanks. There's some fuss at the next desk, have a look.")]);
          await k.reachOnFoot(fake.x, fake.z, t("গোলমাল", "The fuss"), t("পাশের ডেস্কে যান", "Go to the next desk"), 3, top.y);
          await k.talk(fake, [o("ম্যাডামের পার্সেল আটকে আছে। মোবাইলে একটা কোড গেছে, ওটা বলে দিলেই ছাড়ব।", "Madam's parcel is stuck. A code's gone to her mobile. Tell me that and I'll release it.")]);
          const pick = await k.choose(fake, [t("কোন কোম্পানি? আপনার পরিচয়পত্র দেখান", "Which company? Show your ID"), t("কোডটা বলে দিন, ঝামেলা শেষ", "Give him the code and be done"), t("আমি কিছু জানি না", "I know nothing about it")], 0);
          if (pick === 1) k.fail(t("কোড পেয়েই তার ঝটপট টাকা খালি হয়ে গেল।", "With that code, her Jhotpot Taka account was emptied."));
          await k.talk(fake, [o("আরে, আমার ডিউটি শেষ। আমি যাই।", "Oh, my shift's over. I'm off.")]);
          k.walk(fake, [[top.x, top.z]], 3.6);
          await k.talk(victim, [
            o("কোডটা বলতে যাচ্ছিলাম! পার্সেলের জন্য তো কোড লাগে না, তাই না?", "I was about to read it out! You don't need a code for a parcel, do you?"),
            h("একদম না। আর ওই কোড দিয়ে আপনার ঝটপট টাকায় ঢোকা যায়।", "Never. And that code opens your Jhotpot Taka account."),
            o("একই লোক গত সপ্তাহে নিচের তলাতেও এসেছিল।", "The same man was on the floor below last week."),
          ]);
          await k.goOutside(t("কাজ শেষ। বাইরে আসুন", "Job done. Come back outside"));
        },
      },
    ],
  },
  {
    id: "m07",
    title: t("মলের ফাঁদ ওয়াইফাই", "The mall's trap Wi-Fi"),
    blurb: t("মলে একটা ফ্রি ওয়াইফাইয়ে ঢুকলেই মানুষের টাকা যাচ্ছে।", "People at the mall lose money after joining a free Wi-Fi."),
    region: GUL,
    start: (k) => {
      const b = k.inside("mall");
      return { x: b.outX - 3, z: b.outZ + 2 };
    },
    money: 1000,
    rep: 3,
    sense: 2,
    lesson: t("খোলা ওয়াইফাইয়ে ব্যাংকিং নয়। নামটা আসল মনে হলেও ফাঁদ হতে পারে।", "No banking on open Wi-Fi. Even a real-sounding name can be a trap."),
    stages: [
      {
        run: async (k) => {
          const b = await k.goInside("mall", t("মলে ঢুকুন", "Go into the mall"));
          const guard = k.person("npc_guard_melon", b.x - 2, b.z + 5, t("নিরাপত্তারক্ষী", "Security guard"), { y: b.y });
          k.faceHero(guard);
          await k.reachOnFoot(guard.x, guard.z, t("নিরাপত্তারক্ষী", "Security guard"), t("নিরাপত্তারক্ষীর সাথে কথা বলুন", "Talk to the guard"), 3, b.y);
          await k.talk(guard, [
            o("তিন দিনে নয়জন অভিযোগ করেছে। ফ্রি মল ওয়াইফাই নামে কিছু একটা চলছে, যা আমাদের নয়।", "Nine complaints in three days. Something called Free Mall WiFi is running, and it isn't ours."),
            h("ফোনের মিটার দিয়ে খুঁজে দেখি।", "I'll hunt for it with the phone's meter."),
          ]);
          const top = b.lift[1] ?? { x: b.x, y: b.y, z: b.z };
          const man = k.person("npc_student_lemon", top.x + 9, top.z + 12, t("ব্যাগ হাতে লোক", "Man with a bag"), { y: top.y, pose: "sit_bench" });
          await k.hunt(man.x, man.z, top.y, t("ফ্রি মল ওয়াইফাই", "Free Mall WiFi"), t("মলে হেঁটে সিগন্যাল সবচেয়ে জোরালো জায়গা খুঁজুন", "Walk the mall to where the signal's strongest"), 7);
          await k.photo(man.x, man.z, top.y, t("ব্যাগের ভেতরের রাউটার", "the router in the bag"), t("কাছে গিয়ে ব্যাগের ছবি তুলুন", "Go close and photograph the bag"), 5);
          await k.talk(man, [
            o("কী হয়েছে? আমি তো শুধু বসে আছি।", "What's up? I'm only sitting here."),
            h("ব্যাগের ভেতর রাউটারটা কার?", "Whose is the router in your bag?"),
            o("আমাকে একজন টাকা দিয়েছে বসে থাকতে। আমি কিছু জানি না, সত্যি!", "A man paid me to sit here. I know nothing, honestly!"),
          ]);
          await k.talk(guard, [o("ধরা গেল। তুমি না থাকলে আরও কত মানুষ ঠকত।", "Got him. Without you, how many more would have been cheated.")]);
          await k.goOutside(t("বাইরে আসুন", "Come outside"));
        },
      },
    ],
  },
  {
    id: "m08",
    title: t("রাতের কিউআর স্টিকার", "QR stickers by night"),
    blurb: t("মিরপুরের দোকানে দোকানে কিউআরের ওপর ভুয়া স্টিকার। রাতে কে লাগায়?", "Fake stickers are going over the QR codes at Mirpur stalls. Who pastes them at night?"),
    region: MIR,
    start: (k) => {
      const st = uncleStall(k);
      return { x: st.x + 3.5, z: st.z + 2.5 };
    },
    money: 1100,
    rep: 4,
    sense: 2,
    lesson: t("কিউআরে টাকা পাঠানোর আগে নামটা মিলিয়ে নিন, স্টিকার ওপরে লাগানো কিনা দেখুন।", "Before paying by QR, check the name that comes up, and whether a sticker's been stuck on top."),
    stages: [
      {
        run: async (k) => {
          k.g.setHour(21);
          const st = uncleStall(k);
          const uncle = k.person("npc_elder_date", st.x + 1.8, st.z + 1.4, UNCLE);
          k.faceHero(uncle);
          await k.talk(uncle, [
            o("আজ খদ্দের কিউআরে টাকা পাঠাল, আমার কাছে আসেনি। দেখি স্টিকারের নিচে আরেকটা স্টিকার!", "A customer paid by QR today and it never reached me. There's a sticker under the sticker!"),
            h("আশপাশের দোকানগুলো দেখে আসি।", "I'll check the stalls around here."),
          ]);
          for (let i = 0; i < 3; i++) {
            const c = k.cartNear(st, i * 3 + 1);
            await k.doAt(c.x + 1.2, c.z + 1.2, 0.16, t("কিউআর দেখুন", "Check the QR"), t(`দোকানের কিউআর দেখুন (${i + 1}/3)`, `Check the stall's QR (${i + 1}/3)`), 3.4);
            k.note(i === 2 ? t("এখানেও ওপরে নতুন স্টিকার! আঠা এখনও ভেজা।", "Another sticker on top! The glue's still wet.") : t("ওপরে আরেকটা স্টিকার লাগানো।", "One stuck on top of the real one."));
          }
          const p = k.g.player;
          const man = k.person("npc_worker_jackfruit", p.x + 8, p.z + 10, t("স্টিকারওয়ালা", "Sticker man"));
          const end = k.away(320);
          k.walkTo(man, end.x, end.z, 1.9);
          await k.tail(man, t("স্টিকার হাতে লোকটার পিছু নিন", "Follow the man with the stickers"), {
            near: 4,
            far: 60,
            seen: t("সে দেখে ফেলে দৌড় দিল।", "He spotted you and ran."),
            lost: t("গলির ভেতর হারিয়ে গেল।", "He vanished down an alley."),
            done: () => !man.moving,
          });
          await k.photo(man.x, man.z, 0.16, t("স্টিকারের রোল", "the roll of stickers"), t("কাছে গিয়ে ছবি তুলুন", "Go close and take a photo"), 8);
          await k.call("npc_elder_date", UNCLE, [
            h("লোকটা ধানমন্ডির এক ঠিকানা থেকে স্টিকার পায়। রোলের গায়ে লেখা।", "He gets his stickers from an address in Dhanmondi. It's on the roll."),
            o("ধানমন্ডি? ওখানে তো নতুন একটা বৃত্তি অফিসও খুলেছে।", "Dhanmondi? A new scholarship office has opened there as well."),
          ]);
        },
      },
    ],
  },
];
