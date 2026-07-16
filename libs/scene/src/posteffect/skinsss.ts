import { Vector2, Vector4 } from '@zephyr3d/base';
import type { BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { ShaderHelper } from '../material';
import { linearToGamma } from '../shaders/misc';
import { fetchSampler } from '../utility/misc';
import { AbstractPostEffect, PostEffectLayer } from './posteffect';

/**
 * Stylized screen-space skin scattering pass.
 *
 * @remarks
 * This is intentionally separate from the profile-based {@link SSS} pass. It follows the simpler
 * depth-aware blur used by many character renderers: a skin material writes a lighting multiplier
 * into a side buffer, then this pass performs a fixed 9x9 depth-aware blur and composites it back
 * over the opaque color.
 *
 * @public
 */
export class SkinSSS extends AbstractPostEffect {
  private static _program: GPUProgram | null = null;
  private _bindGroup: BindGroup | null;
  private _strength: number;
  private _opacity: number;
  private _sampleStep: number;
  private _depthScale: number;
  private _colorBoost: number;

  constructor() {
    super();
    this._layer = PostEffectLayer.opaque;
    this._bindGroup = null;
    this._strength = 1;
    this._opacity = 0.18;
    this._sampleStep = 2;
    this._depthScale = 80;
    this._colorBoost = 1;
  }

  /** Final blend strength. */
  get strength() {
    return this._strength;
  }
  set strength(val) {
    this._strength = Math.max(0, val ?? 0);
  }

  /** Bias subtracted from the blurred skin mask before compositing. */
  get opacity() {
    return this._opacity;
  }
  set opacity(val) {
    this._opacity = Math.max(0, Math.min(1, val ?? 0));
  }

  /** Pixel spacing between blur taps. The reference shader uses 2. */
  get sampleStep() {
    return this._sampleStep;
  }
  set sampleStep(val) {
    this._sampleStep = Math.max(0.25, val ?? 0.25);
  }

  /** Depth rejection scale. The reference shader uses 80. */
  get depthScale() {
    return this._depthScale;
  }
  set depthScale(val) {
    this._depthScale = Math.max(0, val ?? 0);
  }

  /** Multiplier applied to the blurred skin lighting multiplier before compositing. */
  get colorBoost() {
    return this._colorBoost;
  }
  set colorBoost(val) {
    this._colorBoost = Math.max(0, val ?? 0);
  }

  requireLinearDepthTexture() {
    return true;
  }

  apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    if (!ctx.SkinSSSTexture || this._strength <= 0) {
      this.passThrough(ctx, inputColorTexture, srgbOutput);
      return;
    }
    const device = ctx.device;
    let program = SkinSSS._program;
    if (!program) {
      program = this.createProgram(ctx);
      SkinSSS._program = program;
    }
    if (!this._bindGroup) {
      this._bindGroup = device.createBindGroup(program.bindGroupLayouts[0]);
    }
    this._bindGroup.setTexture('colorTex', inputColorTexture, fetchSampler('clamp_linear'));
    this._bindGroup.setTexture('skinTex', ctx.SkinSSSTexture, fetchSampler('clamp_linear'));
    this._bindGroup.setTexture('depthTex', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
    this._bindGroup.setValue(
      'cameraNearFar',
      new Vector2(ctx.camera.getNearPlane(), ctx.camera.getFarPlane())
    );
    this._bindGroup.setValue(
      'targetSize',
      new Vector4(
        inputColorTexture.width,
        inputColorTexture.height,
        inputColorTexture.width,
        inputColorTexture.height
      )
    );
    this._bindGroup.setValue('strength', this._strength);
    this._bindGroup.setValue('opacity', this._opacity);
    this._bindGroup.setValue('sampleStep', this._sampleStep);
    this._bindGroup.setValue('depthScale', this._depthScale);
    this._bindGroup.setValue('colorBoost', this._colorBoost);
    this._bindGroup.setValue('flip', this.needFlip(device) ? 1 : 0);
    this._bindGroup.setValue('srgbOut', srgbOutput ? 1 : 0);
    device.setProgram(program);
    device.setBindGroup(0, this._bindGroup);
    this.drawFullscreenQuad();
  }

  private createProgram(ctx: DrawContext) {
    const program = ctx.device.buildRenderProgram({
      vertex(pb) {
        this.flip = pb.int().uniform(0);
        this.$inputs.pos = pb.vec2().attrib('position');
        this.$outputs.uv = pb.vec2();
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, 1, 1);
          this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
          this.$if(pb.notEqual(this.flip, 0), function () {
            this.$builtins.position.y = pb.neg(this.$builtins.position.y);
          });
        });
      },
      fragment(pb) {
        this.colorTex = pb.tex2D().uniform(0);
        this.skinTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.strength = pb.float().uniform(0);
        this.opacity = pb.float().uniform(0);
        this.sampleStep = pb.float().uniform(0);
        this.depthScale = pb.float().uniform(0);
        this.colorBoost = pb.float().uniform(0);
        this.srgbOut = pb.int().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.func('readDepth01', [pb.vec2('uv')], function () {
          this.$return(ShaderHelper.sampleLinearDepth(this, this.depthTex, this.uv, 0));
        });
        pb.main(function () {
          this.$l.uv = this.$inputs.uv;
          this.$l.baseColor = pb.textureSampleLevel(this.colorTex, this.uv, 0);
          this.$l.result = this.baseColor.rgb;
          this.$l.centerDepth01 = this.readDepth01(this.uv);
          this.$if(pb.lessThan(this.centerDepth01, 1), function () {
            this.$l.centerDepth = pb.max(pb.mul(this.centerDepth01, this.cameraNearFar.y), 1e-4);
            this.$l.sum = pb.vec4(0);
            this.$l.weightSum = pb.float(0);
            this.$for(pb.int('y'), -4, 5, function () {
              this.$for(pb.int('x'), -4, 5, function () {
                this.$l.offsetPx = pb.mul(pb.vec2(pb.float(this.x), pb.float(this.y)), this.sampleStep);
                this.$l.sampleUV = pb.clamp(
                  pb.add(this.uv, pb.div(this.offsetPx, this.targetSize.xy)),
                  pb.vec2(0),
                  pb.vec2(1)
                );
                this.$l.skinSample = pb.textureSampleLevel(this.skinTex, this.sampleUV, 0);
                this.$if(pb.lessThanEqual(this.skinSample.a, 1e-4), function () {
                  this.skinSample = pb.vec4(0, 0, 0, this.opacity);
                });
                this.$l.sampleDepth01 = this.readDepth01(this.sampleUV);
                this.$l.sampleDepth = pb.max(pb.mul(this.sampleDepth01, this.cameraNearFar.y), 1e-4);
                this.$l.depthWeight = pb.clamp(
                  pb.sub(
                    1,
                    pb.div(
                      pb.mul(pb.abs(pb.sub(this.centerDepth, this.sampleDepth)), this.depthScale),
                      this.centerDepth
                    )
                  ),
                  0,
                  1
                );
                this.depthWeight = pb.mul(
                  this.depthWeight,
                  this.depthWeight,
                  pb.sub(3, pb.mul(this.depthWeight, 2))
                );
                this.sum = pb.add(this.sum, pb.mul(this.skinSample, this.depthWeight));
                this.weightSum = pb.add(this.weightSum, this.depthWeight);
              });
            });
            this.$if(pb.greaterThan(this.weightSum, 1e-4), function () {
              this.$l.blurredSkin = pb.div(this.sum, this.weightSum);
              this.$l.alphaDelta = pb.sub(this.blurredSkin.a, this.opacity);
              this.$l.referenceLit = pb.mul(
                this.baseColor.rgb,
                pb.add(
                  pb.vec3(pb.sub(1, this.alphaDelta)),
                  pb.mul(this.blurredSkin.rgb, pb.max(pb.sub(1, this.opacity), 0), this.colorBoost)
                )
              );
              this.result = pb.add(
                this.baseColor.rgb,
                pb.mul(pb.sub(this.referenceLit, this.baseColor.rgb), this.strength)
              );
            });
          });
          this.$if(pb.equal(this.srgbOut, 0), function () {
            this.$outputs.outColor = pb.vec4(this.result, this.baseColor.a);
          }).$else(function () {
            this.$outputs.outColor = pb.vec4(linearToGamma(this, this.result), this.baseColor.a);
          });
        });
      }
    })!;
    program.name = '@SkinSSS';
    return program;
  }
}
