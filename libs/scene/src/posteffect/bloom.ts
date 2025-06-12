import type { AbstractDevice, BindGroup, GPUProgram, RenderStateSet, Texture2D } from '@zephyr3d/device';
import { AbstractPostEffect, PostEffectLayer } from './posteffect';
import type { DrawContext } from '../render';
import { Vector2, Vector4 } from '@zephyr3d/base';

/**
 * The bloom post effect
 * @public
 */
export class Bloom extends AbstractPostEffect {
  static readonly className = 'Bloom' as const;
  private static _programDownsampleH: GPUProgram = null;
  private static _programDownsampleV: GPUProgram = null;
  private static _programUpsample: GPUProgram = null;
  private static _programFinalCompose: GPUProgram = null;
  private static _programPrefilter: GPUProgram = null;
  private static _renderStateAdditive: RenderStateSet = null;
  private static _bindgroupDownsampleH: BindGroup = null;
  private static _bindgroupDownsampleV: BindGroup = null;
  private static _bindgroupUpsample: BindGroup = null;
  private static _bindgroupFinalCompose: BindGroup = null;
  private static _bindgroupPrefilter: BindGroup = null;
  private _thresholdValue: Vector4;
  private _invTexSize: Vector2;
  private _maxDownsampleLevels: number;
  private _downsampleLimit: number;
  private _threshold: number;
  private _thresholdKnee: number;
  private _intensity: number;
  /**
   * Creates an instance of tonemap post effect
   */
  constructor() {
    super();
    this._layer = PostEffectLayer.transparent;
    this._thresholdValue = new Vector4();
    this._invTexSize = new Vector2();
    this._maxDownsampleLevels = 4;
    this._downsampleLimit = 32;
    this._threshold = 0.8;
    this._thresholdKnee = 0;
    this._intensity = 1;
  }
  /** The maximum downsample levels */
  get maxDownsampleLevel(): number {
    return this._maxDownsampleLevels;
  }
  set maxDownsampleLevel(val: number) {
    this._maxDownsampleLevels = val;
  }
  /** Downsample resolution limitation */
  get downsampleLimit(): number {
    return this._downsampleLimit;
  }
  set downsampleLimit(val: number) {
    this._downsampleLimit = val;
  }
  /** Bloom threshold */
  get threshold(): number {
    return this._threshold;
  }
  set threshold(val: number) {
    this._threshold = val;
  }
  /** Bloom threshold knee */
  get thresholdKnee(): number {
    return this._thresholdKnee;
  }
  set thresholdKnee(val: number) {
    this._thresholdKnee = val;
  }
  /** Bloom intensity */
  get intensity(): number {
    return this._intensity;
  }
  set intensity(val: number) {
    this._intensity = val;
  }
  /** {@inheritDoc AbstractPostEffect.requireLinearDepthTexture} */
  requireLinearDepthTexture(): boolean {
    return false;
  }
  /** {@inheritDoc AbstractPostEffect.requireDepthAttachment} */
  requireDepthAttachment(): boolean {
    return false;
  }
  /** {@inheritDoc AbstractPostEffect.apply} */
  apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    const device = ctx.device;
    const downsampleTextures: Texture2D[] = [];
    this._prepare(device, inputColorTexture);
    device.pushDeviceStates();
    const w = Math.max(inputColorTexture.width >> 1, 1);
    const h = Math.max(inputColorTexture.height >> 1, 1);
    const colorTex = device.pool.fetchTemporalTexture2D(false, inputColorTexture.format, w, h, false);
    this.prefilter(device, inputColorTexture, colorTex);
    this.downsample(device, colorTex, downsampleTextures);
    this.upsample(device, downsampleTextures);
    device.popDeviceStates();
    this.finalCompose(device, inputColorTexture, downsampleTextures[0]);
    for (const tex of downsampleTextures) {
      device.pool.releaseTexture(tex);
    }
    device.pool.releaseTexture(colorTex);
  }
  /** @internal */
  prefilter(device: AbstractDevice, srcTexture: Texture2D, rt: Texture2D) {
    this._thresholdValue.x = this._threshold * this._threshold;
    this._thresholdValue.y = this._thresholdValue.x * this._thresholdKnee;
    this._thresholdValue.z = 2 * this._thresholdValue.y;
    this._thresholdValue.w = 0.25 / (this._thresholdValue.y + 0.00001);
    this._thresholdValue.y -= this._thresholdValue.x;
    device.setFramebuffer([rt]);
    device.setProgram(Bloom._programPrefilter);
    device.setBindGroup(0, Bloom._bindgroupPrefilter);
    Bloom._bindgroupPrefilter.setTexture('tex', srcTexture);
    Bloom._bindgroupPrefilter.setValue('flip', device.type === 'webgpu' ? 1 : 0);
    Bloom._bindgroupPrefilter.setValue('threshold', this._thresholdValue);
    this.drawFullscreenQuad();
  }
  /** @internal */
  finalCompose(device: AbstractDevice, srcTexture: Texture2D, bloomTexture: Texture2D) {
    device.setProgram(Bloom._programFinalCompose);
    device.setBindGroup(0, Bloom._bindgroupFinalCompose);
    Bloom._bindgroupFinalCompose.setTexture('srcTex', srcTexture);
    Bloom._bindgroupFinalCompose.setTexture('bloomTex', bloomTexture);
    Bloom._bindgroupFinalCompose.setValue('intensity', this._intensity);
    Bloom._bindgroupFinalCompose.setValue(
      'flip',
      device.type === 'webgpu' && device.getFramebuffer() ? 1 : 0
    );
    this.drawFullscreenQuad();
  }
  /** @internal */
  upsample(device: AbstractDevice, textures: Texture2D[]) {
    device.setProgram(Bloom._programUpsample);
    device.setBindGroup(0, Bloom._bindgroupUpsample);
    Bloom._bindgroupUpsample.setValue('flip', device.type === 'webgpu' ? 1 : 0);
    for (let i = textures.length - 2; i >= 0; i--) {
      Bloom._bindgroupUpsample.setTexture('tex', textures[i + 1]);
      device.setFramebuffer([textures[i]]);
      this.drawFullscreenQuad(Bloom._renderStateAdditive);
    }
  }
  /** @internal */
  downsample(device: AbstractDevice, inputColorTexture: Texture2D, textures: Texture2D[]) {
    const t = Math.max(2, this._downsampleLimit);
    let w = Math.max(t, inputColorTexture.width >> 1);
    let h = Math.max(t, inputColorTexture.height >> 1);
    let maxLevels = Math.max(this._maxDownsampleLevels, 1);
    let sourceTex = inputColorTexture;
    Bloom._bindgroupDownsampleH.setValue('flip', device.type === 'webgpu' ? 1 : 0);
    Bloom._bindgroupDownsampleV.setValue('flip', device.type === 'webgpu' ? 1 : 0);
    while ((w >= t || h >= t) && maxLevels > 0) {
      const tex = device.pool.fetchTemporalTexture2D(false, inputColorTexture.format, w, h, false);
      textures.push(tex);

      const texMiddle = device.pool.fetchTemporalTexture2D(false, inputColorTexture.format, w, h, false);

      // horizonal blur
      this._invTexSize.setXY(1 / sourceTex.width, 1 / sourceTex.height);
      device.setFramebuffer([texMiddle]);
      device.setProgram(Bloom._programDownsampleH);
      device.setBindGroup(0, Bloom._bindgroupDownsampleH);
      Bloom._bindgroupDownsampleH.setTexture('tex', sourceTex);
      Bloom._bindgroupDownsampleH.setValue('invTexSize', this._invTexSize);
      this.drawFullscreenQuad();

      // vertical blur
      this._invTexSize.setXY(1 / texMiddle.width, 1 / texMiddle.height);
      device.setFramebuffer([tex]);
      device.setProgram(Bloom._programDownsampleV);
      device.setBindGroup(0, Bloom._bindgroupDownsampleV);
      Bloom._bindgroupDownsampleV.setTexture('tex', texMiddle);
      Bloom._bindgroupDownsampleV.setValue('invTexSize', this._invTexSize);
      this.drawFullscreenQuad();

      maxLevels--;
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
      sourceTex = tex;

      device.pool.releaseTexture(texMiddle);
    }
  }
  /** @internal */
  private _prepare(device: AbstractDevice, srcTexture: Texture2D) {
    if (!Bloom._programFinalCompose) {
      Bloom._programFinalCompose = device.buildRenderProgram({
        vertex(pb) {
          this.flip = pb.int().uniform(0);
          this.$inputs.pos = pb.vec2().attrib('position');
          this.$outputs.uv = pb.vec2();
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
            this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
            this.$if(pb.notEqual(this.flip, 0), function () {
              this.$builtins.position.y = pb.neg(this.$builtins.position.y);
            });
          });
        },
        fragment(pb) {
          this.srcTex = pb.tex2D().uniform(0);
          this.bloomTex = pb.tex2D().uniform(0);
          this.intensity = pb.float().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$l.srcSample = pb.textureSampleLevel(this.srcTex, this.$inputs.uv, 0);
            this.$l.bloomSample = pb.textureSampleLevel(this.bloomTex, this.$inputs.uv, 0);
            this.$outputs.outColor = pb.vec4(
              pb.add(this.srcSample.rgb, pb.mul(this.bloomSample.rgb, this.intensity)),
              1
            );
          });
        }
      });
      Bloom._bindgroupFinalCompose = device.createBindGroup(Bloom._programFinalCompose.bindGroupLayouts[0]);
    }
    if (!Bloom._programPrefilter) {
      Bloom._programPrefilter = device.buildRenderProgram({
        vertex(pb) {
          this.flip = pb.int().uniform(0);
          this.$inputs.pos = pb.vec2().attrib('position');
          this.$outputs.uv = pb.vec2();
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
            this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
            this.$if(pb.notEqual(this.flip, 0), function () {
              this.$builtins.position.y = pb.neg(this.$builtins.position.y);
            });
          });
        },
        fragment(pb) {
          this.tex = pb.tex2D().uniform(0);
          this.threshold = pb.vec4().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$l.p = pb.textureSampleLevel(this.tex, this.$inputs.uv, 0);
            this.$l.brightness = pb.max(pb.max(this.p.r, this.p.g), this.p.b);
            this.$l.soft = pb.clamp(pb.add(this.brightness, this.threshold.y), 0, this.threshold.z);
            this.soft = pb.mul(this.soft, this.soft, this.threshold.w);
            this.$l.contrib = pb.div(
              pb.max(this.soft, pb.sub(this.brightness, this.threshold.x)),
              pb.max(this.brightness, 0.00001)
            );
            this.$outputs.outColor = pb.vec4(pb.mul(this.p.rgb, this.contrib), 1);
          });
        }
      });
      Bloom._bindgroupPrefilter = device.createBindGroup(Bloom._programPrefilter.bindGroupLayouts[0]);
    }
    if (!Bloom._programUpsample) {
      Bloom._programUpsample = device.buildRenderProgram({
        vertex(pb) {
          this.flip = pb.int().uniform(0);
          this.$inputs.pos = pb.vec2().attrib('position');
          this.$outputs.uv = pb.vec2();
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
            this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
            this.$if(pb.notEqual(this.flip, 0), function () {
              this.$builtins.position.y = pb.neg(this.$builtins.position.y);
            });
          });
        },
        fragment(pb) {
          this.tex = pb.tex2D().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$outputs.outColor = pb.textureSampleLevel(this.tex, this.$inputs.uv, 0);
          });
        }
      });
      Bloom._bindgroupUpsample = device.createBindGroup(Bloom._programUpsample.bindGroupLayouts[0]);
    }
    if (!Bloom._programDownsampleH) {
      const offsets = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
      const weights = [
        0.01621622, 0.05405405, 0.12162162, 0.19459459, 0.22702703, 0.19459459, 0.12162162, 0.05405405,
        0.01621622
      ];
      Bloom._programDownsampleH = device.buildRenderProgram({
        vertex(pb) {
          this.flip = pb.int().uniform(0);
          this.$inputs.pos = pb.vec2().attrib('position');
          this.$outputs.uv = pb.vec2();
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
            this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
            this.$if(pb.notEqual(this.flip, 0), function () {
              this.$builtins.position.y = pb.neg(this.$builtins.position.y);
            });
          });
        },
        fragment(pb) {
          this.invTexSize = pb.vec2().uniform(0);
          this.tex = pb.tex2D().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$l.sum = pb.vec3(0);
            this.$l.offset = pb.float();
            for (let i = 0; i < 9; i++) {
              this.offset = pb.mul(this.invTexSize.x, offsets[i] * 2);
              this.sum = pb.add(
                this.sum,
                pb.mul(
                  pb.textureSampleLevel(this.tex, pb.add(this.$inputs.uv, pb.vec2(this.offset, 0)), 0).rgb,
                  weights[i]
                )
              );
            }
            this.$outputs.outColor = pb.vec4(this.sum, 1);
          });
        }
      });
      Bloom._bindgroupDownsampleH = device.createBindGroup(Bloom._programDownsampleH.bindGroupLayouts[0]);
    }
    if (!Bloom._programDownsampleV) {
      const offsets = [-3.23076923, -1.38461538, 0.0, 1.38461538, 3.23076923];
      const weights = [0.07027027, 0.31621622, 0.22702703, 0.31621622, 0.07027027];
      Bloom._programDownsampleV = device.buildRenderProgram({
        vertex(pb) {
          this.flip = pb.int().uniform(0);
          this.$inputs.pos = pb.vec2().attrib('position');
          this.$outputs.uv = pb.vec2();
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
            this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
            this.$if(pb.notEqual(this.flip, 0), function () {
              this.$builtins.position.y = pb.neg(this.$builtins.position.y);
            });
          });
        },
        fragment(pb) {
          this.invTexSize = pb.vec2().uniform(0);
          this.tex = pb.tex2D().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$l.sum = pb.vec3(0);
            this.$l.offset = pb.float();
            for (let i = 0; i < 5; i++) {
              this.offset = pb.mul(this.invTexSize.y, offsets[i]);
              this.sum = pb.add(
                this.sum,
                pb.mul(
                  pb.textureSampleLevel(this.tex, pb.add(this.$inputs.uv, pb.vec2(0, this.offset)), 0).rgb,
                  weights[i]
                )
              );
            }
            this.$outputs.outColor = pb.vec4(this.sum, 1);
          });
        }
      });
      Bloom._bindgroupDownsampleV = device.createBindGroup(Bloom._programDownsampleV.bindGroupLayouts[0]);
    }
    if (!Bloom._renderStateAdditive) {
      Bloom._renderStateAdditive = device.createRenderStateSet();
      Bloom._renderStateAdditive.useRasterizerState().setCullMode('none');
      Bloom._renderStateAdditive.useDepthState().enableTest(false).enableWrite(false);
      Bloom._renderStateAdditive
        .useBlendingState()
        .enable(true)
        .setBlendFuncRGB('one', 'one')
        .setBlendFuncAlpha('one', 'zero');
    }
  }
}
