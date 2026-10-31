// How each vehicle handles, measured by driving the real body with scripted keys on an empty plane.
// Usage: node tools/test/handling.mjs [vehicle ids]
import { execFileSync } from "node:child_process";

const edge = (...a) => execFileSync("node", ["tools/test/edge.mjs", ...a], { encoding: "utf8", maxBuffer: 1 << 24 });
const ids = process.argv.slice(2);
const list = ids.length ? ids : ["bicycle", "rickshaw", "easybike", "cng", "motorbike", "car_sedan", "microbus", "bus_city", "truck"];

const out = edge("eval", `(()=>{
  const g=window.__game,t=g.traffic;
  const dt=1/60, ground=()=>0;
  const fresh=(id)=>{ const v=t.spawnParkedAt(id,"default",0,0,0); t.parked.splice(t.parked.indexOf(v),1); v.mode="player"; v.speed=0; v.sideSpeed=0; v.spin=0; v.heading=0; v.x=0; v.z=0; v.steerAngle=0; return v; };
  const run=(v,thr,st,hb,sec)=>{ const n=Math.round(sec/dt); for(let i=0;i<n;i++) v.drive({throttle:thr,steer:st,handbrake:hb},dt,null,ground); };
  const rows={};
  for(const id of ${JSON.stringify(list)}){
    const r={};
    let v=fresh(id);
    // Off the line.
    let time=0; const aim=Math.min(v.spec.topSpeed*.8,20); while(v.speed<aim&&time<30){ v.drive({throttle:1,steer:0,handbrake:false},dt,null,ground); time+=dt; }
    r.zeroTo=[+aim.toFixed(1),+time.toFixed(1)];
    run(v,1,0,false,20); r.top=+v.speed.toFixed(1);
    // Stopping from 12 m/s, or as near as it gets.
    v=fresh(id); v.speed=Math.min(12,v.spec.topSpeed*.9); const from=v.speed; let z0=v.z; time=0; while(v.speed>0.05&&time<12){ v.drive({throttle:-1,steer:0,handbrake:false},dt,null,ground); time+=dt; }
    r.stop=[+from.toFixed(1),+(v.z-z0).toFixed(1)]; run(v,0,0,false,1); r.afterStop=+v.speed.toFixed(3);
    // Tightest circle at walking pace.
    v=fresh(id); v.speed=3; run(v,.25,1,false,4); r.lowR=+(Math.abs(v.speed)/Math.max(Math.abs(v.spin),.01)).toFixed(1);
    // A hard corner at speed: how much grip, how far the back steps out.
    const fast=Math.min(16,v.spec.topSpeed*.85);
    v=fresh(id); v.speed=fast; let maxG=0,maxSlip=0,maxSpin=0; for(let i=0;i<180;i++){ v.drive({throttle:.6,steer:1,handbrake:false},dt,null,ground); maxG=Math.max(maxG,Math.abs(v.spin*v.speed)); maxSlip=Math.max(maxSlip,Math.abs(Math.atan2(v.sideSpeed,Math.abs(v.speed)+.01))); maxSpin=Math.max(maxSpin,Math.abs(v.spin)); }
    r.corner={speed:+fast.toFixed(1),latG:+(maxG/9.8).toFixed(2),slipDeg:+(maxSlip*57.3).toFixed(1),endSpeed:+v.speed.toFixed(1)};
    run(v,.3,0,false,2); r.straightens={spin:+v.spin.toFixed(3),side:+v.sideSpeed.toFixed(2)};
    // Quick left-right at speed: does it settle?
    v=fresh(id); v.speed=fast; run(v,.4,1,false,.5); run(v,.4,-1,false,.5); run(v,.4,0,false,1.5); r.flick={spin:+v.spin.toFixed(3),side:+v.sideSpeed.toFixed(2)};
    // Handbrake into a turn.
    v=fresh(id); v.speed=fast; let peak=0; for(let i=0;i<120;i++){ v.drive({throttle:0,steer:1,handbrake:true},dt,null,ground); peak=Math.max(peak,Math.abs(Math.atan2(v.sideSpeed,Math.abs(v.speed)+.01))); } r.handbrake={slideDeg:+(peak*57.3).toFixed(0),turnedDeg:+(v.heading*57.3).toFixed(0),left:+Math.hypot(v.speed,v.sideSpeed).toFixed(1)};
    rows[id]=r;
  }
  return JSON.stringify(rows);
})()`);
const rows = JSON.parse(JSON.parse(out));
for (const [id, r] of Object.entries(rows)) console.log(id.padEnd(10), JSON.stringify(r));
