import { Matrix, Mesh, Quaternion, Scene, Vector3 } from "@babylonjs/core";
import { StaticAsset, loadStatic } from "./assets";

export const PROP_IDS = [
  "tea_stall", "food_cart", "fruit_cart", "umbrella_stall", "newspaper_stand", "crates", "plastic_chair", "bench", "dustbin", "cone",
  "road_divider", "barrier", "electric_box", "lamp_post", "electric_pole", "traffic_light", "police_box", "bus_stop", "billboard",
  "water_tank", "ac_unit", "dish", "laundry", "planter", "tree_raintree", "tree_krishnachura", "tree_coconut", "tree_banana", "tree_mehgoni",
  "van_cart", "sack_pile", "flexi_kiosk", "clothes_rack", "shoe_stall", "tin_shed", "scaffold_bamboo", "brick_pile", "tin_hoarding", "bunting", "plant_nursery", "cable_bundle", "traffic_mast", "nouka", "zoo_elephant", "zoo_deer", "paan_stall", "fuchka_cart", "jhalmuri_stand", "pitha_stall", "coconut_cart", "cane_press", "cobbler_kit", "barber_chair", "fish_table", "meat_table", "veg_stall", "clothes_heap", "dog", "crow",
] as const;
export type PropId = (typeof PROP_IDS)[number];

export const LANDMARK_IDS = ["metro_pier", "metro_span", "metro_station", "metro_train", "metro_train_cab", "mosque", "footbridge", "golchattar"] as const;
export type LandmarkId = (typeof LANDMARK_IDS)[number];

/** View distance by prop, in metres. Small clutter fades out early to protect the frame rate. */
const VIEW: Partial<Record<string, number>> = {
  paan_stall: 90, fuchka_cart: 100, jhalmuri_stand: 70, pitha_stall: 80, coconut_cart: 100, cane_press: 100, cobbler_kit: 60, barber_chair: 70, fish_table: 80, meat_table: 80, veg_stall: 80, clothes_heap: 90, dog: 70, crow: 55, zoo_deer: 120, zoo_elephant: 160, nouka: 420,
  van_cart: 120, sack_pile: 100, flexi_kiosk: 120, clothes_rack: 120, shoe_stall: 110, tin_shed: 170, scaffold_bamboo: 260, brick_pile: 100, tin_hoarding: 170, bunting: 220, plant_nursery: 110, cable_bundle: 200, traffic_mast: 340,
  plastic_chair: 90, cone: 90, crates: 110, dustbin: 110, ac_unit: 90, laundry: 90, dish: 100, bench: 120,
  tea_stall: 120, food_cart: 120, fruit_cart: 120, umbrella_stall: 120, newspaper_stand: 100, bus_stop: 170, planter: 110, electric_box: 100, barrier: 170,
  tree_raintree: 300, tree_krishnachura: 300, tree_coconut: 300, tree_mehgoni: 300, tree_banana: 150,
  lamp_post: 240, electric_pole: 170, traffic_light: 240, police_box: 200, billboard: 520,
  metro_pier: 640, metro_span: 640, metro_station: 1000, mosque: 800, footbridge: 700, golchattar: 500,
};

/** How far out each kind of prop casts a shadow: 0 nearest cascade only, 1 mid, 9 all. */
const SHADOW_LAYERS: Partial<Record<string, number>> = {
  traffic_mast: 1, van_cart: 0, sack_pile: 0, flexi_kiosk: 0, clothes_rack: 0, shoe_stall: 0, tin_shed: 1, scaffold_bamboo: 1, brick_pile: 0, tin_hoarding: 0, plant_nursery: 0,
  tea_stall: 0, food_cart: 0, fruit_cart: 0, umbrella_stall: 0, bus_stop: 1, police_box: 0, bench: 0, billboard: 1, tree_banana: 1,
  tree_raintree: 1, tree_krishnachura: 1, tree_coconut: 1, tree_mehgoni: 1,
  metro_pier: 1, metro_span: 1, metro_station: 9, mosque: 9, footbridge: 9,
};

/** Parts only some instances should show: every Nth instance keeps them. */
const OPTIONAL_PARTS: Partial<Record<string, Record<string, number>>> = {
  electric_pole: { transformer: 7 },
};

interface PropSet {
  id: string;
  meshes: Mesh[];
  all: Float32Array;
  count: number;
  visible: Float32Array;
  shownHash: number;
  view: number;
  radius: number;
  xs: Float32Array;
  zs: Float32Array;
}

/** Places static props as thin instances: one draw call per prop type. Babylon keeps thin
 *  instance data on the geometry, so a prop must not be split across clones of one mesh;
 *  instead each type culls its own instances and re-uploads only when the set changes. */
export class PropWorld {
  private assets = new Map<string, StaticAsset | null>();
  private pending = new Map<string, number[]>();
  private sets: PropSet[] = [];
  private shadowLimit = new Map<Mesh, number>();
  private solidCache = new Map<string, { x0: number; x1: number; z0: number; z1: number }>();
  private unit = Vector3.One();
  private at = new Vector3();
  private tmp = Matrix.Identity();
  private view = { x: 0, z: 0, scale: 1, dirX: 0, dirZ: 0 };

  constructor(private scene: Scene) {}

  async preload(onProgress?: (done: number, total: number) => void): Promise<void> {
    const all: [string, string][] = [
      ...PROP_IDS.map((id): [string, string] => [id, `assets/props/${id}.glb`]),
      ...LANDMARK_IDS.map((id): [string, string] => [id, `assets/landmarks/${id}.glb`]),
    ];
    let done = 0;
    await Promise.all(
      all.map(async ([id, url]) => {
        this.assets.set(id, await loadStatic(this.scene, url, id));
        onProgress?.(++done, all.length);
      }),
    );
  }

  get(id: string): StaticAsset | null {
    return this.assets.get(id) ?? null;
  }

  has(id: string): boolean {
    return !!this.assets.get(id);
  }

  anchor(id: string, name: string): Vector3 | null {
    return this.get(id)?.anchors.get(name) ?? null;
  }

  /** Queues an instance, and returns which one it is of this prop. Rotation is about Y; the asset's
   *  forward (+Z) points along angle 0. */
  place(id: string, x: number, y: number, z: number, angle = 0, scale = 1): number {
    if (!this.has(id)) return -1;
    let list = this.pending.get(id);
    if (!list) this.pending.set(id, (list = []));
    const index = list.length / 16;
    const m = Matrix.Compose(new Vector3(scale, scale, scale), Quaternion.RotationAxis(Vector3.Up(), angle), new Vector3(x, y, z));
    const arr = m.toArray();
    for (let i = 0; i < 16; i++) list.push(arr[i]);
    return index;
  }

  /** Moves one placed instance, for the few things that can get pushed about. */
  moveInstance(id: string, index: number, x: number, y: number, z: number, angle: number): void {
    if (index < 0) return;
    Matrix.ComposeToRef(this.unit, Quaternion.RotationAxis(Vector3.Up(), angle), this.at.set(x, y, z), this.tmp);
    for (const s of this.sets) {
      if (s.id !== id || index >= s.count) continue;
      this.tmp.copyToArray(s.all, index * 16);
      s.xs[index] = x;
      s.zs[index] = z;
      s.shownHash = -1;
      this.cull(s);
    }
  }

  private moved = new Set<PropSet>();

  /** Sets one placed instance to any position and any tilt, for what gets thrown about. It shows after `flushMoves`. */
  setInstance(id: string, index: number, m: Matrix): void {
    if (index < 0) return;
    for (const s of this.sets) {
      if (s.id !== id || index >= s.count) continue;
      m.copyToArray(s.all, index * 16);
      s.xs[index] = m.m[12];
      s.zs[index] = m.m[14];
      s.shownHash = -1;
      this.moved.add(s);
    }
  }

  /** Once a frame: however many moved, each set only gets rewritten the once. */
  flushMoves(): void {
    if (!this.moved.size) return;
    for (const s of this.moved) this.cull(s);
    this.moved.clear();
  }

  /** Turns the queued placements into drawable sets. Call once after world generation. */
  finalize(addShadow: (m: Mesh) => void): void {
    for (const [id, data] of this.pending) {
      const asset = this.assets.get(id);
      if (!asset) continue;
      const optional = OPTIONAL_PARTS[id] ?? {};
      const common = asset.meshes.filter((m) => optional[m.name] === undefined);
      this.addSet(id, common, new Float32Array(data), asset.radius, addShadow);
      for (const m of asset.meshes) {
        const every = optional[m.name];
        if (every === undefined) continue;
        const some: number[] = [];
        for (let i = 0; i < data.length; i += 16 * every) some.push(...data.slice(i, i + 16));
        this.addSet(id, [m], new Float32Array(some), asset.radius, addShadow);
      }
    }
    this.pending.clear();
  }

  private addSet(id: string, sourceMeshes: Mesh[], all: Float32Array, radius: number, addShadow: (m: Mesh) => void): void {
    const count = all.length / 16;
    const visible = new Float32Array(all);
    const xs = new Float32Array(count), zs = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      xs[i] = all[i * 16 + 12];
      zs[i] = all[i * 16 + 14];
    }
    for (const m of sourceMeshes) {
      m.isVisible = true;
      m.setEnabled(true);
      m.thinInstanceSetBuffer("matrix", visible, 16, false);
      m.alwaysSelectAsActiveMesh = true;
      m.receiveShadows = true;
      m.isPickable = false;
      m.freezeWorldMatrix();
      const limit = SHADOW_LAYERS[id];
      if (limit !== undefined) {
        addShadow(m);
        this.shadowLimit.set(m, limit);
      }
    }
    this.sets.push({ id, meshes: sourceMeshes, all, count, visible, shownHash: -1, view: VIEW[id] ?? 200, radius, xs, zs });
  }

  /** Solid areas of a large model, in its own coordinates, found from its geometry near the
   *  ground. Saves hand-placing colliders that drift out of step with the model. */
  groundFootprint(id: string, minY: number, maxY: number, cellSize = 1): { x0: number; z0: number; x1: number; z1: number }[] {
    const asset = this.get(id);
    if (!asset) return [];
    const cells = new Map<string, [number, number]>();
    for (const m of asset.meshes) {
      const pos = m.getVerticesData("position");
      if (!pos) continue;
      for (let i = 0; i < pos.length; i += 3) {
        if (pos[i + 1] < minY || pos[i + 1] > maxY) continue;
        const cx = Math.floor(pos[i] / cellSize), cz = Math.floor(pos[i + 2] / cellSize);
        cells.set(`${cx},${cz}`, [cx, cz]);
      }
    }
    // Join touching cells into one box per solid object.
    const out: { x0: number; z0: number; x1: number; z1: number }[] = [];
    const seen = new Set<string>();
    for (const [key, start] of cells) {
      if (seen.has(key)) continue;
      const stack = [start];
      seen.add(key);
      let x0 = start[0], x1 = start[0], z0 = start[1], z1 = start[1];
      while (stack.length) {
        const [cx, cz] = stack.pop()!;
        x0 = Math.min(x0, cx); x1 = Math.max(x1, cx);
        z0 = Math.min(z0, cz); z1 = Math.max(z1, cz);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            const k = `${cx + dx},${cz + dz}`;
            const c = cells.get(k);
            if (c && !seen.has(k)) {
              seen.add(k);
              stack.push(c);
            }
          }
        }
      }
      out.push({ x0: x0 * cellSize, z0: z0 * cellSize, x1: (x1 + 1) * cellSize, z1: (z1 + 1) * cellSize });
    }
    return out;
  }

  /** Size of the solid part of a prop, from its geometry between two heights. */
  solidBox(id: string, minY = 0.08, maxY = 1.35): { x0: number; x1: number; z0: number; z1: number } | null {
    const cached = this.solidCache.get(id);
    if (cached) return cached;
    const asset = this.get(id);
    if (!asset) return null;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const m of asset.meshes) {
      const pos = m.getVerticesData("position");
      if (!pos) continue;
      for (let i = 0; i < pos.length; i += 3) {
        const y = pos[i + 1];
        if (y < minY || y > maxY) continue;
        x0 = Math.min(x0, pos[i]);
        x1 = Math.max(x1, pos[i]);
        z0 = Math.min(z0, pos[i + 2]);
        z1 = Math.max(z1, pos[i + 2]);
      }
    }
    if (!isFinite(x0)) return null;
    const box = { x0, x1, z0, z1 };
    this.solidCache.set(id, box);
    return box;
  }

  /** Highest shadow cascade this mesh should draw in. */
  shadowLayerLimit(m: Mesh): number | undefined {
    return this.shadowLimit.get(m);
  }

  /** Keeps instances that are in range and not clearly behind the camera. */
  updateVisibility(x: number, z: number, viewScale: number, dirX = 0, dirZ = 0): void {
    const v = this.view;
    v.x = x;
    v.z = z;
    v.scale = viewScale;
    v.dirX = dirX;
    v.dirZ = dirZ;
    for (const s of this.sets) this.cull(s);
  }

  private cull(s: PropSet): void {
    const { x, z, scale, dirX, dirZ } = this.view;
    const reach = s.view * scale;
    const reach2 = reach * reach;
    const near = s.radius + 24;
    let n = 0;
    let hash = 7;
    // When something moved the kept order alone won't show it, so every instance is rewritten.
    const rewrite = s.shownHash === -1;
    for (let i = 0; i < s.count; i++) {
      const dx = s.xs[i] - x, dz = s.zs[i] - z;
      if (dx * dx + dz * dz > reach2) continue;
      // A wide margin behind the camera keeps quick turns from showing pop-in.
      if (dx * dirX + dz * dirZ < -near) continue;
      if (n !== i || rewrite) s.visible.set(s.all.subarray(i * 16, i * 16 + 16), n * 16);
      n++;
      hash = (hash * 31 + i) | 0;
    }
    if (hash === s.shownHash) return;
    s.shownHash = hash;
    for (const m of s.meshes) {
      m.thinInstanceCount = n;
      if (n > 0) m.thinInstanceBufferUpdated("matrix");
      m.setEnabled(n > 0);
    }
  }
}
