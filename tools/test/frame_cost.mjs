// What the game itself spends per frame, system by system, in milliseconds. Unlike FPS this barely
// changes when another program on the machine is busy, so it can tell a real slowdown from outside load.
// Usage: node tools/test/frame_cost.mjs [frames]
import { execFileSync } from "node:child_process";

const frames = Number(process.argv[2] ?? 300);
const edge = (...a) => execFileSync("node", ["tools/test/edge.mjs", ...a], { encoding: "utf8", maxBuffer: 1 << 24 });
const SPOTS = { spawn: [-15, -34], golchattar: [-12, 22], "east road": [120, 3], "market lane": [-150, -70] };

const measure = `(async () => {
  const g = window.__game;
  const t = {};
  const wrap = (obj, name, label) => {
    const f = obj[name];
    t[label] = [];
    obj[name] = function (...a) {
      const s = performance.now();
      const r = f.apply(this, a);
      t[label][t[label].length] = performance.now() - s;
      return r;
    };
    return () => { delete obj[name]; if (obj[name] !== f) obj[name] = f; };
  };
  const undo = [
    wrap(g.player, "update", "player"),
    wrap(g.interactions, "update", "offers (new)"),
    wrap(g.talk, "update", "talk (new)"),
    wrap(g.tea, "update", "tea (new)"),
    wrap(g.reactions, "update", "reactions (new)"),
    wrap(g.hud, "layoutWorldText", "world text (new)"),
    wrap(g.traffic, "update", "traffic"),
    wrap(g.peds, "update", "people"),
    wrap(g.fleet, "render", "fleet"),
    wrap(g, "stepWorld", "whole world"),
    wrap(g.scene, "render", "draw"),
    wrap(g, "frame", "whole frame"),
  ];
  const draws = [];
  await new Promise((res) => {
    let n = 0;
    const tick = () => {
      draws.push(g.engine._drawCalls.current);
      if (++n < ${frames}) requestAnimationFrame(tick); else res();
    };
    requestAnimationFrame(tick);
  });
  undo.forEach((u) => u());
  const out = {};
  for (const k in t) {
    const a = t[k].slice().sort((p, q) => p - q);
    if (!a.length) continue;
    out[k] = [+(a.reduce((p, q) => p + q, 0) / ${frames}).toFixed(2), +a[Math.floor(a.length * 0.95)].toFixed(2)];
  }
  out.drawCalls = Math.round(draws.reduce((p, q) => p + q, 0) / draws.length);
  return out;
})()`;

edge("eval", `(() => { const g = window.__game; if (g.state !== "playing") g.testPlay(); })()`);
for (const [name, [x, z]] of Object.entries(SPOTS)) {
  edge("eval", `(() => { const g = window.__game, p = g.player; p.respawn(); p.x = ${x}; p.z = ${z}; p.y = g.city.layout.groundHeight(p.x, p.z); g.rig.snap(p.x, p.y, p.z, 0); g.city.forceDetailAround(p.x, p.z); })()`);
  await new Promise((r) => setTimeout(r, 1500));
  console.log(name, "(average ms, p95 ms)");
  console.log(edge("eval", measure).trim().replace(/\s+/g, " "));
}
