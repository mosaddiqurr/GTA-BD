import { Color4, DynamicTexture, ParticleSystem, Scene, Vector3 } from "@babylonjs/core";

/** A puff of dust and a few sparks where things hit. Always running with nothing to emit, so the
 *  first crash of a session doesn't have to wait for its shaders. */
export class CrashFx {
  private dust: ParticleSystem;
  private sparks: ParticleSystem;
  private at = new Vector3();

  constructor(scene: Scene) {
    const tex = new DynamicTexture("crashDot", 32, scene, false);
    const c = tex.getContext();
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.45, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
    tex.update();
    tex.hasAlpha = true;

    const dust = new ParticleSystem("crashDust", 60, scene);
    dust.particleTexture = tex;
    dust.emitter = this.at;
    dust.minEmitBox = new Vector3(-0.3, 0, -0.3);
    dust.maxEmitBox = new Vector3(0.3, 0.2, 0.3);
    dust.color1 = new Color4(0.62, 0.56, 0.47, 0.34);
    dust.color2 = new Color4(0.5, 0.46, 0.4, 0.26);
    dust.colorDead = new Color4(0.5, 0.46, 0.4, 0);
    dust.minSize = 0.5;
    dust.maxSize = 1.4;
    dust.minLifeTime = 0.5;
    dust.maxLifeTime = 1.15;
    dust.emitRate = 0;
    dust.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    dust.gravity = new Vector3(0, 0.5, 0);
    dust.direction1 = new Vector3(-1.6, 0.2, -1.6);
    dust.direction2 = new Vector3(1.6, 1.3, 1.6);
    dust.minEmitPower = 0.5;
    dust.maxEmitPower = 1.5;
    dust.updateSpeed = 1 / 60;
    this.dust = dust;

    const sparks = new ParticleSystem("crashSparks", 40, scene);
    sparks.particleTexture = tex;
    sparks.emitter = this.at;
    sparks.minEmitBox = new Vector3(-0.15, 0, -0.15);
    sparks.maxEmitBox = new Vector3(0.15, 0.15, 0.15);
    sparks.color1 = new Color4(1.8, 1.25, 0.5, 1);
    sparks.color2 = new Color4(1.6, 0.85, 0.25, 1);
    sparks.colorDead = new Color4(0.8, 0.3, 0.05, 0);
    sparks.minSize = 0.025;
    sparks.maxSize = 0.07;
    sparks.minLifeTime = 0.18;
    sparks.maxLifeTime = 0.5;
    sparks.emitRate = 0;
    sparks.blendMode = ParticleSystem.BLENDMODE_ADD;
    sparks.gravity = new Vector3(0, -9, 0);
    sparks.direction1 = new Vector3(-3.4, 0.6, -3.4);
    sparks.direction2 = new Vector3(3.4, 3.4, 3.4);
    sparks.minEmitPower = 0.8;
    sparks.maxEmitPower = 1.9;
    sparks.updateSpeed = 1 / 60;
    this.sparks = sparks;

    dust.start();
    sparks.start();
  }

  /** `strength` runs from 0 to 1. Metal on metal throws sparks; anything else only raises dust. */
  burst(x: number, y: number, z: number, strength: number, metal: boolean): void {
    this.at.set(x, y, z);
    this.dust.manualEmitCount = Math.round(8 + strength * 26);
    if (metal && strength > 0.28) this.sparks.manualEmitCount = Math.round(6 + strength * 26);
  }
}
