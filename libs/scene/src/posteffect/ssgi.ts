import { Matrix4x4, Vector2, Vector4 } from '@zephyr3d/base';
import type { BindGroup, FrameBuffer, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { FrameResources } from '../render/rendergraph/blackboard';
import { RGHistoryResources } from '../render/rendergraph/history_resources';
import type { RGHandle, RGPassBuilder, RGTextureDesc } from '../render/rendergraph/types';
import { screenSpaceRayTracing_HiZ, screenSpaceRayTracing_Linear2D } from '../shaders/ssr';
import { ShaderHelper } from '../material';
import { fetchSampler } from '../utility/misc';
import { AbstractPostEffect, PostEffectLayer } from './posteffect';
import type { PostEffectSetupContext } from './posteffect';

const IRRADIANCE_FORMAT = 'rgba16f' as const;
const SURFACE_FORMAT = 'rgba16f' as const;
const MOMENTS_FORMAT = 'rgba16f' as const;

/**
 * Screen-space diffuse global illumination.
 *
 * The effect traces diffuse irradiance, temporally accumulates it,
 * performs variance-guided cross-bilateral a-trous filtering, and publishes
 * the result as history. The next opaque light pass consumes that irradiance
 * through the material BRDF; this pass deliberately does not add irradiance
 * directly to SceneColor.
 *
 * @public
 */
export class SSGI extends AbstractPostEffect {
  private static _tracePrograms: Record<string, GPUProgram> = {};
  private static _temporalPrograms: Record<string, GPUProgram> = {};
  private static _atrousProgram: GPUProgram | null = null;
  private static _surfaceProgram: GPUProgram | null = null;
  private static _upsampleProgram: GPUProgram | null = null;

  private _traceBindGroups: Record<string, BindGroup> = {};
  private _temporalBindGroups: Record<string, BindGroup> = {};
  private _atrousBindGroup: BindGroup | null = null;
  private _surfaceBindGroup: BindGroup | null = null;
  private _upsampleBindGroup: BindGroup | null = null;

  constructor() {
    super();
    this._layer = PostEffectLayer.opaque;
  }

  /** {@inheritDoc AbstractPostEffect.requireLinearDepthTexture} */
  requireLinearDepthTexture(ctx: DrawContext) {
    return !!ctx.SSGI;
  }

  /** {@inheritDoc AbstractPostEffect.requireMotionVectorTexture} */
  requireMotionVectorTexture(ctx: DrawContext) {
    return !!ctx.SSGI && ctx.device.type === 'webgpu';
  }

  /** {@inheritDoc AbstractPostEffect.requireHiZTexture} */
  requireHiZTexture(ctx: DrawContext) {
    return !!ctx.SSGI && ctx.device.type === 'webgpu';
  }

  /** {@inheritDoc AbstractPostEffect.requireSceneNormalTexture} */
  requireSceneNormalTexture(ctx: DrawContext) {
    return !!ctx.SSGI;
  }

  /** Build trace, temporal, denoise, upsample, history and pass-through stages. */
  setup(s: PostEffectSetupContext): RGHandle {
    const { graph, ctx, history, blackboard } = s;
    if (!ctx.SSGI || !history) {
      return s.input;
    }
    const linearDepthHandle = blackboard.get(FrameResources.LinearDepth);
    const normalHandle = blackboard.get(FrameResources.SceneNormal);
    const motionHandle = blackboard.get(FrameResources.MotionVector);
    const hiZHandle = blackboard.get(FrameResources.HiZ);
    if (!linearDepthHandle || !normalHandle) {
      return s.input;
    }

    const settings = ctx.camera.ssgiResolvedSettings;
    const traceWidth = settings.halfRes ? Math.max(1, Math.ceil(s.width * 0.5)) : s.width;
    const traceHeight = settings.halfRes ? Math.max(1, Math.ceil(s.height * 0.5)) : s.height;
    const traceSize = { width: traceWidth, height: traceHeight };
    const fullSize = { width: s.width, height: s.height };
    const traceDesc: RGTextureDesc = {
      format: IRRADIANCE_FORMAT,
      sizeMode: 'absolute',
      width: traceWidth,
      height: traceHeight
    };
    const fullIrradianceDesc: RGTextureDesc = {
      format: IRRADIANCE_FORMAT,
      sizeMode: 'absolute',
      width: s.width,
      height: s.height
    };
    const surfaceDesc: RGTextureDesc = {
      format: SURFACE_FORMAT,
      sizeMode: 'absolute',
      width: s.width,
      height: s.height
    };
    const momentsDesc: RGTextureDesc = {
      format: MOMENTS_FORMAT,
      sizeMode: 'absolute',
      width: traceWidth,
      height: traceHeight
    };

    const findHistoryRead = (name: string) =>
      s.historyReads.find((binding) => binding.name === name)?.handle ?? null;
    const previousIrradianceHandle = findHistoryRead(RGHistoryResources.SSGI_IRRADIANCE);
    const previousSurfaceHandle = findHistoryRead(RGHistoryResources.SSGI_SURFACE);
    const previousMomentsHandle = history.importPreviousIfCompatible(
      graph,
      RGHistoryResources.SSGI_MOMENTS,
      momentsDesc,
      traceSize
    );
    const previousSceneColorHandle =
      ctx.device.type === 'webgpu'
        ? history.importPreviousIfCompatible(
            graph,
            RGHistoryResources.SSGI_SCENE_COLOR,
            {
              format: s.colorFormat,
              sizeMode: 'absolute',
              width: s.width,
              height: s.height
            },
            fullSize
          )
        : null;
    const canSampleSceneHistory = !!(previousSceneColorHandle && previousSurfaceHandle && motionHandle);

    const readFrameInputs = (builder: RGPassBuilder) => {
      builder.read(linearDepthHandle);
      builder.read(normalHandle);
      if (motionHandle) {
        builder.read(motionHandle);
      }
      if (hiZHandle) {
        builder.read(hiZHandle);
      }
      for (const dep of s.dependencies) {
        builder.read(dep);
      }
    };

    // Trace one or two cosine-weighted diffuse rays. A hit resolves through
    // previousHitUV = hitUV - motion(hitUV); low confidence blends to IBL.
    const rawIrradianceHandle = graph.addPass('SSGI:Trace', (builder) => {
      builder.read(s.input);
      readFrameInputs(builder);
      if (canSampleSceneHistory) {
        builder.read(previousSceneColorHandle!);
        builder.read(previousSurfaceHandle!);
      }
      const out = builder.createTexture({ ...traceDesc, label: 'SSGI:rawIrradiance' });
      const fb = builder.createFramebuffer({
        label: 'SSGI:traceFB',
        width: traceWidth,
        height: traceHeight,
        colorAttachments: out,
        depthAttachment: null,
        ignoreDepthStencil: true
      });
      builder.setExecute((rg) => {
        const device = ctx.device;
        device.pushDeviceStates();
        try {
          device.setFramebuffer(rg.getFramebuffer<FrameBuffer>(fb));
          this.trace(
            ctx,
            canSampleSceneHistory
              ? rg.getTexture<Texture2D>(previousSceneColorHandle!)
              : rg.getTexture<Texture2D>(s.input),
            rg.getTexture<Texture2D>(linearDepthHandle),
            rg.getTexture<Texture2D>(normalHandle),
            motionHandle ? rg.getTexture<Texture2D>(motionHandle) : null,
            canSampleSceneHistory ? rg.getTexture<Texture2D>(previousSurfaceHandle!) : null,
            hiZHandle ? rg.getTexture<Texture2D>(hiZHandle) : null,
            traceWidth,
            traceHeight,
            canSampleSceneHistory
          );
        } finally {
          device.popDeviceStates();
        }
      });
      return out;
    });

    // Store the current full-resolution surface independently from irradiance;
    // no albedo MRT is needed because the next lighting pass applies the BRDF.
    const surfaceHandle = graph.addPass('SSGI:Surface', (builder) => {
      builder.read(linearDepthHandle);
      builder.read(normalHandle);
      const out = builder.createTexture({ ...surfaceDesc, label: 'SSGI:surface' });
      const fb = builder.createFramebuffer({
        label: 'SSGI:surfaceFB',
        width: s.width,
        height: s.height,
        colorAttachments: out,
        depthAttachment: null,
        ignoreDepthStencil: true
      });
      builder.setExecute((rg) => {
        const device = ctx.device;
        device.pushDeviceStates();
        try {
          device.setFramebuffer(rg.getFramebuffer<FrameBuffer>(fb));
          this.writeSurface(
            ctx,
            rg.getTexture<Texture2D>(linearDepthHandle),
            rg.getTexture<Texture2D>(normalHandle)
          );
        } finally {
          device.popDeviceStates();
        }
      });
      return out;
    });

    const canTemporal = !!(
      ctx.device.type === 'webgpu' &&
      ctx.camera.ssgiTemporal &&
      motionHandle &&
      previousIrradianceHandle &&
      previousSurfaceHandle &&
      previousMomentsHandle
    );

    // Temporal pass always creates moments. On the first frame it simply
    // initializes them; with valid history it rejects by depth and normal,
    // neighborhood-clamps radiance, and accumulates first/second moments.
    const temporalResult = graph.addPass('SSGI:Temporal', (builder) => {
      builder.read(rawIrradianceHandle);
      readFrameInputs(builder);
      if (canTemporal) {
        builder.read(previousIrradianceHandle!);
        builder.read(previousSurfaceHandle!);
        builder.read(previousMomentsHandle!);
      }
      const irradiance = builder.createTexture({ ...traceDesc, label: 'SSGI:temporalIrradiance' });
      const moments = builder.createTexture({ ...momentsDesc, label: 'SSGI:moments' });
      const fb = builder.createFramebuffer({
        label: 'SSGI:temporalFB',
        width: traceWidth,
        height: traceHeight,
        colorAttachments: [irradiance, moments],
        depthAttachment: null,
        ignoreDepthStencil: true
      });
      builder.setExecute((rg) => {
        const device = ctx.device;
        device.pushDeviceStates();
        try {
          device.setFramebuffer(rg.getFramebuffer<FrameBuffer>(fb));
          this.temporal(
            ctx,
            rg.getTexture<Texture2D>(rawIrradianceHandle),
            rg.getTexture<Texture2D>(linearDepthHandle),
            rg.getTexture<Texture2D>(normalHandle),
            canTemporal ? rg.getTexture<Texture2D>(motionHandle!) : null,
            canTemporal ? rg.getTexture<Texture2D>(previousIrradianceHandle!) : null,
            canTemporal ? rg.getTexture<Texture2D>(previousSurfaceHandle!) : null,
            canTemporal ? rg.getTexture<Texture2D>(previousMomentsHandle!) : null,
            traceWidth,
            traceHeight
          );
        } finally {
          device.popDeviceStates();
        }
      });
      return { irradiance, moments };
    });

    // Variance-guided, cross-bilateral a-trous filtering. The increasing
    // kernel step removes low-frequency Monte Carlo noise while depth/normal
    // weights preserve discontinuities.
    let filteredHandle = temporalResult.irradiance;
    for (let pass = 0; pass < settings.denoisePasses; pass++) {
      const source = filteredHandle;
      filteredHandle = graph.addPass(`SSGI:ATrous:${pass}`, (builder) => {
        builder.read(source);
        builder.read(temporalResult.moments);
        builder.read(linearDepthHandle);
        builder.read(normalHandle);
        const out = builder.createTexture({ ...traceDesc, label: `SSGI:atrous${pass}` });
        const fb = builder.createFramebuffer({
          label: `SSGI:atrousFB${pass}`,
          width: traceWidth,
          height: traceHeight,
          colorAttachments: out,
          depthAttachment: null,
          ignoreDepthStencil: true
        });
        builder.setExecute((rg) => {
          const device = ctx.device;
          device.pushDeviceStates();
          try {
            device.setFramebuffer(rg.getFramebuffer<FrameBuffer>(fb));
            this.atrous(
              ctx,
              rg.getTexture<Texture2D>(source),
              rg.getTexture<Texture2D>(temporalResult.moments),
              rg.getTexture<Texture2D>(linearDepthHandle),
              rg.getTexture<Texture2D>(normalHandle),
              traceWidth,
              traceHeight,
              1 << pass
            );
          } finally {
            device.popDeviceStates();
          }
        });
        return out;
      });
    }

    // Half-resolution presets use a joint bilateral upsample before history is
    // consumed by full-resolution materials on the next frame.
    let finalIrradianceHandle = filteredHandle;
    if (settings.halfRes) {
      const source = filteredHandle;
      finalIrradianceHandle = graph.addPass('SSGI:Upsample', (builder) => {
        builder.read(source);
        builder.read(linearDepthHandle);
        builder.read(normalHandle);
        const out = builder.createTexture({ ...fullIrradianceDesc, label: 'SSGI:upsampledIrradiance' });
        const fb = builder.createFramebuffer({
          label: 'SSGI:upsampleFB',
          width: s.width,
          height: s.height,
          colorAttachments: out,
          depthAttachment: null,
          ignoreDepthStencil: true
        });
        builder.setExecute((rg) => {
          const device = ctx.device;
          device.pushDeviceStates();
          try {
            device.setFramebuffer(rg.getFramebuffer<FrameBuffer>(fb));
            this.upsample(
              ctx,
              rg.getTexture<Texture2D>(source),
              rg.getTexture<Texture2D>(linearDepthHandle),
              rg.getTexture<Texture2D>(normalHandle)
            );
          } finally {
            device.popDeviceStates();
          }
        });
        return out;
      });
    }

    // SSGI history is independent from TAA/SSR history. Commit the opaque HDR
    // SceneColor input (before SSR/transparency/tone-map/AA), irradiance,
    // surface and moments, then pass SceneColor through unchanged.
    return graph.addPass('SSGI:Commit', (builder) => {
      builder.read(s.input);
      builder.read(finalIrradianceHandle);
      builder.read(surfaceHandle);
      builder.read(temporalResult.moments);
      const output = s.createOutput(builder);
      builder.setExecute((rg) => {
        const device = ctx.device;
        device.pushDeviceStates();
        try {
          device.setFramebuffer(
            output.framebuffer ? rg.getFramebuffer<FrameBuffer>(output.framebuffer) : null
          );
          const sceneColor = rg.getTexture<Texture2D>(s.input);
          const irradiance = rg.getTexture<Texture2D>(finalIrradianceHandle);
          const surface = rg.getTexture<Texture2D>(surfaceHandle);
          const moments = rg.getTexture<Texture2D>(temporalResult.moments);
          this.passThrough(ctx, sceneColor, output.srgbOutput);
          if (ctx.device.type === 'webgpu') {
            this.commitHistory(history, RGHistoryResources.SSGI_SCENE_COLOR, sceneColor);
          }
          this.commitHistory(history, RGHistoryResources.SSGI_IRRADIANCE, irradiance);
          this.commitHistory(history, RGHistoryResources.SSGI_SURFACE, surface);
          this.commitHistory(history, RGHistoryResources.SSGI_MOMENTS, moments);
        } finally {
          device.popDeviceStates();
        }
      });
      return output.color;
    });
  }

  /** @internal */
  private commitHistory(
    history: NonNullable<PostEffectSetupContext['history']>,
    name: string,
    texture: Texture2D
  ) {
    history.queueRetainedCommit(
      name,
      {
        format: texture.format,
        sizeMode: 'absolute',
        width: texture.width,
        height: texture.height
      },
      { width: texture.width, height: texture.height },
      texture
    );
  }

  /** @internal */
  private trace(
    ctx: DrawContext,
    sampleColor: Texture2D,
    depth: Texture2D,
    normal: Texture2D,
    motion: Texture2D | null,
    previousSurface: Texture2D | null,
    hiZ: Texture2D | null,
    width: number,
    height: number,
    sampleHistory: boolean
  ) {
    const envHash = ctx.env!.light.getHash();
    const hash = `${ctx.device.type}:${sampleHistory ? 1 : 0}:${hiZ ? 1 : 0}:${ctx.camera.ssgiResolvedSettings.raysPerPixel}:${envHash}`;
    let program = SSGI._tracePrograms[hash];
    if (!program) {
      program = this.createTraceProgram(ctx, !!hiZ, sampleHistory);
      SSGI._tracePrograms[hash] = program;
    }
    let bindGroup = this._traceBindGroups[hash];
    if (!bindGroup) {
      bindGroup = ctx.device.createBindGroup(program.bindGroupLayouts[0]);
      this._traceBindGroups[hash] = bindGroup;
    }
    bindGroup.setTexture(
      'sampleColorTex',
      sampleColor,
      fetchSampler(ctx.device.type === 'webgl' ? 'clamp_nearest_nomip' : 'clamp_linear_nomip')
    );
    bindGroup.setTexture('depthTex', depth, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture('normalTex', normal, fetchSampler('clamp_nearest_nomip'));
    if (sampleHistory) {
      bindGroup.setTexture('motionTex', motion!, fetchSampler('clamp_nearest_nomip'));
      bindGroup.setTexture('previousSurfaceTex', previousSurface!, fetchSampler('clamp_nearest_nomip'));
      bindGroup.setValue(
        'historyRejectParams',
        new Vector2(ctx.camera.ssgiDepthReject, ctx.camera.ssgiNormalReject)
      );
    }
    if (hiZ) {
      bindGroup.setTexture('hizTex', hiZ, fetchSampler('clamp_nearest'));
      bindGroup.setValue('depthMipLevels', hiZ.mipLevelCount);
    }
    bindGroup.setValue('cameraNearFar', new Vector2(ctx.camera.getNearPlane(), ctx.camera.getFarPlane()));
    bindGroup.setValue('viewMatrix', ctx.camera.viewMatrix);
    bindGroup.setValue('invViewMatrix', ctx.camera.worldMatrix);
    bindGroup.setValue('projMatrix', ctx.camera.getProjectionMatrix());
    bindGroup.setValue('invProjMatrix', Matrix4x4.invert(ctx.camera.getProjectionMatrix()));
    bindGroup.setValue(
      'traceParams',
      new Vector4(
        ctx.camera.ssgiMaxDistance,
        ctx.camera.ssgiThickness,
        ctx.camera.ssgiResolvedSettings.maxSteps,
        ctx.camera.ssgiStride
      )
    );
    bindGroup.setValue('targetSize', new Vector4(width, height, depth.width, depth.height));
    bindGroup.setValue(
      'radianceParams',
      new Vector4(
        ctx.camera.ssgiIntensity,
        ctx.camera.ssgiMaxRayIntensity,
        ctx.env!.light.strength,
        ctx.device.frameInfo.frameCounter
      )
    );
    bindGroup.setValue('flip', this.needFlip(ctx.device) ? 1 : 0);
    ctx.env!.light.envLight.updateBindGroup(bindGroup);
    ctx.device.setProgram(program);
    ctx.device.setBindGroup(0, bindGroup);
    this.drawFullscreenQuad(AbstractPostEffect.getDefaultRenderState(ctx, 'always'));
  }

  /** @internal */
  private temporal(
    ctx: DrawContext,
    current: Texture2D,
    depth: Texture2D,
    normal: Texture2D,
    motion: Texture2D | null,
    previousIrradiance: Texture2D | null,
    previousSurface: Texture2D | null,
    previousMoments: Texture2D | null,
    width: number,
    height: number
  ) {
    const hasHistory = !!(motion && previousIrradiance && previousSurface && previousMoments);
    const hash = hasHistory ? 'history' : 'initialize';
    let program = SSGI._temporalPrograms[hash];
    if (!program) {
      program = this.createTemporalProgram(ctx, hasHistory);
      SSGI._temporalPrograms[hash] = program;
    }
    let bindGroup = this._temporalBindGroups[hash];
    if (!bindGroup) {
      bindGroup = ctx.device.createBindGroup(program.bindGroupLayouts[0]);
      this._temporalBindGroups[hash] = bindGroup;
    }
    bindGroup.setTexture('currentTex', current, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture('depthTex', depth, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture('normalTex', normal, fetchSampler('clamp_nearest_nomip'));
    if (hasHistory) {
      bindGroup.setTexture('motionTex', motion!, fetchSampler('clamp_nearest_nomip'));
      bindGroup.setTexture('previousIrradianceTex', previousIrradiance!, fetchSampler('clamp_linear_nomip'));
      bindGroup.setTexture('previousSurfaceTex', previousSurface!, fetchSampler('clamp_nearest_nomip'));
      bindGroup.setTexture('previousMomentsTex', previousMoments!, fetchSampler('clamp_linear_nomip'));
    }
    bindGroup.setValue('targetSize', new Vector4(width, height, depth.width, depth.height));
    bindGroup.setValue(
      'temporalParams',
      new Vector4(
        ctx.camera.ssgiTemporalWeight,
        ctx.camera.ssgiDepthReject,
        ctx.camera.ssgiNormalReject,
        ctx.camera.getFarPlane()
      )
    );
    bindGroup.setValue('flip', this.needFlip(ctx.device) ? 1 : 0);
    ctx.device.setProgram(program);
    ctx.device.setBindGroup(0, bindGroup);
    this.drawFullscreenQuad(AbstractPostEffect.getDefaultRenderState(ctx, 'always'));
  }

  /** @internal */
  private atrous(
    ctx: DrawContext,
    source: Texture2D,
    moments: Texture2D,
    depth: Texture2D,
    normal: Texture2D,
    width: number,
    height: number,
    step: number
  ) {
    let program = SSGI._atrousProgram;
    if (!program) {
      program = this.createAtrousProgram(ctx);
      SSGI._atrousProgram = program;
    }
    if (!this._atrousBindGroup) {
      this._atrousBindGroup = ctx.device.createBindGroup(program.bindGroupLayouts[0]);
    }
    const bindGroup = this._atrousBindGroup;
    bindGroup.setTexture('sourceTex', source, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture('momentsTex', moments, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture('depthTex', depth, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture('normalTex', normal, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setValue('targetSize', new Vector4(width, height, depth.width, depth.height));
    bindGroup.setValue(
      'filterParams',
      new Vector4(
        step,
        Math.max(0.001, ctx.camera.ssgiDepthReject),
        Math.max(1, ctx.camera.ssgiNormalReject * 32),
        4
      )
    );
    bindGroup.setValue('cameraFar', ctx.camera.getFarPlane());
    bindGroup.setValue('flip', this.needFlip(ctx.device) ? 1 : 0);
    ctx.device.setProgram(program);
    ctx.device.setBindGroup(0, bindGroup);
    this.drawFullscreenQuad(AbstractPostEffect.getDefaultRenderState(ctx, 'always'));
  }

  /** @internal */
  private writeSurface(ctx: DrawContext, depth: Texture2D, normal: Texture2D) {
    let program = SSGI._surfaceProgram;
    if (!program) {
      program = this.createSurfaceProgram(ctx);
      SSGI._surfaceProgram = program;
    }
    if (!this._surfaceBindGroup) {
      this._surfaceBindGroup = ctx.device.createBindGroup(program.bindGroupLayouts[0]);
    }
    this._surfaceBindGroup.setTexture('depthTex', depth, fetchSampler('clamp_nearest_nomip'));
    this._surfaceBindGroup.setTexture('normalTex', normal, fetchSampler('clamp_nearest_nomip'));
    this._surfaceBindGroup.setValue('targetSize', new Vector2(depth.width, depth.height));
    this._surfaceBindGroup.setValue('cameraFar', ctx.camera.getFarPlane());
    this._surfaceBindGroup.setValue('flip', this.needFlip(ctx.device) ? 1 : 0);
    ctx.device.setProgram(program);
    ctx.device.setBindGroup(0, this._surfaceBindGroup);
    this.drawFullscreenQuad(AbstractPostEffect.getDefaultRenderState(ctx, 'always'));
  }

  /** @internal */
  private upsample(ctx: DrawContext, source: Texture2D, depth: Texture2D, normal: Texture2D) {
    let program = SSGI._upsampleProgram;
    if (!program) {
      program = this.createUpsampleProgram(ctx);
      SSGI._upsampleProgram = program;
    }
    if (!this._upsampleBindGroup) {
      this._upsampleBindGroup = ctx.device.createBindGroup(program.bindGroupLayouts[0]);
    }
    this._upsampleBindGroup.setTexture('sourceTex', source, fetchSampler('clamp_nearest_nomip'));
    this._upsampleBindGroup.setTexture('depthTex', depth, fetchSampler('clamp_nearest_nomip'));
    this._upsampleBindGroup.setTexture('normalTex', normal, fetchSampler('clamp_nearest_nomip'));
    this._upsampleBindGroup.setValue(
      'targetSize',
      new Vector4(source.width, source.height, depth.width, depth.height)
    );
    this._upsampleBindGroup.setValue(
      'guideParams',
      new Vector4(
        Math.max(0.001, ctx.camera.ssgiDepthReject),
        Math.max(1, ctx.camera.ssgiNormalReject * 32),
        ctx.camera.getFarPlane(),
        0
      )
    );
    this._upsampleBindGroup.setValue('flip', this.needFlip(ctx.device) ? 1 : 0);
    ctx.device.setProgram(program);
    ctx.device.setBindGroup(0, this._upsampleBindGroup);
    this.drawFullscreenQuad(AbstractPostEffect.getDefaultRenderState(ctx, 'always'));
  }

  /** @internal */
  private createTraceProgram(ctx: DrawContext, useHiZ: boolean, sampleHistory: boolean) {
    const raysPerPixel = ctx.camera.ssgiResolvedSettings.raysPerPixel;
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
        this.sampleColorTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().uniform(0);
        this.normalTex = pb.tex2D().uniform(0);
        if (sampleHistory) {
          this.motionTex = pb.tex2D().uniform(0);
          this.previousSurfaceTex = pb.tex2D().uniform(0);
          this.historyRejectParams = pb.vec2().uniform(0);
        }
        if (useHiZ) {
          this.hizTex = pb.tex2D().uniform(0);
          this.depthMipLevels = pb.int().uniform(0);
        }
        this.cameraNearFar = pb.vec2().uniform(0);
        this.viewMatrix = pb.mat4().uniform(0);
        this.invViewMatrix = pb.mat4().uniform(0);
        this.projMatrix = pb.mat4().uniform(0);
        this.invProjMatrix = pb.mat4().uniform(0);
        this.traceParams = pb.vec4().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.radianceParams = pb.vec4().uniform(0);
        ctx.env!.light.envLight.initShaderBindings(pb);
        this.$outputs.outColor = pb.vec4();
        pb.func('SSGI_getPosition', [pb.vec2('uv')], function () {
          this.$l.linearDepth = ShaderHelper.sampleLinearDepth(this, this.depthTex, this.uv, 0);
          this.$l.nonLinearDepth = pb.div(
            pb.sub(pb.div(this.cameraNearFar.x, this.linearDepth), this.cameraNearFar.y),
            pb.sub(this.cameraNearFar.x, this.cameraNearFar.y)
          );
          this.$l.clipPos = pb.vec4(
            pb.sub(pb.mul(this.uv, 2), pb.vec2(1)),
            pb.sub(pb.mul(pb.clamp(this.nonLinearDepth, 0, 1), 2), 1),
            1
          );
          this.$l.viewPos = pb.mul(this.invProjMatrix, this.clipPos);
          this.$return(pb.vec4(pb.div(this.viewPos.xyz, this.viewPos.w), this.linearDepth));
        });
        pb.func('SSGI_hash22', [pb.vec2('p'), pb.float('seed')], function () {
          this.$l.q = pb.vec2(pb.dot(this.p, pb.vec2(127.1, 311.7)), pb.dot(this.p, pb.vec2(269.5, 183.3)));
          this.$return(pb.fract(pb.mul(pb.sin(pb.add(this.q, this.seed)), 43758.5453)));
        });
        pb.func('SSGI_cosineDirection', [pb.vec3('n'), pb.vec2('xi')], function () {
          this.$l.up = this.$choice(pb.lessThan(pb.abs(this.n.z), 0.999), pb.vec3(0, 0, 1), pb.vec3(1, 0, 0));
          this.$l.tangent = pb.normalize(pb.cross(this.up, this.n));
          this.$l.bitangent = pb.cross(this.n, this.tangent);
          this.$l.r = pb.sqrt(this.xi.x);
          this.$l.phi = pb.mul(2 * Math.PI, this.xi.y);
          this.$l.local = pb.vec3(
            pb.mul(this.r, pb.cos(this.phi)),
            pb.mul(this.r, pb.sin(this.phi)),
            pb.sqrt(pb.max(0, pb.sub(1, this.xi.x)))
          );
          this.$return(
            pb.normalize(
              pb.add(
                pb.mul(this.tangent, this.local.x),
                pb.mul(this.bitangent, this.local.y),
                pb.mul(this.n, this.local.z)
              )
            )
          );
        });
        pb.main(function () {
          this.$l.uv = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.targetSize.xy);
          this.$l.pos = this.SSGI_getPosition(this.uv);
          this.$if(pb.greaterThanEqual(this.pos.w, 1), function () {
            this.$outputs.outColor = pb.vec4(0);
          }).$else(function () {
            this.$l.worldNormal = pb.normalize(
              pb.sub(pb.mul(pb.textureSampleLevel(this.normalTex, this.uv, 0).rgb, 2), pb.vec3(1))
            );
            this.$l.viewNormal = pb.normalize(pb.mul(this.viewMatrix, pb.vec4(this.worldNormal, 0)).xyz);
            // Use the SH-integrated diffuse IBL as an exact, noise-free
            // baseline. Stochastic rays only estimate the screen-space
            // replacement relative to the environment in the same direction.
            this.$l.iblIrradiance = pb.mul(
              ctx.env!.light.envLight.getIrradiance(this, this.worldNormal),
              this.radianceParams.z,
              Math.PI
            );
            this.$l.correctionSum = pb.vec3(0);
            this.$for(pb.float('rayIndex'), 0, raysPerPixel, function () {
              this.$l.xi = this.SSGI_hash22(
                pb.add(pb.mul(this.uv, this.targetSize.xy), pb.vec2(this.rayIndex, pb.mul(this.rayIndex, 7))),
                pb.add(this.radianceParams.w, pb.mul(this.rayIndex, 17))
              );
              this.$l.worldRay = this.SSGI_cosineDirection(this.worldNormal, this.xi);
              this.$l.viewRay = pb.normalize(pb.mul(this.viewMatrix, pb.vec4(this.worldRay, 0)).xyz);
              this.$l.rayOrigin = pb.add(this.pos.xyz, pb.mul(this.viewNormal, this.traceParams.y, 0.25));
              if (useHiZ) {
                this.$l.hit = screenSpaceRayTracing_HiZ(
                  this,
                  this.rayOrigin,
                  this.viewRay,
                  this.viewMatrix,
                  this.projMatrix,
                  this.invProjMatrix,
                  this.cameraNearFar,
                  this.depthMipLevels,
                  this.traceParams.z,
                  this.traceParams.x,
                  this.traceParams.y,
                  this.targetSize,
                  this.hizTex,
                  this.normalTex
                );
              } else {
                this.$l.hit = screenSpaceRayTracing_Linear2D(
                  this,
                  this.rayOrigin,
                  this.viewRay,
                  this.viewMatrix,
                  this.projMatrix,
                  this.invProjMatrix,
                  this.cameraNearFar,
                  this.traceParams.x,
                  this.traceParams.z,
                  this.traceParams.y,
                  this.traceParams.w,
                  this.targetSize,
                  this.depthTex,
                  this.normalTex
                );
              }
              this.$l.hitConfidence = pb.clamp(this.hit.w, 0, 1);
              this.$l.hitUV = pb.clamp(this.hit.xy, pb.vec2(0), pb.vec2(1));
              this.$l.envRadiance = pb.mul(
                ctx.env!.light.envLight.getRadiance(this, this.worldRay, pb.float(0))!,
                this.radianceParams.z
              );
              if (sampleHistory) {
                this.$l.hitMotion = pb.textureSampleLevel(this.motionTex, this.hitUV, 0).xy;
                this.$l.previousHitUV = pb.sub(this.hitUV, this.hitMotion);
                this.$l.historyValid = pb.and(
                  pb.all(pb.greaterThanEqual(this.previousHitUV, pb.vec2(0))),
                  pb.all(pb.lessThanEqual(this.previousHitUV, pb.vec2(1))),
                  pb.all(pb.lessThan(pb.abs(this.hitMotion), pb.vec2(5e4)))
                );
                this.$l.historyRadiance = pb.textureSampleLevel(
                  this.sampleColorTex,
                  pb.clamp(this.previousHitUV, pb.vec2(0), pb.vec2(1)),
                  0
                ).rgb;
                this.$l.currentHitDepth = pb.mul(
                  ShaderHelper.sampleLinearDepth(this, this.depthTex, this.hitUV, 0),
                  this.cameraNearFar.y
                );
                this.$l.currentHitNormal = pb.normalize(
                  pb.sub(pb.mul(pb.textureSampleLevel(this.normalTex, this.hitUV, 0).rgb, 2), pb.vec3(1))
                );
                this.$l.previousHitSurface = pb.textureSampleLevel(
                  this.previousSurfaceTex,
                  pb.clamp(this.previousHitUV, pb.vec2(0), pb.vec2(1)),
                  0
                );
                this.$l.previousHitNormal = pb.normalize(
                  pb.sub(pb.mul(this.previousHitSurface.rgb, 2), pb.vec3(1))
                );
                this.historyValid = pb.and(
                  this.historyValid,
                  pb.lessThanEqual(
                    pb.abs(pb.sub(this.previousHitSurface.a, this.currentHitDepth)),
                    this.historyRejectParams.x
                  ),
                  pb.greaterThanEqual(
                    pb.dot(this.currentHitNormal, this.previousHitNormal),
                    this.historyRejectParams.y
                  )
                );
                this.$l.screenRadiance = this.historyRadiance;
                this.$l.correctionValidity = pb.mul(this.hitConfidence, pb.float(this.historyValid));
              } else {
                this.$l.screenRadiance = pb.textureSampleLevel(this.sampleColorTex, this.hitUV, 0).rgb;
                this.$l.correctionValidity = this.hitConfidence;
              }
              this.$l.maxComponent = pb.max(
                pb.max(this.screenRadiance.r, this.screenRadiance.g),
                this.screenRadiance.b
              );
              this.$l.fireflyScale = this.$choice(
                pb.greaterThan(this.maxComponent, this.radianceParams.y),
                pb.div(this.radianceParams.y, pb.max(this.maxComponent, 1e-5)),
                pb.float(1)
              );
              this.$l.clampedScreenRadiance = pb.mul(this.screenRadiance, this.fireflyScale);
              this.$l.correction = pb.mul(
                pb.sub(this.clampedScreenRadiance, this.envRadiance),
                this.correctionValidity,
                this.radianceParams.x,
                Math.PI
              );
              this.correctionSum = pb.add(this.correctionSum, this.correction);
            });
            this.$l.irradiance = pb.add(this.iblIrradiance, pb.div(this.correctionSum, raysPerPixel));
            this.$outputs.outColor = pb.vec4(pb.max(this.irradiance, pb.vec3(0)), 1);
          });
        });
      }
    })!;
    program.name = '@SSGI_Trace';
    return program;
  }

  /** @internal */
  private createTemporalProgram(ctx: DrawContext, hasHistory: boolean) {
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
        this.currentTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().uniform(0);
        this.normalTex = pb.tex2D().uniform(0);
        if (hasHistory) {
          this.motionTex = pb.tex2D().uniform(0);
          this.previousIrradianceTex = pb.tex2D().uniform(0);
          this.previousSurfaceTex = pb.tex2D().uniform(0);
          this.previousMomentsTex = pb.tex2D().uniform(0);
        }
        this.targetSize = pb.vec4().uniform(0);
        this.temporalParams = pb.vec4().uniform(0);
        this.$outputs.outIrradiance = pb.vec4();
        this.$outputs.outMoments = pb.vec4();
        pb.func('SSGI_luminance', [pb.vec3('c')], function () {
          this.$return(pb.max(0, pb.dot(this.c, pb.vec3(0.2126, 0.7152, 0.0722))));
        });
        pb.main(function () {
          this.$l.uv = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.targetSize.xy);
          this.$l.current = pb.textureSampleLevel(this.currentTex, this.uv, 0);
          this.$l.result = this.current.rgb;
          this.$l.luminance = this.SSGI_luminance(this.current.rgb);
          this.$l.moment = pb.vec4(this.luminance, pb.mul(this.luminance, this.luminance), 1, 0);
          if (hasHistory) {
            this.$l.motion = pb.textureSampleLevel(this.motionTex, this.uv, 0).xy;
            this.$l.previousUV = pb.sub(this.uv, this.motion);
            this.$l.validUV = pb.and(
              pb.all(pb.greaterThanEqual(this.previousUV, pb.vec2(0))),
              pb.all(pb.lessThanEqual(this.previousUV, pb.vec2(1))),
              pb.all(pb.lessThan(pb.abs(this.motion), pb.vec2(5e4)))
            );
            this.$l.currentDepth = pb.mul(
              ShaderHelper.sampleLinearDepth(this, this.depthTex, this.uv, 0),
              this.temporalParams.w
            );
            this.$l.currentNormal = pb.normalize(
              pb.sub(pb.mul(pb.textureSampleLevel(this.normalTex, this.uv, 0).rgb, 2), pb.vec3(1))
            );
            this.$l.previousSurface = pb.textureSampleLevel(
              this.previousSurfaceTex,
              pb.clamp(this.previousUV, pb.vec2(0), pb.vec2(1)),
              0
            );
            this.$l.previousNormal = pb.normalize(pb.sub(pb.mul(this.previousSurface.rgb, 2), pb.vec3(1)));
            this.$l.surfaceValid = pb.and(
              pb.lessThanEqual(
                pb.abs(pb.sub(this.previousSurface.a, this.currentDepth)),
                this.temporalParams.y
              ),
              pb.greaterThanEqual(pb.dot(this.currentNormal, this.previousNormal), this.temporalParams.z)
            );
            this.$l.neighborhoodMin = this.current.rgb;
            this.$l.neighborhoodMax = this.current.rgb;
            for (let y = -1; y <= 1; y++) {
              for (let x = -1; x <= 1; x++) {
                if (x === 0 && y === 0) {
                  continue;
                }
                this.$l.neighbor = pb.textureSampleLevel(
                  this.currentTex,
                  pb.add(this.uv, pb.div(pb.vec2(x, y), this.targetSize.xy)),
                  0
                ).rgb;
                this.neighborhoodMin = pb.min(this.neighborhoodMin, this.neighbor);
                this.neighborhoodMax = pb.max(this.neighborhoodMax, this.neighbor);
              }
            }
            this.$l.previous = pb.textureSampleLevel(
              this.previousIrradianceTex,
              pb.clamp(this.previousUV, pb.vec2(0), pb.vec2(1)),
              0
            );
            this.$l.previousClamped = pb.clamp(this.previous.rgb, this.neighborhoodMin, this.neighborhoodMax);
            this.$l.previousMoment = pb.textureSampleLevel(
              this.previousMomentsTex,
              pb.clamp(this.previousUV, pb.vec2(0), pb.vec2(1)),
              0
            );
            this.$l.validity = pb.mul(
              pb.float(pb.and(this.validUV, this.surfaceValid)),
              pb.clamp(this.previous.a, 0, 1)
            );
            // Start new histories as a running average, then cap their weight
            // at the configured value once enough samples have accumulated.
            this.$l.runningAverageWeight = pb.div(this.previousMoment.z, pb.add(this.previousMoment.z, 1));
            this.$l.historyWeight = pb.min(this.temporalParams.x, this.runningAverageWeight);
            this.$l.weight = pb.mul(this.historyWeight, this.validity);
            this.result = pb.mix(this.current.rgb, this.previousClamped, this.weight);
            this.$l.momentXY = pb.mix(this.moment.xy, this.previousMoment.xy, this.weight);
            this.$l.historyLength = pb.mix(
              pb.float(1),
              pb.min(32, pb.add(this.previousMoment.z, 1)),
              this.validity
            );
            this.$l.variance = pb.max(0, pb.sub(this.momentXY.y, pb.mul(this.momentXY.x, this.momentXY.x)));
            this.moment = pb.vec4(this.momentXY, this.historyLength, this.variance);
          } else {
            // The WebGL fallback has no motion-vector temporal resolve. Seed
            // a-trous with spatial variance so its luminance weighting can
            // still remove Monte Carlo noise instead of treating it as an edge.
            this.$l.spatialLum = pb.float(0);
            this.$l.spatialLum2 = pb.float(0);
            for (let y = -1; y <= 1; y++) {
              for (let x = -1; x <= 1; x++) {
                this.$l.neighborLum = this.SSGI_luminance(
                  pb.textureSampleLevel(
                    this.currentTex,
                    pb.add(this.uv, pb.div(pb.vec2(x, y), this.targetSize.xy)),
                    0
                  ).rgb
                );
                this.spatialLum = pb.add(this.spatialLum, this.neighborLum);
                this.spatialLum2 = pb.add(this.spatialLum2, pb.mul(this.neighborLum, this.neighborLum));
              }
            }
            this.spatialLum = pb.div(this.spatialLum, 9);
            this.spatialLum2 = pb.div(this.spatialLum2, 9);
            this.$l.spatialVariance = pb.max(
              0,
              pb.sub(this.spatialLum2, pb.mul(this.spatialLum, this.spatialLum))
            );
            this.moment = pb.vec4(this.moment.xyz, this.spatialVariance);
          }
          this.$outputs.outIrradiance = pb.vec4(this.result, this.current.a);
          this.$outputs.outMoments = this.moment;
        });
      }
    })!;
    program.name = hasHistory ? '@SSGI_Temporal' : '@SSGI_TemporalInitialize';
    return program;
  }

  /** @internal */
  private createAtrousProgram(ctx: DrawContext) {
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
        this.sourceTex = pb.tex2D().uniform(0);
        this.momentsTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().uniform(0);
        this.normalTex = pb.tex2D().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.filterParams = pb.vec4().uniform(0);
        this.cameraFar = pb.float().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.func('SSGI_luminance', [pb.vec3('c')], function () {
          this.$return(pb.max(0, pb.dot(this.c, pb.vec3(0.2126, 0.7152, 0.0722))));
        });
        pb.main(function () {
          this.$l.uv = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.targetSize.xy);
          this.$l.center = pb.textureSampleLevel(this.sourceTex, this.uv, 0);
          this.$l.centerDepth = pb.mul(
            ShaderHelper.sampleLinearDepth(this, this.depthTex, this.uv, 0),
            this.cameraFar
          );
          this.$l.centerNormal = pb.normalize(
            pb.sub(pb.mul(pb.textureSampleLevel(this.normalTex, this.uv, 0).rgb, 2), pb.vec3(1))
          );
          this.$l.centerLum = this.SSGI_luminance(this.center.rgb);
          this.$l.moments = pb.textureSampleLevel(this.momentsTex, this.uv, 0);
          this.$l.sigma = pb.add(pb.sqrt(pb.max(this.moments.w, 0)), 0.02);
          this.$l.sum = pb.vec3(0);
          this.$l.weightSum = pb.float(0);
          const kernel = [1, 2 / 3, 1 / 6];
          for (let y = -2; y <= 2; y++) {
            for (let x = -2; x <= 2; x++) {
              const kernelWeight = kernel[Math.abs(x)] * kernel[Math.abs(y)];
              this.$l.sampleUV = pb.add(
                this.uv,
                pb.mul(pb.div(pb.vec2(x, y), this.targetSize.xy), this.filterParams.x)
              );
              this.$l.sampleValue = pb.textureSampleLevel(this.sourceTex, this.sampleUV, 0);
              this.$l.sampleDepth = pb.mul(
                ShaderHelper.sampleLinearDepth(this, this.depthTex, this.sampleUV, 0),
                this.cameraFar
              );
              this.$l.sampleNormal = pb.normalize(
                pb.sub(pb.mul(pb.textureSampleLevel(this.normalTex, this.sampleUV, 0).rgb, 2), pb.vec3(1))
              );
              this.$l.depthWeight = pb.exp(
                pb.neg(
                  pb.div(
                    pb.abs(pb.sub(this.sampleDepth, this.centerDepth)),
                    pb.mul(this.filterParams.y, this.filterParams.x)
                  )
                )
              );
              this.$l.normalWeight = pb.pow(
                pb.max(0, pb.dot(this.centerNormal, this.sampleNormal)),
                this.filterParams.z
              );
              this.$l.colorWeight = pb.exp(
                pb.neg(
                  pb.div(
                    pb.abs(pb.sub(this.SSGI_luminance(this.sampleValue.rgb), this.centerLum)),
                    pb.mul(this.sigma, this.filterParams.w)
                  )
                )
              );
              this.$l.weight = pb.mul(
                kernelWeight,
                this.depthWeight,
                this.normalWeight,
                this.colorWeight,
                this.sampleValue.a
              );
              this.sum = pb.add(this.sum, pb.mul(this.sampleValue.rgb, this.weight));
              this.weightSum = pb.add(this.weightSum, this.weight);
            }
          }
          this.$l.filtered = this.$choice(
            pb.greaterThan(this.weightSum, 1e-5),
            pb.div(this.sum, this.weightSum),
            this.center.rgb
          );
          this.$outputs.outColor = pb.vec4(this.filtered, this.center.a);
        });
      }
    })!;
    program.name = '@SSGI_ATrous';
    return program;
  }

  /** @internal */
  private createSurfaceProgram(ctx: DrawContext) {
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
        this.depthTex = pb.tex2D().uniform(0);
        this.normalTex = pb.tex2D().uniform(0);
        this.targetSize = pb.vec2().uniform(0);
        this.cameraFar = pb.float().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.main(function () {
          this.$l.uv = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.targetSize);
          this.$l.normal = pb.textureSampleLevel(this.normalTex, this.uv, 0).rgb;
          this.$l.depth = pb.mul(
            ShaderHelper.sampleLinearDepth(this, this.depthTex, this.uv, 0),
            this.cameraFar
          );
          this.$outputs.outColor = pb.vec4(this.normal, this.depth);
        });
      }
    })!;
    program.name = '@SSGI_Surface';
    return program;
  }

  /** @internal */
  private createUpsampleProgram(ctx: DrawContext) {
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
        this.sourceTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().uniform(0);
        this.normalTex = pb.tex2D().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.guideParams = pb.vec4().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.main(function () {
          this.$l.uv = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.targetSize.zw);
          this.$l.centerDepth = pb.mul(
            ShaderHelper.sampleLinearDepth(this, this.depthTex, this.uv, 0),
            this.guideParams.z
          );
          this.$l.centerNormal = pb.normalize(
            pb.sub(pb.mul(pb.textureSampleLevel(this.normalTex, this.uv, 0).rgb, 2), pb.vec3(1))
          );
          this.$l.sum = pb.vec3(0);
          this.$l.weightSum = pb.float(0);
          for (let y = -1; y <= 1; y++) {
            for (let x = -1; x <= 1; x++) {
              this.$l.sampleUV = pb.add(this.uv, pb.div(pb.vec2(x, y), this.targetSize.xy));
              this.$l.sampleValue = pb.textureSampleLevel(this.sourceTex, this.sampleUV, 0);
              this.$l.sampleDepth = pb.mul(
                ShaderHelper.sampleLinearDepth(this, this.depthTex, this.sampleUV, 0),
                this.guideParams.z
              );
              this.$l.sampleNormal = pb.normalize(
                pb.sub(pb.mul(pb.textureSampleLevel(this.normalTex, this.sampleUV, 0).rgb, 2), pb.vec3(1))
              );
              this.$l.depthWeight = pb.exp(
                pb.neg(pb.div(pb.abs(pb.sub(this.sampleDepth, this.centerDepth)), this.guideParams.x))
              );
              this.$l.normalWeight = pb.pow(
                pb.max(0, pb.dot(this.centerNormal, this.sampleNormal)),
                this.guideParams.y
              );
              this.$l.weight = pb.mul(this.depthWeight, this.normalWeight, this.sampleValue.a);
              this.sum = pb.add(this.sum, pb.mul(this.sampleValue.rgb, this.weight));
              this.weightSum = pb.add(this.weightSum, this.weight);
            }
          }
          this.$l.result = this.$choice(
            pb.greaterThan(this.weightSum, 1e-5),
            pb.div(this.sum, this.weightSum),
            pb.textureSampleLevel(this.sourceTex, this.uv, 0).rgb
          );
          this.$outputs.outColor = pb.vec4(this.result, pb.float(pb.greaterThan(this.weightSum, 1e-5)));
        });
      }
    })!;
    program.name = '@SSGI_Upsample';
    return program;
  }
}
