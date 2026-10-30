export type RoadClass = "main" | "secondary" | "street";

export interface RoadDef {
  axis: "v" | "h"; // v runs north-south at x = at, h runs east-west at z = at
  at: number;
  from: number;
  to: number;
  cls: RoadClass;
  nameBn: string;
  lanesPerDir: number;
  median: number;
}

export type BlockKind = "dense" | "commercial" | "mosque" | "park" | "market" | "terminal" | "construction";

export interface RegionLayout {
  xLines: number[];
  zLines: number[];
  roads: RoadDef[];
  /** Block kind by "col,row" cell index. Others are dense or commercial by distance to the centre. */
  blocks: Record<string, BlockKind>;
  /** A round plaza with a ring lane, used for the golchattar. */
  plaza: { x: number; z: number; radius: number; ringRadius: number; islandRadius: number; nameBn: string };
  /** Elevated rail line along a north-south road. */
  metro?: { x: number; fromZ: number; toZ: number; spacing: number; stationZ: number };
  areas: { nameBn: string; x0: number; x1: number; z0: number; z1: number }[];
  boundary: number;
}

export interface RegionManifest {
  id: string;
  displayNameBn: string;
  displayNameEn: string;
  spawnPoints: Record<string, [number, number, number]>;
  layout: RegionLayout;
  environmentProfile: string;
}
