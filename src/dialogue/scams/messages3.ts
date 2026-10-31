import type { Scam } from "../types";

/** Messages that are really what they say, so that not everything is suspect. Doubting one costs a little.
 *  Use MESSAGES from messages.ts, which already includes these. */
export const MESSAGES_REAL: Scam[] = [
  {
    key: "sms_real_delivery",
    kind: "sms",
    real: true,
    from: ["ডেলিভারি সার্ভিস", "Delivery Service"],
    body: ["আপনার অর্ডার #৪৫১৭ আজ বিকাল ৩-৬টার মধ্যে পৌঁছাবে। পণ্য দেখে ডেলিভারিম্যানকে ৬৮০ টাকা দিন। কোনো লিংক বা অগ্রিম লাগবে না।", "Your order #4517 will arrive today between 3 and 6 pm. Check the goods, then pay the delivery man Tk 680. No link or advance needed."],
    nodes: {
      start: {
        who: "h",
        say: ["আগেই তো অর্ডার দিয়েছিলাম। আবার টাকার কথা বলছে।", "I did place an order earlier. And it mentions money."],
        options: [
          { text: ["অর্ডারের নম্বর মিলিয়ে দেখি।", "Match it against my order number."], go: "check" },
          { text: ["ভুয়া ভেবে কল ধরব না।", "It must be fake, I won't answer the rider."], go: "wrong" },
        ],
      },
      check: {
        who: "h",
        say: ["অর্ডারের পাতায় একই নম্বর, একই টাকা। হাতে পেয়ে দেখে দেব।", "Same number and same amount on my order page. I'll pay once I've seen it."],
        out: {
          sense: 2,
          lesson: ["নিজের জানা অর্ডার, মিলে যাওয়া নম্বর, লিংক বা অগ্রিম নেই, এগুলোই আসল মেসেজের চিহ্ন।", "An order you know of, a matching number, no link and no advance: those are the signs of a real message."],
        },
      },
      wrong: {
        who: "h",
        say: ["পার্সেল ফেরত গেল। আবার পাঠাতে বাড়তি খরচ দিতে হলো।", "The parcel went back. I had to pay extra to have it sent again."],
        out: {
          money: -100,
          sense: 1,
          lesson: ["সব মেসেজ ভুয়া নয়। নিজের অর্ডারের পাতায় মিলিয়ে দেখলে এক মিনিটেই জানা যেত।", "Not every message is fake. Checking your own order page would have told you in a minute."],
        },
      },
    },
  },
  {
    key: "sms_real_balance",
    kind: "sms",
    real: true,
    from: ["ঝটপট টাকা", "Jhotpot Taka"],
    body: ["ক্যাশ ইন সফল। টাকা ২,০০০.০০, এজেন্ট দোকান নং ২১৭। নতুন ব্যালান্স ২,৪৫০.৫০ টাকা। TrxID 8KD3MZ1P", "Cash in successful. Tk 2,000.00, agent shop no. 217. New balance Tk 2,450.50. TrxID 8KD3MZ1P"],
    nodes: {
      start: {
        who: "h",
        say: ["এইমাত্র দোকানে টাকা ভরলাম। মেসেজটা ঠিক তো?", "I've just put money in at the shop. Is this message right?"],
        options: [
          { text: ["অ্যাপে ব্যালান্স মিলিয়ে দেখি।", "Match it against the balance in the app."], go: "check" },
          { text: ["ভুয়া মনে হচ্ছে, দোকানিকে ধরি।", "It feels fake, I'll confront the shopkeeper."], go: "wrong" },
        ],
      },
      check: {
        who: "h",
        say: ["অ্যাপেও একই ব্যালান্স। সব ঠিক আছে।", "The app shows the same balance. All's well."],
        out: {
          sense: 2,
          lesson: ["নিজের করা লেনদেনের মেসেজ আসাটাই স্বাভাবিক। ব্যালান্সে মিললে আর চিন্তা নেই।", "A message about your own transaction is normal. If the balance agrees, there's nothing to worry about."],
        },
      },
      wrong: {
        who: "o",
        say: ["টাকা তো ঢুকেছে, ব্যালান্স দেখুন! সবার সামনে এভাবে বললেন, খারাপ লাগল।", "The money went in, check your balance! Saying that in front of everyone hurt."],
        out: {
          rep: -2,
          sense: 1,
          lesson: ["সন্দেহ করা ভালো, তবে আগে যাচাই। ব্যালান্স দেখলেই হতো, মানুষকে দোষ দেওয়ার দরকার ছিল না।", "Doubt is fine, but check first. Your balance would have settled it, with no need to accuse anyone."],
        },
      },
    },
  },
  {
    key: "sms_real_friend",
    kind: "sms",
    real: true,
    from: ["সুমন (বন্ধু)", "Sumon (friend)"],
    body: ["খবর আছে!! চাকরিটা হয়ে গেছে। শুক্রবার সন্ধ্যায় মোড়ের চায়ের দোকানে চা খাওয়াব, চলে এসো।", "News!! I got the job. Friday evening the tea's on me at the corner stall, come along."],
    nodes: {
      start: {
        who: "h",
        say: ["সুমনের চেনা নম্বর। টাকা চায়নি, লিংকও নেই।", "It's Sumon's usual number. He isn't asking for money, and there's no link."],
        options: [
          { text: ["অভিনন্দন জানিয়ে ফোন করি।", "Ring to congratulate him."], go: "call" },
          { text: ["আইডি হ্যাক ভেবে ব্লক করি।", "Assume he's been hacked and block him."], go: "wrong" },
        ],
      },
      call: {
        who: "o",
        say: ["হ্যাঁ, সত্যি! শুক্রবার আসতেই হবে, চায়ের বিল আমার!", "Yes, really! You have to come on Friday, the tea's on me!"],
        out: {
          sense: 1,
          rep: 1,
          lesson: ["চেনা নম্বর, টাকার কথা নেই, লিংক নেই। এমন খুশির খবরে ভয়ের কিছু নেই।", "A number you know, no money asked, no link. There's nothing to fear in good news like this."],
        },
      },
      wrong: {
        who: "h",
        say: ["শুক্রবার সবাই গেল, আমি গেলাম না। সুমন খুব কষ্ট পেয়েছে।", "Everyone went on Friday except me. Sumon was really hurt."],
        out: {
          rep: -2,
          sense: 1,
          lesson: ["ফাঁদের চিহ্ন হলো টাকা, লিংক, তাড়া। কিছুই না থাকলে একটা ফোন করে দেখলেই হয়।", "The signs of a trap are money, links and hurry. If there's none of that, a quick call settles it."],
        },
      },
    },
  },
  {
    key: "sms_real_clinic",
    kind: "sms",
    real: true,
    from: ["কমিউনিটি ক্লিনিক", "Community Clinic"],
    body: ["আগামীকাল সকাল ১০টায় ডাক্তারের সিরিয়াল নং ৭। আগের রিপোর্ট সাথে আনবেন। ফি ক্লিনিকে দেবেন, কোনো অগ্রিম নেই।", "Tomorrow 10 am, doctor's queue number 7. Bring your earlier reports. Pay the fee at the clinic, no advance."],
    nodes: {
      start: {
        who: "h",
        say: ["ক্লিনিকে তো গত সপ্তাহে নাম লিখিয়েছিলাম।", "I did put my name down at the clinic last week."],
        options: [
          { text: ["কার্ডের নম্বরে ফোন করে মিলিয়ে নিই।", "Ring the number on my clinic card to check."], go: "check" },
          { text: ["ভুয়া হতে পারে, যাব না।", "It could be fake, I won't go."], go: "wrong" },
        ],
      },
      check: {
        who: "o",
        say: ["হ্যাঁ, কাল সকাল দশটায় আপনার সিরিয়াল। রিপোর্টটা আনবেন, টাকা এখানে এসে দেবেন।", "Yes, your turn is at ten tomorrow morning. Bring the report, and pay when you get here."],
        out: {
          sense: 2,
          lesson: ["কার্ডে ছাপা নম্বরে ফোন করে যাচাই করাই ঠিক পথ। আগাম টাকা না চাইলে ভয়ের কিছু নেই।", "Ringing the number printed on your card is the right way to check. With no advance asked, there's little to fear."],
        },
      },
      wrong: {
        who: "h",
        say: ["সিরিয়াল চলে গেছে। আবার নতুন টিকিট কাটতে হলো।", "My turn was missed. I had to buy a new ticket."],
        out: {
          money: -150,
          sense: 1,
          lesson: ["আসল মেসেজ টাকা আগে চায় না। কার্ডের নম্বরে একটা ফোনেই মিলে যেত, সিরিয়ালও যেত না।", "A real message doesn't ask for money first. One call to the card's number would have settled it and saved your turn."],
        },
      },
    },
  },
  {
    key: "sms_real_own_code",
    kind: "sms",
    real: true,
    from: ["ঝটপট টাকা", "Jhotpot Taka"],
    body: ["আপনার লগইন কোড ৬০৪১৭৩। আপনি না চাইলে কাউকে দেবেন না। ঝটপট টাকা কখনো কোড চায় না।", "Your login code is 604173. If you didn't ask for it, give it to no one. Jhotpot Taka never asks for codes."],
    nodes: {
      start: {
        who: "h",
        say: ["এইমাত্র নতুন ফোনে অ্যাপে ঢুকছিলাম, তাই কোড এল।", "I was just logging in on a new phone, so a code came."],
        options: [
          { text: ["অ্যাপে নিজেই কোডটা বসাই।", "Enter the code in the app myself."], go: "ok" },
          { text: ["ভয়ে দোকানে দৌড়াই।", "Panic and run to the shop."], go: "wrong" },
        ],
      },
      ok: {
        who: "h",
        say: ["ঢুকে গেলাম। কোডটা শুধু অ্যাপেই গেল, কারো কানে নয়।", "I'm in. The code went only into the app, into nobody's ear."],
        out: {
          sense: 2,
          lesson: ["নিজে চাইলে কোড আসবেই, সেটা নিজের অ্যাপেই বসান। ফোনে কেউ চাইলে তখনই ভুয়া।", "If you asked, a code will come, so enter it in your own app. If someone asks for it by phone, that's when it's fake."],
        },
      },
      wrong: {
        who: "h",
        say: ["অর্ধেক দিন গেল, রিকশা ভাড়াও গেল। কোডটা আসলে আমারই ছিল।", "Half a day and the rickshaw fare gone. The code was mine all along."],
        out: {
          money: -80,
          sense: 1,
          lesson: ["নিজে চাইলে কোড আসা ভয়ের নয়। না চাইতে এলে তখন পিন বদলে হেল্পলাইনে জানান।", "A code you asked for is nothing to fear. If one comes unasked, change your PIN and tell the helpline."],
        },
      },
    },
  },
  {
    key: "sms_real_bill",
    kind: "sms",
    real: true,
    from: ["বিদ্যুৎ অফিস", "Electricity Office"],
    body: ["গ্রাহক নং ২২৮৪১৭: এই মাসের বিল ৬৪৫ টাকা। শেষ তারিখ ২৫ তারিখ। ব্যাংক বা অনুমোদিত দোকানে দিন।", "Customer no. 228417: this month's bill is Tk 645. Last date is the 25th. Pay at a bank or an approved shop."],
    nodes: {
      start: {
        who: "h",
        say: ["বিলের মেসেজ? গ্রাহক নম্বরটা তো আমারই।", "A bill message? That customer number is mine."],
        options: [
          { text: ["কাগজের বিলে মিলিয়ে নিয়মমতো দিই।", "Match it with the paper bill and pay as usual."], go: "ok" },
          { text: ["ভুয়া ভেবে পাত্তা দিই না।", "Assume it's fake and ignore it."], go: "wrong" },
        ],
      },
      ok: {
        who: "h",
        say: ["কাগজের বিলে একই টাকা। দোকানে দিয়ে রসিদ নিলাম।", "The paper bill shows the same amount. I paid at the shop and took a receipt."],
        out: {
          sense: 2,
          lesson: ["গ্রাহক নম্বর মিলছে, লিংক নেই, ব্যক্তিগত নম্বর নেই। আসল বিল চিনবেন এভাবেই।", "The customer number matches, with no link and no personal number. That's how to spot a real bill."],
        },
      },
      wrong: {
        who: "h",
        say: ["পরের মাসের বিলে জরিমানা যোগ হয়ে এল।", "Next month's bill came with a late fine added."],
        out: {
          money: -120,
          sense: 1,
          lesson: ["উপেক্ষা না করে কাগজের বিল বা আগের রসিদে মিলিয়ে দেখুন। যাচাই করাই নিয়ম, উড়িয়ে দেওয়া নয়।", "Don't ignore it: compare with the paper bill or an old receipt. The rule is to check, not to dismiss."],
        },
      },
    },
  },
  {
    key: "sms_real_bus_ticket",
    kind: "sms",
    real: true,
    from: ["বাস কাউন্টার", "Bus Counter"],
    body: ["টিকিট নিশ্চিত। আসন C4, ঢাকা থেকে রাত ৯:৩০। টিকিট নং ৭৭২১। কাউন্টারে এই নম্বর দেখান। ধন্যবাদ।", "Ticket confirmed. Seat C4, from Dhaka at 9:30 pm. Ticket no. 7721. Show this number at the counter. Thank you."],
    nodes: {
      start: {
        who: "h",
        say: ["সকালে যে টিকিট কাটলাম, এটা তারই তো?", "This must be for the ticket I bought this morning?"],
        options: [
          { text: ["রসিদের সাথে মিলিয়ে দেখি।", "Match it with my receipt."], go: "ok" },
          { text: ["ফাঁদ হতে পারে, টিকিট বাতিল করি।", "It could be a trap, I'll cancel the ticket."], go: "wrong" },
        ],
      },
      ok: {
        who: "h",
        say: ["রসিদে একই আসন, একই সময়। ঠিকই আছে।", "The receipt shows the same seat and time. It's all correct."],
        out: {
          sense: 2,
          lesson: ["নিজের কেনা জিনিসের খবর, টাকা বা লিংকের কথা নেই। রসিদে মিললে নিশ্চিন্ত থাকুন।", "News about something you bought, with no money or link involved. If it matches your receipt, relax."],
        },
      },
      wrong: {
        who: "h",
        say: ["বাতিল করতে গিয়ে দুইশো টাকা কেটে নিল। মেসেজটা আসলই ছিল।", "Cancelling cost me two hundred taka. The message was real after all."],
        out: {
          money: -200,
          sense: 1,
          lesson: ["ভয়ে কিছু বাতিল করার আগে যাচাই করুন। রসিদ পকেটেই ছিল, দেখে নিলেই হতো।", "Before cancelling anything out of fear, check. The receipt was in your pocket all along."],
        },
      },
    },
  },
  {
    key: "sms_real_water_notice",
    kind: "sms",
    real: true,
    from: ["পানি সরবরাহ অফিস", "Water Supply Office"],
    body: ["আগামীকাল সকাল ১০টা থেকে দুপুর ২টা পর্যন্ত মেরামতের জন্য আপনার এলাকায় পানি বন্ধ থাকবে। আগে পানি ধরে রাখুন।", "Tomorrow from 10 am to 2 pm the water will be off in your area for repairs. Store some water beforehand."],
    nodes: {
      start: {
        who: "h",
        say: ["কাল পানি বন্ধ? টাকার কথা নেই, লিংকও নেই।", "No water tomorrow? There's no mention of money, and no link."],
        options: [
          { text: ["পাশের বাসায় জিজ্ঞেস করি।", "Ask the neighbours."], go: "ok" },
          { text: ["ভুয়া ভেবে পাত্তা দিই না।", "Assume it's fake and ignore it."], go: "wrong" },
        ],
      },
      ok: {
        who: "o",
        say: ["হ্যাঁ, অফিসের লোক নোটিশও লাগিয়ে গেছে। পানি ধরে রাখুন।", "Yes, someone from the office put up a notice too. Better store some water."],
        out: {
          sense: 2,
          rep: 1,
          lesson: ["টাকা চায়নি, লিংক নেই, প্রতিবেশীর কথায় মিলে গেল। এমন খবর বিশ্বাস করা যায়।", "No money asked, no link, and the neighbours agree. News like that can be trusted."],
        },
      },
      wrong: {
        who: "h",
        say: ["দুপুরে পানি নেই। দোকান থেকে জার কিনতে হলো।", "No water at midday. I had to buy jars from the shop."],
        out: {
          money: -100,
          sense: 1,
          lesson: ["ফাঁদ টাকা চায়, এটা চায়নি। পাশের বাসায় একটা প্রশ্নেই জানা যেত।", "A trap asks for money, and this one didn't. One question to the neighbours would have told you."],
        },
      },
    },
  },
];
