// Drives down the road for a while and reports which system caused any slow frames.
// Usage: node tools/test/hitch_probe.mjs [seconds] [foot|car]
import { execFileSync } from "node:child_process";

const seconds = +(process.argv[2] ?? 20);
const how = process.argv[3] ?? "car";
const edge = (...a) => execFileSync("node", ["tools/test/edge.mjs", ...a], { encoding: "utf8", maxBuffer: 1 << 24 });

const js = `(async () => {
  const g = window.__game, p = g.player;
  if (g.state !== "playing") g.testPlay();
  const cur = {};
  const wrap = (obj, name, label) => {
    const f = obj[name];
    if (f.__wrapped) return;
    const w = function (...a) {
      const t = performance.now();
      const r = f.apply(this, a);
      cur[label] = (cur[label] || 0) + performance.now() - t;
      return r;
    };
    w.__wrapped = true;
    obj[name] = w;
  };
  wrap(g.city, "updateStreaming", "streaming");
  wrap(g.peds, "update", "peds");
  wrap(g.traffic, "update", "traffic");
  wrap(g.fleet, "render", "fleet");
  wrap(g.crowd, "end", "crowdEnd");
  wrap(g.night, "update", "night");
  wrap(g.city.props, "updateVisibility", "propVis");
  wrap(g.player, "update", "player");
  wrap(g.scene, "render", "render");
  wrap(g.env, "update", "env");
  ${how === "car" ? `
  p.respawn();
  const all = [...g.traffic.parked].filter((q) => q.id === "car_sedan");
  const v = all[0];
  g.traffic.takeOver(v);
  v.place(40, 2.25, 1.57);
  p.vehicle = v; p.asPassenger = false; p.setStage("driving");
  ` : ""}
  const key = (code, type) => window.dispatchEvent(new KeyboardEvent(type, { code }));
  key("KeyW", "keydown");
  const rows = [];
  const frames = [];
  let last = performance.now();
  let end = last + ${seconds} * 1000;
  await new Promise((res) => {
    const tick = (t) => {
      const dt = t - last;
      last = t;
      frames.push(dt);
      if (dt > 22) {
        const parts = Object.entries(cur).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => k + " " + v.toFixed(1)).join(", ");
        rows.push(dt.toFixed(0) + "ms: " + parts);
      }
      for (const k in cur) delete cur[k];
      if (t < end) requestAnimationFrame(tick); else res();
    };
    requestAnimationFrame(tick);
  });
  key("KeyW", "keyup");
  const sorted = [...frames].sort((a, b) => a - b);
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
  const pos = p.position;
  return { frames: frames.length, fps: +(1000 / avg).toFixed(1), p50: +sorted[Math.floor(sorted.length * 0.5)].toFixed(1), p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1), p99: +sorted[Math.floor(sorted.length * 0.99)].toFixed(1), worst: +sorted[sorted.length - 1].toFixed(1), slow: rows.length, at: [pos.x, pos.z].map((n) => +n.toFixed(0)), rows: rows.slice(0, 26) };
})()`;
console.log(edge("eval", js));
