// Runs traffic and pedestrians through simulated minutes with no rendering, and reports anything odd:
// bad numbers, vehicles off the road or stuck, overlapping traffic, people inside buildings or adrift.
// Usage: node tools/test/soak.mjs [minutes]
import { execFileSync } from "node:child_process";

const minutes = +(process.argv[2] ?? 5);
const edge = (...a) => execFileSync("node", ["tools/test/edge.mjs", ...a], { encoding: "utf8", maxBuffer: 1 << 24 });

const js = `(async () => {
  const g = window.__game, t = g.traffic, peds = g.peds, city = g.city, layout = city.layout;
  if (g.state !== "playing") g.testPlay();
  g.state = "paused";
  const dt = 1 / 30;
  const steps = Math.round(${minutes} * 60 / dt);
  const report = { bad: 0, stuckAtEnd: [], longStops: 0, overlaps: 0, offRoad: new Set(), peopleInWalls: 0, peopleFar: 0, peopleAir: 0, walkers: 0, busDwells: 0, boardings: 0, jumps: 0, errors: [] };
  const seen = new Map();
  t.onBusDwell = ((orig) => (stop, v) => { report.busDwells++; orig?.(stop, v); })(t.onBusDwell);
  const WORK = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
  // Wander: the player's point moves round the district so spawning and despawning are exercised.
  let px = -15, pz = -34;
  for (let i = 0; i < steps; i++) {
    const a = i * dt * 0.02;
    px = Math.sin(a) * 220;
    pz = Math.cos(a * 1.3) * 220;
    t.playerX = px; t.playerZ = pz;
    try {
      t.update(dt);
      peds.update(dt, px, pz, null, 0, px, pz, 0, 1);
    } catch (e) {
      report.errors.push(String(e && e.stack || e).slice(0, 300));
      if (report.errors.length > 3) break;
    }
    if (i % 15 !== 0) continue;
    for (const v of t.vehicles) {
      if (!isFinite(v.x) || !isFinite(v.z) || !isFinite(v.heading) || !isFinite(v.speed)) report.bad++;
      const last = seen.get(v);
      if (last && Math.hypot(v.x - last.x, v.z - last.z) > Math.max(v.speed, 8) * dt * 15 + 3) report.jumps++;
      if (last && v.speed < 0.05) { last.still += 0.5; if (last.still === 45) report.longStops++; }
      else if (last) last.still = 0;
      if (!last) seen.set(v, { x: v.x, z: v.z, still: 0 }); else { last.x = v.x; last.z = v.z; }
      if (v.lane && !v.connector && Math.abs(v.lateral) < 0.1) {
        const road = layout.roadNameAt ? layout.roadNameAt(v.x, v.z) : "x";
        if (!road) report.offRoad.add(v.id + "@" + v.x.toFixed(0) + "," + v.z.toFixed(0));
      }
    }
    if (i % 90 === 0) {
      const all = t.vehicles;
      for (let a2 = 0; a2 < all.length; a2++) for (let b = a2 + 1; b < all.length; b++) {
        const p = all[a2], q = all[b];
        if (Math.abs(p.x - q.x) > 6 || Math.abs(p.z - q.z) > 6) continue;
        if (Math.hypot(p.x - q.x, p.z - q.z) < 0.9) report.overlaps++;
      }
      for (const w of peds.walkers) {
        if (!isFinite(w.x) || !isFinite(w.z)) report.bad++;
        if (w.y < -0.5 || w.y > 3) report.peopleAir++;
        city.collision.resolveCircle(w.x, w.z, 0.1, WORK);
        // Solid scenery only applies to people within sight of the player.
        if (WORK.hit && w.state === "walk" && Math.hypot(w.x - px, w.z - pz) < 40) report.peopleInWalls++;
        if (Math.hypot(w.x - px, w.z - pz) > 400 && !peds.isQueued(w)) report.peopleFar++;
      }
    }
  }
  report.walkers = peds.walkers.length;
  report.stuckAtEnd = t.vehicles.filter((v) => v.stuckTime > 15).map((v) => v.id + " stuck " + v.stuckTime.toFixed(0) + "s at " + v.x.toFixed(0) + "," + v.z.toFixed(0));
  report.offRoad = [...report.offRoad].slice(0, 12);
  report.vehicles = t.vehicles.length;
  report.states = peds.walkers.reduce((o, w) => (o[w.state] = (o[w.state] || 0) + 1, o), {});
  g.state = "playing";
  return report;
})()`;

console.log(edge("eval", js));
