import type { Nullable } from '@zephyr3d/base';
import { Vector2 } from '@zephyr3d/base';
import { AbstractPostEffect, PostEffectLayer } from './posteffect';
import { linearToGamma } from '../shaders/misc';
import type { AbstractDevice, BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { fetchSampler } from '../utility/misc';

/**
 * Color adjustment post effect with optional sharpen.
 * @public
 */
export class ColorAdjust extends AbstractPostEffect {
  private static _program: Nullable<GPUProgram> = null;
  private static _bindgroup: Nullable<BindGroup> = null;
  private readonly _invTexSize: Vector2;
  private _saturation: number;
  private _contrast: number;
  private _hue: number;
  private _sharpen: number;
  /**
   * Creates an instance of color adjust post effect.
   */
  constructor() {
    super();
    this._layer = PostEffectLayer.transparent;
    this._invTexSize = new Vector2();
    this._saturation = 1;
    this._contrast = 1;
    this._hue = 0;
    this._sharpen = 0;
  }
  /** Saturation multiplier, 1 means unchanged. */
  get saturation() {
    return this._saturation;
  }
  set saturation(val: number) {
    this._saturation = val;
  }
  /** Contrast multiplier, 1 means unchanged. */
  get contrast() {
    return this._contrast;
  }
  set contrast(val: number) {
    this._contrast = val;
  }
  /** Hue rotation in degrees. */
  get hue() {
    return this._hue;
  }
  set hue(val: number) {
    this._hue = val;
  }
  /** Sharpen amount, 0 means disabled. */
  get sharpen() {
    return this._sharpen;
  }
  set sharpen(val: number) {
    this._sharpen = val;
  }
  /** {@inheritDoc AbstractPostEffect.requireLinearDepthTexture} */
  requireLinearDepthTexture() {
    return false;
  }
  /** {@inheritDoc AbstractPostEffect.requireDepthAttachment} */
  requireDepthAttachment() {
    return false;
  }
  /** {@inheritDoc AbstractPostEffect.apply} */
  apply(ctx: DrawContext, inputColorTexture: Texture2D, _sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    const device = ctx.device;
    try {
      this._prepare(device);
    } catch (err) {
      console.error(err);
      // Fail-safe: if shader compilation fails, disable this effect and pass through
      // so the editor/render loop keeps running.
      this.enabled = false;
      this.passThrough(ctx, inputColorTexture, srgbOutput);
      return;
    }
    this._invTexSize.setXY(1 / inputColorTexture.width, 1 / inputColorTexture.height);
    ColorAdjust._bindgroup!.setTexture('srcTex', inputColorTexture, fetchSampler('clamp_linear_nomip'));
    ColorAdjust._bindgroup!.setValue('flip', this.needFlip(device) ? 1 : 0);
    ColorAdjust._bindgroup!.setValue('srgbOut', srgbOutput ? 1 : 0);
    ColorAdjust._bindgroup!.setValue('invTexSize', this._invTexSize);
    ColorAdjust._bindgroup!.setValue('saturation', this._saturation);
    ColorAdjust._bindgroup!.setValue('contrast', this._contrast);
    ColorAdjust._bindgroup!.setValue('hue', (this._hue * Math.PI) / 180);
    ColorAdjust._bindgroup!.setValue('sharpen', this._sharpen);
    device.setProgram(ColorAdjust._program);
    device.setBindGroup(0, ColorAdjust._bindgroup!);
    this.drawFullscreenQuad();
  }
  /** @internal */
  private _prepare(device: AbstractDevice) {
    if (!ColorAdjust._program) {
      ColorAdjust._program = device.buildRenderProgram({
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
          this.srgbOut = pb.int().uniform(0);
          this.invTexSize = pb.vec2().uniform(0);
          this.saturation = pb.float().uniform(0);
          this.contrast = pb.float().uniform(0);
          this.hue = pb.float().uniform(0);
          this.sharpen = pb.float().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$l.sample0 = pb.textureSampleLevel(this.srcTex, this.$inputs.uv, 0);
            this.$l.color3 = this.sample0.rgb;
            this.$l.alpha = this.sample0.a;

            this.$if(pb.greaterThan(this.sharpen, 0), function () {
              this.$l.north = pb.textureSampleLevel(
                this.srcTex,
                pb.add(this.$inputs.uv, pb.mul(pb.vec2(0, -1), this.invTexSize)),
                0
              ).rgb;
              this.$l.south = pb.textureSampleLevel(
                this.srcTex,
                pb.add(this.$inputs.uv, pb.mul(pb.vec2(0, 1), this.invTexSize)),
                0
              ).rgb;
              this.$l.west = pb.textureSampleLevel(
                this.srcTex,
                pb.add(this.$inputs.uv, pb.mul(pb.vec2(-1, 0), this.invTexSize)),
                0
              ).rgb;
              this.$l.east = pb.textureSampleLevel(
                this.srcTex,
                pb.add(this.$inputs.uv, pb.mul(pb.vec2(1, 0), this.invTexSize)),
                0
              ).rgb;
              this.$l.lap = pb.sub(
                pb.mul(this.color3, 4),
                pb.add(pb.add(this.north, this.south), pb.add(this.west, this.east))
              );
              this.color3 = pb.add(this.color3, pb.mul(this.lap, this.sharpen));
            });

            this.$l.luma = pb.dot(this.color3, pb.vec3(0.299, 0.587, 0.114));
            this.color3 = pb.mix(pb.vec3(this.luma), this.color3, this.saturation);
            this.color3 = pb.add(pb.mul(pb.sub(this.color3, pb.vec3(0.5)), this.contrast), pb.vec3(0.5));

            this.$l.cosHue = pb.cos(this.hue);
            this.$l.sinHue = pb.sin(this.hue);
            this.$l.r = pb.dot(
              this.color3,
              pb.vec3(
                pb.add(pb.add(0.299, pb.mul(0.701, this.cosHue)), pb.mul(0.168, this.sinHue)),
                pb.add(pb.sub(0.587, pb.mul(0.587, this.cosHue)), pb.mul(0.33, this.sinHue)),
                pb.sub(pb.sub(0.114, pb.mul(0.114, this.cosHue)), pb.mul(0.497, this.sinHue))
              )
            );
            this.$l.g = pb.dot(
              this.color3,
              pb.vec3(
                pb.sub(pb.sub(0.299, pb.mul(0.299, this.cosHue)), pb.mul(0.328, this.sinHue)),
                pb.add(pb.add(0.587, pb.mul(0.413, this.cosHue)), pb.mul(0.035, this.sinHue)),
                pb.add(pb.sub(0.114, pb.mul(0.114, this.cosHue)), pb.mul(0.292, this.sinHue))
              )
            );
            this.$l.b = pb.dot(
              this.color3,
              pb.vec3(
                pb.add(pb.sub(0.299, pb.mul(0.3, this.cosHue)), pb.mul(1.25, this.sinHue)),
                pb.sub(pb.sub(0.587, pb.mul(0.588, this.cosHue)), pb.mul(1.05, this.sinHue)),
                pb.sub(pb.add(0.114, pb.mul(0.886, this.cosHue)), pb.mul(0.203, this.sinHue))
              )
            );

            this.$l.result = pb.clamp(pb.vec3(this.r, this.g, this.b), pb.vec3(0), pb.vec3(1));
            this.$if(pb.notEqual(this.srgbOut, 0), function () {
              this.result = linearToGamma(this, this.result);
            });
            this.$outputs.outColor = pb.vec4(this.result, this.alpha);
          });
        }
      });
      if (!ColorAdjust._program) {
        throw new Error('ColorAdjust: failed to build GPU program');
      }
      ColorAdjust._program.name = '@ColorAdjust';
      ColorAdjust._bindgroup = device.createBindGroup(ColorAdjust._program.bindGroupLayouts[0]);
    }
  }
}
