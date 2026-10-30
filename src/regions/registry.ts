import type { RegionManifest } from "./types";
import { mirpur10 } from "./dhaka/mirpur10";

// New regions register here. Game systems take a RegionManifest and never name a place.
export const regions: Record<string, RegionManifest> = {
  [mirpur10.id]: mirpur10,
};

export const defaultRegionId = mirpur10.id;
