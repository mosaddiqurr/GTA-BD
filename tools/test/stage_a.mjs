// Walks through what Stage A added, in the running game, and reports what it finds. Pictures go to <dir>.
// Usage: node tools/test/stage_a.mjs <dir> [region]
import { execFileSync } from "node:child_process";

const edge = (...a) => execFileSync("node", ["tools/test/edge.mjs", ...a], { encoding: "utf8", maxBuffer: 1 << 24 });
const js = (s) => edge("eval", s).trim().replace(/\s+/g, " ");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = process.argv[2];
const region = process.argv[3] ?? "dhaka_mirpur10";
const ready = async () => {
  for (let i = 0; i < 80; i++) {
    await wait(2000);
    try {
      if (js("window.__game&&window.__game.state").includes("title")) return true;
    } catch {}
  }
  return false;
};
const pic = (name) => { try { execFileSync("node", ["tools/test/edge.mjs", "canvas", `${dir}/a_${region}_${name}.jpg`], { timeout: 15000 }); } catch { console.log("no picture", name); } };
const free = (x, z) => `(()=>{const c=window.__game.city.collision,W={x:0,z:0,nx:0,nz:0,hit:false}; c.resolveCircle(${x},${z},.4,W); return [W.x,W.z]})()`;

js(`(()=>{for(const k of Object.keys(localStorage)) if(k.startsWith('bow.save')||k==='bow.slot') localStorage.removeItem(k); return 1})()`);
edge("goto", `http://localhost:5173/?region=${region}`);
console.log("loaded", await ready());
js(`(()=>{window.__errs=[]; addEventListener('error',e=>window.__errs.push(String(e.message).slice(0,200))); addEventListener('unhandledrejection',e=>window.__errs.push(String(e.reason).slice(0,200))); return 1})()`);
js(`(()=>{const g=window.__game; g.settings.autosave=false; g.testPlay(); return 1})()`);
await wait(3000);
console.log("stats", js(`(()=>{const g=window.__game,c=g.city; return {blocks:c.layout.blocks.length,insides:c.interiors.all.map(b=>b.kind).join(','),thana:!!c.thanaYard,loose:c.loose.all.length,stalls:c.stalls.length,kinds:[...new Set(c.stalls.map(s=>s.prop))].length,walkers:g.peds.walkers.length,fps:+g.engine.getFps().toFixed(0)}})()`));

// Every door: in, up, out.
for (const kind of ["home", "mall", "restaurant", "clinic", "bank", "hotel", "office", "thana"]) {
  const r = js(`(async()=>{const g=window.__game,d=g.doors; const b=g.city.interiors.all.find(q=>q.kind==='${kind}'); if(!b) return 'missing';
    d.inside=b; g.player.warp(b.x,b.y,b.z,b.yaw); await new Promise(r=>setTimeout(r,900)); const y0=g.player.y;
    const here={x:+g.player.x.toFixed(1),z:+g.player.z.toFixed(1),y:+y0.toFixed(2),people:b.people.length,spots:b.spots.map(s=>s.kind).join(','),lift:b.lift.length,shops:b.shops.length,area:g.city.layout.blockAt(b.outX,b.outZ)?'door on footpath':'door on road'};
    const stop=b.lift[b.lift.length-1]; if(stop){ g.player.warp(stop.x,stop.y,stop.z,stop.yaw); await new Promise(r=>setTimeout(r,700)); here.upstairsY=+g.player.y.toFixed(2);}
    return here})()`);
  console.log(kind, r);
  await wait(500);
  pic(`in_${kind}`);
  js(`(()=>{const g=window.__game,d=g.doors; const b=d.inside; if(b){d.inside=null; g.player.warp(b.outX,.16,b.outZ,b.outYaw);} return 1})()`);
  await wait(300);
}
console.log("back on street", js(`(()=>{const g=window.__game,p=g.player; return {x:+p.x.toFixed(1),z:+p.z.toFixed(1),y:+p.y.toFixed(2)}})()`));

// Traffic: new kinds on the road.
await wait(4000);
console.log("kinds on the road", js(`(()=>{const g=window.__game,o={}; for(const v of g.traffic.vehicles) o[v.id]=(o[v.id]||0)+1; return o})()`));

// Police: patrols, refusal, a report, an officer out of the car.
console.log("patrols", js(`(()=>{const g=window.__game; return g.law.patrols.length})()`));
console.log("refused", js(`(()=>{const g=window.__game,p=g.player,t=g.traffic; const v=t.spawnParkedAt('police_car','default',p.x+2,p.z,0); if(!v) return 'no car'; window.__pc=v; const out=[]; const best=t.nearestVehicle(p.x,p.z,3,p.y); g.events_refused=0; g.interactions; return {official:v.official,near:best&&best.id}})()`));
js(`(()=>{const g=window.__game,t=g.traffic,v=window.__pc; if(v){const i=t.parked.indexOf(v); if(i>=0)t.parked.splice(i,1);} return 1})()`);

// Towing: a car left in a running lane.
console.log("tow setup", js(`(()=>{const g=window.__game,t=g.traffic,p=g.player; const l=g.city.graph.lanes.filter(q=>q.road.cls!=='main'&&q.length>60&&q.index===0).sort((a,b)=>Math.hypot(a.pts[0]-p.x,a.pts[1]-p.z)-Math.hypot(b.pts[0]-p.x,b.pts[1]-p.z))[0]; const n=l.pts.length-2; const x=(l.pts[0]+l.pts[n])/2,z=(l.pts[1]+l.pts[n+1])/2; const v=t.spawnParkedAt('car_sedan','default',x,z,Math.atan2(l.pts[n]-l.pts[0],l.pts[n+1]-l.pts[1])); window.__left=v; g.law.lastInLane.set(v,99); return {x,z,inLane:t.standingInLane(v),km:+(Math.hypot(x-p.x,z-p.z)).toFixed(0)}})()`));
for (let i = 0; i < 12; i++) {
  await wait(5000);
  const s = js(`(()=>{const g=window.__game,w=g.law.wrecker,v=window.__left; return {wrecker:w?{state:w.state,t:+w.time.toFixed(0),d:+Math.hypot(w.v.x-v.x,w.v.z-v.z).toFixed(0)}:null,impounded:v.impounded,at:[+v.x.toFixed(0),+v.z.toFixed(0)]}})()`);
  console.log(" tow", s);
  if (s.includes('"impounded": true')) break;
}

// Rain.
js(`(()=>{const g=window.__game; g.env.setHour(11); g.weather.force(1); g.weather.wet=1; g.weather.heavyLeft=1; return 1})()`);
await wait(4000);
console.log("rain", js(`(()=>{const g=window.__game,W=g.weather; return {rain:+W.rain.toFixed(2),wet:+W.wet.toFixed(2),flood:+W.flood.toFixed(2),patches:W.floodPatches.length,fps:+g.engine.getFps().toFixed(0),umbrellas:g.peds.rainGear.nC,coats:g.peds.rainGear.nK}})()`));
pic("rain");
js(`(()=>{const g=window.__game,W=g.weather,q=W.floodPatches[0]; g.player.warp((q.x0+q.x1)/2,0,(q.z0+q.z1)/2,0); return 1})()`);
await wait(2500);
pic("flood");
console.log("flood here", js(`(()=>{const g=window.__game; return {floodAt:g.weather.floodAt(g.player.x,g.player.z),pace:g.player.groundPace}})()`));
js(`(()=>{const g=window.__game; g.weather.force(0); g.weather.wet=0; g.weather.heavyLeft=0; g.weather.timer=9999; return 1})()`);
await wait(2000);

// The day: night closures, a power cut, Eid.
js(`(()=>{const g=window.__game; g.player.respawn(); g.env.setHour(23.2); return 1})()`);
await wait(2500);
console.log("night", js(`(()=>{const g=window.__game,r=g.rhythm; return {shopsOpen:r.shopsAreOpen,traffic:+r.traffic.toFixed(2),people:+r.people.toFixed(2),shutters:g.city.shutterMeshes.size}})()`));
pic("night");
js(`(()=>{const g=window.__game; g.rhythm.powerOff=30; g.night.setPower(false); g.city.setPower(false); return 1})()`);
await wait(1200);
pic("powercut");
js(`(()=>{const g=window.__game; g.rhythm.powerOff=0.01; g.env.setHour(11); return 1})()`);
await wait(1500);
js(`(()=>{const g=window.__game; g.save.day=7; return 1})()`);
await wait(1200);
console.log("eid", js(`(()=>{const g=window.__game; return {eid:g.rhythm.isEid}})()`));
js(`(()=>{const g=window.__game; g.save.day=8; return 1})()`);

// Evening crowds.
js(`(()=>{const g=window.__game,f=g.city.factories[0]; g.env.setHour(17.4); if(f) g.player.warp(f.gateX+6,.16,f.gateZ-3,0); return f?1:0})()`);
await wait(6000);
console.log("shift change", js(`(()=>{const g=window.__game,p=g.player; return {out:g.peds.routed.filter(q=>q.hours&&q.who.x<1e4&&Math.hypot(q.who.x-p.x,q.who.z-p.z)<70).length,total:g.peds.routed.filter(q=>q.hours).length}})()`));
pic("shift");

console.log("errors", js(`(window.__errs||[]).slice(-6)`));
