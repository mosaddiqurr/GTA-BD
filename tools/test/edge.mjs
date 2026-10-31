// Drives the game in a real browser on the discrete GPU, for honest FPS numbers and screenshots.
//
//   node tools/test/edge.mjs start [vsync|igpu]    launches headless Edge with the RTX GPU, or the weak one
//   node tools/test/edge.mjs goto <url>
//   node tools/test/edge.mjs eval "<js expression>" (async allowed; prints JSON)
//   node tools/test/edge.mjs shot <file.png> [width height]
//   node tools/test/edge.mjs key <code> <ms>        hold a key, e.g. KeyW 2000
//   node tools/test/edge.mjs profile <seconds> [lines]  where script time goes, by function
//   node tools/test/edge.mjs sized <w> <h> "<js>" [file.png]   the same at another window size
//   node tools/test/edge.mjs stop
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9333;
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const [cmd, ...args] = process.argv.slice(2);

async function target() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  // Only ever talk to the game's own tab or a blank one, never a browser-owned page.
  return list.find((t) => t.type === "page" && (t.url.startsWith("http://localhost") || t.url === "about:blank"));
}

async function withSession(fn) {
  const t = await target();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  try {
    return await fn(send);
  } finally {
    ws.close();
  }
}

const KEY_CODES = { KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68, KeyF: 70, KeyE: 69, KeyH: 72, KeyR: 82, KeyC: 67, KeyT: 84, KeyM: 77, KeyV: 86, KeyG: 71, KeyQ: 81, Digit1: 49, Digit2: 50, Digit3: 51, Digit4: 52, Digit5: 53, Digit6: 54, Enter: 13, Space: 32, ShiftLeft: 16, Escape: 27 };

if (cmd === "start") {
  const dir = join(tmpdir(), "bow-edge-profile");
  mkdirSync(dir, { recursive: true });
  const child = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${dir}`,
    "--headless=new",
    "--window-size=1536,864",
    "--force-device-scale-factor=1.25",
    // "start igpu" runs on the laptop's weak integrated GPU, like a browser nobody has reconfigured.
    args[0] === "igpu" ? "--force_low_power_gpu" : "--force_high_performance_gpu",
    "--use-angle=d3d11",
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    // "start vsync" behaves like an ordinary browser window, capped to the display.
    ...(args[0] === "vsync" || args[0] === "igpu" ? [] : ["--disable-gpu-vsync", "--disable-frame-rate-limit"]),
    // InPrivate with sync off: Edge would otherwise sign a new profile in with the Windows account.
    "--inprivate",
    "--disable-sync",
    "--disable-features=msImplicitSignin,msEdgeSync,CalculateNativeWinOcclusion",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { detached: true, stdio: "ignore" });
  child.unref();
  console.log("started", child.pid);
} else if (cmd === "sized") {
  // Runs some js with the window at this size, and optionally saves a picture. The size only lasts
  // as long as the connection, which is why it isn't a command of its own.
  const [w, h, expression, file] = args;
  await withSession(async (send) => {
    await send("Emulation.setDeviceMetricsOverride", { width: Number(w), height: Number(h), deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 600));
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    console.log(r.result?.exceptionDetails ? "EXC " + JSON.stringify(r.result.exceptionDetails).slice(0, 800) : JSON.stringify(r.result?.result?.value));
    if (file) {
      await new Promise((res) => setTimeout(res, 450));
      const img = await send("Page.captureScreenshot", { format: "png" });
      if (img.result?.data) writeFileSync(file, Buffer.from(img.result.data, "base64"));
    }
  });
} else if (cmd === "profile") {
  // Where script time goes, by function: the running page sampled for this many seconds.
  const seconds = Number(args[0] ?? 4);
  const r = await withSession(async (send) => {
    await send("Profiler.enable");
    await send("Profiler.setSamplingInterval", { interval: 500 });
    await send("Profiler.start");
    await new Promise((res) => setTimeout(res, seconds * 1000));
    return send("Profiler.stop");
  });
  const p = r.result.profile;
  const self = new Map();
  const dt = p.timeDeltas;
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  p.samples.forEach((id, i) => {
    const f = byId.get(id).callFrame;
    const name = `${f.functionName || "(anon)"} ${f.url.split("/").pop().split("?")[0]}:${f.lineNumber}`;
    self.set(name, (self.get(name) ?? 0) + dt[i] / 1000);
  });
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  for (const [name, ms] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(args[1] ?? 28))) console.log(`${((ms / total) * 100).toFixed(1).padStart(5)}%  ${(ms / seconds).toFixed(1).padStart(6)} ms/s  ${name}`);
} else if (cmd === "goto") {
  await withSession((send) => send("Page.navigate", { url: args[0] }));
  console.log("ok");
} else if (cmd === "eval") {
  const r = await withSession((send) => send("Runtime.evaluate", { expression: args[0], awaitPromise: true, returnByValue: true }));
  if (r.result?.exceptionDetails) console.log("EXC", JSON.stringify(r.result.exceptionDetails).slice(0, 800));
  else console.log(JSON.stringify(r.result?.result?.value, null, 1));
} else if (cmd === "gesture") {
  // The same as eval, but it counts as the player having clicked: audio and pointer lock need that.
  const r = await withSession((send) => send("Runtime.evaluate", { expression: args[0], awaitPromise: true, returnByValue: true, userGesture: true }));
  if (r.result?.exceptionDetails) console.log("EXC", JSON.stringify(r.result.exceptionDetails).slice(0, 800));
  else console.log(JSON.stringify(r.result?.result?.value, null, 1));
} else if (cmd === "shot") {
  let saved = false;
  for (let attempt = 0; attempt < 3 && !saved; attempt++) {
    const r = await Promise.race([
      withSession((send) => send("Page.captureScreenshot", { format: "png" })),
      new Promise((res) => setTimeout(() => res(null), 12000)),
    ]);
    if (r?.result?.data) {
      writeFileSync(args[0], Buffer.from(r.result.data, "base64"));
      saved = true;
    }
  }
  console.log(saved ? `saved ${args[0]}` : "screenshot failed");
  process.exit(0);
} else if (cmd === "canvas") {
  // Reads the game canvas directly; dependable even while the GPU is busy with other work.
  const r = await withSession((send) =>
    send("Runtime.evaluate", {
      expression: `new Promise((res) => { const g = window.__game; g.engine.onEndFrameObservable.addOnce(() => res(g.engine.getRenderingCanvas().toDataURL("image/jpeg", 0.93))); })`,
      awaitPromise: true,
      returnByValue: true,
    }),
  );
  writeFileSync(args[0], Buffer.from(r.result.result.value.split(",")[1], "base64"));
  console.log("saved", args[0]);
} else if (cmd === "key") {
  const [code, ms] = args;
  const vk = KEY_CODES[code] ?? 0;
  await withSession(async (send) => {
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", code, key: code, windowsVirtualKeyCode: vk });
    await new Promise((r) => setTimeout(r, Number(ms)));
    await send("Input.dispatchKeyEvent", { type: "keyUp", code, key: code, windowsVirtualKeyCode: vk });
  });
  console.log("ok");
} else if (cmd === "stop") {
  await withSession((send) => send("Browser.close"));
  console.log("stopped");
} else {
  console.log("unknown command");
}
