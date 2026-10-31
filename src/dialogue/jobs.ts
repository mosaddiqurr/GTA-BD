import type { Line } from "./types";
import { CNG, BUS } from "./jobs2";
import { FOOD, COURIER } from "./jobs3";
import { PORTER, AMBULANCE } from "./jobs4";

export type JobKey = "tea" | "rickshaw" | "cng" | "bus" | "food" | "courier" | "porter" | "ambulance";

export interface JobLines {
  name: Line;
  /** The boss offering the job. */
  offer: Line[];
  start: Line[];
  /** What customers or passengers say during the job. */
  customer: Line[];
  praise: Line[];
  complaint: Line[];
  late: Line[];
  /** Never names an amount: the game shows that. */
  pay: Line[];
  quit: Line[];
  /** Advice from the boss. */
  tips: Line[];
  /** Short on-screen objectives. */
  goal: Line[];
}

const TEA: JobLines = {
  name: ["চায়ের দোকানের সহকারী", "Tea stall helper"],
  offer: [
    ["হাতে সময় আছে? আমার কাপ ধোয়ার লোকটা আজও গায়েব।", "Got a minute? My cup-washer has vanished again."],
    ["চা বানাতে হবে না, কাপ ধরতে জানলেই চলবে। করবেন?", "You needn't brew anything. If you can hold a cup, you're hired. Interested?"],
    ["আজ এমন ভিড়, একা সামলাতে পারছি না। একটু হাত লাগাবেন?", "It's so busy today I can't cope alone. Will you lend a hand?"],
    ["কাজ সোজা। কেটলি গরম, কাস্টমার আরও গরম। শুরু করবেন?", "Easy work. The kettle's hot and the customers are hotter. Want to start?"],
  ],
  start: [
    ["কাঁধে গামছা নিলেই আপনি এই দোকানের অর্ধেক মালিক। শুধু লাভটা আমার।", "Towel on your shoulder and you're half owner of this stall. Only the profit's mine."],
    ["আগে কাপ ধোবেন, তারপর চা ঢালবেন। উল্টোটা করলে কাস্টমার পালাবে।", "Wash the cup, then pour. Do it backwards and they'll run."],
    ["কোনার বেঞ্চের লোকটা তিন ঘণ্টা ধরে এক কাপে আছেন। ওনাকে ঘাঁটাবেন না।", "The man on the corner bench has been on one cup for three hours. Leave him be."],
    ["চিনি কম বললে কম দিবেন, বেশি বললেও কম দিবেন। চিনির দাম জানেন তো?", "If they ask for less sugar, give less. If they ask for more, give less. You know what sugar costs?"],
  ],
  customer: [
    ["আদা চা দেন, আদাটা যেন টের পাই। গতবার শুধু গুজব ছিল।", "Ginger tea, and let me actually taste the ginger. Last time it was only a rumour."],
    ["দুধ চা, চিনি কম। ডাক্তার বলেছে, আর বাসায় গুপ্তচর আছে।", "Milk tea, less sugar. Doctor's orders, and there are spies at home."],
    ["চায়ের সঙ্গে ওই বিস্কুটটা দেন, যেটা ডোবালে কাপের তলায় হারায় না।", "Tea, and that biscuit, the one that doesn't vanish to the bottom of the cup when dunked."],
    ["বাকি লিখে রাখেন, মাসের শেষে দিয়ে দিব। কোন মাস, সেটা পরে জানাব।", "Put it on my tab, I'll pay at the end of the month. Which month, I'll let you know."],
    ["এই চায়ে তো চা নাই, আছে গরম পানি আর আশা।", "There's no tea in this tea. Just hot water and hope."],
    ["রং চা দেন, লেবু দিয়ে। আর দেশের খবর কী, সেটাও এক কাপ।", "Black tea with lemon. And pour me a cup of the nation's news while you're at it."],
    ["জলদি দেন, বাস ছেড়ে দিচ্ছে! না থাক, বাস তো জ্যামে, আস্তে দেন।", "Quick, the bus is leaving! No wait, it's stuck in traffic. Take your time."],
    ["কাপটা এত ছোট কেন? চা খাব, না ওষুধ?", "Why's the cup so small? Am I having tea or medicine?"],
    ["গতকালের মতো চা দেন। কী খেয়েছিলাম মনে নাই, তবে ভালো ছিল।", "Same as yesterday. I can't remember what it was, but it was good."],
    ["আমি চা খাই না, শুধু বসি। বসার চার্জ নাই তো?", "I don't drink tea, I just sit. There's no charge for sitting, is there?"],
    ["চারটা চা, চারটাই আলাদা। কড়া, পাতলা, মিষ্টি, আর একটা আমার বন্ধুর মতো তিতা।", "Four teas, all different. Strong, weak, sweet, and one as bitter as my friend."],
    ["কাল পরীক্ষা। এমন চা দেন যেন সকাল পর্যন্ত ঘুম না আসে।", "Exam tomorrow. Give me a tea that keeps sleep away till morning."],
    ["ঝটপট টাকায় দিই? নাম্বারটা বলেন, আর পিন চাইবেন না কিন্তু!", "Can I pay by Jhotpot Taka? Give me the number, and don't you go asking for my PIN!"],
    ["এক কাপ চায়ে এত দেরি? পাতা কি বাগান থেকে তুলতে গেছেন?", "This long for one cup? Did you go to the garden to pick the leaves?"],
  ],
  praise: [
    ["বাহ, আপনার হাতে চা আছে। কাল থেকে আপনি বানান, আমি বসি।", "Now that's a hand for tea. From tomorrow you brew and I'll sit."],
    ["আজ কাপ নিয়ে কেউ নালিশ করেনি। এই দোকানে এটা ঐতিহাসিক ঘটনা।", "Nobody complained about the cups today. At this stall that's historic."],
    ["একটা কাপও ভাঙেননি! আমি নিজেও এত ভালো না।", "Not one cup broken! Even I'm not that good."],
    ["পুরনো কাস্টমার বলল, চা আজ অন্য রকম। ভালো অর্থে, এবার অন্তত।", "An old regular says the tea's different today. In a good way, this time."],
    ["কাপ ঘোরানোর হাতটা দারুণ। মনে হয় জন্ম থেকেই কেটলি ধরছেন।", "Lovely wrist on those cups. You'd think you were born holding a kettle."],
    ["লোক বসছে, চা খাচ্ছে, টাকাও দিচ্ছে। এই তিনটা একসঙ্গে বহু দিন দেখিনি।", "People sitting, drinking and actually paying. I haven't seen all three together in ages."],
  ],
  complaint: [
    ["এই কাপে চিনি, না লবণ? একটু চেখে দেখেন তো।", "Is that sugar or salt in this cup? Have a taste, go on."],
    ["আধা কাপ চা, আধা কাপ গামছার গন্ধ। এটা কোন রেসিপি?", "Half a cup of tea, half a cup of towel. What recipe is this?"],
    ["রং চা চাইলাম, দুধ দিলেন, তারপর বললেন এটাই নাকি রং।", "I asked for black tea, you added milk, then said that's the colour."],
    ["কাপ ভেজা, বেঞ্চ ভেজা, আমিও ভেজা। ছাতা আনতে হবে নাকি?", "Wet cup, wet bench, now wet me. Should I bring an umbrella?"],
    ["দশ মিনিট ধরে ডাকছি। এবার কি দরখাস্ত লিখব?", "I've been calling for ten minutes. Shall I submit a written application?"],
    ["চা ঠান্ডা। শরবত বলে চালালেও মেনে নিতাম।", "This tea's cold. I'd have accepted it if you'd called it sherbet."],
    ["আরে, এই কাপ তো এইমাত্র আগের লোকের হাতে ছিল!", "Hey, this cup was in the last person's hand just now!"],
    ["ভাঙতির বদলে দুইটা লজেন্স দিলেন। লজেন্স দিয়ে কি বাসে উঠব?", "Two sweets instead of change. Shall I pay the bus in sweets?"],
  ],
  late: [
    ["এখন এলেন? সকালের সব চা ঘুমিয়ে পড়েছে।", "Now you come? All the morning tea has fallen asleep."],
    ["কেটলি আপনার আগে গরম হয়ে গেছে। এটা ভালো লক্ষণ না।", "The kettle got going before you did. Not a good sign."],
    ["অফিসের লোকেরা চলে গেছে, রেখে গেছে শুধু নালিশ।", "The office crowd has gone, and left nothing but complaints."],
    ["দেরি কেন? জ্যাম? আপনি তো হেঁটে আসেন!", "Why so late? Traffic? You walk here!"],
  ],
  pay: [
    ["আজকের হিসাব এই নেন। গুনে নেন, আমি নিজেই গুনতে ভুল করি।", "Here's today's money. Count it, I get it wrong myself."],
    ["টাকাটা রাখেন। আর একটা বিস্কুট, এটা লাভের অংশ।", "Take the money. And a biscuit, your share of the profits."],
    ["বেচাকেনা ভালো হলো, তাই আজ হিসাবে কম তর্ক করলাম। নেন।", "Good trade today, so I argued less over the sums. Here."],
    ["আজকের পাওনা বুঝে নেন। কাল এলে আবার হবে।", "Here's what you're owed today. Come tomorrow and there's more."],
    ["কাজের টাকা কাজের শেষেই। এই দোকানে বাকি শুধু কাস্টমারের।", "Work's money at work's end. At this stall only customers get credit."],
  ],
  quit: [
    ["যাচ্ছেন? আচ্ছা, গামছাটা রেখে যান। ওটা দোকানের সম্পদ।", "Off, then? Fine, leave the towel. It's a company asset."],
    ["ঠিক আছে, আজ এই পর্যন্ত। কেটলি আপনাকে মনে রাখবে।", "All right, that's it for today. The kettle will remember you."],
    ["চলে গেলে কাপ আবার আমাকেই ধুতে হবে। যান, ইচ্ছা হলে আসবেন।", "If you go, the cups are mine again. Off you go, come back whenever."],
  ],
  tips: [
    ["কেউ রেগে গেলে আগে চা দিবেন, পরে কথা শুনবেন।", "If someone's angry, give them tea first and hear them out after."],
    ["গরম গ্লাস ধরবেন ওপরের কানায়, নিচে না।", "Hold a hot glass by the rim, not the base."],
    ["যে যত জোরে ডাকে, তার বাকি তত বেশি। মনে রাখবেন।", "The louder they call, the more they owe. Remember that."],
    ["তর্কে পক্ষ নিবেন না। দোকানে সবাই কাস্টমার।", "Don't take sides in arguments. Everyone here's a customer."],
    ["কেউ টাকা পাঠানোর মেসেজ দেখালেই ছাড়বেন না। নিজের ফোনে টাকা আসা দেখে নিবেন।", "Don't let anyone go just for showing a 'sent' message. See the money reach your own phone."],
  ],
  goal: [
    ["অর্ডার নিন", "Take the order"],
    ["চা নিয়ে বেঞ্চে যান", "Take the tea to the bench"],
    ["খালি কাপ তুলে আনুন", "Collect the empty cups"],
    ["টাকা নিয়ে দোকানে ফিরুন", "Bring the money back to the stall"],
  ],
};

const RICKSHAW: JobLines = {
  name: ["রিকশা চালানো", "Pulling a rickshaw"],
  offer: [
    ["আমার একটা রিকশা খালি পড়ে আছে। চালক গেছে বাড়ি, ধান কাটতে। টানবেন?", "One of my rickshaws is sitting idle. Its driver's gone home for the harvest. Will you pull it?"],
    ["প্যাডেল মারতে জানেন? না জানলেও সমস্যা নাই, ঢাকা শিখিয়ে দিবে।", "Know how to pedal? Doesn't matter if not, Dhaka will teach you."],
    ["জমার কথা পরে হবে। আগে দেখি রিকশা আপনাকে পছন্দ করে কি না।", "We'll talk about the daily rent later. First let's see if the rickshaw likes you."],
    ["আজ বাসে জায়গা নাই, রিকশার খুব কদর। চালাবেন একটা?", "No room on the buses today, so rickshaws are in demand. Want to take one out?"],
  ],
  start: [
    ["এই নেন চাবি। রিকশার না, তালার। রিকশা আবার চাবি বোঝে না।", "Here's the key. Not for the rickshaw, for the lock. Rickshaws don't understand keys."],
    ["বেলটা ঠিক আছে, ব্রেকটা মোটামুটি। বাকিটা ভাগ্য আর আপনার পা।", "The bell works, the brake more or less. The rest is luck and your legs."],
    ["বড় রাস্তায় উঠবেন না, ওখানে রিকশা নিষেধ। গলিই আপনার রাজ্য।", "Keep off the main road, rickshaws are banned there. The lanes are your kingdom."],
    ["ফ্লাইওভার দেখলে দূর থেকে সালাম দিবেন, ওঠার চেষ্টা করবেন না।", "See a flyover? Salute it from afar and don't try to climb it."],
  ],
  customer: [
    ["এই রিকশা, যাবেন? কাছেই, ভাড়াও কাছাকাছি।", "Hey, rickshaw! Going? It's close, and so is the fare."],
    ["আস্তে চালান, ব্যাগে ডিম আছে। ডজনখানেক, এখন পর্যন্ত।", "Slow down, I've got eggs in this bag. A dozen, so far."],
    ["জোরে চালান, বাসায় চুলায় তরকারি রেখে এসেছি!", "Faster, I've left curry on the stove!"],
    ["এই গলিতে ঢোকেন, আমি শর্টকাট চিনি। ওহ, এটা তো কানা গলি।", "Turn in here, I know a shortcut. Oh. It's a dead end."],
    ["হুড তুলে দেন, রোদ লাগছে। না, নামান, বাতাস আসছে না।", "Put the hood up, the sun's on me. No, down, there's no breeze."],
    ["আগের রিকশা অর্ধেক ভাড়ায় এসেছিল। অবশ্য সেটা গত বছর।", "The last rickshaw charged half this. Mind you, that was last year."],
    ["সামনের বাসটার পাশ কাটান! পারবেন না? আচ্ছা, বাসটা নড়লে বলবেন।", "Overtake that bus! Can't? Fine, tell me if it ever moves."],
    ["পথ তো লম্বা, আমার শ্যালকের বিয়ের গল্পটা শোনেন।", "Long road ahead, so let me tell you about my brother-in-law's wedding."],
    ["ওই ফুচকার দোকানে দুই মিনিট দাঁড়ান। বেশি না, মাত্র দুই প্লেট।", "Stop at that fuchka stall for two minutes. Not long, just two plates."],
    ["বেলটা এত জোরে কেন? পুরো পাড়া জেনে গেল আমি বাজারে যাচ্ছি।", "Why's the bell so loud? The whole neighbourhood knows I'm off to market."],
    ["একটু জোরে টানেন, পাশের জ্যামটাও আমাদের পেছনে ফেলে যাচ্ছে।", "Pull a little harder, the traffic jam beside us is overtaking."],
    ["বামে রাখেন, না ডানে, মানে যেদিকে ফাঁকা। ফাঁকা নাই? তাহলে আকাশে।", "Keep left, no, right, I mean wherever it's empty. Nothing empty? Try the sky."],
    ["ভাঙতি নাই, শুধু পাঁচশো টাকার নোট। আপনি ভাঙাবেন, না আমি?", "No change, only a five hundred note. Will you break it, or shall I?"],
    ["উঠেই তো পড়েছি। এবার শান্তিমতো ভাড়া নিয়ে তর্ক করি।", "Well, I'm on now. Let's argue about the fare in peace."],
  ],
  praise: [
    ["পুরো পথে একটাও ঝাঁকি নাই! রাস্তা কি আজ পাল্টে দিয়েছে?", "Not one jolt the whole way! Did they change the road today?"],
    ["এই ভাড়াটা খুশি হয়ে দিলাম। বেলের তালটা ভালো ছিল।", "Glad to pay this one. The bell had good rhythm."],
    ["এত সরু ফাঁক দিয়ে বের হলেন! বাতাসও ওখানে আটকে যেত।", "Through that gap? Even the breeze would have got stuck."],
    ["বৃষ্টিতে কেউ আসছিল না, আপনি এলেন। ভালো মানুষ।", "Nobody would come out in the rain, but you did. Good person."],
    ["গ্যারেজের রিকশা এই প্রথম ঠিক সময়ে ফিরল। চা আমার পক্ষ থেকে।", "First time a rickshaw's come back to the garage on time. Tea's on me."],
    ["আপনাকে পেলে বাস আর ধরব না। আপনার রিকশায় জ্যামও সুন্দর লাগে।", "With you around I won't bother with the bus. Even the jam looks nice from here."],
  ],
  complaint: [
    ["এত ঝাঁকি! দুপুরের ভাত এখন কোথায় আছে, আমি জানি না।", "So bumpy! I've no idea where my lunch has gone."],
    ["গর্তটা দেখলেন না? গর্তটা তো আমাকে ঠিকই দেখেছে।", "Didn't you see that pothole? It certainly saw me."],
    ["ভাড়া ঠিক হলো গুলশান পর্যন্ত, এটা কোন জায়গা?", "We agreed the fare to Gulshan. Where on earth is this?"],
    ["পেছনের বাসের হেলপার আমাকে হাত দিয়ে সরাচ্ছে! একটু সাইড নেন!", "The helper on the bus behind is shooing me with his hand! Move over!"],
    ["হুড ছেঁড়া, সিট ভেজা, বেল নষ্ট। কী আছে এই রিকশায়?", "Torn hood, wet seat, dead bell. What does this rickshaw actually have?"],
    ["আপনি কি রিকশা চালান, না রাস্তা মাপেন? এত আস্তে কেন?", "Are you driving, or surveying the road? Why so slow?"],
    ["আমি বাঁয়ে বললাম, আপনি ডানে গেলেন। এটাও আমার দোষ?", "I said left, you went right. Is that my fault too?"],
    ["এত ভাড়া? এই টাকায় তো রিকশাটাই কেনা যেত!", "That much? For that I could buy the rickshaw!"],
  ],
  late: [
    ["জমার সময় পার হয়ে গেছে। রিকশা কি আপনাকে টানছিল?", "Rent time's gone. Was the rickshaw pulling you?"],
    ["সকালের ভিড় শেষ। ভাড়াগুলো সব বাসে চলে গেছে।", "The morning crowd's over. All the fares have gone by bus."],
    ["অন্য চালক দুইবার ঘুরে এল, আপনি এখনো প্যাডেলে পা রাখেননি।", "The other driver's been round twice and you haven't touched a pedal."],
    ["দেরিতে এলে রিকশাও অভিমান করে, চেইন পড়ে যায়।", "Come late and the rickshaw sulks. Its chain falls off."],
  ],
  pay: [
    ["এই নেন আজকের টাকা। জমা কেটে রেখেছি, বাকিটা আপনার।", "Today's takings. I've kept the rent, the rest is yours."],
    ["পা দুইটার দাম তো আর দিতে পারি না, তবে আজকের টাকা এই নেন।", "I can't pay for those legs, but here's today's money."],
    ["গুনে নেন। ছেঁড়া নোট নাই, থাকলে যাত্রীর দোষ।", "Count it. No torn notes, and if there are, blame the passengers."],
    ["আজ ভালোই টেনেছেন। হিসাব মিলিয়ে দিলাম, রাখেন।", "You pulled well today. The sums are done, take it."],
    ["টাকা রাখেন। টায়ারে হাওয়া দেওয়ার খরচ আজ আমার।", "Take your money. The air for the tyres is on me today."],
  ],
  quit: [
    ["রিকশা রেখে যাচ্ছেন? তালা দিয়ে চাবিটা আমাকে দেন।", "Leaving the rickshaw? Lock it and hand me the key."],
    ["আচ্ছা, পা দুইটাকে বিশ্রাম দেন। রিকশা এখানেই থাকবে।", "All right, rest those legs. The rickshaw will be right here."],
    ["আজ থাক তাহলে। কাল ইচ্ছা হলে আসবেন, গ্যারেজ খোলা।", "That's enough for today then. The garage is open tomorrow if you fancy it."],
  ],
  tips: [
    ["ভাড়া আগে ঠিক করবেন, নইলে পুরো পথ তর্কও টানতে হবে।", "Settle the fare first, or you'll be pulling an argument all the way."],
    ["ঢালু রাস্তায় নেমে টানবেন। হাঁটু আপনার নিজের, ধার করা না।", "Get off and walk it up a slope. Those knees are yours, not borrowed."],
    ["বড় গাড়ি এলে জায়গা দিবেন। জেতার দরকার নাই, পৌঁছানো দরকার।", "Give way to big vehicles. You don't need to win, you need to arrive."],
    ["মালপত্র বেশি দেখলে ভাড়াটা আগেই একটু বাড়িয়ে নিবেন।", "If there's a lot of luggage, raise the fare before you set off."],
    ["রাতে বড় নোট পেলে ভালো করে দেখে নিবেন। জাল নোট আঁধার ভালোবাসে।", "At night, check any big note well. Fake notes love the dark."],
  ],
  goal: [
    ["যাত্রীকে তুলুন", "Pick up the passenger"],
    ["যাত্রীকে গন্তব্যে নামান", "Drop the passenger at the destination"],
    ["পরের যাত্রী খুঁজুন", "Find the next passenger"],
    ["রিকশা নিয়ে গ্যারেজে ফিরুন", "Bring the rickshaw back to the garage"],
  ],
};

export const JOBS: Record<JobKey, JobLines> = {
  tea: TEA,
  rickshaw: RICKSHAW,
  cng: CNG,
  bus: BUS,
  food: FOOD,
  courier: COURIER,
  porter: PORTER,
  ambulance: AMBULANCE,
};
