// Records a browser performance trace while the game runs and lists the longest events.
// Usage: node tools/test/trace.mjs [seconds]
const PORT = 9333;
const seconds = +(process.argv[2] ?? 8);

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page" && t.url.startsWith("http://localhost"));
const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let id = 0;
const pending = new Map();
const events = [];
let done;
const finished = new Promise((r) => (done = r));
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  } else if (d.method === "Tracing.dataCollected") events.push(...d.params.value);
  else if (d.method === "Tracing.tracingComplete") done();
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

void page;
await send("Tracing.start", {
  transferMode: "ReportEvents",
  traceConfig: { includedCategories: ["devtools.timeline", "v8", "disabled-by-default-v8.gc", "gpu", "cc", "viz", "toplevel"], recordMode: "recordContinuously" },
});
await new Promise((r) => setTimeout(r, seconds * 1000));
await send("Tracing.end");
await finished;
ws.close();

const names = new Map();
for (const e of events) if (e.ph === "M" && e.name === "thread_name") names.set(`${e.pid}:${e.tid}`, e.args.name);
const procs = new Map();
for (const e of events) if (e.ph === "M" && e.name === "process_name") procs.set(e.pid, e.args.name);

const totals = new Map();
for (const e of events) {
  if (e.ph !== "X" || !e.dur) continue;
  const thread = names.get(`${e.pid}:${e.tid}`) ?? "?";
  const key = `${procs.get(e.pid) ?? "?"} / ${thread} / ${e.name}`;
  let t = totals.get(key);
  if (!t) totals.set(key, (t = { count: 0, total: 0, max: 0, over20: 0 }));
  t.count++;
  t.total += e.dur / 1000;
  t.max = Math.max(t.max, e.dur / 1000);
  if (e.dur > 20000) t.over20++;
}
const rows = [...totals.entries()].filter(([, t]) => t.max > 12).sort((a, b) => b[1].over20 - a[1].over20 || b[1].max - a[1].max).slice(0, 36);
for (const [k, t] of rows) console.log(`${String(t.over20).padStart(4)} >20ms  max ${t.max.toFixed(0).padStart(4)}ms  total ${t.total.toFixed(0).padStart(6)}ms  n=${String(t.count).padStart(5)}  ${k}`);
