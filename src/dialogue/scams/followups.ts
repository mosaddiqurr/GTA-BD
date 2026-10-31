import type { Scam } from "../types";

/** The ones that come back. Each only fires when an `Outcome.later` names it, and each has a way out. */
export const FOLLOWUPS: Scam[] = [
  {
    key: "later_sucker_list",
    kind: "call",
    followUp: true,
    from: ["+880 1819 00462", "+880 1819 00462"],
    nodes: {
      start: {
        who: "o",
        say: ["আপনার আগের লেনদেনটা অসম্পূর্ণ রয়ে গেছে। আজ না মেটালে নম্বরটা কালো তালিকায় যাবে।", "Your last transaction was left unfinished. Settle it today or your number goes on the blacklist."],
        options: [
          { text: ["কত টাকা লাগবে?", "How much will it take?"], go: "amount" },
          { text: ["আগের লেনদেন মানে কোনটা?", "Which last transaction?"], go: "which" },
          { text: ["নম্বরটা নিয়ে থানায় যাব।", "I'm taking this number to the police."], go: "report" },
        ],
      },
      amount: {
        who: "o",
        say: ["মাত্র দেড় হাজার টাকা। পাঠালেই আগের সব টাকাও ফেরত আসবে।", "Just 1,500 taka. Send it and all the earlier money comes back too."],
        options: [
          { text: ["ঠিক আছে, পাঠাচ্ছি।", "All right, I'm sending it."], go: "lost" },
          { text: ["ফেরত দিতে টাকা লাগবে কেন?", "Why would a refund cost money?"], go: "which" },
          { text: ["না, আগে ব্যাংকে জিজ্ঞেস করব।", "No, I'll ask at the bank first."], go: "report" },
        ],
      },
      which: {
        who: "o",
        say: ["এত কথা বলার সময় নেই। আজকের পর ফাইলটা আর খোলা যাবে না।", "There's no time for all this talk. After today the file can't be reopened."],
        options: [
          { text: ["আচ্ছা, পাঠাচ্ছি।", "Fine, I'm sending it."], go: "lost" },
          { text: ["কেটে দিচ্ছি, থানায় জানাব।", "I'm hanging up and telling the police."], go: "report" },
        ],
      },
      lost: {
        who: "o",
        say: ["পেয়েছি। আপনার ফাইল এখন প্রক্রিয়ায় আছে, পরে জানাব।", "Got it. Your file is in process now, we'll let you know."],
        out: {
          mobile: -1500,
          sense: 1,
          later: "later_recovery_agent",
          lesson: ["একবার ঠকলে নম্বরটা ওদের তালিকায় ওঠে, তাই আবার ফোন আসে। আর টাকা নয়, থানায় জানান।", "Once you've been cheated your number goes on their list, which is why they ring again. No more money: tell the police."],
        },
      },
      report: {
        who: "h",
        say: ["নম্বরটা লিখে নিলাম। থানায় গিয়ে বলে দেব।", "I've written the number down. I'll go and tell the police."],
        out: {
          sense: 3,
          rep: 1,
          lesson: ["কালো তালিকা বলে কিছু নেই, ওটা ভয় দেখানোর কৌশল। ঠকা লজ্জার নয়, জানালে অন্যরাও বাঁচে।", "There is no blacklist, it's just a way to scare you. Being cheated is no shame, and telling someone protects others too."],
        },
      },
    },
  },
  {
    key: "later_recovery_agent",
    kind: "call",
    followUp: true,
    from: ["অর্থ উদ্ধার সেবা", "Money Recovery Service"],
    nodes: {
      start: {
        who: "o",
        say: ["আমরা অর্থ উদ্ধার সেবা থেকে বলছি। আপনার খোয়া যাওয়া টাকা আমরা ফিরিয়ে আনতে পারি।", "We're calling from the Money Recovery Service. We can get back the money you lost."],
        options: [
          { text: ["সত্যি ফেরত পাব? কত লাগবে?", "I'd really get it back? How much?"], go: "fee" },
          { text: ["আমার কথা জানলেন কী করে?", "How do you know about me?"], go: "how" },
          { text: ["ব্যাংক আর থানাতেই যাব।", "I'll go to the bank and the police."], go: "bank" },
        ],
      },
      how: {
        who: "o",
        say: ["প্রতারকদের কাছ থেকে পাওয়া তালিকায় আপনার নাম আছে। আমরা অনুমতি নিয়েই কাজ করি।", "Your name is on a list taken from the fraudsters. We work with full permission."],
        options: [
          { text: ["তাদের তালিকা আপনার হাতে কেন?", "Why do you have their list?"], go: "caught" },
          { text: ["আচ্ছা, ফি কত?", "All right, what's the fee?"], go: "fee" },
        ],
      },
      fee: {
        who: "o",
        say: ["ফি মাত্র দুই হাজার টাকা। কাল সন্ধ্যার মধ্যে পুরো টাকা ঘরে বসেই পাবেন।", "The fee is only 2,000 taka. You'll have it all back by tomorrow evening, without leaving home."],
        options: [
          { text: ["পাঠিয়ে দিচ্ছি।", "I'll send it now."], go: "lost" },
          { text: ["টাকা উদ্ধার হলে তারপর ফি দেব।", "I'll pay once the money's recovered."], go: "after" },
          { text: ["না, ব্যাংকে যাব।", "No, I'm going to the bank."], go: "bank" },
        ],
      },
      after: {
        who: "o",
        say: ["না, নিয়ম নেই। আগে ফি না দিলে ফাইল খোলা যাবে না। আজই শেষ সুযোগ।", "No, that's not the rule. Without the fee first, the file can't be opened. Today's your last chance."],
        options: [
          { text: ["ঠিক আছে, পাঠাচ্ছি।", "All right, I'm sending it."], go: "lost" },
          { text: ["তাহলে থাক, থানায় যাচ্ছি।", "Then forget it, I'm going to the police."], go: "bank" },
        ],
      },
      caught: {
        who: "o",
        say: ["এত সন্দেহ করলে আপনারই ক্ষতি। ওই টাকা আর কোনোদিন পাবেন না।", "All this suspicion only hurts you. You'll never see that money now."],
        out: {
          sense: 3,
          lesson: ["আগে ফি নিয়ে টাকা উদ্ধারের কথা বলাটাই ফাঁদ। হারানো টাকার জন্য থানায় জিডি করুন।", "Promising recovery for a fee up front is the trap. For lost money, file a report with the police."],
        },
      },
      lost: {
        who: "o",
        say: ["ফি পেয়েছি, ধন্যবাদ। কাজ শুরু হয়ে গেছে, ফোন খোলা রাখবেন।", "Fee received, thank you. Work has begun, keep your phone on."],
        out: {
          mobile: -2000,
          sense: 1,
          lesson: ["উদ্ধার এজেন্ট প্রতারকেরই আরেক রূপ। হারানো টাকার জন্য যে আগে ফি চায়, সে আবার ঠকায়।", "A recovery agent is the fraudster in another form. Whoever asks a fee to find lost money is cheating you again."],
        },
      },
      bank: {
        who: "h",
        say: ["কেউ ফি নিয়ে টাকা ফেরায় না। আমি নিজেই অভিযোগ করব।", "Nobody returns money for a fee. I'll make the complaint myself."],
        out: {
          sense: 3,
          rep: 1,
          lesson: ["ঠিক কাজ। থানায় জিডি করুন, আর ব্যাংক বা হেল্পলাইনে লেনদেনের তথ্য দিন।", "Right call. File a report with the police, and give the transaction details to the bank or helpline."],
        },
      },
    },
  },
  {
    key: "later_loan_in_name",
    kind: "call",
    followUp: true,
    from: ["ঋণ আদায় বিভাগ", "Loan Collection Department"],
    nodes: {
      start: {
        who: "o",
        say: ["আপনার নামে নেওয়া পঞ্চাশ হাজার টাকার ঋণের কিস্তি বাকি। আজই দুই হাজার টাকা দিন।", "An instalment is due on the 50,000 taka loan in your name. Pay 2,000 taka today."],
        options: [
          { text: ["আমি তো কোনো ঋণ নিইনি!", "I never took any loan!"], go: "deny" },
          { text: ["কোন প্রতিষ্ঠানের ঋণ? কাগজ দেখান।", "Which lender? Show me the papers."], go: "paper" },
          { text: ["ব্যাংকে গিয়ে খোঁজ নিচ্ছি।", "I'll go and check at the bank."], go: "bank" },
        ],
      },
      deny: {
        who: "o",
        say: ["আপনার পরিচয়পত্রের ছবি আমাদের কাছে আছে। অস্বীকার করলে মামলা হবে, ভেবে বলুন।", "We have a picture of your ID card. Deny it and there'll be a case, so think before you speak."],
        options: [
          { text: ["ঝামেলা চাই না, কিছু দিয়ে দিই।", "I don't want trouble, I'll pay something."], go: "lost" },
          { text: ["কোন প্রতিষ্ঠান? কাগজ দেখান।", "Which lender? Show me the papers."], go: "paper" },
          { text: ["তাহলে থানায় জিডি করব।", "Then I'll file a report with the police."], go: "bank" },
        ],
      },
      paper: {
        who: "o",
        say: ["কাগজ অফিসে আছে, পরে পাঠাব। আগে কিস্তিটা দিন, নইলে নাম খেলাপির তালিকায় উঠবে।", "The papers are at the office, we'll send them later. Pay first, or your name goes on the defaulters' list."],
        options: [
          { text: ["আচ্ছা, দিচ্ছি।", "All right, I'll pay."], go: "lost" },
          { text: ["কাগজ ছাড়া এক টাকাও না।", "Not one taka without the papers."], go: "bank" },
        ],
      },
      lost: {
        who: "o",
        say: ["ধন্যবাদ। আগামী মাসের কিস্তিটা মনে রাখবেন।", "Thank you. Do remember next month's instalment."],
        out: {
          money: -2000,
          sense: 1,
          later: "later_sucker_list",
          lesson: ["যে ঋণ নেননি তার টাকা দিলে সেটাই মেনে নেওয়া হয়। ব্যাংকে খোঁজ নিন, থানায় জিডি করুন।", "Paying for a loan you never took is as good as accepting it. Check at the bank and file a police report."],
        },
      },
      bank: {
        who: "h",
        say: ["ব্যাংক বলল, আমার নামে কোনো ঋণ নেই। থানায় জিডি করে রাখলাম।", "The bank says there's no loan in my name. I've filed a police report."],
        out: {
          sense: 3,
          rep: 1,
          lesson: ["পরিচয়পত্রের ছবি কারো হাতে গেলে এমন ভয় দেখানো যায়। না নেওয়া ঋণের টাকা দেবেন না।", "If someone has a picture of your ID they can frighten you like this. Never pay for a loan you didn't take."],
        },
      },
    },
  },
  {
    key: "later_bank_second_call",
    kind: "call",
    followUp: true,
    from: ["ব্যাংক জালিয়াতি দমন বিভাগ", "Bank Fraud Department"],
    nodes: {
      start: {
        who: "o",
        say: ["আমরা ব্যাংকের জালিয়াতি দমন বিভাগ। আপনার কার্ড থেকে টাকা গেছে, এখনই সাহায্য লাগবে।", "This is the bank's fraud department. Money has left your card and you need help right now."],
        options: [
          { text: ["হ্যাঁ, গেছে! ফেরত পাব?", "Yes, it went! Can I get it back?"], go: "back" },
          { text: ["কে বলছেন, কোন শাখা?", "Who's speaking, which branch?"], go: "branch" },
          { text: ["কার্ডের পেছনের নম্বরে ফোন করছি।", "I'm calling the number on the back of the card."], go: "callback" },
        ],
      },
      back: {
        who: "o",
        say: ["পাবেন, চিন্তা নেই। এইমাত্র একটা কোড গেছে, ওটা বললে লেনদেনটা উল্টে দেব।", "You will, don't worry. A code just went to you. Read it out and I'll reverse the payment."],
        options: [
          { text: ["বলছি, লিখে নিন।", "I'll read it, write it down."], go: "lost" },
          { text: ["উল্টাতে আমার কোড লাগবে কেন?", "Why would a reversal need my code?"], go: "branch" },
          { text: ["ব্যাংকে গিয়ে করব।", "I'll do it at the bank."], go: "callback" },
        ],
      },
      branch: {
        who: "o",
        say: ["আমরা প্রধান কার্যালয়ের লোক, শাখার সাথে সম্পর্ক নেই। দেরি করলে বাকি টাকাও যাবে।", "We're head office, nothing to do with branches. Delay and the rest of your money goes too."],
        options: [
          { text: ["আচ্ছা, কোডটা বলছি।", "All right, I'll read the code."], go: "lost" },
          { text: ["না, নিজে ব্যাংকে যাচ্ছি।", "No, I'm going to the bank myself."], go: "callback" },
        ],
      },
      lost: {
        who: "o",
        say: ["কোড মিলেছে। লাইনে থাকুন, প্রক্রিয়া চলছে।", "The code matches. Stay on the line, it's being processed."],
        out: {
          money: -3000,
          sense: 1,
          later: "later_recovery_agent",
          lesson: ["কোড দিলে টাকা ফেরে না, আরও যায়। কার্ড বন্ধ করতে পেছনের নম্বরে নিজে ফোন করুন।", "Giving a code never brings money back, it takes more. To stop the card, ring the number on its back yourself."],
        },
      },
      callback: {
        who: "h",
        say: ["পেছনের নম্বরে ফোন করে কার্ড বন্ধ করালাম।", "I rang the number on the back and had the card stopped."],
        out: {
          sense: 3,
          lesson: ["আসল ব্যাংক কোড চায় না। যে নম্বর আপনি নিজে খুঁজে পেয়েছেন, শুধু সেটাতেই ভরসা করুন।", "A real bank never asks for a code. Only trust a number you found yourself."],
        },
      },
    },
  },
  {
    key: "later_prize_bigger",
    kind: "call",
    followUp: true,
    from: ["পুরস্কার বিতরণ কমিটি", "Prize Committee"],
    nodes: {
      start: {
        who: "o",
        say: ["অভিনন্দন! আপনার পুরস্কার বেড়ে দশ লাখ টাকা হয়েছে। শুধু ছাড়পত্রের ফি বাকি আছে।", "Congratulations! Your prize has grown to ten lakh taka. Only the clearance fee is left."],
        options: [
          { text: ["আবার ফি? কত?", "Another fee? How much?"], go: "amount" },
          { text: ["আগের টাকাটাই তো পেলাম না।", "I never even got the first money."], go: "old" },
          { text: ["অভিযোগ করব, আর ফোন করবেন না।", "I'm complaining. Don't ring again."], go: "report" },
        ],
      },
      amount: {
        who: "o",
        say: ["মাত্র তিন হাজার টাকা। আজ দিলে কাল সকালে বাড়িতে চেক পৌঁছে যাবে।", "Just 3,000 taka. Pay today and the cheque reaches your home tomorrow morning."],
        options: [
          { text: ["ঠিক আছে, দিচ্ছি।", "All right, I'll pay."], go: "lost" },
          { text: ["পুরস্কার থেকে কেটে রাখুন।", "Take it out of the prize."], go: "deduct" },
          { text: ["না, থাক।", "No, forget it."], go: "report" },
        ],
      },
      old: {
        who: "o",
        say: ["সেটা এই ফির সাথেই আসবে। এখন না দিলে আগের টাকাও বাতিল হয়ে যাবে।", "That comes with this fee. If you don't pay now, the earlier money is cancelled too."],
        options: [
          { text: ["বাতিল হলে হোক।", "Then let it be cancelled."], go: "report" },
          { text: ["আচ্ছা, দিচ্ছি।", "Fine, I'll pay."], go: "lost" },
          { text: ["পুরস্কার থেকে কেটে রাখুন।", "Take it out of the prize."], go: "deduct" },
        ],
      },
      deduct: {
        who: "o",
        say: ["নিয়মে সেটা হয় না, সরকারি ফি আলাদা জমা দিতে হয়। বুঝতেই তো পারছেন।", "The rules don't allow that, government fees are paid separately. I'm sure you understand."],
        options: [
          { text: ["বুঝেছি, এটা প্রতারণা।", "I understand. This is a scam."], go: "report" },
          { text: ["তাহলে দিচ্ছি।", "Then I'll pay."], go: "lost" },
        ],
      },
      lost: {
        who: "o",
        say: ["পেয়েছি। এখন বাকি থাকল শুধু ব্যাংক চার্জ, কাল জানাব।", "Received. Now there's only the bank charge left, I'll tell you tomorrow."],
        out: {
          money: -3000,
          sense: 1,
          later: "later_recovery_agent",
          lesson: ["প্রতি ধাপে নতুন ফি আসে, পুরস্কার আসে না। যে খেলায় নামেননি তাতে জেতা যায় না।", "Every step brings a new fee and never the prize. You can't win a game you never entered."],
        },
      },
      report: {
        who: "h",
        say: ["নম্বরটা ব্লক করলাম। মোবাইল কোম্পানিকেও জানিয়ে দেব।", "I've blocked the number. I'll tell my mobile company too."],
        out: {
          sense: 3,
          lesson: ["পুরস্কার থেকেই ফি কাটা যেত। কাটে না, কারণ পুরস্কারই নেই। নম্বরটা কোম্পানিকে জানান।", "The fee could come out of the prize. It doesn't, because there is no prize. Report the number to your company."],
        },
      },
    },
  },
  {
    key: "later_customs_second_fee",
    kind: "call",
    followUp: true,
    from: ["কাস্টমস গুদাম", "Customs Warehouse"],
    nodes: {
      start: {
        who: "o",
        say: ["কাস্টমস গুদাম থেকে বলছি। ফি পেয়েছি, কিন্তু দেরির জন্য গুদাম ভাড়া জমেছে। আড়াই হাজার লাগবে।", "This is the customs warehouse. We got the fee, but storage charges built up. It's 2,500 taka more."],
        options: [
          { text: ["আবার টাকা? আচ্ছা, পাঠাচ্ছি।", "More money? All right, I'm sending it."], go: "lost" },
          { text: ["পার্সেলটা কে পাঠিয়েছে বলুন তো?", "Tell me, who sent this parcel?"], go: "who" },
          { text: ["কাস্টমস অফিসে এসে দেব।", "I'll pay at the customs office."], go: "office" },
        ],
      },
      who: {
        who: "o",
        say: ["বিদেশ থেকে আপনার এক শুভাকাঙ্ক্ষী পাঠিয়েছেন। ভেতরে দামি জিনিস, তাই এত সতর্কতা।", "A well-wisher of yours abroad sent it. There are valuables inside, hence all the care."],
        options: [
          { text: ["তাঁর নামটা বলুন।", "Tell me the name."], go: "name" },
          { text: ["আচ্ছা, টাকা পাঠাচ্ছি।", "All right, I'm sending the money."], go: "lost" },
        ],
      },
      name: {
        who: "o",
        say: ["নাম বলা নিষেধ। টাকা না দিলে পার্সেল নিলামে উঠবে, আর আপনার নামে মামলা হবে।", "I can't give the name. Don't pay and the parcel goes to auction, and a case goes in your name."],
        options: [
          { text: ["তাহলে অফিসে আসছি, ঠিকানা দিন।", "Then I'm coming in. Give me the address."], go: "office" },
          { text: ["পাঠাচ্ছি, মামলা চাই না।", "I'm sending it, I don't want a case."], go: "lost" },
        ],
      },
      office: {
        who: "o",
        say: ["অফিসে আসার দরকার নেই, ওখানে কেউ কিছু জানবে না। শুধু টাকাটা পাঠান।", "No need to come in, nobody there will know anything. Just send the money."],
        options: [
          { text: ["বুঝে গেছি। কেটে দিয়ে থানায় জানাচ্ছি।", "Now I see. I'm hanging up and telling the police."], out: { sense: 3, rep: 1, lesson: ["অফিস নিজেই জানে না, এই কথাতেই ধরা পড়ল। ফোনে আসা শুল্কের কথা অফিসে গিয়ে যাচাই করুন।", "Saying the office won't know gave it away. Check any customs call by going to the office in person."] } },
          { text: ["আচ্ছা, পাঠাচ্ছি।", "All right, I'm sending it."], go: "lost" },
        ],
      },
      lost: {
        who: "o",
        say: ["পেয়েছি। ডেলিভারির ছাড়পত্র হয়ে গেলে জানাব।", "Received. We'll tell you when delivery is cleared."],
        out: {
          money: -2500,
          sense: 1,
          later: "later_recovery_agent",
          lesson: ["কাস্টমসের টাকা কখনো ব্যক্তিগত নম্বরে যায় না। যে পার্সেল চেনেন না, তার ফিও দেবেন না।", "Customs money never goes to a personal number. Don't pay fees on a parcel you know nothing about."],
        },
      },
    },
  },
  {
    key: "later_fake_lawyer",
    kind: "call",
    followUp: true,
    from: ["আদালতের উকিল", "Court Lawyer"],
    nodes: {
      start: {
        who: "o",
        say: ["আমি উকিল বলছি। আপনার নামের মামলাটা আমার হাতে এসেছে, চাইলে আজই মিটিয়ে দিতে পারি।", "This is a lawyer speaking. The case in your name has come to me, and I can settle it today if you like."],
        options: [
          { text: ["কীভাবে মিটবে? কত লাগবে?", "How? How much will it take?"], go: "amount" },
          { text: ["মামলার নম্বর আর কোন আদালত?", "What's the case number, which court?"], go: "case" },
          { text: ["থানায় গিয়ে নিজেই খোঁজ নেব।", "I'll go and check with the police myself."], go: "police" },
        ],
      },
      case: {
        who: "o",
        say: ["এসব ফোনে বলা যায় না, গোপন নথি। খোঁজ নিতে গেলে উল্টো গ্রেফতার হতে পারেন।", "That can't be said by phone, it's confidential. If you go asking, you could be the one arrested."],
        options: [
          { text: ["তাহলে টাকা দিয়েই মেটাই।", "Then I'd better settle it with money."], go: "amount" },
          { text: ["থানায় খোঁজ নিলে সমস্যা কী?", "What's wrong with asking the police?"], go: "police" },
        ],
      },
      amount: {
        who: "o",
        say: ["আদালতের খরচ মিলিয়ে চার হাজার টাকা। আমার নিজের নম্বরে পাঠান, রসিদ পরে পাবেন।", "With court costs it's 4,000 taka. Send it to my own number, you'll get a receipt later."],
        options: [
          { text: ["পাঠিয়ে দিচ্ছি।", "I'll send it now."], go: "lost" },
          { text: ["রসিদ ছাড়া টাকা দেব না।", "No receipt, no money."], go: "police" },
        ],
      },
      lost: {
        who: "o",
        say: ["পেয়েছি। আর কাউকে বলবেন না, তাহলে মামলা আবার খুলে যাবে।", "Received. Don't tell anyone, or the case will open again."],
        out: {
          mobile: -4000,
          sense: 1,
          later: "later_recovery_agent",
          lesson: ["আদালতের টাকা ব্যক্তিগত নম্বরে যায় না। মামলা আছে কি না থানায় বা আদালতে জেনে নিন।", "Court money doesn't go to a personal number. Find out at the police station or the court if there's any case."],
        },
      },
      police: {
        who: "h",
        say: ["থানায় খোঁজ নিলাম। আমার নামে কোনো মামলাই নেই।", "I checked with the police. There's no case in my name at all."],
        out: {
          sense: 3,
          rep: 1,
          lesson: ["কাউকে না বলতে বলা আর ফোনে টাকা চাওয়া, দুটোই প্রতারণার চিহ্ন। নম্বরটা থানায় দিয়ে আসুন।", "Being told to keep quiet and being asked for money by phone are both signs of fraud. Give the number to the police."],
        },
      },
    },
  },
  {
    key: "later_sim_dead",
    kind: "sms",
    followUp: true,
    from: ["+880 1914 00733", "+880 1914 00733"],
    body: ["আপনার SIM নতুন ডিভাইসে চালু হয়েছে। আপনি না করে থাকলে ১০ মিনিটের মধ্যে এখানে ব্লক করুন: http://sim-raksha.clikk/stop", "Your SIM was activated on a new device. If it wasn't you, block it here within 10 minutes: http://sim-raksha.clikk/stop"],
    nodes: {
      start: {
        who: "h",
        say: ["ফোনে নেটওয়ার্ক নেই, আবার এই মেসেজ। কী করি?", "No signal on my phone, and now this message. What do I do?"],
        options: [
          { text: ["লিংকে গিয়ে ব্লক করি।", "Go to the link and block it."], go: "link" },
          { text: ["ওই নম্বরে ফোন করি।", "Ring that number."], go: "number" },
          { text: ["পরিচয়পত্র নিয়ে কোম্পানির দোকানে যাই।", "Take my ID to the company's shop."], go: "shop" },
        ],
      },
      link: {
        who: "h",
        say: ["পেজটা ঝটপট টাকার পিন আর পরিচয়পত্রের নম্বর চাইছে।", "The page wants my Jhotpot Taka PIN and ID number."],
        options: [
          { text: ["পিন দিয়ে দিই।", "Give the PIN."], go: "lost" },
          { text: ["না, বন্ধ করে দোকানে যাই।", "No, close it and go to the shop."], go: "shop" },
        ],
      },
      number: {
        who: "o",
        say: ["আমরা সিম সুরক্ষা দল। ঝটপট টাকার পিন বলুন, আমরা লেনদেন আটকে দিচ্ছি।", "We're the SIM protection team. Tell us your Jhotpot Taka PIN and we'll block the transactions."],
        options: [
          { text: ["পিন বলছি।", "I'll give the PIN."], go: "lost" },
          { text: ["পিন কাউকে বলি না।", "I never tell anyone my PIN."], go: "shop" },
        ],
      },
      lost: {
        who: "h",
        say: ["টাকা কাটার মেসেজ এল! ব্যালান্স প্রায় খালি।", "A deduction message came in! My balance is nearly empty."],
        out: {
          mobile: -3000,
          sense: 1,
          later: "later_loan_in_name",
          lesson: ["নেটওয়ার্ক হঠাৎ গেলে সিম চুরি হতে পারে। সোজা কোম্পানির দোকানে যান, পিন কোথাও দেবেন না।", "A sudden loss of signal can mean a stolen SIM. Go straight to the company's shop and give your PIN to no one."],
        },
      },
      shop: {
        who: "h",
        say: ["দোকানে আঙুলের ছাপ দিয়ে সিম ফিরে পেলাম, ঝটপট টাকাও আটকে দিলাম।", "At the shop I gave my fingerprint, got my SIM back, and locked Jhotpot Taka too."],
        out: {
          sense: 3,
          rep: 1,
          lesson: ["হঠাৎ নেটওয়ার্ক গেলে দেরি নয়। পরিচয়পত্র নিয়ে দোকানে যান, হেল্পলাইনে লেনদেন আটকান।", "If your signal suddenly dies, don't wait. Take your ID to the shop and have the helpline block transactions."],
        },
      },
    },
  },
  {
    key: "later_loan_shame_again",
    kind: "sms",
    followUp: true,
    from: ["দ্রুত ঋণ অ্যাপ", "Quick Loan App"],
    body: ["আজ বিকালের মধ্যে ৩,২০০ টাকা শোধ না করলে আপনার ফোনের সব নম্বরে জানানো হবে আপনি ঋণখেলাপি ও প্রতারক। আপনার ছবিও যাবে।", "Pay 3,200 taka by this afternoon or every number in your phone will be told you are a defaulter and a cheat. Your photo goes too."],
    nodes: {
      start: {
        who: "h",
        say: ["আমার সব আত্মীয়কে মেসেজ পাঠাবে বলছে! কী লজ্জার কথা।", "They say they'll message all my relatives! How shameful."],
        options: [
          { text: ["লজ্জা এড়াতে টাকা পাঠাই।", "Send the money to avoid the shame."], go: "paying" },
          { text: ["নিজেই সবাইকে আগে জানিয়ে দিই।", "Tell everyone myself first."], go: "tell" },
          { text: ["অ্যাপ মুছে থানায় যাই।", "Delete the app and go to the police."], go: "police" },
        ],
      },
      paying: {
        who: "o",
        say: ["হিসাবে দেখছি সুদ আরও বেড়েছে। আগে তিন হাজার দুইশো দিন, তারপর বাকিটা।", "Our accounts show the interest has grown. Pay the 3,200 first, then the rest."],
        options: [
          { text: ["আচ্ছা, দিয়ে দিই।", "All right, I'll pay."], go: "lost" },
          { text: ["আর না, থানায় যাই।", "No more, I'm going to the police."], go: "police" },
        ],
      },
      lost: {
        who: "h",
        say: ["যত দিই, তত বাড়ে। টাকা গেল, ভয়টা রয়েই গেল।", "The more I pay, the more it grows. The money's gone and the fear stayed."],
        out: {
          mobile: -3200,
          sense: 1,
          lesson: ["এসব অ্যাপের ঋণ শেষ হয় না। টাকা না দিয়ে অ্যাপ মুছুন, সবাইকে বলে থানায় যান।", "These apps' debts never end. Stop paying, delete the app, tell people, and go to the police."],
        },
      },
      tell: {
        who: "h",
        say: ["সবাইকে বললাম, আমার নামে বাজে মেসেজ আসতে পারে। সবাই পাশে দাঁড়াল।", "I told everyone nasty messages about me might come. They all stood by me."],
        out: {
          sense: 3,
          rep: 1,
          lesson: ["ওরা লজ্জা দেখিয়েই টাকা আদায় করে। নিজে আগে জানালে সেই ভয় আর কাজ করে না।", "They collect money by threatening shame. Tell people first and the threat stops working."],
        },
      },
      police: {
        who: "h",
        say: ["অ্যাপ মুছলাম, মেসেজের ছবি তুলে থানায় জিডি করলাম।", "I deleted the app, took pictures of the messages, and filed a police report."],
        out: {
          sense: 3,
          rep: 1,
          lesson: ["ফোনের নম্বর দেখতে চায় এমন ঋণ অ্যাপ নামাবেন না। ভয় দেখালে প্রমাণ রেখে থানায় জানান।", "Never install a loan app that wants your contacts. If it threatens you, keep the evidence and tell the police."],
        },
      },
    },
  },
  {
    key: "later_passport_misuse",
    kind: "call",
    followUp: true,
    from: ["বিদেশ যাওয়া এজেন্সি", "Overseas Agency"],
    nodes: {
      start: {
        who: "o",
        say: ["এজেন্সি থেকে বলছি। ভিসা আটকে গেছে, পাসপোর্ট ফেরত চাইলে তিন হাজার টাকা অফিস খরচ দিন।", "This is the agency. The visa is stuck. If you want the passport back, pay 3,000 taka office costs."],
        options: [
          { text: ["পাসপোর্ট তো ফেরত চাই, দিচ্ছি।", "I need the passport back, I'll pay."], go: "lost" },
          { text: ["অফিসে এসে নেব, ঠিকানা বলুন।", "I'll collect it. Give me the address."], go: "address" },
          { text: ["সরকারি অফিসে অভিযোগ করব।", "I'll complain to the government office."], go: "report" },
        ],
      },
      address: {
        who: "o",
        say: ["অফিস বদল হচ্ছে, এখন আসা যাবে না। দেরি করলে পাসপোর্ট দিয়ে অন্য কাজ হয়ে যেতে পারে।", "The office is moving, you can't come now. Delay and the passport could be used for something else."],
        options: [
          { text: ["কী কাজ হবে?", "Used for what?"], go: "misuse" },
          { text: ["ঠিক আছে, টাকা পাঠাচ্ছি।", "All right, I'm sending the money."], go: "lost" },
          { text: ["এটা তো ভয় দেখানো। অভিযোগ করব।", "That's a threat. I'm complaining."], go: "report" },
        ],
      },
      misuse: {
        who: "o",
        say: ["সে আমি বলতে পারব না। টাকা দিলে ঝামেলা থাকবে না, না দিলে দায় আপনার।", "That I can't say. Pay and there's no trouble. Don't, and it's on you."],
        options: [
          { text: ["আচ্ছা, দিচ্ছি।", "All right, I'll pay."], go: "lost" },
          { text: ["থানায় যাচ্ছি।", "I'm going to the police."], go: "report" },
        ],
      },
      lost: {
        who: "o",
        say: ["পেয়েছি। পাসপোর্ট কুরিয়ারে যাবে, কবে যাবে পরে জানাব।", "Received. The passport will go by courier, we'll tell you when."],
        out: {
          mobile: -3000,
          sense: 1,
          later: "later_recovery_agent",
          lesson: ["পাসপোর্ট আটকে রেখে টাকা চাওয়াই ওদের ব্যবসা। প্রবাসী কল্যাণ অফিসে আর থানায় অভিযোগ করুন।", "Holding passports for money is their business. Complain to the overseas welfare office and the police."],
        },
      },
      report: {
        who: "h",
        say: ["থানায় জিডি করলাম, প্রবাসী কল্যাণ অফিসেও অভিযোগ দিলাম।", "I filed a police report and complained to the overseas welfare office too."],
        out: {
          sense: 3,
          rep: 2,
          lesson: ["পাসপোর্ট আটকে টাকা চাওয়া অপরাধ। পাসপোর্ট দেওয়ার আগে এজেন্সি সরকারি অফিসে যাচাই করুন।", "Holding a passport for money is a crime. Check an agency at the government office before you hand one over."],
        },
      },
    },
  },
  {
    key: "later_scholarship_docs",
    kind: "sms",
    followUp: true,
    from: ["আন্তর্জাতিক বৃত্তি বোর্ড", "International Scholarship Board"],
    body: ["অভিনন্দন! আসন নিশ্চিত। ভিসা জামানত ২,৫০০ টাকা ১২ ঘণ্টায় না দিলে বৃত্তি বাতিল ও আবেদন ফি বাজেয়াপ্ত হবে। পাঠান: 01644 00275", "Congratulations! Seat confirmed. Pay the 2,500 taka visa deposit within 12 hours or the scholarship is cancelled and your application fee forfeited. Send to: 01644 00275"],
    nodes: {
      start: {
        who: "h",
        say: ["আবার টাকা চাইছে। আগের ফি তো দেওয়াই হয়েছে।", "They want money again. The first fee was already paid."],
        options: [
          { text: ["পাঠিয়ে দিই, এতদূর এসেছি।", "Send it, I've come this far."], go: "lost" },
          { text: ["উত্তরে জিজ্ঞেস করি, কোন বিশ্ববিদ্যালয়?", "Reply and ask which university."], go: "ask" },
          { text: ["চেনা কোনো শিক্ষককে দেখাই।", "Show it to a teacher I know."], go: "teacher" },
        ],
      },
      ask: {
        who: "o",
        say: ["বিশ্ববিদ্যালয়ের নাম ভিসার আগে বলা নিষেধ। সময় চলে যাচ্ছে, এখনই জামানত দিন।", "The university's name can't be given before the visa. Time is running out, pay the deposit now."],
        options: [
          { text: ["আচ্ছা, পাঠাই।", "All right, I'll send it."], go: "lost" },
          { text: ["শিক্ষককে দেখাই আগে।", "I'll show a teacher first."], go: "teacher" },
        ],
      },
      lost: {
        who: "h",
        say: ["টাকা পাঠালাম। ওই নম্বর এখন বন্ধ দেখাচ্ছে।", "I sent the money. That number now shows as switched off."],
        out: {
          mobile: -2500,
          sense: 1,
          later: "later_recovery_agent",
          lesson: ["বৃত্তি দেয় যে, সে টাকা চায় না। যে বিশ্ববিদ্যালয়ের নামই বলে না, সেটা বৃত্তি নয়।", "Whoever gives a scholarship doesn't ask for money. If they won't name the university, it's no scholarship."],
        },
      },
      teacher: {
        who: "h",
        say: ["শিক্ষক বললেন, এমন বোর্ডই নেই। মেসেজটা থানায় দেখিয়ে এলাম।", "The teacher says there's no such board. I showed the message to the police."],
        out: {
          sense: 3,
          rep: 1,
          lesson: ["বৃত্তির খবর আগে শিক্ষকের কাছে যাচাই করুন। যে কাগজ পাঠিয়ে ফেলেছেন, তা থানায় জানিয়ে রাখুন।", "Check scholarship news with a teacher first. Tell the police about any papers you've already sent."],
        },
      },
    },
  },
  {
    key: "later_charity_again",
    kind: "call",
    followUp: true,
    from: ["ত্রাণ তহবিল", "Relief Fund"],
    nodes: {
      start: {
        who: "o",
        say: ["গতবারের দানের জন্য ধন্যবাদ। আপনি আমাদের বিশেষ দাতা। এবার নৌকার জন্য আরও এক হাজার লাগবে।", "Thank you for your last gift. You're one of our special donors. This time the boats need another 1,000."],
        options: [
          { text: ["ভালো কাজে দিচ্ছি।", "It's a good cause, I'll give."], go: "lost" },
          { text: ["আগের টাকার রসিদ দিন।", "Give me a receipt for last time."], go: "receipt" },
          { text: ["চেনা দলে দেব, আর ফোন নয়।", "I'll give to people I know. Don't ring again."], go: "report" },
        ],
      },
      receipt: {
        who: "o",
        say: ["মানুষ পানিতে আটকে আছে আর আপনি রসিদ চাইছেন? একটু মানবিক হন।", "People are stranded in the water and you're asking for a receipt? Have a little humanity."],
        options: [
          { text: ["দিচ্ছি, মন খারাপ করবেন না।", "I'll give, don't be upset."], go: "lost" },
          { text: ["অফিস কোথায়? আমি গিয়ে দেব।", "Where's the office? I'll give it there."], go: "office" },
        ],
      },
      office: {
        who: "o",
        say: ["অফিসে আসতে হবে না, সবাই মাঠে আছে। এই নম্বরেই পাঠান।", "No need to come in, everyone's out in the field. Just send it to this number."],
        options: [
          { text: ["বুঝেছি, নম্বরটা জানিয়ে দেব।", "I understand. I'm reporting this number."], go: "report" },
          { text: ["আচ্ছা, দিচ্ছি।", "All right, I'll give."], go: "lost" },
        ],
      },
      lost: {
        who: "o",
        say: ["অনেক ধন্যবাদ। আগামী সপ্তাহে আবার জানাব।", "Many thanks. We'll be in touch again next week."],
        out: {
          mobile: -1000,
          sense: 1,
          lesson: ["মনে অপরাধবোধ জাগিয়ে টাকা নেওয়া পুরোনো কৌশল। দান করুন চেনা দলে, রসিদ নিয়ে।", "Making you feel guilty to get money is an old trick. Give to people you know, and take a receipt."],
        },
      },
      report: {
        who: "h",
        say: ["নম্বরটা থানায় দিলাম। দান করব পাড়ার চেনা দলের হাতে।", "I gave the number to the police. I'll give to the local group I know."],
        out: {
          sense: 3,
          rep: 2,
          lesson: ["কে নিচ্ছে, কোথায় যাচ্ছে না জানলে সেটা দান নয়। দুর্যোগের সময় এমন ফোন বাড়ে।", "If you don't know who takes it or where it goes, it isn't charity. These calls rise during disasters."],
        },
      },
    },
  },
  {
    key: "later_bureau_more",
    kind: "call",
    followUp: true,
    from: ["বিয়ের ব্যুরো অফিস", "Marriage Bureau Office"],
    nodes: {
      start: {
        who: "o",
        say: ["খুশির খবর! ওই পরিবার কথা বলতে রাজি। দেখা করার আগে বিশেষ সদস্য ফি দুই হাজার টাকা লাগবে।", "Good news! That family has agreed to talk. Before you meet, there's a 2,000 taka special member fee."],
        options: [
          { text: ["দিচ্ছি, ভালো সম্বন্ধ ছাড়ব না।", "I'll pay, I won't lose a good match."], go: "lost" },
          { text: ["ওই পরিবারের নম্বরটা আগে দিন।", "Give me that family's number first."], go: "number" },
          { text: ["আর টাকা নয়, অভিযোগ করব।", "No more money. I'm complaining."], go: "report" },
        ],
      },
      number: {
        who: "o",
        say: ["নম্বর দেওয়া নিয়মে নেই। ফি দিলে তবেই দেখা হবে, অনেকে লাইনে আছেন।", "Giving numbers is against the rules. Pay the fee and you'll meet. Many others are waiting."],
        options: [
          { text: ["আচ্ছা, দিচ্ছি।", "All right, I'll pay."], go: "lost" },
          { text: ["ঠিকানা দিন, নিজে যাচাই করব।", "Give me an address, I'll check myself."], go: "verify" },
        ],
      },
      verify: {
        who: "o",
        say: ["যাচাই করে কী হবে? এমন সম্বন্ধ আর পাবেন না। আজকের মধ্যে জানান।", "What good would checking do? You won't get a match like this again. Let me know today."],
        options: [
          { text: ["তাহলে থাক, অভিযোগ করব।", "Then forget it. I'm complaining."], go: "report" },
          { text: ["ঠিক আছে, দিচ্ছি।", "All right, I'll pay."], go: "lost" },
        ],
      },
      lost: {
        who: "o",
        say: ["পেয়েছি। আগামী সপ্তাহে ওঁরা আসবেন, তখন উপহারের খরচটাও লাগবে।", "Received. They'll come next week, and then there's the cost of the gifts too."],
        out: {
          mobile: -2000,
          sense: 1,
          lesson: ["ধাপে ধাপে ফি চাওয়াই এদের ব্যবসা। সত্যি সম্বন্ধ হলে পরিবারের ঠিকানায় গিয়ে দেখা যায়।", "Fee after fee is their whole business. A real match has a family and an address you can visit."],
        },
      },
      report: {
        who: "h",
        say: ["আত্মীয়দের জানালাম, থানাতেও অভিযোগ দিলাম।", "I told my relatives and made a complaint to the police."],
        out: {
          sense: 3,
          rep: 1,
          lesson: ["কোনো পরিবারের সাথে দেখা না করিয়ে বারবার ফি চাইলে সেটা ভুয়া। খোঁজ নিন চেনা লোকের মাধ্যমে।", "Fees again and again with no family ever met means it's fake. Look for matches through people you know."],
        },
      },
    },
  },
  {
    key: "later_medicine_more",
    kind: "call",
    followUp: true,
    from: ["ভেষজ চিকিৎসা কেন্দ্র", "Herbal Care Centre"],
    nodes: {
      start: {
        who: "o",
        say: ["আগের কোর্স মাঝপথে থামালে কোনো কাজ হবে না। আরেক কোর্স নিন, আজকের দিনে অর্ধেক দাম।", "Stop the course midway and it won't work at all. Take another one, half price today only."],
        options: [
          { text: ["ঠিক আছে, পাঠান।", "All right, send it."], go: "lost" },
          { text: ["আপনাদের ডাক্তারের নাম কী?", "What's your doctor's name?"], go: "doctor" },
          { text: ["আমি আসল ডাক্তার দেখাব।", "I'll see a real doctor."], go: "clinic" },
        ],
      },
      doctor: {
        who: "o",
        say: ["আমাদের বড় হাকিম, বিদেশে পড়েছেন। হাসপাতালের ডাক্তারদের কথা শুনবেন না, তারা এসব গোপন করেন।", "Our senior healer, trained abroad. Don't listen to hospital doctors, they hide all this."],
        options: [
          { text: ["তবে আরেক কোর্স দিন।", "Then give me another course."], go: "lost" },
          { text: ["ডাক্তারের কথা শুনতে মানা কেন?", "Why shouldn't I listen to a doctor?"], go: "clinic" },
        ],
      },
      lost: {
        who: "o",
        say: ["অগ্রিম পেয়েছি। ওষুধ চলতে থাকুক, হাসপাতালের ওষুধ বন্ধ রাখবেন।", "Advance received. Keep taking it, and keep the hospital's medicine stopped."],
        out: {
          money: -1800,
          sense: 1,
          lesson: ["ডাক্তারের ওষুধ বন্ধ করতে বলাটাই সবচেয়ে বড় বিপদের চিহ্ন। আগে ডাক্তার দেখান, কোর্স নয়।", "Being told to stop a doctor's medicine is the biggest danger sign. See a doctor first, not another course."],
        },
      },
      clinic: {
        who: "h",
        say: ["ডাক্তার দেখালাম। ওই ওষুধ ফেলে নম্বরটা ওষুধ প্রশাসনে জানালাম।", "I saw a doctor. I threw that medicine out and reported the number to the drug office."],
        out: {
          sense: 3,
          rep: 1,
          lesson: ["সব রোগ সারানোর ওষুধ হয় না। মোড়কে অনুমোদন নম্বর নেই এমন ওষুধ খাবেন না।", "No medicine cures everything. Never take one with no approval number on the packet."],
        },
      },
    },
  },
  {
    key: "later_task_more",
    kind: "sms",
    followUp: true,
    from: ["কাজের অ্যাপ সাপোর্ট", "Task App Support"],
    body: ["আপনার আয় ১৪,২৫০ টাকা জমা হয়েছে! তুলতে হলে ভিআইপি ধাপ খুলুন। জমা দিন ২,০০০ টাকা। আজই শেষ। http://kaj-earn.winn/vip", "Your earnings of 14,250 taka are ready! To withdraw, unlock the VIP stage. Deposit 2,000 taka. Today only. http://kaj-earn.winn/vip"],
    nodes: {
      start: {
        who: "h",
        say: ["চৌদ্দ হাজার জমেছে? কিন্তু তুলতে আবার টাকা দিতে হবে।", "Fourteen thousand saved up? But I have to pay to take it out."],
        options: [
          { text: ["দুই হাজার জমা দিই।", "Deposit the 2,000."], go: "deposit", out: { mobile: -2000 } },
          { text: ["আয় থেকে কেটে নিতে বলি।", "Ask them to take it from my earnings."], go: "deduct" },
          { text: ["বন্ধ করে অভিযোগ করি।", "Close it and report them."], go: "report" },
        ],
      },
      deduct: {
        who: "o",
        say: ["সিস্টেমে কাটা যায় না, নিয়ম। আজ জমা না দিলে পুরো আয় বাতিল হবে।", "The system can't deduct it, those are the rules. No deposit today and all your earnings are cancelled."],
        options: [
          { text: ["আচ্ছা, জমা দিই।", "All right, I'll deposit."], go: "deposit", out: { mobile: -2000 } },
          { text: ["তাহলে থাক, অভিযোগ করি।", "Then forget it, I'll report them."], go: "report" },
        ],
      },
      deposit: {
        who: "o",
        say: ["অভিনন্দন, ভিআইপি খুলেছে! এবার শেষ ধাপে আরও তিন হাজার দিলেই সব টাকা তুলতে পারবেন।", "Congratulations, VIP is open! One last stage: another 3,000 and you can withdraw everything."],
        options: [
          { text: ["আর একটু তো, দিয়ে দিই।", "Only a little more, I'll pay."], go: "lost" },
          { text: ["আর না, এবার অভিযোগ করি।", "No more. Now I'm reporting them."], go: "reportLate" },
        ],
      },
      lost: {
        who: "h",
        say: ["আয় দেখাচ্ছে অনেক, কিন্তু অ্যাপ এখন আর খুলছেই না।", "It shows plenty of earnings, but now the app won't even open."],
        out: {
          mobile: -3000,
          sense: 1,
          later: "later_recovery_agent",
          lesson: ["পর্দায় দেখানো সংখ্যা টাকা নয়। আয় তুলতে যে আগে টাকা চায়, সে দেয় না, নেয়।", "A number on a screen isn't money. Whoever wants money before you can withdraw only takes, never gives."],
        },
      },
      reportLate: {
        who: "h",
        say: ["দুই হাজার গেল, তবু থামলাম। অ্যাপ মুছে থানায় জানালাম।", "Two thousand's gone, but I stopped. I deleted the app and told the police."],
        out: {
          sense: 2,
          lesson: ["যে কোনো ধাপে থামা যায়। যা গেছে তা তুলতে আরও ঢালবেন না, এটাই ওদের ভরসা।", "You can stop at any step. Don't pour in more to win back what's gone, that's what they count on."],
        },
      },
      report: {
        who: "h",
        say: ["অ্যাপ মুছে দিলাম। মেসেজের ছবি নিয়ে থানায় জানালাম।", "I deleted the app and took a picture of the message to the police."],
        out: {
          sense: 3,
          rep: 1,
          lesson: ["কাজ করলে টাকা পাবেন, কাজ পেতে টাকা দেবেন না। আগেরটা ফেরাতে আরও ঢালবেন না।", "Work earns you money, it doesn't cost you. Don't pay more to win back what's gone."],
        },
      },
    },
  },
  {
    key: "later_phone_watched",
    kind: "sms",
    followUp: true,
    from: ["+880 1622 00918", "+880 1622 00918"],
    body: ["সতর্কতা! নতুন একটি ডিভাইস থেকে আপনার অ্যাকাউন্টে ঢোকার চেষ্টা হয়েছে। সুরক্ষা আপডেট নামান: http://phone-safe.linkk/fix", "Warning! Someone tried to enter your account from a new device. Download the security update: http://phone-safe.linkk/fix"],
    nodes: {
      start: {
        who: "h",
        say: ["ফোনটা নিজে নিজে জ্বলে উঠছে, আবার এই মেসেজ। কেউ দেখছে নাকি?", "My phone keeps lighting up by itself, and now this message. Is someone watching?"],
        options: [
          { text: ["লিংকের আপডেট নামাই।", "Download the update from the link."], go: "link" },
          { text: ["সেই সহায়তা অ্যাপটা মুছে দিই।", "Delete that support app."], go: "remove" },
          { text: ["ব্যাংক আর হেল্পলাইনে যাই।", "Go to the bank and the helpline."], go: "bank" },
        ],
      },
      link: {
        who: "h",
        say: ["ফোন বলছে, এই অ্যাপ পর্দা দেখতে আর মেসেজ পড়তে চায়।", "The phone says this app wants to see my screen and read my messages."],
        options: [
          { text: ["অনুমতি দিই।", "Allow it."], go: "lost" },
          { text: ["না, মুছে দোকানে নিয়ে যাই।", "No, delete it and take the phone to a shop."], go: "remove" },
        ],
      },
      lost: {
        who: "h",
        say: ["ঝটপট টাকার ব্যালান্স থেকে একের পর এক টাকা যাচ্ছে!", "Money is leaving my Jhotpot Taka balance, payment after payment!"],
        out: {
          mobile: -3000,
          sense: 1,
          later: "later_loan_in_name",
          lesson: ["সহায়তার নামে অ্যাপ নামালে পর্দা অন্যের হাতে যায়। ফোনের দোকান আর হেল্পলাইন ধরুন।", "Installing a so-called support app hands over your screen. Go to a phone shop and the helpline instead."],
        },
      },
      remove: {
        who: "h",
        say: ["অ্যাপটা মুছলাম। অন্য ফোন থেকে পিন বদলে নিলাম।", "I deleted the app and changed my PIN from another phone."],
        out: {
          sense: 2,
          lesson: ["পর্দা দেখার অ্যাপ মুছে অন্য ফোন থেকে পিন বদলান। তারপর হেল্পলাইনে জানিয়ে রাখুন।", "Delete the screen-watching app and change your PIN from another phone. Then tell the helpline."],
        },
      },
      bank: {
        who: "h",
        say: ["ব্যাংকে গিয়ে লেনদেন আটকালাম, ফোন দোকানে পরিষ্কার করালাম।", "I went to the bank and blocked transactions, and had the phone cleaned at a shop."],
        out: {
          sense: 3,
          rep: 1,
          lesson: ["টাকা নিয়ে সন্দেহ হলে আগে ব্যাংক আর হেল্পলাইন। মেসেজের লিংকে ঠিক করার চেষ্টা করবেন না।", "When your money's in doubt, go to the bank and helpline first. Never try to fix things through a link in a message."],
        },
      },
    },
  },
];
