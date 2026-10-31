import type { Line } from "./types";
import { TALK, DJ_LINES, SCAM_TIPS, WEATHER, TRAFFIC_REPORTS } from "./radio2";

/** The car radio: ঢাকা বাতাস, "Dhaka Breeze". All of it is read by one presenter, so callers are reported, not voiced. */

const NEWS: Line[] = [
  ["ফ্লাইওভারে উঠে পড়েছে একটি ছাগল। চালকরা বলছেন, আজকের সবচেয়ে দ্রুত যান সেটিই।", "A goat has got onto the flyover. Drivers say it's the fastest vehicle up there today."],
  ["পেঁয়াজের দাম আবার বেড়েছে। ক্রেতারা এখন কাটার আগেই কাঁদছেন।", "Onion prices are up again. Shoppers are now crying before they even cut one."],
  ["মেয়রবিহীন এক পাড়া কমিটি একটি গর্তের নাম রেখেছে শান্তি নিবাস। উদ্বোধনে ছিল চা।", "A mayor-less neighbourhood committee has named a pothole Peace Villa. Tea was served at the opening."],
  ["লেকের হাঁসেরা সারি বেঁধে রাস্তা পার হলো। চালকরা প্রথমবার জেব্রা ক্রসিং মানলেন।", "The lake's ducks crossed the road in a line. Drivers obeyed a zebra crossing for the first time."],
  ["এক বাড়িওয়ালা ভাড়া কমিয়েছেন। ভাড়াটিয়ারা তাঁকে ডাক্তারের কাছে নিয়ে গেছেন।", "A landlord has lowered the rent. His tenants took him to a doctor."],
  ["কাল এক পাড়ায় লোডশেডিং হয়নি। ভয় পেয়ে অনেকেই মোমবাতি জ্বালিয়ে বসে ছিলেন।", "One neighbourhood had no power cut yesterday. Many sat up with candles, frightened."],
  ["আধা ঘণ্টার বৃষ্টিতে এক গলিতে নৌকা চালু হয়েছে। ভাড়া নিয়ে তর্কও চালু।", "After half an hour of rain a lane has launched a boat service. Fare disputes have launched too."],
  ["এক সিগন্যালে সবুজ বাতি জ্বলে আছে। চালকরা কী করবেন বুঝতে না পেরে দাঁড়িয়ে।", "The light's green at one junction. Not knowing what to do, drivers are standing still."],
  ["জরিপ বলছে, ঢাকায় পাঁচ মিনিটে আসছি মানে গড়ে চল্লিশ মিনিট।", "A survey finds that in Dhaka, I'll be there in five minutes means forty on average."],
  ["এক বাসের হেলপার প্রথমবার বললেন, গাড়ি ভরা। যাত্রীরা হতবাক।", "A bus helper has said for the first time that the bus is full. Passengers are stunned."],
  ["চায়ের দোকানের গুজব ইন্টারনেটকে হারিয়ে দিয়েছে। পরীক্ষায় গুজব পৌঁছেছে আগে।", "Tea stall gossip has beaten the internet. In tests, the rumour got there first."],
  ["লটারি জেতার ফোন পেয়ে এক ব্যক্তি জানতে চাইলেন, টিকিট কবে কিনলাম? ফোন কেটে গেছে।", "A man told he'd won a lottery asked when he'd bought the ticket. The line went dead."],
  ["এক আমগাছের মালিক ঢিল বন্ধ করে আবেদনপত্র চালু করেছেন। প্রথম দিনেই সত্তরটি জমা।", "A mango tree's owner has replaced stone-throwing with an application form. Seventy came in on day one."],
  ["মশারা রোজ সন্ধ্যায় ঠিক সময়ে হাজির। শহরের একমাত্র সময়ানুবর্তী দল তারাই।", "Mosquitoes report on time every evening. They're the city's only punctual team."],
  ["চার ঘণ্টা হর্ন না দেওয়া এক চালককে সংবর্ধনা। পরে জানা গেল, হর্ন নষ্ট।", "A driver was honoured for four hours with no horn. It later emerged his horn was broken."],
  ["নতুন ফুটপাথ উদ্বোধনের এক ঘণ্টার মধ্যে সেখানে চায়ের দোকান বসেছে।", "Within an hour of a new footpath opening, a tea stall moved in."],
  ["তিন বছর পর ধার দেওয়া ছাতা ফেরত পেলেন এক ব্যক্তি। খুশিতে আবার ধার দিয়েছেন।", "A man got back an umbrella he lent three years ago. In his joy, he lent it out again."],
  ["লিফট নষ্ট এক ভবনের সবার ওজন কমেছে। ডাক্তাররা লিফট না সারানোর পরামর্শ দিচ্ছেন।", "Everyone in a building with a broken lift has lost weight. Doctors advise against repairs."],
  ["একটি কাঁঠাল ভ্যান থেকে নেমে গড়িয়ে চলেছে। ট্রাফিক তাকে আগে যেতে দিয়েছে।", "A jackfruit has left its van and is rolling along. Traffic has given way."],
  ["লিফটে আটকে তিন বছরের দুই প্রতিবেশীর প্রথম পরিচয় হলো। বিকেলে চায়ের দাওয়াত।", "Stuck in a lift, neighbours of three years met for the first time. Tea's set for this afternoon."],
  ["ইলিশের দাম শুনে এক ক্রেতা ছবি তুলে চলে গেছেন। বিক্রেতা ছবি তোলার ফি ভাবছেন।", "On hearing the hilsa price, a buyer took a photo and left. The seller's considering a photo fee."],
  ["গলি ক্রিকেটের এক আম্পায়ার সাত বছর পর অবসর নিলেন। আউট নিয়ে তর্ক এখনো চলছে।", "A lane cricket umpire has retired after seven years. The arguments over his decisions go on."],
  ["এক ছাদের কবুতর পাশের ছাদে চলে গেছে। দুই পরিবারে শান্তি আলোচনা, সঙ্গে মুড়ি।", "A rooftop pigeon has moved next door. The two families are in peace talks, with puffed rice."],
  ["ভাঙতির বদলে পাওয়া লজেন্স দিয়ে ভাড়া দিলেন এক যাত্রী। হেলপার নিয়েছেন।", "A passenger paid the fare with a sweet given as change. The helper accepted."],
  ["ভোর চারটায় পানি এল। পুরো পাড়া বালতি হাতে দাঁড়িয়ে, দিনের সেরা আড্ডা হলো।", "Water came at four in the morning. The whole street stood with buckets, the best chat of the day."],
  ["মেঘ দেখে সবাই কাপড় তুলল, বৃষ্টি হলো না। আবার মেলে দিতেই শুরু।", "Seeing clouds, everyone took in the washing, and no rain. They hung it out again, and it began."],
  ["চিড়িয়াখানার এক বানর দর্শনার্থীর বাদাম ফেরত দিয়েছে। ধারণা করা হচ্ছে, লবণ কম ছিল।", "A zoo monkey has returned a visitor's peanuts. They're thought to have lacked salt."],
  ["পরীক্ষার হলে ধার করা কলম ফেরত দিয়েছে এক ছাত্র। খবরটি এলাকায় ছড়িয়ে পড়েছে।", "A student returned a pen borrowed in an exam hall. The news has spread through the area."],
  ["মোড়ের ট্রাফিক বক্সে চড়ুই বাসা বেঁধেছে। ডিউটি এখন চলছে বক্সের বাইরে।", "Sparrows have nested in a junction's traffic box. Duty now takes place outside it."],
  ["ভুল করে টাকা গেছে বলে এক ফোন এল। গ্রাহক বললেন, ব্যালেন্স দেখি। ফোন কেটে গেল।", "A call claimed money had been sent by mistake. The customer said, let me check my balance. The line went dead."],
  ["রিকশার পেছনে নতুন ছবি, বাঘের পাশে আমগাছ। শিল্পী বলছেন, বাঘেরও ছায়া লাগে।", "New art on a rickshaw's back: a tiger beside a mango tree. The artist says tigers need shade too."],
  ["গুলশানে এক বার্গারের দাম শুনে এক ক্রেতা কিস্তির ফর্ম চেয়েছেন।", "On hearing a burger's price in Gulshan, a customer asked for an instalment form."],
  ["মিরপুরের এক ফুচকা বিক্রেতার দাবি, টক চেখে তিনি আবহাওয়া বলতে পারেন। আজ ঝাল।", "A fuchka seller in Mirpur claims he can forecast weather by tasting the tamarind. Today: spicy."],
  ["ধানমন্ডিতে এক কুকুর রোজ একা চায়ের দোকানে যায়। বাকির খাতায় তার নামও উঠেছে।", "A dog in Dhanmondi goes alone to a tea stall daily. Its name's now in the credit book."],
  ["নতুন ফোন কিনে এক দাদি প্রথম মেসেজ পাঠালেন। পুরো পরিবারকে, ভোর পাঁচটায়।", "A grandmother's bought a new phone and sent her first message. To the whole family, at five in the morning."],
  ["এক পাড়ার বিয়েতে রোস্ট কম পড়েছে। ঘটনার তদন্তে পাঁচ সদস্যের চাচা কমিটি।", "A neighbourhood wedding ran short of roast chicken. A five-member committee of uncles is investigating."],
  ["এক পাড়া কমিটি একটি গর্তের জন্মদিন পালন করেছে। সে এবার পাঁচে পড়ল।", "A neighbourhood committee has celebrated a pothole's birthday. It turned five this year."],
  ["একটি অটোরিকশা পুরো পথ পেছন দিকে চলে পৌঁছেছে। চালক বলেন, সামনে জ্যাম ছিল।", "An auto-rickshaw went the whole way in reverse. The driver says there was traffic ahead."],
  ["বাজারে একটি লাউ এত বড় হয়েছে, তার জন্য আলাদা রিকশা লেগেছে। ভাড়া নিয়ে লাউ নীরব।", "A gourd has grown so large it needed its own rickshaw. It's silent on the fare."],
  ["পরিসংখ্যান বলছে, চায়ের কাপে শুরু হওয়া তর্কের অর্ধেক চা শেষ হলেই মিটে যায়।", "Figures show half of all arguments begun over tea end when the tea does."],
];

const ADS: Line[] = [
  ["ধবধবে সাবান। এমন পরিষ্কার, ধোয়ার পর নিজের কাপড় নিজেই চিনতে পারবেন না।", "Dhobdhobe Soap. So clean you won't recognise your own clothes."],
  ["আলু মিয়ার চিপস। প্যাকেটে বাতাসই বেশি, কিন্তু বাতাসটা একদম তাজা।", "Alu Mia's Chips. Mostly air in the packet, but it's very fresh air."],
  ["হর্নরোধী তুলা। কানে দিন, আর ঢাকাকে গ্রাম ভাবুন।", "Horn-Proof Cotton. Put it in your ears and imagine Dhaka's a village."],
  ["ঘুমহারা চা পাতা। এক কাপেই তিন দিন ঘুম নাই। পরীক্ষার্থীর বন্ধু, বাকিদের শত্রু।", "Sleepless Tea. One cup, no sleep for three days. Friend of students, enemy of everyone else."],
  ["এক ঘণ্টায় ইংরেজি শিখুন। দ্বিতীয় ঘণ্টায় ভুলে যান। টাকা ফেরত নাই।", "Learn English in one hour. Forget it in the second. No refunds."],
  ["ছয় তলা আবাসন। লিফট নাই, ব্যায়ামের খরচও নাই। ফ্ল্যাট নিন, ওজন কমান।", "Six-Storey Homes. No lift, no gym fees. Take a flat, lose weight."],
  ["পাঁচ মিনিট ঘড়ি। এই ঘড়িতে পাঁচ মিনিট মানে এক ঘণ্টা। আর কখনো দেরি হবে না।", "The Five Minute Watch. On this watch, five minutes means an hour. You'll never be late again."],
  ["বিরিয়ানি বিমা। প্যাকেটে আলু না পেলে আমরা একটা আলু পাঠাব, কাল বা পরশু।", "Biryani Insurance. No potato in your packet? We'll send one, tomorrow or the day after."],
  ["মেঘলা ছাতা। খুলবে যখন ইচ্ছা, বন্ধ হবে না কখনো।", "Megla Umbrella. Opens when it likes, never closes."],
  ["লোডশেডিং পাখা। চলে না, কিন্তু দেখলেই ঠান্ডা লাগে।", "Power Cut Fan. Doesn't run, but just looking at it cools you."],
  ["কাদাবন্ধু জুতা। বর্ষায় হারালে দুই পাটি একসঙ্গে খুঁজে পাবেন, ড্রেনে।", "Mud-Friend Shoes. Lose them in the monsoon and you'll find both together, in the drain."],
  ["ধৈর্য লজেন্স। জ্যামের আগে একটা, জ্যামের পরে একটা। মাঝখানে পুরো প্যাকেট।", "Patience Drops. One before traffic, one after. The full packet in between."],
  ["আম্মু অ্যালার্ম। ঘণ্টা বাজে না, সোজা চিৎকার করে, সাতটা বাজে, ওঠো!", "The Mum Alarm. It doesn't ring. It shouts, it's seven o'clock, get up!"],
  ["বোতলে ভরা গ্রামের বাতাস। শহরে খুলবেন, গভীর শ্বাস নিবেন। ধোঁয়া বিনামূল্যে।", "Village Air in a Bottle. Open in the city and breathe deep. Smoke included free."],
  ["টুকটুক ব্যাগ। বাজারের ব্যাগ যা কখনো ফাটে না, শুধু মানিব্যাগ খালি করে।", "Tuktuk Bag. The shopping bag that never bursts. It only empties your wallet."],
  ["তেজী সরিষার তেল। এক ফোঁটাতেই পুরো পাড়া জানবে, আজ আপনার বাসায় ভর্তা।", "Teji Mustard Oil. One drop and the whole street knows you're making bharta today."],
  ["পাড়াতো কোচিং। সবাইকে এক নম্বরে তুলে দিব। কিসে এক নম্বর, ভর্তির পরে জানবেন।", "Local Coaching. We'll make everyone number one. Number one in what, you'll learn after admission."],
  ["জাদু কলম। পরীক্ষায় নিজে লিখবে না, তবে দোষ দেওয়ার মতো কিছু তো থাকবে।", "Magic Pen. It won't write the exam for you, but you'll have something to blame."],
  ["দাঁড়ানোর কুশন। বাসে সিট না পেলে অন্তত এটা জড়িয়ে ধরে থাকবেন।", "The Standing Cushion. No seat on the bus? At least you'll have this to hug."],
  ["ঘরোয়া মশারি। মশা ঢুকতে পারবে না, আপনিও বের হতে পারবেন না। শান্তির ঘুম।", "Home Net. Mosquitoes can't get in and you can't get out. Peaceful sleep."],
  ["পাড়ার ডিম। ডিম দেশি, মুরগিও দেশি, শুধু দামটা বিদেশি।", "Neighbourhood Eggs. Local eggs, local hens, only the price is foreign."],
  ["নিরাপদ খাতা। পিন লেখার জন্য না, পিন না লেখার জন্য। খাতাটা আসলে ফাঁকা।", "The Safe Notebook. Not for writing your PIN, for not writing it. The notebook's blank."],
  ["রোদছায়া টুপি। মাথার ওপর ছোট্ট একটা ছাদ। পাখা লাগাতে আলাদা টাকা।", "Rodchhaya Hat. A tiny roof for your head. A fan costs extra."],
  ["সোনালি ঝালমুড়ি মশলা। এমন ঝাল, ফোন ধরতে গিয়ে গান গেয়ে উঠবেন।", "Shonali Jhalmuri Spice. So hot you'll burst into song answering the phone."],
  ["ঢাকা বাতাস শ্রোতা ক্লাব। যোগ দিন, কোনো ফি নাই। কেউ ফি চাইলে বুঝবেন, ওটা আমরা না।", "Dhaka Breeze Listeners' Club. Join free. If anyone asks for a fee, that's not us."],
];

export const RADIO: {
  news: Line[];
  ads: Line[];
  talk: Line[];
  djLines: Line[];
  scamTips: Line[];
  weather: { clear: Line[]; rain: Line[] };
  traffic: Line[];
} = {
  news: NEWS,
  ads: ADS,
  talk: TALK,
  djLines: DJ_LINES,
  scamTips: SCAM_TIPS,
  weather: WEATHER,
  traffic: TRAFFIC_REPORTS,
};
