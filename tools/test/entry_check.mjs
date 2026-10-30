// Steps the get-in and get-out sequences a frame at a time and saves a strip of screenshots.
// Usage: node tools/test/entry_check.mjs <output dir> <vehicle id> [drive|ride]
import { execFileSync } from "node:child_process";

const [outDir, id = "car_sedan", how = "drive"] = process.argv.slice(2);
const edge = (...a) => execFileSync("node", ["tools/test/edge.mjs", ...a], { encoding: "utf8" });
const ride = how === "ride";

const setup = `(() => {
  const g = window.__game, p = g.player;
  if (g.state !== "playing") g.testPlay();
  document.getElementById("ui").style.display = "none";
  g.state = "paused";
  p.respawn();
  const all = [...g.traffic.vehicles, ...g.traffic.parked];
  const v = all.find((q) => q.id === "${id}" && q.driverId && q.mode === "ai" && !q.connector) ?? all.find((q) => q.id === "${id}");
  if (!v) return "none of ${id}";
  window.__v = v;
  v.speed = 0;
  // Start a few steps from the boarding side, as a player would.
  const side = p.boardingPoint(v, ${ride});
  const b = v.worldPoint(side);
  const ax = b.x - v.x, az = b.z - v.z, l = Math.hypot(ax, az);
  p.x = b.x + (ax / l) * 2.2 - Math.sin(v.heading) * 1.2;
  p.z = b.z + (az / l) * 2.2 - Math.cos(v.heading) * 1.2;
  p.y = g.city.layout.groundHeight(p.x, p.z);
  p.beginEnter(v, ${ride});
  g.rig.pitch = 0.16;
  g.rig.yaw = Math.atan2(v.x - p.x, v.z - p.z) + 0.75;
  g.rig.snap(p.x, p.y, p.z, g.rig.yaw);
  return { id: v.id, driver: v.driverId, stage: p.stage, seats: v.arch.passengerSeats.length };
})()`;

console.log(edge("eval", setup).trim().replace(/\s+/g, " "));

const advance = (seconds, key) => `(() => {
  const g = window.__game, p = g.player, yaw = g.rig.yaw, pitch = g.rig.pitch;
  ${key ? `g.input.justPressed.add("${key}");` : ""}
  const n = Math.round(${seconds} * 60);
  for (let i = 0; i < n; i++) { g.step(1 / 60); g.input.endFrame(); g.rig.yaw = yaw; g.rig.pitch = pitch; }
  const v = window.__v;
  return p.stage + " door " + v.doorAngle.toFixed(2) + " driver " + v.driverId + " hero " + p.character.root.position.asArray().map((n) => +n.toFixed(2)).join(",");
})()`;

let frame = 0;
const shot = async (label) => {
  console.log(String(frame).padStart(2, "0"), label, edge("canvas", `${outDir}/entry_${id}_${String(frame).padStart(2, "0")}.jpg`).trim().length > 0 ? "" : "");
  frame++;
};

const wait = () => new Promise((r) => setTimeout(r, 180));
for (let i = 0; i < 12; i++) {
  const s = edge("eval", advance(i < 3 ? 0.25 : 0.33)).trim();
  await wait();
  await shot(s);
}
console.log("--- getting out");
edge("eval", `(() => { const v = window.__v; v.speed = 0; v.holdTime = 30; })()`);
const s0 = edge("eval", advance(0.02, "KeyF")).trim();
console.log(s0);
for (let i = 0; i < 6; i++) {
  const s = edge("eval", advance(0.25)).trim();
  await wait();
  await shot(s);
}
edge("eval", `(() => { const g = window.__game; g.state = "playing"; document.getElementById("ui").style.display = ""; })()`);
