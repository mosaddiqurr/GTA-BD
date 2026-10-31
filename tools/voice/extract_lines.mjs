// Lists every line the game can say, and who says it, for the voice generator.
// Usage: node tools/voice/extract_lines.mjs <output.json>
// The words on screen are the source of truth: a line's file name is a hash of its text, the same
// hash the game uses to find it. Anything said with numbers is listed in its spoken form.
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = process.argv[2];
if (!out) {
  console.error("Usage: node tools/voice/extract_lines.mjs <output.json>");
  process.exit(1);
}
const require = createRequire(join(process.cwd(), "package.json"));
const ts = require("typescript");

// Only plain data files are needed, so each is simply turned into JavaScript and loaded.
const dir = mkdtempSync(join(tmpdir(), "bow-lines-"));
const load = async (name, source, fix = (t) => t) => {
  const js = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: { module: "ESNext", target: "ES2022" } }).outputText;
  const file = join(dir, name);
  writeFileSync(file, fix(js));
  return import(pathToFileURL(file).href);
};
const { bn, takaWords } = await load("bn.mjs", "src/localization/bn.ts");
const { ACTORS, ACTOR_OF } = await load("cast.mjs", "src/interaction/cast.ts", (t) => t.replace(/from "..\/localization\/bn"/, 'from "./bn.mjs"'));
const { lineKey } = await load("key.mjs", "src/audio/lineKey.ts");
const ROUTES = [];
const REGIONS = [];
for (const name of ["mirpur10", "gulshan", "dhanmondi"]) {
  const mod = await load(`${name}.mjs`, `src/regions/dhaka/${name}.ts`);
  for (const region of Object.values(mod)) {
    REGIONS.push(region);
    ROUTES.push(...region.busRoutes.map((q) => q.name));
  }
}
rmSync(dir, { recursive: true, force: true });

// Women and girls speak in text until there is a woman's voice to give them: never a man's.
const NO_VOICE_YET = new Set(["woman", "girl", "granny"]);
const lines = new Map();
const add = (actor, text) => {
  const clean = String(text).trim();
  if (!clean || NO_VOICE_YET.has(actor)) return;
  const id = `${actor}/${lineKey(clean)}`;
  if (!lines.has(id)) lines.set(id, { actor, key: lineKey(clean), text: clean });
};
const npcs = ACTORS.filter((a) => a !== "hero" && !NO_VOICE_YET.has(a));
const everyone = (list) => {
  for (const a of npcs) for (const t of list) add(a, t);
};
// The hero's own lines, in the voice of each man or boy you can play as.
const hero = (list) => {
  for (const t of list) for (const a of ["hero", "mid", "elder", "kid"]) add(a, t);
};

// What each kind of person says about themselves.
const addresses = new Set();
for (const [id, role] of Object.entries(bn.talk.roles)) {
  const actor = ACTOR_OF[id];
  for (const list of [role.greet, role.hello, role.work, role.news, role.topic.answer, role.bye]) for (const t of list) add(actor, t);
  addresses.add(role.address);
  hero([role.topic.ask]);
}

// The hero's questions, in every form of address.
const ask = bn.talk.ask;
for (const a of addresses) hero([ask.hello(a), ask.name(a), ask.work(a), ask.news(a), ask.place(a), ask.bye(a)]);
hero([ask.back]);
const labels = Object.values(bn.talk.places);
hero(labels.map((p) => bn.talk.placeAsk(p)));
hero(bn.talk.bench.topics.map((t) => t.ask));

// Anything anyone at all might say.
everyone(bn.talk.again);
everyone(bn.talk.busy);
everyone(bn.talk.leftAlone);
everyone([bn.talk.whereTo]);
everyone(bn.talk.names.map((n) => bn.talk.myName(n)));
everyone(labels.map((p) => bn.talk.placeNear(p)));
everyone(labels.map((p) => `${p}?`));
everyone(bn.talk.dirs.map((d) => bn.talk.wayIs(d)));
const metres = [];
for (let m = 30; m < 100; m += 10) metres.push(m);
for (let m = 100; m <= 1000; m += 50) metres.push(m);
everyone(metres.map((m) => bn.talk.distanceIs(takaWords(m))));
everyone(bn.talk.bench.greet);
for (const t of bn.talk.bench.topics) everyone(t.answer);
everyone(bn.sideIn);
everyone(bn.bumped);
everyone(bn.bumpedHard);
everyone(bn.dodge);
everyone(bn.browse);
everyone(bn.overheard.flat());
everyone(bn.driverLeaves);
everyone(bn.busPassengers);
const c = bn.crash;
for (const list of [c.driver, c.driverOut, c.passenger, c.bystander, c.wall, c.fled, c.knocked, c.pedestrian]) everyone(list);
for (const m of c.menu) {
  everyone([m.reply]);
  hero([m.line]);
}
everyone([c.calmed]);

// Particular people.
for (const t of [...bn.police, ...c.police]) add("deep", t);
for (const t of c.cart) add("seller", t);
const tea = bn.tea;
for (const t of [tea.ask, tea.okay, tea.noSeat, tea.serve, tea.bill, ...tea.calls]) add("seller", t);
hero([tea.notNow, tea.done, tea.leftEarly, ...tea.menu.map((m) => m.line)]);
for (const list of Object.values(bn.stallCalls)) for (const t of list) add("seller", t);
hero([bn.askStop, ...Object.values(bn.hail.call)]);
// Haggling in the market, and phone calls.
for (const t of [...bn.shop.haggleFloor, ...bn.shop.haggleCall]) add("seller", t);
hero([...bn.shop.haggleAsk, bn.shop.haggleLeaveLine]);
for (const list of Object.values(bn.shop.stock)) {
  for (const it of list) {
    if (!it.haggle) continue;
    hero([bn.shop.askPrice(it.name)]);
    for (let p = 10; p <= 1300; p += 10) {
      if (p < it.price * 0.75 || p > it.price * 1.55) continue;
      add("seller", bn.shop.quoteSay(p));
      add("seller", bn.shop.haggleDownSay(p));
      add("seller", bn.shop.hereSay(p));
      hero([bn.shop.haggleBuySay(p)]);
    }
  }
}
// Police, buildings.
const law = bn.law;
for (const t of [law.approach, law.towing, law.paidLine, law.laterLine, law.pleadYes, law.pleadNo, law.noMoney, law.desk, law.deskClear, law.deskPaid, law.officerHello, law.officerAnswer, law.locked, ...law.noEntry]) add("deep", t);
hero([law.payLine, law.payLaterLine, law.pleadLine, law.officerAsk, law.officerBye]);
for (const why of Object.values(law.why)) for (const n of [500, 1000, 800, 1600]) add("deep", law.chargeSay(why, n));
for (let n = 100; n <= 5000; n += 100) add("deep", law.deskOwesSay(n));
for (const t of bn.heroes.kidNoDrive) add("mid", t);
for (const r of REGIONS) for (const a of r.layout.areas) add("young", bn.trip.thisStop(a.nameBn));
const PHONE_VOICES = { chacha: "elder", rasel: "young", tanvir: "mid", landlord: "deep", emergency: "mid", bank: "mid", unknown: "mid" };
for (const [who, data] of Object.entries(bn.phone.people)) {
  for (const talk of [...(data.calls ?? []), ...(data.incoming ?? [])]) {
    talk.forEach((t, i) => (i % 2 === 0 ? add(PHONE_VOICES[who], t) : hero([t])));
  }
}
for (const a of npcs) add(a, bn.hail.reply);

// Shops: the hero asks, and whoever is at the counter names the price.
const prices = new Set();
for (const list of Object.values(bn.shop.stock)) {
  for (const it of list) {
    hero([bn.shop.ask(it.name)]);
    prices.add(it.price);
  }
}
for (const a of ["seller"]) {
  for (const t of [...bn.shop.greet, bn.shop.noMoney, bn.trip.noMoney]) add(a, t);
  for (const price of prices) add(a, bn.shop.hereSay(price));
}
hero([bn.shop.leaveLine]);

// The metro: the clerk at the ticket window, and the hero asking.
add("mid", bn.metro.ask);
add("mid", bn.metro.sold);
add("mid", bn.shop.noMoney);
for (const region of REGIONS) for (const l of region.layout.metro?.lines ?? []) hero([bn.metro.buy(l.nameBn)]);

// Boys on the playing field.
for (const a of ["young", "mid", "seller"]) for (const t of Object.values(bn.playground)) add(a, t);

// Going on to another district.
const offDuty = Object.entries(bn.talk.offDuty);
for (const [id, role] of offDuty) {
  const actor = ACTOR_OF[id];
  for (const list of [role.greet, role.hello, role.work, role.news, role.topic?.answer, role.bye]) for (const t of list ?? []) add(actor, t);
  if (role.topic) hero([role.topic.ask]);
}
for (const region of REGIONS) {
  for (const g of region.gates) {
    hero([bn.talk.districtAsk(g.nameBn), bn.trip.goTo(g.nameBn), bn.trip.busToAsk(g.nameBn)]);
    add("young", bn.trip.busGoes(g.nameBn));
    add("young", bn.trip.farArrived(g.nameBn));
    const line = region.busRoutes.find((q) => q.to === g.to)?.name ?? "";
    add("young", bn.trip.busNotGoing(g.nameBn, line));
    everyone([bn.talk.wayDistrict(g.nameBn, line), bn.talk.wayDistrictMetro(g.nameBn, line)]);
  }
}
for (const a of ["seller", "mid"]) add(a, bn.trip.tooFar);
hero([bn.hail.busCall]);
for (const t of [...bn.hail.busRoom, ...bn.hail.busFull]) add("young", t);
everyone(bn.blocked);

// Fares: rickshaw and CNG drivers.
const t = bn.trip;
const drivers = ["seller", "mid"];
for (const a of drivers) {
  for (const line of [t.whereTo, t.tooClose, t.okay, t.yourLoss]) add(a, line);
  for (let fare = 10; fare <= 800; fare += 10) {
    add(a, t.quoteSay(fare));
    add(a, t.counterSay(fare));
    add(a, t.arrivedSay(fare));
  }
}
hero([t.never, t.dealSay, t.justRiding]);
hero(labels.map((p) => t.goTo(p)));
hero(labels.map((p) => t.busGetOff(p)));
for (let fare = 10; fare <= 800; fare += 10) hero([t.offer(String(fare)).replace(String(fare), takaWords(fare))]);
add("young", t.busAsk);
add("young", t.busFare(t.busFareWords));
for (const p of labels) add("young", t.busArrived(p));
for (const r of ROUTES) add("young", t.calling(r.split(" — ")[1] ?? r));
add("seller", bn.voiceSample);

// Older lines say "ভাই" to the hero. The woman, the old man and the boy are called something else.
const ADDRESS_RE = /(?<!আমার |ছোট |বড় |তার |ওর |ওনার |মেজো |এক |দুই |তিন |চাচাতো |মামাতো )ভাই(?![া-ৌ্য়])/g;
for (const l of [...lines.values()]) {
  if (l.actor === "hero") continue;
  if (l.text.search(ADDRESS_RE) >= 0) for (const w of ["আপা", "চাচা", "বাবু"]) add(l.actor, l.text.replace(ADDRESS_RE, w));
}

// Stage B: files that import one another, so each brings the rest along.
const deepDir = mkdtempSync(join(tmpdir(), "bow-deep-"));
const seenFiles = new Map();
const deep = async (source) => {
  const norm = source.replace(/\\/g, "/");
  if (!seenFiles.has(norm)) {
    const name = `m${seenFiles.size}.mjs`;
    seenFiles.set(norm, name);
    let js = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: { module: "ESNext", target: "ES2022" } }).outputText;
    const folder = norm.slice(0, norm.lastIndexOf("/"));
    const refs = [...js.matchAll(/from "(\.[^"]+)"/g)].map((m) => m[1]);
    for (const r of refs) {
      const parts = `${folder}/${r}`.split("/");
      const clean = [];
      for (const q of parts) {
        if (q === "..") clean.pop();
        else if (q !== ".") clean.push(q);
      }
      const child = await deep(`${clean.join("/")}.ts`);
      js = js.replace(`from "${r}"`, `from "./${child}"`);
    }
    writeFileSync(join(deepDir, name), js);
  }
  return seenFiles.get(norm);
};
const need = async (source) => import(pathToFileURL(join(deepDir, await deep(source))).href);

const say = (actor, l) => add(actor, l[0]);
const walkTree = (tree, actor) => {
  for (const node of Object.values(tree.nodes)) {
    if (node.who === "o") say(actor, node.say);
    else hero([node.say[0]]);
  }
};
const sceneOf = (actor, scene) => {
  for (const [who, l] of scene) {
    if (who === "o") say(actor, l);
    else hero([l[0]]);
  }
};

const { ROLE_TALK } = await need("src/dialogue/street/index.ts");
for (const [id, role] of Object.entries(ROLE_TALK)) {
  const actor = ACTOR_OF[id];
  for (const [k, v] of Object.entries(role)) {
    if (k === "favours") for (const f of v) {
      say(actor, f.ask);
      say(actor, f.done);
    } else for (const l of v) say(actor, l);
  }
}
const { ADDRESSED } = await need("src/dialogue/address.ts");
for (const lists of Object.values(ADDRESSED)) for (const list of Object.values(lists)) for (const l of list) for (const a of ["mid", "seller", "young", "elder"]) say(a, l);
const { FRIENDS } = await need("src/dialogue/friends/index.ts");
for (const f of FRIENDS) {
  const actor = ACTOR_OF[f.id];
  sceneOf(actor, f.firstMeet);
  for (const s of f.teaTalks) sceneOf(actor, s);
  for (const list of [f.smallTalk, f.callHello, f.callBusy, f.callYes, f.closer, f.hurt, f.gift]) for (const l of list) say(actor, l);
  for (const fv of f.favours) {
    say(actor, fv.ask);
    say(actor, fv.done);
  }
  for (const t2 of f.theyCall) walkTree(t2, actor);
}
const { CALLS } = await need("src/dialogue/scams/calls.ts");
const { MESSAGES } = await need("src/dialogue/scams/messages.ts");
const { FOLLOWUPS } = await need("src/dialogue/scams/followups.ts");
const { STRANGERS, STRANGER_SPEAKER } = await need("src/dialogue/scams/strangers.ts");
for (const q of [...CALLS, ...MESSAGES, ...FOLLOWUPS]) walkTree(q, "mid");
for (const q of STRANGERS) walkTree(q, STRANGER_SPEAKER[q.key] ?? "mid");
const { EVENTS } = await need("src/dialogue/events.ts");
for (const q of EVENTS) walkTree(q, ACTOR_OF[q.id] ?? "mid");
const { JOBS } = await need("src/dialogue/jobs.ts");
for (const l of [...JOBS.tea.offer, ...JOBS.tea.tips, ...JOBS.tea.pay]) say("seller", l);
const { RADIO } = await need("src/dialogue/radio.ts");
for (const [k, v] of Object.entries(RADIO)) {
  const lists = Array.isArray(v) ? [v] : Object.values(v);
  for (const list of lists) for (const l of list) say(k === "djLines" || k === "ads" ? "young" : "mid", l);
}
const { LICENCE_LINES } = await need("src/dialogue/licence.ts");
for (const list of Object.values(LICENCE_LINES)) for (const l of list) say("deep", l);
const { ENDING } = await need("src/dialogue/tutorial.ts");
for (const l of ENDING.lines) say("elder", l);
rmSync(deepDir, { recursive: true, force: true });

// What the hero says when talking to anyone.
const converse = readFileSync("src/interaction/converse.ts", "utf8");
for (const key of ["family", "money", "city", "food", "weather", "joke", "dream", "complaint", "gossip", "advice", "scamStory", "favour", "praiseSay", "rudeSay", "sorrySay", "photo"]) {
  const m = converse.match(new RegExp(`${key}: L\\("([^"]+)"`));
  if (m) hero([m[1]]);
}

// The story, read from the scripts: who's speaking comes from how each person was brought on.
for (const file of ["src/missions/story1.ts", "src/missions/story2.ts"]) {
  const src = readFileSync(file, "utf8");
  const vars = new Map();
  for (const m of src.matchAll(/(?:const |, )(\w+)\s*=\s*k\.person\("(\w+)"/g)) vars.set(m[1], m[2]);
  for (const m of src.matchAll(/(\w+):\s*k\.person\("(\w+)"/g)) vars.set(m[1], m[2]);
  const block = (from, actor) => {
    let depth = 0;
    let i = src.indexOf("[", from);
    const start = i;
    for (; i < src.length; i++) {
      if (src[i] === "[") depth++;
      if (src[i] === "]" && --depth === 0) break;
    }
    const body = src.slice(start, i);
    for (const q of body.matchAll(/\bo\("([^"]+)"/g)) add(actor, q[1]);
    hero([...body.matchAll(/\bh\("([^"]+)"/g)].map((q) => q[1]));
  };
  for (const m of src.matchAll(/k\.talk\((\w+)(?:\.who)?,/g)) block(m.index, ACTOR_OF[vars.get(m[1])] ?? "elder");
  for (const m of src.matchAll(/k\.call\("(\w+)"/g)) block(m.index, ACTOR_OF[m[1]] ?? "mid");
  for (const m of src.matchAll(/k\.talk\((\w+), k\.score/g)) block(m.index, ACTOR_OF[vars.get(m[1])] ?? "elder");
  for (const m of src.matchAll(/\["o", \["([^"]+)"/g)) add("mid", m[1]);
  for (const m of src.matchAll(/\bq: \["([^"]+)"/g)) add("elder", m[1]);
}

writeFileSync(out, JSON.stringify({ actors: ACTORS, lines: [...lines.values()] }, null, 0));
const chars = [...lines.values()].reduce((n, l) => n + l.text.length, 0);
const unique = new Set([...lines.values()].map((l) => l.text)).size;
console.log(`${lines.size} clips, ${unique} different lines, ${chars} characters`);
