import type { Scam } from "../types";
import { STRANGERS2 } from "./strangers2";

/** Who speaks in each stranger scene, as a voice actor from ACTORS in src/interaction/cast.ts. "woman", "girl"
 *  and "granny" have text only until a woman's voice is approved. */
export const STRANGER_SPEAKER: Record<string, string> = {
  stranger_pension_elder: "elder",
  stranger_garment_bonus: "woman",
  stranger_student_scholarship: "young",
  stranger_shopkeeper_qr: "seller",
  stranger_mother_son_abroad: "woman",
  stranger_rickshaw_lottery: "mid",
  stranger_tea_received: "seller",
  stranger_maid_loan: "woman",
  stranger_granny_allowance: "granny",
  stranger_young_mother_vaccine: "woman",
  stranger_boy_game: "kid",
  stranger_cng_fine: "deep",
  stranger_student_wifi: "girl",
  stranger_shop_stock: "seller",
  stranger_mother_bureau: "woman",
  stranger_elder_sugar: "elder",
  stranger_worker_dubai: "young",
  stranger_student_atm: "young",
  stranger_tailor_relief: "mid",
  stranger_vendor_rumour: "seller",
  stranger_nurse_phone: "woman",
  stranger_elder_remittance: "elder",
};

/** People in the street asking "is this real?". `from` says who they are, and `body` is what they show the hero.
 *  The first eleven are here and the rest in strangers2.ts. STRANGERS holds all of them. */
export const STRANGERS: Scam[] = [
  {
    key: "stranger_pension_elder",
    kind: "stranger",
    from: ["পেনশন নিয়ে চিন্তিত প্রবীণ", "Elderly man worried about his pension"],
    nodes: {
      start: {
        who: "o",
        say: ["শুনুন তো একটু। পেনশন অফিস ফোনে বলল, ওটিপি না দিলে পেনশন বন্ধ। এটা কি সত্যি?", "Listen a moment. The pension office rang and said my pension stops unless I give an OTP. Is that true?"],
        options: [
          { text: ["ওটিপি দেবেন না, এটা প্রতারণা।", "Don't give the OTP, it's a scam."], go: "right" },
          { text: ["দিয়ে দিন, পেনশন আগে।", "Give it, the pension comes first."], go: "wrong" },
          { text: ["কোন নম্বর থেকে ফোন করেছিল?", "What number did they ring from?"], go: "ask" },
        ],
      },
      ask: {
        who: "o",
        say: ["একটা মোবাইল নম্বর থেকে। বলল আজকেই শেষ দিন, আর ছেলেকেও যেন না বলি।", "From a mobile number. They said today's the last day, and that I shouldn't even tell my son."],
        options: [
          { text: ["অফিসে নিজে চলে যান, ফোনে কিছু নয়।", "Go to the office yourself, nothing by phone."], go: "right" },
          { text: ["অফিসের লোকই তো, দিয়ে দিন।", "It's the office, give it to them."], go: "wrong" },
        ],
      },
      right: {
        who: "o",
        say: ["বাঁচালেন। এত বছরের জমানো টাকা, আর একটু হলেই গেছিল। আমি অফিসেই যাব।", "You've saved me. All those years of savings nearly went. I'll go to the office."],
        out: {
          rep: 3,
          sense: 2,
          lesson: ["পেনশন অফিস ফোনে কোড চায় না। কাউকে না বলতে বলাটাই সবচেয়ে বড় চিহ্ন।", "A pension office never asks for a code by phone. Being told to tell nobody is the biggest sign."],
        },
      },
      wrong: {
        who: "o",
        say: ["কোডটা দিলাম। পরে ব্যাংকে গিয়ে দেখি, জমানো টাকা নেই! আপনার কথায় ভরসা করেছিলাম।", "I gave the code. Then at the bank I found my savings gone! I trusted what you said."],
        out: {
          rep: -3,
          sense: 1,
          lesson: ["আপনার কথায় একজন মানুষ সঞ্চয় হারালেন। কোড চাওয়া মানেই প্রতারণা, এটা মনে রাখুন।", "On your word, someone lost their savings. Being asked for a code always means a scam, remember that."],
        },
      },
    },
  },
  {
    key: "stranger_garment_bonus",
    kind: "stranger",
    from: ["পোশাক কারখানার কর্মী", "Garment worker"],
    body: ["কারখানার বোনাস ৫,০০০ টাকা রেডি। ঝটপট টাকা পিন দিয়ে লগইন করে নিন: http://factory-bonus.clikk/get", "Factory bonus of Tk 5,000 is ready. Log in with your Jhotpot Taka PIN to collect: http://factory-bonus.clikk/get"],
    nodes: {
      start: {
        who: "o",
        say: ["কারখানা থেকে এই মেসেজ এল নাকি, দেখুন তো। বোনাস পেলে বাড়িতে টাকা পাঠাতাম।", "Did this message really come from the factory? Have a look. With a bonus I'd send money home."],
        options: [
          { text: ["পিন দেবেন না, হিসাব অফিসে জিজ্ঞেস করুন।", "Don't give your PIN, ask the accounts office."], go: "right" },
          { text: ["বোনাস তো! লিংকে ঢুকে নিন।", "It's a bonus! Open the link and take it."], go: "wrong" },
          { text: ["কারখানা বেতন দেয় কীভাবে?", "How does the factory normally pay you?"], go: "ask" },
        ],
      },
      ask: {
        who: "o",
        say: ["বেতন সোজা আমার ঝটপট টাকায় আসে, কখনো পিন লাগেনি। এই প্রথম লিংক দেখলাম।", "My pay comes straight into my Jhotpot Taka, I've never needed a PIN. This is the first link I've seen."],
        options: [
          { text: ["তাহলে ভুয়া। সুপারভাইজারকে দেখান।", "Then it's fake. Show your supervisor."], go: "right" },
          { text: ["নিয়ম বদলেছে হয়তো, ঢুকে দেখুন।", "Maybe the rules changed, try it."], go: "wrong" },
        ],
      },
      right: {
        who: "o",
        say: ["তাই তো! সুপারভাইজারকে দেখাই, লাইনের সবাইকেও বলে দেব।", "Of course! I'll show the supervisor and tell everyone on my line."],
        out: {
          rep: 3,
          sense: 2,
          lesson: ["আসল বেতন নিজে নিজে আসে। টাকা পেতে পিন লাগে না, লিংকও লাগে না।", "Real pay arrives by itself. Receiving money needs no PIN and no link."],
        },
      },
      wrong: {
        who: "o",
        say: ["পিন দিলাম, মাসের পুরো বেতনটাই চলে গেল। এখন বাড়িতে কী পাঠাব?", "I gave my PIN and the whole month's pay went. What will I send home now?"],
        out: {
          rep: -4,
          sense: 1,
          lesson: ["একজনের মাসের রোজগার গেল। লিংকে পিন চাইলে সব সময় না বলুন, অফিসে যাচাই করতে বলুন।", "A month's earnings are gone. When a link asks for a PIN always say no, and send them to the office to check."],
        },
      },
    },
  },
  {
    key: "stranger_student_scholarship",
    kind: "stranger",
    from: ["বৃত্তির খবরে উত্তেজিত ছাত্র", "Student excited about a scholarship"],
    body: ["ফুল ফান্ড স্কলারশিপ কনফার্ম! আবেদন ফি ২,০০০ টাকা আজই দিন: 01676 00318", "Full-funded scholarship confirmed! Pay the Tk 2,000 application fee today: 01676 00318"],
    nodes: {
      start: {
        who: "o",
        say: ["দেখুন! বিদেশে পড়ার পুরো বৃত্তি পেয়েছি। শুধু দুই হাজার টাকা ফি। টিউশনির টাকাটা দিয়ে দেব?", "Look! I've got a full scholarship abroad. Only a 2,000 taka fee. Shall I pay with my tutoring money?"],
        options: [
          { text: ["যে বৃত্তি দেয়, সে ফি নেয় না।", "Whoever gives a scholarship doesn't take a fee."], go: "right" },
          { text: ["দারুণ! দিয়ে দিন, সুযোগ হারাবেন না।", "Great! Pay it, don't lose the chance."], go: "wrong" },
          { text: ["আবেদন করেছিলেন?", "Had you applied for it?"], go: "ask" },
        ],
      },
      ask: {
        who: "o",
        say: ["না, করিনি। ওরা বলল, রেজাল্ট দেখে বেছে নিয়েছে। এমন হতে পারে না?", "No, I hadn't. They said they picked me from my results. Couldn't that happen?"],
        options: [
          { text: ["আবেদন ছাড়া বৃত্তি হয় না। শিক্ষককে দেখান।", "No application, no scholarship. Show a teacher."], go: "right" },
          { text: ["হতেই পারে, দিয়ে দিন।", "It could happen, go ahead and pay."], go: "wrong" },
        ],
      },
      right: {
        who: "o",
        say: ["ঠিক। শিক্ষককে দেখাই আগে। টিউশনির টাকাটা বেঁচে গেল।", "You're right. I'll show my teacher first. That's my tutoring money saved."],
        out: {
          rep: 3,
          sense: 2,
          lesson: ["আবেদন করেননি, তবু বৃত্তি, আবার ফি, এটাই চিহ্ন। আসল বৃত্তি শিক্ষকেরা চেনেন।", "No application, yet a scholarship, and with a fee: that's the sign. Teachers know the real ones."],
        },
      },
      wrong: {
        who: "o",
        say: ["ফি দিলাম। এখন ওই নম্বর বন্ধ। সারা মাসের টিউশনির টাকা শেষ।", "I paid the fee. Now that number's off. A whole month's tutoring money, gone."],
        out: {
          rep: -3,
          sense: 1,
          lesson: ["ছাত্রের কষ্টের টাকা গেল। স্বপ্ন দেখিয়ে ফি নেওয়া পুরোনো ফাঁদ, আগে যাচাই করতে বলুন।", "A student's hard-earned money is gone. Selling dreams for a fee is an old trap, so tell people to check first."],
        },
      },
    },
  },
  {
    key: "stranger_shopkeeper_qr",
    kind: "stranger",
    from: ["চিন্তিত দোকানি", "Worried shopkeeper"],
    nodes: {
      start: {
        who: "o",
        say: ["গ্রাহকরা বলছে কিউআরে টাকা পাঠিয়েছে, আমার হিসাবে আসে না। স্টিকারটা দেখুন তো, ঠিক আছে?", "Customers say they paid by QR, but it doesn't reach my account. Look at this sticker, is it all right?"],
        options: [
          { text: ["ওপরে আরেকটা স্টিকার মনে হচ্ছে। তুলে দেখুন।", "There seems to be a second sticker on top. Peel it."], go: "right" },
          { text: ["নেটওয়ার্কের সমস্যা, চিন্তা নেই।", "It's a network problem, don't worry."], go: "wrong" },
          { text: ["স্ক্যান করলে কার নাম ওঠে?", "Whose name comes up when you scan it?"], go: "ask" },
        ],
      },
      ask: {
        who: "o",
        say: ["স্ক্যান করলাম, আমার নাম তো নয়! অন্য কারো নাম উঠছে। এটা কীভাবে হলো?", "I scanned it, and it isn't my name! Someone else's comes up. How did this happen?"],
        options: [
          { text: ["কেউ ওপরে নকল স্টিকার লাগিয়েছে। থানায় জানান।", "Someone stuck a fake on top. Tell the police."], go: "right" },
          { text: ["কোম্পানির ভুল হবে, থাক।", "Must be the company's mistake, leave it."], go: "wrong" },
        ],
      },
      right: {
        who: "o",
        say: ["সত্যিই তলায় আমার আসল স্টিকার! এখন থেকে রোজ দেখব, গ্রাহকদেরও বলব নাম মিলিয়ে নিতে।", "My real sticker's underneath! I'll check it daily from now on, and tell customers to match the name."],
        out: {
          rep: 3,
          sense: 2,
          lesson: ["স্ক্যানের পর নাম মিলিয়ে নিন, দোকানিও রোজ স্টিকার দেখুন। নকল লাগানো খুব সহজ।", "Match the name after scanning, and shopkeepers should check their stickers daily. A fake is very easy to stick on."],
        },
      },
      wrong: {
        who: "o",
        say: ["আরও এক সপ্তাহ গেল। ব্যবসার অনেক টাকা অন্যের পকেটে চলে গেল।", "Another week went by. A lot of my takings went into someone else's pocket."],
        out: {
          rep: -3,
          sense: 1,
          lesson: ["টাকা না পৌঁছালে নেটওয়ার্ক ভেবে থামবেন না। স্টিকার তুলে দেখুন, স্ক্যান করে নাম মেলান।", "When money doesn't arrive, don't just blame the network. Peel the sticker, scan it, and match the name."],
        },
      },
    },
  },
  {
    key: "stranger_mother_son_abroad",
    kind: "stranger",
    from: ["চিন্তিত মা", "Worried mother"],
    nodes: {
      start: {
        who: "o",
        say: ["আমার ছেলে মালয়েশিয়ায়। কে যেন ফোনে বলল, ছেলে পুলিশের হাতে, দশ হাজার দিলে ছাড়বে। কী করি?", "My son's in Malaysia. Someone rang to say the police have him and will free him for 10,000. What do I do?"],
        options: [
          { text: ["আগে ছেলের নিজের নম্বরে ফোন করুন।", "First ring your son on his own number."], go: "right" },
          { text: ["দিয়ে দিন, ছেলের ব্যাপার।", "Pay it, this is your son."], go: "wrong" },
          { text: ["ছেলের সাথে কথা বলিয়েছিল?", "Did they let you speak to him?"], go: "ask" },
        ],
      },
      ask: {
        who: "o",
        say: ["না, বলল কথা বলা নিষেধ। পেছনে কান্নার আওয়াজ শুনিয়েছিল শুধু। বুকটা কেঁপে গেছে।", "No, they said talking isn't allowed. I only heard crying in the background. My heart's shaking."],
        options: [
          { text: ["আওয়াজে কিছু বোঝা যায় না। ছেলেকে ফোন করুন।", "A sound proves nothing. Ring your son."], go: "right" },
          { text: ["সময় নেই, পাঠিয়ে দিন।", "There's no time, send it."], go: "wrong" },
        ],
      },
      right: {
        who: "o",
        say: ["ফোন করলাম, ছেলে কাজেই আছে, কিছুই হয়নি! বুকে পানি এল।", "I rang him. He's at work and nothing's happened! What a relief."],
        out: {
          rep: 4,
          sense: 2,
          lesson: ["ভয় পেলে মানুষ ভাবে না, ওরা সেটাই চায়। আগে চেনা নম্বরে ফোন, তারপর অন্য কিছু।", "Fear stops people thinking, and that's what they want. First ring the number you know, then anything else."],
        },
      },
      wrong: {
        who: "o",
        say: ["পাঠালাম। পরে ছেলে ফোন করে বলল, সে তো ঠিকই আছে। দশ হাজার টাকা গেল।", "I sent it. Later my son rang to say he's fine. Ten thousand taka, gone."],
        out: {
          rep: -4,
          sense: 1,
          lesson: ["এক ফোনেই সত্যিটা জানা যেত। স্বজনের বিপদের খবরে আগে তাকে বা পরিবারকে ফোন করতে বলুন।", "One call would have told the truth. When a loved one is said to be in trouble, tell people to ring them first."],
        },
      },
    },
  },
  {
    key: "stranger_rickshaw_lottery",
    kind: "stranger",
    from: ["রিকশাচালক", "Rickshaw puller"],
    nodes: {
      start: {
        who: "o",
        say: ["একজন ফোনে বলল, আমি নাকি মোটরসাইকেল জিতেছি! তিন দিনের জমা দিয়ে দেড় হাজার টাকা কর দেব?", "Someone rang to say I've won a motorcycle! Should I pay 1,500 taka tax with three days' savings?"],
        options: [
          { text: ["দেবেন না। পুরস্কারে আগে টাকা লাগে না।", "Don't. A prize doesn't cost money first."], go: "right" },
          { text: ["মোটরসাইকেল তো! দিয়ে দিন।", "It's a motorcycle! Go on and pay."], go: "wrong" },
          { text: ["কোনো লটারি কিনেছিলেন?", "Did you buy a lottery ticket?"], go: "ask" },
        ],
      },
      ask: {
        who: "o",
        say: ["না, কিনিনি। ওরা বলল, নম্বর দেখে ভাগ্য খুলেছে। আজ সন্ধ্যার মধ্যে দিতে হবে।", "No, I didn't. They said my luck turned from my number. I have to pay by this evening."],
        options: [
          { text: ["না কিনলে জেতা যায় না। নম্বরটা ব্লক করুন।", "No ticket, no win. Block that number."], go: "right" },
          { text: ["ভাগ্য তো খুলতেই পারে, দিন।", "Luck can turn, pay it."], go: "wrong" },
        ],
      },
      right: {
        who: "o",
        say: ["ঠিক বলেছেন। ওই টাকায় বরং ছেলের জন্য খাতা কিনব। রিকশাতেই ভালো আছি।", "You're right. I'll buy my boy some notebooks with that money. I'm fine on my rickshaw."],
        out: {
          rep: 3,
          sense: 2,
          lesson: ["না কিনে লটারি জেতা যায় না, আর পুরস্কার আগে টাকা চায় না। দুটোই মনে রাখলে এই ফাঁদ শেষ।", "You can't win without a ticket, and prizes don't ask money first. Remember both and this trap is over."],
        },
      },
      wrong: {
        who: "o",
        say: ["দিলাম। মোটরসাইকেল তো এল না, ফোনও আর ধরে না। তিন দিন রোদে খেটে পাওয়া টাকা।", "I paid. No motorcycle came, and now they don't answer. Three days' sweat in the sun, for that."],
        out: {
          rep: -3,
          sense: 1,
          lesson: ["গরিব মানুষের কষ্টের টাকা গেল। পুরস্কারের জন্য আগে টাকা চাইলে না বলতে বলুন।", "A poor man's hard-earned money is gone. When a prize wants money first, tell people to say no."],
        },
      },
    },
  },
  {
    key: "stranger_tea_received",
    kind: "stranger",
    from: ["চা বিক্রেতা", "Tea seller"],
    body: ["আপনি ১,৫০০ টাকা পেয়েছেন। TrxID X9K2LP07। ব্যালান্স ১,৫২০ টাকা।", "You have received Tk 1,500. TrxID X9K2LP07. Balance Tk 1,520."],
    nodes: {
      start: {
        who: "o",
        say: ["এই মেসেজের পর একজন ফোনে কাঁদছে, ভুলে টাকা গেছে, ফেরত চায়। দিয়ে দিই? আমি তো ঠকাতে চাই না।", "After this message someone's crying on the phone, says it went by mistake and wants it back. Should I? I'm no cheat."],
        options: [
          { text: ["আগে ব্যালান্স দেখুন, মেসেজ নয়।", "Check your balance first, not the message."], go: "ask" },
          { text: ["হ্যাঁ, ভালো মানুষের মতো দিয়ে দিন।", "Yes, be a good man and send it."], go: "wrong" },
          { text: ["এটা ভুয়া। কিছু পাঠাবেন না।", "It's fake. Don't send anything."], go: "right" },
        ],
      },
      ask: {
        who: "o",
        say: ["দেখি, এই যে। বিশ টাকাই আছে, পনেরোশো তো আসেনি! তাহলে মেসেজটা?", "Let's see, here. There's only twenty taka, the fifteen hundred never came! So that message?"],
        options: [
          { text: ["ভুয়া মেসেজ। নম্বরটা ব্লক করুন।", "A fake message. Block the number."], go: "right" },
          { text: ["পরে আসবে হয়তো, পাঠিয়ে দিন।", "Maybe it comes later, send it anyway."], go: "wrong" },
        ],
      },
      right: {
        who: "o",
        say: ["উফ, আজকের চা বেচা টাকাটা বেঁচে গেল। কাঁদলে মানুষ কত সহজে গলে যায়!", "Whew, today's tea money is safe. How easily a person melts at crying!"],
        out: {
          rep: 3,
          sense: 2,
          lesson: ["ভালো মানুষকেই এরা ধরে। মেসেজ নয়, ব্যালান্সই আসল প্রমাণ।", "It's good people they catch. Your balance is the proof, not a message."],
        },
      },
      wrong: {
        who: "o",
        say: ["পাঠালাম। আজকের সব বিক্রির টাকা চলে গেল। পরে দেখি, ওই পনেরোশো কখনো আসেইনি।", "I sent it. All of today's takings gone. Then I saw the fifteen hundred never came at all."],
        out: {
          rep: -3,
          sense: 1,
          lesson: ["ব্যালান্স না দেখে ফেরত পাঠালে সবটাই যায়। ভুলের টাকা হলে হেল্পলাইন ফেরায়, মানুষ নয়।", "Sending it back without checking the balance loses it all. A real mistake goes through the helpline, not through people."],
        },
      },
    },
  },
  {
    key: "stranger_maid_loan",
    kind: "stranger",
    from: ["বাসাবাড়ির গৃহকর্মী", "Home help"],
    nodes: {
      start: {
        who: "o",
        say: ["ছেলের পরীক্ষার ফির জন্য এই অ্যাপে ঋণ নিতে চাই। ফোনের সব নম্বর দেখার অনুমতি চায়। দিয়ে দিই?", "I want a loan on this app for my son's exam fee. It wants to see all the numbers in my phone. Shall I allow it?"],
        options: [
          { text: ["অনুমতি দেবেন না, এটা ফাঁদ।", "Don't allow it, it's a trap."], go: "right" },
          { text: ["ফির ব্যাপার, দিয়ে দিন।", "It's for the fee, allow it."], go: "wrong" },
          { text: ["আগে কোনো টাকা চেয়েছে?", "Has it asked for any money up front?"], go: "ask" },
        ],
      },
      ask: {
        who: "o",
        say: ["হ্যাঁ, পাঁচশো টাকা আগে দিতে বলছে। আর এক সপ্তাহে শোধ না হলে সবাইকে জানাবে।", "Yes, it wants 500 taka first. And if it isn't repaid in a week, it'll tell everyone."],
        options: [
          { text: ["ঋণ দিতে টাকা নেয় না। সমিতি বা স্কুলে বলুন।", "Lenders don't charge to lend. Try a savings group or the school."], go: "right" },
          { text: ["সবাই তো এভাবেই নেয়, নিয়ে নিন।", "Everyone does it this way, take it."], go: "wrong" },
        ],
      },
      right: {
        who: "o",
        say: ["স্কুলে গিয়ে বললাম, কিস্তিতে ফি দিতে পারব। আর পাশের বাসার একজন সমিতির কথাও বললেন।", "I spoke at the school and I can pay the fee in parts. And a neighbour told me about a savings group."],
        out: {
          rep: 3,
          sense: 2,
          lesson: ["বিপদের সময়েই এই অ্যাপগুলো ধরে। টাকা লাগলে সমিতি, স্কুল বা চেনা মানুষের কাছে আগে বলুন।", "These apps catch people at their neediest. If money's needed, ask a savings group, the school or people you know first."],
        },
      },
      wrong: {
        who: "o",
        say: ["ঋণ নিলাম। এখন বাসার মালিক আর সব আত্মীয়ের কাছে মেসেজ যাচ্ছে, আমি নাকি চোর। কাজটাই যাবে।", "I took it. Now messages go to my employer and all my relatives calling me a thief. I could lose my job."],
        out: {
          rep: -4,
          sense: 1,
          lesson: ["ফোনের নম্বর দিলে ওরা লজ্জা দিয়ে আদায় করে। এখন অ্যাপ মুছে সবাইকে জানিয়ে থানায় যেতে বলুন।", "Give them your contacts and they collect by shaming you. Tell her to delete the app, tell people, and go to the police."],
        },
      },
    },
  },
  {
    key: "stranger_granny_allowance",
    kind: "stranger",
    real: true,
    from: ["ভাতা নিয়ে দ্বিধায় থাকা বৃদ্ধা", "Old woman unsure about her allowance"],
    body: ["ওয়ার্ড অফিস নোটিশ: বয়স্ক ভাতার তালিকা নবায়ন। পরিচয়পত্র ও ভাতা বই নিয়ে শনিবার অফিসে আসুন। কোনো টাকা লাগবে না।", "Ward office notice: the old-age allowance list is being renewed. Bring your ID and allowance book to the office on Saturday. No money needed."],
    nodes: {
      start: {
        who: "o",
        say: ["নাতি এই মেসেজ পড়ে শোনাল। এত জালিয়াতির কথা শুনি, এটাও কি ভুয়া? শনিবার যাব?", "My grandson read me this message. I hear of so much fraud, is this fake too? Should I go on Saturday?"],
        options: [
          { text: ["যান, টাকা চায়নি, অফিসেই ডাকছে।", "Go. It asks for no money, and calls you to the office."], go: "right" },
          { text: ["এটাও ভুয়া, যাবেন না।", "That's fake too, don't go."], go: "wrong" },
          { text: ["কোন অফিসের কথা লিখেছে?", "Which office does it name?"], go: "ask" },
        ],
      },
      ask: {
        who: "o",
        say: ["আমাদের ওয়ার্ড অফিস, মোড়ের ওটাই। মেম্বারও আমাকে কাল বলেছিলেন।", "Our ward office, the one at the corner. The ward member told me yesterday too."],
        options: [
          { text: ["নিশ্চিন্তে যান, পরিচয়পত্র নেবেন।", "Go without worry, and take your ID."], go: "right" },
          { text: ["সব মেসেজই ভুয়া হয়, যাবেন না।", "All these messages are fake, don't go."], go: "wrong" },
        ],
      },
      right: {
        who: "o",
        say: ["তাই যাই। আপনি না বললে ভয়েই যেতাম না।", "Then I'll go. If you hadn't said so, I'd have stayed away out of fear."],
        out: {
          rep: 3,
          sense: 2,
          lesson: ["টাকা চায়নি, লিংক নেই, চেনা অফিসে ডাকছে। এমন মেসেজ বিশ্বাস করা যায়।", "No money, no link, and it calls you to an office you know. A message like that can be trusted."],
        },
      },
      wrong: {
        who: "o",
        say: ["গেলাম না। পরে শুনি তালিকা থেকে নাম কাটা গেছে। এখন আবার দৌড়াদৌড়ি।", "I didn't go. Later I heard my name was struck off the list. Now it's all running about again."],
        out: {
          rep: -3,
          sense: 1,
          lesson: ["সবকিছুতে না বলাও ক্ষতি করে। দেখুন টাকা চায় কি না, আর নিজে গিয়ে যাচাই করা যায় কি না।", "Saying no to everything does harm too. See whether it asks for money, and whether you can check in person."],
        },
      },
    },
  },
  {
    key: "stranger_young_mother_vaccine",
    kind: "stranger",
    real: true,
    from: ["কোলে শিশু নিয়ে তরুণী মা", "Young mother with a baby"],
    body: ["স্বাস্থ্যকেন্দ্র: আপনার শিশুর টিকার তারিখ আগামী রবিবার সকাল ৯টা। কার্ড সাথে আনবেন। টিকা বিনামূল্যে।", "Health centre: your child's vaccination is next Sunday at 9 am. Bring the card. The vaccine is free."],
    nodes: {
      start: {
        who: "o",
        say: ["স্বাস্থ্যকেন্দ্র থেকে এই মেসেজ। একজন বলল, মেসেজে টিকার কথা সব ভুয়া। বাচ্চাকে নিয়ে যাব?", "This message is from the health centre. Someone said vaccine messages are all fake. Should I take my baby?"],
        options: [
          { text: ["নিয়ে যান, টাকা চায়নি।", "Take your baby. It doesn't ask for money."], go: "right" },
          { text: ["ভুয়া হতে পারে, যাবেন না।", "It could be fake, don't go."], go: "wrong" },
          { text: ["টিকার কার্ডে তারিখ দেখেছেন?", "Have you checked the date on the vaccine card?"], go: "ask" },
        ],
      },
      ask: {
        who: "o",
        say: ["দেখি। হ্যাঁ, কার্ডেও রবিবারই লেখা! নার্সও এই তারিখ বলেছিলেন।", "Let me look. Yes, the card says Sunday too! The nurse gave this date as well."],
        options: [
          { text: ["মিলে গেছে, তাহলে আসল।", "It matches, so it's real."], go: "right" },
          { text: ["কার্ডও ভুল হতে পারে, যাবেন না।", "The card could be wrong too, don't go."], go: "wrong" },
        ],
      },
      right: {
        who: "o",
        say: ["রবিবার নিয়ে যাব। মনটা হালকা হলো, ধন্যবাদ।", "I'll take my baby on Sunday. That's a weight off my mind, thank you."],
        out: {
          rep: 3,
          sense: 2,
          lesson: ["কার্ডের তারিখে মিলেছে, টিকা বিনামূল্যে, লিংক নেই। আসল খবর চিনলে শিশুরও উপকার।", "It matches the card, the vaccine is free, and there's no link. Knowing real news when you see it helps the child too."],
        },
      },
      wrong: {
        who: "o",
        say: ["গেলাম না। পরে নার্স খুব বকলেন, টিকার সময় পার হয়ে গেছে। আবার তারিখ নিতে হলো।", "I didn't go. Later the nurse scolded me, the vaccine date had passed. I had to get a new date."],
        out: {
          rep: -3,
          sense: 1,
          lesson: ["ভুয়া ভেবে আসল কাজ বন্ধ হলে ক্ষতি শিশুর। কার্ড বা নার্সের সাথে মিলিয়ে নিতে বলুন।", "When real things stop for fear of fakes, the child pays. Tell her to match it with the card or the nurse."],
        },
      },
    },
  },
  {
    key: "stranger_boy_game",
    kind: "stranger",
    from: ["গেমপাগল স্কুলছাত্র", "Schoolboy mad about games"],
    nodes: {
      start: {
        who: "o",
        say: ["এই সাইটে বিনামূল্যে গেমের কয়েন দিচ্ছে! শুধু আম্মুর ফোনের কোডটা লাগবে। দিয়ে দিই?", "This site's giving free game coins! It only needs the code from my mum's phone. Shall I give it?"],
        options: [
          { text: ["না, কোড দিলে আম্মুর টাকা চলে যাবে।", "No, give that code and your mum's money goes."], go: "right" },
          { text: ["কয়েন তো ফ্রি, সমস্যা কী?", "The coins are free, what's the problem?"], go: "wrong" },
          { text: ["কোডটা কীসের?", "What's the code for?"], go: "ask" },
        ],
      },
      ask: {
        who: "o",
        say: ["আম্মুর ফোনে যে ছয় সংখ্যা আসে। সাইট বলছে আম্মুকে বলার দরকার নেই, চুপচাপ দিতে।", "The six digits that come on my mum's phone. The site says not to tell her, just give it quietly."],
        options: [
          { text: ["চুপচাপ মানেই ফাঁদ। আম্মুকে দেখাও।", "Quietly means a trap. Show your mum."], go: "right" },
          { text: ["ছোট্ট কোড তো, দিয়ে দাও।", "It's only a little code, give it."], go: "wrong" },
        ],
      },
      right: {
        who: "o",
        say: ["তাহলে দেব না। আম্মুকেই দেখাই। কয়েন পরে জমিয়ে নেব।", "Then I won't. I'll show my mum. I can save up coins later."],
        out: {
          rep: 2,
          sense: 2,
          lesson: ["শিশুদের ফাঁদে ফেলে বড়দের টাকা নেওয়া হয়। ফ্রি কিছুর জন্য কোড কখনো দিতে নেই।", "Children are tricked to get at grown-ups' money. Nothing free ever needs a code."],
        },
      },
      wrong: {
        who: "o",
        say: ["কোড দিলাম। আম্মু এখন বলছে টাকা নেই, খুব চিন্তায় আছে। আমি কী করব?", "I gave the code. Now my mum says the money's gone, and she's very worried. What do I do?"],
        out: {
          rep: -3,
          sense: 1,
          lesson: ["বাচ্চাটা ভরসা করেছিল আপনাকে। কোড আর ফ্রি কয়েন একসাথে এলেই সেটা ফাঁদ, বড়দের জানাতে বলুন।", "That child trusted you. A code and free coins together is always a trap, and children should tell a grown-up."],
        },
      },
    },
  },
  ...STRANGERS2,
];
