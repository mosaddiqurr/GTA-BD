// How steady a vehicle sits on screen while driving, with the raw frame timer and the steadied one.
// The figure is how many pixels it jumps about from frame to frame, sideways and up and down, once the
// vehicle's smooth drift across the screen is taken away. Lower is smoother.
// Usage: node tools/test/feel_probe.mjs [vehicle ids]
import { execFileSync } from "node:child_process";

const ids = process.argv.slice(2);
const edge = (...a) => execFileSync("node", ["tools/test/edge.mjs", ...a], { encoding: "utf8", maxBuffer: 1 << 24 });
const js = (s) => edge("eval", s).trim().replace(/\s+/g, " ");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const collect = `(() => {
  const g = window.__game;
  window.__feel = [];
  const p = { x: 0, y: 0 };
  const tick = () => {
    const v = g.player.vehicle;
    if (!v) return;
    g.project(v.x, v.y + 0.8, v.z, p);
    window.__feel.push([p.x, p.y, v.speed]);
    if (window.__feel.length < 320) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return 1;
})()`;

const read = `(() => {
  const f = window.__feel;
  const steps = [];
  for (let i = 2; i < f.length; i++) {
    if (Math.abs(f[i][2]) < 4) continue;
    steps.push(Math.hypot(f[i][0] - 2 * f[i - 1][0] + f[i - 2][0], f[i][1] - 2 * f[i - 1][1] + f[i - 2][1]));
  }
  steps.sort((a, b) => a - b);
  const avg = steps.reduce((a, b) => a + b, 0) / Math.max(steps.length, 1);
  return { frames: steps.length, jitterPx: +avg.toFixed(3), p95Px: +(steps[Math.floor(steps.length * 0.95)] ?? 0).toFixed(3) };
})()`;

const run = async (id, label, setup) => {
  js(`(() => {
    const g = window.__game, p = g.player, t = g.traffic;
    if (g.state !== "playing") g.testPlay();
    p.respawn();
    ${setup}
    const lane = t.mainLanes.filter((l) => l.length > 120)[0];
    const hd = Math.atan2(lane.pts[2] - lane.pts[0], lane.pts[3] - lane.pts[1]);
    const v = t.parked.find((q) => q.id === "${id}") ?? t.spawnParkedAt("${id}", "default", 0, 0, 0);
    t.takeOver(v);
    v.driverId = null;
    p.vehicle = v; p.asPassenger = false; p.door = null; p.setStage("driving");
    v.place(lane.pts[0], lane.pts[1], hd);
    v.y = 0; v.speed = 7;
    g.rig.snap(v.x, v.y, v.z, hd);
    t.vehicles.forEach((q) => { if (Math.hypot(q.x - v.x, q.z - v.z) < 60) q.stuckTime = 99; });
    return 1;
  })()`);
  await wait(600);
  js(collect);
  edge("key", "KeyW", "5400");
  await wait(200);
  console.log(id.padEnd(10), label.padEnd(10), js(read));
};

js(`(() => { const g = window.__game; if (g.state !== "playing") g.testPlay(); window.__steady = g.steadyDt; return 1; })()`);
for (const id of ids.length ? ids : ["car_sedan", "motorbike"]) {
  await run(id, "raw timer", `g.steadyDt = () => Math.min(g.engine.getDeltaTime() / 1000, 0.066);`);
  await run(id, "steadied", `g.steadyDt = window.__steady;`);
}
js(`(() => { const g = window.__game; g.steadyDt = window.__steady; g.player.respawn(); return 1; })()`);
