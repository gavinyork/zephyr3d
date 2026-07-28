import { AbstractPostEffect, PostEffectLayer } from './posteffect';
import type { PostEffectSetupContext } from './posteffect';
import { linearToGamma } from '../shaders/misc';
import type { BindGroup, FrameBuffer, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { screenSpaceRayTracing_HiZ, screenSpaceRayTracing_Linear2D, SSR_calcJitter } from '../shaders/ssr';
import { temporalResolve } from '../shaders/temporal';
import type { Nullable } from '@zephyr3d/base';
import { Matrix4x4, Vector2, Vector4 } from '@zephyr3d/base';
import { copyTexture, fetchSampler } from '../utility/misc';
import { getGGXLUT } from '../utility/textures/ggxlut';
import { BilateralBlurBlitter } from '../blitter/bilateralblur';
import { ShaderHelper } from '../material';
import { RGHistoryResources } from '../render/rendergraph/history_resources';
import { FrameResources } from '../render/rendergraph/blackboard';
import type { RGExecuteContext, RGHandle, RGPassBuilder, RGTextureDesc } from '../render/rendergraph/types';

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
  /** {@inheritDoc AbstractPostEffect.requireMotionVectorTexture} */
  requireMotionVectorTexture(ctx: DrawContext) {
    return !!ctx.camera.ssrTemporal;
  }
  /** {@inheritDoc AbstractPostEffect.requireHiZTexture} */
  requireHiZTexture(ctx: DrawContext) {
    return !!ctx.camera.HiZ;
  }
  /** {@inheritDoc AbstractPostEffect.requireSceneNormalTexture} */
  requireSceneNormalTexture() {
    return true;
  }
  /** {@inheritDoc AbstractPostEffect.requireSceneRoughnessTexture} */
  requireSceneRoughnessTexture() {
    return true;
  }
  /**
   * Declares SSR's internal steps (intersect, resolve, optional bilateral
   * blur, optional temporal resolve, combine) as individual render graph
   * passes, mirroring the sequence of {@link SSR.apply}.
   */
  setup(s: PostEffectSetupContext): RGHandle {
    const { graph, ctx, history } = s;
    const linearDepthHandle = s.blackboard.get(FrameResources.LinearDepth);
    const texDesc: RGTextureDesc = {
      format: 'rgba16f',
      sizeMode: 'absolute',
      width: s.width,
      height: s.height
    };
    const readCommon = (builder: RGPassBuilder) => {
      if (linearDepthHandle) {
        builder.read(linearDepthHandle);
      }
      // Roughness/normal MRT outputs, HiZ and the scene color copy are reached
      // through DrawContext fields; the dependency list carries their handles.
      for (const dep of s.dependencies) {
        builder.read(dep);
      }
    };
    const getLinearDepth = (rg: RGExecuteContext) =>
      linearDepthHandle ? rg.getTexture<Texture2D>(linearDepthHandle) : ctx.linearDepthTexture!;

    // 1. Ray march the scene (HiZ or linear 2D) into the intersect texture.
    const intersectHandle = graph.addPass('SSR:Intersect', (builder) => {
      builder.read(s.input);
      readCommon(builder);
      const out = builder.createTexture({ ...texDesc, label: 'SSR:intersect' });
      const fb = builder.createFramebuffer({
        label: 'SSR:intersectFB',
        width: s.width,
        height: s.height,
        colorAttachments: out,
        depthAttachment: s.sceneDepthAttachment,
        ignoreDepthStencil: false
      });
      builder.setExecute((rg) => {
        const device = ctx.device;
        device.pushDeviceStates();
        try {
          device.setFramebuffer(rg.getFramebuffer<FrameBuffer>(fb));
          this.intersect(ctx, rg.getTexture<Texture2D>(s.input), getLinearDepth(rg), true, false);
        } finally {
          device.popDeviceStates();
        }
      });
      return out;
    });

    // 2. Resolve reflection color from the intersect result.
    const resolveHandle = graph.addPass('SSR:Resolve', (builder) => {
      builder.read(s.input);
      builder.read(intersectHandle);
      readCommon(builder);
      const out = builder.createTexture({ ...texDesc, label: 'SSR:resolve' });
      const fb = builder.createFramebuffer({
        label: 'SSR:resolveFB',
        width: s.width,
        height: s.height,
        colorAttachments: out,
        depthAttachment: s.sceneDepthAttachment,
        ignoreDepthStencil: false
      });
      builder.setExecute((rg) => {
        const device = ctx.device;
        device.pushDeviceStates();
        try {
          device.setFramebuffer(rg.getFramebuffer<FrameBuffer>(fb));
          const inputTex = rg.getTexture<Texture2D>(s.input);
          this.resolve(
            ctx,
            ctx.sceneColorTexture ?? inputTex,
            getLinearDepth(rg),
            rg.getTexture<Texture2D>(intersectHandle)
          );
        } finally {
          device.popDeviceStates();
        }
      });
      return out;
    });

    // 3. Optional bilateral blur (horizontal + vertical), guided by the
    // per-pixel blur size stored in the intersect texture.
    let reflectHandle = resolveHandle;
    if (ctx.camera.ssrBlurScale > 0 && ctx.camera.ssrBlurKernelSize > 0) {
      reflectHandle = graph.addPass('SSR:Blur', (builder) => {
        builder.read(resolveHandle);
        builder.read(intersectHandle);
        readCommon(builder);
        const middle = builder.createTexture({ ...texDesc, label: 'SSR:blurH' });
        const out = builder.createTexture({ ...texDesc, label: 'SSR:blur' });
        const middleFB = builder.createFramebuffer({
          label: 'SSR:blurHFB',
          width: s.width,
          height: s.height,
          colorAttachments: middle,
          depthAttachment: s.sceneDepthAttachment,
          ignoreDepthStencil: false
        });
        const outFB = builder.createFramebuffer({
          label: 'SSR:blurFB',
          width: s.width,
          height: s.height,
          colorAttachments: out,
          depthAttachment: s.sceneDepthAttachment,
          ignoreDepthStencil: false
        });
        builder.setExecute((rg) => {
          const device = ctx.device;
          device.pushDeviceStates();
          try {
            const intersectTex = rg.getTexture<Texture2D>(intersectHandle);
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
              rg.getTexture<Texture2D>(resolveHandle),
              rg.getFramebuffer<FrameBuffer>(middleFB)
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
              rg.getTexture<Texture2D>(middle),
              rg.getFramebuffer<FrameBuffer>(outFB)
            );
          } finally {
            device.popDeviceStates();
          }
        });
        return out;
      });
    }

    // 4. Optional temporal resolve against last frame's reflection.
    const wantTemporal = !!ctx.camera.ssrTemporal;
    const motionVectorHandle = wantTemporal ? s.blackboard.get(FrameResources.MotionVector) : null;
    const historySize = { width: s.width, height: s.height };
    const prevReflectHandle =
      wantTemporal && history && motionVectorHandle
        ? history.importPreviousIfCompatible(graph, RGHistoryResources.SSR_REFLECT, texDesc, historySize)
        : null;
    const prevMotionVectorHandle =
      wantTemporal && history && motionVectorHandle
        ? history.importPreviousIfCompatible(
            graph,
            RGHistoryResources.SSR_MOTION_VECTOR,
            texDesc,
            historySize
          )
        : null;
    if (motionVectorHandle && prevReflectHandle && prevMotionVectorHandle) {
      const blurredHandle = reflectHandle;
      reflectHandle = graph.addPass('SSR:Temporal', (builder) => {
        builder.read(blurredHandle);
        builder.read(prevReflectHandle);
        builder.read(prevMotionVectorHandle);
        builder.read(motionVectorHandle);
        readCommon(builder);
        const out = builder.createTexture({ ...texDesc, label: 'SSR:temporal' });
        const fb = builder.createFramebuffer({
          label: 'SSR:temporalFB',
          width: s.width,
          height: s.height,
          colorAttachments: out,
          depthAttachment: s.sceneDepthAttachment,
          ignoreDepthStencil: false
        });
        builder.setExecute((rg) => {
          const device = ctx.device;
          device.pushDeviceStates();
          try {
            this.temporal(
              ctx,
              rg.getTexture<Texture2D>(blurredHandle),
              getLinearDepth(rg),
              rg.getTexture<Texture2D>(prevReflectHandle),
              rg.getTexture<Texture2D>(prevMotionVectorHandle),
              rg.getFramebuffer<FrameBuffer>(fb)
            );
          } finally {
            device.popDeviceStates();
          }
        });
        return out;
      });
    }

    // 5. Combine reflections with the scene color and queue history commits.
    const finalReflectHandle = reflectHandle;
    return graph.addPass('PostEffect:SSR', (builder) => {
      builder.read(s.input);
      builder.read(finalReflectHandle);
      if (motionVectorHandle) {
        builder.read(motionVectorHandle);
      }
      readCommon(builder);
      const output = s.createOutput(builder, { needDepthAttachment: true });
      builder.setExecute((rg) => {
        const device = ctx.device;
        device.pushDeviceStates();
        try {
          device.setFramebuffer(
            output.framebuffer ? rg.getFramebuffer<FrameBuffer>(output.framebuffer) : null
          );
          const inputTex = rg.getTexture<Texture2D>(s.input);
          const reflectanceTex = rg.getTexture<Texture2D>(finalReflectHandle);
          copyTexture(
            inputTex,
            device.getFramebuffer()!,
            fetchSampler('clamp_nearest_nomip'),
            AbstractPostEffect.getDefaultRenderState(ctx, 'eq')
          );
          this.combine(ctx, inputTex, reflectanceTex, output.srgbOutput);
          if (wantTemporal && history) {
            history.queueRetainedCommit(
              RGHistoryResources.SSR_REFLECT,
              {
                format: reflectanceTex.format,
                sizeMode: 'absolute',
                width: reflectanceTex.width,
                height: reflectanceTex.height
              },
              { width: reflectanceTex.width, height: reflectanceTex.height },
              reflectanceTex
            );
            if (ctx.motionVectorTexture) {
              history.queueRetainedCommit(
                RGHistoryResources.SSR_MOTION_VECTOR,
                {
                  format: ctx.motionVectorTexture.format,
                  sizeMode: 'absolute',
                  width: ctx.motionVectorTexture.width,
                  height: ctx.motionVectorTexture.height
                },
                { width: ctx.motionVectorTexture.width, height: ctx.motionVectorTexture.height },
                ctx.motionVectorTexture
              );
            }
          }
        } finally {
          device.popDeviceStates();
        }
      });
      return output.color;
    });
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
    srcTex: Texture2D,
    fbTo: FrameBuffer
  ) {
    const size = new Vector2(srcTex.width, srcTex.height);
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
    blitter.blit(srcTex, fbTo, fetchSampler('clamp_linear_nomip'));
  }
  /** @internal */
  combine(ctx: DrawContext, inputColorTexture: Texture2D, reflectanceTex: Texture2D, srgbOut: boolean) {
    const device = ctx.device;
    let program = SSR._combineProgram;
    if (program === undefined) {
      program = this._createCombineProgrm(ctx);
      SSR._combineProgram = program;
    }
    const roughnessTexture = ctx.SceneRoughnessTexture!;
    if (!this._combineBindGroup) {
      this._combineBindGroup = device.createBindGroup(program!.bindGroupLayouts[0]);
    }
    const linearSampler = fetchSampler('clamp_linear');
    const nearestSampler = fetchSampler('clamp_nearest');
    this._combineBindGroup.setTexture('colorTex', inputColorTexture, linearSampler);
    this._combineBindGroup.setTexture('reflectanceTex', reflectanceTex, linearSampler);
    this._combineBindGroup.setTexture('roughnessTex', roughnessTexture, linearSampler);
    this._combineBindGroup.setTexture('albedoTex', inputColorTexture, linearSampler);
    this._combineBindGroup.setTexture('extraTex', inputColorTexture, nearestSampler);
    this._combineBindGroup.setTexture('normalTex', ctx.SceneNormalTexture!, nearestSampler);
    this._combineBindGroup.setTexture('depthTex', ctx.linearDepthTexture!, nearestSampler);
    this._combineBindGroup.setTexture('zGGXLut', getGGXLUT(1024), fetchSampler('clamp_nearest_nomip'));
    this._combineBindGroup.setValue('ssrMaxRoughness', ctx.camera.ssrMaxRoughness);
    this._combineBindGroup.setValue('ssrStrengthMode', 0);
    this._combineBindGroup.setValue(
      'cameraNearFar',
      new Vector2(ctx.camera.getNearPlane(), ctx.camera.getFarPlane())
    );
    this._combineBindGroup.setValue('viewMatrix', ctx.camera.viewMatrix);
    this._combineBindGroup.setValue('invProjMatrix', Matrix4x4.invert(ctx.camera.getProjectionMatrix()));
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
    const hasEnvRadiance = !!ctx.env!.light.envLight?.hasRadiance();
    const hash = hasEnvRadiance ? ctx.env!.light.getHash() : '';
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
    const roughnessTexture = ctx.SceneRoughnessTexture!;
    const normalTexture = ctx.SceneNormalTexture!;
    bindGroup.setTexture('colorTex', inputColorTexture, linearSampler);
    bindGroup.setTexture('intersectTex', intersectTexture, nearestSampler);
    bindGroup.setTexture('roughnessTex', roughnessTexture, nearestSampler);
    bindGroup.setTexture('normalTex', normalTexture, nearestSampler);
    bindGroup.setTexture('albedoTex', inputColorTexture, linearSampler);
    bindGroup.setTexture('extraTex', inputColorTexture, nearestSampler);
    bindGroup.setTexture('depthTex', sceneDepthTexture, nearestSampler);
    bindGroup.setTexture('zGGXLut', getGGXLUT(1024), fetchSampler('clamp_nearest_nomip'));
    bindGroup.setValue('ssrMaxRoughness', ctx.camera.ssrMaxRoughness);
    bindGroup.setValue('ssrStrengthMode', 0);
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
    if (hasEnvRadiance) {
      bindGroup.setValue('envLightStrength', ShaderHelper.getEnvLightLuminance(ctx));
      bindGroup.setValue('envLightSpecularStrength', ctx.env!.light.specularStrength ?? 1);
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
    const hasEnvRadiance = !!ctx.env!.light.envLight?.hasRadiance();
    const hash = `${Number(blur)}:${
      hasEnvRadiance ? ctx.env!.light.getHash() : ''
    }:${!!ctx.HiZTexture}:${!!ctx.camera.ssrCalcThickness}`;
    let program = SSR._programs[hash];
    if (program === undefined) {
      const created = this._createIntersectProgram(ctx, blur);
      if (!created) {
        return;
      }
      program = created;
      SSR._programs[hash] = program;
    }
    let bindGroup = this._bindgroups[hash];
    if (!bindGroup) {
      bindGroup = device.createBindGroup(program.bindGroupLayouts[0]);
      this._bindgroups[hash] = bindGroup;
    }
    const nearestSampler = fetchSampler('clamp_nearest');
    const linearSampler = fetchSampler('clamp_linear');
    const roughnessTexture = ctx.SceneRoughnessTexture!;
    const normalTexture = ctx.SceneNormalTexture!;
    if (!blur) {
      bindGroup.setTexture('colorTex', inputColorTexture, linearSampler);
      if (hasEnvRadiance) {
        bindGroup.setValue('envLightStrength', ShaderHelper.getEnvLightLuminance(ctx));
        bindGroup.setValue('envLightSpecularStrength', ctx.env!.light.specularStrength ?? 1);
        ctx.env!.light.envLight.updateBindGroup(bindGroup);
      }
    }
    bindGroup.setTexture('albedoTex', inputColorTexture, linearSampler);
    bindGroup.setTexture('roughnessTex', roughnessTexture, nearestSampler);
    bindGroup.setTexture('normalTex', normalTexture, nearestSampler);
    bindGroup.setTexture('extraTex', inputColorTexture, nearestSampler);
    bindGroup.setTexture('depthTex', sceneDepthTexture, nearestSampler);
    bindGroup.setTexture('zGGXLut', getGGXLUT(1024), fetchSampler('clamp_nearest_nomip'));
    bindGroup.setValue('cameraNearFar', new Vector2(ctx.camera.getNearPlane(), ctx.camera.getFarPlane()));
    bindGroup.setValue('cameraPos', ctx.camera.getWorldPosition());
    bindGroup.setValue('invProjMatrix', Matrix4x4.invert(ctx.camera.getProjectionMatrix()));
    bindGroup.setValue('projMatrix', ctx.camera.getProjectionMatrix());
    bindGroup.setValue('viewMatrix', ctx.camera.viewMatrix);
    bindGroup.setValue('invViewMatrix', ctx.camera.worldMatrix);
    bindGroup.setValue('ssrParams', ctx.camera.ssrParams);
    bindGroup.setValue('ssrMaxRoughness', ctx.camera.ssrMaxRoughness);
    bindGroup.setValue('ssrStrengthMode', 0);
    if (ctx.HiZTexture) {
      bindGroup.setTexture('hizTex', ctx.HiZTexture, nearestSampler);
      bindGroup.setValue('depthMipLevels', ctx.HiZTexture.mipLevelCount);
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
    this._temporalBindGroup.setTexture(
      'currentColorTex',
      currentReflectTex,
      fetchSampler('clamp_nearest_nomip')
    );
    this._temporalBindGroup.setTexture(
      'currentDepthTex',
      sceneDepthTexture,
      fetchSampler('clamp_nearest_nomip')
    );
    this._temporalBindGroup.setTexture(
      'motionVector',
      ctx.motionVectorTexture!,
      fetchSampler('clamp_nearest_nomip')
    );
    this._temporalBindGroup.setTexture(
      'prevMotionVector',
      prevMotionVectorTex,
      fetchSampler('clamp_nearest_nomip')
    );
    this._temporalBindGroup.setValue('flip', this.needFlip(device) ? 1 : 0);
    this._temporalBindGroup.setValue(
      'texSize',
      new Vector2(sceneDepthTexture.width, sceneDepthTexture.height)
    );
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
        pingpongFramebuffer[0].getColorAttachments()[0] as Texture2D,
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
        pingpongFramebuffer[1].getColorAttachments()[0] as Texture2D,
        pingpongFramebuffer[0]
      );
    }
    const historyManager = ctx.camera.getHistoryResourceManager();
    let reflectanceTex = pingpongFramebuffer[0].getColorAttachments()[0] as Texture2D;
    const prevSSRReflectTex = historyManager!.tryGetPrevious(RGHistoryResources.SSR_REFLECT);
    const prevSSRMotionVectorTex = historyManager!.tryGetPrevious(RGHistoryResources.SSR_MOTION_VECTOR);
    const canTemporal =
      ctx.camera.ssrTemporal &&
      !!ctx.motionVectorTexture &&
      !!prevSSRReflectTex &&
      !!prevSSRMotionVectorTex &&
      prevSSRReflectTex.width === reflectanceTex.width &&
      prevSSRReflectTex.height === reflectanceTex.height;
    if (canTemporal) {
      this.temporal(
        ctx,
        reflectanceTex,
        sceneDepthTexture,
        prevSSRReflectTex as Texture2D,
        prevSSRMotionVectorTex as Texture2D,
        pingpongFramebuffer[1]
      );
      reflectanceTex = pingpongFramebuffer[1].getColorAttachments()[0] as Texture2D;
    }
    device.popDeviceStates();
    this.combine(ctx, inputColorTexture, reflectanceTex, srgbOutput);
    if (ctx.camera.ssrTemporal) {
      const reflectanceSize = { width: reflectanceTex.width, height: reflectanceTex.height };
      historyManager!.queueRetainedCommit(
        RGHistoryResources.SSR_REFLECT,
        {
          format: reflectanceTex.format,
          sizeMode: 'absolute',
          width: reflectanceTex.width,
          height: reflectanceTex.height
        },
        reflectanceSize,
        reflectanceTex
      );
    }
    if (ctx.camera.ssrTemporal && ctx.motionVectorTexture) {
      const motionVectorSize = {
        width: ctx.motionVectorTexture.width,
        height: ctx.motionVectorTexture.height
      };
      historyManager!.queueRetainedCommit(
        RGHistoryResources.SSR_MOTION_VECTOR,
        {
          format: ctx.motionVectorTexture.format,
          sizeMode: 'absolute',
          width: ctx.motionVectorTexture.width,
          height: ctx.motionVectorTexture.height
        },
        motionVectorSize,
        ctx.motionVectorTexture
      );
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
        this.albedoTex = pb.tex2D().uniform(0);
        this.extraTex = pb.tex2D().uniform(0);
        this.normalTex = pb.tex2D().uniform(0);
        // Linear depth is r32f/rg32f and is only sampled with nearest
        // filtering, so it must use the non-filtering float sample type on
        // adapters without float32-filterable.
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.zGGXLut = pb.tex2D().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.viewMatrix = pb.mat4().uniform(0);
        this.invProjMatrix = pb.mat4().uniform(0);
        this.ssrMaxRoughness = pb.float().uniform(0);
        this.ssrStrengthMode = pb.int().uniform(0);
        this.srgbOut = pb.int().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.func('getPosition', [pb.vec2('uv')], function () {
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
          this.$l.viewPos4 = pb.mul(this.invProjMatrix, this.clipSpacePos);
          this.$return(pb.vec4(pb.div(this.viewPos4.xyz, this.viewPos4.w), this.linearDepth));
        });
        pb.func('resolveDeferredStrength', [pb.vec2('uv'), pb.vec4('roughnessValue')], function () {
          this.$l.roughness = pb.clamp(this.roughnessValue.a, 0.045, 1);
          this.$l.base = pb.textureSampleLevel(this.albedoTex, this.uv, 0);
          // Hybrid may merge forward-only SSR surface data into the roughness MRT while the
          // deferred GBuffer remains empty at those pixels. Fall back to forward SSR semantics
          // there instead of decoding the mixed texture as deferred metallic/occlusion/F0 data.
          this.$if(pb.lessThanEqual(this.base.a, 1e-5), function () {
            this.$return(pb.clamp(this.roughnessValue.rgb, pb.vec3(0), pb.vec3(1)));
          });
          this.$l.pos = this.getPosition(this.uv);
          this.$if(pb.greaterThanEqual(this.pos.w, 1), function () {
            this.$return(pb.vec3(0));
          });
          this.$l.viewPos = this.pos.xyz;
          this.$l.viewVec = pb.neg(pb.normalize(this.viewPos));
          this.$l.worldNormal = pb.sub(
            pb.mul(pb.textureSampleLevel(this.normalTex, this.uv, 0).rgb, 2),
            pb.vec3(1)
          );
          this.$l.viewNormal = pb.normalize(pb.mul(this.viewMatrix, pb.vec4(this.worldNormal, 0)).xyz);
          this.$l.NoV = pb.clamp(pb.dot(this.viewNormal, this.viewVec), 0.0001, 1);
          this.$l.baseColor = this.base.rgb;
          this.$l.extra = pb.textureSampleLevel(this.extraTex, this.uv, 0);
          this.$l.metallic = pb.clamp(this.roughnessValue.r, 0, 1);
          this.$l.occlusion = pb.clamp(this.roughnessValue.g, 0, 1);
          this.$l.specStrength = pb.clamp(this.roughnessValue.b, 0, 1);
          this.$l.specularWeight = pb.clamp(this.extra.a, 0, 1);
          this.$l.f0 = pb.mix(pb.mul(pb.vec3(0.04), this.specStrength), this.baseColor, this.metallic);
          this.$l.Fr = pb.sub(pb.max(pb.vec3(pb.sub(1, this.roughness)), this.f0), this.f0);
          this.$l.kS = pb.add(this.f0, pb.mul(this.Fr, pb.pow(pb.sub(1, this.NoV), 5)));
          this.$l.fab = pb.clamp(
            pb.textureSampleLevel(
              this.zGGXLut,
              pb.clamp(pb.vec2(this.NoV, this.roughness), pb.vec2(0), pb.vec2(1)),
              0
            ).rg,
            pb.vec2(0),
            pb.vec2(1)
          );
          this.$l.FssEss = pb.add(pb.mul(this.kS, this.fab.x), pb.vec3(this.fab.y));
          this.$return(
            pb.clamp(pb.mul(this.FssEss, this.occlusion, this.specularWeight), pb.vec3(0), pb.vec3(1))
          );
        });
        pb.func(
          'resolveSample',
          [pb.vec2('uv'), pb.vec3('sceneColor'), pb.vec3('reflectance'), pb.vec4('roughnessValue')],
          function () {
            this.$l.r = pb.div(this.reflectance, pb.add(this.reflectance, pb.vec3(1)));
            this.$l.strength = pb.vec3();
            this.$if(pb.equal(this.ssrStrengthMode, 0), function () {
              this.strength = pb.clamp(this.roughnessValue.rgb, pb.vec3(0), pb.vec3(1));
            })
              .$elseif(pb.equal(this.ssrStrengthMode, 1), function () {
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
              })
              .$else(function () {
                this.strength = this.resolveDeferredStrength(this.uv, this.roughnessValue);
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
            this.combined = this.resolveSample(
              this.screenUV,
              this.sceneColor,
              this.reflectance,
              this.roughnessInfo
            );
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
        if (ctx.env!.light.envLight?.hasRadiance()) {
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
        this.albedoTex = pb.tex2D().uniform(0);
        this.extraTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.zGGXLut = pb.tex2D().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.viewMatrix = pb.mat4().uniform(0);
        this.invViewMatrix = pb.mat4().uniform(0);
        this.invProjMatrix = pb.mat4().uniform(0);
        this.ssrMaxRoughness = pb.float().uniform(0);
        this.ssrStrengthMode = pb.int().uniform(0);
        if (ctx.env!.light.envLight?.hasRadiance()) {
          this.envLightStrength = pb.float().uniform(0);
          this.envLightSpecularStrength = pb.float().uniform(0);
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
        pb.func('resolveDeferredStrength', [pb.vec2('uv'), pb.vec4('roughnessValue')], function () {
          this.$l.roughness = pb.clamp(this.roughnessValue.a, 0.045, 1);
          this.$l.base = pb.textureSampleLevel(this.albedoTex, this.uv, 0);
          this.$if(pb.lessThanEqual(this.base.a, 1e-5), function () {
            this.$return(pb.clamp(this.roughnessValue.rgb, pb.vec3(0), pb.vec3(1)));
          });
          this.$l.pos = this.getPosition(this.uv, this.invProjMatrix);
          this.$if(pb.greaterThanEqual(this.pos.w, 1), function () {
            this.$return(pb.vec3(0));
          });
          this.$l.viewPos = this.pos.xyz;
          this.$l.viewVec = pb.neg(pb.normalize(this.viewPos));
          this.$l.worldNormal = pb.sub(
            pb.mul(pb.textureSampleLevel(this.normalTex, this.uv, 0).rgb, 2),
            pb.vec3(1)
          );
          this.$l.viewNormal = pb.normalize(pb.mul(this.viewMatrix, pb.vec4(this.worldNormal, 0)).xyz);
          this.$l.NoV = pb.clamp(pb.dot(this.viewNormal, this.viewVec), 0.0001, 1);
          this.$l.baseColor = this.base.rgb;
          this.$l.extra = pb.textureSampleLevel(this.extraTex, this.uv, 0);
          this.$l.metallic = pb.clamp(this.roughnessValue.r, 0, 1);
          this.$l.occlusion = pb.clamp(this.roughnessValue.g, 0, 1);
          this.$l.specStrength = pb.clamp(this.roughnessValue.b, 0, 1);
          this.$l.specularWeight = pb.clamp(this.extra.a, 0, 1);
          this.$l.f0 = pb.mix(pb.mul(pb.vec3(0.04), this.specStrength), this.baseColor, this.metallic);
          this.$l.Fr = pb.sub(pb.max(pb.vec3(pb.sub(1, this.roughness)), this.f0), this.f0);
          this.$l.kS = pb.add(this.f0, pb.mul(this.Fr, pb.pow(pb.sub(1, this.NoV), 5)));
          this.$l.fab = pb.clamp(
            pb.textureSampleLevel(
              this.zGGXLut,
              pb.clamp(pb.vec2(this.NoV, this.roughness), pb.vec2(0), pb.vec2(1)),
              0
            ).rg,
            pb.vec2(0),
            pb.vec2(1)
          );
          this.$l.FssEss = pb.add(pb.mul(this.kS, this.fab.x), pb.vec3(this.fab.y));
          this.$return(
            pb.clamp(pb.mul(this.FssEss, this.occlusion, this.specularWeight), pb.vec3(0), pb.vec3(1))
          );
        });
        pb.func(
          'resolveSample',
          [pb.vec2('uv'), pb.vec3('sceneColor'), pb.vec3('reflectance'), pb.vec4('roughnessValue')],
          function () {
            this.$l.r = pb.div(this.reflectance, pb.add(this.reflectance, pb.vec3(1)));
            this.$l.strength = pb.vec3();
            this.$if(pb.equal(this.ssrStrengthMode, 0), function () {
              this.strength = pb.clamp(this.roughnessValue.rgb, pb.vec3(0), pb.vec3(1));
            })
              .$elseif(pb.equal(this.ssrStrengthMode, 1), function () {
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
              })
              .$else(function () {
                this.strength = this.resolveDeferredStrength(this.uv, this.roughnessValue);
              });
            this.color = pb.add(
              pb.mul(this.r, this.strength),
              pb.mul(this.sceneColor, pb.sub(pb.vec3(1), this.strength))
            );
            this.$return(this.color);
          }
        );
        pb.func('resolveEnvRadiance', [pb.vec2('uv'), pb.vec4('roughnessInfo')], function () {
          if (!ctx.env!.light.envLight?.hasRadiance()) {
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
            this.envLightStrength,
            this.envLightSpecularStrength
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
                this.$l.indirectReflectSceneColor = pb.textureSampleLevel(
                  this.colorTex,
                  this.indirectUV,
                  0
                ).rgb;
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
                this.hitUV,
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
  private _createIntersectProgram(ctx: DrawContext, blur: boolean): Nullable<GPUProgram> {
    const program = ctx.device.buildRenderProgram({
      vertex(pb) {
        this.flip = pb.int().uniform(0);
        this.$inputs.pos = pb.vec2().attrib('position');
        this.$outputs.uv = pb.vec2();
        if (!blur && ctx.env!.light.envLight?.hasRadiance()) {
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
          if (ctx.env!.light.envLight?.hasRadiance()) {
            this.envLightStrength = pb.float().uniform(0);
            this.envLightSpecularStrength = pb.float().uniform(0);
            ctx.env!.light.envLight.initShaderBindings(pb);
          }
        }
        this.albedoTex = pb.tex2D().uniform(0);
        this.roughnessTex = pb.tex2D().uniform(0);
        this.normalTex = pb.tex2D().uniform(0);
        this.extraTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.zGGXLut = pb.tex2D().uniform(0);
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
          // Hi-Z is rg32f and is sampled with a nearest sampler. Do not
          // require the optional float32-filterable feature just to bind it.
          this.hizTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
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
        pb.func(
          'resolveDeferredStrength',
          [pb.vec2('uv'), pb.vec4('roughnessValue'), pb.vec4('viewPosInfo')],
          function () {
            this.$l.roughness = pb.clamp(this.roughnessValue.a, 0.045, 1);
            this.$l.base = pb.textureSampleLevel(this.albedoTex, this.uv, 0);
            this.$if(pb.lessThanEqual(this.base.a, 1e-5), function () {
              this.$return(pb.clamp(this.roughnessValue.rgb, pb.vec3(0), pb.vec3(1)));
            });
            this.$l.viewPos = this.viewPosInfo.xyz;
            this.$l.viewVec = pb.neg(pb.normalize(this.viewPos));
            this.$l.worldNormal = pb.sub(
              pb.mul(pb.textureSampleLevel(this.normalTex, this.uv, 0).rgb, 2),
              pb.vec3(1)
            );
            this.$l.viewNormal = pb.normalize(pb.mul(this.viewMatrix, pb.vec4(this.worldNormal, 0)).xyz);
            this.$l.NoV = pb.clamp(pb.dot(this.viewNormal, this.viewVec), 0.0001, 1);
            this.$l.baseColor = this.base.rgb;
            this.$l.extra = pb.textureSampleLevel(this.extraTex, this.uv, 0);
            this.$l.metallic = pb.clamp(this.roughnessValue.r, 0, 1);
            this.$l.occlusion = pb.clamp(this.roughnessValue.g, 0, 1);
            this.$l.specStrength = pb.clamp(this.roughnessValue.b, 0, 1);
            this.$l.specularWeight = pb.clamp(this.extra.a, 0, 1);
            this.$l.f0 = pb.mix(pb.mul(pb.vec3(0.04), this.specStrength), this.baseColor, this.metallic);
            this.$l.Fr = pb.sub(pb.max(pb.vec3(pb.sub(1, this.roughness)), this.f0), this.f0);
            this.$l.kS = pb.add(this.f0, pb.mul(this.Fr, pb.pow(pb.sub(1, this.NoV), 5)));
            this.$l.fab = pb.clamp(
              pb.textureSampleLevel(
                this.zGGXLut,
                pb.clamp(pb.vec2(this.NoV, this.roughness), pb.vec2(0), pb.vec2(1)),
                0
              ).rg,
              pb.vec2(0),
              pb.vec2(1)
            );
            this.$l.FssEss = pb.add(pb.mul(this.kS, this.fab.x), pb.vec3(this.fab.y));
            this.$return(
              pb.clamp(pb.mul(this.FssEss, this.occlusion, this.specularWeight), pb.vec3(0), pb.vec3(1))
            );
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
                  this.ssrParams.x,
                  this.ssrParams.z,
                  this.targetSize,
                  this.hizTex,
                  this.normalTex
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
                if (ctx.env!.light.envLight?.hasRadiance()) {
                  this.$l.reflectVecW = pb.mul(this.invViewMatrix, pb.vec4(this.reflectVec, 0)).xyz;
                  this.$l.env = pb.mul(
                    ctx.env!.light.envLight.getRadiance(this, this.reflectVecW, this.roughness)!,
                    this.envLightStrength,
                    this.envLightSpecularStrength
                  );
                } else {
                  this.$l.env = pb.vec3(0);
                }
                this.$l.reflectance = pb.mix(
                  this.env,
                  pb.textureSampleLevel(this.colorTex, this.hitUV, 0).rgb,
                  this.hitAlpha
                );
                this.$l.reflectance = pb.div(this.$l.reflectance, pb.add(this.$l.reflectance, pb.vec3(1)));
                this.$l.strength = pb.vec3();
                this.$if(pb.equal(this.ssrStrengthMode, 0), function () {
                  this.strength = pb.clamp(this.roughnessValue.rgb, pb.vec3(0), pb.vec3(1));
                })
                  .$elseif(pb.equal(this.ssrStrengthMode, 1), function () {
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
                  })
                  .$else(function () {
                    this.strength = this.resolveDeferredStrength(
                      this.screenUV,
                      this.roughnessValue,
                      this.pos
                    );
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
    });
    if (!program) {
      return null;
    }
    program.name = blur ? '@SSR_Intersect_Blur' : '@SSR_Intersect';
    return program;
  }
}
