// Goes through what Stage B added, in the running game, and prints what happened at each step.
// Usage: node tools/test/stage_b.mjs <picture dir> [section ...]
import { connect, wait } from "./session.mjs";

const dir = process.argv[2] ?? ".";
const only = process.argv.slice(3);
const on = (name) => !only.length || only.includes(name);
const s = await connect();
const show = async (label, code) => console.log(label, JSON.stringify(await s.js(code)));
const menu = () => s.js(`(()=>{const c=document.querySelector('#choices'); return c.classList.contains('on')?c.innerText.replace(/\\s+/g,' ').slice(0,170):''})()`);
const untilMenu = async (tries = 30) => {
  for (let i = 0; i < tries; i++) {
    const m = await menu();
    if (m) return m;
    await wait(300);
  }
  return "";
};
await s.begin("dhaka_mirpur10", { hour: 11 });
await s.js(`(()=>{const g=window.__game; g.talk.hurry=true; g.settings.viewFoot='third'; g.settings.viewDrive='third'; g.applyViewSettings(); return 1})()`);

if (on("mission")) {
  console.log("--- a mission by hand: start marker, E, choices");
  await show("next", `(()=>{const g=window.__game,R=g.missions; return {id:R.next.id,open:!!R.openNow,at:R.startPoint}})()`);
  await s.js(`(()=>{const g=window.__game,R=g.missions,p=R.startPoint; g.player.warp(p.x+1,0.16,p.z+1,0); return 1})()`);
  await wait(600);
  console.log(" prompt", await s.js(`document.getElementById('prompt').innerText`));
  await s.key("KeyE");
  await wait(800);
  await show(" begun", `(()=>{const R=window.__game.missions; return {active:R.active&&R.active.id,objective:document.getElementById('objectiveText').innerText}})()`);
  await s.js(`(()=>{const g=window.__game,b=g.missions.kit.beamAt; g.player.warp(b.x+1,0.16,b.z+1,0); return b})()`);
  // Walks through the conversation and each customer's order by pressing keys.
  for (let i = 0; i < 40; i++) {
    const active = await s.js(`window.__game.missions.active&&window.__game.missions.active.id`);
    if (!active) break;
    const m = await menu();
    if (m) {
      console.log(" menu:", m.slice(0, 80));
      const want = m.includes("দুধ চা") ? (i % 3) + 1 : 1;
      await s.key(`Digit${want}`);
    }
    await wait(500);
  }
  await show(" after", `(()=>{const g=window.__game; return {active:!!g.missions.active,done:g.life.data.story.done,taka:g.wallet.taka,banner:document.getElementById('banner').innerText.slice(0,40),next:g.missions.next&&g.missions.next.id}})()`);
  await s.canvas(`${dir}/b_m1.png`);
}

if (on("talk")) {
  console.log("--- talking to people: memory, moods");
  const who = `(()=>{const g=window.__game; g.player.warp(g.player.x,0.16,g.player.z,0); const st=g.city.stalls.find(q=>q.kind!=='tea'&&g.peds.vendorOf(q)); const v=g.peds.vendorOf(st); window.__p=v; g.player.warp(v.x+1.3,v.y,v.z,-1.57); return v.id})()`;
  console.log(" person", await s.js(who));
  await s.js(`window.__game.talk.talkTo(window.__p)`);
  let m = await untilMenu();
  console.log(" main menu:", m);
  await s.key("Digit1");
  m = await untilMenu();
  console.log(" chat menu:", m);
  await s.key("Digit5");
  await wait(800);
  m = await untilMenu();
  console.log(" back on chat:", !!m);
  await s.js(`window.__game.talk.stop()`);
  await wait(300);
  await show(" remembered", `(()=>{const g=window.__game,p=window.__p; const key=Object.keys(g.life.data.people).pop(); return {key,mem:g.life.data.people[key]}})()`);
  await s.js(`window.__game.talk.talkTo(window.__p)`);
  m = await untilMenu();
  await show(" second greeting uses known", `document.querySelector('.bubble.on span')?.innerText?.slice(0,60)`);
  const rudeAt = m.split(" ").findIndex((_, i, a) => false);
  void rudeAt;
  await s.js(`(()=>{const g=window.__game; const mem=g.converse.mem(window.__p); mem.feel=-20; g.talk.stop(); g.life.addRep(-3); return 1})()`);
  await wait(300);
  await s.js(`window.__game.talk.talkTo(window.__p)`);
  await wait(500);
  await show(" refused", `(()=>({talk:window.__game.talk.active,line:document.querySelector('.bubble.on span')?.innerText?.slice(0,60)}))()`);
  await s.js(`(()=>{const g=window.__game; g.converse.mem(window.__p).feel=0; g.life.addRep(3); return 1})()`);
}

if (on("friends")) {
  console.log("--- friends");
  await show("here", `window.__game.friends.here.map(f=>[f.def.key,Math.round(f.who.x),Math.round(f.who.z)])`);
  await s.js(`(()=>{const g=window.__game,f=g.friends.here[0]; g.player.warp(f.who.x+1.2,0.16,f.who.z,-1.57); return 1})()`);
  await wait(500);
  console.log(" prompt", await s.js(`document.getElementById('prompt').innerText`));
  await s.key("KeyE");
  const m = await untilMenu(50);
  console.log(" menu:", m);
  await show(" met", `(()=>{const g=window.__game,f=g.friends.here[0]; return {met:g.life.friend(f.def.key).met,contact:!!g.phone&&0}})()`);
  await s.key("Digit2");
  await wait(800);
  await show(" tea", `(()=>{const g=window.__game; return {active:g.missions.active&&g.missions.active.id,obj:document.getElementById('objectiveText').innerText}})()`);
  await s.js(`(()=>{const g=window.__game,b=g.missions.kit.beamAt; if(b) g.player.warp(b.x+1,0.16,b.z+1,0); return 1})()`);
  for (let i = 0; i < 30; i++) {
    await wait(400);
    if (!(await s.js(`!!window.__game.missions.active`))) break;
  }
  await show(" after tea", `(()=>{const g=window.__game,f=g.friends.here[0]; return {state:g.life.friend(f.def.key),taka:g.wallet.taka,hp:g.life.health}})()`);
  await show(" journal", `(()=>window.__game.friends.html().length)()`);
}

if (on("scams")) {
  console.log("--- scams");
  const before = await s.js(`({t:window.__game.wallet.taka,m:window.__game.save.phone.mobile})`);
  console.log(" money", JSON.stringify(before));
  await s.js(`(()=>{const g=window.__game; g.everyday.ring(g.everyday.unseen(g.everyday.pickCall())); return 1})()`);
  let m = await untilMenu();
  console.log(" ringing:", m);
  await s.key("Digit1");
  for (let i = 0; i < 40; i++) {
    await wait(350);
    if (!(await s.js(`window.__game.tree.active`))) break;
    m = await menu();
    if (m) {
      console.log("  option:", m.slice(0, 90));
      await s.key("Digit1");
    }
  }
  await show(" after a call", `(()=>{const g=window.__game,x=g.life.data.scams; return {taka:g.wallet.taka,mobile:g.save.phone.mobile,fell:x.fell,spotted:x.spotted,sense:x.sense,pending:x.pending.length,lessons:x.lessons.length}})()`);
  await s.js(`(()=>{const g=window.__game; g.everyday.sms(g.everyday.pickSms()); return 1})()`);
  await wait(1500);
  m = await untilMenu();
  console.log(" sms options:", m);
  await s.shot(`${dir}/b_sms.png`);
  for (let i = 0; i < 40; i++) {
    m = await menu();
    if (m) await s.key("Digit2");
    await wait(350);
    if (!(await s.js(`window.__game.tree.active`))) break;
  }
  await s.js(`(()=>{const g=window.__game; g.everyday.nextStranger(); return 1})()`);
  await wait(500);
  await show(" stranger offer", `(()=>{const o=window.__game.everyday.offer; return o&&{hint:o.hint,label:o.label,dist:+Math.hypot(o.who.x-window.__game.player.x,o.who.z-window.__game.player.z).toFixed(1)}})()`);
  await s.key("KeyE");
  for (let i = 0; i < 40; i++) {
    await wait(350);
    m = await menu();
    if (m) await s.key("Digit1");
    if (i > 2 && !(await s.js(`window.__game.tree.active`))) break;
  }
  await s.js(`(()=>{const g=window.__game; g.everyday.nextEvent(); return 1})()`);
  await wait(500);
  await show(" event offer", `(()=>{const o=window.__game.everyday.offer; return o&&{hint:o.hint}})()`);
  await s.key("KeyE");
  for (let i = 0; i < 40; i++) {
    await wait(350);
    m = await menu();
    if (m) await s.key("Digit1");
    if (i > 2 && !(await s.js(`window.__game.tree.active`))) break;
  }
  await show(" rep and scams", `(()=>{const g=window.__game,x=g.life.data.scams; return {rep:g.life.rep,fell:x.fell,spotted:x.spotted,sense:x.sense}})()`);
  await show(" off switch", `(()=>{const g=window.__game; g.settings.missionsOff=true; g.missions.setOff(true); const o=document.getElementById('objective').classList.contains('on'); g.settings.missionsOff=false; g.missions.setOff(false); return {objectiveShownWhileOff:o,back:document.getElementById('objective').classList.contains('on')}})()`);
}

if (on("jobs")) {
  console.log("--- jobs, all by themselves");
  await s.js(`(()=>{const g=window.__game; g.missions.kit.auto=true; return 1})()`);
  const ids = await s.js(`(async()=>{const m=await import('/src/missions/jobs.ts'); window.__jobs=m.JOB_LIST; return m.JOB_LIST.map(j=>j.id)})()`);
  for (const id of ids) {
    const before = await s.js(`window.__game.life.data.stats.earned`);
    await s.js(`(()=>{const g=window.__game; if(g.player.vehicle) g.player.endVehicle(); g.missions.begin(window.__jobs.find(j=>j.id==='${id}')); return 1})()`);
    const t0 = Date.now();
    let live = true;
    while (live && Date.now() - t0 < 60000) {
      await wait(300);
      live = await s.js(`!!window.__game.missions.active`);
      if (await s.js(`window.__game.state==='paused'`)) await s.js(`window.__game.panels.closeOverlay()`);
    }
    const after = await s.js(`window.__game.life.data.stats.earned`);
    console.log(` ${id}`, live ? "STUCK" : "done", `paid ${after - before}`, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (live) await s.js(`window.__game.missions.stop()`);
  }
  await s.js(`(()=>{const g=window.__game; g.missions.kit.auto=false; if(g.player.vehicle) g.player.endVehicle(); return 1})()`);
}

if (on("extras")) {
  console.log("--- garage, licence, radio, stickers, businesses, race");
  await show("car crash", `(()=>{const g=window.__game,p=g.player; const v=g.traffic.spawnParkedAt('car_sedan','white',p.x+3,p.z+3,0); p.takeWheel(v); window.__car=v; g.extras.crashed(v,12); g.extras.crashed(v,12); return {damage:g.life.data.damage.car_sedan,own:v.ownBody}})()`);
  await wait(700);
  const at = await s.js(`({x:window.__car.x,z:window.__car.z})`);
  await s.view([at.x + 3, 2, at.z + 6], [at.x, 0.7, at.z]);
  await wait(500);
  await s.canvas(`${dir}/b_dent.png`);
  await s.view(null);
  await show("garage", `(()=>{const g=window.__game,G=g.extras.garagePoints[0],v=window.__car; v.place(G.x+2,G.z-6,0); return G})()`);
  await wait(500);
  console.log(" prompt", await s.js(`document.getElementById('prompt').innerText`));
  await s.key("KeyE");
  await wait(900);
  await show(" repaired", `(()=>{const g=window.__game; return {damage:g.life.data.damage.car_sedan,taka:g.wallet.taka}})()`);
  await show("radio", `(()=>{const g=window.__game; return g.radio.station})()`);
  await s.key("KeyN");
  await wait(1500);
  await show(" talk station", `(()=>({st:window.__game.radio.station,sub:document.getElementById('subtitle').innerText.slice(0,70)}))()`);
  await s.key("KeyN");
  await wait(1200);
  await show(" folk", `(()=>({st:window.__game.radio.station,level:window.__game.audio.level}))()`);
  await s.key("KeyN");
  await s.key("KeyN");
  await s.js(`window.__game.player.endVehicle()`);
  await wait(500);
  await show("licence", `(()=>{const g=window.__game,b=g.city.interiors.all.find(q=>q.kind==='thana'); g.player.warp(b.outX+6,0.16,b.outZ,0); return g.life.data.licence})()`);
  await wait(500);
  console.log(" prompt", await s.js(`document.getElementById('prompt').innerText`));
  await s.key("KeyE");
  for (let i = 0; i < 5; i++) {
    await wait(400);
    const right = await s.js(`(async()=>{const g=window.__game,m=await import('/src/dialogue/licence.ts'); return m.LICENCE_QUIZ[g.extras.current].right})()`);
    await s.key(`Digit${right + 1}`);
  }
  await wait(500);
  await show(" passed", `window.__game.life.data.licence`);
  await show("sticker", `(()=>{const g=window.__game,x=g.extras.stickers[0]; g.player.warp(x.x+0.5,0.16,x.z,0); return {left:g.extras.stickers.length,x:Math.round(x.x),z:Math.round(x.z)}})()`);
  await wait(500);
  await s.canvas(`${dir}/b_sticker.png`);
  await s.key("KeyE");
  await wait(400);
  await show(" found", `window.__game.life.data.found.length`);
  await show("business", `(()=>{const g=window.__game; g.wallet.receive(6000); g.extras.act('own_stall'); return g.life.data.owned})()`);
  await show(" pays at dawn", `(async()=>{const g=window.__game,b=g.wallet.taka; g.env.setHour(5.98); await new Promise(r=>setTimeout(r,2500)); return g.wallet.taka-b})()`);
  await s.js(`(()=>{const g=window.__game; g.env.setHour(11); g.missions.kit.auto=true; g.extras.act('race_bike'); return 1})()`);
  for (let i = 0; i < 40; i++) {
    await wait(300);
    if (!(await s.js(`!!window.__game.missions.active`))) break;
  }
  await show(" race", `(()=>{const g=window.__game; g.missions.kit.auto=false; if(g.player.vehicle) g.player.endVehicle(); return g.life.data.raceBest})()`);
  await show("journal page", `(()=>{const g=window.__game; g.openJournal(); return {state:g.state,open:g.panels.overlayOpen,tabs:[...document.querySelectorAll('#overlayBody .tabs button')].map(b=>b.innerText)}})()`);
  await s.shot(`${dir}/b_journal.png`);
  await s.js(`window.__game.panels.closeOverlay()`);
}

if (on("rain")) {
  console.log("--- umbrella and bus pictures");
  await s.js(`(()=>{const g=window.__game; g.env.speed=0; g.weather.force(1); g.wallet.add('umbrella'); return 1})()`);
  await wait(2500);
  const p = await s.js(`({x:window.__game.player.x,y:window.__game.player.y,z:window.__game.player.z,yaw:window.__game.player.yaw})`);
  await s.view([p.x + 2.4, p.y + 1.7, p.z + 1.2], [p.x, p.y + 1.1, p.z]);
  await wait(500);
  await s.canvas(`${dir}/b_umbrella.png`);
  await s.view(null);
  await s.js(`(()=>{const g=window.__game; g.weather.force(0); return 1})()`);
}

console.log("errors", JSON.stringify(await s.errors()));
s.close();
