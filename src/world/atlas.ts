import { Color3, Material, PBRMaterial, Scene, Texture } from "@babylonjs/core";
import type { Rect } from "./geo";

// Must match the cell layout in tools/textures/build_textures.py.
export const CELLS = {
  plasterClean: [0, 0], plasterStain: [1, 0], plasterHeavy: [2, 0], concrete: [3, 0], brick: [4, 0], tileMosaic: [5, 0], tileWhite: [6, 0], acp: [7, 0],
  winGrillA: [0, 1], winGrillB: [1, 1], winSlideA: [2, 1], winSlideB: [3, 1], winDark: [4, 1], winCurtainA: [5, 1], winCurtainB: [6, 1], winOffice: [7, 1],
  shopGrocery: [0, 2], shopPharmacy: [1, 2], shopMobile: [2, 2], shopClothes: [3, 2], shopTea: [4, 2], shopHardware: [5, 2], shopSweets: [6, 2], shopBooks: [7, 2],
  shutter: [0, 3], shutterBlue: [1, 3], awning: [2, 3], tarp: [3, 3], metal: [4, 3], rust: [5, 3], wood: [6, 3], door: [7, 3],
  ac: [0, 4], balconyFloor: [1, 4], roof: [2, 4], tar: [3, 4], curtainWall: [4, 4], vinylA: [5, 4], vinylB: [6, 4], vinylC: [7, 4],
  railPlain: [0, 5], railOrnate: [1, 5], laundryA: [2, 5], laundryB: [3, 5], plants: [4, 5], mesh: [5, 5], farA: [6, 5], farB: [7, 5],
} as const;

export type CellName = keyof typeof CELLS;

const GRID = 8;
const INSET = 3 / 512 / GRID;

/** Texture rect of a whole cell (or a part of it, in 0..1 with y0 = top). */
export function cell(name: CellName, fx0 = 0, fy0 = 0, fx1 = 1, fy1 = 1): Rect {
  const [cx, cy] = CELLS[name];
  const s = 1 / GRID;
  const u0 = cx * s + INSET;
  const u1 = (cx + 1) * s - INSET;
  const vTop = 1 - cy * s - INSET;
  const vBot = 1 - (cy + 1) * s + INSET;
  const du = u1 - u0;
  const dv = vTop - vBot;
  return [u0 + du * fx0, vTop - dv * fy1, u0 + du * fx1, vTop - dv * fy0];
}

/** A wall-sized patch of a tiling material: width by height in metres at 4 m per cell. */
export function patch(name: CellName, w: number, h: number, seedU: number, seedV: number, metresPerCell = 4): Rect {
  const fw = Math.min(w / metresPerCell, 1);
  const fh = Math.min(h / metresPerCell, 1);
  const fx0 = (1 - fw) * seedU;
  const fy0 = (1 - fh) * seedV;
  return cell(name, fx0, fy0, fx0 + fw, fy0 + fh);
}

export interface FacadeMaterials {
  opaque: PBRMaterial;
  cutout: PBRMaterial;
  /** Shop interiors: a separate, much sharper atlas, because people walk right past them. */
  shop: PBRMaterial;
}

// Must match PAINTERS in tools/textures/build_shops.py.
const SHOP_CELLS: Partial<Record<CellName, number[]>> = {
  shopGrocery: [0, 8], shopPharmacy: [1], shopMobile: [2], shopClothes: [3], shopTea: [4], shopHardware: [5, 8], shopSweets: [6], shopBooks: [7],
};
const SHOP_COLS = 3;
const SHOP_ROWS = 3;
const SHOP_INSET = 2 / 1365;

/** Texture rect inside the shop atlas. `pick` (0..1) chooses between a kind's painted variants. */
export function shopCell(kind: CellName, pick: number, fx0 = 0, fy0 = 0, fx1 = 1, fy1 = 1): Rect {
  const options = SHOP_CELLS[kind] ?? [0];
  const i = options[Math.floor(pick * options.length) % options.length];
  const cx = i % SHOP_COLS, cy = Math.floor(i / SHOP_COLS);
  const u0 = (cx + SHOP_INSET) / SHOP_COLS, u1 = (cx + 1 - SHOP_INSET) / SHOP_COLS;
  const vTop = 1 - (cy + SHOP_INSET) / SHOP_ROWS, vBot = 1 - (cy + 1 - SHOP_INSET) / SHOP_ROWS;
  const du = u1 - u0, dv = vTop - vBot;
  return [u0 + du * fx0, vTop - dv * fy1, u0 + du * fx1, vTop - dv * fy0];
}

function configure(mat: PBRMaterial, albedo: Texture, normal: Texture, orm: Texture, emissive: Texture): void {
  mat.albedoTexture = albedo;
  mat.bumpTexture = normal;
  mat.metallicTexture = orm;
  mat.useRoughnessFromMetallicTextureAlpha = false;
  mat.useRoughnessFromMetallicTextureGreen = true;
  mat.useMetallnessFromMetallicTextureBlue = true;
  mat.useAmbientOcclusionFromMetallicTextureRed = true;
  mat.metallic = 1;
  mat.roughness = 1;
  mat.emissiveTexture = emissive;
  mat.emissiveColor = Color3.White();
  mat.emissiveIntensity = 0;
}

export function createFacadeMaterials(scene: Scene, anisotropy: number): FacadeMaterials {
  const load = (file: string, linear = false): Texture => {
    const t = new Texture(`assets/textures/${file}`, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
    t.anisotropicFilteringLevel = anisotropy;
    t.gammaSpace = !linear;
    return t;
  };
  const albedo = load("facade_albedo.webp");
  const normal = load("facade_normal.webp", true);
  const orm = load("facade_orm.webp", true);
  const emissive = load("facade_emissive.webp");

  const opaque = new PBRMaterial("facade", scene);
  configure(opaque, albedo, normal, orm, emissive);

  const cutout = new PBRMaterial("facadeCutout", scene);
  configure(cutout, albedo, normal, orm, emissive);
  cutout.transparencyMode = Material.MATERIAL_ALPHATEST;
  cutout.albedoTexture = albedo;
  albedo.hasAlpha = true;
  cutout.useAlphaFromAlbedoTexture = true;
  cutout.alphaCutOff = 0.5;
  cutout.backFaceCulling = false;
  cutout.twoSidedLighting = true;
  // The opaque material must ignore the alpha channel that shares this texture.
  opaque.transparencyMode = Material.MATERIAL_OPAQUE;
  opaque.useAlphaFromAlbedoTexture = false;

  const shopTex = load("shops.webp");
  const shop = new PBRMaterial("shopInterior", scene);
  shop.albedoTexture = shopTex;
  // At night the goods are lit by the shop's own tube light.
  shop.emissiveTexture = shopTex;
  shop.emissiveColor = Color3.White();
  shop.emissiveIntensity = 0;
  shop.metallic = 0;
  shop.roughness = 0.82;
  return { opaque, cutout, shop };
}
