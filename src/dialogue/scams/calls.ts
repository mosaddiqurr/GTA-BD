import type { Scam } from "../types";
import { CALLS2 } from "./calls2";

/** Scam phone calls, the first twelve here and the rest in calls2.ts. CALLS holds all of them. */
export const CALLS: Scam[] = [
  {
    key: "call_care_otp",
    kind: "call",
    from: ["+880 1712 00385", "+880 1712 00385"],
    nodes: {
      start: {
        who: "o",
        say: ["আসসালামু আলাইকুম। ঝটপট টাকা হেল্পলাইন থেকে বলছি। আপনার অ্যাকাউন্টে একটা সমস্যা ধরা পড়েছে।", "Assalamu alaikum. This is the Jhotpot Taka helpline. We've found a problem with your account."],
        options: [
          { text: ["কী সমস্যা?", "What problem?"], go: "problem" },
          { text: ["হেল্পলাইন মোবাইল নম্বর থেকে ফোন করে?", "A helpline ringing from a mobile number?"], go: "number" },
          { text: ["আমি ব্যস্ত, রাখছি।", "I'm busy, goodbye."], out: { sense: 1, lesson: ["অচেনা ফোনে অ্যাকাউন্টের কথা শুনলে কেটে দেওয়াই নিরাপদ। ব্যালান্স নিজে অ্যাপে দেখে নিন।", "When a strange caller talks about your account, hanging up is safest. Check your balance in the app yourself."] } },
        ],
      },
      problem: {
        who: "o",
        say: ["আজ রাত বারোটায় অ্যাকাউন্টটা বন্ধ হয়ে যাবে। এখনই যাচাই করলে কোনো ঝামেলা থাকবে না।", "Your account closes at midnight tonight. Verify it now and there'll be no trouble."],
        options: [
          { text: ["কীভাবে যাচাই করব?", "How do I verify it?"], go: "code" },
          { text: ["আমি দোকানে গিয়ে করে নেব।", "I'll do it at the shop."], go: "stall" },
        ],
      },
      number: {
        who: "o",
        say: ["এটা আমাদের অফিসের বিশেষ নম্বর। কিন্তু সময় নেই, অ্যাকাউন্ট আজ রাতেই বন্ধ হবে।", "This is our office's special number. But there's no time, your account closes tonight."],
        options: [
          { text: ["আসল হেল্পলাইনে নিজেই ফোন করছি।", "I'll ring the real helpline myself."], go: "caught" },
          { text: ["তাহলে কী করতে হবে?", "Then what do I have to do?"], go: "code" },
        ],
      },
      stall: {
        who: "o",
        say: ["দোকানে যেতে যেতে বন্ধ হয়ে যাবে! ফোনে দুই মিনিটের কাজ, আমি নিজে করে দিচ্ছি।", "It'll be closed before you reach the shop! It's two minutes by phone, I'll do it for you."],
        options: [
          { text: ["আচ্ছা, বলুন কী করব।", "All right, tell me what to do."], go: "code" },
          { text: ["বন্ধ হলে দোকানেই খুলব।", "If it closes, I'll open it at the shop."], go: "caught" },
        ],
      },
      code: {
        who: "o",
        say: ["এইমাত্র আপনার ফোনে ছয় সংখ্যার একটা ওটিপি গেছে। ওটা একটু বলুন, মিলিয়ে নিই।", "A six digit OTP just went to your phone. Read it to me so I can match it."],
        options: [
          { text: ["বলছি, লিখে নিন।", "I'll read it, write it down."], go: "lost" },
          { text: ["মেসেজে তো লেখা, কাউকে বলবেন না।", "The message says never to tell anyone."], go: "warned" },
        ],
      },
      warned: {
        who: "o",
        say: ["ওটা সাধারণ মানুষের জন্য লেখা। আমি তো কোম্পানির লোক, আমাকে বললে সমস্যা নেই।", "That's written for the general public. I'm from the company, telling me is fine."],
        options: [
          { text: ["ও আচ্ছা, বলছি।", "Oh, all right, I'll read it."], go: "lost" },
          { text: ["কোম্পানির লোক হলে কোড লাগে না।", "Company staff wouldn't need my code."], go: "caught" },
        ],
      },
      lost: {
        who: "o",
        say: ["ধন্যবাদ, মিলে গেছে। একটু লাইনে থাকুন, কেটে যাবেন না।", "Thank you, it matches. Stay on the line a moment, don't hang up."],
        out: {
          mobile: -2500,
          sense: 1,
          later: "later_sucker_list",
          lesson: ["ওটিপি দেওয়া মানে টাকা তোলার চাবি দেওয়া। আসল হেল্পলাইন কখনো কোড চায় না।", "Giving your OTP hands over the key to your money. A real helpline never asks for a code."],
        },
      },
      caught: {
        who: "o",
        say: ["ঠিক আছে, পরে কিছু হলে আমাদের দোষ দেবেন না।", "Fine. If anything happens later, don't blame us."],
        out: {
          sense: 3,
          lesson: ["আসল হেল্পলাইন কোড চায় না, ভয়ও দেখায় না। সন্দেহ হলে কোম্পানির নম্বরে নিজে ফোন করুন।", "A real helpline asks for no code and doesn't scare you. If in doubt, ring the company's number yourself."],
        },
      },
    },
  },
  {
    key: "call_care_pin_upgrade",
    kind: "call",
    from: ["ঝটপট টাকা সার্ভিস সেন্টার", "Jhotpot Taka Service Centre"],
    nodes: {
      start: {
        who: "o",
        say: ["ঝটপট টাকা সার্ভিস সেন্টার থেকে বলছি। আজ সবার অ্যাকাউন্ট নতুন সিস্টেমে যাচ্ছে, আপনারটা বাকি।", "This is the Jhotpot Taka service centre. Everyone's account moves to a new system today, and yours is left."],
        options: [
          { text: ["তাতে আমার কী করতে হবে?", "What do I have to do?"], go: "need" },
          { text: ["রেকর্ডে আমার নাম কী আছে বলুন তো?", "What name do your records show for me?"], go: "name" },
          { text: ["আমি অ্যাপে দেখে নেব।", "I'll look in the app."], out: { sense: 2, lesson: ["আপডেট হলে অ্যাপেই দেখা যায়। ফোনে পিন চাওয়ার কোনো নিয়ম নেই।", "Any update shows in the app itself. No rule ever requires your PIN by phone."] } },
        ],
      },
      need: {
        who: "o",
        say: ["আপনার পিনটা নতুন সিস্টেমে বসাতে হবে। না করলে ব্যালান্স শূন্য হয়ে যেতে পারে।", "Your PIN must be entered into the new system. If not, your balance could drop to zero."],
        options: [
          { text: ["পিন বলতে হবে? আচ্ছা।", "I have to say my PIN? All right."], go: "lost" },
          { text: ["এজেন্টের দোকানে গিয়ে করি?", "Can I do it at an agent's shop?"], go: "agent" },
          { text: ["পিন তো গোপন রাখতে বলা হয়।", "We're told to keep our PIN secret."], go: "secret" },
        ],
      },
      name: {
        who: "o",
        say: ["নাম আছে, কিন্তু নিরাপত্তার জন্য ফোনে বলা যায় না। আপনিই আগে পিন দিয়ে নিশ্চিত করুন।", "It's there, but for security I can't say it by phone. You confirm with your PIN first."],
        options: [
          { text: ["আমার নামই জানেন না, আবার পিন চান!", "You don't know my name, yet you want my PIN!"], go: "caught" },
          { text: ["আচ্ছা, পিন বলছি।", "All right, I'll say my PIN."], go: "lost" },
        ],
      },
      agent: {
        who: "o",
        say: ["এজেন্টরা এই আপডেট জানে না। আজকের পর পুরোনো অ্যাকাউন্টের টাকা আর তোলা যাবে না।", "Agents don't know about this update. After today, money in old accounts can't be withdrawn."],
        options: [
          { text: ["তাহলে বলে দিচ্ছি।", "Then I'll tell you."], go: "lost" },
          { text: ["তবু আমি নিজে দেখে নেব।", "Still, I'll check for myself."], go: "caught" },
        ],
      },
      secret: {
        who: "o",
        say: ["গোপন তো অন্যদের কাছে। আমি কোম্পানির কর্মকর্তা, আমার কাছে সব তথ্য নিরাপদ।", "Secret from others, yes. I'm a company officer, your details are safe with me."],
        options: [
          { text: ["কোম্পানি হলে পিন জানা লাগে কেন?", "If you're the company, why do you need it?"], go: "caught" },
          { text: ["ঠিক আছে, বলছি।", "All right, I'll tell you."], go: "lost" },
        ],
      },
      lost: {
        who: "o",
        say: ["ধন্যবাদ, আপডেট শুরু হলো। দশ মিনিট ফোনে কোনো মেসেজ খুলবেন না।", "Thank you, the update has begun. Don't open any messages for ten minutes."],
        out: {
          mobile: -4000,
          sense: 1,
          later: "later_recovery_agent",
          lesson: ["পিন জানলে সব টাকা তুলে নেওয়া যায়। কোম্পানির কারো আপনার পিন জানার দরকারই নেই।", "With your PIN anyone can take all your money. Nobody at the company ever needs to know it."],
        },
      },
      caught: {
        who: "o",
        say: ["আপনি বুঝতে পারছেন না। পরে টাকা গেলে আমাদের দোষ দেবেন না।", "You don't understand. If your money goes later, don't blame us."],
        out: {
          sense: 3,
          lesson: ["পিন চাওয়া আর সময়ের ভয় দেখানোই ধরিয়ে দিল। পিন শুধু আপনি জানবেন, আর কেউ নয়।", "Asking for your PIN and rushing you gave it away. Only you should ever know your PIN."],
        },
      },
    },
  },
  {
    key: "call_fake_received",
    kind: "call",
    from: ["+880 1711 00529", "+880 1711 00529"],
    nodes: {
      start: {
        who: "o",
        say: ["দয়া করে একটু শুনুন। ভুল করে আপনার নম্বরে দুই হাজার টাকা চলে গেছে। মেসেজ পেয়েছেন নিশ্চয়ই?", "Please, just listen. By mistake 2,000 taka went to your number. You must have got the message?"],
        options: [
          { text: ["হ্যাঁ, একটা মেসেজ এসেছে।", "Yes, a message came."], go: "msg" },
          { text: ["দাঁড়ান, ব্যালান্স দেখে নিই।", "Wait, let me check my balance."], go: "balance" },
          { text: ["আমি কিছু জানি না।", "I don't know anything about it."], go: "know" },
        ],
      },
      msg: {
        who: "o",
        say: ["ওটা আমার পরিবারের ওষুধের টাকা। একটু ফেরত পাঠিয়ে দিন, খুব উপকার হবে।", "That's my family's medicine money. Please send it back, it would be a great help."],
        options: [
          { text: ["আহা, পাঠিয়ে দিচ্ছি।", "Oh dear, I'll send it now."], go: "lost" },
          { text: ["আগে ব্যালান্সটা দেখি।", "Let me check my balance first."], go: "balance" },
        ],
      },
      balance: {
        who: "o",
        say: ["নেটওয়ার্ক খারাপ, দেখতে দেরি হবে। মেসেজ তো এসেছেই, ওটাই যথেষ্ট প্রমাণ।", "The network's bad, checking will take ages. The message came, that's proof enough."],
        options: [
          { text: ["ব্যালান্সে তো টাকা বাড়েনি!", "My balance hasn't gone up!"], go: "caught" },
          { text: ["ঠিক আছে, পাঠাই।", "All right, I'll send it."], go: "lost" },
        ],
      },
      know: {
        who: "o",
        say: ["এমন বলবেন না, টাকাটা না পেলে বিপদে পড়ব। অভিযোগ করলে আপনার অ্যাকাউন্টও আটকে যাবে।", "Don't say that, I'm in trouble without it. If I complain, your account gets frozen too."],
        options: [
          { text: ["অভিযোগ করুন, হেল্পলাইন দেখবে।", "Go ahead and complain, the helpline can look."], go: "caught" },
          { text: ["আচ্ছা, কী মেসেজ বলছেন?", "All right, what message do you mean?"], go: "msg" },
        ],
      },
      lost: {
        who: "o",
        say: ["অনেক ধন্যবাদ, আপনার মতো মানুষ হয় না। রাখছি।", "Thank you so much, there's nobody like you. Goodbye."],
        out: {
          mobile: -2000,
          sense: 1,
          later: "later_sucker_list",
          lesson: ["এসএমএস যে কেউ বানাতে পারে। টাকা সত্যি এলে নিজের ব্যালান্সেই দেখা যেত।", "Anyone can fake an SMS. If the money had really come, it would show in your own balance."],
        },
      },
      caught: {
        who: "o",
        say: ["ধুর, নম্বরটাই ভুল মনে হচ্ছে।", "Bah, I must have the wrong number."],
        out: {
          sense: 3,
          lesson: ["মেসেজ নয়, নিজের ব্যালান্সই আসল প্রমাণ। টাকা না বাড়লে ফেরত পাঠানোর কিছু নেই।", "Your own balance is the proof, not a message. If it hasn't risen, there's nothing to send back."],
        },
      },
    },
  },
  {
    key: "call_bank_card_blocked",
    kind: "call",
    from: ["ব্যাংক হেল্প ডেস্ক", "Bank Help Desk"],
    nodes: {
      start: {
        who: "o",
        say: ["আপনার ব্যাংকের হেল্প ডেস্ক থেকে বলছি। সন্দেহজনক লেনদেনের কারণে আপনার কার্ড বন্ধ হয়ে গেছে।", "This is your bank's help desk. Your card has been blocked because of a suspicious transaction."],
        options: [
          { text: ["কীভাবে খুলব?", "How do I unblock it?"], go: "open" },
          { text: ["কোন শাখা থেকে বলছেন?", "Which branch are you calling from?"], go: "branch" },
          { text: ["কার্ডের পেছনের নম্বরে ফোন করছি।", "I'll ring the number on the back of the card."], go: "back" },
        ],
      },
      open: {
        who: "o",
        say: ["কার্ডের ওপরের ষোলো সংখ্যাটা বলুন। আমি পরীক্ষা করে এখনই খুলে দিচ্ছি।", "Read me the sixteen digits on the card. I'll check and unblock it right away."],
        options: [
          { text: ["বলছি, লিখে নিন।", "I'll read them, write them down."], go: "cvv" },
          { text: ["কাল ব্যাংকে গিয়ে খুলি?", "Could I unblock it at the bank tomorrow?"], go: "stall" },
          { text: ["পেছনের নম্বরে নিজে ফোন করব।", "I'll ring the number on the back myself."], go: "back" },
        ],
      },
      branch: {
        who: "o",
        say: ["আমরা কেন্দ্রীয় হেল্প ডেস্ক, সব শাখার কাজ এখান থেকেই হয়। এখন কার্ড নম্বরটা বলুন।", "We're the central help desk, all branches run through us. Now read me the card number."],
        options: [
          { text: ["আগে আমার নাম আর শেষ চার সংখ্যা বলুন।", "First you tell me my name and last four digits."], go: "testit" },
          { text: ["আচ্ছা, নম্বরটা বলছি।", "All right, I'll read the number."], go: "cvv" },
        ],
      },
      testit: {
        who: "o",
        say: ["সিস্টেম বন্ধ আছে বলেই তো দেখতে পাচ্ছি না। তাড়াতাড়ি করুন, লাইনে আরও লোক আছে।", "I can't see that because the system's down. Hurry up, others are waiting."],
        options: [
          { text: ["সিস্টেম বন্ধ হলে খুলবেন কীভাবে?", "If it's down, how will you unblock it?"], go: "caught" },
          { text: ["ঠিক আছে, বলছি।", "All right, I'll read it."], go: "cvv" },
        ],
      },
      stall: {
        who: "o",
        say: ["কাল পর্যন্ত এভাবে থাকলে সব টাকা চলে যেতে পারে। আমি আপনার ভালোর জন্যই বলছি।", "Left like this till tomorrow, all your money could go. I'm saying this for your own good."],
        options: [
          { text: ["তাহলে নম্বরটা বলে দিই।", "Then I'll read the number."], go: "cvv" },
          { text: ["তবু পেছনের নম্বরে ফোন করব।", "Still, I'll ring the number on the back."], go: "back" },
        ],
      },
      cvv: {
        who: "o",
        say: ["ধন্যবাদ। এখন পেছনের তিন সংখ্যা আর ফোনে আসা কোডটা বলুন, ব্যস শেষ।", "Thank you. Now the three digits on the back and the code on your phone, and we're done."],
        options: [
          { text: ["বলছি।", "I'll read them."], go: "lost" },
          { text: ["কোড তো কাউকে দিতে মানা।", "We're told never to give that code."], go: "back" },
        ],
      },
      lost: {
        who: "o",
        say: ["হয়ে গেছে, কার্ড এখন পুরোপুরি সচল। আমাদের সাথে থাকার জন্য ধন্যবাদ।", "Done, the card is fully active now. Thank you for staying with us."],
        out: {
          money: -3500,
          sense: 1,
          later: "later_bank_second_call",
          lesson: ["আসল ব্যাংক কার্ডের নম্বর আর কোড কখনো চায় না। সন্দেহ হলে পেছনের নম্বরে ফোন করুন।", "A real bank never asks for your card number or code. If in doubt, ring the number on the back."],
        },
      },
      back: {
        who: "h",
        say: ["কার্ডের পেছনের নম্বরে ফোন করলাম। ব্যাংক বলল, কার্ড ঠিকই আছে।", "I rang the number on the back of the card. The bank says the card is fine."],
        out: {
          sense: 3,
          lesson: ["কার্ডের পেছনের নম্বরটাই আসল ব্যাংক। যে ফোন করেছে তাকে নয়, ওই নম্বরকে বিশ্বাস করুন।", "The number on the back of the card is the real bank. Trust that, not whoever rang you."],
        },
      },
      caught: {
        who: "o",
        say: ["বেশি বোঝেন দেখছি। ঠিক আছে, কার্ড বন্ধই থাকুক।", "You think you know a lot. Fine, let the card stay blocked."],
        out: {
          sense: 3,
          lesson: ["যে আপনার নামই জানে না, সে আপনার ব্যাংক নয়। একটা প্রশ্নেই তার গল্প ভেঙে গেল।", "Someone who doesn't know your name isn't your bank. One question broke the whole story."],
        },
      },
    },
  },
  {
    key: "call_prize_company",
    kind: "call",
    from: ["লাকি ড্র বিভাগ", "Lucky Draw Department"],
    nodes: {
      start: {
        who: "o",
        say: ["অভিনন্দন! আপনার মোবাইল কোম্পানির বার্ষিকী লাকি ড্রতে আপনার নম্বর পাঁচ লাখ টাকা জিতেছে!", "Congratulations! Your number has won five lakh taka in your mobile company's anniversary draw!"],
        options: [
          { text: ["সত্যি! কী করতে হবে?", "Really! What do I have to do?"], go: "claim" },
          { text: ["আমি তো কোনো লটারিতে নাম দিইনি।", "But I never entered any lottery."], go: "noentry" },
          { text: ["রাখছি, ধন্যবাদ।", "Goodbye, thanks."], out: { sense: 1, lesson: ["যে খেলায় নামেননি তাতে জেতা যায় না। এমন ফোন কেটে দেওয়াই ঠিক।", "You can't win a game you never entered. Hanging up on a call like this is right."] } },
        ],
      },
      claim: {
        who: "o",
        say: ["পুরস্কার ছাড়াতে সরকারি কর আড়াই হাজার টাকা আগে জমা দিতে হবে। আজ বিকেল পাঁচটা পর্যন্ত সময়।", "To release the prize, 2,500 taka of government tax must be paid first. You have until five today."],
        options: [
          { text: ["পাঠিয়ে দিই।", "I'll send it."], go: "lost" },
          { text: ["পুরস্কার থেকে কেটে নিন।", "Take it out of the prize."], go: "deduct" },
          { text: ["কোম্পানির দোকানে গিয়ে নেব।", "I'll collect it at the company's shop."], go: "shop" },
        ],
      },
      noentry: {
        who: "o",
        say: ["নাম দিতে হয় না, কোম্পানি নিজেই নম্বর বাছাই করে। এমন সুযোগ জীবনে একবার আসে।", "You don't enter, the company picks the numbers itself. A chance like this comes once in a lifetime."],
        options: [
          { text: ["তাহলে কী করব?", "Then what do I do?"], go: "claim" },
          { text: ["কোম্পানির দোকানে গিয়ে নেব।", "I'll collect it at the company's shop."], go: "shop" },
        ],
      },
      deduct: {
        who: "o",
        say: ["নিয়ম নেই, কর আলাদা দিতে হয়। এখনই না দিলে পুরস্কার অন্যজনের নামে চলে যাবে।", "Not allowed, tax is paid separately. Don't pay now and the prize goes to someone else."],
        options: [
          { text: ["হারাতে চাই না, দিচ্ছি।", "I don't want to lose it, I'll pay."], go: "lost" },
          { text: ["যাক, আমার দরকার নেই।", "Let it go, I don't need it."], go: "caught" },
        ],
      },
      shop: {
        who: "o",
        say: ["দোকানে এই খবর নেই, এটা গোপন প্রচারণা। কাউকে বললে পুরস্কার বাতিল হবে, মনে রাখবেন।", "The shops don't know, it's a secret campaign. Tell anyone and the prize is cancelled, remember that."],
        options: [
          { text: ["গোপন পুরস্কার হয় না। রাখছি।", "There's no such thing as a secret prize. Goodbye."], go: "caught" },
          { text: ["আচ্ছা, কাউকে বলব না। দিচ্ছি।", "All right, I won't tell anyone. I'll pay."], go: "lost" },
        ],
      },
      lost: {
        who: "o",
        say: ["কর পেয়েছি, আপনার চেক তৈরি হচ্ছে। শিগগিরই আবার ফোন করব।", "Tax received, your cheque is being prepared. I'll ring again soon."],
        out: {
          mobile: -2500,
          sense: 1,
          later: "later_prize_bigger",
          lesson: ["যে লটারিতে নাম দেননি তাতে জেতা যায় না। পুরস্কার পেতে আগে টাকা চাইলেই বুঝবেন ভুয়া।", "You can't win a lottery you never entered. Being asked to pay first is the sign that it's fake."],
        },
      },
      caught: {
        who: "o",
        say: ["ঠিক আছে, ভাগ্য নিজের হাতেই হারালেন।", "Fine, you've thrown away your own luck."],
        out: {
          sense: 3,
          lesson: ["আগে টাকা চাওয়া, তাড়া দেওয়া, গোপন রাখতে বলা, তিনটাই চিহ্ন। আসল খবর মেলে কোম্পানির দোকানে।", "Asking money first, rushing you, demanding secrecy: all three are signs. Real news comes from the company's shop."],
        },
      },
    },
  },
  {
    key: "call_dubai_job",
    kind: "call",
    from: ["+880 1815 00274", "+880 1815 00274"],
    nodes: {
      start: {
        who: "o",
        say: ["আপনি বা পরিবারের কেউ দুবাই যেতে চান? বড় কোম্পানিতে লোক নিচ্ছি, বেতন আশি হাজার।", "Do you or anyone in your family want to go to Dubai? A big company's hiring, the pay is 80,000."],
        options: [
          { text: ["আগ্রহ আছে, বলুন।", "I'm interested, go on."], go: "detail" },
          { text: ["এজেন্সির লাইসেন্স আর ঠিকানা কী?", "What's the agency's licence and address?"], go: "license" },
          { text: ["দরকার নেই।", "No need."], out: { sense: 1, lesson: ["অচেনা ফোনে বিদেশের কাজ আসে না। আগ্রহ থাকলে সরকারি অফিসে নিজে খোঁজ নিন।", "Jobs abroad don't come from strange calls. If you're interested, ask at the government office yourself."] } },
        ],
      },
      detail: {
        who: "o",
        say: ["শুধু পাসপোর্ট আর পাঁচ হাজার টাকা অগ্রিম। ভিসা হলে বাকিটা, বিমানের টিকিট আমাদের।", "Just the passport and 5,000 taka in advance. The rest when the visa's done, and the flight's on us."],
        options: [
          { text: ["অগ্রিম পাঠিয়ে দিই।", "I'll send the advance."], go: "lost" },
          { text: ["চুক্তিপত্র আগে দেখতে চাই।", "I want to see the contract first."], go: "contract" },
          { text: ["বাড়িতে আলোচনা করে জানাব।", "I'll talk at home and let you know."], go: "wait" },
        ],
      },
      license: {
        who: "o",
        say: ["লাইসেন্স আছে, এখন নবায়ন চলছে। এত খোঁজ নিলে সিট চলে যাবে, মাত্র তিনটা বাকি।", "We have a licence, it's being renewed. Keep asking and the places will go, only three are left."],
        options: [
          { text: ["সরকারি অফিসে যাচাই করে জানাব।", "I'll check at the government office."], go: "caught" },
          { text: ["ঠিক আছে, কত দিতে হবে?", "All right, how much do I pay?"], go: "detail" },
        ],
      },
      contract: {
        who: "o",
        say: ["চুক্তি দুবাই গেলেই পাবেন, এখানে নিয়ম নেই। আমার ওপর ভরসা রাখুন।", "You'll get the contract in Dubai, that's not done here. Just trust me."],
        options: [
          { text: ["ঠিক আছে, ভরসা করলাম।", "All right, I'll trust you."], go: "lost" },
          { text: ["চুক্তি ছাড়া কিছু দেব না।", "Nothing without a contract."], go: "caught" },
        ],
      },
      wait: {
        who: "o",
        say: ["আলোচনা করতে করতে সিট শেষ। আজ দুপুরের মধ্যে অগ্রিম দিয়ে অন্তত নাম তুলে রাখুন।", "While you talk, the places go. At least pay the advance by noon and get your name down."],
        options: [
          { text: ["আচ্ছা, দিচ্ছি।", "All right, I'll pay."], go: "lost" },
          { text: ["তাড়াহুড়ো করব না।", "I won't be rushed."], go: "caught" },
        ],
      },
      lost: {
        who: "o",
        say: ["পেয়েছি। কাল পাসপোর্টটা আমাদের লোকের হাতে দিয়ে দেবেন, ভিসা হয়ে যাবে।", "Received. Tomorrow hand the passport to our man, and the visa will be done."],
        out: {
          mobile: -5000,
          sense: 1,
          later: "later_passport_misuse",
          lesson: ["ফি আর পাসপোর্ট নিয়ে উধাও হওয়া পুরোনো ফাঁদ। আগে সরকারি জনশক্তি অফিসে এজেন্সি যাচাই করুন।", "Vanishing with the fee and passport is an old trap. Check the agency at the government manpower office first."],
        },
      },
      caught: {
        who: "o",
        say: ["যান, পরে আফসোস করবেন। এমন সুযোগ আর পাবেন না।", "Go on then, you'll regret it. You won't get a chance like this again."],
        out: {
          sense: 3,
          lesson: ["লাইসেন্স বা চুক্তি দেখাতে পারেনি, শুধু তাড়া দিয়েছে। নিবন্ধিত এজেন্সি কিনা সরকারি অফিসে জানুন।", "No licence or contract to show, only rushing. Ask at the government office whether an agency is registered."],
        },
      },
    },
  },
  {
    key: "call_malaysia_factory",
    kind: "call",
    from: ["+880 1913 00641", "+880 1913 00641"],
    nodes: {
      start: {
        who: "o",
        say: ["মালয়েশিয়ার কারখানায় সরকারি কোটায় কাজ। এলাকা থেকে আপনার নম্বর পেয়েছি, একজনের জায়গা খালি।", "Factory work in Malaysia on the government quota. I got your number locally, and one place is free."],
        options: [
          { text: ["এলাকার কে নম্বর দিল?", "Who locally gave you my number?"], go: "who" },
          { text: ["কত খরচ?", "How much does it cost?"], go: "cost" },
          { text: ["দরকার নেই।", "No need."], out: { sense: 1, lesson: ["সরকারি কোটার খবর অচেনা ফোনে আসে না। আগ্রহ থাকলে সরকারি অফিসে নিজে জেনে নিন।", "Government quota news doesn't come from strange calls. If you're interested, ask at the government office."] } },
        ],
      },
      who: {
        who: "o",
        say: ["আপনার পরিচিতই দিয়েছে, নাম মনে নেই। সেটা বড় কথা নয়, কাজটাই আসল।", "Someone you know gave it, I forget who. That's not important, the job's what matters."],
        options: [
          { text: ["নাম না বললে কথা নেই।", "No name, no talk."], go: "caught" },
          { text: ["আচ্ছা, কত খরচ?", "All right, how much does it cost?"], go: "cost" },
        ],
      },
      cost: {
        who: "o",
        say: ["আজ শুধু মেডিকেল ফি তিন হাজার টাকা। আমাদের ক্লিনিকেই রিপোর্ট হবে, আপনাকে আসতেও হবে না।", "Just a 3,000 taka medical fee today. Our clinic does the report, you needn't even come in."],
        options: [
          { text: ["পাঠিয়ে দিই।", "I'll send it."], go: "lost" },
          { text: ["পরীক্ষা ছাড়া রিপোর্ট হয় কীভাবে?", "How can there be a report without a test?"], go: "report" },
          { text: ["ভেবে দেখি।", "Let me think about it."], go: "think" },
        ],
      },
      report: {
        who: "o",
        say: ["ওসব আমরা সামলে নিই, তাই তো এত লোক যাচ্ছে। আপনি শুধু ফিটা দিন।", "We take care of all that, that's why so many are going. You just pay the fee."],
        options: [
          { text: ["এটা তো ভুয়া রিপোর্ট। থাক।", "That's a fake report. Forget it."], go: "caught" },
          { text: ["ঠিক আছে, পাঠাচ্ছি।", "All right, I'm sending it."], go: "lost" },
        ],
      },
      think: {
        who: "o",
        say: ["ভাবার সময় নেই, আজ রাতেই তালিকা জমা যাবে। কাল থেকে খরচ তিন গুণ।", "There's no time to think, the list goes in tonight. From tomorrow it costs three times as much."],
        options: [
          { text: ["তবু আমি অফিসে খোঁজ নেব।", "Still, I'll ask at the office."], go: "caught" },
          { text: ["আচ্ছা, পাঠাই।", "All right, I'll send it."], go: "lost" },
        ],
      },
      lost: {
        who: "o",
        say: ["পেয়েছি। এবার পাসপোর্টের ছবি আর আঙুলের ছাপের ফর্মটা পাঠাচ্ছি।", "Received. Now I'm sending the form for your passport picture and fingerprints."],
        out: {
          mobile: -3000,
          sense: 1,
          later: "later_passport_misuse",
          lesson: ["সরকারি কোটায় কেউ অচেনা নম্বর থেকে ফোন করে না। খবরটা প্রবাসী কল্যাণ অফিসে যাচাই করুন।", "Nobody offers a government quota from a strange number. Check the news at the overseas welfare office."],
        },
      },
      caught: {
        who: "o",
        say: ["ঠিক আছে, জায়গাটা অন্যকে দিয়ে দিচ্ছি।", "Fine, I'm giving the place to someone else."],
        out: {
          sense: 3,
          lesson: ["পরীক্ষা ছাড়া রিপোর্ট আর অচেনা ফোনে কাজ, দুটোই ভুয়া। বৈধ পথ সরকারি অফিসে জেনে নিন।", "A report with no test and a job from a strange call are both fake. Learn the lawful way at the government office."],
        },
      },
    },
  },
  {
    key: "call_scholarship",
    kind: "call",
    from: ["বিদেশি বৃত্তি অফিস", "Foreign Scholarship Office"],
    nodes: {
      start: {
        who: "o",
        say: ["আপনার পরিবারের এক শিক্ষার্থী বিদেশে পুরো বৃত্তির জন্য বাছাই হয়েছে! অভিনন্দন।", "A student in your family has been chosen for a full scholarship abroad! Congratulations."],
        options: [
          { text: ["কে বাছাই হলো? নামটা বলুন।", "Who was chosen? Tell me the name."], go: "name" },
          { text: ["বাহ, এখন কী করতে হবে?", "Wonderful, what happens now?"], go: "fee" },
          { text: ["আমরা তো আবেদন করিনি।", "But we never applied."], go: "noapply" },
        ],
      },
      name: {
        who: "o",
        say: ["সেটা গোপন তালিকায় আছে, ফি জমা দিলেই নাম প্রকাশ হবে।", "That's on a confidential list. The name is released once the fee is paid."],
        options: [
          { text: ["নাম না জেনে ফি দেব কেন?", "Why pay a fee without knowing the name?"], go: "caught" },
          { text: ["ঠিক আছে, ফি কত?", "All right, how much is the fee?"], go: "fee" },
        ],
      },
      noapply: {
        who: "o",
        say: ["আমরা ফলাফল দেখে নিজেরাই বাছাই করি, আবেদন লাগে না। মেধাবীদের জন্য বিশেষ সুযোগ।", "We choose from exam results ourselves, no application needed. It's a special chance for bright students."],
        options: [
          { text: ["ফি কত?", "How much is the fee?"], go: "fee" },
          { text: ["চেনা শিক্ষককে জিজ্ঞেস করে দেখি।", "I'll ask a teacher I know."], go: "caught" },
        ],
      },
      fee: {
        who: "o",
        say: ["প্রসেসিং ফি দেড় হাজার টাকা আর সনদের ছবি। আজকের মধ্যে না দিলে আসন বাতিল হবে।", "A processing fee of 1,500 taka and a picture of the certificates. Miss today and the seat's cancelled."],
        options: [
          { text: ["পাঠাচ্ছি।", "I'm sending it."], go: "lost" },
          { text: ["বৃত্তির ওয়েবসাইটটা কোথায় দেখব?", "Where's the scholarship's website?"], go: "site" },
          { text: ["কাল জানাব।", "I'll let you know tomorrow."], go: "wait" },
        ],
      },
      site: {
        who: "o",
        say: ["ওয়েবসাইটে এসব থাকে না, এটা সরাসরি কোটা। আপনি শুধু আমাদের সাথে যোগাযোগ রাখবেন।", "It isn't on any website, it's a direct quota. You just stay in touch with us."],
        options: [
          { text: ["তাহলে এটা ভুয়া।", "Then this is fake."], go: "caught" },
          { text: ["আচ্ছা, দিচ্ছি।", "All right, I'll pay."], go: "lost" },
        ],
      },
      wait: {
        who: "o",
        say: ["কালকের মধ্যে অন্য কেউ নিয়ে যাবে। এত বড় সুযোগ হাতছাড়া করবেন?", "By tomorrow someone else will have taken it. You'd let a chance this big slip?"],
        options: [
          { text: ["দিচ্ছি।", "I'll pay."], go: "lost" },
          { text: ["যাক, শিক্ষকের কাছে খোঁজ নেব।", "Let it go, I'll ask a teacher."], go: "caught" },
        ],
      },
      lost: {
        who: "o",
        say: ["পেয়েছি, অভিনন্দন। আমাদের বোর্ড শিগগিরই যোগাযোগ করবে।", "Received, congratulations. Our board will be in touch soon."],
        out: {
          mobile: -1500,
          sense: 1,
          later: "later_scholarship_docs",
          lesson: ["আসল বৃত্তিতে আবেদন লাগে, ফোনে ফি চাওয়া হয় না। খবরটা আগে শিক্ষকের কাছে যাচাই করুন।", "A real scholarship needs an application and no fee by phone. Check the news with a teacher first."],
        },
      },
      caught: {
        who: "o",
        say: ["ঠিক আছে, আসনটা আরেকজনকে দিচ্ছি।", "Fine, I'm giving the seat to someone else."],
        out: {
          sense: 3,
          lesson: ["না করা আবেদনে বৃত্তি আসে না। আসল বৃত্তির নাম, ওয়েবসাইট আর নিয়ম সবার জন্য খোলা থাকে।", "No application, no scholarship. A real one has a name, a website and rules open to all."],
        },
      },
    },
  },
  {
    key: "call_loan_app",
    kind: "call",
    from: ["দ্রুত ঋণ সহায়তা", "Quick Loan Support"],
    nodes: {
      start: {
        who: "o",
        say: ["মাত্র পাঁচ মিনিটে বিশ হাজার টাকা ঋণ! কোনো কাগজ লাগবে না, শুধু ফোনে একটা অ্যাপ নামান।", "A 20,000 taka loan in just five minutes! No papers, just download an app on your phone."],
        options: [
          { text: ["বলেন কী! লিংক দিন।", "You don't say! Send the link."], go: "app" },
          { text: ["সুদ কত, লিখিত আছে?", "What's the interest, is it in writing?"], go: "rate" },
          { text: ["লাগবে না।", "No thanks."], out: { sense: 1, lesson: ["কাগজ ছাড়া ঋণের ফোন বেশিরভাগই ফাঁদ। টাকা লাগলে ব্যাংক বা চেনা সমিতিতে যান।", "Most no-papers loan calls are traps. If you need money, go to a bank or a savings group you know."] } },
        ],
      },
      app: {
        who: "o",
        say: ["অ্যাপটা ফোনের সব নম্বর আর ছবি দেখার অনুমতি চাইবে। হ্যাঁ দিয়ে দেবেন, এটাই নিয়ম।", "The app will ask to see all your phone's numbers and photos. Just say yes, that's the rule."],
        options: [
          { text: ["অনুমতি দিলাম।", "I've allowed it."], go: "fee" },
          { text: ["ঋণের সাথে ছবির কী সম্পর্ক?", "What have photos got to do with a loan?"], go: "photo" },
        ],
      },
      rate: {
        who: "o",
        say: ["সুদ খুব কম, সপ্তাহে সামান্য একটু। লিখিত কিছু লাগে না, অ্যাপেই দেখাবে।", "The interest is very low, just a little each week. Nothing's written down, the app shows it."],
        options: [
          { text: ["লিখিত ছাড়া নেব না।", "I won't take it without it in writing."], go: "caught" },
          { text: ["ঠিক আছে, লিংক দিন।", "All right, send the link."], go: "app" },
        ],
      },
      photo: {
        who: "o",
        say: ["সেটা শুধু যাচাইয়ের জন্য, ভয়ের কিছু নেই। অল্প কিস্তিতে শোধ করলেই হবে।", "That's only for verification, nothing to fear. You just pay it off in small instalments."],
        options: [
          { text: ["আচ্ছা, দিলাম।", "All right, I've allowed it."], go: "fee" },
          { text: ["আমার ছবি দেব না।", "I won't give my photos."], go: "caught" },
        ],
      },
      fee: {
        who: "o",
        say: ["ঋণ পাস! ছাড়ের আগে সার্ভিস ফি বারোশো টাকা পাঠান, এক মিনিটে বিশ হাজার ঢুকবে।", "Loan approved! Before release, send a 1,200 taka service fee and the 20,000 lands in a minute."],
        options: [
          { text: ["ফি পাঠাই।", "I'll send the fee."], go: "lost" },
          { text: ["ফি ঋণ থেকে কেটে নিন।", "Take the fee out of the loan."], go: "caught" },
        ],
      },
      lost: {
        who: "o",
        say: ["ফি পেয়েছি, ঋণ শিগগিরই আসবে। মনে রাখবেন, এক সপ্তাহে শোধ না করলে সবাই জানবে।", "Fee received, the loan's coming soon. Remember, don't repay in a week and everyone will know."],
        out: {
          mobile: -1200,
          sense: 1,
          later: "later_loan_shame_again",
          lesson: ["ঋণের আগে ফি চাওয়া আর ফোনের নম্বর নেওয়া, দুটোই ফাঁদ। ঋণ নিন ব্যাংক বা চেনা সমিতি থেকে।", "A fee before a loan and taking your contacts are both traps. Borrow from a bank or a savings group you know."],
        },
      },
      caught: {
        who: "o",
        say: ["ঠিক আছে, টাকার দরকার হলে আবার ফোন করবেন।", "Fine, ring back when you need money."],
        out: {
          sense: 3,
          lesson: ["ঋণ দিতে ফোনের ছবি আর নম্বর লাগে না। ওগুলো দিয়েই পরে লজ্জা দিয়ে টাকা আদায় করে।", "A loan doesn't need your photos and contacts. They use those later to shame money out of you."],
        },
      },
    },
  },
  {
    key: "call_old_friend",
    kind: "call",
    from: ["+880 1678 00193", "+880 1678 00193"],
    nodes: {
      start: {
        who: "o",
        say: ["হ্যালো! গলা শুনে বলুন তো কে? অনেকদিন পর ফোন করলাম, এটা নতুন নম্বর।", "Hello! Guess who from my voice? It's been ages. This is my new number."],
        options: [
          { text: ["কে, রফিক নাকি?", "Who's this, Rafiq?"], go: "feed" },
          { text: ["আপনিই বলুন, আপনি কে।", "You tell me who you are."], go: "who" },
          { text: ["অচেনা নম্বর, রাখছি।", "I don't know this number, goodbye."], out: { sense: 1, lesson: ["নিজের নাম না বলা ফোন কেটে দেওয়াই ভালো। সত্যি চেনা মানুষ হলে নাম বলতে আপত্তি করে না।", "It's best to hang up if a caller won't give a name. Someone you really know doesn't mind saying who they are."] } },
        ],
      },
      feed: {
        who: "o",
        say: ["হ্যাঁ হ্যাঁ, রফিক! ধরে ফেলেছেন তো। শুনুন, খুব বিপদে পড়ে ফোন করেছি।", "Yes, yes, Rafiq! You got it. Listen, I'm ringing because I'm in real trouble."],
        options: [
          { text: ["কী হয়েছে?", "What's happened?"], go: "trouble" },
          { text: ["আমরা শেষ কোথায় দেখা করেছিলাম?", "Where did we last meet?"], go: "test" },
        ],
      },
      who: {
        who: "o",
        say: ["এত পর হয়ে গেলেন? একসাথে কত চা খেয়েছি! শুনুন, একটা বিপদে পড়েছি।", "Have we become such strangers? All the tea we drank together! Listen, I'm in trouble."],
        options: [
          { text: ["কী বিপদ?", "What trouble?"], go: "trouble" },
          { text: ["নাম না বললে কথা নেই।", "No name, no talk."], go: "caught" },
        ],
      },
      test: {
        who: "o",
        say: ["আরে সেসব পরে হবে! এখন একটু শুনুন, সময় নেই।", "Oh, that can wait! Just listen now, there's no time."],
        options: [
          { text: ["এটুকু বলতে পারলেন না।", "You couldn't even tell me that."], go: "caught" },
          { text: ["আচ্ছা, কী হয়েছে?", "All right, what's happened?"], go: "trouble" },
        ],
      },
      trouble: {
        who: "o",
        say: ["বাসের টিকিট কাটতে গিয়ে মানিব্যাগ হারিয়েছি। দুই হাজার টাকা পাঠান, কালই ফেরত দেব।", "I lost my wallet buying a bus ticket. Send 2,000 taka, I'll return it tomorrow."],
        options: [
          { text: ["আচ্ছা, পাঠাচ্ছি।", "All right, I'm sending it."], go: "lost" },
          { text: ["পুরোনো নম্বরে ফোন করে দেখি।", "Let me try the old number."], go: "verify" },
        ],
      },
      verify: {
        who: "o",
        say: ["পুরোনো সিম তো হারিয়ে গেছে! মানুষ বিপদে পড়েছে আর আপনি যাচাই করছেন?", "I've lost the old SIM! Someone's in trouble and you're checking up?"],
        options: [
          { text: ["রাগ করবেন না, পাঠাচ্ছি।", "Don't be cross, I'm sending it."], go: "lost" },
          { text: ["আসল বন্ধু এতে রাগ করে না।", "A real friend wouldn't mind."], go: "caught" },
        ],
      },
      lost: {
        who: "o",
        say: ["অনেক ধন্যবাদ। আপনি না থাকলে কী যে হতো!", "Thank you so much. I don't know what I'd have done without you!"],
        out: {
          mobile: -2000,
          sense: 1,
          later: "later_sucker_list",
          lesson: ["নামটা আপনিই বলে দিলেন, সে শুধু লুফে নিল। টাকার আগে চেনা নম্বরে বা সামনাসামনি যাচাই করুন।", "You gave the name and he just grabbed it. Before sending money, check on a number you know or in person."],
        },
      },
      caught: {
        who: "o",
        say: ["ধুর, ভুল নম্বরে লেগেছে।", "Bah, wrong number."],
        out: {
          sense: 3,
          lesson: ["আপনাকে দিয়েই নাম বলিয়ে নেওয়া পুরোনো কৌশল। চেনা মানুষকে চেনার একটা প্রশ্নেই ধরা পড়ে।", "Getting you to supply the name is an old trick. One question only a real friend could answer catches it."],
        },
      },
    },
  },
  {
    key: "call_customs_parcel",
    kind: "call",
    from: ["বিমানবন্দর কাস্টমস", "Airport Customs"],
    nodes: {
      start: {
        who: "o",
        say: ["বিমানবন্দর কাস্টমস থেকে বলছি। বিদেশ থেকে আপনার নামে একটা দামি পার্সেল এসে আটকে আছে।", "This is airport customs. A valuable parcel from abroad, in your name, is being held here."],
        options: [
          { text: ["আমার নামে? কী আছে?", "In my name? What's in it?"], go: "inside" },
          { text: ["কে পাঠিয়েছে?", "Who sent it?"], go: "sender" },
          { text: ["আমি কিছু আনাইনি।", "I haven't ordered anything."], go: "none" },
        ],
      },
      inside: {
        who: "o",
        say: ["ভেতরে মোবাইল, ঘড়ি আর ডলার আছে। শুল্ক তিন হাজার টাকা দিলেই আজ ছেড়ে দেব।", "There's a phone, a watch and dollars inside. Pay 3,000 taka duty and I'll release it today."],
        options: [
          { text: ["পাঠিয়ে দিচ্ছি।", "I'll send it now."], go: "lost" },
          { text: ["কাস্টমসে এসে রসিদ নিয়ে দেব।", "I'll pay at customs and take a receipt."], go: "office" },
        ],
      },
      sender: {
        who: "o",
        say: ["বিদেশের এক বন্ধু, নামটা কাগজে অস্পষ্ট। আপনার নাম আর নম্বরটাই পরিষ্কার লেখা আছে।", "A friend abroad, the name's blurred on the paper. Only your name and number are clearly written."],
        options: [
          { text: ["বিদেশে আমার তেমন কেউ নেই।", "I have nobody like that abroad."], go: "none" },
          { text: ["আচ্ছা, ভেতরে কী আছে?", "All right, what's inside?"], go: "inside" },
        ],
      },
      none: {
        who: "o",
        say: ["না আনিয়েও আপনার নামেই এসেছে। না ছাড়ালে অবৈধ মালের মামলা আপনার নামেই হবে।", "Ordered or not, it's in your name. Don't clear it and the illegal goods case goes in your name."],
        options: [
          { text: ["মামলা চাই না, টাকা দিচ্ছি।", "I don't want a case, I'll pay."], go: "lost" },
          { text: ["কোন ধারায় মামলা? অফিসে আসছি।", "A case under what law? I'm coming in."], go: "office" },
        ],
      },
      office: {
        who: "o",
        say: ["অফিসে এলে আপনাকেই আটকে রাখবে, আমি ভালোর জন্য বলছি। ফোনেই মিটিয়ে নিন।", "Come in and they'll hold you, I'm saying this for your good. Settle it by phone."],
        options: [
          { text: ["ভয় পেয়েছি, দিচ্ছি।", "I'm scared, I'll pay."], go: "lost" },
          { text: ["আসল অফিস ফোনে টাকা নেয় না।", "A real office doesn't take money by phone."], go: "caught" },
        ],
      },
      lost: {
        who: "o",
        say: ["পেয়েছি। পার্সেল ছাড় হলে ডেলিভারি পাবেন, একটু অপেক্ষা করুন।", "Received. You'll get delivery once the parcel clears, just wait a little."],
        out: {
          mobile: -3000,
          sense: 1,
          later: "later_customs_second_fee",
          lesson: ["কাস্টমসের শুল্ক ব্যক্তিগত নম্বরে নেওয়া হয় না। না আনানো পার্সেলের ফি দেবেন না, ফোন কেটে দিন।", "Customs duty is never taken on a personal number. Don't pay for a parcel you didn't order, just hang up."],
        },
      },
      caught: {
        who: "o",
        say: ["যা ভালো বোঝেন। পার্সেল নিলামে যাবে।", "As you like. The parcel goes to auction."],
        out: {
          sense: 3,
          lesson: ["না আনানো পার্সেল, ব্যক্তিগত নম্বর আর মামলার ভয়, এই তিনেই ধরা পড়ল। রসিদ ছাড়া শুল্ক হয় না।", "An unordered parcel, a personal number and a threat of a case gave it away. Real duty always has a receipt."],
        },
      },
    },
  },
  {
    key: "call_fake_police",
    kind: "call",
    from: ["থানা ডিউটি অফিসার", "Police Duty Officer"],
    nodes: {
      start: {
        who: "o",
        say: ["থানা থেকে বলছি। আপনার পরিচয়পত্রে খোলা একটা অ্যাকাউন্টে অবৈধ টাকা পাওয়া গেছে। মামলা হয়েছে।", "This is the police station. Illegal money was found in an account opened with your ID. A case is filed."],
        options: [
          { text: ["আমি কিছুই জানি না! কী করব?", "I know nothing about this! What do I do?"], go: "scared" },
          { text: ["কোন থানা, আপনার নাম কী?", "Which station, what's your name?"], go: "which" },
          { text: ["আমি থানায় এসে কথা বলব।", "I'll come to the station and talk."], go: "come" },
        ],
      },
      scared: {
        who: "o",
        say: ["ভয় নেই, আমি সাহায্য করব। তবে বিষয়টা গোপন রাখবেন, কাউকে বললে গ্রেফতার হবেন।", "Don't be afraid, I'll help. But keep this secret. Tell anyone and you'll be arrested."],
        options: [
          { text: ["ঠিক আছে, কাউকে বলব না।", "All right, I won't tell anyone."], go: "fine" },
          { text: ["বাড়ির লোককে না জানিয়ে পারব না।", "I have to tell my family."], go: "family" },
        ],
      },
      which: {
        who: "o",
        say: ["আমি কেন্দ্রীয় থানার এসআই। এত প্রশ্ন করছেন কেন? আপনার নামে তো পরোয়ানা আছে।", "I'm a sub-inspector at the central station. Why all these questions? There's a warrant in your name."],
        options: [
          { text: ["পরোয়ানা থাকলে বাড়িতে আসুন।", "If there's a warrant, come to my home."], go: "caught" },
          { text: ["না না, কী করতে হবে বলুন।", "No, no, tell me what to do."], go: "fine" },
        ],
      },
      come: {
        who: "o",
        say: ["এলে তো সবাই জেনে যাবে, আপনার সম্মান যাবে। ফোনেই সমাধান করা ভালো।", "If you come, everyone will find out and your good name will suffer. Better to settle it by phone."],
        options: [
          { text: ["কীভাবে সমাধান?", "Settle it how?"], go: "fine" },
          { text: ["সম্মান নিয়ে ভাবি না, আসছি।", "I'm not worried about that, I'm coming."], go: "caught" },
        ],
      },
      family: {
        who: "o",
        say: ["কাউকে জানালে আমার আর কিছু করার থাকবে না। এখনই ঠিক করুন, ফাইল উপরে চলে যাচ্ছে।", "Tell anyone and there's nothing more I can do. Decide now, the file's going upstairs."],
        options: [
          { text: ["আচ্ছা, কী করতে হবে?", "All right, what must I do?"], go: "fine" },
          { text: ["তবু জানাব।", "I'll tell them anyway."], go: "caught" },
        ],
      },
      fine: {
        who: "o",
        say: ["জামিনের টাকা পাঁচ হাজার এই নম্বরে পাঠান। তদন্ত শেষে পুরোটা ফেরত পাবেন।", "Send 5,000 taka bail money to this number. You'll get it all back when the investigation ends."],
        options: [
          { text: ["পাঠিয়ে দিচ্ছি।", "I'll send it now."], go: "lost" },
          { text: ["পুলিশ তো ফোনে টাকা নেয় না।", "The police don't take money by phone."], go: "caught" },
        ],
      },
      lost: {
        who: "o",
        say: ["পেয়েছি। ফোন বন্ধ করবেন না, কাউকে কিছু বলবেন না।", "Received. Don't switch off your phone, and don't tell anyone anything."],
        out: {
          mobile: -5000,
          sense: 1,
          later: "later_fake_lawyer",
          lesson: ["পুলিশ বা আদালত ফোনে জামিনের টাকা নেয় না। ভয় পেলে নিজে কাছের থানায় গিয়ে জিজ্ঞেস করুন।", "Police and courts never take bail money by phone. If you're frightened, go and ask at your nearest station."],
        },
      },
      caught: {
        who: "o",
        say: ["ঠিক আছে, বিপদ আপনিই ডেকে আনলেন।", "Fine, you've brought this trouble on yourself."],
        out: {
          sense: 3,
          rep: 1,
          lesson: ["কাউকে না বলতে বলা আর ফোনে জামিন চাওয়াই ধরিয়ে দিল। সত্যি মামলা হলে কাগজ আসে, ফোন নয়।", "Telling you to keep quiet and asking bail by phone gave it away. A real case comes on paper, not by phone."],
        },
      },
    },
  },
  ...CALLS2,
];
