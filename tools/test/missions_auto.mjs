// Runs every story mission from start to finish by itself, in whichever district each part belongs,
// with the script's waits answered automatically. It proves each one can be got through and reports errors.
// Usage: node tools/test/missions_auto.mjs [first id] [last id]
import { connect, wait } from "./session.mjs";

const from = process.argv[2] ?? "m01", to = process.argv[3] ?? "m99";
const s = await connect();
let here = "";
const openRegion = async (region) => {
  if (region === here) return;
  await s.begin(region, { still: false, settle: 2500 });
  await s.js(`(()=>{const g=window.__game; g.missions.kit.auto=true; g.talk.hurry=true; return 1})()`);
  here = region;
};
await openRegion("dhaka_mirpur10");
const list = await s.js(`window.__game.missions.list.map(m=>({id:m.id,region:m.region,stages:m.stages.map(q=>q.region||m.region)}))`);
let bad = 0;
for (const m of list) {
  if (m.id < from || m.id > to) continue;
  let i = 0;
  while (i < m.stages.length) {
    await openRegion(m.stages[i]);
    const started = await s.js(`(()=>{const g=window.__game,R=g.missions; if(R.active) return 'busy '+R.active.id; g.hud.hideChoices(); R.begin(R.list.find(q=>q.id==='${m.id}'),${i},true); return 'ok'})()`);
    if (started !== "ok") console.log(m.id, "stage", i, started);
    const t0 = Date.now();
    let state = null;
    for (;;) {
      await wait(350);
      state = await s.js(`(()=>{const g=window.__game,R=g.missions; return {active:R.active&&R.active.id,stage:R.stageIndex,banner:document.getElementById('banner').innerText.replace(/\\s+/g,' ').slice(0,70),objective:document.getElementById('objectiveText').innerText.slice(0,60),state:g.state}})()`);
      // Overlays stop the game: the test closes them as a player would.
      if (state.state === "paused") await s.js(`(()=>{const g=window.__game; g.panels.closeOverlay(); return 1})()`);
      if (!state.active) break;
      if (state.stage > i) break;
      if (Date.now() - t0 > 60000) {
        console.log(m.id, "STUCK at stage", i, JSON.stringify(state));
        bad++;
        await s.js(`window.__game.missions.stop()`);
        break;
      }
    }
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(m.id, "stage", i, state.active ? "moved on" : state.banner, `${sec}s`);
    if (state.active && state.stage > i) {
      await s.js(`window.__game.missions.stop()`);
      await wait(300);
    }
    await s.js(`(()=>{const g=window.__game; g.hud.hideChoices(); if(g.missions.menu) g.missions.menu=null; g.missions.refreshNext&&0; return 1})()`);
    i++;
    await wait(300);
  }
  const errs = await s.errors();
  if (errs.length) {
    console.log(" errors", JSON.stringify(errs));
    bad += errs.length;
    await s.js(`window.__errs.length=0`);
  }
}
console.log(bad ? `${bad} problem(s)` : "all clean");
s.close();
