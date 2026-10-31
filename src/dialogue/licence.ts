import type { Line, QuizQuestion } from "./types";

export const LICENCE_QUIZ: QuizQuestion[] = [
  {
    q: ["সিগন্যালে লাল বাতি জ্বললে কী করবেন?", "What do you do at a red light?"],
    options: [
      ["স্টপ লাইনের আগে থেমে দাঁড়াবেন", "Stop before the stop line"],
      ["ফাঁকা দেখলে চলে যাবেন", "Go if it looks empty"],
      ["হর্ন দিয়ে সবাইকে সরাবেন", "Sound the horn to clear everyone"],
    ],
    right: 0,
  },
  {
    q: ["হলুদ বাতি মানে কী?", "What does an amber light mean?"],
    options: [
      ["সবচেয়ে জোরে পার হওয়ার সময়", "Time to go as fast as you can"],
      ["থামার প্রস্তুতি নিন", "Get ready to stop"],
      ["বাতিটা নষ্ট", "The light's broken"],
    ],
    right: 1,
  },
  {
    q: ["সবুজ বাতি জ্বলছে, কিন্তু সামনে পথচারী এখনো পার হচ্ছেন। কী করবেন?", "The light is green, but a pedestrian is still crossing. What do you do?"],
    options: [
      ["হর্ন দিয়ে তাড়া দেবেন", "Hurry them with the horn"],
      ["পাশ কাটিয়ে চলে যাবেন", "Squeeze past them"],
      ["পার না হওয়া পর্যন্ত অপেক্ষা করবেন", "Wait until they've crossed"],
    ],
    right: 2,
  },
  {
    q: ["বাংলাদেশে গাড়ি রাস্তার কোন পাশ দিয়ে চলে?", "Which side of the road do vehicles drive on in Bangladesh?"],
    options: [
      ["ডান পাশ", "The right"],
      ["বাম পাশ", "The left"],
      ["যে পাশ ফাঁকা", "Whichever's empty"],
      ["মাঝখান দিয়ে", "Down the middle"],
    ],
    right: 1,
  },
  {
    q: ["সামনের গাড়িকে ওভারটেক করতে হয় কোন দিক দিয়ে?", "On which side do you overtake the vehicle ahead?"],
    options: [
      ["ডান দিক দিয়ে, সামনে ফাঁকা দেখে", "On the right, when the road ahead is clear"],
      ["বাম দিক দিয়ে, ফুটপাথ ঘেঁষে", "On the left, along the footpath"],
      ["যেদিকে হর্ন বেশি শোনা যায়", "Wherever the horns are loudest"],
    ],
    right: 0,
  },
  {
    q: ["কোথায় ওভারটেক করা যাবে না?", "Where must you not overtake?"],
    options: [
      ["ফাঁকা সোজা রাস্তায়", "On an empty, straight road"],
      ["মহাসড়কের প্রশস্ত অংশে", "On a wide stretch of highway"],
      ["মোড়ে, বাঁকে আর সেতুর ওপর", "At junctions, on bends and on bridges"],
    ],
    right: 2,
  },
  {
    q: ["জেব্রা ক্রসিংয়ে পথচারী দাঁড়িয়ে আছেন। কী করবেন?", "A pedestrian's waiting at a zebra crossing. What do you do?"],
    options: [
      ["থেমে তাঁকে আগে যেতে দেবেন", "Stop and let them go first"],
      ["গতি বাড়িয়ে আগে পার হবেন", "Speed up and get across first"],
      ["হাত নেড়ে শুভেচ্ছা জানিয়ে চলে যাবেন", "Wave hello and carry on"],
    ],
    right: 0,
  },
  {
    q: ["ফুটপাথে মোটরসাইকেল চালানো যাবে?", "May you ride a motorcycle on the footpath?"],
    options: [
      ["জ্যাম হলে যাবে", "Yes, if there's traffic"],
      ["আস্তে চালালে যাবে", "Yes, if you go slowly"],
      ["না, ফুটপাথ পথচারীর জন্য", "No, the footpath is for pedestrians"],
    ],
    right: 2,
  },
  {
    q: ["মোটরসাইকেলে হেলমেট পরবেন কে?", "Who must wear a helmet on a motorcycle?"],
    options: [
      ["শুধু চালক", "Only the rider"],
      ["চালক আর পেছনের আরোহী, দুজনেই", "The rider and the pillion passenger, both"],
      ["পুলিশ দেখলে যে আগে পায়", "Whoever grabs it first when police appear"],
    ],
    right: 1,
  },
  {
    q: ["একটি মোটরসাইকেলে চালকসহ সর্বোচ্চ কতজন উঠতে পারবেন?", "At most how many people may ride one motorcycle, including the rider?"],
    options: [
      ["২ জন", "2"],
      ["৩ জন", "3"],
      ["৪ জন, ছোটরা গোনার বাইরে", "4, children don't count"],
      ["যতজন ধরে", "As many as fit"],
    ],
    right: 0,
  },
  {
    q: ["গাড়িতে সিটবেল্ট কার জন্য?", "Who is a seatbelt for?"],
    options: [
      ["শুধু লম্বা পথের জন্য", "Only for long journeys"],
      ["শুধু চালকের জন্য", "Only for the driver"],
      ["শুধু পুলিশের সামনে", "Only in front of the police"],
      ["চালক আর সব যাত্রীর জন্য", "The driver and all passengers"],
    ],
    right: 3,
  },
  {
    q: ["পেছনে অ্যাম্বুলেন্সের সাইরেন শুনলে কী করবেন?", "You hear an ambulance siren behind you. What do you do?"],
    options: [
      ["ওর পেছনে লেগে জ্যাম পার হবেন", "Tail it through the traffic"],
      ["নিরাপদে পাশে সরে পথ ছেড়ে দেবেন", "Move aside safely and clear the way"],
      ["জোরে চালিয়ে আগে থাকবেন", "Speed up to stay ahead"],
    ],
    right: 1,
  },
  {
    q: ["ফায়ার সার্ভিসের গাড়ি ঘণ্টা বাজিয়ে এলে কী করবেন?", "A fire engine approaches with its bell ringing. What do you do?"],
    options: [
      ["থেমে ছবি তুলবেন", "Stop and take a photo"],
      ["হর্ন দিয়ে পাল্টা উত্তর দেবেন", "Answer with your horn"],
      ["পথ ছেড়ে দেবেন, পেছনে লেগে যাবেন না", "Clear the way, and don't follow behind"],
    ],
    right: 2,
  },
  {
    q: ["গাড়ি চালানোর সময় কোন কাগজগুলো সঙ্গে রাখতে হয়?", "Which papers must you carry while driving?"],
    options: [
      ["লাইসেন্স, রেজিস্ট্রেশন, ফিটনেস, ট্যাক্স টোকেন ও বিমা", "Licence, registration, fitness, tax token and insurance"],
      ["শুধু মানিব্যাগ", "Just your wallet"],
      ["পরিচিত কারও ফোন নম্বর", "The phone number of someone you know"],
    ],
    right: 0,
  },
  {
    q: ["চালাতে চালাতে ফোন এলে কী করবেন?", "Your phone rings while you're driving. What do you do?"],
    options: [
      ["ঘাড় আর কাঁধের মাঝে চেপে কথা বলবেন", "Talk with it wedged against your shoulder"],
      ["নিরাপদ জায়গায় থেমে তারপর কথা বলবেন", "Stop somewhere safe, then talk"],
      ["লাউডস্পিকারে পুরো রাস্তাকে শোনাবেন", "Put it on speaker for the whole road"],
    ],
    right: 1,
  },
  {
    q: ["হাসপাতাল আর স্কুলের সামনে কী মানবেন?", "What do you observe outside hospitals and schools?"],
    options: [
      ["দ্রুত পার হয়ে যাবেন, যেন কম সময় থাকেন", "Pass quickly to be there less"],
      ["ছোট ছোট করে হর্ন দেবেন", "Use only short little horn blasts"],
      ["হর্ন না বাজিয়ে আস্তে চালাবেন", "Go slowly without using the horn"],
    ],
    right: 2,
  },
  {
    q: ["গাড়িতে হাইড্রলিক হর্ন লাগানো যাবে?", "May you fit a hydraulic horn to a vehicle?"],
    options: [
      ["না, এটা নিষিদ্ধ", "No, they're banned"],
      ["হ্যাঁ, বড় গাড়িতে", "Yes, on big vehicles"],
      ["হ্যাঁ, ঈদের সময়", "Yes, at Eid"],
    ],
    right: 0,
  },
  {
    q: ["নেশা করে গাড়ি চালানো কখন ঠিক?", "When is it all right to drive intoxicated?"],
    options: [
      ["রাতে রাস্তা ফাঁকা থাকলে", "At night when the roads are empty"],
      ["বাসা কাছে হলে", "When home is close"],
      ["কখনোই না", "Never"],
    ],
    right: 2,
  },
  {
    q: ["রেলক্রসিংয়ে পৌঁছে কী করবেন?", "What do you do on reaching a level crossing?"],
    options: [
      ["ট্রেনের আগে পার হওয়ার চেষ্টা করবেন", "Try to beat the train"],
      ["থেমে দুই দিক দেখে পার হবেন, গেট বন্ধ থাকলে অপেক্ষা করবেন", "Stop and look both ways, and wait if the gate's closed"],
      ["গেটের নিচ দিয়ে গলে যাবেন", "Slip under the gate"],
    ],
    right: 1,
  },
  {
    q: ["রাতে সামনে থেকে গাড়ি এলে হেডলাইট কী করবেন?", "At night a vehicle comes towards you. What do you do with your headlights?"],
    options: [
      ["লো বিমে নামাবেন", "Dip to low beam"],
      ["হাই বিমে তুলে জানান দেবেন", "Go to high beam so they know you're there"],
      ["নিভিয়ে দেবেন, তেল বাঁচবে", "Switch them off, saves fuel"],
    ],
    right: 0,
  },
  {
    q: ["বৃষ্টিতে রাস্তা ভেজা থাকলে কী করবেন?", "What do you do when rain has wet the road?"],
    options: [
      ["গতি বাড়াবেন, তাড়াতাড়ি বৃষ্টি পার হবেন", "Speed up to get through the rain faster"],
      ["সামনের গাড়ির পেছনে লেগে থাকবেন", "Stay close behind the vehicle ahead"],
      ["গতি কমাবেন, সামনের গাড়ি থেকে দূরত্ব বাড়াবেন", "Slow down and leave more distance"],
    ],
    right: 2,
  },
  {
    q: ["বাতি সবুজ, কিন্তু ট্রাফিক পুলিশ হাত তুলে থামতে বলছেন। কার কথা মানবেন?", "The light's green, but a traffic officer signals you to stop. Which do you obey?"],
    options: [
      ["ট্রাফিক পুলিশের", "The traffic officer"],
      ["বাতির", "The light"],
      ["পেছনের হর্নের", "The horns behind you"],
    ],
    right: 0,
  },
  {
    q: ["একমুখী রাস্তায় ভুল দিকে ঢুকে পড়লে কী করবেন?", "You've entered a one-way street the wrong way. What do you do?"],
    options: [
      ["জোরে চালিয়ে দ্রুত বের হবেন", "Drive fast to get out quickly"],
      ["নিরাপদে থেমে সঠিক দিকে ঘুরে যাবেন", "Stop safely and turn back the right way"],
      ["হর্ন দিয়ে সবাইকে উল্টো ঘোরাবেন", "Sound the horn and make everyone else turn round"],
    ],
    right: 1,
  },
  {
    q: ["রাস্তায় গাড়ি নষ্ট হলে কী করবেন?", "Your vehicle breaks down on the road. What do you do?"],
    options: [
      ["ওখানেই রেখে চা খেতে যাবেন", "Leave it there and go for tea"],
      ["বনেট খুলে সবার পরামর্শ নেবেন", "Open the bonnet and ask everyone's advice"],
      ["পাশে সরিয়ে হ্যাজার্ড বাতি জ্বালাবেন, পেছনে সতর্ক চিহ্ন রাখবেন", "Move aside, switch on the hazards, and put a warning sign behind"],
    ],
    right: 2,
  },
  {
    q: ["সামনের গাড়ি থেকে কতটা দূরত্ব রাখবেন?", "How far should you stay from the vehicle ahead?"],
    options: [
      ["এমন দূরত্ব, যাতে হঠাৎ থামলেও নিরাপদে থামতে পারেন", "Far enough to stop safely if it brakes suddenly"],
      ["এক হাত, নইলে অন্য গাড়ি ঢুকে পড়বে", "An arm's length, or someone will cut in"],
      ["যত কাছে পারা যায়, বাতাস কম লাগে", "As close as possible, less wind resistance"],
    ],
    right: 0,
  },
  {
    q: ["ডানে মোড় নেওয়ার আগে কী করবেন?", "What do you do before turning right?"],
    options: [
      ["মোড়ে গিয়ে হঠাৎ ঘুরে যাবেন", "Turn suddenly at the junction"],
      ["আগে থেকে আয়না দেখে ইন্ডিকেটর দেবেন", "Check your mirrors and signal in good time"],
      ["হাত বের করে নাড়াবেন, ইন্ডিকেটর শুধু উৎসবে", "Wave your arm, indicators are for festivals"],
    ],
    right: 1,
  },
  {
    q: ["অপেশাদার ড্রাইভিং লাইসেন্সের জন্য ন্যূনতম বয়স কত?", "What's the minimum age for a non-professional driving licence?"],
    options: [
      ["১২ বছর", "12 years"],
      ["১৮ বছর", "18 years"],
      ["যখন প্যাডেলে পা পৌঁছায়", "When your feet reach the pedals"],
    ],
    right: 1,
  },
  {
    q: ["গোলচত্বরে কে আগে যাবে?", "Who goes first at a roundabout?"],
    options: [
      ["যে আগে হর্ন দিল", "Whoever sounded the horn first"],
      ["যার গাড়ি বড়", "Whoever has the biggest vehicle"],
      ["যে আগে থেকেই চত্বরের ভেতরে আছে", "Whoever's already on the roundabout"],
    ],
    right: 2,
  },
  {
    q: ["আপনার গাড়ি অন্য গাড়িতে ঘষা লাগলে কী করবেন?", "Your vehicle scrapes another. What do you do?"],
    options: [
      ["থেমে কথা বলবেন, দরকার হলে ৯৯৯-এ ফোন করবেন", "Stop and talk, and ring 999 if needed"],
      ["দ্রুত পালিয়ে যাবেন", "Drive off quickly"],
      ["আগে চিৎকার শুরু করবেন, যে আগে চিৎকার করে সে জেতে", "Start shouting first, whoever shouts first wins"],
    ],
    right: 0,
  },
  {
    q: ["বাস কোথায় যাত্রী ওঠাবে আর নামাবে?", "Where should a bus let passengers on and off?"],
    options: [
      ["রাস্তার মাঝখানে, যেখানে ডাক পড়ে", "In the middle of the road, wherever someone calls"],
      ["চলন্ত অবস্থায়, সময় বাঁচাতে", "On the move, to save time"],
      ["নির্ধারিত স্টপে, পুরোপুরি থামিয়ে", "At the proper stop, having fully stopped"],
    ],
    right: 2,
  },
];

export const LICENCE_LINES: { welcome: Line[]; passed: Line[]; failed: Line[]; officer: Line[] } = {
  welcome: [
    ["লাইসেন্স অফিসে স্বাগতম। লাইনে দাঁড়ান, লাইনটা অফিসের চেয়েও পুরনো।", "Welcome to the licence office. Join the queue, it's older than the office."],
    ["পরীক্ষা দিবেন? আগে বসেন। চেয়ার না থাকলে দাঁড়িয়েই বসেন।", "Taking the test? Sit down first. No chair? Sit standing."],
    ["কেউ বলেছে টাকা দিলে পরীক্ষা লাগবে না? ওরা দালাল। এখানে পরীক্ষাই পথ।", "Someone said pay and skip the test? They're touts. Here, the test is the only way."],
    ["কাগজপত্র এনেছেন? ফটোকপিও? ফটোকপির ফটোকপি? আচ্ছা, দেখা যাক।", "Brought your papers? A photocopy? A photocopy of the photocopy? All right, let's see."],
    ["প্রশ্ন সোজা, রাস্তা কঠিন। ঠিকঠাক উত্তর দিলে রাস্তা একটু সোজা হবে।", "The questions are easy, the roads are hard. Answer well and the roads get a little easier."],
  ],
  passed: [
    ["পাস করেছেন! এখন আপনি আইনত হর্ন বাজাতে পারেন, তবে না বাজালেই ভালো।", "You've passed! Now you may legally sound a horn, but better if you don't."],
    ["অভিনন্দন! লাইসেন্স নেন। এটা রাস্তা কিনে দেয় না, শুধু চালানোর অনুমতি দেয়।", "Congratulations! Take your licence. It doesn't buy you the road, only permission to drive on it."],
    ["সব ঠিক। এবার গিয়ে সবাইকে জেব্রা ক্রসিংটা একটু দেখিয়ে দিবেন।", "All correct. Now go and show everyone what a zebra crossing is."],
    ["ভালো করেছেন। ছবিটা একটু অন্য রকম এসেছে, সব লাইসেন্সেই আসে।", "Well done. The photo's come out a bit odd, but it does on every licence."],
    ["পাস! সাবধানে চালাবেন। আপনার সঙ্গে আবার দেখা হোক শুধু নবায়নের দিনে।", "Passed! Drive carefully. May we meet again only on renewal day."],
  ],
  failed: [
    ["এবার হলো না। সমস্যা নাই, রাস্তাও আপনাকে আরেকটু সময় দিতে চায়।", "Not this time. No matter, the road wants to give you a little longer too."],
    ["কিছু উত্তর পড়ে আমার কলম থেমে গেল। আবার পড়ে আসেন।", "Some of those answers stopped my pen. Go and study again."],
    ["ফেল করেছেন, তবে ভয় নাই। প্রশ্নগুলো একই থাকবে, আপনি বদলে যাবেন।", "You've failed, but don't worry. The questions stay the same, you'll change."],
    ["কেউ টাকা নিয়ে পাস করিয়ে দিবে বললে যাবেন না। বইটা বরং নিয়ে যান।", "If anyone offers to pass you for money, don't go. Take the book instead."],
    ["আজ না হলে কাল। পড়াশোনা করে আসেন, আমরা এখানেই আছি।", "If not today, tomorrow. Study and come back, we'll be right here."],
  ],
  officer: [
    ["ফর্মটা নিজের হাতে পূরণ করেন। দোকানের লোক লিখে দিলে ভুলটাও তাদের হাতে থাকে।", "Fill in the form yourself. If the shop man writes it, the mistakes are his too."],
    ["এই কাউন্টার না, ওই কাউন্টার। ওই কাউন্টার না, প্রথমটা। হ্যাঁ, এটাই।", "Not this counter, that one. Not that one, the first. Yes, this one."],
    ["দুপুরের খাবারের বিরতি চলছে। আধা ঘণ্টা পরে আসেন। আধা ঘণ্টা মানে আধা ঘণ্টাই।", "It's the lunch break. Come back in half an hour. Half an hour means half an hour."],
    ["ফি দিবেন কাউন্টারে, রসিদ নিয়ে। বাইরে কেউ চাইলে দিবেন না।", "Pay the fee at the counter, and take a receipt. If someone outside asks, don't pay."],
    ["চালানোর পরীক্ষায় হাত দুইটা স্টিয়ারিংয়ে রাখবেন। হর্নে না।", "In the driving test, keep both hands on the wheel. Not on the horn."],
  ],
};
