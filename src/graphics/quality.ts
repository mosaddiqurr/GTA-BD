import type { QualityName } from "../app/settings";

export interface QualityPreset {
  name: Exclude<QualityName, "auto">;
  renderScale: number; // fraction of the display's physical pixels
  shadowSize: number;
  cascades: number;
  shadowDistance: number;
  ssao: boolean;
  bloom: boolean;
  msaa: number;
  fxaa: boolean;
  anisotropy: number;
  macroSize: number;
  signSize: number;
  detailRadius: number;
  viewScale: number;
  fogDensity: number;
  traffic: number;
  pedestrians: number;
  godRays: boolean;
}

export const QUALITY: Record<QualityPreset["name"], QualityPreset> = {
  low: { name: "low", renderScale: 1, shadowSize: 1024, cascades: 2, shadowDistance: 90, ssao: false, bloom: false, msaa: 1, fxaa: false, anisotropy: 4, macroSize: 2048, signSize: 2048, detailRadius: 70, viewScale: 0.6, fogDensity: 0.0034, traffic: 40, pedestrians: 90, godRays: false },
  medium: { name: "medium", renderScale: 1, shadowSize: 1536, cascades: 3, shadowDistance: 130, ssao: false, bloom: true, msaa: 4, fxaa: false, anisotropy: 8, macroSize: 4096, signSize: 4096, detailRadius: 110, viewScale: 0.8, fogDensity: 0.0024, traffic: 75, pedestrians: 220, godRays: false },
  high: { name: "high", renderScale: 1, shadowSize: 2048, cascades: 3, shadowDistance: 190, ssao: true, bloom: true, msaa: 4, fxaa: false, anisotropy: 16, macroSize: 4096, signSize: 4096, detailRadius: 150, viewScale: 1, fogDensity: 0.0017, traffic: 120, pedestrians: 380, godRays: false },
  ultra: { name: "ultra", renderScale: 1, shadowSize: 3072, cascades: 4, shadowDistance: 260, ssao: true, bloom: true, msaa: 4, fxaa: false, anisotropy: 16, macroSize: 4096, signSize: 4096, detailRadius: 210, viewScale: 1.25, fogDensity: 0.0014, traffic: 150, pedestrians: 520, godRays: true },
};

/** Chooses a preset from the GPU the browser reports. Runtime frame rate corrects it later. */
export function detectQuality(gl: WebGL2RenderingContext | null): QualityPreset["name"] {
  if (!gl) return "low";
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
  if (/swiftshader|llvmpipe|software|microsoft basic/.test(renderer)) return "low";
  if (/rtx|rx [5-9]\d{3}|radeon pro|arc a7/.test(renderer)) return "high";
  if (/gtx|rx [45]\d{2}|iris xe|arc/.test(renderer)) return "medium";
  if (/intel|vega|radeon\(tm\)|radeon graphics|adreno|mali/.test(renderer)) return "medium";
  return "medium";
}

/** Hardware scaling level that gives this preset's share of the display's physical pixels. */
export function scalingFor(q: QualityPreset): number {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return 1 / (dpr * q.renderScale);
}

/** True when the browser is on an integrated GPU, which is a common cause of a slow, soft picture. */
export function isIntegratedGpu(gl: WebGL2RenderingContext | null): boolean {
  return /radeon\(tm\)|radeon graphics|intel|uhd|iris|vega/i.test(gpuName(gl));
}

export function gpuName(gl: WebGL2RenderingContext | null): string {
  if (!gl) return "unknown";
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  return String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}
