import type { RegionManifest } from "../types";

// An original, compressed approximation of the Mirpur 10 area. Road names and the
// layout are inspired by the real place; this is not survey data.
export const mirpur10: RegionManifest = {
  id: "dhaka_mirpur10",
  displayNameBn: "মিরপুর ১০, ঢাকা",
  displayNameEn: "Mirpur 10, Dhaka",
  environmentProfile: "urban_dhaka",
  spawnPoints: { default: [-15, 0.16, -34] },
  layout: {
    xLines: [-460, -290, -130, 0, 150, 300, 460],
    zLines: [-460, -280, -120, 0, 140, 300, 460],
    boundary: 478,
    roads: [
      { axis: "v", at: 0, from: -460, to: 460, cls: "main", nameBn: "বেগম রোকেয়া সরণি", lanesPerDir: 3, median: 2.8 },
      { axis: "h", at: 0, from: -460, to: 460, cls: "main", nameBn: "মিরপুর সড়ক", lanesPerDir: 2, median: 1.2 },
      { axis: "v", at: -290, from: -460, to: 460, cls: "secondary", nameBn: "সেনপাড়া রোড", lanesPerDir: 2, median: 0 },
      { axis: "v", at: 300, from: -460, to: 460, cls: "secondary", nameBn: "মনিপুর রোড", lanesPerDir: 2, median: 0 },
      { axis: "h", at: -280, from: -460, to: 460, cls: "secondary", nameBn: "কাজীপাড়া রোড", lanesPerDir: 2, median: 0 },
      { axis: "h", at: 300, from: -460, to: 460, cls: "secondary", nameBn: "পল্লবী রোড", lanesPerDir: 2, median: 0 },
      { axis: "v", at: -460, from: -460, to: 460, cls: "secondary", nameBn: "পশ্চিম বাইপাস", lanesPerDir: 2, median: 0 },
      { axis: "v", at: 460, from: -460, to: 460, cls: "secondary", nameBn: "পূর্ব বাইপাস", lanesPerDir: 2, median: 0 },
      { axis: "h", at: -460, from: -460, to: 460, cls: "secondary", nameBn: "দক্ষিণ বাইপাস", lanesPerDir: 2, median: 0 },
      { axis: "h", at: 460, from: -460, to: 460, cls: "secondary", nameBn: "উত্তর বাইপাস", lanesPerDir: 2, median: 0 },
      { axis: "v", at: -130, from: -280, to: 300, cls: "street", nameBn: "পর্বতা রোড", lanesPerDir: 1, median: 0 },
      { axis: "v", at: 150, from: -460, to: 300, cls: "street", nameBn: "শেওড়াপাড়া লেন", lanesPerDir: 1, median: 0 },
      { axis: "h", at: -120, from: -460, to: 300, cls: "street", nameBn: "ইব্রাহিমপুর রোড", lanesPerDir: 1, median: 0 },
      { axis: "h", at: 140, from: -290, to: 460, cls: "street", nameBn: "আল-হেলাল রোড", lanesPerDir: 1, median: 0 },
    ],
    blocks: {
      "2,3": "mosque",
      "4,4": "park",
      "4,1": "market",
      "1,3": "terminal",
      "5,3": "construction",
    },
    plaza: { x: 0, z: 0, radius: 26, ringRadius: 14.5, islandRadius: 7, nameBn: "মিরপুর ১০ গোলচত্বর" },
    metro: { x: 0, fromZ: -490, toZ: 490, spacing: 35, stationZ: 105 },
    areas: [
      { nameBn: "মিরপুর ১০ গোলচত্বর", x0: -55, x1: 55, z0: -55, z1: 55 },
      { nameBn: "মেট্রো স্টেশন এলাকা", x0: -40, x1: 40, z0: 55, z1: 190 },
      { nameBn: "সেনপাড়া", x0: -300, x1: -40, z0: -300, z1: 40 },
      { nameBn: "ইব্রাহিমপুর", x0: -480, x1: -300, z0: -480, z1: 0 },
      { nameBn: "কাজীপাড়া", x0: -40, x1: 480, z0: -480, z1: -120 },
      { nameBn: "মনিপুর", x0: 40, x1: 480, z0: -120, z1: 480 },
      { nameBn: "পল্লবী", x0: -480, x1: 40, z0: 40, z1: 480 },
    ],
  },
};
