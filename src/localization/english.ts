import { regions } from "../regions/registry";
import { bn, lang, noteSpoken, setNames } from "./bn";
import { en } from "./en";
import { EN_NAMES } from "./en_names";

type Any = Record<string, unknown>;

// Lays the English over the Bangla, leaving the voices able to find what each line was.
function lay(target: Any, over: Any): void {
  for (const k of Object.keys(over)) {
    const o = over[k], t = target[k];
    if (typeof o === "string") {
      if (typeof t === "string") noteSpoken(o, t);
      target[k] = o;
    } else if (Array.isArray(o)) {
      layList(t as unknown[], o);
    } else if (o && typeof o === "object" && t && typeof t === "object") {
      lay(t as Any, o as Any);
    } else {
      target[k] = o;
    }
  }
}

function layList(target: unknown[], over: unknown[]): void {
  over.forEach((o, i) => {
    const t = target[i];
    if (typeof o === "string") {
      if (typeof t === "string") noteSpoken(o, t);
      target[i] = o;
    } else if (Array.isArray(o)) layList(t as unknown[], o);
    else if (o && typeof o === "object" && t && typeof t === "object") lay(t as Any, o as Any);
    else target[i] = o;
  });
}

// Everything named in a district's data, down through its roads, areas, gates and stops.
function renameAll(node: unknown, seen: Set<unknown>): void {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    node.forEach((v, i) => {
      if (typeof v === "string") node[i] = EN_NAMES[v] ?? v;
      else renameAll(v, seen);
    });
    return;
  }
  const o = node as Any;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === "string") o[k] = EN_NAMES[v] ?? v;
    else renameAll(v, seen);
  }
}

if (lang === "en") {
  document.documentElement.lang = "en";
  // Newer text already carries both languages and has resolved itself, and en.ts doesn't mention it.
  lay(bn as unknown as Any, en as unknown as Any);
  setNames(EN_NAMES);
  renameAll(regions, new Set());
}
