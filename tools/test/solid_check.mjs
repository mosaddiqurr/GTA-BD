// Checks that solid things stay solid. Counts vehicles overlapping each other over a stretch of real time,
// throws the player's vehicle at walls from every angle, drops the hero into walls, and looks for people
// who aren't getting anywhere around the footbridge and the station.
// Usage: node tools/test/solid_check.mjs [seconds]
import { execFileSync } from "node:child_process";

const seconds = Number(process.argv[2] ?? 20);
const edge = (...a) => execFileSync("node", ["tools/test/edge.mjs", ...a], { encoding: "utf8", maxBuffer: 1 << 24 });
const js = (s) => edge("eval", s).trim().replace(/\s+/g, " ");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A self-contained overlap test, so this checks the game rather than sharing its code.
const SAT = `const overlap = (a, b) => {
  const as = Math.sin(a.heading), ac = Math.cos(a.heading), bs = Math.sin(b.heading), bc = Math.cos(b.heading);
  const ahl = a.spec.length / 2, ahw = a.spec.width / 2, bhl = b.spec.length / 2, bhw = b.spec.width / 2;
  const dx = a.x - b.x, dz = a.z - b.z;
  let best = 99;
  for (const [ux, uz] of [[as, ac], [ac, -as], [bs, bc], [bc, -bs]]) {
    const ra = ahl * Math.abs(ux * as + uz * ac) + ahw * Math.abs(ux * ac - uz * as);
    const rb = bhl * Math.abs(ux * bs + uz * bc) + bhw * Math.abs(ux * bc - uz * bs);
    const o = ra + rb - Math.abs(dx * ux + dz * uz);
    if (o <= 0) return 0;
    best = Math.min(best, o);
  }
  return best;
};`;

js(`(()=>{const g=window.__game; if(g.state!=='playing') g.testPlay(); g.settings.traffic=3; g.applyDensity(); const p=g.player; p.respawn(); p.x=-16;p.z=-80;p.y=.16; g.rig.snap(p.x,p.y,p.z,0);
  window.__ov={frames:0,pairs:0,deep:0,worst:0,seen:new Set()};
  ${SAT}
  window.__ovObs=g.scene.onAfterRenderObservable.add(()=>{
    const r=window.__ov, t=g.traffic, list=[...t.vehicles,...t.parked].filter(v=>Math.hypot(v.x-p.x,v.z-p.z)<70);
    r.frames++;
    for(let i=0;i<list.length;i++) for(let j=i+1;j<list.length;j++){ const a=list[i],b=list[j]; if(Math.abs(a.x-b.x)>14||Math.abs(a.z-b.z)>14||Math.abs(a.y-b.y)>2.6) continue; const o=overlap(a,b); if(o>0.02){ r.pairs++; if(o>0.15) r.deep++; if(o>r.worst){r.worst=o; r.what=a.id+'/'+b.id+' '+a.mode+'/'+b.mode;} } }
  });
  return 1})()`);
await wait(seconds * 1000);
console.log("traffic overlap", js(`(()=>{const g=window.__game,r=window.__ov; g.scene.onAfterRenderObservable.remove(window.__ovObs); return {frames:r.frames,touching:r.pairs,deep:r.deep,worst:+r.worst.toFixed(3),what:r.what,perFrame:+(r.pairs/Math.max(r.frames,1)).toFixed(2),vehicles:g.traffic.vehicles.length}})()`));

// Throw every kind of vehicle at walls, with the real driving code.
console.log("into walls", js(`(()=>{
  const g=window.__game,t=g.traffic,c=g.city.collision,lay=g.city.layout;
  ${SAT}
  const ids=["car_sedan","microbus","bus_city","truck","cng","rickshaw","motorbike","bicycle"];
  const r={tries:0,inside:0,worst:0,by:{}};
  const spots=g.city.frontages.filter(s=>!s.back);
  let rnd=12345; const R=()=>{rnd=(rnd*16807)%2147483647; return rnd/2147483647;};
  const dt=1/60;
  for(let n=0;n<420;n++){
    const id=ids[n%ids.length]; const s=spots[Math.floor(R()*spots.length)];
    const v=t.spawnParkedAt(id,"default",0,0,0); if(!v) continue; t.parked.splice(t.parked.indexOf(v),1);
    const ca=Math.cos(s.angle), sa=Math.sin(s.angle), u=(R()-.5)*s.w;
    const away=4+R()*10;
    v.x=s.x+u*ca-away*sa; v.z=s.z-u*sa-away*ca; v.heading=s.angle+(R()-.5)*1.6; v.speed=v.spec.topSpeed*(.35+R()*.65); v.y=0;
    // Somewhere to start from at all: in front of one building may be inside the next.
    const clear={x:0,z:0,nx:0,nz:0,hit:false}; c.resolveCircle(v.x,v.z,Math.max(v.spec.length,v.spec.width)/2+.3,clear); if(clear.hit) continue;
    const inp={throttle:1,steer:(R()-.5)*2,handbrake:false};
    for(let f=0;f<110;f++) v.drive(inp,dt,c,(x,z)=>lay.groundHeight(x,z));
    r.tries++;
    const sn=Math.sin(v.heading), cs=Math.cos(v.heading), hl=v.spec.length/2, hw=v.spec.width/2;
    for(const q of c.query(v.x,v.z,hl+hw+1)){
      if(q.kind!=="box") continue;
      const other={x:(q.x0+q.x1)/2,z:(q.z0+q.z1)/2,heading:0,y:0,spec:{length:q.z1-q.z0,width:q.x1-q.x0}};
      const o=overlap(v,other);
      if(o>0.03){ r.inside++; r.by[id]=(r.by[id]||0)+1; r.worst=Math.max(r.worst,o); break; }
    }
  }
  r.worst=+r.worst.toFixed(3);
  return r;
})()`));

// The hero walking about at random from a free spot, a step at a time: are they ever inside anything?
console.log("hero walking", js(`(()=>{
  const g=window.__game,c=g.city.collision; const W={x:0,z:0,nx:0,nz:0,hit:false};
  let rnd=777; const R=()=>{rnd=(rnd*16807)%2147483647; return rnd/2147483647;};
  let bad=0,steps=0,walks=0;
  for(let i=0;i<300;i++){
    let x=(R()-.5)*1660,z=(R()-.5)*1660;
    c.resolveCircle(x,z,0.34,W);
    if(W.hit) continue;
    walks++;
    let a=R()*6.28;
    for(let k=0;k<400;k++){
      if(R()<.03) a=R()*6.28;
      c.resolveCircle(x+Math.sin(a)*.09,z+Math.cos(a)*.09,0.34,W);
      x=W.x; z=W.z; steps++;
      c.resolveCircle(x,z,0.3,W);
      if(W.hit) bad++;
    }
  }
  return {walks,steps,insideSomething:bad};
})()`));

// Big props whose solid area is much smaller than what can be seen.
console.log("props", js(`(()=>{const p=window.__game.city.props; const out={}; for(const id of ["mosque","golchattar","police_box","bus_stop","tin_shed","billboard","tea_stall","metro_station"]){ const b=p.solidBox(id); out[id]=b?[+(b.x1-b.x0).toFixed(1),+(b.z1-b.z0).toFixed(1)]:null; } return out;})()`));

// Crowds at the choke points.
const m = js(`(()=>{const g=window.__game,p=g.player; g.settings.crowd=3; g.applyDensity(); const l=g.city.region.layout; const st=l.metro?{x:l.metro.x,z:l.metro.stationZ}:{x:0,z:-62}; p.x=st.x+22;p.z=st.z-52;p.y=.16; g.rig.snap(p.x,p.y,p.z,0); return [st.x,st.z]})()`);
const [sx, sz] = JSON.parse(m);
await wait(14000);
js(`(()=>{const pd=window.__game.peds; window.__was=new Map(pd.walkers.map(w=>[w,[w.x,w.z]])); return 1})()`);
await wait(6000);
console.log("stuck near station", js(`(()=>{const pd=window.__game.peds; let near=0,stuck=0,states={}; for(const w of pd.walkers){ if(Math.hypot(w.x-${sx},w.z-${sz})>70||w.state!=="walk") continue; near++; const b=window.__was.get(w); if(b&&Math.hypot(w.x-b[0],w.z-b[1])<1){ stuck++; } } return {walkingNear:near,stuck}})()`));
js(`(()=>{const g=window.__game; g.settings.crowd=1; g.settings.traffic=1; g.applyDensity(); g.player.respawn(); return 1})()`);
