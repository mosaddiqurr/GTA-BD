import { Color3, DynamicTexture, PBRMaterial, Scene, Texture } from "@babylonjs/core";
import "@fontsource/galada/bengali-400.css";
import "@fontsource/hind-siliguri/bengali-500.css";
import "@fontsource/hind-siliguri/bengali-700.css";
import "@fontsource/anek-bangla/bengali-700.css";
import "@fontsource/anek-bangla/bengali-800.css";
import "@fontsource/baloo-da-2/bengali-700.css";
import "@fontsource/baloo-da-2/bengali-800.css";
import "@fontsource/tiro-bangla/bengali-400.css";
import "@fontsource/mina/bengali-700.css";
import "@fontsource/atma/bengali-700.css";
import "@fontsource/noto-serif-bengali/bengali-800.css";
import type { BusRoute, RegionManifest } from "../regions/types";
import { Rng } from "./cityLayout";
import type { CellName } from "./atlas";
import type { Rect } from "./geo";
import { bnNum } from "../localization/bn";

// All Bangla text is typeset by the browser's shaping engine, so conjuncts are correct.
// Names are generic and original: no real brands, and phone numbers are all zeros.
export const SHOP_NAMES: Record<string, string[]> = {
  shopBarber: ["নিউ স্টাইল সেলুন", "ভাই ভাই হেয়ার কাটিং", "রয়্যাল সেলুন"],
  shopTailor: ["আলিফ টেইলার্স", "ফ্যাশন টেইলার্স", "মডার্ন দর্জি ঘর"],
  shopRepair: ["মোবাইল সার্ভিসিং সেন্টার", "ডিজিটাল মোবাইল রিপেয়ার", "হক মোবাইল মেরামত"],
  shopPhoto: ["ফটোকপি ও প্রিন্ট", "পাসপোর্ট সাইজ ছবি", "স্মৃতি ফটো স্টুডিও"],
  shopAgent: ["ঝটপট টাকা এজেন্ট", "টাকা পাঠান ও তুলুন", "ঝটপট টাকা পয়েন্ট"],
  shopDiagnostic: ["মেডিকেয়ার ডায়াগনস্টিক সেন্টার", "জনসেবা ডায়াগনস্টিক", "নিরাময় প্যাথলজি ল্যাব"],
  shopBiryani: ["নবাবী বিরিয়ানি হাউজ", "মামা কাচ্চি ঘর", "পুরান ঢাকা বিরিয়ানি"],
  shopRice: ["মা ভাতের হোটেল", "জনতা ভাত ঘর", "গরম ভাতের হোটেল"],
  shopSari: ["বেনারসি বিতান", "জামদানি ঘর", "শাড়ি মহল"],
  shopGold: ["স্বর্ণালী জুয়েলার্স", "নিউ গহনা ঘর", "রূপসী জুয়েলার্স"],
  shopElectronics: ["ইলেকট্রো বাজার", "ভাই ভাই ইলেকট্রনিক্স", "ডিজিটাল টিভি সেন্টার"],
  coaching: ["মেধা কোচিং সেন্টার", "প্রতিভা ভর্তি কোচিং", "সফল একাডেমিক কেয়ার", "বিজ্ঞান ক্লাব কোচিং", "এসএসসি ও এইচএসসি ব্যাচ", "গণিত ক্লাব", "ইংরেজি স্পোকেন কোর্স"],
  shopGrocery: ["মায়ের দোয়া স্টোর", "জনতা জেনারেল স্টোর", "ভাই ভাই ট্রেডার্স", "আল-আমিন স্টোর", "বিসমিল্লাহ ভ্যারাইটি স্টোর", "নিউ মদিনা স্টোর"],
  shopPharmacy: ["রহমান ফার্মেসী", "সেবা মেডিকেল হল", "জনসেবা ফার্মেসী", "মা ফার্মা", "লাইফ কেয়ার ফার্মেসী"],
  shopMobile: ["নিউ ঢাকা মোবাইল সেন্টার", "স্মার্ট টেলিকম", "সিটি মোবাইল ও রিচার্জ", "ডিজিটাল ফোন হাউস", "এশিয়া টেলিকম"],
  shopClothes: ["সোনালী ফ্যাশন", "বধূয়া বস্ত্র বিতান", "রূপসী ক্লথ স্টোর", "আল-আমিন টেইলার্স", "নিউ স্টাইল গার্মেন্টস", "ঢাকা পাঞ্জাবি হাউস"],
  shopTea: ["বিসমিল্লাহ হোটেল", "ভাই ভাই রেস্তোরাঁ", "মিতালী হোটেল", "ঢাকা কাচ্চি ঘর", "ঘরোয়া ভাতের হোটেল", "চা-নাস্তার দোকান"],
  shopHardware: ["রাজধানী হার্ডওয়্যার", "ভাই ভাই ইলেকট্রিক", "মিরপুর স্যানিটারি", "আদর্শ পেইন্টস", "নিউ আলো ইলেকট্রিক"],
  shopSweets: ["কোহিনূর সুইটস", "মধুবন মিষ্টান্ন ভান্ডার", "নিউ বেকারি", "রসগোল্লা ঘর", "তাজা কনফেকশনারি"],
  shopBooks: ["আদর্শ লাইব্রেরি", "জ্ঞানকোষ বই ঘর", "ছাত্রবন্ধু লাইব্রেরি", "বর্ণমালা স্টেশনারি", "বই মেলা"],
};

const SHOP_TAGLINES: Record<string, string> = {
  shopBarber: "চুল কাটা, দাড়ি কামানো",
  shopTailor: "জামা, প্যান্ট, পাঞ্জাবি সেলাই",
  shopRepair: "সব মোবাইল মেরামত করা হয়",
  shopPhoto: "ফটোকপি, প্রিন্ট, ছবি",
  shopAgent: "টাকা পাঠান, তুলুন, রিচার্জ করুন",
  shopDiagnostic: "রক্ত পরীক্ষা, এক্স-রে, ইসিজি",
  shopBiryani: "কাচ্চি, তেহারি, মোরগ পোলাও",
  shopRice: "ভাত, মাছ, ডাল, ভর্তা",
  shopSari: "বেনারসি, জামদানি, কাতান",
  shopGold: "২২ ক্যারেট সোনার গহনা",
  shopElectronics: "টিভি, ফ্রিজ, ফ্যান, রাইস কুকার",
  coaching: "ভর্তি চলছে",
  shopGrocery: "চাল, ডাল, তেল, মসলা",
  shopPharmacy: "সকল প্রকার ঔষধ পাওয়া যায়",
  shopMobile: "রিচার্জ ও মোবাইল সার্ভিসিং",
  shopClothes: "পাঞ্জাবি, শার্ট, প্যান্ট",
  shopTea: "গরম ভাত, চা ও নাস্তা",
  shopHardware: "রড, সিমেন্ট, রং, ইলেকট্রিক",
  shopSweets: "প্রতিদিনের তাজা মিষ্টি",
  shopBooks: "বই, খাতা, কলম",
};

const OFFICE_NAMES = [
  "সিটি কোচিং সেন্টার", "আপন ডায়াগনস্টিক", "নিউ মডেল ডেন্টাল কেয়ার", "উত্তরণ কম্পিউটার ট্রেনিং",
  "মিরপুর ল্যাব", "আলো চক্ষু সেবা", "মোবাইল ব্যাংকিং এজেন্ট", "সেফ ট্রাভেলস",
  "ফ্ল্যাট ও প্লট বিক্রয়", "ইংলিশ স্পোকেন কোর্স", "মিরপুর শপিং কমপ্লেক্স", "ঢাকা ফ্যাশন প্লাজা",
];

const BILLBOARDS: { head: string; sub: string; bg: [string, string]; fg: string; accent: string }[] = [
  { head: "অপরিচিত লিংকে ক্লিক করবেন না", sub: "আপনার তথ্য, আপনার নিরাপত্তা", bg: ["#0b3d5c", "#0a6b7a"], fg: "#ffffff", accent: "#ffd23f" },
  { head: "ওটিপি কাউকে দেবেন না", sub: "ব্যাংক কখনো আপনার পিন চায় না", bg: ["#7a0c1e", "#c1272d"], fg: "#ffffff", accent: "#ffe08a" },
  { head: "রেডি ফ্ল্যাট বিক্রয়", sub: "মিরপুর ১০, সহজ কিস্তিতে", bg: ["#123d2a", "#1f7a4d"], fg: "#fff8e1", accent: "#ffd23f" },
  { head: "ভর্তি চলছে!", sub: "সিটি কোচিং সেন্টার", bg: ["#f2b705", "#f28c0f"], fg: "#22130a", accent: "#7a0c1e" },
  { head: "খাঁটি সরিষার তেল", sub: "রান্নায় আসল স্বাদ", bg: ["#d99a00", "#8f5a00"], fg: "#fffbea", accent: "#ffffff" },
  { head: "নিরাপদ সড়ক চাই", sub: "ট্রাফিক আইন মেনে চলুন", bg: ["#10451d", "#2d6a4f"], fg: "#ffffff", accent: "#ffd23f" },
  { head: "মেট্রোরেলে চলুন", sub: "সময় বাঁচান, শহর বাঁচান", bg: ["#102a54", "#1e5aa8"], fg: "#ffffff", accent: "#f05d5e" },
  { head: "তাজা চা পাতা", sub: "প্রতিদিনের সতেজতা", bg: ["#1b4d2e", "#5b8c3a"], fg: "#fff8e1", accent: "#e8c547" },
];

const LABELS = ["ঈদ মোবারক", "শপিং মল", "রেস্তোরাঁ", "হোটেল", "ক্লিনিক", "ব্যাংক", "আবাসিক ভবন", "অফিস টাওয়ার", "থানা", "সিএনজি ফিলিং স্টেশন", "গার্মেন্টস কারখানা", "কোচিং পাড়া", "ইলেকট্রনিক্স মার্কেট", "গহনা মার্কেট", "বই বাজার", "শাড়ি মার্কেট", "মাছ বাজার", "ট্রাফিক পুলিশ", "বাস স্টপ", "খেলার মাঠ", "কাঁচাবাজার", "মসজিদ", "কাজ চলছে", "রাস্তা বন্ধ", "সিএনজি স্ট্যান্ড", "নিরাপদে রাস্তা পার হোন", "আদর্শ উচ্চ বিদ্যালয়", "নগর বিশ্ববিদ্যালয়"];

/** The bus routes of the district being played. Each bus shows one on its board. */
export let ROUTES: string[] = [];
export let ROUTE_INFO: BusRoute[] = [];

const POSTERS = ["টু-লেট", "বাসা ভাড়া হবে", "সাবলেট", "পড়াতে চাই", "জরুরি লোক চাই", "ফ্ল্যাট ভাড়া"];
const PLATE_LETTERS = ["ক", "খ", "গ", "ঘ", "চ", "ছ", "জ", "ট", "ঠ", "থ"];

const FONTS = [
  "700 {s}px 'Hind Siliguri'",
  "800 {s}px 'Anek Bangla'",
  "800 {s}px 'Baloo Da 2'",
  "700 {s}px 'Mina'",
  "700 {s}px 'Atma'",
  "400 {s}px 'Galada'",
  "800 {s}px 'Noto Serif Bengali'",
  "400 {s}px 'Tiro Bangla'",
];

// Bright, slightly clashing palettes, the real look of a Dhaka shopping street.
const PALETTES: { bg: [string, string]; fg: string; line: string }[] = [
  { bg: ["#b3121d", "#7f0d15"], fg: "#fff6d6", line: "#ffd23f" },
  { bg: ["#0b5d3b", "#07402a"], fg: "#ffffff", line: "#ffd23f" },
  { bg: ["#0d3b8c", "#082763"], fg: "#ffffff", line: "#ffcf33" },
  { bg: ["#f4c20d", "#e8a200"], fg: "#7a0c1e", line: "#7a0c1e" },
  { bg: ["#ffffff", "#e9e6da"], fg: "#b3121d", line: "#0d3b8c" },
  { bg: ["#7b1fa2", "#4a126b"], fg: "#fff176", line: "#ffffff" },
  { bg: ["#e65100", "#b53d00"], fg: "#ffffff", line: "#fff176" },
  { bg: ["#00838f", "#005a63"], fg: "#ffffff", line: "#ffeb3b" },
  { bg: ["#c2185b", "#8e0f42"], fg: "#ffffff", line: "#ffe082" },
  { bg: ["#1a1a1a", "#000000"], fg: "#ffcf33", line: "#e53935" },
  { bg: ["#f5f0e1", "#d9d2bd"], fg: "#0b5d3b", line: "#b3121d" },
  { bg: ["#2e7d32", "#1b5e20"], fg: "#fff59d", line: "#ffffff" },
];

export class SignAtlas {
  readonly material: PBRMaterial;
  private texture: DynamicTexture;
  private ctx: CanvasRenderingContext2D;
  private readonly size: number;
  private penX = 0;
  private penY = 0;
  private rowH = 0;
  private readonly rng = new Rng(52);

  private shopSigns = new Map<string, Rect[]>();
  private officeSigns: Rect[] = [];
  private billboards: Rect[] = [];
  private roadSigns: Rect[] = [];
  private gateBoards = new Map<string, Rect>();
  private labels = new Map<string, Rect>();
  private routes: Rect[] = [];
  private posters: Rect[] = [];
  private platesWhite: Rect[] = [];
  private platesGreen: Rect[] = [];
  private tall: Rect[] = [];

  constructor(scene: Scene, size: number, private region: RegionManifest) {
    this.size = size;
    ROUTE_INFO = region.busRoutes;
    ROUTES = region.busRoutes.map((q) => q.name);
    this.texture = new DynamicTexture("signAtlas", { width: size, height: size }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    this.texture.anisotropicFilteringLevel = 8;
    this.ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    this.ctx.fillStyle = "#333";
    this.ctx.fillRect(0, 0, size, size);

    const mat = new PBRMaterial("signs", scene);
    mat.albedoTexture = this.texture;
    mat.emissiveTexture = this.texture;
    mat.emissiveColor = Color3.White();
    mat.emissiveIntensity = 0;
    mat.metallic = 0;
    mat.roughness = 0.55;
    this.material = mat;

    this.drawAll();
    this.texture.update(true);
  }

  static async loadFonts(): Promise<void> {
    const probes = FONTS.map((f) => f.replace("{s}", "40"));
    await Promise.all(probes.map((p) => document.fonts.load(p, "বাংলা")));
    await document.fonts.ready;
  }

  /** Reserves atlas space and returns its pixel rect plus the texture rect. */
  private alloc(w: number, h: number): { x: number; y: number; uv: Rect } {
    const pad = 4;
    if (this.penX + w + pad > this.size) {
      this.penX = 0;
      this.penY += this.rowH + pad;
      this.rowH = 0;
    }
    const x = this.penX, y = this.penY;
    // Space past the edge would sample some other sign, so this must never go unnoticed.
    if (y + h > this.size) console.error(`[signs] atlas overflow at y=${y + h} of ${this.size}`);
    this.penX += w + pad;
    this.rowH = Math.max(this.rowH, h);
    const s = this.size;
    // Canvas textures upload with y flipped, so v runs from the bottom of the canvas.
    return { x, y, uv: [x / s, 1 - (y + h) / s, (x + w) / s, 1 - y / s] };
  }

  private fitFont(template: string, text: string, maxW: number, maxS: number): string {
    const ctx = this.ctx;
    let s = maxS;
    ctx.font = template.replace("{s}", String(s));
    const w = ctx.measureText(text).width;
    if (w > maxW) s = Math.floor((s * maxW) / w);
    return template.replace("{s}", String(s));
  }

  private weather(x: number, y: number, w: number, h: number, amount: number): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, `rgba(30,25,15,${amount * 0.25})`);
    g.addColorStop(0.35, "rgba(30,25,15,0)");
    g.addColorStop(1, `rgba(40,30,15,${amount * 0.55})`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    const r = this.rng;
    // Rain streaks and flecks.
    for (let i = 0; i < 16 * amount; i++) {
      ctx.fillStyle = `rgba(${r.pick(["20,15,10", "240,235,220"])},${r.range(0.04, 0.16)})`;
      const fx = x + r.range(0, w);
      ctx.fillRect(fx, y + r.range(0, h * 0.4), r.range(1, 4), r.range(h * 0.1, h * 0.6));
    }
  }

  private board(head: string, sub: string, w: number, h: number): Rect {
    const r = this.rng;
    const a = this.alloc(w, h);
    const ctx = this.ctx;
    const pal = r.pick(PALETTES);
    const g = ctx.createLinearGradient(0, a.y, 0, a.y + h);
    g.addColorStop(0, pal.bg[0]);
    g.addColorStop(1, pal.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(a.x, a.y, w, h);

    // Painted border or a stripe.
    ctx.strokeStyle = pal.line;
    ctx.lineWidth = Math.max(3, h * 0.03);
    if (r.chance(0.6)) ctx.strokeRect(a.x + h * 0.05, a.y + h * 0.05, w - h * 0.1, h - h * 0.1);
    else {
      ctx.fillStyle = pal.line;
      ctx.fillRect(a.x, a.y + h - h * 0.08, w, h * 0.08);
    }

    // Decoration that needs no language: a circle badge at one end.
    const hasBadge = r.chance(0.45);
    const textX = a.x + w / 2 + (hasBadge ? h * 0.4 : 0);
    const textW = w - h * 0.5 - (hasBadge ? h * 0.8 : 0);
    if (hasBadge) {
      ctx.fillStyle = pal.line;
      ctx.beginPath();
      ctx.arc(a.x + h * 0.55, a.y + h / 2, h * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pal.bg[0];
      ctx.beginPath();
      ctx.arc(a.x + h * 0.55, a.y + h / 2, h * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const font = r.pick(FONTS);
    const headY = sub ? a.y + h * 0.4 : a.y + h * 0.5;
    ctx.font = this.fitFont(font, head, textW, Math.floor(h * (sub ? 0.5 : 0.62)));
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillText(head, textX + 3, headY + 3);
    ctx.fillStyle = pal.fg;
    ctx.fillText(head, textX, headY);
    if (sub) {
      ctx.font = this.fitFont("500 {s}px 'Hind Siliguri'", sub, textW, Math.floor(h * 0.2));
      ctx.fillStyle = pal.fg;
      ctx.fillText(sub, textX, a.y + h * 0.78);
    }
    this.weather(a.x, a.y, w, h, r.range(0.35, 1));
    return a.uv;
  }

  private drawAll(): void {
    const s = this.size / 4096;
    const bw = Math.floor(815 * s), bh = Math.floor(160 * s);
    const r = this.rng;
    for (const [kind, names] of Object.entries(SHOP_NAMES)) {
      const list: Rect[] = [];
      for (const name of names) {
        const phone = r.chance(0.5) ? `মোবাইল: ${bnNum("01700-000000")}` : SHOP_TAGLINES[kind];
        list.push(this.board(name, phone, bw, bh));
      }
      this.shopSigns.set(kind, list);
    }
    // Local businesses are named after wherever they are.
    const here = (t: string): string => t.replace("মিরপুর ১০", this.region.shortNameBn).replace("মিরপুর", this.region.shortNameBn);
    const offices = OFFICE_NAMES.map(here);
    for (const name of offices) this.officeSigns.push(this.board(name, r.chance(0.5) ? "২য় তলা" : "", bw, bh));
    for (const name of offices.slice(0, 6)) this.tall.push(this.tallBoard(name, Math.floor(120 * s), Math.floor(640 * s)));
    for (const b of BILLBOARDS) this.billboards.push(this.billboard({ ...b, sub: here(b.sub) }, Math.floor(800 * s), Math.floor(400 * s)));
    for (const g of this.region.gates) this.gateBoards.set(g.to, this.roadSign(g.nameBn, g.viaBn, Math.floor(520 * s), Math.floor(220 * s)));
    for (const b of this.region.roadSigns) this.roadSigns.push(this.roadSign(b.head, b.sub, Math.floor(520 * s), Math.floor(220 * s)));
    for (const l of [...LABELS, ...this.region.labels]) this.labels.set(l, this.label(l, Math.floor(420 * s), Math.floor(110 * s)));
    for (const route of ROUTES) this.routes.push(this.routeBoard(route, Math.floor(520 * s), Math.floor(110 * s)));
    for (const p of POSTERS) this.posters.push(this.poster(p, Math.floor(160 * s), Math.floor(224 * s)));
    for (let i = 0; i < 10; i++) {
      this.platesWhite.push(this.plate("#f2f1ea", "#111", Math.floor(196 * s), Math.floor(98 * s)));
      this.platesGreen.push(this.plate("#2c7a3f", "#000", Math.floor(196 * s), Math.floor(98 * s)));
    }
  }

  private tallBoard(text: string, w: number, h: number): Rect {
    const a = this.alloc(w, h);
    const ctx = this.ctx;
    const pal = this.rng.pick(PALETTES);
    ctx.fillStyle = pal.bg[0];
    ctx.fillRect(a.x, a.y, w, h);
    ctx.fillStyle = pal.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Vertical Bangla stacks whole words, because splitting a conjunct would break it.
    const words = text.split(" ");
    const step = h / (words.length + 0.5);
    words.forEach((word, i) => {
      ctx.font = this.fitFont("800 {s}px 'Anek Bangla'", word, w * 0.86, Math.floor(w * 0.34));
      ctx.fillText(word, a.x + w / 2, a.y + step * (i + 0.75));
    });
    this.weather(a.x, a.y, w, h, 0.5);
    return a.uv;
  }

  private billboard(b: (typeof BILLBOARDS)[number], w: number, h: number): Rect {
    const a = this.alloc(w, h);
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(a.x, a.y, a.x + w, a.y + h);
    g.addColorStop(0, b.bg[0]);
    g.addColorStop(1, b.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(a.x, a.y, w, h);
    ctx.fillStyle = b.accent;
    ctx.beginPath();
    ctx.moveTo(a.x + w * 0.72, a.y);
    ctx.lineTo(a.x + w, a.y);
    ctx.lineTo(a.x + w, a.y + h * 0.55);
    ctx.closePath();
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = b.fg;
    ctx.font = this.fitFont("800 {s}px 'Anek Bangla'", b.head, w * 0.9, Math.floor(h * 0.27));
    ctx.fillText(b.head, a.x + w / 2, a.y + h * 0.42);
    ctx.font = this.fitFont("700 {s}px 'Hind Siliguri'", b.sub, w * 0.8, Math.floor(h * 0.13));
    ctx.fillText(b.sub, a.x + w / 2, a.y + h * 0.7);
    this.weather(a.x, a.y, w, h, 0.4);
    return a.uv;
  }

  private roadSign(head: string, sub: string, w: number, h: number): Rect {
    const a = this.alloc(w, h);
    const ctx = this.ctx;
    ctx.fillStyle = "#0a5b3f";
    ctx.fillRect(a.x, a.y, w, h);
    ctx.strokeStyle = "#f4f4ec";
    ctx.lineWidth = Math.max(3, h * 0.03);
    ctx.strokeRect(a.x + h * 0.05, a.y + h * 0.05, w - h * 0.1, h - h * 0.1);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = this.fitFont("700 {s}px 'Hind Siliguri'", head, w * 0.86, Math.floor(h * (sub ? 0.42 : 0.42)));
    ctx.fillText(head, a.x + w / 2, a.y + (sub ? h * 0.4 : h * 0.5));
    if (sub) {
      ctx.font = this.fitFont("500 {s}px 'Hind Siliguri'", sub, w * 0.86, Math.floor(h * 0.22));
      ctx.fillText(sub, a.x + w / 2, a.y + h * 0.74);
    }
    this.weather(a.x, a.y, w, h, 0.25);
    return a.uv;
  }

  private label(text: string, w: number, h: number): Rect {
    const a = this.alloc(w, h);
    const ctx = this.ctx;
    ctx.fillStyle = text === "ট্রাফিক পুলিশ" ? "#123a7a" : text === "রাস্তা বন্ধ" || text === "কাজ চলছে" ? "#d7a100" : "#0a5b3f";
    ctx.fillRect(a.x, a.y, w, h);
    ctx.fillStyle = text === "কাজ চলছে" || text === "রাস্তা বন্ধ" ? "#111" : "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = this.fitFont("700 {s}px 'Hind Siliguri'", text, w * 0.9, Math.floor(h * 0.62));
    ctx.fillText(text, a.x + w / 2, a.y + h / 2);
    return a.uv;
  }

  private routeBoard(text: string, w: number, h: number): Rect {
    const a = this.alloc(w, h);
    const ctx = this.ctx;
    ctx.fillStyle = "#101010";
    ctx.fillRect(a.x, a.y, w, h);
    ctx.fillStyle = "#ffb300";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = this.fitFont("700 {s}px 'Hind Siliguri'", text, w * 0.92, Math.floor(h * 0.62));
    ctx.fillText(text, a.x + w / 2, a.y + h / 2);
    return a.uv;
  }

  private poster(text: string, w: number, h: number): Rect {
    const a = this.alloc(w, h);
    const ctx = this.ctx;
    ctx.fillStyle = "#efe9d5";
    ctx.fillRect(a.x, a.y, w, h);
    ctx.fillStyle = "#14141a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = this.fitFont("700 {s}px 'Hind Siliguri'", text, w * 0.88, Math.floor(h * 0.26));
    ctx.fillText(text, a.x + w / 2, a.y + h * 0.36);
    ctx.font = this.fitFont("500 {s}px 'Hind Siliguri'", bnNum("01700-000000"), w * 0.88, Math.floor(h * 0.1));
    ctx.fillText(bnNum("01700-000000"), a.x + w / 2, a.y + h * 0.66);
    this.weather(a.x, a.y, w, h, 0.7);
    return a.uv;
  }

  private plate(bg: string, fg: string, w: number, h: number): Rect {
    const r = this.rng;
    const a = this.alloc(w, h);
    const ctx = this.ctx;
    ctx.fillStyle = bg;
    ctx.fillRect(a.x, a.y, w, h);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 2;
    ctx.strokeRect(a.x + 3, a.y + 3, w - 6, h - 6);
    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const top = `ঢাকা মেট্রো-${r.pick(PLATE_LETTERS)}`;
    ctx.font = this.fitFont("700 {s}px 'Hind Siliguri'", top, w * 0.9, Math.floor(h * 0.34));
    ctx.fillText(top, a.x + w / 2, a.y + h * 0.3);
    const num = `${bnNum(r.int(11, 99))}-${bnNum(String(r.int(1000, 9999)))}`;
    ctx.font = this.fitFont("700 {s}px 'Hind Siliguri'", num, w * 0.9, Math.floor(h * 0.4));
    ctx.fillText(num, a.x + w / 2, a.y + h * 0.7);
    return a.uv;
  }

  shop(kind: CellName, r: Rng): Rect {
    return r.pick(this.shopSigns.get(kind) ?? this.officeSigns);
  }
  office(r: Rng): Rect {
    return r.pick(this.officeSigns);
  }
  tallSign(r: Rng): Rect {
    return r.pick(this.tall);
  }
  billboardAd(r: Rng): Rect {
    return r.pick(this.billboards);
  }
  /** The two cyber-safety public notices, foreshadowing later content. */
  billboardIndex(i: number): Rect {
    return this.billboards[i % this.billboards.length];
  }
  road(i: number): Rect {
    return this.roadSigns[i % this.roadSigns.length];
  }
  /** The big board over a road leaving for another district. */
  gateBoard(to: string): Rect {
    return this.gateBoards.get(to) ?? this.officeSigns[0];
  }
  labelOf(text: string): Rect {
    return this.labels.get(text) ?? this.officeSigns[0];
  }
  route(index: number): Rect {
    return this.routes[index % this.routes.length];
  }
  poster2(r: Rng): Rect {
    return r.pick(this.posters);
  }
  plateOf(green: boolean, r: Rng): Rect {
    return r.pick(green ? this.platesGreen : this.platesWhite);
  }
}
