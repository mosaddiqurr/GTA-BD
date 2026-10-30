// Switches expensive features off one at a time at one spot, to see what each costs in frame rate.
// Usage: node tools/test/cost_probe.mjs
import { execFileSync } from "node:child_process";

const edge = (...a) => execFileSync("node", ["tools/test/edge.mjs", ...a], { encoding: "utf8", maxBuffer: 1 << 24 });

const measure = `(async () => {
  await new Promise((r) => setTimeout(r, 1200));
  const frames = [];
  let last = performance.now();
  await new Promise((res) => {
    const tick = (t) => {
      frames.push(t - last);
      last = t;
      if (frames.length < 200) requestAnimationFrame(tick); else res();
    };
    requestAnimationFrame(tick);
  });
  frames.shift();
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
  const slow = frames.filter((f) => f > 20).length;
  return { fps: +(1000 / avg).toFixed(1), slowPct: Math.round((slow / frames.length) * 100) };
})()`;

const run = (label, setup, undo) => {
  edge("eval", `(() => { const g = window.__game; ${setup} })()`);
  console.log(label.padEnd(24), edge("eval", measure).trim().replace(/\s+/g, " "));
  if (undo) edge("eval", `(() => { const g = window.__game; ${undo} })()`);
};

edge("eval", `(() => { const g = window.__game; if (g.state !== "playing") g.testPlay(); const p = g.player; p.respawn(); p.x = 0; p.z = -30; g.rig.yaw = 0; g.rig.snap(p.x, p.y, p.z, 0); })()`);
run("baseline", "");
run("no SSAO", `g.post.ssao && g.scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline("ssao", g.rig.camera);`, `g.post.ssao && g.scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline("ssao", g.rig.camera);`);
run("MSAA 1x", `g.post.pipeline && (g.post.pipeline.samples = 1);`, `g.post.pipeline && (g.post.pipeline.samples = 4);`);
run("no shadows", `g.env.shadows.getShadowMap().refreshRate = 0; g.scene.shadowsEnabled = false;`, `g.scene.shadowsEnabled = true; g.env.shadows.getShadowMap().refreshRate = 1;`);
run("people 60", `g.peds.setTarget(60); g.peds.walkers.splice(100);`, `g.peds.setTarget(g.quality.pedestrians);`);
run("half resolution", `g.engine.setHardwareScalingLevel(1.6);`, `g.engine.setHardwareScalingLevel(0.8);`);
run("baseline again", "");
