import { DEPTH_FARTHEST, Vector2, Vector4 } from '@zephyr3d/base';
import type { BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { ShaderHelper } from '../material';
import { SKIN_SSS_LDR_ENCODE_RANGE } from '../material/skin';
import { linearToGamma } from '../shaders/misc';
import { fetchSampler } from '../utility/misc';
import { AbstractPostEffect, PostEffectLayer } from './posteffect';

/**
 * Stylized screen-space skin scattering pass.
 *
 * @remarks
 * This is intentionally separate from the profile-based {@link SSS} pass. It follows the simpler
 * depth-aware blur used by many character renderers: a skin material writes an additive scatter
 * irradiance term into a side buffer, then this pass performs a fixed 9x9 depth-aware blur and
 * adds the blurred term back over the opaque color. Because the composite is additive, scattered
 * light bleeds into regions where the base lighting is dark (the far side of the terminator).
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
  private _scatterRadius: number;
  private _smoothness: number;

  constructor() {
    super();
    this._layer = PostEffectLayer.opaque;
    this._bindGroup = null;
    this._strength = 1;
    this._opacity = 0.18;
    this._sampleStep = 2;
    this._depthScale = 80;
    this._colorBoost = 1;
    this._scatterRadius = 0.02;
    this._smoothness = 0;
  }

  /** Final blend strength. */
  get strength() {
    return this._strength;
  }
  set strength(val) {
    this._strength = Math.max(0, val ?? 0);
  }

  /** Skin mask coverage threshold. Scattering fades in as the blurred mask coverage exceeds this. */
  get opacity() {
    return this._opacity;
  }
  set opacity(val) {
    this._opacity = Math.max(0, Math.min(1, val ?? 0));
  }

  /** Maximum pixel spacing between blur taps. Caps the projected scatter radius for close-ups. */
  get sampleStep() {
    return this._sampleStep;
  }
  set sampleStep(val) {
    this._sampleStep = Math.max(0.25, val ?? 0.25);
  }

  /** World-space scatter radius. The blur width shrinks with distance to keep this constant. */
  get scatterRadius() {
    return this._scatterRadius;
  }
  set scatterRadius(val) {
    this._scatterRadius = Math.max(0, val ?? 0);
  }

  /**
   * Skin smoothing amount ("beauty filter"). Blends the lit color toward a
   * mask- and depth-weighted blur of itself on skin pixels, removing pores and
   * shading noise while facial features stay sharp wherever the skin mask
   * excludes them (eyes, brows, lips). 0 disables smoothing.
   */
  get smoothness() {
    return this._smoothness;
  }
  set smoothness(val) {
    this._smoothness = Math.max(0, Math.min(1, val ?? 0));
  }

  /** Depth rejection scale. The reference shader uses 80. */
  get depthScale() {
    return this._depthScale;
  }
  set depthScale(val) {
    this._depthScale = Math.max(0, val ?? 0);
  }

  /** Multiplier applied to the blurred scatter irradiance before compositing. */
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
    // Pixels per world unit (at unit view depth for perspective cameras). The
    // shader divides by the view depth so the blur footprint stays a constant
    // world-space radius; the kernel reaches 4 taps from the center.
    const projScale = 0.5 * inputColorTexture.height * ctx.camera.getProjectionMatrix().m11;
    this._bindGroup.setValue(
      'radiusParams',
      new Vector2((this._scatterRadius * projScale) / 4, ctx.camera.isPerspective() ? 1 : 0)
    );
    this._bindGroup.setValue('depthScale', this._depthScale);
    this._bindGroup.setValue('colorBoost', this._colorBoost);
    this._bindGroup.setValue(
      'encodeScale',
      ctx.SkinSSSTexture.format === 'rgba8unorm' ? SKIN_SSS_LDR_ENCODE_RANGE : 1
    );
    this._bindGroup.setValue('smoothness', this._smoothness);
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
          this.$builtins.position = pb.vec4(this.$inputs.pos, DEPTH_FARTHEST, 1);
          this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
          this.$if(pb.notEqual(this.flip, 0), function () {
            this.$builtins.position.y = pb.neg(this.$builtins.position.y);
          });
        });
      },
      fragment(pb) {
        this.colorTex = pb.tex2D().uniform(0);
        this.skinTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.strength = pb.float().uniform(0);
        this.opacity = pb.float().uniform(0);
        this.sampleStep = pb.float().uniform(0);
        this.radiusParams = pb.vec2().uniform(0);
        this.depthScale = pb.float().uniform(0);
        this.colorBoost = pb.float().uniform(0);
        this.encodeScale = pb.float().uniform(0);
        this.smoothness = pb.float().uniform(0);
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
          // Early out on non-skin pixels: scattering is additive irradiance
          // masked by skin coverage, so pixels with no skin coverage never
          // receive a contribution. This skips the 9x9 blur for most of the
          // screen and keeps neighboring non-skin surfaces (collars, hair)
          // free of skin tint.
          this.$l.centerSkin = pb.textureSampleLevel(this.skinTex, this.uv, 0);
          this.$if(
            pb.and(pb.lessThan(this.centerDepth01, 1), pb.greaterThan(this.centerSkin.a, 1e-4)),
            function () {
              this.$l.centerDepth = pb.max(pb.mul(this.centerDepth01, this.cameraNearFar.y), 1e-4);
              // Project the world-space scatter radius to a per-pixel tap
              // spacing (radiusParams.y is 1 for perspective cameras, 0 for
              // orthographic). sampleStep caps the spacing for close-ups.
              this.$l.stepPx = pb.clamp(
                pb.div(
                  this.radiusParams.x,
                  pb.max(pb.mix(pb.float(1), this.centerDepth, this.radiusParams.y), 1e-4)
                ),
                0,
                this.sampleStep
              );
              this.$l.sum = pb.vec4(0);
              this.$l.weightSum = pb.float(0);
              this.$l.colorSum = pb.vec3(0);
              this.$l.colorWeightSum = pb.float(0);
              this.$for(pb.int('y'), -4, 5, function () {
                this.$for(pb.int('x'), -4, 5, function () {
                  this.$l.fx = pb.float(this.x);
                  this.$l.fy = pb.float(this.y);
                  this.$l.offsetPx = pb.mul(pb.vec2(this.fx, this.fy), this.stepPx);
                  this.$l.sampleUV = pb.clamp(
                    pb.add(this.uv, pb.div(this.offsetPx, this.targetSize.xy)),
                    pb.vec2(0),
                    pb.vec2(1)
                  );
                  this.$l.skinSample = pb.textureSampleLevel(this.skinTex, this.sampleUV, 0);
                  // Non-skin pixels contribute nothing; their zero alpha also
                  // lowers the coverage used to gate the composite below.
                  this.$if(pb.lessThanEqual(this.skinSample.a, 1e-4), function () {
                    this.skinSample = pb.vec4(0);
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
                  // Gaussian falloff (sigma = 2 taps) removes the boxy look of
                  // uniformly weighted samples.
                  this.$l.spatialWeight = pb.exp(
                    pb.mul(pb.add(pb.mul(this.fx, this.fx), pb.mul(this.fy, this.fy)), -0.125)
                  );
                  this.$l.tapWeight = pb.mul(this.depthWeight, this.spatialWeight);
                  this.sum = pb.add(this.sum, pb.mul(this.skinSample, this.tapWeight));
                  this.weightSum = pb.add(this.weightSum, this.tapWeight);
                  // Skin smoothing accumulates the lit color with the sample
                  // mask as an extra edge stop, so eyes/brows/lips (mask 0)
                  // never bleed onto the skin. Uniform branch: costs nothing
                  // when smoothing is disabled.
                  this.$if(pb.greaterThan(this.smoothness, 0), function () {
                    this.$l.colorWeight = pb.mul(this.tapWeight, this.skinSample.a);
                    this.$l.colorSample = pb.textureSampleLevel(this.colorTex, this.sampleUV, 0);
                    this.colorSum = pb.add(this.colorSum, pb.mul(this.colorSample.rgb, this.colorWeight));
                    this.colorWeightSum = pb.add(this.colorWeightSum, this.colorWeight);
                  });
                });
              });
              this.$if(pb.greaterThan(this.weightSum, 1e-4), function () {
                this.$l.blurredSkin = pb.div(this.sum, this.weightSum);
                // Additive composite: the blurred scatter irradiance is added on
                // top of the base lighting so light bleeds into dark regions.
                // Coverage gating keeps nearby non-skin pixels (collars, hair)
                // from being tinted by neighboring skin samples.
                this.$l.coverage = pb.smoothStep(
                  this.opacity,
                  pb.add(this.opacity, 0.35),
                  this.blurredSkin.a
                );
                // Skin smoothing: blend toward the mask-weighted blurred color
                // before adding the scatter term.
                this.$l.smoothedBase = this.baseColor.rgb;
                this.$if(pb.greaterThan(this.colorWeightSum, 1e-4), function () {
                  this.smoothedBase = pb.mix(
                    this.baseColor.rgb,
                    pb.div(this.colorSum, this.colorWeightSum),
                    pb.mul(this.smoothness, this.coverage, this.centerSkin.a)
                  );
                });
                this.result = pb.add(
                  this.smoothedBase,
                  pb.mul(
                    this.blurredSkin.rgb,
                    this.encodeScale,
                    this.colorBoost,
                    this.coverage,
                    this.strength
                  )
                );
              });
            }
          );
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
