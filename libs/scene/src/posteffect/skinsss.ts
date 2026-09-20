import { DEPTH_FARTHEST, Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import type { BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { ShaderHelper } from '../material';
import { SKIN_SSS_LDR_ENCODE_RANGE } from '../material/skin';
import { SubsurfaceProfile } from '../material/subsurfaceprofile';
import { linearToGamma } from '../shaders/misc';
import { fetchSampler } from '../utility/misc';
import { AbstractPostEffect, PostEffectLayer } from './posteffect';

/** Default radial-disc sample count for the Burley kernel. */
const DEFAULT_SAMPLE_COUNT = 32;

/**
 * Screen-space skin scattering — 3-pass pipeline aligned with UE5.
 *
 * @remarks
 * Pass 1 (Burley): Radial-disc Burley diffusion with Halton + inverse-CDF
 *   importance sampling, 3D bilateral distance, per-channel kernel.
 * Pass 2 (BVar): Luminance variance + depth gradient → transmission estimate.
 * Pass 3 (Recombine): Specular/diffuse separation via SceneColor.a, profile-
 *   boundary-weighted recombination, transmission overlay.
 *
 * WebGPU only.
 *
 * @public
 */
export class SkinSSS extends AbstractPostEffect {
  private static _burleyProgram: GPUProgram | null = null;
  private static _bvarProgram: GPUProgram | null = null;
  private static _recombineProgram: GPUProgram | null = null;
  private _burleyBindGroup: BindGroup | null;
  private _bvarBindGroup: BindGroup | null;
  private _recombineBindGroup: BindGroup | null;
  private _profile: SubsurfaceProfile | null;
  private _strength: number;
  private _depthScale: number;
  private _scatterRadius: number;
  private _sampleCount: number;
  private readonly _scatterTint: Vector4;
  private readonly _channelRadius: Vector3;
  private readonly _channelFalloff: Vector3;
  private readonly _radiusParams: Vector4;
  private readonly _targetSize: Vector4;
  private readonly _cameraNearFar: Vector2;

  constructor() {
    super();
    this._layer = PostEffectLayer.opaque;
    this._burleyBindGroup = null;
    this._bvarBindGroup = null;
    this._recombineBindGroup = null;
    this._profile = null;
    this._strength = 1;
    this._depthScale = 80;
    this._scatterRadius = 0.02;
    this._sampleCount = DEFAULT_SAMPLE_COUNT;
    this._scatterTint = new Vector4(1, 1, 1, 1);
    this._channelRadius = new Vector3(1, 1, 1);
    this._channelFalloff = new Vector3(1, 1, 1);
    this._radiusParams = new Vector4();
    this._targetSize = new Vector4();
    this._cameraNearFar = new Vector2();
  }

  get profile(): SubsurfaceProfile | null {
    return this._profile;
  }
  set profile(val: SubsurfaceProfile | null) {
    this._profile = val ?? null;
  }
  get strength() {
    return this._strength;
  }
  set strength(val) {
    this._strength = Math.max(0, val ?? 0);
  }
  get scatterTint(): Vector4 {
    return this._scatterTint;
  }
  set scatterTint(val: Vector4) {
    this._scatterTint.set(val);
  }
  get scatterRadius() {
    return this._scatterRadius;
  }
  set scatterRadius(val) {
    this._scatterRadius = Math.max(0, val ?? 0);
  }
  get sampleCount() {
    return this._sampleCount;
  }
  set sampleCount(val) {
    this._sampleCount = Math.max(8, Math.min(64, Math.round(val ?? DEFAULT_SAMPLE_COUNT)));
  }
  get depthScale() {
    return this._depthScale;
  }
  set depthScale(val) {
    this._depthScale = Math.max(0, val ?? 0);
  }

  requireLinearDepthTexture() {
    return true;
  }

  apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    if (!ctx.SkinSSSTexture || this._strength <= 0 || ctx.device.type !== 'webgpu') {
      this.passThrough(ctx, inputColorTexture, srgbOutput);
      return;
    }
    const device = ctx.device;
    const outputFramebuffer = device.getFramebuffer();
    const skinTex = ctx.SkinSSSTexture;
    const width = inputColorTexture.width;
    const height = inputColorTexture.height;

    const profile = this._profile ?? SubsurfaceProfile.getDefaultSkinProfile();
    const radius = profile.scatterRadius;
    const maxChannel = Math.max(radius.x, radius.y, radius.z, 1e-5);
    this._channelRadius.setXYZ(radius.x / maxChannel, radius.y / maxChannel, radius.z / maxChannel);
    const falloff = profile.falloffColor;
    this._channelFalloff.setXYZ(falloff.x, falloff.y, falloff.z);
    const projScale = 0.5 * height * ctx.camera.getProjectionMatrix().m11;
    this._radiusParams.setXYZW(
      this._scatterRadius * projScale,
      ctx.camera.isPerspective() ? 1 : 0,
      this._sampleCount,
      this._depthScale
    );
    this._targetSize.setXYZW(width, height, 1 / width, 1 / height);
    this._cameraNearFar.setXY(ctx.camera.getNearPlane(), ctx.camera.getFarPlane());
    const encodeScale = skinTex.format === 'rgba8unorm' ? SKIN_SSS_LDR_ENCODE_RANGE : 1;

    if (!SkinSSS._burleyProgram) {
      SkinSSS._burleyProgram = this.createBurleyProgram(ctx);
    }
    if (!SkinSSS._bvarProgram) {
      SkinSSS._bvarProgram = this.createBVarProgram(ctx);
    }
    if (!SkinSSS._recombineProgram) {
      SkinSSS._recombineProgram = this.createRecombineProgram(ctx);
    }

    const diffusedFB = device.pool.fetchTemporalFramebuffer(
      false,
      width,
      height,
      skinTex.format,
      null,
      false
    );
    const bvarFB = device.pool.fetchTemporalFramebuffer(false, width, height, skinTex.format, null, false);

    // --- Pass 1: Burley diffusion ---
    device.pushDeviceStates();
    try {
      if (!this._burleyBindGroup) {
        this._burleyBindGroup = device.createBindGroup(SkinSSS._burleyProgram.bindGroupLayouts[0]);
      }
      const bg = this._burleyBindGroup;
      bg.setTexture('skinTex', skinTex, fetchSampler('clamp_linear'));
      bg.setTexture('depthTex', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
      bg.setTexture('sceneTex', inputColorTexture, fetchSampler('clamp_linear'));
      bg.setValue('cameraNearFar', this._cameraNearFar);
      bg.setValue('targetSize', this._targetSize);
      bg.setValue('radiusParams', this._radiusParams);
      bg.setValue('channelRadius', this._channelRadius);
      bg.setValue('channelFalloff', this._channelFalloff);
      bg.setValue('sampleCount', this._sampleCount);
      bg.setValue('encodeScale', encodeScale);
      bg.setValue('flip', this.needFlip(device) ? 1 : 0);
      device.setProgram(SkinSSS._burleyProgram);
      device.setBindGroup(0, bg);
      device.setFramebuffer(diffusedFB);
      this.drawFullscreenQuad();
    } finally {
      device.popDeviceStates();
    }

    // --- Pass 2: BVar transmission ---
    device.pushDeviceStates();
    try {
      if (!this._bvarBindGroup) {
        this._bvarBindGroup = device.createBindGroup(SkinSSS._bvarProgram.bindGroupLayouts[0]);
      }
      const bg = this._bvarBindGroup;
      bg.setTexture(
        'diffusedTex',
        diffusedFB.getColorAttachments()[0] as Texture2D,
        fetchSampler('clamp_linear')
      );
      bg.setTexture('skinTex', skinTex, fetchSampler('clamp_linear'));
      bg.setTexture('depthTex', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
      bg.setValue('targetSize', this._targetSize);
      bg.setValue('cameraNearFar', this._cameraNearFar);
      bg.setValue('flip', this.needFlip(device) ? 1 : 0);
      device.setProgram(SkinSSS._bvarProgram);
      device.setBindGroup(0, bg);
      device.setFramebuffer(bvarFB);
      this.drawFullscreenQuad();
    } finally {
      device.popDeviceStates();
    }

    // --- Pass 3: Recombine ---
    device.setFramebuffer(outputFramebuffer);
    if (!this._recombineBindGroup) {
      this._recombineBindGroup = device.createBindGroup(SkinSSS._recombineProgram.bindGroupLayouts[0]);
    }
    const rbg = this._recombineBindGroup;
    rbg.setTexture('colorTex', inputColorTexture, fetchSampler('clamp_linear'));
    rbg.setTexture('skinTex', skinTex, fetchSampler('clamp_linear'));
    rbg.setTexture(
      'diffusedTex',
      diffusedFB.getColorAttachments()[0] as Texture2D,
      fetchSampler('clamp_linear')
    );
    rbg.setTexture('bvarTex', bvarFB.getColorAttachments()[0] as Texture2D, fetchSampler('clamp_linear'));
    rbg.setTexture('depthTex', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
    rbg.setValue('cameraNearFar', this._cameraNearFar);
    rbg.setValue('targetSize', this._targetSize);
    rbg.setValue('scatterTint', this._scatterTint);
    rbg.setValue('strength', this._strength);
    rbg.setValue('encodeScale', encodeScale);
    rbg.setValue('flip', this.needFlip(device) ? 1 : 0);
    rbg.setValue('srgbOut', srgbOutput ? 1 : 0);
    device.setProgram(SkinSSS._recombineProgram);
    device.setBindGroup(0, rbg);
    this.drawFullscreenQuad();

    device.pool.releaseFrameBuffer(diffusedFB);
    device.pool.releaseFrameBuffer(bvarFB);
  }

  private static fullscreenVertex(pb: any) {
    pb.getGlobalScope().flip = pb.int().uniform(0);
    pb.getGlobalScope().$inputs.pos = pb.vec2().attrib('position');
    pb.getGlobalScope().$outputs.uv = pb.vec2();
    pb.main(function (this: any) {
      this.$builtins.position = pb.vec4(this.$inputs.pos, DEPTH_FARTHEST, 1);
      this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
      this.$if(pb.notEqual(this.flip, 0), function (this: any) {
        this.$builtins.position.y = pb.neg(this.$builtins.position.y);
      });
    });
  }

  private createBurleyProgram(ctx: DrawContext) {
    const program = ctx.device.buildRenderProgram({
      vertex(pb) {
        SkinSSS.fullscreenVertex(pb);
      },
      fragment(pb) {
        this.skinTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.sceneTex = pb.tex2D().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.radiusParams = pb.vec4().uniform(0);
        this.channelRadius = pb.vec3().uniform(0);
        this.channelFalloff = pb.vec3().uniform(0);
        this.sampleCount = pb.int().uniform(0);
        this.encodeScale = pb.float().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.func('readDepth01', [pb.vec2('uv')], function () {
          this.$return(ShaderHelper.sampleLinearDepth(this, this.depthTex, this.uv, 0));
        });
        pb.func('burleyW', [pb.float('r'), pb.float('d')], function () {
          this.$l.safeD = pb.max(this.d, 1e-4);
          this.$l.rd = pb.div(this.r, this.safeD);
          this.$l.e1 = pb.exp(pb.neg(pb.min(this.rd, 40)));
          this.$l.e2 = pb.exp(pb.neg(pb.min(pb.div(this.rd, 3), 40)));
          this.$return(pb.div(pb.add(this.e1, this.e2), this.safeD));
        });
        pb.main(function () {
          this.$l.uv = this.$inputs.uv;
          this.$l.center = pb.textureSampleLevel(this.skinTex, this.uv, 0);
          this.$l.centerDepth01 = this.readDepth01(this.uv);
          this.$outputs.outColor = this.center;
          this.$if(
            pb.and(pb.lessThan(this.centerDepth01, 1), pb.greaterThan(this.center.a, 1e-4)),
            function () {
              this.$l.centerDepth = pb.max(pb.mul(this.centerDepth01, this.cameraNearFar.y), 1e-4);
              this.$l.shape = pb.vec3(
                pb.mix(0.72, 1.46, pb.clamp(this.channelFalloff.x, 0.05, 1)),
                pb.mix(0.72, 1.46, pb.clamp(this.channelFalloff.y, 0.05, 1)),
                pb.mix(0.72, 1.46, pb.clamp(this.channelFalloff.z, 0.05, 1))
              );
              this.$l.viewScale = pb.max(pb.mix(pb.float(1), this.centerDepth, this.radiusParams.y), 1e-4);
              this.$l.radiusPx = pb.div(pb.mul(this.channelRadius, this.radiusParams.x), this.viewScale);
              this.$l.maxRadiusPx = pb.max(pb.max(this.radiusPx.x, this.radiusPx.y), this.radiusPx.z);
              // Normalized shaping distance per channel (dimensionless, ~0.7-1.5)
              this.$l.shape = pb.vec3(
                pb.mix(0.72, 1.46, pb.clamp(this.channelFalloff.x, 0.05, 1)),
                pb.mix(0.72, 1.46, pb.clamp(this.channelFalloff.y, 0.05, 1)),
                pb.mix(0.72, 1.46, pb.clamp(this.channelFalloff.z, 0.05, 1))
              );
              // CDF at average radius for importance sampling range
              // avgR is in normalized units (fraction of maxRadiusPx)
              this.$l.avgR = pb.float(0.3);
              this.$l.cdf0 = pb.sub(
                1,
                pb.add(
                  pb.mul(0.25, pb.exp(pb.neg(pb.div(this.avgR, pb.max(this.shape.x, 1e-4))))),
                  pb.mul(0.75, pb.exp(pb.neg(pb.div(this.avgR, pb.mul(pb.max(this.shape.x, 1e-4), 3)))))
                )
              );
              this.$l.sampleRange = pb.sub(1, this.cdf0);
              this.$l.jitter = pb.fract(pb.mul(pb.dot(this.uv, pb.vec2(12.9898, 78.233)), 43758.5453));
              this.$l.sumColor = pb.vec3(0);
              this.$l.sumWeight = pb.vec3(0);
              this.$l.coverage = pb.float(0);
              this.$l.coverageWeight = pb.float(0);
              this.$for(pb.int('i'), 0, DEFAULT_SAMPLE_COUNT, function () {
                this.$l.fi = pb.add(pb.float(this.i), this.jitter);
                this.$l.xi_r = pb.fract(pb.mul(this.fi, 0.754878));
                this.$l.xi_theta = pb.fract(pb.mul(this.fi, 0.56984));
                this.$l.xi_mapped = pb.add(pb.mul(this.xi_r, this.sampleRange), this.cdf0);
                // UE5 inverse CDF in normalized space (shape.x ~ 1.0)
                this.$l.invShape = pb.div(
                  pb.add(pb.mul(this.xi_mapped, -0.6), -2.0),
                  pb.max(this.shape.x, 1e-4)
                );
                this.$l.rNorm = pb.mul(
                  pb.log(pb.max(pb.sub(1, this.xi_mapped), 1e-6)),
                  pb.mul(this.invShape, 0.693147)
                );
                this.rNorm = pb.max(this.rNorm, 1e-5);
                // Convert normalized distance to pixels
                this.$l.rPx = pb.mul(this.rNorm, this.maxRadiusPx);
                this.$l.angle = pb.mul(this.xi_theta, 2 * Math.PI);
                // PDF in normalized space (must match the sampling distribution)
                this.$l.pdf = pb.mul(
                  pb.div(
                    pb.add(
                      pb.exp(pb.neg(pb.div(this.rNorm, pb.max(this.shape.x, 1e-4)))),
                      pb.exp(pb.neg(pb.div(this.rNorm, pb.mul(pb.max(this.shape.x, 1e-4), 3))))
                    ),
                    pb.max(this.shape.x, 1e-4)
                  ),
                  0.25
                );
                this.pdf = pb.max(this.pdf, 1e-8);
                // Screen-space offset
                this.$l.offset = pb.mul(
                  pb.vec2(pb.cos(this.angle), pb.sin(this.angle)),
                  this.rPx,
                  this.targetSize.zw
                );
                this.$l.sampleUV = pb.clamp(pb.add(this.uv, this.offset), pb.vec2(0), pb.vec2(1));
                this.$l.tapSample = pb.textureSampleLevel(this.skinTex, this.sampleUV, 0);
                this.$l.sampleDepth01 = this.readDepth01(this.sampleUV);
                this.$l.sampleDepth = pb.max(pb.mul(this.sampleDepth01, this.cameraNearFar.y), 1e-4);
                this.$l.depthDiff = pb.mul(
                  pb.div(pb.abs(pb.sub(this.centerDepth, this.sampleDepth)), this.centerDepth),
                  this.radiusParams.w
                );
                // Depth distance in normalized units (relative to maxRadiusPx)
                this.$l.depthNorm = pb.div(this.depthDiff, pb.max(this.maxRadiusPx, 1));
                // 3D combined distance in normalized space
                this.$l.combinedDist = pb.sqrt(
                  pb.add(pb.mul(this.rNorm, this.rNorm), pb.mul(this.depthNorm, this.depthNorm))
                );
                // Per-channel Burley kernel in normalized space / PDF
                this.$l.w = pb.vec3(
                  pb.div(this.burleyW(this.combinedDist, pb.mul(this.shape.x, this.channelRadius.x)), this.pdf),
                  pb.div(this.burleyW(this.combinedDist, pb.mul(this.shape.y, this.channelRadius.y)), this.pdf),
                  pb.div(this.burleyW(this.combinedDist, pb.mul(this.shape.z, this.channelRadius.z)), this.pdf)
                );
                this.$l.isSkin = pb.float(pb.greaterThan(this.tapSample.a, 1e-4));
                this.$l.tapWeight = pb.mul(this.w, this.isSkin);
                this.sumColor = pb.add(this.sumColor, pb.mul(this.tapSample.rgb, this.tapWeight));
                this.sumWeight = pb.add(this.sumWeight, this.tapWeight);
                this.coverage = pb.add(this.coverage, pb.mul(this.tapWeight.x, this.tapSample.a));
                this.coverageWeight = pb.add(this.coverageWeight, this.tapWeight.x);
              });
              this.$l.diffused = pb.div(this.sumColor, pb.max(this.sumWeight, pb.vec3(1e-6)));
              this.$l.maskOpacity = pb.clamp(pb.mul(pb.sub(this.center.a, 0.1), 10), 0, 1);
              this.$l.blended = pb.mix(this.center.rgb, this.diffused, this.maskOpacity);
              this.$outputs.outColor = pb.vec4(
                this.blended,
                pb.div(this.coverage, pb.max(this.coverageWeight, 1e-6))
              );
            }
          );
        });
      }
    })!;
    program.name = '@SkinSSSBurley';
    return program;
  }

  private createBVarProgram(ctx: DrawContext) {
    // UE5's BVar pass computes transmission from temporal reprojection +
    // shadow map sampling. Without a velocity buffer and shadow map access
    // in the SSS post-effect, it outputs zero transmission — matching UE5's
    // behavior when those inputs are unavailable. For now this is a simple
    // passthrough; transmission comes from the material's back-lit term
    // (transmissionStrength × thickness from subsurfaceTexture.b).
    const program = ctx.device.buildRenderProgram({
      vertex(pb) {
        SkinSSS.fullscreenVertex(pb);
      },
      fragment(pb) {
        this.diffusedTex = pb.tex2D().uniform(0);
        this.skinTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.main(function () {
          this.$l.diffused = pb.textureSampleLevel(this.diffusedTex, this.$inputs.uv, 0);
          // transmission = 0 (no velocity buffer / shadow map available)
          this.$outputs.outColor = pb.vec4(this.diffused.rgb, 0);
        });
      }
    })!;
    program.name = '@SkinSSSBVar';
    return program;
  }

  private createRecombineProgram(ctx: DrawContext) {
    const program = ctx.device.buildRenderProgram({
      vertex(pb) {
        SkinSSS.fullscreenVertex(pb);
      },
      fragment(pb) {
        this.colorTex = pb.tex2D().uniform(0);
        this.skinTex = pb.tex2D().uniform(0);
        this.diffusedTex = pb.tex2D().uniform(0);
        this.bvarTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.scatterTint = pb.vec4().uniform(0);
        this.strength = pb.float().uniform(0);
        this.encodeScale = pb.float().uniform(0);
        this.srgbOut = pb.int().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.func('readDepth01', [pb.vec2('uv')], function () {
          this.$return(ShaderHelper.sampleLinearDepth(this, this.depthTex, this.uv, 0));
        });
        pb.main(function () {
          this.$l.uv = this.$inputs.uv;
          this.$l.baseColor = pb.textureSampleLevel(this.colorTex, this.uv, 0);
          this.$l.result = this.baseColor.rgb;
          this.$l.centerSkin = pb.textureSampleLevel(this.skinTex, this.uv, 0);
          this.$l.centerDepth01 = this.readDepth01(this.uv);
          this.$if(
            pb.and(pb.lessThan(this.centerDepth01, 1), pb.greaterThan(this.centerSkin.a, 1e-4)),
            function () {
              this.$l.bvarData = pb.textureSampleLevel(this.bvarTex, this.uv, 0);
              this.$l.blurredRaw = this.bvarData.rgb;
              this.$l.transmission = this.bvarData.a;
              this.$l.diffused = pb.mul(this.blurredRaw, this.encodeScale);
              this.$l.original = pb.mul(this.centerSkin.rgb, this.encodeScale);
              // Forward pipeline: side buffer = diffusible only (not full SceneColor).
              // Recombine = replace original diffusible with blurred diffusible.
              //   sceneColor = specular + original_diffusible
              //   result     = specular + blurred_diffusible
              //            = sceneColor - original + diffused
              this.$l.redistributed = pb.mul(
                pb.sub(this.diffused, this.original),
                this.scatterTint.rgb
              );
              this.result = pb.add(this.baseColor.rgb, pb.mul(this.redistributed, this.strength));
              // Transmission overlay
              this.$if(pb.greaterThan(this.transmission, 0.001), function () {
                this.result = pb.add(
                  this.result,
                  pb.mul(this.diffused, this.scatterTint.rgb, this.transmission, this.scatterTint.a, 0.5)
                );
              });
              this.result = pb.max(this.result, pb.vec3(0));
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
    program.name = '@SkinSSSRecombine';
    return program;
  }
}
