import {
  Camera, ColorCurves, DefaultRenderingPipeline, ImageProcessingConfiguration, Scene, SSAO2RenderingPipeline,
} from "@babylonjs/core";
import type { QualityPreset } from "./quality";

/** Filmic finish: tone mapping, bloom, ambient occlusion and a warm grade. */
export class PostStack {
  private pipeline: DefaultRenderingPipeline;
  private ssao: SSAO2RenderingPipeline | null = null;

  constructor(private scene: Scene, private camera: Camera, q: QualityPreset) {
    const p = new DefaultRenderingPipeline("main", true, scene, [camera]);
    this.pipeline = p;
    p.imageProcessingEnabled = true;
    const ip = p.imageProcessing;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.05;
    ip.contrast = 1.15;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 1.4;
    ip.vignetteStretch = 0.5;
    ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
    ip.colorCurvesEnabled = true;
    const curves = new ColorCurves();
    curves.globalSaturation = 22;
    curves.highlightsHue = 40;
    curves.highlightsDensity = 18;
    curves.highlightsSaturation = 15;
    curves.shadowsHue = 210;
    curves.shadowsDensity = 14;
    curves.shadowsSaturation = 8;
    ip.colorCurves = curves;
    p.bloomThreshold = 0.82;
    p.bloomWeight = 0.3;
    p.bloomKernel = 64;
    p.bloomScale = 0.5;
    p.sharpenEnabled = true;
    p.sharpen.edgeAmount = 0.34;
    p.sharpen.colorAmount = 1;
    this.apply(q);
  }

  apply(q: QualityPreset): void {
    const p = this.pipeline;
    p.samples = q.msaa;
    p.fxaaEnabled = q.fxaa;
    p.bloomEnabled = q.bloom;
    p.chromaticAberrationEnabled = false;
    p.grainEnabled = false;
    if (q.ssao && !this.ssao) {
      const s = new SSAO2RenderingPipeline("ssao", this.scene, { ssaoRatio: 0.75, blurRatio: 1 }, [this.camera], false);
      s.radius = 1.6;
      s.totalStrength = 1.15;
      s.base = 0.1;
      s.samples = q.name === "ultra" ? 24 : 16;
      s.maxZ = 180;
      s.minZAspect = 0.5;
      s.expensiveBlur = true;
      s.bilateralSamples = 12;
      s.bilateralSoften = 0.05;
      s.bilateralTolerance = 0.01;
      this.ssao = s;
    } else if (!q.ssao && this.ssao) {
      this.scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline("ssao", [this.camera]);
      this.ssao.dispose();
      this.ssao = null;
    }
  }

  /** The player's own preference, on top of whatever the time of day calls for. */
  brightness = 1;

  setGrade(exposure: number, contrast: number): void {
    // Written straight to the settings: the shader reads them every frame anyway, and the public
    // setters tell every material to re-check itself and rebuild the effect, a 50 ms stall each time.
    const cfg = this.pipeline.imageProcessing.imageProcessingConfiguration as unknown as { _exposure: number; _contrast: number };
    cfg._exposure = exposure * this.brightness;
    cfg._contrast = contrast;
  }
}
