// Measures real frame times at several places around the district, on the current quality preset.
// Usage: node tools/test/fps_tour.mjs [low|medium|high|ultra]
import { execFileSync } from "node:child_process";

const quality = process.argv[2];
const edge = (...a) => execFileSync("node", ["tools/test/edge.mjs", ...a], { encoding: "utf8" });

const spots = [
  ["spawn", -15, -34, 0],
  ["golchattar", 0, -22, 0],
  ["east road", 110, 8, -1.57],
  ["market lane", -120, -60, 1.0],
  ["terminal", 80, 150, 3.1],
  ["metro north", -8, 240, 3.1],
];

const measure = (name, x, z, yaw) => `(async () => {
  const g = window.__game, p = g.player;
  if (g.state !== "playing") g.testPlay();
  p.respawn();
  p.x = ${x}; p.z = ${z}; p.yaw = ${yaw};
  g.rig.yaw = ${yaw};
  g.rig.snap(p.x, p.y, p.z, ${yaw});
  await new Promise((r) => setTimeout(r, 2500));
  const frames = [];
  let last = performance.now();
  await new Promise((res) => {
    const tick = (t) => {
      frames.push(t - last);
      last = t;
      if (frames.length < 240) requestAnimationFrame(tick); else res();
    };
    requestAnimationFrame(tick);
  });
  frames.shift();
  const sorted = [...frames].sort((a, b) => a - b);
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
  return { spot: "${name}", fps: +(1000 / avg).toFixed(1), p50: +sorted[Math.floor(sorted.length * 0.5)].toFixed(1), p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1), worst: +sorted[sorted.length - 1].toFixed(1), active: g.scene.getActiveMeshes().length, tris: g.engine.drawCalls, people: g.crowd.drawn, live: g.peds.liveNow, cars: g.traffic.vehicles.length };
})()`;

if (quality) console.log(edge("eval", `(() => { const g = window.__game; if (g.state !== "playing") g.testPlay(); g.changeQuality("${quality}"); return g.quality.name; })()`).trim());
for (const [name, x, z, yaw] of spots) {
  console.log(edge("eval", measure(name, x, z, yaw)).trim().replace(/\s+/g, " "));
}
