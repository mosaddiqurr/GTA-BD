import type { RegionLayout } from "../regions/types";
import type { Block, CityLayout } from "../world/cityLayout";
import { roadWidth } from "../world/cityLayout";
import { flyoverHalf, flyoverHeight } from "../world/flyover";
import { blockOutline } from "../world/roads";

/** What the map shows beyond the road layout. */
export interface MapExtras {
  buildings: { x: number; z: number; angle: number; w: number; d: number; style: string; back?: boolean }[];
  lakes: [number, number][][];
  bridges: { x: number; z: number; half: number }[];
}

const BLOCK_COLOUR: Partial<Record<Block["kind"], string>> = {
  dense: "#2a3230",
  commercial: "#2e3338",
  park: "#37603a",
  garden: "#2f5a36",
  pond: "#37603a",
  zoo: "#34603c",
  river: "#37603a",
  stadium: "#3a4a3c",
  towers: "#30393f",
  embassy: "#2f3a33",
  stage: "#3a4a3c",
  coaching: "#30343a",
  garments: "#3a3c40",
  mall: "#3a4450",
  thana: "#2f3f58",
  fuel: "#3c3a34",
  terminal: "#3a3c40",
  market: "#47392b",
  mosque: "#2f3f38",
  construction: "#443d33",
  villas: "#2d3b32",
  lake: "#36593a",
  school: "#4a3f5e",
  university: "#3f4570",
};

const ROAD_COLOUR = { main: "#f2d98b", secondary: "#e4dfd0", street: "#b5b2a7" };

/** Paints a district onto a canvas: roads first, then the blocks over them so their rounded corners
 *  carve the junctions, then buildings, water and the raised things. Text goes on later, so it stays
 *  sharp and upright at any zoom. */
export function paintDistrict(size: number, layout: CityLayout, extras: MapExtras, half: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const k = size / (half * 2);
  const X = (x: number): number => (x + half) * k;
  const Y = (z: number): number => (half - z) * k;

  ctx.fillStyle = "#171d1c";
  ctx.fillRect(0, 0, size, size);

  // Roads, with the arterials carrying on out towards the next district.
  const data: RegionLayout = layout.data;
  const edge = data.boundary + 60;
  const lengthOf = (r: RegionLayout["roads"][number]): [number, number] => {
    const reachesOut = r.at === 0 && r.cls === "main";
    return [reachesOut && r.from < -400 ? -edge : r.from, reachesOut && r.to > 400 ? edge : r.to];
  };
  for (const r of data.roads) {
    const w = roadWidth(r) * k;
    const [from, to] = lengthOf(r);
    ctx.fillStyle = ROAD_COLOUR[r.cls];
    if (r.axis === "v") ctx.fillRect(X(r.at) - w / 2, Y(to), w, (to - from) * k);
    else ctx.fillRect(X(from), Y(r.at) - w / 2, (to - from) * k, w);
  }
  const { plaza, metro, flyover } = data;
  ctx.fillStyle = ROAD_COLOUR.main;
  ctx.beginPath();
  ctx.arc(X(plaza.x), Y(plaza.z), plaza.radius * k, 0, Math.PI * 2);
  ctx.fill();

  // Blocks, with a dark edge that reads as the kerb.
  ctx.lineJoin = "round";
  for (const b of layout.blocks) {
    const shape = blockOutline(b);
    ctx.beginPath();
    shape.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Y(z)) : ctx.moveTo(X(x), Y(z))));
    ctx.closePath();
    ctx.fillStyle = BLOCK_COLOUR[b.kind] ?? "#2a3230";
    ctx.fill();
    ctx.strokeStyle = "rgba(8, 11, 11, 0.85)";
    ctx.lineWidth = Math.max(1, 1.4 * k);
    ctx.stroke();
  }

  // Medians.
  ctx.fillStyle = "rgba(112, 96, 58, 0.9)";
  for (const r of data.roads) {
    if (r.median <= 0) continue;
    const w = Math.max(r.median * k, 1);
    if (r.axis === "v") ctx.fillRect(X(r.at) - w / 2, Y(r.to), w, (r.to - r.from) * k);
    else ctx.fillRect(X(r.from), Y(r.at) - w / 2, (r.to - r.from) * k, w);
  }
  ctx.fillStyle = "#3b7a42";
  ctx.beginPath();
  ctx.arc(X(plaza.x), Y(plaza.z), plaza.islandRadius * k, 0, Math.PI * 2);
  ctx.fill();

  // Buildings, a shade off the ground they stand on, each with a soft shadow to the south.
  for (const pass of [0, 1]) {
    for (const s of extras.buildings) {
      const ca = Math.cos(s.angle), sa = Math.sin(s.angle);
      const corner = (u: number, v: number): [number, number] => [s.x + u * ca + v * sa, s.z - u * sa + v * ca];
      const pts = [corner(-s.w / 2, 0), corner(s.w / 2, 0), corner(s.w / 2, s.d), corner(-s.w / 2, s.d)];
      ctx.beginPath();
      pts.forEach(([x, z], i) => {
        const sx = X(x) + (pass === 0 ? 1.1 * k : 0), sy = Y(z) + (pass === 0 ? 1.4 * k : 0);
        if (i) ctx.lineTo(sx, sy);
        else ctx.moveTo(sx, sy);
      });
      ctx.closePath();
      if (pass === 0) ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
      else ctx.fillStyle = s.style === "glass" ? "#44596c" : s.style === "tin" ? "#5b4a3a" : s.style === "commercial" ? "#46494e" : s.back ? "#39423f" : "#414b47";
      ctx.fill();
    }
  }

  // Lakes, darker at the edge so the water looks as if it has depth.
  for (const lake of extras.lakes) {
    ctx.beginPath();
    lake.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Y(z)) : ctx.moveTo(X(x), Y(z))));
    ctx.closePath();
    ctx.fillStyle = "#2f7fa3";
    ctx.fill();
    ctx.strokeStyle = "#a9c6c2";
    ctx.lineWidth = Math.max(1, 1.2 * k);
    ctx.stroke();
  }

  // Footbridges: a pale line right across the road.
  for (const b of extras.bridges) {
    ctx.strokeStyle = "rgba(10, 12, 12, 0.8)";
    ctx.lineWidth = Math.max(3, 5 * k);
    ctx.beginPath();
    ctx.moveTo(X(b.x - b.half), Y(b.z));
    ctx.lineTo(X(b.x + b.half), Y(b.z));
    ctx.stroke();
    ctx.strokeStyle = "#f4f4ec";
    ctx.lineWidth = Math.max(1.5, 3 * k);
    ctx.stroke();
  }

  // The flyover: orange, lighter where the ramps come down to the road.
  if (flyover) {
    const road = data.roads.find((q) => q.nameBn === flyover.roadName);
    const w = flyoverHalf(road?.median ?? 0) * 2;
    const seg = (p0: number, p1: number): [number, number, number, number] => (flyover.axis === "h" ? [X(p0), Y(flyover.at), X(p1), Y(flyover.at)] : [X(flyover.at), Y(p0), X(flyover.at), Y(p1)]);
    const stroke = (p0: number, p1: number, width: number, colour: string): void => {
      const [ax, ay, bx, by] = seg(p0, p1);
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.lineCap = "butt";
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    };
    stroke(flyover.start, flyover.end, (w + 2.4) * k, "rgba(15, 12, 8, 0.85)");
    for (let p = flyover.start; p < flyover.end; p += 6) {
      const t = flyoverHeight(flyover, p + 3) / flyover.height;
      const g = Math.round(150 + (1 - t) * 60), b = Math.round(50 + (1 - t) * 90);
      stroke(p, Math.min(p + 6.2, flyover.end), w * k, `rgb(255, ${g}, ${b})`);
    }
  }

  // The metro: a red line on its viaduct, and a block for the station.
  if (metro) {
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.lineWidth = Math.max(4, 6.5 * k);
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(X(metro.x), Y(metro.toZ));
    ctx.lineTo(X(metro.x), Y(metro.fromZ));
    ctx.stroke();
    ctx.strokeStyle = "#e0263c";
    ctx.lineWidth = Math.max(2.4, 4 * k);
    ctx.stroke();
    ctx.fillStyle = "rgba(224, 38, 60, 0.72)";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(1, 1 * k);
    const sw = 22 * k, sh = 140 * k;
    ctx.fillRect(X(metro.x) - sw / 2, Y(metro.stationZ + 70), sw, sh);
    ctx.strokeRect(X(metro.x) - sw / 2, Y(metro.stationZ + 70), sw, sh);
  }
  return c;
}

/** Dhaka in small: the three districts where they really lie, and how they connect. */
export function paintDhaka(c: HTMLCanvasElement, here: string): void {
  const dpr = c.width / Math.max(c.clientWidth, 1);
  const ctx = c.getContext("2d")!;
  const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);
  const at: Record<string, [number, number]> = { dhaka_mirpur10: [0.24, 0.24], dhaka_gulshan: [0.78, 0.3], dhaka_dhanmondi: [0.36, 0.8] };
  const P = (id: string): [number, number] => [at[id][0] * W, at[id][1] * H];
  const line = (a: string, b: string, colour: string, width: number, dash: number[] = [], bend = 0): void => {
    const [ax, ay] = P(a), [bx, by] = P(b);
    ctx.strokeStyle = colour;
    ctx.lineWidth = width * dpr;
    ctx.setLineDash(dash.map((d) => d * dpr));
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo((ax + bx) / 2 + bend * dpr, (ay + by) / 2 - bend * dpr, bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  line("dhaka_mirpur10", "dhaka_gulshan", "#f2d98b", 4);
  line("dhaka_gulshan", "dhaka_dhanmondi", "#f2d98b", 4);
  line("dhaka_mirpur10", "dhaka_dhanmondi", "#f2d98b", 4, [], -10);
  line("dhaka_mirpur10", "dhaka_dhanmondi", "#e0263c", 3, [6, 4], 14);
  for (const [id, name] of [["dhaka_mirpur10", "মিরপুর"], ["dhaka_gulshan", "গুলশান"], ["dhaka_dhanmondi", "ধানমন্ডি"]]) {
    const [x, y] = P(id);
    const on = id === here;
    ctx.beginPath();
    ctx.arc(x, y, (on ? 11 : 8) * dpr, 0, Math.PI * 2);
    ctx.fillStyle = on ? "#e0263c" : "#f7f3e8";
    ctx.fill();
    ctx.strokeStyle = "#101413";
    ctx.lineWidth = 2 * dpr;
    ctx.stroke();
    ctx.font = `700 ${15 * dpr}px "Anek Bangla", "Hind Siliguri", sans-serif`;
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    ctx.lineWidth = 4 * dpr;
    ctx.strokeStyle = "rgba(10, 13, 13, 0.9)";
    ctx.strokeText(name, x, y - 18 * dpr);
    ctx.fillStyle = on ? "#ffd166" : "#ffffff";
    ctx.fillText(name, x, y - 18 * dpr);
  }
}
