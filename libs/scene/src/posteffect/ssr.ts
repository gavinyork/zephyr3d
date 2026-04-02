import { AbstractPostEffect, PostEffectLayer } from './posteffect';
import { linearToGamma } from '../shaders/misc';
import type { BindGroup, FrameBuffer, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { screenSpaceRayTracing_HiZ, screenSpaceRayTracing_Linear2D, SSR_calcJitter } from '../shaders/ssr';
import { temporalResolve } from '../shaders/temporal';
import type { Nullable } from '@zephyr3d/base';
import { Matrix4x4, Vector2, Vector4 } from '@zephyr3d/base';
import { copyTexture, fetchSampler } from '../utility/misc';
import { BilateralBlurBlitter } from '../blitter/bilateralblur';
import { ShaderHelper } from '../material';

/**
 * SSR post effect
 *
 * @remarks
 * Internal used in light pass
 *
 * @internal
 */
export class SSR extends AbstractPostEffect {
  private static readonly _sdfMaxBoxes = 24;
  private static _programs: Record<string, GPUProgram> = {};
  private static _resolveProgram: Record<string, GPUProgram> = {};
  private static _combineProgram?: GPUProgram;
  private static _temporalProgram?: GPUProgram;
  private static _blurBlitterH: Nullable<BilateralBlurBlitter> = null;
  private static _blurBlitterV: Nullable<BilateralBlurBlitter> = null;
  private _bindgroups: Record<string, BindGroup>;
  private _resolveBindGroup: Record<string, BindGroup>;
  private _combineBindGroup: Nullable<BindGroup>;
  private _temporalBindGroup: Nullable<BindGroup>;
  /**
   * Creates an instance of SSR post effect
   */
  constructor() {
    super();
    this._layer = PostEffectLayer.opaque;
    this._bindgroups = {};
    this._resolveBindGroup = {};
    this._combineBindGroup = null;
    this._temporalBindGroup = null;
  }
  /** {@inheritDoc AbstractPostEffect.requireLinearDepthTexture} */
  requireLinearDepthTexture() {
    return true;
  }
  /** {@inheritDoc AbstractPostEffect.requireDepthAttachment} */
  requireDepthAttachment() {
    return true;
  }
  /** @internal */
  blurPass(
    ctx: DrawContext,
    blitter: BilateralBlurBlitter,
    blurSizeTex: Texture2D,
    blurSizeIndex: number,
    blurSizeScale: number,
    kernelRadius: number,
    stdDev: number,
    depthCutoff: number,
    fbFrom: FrameBuffer,
    fbTo: FrameBuffer
  ) {
    const size = new Vector2(fbFrom.getWidth(), fbFrom.getHeight());
    blitter.kernelRadius = kernelRadius;
    blitter.stdDev = stdDev;
    blitter.size = size;
    blitter.depthTex = ctx.linearDepthTexture ?? null;
    blitter.depthCutoff = depthCutoff;
    blitter.blurSizeTex = blurSizeTex;
    blitter.blurSizeIndex = blurSizeIndex;
    blitter.blurSizeScale = blurSizeScale;
    blitter.sampler = fetchSampler('clamp_nearest_nomip');
    blitter.cameraNearFar.setXY(ctx.camera.getNearPlane(), ctx.camera.getFarPlane());
    blitter.srgbOut = false;
    blitter.blit(fbFrom.getColorAttachments()[0] as Texture2D, fbTo, fetchSampler('clamp_linear_nomip'));
  }
  /** @internal */
  combine(ctx: DrawContext, inputColorTexture: Texture2D, reflectanceTex: Texture2D, srgbOut: boolean) {
    const device = ctx.device;
    let program = SSR._combineProgram;
    if (program === undefined) {
      program = this._createCombineProgrm(ctx);
      SSR._combineProgram = program;
    }
    if (!this._combineBindGroup) {
      this._combineBindGroup = device.createBindGroup(program!.bindGroupLayouts[0]);
    }
    const linearSampler = fetchSampler('clamp_linear');
    this._combineBindGroup.setTexture('colorTex', inputColorTexture, linearSampler);
    this._combineBindGroup.setTexture('reflectanceTex', reflectanceTex, linearSampler);
    this._combineBindGroup.setTexture('roughnessTex', ctx.SSRRoughnessTexture, linearSampler);
    this._combineBindGroup.setValue('ssrMaxRoughness', ctx.camera.ssrMaxRoughness);
    this._combineBindGroup.setValue('ssrStrengthMode', ctx.camera.renderPath === 'forward' ? 0 : 1);
    this._combineBindGroup.setValue(
      'targetSize',
      new Vector4(
        inputColorTexture.width,
        inputColorTexture.height,
        inputColorTexture.width,
        inputColorTexture.height
      )
    );
    this._combineBindGroup.setValue('flip', this.needFlip(device) ? 1 : 0);
    this._combineBindGroup.setValue('srgbOut', srgbOut ? 1 : 0);
    device.setProgram(program);
    device.setBindGroup(0, this._combineBindGroup);
    this.drawFullscreenQuad(AbstractPostEffect.getDefaultRenderState(ctx, 'gt'));
  }
  /** @internal */
  resolve(
    ctx: DrawContext,
    inputColorTexture: Texture2D,
    sceneDepthTexture: Texture2D,
    intersectTexture: Texture2D
  ) {
    const device = ctx.device;
    const hash = ctx.env!.light.envLight ? ctx.env!.light.getHash() : '';
    let program = SSR._resolveProgram[hash];
    if (program === undefined) {
      program = this._createResolveProgram(ctx);
      SSR._resolveProgram[hash] = program;
    }
    let bindGroup = this._resolveBindGroup[hash];
    if (!bindGroup) {
      bindGroup = device.createBindGroup(program.bindGroupLayouts[0]);
      this._resolveBindGroup[hash] = bindGroup;
    }
    const nearestSampler = fetchSampler('clamp_nearest');
    const linearSampler = fetchSampler('clamp_linear');
    bindGroup.setTexture('colorTex', inputColorTexture, linearSampler);
    bindGroup.setTexture('intersectTex', intersectTexture, nearestSampler);
    bindGroup.setTexture('roughnessTex', ctx.SSRRoughnessTexture, nearestSampler);
    bindGroup.setTexture('normalTex', ctx.SSRNormalTexture, nearestSampler);
    bindGroup.setTexture('depthTex', sceneDepthTexture, nearestSampler);
    bindGroup.setValue('ssrMaxRoughness', ctx.camera.ssrMaxRoughness);
    bindGroup.setValue('ssrStrengthMode', ctx.camera.renderPath === 'forward' ? 0 : 1);
    bindGroup.setValue('cameraNearFar', new Vector2(ctx.camera.getNearPlane(), ctx.camera.getFarPlane()));
    bindGroup.setValue(
      'targetSize',
      new Vector4(
        inputColorTexture.width,
        inputColorTexture.height,
        sceneDepthTexture.width,
        sceneDepthTexture.height
      )
    );
    bindGroup.setValue('invProjMatrix', Matrix4x4.invert(ctx.camera.getProjectionMatrix()));
    bindGroup.setValue('viewMatrix', ctx.camera.viewMatrix);
    bindGroup.setValue('invViewMatrix', ctx.camera.worldMatrix);
    if (ctx.env!.light.envLight) {
      bindGroup.setValue('envLightStrength', ctx.env!.light.strength);
      ctx.env!.light.envLight.updateBindGroup(bindGroup);
    }
    bindGroup.setValue('flip', this.needFlip(device) ? 1 : 0);
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    this.drawFullscreenQuad(AbstractPostEffect.getDefaultRenderState(ctx, 'gt'));
  }
  /** @internal */
  intersect(
    ctx: DrawContext,
    inputColorTexture: Texture2D,
    sceneDepthTexture: Texture2D,
    blur: boolean,
    srgbOut: boolean
  ) {
    const device = ctx.device;
    const hash = `${Number(blur)}:${
      ctx.env!.light.envLight ? ctx.env!.light.getHash() : ''
    }:${!!ctx.HiZTexture}:${!!ctx.camera.ssrCalcThickness}`;
    let program = SSR._programs[hash];
    if (program === undefined) {
      program = this._createIntersectProgram(ctx, blur);
      SSR._programs[hash] = program;
    }
    let bindGroup = this._bindgroups[hash];
    if (!bindGroup) {
      bindGroup = device.createBindGroup(program.bindGroupLayouts[0]);
      this._bindgroups[hash] = bindGroup;
    }
    const nearestSampler = fetchSampler('clamp_nearest');
    const linearSampler = fetchSampler('clamp_linear');
    if (!blur) {
      bindGroup.setTexture('colorTex', inputColorTexture, linearSampler);
      if (ctx.env!.light.envLight) {
        bindGroup.setValue('envLightStrength', ctx.env!.light.strength);
        ctx.env!.light.envLight.updateBindGroup(bindGroup);
      }
    }
    bindGroup.setTexture('roughnessTex', ctx.SSRRoughnessTexture, nearestSampler);
    bindGroup.setTexture('normalTex', ctx.SSRNormalTexture, nearestSampler);
    bindGroup.setTexture('depthTex', sceneDepthTexture, nearestSampler);
    bindGroup.setValue('cameraNearFar', new Vector2(ctx.camera.getNearPlane(), ctx.camera.getFarPlane()));
    bindGroup.setValue('cameraPos', ctx.camera.getWorldPosition());
    bindGroup.setValue('invProjMatrix', Matrix4x4.invert(ctx.camera.getProjectionMatrix()));
    bindGroup.setValue('projMatrix', ctx.camera.getProjectionMatrix());
    bindGroup.setValue('viewMatrix', ctx.camera.viewMatrix);
    bindGroup.setValue('invViewMatrix', ctx.camera.worldMatrix);
    bindGroup.setValue('ssrParams', ctx.camera.ssrParams);
    bindGroup.setValue('ssrMaxRoughness', ctx.camera.ssrMaxRoughness);
    bindGroup.setValue('ssrStrengthMode', ctx.camera.renderPath === 'forward' ? 0 : 1);
    if (ctx.HiZTexture) {
      bindGroup.setTexture('hizTex', ctx.HiZTexture, nearestSampler);
      bindGroup.setValue('depthMipLevels', ctx.HiZTexture.mipLevelCount);
      bindGroup.setValue('ssrHiZFallback', ctx.camera.ssrHiZFallback ? 1 : 0);
      bindGroup.setValue('ssrHiZFallbackSteps', ctx.camera.ssrHiZFallbackSteps);
      bindGroup.setValue('ssrHiZFallbackStride', ctx.camera.ssrHiZFallbackStride);
      bindGroup.setValue('ssrSDFBoxCount', ctx.ssrSDFBoxCount ?? 0);
      if (ctx.ssrSDFBoxBuffer) {
        bindGroup.setBuffer('zSDFBoxes', ctx.ssrSDFBoxBuffer);
      }
      bindGroup.setValue(
        'targetSize',
        new Vector4(
          sceneDepthTexture.width,
          sceneDepthTexture.height,
          ctx.HiZTexture.width,
          ctx.HiZTexture.height
        )
      );
    } else {
      bindGroup.setValue('ssrStride', ctx.camera.ssrStride);
      bindGroup.setValue(
        'targetSize',
        new Vector4(
          sceneDepthTexture.width,
          sceneDepthTexture.height,
          sceneDepthTexture.width,
          sceneDepthTexture.height
        )
      );
    }
    bindGroup.setValue('flip', this.needFlip(device) ? 1 : 0);
    bindGroup.setValue('srgbOut', srgbOut ? 1 : 0);
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    this.drawFullscreenQuad(AbstractPostEffect.getDefaultRenderState(ctx, 'gt'));
  }
  /** @internal */
  temporal(
    ctx: DrawContext,
    currentReflectTex: Texture2D,
    sceneDepthTexture: Texture2D,
    prevReflectTex: Texture2D,
    prevMotionVectorTex: Texture2D,
    outFramebuffer: FrameBuffer
  ) {
    const device = ctx.device;
    let program = SSR._temporalProgram;
    if (!program) {
      program = this._createTemporalProgram(ctx);
      SSR._temporalProgram = program;
    }
    if (!this._temporalBindGroup) {
      this._temporalBindGroup = device.createBindGroup(program.bindGroupLayouts[0]);
    }
    this._temporalBindGroup.setTexture('historyColorTex', prevReflectTex, fetchSampler('clamp_linear_nomip'));
    this._temporalBindGroup.setTexture('currentColorTex', currentReflectTex, fetchSampler('clamp_nearest_nomip'));
    this._temporalBindGroup.setTexture('currentDepthTex', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
    this._temporalBindGroup.setTexture(
      'motionVector',
      ctx.motionVectorTexture!,
      fetchSampler('clamp_nearest_nomip')
    );
    this._temporalBindGroup.setTexture('prevMotionVector', prevMotionVectorTex, fetchSampler('clamp_nearest_nomip'));
    this._temporalBindGroup.setValue('flip', this.needFlip(device) ? 1 : 0);
    this._temporalBindGroup.setValue('texSize', new Vector2(sceneDepthTexture.width, sceneDepthTexture.height));
    this._temporalBindGroup.setValue('temporalWeight', ctx.camera.ssrTemporalWeight);
    device.setFramebuffer(outFramebuffer);
    device.setProgram(program);
    device.setBindGroup(0, this._temporalBindGroup);
    this.drawFullscreenQuad(AbstractPostEffect.getDefaultRenderState(ctx, 'gt'));
  }
  /** {@inheritDoc AbstractPostEffect.apply} */
  apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    const device = ctx.device;
    device.pushDeviceStates();
    copyTexture(
      inputColorTexture,
      device.getFramebuffer()!,
      fetchSampler('clamp_nearest_nomip'),
      AbstractPostEffect.getDefaultRenderState(ctx, 'eq')
    );

    const intersectFramebuffer = device.pool.fetchTemporalFramebuffer(
      false,
      inputColorTexture.width,
      inputColorTexture.height,
      'rgba16f',
      ctx.depthTexture,
      false
    );
    const pingpongFramebuffer = [
      device.pool.fetchTemporalFramebuffer(
        false,
        inputColorTexture.width,
        inputColorTexture.height,
        'rgba16f',
        ctx.depthTexture,
        false
      ),
      device.pool.fetchTemporalFramebuffer(
        false,
        inputColorTexture.width,
        inputColorTexture.height,
        'rgba16f',
        ctx.depthTexture,
        false
      )
    ];
    device.setFramebuffer(intersectFramebuffer);
    this.intersect(ctx, inputColorTexture, sceneDepthTexture, true, false);
    const intersectTex = intersectFramebuffer.getColorAttachments()[0] as Texture2D;
    device.setFramebuffer(pingpongFramebuffer[0]);
    const ssrSceneColorTexture = ctx.sceneColorTexture ?? inputColorTexture;
    this.resolve(ctx, ssrSceneColorTexture, sceneDepthTexture, intersectTex);
    if (ctx.camera.ssrBlurScale > 0 && ctx.camera.ssrBlurKernelSize > 0) {
      const blurSizeScale = 255 * ctx.camera.ssrBlurScale;
      const kernelRadius = (Math.max(1, ctx.camera.ssrBlurKernelSize >> 0) - 1) >> 1;
      const stdDev = ctx.camera.ssrBlurStdDev;
      const depthCutoff = ctx.camera.ssrBlurDepthCutoff;
      const blitterH = (SSR._blurBlitterH = SSR._blurBlitterH ?? new BilateralBlurBlitter(false));
      blitterH.renderStates = AbstractPostEffect.getDefaultRenderState(ctx, 'gt');
      this.blurPass(
        ctx,
        blitterH,
        intersectTex,
        2,
        blurSizeScale,
        kernelRadius,
        stdDev,
        depthCutoff,
        pingpongFramebuffer[0],
        pingpongFramebuffer[1]
      );
      const blitterV = (SSR._blurBlitterV = SSR._blurBlitterV ?? new BilateralBlurBlitter(true));
      blitterV.renderStates = AbstractPostEffect.getDefaultRenderState(ctx, 'gt');
      this.blurPass(
        ctx,
        blitterV,
        intersectTex,
        2,
        blurSizeScale,
        kernelRadius,
        stdDev,
        depthCutoff,
        pingpongFramebuffer[1],
        pingpongFramebuffer[0]
      );
    }
    const history = ctx.camera.getHistoryData();
    let reflectanceTex = pingpongFramebuffer[0].getColorAttachments()[0] as Texture2D;
    const canTemporal =
      ctx.camera.ssrTemporal &&
      !!ctx.motionVectorTexture &&
      !!history.prevSSRReflectTex &&
      !!history.prevSSRMotionVectorTex &&
      history.prevSSRReflectTex.width === reflectanceTex.width &&
      history.prevSSRReflectTex.height === reflectanceTex.height;
    if (canTemporal) {
      this.temporal(
        ctx,
        reflectanceTex,
        sceneDepthTexture,
        history.prevSSRReflectTex as Texture2D,
        history.prevSSRMotionVectorTex as Texture2D,
        pingpongFramebuffer[1]
      );
      reflectanceTex = pingpongFramebuffer[1].getColorAttachments()[0] as Texture2D;
    }
    device.popDeviceStates();
    this.combine(ctx, inputColorTexture, reflectanceTex, srgbOutput);
    if (history.prevSSRReflectTex) {
      device.pool.releaseTexture(history.prevSSRReflectTex);
      history.prevSSRReflectTex = null;
    }
    if (history.prevSSRMotionVectorTex) {
      device.pool.releaseTexture(history.prevSSRMotionVectorTex);
      history.prevSSRMotionVectorTex = null;
    }
    if (ctx.camera.ssrTemporal) {
      device.pool.retainTexture(reflectanceTex);
      history.prevSSRReflectTex = reflectanceTex;
    }
    if (ctx.camera.ssrTemporal && ctx.motionVectorTexture) {
      if (history.prevSSRMotionVectorTex) {
        device.pool.releaseTexture(history.prevSSRMotionVectorTex);
      }
      device.pool.retainTexture(ctx.motionVectorTexture);
      history.prevSSRMotionVectorTex = ctx.motionVectorTexture;
    }
    device.pool.releaseFrameBuffer(intersectFramebuffer);
    device.pool.releaseFrameBuffer(pingpongFramebuffer[0]);
    device.pool.releaseFrameBuffer(pingpongFramebuffer[1]);
  }
  /** @internal */
  private _createCombineProgrm(ctx: DrawContext) {
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
        this.reflectanceTex = pb.tex2D().uniform(0);
        this.roughnessTex = pb.tex2D().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.ssrMaxRoughness = pb.float().uniform(0);
        this.ssrStrengthMode = pb.int().uniform(0);
        this.srgbOut = pb.int().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.func(
          'resolveSample',
          [pb.vec3('sceneColor'), pb.vec3('reflectance'), pb.vec4('roughnessValue')],
          function () {
            this.$l.r = pb.div(this.reflectance, pb.add(this.reflectance, pb.vec3(1)));
            this.$l.strength = pb.vec3();
            this.$if(pb.equal(this.ssrStrengthMode, 0), function () {
              this.strength = pb.clamp(this.roughnessValue.rgb, pb.vec3(0), pb.vec3(1));
            }).$else(function () {
              this.$l.roughAtten = pb.clamp(
                pb.sub(1, pb.div(this.roughnessValue.a, pb.max(this.ssrMaxRoughness, 1e-4))),
                0,
                1
              );
              this.$l.metallic = pb.clamp(this.roughnessValue.r, 0, 1);
              this.$l.specStrength = pb.clamp(this.roughnessValue.b, 0, 1);
              this.$l.f0 = pb.mix(pb.mul(0.04, this.specStrength), 1, this.metallic);
              this.$l.s = pb.mul(this.roughAtten, this.roughAtten, this.f0);
              this.strength = pb.vec3(this.s);
            });
            this.color = pb.add(
              pb.mul(this.r, this.strength),
              pb.mul(this.sceneColor, pb.sub(pb.vec3(1), this.strength))
            );
            this.$return(this.color);
          }
        );
        pb.main(function () {
          this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.targetSize.xy);
          this.$l.sceneColor = pb.textureSampleLevel(this.colorTex, this.screenUV, 0).rgb;
          this.$l.roughnessInfo = pb.textureSampleLevel(this.roughnessTex, this.screenUV, 0);
          this.$l.combined = pb.vec3();
          this.$if(pb.greaterThanEqual(this.roughnessInfo.a, this.ssrMaxRoughness), function () {
            this.combined = this.sceneColor;
          }).$else(function () {
            this.$l.reflectance = pb.textureSampleLevel(this.reflectanceTex, this.screenUV, 0).rgb;
            this.combined = this.resolveSample(this.sceneColor, this.reflectance, this.roughnessInfo);
          });
          this.$if(pb.equal(this.srgbOut, 0), function () {
            this.$outputs.outColor = pb.vec4(this.combined, 1);
          }).$else(function () {
            this.$outputs.outColor = pb.vec4(linearToGamma(this, this.combined), 1);
          });
        });
      }
    })!;
    program.name = '@SSR_Combine';
    return program;
  }
  /** @internal */
  private _createResolveProgram(ctx: DrawContext) {
    const program = ctx.device.buildRenderProgram({
      vertex(pb) {
        this.flip = pb.int().uniform(0);
        this.$inputs.pos = pb.vec2().attrib('position');
        this.$outputs.uv = pb.vec2();
        if (ctx.env!.light.envLight) {
          ctx.env!.light.envLight.initShaderBindings(pb);
        }
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
        this.intersectTex = pb.tex2D().uniform(0);
        this.roughnessTex = pb.tex2D().uniform(0);
        this.normalTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.viewMatrix = pb.mat4().uniform(0);
        this.invViewMatrix = pb.mat4().uniform(0);
        this.invProjMatrix = pb.mat4().uniform(0);
        this.ssrMaxRoughness = pb.float().uniform(0);
        this.ssrStrengthMode = pb.int().uniform(0);
        if (ctx.env!.light.envLight) {
          this.envLightStrength = pb.float().uniform(0);
          ctx.env!.light.envLight.initShaderBindings(pb);
        }
        this.$outputs.outColor = pb.vec4();
        pb.func('getPosition', [pb.vec2('uv'), pb.mat4('mat')], function () {
          this.$l.linearDepth = ShaderHelper.sampleLinearDepth(this, this.depthTex, this.uv, 0);
          this.$l.nonLinearDepth = pb.div(
            pb.sub(pb.div(this.cameraNearFar.x, this.linearDepth), this.cameraNearFar.y),
            pb.sub(this.cameraNearFar.x, this.cameraNearFar.y)
          );
          this.$l.clipSpacePos = pb.vec4(
            pb.sub(pb.mul(this.uv, 2), pb.vec2(1)),
            pb.sub(pb.mul(pb.clamp(this.nonLinearDepth, 0, 1), 2), 1),
            1
          );
          this.$l.wPos = pb.mul(this.mat, this.clipSpacePos);
          this.$return(pb.vec4(pb.div(this.wPos.xyz, this.wPos.w), this.linearDepth));
        });
        pb.func(
          'resolveSample',
          [pb.vec3('sceneColor'), pb.vec3('reflectance'), pb.vec4('roughnessValue')],
          function () {
            this.$l.r = pb.div(this.reflectance, pb.add(this.reflectance, pb.vec3(1)));
            this.$l.strength = pb.vec3();
            this.$if(pb.equal(this.ssrStrengthMode, 0), function () {
              this.strength = pb.clamp(this.roughnessValue.rgb, pb.vec3(0), pb.vec3(1));
            }).$else(function () {
              this.$l.roughAtten = pb.clamp(
                pb.sub(1, pb.div(this.roughnessValue.a, pb.max(this.ssrMaxRoughness, 1e-4))),
                0,
                1
              );
              this.$l.metallic = pb.clamp(this.roughnessValue.r, 0, 1);
              this.$l.specStrength = pb.clamp(this.roughnessValue.b, 0, 1);
              this.$l.f0 = pb.mix(pb.mul(0.04, this.specStrength), 1, this.metallic);
              this.$l.s = pb.mul(this.roughAtten, this.roughAtten, this.f0);
              this.strength = pb.vec3(this.s);
            });
            this.color = pb.add(
              pb.mul(this.r, this.strength),
              pb.mul(this.sceneColor, pb.sub(pb.vec3(1), this.strength))
            );
            this.$return(this.color);
          }
        );
        pb.func('resolveEnvRadiance', [pb.vec2('uv'), pb.vec4('roughnessInfo')], function () {
          if (!ctx.env!.light.envLight) {
            this.$return(pb.vec3(0));
            return;
          }
          this.$l.pos = this.getPosition(this.uv, this.invProjMatrix);
          this.$if(pb.greaterThanEqual(this.pos.w, 1), function () {
            this.$return(pb.vec3(0));
          });
          this.$l.roughness = this.roughnessInfo.a;
          this.$l.viewPos = this.pos.xyz;
          this.$l.worldNormal = pb.sub(
            pb.mul(pb.textureSampleLevel(this.normalTex, this.uv, 0).rgb, 2),
            pb.vec3(1)
          );
          this.$l.viewVec = pb.normalize(this.viewPos);
          this.$l.viewNormal = pb.mul(this.viewMatrix, pb.vec4(this.worldNormal, 0)).xyz;
          this.$l.reflectVec = pb.add(
            pb.reflect(this.viewVec, this.viewNormal),
            SSR_calcJitter(this, this.viewPos, this.roughness)
          );
          this.$l.reflectVecW = pb.mul(this.invViewMatrix, pb.vec4(this.reflectVec, 0)).xyz;
          this.$l.roughness2 = pb.clamp(this.roughness, 0, 1);
          this.$l.env = pb.mul(
            ctx.env!.light.envLight.getRadiance(this, this.reflectVecW, this.roughness2)!,
            this.envLightStrength
          );
          this.$return(pb.min(this.env, pb.vec3(1)));
        });
        pb.func(
          'resolveReflectance',
          [pb.vec2('uv'), pb.vec3('reflectSceneColor'), pb.vec4('roughnessInfo'), pb.float('alpha')],
          function () {
            this.$l.env = this.resolveEnvRadiance(this.uv, this.roughnessInfo);
            this.$l.reflectance = pb.mix(this.env, this.reflectSceneColor, pb.clamp(this.alpha, 0, 1));
            this.$return(this.reflectance);
          }
        );
        pb.main(function () {
          this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.targetSize.xy);
          this.$l.roughnessInfo = pb.textureSampleLevel(this.roughnessTex, this.screenUV, 0);
          this.$l.intersectSample = pb.vec4(0);
          this.$l.reflectance = pb.vec3(0);
          this.$if(pb.lessThan(this.roughnessInfo.a, this.ssrMaxRoughness), function () {
            this.intersectSample = pb.textureSampleLevel(this.intersectTex, this.screenUV, 0);
            this.$l.hitAlpha = pb.clamp(this.intersectSample.w, 0, 1);
            this.$l.hitUV = pb.clamp(this.intersectSample.xy, pb.vec2(0), pb.vec2(1));
            this.$if(pb.greaterThan(this.hitAlpha, 0), function () {
              this.$l.indirectIntersectSample = pb.textureSampleLevel(this.intersectTex, this.hitUV, 0);
              this.$l.indirectAlpha = pb.clamp(this.indirectIntersectSample.w, 0, 1);
              this.$l.indirectUV = pb.clamp(this.indirectIntersectSample.xy, pb.vec2(0), pb.vec2(1));
              this.$l.indirectRoughnessInfo = pb.textureSampleLevel(this.roughnessTex, this.hitUV, 0);
              this.$l.indirectReflectance = pb.vec3();
              this.$if(pb.greaterThan(this.indirectAlpha, 0), function () {
                this.$l.indirectReflectSceneColor = pb.textureSampleLevel(this.colorTex, this.indirectUV, 0).rgb;
                this.indirectReflectance = this.resolveReflectance(
                  this.hitUV,
                  this.indirectReflectSceneColor,
                  this.indirectRoughnessInfo,
                  this.indirectAlpha
                );
              }).$else(function () {
                this.indirectReflectance = this.resolveEnvRadiance(this.hitUV, this.indirectRoughnessInfo);
              });
              this.$l.reflectSceneColor = pb.textureSampleLevel(this.colorTex, this.hitUV, 0).rgb;
              this.$l.reflectSceneColor = this.resolveSample(
                this.reflectSceneColor,
                this.indirectReflectance,
                this.indirectRoughnessInfo
              );
              this.reflectance = this.resolveReflectance(
                this.screenUV,
                this.reflectSceneColor,
                this.roughnessInfo,
                this.hitAlpha
              );
            }).$else(function () {
              this.reflectance = this.resolveEnvRadiance(this.screenUV, this.roughnessInfo);
            });
          });
          this.$outputs.outColor = pb.vec4(this.reflectance, this.intersectSample.z);
        });
      }
    })!;
    program.name = '@SSR_Resolve';
    return program;
  }
  /** @internal */
  private _createTemporalProgram(ctx: DrawContext) {
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
        this.historyColorTex = pb.tex2D().uniform(0);
        this.currentColorTex = pb.tex2D().uniform(0);
        this.currentDepthTex = pb.tex2D().uniform(0);
        this.motionVector = pb.tex2D().uniform(0);
        this.prevMotionVector = pb.tex2D().uniform(0);
        this.texSize = pb.vec2().uniform(0);
        this.temporalWeight = pb.float().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.main(function () {
          this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.texSize);
          this.$l.currentColor = pb.textureSampleLevel(this.currentColorTex, this.screenUV, 0).rgb;
          this.$l.resolvedColor = temporalResolve(
            this,
            this.currentColorTex,
            this.historyColorTex,
            this.currentDepthTex,
            this.motionVector,
            this.prevMotionVector,
            this.screenUV,
            this.texSize,
            0
          );
          this.$l.w = pb.clamp(this.temporalWeight, 0, 1);
          this.$outputs.outColor = pb.vec4(pb.mix(this.currentColor, this.resolvedColor, this.w), 1);
        });
      }
    })!;
    program.name = '@SSR_Temporal';
    return program;
  }
  /** @internal */
  private _createIntersectProgram(ctx: DrawContext, blur: boolean) {
    const program = ctx.device.buildRenderProgram({
      vertex(pb) {
        this.flip = pb.int().uniform(0);
        this.$inputs.pos = pb.vec2().attrib('position');
        this.$outputs.uv = pb.vec2();
        if (!blur && ctx.env!.light.envLight) {
          ctx.env!.light.envLight.initShaderBindings(pb);
        }
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, 1, 1);
          this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
          this.$if(pb.notEqual(this.flip, 0), function () {
            this.$builtins.position.y = pb.neg(this.$builtins.position.y);
          });
        });
      },
      fragment(pb) {
        if (!blur) {
          this.colorTex = pb.tex2D().uniform(0);
          if (ctx.env!.light.envLight) {
            this.envLightStrength = pb.float().uniform(0);
            ctx.env!.light.envLight.initShaderBindings(pb);
          }
        }
        this.roughnessTex = pb.tex2D().uniform(0);
        this.normalTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.cameraPos = pb.vec3().uniform(0);
        this.invProjMatrix = pb.mat4().uniform(0);
        this.projMatrix = pb.mat4().uniform(0);
        this.viewMatrix = pb.mat4().uniform(0);
        this.invViewMatrix = pb.mat4().uniform(0);
        this.ssrParams = pb.vec4().uniform(0);
        this.ssrMaxRoughness = pb.float().uniform(0);
        this.ssrStrengthMode = pb.int().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        if (ctx.HiZTexture) {
          this.hizTex = pb.tex2D().uniform(0);
          this.depthMipLevels = pb.int().uniform(0);
          this.ssrHiZFallback = pb.int().uniform(0);
          this.ssrHiZFallbackSteps = pb.float().uniform(0);
          this.ssrHiZFallbackStride = pb.float().uniform(0);
          this.ssrSDFBoxCount = pb.int().uniform(0);
          this.zSDFBoxes = pb.vec4[SSR._sdfMaxBoxes * 2]().uniformBuffer(0);
        } else {
          this.ssrStride = pb.float().uniform(0);
        }
        this.srgbOut = pb.int().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.func('getPosition', [pb.vec2('uv'), pb.mat4('mat')], function () {
          this.$l.linearDepth = ShaderHelper.sampleLinearDepth(this, this.depthTex, this.uv, 0);
          this.$l.nonLinearDepth = pb.div(
            pb.sub(pb.div(this.cameraNearFar.x, this.linearDepth), this.cameraNearFar.y),
            pb.sub(this.cameraNearFar.x, this.cameraNearFar.y)
          );
          this.$l.clipSpacePos = pb.vec4(
            pb.sub(pb.mul(this.uv, 2), pb.vec2(1)),
            pb.sub(pb.mul(pb.clamp(this.nonLinearDepth, 0, 1), 2), 1),
            1
          );
          this.$l.wPos = pb.mul(this.mat, this.clipSpacePos);
          this.$return(pb.vec4(pb.div(this.wPos.xyz, this.wPos.w), this.linearDepth));
        });
        pb.func('sdAABB', [pb.vec3('p'), pb.vec3('bmin'), pb.vec3('bmax')], function () {
          this.$l.c = pb.mul(pb.add(this.bmin, this.bmax), 0.5);
          this.$l.e = pb.mul(pb.sub(this.bmax, this.bmin), 0.5);
          this.$l.q = pb.sub(pb.abs(pb.sub(this.p, this.c)), this.e);
          this.$l.outside = pb.length(pb.max(this.q, pb.vec3(0)));
          this.$l.inside = pb.min(pb.max(this.q.x, pb.max(this.q.y, this.q.z)), 0);
          this.$return(pb.add(this.outside, this.inside));
        });
        pb.func(
          'traceSDFBoxes',
          [
            pb.vec3('rayOrigin'),
            pb.vec3('rayDir'),
            pb.float('maxDistance'),
            pb.float('maxIterations'),
            pb.float('thickness'),
            pb.float('stepScale'),
            pb.vec2('cameraNearFar'),
            pb.mat4('projMatrix'),
            pb.vec4('textureSize')
          ],
          function () {
            this.$if(pb.lessThanEqual(this.ssrSDFBoxCount, 0), function () {
              this.$return(pb.vec4(0));
            });
            this.$l.t = pb.float(0.05);
            this.$l.hitInfo = pb.vec4(0);
            this.$for(pb.float('i'), 0, pb.getDevice().type === 'webgl' ? 256 : this.maxIterations, function () {
              if (pb.getDevice().type === 'webgl') {
                this.$if(pb.greaterThanEqual(this.i, this.maxIterations), function () {
                  this.$break();
                });
              }
              this.$if(pb.greaterThan(this.t, this.maxDistance), function () {
                this.$break();
              });
              this.$l.p = pb.add(this.rayOrigin, pb.mul(this.rayDir, this.t));
              this.$l.sd = pb.float(1e6);
              this.$for(pb.int('b'), 0, SSR._sdfMaxBoxes, function () {
                this.$if(pb.greaterThanEqual(this.b, this.ssrSDFBoxCount), function () {
                  this.$break();
                });
                this.$l.bmin = this.zSDFBoxes.at(pb.mul(this.b, 2)).xyz;
                this.$l.bmax = this.zSDFBoxes.at(pb.add(pb.mul(this.b, 2), 1)).xyz;
                this.sd = pb.min(this.sd, this.sdAABB(this.p, this.bmin, this.bmax));
              });
              this.$if(pb.lessThan(this.sd, 0.02), function () {
                this.$l.clip = pb.mul(this.projMatrix, pb.vec4(this.p, 1));
                this.$if(pb.lessThan(pb.abs(this.clip.w), 1e-5), function () {
                  this.$break();
                });
                this.$l.uv = pb.add(pb.mul(pb.div(this.clip.xy, this.clip.w), 0.5), pb.vec2(0.5));
                this.$if(
                  pb.or(pb.any(pb.lessThan(this.uv, pb.vec2(0))), pb.any(pb.greaterThan(this.uv, pb.vec2(1)))),
                  function () {
                    this.$break();
                  }
                );
                this.$l.sceneDepth01 = ShaderHelper.sampleLinearDepth(this, this.depthTex, this.uv, 0);
                this.$if(pb.lessThan(this.sceneDepth01, 1), function () {
                  this.$l.sceneDepth = pb.mul(this.sceneDepth01, this.cameraNearFar.y);
                  this.$l.hitDepth = pb.max(pb.neg(this.p.z), 0);
                  this.$l.depthDelta = pb.abs(pb.sub(this.sceneDepth, this.hitDepth));
                  this.$l.depthTol = pb.max(pb.mul(this.thickness, this.cameraNearFar.y), 0.25);
                  this.$l.alpha = pb.sub(1, pb.smoothStep(0, this.depthTol, this.depthDelta));
                  this.hitInfo = pb.vec4(this.uv, this.t, pb.clamp(this.alpha, 0, 1));
                });
                this.$break();
              });
              this.$l.step = pb.max(pb.mul(this.sd, pb.max(this.stepScale, 0.25)), 0.02);
              this.t = pb.add(this.t, this.step);
            });
            this.$return(this.hitInfo);
          }
        );
        pb.main(function () {
          this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.targetSize.xy);
          this.$l.roughnessValue = pb.textureSampleLevel(this.roughnessTex, this.screenUV, 0);
          this.$l.roughness = this.roughnessValue.a;
          if (!blur) {
            this.$l.sceneColor = pb.textureSampleLevel(this.colorTex, this.screenUV, 0).rgb;
          }
          this.$l.color = pb.vec3(0);
          this.$l.a = pb.float(0);
          this.$if(pb.lessThan(this.roughness, this.ssrMaxRoughness), function () {
          this.$l.pos = this.getPosition(this.screenUV, this.invProjMatrix);
          this.$l.linearDepth = this.pos.w;
          this.$if(pb.greaterThanEqual(this.linearDepth, 1), function () {
            if (!blur) {
              this.color = this.sceneColor;
              this.a = 1;
            }
          }).$else(function () {
            this.$l.viewPos = this.pos.xyz;
            this.$l.worldNormal = pb.sub(
              pb.mul(pb.textureSampleLevel(this.normalTex, this.screenUV, 0).rgb, 2),
              pb.vec3(1)
            );
            this.$l.viewVec = pb.normalize(this.viewPos);
            this.$l.viewNormal = pb.mul(this.viewMatrix, pb.vec4(this.worldNormal, 0)).xyz;
            this.$l.reflectVec = pb.add(
              pb.reflect(this.viewVec, this.viewNormal),
              SSR_calcJitter(this, this.viewPos, this.roughness)
            );
            this.$l.hitInfo = pb.vec4(0);
            if (ctx.HiZTexture) {
              this.hitInfo = screenSpaceRayTracing_HiZ(
                this,
                this.viewPos,
                this.reflectVec,
                this.viewMatrix,
                this.projMatrix,
                this.invProjMatrix,
                this.cameraNearFar,
                this.depthMipLevels,
                this.ssrParams.y,
                this.ssrParams.z,
                this.targetSize,
                this.hizTex,
                this.normalTex
              );
              this.$if(
                pb.and(
                  pb.notEqual(this.ssrHiZFallback, 0),
                  pb.lessThanEqual(pb.clamp(this.hitInfo.w, 0, 1), 0)
                ),
                function () {
                  this.$l.hitInfoFallback = pb.vec4(0);
                  this.$if(pb.greaterThan(this.ssrSDFBoxCount, 0), function () {
                    this.hitInfoFallback = this.traceSDFBoxes(
                      this.viewPos,
                      this.reflectVec,
                      this.ssrParams.x,
                      this.ssrHiZFallbackSteps,
                      this.ssrParams.z,
                      this.ssrHiZFallbackStride,
                      this.cameraNearFar,
                      this.projMatrix,
                      this.targetSize
                    );
                  }).$else(function () {
                    this.hitInfoFallback = screenSpaceRayTracing_Linear2D(
                      this,
                      this.viewPos,
                      this.reflectVec,
                      this.viewMatrix,
                      this.projMatrix,
                      this.invProjMatrix,
                      this.cameraNearFar,
                      this.ssrParams.x,
                      this.ssrHiZFallbackSteps,
                      this.ssrParams.z,
                      this.ssrHiZFallbackStride,
                      this.targetSize,
                      this.depthTex,
                      this.normalTex,
                      !!ctx.camera.ssrCalcThickness
                    );
                  });
                  this.$if(pb.lessThanEqual(pb.clamp(this.hitInfoFallback.w, 0, 1), 0), function () {
                    this.hitInfoFallback = screenSpaceRayTracing_Linear2D(
                      this,
                      this.viewPos,
                      this.reflectVec,
                      this.viewMatrix,
                      this.projMatrix,
                      this.invProjMatrix,
                      this.cameraNearFar,
                      this.ssrParams.x,
                      this.ssrHiZFallbackSteps,
                      this.ssrParams.z,
                      this.ssrHiZFallbackStride,
                      this.targetSize,
                      this.depthTex,
                      this.normalTex,
                      !!ctx.camera.ssrCalcThickness
                    );
                  });
                  this.$if(pb.greaterThan(this.hitInfoFallback.w, this.hitInfo.w), function () {
                    this.hitInfo = this.hitInfoFallback;
                  });
                }
              );
            } else {
              this.hitInfo = screenSpaceRayTracing_Linear2D(
                this,
                this.viewPos,
                this.reflectVec,
                this.viewMatrix,
                this.projMatrix,
                this.invProjMatrix,
                this.cameraNearFar,
                this.ssrParams.x,
                this.ssrParams.y,
                this.ssrParams.z,
                this.ssrStride,
                this.targetSize,
                this.depthTex,
                this.normalTex,
                !!ctx.camera.ssrCalcThickness
              );
            }
            this.$l.hitAlpha = pb.clamp(this.hitInfo.w, 0, 1);
            this.$l.hitUV = pb.clamp(this.hitInfo.xy, pb.vec2(0), pb.vec2(1));
            if (blur) {
              this.blurRadius = pb.float(0);
              this.$if(pb.greaterThan(this.roughness, 0.001), function () {
                this.$l.coneAngle = pb.mul(pb.min(this.roughness, 0.999), Math.PI * 0.5);
                this.$l.coneLen = this.$choice(
                  pb.greaterThan(this.hitAlpha, 0),
                  this.hitInfo.z,
                  pb.min(this.targetSize.z, this.targetSize.w)
                );
                this.$l.opLen = pb.mul(pb.tan(this.coneAngle), this.coneLen, 2);
                this.$l.a2 = pb.mul(this.opLen, this.opLen);
                this.$l.fh2 = pb.mul(this.coneLen, this.coneLen, 4);
                this.blurRadius = pb.div(
                  pb.mul(this.opLen, pb.sub(pb.sqrt(pb.add(this.a2, this.fh2)), this.opLen)),
                  pb.mul(this.coneLen, 4)
                );
              });
              this.a = this.hitAlpha;
              this.color = pb.vec3(this.hitUV, pb.clamp(pb.div(this.blurRadius, 255), 0, 1));
            } else {
              if (ctx.env!.light.envLight) {
                this.$l.reflectVecW = pb.mul(this.invViewMatrix, pb.vec4(this.reflectVec, 0)).xyz;
                this.$l.env = pb.mul(
                  ctx.env!.light.envLight.getRadiance(this, this.reflectVecW, this.roughness)!,
                  this.envLightStrength
                );
              } else {
                this.$l.env = pb.vec3(0);
              }
              this.$l.reflectance = pb.mix(
                this.env,
                pb.textureSampleLevel(this.colorTex, this.hitUV, 0).rgb,
                this.hitAlpha
              );
              this.reflectance = pb.div(this.reflectance, pb.add(this.reflectance, pb.vec3(1)));
              this.$l.strength = pb.vec3();
              this.$if(pb.equal(this.ssrStrengthMode, 0), function () {
                this.strength = pb.clamp(this.roughnessValue.rgb, pb.vec3(0), pb.vec3(1));
              }).$else(function () {
                this.$l.roughAtten = pb.clamp(
                  pb.sub(1, pb.div(this.roughness, pb.max(this.ssrMaxRoughness, 1e-4))),
                  0,
                  1
                );
                this.$l.metallic = pb.clamp(this.roughnessValue.r, 0, 1);
                this.$l.specStrength = pb.clamp(this.roughnessValue.b, 0, 1);
                this.$l.f0 = pb.mix(pb.mul(0.04, this.specStrength), 1, this.metallic);
                this.$l.s = pb.mul(this.roughAtten, this.roughAtten, this.f0);
                this.strength = pb.vec3(this.s);
              });
              this.color = pb.add(
                pb.mul(this.reflectance, this.strength),
                pb.mul(this.sceneColor, pb.sub(pb.vec3(1), this.strength))
              );
            }
          });
          });
          this.$if(pb.equal(this.srgbOut, 0), function () {
            this.$outputs.outColor = pb.vec4(this.color, this.a);
          }).$else(function () {
            this.$outputs.outColor = pb.vec4(linearToGamma(this, this.color), this.a);
          });
        });
      }
    })!;
    program.name = blur ? '@SSR_Intersect_Blur' : '@SSR_Intersect';
    return program;
  }
}
