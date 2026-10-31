import type { Scam } from "../types";
import { MESSAGES2 } from "./messages2";
import { MESSAGES_REAL } from "./messages3";

/** Scam text messages, the first twelve here and the rest in messages2.ts; the real ones are in messages3.ts.
 *  MESSAGES holds all of them. The numbers and links in `body` are invented: every phone number is a digit
 *  short of a real one, and no link ends in a real domain. */
export const MESSAGES: Scam[] = [
  {
    key: "sms_fake_received",
    kind: "sms",
    from: ["+880 1712 00418", "+880 1712 00418"],
    body: ["আপনি ০১৭১২ ০০৪১৮ নম্বর থেকে ২,০০০.০০ টাকা পেয়েছেন। ফি ০.০০। ব্যালান্স ২,৪৩১.৫০ টাকা। TrxID 7GH2KL9Q", "You have received Tk 2,000.00 from 01712 00418. Fee Tk 0.00. Balance Tk 2,431.50. TrxID 7GH2KL9Q"],
    nodes: {
      start: {
        who: "h",
        say: ["দুই হাজার টাকা এল? কে পাঠাল, কিছুই তো জানি না।", "Two thousand taka came in? I've no idea who sent it."],
        options: [
          { text: ["ব্যালান্স দেখি।", "Check my balance."], go: "bal" },
          { text: ["ওই নম্বরে ফোন করি।", "Ring that number."], go: "phone" },
          { text: ["মুছে দিই।", "Delete it."], out: { sense: 1, lesson: ["মুছে ফেলা ভালো হলো। পরের বার ব্যালান্সও দেখে নিন, আসল টাকা সেখানেই দেখা যায়।", "Deleting it was good. Next time check your balance too, that's where real money shows."] } },
        ],
      },
      bal: {
        who: "h",
        say: ["ব্যালান্স আগের মতোই আছে। এক পয়সাও বাড়েনি।", "My balance is just as it was. Not a paisa more."],
        options: [
          { text: ["নম্বরটা ব্লক করি।", "Block the number."], out: { sense: 3, lesson: ["মেসেজটা হেল্পলাইন নম্বর থেকে আসেনি, ব্যালান্সেও টাকা নেই। এটাই ফেরত চাওয়ার ফাঁদের শুরু।", "It didn't come from the helpline number and the balance didn't move. It's how the send-it-back trap begins."] } },
          { text: ["তবু ফোন করে জানাই।", "Ring and tell them anyway."], go: "phone" },
        ],
      },
      phone: {
        who: "o",
        say: ["ফোন করার জন্য ধন্যবাদ! টাকাটা ভুলে গেছে, আমার ওষুধের টাকা। একটু ফেরত দিন না।", "Thank you for ringing! That money went by mistake, it's for my medicine. Please send it back."],
        options: [
          { text: ["পাঠিয়ে দিই।", "Send it."], go: "lost" },
          { text: ["ব্যালান্সে তো টাকা আসেনি।", "No money has come into my balance."], go: "caught" },
        ],
      },
      lost: {
        who: "h",
        say: ["পাঠালাম। পরে দেখি, আসল টাকা কখনো আসেইনি, আমারটাই গেল।", "I sent it. Then I saw the money never came at all, and mine's gone."],
        out: {
          mobile: -2000,
          sense: 1,
          later: "later_sucker_list",
          lesson: ["এসএমএস বানানো যায়, ব্যালান্স বানানো যায় না। ফেরত পাঠানোর আগে নিজের ব্যালান্স দেখুন।", "A message can be faked, your balance can't. Before sending anything back, check your own balance."],
        },
      },
      caught: {
        who: "o",
        say: ["কী বলছেন! মেসেজ তো গেছে। আচ্ছা থাক, রাখছি।", "What are you saying! The message went. Never mind then, goodbye."],
        out: {
          sense: 3,
          lesson: ["ব্যালান্স দেখাই সবচেয়ে সহজ পরীক্ষা। সত্যি ভুল হলে সে হেল্পলাইনে যাবে, আপনার কাছে নয়।", "Checking your balance is the easiest test. A real mistake goes to the helpline, not to you."],
        },
      },
    },
  },
  {
    key: "sms_account_lock",
    kind: "sms",
    from: ["+880 1309 00412", "+880 1309 00412"],
    body: ["প্রিয় গ্রাহক, আপনার ঝটপট টাকা একাউন্ট ২৪ ঘন্টার মধে বন্ধ হবে। এখনি ভেরিফাই করুন: http://jhotpot-verify.clikk/login", "Dear customer, your Jhotpot Taka account will close within 24 hours. Verify now: http://jhotpot-verify.clikk/login"],
    nodes: {
      start: {
        who: "h",
        say: ["অ্যাকাউন্ট বন্ধ হবে? লিংকটা কেমন যেন লাগছে।", "My account will close? That link looks a bit odd."],
        options: [
          { text: ["লিংকে ঢুকি।", "Open the link."], go: "page" },
          { text: ["অ্যাপ খুলে নিজে দেখি।", "Open the app and look for myself."], go: "app" },
          { text: ["রিপোর্ট করে মুছে দিই।", "Report it and delete it."], out: { sense: 2, rep: 1, lesson: ["ঠিক কাজ। হুমকির মেসেজে তাড়াহুড়ো নয়, হেল্পলাইনে নম্বরটা জানিয়ে দিলে অন্যরাও বাঁচে।", "Well done. Don't rush at a threatening message. Telling the helpline the number protects others too."] } },
        ],
      },
      page: {
        who: "h",
        say: ["ঝটপট টাকার মতোই দেখতে পেজ। নম্বর আর পিন চাইছে।", "The page looks just like Jhotpot Taka. It wants my number and PIN."],
        options: [
          { text: ["পিন দিয়ে ঢুকি।", "Enter the PIN."], go: "lost" },
          { text: ["ঠিকানাটা আসল নয়, বন্ধ করি।", "That address isn't the real one, close it."], go: "app" },
        ],
      },
      app: {
        who: "h",
        say: ["অ্যাপে সব ঠিক আছে। কোনো সতর্কবার্তা নেই।", "Everything's fine in the app. No warning at all."],
        out: {
          sense: 3,
          lesson: ["লিংক নয়, অ্যাপ নিজে খুলে দেখুন। আসল সতর্কতা অ্যাপেই থাকে, পিন চাওয়া পেজে নয়।", "Not the link: open the app yourself. Real warnings live in the app, not on a page asking for your PIN."],
        },
      },
      lost: {
        who: "h",
        say: ["পিন দিতেই টাকা কাটার মেসেজ এল। পেজটাও উধাও!", "As soon as I gave the PIN, a deduction message came. The page vanished too!"],
        out: {
          mobile: -3000,
          sense: 1,
          later: "later_sucker_list",
          lesson: ["দেখতে আসল হলেই আসল নয়। মেসেজের লিংকে কখনো পিন দেবেন না, অ্যাপ নিজে খুলুন।", "Looking real doesn't make it real. Never give your PIN through a link in a message, open the app yourself."],
        },
      },
    },
  },
  {
    key: "sms_prize_draw",
    kind: "sms",
    from: ["Lucky-Draw", "Lucky-Draw"],
    body: ["অভিনন্দন!! আপনার মোবাইল নম্বর ২,৫০,০০০ টাকা জিতেছে। পুরস্কার নিতে এখুনি কল দিন 01811 00374. অফিস টাইম ৯-৬", "Congratulations!! Your mobile number has won Tk 2,50,000. To claim the prize call 01811 00374 now. Office hours 9-6"],
    nodes: {
      start: {
        who: "h",
        say: ["আড়াই লাখ টাকা! আমি তো কিছুতে নাম দিইনি।", "Two and a half lakh taka! I never entered anything."],
        options: [
          { text: ["নম্বরটায় ফোন করি।", "Ring that number."], go: "phone" },
          { text: ["কোম্পানির দোকানে জিজ্ঞেস করি।", "Ask at the company's shop."], go: "shop" },
          { text: ["মুছে দিই।", "Delete it."], out: { sense: 2, lesson: ["যে খেলায় নামেননি তাতে জেতা যায় না। মুছে দেওয়াই ঠিক হলো।", "You can't win a game you never entered. Deleting it was right."] } },
        ],
      },
      phone: {
        who: "o",
        say: ["অভিনন্দন! পুরস্কার নিতে কর বাবদ দুই হাজার টাকা আগে পাঠান। আজই শেষ সময়।", "Congratulations! To collect the prize, first send 2,000 taka for tax. Today's the last day."],
        options: [
          { text: ["পাঠাই।", "Send it."], go: "lost" },
          { text: ["পুরস্কার থেকে কেটে নিন।", "Take it out of the prize."], go: "deduct" },
        ],
      },
      deduct: {
        who: "o",
        say: ["নিয়ম নেই। সময় গেলে পুরস্কার অন্যের নামে যাবে।", "That's not allowed. When time's up, the prize goes to someone else."],
        options: [
          { text: ["আচ্ছা, পাঠাই।", "All right, send it."], go: "lost" },
          { text: ["বুঝেছি, দোকানে জিজ্ঞেস করি।", "I see. I'll ask at the shop."], go: "shop" },
        ],
      },
      shop: {
        who: "h",
        say: ["দোকানে বলল, কোম্পানির এমন কোনো ড্রই নেই।", "The shop says the company has no such draw at all."],
        out: {
          sense: 3,
          lesson: ["যাচাই করতে এক মিনিট লাগল। পুরস্কারের খবর সব সময় কোম্পানির নিজের দোকানে জেনে নিন।", "Checking took one minute. Always ask about prizes at the company's own shop."],
        },
      },
      lost: {
        who: "o",
        say: ["পেয়েছি। পুরস্কারের পরিমাণ আরও বেড়েছে, কাল জানাব।", "Received. The prize has grown even more, I'll tell you tomorrow."],
        out: {
          mobile: -2000,
          sense: 1,
          later: "later_prize_bigger",
          lesson: ["পুরস্কারের আগে টাকা চাওয়াই ফাঁদ। সত্যি পুরস্কার হলে কর তার থেকেই কাটা যেত।", "Asking for money before a prize is the trap. A real prize could take tax out of itself."],
        },
      },
    },
  },
  {
    key: "sms_parcel_fee",
    kind: "sms",
    from: ["Courier-Alert", "Courier-Alert"],
    body: ["আপনার পার্সেল ঠিকানা ভুলের জন্য আটকে আছে। ৩৫ টাকা রিডেলিভারি ফি দিন আজকেই, না হলে ফেরত যাবে: https://parcel-fee.linkk/pay", "Your parcel is held because of a wrong address. Pay the 35 taka redelivery fee today or it goes back: https://parcel-fee.linkk/pay"],
    nodes: {
      start: {
        who: "h",
        say: ["কোনো পার্সেল আসার কথা আছে নাকি? মাত্র পঁয়ত্রিশ টাকাই তো।", "Was a parcel meant to come? It's only thirty-five taka."],
        options: [
          { text: ["লিংকে ফি দিই।", "Pay the fee at the link."], go: "page" },
          { text: ["যে দোকান থেকে কিনেছি, তাদের জিজ্ঞেস করি।", "Ask the shop I bought from."], go: "shop" },
          { text: ["মুছে দিই।", "Delete it."], out: { sense: 2, lesson: ["ফি যত ছোটই হোক, লিংকে কার্ড দেওয়া যাবে না। ডেলিভারির খবর দোকানেই জানা যায়।", "However small the fee, never give your card through a link. The shop can tell you about any delivery."] } },
        ],
      },
      page: {
        who: "h",
        say: ["পঁয়ত্রিশ টাকার জন্য কার্ডের নম্বর আর কোড চাইছে।", "It wants my card number and code for thirty-five taka."],
        options: [
          { text: ["দিয়ে দিই, সামান্য টাকা।", "Give them, it's a trifle."], go: "lost" },
          { text: ["এত অল্পে কোড কেন? বন্ধ করি।", "Why a code for so little? Close it."], go: "shop" },
        ],
      },
      lost: {
        who: "h",
        say: ["পঁয়ত্রিশ নয়, আঠারোশো টাকা কেটে নিল!", "Not thirty-five: they took eighteen hundred!"],
        out: {
          money: -1800,
          sense: 1,
          later: "later_customs_second_fee",
          lesson: ["ছোট ফি হলো টোপ, আসল লক্ষ্য কার্ডের কোড। লিংকে কার্ড বা কোড কখনো দেবেন না।", "The small fee is the bait, your card code is the real target. Never give a card or code through a link."],
        },
      },
      shop: {
        who: "h",
        say: ["দোকান বলল, আমার কোনো পার্সেলই আটকে নেই।", "The shop says none of my parcels are held up."],
        out: {
          sense: 3,
          lesson: ["যেখান থেকে কিনেছেন, তাদের জিজ্ঞেস করলেই সত্যিটা মেলে। মেসেজের লিংক লাগে না।", "Asking where you bought from gets you the truth. You don't need the link in the message."],
        },
      },
    },
  },
  {
    key: "sms_bank_update",
    kind: "sms",
    from: ["Bank-Notice", "Bank-Notice"],
    body: ["প্রিয় গ্রাহক, আপনার ব্যাংকের তথ্যের মেয়াদ শেষ। আজ আপডেট না করলে একাউন্ট ফ্রিজ হবে। ক্লিক করুন: http://bank-update.onlinee/form", "Dear Customer your bank information is expire. Update today otherwise account will be freeze. Click: http://bank-update.onlinee/form"],
    nodes: {
      start: {
        who: "h",
        say: ["ব্যাংকের তথ্য আপডেট? ব্যাংকের নামই তো লেখেনি।", "Update my bank details? It doesn't even name the bank."],
        options: [
          { text: ["লিংকে ঢুকি।", "Open the link."], go: "form" },
          { text: ["কার্ডের পেছনের নম্বরে ফোন করি।", "Ring the number on the back of the card."], go: "call" },
          { text: ["ব্যাংকে গিয়ে জিজ্ঞেস করি।", "Go and ask at the bank."], go: "call" },
        ],
      },
      form: {
        who: "h",
        say: ["ফর্মে পরিচয়পত্র, কার্ড নম্বর আর ফোনে আসা কোড চাইছে।", "The form wants my ID, card number and the code on my phone."],
        options: [
          { text: ["সব ভরে দিই।", "Fill it all in."], go: "lost" },
          { text: ["ব্যাংক এমন চায় না, বন্ধ করি।", "A bank wouldn't ask this. Close it."], go: "call" },
        ],
      },
      lost: {
        who: "h",
        say: ["জমা দিতেই ব্যাংক থেকে টাকা কাটার মেসেজ এল!", "As soon as I submitted it, a message came: money left my bank!"],
        out: {
          money: -3500,
          sense: 1,
          later: "later_bank_second_call",
          lesson: ["ব্যাংক লিংক পাঠিয়ে কোড চায় না। তথ্য আপডেট করতে হলে শাখায় যান বা পেছনের নম্বরে ফোন করুন।", "Banks don't send links asking for codes. To update details, go to a branch or ring the number on the card."],
        },
      },
      call: {
        who: "h",
        say: ["ব্যাংক বলল, অ্যাকাউন্ট ঠিক আছে। মেসেজটা তাদের জানিয়ে দিলাম।", "The bank says the account's fine. I told them about the message."],
        out: {
          sense: 3,
          lesson: ["ব্যাংকের নাম নেই, লিংক অদ্ভুত, সময়ের ভয়, এতেই ধরা পড়ে। পেছনের নম্বরেই সত্যিটা মেলে।", "No bank name, an odd link and a deadline gave it away. The number on the card gets you the truth."],
        },
      },
    },
  },
  {
    key: "sms_friend_hacked",
    kind: "sms",
    from: ["নাহিদ (বন্ধু)", "Nahid (friend)"],
    body: ["বন্ধু খুব ঝামেলায় পড়ে গেছি। আজকেই ৩০০০ টাকা লাগবে। এই নম্বরে পাঠিয়ে দাও 01612 00558, কাল দিয়ে দিব। কাউকে বলো না প্লিজ।", "Friend, I'm in real trouble. I need 3000 taka today. Send it to this number, 01612 00558, I'll return it tomorrow. Please don't tell anyone."],
    nodes: {
      start: {
        who: "h",
        say: ["নাহিদের আইডি থেকে এল। কিন্তু নম্বরটা তো অন্য কারো।", "It came from Nahid's account. But that number is someone else's."],
        options: [
          { text: ["পাঠিয়ে দিই, বন্ধু বিপদে।", "Send it, a friend's in trouble."], go: "lost" },
          { text: ["নাহিদের চেনা নম্বরে ফোন করি।", "Ring Nahid on the number I know."], go: "known" },
          { text: ["উত্তরে জিজ্ঞেস করি, আমরা কোথায় পড়তাম?", "Reply and ask where we studied."], go: "ask" },
        ],
      },
      ask: {
        who: "o",
        say: ["এসব পরে বলব, এখন সময় নেই। বন্ধুর জন্য এটুকু করা যায় না?", "I'll explain all that later, there's no time now. Can't you do this little thing for a friend?"],
        options: [
          { text: ["আচ্ছা, পাঠাই।", "All right, send it."], go: "lost" },
          { text: ["উত্তর দিল না, ফোন করি।", "No answer to that. I'll ring him."], go: "known" },
        ],
      },
      known: {
        who: "o",
        say: ["আমি? আমি তো ঠিকই আছি! আমার আইডি হ্যাক হয়েছে, সবার কাছে মেসেজ যাচ্ছে।", "Me? I'm fine! My account's been hacked, the message is going to everyone."],
        out: {
          sense: 3,
          rep: 1,
          lesson: ["চেনা মানুষের আইডি থেকেও ফাঁদ আসে। টাকা চাইলে চেনা নম্বরে একবার ফোন করে নিন।", "Traps can come even from an account you know. If money's asked for, ring the number you know first."],
        },
      },
      lost: {
        who: "h",
        say: ["টাকা পাঠিয়ে নাহিদকে ফোন দিলাম। সে কিছুই জানে না।", "After sending the money I rang Nahid. He knows nothing about it."],
        out: {
          mobile: -3000,
          sense: 1,
          lesson: ["আইডি হ্যাক হলে বন্ধুর নামেই মেসেজ আসে। অন্য নম্বরে টাকা আর গোপন রাখতে বলা, দুটোই চিহ্ন।", "When an account's hacked, messages come in your friend's name. A strange number and a request for secrecy are the signs."],
        },
      },
    },
  },
  {
    key: "sms_instant_loan",
    kind: "sms",
    from: ["QuickLoan", "QuickLoan"],
    body: ["কোন কাগজ ছাড়াই ৫০,০০০ টাকা লোন! ৫ মিনিটে ঝটপট টাকায় পাবেন। অ্যাপ নামান: http://loan-fast.winn/app", "Tk 50,000 loan with no papers! Get it in your Jhotpot Taka in 5 minutes. Download the app: http://loan-fast.winn/app"],
    nodes: {
      start: {
        who: "h",
        say: ["পাঁচ মিনিটে পঞ্চাশ হাজার? কাগজও লাগবে না?", "Fifty thousand in five minutes? No papers either?"],
        options: [
          { text: ["অ্যাপটা নামাই।", "Download the app."], go: "app" },
          { text: ["ব্যাংকে ঋণের নিয়ম জেনে নিই।", "Ask the bank about its loan rules."], go: "bank" },
          { text: ["মুছে দিই।", "Delete it."], out: { sense: 2, lesson: ["এত সহজ ঋণ ফাঁদ হতে পারে। টাকা লাগলে ব্যাংক বা চেনা সমিতিতে যান।", "A loan this easy may be a trap. If you need money, go to a bank or a savings group you know."] } },
        ],
      },
      app: {
        who: "h",
        say: ["অ্যাপ আমার সব নম্বর, ছবি আর মেসেজ দেখার অনুমতি চাইছে।", "The app wants permission to see all my contacts, photos and messages."],
        options: [
          { text: ["অনুমতি দিই।", "Allow it."], go: "fee" },
          { text: ["না, অ্যাপ মুছে দিই।", "No, delete the app."], go: "bank" },
        ],
      },
      fee: {
        who: "o",
        say: ["লোন পাস! সাতশো টাকা প্রসেসিং ফি দিলেই এখনই টাকা পাবেন।", "Loan approved! Pay a 700 taka processing fee and you'll have the money right now."],
        options: [
          { text: ["ফি দিই।", "Pay the fee."], go: "lost" },
          { text: ["ফি কেটে লোন দিন।", "Take the fee out of the loan."], go: "deduct" },
        ],
      },
      deduct: {
        who: "o",
        say: ["সিস্টেমে হয় না। ফি না দিলে আপনার নম্বরগুলো আমাদের কাছে রয়েই গেল, ভেবে দেখুন।", "The system can't. Don't pay, and remember your contacts are with us. Think it over."],
        options: [
          { text: ["ভয় পাচ্ছি, ফি দিই।", "I'm scared, I'll pay."], go: "lost" },
          { text: ["অ্যাপ মুছে থানায় জানাই।", "Delete the app and tell the police."], go: "police" },
        ],
      },
      lost: {
        who: "h",
        say: ["এল মাত্র দুই হাজার। এখন এক সপ্তাহে পাঁচ হাজার শোধ করতে বলছে!", "Only two thousand came. Now they want five thousand back within a week!"],
        out: {
          mobile: -700,
          sense: 1,
          later: "later_loan_shame_again",
          lesson: ["ফোনের নম্বর আর ছবি নিয়ে এরা ভয় দেখিয়ে আদায় করে। এমন অ্যাপে অনুমতি দেবেন না।", "With your contacts and photos they frighten money out of you. Never give such an app permission."],
        },
      },
      police: {
        who: "h",
        say: ["অ্যাপ মুছলাম, নম্বরটা নিয়ে থানায় জানালাম।", "I deleted the app and took the number to the police."],
        out: {
          sense: 2,
          lesson: ["অনুমতি দিয়ে ফেললেও থামা যায়। অ্যাপ মুছে আত্মীয়দের সতর্ক করুন, প্রমাণ নিয়ে থানায় যান।", "You can stop even after giving permission. Delete the app, warn your relatives, and take the evidence to the police."],
        },
      },
      bank: {
        who: "h",
        say: ["অ্যাপটা রাখলাম না। ঋণ লাগলে ব্যাংকেই যাব।", "I didn't keep the app. If I need a loan I'll go to the bank."],
        out: {
          sense: 3,
          lesson: ["ঋণের জন্য ফোনের নম্বর লাগে না। যে অ্যাপ এসব চায়, পরে ওগুলো দিয়েই ভয় দেখায়।", "A loan doesn't need your contacts. An app that wants them will use them to frighten you later."],
        },
      },
    },
  },
  {
    key: "sms_part_time",
    kind: "sms",
    from: ["HR-Online", "HR-Online"],
    body: ["Good news!! পার্ট টাইম জব। দিনে ৩০০০-৫০০০ টাকা ইনকাম। মোবাইল দিয়েই কাজ। যোগ দিন: http://earn-daily.winn/join", "Good news!! Part time job. Earn Tk 3000-5000 a day. Work from your mobile. Join: http://earn-daily.winn/join"],
    nodes: {
      start: {
        who: "h",
        say: ["মোবাইল দিয়েই দিনে পাঁচ হাজার? এত সহজ?", "Five thousand a day from a mobile phone? That easy?"],
        options: [
          { text: ["লিংকে যোগ দিই।", "Join through the link."], go: "group" },
          { text: ["উত্তরে অফিসের ঠিকানা চাই।", "Reply and ask for the office address."], go: "addr" },
          { text: ["মুছে দিই।", "Delete it."], out: { sense: 2, lesson: ["চেনা নেই, অফিস নেই, আয় বিশাল। এমন মেসেজ মুছে দেওয়াই ভালো।", "Nobody you know, no office, huge earnings. It's best to delete a message like that."] } },
        ],
      },
      group: {
        who: "o",
        say: ["স্বাগতম! প্রথম কাজের আগে আপনার আইডি চালু করতে বারোশো টাকা জমা দিন।", "Welcome! Before your first task, deposit 1,200 taka to activate your ID."],
        options: [
          { text: ["জমা দিই।", "Make the deposit."], go: "lost" },
          { text: ["কাজের আগে জমা? থাক।", "A deposit before work? No thanks."], go: "caught" },
        ],
      },
      addr: {
        who: "o",
        say: ["অফিস অনলাইনে, ঠিকানা লাগে না। এখনই যোগ না দিলে আসন শেষ।", "The office is online, no address needed. Join now or the places run out."],
        options: [
          { text: ["আচ্ছা, যোগ দিই।", "All right, I'll join."], go: "group" },
          { text: ["ঠিকানা ছাড়া নয়।", "Not without an address."], go: "caught" },
        ],
      },
      lost: {
        who: "h",
        say: ["জমা দিলাম। পর্দায় আয় বাড়ছে, কিন্তু তোলা যাচ্ছে না।", "I made the deposit. The earnings rise on screen, but I can't withdraw them."],
        out: {
          mobile: -1200,
          sense: 1,
          later: "later_task_more",
          lesson: ["কাজের আগে জমা চাইলে সেটা কাজ নয়। পর্দার সংখ্যা দেখে আর টাকা ঢালবেন না।", "A deposit before work means it isn't work. Don't put in more because of a number on a screen."],
        },
      },
      caught: {
        who: "h",
        say: ["মুছে দিলাম। কাজ করলে টাকা আমার পাওয়ার কথা, দেওয়ার নয়।", "I deleted it. Work should pay me, not cost me."],
        out: {
          sense: 3,
          lesson: ["আসল কাজে আপনি বেতন পান, জমা দেন না। ঠিকানা না থাকাটাও বড় চিহ্ন।", "In real work you get paid, you don't make deposits. Having no address is a big sign too."],
        },
      },
    },
  },
  {
    key: "sms_free_data_dial",
    kind: "sms",
    from: ["Data-Offer", "Data-Offer"],
    body: ["আপনার মোবাইল কোম্পানির পক্ষ থেকে ফ্রি ২০ জিবি! চালু করতে ডায়াল করুন **21*01745 00921#", "Free 20 GB from your mobile company! To activate dial **21*01745 00921#"],
    nodes: {
      start: {
        who: "h",
        say: ["বিশ জিবি ফ্রি! শুধু একটা কোড ডায়াল করলেই হবে?", "Twenty gigs free! I just dial one code?"],
        options: [
          { text: ["কোডটা ডায়াল করি।", "Dial the code."], go: "dial" },
          { text: ["কোম্পানির অ্যাপে অফার খুঁজি।", "Look for the offer in the company's app."], go: "offer" },
          { text: ["মুছে দিই।", "Delete it."], out: { sense: 2, lesson: ["অচেনা মেসেজের কোড ডায়াল না করে ভালোই করলেন। অফার থাকলে কোম্পানির অ্যাপে দেখা যায়।", "Good that you didn't dial a code from a strange message. Real offers show in the company's app."] } },
        ],
      },
      dial: {
        who: "h",
        say: ["ডেটা তো এল না। কিন্তু আমার ফোনে আর কোনো কল আসছে না!", "No data came. But now no calls are reaching my phone!"],
        options: [
          { text: ["হয়তো সময় নিচ্ছে, অপেক্ষা করি।", "Maybe it takes time, I'll wait."], go: "lost" },
          { text: ["কোম্পানির দোকানে গিয়ে বন্ধ করাই।", "Go to the company's shop and get it stopped."], go: "shop" },
        ],
      },
      lost: {
        who: "h",
        say: ["যাচাইয়ের কলগুলো ওদের কাছে চলে গেছে। ব্যালান্স কমে গেল!", "The verification calls went to them. My balance has dropped!"],
        out: {
          mobile: -2500,
          sense: 1,
          later: "later_sim_dead",
          lesson: ["অচেনা কোড ডায়াল করলে আপনার কল অন্যের কাছে চলে যেতে পারে। অফার দেখুন কোম্পানির অ্যাপে।", "Dialling a strange code can send your calls to someone else. Look for offers in the company's own app."],
        },
      },
      shop: {
        who: "h",
        say: ["দোকানে কল চলে যাওয়াটা বন্ধ করে দিল। সময়মতো বেঁচে গেলাম।", "The shop stopped my calls being diverted. I got out in time."],
        out: {
          sense: 2,
          lesson: ["হঠাৎ কল আসা বন্ধ হলে দেরি করবেন না। কোম্পানির দোকানে গিয়ে কল ফরোয়ার্ড বন্ধ করান।", "If calls suddenly stop coming, don't wait. Have call forwarding stopped at the company's shop."],
        },
      },
      offer: {
        who: "h",
        say: ["অ্যাপে এমন কোনো অফার নেই। তাহলে মেসেজটা ভুয়া।", "There's no such offer in the app. So the message is fake."],
        out: {
          sense: 3,
          lesson: ["কোম্পানির নিজের অ্যাপে মিলিয়ে নেওয়াই সেরা পথ। কোড ডায়াল করার আগে একবার দেখে নিন।", "Checking in the company's own app is the best way. Look there before you dial any code."],
        },
      },
    },
  },
  {
    key: "sms_scholarship",
    kind: "sms",
    from: ["Global-Scholar", "Global-Scholar"],
    body: ["অভিনন্দন! আপনার পরিবারের শিক্ষার্থীর জন্য ১০০% ফুল ফ্রি স্কলারশিপ। আবেদন ফি মাত্র ১,০০০ টাকা। শেষ সময় আজ রাত ১২টা। http://free-scholar.topp/apply", "Congratulations! 100% full free scholarship for the student in your family. Application fee only Tk 1,000. Deadline midnight tonight. http://free-scholar.topp/apply"],
    nodes: {
      start: {
        who: "h",
        say: ["পুরো বিনা খরচে পড়ার সুযোগ? কিন্তু আবেদনেই টাকা চাইছে।", "A chance to study completely free? But the application itself costs money."],
        options: [
          { text: ["লিংকে আবেদন করি।", "Apply through the link."], go: "form" },
          { text: ["চেনা শিক্ষককে দেখাই।", "Show it to a teacher I know."], go: "teacher" },
          { text: ["মুছে দিই।", "Delete it."], out: { sense: 2, lesson: ["ফ্রি বৃত্তিতে আবেদনের ফি কেন? মুছে ভালোই করলেন, পরের বার শিক্ষককেও দেখান।", "Why a fee for a free scholarship? Deleting it was good. Next time show a teacher too."] } },
        ],
      },
      form: {
        who: "h",
        say: ["ফর্মে ফি ছাড়াও পরিচয়পত্র আর সনদের ছবি চাইছে।", "Besides the fee, the form wants pictures of ID and certificates."],
        options: [
          { text: ["সব দিয়ে দিই।", "Give it all."], go: "lost" },
          { text: ["আগে যাচাই করি।", "Check first."], go: "teacher" },
        ],
      },
      lost: {
        who: "h",
        say: ["সব পাঠালাম। ফি কেটে নিয়ে পেজটা আর খুলছে না।", "I sent it all. They took the fee and the page won't open any more."],
        out: {
          mobile: -1000,
          sense: 1,
          later: "later_scholarship_docs",
          lesson: ["এখন টাকার সাথে কাগজও ওদের হাতে। বৃত্তির খবর আগে শিক্ষকের কাছে যাচাই করুন।", "Now they have your papers as well as your money. Check scholarship news with a teacher first."],
        },
      },
      teacher: {
        who: "h",
        say: ["শিক্ষক বললেন, আসল বৃত্তির খবর এভাবে আসে না। মেসেজটা মুছে দিলাম।", "The teacher says real scholarship news doesn't come like this. I deleted the message."],
        out: {
          sense: 3,
          lesson: ["আসল বৃত্তির নাম আর নিয়ম খোলা থাকে, শিক্ষকেরাও জানেন। রাতের মধ্যে তাড়া দেয় না।", "Real scholarships are open about their name and rules, and teachers know them. They don't rush you by midnight."],
        },
      },
    },
  },
  {
    key: "sms_electric_cut",
    kind: "sms",
    from: ["Power-Office", "Power-Office"],
    body: ["প্রিয় গ্রাহক, আপনার বিদ্যুৎ বিল বকেয়া। আজ রাত ৯টায় সংযোগ বিচ্ছিন্ন হবে। এখনই যোগাযোগ করুন অফিসার: 01715 00623", "Dear customer, your electricity bill is overdue. Your connection will be cut at 9 tonight. Contact the officer now: 01715 00623"],
    nodes: {
      start: {
        who: "h",
        say: ["আজ রাতেই লাইন কাটবে? গত মাসের বিল তো দিয়েছি।", "They'll cut the line tonight? I paid last month's bill."],
        options: [
          { text: ["অফিসারকে ফোন করি।", "Ring the officer."], go: "phone" },
          { text: ["রসিদ নিয়ে বিদ্যুৎ অফিসে যাই।", "Take my receipt to the electricity office."], go: "office" },
          { text: ["মুছে দিই।", "Delete it."], out: { sense: 1, lesson: ["ভালো করেছেন। তবু রসিদটা একবার মিলিয়ে নিন, আসল বিল থাকলে অফিসে জানা যায়।", "Good. Still, check your receipt once. The office can tell you if a bill is real."] } },
        ],
      },
      phone: {
        who: "o",
        say: ["বিল নয়শো টাকা বাকি। এই নম্বরে ঝটপট টাকা পাঠান, লাইন কাটা আমি আটকে দিচ্ছি।", "900 taka is due. Send it to this number by Jhotpot Taka and I'll stop the cut-off."],
        options: [
          { text: ["পাঠাই।", "Send it."], go: "lost" },
          { text: ["আমার মিটার নম্বর বলুন।", "Tell me my meter number."], go: "meter" },
        ],
      },
      meter: {
        who: "o",
        say: ["মিটার নম্বর পরে মেলাব, এখন সময় নেই। লাইন কাটলে আবার হাজার টাকা লাগবে।", "We'll match the meter later, there's no time now. Once it's cut, reconnecting costs a thousand."],
        options: [
          { text: ["আচ্ছা, পাঠাই।", "All right, send it."], go: "lost" },
          { text: ["নম্বর ছাড়া নয়, অফিসে যাচ্ছি।", "Not without the number. I'm going to the office."], go: "office" },
        ],
      },
      lost: {
        who: "h",
        say: ["পাঠালাম। পরে অফিসে শুনলাম, আমার কোনো বিল বাকিই ছিল না।", "I sent it. Later the office told me I owed nothing at all."],
        out: {
          mobile: -900,
          sense: 1,
          lesson: ["ব্যক্তিগত নম্বরে বিল নেওয়া হয় না। লাইন কাটার ভয় দেখালে আগে রসিদ আর অফিসে যাচাই করুন।", "Bills aren't paid to a personal number. If they threaten to cut you off, check your receipt and the office."],
        },
      },
      office: {
        who: "h",
        say: ["অফিস বলল, বিল পরিশোধই আছে। এই নম্বর তাদের নয়।", "The office says the bill's all paid. That number isn't theirs."],
        out: {
          sense: 3,
          lesson: ["মিটার নম্বর লেখেনি, ব্যক্তিগত নম্বর, রাতের ভয়, এতেই ধরা পড়ল। রসিদ রাখলে যাচাই সহজ।", "No meter number, a personal number and a deadline tonight gave it away. Keeping receipts makes checking easy."],
        },
      },
    },
  },
  {
    key: "sms_wifi_free",
    kind: "sms",
    from: ["Free-City-WiFi", "Free-City-WiFi"],
    body: ["শহরের ফ্রি ওয়াইফাই এখন আপনার এলাকায়! FREE_DHAKA_NET এ যুক্ত হয়ে ঝটপট টাকা নম্বর ও ওটিপি দিয়ে লগইন করুন।", "Free city Wi-Fi is now in your area! Join FREE_DHAKA_NET and log in with your Jhotpot Taka number and OTP."],
    nodes: {
      start: {
        who: "h",
        say: ["ফ্রি ইন্টারনেট পেলে তো ভালোই। কিন্তু ওটিপি কেন?", "Free internet would be nice. But why an OTP?"],
        options: [
          { text: ["যুক্ত হয়ে লগইন করি।", "Join and log in."], go: "login" },
          { text: ["আশপাশের দোকানে জিজ্ঞেস করি।", "Ask at a nearby shop."], go: "ask" },
          { text: ["নিজের ডেটাই চালাই, মুছে দিই।", "Use my own data and delete this."], out: { sense: 2, lesson: ["ইন্টারনেট দিতে টাকার হিসাবের কোড লাগে না। টাকার কাজে নিজের ডেটাই নিরাপদ।", "Internet access doesn't need a code for your money. For anything with money, your own data is safer."] } },
        ],
      },
      login: {
        who: "h",
        say: ["পেজ ঝটপট টাকার নম্বর নিল। এখন ফোনে একটা কোড এসেছে।", "The page took my Jhotpot Taka number. Now a code's come to my phone."],
        options: [
          { text: ["কোডটা বসিয়ে দিই।", "Enter the code."], go: "lost" },
          { text: ["ওয়াইফাই বন্ধ করে বেরিয়ে যাই।", "Turn off the Wi-Fi and leave."], go: "leave" },
        ],
      },
      ask: {
        who: "o",
        say: ["এখানে তো এমন কিছু নেই। কেউ নিজের ফোন থেকে ওই নামে ওয়াইফাই ছেড়েছে হয়তো।", "There's nothing like that here. Maybe someone's running Wi-Fi by that name off their own phone."],
        out: {
          sense: 3,
          lesson: ["ওয়াইফাইয়ের নাম যে কেউ বানাতে পারে। পাশের মানুষকে জিজ্ঞেস করলেই সত্যিটা জানা যায়।", "Anyone can give Wi-Fi any name. Asking the people nearby gets you the truth."],
        },
      },
      lost: {
        who: "h",
        say: ["কোড দিতেই ইন্টারনেট এল, আর ঝটপট টাকা থেকে টাকাও গেল।", "As soon as I entered the code the internet came, and money left my Jhotpot Taka."],
        out: {
          mobile: -800,
          sense: 1,
          lesson: ["ফ্রি ওয়াইফাইয়ে লগইনের জন্য ওটিপি লাগে না। ওই কোড আসলে আপনার অ্যাকাউন্টের চাবি।", "Free Wi-Fi needs no OTP to log in. That code is really the key to your account."],
        },
      },
      leave: {
        who: "h",
        say: ["বেরিয়ে এলাম। কোডটা কাউকে দিইনি, পিনও বদলে নিলাম।", "I got out. I gave the code to nobody, and I changed my PIN too."],
        out: {
          sense: 2,
          lesson: ["কোড না দিলে ওরা ঢুকতে পারে না। তবু সাবধানে পিন বদলে নেওয়া ভালো কাজ।", "Without the code they can't get in. Even so, changing your PIN was a careful thing to do."],
        },
      },
    },
  },
  ...MESSAGES2,
  ...MESSAGES_REAL,
];
