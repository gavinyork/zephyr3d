import { AbstractPostEffect, PostEffectLayer } from './posteffect';
import { linearToGamma } from '../shaders/misc';
import type { BindGroup, FrameBuffer, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { screenSpaceRayTracing_HiZ, screenSpaceRayTracing_Linear2D, SSR_calcJitter } from '../shaders/ssr';
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
  private static _programs: Record<string, GPUProgram> = {};
  private static _resolveProgram: Record<string, GPUProgram> = {};
  private static _combineProgram: Nullable<GPUProgram> = null;
  private static _blurBlitterH: Nullable<BilateralBlurBlitter> = null;
  private static _blurBlitterV: Nullable<BilateralBlurBlitter> = null;
  private _bindgroups: Record<string, BindGroup>;
  private _resolveBindGroup: Record<string, BindGroup>;
  private _combineBindGroup: Nullable<BindGroup>;
  /**
   * Creates an instance of SSR post effect
   */
  constructor() {
    super();
    this._layer = PostEffectLayer.opaque;
    this._bindgroups = {};
    this._resolveBindGroup = {};
    this._combineBindGroup = null;
  }
  /** {@inheritDoc AbstractPostEffect.requireLinearDepthTexture} */
  requireLinearDepthTexture(): boolean {
    return true;
  }
  /** {@inheritDoc AbstractPostEffect.requireDepthAttachment} */
  requireDepthAttachment(): boolean {
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
    this._combineBindGroup.setValue(
      'targetSize',
      new Vector4(
        device.getDrawingBufferWidth(),
        device.getDrawingBufferHeight(),
        device.getDrawingBufferWidth(),
        device.getDrawingBufferHeight()
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
    bindGroup.setValue('cameraNearFar', new Vector2(ctx.camera.getNearPlane(), ctx.camera.getFarPlane()));
    bindGroup.setValue(
      'targetSize',
      new Vector4(
        device.getDrawingBufferWidth(),
        device.getDrawingBufferHeight(),
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
    if (ctx.HiZTexture) {
      bindGroup.setTexture('hizTex', ctx.HiZTexture, nearestSampler);
      bindGroup.setValue('depthMipLevels', ctx.HiZTexture.mipLevelCount);
      bindGroup.setValue(
        'targetSize',
        new Vector4(
          device.getDrawingBufferWidth(),
          device.getDrawingBufferHeight(),
          ctx.HiZTexture.width,
          ctx.HiZTexture.height
        )
      );
    } else {
      bindGroup.setValue('ssrStride', ctx.camera.ssrStride);
      bindGroup.setValue(
        'targetSize',
        new Vector4(
          device.getDrawingBufferWidth(),
          device.getDrawingBufferHeight(),
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
    this.resolve(ctx, inputColorTexture, sceneDepthTexture, intersectTex);
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
    device.popDeviceStates();
    this.combine(
      ctx,
      inputColorTexture,
      pingpongFramebuffer[0].getColorAttachments()[0] as Texture2D,
      srgbOutput
    );
    device.pool.releaseFrameBuffer(intersectFramebuffer);
    device.pool.releaseFrameBuffer(pingpongFramebuffer[0]);
    device.pool.releaseFrameBuffer(pingpongFramebuffer[1]);
  }
  /** @internal */
  private _createCombineProgrm(ctx: DrawContext): GPUProgram {
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
        this.srgbOut = pb.int().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.func(
          'resolveSample',
          [pb.vec3('sceneColor'), pb.vec3('reflectance'), pb.vec4('roughnessValue')],
          function () {
            this.$l.r = pb.div(this.reflectance, pb.add(this.reflectance, pb.vec3(1)));
            this.$l.strength = pb.clamp(this.roughnessValue.rgb, pb.vec3(0), pb.vec3(1));
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
  private _createResolveProgram(ctx: DrawContext): GPUProgram {
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
            this.$l.strength = pb.clamp(this.roughnessValue.rgb, pb.vec3(0), pb.vec3(1));
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
          this.$l.roughness2 = pb.float(0);
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
            this.$l.reflectance = pb.mix(this.env, this.reflectSceneColor, this.alpha);
            this.$return(this.reflectance);
          }
        );
        pb.main(function () {
          this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.targetSize.xy);
          this.$l.roughnessInfo = pb.textureSampleLevel(this.roughnessTex, this.screenUV, 0);
          this.$if(pb.greaterThanEqual(this.roughnessInfo.a, this.ssrMaxRoughness), function () {
            pb.discard();
          });
          this.$l.intersectSample = pb.textureSampleLevel(this.intersectTex, this.screenUV, 0);
          this.$l.reflectance = pb.vec3();
          this.$if(pb.greaterThan(this.intersectSample.w, 0), function () {
            this.$l.indirectIntersectSample = pb.textureSampleLevel(
              this.intersectTex,
              this.intersectSample.xy,
              0
            );
            this.$l.indirectRoughnessInfo = pb.textureSampleLevel(
              this.roughnessTex,
              this.intersectSample.xy,
              0
            );
            this.$l.indirectReflectance = pb.vec3();
            this.$if(pb.greaterThan(this.indirectIntersectSample.w, 0), function () {
              this.$l.indirectReflectSceneColor = pb.textureSampleLevel(
                this.colorTex,
                this.indirectIntersectSample.xy,
                0
              ).rgb;
              this.indirectReflectance = this.resolveReflectance(
                this.intersectSample.xy,
                this.indirectReflectSceneColor,
                this.indirectRoughnessInfo,
                this.indirectIntersectSample.w
              );
            }).$else(function () {
              this.indirectReflectance = this.resolveEnvRadiance(
                this.intersectSample.xy,
                this.indirectRoughnessInfo
              );
            });
            this.$l.reflectSceneColor = pb.textureSampleLevel(this.colorTex, this.intersectSample.xy, 0).rgb;
            this.$l.reflectSceneColor = this.resolveSample(
              this.reflectSceneColor,
              this.indirectReflectance,
              this.indirectRoughnessInfo
            );
            this.reflectance = this.resolveReflectance(
              this.screenUV,
              this.reflectSceneColor,
              this.roughnessInfo,
              this.intersectSample.w
            );
          }).$else(function () {
            this.reflectance = this.resolveEnvRadiance(this.screenUV, this.roughnessInfo);
          });
          this.$outputs.outColor = pb.vec4(this.reflectance, this.intersectSample.z);
        });
      }
    })!;
    program.name = '@SSR_Resolve';
    return program;
  }
  /** @internal */
  private _createIntersectProgram(ctx: DrawContext, blur: boolean): GPUProgram {
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
        this.targetSize = pb.vec4().uniform(0);
        if (ctx.HiZTexture) {
          this.hizTex = pb.tex2D().uniform(0);
          this.depthMipLevels = pb.int().uniform(0);
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
        pb.main(function () {
          this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.targetSize.xy);
          this.$l.roughnessValue = pb.textureSampleLevel(this.roughnessTex, this.screenUV, 0);
          this.$l.roughness = this.roughnessValue.a;
          this.$if(pb.greaterThanEqual(this.roughness, this.ssrMaxRoughness), function () {
            pb.discard();
          });
          if (!blur) {
            this.$l.sceneColor = pb.textureSampleLevel(this.colorTex, this.screenUV, 0).rgb;
          }
          this.$l.pos = this.getPosition(this.screenUV, this.invProjMatrix);
          this.$l.linearDepth = this.pos.w;
          this.$l.color = pb.vec3(0);
          this.$l.a = pb.float();
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
            this.$l.hitInfo = ctx.HiZTexture
              ? screenSpaceRayTracing_HiZ(
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
                )
              : screenSpaceRayTracing_Linear2D(
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
            if (blur) {
              this.blurRadius = pb.float(0);
              this.$if(pb.greaterThan(this.roughness, 0.001), function () {
                this.$l.coneAngle = pb.mul(pb.min(this.roughness, 0.999), Math.PI * 0.5);
                this.$l.coneLen = this.$choice(
                  pb.greaterThan(this.hitInfo.w, 0),
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
              this.a = this.hitInfo.w;
              this.color = pb.vec3(this.hitInfo.xy, pb.clamp(pb.div(this.blurRadius, 255), 0, 1));
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
                pb.textureSampleLevel(this.colorTex, this.hitInfo.xy, 0).rgb,
                this.hitInfo.w
              );
              this.reflectance = pb.div(this.reflectance, pb.add(this.reflectance, pb.vec3(1)));
              this.$l.strength = pb.clamp(this.roughnessValue.rgb, pb.vec3(0), pb.vec3(1));
              this.color = pb.add(
                pb.mul(this.reflectance, this.strength),
                pb.mul(this.sceneColor, pb.sub(pb.vec3(1), this.strength))
              );
            }
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
