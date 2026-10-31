import { ENDING } from "../dialogue/tutorial";
import { Kit, h, o, t } from "./kit";
import type { MissionDef } from "./runner";
import { DHA, GUL, MIR, UNCLE, uncleStall } from "./story1";

const atDoor = (kind: "office" | "bank" | "home" | "thana" | "mall" | "clinic", dx = 3) => (k: Kit) => {
  const b = k.inside(kind);
  return { x: b.outX + dx, z: b.outZ + 2 };
};

export const STORY_2: MissionDef[] = [
  {
    id: "m09",
    title: t("ভুয়া বৃত্তি অফিস", "The fake scholarship office"),
    blurb: t("ধানমন্ডিতে বিদেশি বৃত্তির অফিস। ছদ্মবেশে গিয়ে প্রমাণ আনুন।", "A foreign scholarship office in Dhanmondi. Go in disguised and bring out proof."),
    region: DHA,
    start: atDoor("office"),
    money: 1200,
    rep: 3,
    sense: 2,
    lesson: t("আসল বৃত্তিতে আবেদন করতে টাকা লাগে না, আর 'আজই শেষ' বলে না।", "A real scholarship charges no fee to apply, and never says 'today only'."),
    stages: [
      {
        run: async (k) => {
          const b = await k.goInside("office", t("অফিসে ঢুকুন", "Go into the office"));
          const top = b.lift[1] ?? { x: b.x, y: b.y, z: b.z };
          const clerk = k.person("npc_boss_quince", top.x + 2, top.z + 6, t("বৃত্তি পরামর্শক", "Scholarship adviser"), { y: top.y });
          k.faceHero(clerk);
          await k.reachOnFoot(clerk.x, clerk.z, t("বৃত্তি অফিস", "Scholarship office"), t("ওপরের তলায় অফিসে যান", "Go up to the office"), 3, top.y);
          await k.talk(clerk, [
            o("সুইডেনে পুরো বৃত্তি! শুধু প্রসেসিং ফি বিশ হাজার। আজই শেষ দিন।", "A full scholarship to Sweden! Just a twenty thousand processing fee. Today's the last day."),
            h("কাগজগুলো একটু দেখি?", "May I see the papers?"),
            o("দেখেন, দেখেন। আমি ভেতর থেকে ফর্ম নিয়ে আসছি।", "Go ahead. I'll fetch the form from inside."),
          ]);
          k.walk(clerk, [[top.x + 12, top.z + 6]], 1.4);
          await k.photo(top.x - 2, top.z + 5, top.y, t("ভুয়া সিল", "the fake seal"), t("টেবিলের কাগজের ছবি তুলুন", "Photograph the papers on the desk"), 4);
          await k.photo(top.x + 4, top.z + 9, top.y, t("টাকার খাতা", "the money ledger"), t("দেয়ালের পাশের খাতার ছবি তুলুন", "Photograph the ledger by the wall"), 4);
          await k.inspect(t("বৃত্তির চিঠি", "The scholarship letter"), [
            { text: t("প্রিয় আবেদনকারী, ", "Dear applicant, ") },
            { text: t("আপনি নির্বাচিত হয়েছেন", "you have been selected"), flag: t("আবেদন না করেই নির্বাচিত? অসম্ভব।", "Selected without applying? Impossible.") },
            { text: t("। ", ". ") },
            { text: t("প্রসেসিং ফি বিকাশে নয়, ব্যক্তিগত নম্বরে", "Pay the fee to this personal number"), flag: t("প্রতিষ্ঠান ব্যক্তিগত নম্বরে টাকা নেয় না।", "An institution doesn't take money on a personal number.") },
            { text: t(" পাঠান। ", ". ") },
            { text: t("আজ রাত বারোটার মধ্যে", "By midnight tonight"), flag: t("ভাবার সময় কেড়ে নেওয়াই কৌশল।", "Taking away your time to think is the trick.") },
          ], t("চিঠির ফাঁকিগুলোতে চাপ দিন", "Tap the tricks in the letter"));
          await k.goOutside(t("কেউ ফেরার আগে বেরিয়ে পড়ুন", "Get out before anyone's back"));
        },
      },
    ],
  },
  {
    id: "m10",
    title: t("পাসপোর্ট আর বাস", "The passport and the bus"),
    blurb: t("বন্ধু মামুন দালালের হাতে পাসপোর্ট দিতে যাচ্ছে। বাস ছাড়ার আগে পৌঁছান।", "Your friend Mamun is handing his passport to an agent. Get there before the bus leaves."),
    region: DHA,
    start: (k) => k.block("university"),
    money: 1200,
    rep: 4,
    sense: 2,
    lesson: t("পাসপোর্ট কখনো অচেনা দালালের হাতে নয়। সরকারি অফিসে যাচাই করুন।", "Never hand your passport to an unknown agent. Check at the government office."),
    stages: [
      {
        run: async (k) => {
          await k.call("npc_student_lemon", t("মামুন", "Mamun"), [
            o("দোস্ত, দুবাইয়ের ভিসা পেয়ে গেছি! দালাল বলেছে পাসপোর্ট দিয়ে দিলেই হবে।", "Friend, I've got a Dubai visa! The agent says just hand over the passport."),
            h("দাঁড়াও! টাকা দিয়েছ?", "Wait! Have you paid?"),
            o("আশি হাজার। বাস টার্মিনালে দেখা হবে, বাস ছাড়ছে।", "Eighty thousand. Meeting him at the terminal, the bus is leaving."),
          ]);
          const stop = k.block("terminal");
          k.timer(130, t("বাস চলে গেল, পাসপোর্টও গেল।", "The bus has gone, and the passport with it."));
          await k.reach(stop.x, stop.z, t("বাস টার্মিনাল", "Bus terminal"), t("দ্রুত টার্মিনালে যান: যেকোনো বাহন নিন", "Get to the terminal fast: take anything"), 16);
          k.clearTimer();
          if (k.g.player.vehicle) await k.until(() => !k.g.player.vehicle, 0.1);
          const friend = k.person("npc_student_lemon", stop.x + 4, stop.z + 6, t("মামুন", "Mamun"));
          const agent = k.person("npc_boss_quince", stop.x + 6, stop.z + 7, t("দালাল", "Agent"));
          k.faceHero(friend);
          await k.reachOnFoot(friend.x, friend.z, t("মামুন", "Mamun"), t("মামুনের কাছে যান", "Go to Mamun"), 3);
          await k.talk(agent, [o("তাড়াতাড়ি! ভিসা হাতে পেলে কোম্পানির কাছে দিতে হবে। পাসপোর্টটা দিন।", "Hurry! The company needs it as soon as the visa's in. Give me the passport.")]);
          const pick = await k.choose(friend, [t("কোম্পানির নাম আর লাইসেন্স নম্বর চাও", "Ask for the company name and licence number"), t("পাসপোর্টটা দিয়ে দাও, পরে দেখা যাবে", "Give it to him, we'll see later"), t("দালালকে গালি দাও", "Shout abuse at the agent")], 0);
          if (pick === 1) k.fail(t("পাসপোর্ট নিয়ে লোকটা বাসে উঠে গেল।", "He took the passport and got on the bus."));
          await k.talk(agent, [o("লাইসেন্স? ওসব অফিসে আছে। আপনারা থাকেন, আমি আসছি।", "Licence? That's at the office. You stay here, I'll be back.")]);
          k.walk(agent, [[stop.x + 60, stop.z + 40]], 3.4);
          await k.talk(friend, [
            o("আমার আশি হাজার টাকা! মায়ের গয়না বেচে দিয়েছি।", "My eighty thousand! I sold my mother's jewellery."),
            h("পাসপোর্টটা তো বাঁচল। থানায় চলো, লিখিত দাও।", "At least the passport's safe. Come to the police and put it in writing."),
            o("লোকটা বলছিল গুলশানের এক কল সেন্টার সব চালায়।", "He said some call centre in Gulshan runs all of it."),
          ]);
        },
      },
    ],
  },
  {
    id: "m11",
    title: t("লেকের গুজব", "The rumour at the lake"),
    blurb: t("লেকের পাড়ে গুজব ছড়াচ্ছে, ব্যাংকে টাকা থাকবে না। মানুষ আতঙ্কে ছুটছে।", "A rumour at the lake says the banks will fail. People are in a panic."),
    region: DHA,
    start: (k) => k.block("lake"),
    money: 1000,
    rep: 5,
    sense: 2,
    lesson: t("ফরওয়ার্ড করার আগে উৎস দেখুন। ভয় ধরানো বার্তাই সবচেয়ে দ্রুত ছড়ায়।", "Check the source before you forward. Messages that frighten spread fastest."),
    stages: [
      {
        run: async (k) => {
          const s = k.block("lake");
          const first = k.person("npc_woman_apple", s.x + 2, s.z + 2, t("পথচারী", "Passer-by"));
          k.faceHero(first);
          await k.reachOnFoot(first.x, first.z, t("ভিড়", "The crowd"), t("ভিড়ে কী হচ্ছে জানুন", "Find out what the crowd's about"), 3);
          await k.talk(first, [
            o("গ্রুপে এসেছে, কাল সব ব্যাংক বন্ধ! দোকানদার ভাইয়ের কাছে শুনুন, উনিই পাঠিয়েছেন।", "It came on the group, all the banks shut tomorrow! Ask the shopkeeper, he's the one who sent it."),
          ]);
          const p2 = k.away(70);
          const second = k.person("npc_shop_papaya", p2.x, p2.z, t("দোকানদার", "Shopkeeper"));
          k.faceHero(second);
          await k.reachOnFoot(second.x, second.z, t("দোকানদার", "Shopkeeper"), t("দোকানদারকে খুঁজুন", "Find the shopkeeper"), 3);
          await k.talk(second, [o("আমি তো শুধু ফরওয়ার্ড করেছি। আমাকে পাঠিয়েছে কোচিংয়ের ওই ছাত্রটা।", "I only forwarded it. That student from the coaching centre sent it to me.")]);
          const p3 = k.away(90);
          const third = k.person("npc_student_lemon", p3.x, p3.z, t("ছাত্র", "Student"));
          k.faceHero(third);
          await k.reachOnFoot(third.x, third.z, t("ছাত্র", "Student"), t("ছাত্রটাকে খুঁজুন", "Find the student"), 3);
          await k.talk(third, [o("লিঙ্কে একটা খবর ছিল, দেখতে আসল। এই যে।", "There was a news link, it looked real. Here.")]);
          await k.inspect(t("গ্রুপের বার্তা", "The group message"), [
            { text: t("জরুরি!!! ", "URGENT!!! "), flag: t("অতিরিক্ত আতঙ্কের ভাষা।", "Panic language, laid on thick.") },
            { text: t("কাল থেকে সব ব্যাংক বন্ধ। ", "All banks close from tomorrow. ") },
            { text: t("সবাইকে এখনই পাঠান", "Send to everyone now"), flag: t("'সবাইকে পাঠান' বললেই সন্দেহ করুন।", "'Send to everyone' is your cue to doubt it.") },
            { text: t(". বিস্তারিত: ", ". Details: ") },
            { text: t("news-bd24.clikk/bank", "news-bd24.clikk/bank"), flag: t("আসল সংবাদের ঠিকানা এমন হয় না।", "No real news site has an address like this.") },
          ], t("গুজবের লক্ষণে চাপ দিন", "Tap the signs of a rumour"));
          const pick = await k.choose(third, [t("লিঙ্কটা ভুয়া। সবাইকে সত্যিটা জানাও", "The link's fake. Tell everyone the truth"), t("আরও গ্রুপে পাঠাও", "Forward it to more groups"), t("আমার কী, চলে যাই", "Not my problem, I'm leaving")], 0);
          if (pick !== 0) k.fail(t("গুজব থামল না, ব্যাংকে ভিড়ে হুলস্থুল।", "The rumour didn't stop, and the banks were mobbed."));
          await k.reachOnFoot(first.x, first.z, t("ভিড়", "The crowd"), t("ভিড়ে ফিরে সত্যিটা বলুন", "Go back and tell the crowd"), 3);
          await k.talk(first, [
            h("খবরটা ভুয়া। ব্যাংকের নিজের নম্বরে ফোন করে দেখুন।", "It's fake. Ring the bank's own number and see."),
            o("ফোন করলাম, কিছুই বন্ধ হচ্ছে না! ছি, আমিও পাঁচজনকে পাঠিয়েছিলাম।", "I've rung, nothing's closing! Shame, I sent it to five people myself."),
            o("সবাইকে জানিয়ে দিচ্ছি। আপনাকে ধন্যবাদ।", "I'll let them all know. Thank you."),
          ]);
        },
      },
    ],
  },
  {
    id: "m12",
    title: t("হ্যাক হওয়া বন্ধু", "The hacked friend"),
    blurb: t("রাসেলের অ্যাকাউন্ট হ্যাক হয়ে সবার কাছে টাকা চাইছে। তিনজনকে থামান।", "Rasel's account has been hacked and is asking everyone for money. Stop three of them."),
    region: MIR,
    start: (k) => k.block("market"),
    money: 1300,
    rep: 5,
    sense: 2,
    lesson: t("বন্ধু টাকা চাইলে আগে ফোন করে গলা শুনুন। মেসেজে নয়।", "If a friend asks for money, ring and hear their voice first. Not by message."),
    stages: [
      {
        run: async (k) => {
          await k.call("npc_cng_guava", t("রাসেল", "Rasel"), [
            o("আমার অ্যাকাউন্ট হ্যাক হয়ে গেছে! সবার কাছে টাকা চাইছে। তাড়াতাড়ি কিছু করো!", "My account's been hacked! It's asking everyone for money. Do something, quick!"),
            h("কে কে পেয়েছে?", "Who's had it?"),
            o("হাসান, রত্না আর বুড়ো চাচা। ওরা কাছেই আছে, একটু পরেই পাঠিয়ে দেবে।", "Hasan, Ratna and old Uncle. They're nearby, and they'll send it any moment."),
          ]);
          k.timer(190, t("তিনজনই টাকা পাঠিয়ে দিল।", "All three sent the money."));
          const friends: { id: "npc_worker_jackfruit" | "npc_woman_plum" | "npc_elder_date"; name: string; en: string }[] = [
            { id: "npc_worker_jackfruit", name: "হাসান", en: "Hasan" },
            { id: "npc_woman_plum", name: "রত্না", en: "Ratna" },
            { id: "npc_elder_date", name: "বুড়ো চাচা", en: "Old Uncle" },
          ];
          for (let i = 0; i < 3; i++) {
            const f = friends[i];
            const at = k.away(170 + i * 30, 1.1 + i * 2.1);
            const friend = k.person(f.id, at.x, at.z, t(f.name, f.en));
            k.faceHero(friend);
            await k.reachOnFoot(friend.x, friend.z, t(f.name, f.en), t(`${f.name}কে থামান`, `Stop ${f.en}`), 3);
            const pick = await k.choose(friend, [t("পাঠিও না! আগে রাসেলকে ফোন করো", "Don't send it! Ring Rasel first"), t("পাঠিয়ে দাও, বন্ধু বিপদে", "Send it, a friend's in trouble"), t("অর্ধেক পাঠাও", "Send half")], 0);
            if (pick !== 0) k.fail(t("টাকা চলে গেল ঠকবাজের কাছে।", "The money went straight to the scammer."));
            k.note(t("ফোন করে দেখল, রাসেল কিছুই চায়নি!", "They rang him, and Rasel never asked for a thing!"));
          }
          k.clearTimer();
          await k.call("npc_cng_guava", t("রাসেল", "Rasel"), [
            o("তিনজনই বেঁচে গেছে! পাসওয়ার্ড বদলেছি, দুই ধাপের সুরক্ষাও দিয়েছি।", "All three are safe! I've changed my password and turned on two-step security."),
            h("ঠকবাজের নম্বরটা কোথাকার?", "Where's the scammer's number from?"),
            o("শিহাব দেখেছে, গুলশানের একটা অফিসে ব্যবহার হয়।", "Shihab looked, and it's used at an office in Gulshan."),
          ]);
        },
      },
    ],
  },
  {
    id: "m13",
    title: t("কল সেন্টারের ভেতরে", "Inside the call centre"),
    blurb: t("গুলশানের কল সেন্টারে চাকরি নিন। স্ক্রিপ্টের ছবি তুলে সিঁড়ি দিয়ে বেরিয়ে আসুন।", "Get hired at the Gulshan call centre, photograph the scripts, and leave by the stairs."),
    region: GUL,
    start: atDoor("office", -3),
    money: 1800,
    rep: 4,
    sense: 3,
    lesson: t("কথা মুখস্থ করা স্ক্রিপ্টে চলে। প্রশ্ন করলে আটকে যায়, তাই প্রশ্ন করুন।", "They work from memorised scripts and stumble on questions, so ask questions."),
    stages: [
      {
        run: async (k) => {
          const b = await k.goInside("office", t("অফিস টাওয়ারে ঢুকুন", "Go into the office tower"));
          const top = b.lift[b.lift.length - 1] ?? { x: b.x, y: b.y, z: b.z };
          const boss = k.person("npc_boss_quince", top.x + 3, top.z + 4, t("ম্যানেজার", "Manager"), { y: top.y });
          k.faceHero(boss);
          await k.reachOnFoot(boss.x, boss.z, t("কল সেন্টার", "Call centre"), t("সবচেয়ে ওপরের তলায় যান", "Go to the top floor"), 3, top.y);
          await k.talk(boss, [o("চাকরি চান? আমাদের কাজ কাস্টমার সার্ভিস। কথা বলতে পারেন? এই লাইনটা পড়েন।", "Want a job? We do customer service. Can you talk? Read this line.")]);
          const pick = await k.choose(boss, [t("আপনার কার্ড বন্ধ হয়ে যাবে, কোডটা বলুন", "Your card will be blocked, tell me the code"), t("আমি এসব পড়ব না", "I won't read this"), t("পুলিশ ডাকছি", "I'm calling the police")], 0);
          if (pick === 2) k.fail(t("ম্যানেজার সব গুটিয়ে পালিয়ে গেল।", "The manager packed up and fled."));
          if (pick === 1) k.fail(t("চাকরি হলো না। ভেতরে যাওয়া গেল না।", "No job, and no way inside."));
          await k.talk(boss, [o("ভালো গলা। ভেতরে যান, টেবিলে স্ক্রিপ্ট আছে। পাহারাদার ঘুরছে, কাজ ফেলে ঘুরবেন না।", "Good voice. Go in, the scripts are on the desk. The watchman's about, so no wandering.")]);
          const guard = k.person("npc_guard_melon", top.x + 8, top.z + 8, t("পাহারাদার", "Watchman"), { y: top.y });
          let leg = 0;
          const loop: [number, number][] = [[top.x + 8, top.z + 8], [top.x - 6, top.z + 8], [top.x - 6, top.z + 14], [top.x + 8, top.z + 14]];
          const patrol = (): void => {
            leg = (leg + 1) % loop.length;
            k.walk(guard, [loop[leg]], 1.5);
            guard.onArrive = patrol;
          };
          patrol();
          let caught = 0, last = performance.now();
          const stop = k.watch(() => {
            const now = performance.now();
            const dt = (now - last) / 1000;
            last = now;
            const d = Math.hypot(guard.x - k.g.player.x, guard.z - k.g.player.z);
            caught = d < 2.6 ? caught + dt : Math.max(0, caught - dt);
            if (d < 7) k.g.panels.setSignal(1 - d / 7, k.g.talk.active ? "" : "⚠");
            else k.g.panels.setSignal(null);
            return caught > 1.4 ? t("পাহারাদার ধরে ফেলল!", "The watchman caught you!") : null;
          });
          await k.photo(top.x - 2, top.z + 10, top.y, t("ব্যাংক অফিসার স্ক্রিপ্ট", "the bank officer script"), t("পাহারাদারকে এড়িয়ে প্রথম স্ক্রিপ্টের ছবি তুলুন", "Dodge the watchman and photograph the first script"), 2.6);
          await k.photo(top.x + 5, top.z + 11, top.y, t("লটারি স্ক্রিপ্ট", "the lottery script"), t("দ্বিতীয় স্ক্রিপ্টের ছবি তুলুন", "Photograph the second script"), 2.6);
          await k.photo(top.x - 4, top.z + 13, top.y, t("নম্বরের তালিকা", "the list of numbers"), t("নম্বরের তালিকার ছবি তুলুন", "Photograph the list of numbers"), 2.6);
          stop();
          k.g.panels.setSignal(null);
          await k.goOutside(t("সিঁড়ি বা লিফটে নেমে বেরিয়ে পড়ুন", "Down the stairs or lift, and out"));
        },
      },
    ],
  },
  {
    id: "m14",
    title: t("টাকার পথ", "Following the money"),
    blurb: t("চাচার সঞ্চয় উধাও! তিন এজেন্ট ঘুরে টাকার পথ খুঁজুন।", "Uncle's savings are gone! Trace the money through three agents."),
    region: MIR,
    start: (k) => {
      const st = uncleStall(k);
      return { x: st.x + 2.5, z: st.z + 2.5 };
    },
    money: 1500,
    rep: 3,
    sense: 2,
    lesson: t("লেনদেনের নম্বর রাখুন। ওটাই পরে টাকা খোঁজার পথ।", "Keep the transaction number. It's how money gets traced later."),
    stages: [
      {
        region: MIR,
        run: async (k) => {
          const st = uncleStall(k);
          const uncle = k.person("npc_elder_date", st.x + 1.8, st.z + 1.4, UNCLE);
          k.faceHero(uncle);
          await k.talk(uncle, [
            o("সব শেষ। সকালে দেখি ব্যাংকের সঞ্চয়ও নেই। কে একজন ফোন করে আমার নামে তুলে নিয়েছে।", "It's all gone. This morning the savings in the bank were gone too. Someone rang in my name and took it."),
            h("লেনদেনের নম্বরটা দিন। টাকার পথ খুঁজব।", "Give me the transaction number. I'll trace the money."),
            o("এই নাও। প্রথম টাকা গেছে পাশের বাজারের এজেন্টের কাছে।", "Here. First it went to the agent at the market near here."),
          ]);
          const m = k.block("market");
          const agent = k.person("npc_shop_papaya", m.x + 2, m.z + 2, t("এজেন্ট", "Agent"));
          k.faceHero(agent);
          await k.reachOnFoot(agent.x, agent.z, t("প্রথম এজেন্ট", "First agent"), t("বাজারের এজেন্টের কাছে যান", "Go to the agent at the market"), 3);
          await k.talk(agent, [
            o("হ্যাঁ, এই নম্বর আমার খাতায় আছে। এক লোক এসে গুলশানের এজেন্টকে পাঠাতে বলল।", "Yes, that number's in my book. A man came and had it sent to an agent in Gulshan."),
            h("গুলশানে কোথায়?", "Where in Gulshan?"),
            o("মলের পাশে। সেখানে গেলেই চিনবেন।", "By the mall. You'll find it once you're there."),
          ]);
          k.g.life.setFlag("m14a");
        },
      },
      {
        region: GUL,
        run: async (k) => {
          const b = k.inside("mall");
          const agent = k.person("npc_office_orange", b.outX + 5, b.outZ + 3, t("এজেন্ট", "Agent"));
          k.faceHero(agent);
          await k.reachOnFoot(agent.x, agent.z, t("দ্বিতীয় এজেন্ট", "Second agent"), t("গুলশানের মলের পাশের এজেন্টকে খুঁজুন", "Find the agent by the Gulshan mall"), 3);
          await k.talk(agent, [
            o("এই নম্বর? লোকটা নগদ নেয়নি, ধানমন্ডির এক কোচিং সেন্টারের নামে পাঠাল।", "This number? He took no cash, and sent it on in the name of a Dhanmondi coaching centre."),
            h("কোচিং সেন্টার? আগেও ওই নাম শুনেছি।", "A coaching centre? I've heard that name before."),
          ]);
        },
      },
      {
        region: DHA,
        run: async (k) => {
          const c = k.block("coaching");
          const agent = k.person("npc_student_lemon", c.x + 2, c.z + 2, t("কোচিংয়ের কেরানি", "Coaching clerk"));
          k.faceHero(agent);
          await k.reachOnFoot(agent.x, agent.z, t("তৃতীয় এজেন্ট", "Third agent"), t("ধানমন্ডির কোচিং সেন্টারে যান", "Go to the Dhanmondi coaching centre"), 3);
          await k.talk(agent, [
            o("আমার নামে হিসাব খুলে দিয়েছিল বৃত্তির লোকেরা। মাসে হাজার টাকা দেয়। আমি জানতাম না!", "The scholarship people opened an account in my name. A thousand a month. I didn't know!"),
            h("টাকা কোথায় যায়?", "Where does the money go?"),
            o("এক বড় সাহেবের কাছে। গাড়ি নম্বর এই যে। সব গুলশানের কল সেন্টারের।", "To some big boss. Here's his car number. It all belongs to the Gulshan call centre."),
          ]);
          k.note(t("একই চক্র। মোবাইল টাকা, বৃত্তি, কল সেন্টার।", "One ring: mobile money, scholarships, the call centre."));
        },
      },
    ],
  },
  {
    id: "m15",
    title: t("বৃদ্ধের পেনশন", "An old man's pension"),
    blurb: t("ব্যাংকে এক 'সাহায্যকারী' বৃদ্ধদের ফর্ম পূরণ করে দেয়। মতিন সাহেব সন্দেহ করছেন।", "A 'helper' at the bank fills in forms for the elderly. Mr Motin has his doubts."),
    region: GUL,
    start: atDoor("bank"),
    money: 1300,
    rep: 5,
    sense: 2,
    lesson: t("ব্যাংকের ফর্ম কর্মচারী দেখে দেবেন। অচেনা 'সাহায্যকারী'র হাতে কার্ড বা পিন নয়।", "Bank staff will help with forms. Never give a stranger your card or PIN."),
    stages: [
      {
        run: async (k) => {
          const b = await k.goInside("bank", t("ব্যাংকে ঢুকুন", "Go into the bank"));
          const old = k.person("npc_elder_date", b.x + 2, b.z + 6, t("বৃদ্ধ", "Old man"), { y: b.y, pose: "sit_bench" });
          const helper = k.person("npc_commuter_lychee", b.x + 3.4, b.z + 6.6, t("সাহায্যকারী", "Helper"), { y: b.y });
          await k.reachOnFoot(old.x, old.z, t("বৃদ্ধ", "Old man"), t("বেঞ্চের বৃদ্ধের কাছে যান", "Go to the old man on the bench"), 3, b.y);
          await k.talk(helper, [o("চাচা, চোখে দেখেন না তো। পিনটা বলেন, আমি মেশিন থেকে পেনশন তুলে দিচ্ছি।", "You can't see well, sir. Tell me the PIN, and I'll draw your pension at the machine.")]);
          const pick = await k.choose(old, [t("পিন বলবেন না। কাউন্টারে চলুন, আমি সাথে আছি", "Don't tell him. Come to the counter, I'm with you"), t("উনি তো ভালো লোক, পিন বলে দিন", "He's a nice man, tell him"), t("পুলিশে দিন একে এখনই", "Have him arrested right now")], 0);
          if (pick === 1) k.fail(t("পেনশনের টাকা নিয়ে লোকটা হাওয়া।", "The man vanished with the pension."));
          if (pick === 2) {
            await k.talk(helper, [o("কী বলছেন! আমি শুধু উপকার করছিলাম। প্রমাণ কই?", "What's this! I was only helping. Where's your proof?")]);
          }
          await k.talk(old, [
            o("ঠিক বলেছ। এই লোক আগেও দুই মাস আমার টাকা তুলে দিয়েছে, হিসাবে কম দেখি।", "You're right. He's drawn my money for two months, and the account always comes up short."),
            h("কাউন্টারে সব বলুন। স্টেটমেন্ট দেখে নিন।", "Tell the counter everything, and check the statement."),
          ]);
          k.walk(helper, [[b.x, b.z]], 3.4);
          await k.caption(t("কর্মচারী স্টেটমেন্ট বের করলেন। প্রমাণ মিলল।", "The clerk prints the statement. There's the proof."), 3);
          await k.goOutside(t("বাইরে আসুন", "Come outside"));
        },
      },
    ],
  },
  {
    id: "m16",
    title: t("সিম নেই", "No service"),
    blurb: t("হঠাৎ ফোনে সিগন্যাল নেই। কেউ আপনার সিম তুলে নিয়েছে! ফোন আর ম্যাপ ছাড়া দোকান খুঁজুন।", "Your phone's suddenly dead. Someone has swapped your SIM! Find the shop with no phone or map."),
    region: MIR,
    start: (k) => k.block("market", 1),
    money: 1500,
    rep: 3,
    sense: 3,
    lesson: t("হঠাৎ 'নো সার্ভিস' মানে সিম জালিয়াতি হতে পারে। সাথে সাথে কোম্পানির দোকানে যান।", "A sudden 'no service' can mean a SIM swap. Go to the company's shop at once."),
    stages: [
      {
        run: async (k) => {
          k.noPhone(true);
          const stop = k.watch(() => null);
          try {
            await k.caption(t("ফোনে লেখা: কোনো সেবা নেই। ম্যাপও চলছে না!", "The phone says: no service. The map's gone too!"), 3);
            k.timer(210, t("দেরি হয়ে গেল। আপনার হিসাব খালি।", "Too late. Your account's been emptied."));
            const p = k.g.player.position;
            const asks = [k.away(60, 0.6), k.away(190, 2.3)];
            const first = k.person("npc_tea_banana", asks[0].x, asks[0].z, t("পথচারী", "Passer-by"));
            k.faceHero(first);
            k.objective(t("কাউকে জিজ্ঞেস করুন: কাছেই আলোর স্তম্ভের পাশের লোকটা", "Ask someone: the person by the light column nearby"));
            k.light(first.x, first.z);
            await k.until(() => !k.g.player.vehicle && Math.hypot(first.x - k.g.player.x, first.z - k.g.player.z) < 3, 0.1);
            await k.talk(first, [
              h("মোবাইল কোম্পানির দোকান কোনদিকে?", "Which way's the phone company shop?"),
              o("সোজা গিয়ে বড় রাস্তায় উঠে আরেকজনকে জিজ্ঞেস করেন। ওই যে আলোটা দেখা যাচ্ছে।", "Straight on to the main road, and ask again there. See that light?"),
            ]);
            const second = k.person("npc_cng_guava", asks[1].x, asks[1].z, t("সিএনজিওয়ালা", "CNG driver"));
            k.light(second.x, second.z);
            k.objective(t("পরের লোকটার কাছে যান", "Get to the next person"));
            await k.until(() => Math.hypot(second.x - k.g.player.position.x, second.z - k.g.player.position.z) < 4, 0.1);
            if (k.g.player.vehicle) k.moveHero(second.x + 1, second.z + 1);
            k.faceHero(second);
            await k.talk(second, [
              h("কোম্পানির দোকান?", "The company shop?"),
              o("ওই আলোর দিকে। তাড়াতাড়ি যান, বন্ধ করে দেবে।", "Towards that light. Hurry, they'll be shutting."),
            ]);
            const shopAt = k.away(170, p.x > 0 ? -1.2 : 1.2);
            const clerk = k.person("npc_office_orange", shopAt.x, shopAt.z, t("দোকানের কর্মী", "Shop clerk"));
            k.light(clerk.x, clerk.z);
            k.objective(t("দোকানে পৌঁছান", "Reach the shop"));
            await k.until(() => Math.hypot(clerk.x - k.g.player.position.x, clerk.z - k.g.player.position.z) < 4, 0.1);
            if (k.g.player.vehicle) k.moveHero(clerk.x + 1, clerk.z + 1);
            k.clearTimer();
            k.faceHero(clerk);
            await k.talk(clerk, [
              o("আপনার নামে কেউ ফটোকপি দিয়ে নতুন সিম তুলেছে। এখনই বন্ধ করছি। পরিচয়পত্র দিন।", "Someone got a new SIM in your name with a photocopy. I'm blocking it now. Your ID, please."),
              h("ফটোকপি কোথায় পেল?", "Where did they get the photocopy?"),
              o("যেখানে যেখানে ফটোকপি দিয়েছেন তার যেকোনো জায়গা। কপিতে তারিখ আর কাজের নাম লিখে দেবেন।", "Anywhere you've handed one over. Write the date and purpose on your copies."),
            ]);
          } finally {
            stop();
            k.noPhone(false);
          }
          k.note(t("ফোন আবার ফিরে এল। ঠকবাজ এখন আপনার নামও জানে।", "The phone's back. The scammer knows your name now, too."));
        },
      },
    ],
  },
  {
    id: "m17",
    title: t("থানায় অভিযোগ", "Reporting it"),
    blurb: t("যথেষ্ট প্রমাণ জমেছে। থানায় গিয়ে সব দিন, যা বাকি থাকে নিয়ে আসুন।", "You've enough proof. Take it all to the police station, and fetch whatever's missing."),
    region: GUL,
    start: atDoor("thana"),
    money: 1000,
    rep: 6,
    sense: 2,
    lesson: t("অভিযোগে তারিখ, নম্বর, লেনদেনের রসিদ রাখুন। প্রমাণ থাকলে পুলিশ কাজ করতে পারে।", "Keep dates, numbers and receipts when you report it. With proof, the police can act."),
    stages: [
      {
        run: async (k) => {
          const b = await k.goInside("thana", t("থানায় ঢুকুন", "Go into the police station"));
          const officer = k.person("npc_police_coconut", b.x + 1.5, b.z + 6, t("ডিউটি অফিসার", "Duty officer"), { y: b.y });
          k.faceHero(officer);
          await k.reachOnFoot(officer.x, officer.z, t("ডিউটি অফিসার", "Duty officer"), t("অফিসারের সাথে কথা বলুন", "Talk to the officer"), 3, b.y);
          await k.talk(officer, [
            o("বলেন কী সমস্যা। কী কী প্রমাণ এনেছেন?", "Tell me the trouble. What proof have you brought?"),
            h("ছবি, লেনদেনের নম্বর, স্ক্রিপ্ট।", "Photos, transaction numbers, the scripts."),
            o("ভালো। কিন্তু এজেন্টের লিখিত বিবৃতি নেই। ওটা ছাড়া আদালতে টিকবে না।", "Good. But no written statement from the agent. Without that it won't stand in court."),
          ]);
          await k.goOutside(t("বাইরে এসে এজেন্টের কাছে যান", "Go out and find the agent"));
          const near = k.away(200);
          const agent = k.person("npc_office_orange", near.x, near.z, t("এজেন্ট", "Agent"));
          k.faceHero(agent);
          await k.reachOnFoot(agent.x, agent.z, t("এজেন্ট", "Agent"), t("এজেন্টের কাছ থেকে বিবৃতি আনুন", "Get a statement from the agent"), 3);
          await k.talk(agent, [
            o("লিখে দিলে আমার ঝামেলা হবে না তো?", "If I write it, will there be trouble for me?"),
            h("সাক্ষী হলে আপনাকেই রক্ষা করবে। চুপ থাকলে ফাঁসবেন।", "A witness is protected. Staying quiet is what gets you in trouble."),
            o("ঠিক আছে। এই নিন, সই করে দিলাম।", "All right. Here, I've signed it."),
          ]);
          await k.goInside("thana", t("বিবৃতি নিয়ে থানায় ফিরুন", "Take the statement back to the station"));
          const back = k.person("npc_police_coconut", b.x + 1.5, b.z + 6, t("ডিউটি অফিসার", "Duty officer"), { y: b.y });
          k.faceHero(back);
          await k.reachOnFoot(back.x, back.z, t("ডিউটি অফিসার", "Duty officer"), t("অফিসারকে দিন", "Give it to the officer"), 3, b.y);
          await k.talk(back, [
            o("এবার মামলা হবে। কিন্তু হোতাকে ধরতে হলে তার অফিসের লোকেশন নিশ্চিত হতে হবে।", "Now there's a case. But to take the ringleader we need his office location confirmed."),
            o("লোকটাকে ফোনে আটকে রাখতে পারবেন? ফোর্স পৌঁছাতে সময় লাগবে।", "Can you keep him talking on the phone? The force will need time to get there."),
          ]);
          await k.goOutside(t("বাইরে আসুন", "Come outside"));
        },
      },
    ],
  },
  {
    id: "m18",
    title: t("ফোনে আটকে রাখা", "Keep him talking"),
    blurb: t("ঘরে বসে ঠকবাজকে ফোনে আটকে রাখুন, যতক্ষণ না পুলিশ পৌঁছায়।", "From home, keep the scammer on the phone until the police arrive."),
    region: MIR,
    start: atDoor("home"),
    money: 1500,
    rep: 5,
    sense: 3,
    lesson: t("ঠকবাজ তাড়াহুড়ো করে, লোভ বা ভয় দেখায়। সময় নিলেই তার খেলা ভাঙে।", "Scammers rush you with greed or fear. Taking your time is what breaks the game."),
    stages: [
      {
        run: async (k) => {
          const b = await k.goInside("home", t("নিজের ঘরে যান", "Go home"));
          const voice = k.person("npc_boss_quince", 1e4, 1e4, t("ঠকবাজ, ফোনে", "Scammer, on the phone"), { y: b.y });
          const spot = k.person("npc_office_orange", b.x + 2, b.z + 3, t("পুলিশের লোক", "Plainclothes officer"), { y: b.y });
          k.faceHero(spot);
          await k.reachOnFoot(spot.x, spot.z, t("পুলিশের লোক", "Plainclothes officer"), t("পুলিশের লোকের পাশে দাঁড়ান", "Stand by the officer"), 3, b.y);
          await k.talk(spot, [o("নম্বরে ফোন দিন। যত বেশিক্ষণ কথা বলবেন, লোকেশন তত পাকা হবে। সে কেটে দিলে সব শেষ।", "Ring the number. The longer you talk, the firmer the location. If he hangs up, it's over.")]);
          let patience = 3;
          const rounds: { say: readonly ["o", readonly [string, string]][]; options: readonly (readonly [string, string])[] ; right: number }[] = [
            { say: [["o", ["আমি ব্যাংকের কর্মকর্তা বলছি। আপনার কার্ড বন্ধ হচ্ছে, তাড়াতাড়ি কোড বলুন।", "This is a bank officer. Your card's being blocked, give me the code quickly."]]], options: [t("কোন শাখা থেকে বলছেন? একটু ধরুন, চশমা খুঁজি", "Which branch? Hold on while I find my glasses"), t("তুমি ঠকবাজ, জানি!", "You're a scammer, I know it!"), t("কোডটা নিন", "Here's the code")], right: 0 },
            { say: [["o", ["শাখা গুলশান। চশমা পরে কোডটা পড়েন।", "Gulshan branch. Put your glasses on and read the code."]]], options: [t("অনেক কোড এসেছে, কোনটা? প্রথমটা না শেষেরটা?", "Lots of codes have come, which one? First or last?"), t("পরে ফোন করব", "I'll ring you later"), t("পুলিশ আসছে!", "The police are coming!")], right: 0 },
            { say: [["o", ["শেষেরটা। ছয় সংখ্যা। তাড়াতাড়ি করেন, সময় নেই।", "The last one, six digits. Hurry, there's no time."]]], options: [t("সংখ্যাগুলো ঝাপসা। আপনার নামটা আবার বলুন, লিখে রাখি", "The digits are blurred. Tell me your name again, I'll write it down"), t("ভুয়া কোড বলে দিই", "Read him a made-up code"), t("ফোন কেটে দিই", "Hang up")], right: 0 },
            { say: [["o", ["রফিক সাহেব। আপনার কি মাথা ঠিক আছে? কোডটা বলেন!", "Mr Rafiq. Are you in your right mind? The code!"]]], options: [t("ছেলে ডাকছে, একটু ধরেন। আপনি ধরে থাকবেন তো?", "My son's calling, hold on. You'll hold, won't you?"), t("আপনি রফিক না, ঠকবাজ", "You're no Rafiq, you're a crook"), t("কত টাকা আছে আমার হিসাবে?", "How much is in my account?")], right: 0 },
            { say: [["o", ["ধরে আছি। কিন্তু তাড়াতাড়ি। আমার ওপরে স্যারের চাপ আছে।", "I'm holding, but hurry. My boss is on my back."]]], options: [t("স্যার? তিনিও কি ব্যাংকের? ওনাকে ধরিয়ে দেন", "Your boss? Is he at the bank too? Put him on"), t("আমি ক্লান্ত, রাখি", "I'm tired, goodbye"), t("সব জানি তোমাদের!", "I know all about you lot!")], right: 0 },
          ];
          for (const round of rounds) {
            await k.talk(voice, round.say);
            const pick = await k.choose(voice, round.options, round.right);
            if (pick !== round.right) {
              patience--;
              if (patience > 0) await k.talk(voice, [o("কী আজেবাজে বলছেন! কথা শোনেন।", "What rubbish is this! Listen to me.")]);
            }
            if (patience <= 0) k.fail(t("সে ফোন কেটে দিল। লোকেশন পাওয়া গেল না।", "He hung up. No location."));
          }
          await k.talk(voice, [o("আরে, দরজায় কে? এই, তোমরা কারা! স্যার পালাচ্ছে!", "Hey, who's at the door? You there, who are you! The boss is running!")]);
          await k.talk(spot, [o("পেয়ে গেছি! কিন্তু হোতা গাড়ি নিয়ে পালিয়েছে, গুলশানের দিকে।", "Got them! But the ringleader's away in a car, towards Gulshan.")]);
          await k.goOutside(t("বাইরে আসুন", "Come outside"));
        },
      },
    ],
  },
  {
    id: "m19",
    title: t("হোতার গাড়ি", "The ringleader's car"),
    blurb: t("হোতা পালাচ্ছে। গাড়ির পিছু নিয়ে পুলিশকে পথ দেখান। কোনো মারামারি নয়।", "The ringleader's running. Follow his car and guide the police. No fighting."),
    region: GUL,
    start: (k) => k.block("towers"),
    money: 2500,
    rep: 6,
    sense: 2,
    stages: [
      {
        run: async (k) => {
          await k.call("npc_police_coconut", t("ডিউটি অফিসার", "Duty officer"), [
            o("সাদা গাড়িটা আপনার কাছেই। পিছু নিন, ধরার চেষ্টা করবেন না। শুধু আমাদের জানান।", "The white car's near you. Follow it, but don't try to stop it. Just keep us told."),
            h("দেখতে পাচ্ছি।", "I can see it."),
          ]);
          const p = k.g.player.position;
          const car = k.car("car_sedan", p, 110);
          if (!car) return;
          const legs = [k.away(420, 0.4), k.away(620, 2.4), k.away(500, 4.4)];
          let leg = 0;
          k.send(car, legs[0].x, legs[0].z);
          const spots = [t("গাড়িটা উত্তরে যাচ্ছে।", "The car's heading north."), t("মোড় ঘুরেছে, এখনও পিছু আছি।", "It's turned, I'm still behind."), t("পুলিশ সামনে থেকে আসছে!", "The police are coming from ahead!")];
          await k.tail(car, t("সাদা গাড়ির পিছু নিন, হারাবেন না", "Stay behind the white car, don't lose it"), {
            near: 6,
            far: 210,
            seen: t("সে টের পেয়ে অন্য পথে পালাল।", "He noticed, and got away another way."),
            lost: t("গাড়িটা ট্রাফিকে হারিয়ে গেল।", "The car's gone in the traffic."),
            done: () => {
              if (k.distOf(car, legs[leg].x, legs[leg].z) < 30) {
                k.note(spots[leg]);
                leg++;
                if (leg >= legs.length) return true;
                k.send(car, legs[leg].x, legs[leg].z);
              }
              return false;
            },
          });
          car.holdTime = 999;
          const at = { x: car.x + 4, z: car.z + 4 };
          const officer = k.person("npc_police_coconut", at.x, at.z, t("পুলিশ অফিসার", "Police officer"));
          const boss = k.person("npc_boss_quince", at.x + 2, at.z + 1, t("হোতা", "Ringleader"));
          await k.reachOnFoot(officer.x, officer.z, t("পুলিশ", "Police"), t("গাড়ি থেকে নেমে পুলিশের কাছে যান", "Get out and go to the police"), 5);
          k.faceHero(officer);
          await k.talk(boss, [o("আমি ব্যবসায়ী মানুষ! আমি কিছু জানি না। আমার উকিলকে ডাকেন।", "I'm a businessman! I know nothing. Call my lawyer.")]);
          await k.talk(officer, [
            o("প্রমাণ সব আছে। ছবি, স্ক্রিপ্ট, বিবৃতি। উনি যা করার করেছেন, আদালত বুঝবে।", "All the proof's here. Photos, scripts, statements. The court will see to him."),
            h("চাচার টাকা ফেরত পাওয়া যাবে?", "Will Uncle's money come back?"),
            o("ফ্রিজ করা হিসাবে সবই আছে। স্টেডিয়ামের সচেতনতা অনুষ্ঠানে চেক দেওয়া হবে। আপনিও আসবেন।", "It's all in the frozen accounts. The cheques go out at the awareness event at the stadium. You'll come too."),
          ]);
        },
      },
    ],
  },
  {
    id: "m20",
    title: t("স্টেডিয়ামের দিন", "The day at the stadium"),
    blurb: t("স্টেডিয়ামে সবার সামনে যা শিখেছেন বলুন। চাচা সঞ্চয় ফিরে পাবেন।", "Tell everyone at the stadium what you've learnt. Uncle gets his savings back."),
    region: MIR,
    start: (k) => k.block("stadium"),
    money: 5000,
    rep: 15,
    sense: 3,
    lesson: t("নিজে সাবধান হন, পাশের জনকেও বলুন। ঠকবাজি লজ্জার নয়, চুপ থাকাটাই ক্ষতির।", "Be careful, and tell the person next to you. Being cheated is no shame; keeping quiet is the harm."),
    stages: [
      {
        run: async (k) => {
          const s = k.block("stadium");
          const uncle = k.person("npc_elder_date", s.x, s.z + 3, UNCLE);
          k.faceHero(uncle);
          for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI;
            const who = k.person(i % 3 === 0 ? "npc_student_lemon" : i % 3 === 1 ? "npc_woman_peach" : "npc_commuter_lychee", s.x + Math.cos(a) * 9, s.z + 3 + Math.sin(a) * 7, t("দর্শক", "Crowd"), { pose: i % 4 ? "stand" : "cheer" });
            who.who.yaw = Math.atan2(s.x - who.x, s.z + 3 - who.z);
          }
          await k.reachOnFoot(uncle.x, uncle.z, UNCLE, t("মঞ্চে চাচার পাশে দাঁড়ান", "Stand by Uncle on the stage"), 4);
          await k.talk(uncle, [
            o("আজ তোমার কথা সবাই শুনবে। মানুষ প্রশ্ন করবে, তুমি উত্তর দাও।", "Today they'll all hear you. People will ask, and you answer."),
          ]);
          const quiz: { q: readonly [string, string]; options: (readonly [string, string])[] }[] = [
            { q: ["ফোনে কেউ ব্যাংকের নামে কোড চাইলে কী করব?", "Someone from 'the bank' wants a code on the phone. What do I do?"], options: [t("ফোন কেটে কার্ডের পেছনের নম্বরে নিজে ফোন করুন", "Hang up and ring the number on your card yourself"), t("কোড বলে দিন", "Give the code"), t("অর্ধেকটা বলুন", "Give half")] },
            { q: ["খদ্দের টাকা পাঠানোর এসএমএস দেখালে?", "A customer shows me a message saying they've paid?"], options: [t("নিজের ফোনে ব্যালান্স দেখে মাল দিন", "Check your own balance before you hand anything over"), t("মেসেজ দেখলেই যথেষ্ট", "The message is enough"), t("পরে দেখে নেবেন", "Check later")] },
            { q: ["বন্ধু মেসেজে হঠাৎ টাকা চাইলে?", "A friend suddenly asks for money by message?"], options: [t("আগে ফোন করে গলা শুনুন", "Ring them and hear their voice first"), t("সাথে সাথে পাঠান", "Send it straight away"), t("গ্রুপে পোস্ট দিন", "Post about it in the group")] },
          ];
          for (const q of quiz) {
            await k.talk(uncle, [["o", q.q]]);
            const pick = await k.choose(uncle, q.options, 0);
            if (pick === 0) k.score++;
            await k.talk(uncle, [pick === 0 ? o("সবাই হাততালি দিচ্ছে! ঠিক বলেছ।", "They're all clapping! You've got it right.") : o("একটু ভেবে দেখো। আসল উত্তর হলো, নিজে যাচাই করা।", "Think again. The real answer is: check for yourself.")]);
          }
          await k.talk(uncle, ENDING.lines.map((l) => ["o", l] as const));
          await k.caption(t("পুলিশের অফিসার চাচার হাতে চেক দিলেন।", "The officer hands Uncle the cheque."), 3);
          k.g.openOverlay();
          k.g.panels.showCredits(ENDING.credits);
        },
      },
    ],
  },
];
