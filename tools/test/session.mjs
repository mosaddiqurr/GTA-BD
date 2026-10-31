// One open connection to the game in Edge, for test scripts that do many things in a row. Start the
// browser first with `node tools/test/edge.mjs start vsync`.
import { writeFileSync } from "node:fs";

const PORT = 9333;

const KEY_CODES = { KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68, KeyF: 70, KeyE: 69, KeyH: 72, KeyR: 82, KeyC: 67, KeyT: 84, KeyM: 77, KeyV: 86, KeyG: 71, KeyQ: 81, KeyI: 73, KeyP: 80, KeyJ: 74, KeyL: 76, KeyB: 66, KeyN: 78, Digit1: 49, Digit2: 50, Digit3: 51, Digit4: 52, Digit5: 53, Digit6: 54, Enter: 13, Space: 32, ShiftLeft: 16, Escape: 27, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39 };

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const t = list.find((q) => q.type === "page" && (q.url.startsWith("http://localhost") || q.url === "about:blank"));
  if (!t) throw new Error("no game tab: run node tools/test/edge.mjs start vsync");
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
  const run = async (expression, userGesture = false) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture });
    if (r.result?.exceptionDetails) return `EXC ${JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails).slice(0, 700)}`;
    return r.result?.result?.value;
  };
  const self = {
    send,
    /** Runs js in the page and hands back the value. */
    js: (expression) => run(expression),
    /** The same, counted as the player having clicked. */
    gesture: (expression) => run(expression, true),
    goto: (url) => send("Page.navigate", { url }),
    /** Waits for the game to reach a state: title by default. */
    ready: async (want = "title", seconds = 180) => {
      for (let i = 0; i < seconds; i += 2) {
        await wait(2000);
        const s = await run("window.__game&&window.__game.state");
        if (s === want) return true;
      }
      return false;
    },
    /** Fresh saves, then a loaded district with the game running. */
    begin: async (region = "dhaka_mirpur10", options = {}) => {
      await self.goto(`http://localhost:5173/?region=${region}`);
      await self.ready();
      if (options.keepSaves !== true) await run(`(()=>{for(const k of Object.keys(localStorage)) if(k.startsWith('bow.save')||k==='bow.slot') localStorage.removeItem(k); return 1})()`);
      await self.goto(`http://localhost:5173/?region=${region}`);
      const ok = await self.ready();
      await run(`(()=>{window.__errs=[]; addEventListener('error',e=>window.__errs.push(String(e.message).slice(0,240))); addEventListener('unhandledrejection',e=>window.__errs.push(String(e.reason).slice(0,240))); const g=window.__game; g.settings.autosave=false; g.testPlay(); g.env.setHour(${options.hour ?? 11}); ${options.still ? "g.env.speed=0;" : ""} g.weather.timer=99999; g.weather.force(0); return 1})()`);
      await wait(options.settle ?? 4000);
      return ok;
    },
    canvas: async (file) => {
      const r = await send("Runtime.evaluate", {
        expression: `new Promise((res) => { const g = window.__game; g.engine.onEndFrameObservable.addOnce(() => res(g.engine.getRenderingCanvas().toDataURL("image/jpeg", 0.93))); })`,
        awaitPromise: true,
        returnByValue: true,
      });
      writeFileSync(file, Buffer.from(r.result.result.value.split(",")[1], "base64"));
    },
    /** The whole window, with the menus and writing on it. */
    shot: async (file) => {
      const r = await send("Page.captureScreenshot", { format: "png" });
      if (r.result?.data) writeFileSync(file, Buffer.from(r.result.data, "base64"));
    },
    key: async (code, ms = 120) => {
      const vk = KEY_CODES[code] ?? 0;
      await send("Input.dispatchKeyEvent", { type: "rawKeyDown", code, key: code, windowsVirtualKeyCode: vk });
      await wait(ms);
      await send("Input.dispatchKeyEvent", { type: "keyUp", code, key: code, windowsVirtualKeyCode: vk });
    },
    /** A view fixed on the world for pictures, until the next call with null. */
    view: async (from, to) => {
      await run(`(()=>{const g=window.__game; g.__view=${from ? JSON.stringify({ from, to }) : "null"}; if(!g.__viewHook){g.__viewHook=true; g.scene.onBeforeRenderObservable.add(()=>{const f=g.__view; if(!f) return; const c=g.rig.camera; c.position.set(f.from[0],f.from[1],f.from[2]); c.setTarget(new c.position.constructor(f.to[0],f.to[1],f.to[2]));});} return 1})()`);
    },
    errors: () => run("window.__errs||[]"),
    close: () => ws.close(),
  };
  return self;
}
