import type { VehicleId } from "../vehicles/vehicleData";
import type { BuildingStyle } from "../world/buildings";

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

export type BlockKind = "dense" | "commercial" | "mosque" | "park" | "market" | "terminal" | "construction" | "villas" | "lake" | "school" | "university" | "river" | "pond" | "garden" | "stadium" | "zoo" | "embassy" | "towers" | "stage" | "coaching" | "garments" | "mall" | "thana" | "fuel";

export interface RegionLayout {
  xLines: number[];
  zLines: number[];
  roads: RoadDef[];
  /** Block kind by "col,row" cell index. Others are dense or commercial by distance to the centre. */
  blocks: Record<string, BlockKind>;
  /** Buildings with a door on the street, by the block they stand on. */
  doors?: { kind: "restaurant" | "hotel" | "clinic" | "bank" | "home" | "office"; key: string }[];
  /** What a market block sells, where it isn't the ordinary bazaar, and its name if it has one. */
  markets?: Record<string, { trade: "bazaar" | "sari" | "electronics" | "gold" | "books"; name?: string }>;
  /** A round plaza with a ring lane, used for the golchattar. */
  plaza: { x: number; z: number; radius: number; ringRadius: number; islandRadius: number; nameBn: string };
  /** Elevated rail line along a north-south road. */
  metro?: {
    x: number;
    fromZ: number;
    toZ: number;
    spacing: number;
    stationZ: number;
    nameBn: string;
    /** Where the trains from here go on to, which way they run, and what a ticket costs. */
    lines: { to: string; dir: 1 | -1; nameBn: string; fare: number }[];
  };
  /** A raised road over the inner lanes of a main road. `start` and `end` are positions along it,
   *  `ramp` how long each ramp is, and `height` the height of the deck's surface. */
  flyover?: { roadName: string; axis: "h" | "v"; at: number; start: number; end: number; ramp: number; height: number };
  areas: { nameBn: string; x0: number; x1: number; z0: number; z1: number }[];
  boundary: number;
}

/** What a district looks like, on top of its layout. Left out, it's the busy old city look. */
export interface RegionStyle {
  /** Buildings on ordinary blocks and on commercial ones, by share. */
  street: [BuildingStyle, number][];
  commercial: [BuildingStyle, number][];
  floors: [number, number];
  commercialFloors: [number, number];
  /** How much is out on the footpaths, 0 to 1. Where there's less, there are trees instead. */
  clutter: number;
  /** How many streets have the overhead tangle of wires, 0 to 1. */
  wires: number;
  /** What parks along the kerb. */
  parked?: string[];
}

/** One line a bus runs. `to` is the district it goes on to; local buses never leave this one. */
export interface BusRoute {
  name: string;
  to?: string;
}

/** Where a road leaves for another district: which road, and which end of it. */
export interface Gate {
  to: string;
  axis: "v" | "h";
  at: number;
  end: 1 | -1;
  nameBn: string;
  viaBn: string;
}

export interface RegionManifest {
  id: string;
  displayNameBn: string;
  displayNameEn: string;
  /** Used wherever a sign or shop name mentions the neighbourhood. */
  shortNameBn: string;
  busRoutes: BusRoute[];
  gates: Gate[];
  roadSigns: { head: string; sub: string }[];
  /** Signs only this district needs. */
  labels: string[];
  style?: RegionStyle;
  trafficMix?: Partial<Record<RoadClass, [VehicleId, number][]>>;
  spawnPoints: Record<string, [number, number, number]>;
  layout: RegionLayout;
  environmentProfile: string;
}
