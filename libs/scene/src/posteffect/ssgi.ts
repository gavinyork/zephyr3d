import { DEPTH_FARTHEST, Matrix4x4, Vector2, Vector4 } from '@zephyr3d/base';
import type { BindGroup, FrameBuffer, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { FrameResources } from '../render/rendergraph/blackboard';
import { RGHistoryResources } from '../render/rendergraph/history_resources';
import type { RGHandle, RGPassBuilder, RGTextureDesc } from '../render/rendergraph/types';
import { screenSpaceRayTracing_HiZ, screenSpaceRayTracing_Linear2D } from '../shaders/ssr';
import { ShaderHelper } from '../material';
import { linearToGamma } from '../shaders/misc';
import { fetchSampler } from '../utility/misc';
import { AbstractPostEffect, PostEffectLayer } from './posteffect';
import type { PostEffectSetupContext } from './posteffect';

const IRRADIANCE_FORMAT = 'rgba16f' as const;
const SURFACE_FORMAT = 'rgba16f' as const;
const MOMENTS_FORMAT = 'rgba16f' as const;
// Ambient occlusion is a single scalar. SSGI already requires a half float color
// buffer for the irradiance targets, so this format is available wherever the
// effect runs at all.
const AO_FORMAT = 'r16f' as const;
const HALF_FLOAT_MAX = 65504;
// Moments are also rgba16f, so the squared luminance must remain below
// HALF_FLOAT_MAX. 255^2 = 65025 leaves a small rounding margin.
const MOMENT_LUMINANCE_MAX = 255;

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
  private static _compositePrograms: Record<string, GPUProgram> = {};

  private _traceBindGroups: Record<string, BindGroup> = {};
  private _temporalBindGroups: Record<string, BindGroup> = {};
  private _atrousBindGroups: Record<string, BindGroup> = {};
  private _surfaceBindGroups: Record<string, BindGroup> = {};
  private _upsampleBindGroups: Record<string, BindGroup> = {};
  private _compositeBindGroups: Record<string, BindGroup> = {};

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
    // Traced hits read this as outgoing surface radiance, so it must exclude the
    // fog the camera ray accumulated: that fog belongs to a different path than
    // the one being integrated, and feeding it back would brighten every bounce.
    // Absent when the scene has no fog, in which case SceneColor is already fog
    // free. Both the sampled color and the committed history use it, otherwise
    // the current and previous frames would disagree and flicker.
    const noFogHandle = blackboard.get(FrameResources.SceneColorNoFog);
    const sampleColorHandle = noFogHandle ?? s.input;
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
    const aoTraceDesc: RGTextureDesc = {
      format: AO_FORMAT,
      sizeMode: 'absolute',
      width: traceWidth,
      height: traceHeight
    };
    const fullAODesc: RGTextureDesc = {
      format: AO_FORMAT,
      sizeMode: 'absolute',
      width: s.width,
      height: s.height
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
    // Only this effect's own temporal pass reads the AO history, so it is
    // imported directly instead of being routed through the light pass history
    // read bindings the way irradiance and surface are.
    const previousAOHandle = history.importPreviousIfCompatible(
      graph,
      RGHistoryResources.SSGI_AO,
      aoTraceDesc,
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

    // Trace one or two cosine-weighted diffuse rays. A hit prefers the previous
    // frame through previousHitUV = hitUV - motion(hitUV) for multi-bounce
    // feedback and falls back to the current frame when that reprojection fails.
    const traceResult = graph.addPass('SSGI:Trace', (builder) => {
      builder.read(sampleColorHandle);
      readFrameInputs(builder);
      if (canSampleSceneHistory) {
        builder.read(previousSceneColorHandle!);
        builder.read(previousSurfaceHandle!);
      }
      const out = builder.createTexture({ ...traceDesc, label: 'SSGI:rawIrradiance' });
      const ao = builder.createTexture({ ...aoTraceDesc, label: 'SSGI:rawAO' });
      const fb = builder.createFramebuffer({
        label: 'SSGI:traceFB',
        width: traceWidth,
        height: traceHeight,
        colorAttachments: [out, ao],
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
            rg.getTexture<Texture2D>(sampleColorHandle),
            canSampleSceneHistory ? rg.getTexture<Texture2D>(previousSceneColorHandle!) : null,
            rg.getTexture<Texture2D>(linearDepthHandle),
            rg.getTexture<Texture2D>(normalHandle),
            canSampleSceneHistory ? rg.getTexture<Texture2D>(motionHandle!) : null,
            canSampleSceneHistory ? rg.getTexture<Texture2D>(previousSurfaceHandle!) : null,
            hiZHandle ? rg.getTexture<Texture2D>(hiZHandle) : null,
            traceWidth,
            traceHeight
          );
        } finally {
          device.popDeviceStates();
        }
      });
      return { irradiance: out, ao };
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
      previousMomentsHandle &&
      previousAOHandle
    );

    // Temporal pass always creates moments. On the first frame it simply
    // initializes them; with valid history it rejects by depth and normal,
    // neighborhood-clamps radiance, and accumulates first/second moments.
    const temporalResult = graph.addPass('SSGI:Temporal', (builder) => {
      builder.read(traceResult.irradiance);
      builder.read(traceResult.ao);
      readFrameInputs(builder);
      if (canTemporal) {
        builder.read(previousIrradianceHandle!);
        builder.read(previousSurfaceHandle!);
        builder.read(previousMomentsHandle!);
        builder.read(previousAOHandle!);
      }
      const irradiance = builder.createTexture({ ...traceDesc, label: 'SSGI:temporalIrradiance' });
      const moments = builder.createTexture({ ...momentsDesc, label: 'SSGI:moments' });
      const ao = builder.createTexture({ ...aoTraceDesc, label: 'SSGI:temporalAO' });
      const fb = builder.createFramebuffer({
        label: 'SSGI:temporalFB',
        width: traceWidth,
        height: traceHeight,
        colorAttachments: [irradiance, moments, ao],
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
            rg.getTexture<Texture2D>(traceResult.irradiance),
            rg.getTexture<Texture2D>(traceResult.ao),
            rg.getTexture<Texture2D>(linearDepthHandle),
            rg.getTexture<Texture2D>(normalHandle),
            canTemporal ? rg.getTexture<Texture2D>(motionHandle!) : null,
            canTemporal ? rg.getTexture<Texture2D>(previousIrradianceHandle!) : null,
            canTemporal ? rg.getTexture<Texture2D>(previousSurfaceHandle!) : null,
            canTemporal ? rg.getTexture<Texture2D>(previousMomentsHandle!) : null,
            canTemporal ? rg.getTexture<Texture2D>(previousAOHandle!) : null,
            traceWidth,
            traceHeight
          );
        } finally {
          device.popDeviceStates();
        }
      });
      return { irradiance, moments, ao };
    });

    // Variance-guided, cross-bilateral a-trous filtering. The increasing
    // kernel step removes low-frequency Monte Carlo noise while depth/normal
    // weights preserve discontinuities.
    let filteredHandle = temporalResult.irradiance;
    let filteredAOHandle = temporalResult.ao;
    for (let pass = 0; pass < settings.denoisePasses; pass++) {
      const source = filteredHandle;
      const aoSource = filteredAOHandle;
      const filtered = graph.addPass(`SSGI:ATrous:${pass}`, (builder) => {
        builder.read(source);
        builder.read(aoSource);
        builder.read(temporalResult.moments);
        builder.read(linearDepthHandle);
        builder.read(normalHandle);
        const out = builder.createTexture({ ...traceDesc, label: `SSGI:atrous${pass}` });
        const ao = builder.createTexture({ ...aoTraceDesc, label: `SSGI:atrousAO${pass}` });
        const fb = builder.createFramebuffer({
          label: `SSGI:atrousFB${pass}`,
          width: traceWidth,
          height: traceHeight,
          colorAttachments: [out, ao],
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
              rg.getTexture<Texture2D>(aoSource),
              rg.getTexture<Texture2D>(temporalResult.moments),
              rg.getTexture<Texture2D>(linearDepthHandle),
              rg.getTexture<Texture2D>(normalHandle),
              traceWidth,
              traceHeight,
              1 << pass,
              canTemporal
            );
          } finally {
            device.popDeviceStates();
          }
        });
        return { irradiance: out, ao };
      });
      filteredHandle = filtered.irradiance;
      filteredAOHandle = filtered.ao;
    }

    // Half-resolution presets use a joint bilateral upsample before history is
    // consumed by full-resolution materials on the next frame.
    let finalIrradianceHandle = filteredHandle;
    let finalAOHandle = filteredAOHandle;
    if (settings.halfRes) {
      const source = filteredHandle;
      const aoSource = filteredAOHandle;
      const upsampled = graph.addPass('SSGI:Upsample', (builder) => {
        builder.read(source);
        builder.read(aoSource);
        builder.read(linearDepthHandle);
        builder.read(normalHandle);
        const out = builder.createTexture({ ...fullIrradianceDesc, label: 'SSGI:upsampledIrradiance' });
        const ao = builder.createTexture({ ...fullAODesc, label: 'SSGI:upsampledAO' });
        const fb = builder.createFramebuffer({
          label: 'SSGI:upsampleFB',
          width: s.width,
          height: s.height,
          colorAttachments: [out, ao],
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
              rg.getTexture<Texture2D>(aoSource),
              rg.getTexture<Texture2D>(linearDepthHandle),
              rg.getTexture<Texture2D>(normalHandle)
            );
          } finally {
            device.popDeviceStates();
          }
        });
        return { irradiance: out, ao };
      });
      finalIrradianceHandle = upsampled.irradiance;
      finalAOHandle = upsampled.ao;
    }

    // Pinned before the commit closure captures it: the a-trous loop above
    // reassigns the handle, and the AO history has to be the trace-resolution
    // one regardless of whether an upsample ran.
    const traceResolutionAOHandle = filteredAOHandle;

    // SSGI history is independent from TAA/SSR history. Commit the opaque HDR
    // SceneColor input (before SSR/transparency/tone-map/AA), irradiance,
    // surface and moments, then pass SceneColor through unchanged.
    return graph.addPass('SSGI:Commit', (builder) => {
      builder.read(s.input);
      if (noFogHandle) {
        builder.read(noFogHandle);
      }
      builder.read(finalIrradianceHandle);
      builder.read(finalAOHandle);
      // The trace-resolution AO is what goes back into history, so it has to be
      // read here too even when the upsampled one is what gets composited.
      builder.read(traceResolutionAOHandle);
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
          const ao = rg.getTexture<Texture2D>(finalAOHandle);
          const filteredAO = rg.getTexture<Texture2D>(traceResolutionAOHandle);
          const surface = rg.getTexture<Texture2D>(surfaceHandle);
          const moments = rg.getTexture<Texture2D>(temporalResult.moments);
          if (ctx.camera.ssgiAOIntensity > 0) {
            this.compositeAO(ctx, sceneColor, ao, output.srgbOutput);
          } else {
            this.passThrough(ctx, sceneColor, output.srgbOutput);
          }
          if (ctx.device.type === 'webgpu') {
            // Commit the same fog-free color the trace sampled, so next frame's
            // reprojected history is on the same footing as this frame's fallback.
            this.commitHistory(
              history,
              RGHistoryResources.SSGI_SCENE_COLOR,
              rg.getTexture<Texture2D>(sampleColorHandle)
            );
          }
          this.commitHistory(history, RGHistoryResources.SSGI_IRRADIANCE, irradiance);
          this.commitHistory(history, RGHistoryResources.SSGI_SURFACE, surface);
          this.commitHistory(history, RGHistoryResources.SSGI_MOMENTS, moments);
          // Committed at trace resolution: the temporal pass that consumes it
          // runs before the upsample, so a full-resolution AO would fail the
          // descriptor compatibility check and silently disable accumulation.
          this.commitHistory(history, RGHistoryResources.SSGI_AO, filteredAO);
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
    currentColor: Texture2D,
    previousColor: Texture2D | null,
    depth: Texture2D,
    normal: Texture2D,
    motion: Texture2D | null,
    previousSurface: Texture2D | null,
    hiZ: Texture2D | null,
    width: number,
    height: number
  ) {
    const sampleHistory = !!(previousColor && motion && previousSurface);
    const envHash = ctx.env!.light.getHash();
    const historyHash = sampleHistory ? `${previousColor!.uid}:${motion!.uid}:${previousSurface!.uid}` : '';
    const hizHash = hiZ ? `${hiZ.uid}` : '';
    const programHash = `${sampleHistory ? '1' : '0'}:${hiZ ? '1' : '0'}:${ctx.camera.ssgiResolvedSettings.raysPerPixel}:${envHash}`;
    const bindGroupHash = `${currentColor.uid}:${depth.uid}:${normal.uid}:(${historyHash}):(${hizHash}):${ctx.camera.ssgiResolvedSettings.raysPerPixel}:${envHash}`;
    let program = SSGI._tracePrograms[programHash];
    if (!program) {
      program = this.createTraceProgram(ctx, !!hiZ, sampleHistory);
      SSGI._tracePrograms[programHash] = program;
    }
    const colorSampler = fetchSampler(
      ctx.device.type === 'webgl' ? 'clamp_nearest_nomip' : 'clamp_linear_nomip'
    );
    let bindGroup = this._traceBindGroups[bindGroupHash];
    if (!bindGroup) {
      bindGroup = ctx.device.createBindGroup(program.bindGroupLayouts[0]);
      bindGroup.setTexture('currentColorTex', currentColor, colorSampler);
      bindGroup.setTexture('depthTex', depth, fetchSampler('clamp_nearest_nomip'));
      bindGroup.setTexture('normalTex', normal, fetchSampler('clamp_nearest_nomip'));
      if (sampleHistory) {
        bindGroup.setTexture('previousColorTex', previousColor!, colorSampler);
        bindGroup.setTexture('motionTex', motion!, fetchSampler('clamp_nearest_nomip'));
        bindGroup.setTexture('previousSurfaceTex', previousSurface!, fetchSampler('clamp_nearest_nomip'));
      }
      if (hiZ) {
        bindGroup.setTexture('hizTex', hiZ, fetchSampler('clamp_nearest'));
        bindGroup.setValue('depthMipLevels', hiZ.mipLevelCount);
      }
      this._traceBindGroups[bindGroupHash] = bindGroup;
    }
    if (sampleHistory) {
      bindGroup.setValue(
        'historyRejectParams',
        new Vector2(ctx.camera.ssgiDepthReject, ctx.camera.ssgiNormalReject)
      );
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
    bindGroup.setValue(
      'targetSize',
      new Vector4(width, height, hiZ?.width ?? depth.width, hiZ?.height ?? depth.height)
    );
    bindGroup.setValue(
      'radianceParams',
      new Vector4(
        ctx.camera.ssgiIntensity,
        ctx.camera.ssgiMaxRayIntensity,
        ShaderHelper.getEnvLightLuminance(ctx),
        ctx.device.frameInfo.frameCounter
      )
    );
    bindGroup.setValue('skyOcclusion', ctx.camera.ssgiSkyOcclusion);
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
    currentAO: Texture2D,
    depth: Texture2D,
    normal: Texture2D,
    motion: Texture2D | null,
    previousIrradiance: Texture2D | null,
    previousSurface: Texture2D | null,
    previousMoments: Texture2D | null,
    previousAO: Texture2D | null,
    width: number,
    height: number
  ) {
    const hasHistory = !!(motion && previousIrradiance && previousSurface && previousMoments && previousAO);
    const hash = hasHistory
      ? `history:${current.uid}:${currentAO.uid}:${depth.uid}:${normal.uid}:${motion!.uid}:${previousIrradiance!.uid}:${previousSurface.uid}:${previousMoments.uid}:${previousAO!.uid}`
      : `initialize:${current.uid}:${currentAO.uid}:${depth.uid}:${normal.uid}`;
    let program = SSGI._temporalPrograms[hash];
    if (!program) {
      program = this.createTemporalProgram(ctx, hasHistory);
      SSGI._temporalPrograms[hash] = program;
    }
    let bindGroup = this._temporalBindGroups[hash];
    if (!bindGroup) {
      bindGroup = ctx.device.createBindGroup(program.bindGroupLayouts[0]);
      bindGroup.setTexture('currentTex', current, fetchSampler('clamp_nearest_nomip'));
      bindGroup.setTexture('currentAOTex', currentAO, fetchSampler('clamp_nearest_nomip'));
      bindGroup.setTexture('depthTex', depth, fetchSampler('clamp_nearest_nomip'));
      bindGroup.setTexture('normalTex', normal, fetchSampler('clamp_nearest_nomip'));
      if (hasHistory) {
        bindGroup.setTexture('motionTex', motion!, fetchSampler('clamp_nearest_nomip'));
        bindGroup.setTexture(
          'previousIrradianceTex',
          previousIrradiance!,
          fetchSampler('clamp_linear_nomip')
        );
        bindGroup.setTexture('previousSurfaceTex', previousSurface!, fetchSampler('clamp_nearest_nomip'));
        bindGroup.setTexture('previousMomentsTex', previousMoments!, fetchSampler('clamp_linear_nomip'));
        // Linear is safe here: this branch only runs on WebGPU, where r16f is
        // unconditionally filterable, and the read is at a reprojected UV.
        bindGroup.setTexture('previousAOTex', previousAO!, fetchSampler('clamp_linear_nomip'));
      }
      this._temporalBindGroups[hash] = bindGroup;
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
    aoSource: Texture2D,
    moments: Texture2D,
    depth: Texture2D,
    normal: Texture2D,
    width: number,
    height: number,
    step: number,
    hasTemporalHistory: boolean
  ) {
    let program = SSGI._atrousProgram;
    if (!program) {
      program = this.createAtrousProgram(ctx);
      SSGI._atrousProgram = program;
    }
    const hash = `atrous:${source.uid}:${aoSource.uid}:${moments.uid}:${depth.uid}:${normal.uid}`;
    let bindGroup = this._atrousBindGroups[hash];
    if (!bindGroup) {
      bindGroup = ctx.device.createBindGroup(program.bindGroupLayouts[0]);
      bindGroup.setTexture('sourceTex', source, fetchSampler('clamp_nearest_nomip'));
      bindGroup.setTexture('aoSourceTex', aoSource, fetchSampler('clamp_nearest_nomip'));
      bindGroup.setTexture('momentsTex', moments, fetchSampler('clamp_nearest_nomip'));
      bindGroup.setTexture('depthTex', depth, fetchSampler('clamp_nearest_nomip'));
      bindGroup.setTexture('normalTex', normal, fetchSampler('clamp_nearest_nomip'));
      this._atrousBindGroups[hash] = bindGroup;
    }
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
    // Number of accumulated frames a pixel needs before its variance estimate is
    // trusted. Zero disables the ramp for paths that never build history, where
    // the stored length is pinned at 1 and would read as permanently new.
    bindGroup.setValue('denoiseParams', new Vector4(hasTemporalHistory ? 8 : 0, 0, 0, 0));
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
    const hash = `${depth.uid}:${normal.uid}`;
    let bindGroup = this._surfaceBindGroups[hash];
    if (!bindGroup) {
      bindGroup = ctx.device.createBindGroup(program.bindGroupLayouts[0]);
      bindGroup.setTexture('depthTex', depth, fetchSampler('clamp_nearest_nomip'));
      bindGroup.setTexture('normalTex', normal, fetchSampler('clamp_nearest_nomip'));
      bindGroup.setValue('targetSize', new Vector2(depth.width, depth.height));
      this._surfaceBindGroups[hash] = bindGroup;
    }
    bindGroup.setValue('cameraFar', ctx.camera.getFarPlane());
    bindGroup.setValue('flip', this.needFlip(ctx.device) ? 1 : 0);
    ctx.device.setProgram(program);
    ctx.device.setBindGroup(0, bindGroup);
    this.drawFullscreenQuad(AbstractPostEffect.getDefaultRenderState(ctx, 'always'));
  }

  /** @internal */
  private upsample(
    ctx: DrawContext,
    source: Texture2D,
    aoSource: Texture2D,
    depth: Texture2D,
    normal: Texture2D
  ) {
    let program = SSGI._upsampleProgram;
    if (!program) {
      program = this.createUpsampleProgram(ctx);
      SSGI._upsampleProgram = program;
    }
    const hash = `${source.uid}:${aoSource.uid}:${depth.uid}:${normal.uid}`;
    let bindGroup = this._upsampleBindGroups[hash];
    if (!bindGroup) {
      bindGroup = ctx.device.createBindGroup(program.bindGroupLayouts[0]);
      bindGroup.setTexture('sourceTex', source, fetchSampler('clamp_nearest_nomip'));
      bindGroup.setTexture('aoSourceTex', aoSource, fetchSampler('clamp_nearest_nomip'));
      bindGroup.setTexture('depthTex', depth, fetchSampler('clamp_nearest_nomip'));
      bindGroup.setTexture('normalTex', normal, fetchSampler('clamp_nearest_nomip'));
      bindGroup.setValue('targetSize', new Vector4(source.width, source.height, depth.width, depth.height));
      this._upsampleBindGroups[hash] = bindGroup;
    }
    bindGroup.setValue(
      'guideParams',
      new Vector4(
        Math.max(0.001, ctx.camera.ssgiDepthReject),
        Math.max(1, ctx.camera.ssgiNormalReject * 32),
        ctx.camera.getFarPlane(),
        0
      )
    );
    bindGroup.setValue('flip', this.needFlip(ctx.device) ? 1 : 0);
    ctx.device.setProgram(program);
    ctx.device.setBindGroup(0, bindGroup);
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
          this.$builtins.position = pb.vec4(this.$inputs.pos, DEPTH_FARTHEST, 1);
          this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
          this.$if(pb.notEqual(this.flip, 0), function () {
            this.$builtins.position.y = pb.neg(this.$builtins.position.y);
          });
        });
      },
      fragment(pb) {
        this.currentColorTex = pb.tex2D().uniform(0);
        // Linear depth is r32f (or rg32f when thickness is enabled). These
        // formats are not filterable without the optional float32-filterable
        // feature, and all SSGI depth reads use a nearest sampler.
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.normalTex = pb.tex2D().uniform(0);
        if (sampleHistory) {
          this.previousColorTex = pb.tex2D().uniform(0);
          this.motionTex = pb.tex2D().uniform(0);
          this.previousSurfaceTex = pb.tex2D().uniform(0);
          this.historyRejectParams = pb.vec2().uniform(0);
        }
        if (useHiZ) {
          // Hi-Z is stored as r32f. It is only read with a nearest sampler,
          // so use the unfilterable sample type for adapters without the
          // optional float32-filterable feature (notably some AMD iGPUs).
          this.hizTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
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
        this.skyOcclusion = pb.float().uniform(0);
        ctx.env!.light.envLight.initShaderBindings(pb);
        this.$outputs.outColor = pb.vec4();
        this.$outputs.outAO = pb.vec4();
        pb.func('SSGI_getPosition', [pb.vec2('uv')], function () {
          this.$l.linearDepth = ShaderHelper.sampleLinearDepth(this, this.depthTex, this.uv, 0);
          this.$l.nonLinearDepth = ShaderHelper.linearNormalizedToNonLinearDepth(
            this,
            this.linearDepth,
            this.cameraNearFar
          );
          this.$l.clipPos = pb.vec4(
            pb.sub(pb.mul(this.uv, 2), pb.vec2(1)),
            ShaderHelper.deviceDepthToClipZ(this, pb.clamp(this.nonLinearDepth, 0, 1)),
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
            // Sky is unoccluded. Its irradiance validity is zero, so this value
            // is never read as a weight, but it must not be a dark texel: the
            // a-trous and upsample kernels reach across the silhouette.
            this.$outputs.outAO = pb.vec4(1);
          }).$else(function () {
            this.$l.worldNormal = pb.normalize(
              pb.sub(pb.mul(pb.textureSampleLevel(this.normalTex, this.uv, 0).rgb, 2), pb.vec3(1))
            );
            this.$l.viewNormal = pb.normalize(pb.mul(this.viewMatrix, pb.vec4(this.worldNormal, 0)).xyz);
            // Use the SH-integrated diffuse IBL as an exact, noise-free
            // baseline. Stochastic rays only estimate the screen-space
            // replacement relative to the environment in the same direction.
            //
            // getIrradiance returns the cosine-convolved SH, which already
            // carries the 1/PI of the Lambert BRDF: materials consume it as
            // k_D * irradiance with no further division, matching punctual
            // lights that apply 1/PI explicitly. The published history is mixed
            // against that same value in the lighting pass, so this baseline
            // must stay in those units and must not be scaled by PI.
            this.$l.iblIrradiance = pb.mul(
              ctx.env!.light.envLight.getIrradiance(this, this.worldNormal),
              this.radianceParams.z
            );
            this.$l.correctionSum = pb.vec3(0);
            // Rays whose outcome the depth buffer cannot resolve (they left the
            // screen or ran out of iterations behind geometry) are excluded from
            // the average instead of counted as unoccluded sky.
            this.$l.determinateSum = pb.float(0);
            this.$l.escapedSum = pb.float(0);
            // Ambient occlusion reuses the very same visibility measurement the
            // sky removal is built on, so the two can never disagree. No extra
            // ray march: only this accumulator is new.
            this.$l.occludedSum = pb.float(0);
            this.$for(pb.float('rayIndex'), 0, raysPerPixel, function () {
              this.$l.xi = this.SSGI_hash22(
                pb.add(pb.mul(this.uv, this.targetSize.xy), pb.vec2(this.rayIndex, pb.mul(this.rayIndex, 7))),
                pb.add(this.radianceParams.w, pb.mul(this.rayIndex, 17))
              );
              this.$l.worldRay = this.SSGI_cosineDirection(this.worldNormal, this.xi);
              this.$l.viewRay = pb.normalize(pb.mul(this.viewMatrix, pb.vec4(this.worldRay, 0)).xyz);
              this.$l.rayOrigin = pb.add(this.pos.xyz, pb.mul(this.viewNormal, this.traceParams.y, 0.25));
              // vec3(occluded, escaped, rawConfidence) - see screenSpaceRayTracing_Linear2D.
              this.$l.giTrace = pb.vec3(0);
              if (useHiZ) {
                // UE5 SSGI: diffuse rays march with RayRoughness = 1 (fast mip
                // ramp) and StepOffset = noise - 0.9. A dedicated hash keeps
                // the jitter decorrelated from the direction sample.
                this.$l.stepOffset = pb.sub(
                  this.SSGI_hash22(
                    pb.add(pb.mul(this.uv, this.targetSize.xy), pb.vec2(pb.mul(this.rayIndex, 23), 11)),
                    pb.add(this.radianceParams.w, pb.mul(this.rayIndex, 29))
                  ).x,
                  0.9
                );
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
                  this.normalTex,
                  this.giTrace,
                  1,
                  this.stepOffset
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
                  this.normalTex,
                  false,
                  this.giTrace
                );
              }
              // Grazing/projectively degenerate rays can return Inf or NaN.
              // A zero weight is not sufficient because NaN * 0 remains NaN and
              // the spatial passes then spread it into a dark block.
              this.$l.hitFinite = pb.all(pb.lessThan(pb.abs(this.hit), pb.vec4(1e30)));
              // Visibility and radiance are kept apart: whether the ray was
              // blocked is independent of whether the blocker's outgoing
              // radiance can be read back from the screen. Geometric certainty
              // gates occlusion so a thin-object false positive cannot darken,
              // while the hit's screen colour is always a usable radiance
              // estimate because the marcher only ever stops on-screen.
              this.$l.occluded = pb.mul(
                pb.float(this.hitFinite),
                pb.clamp(this.giTrace.x, 0, 1),
                pb.clamp(this.giTrace.z, 0, 1)
              );
              this.$l.escaped = pb.mul(pb.float(this.hitFinite), pb.clamp(this.giTrace.y, 0, 1));
              this.$l.hitUV = this.$choice(
                pb.greaterThan(this.occluded, 0),
                pb.clamp(this.hit.xy, pb.vec2(0), pb.vec2(1)),
                this.uv
              );
              this.$l.rawEnvRadiance = pb.mul(
                ctx.env!.light.envLight.getRadiance(this, this.worldRay, pb.float(0))!,
                this.radianceParams.z
              );
              this.$l.envRadiance = this.$choice(
                pb.all(pb.lessThan(pb.abs(this.rawEnvRadiance), pb.vec3(1e30))),
                this.rawEnvRadiance,
                pb.vec3(0)
              );
              this.$l.currentRadiance = pb.textureSampleLevel(this.currentColorTex, this.hitUV, 0).rgb;
              if (sampleHistory) {
                this.$l.hitMotion = pb.textureSampleLevel(this.motionTex, this.hitUV, 0).xy;
                this.$l.previousHitUV = pb.sub(this.hitUV, this.hitMotion);
                this.$l.historyValid = pb.and(
                  pb.all(pb.greaterThanEqual(this.previousHitUV, pb.vec2(0))),
                  pb.all(pb.lessThanEqual(this.previousHitUV, pb.vec2(1))),
                  pb.all(pb.lessThan(pb.abs(this.hitMotion), pb.vec2(5e4)))
                );
                this.$l.historyRadiance = pb.textureSampleLevel(
                  this.previousColorTex,
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
                // Prefer the reprojected previous frame for multi-bounce
                // feedback, but fall back to this frame's already-shaded opaque
                // colour rather than dropping the sample. Losing one bounce of
                // feedback is a far smaller error than reverting to unoccluded
                // IBL, which is what made newly disoccluded regions flash.
                this.$l.screenRadiance = this.$choice(
                  this.historyValid,
                  this.historyRadiance,
                  this.currentRadiance
                );
              } else {
                this.$l.screenRadiance = this.currentRadiance;
              }
              this.$l.screenRadianceFinite = pb.all(pb.lessThan(pb.abs(this.screenRadiance), pb.vec3(1e30)));
              this.screenRadiance = this.$choice(
                this.screenRadianceFinite,
                this.screenRadiance,
                this.envRadiance
              );
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
              // Split the correction into the bounce the blocker adds and the sky
              // it takes away. The bounce is always kept: the hit is on-screen, so
              // its colour is a real measurement. Only the removal is scaled by
              // skyOcclusion, which lets the sky be dimmed less than physically
              // implied without also discarding measured bounce light.
              this.$l.bounceGain = pb.max(pb.sub(this.clampedScreenRadiance, this.envRadiance), pb.vec3(0));
              this.$l.skyLoss = pb.mul(
                pb.max(pb.sub(this.envRadiance, this.clampedScreenRadiance), pb.vec3(0)),
                this.skyOcclusion
              );
              // Cosine-weighted sampling makes the estimator of E/PI - the unit
              // the baseline and the lighting pass both use - the plain mean of
              // the sampled radiance, so no PI appears here either.
              this.$l.correction = pb.mul(
                pb.sub(this.bounceGain, this.skyLoss),
                this.occluded,
                this.radianceParams.x
              );
              this.correctionSum = pb.add(this.correctionSum, this.correction);
              this.determinateSum = pb.add(this.determinateSum, pb.max(this.occluded, this.escaped));
              this.escapedSum = pb.add(this.escapedSum, this.escaped);
              this.occludedSum = pb.add(this.occludedSum, this.occluded);
            });
            // Average over resolved rays only. Dividing by raysPerPixel would
            // implicitly treat every indeterminate ray as an unoccluded sky
            // sample, which is the systematic sky leak this pass has to avoid.
            this.$l.determinateCount = pb.max(this.determinateSum, 1);
            this.$l.irradiance = pb.add(
              this.iblIrradiance,
              pb.div(this.correctionSum, this.determinateCount)
            );
            // radianceParams.x blends the traced estimate over the IBL baseline. A finite-ray
            // correction can have much higher variance than the integrated physical sky and must
            // not remove more than that blend permits (at the default 0.7, at least 30% remains).
            // That reserved share is itself scaled by measured visibility, otherwise no amount of
            // occlusion could ever darken an enclosed corner.
            this.$l.minimumIrradiance = pb.mul(
              this.iblIrradiance,
              pb.max(0, pb.sub(1, this.radianceParams.x)),
              pb.mix(pb.float(1), pb.div(this.escapedSum, this.determinateCount), this.skyOcclusion)
            );
            // Clamp before the render-target conversion: a finite value that overflows becomes Inf
            // in the texture, and every a-trous pass then expands the contaminated region by its
            // kernel radius. Pre-exposed lighting makes this unlikely, but a bright emissive hit
            // amplified by a low-probability ray can still reach it.
            this.$l.boundedIrradiance = pb.clamp(
              pb.max(this.irradiance, this.minimumIrradiance),
              pb.vec3(0),
              pb.vec3(HALF_FLOAT_MAX)
            );
            this.$outputs.outColor = pb.vec4(this.boundedIrradiance, 1);
            // Cosine-weighted sampling makes the mean of `occluded` over the
            // resolved rays an unbiased estimate of cosine-weighted visibility.
            // Averaging over the determinate set - not raysPerPixel - is what
            // keeps an indeterminate ray from reading as unoccluded, the same
            // reasoning the irradiance average uses above.
            this.$outputs.outAO = pb.vec4(
              pb.clamp(pb.sub(1, pb.div(this.occludedSum, this.determinateCount)), 0, 1)
            );
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
          this.$builtins.position = pb.vec4(this.$inputs.pos, DEPTH_FARTHEST, 1);
          this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
          this.$if(pb.notEqual(this.flip, 0), function () {
            this.$builtins.position.y = pb.neg(this.$builtins.position.y);
          });
        });
      },
      fragment(pb) {
        this.currentTex = pb.tex2D().uniform(0);
        this.currentAOTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.normalTex = pb.tex2D().uniform(0);
        if (hasHistory) {
          this.motionTex = pb.tex2D().uniform(0);
          this.previousIrradianceTex = pb.tex2D().uniform(0);
          this.previousSurfaceTex = pb.tex2D().uniform(0);
          this.previousMomentsTex = pb.tex2D().uniform(0);
          this.previousAOTex = pb.tex2D().uniform(0);
        }
        this.targetSize = pb.vec4().uniform(0);
        this.temporalParams = pb.vec4().uniform(0);
        this.$outputs.outIrradiance = pb.vec4();
        this.$outputs.outMoments = pb.vec4();
        this.$outputs.outAO = pb.vec4();
        pb.func('SSGI_luminance', [pb.vec3('c')], function () {
          this.$l.boundedLuminance = pb.clamp(
            pb.dot(this.c, pb.vec3(0.2126, 0.7152, 0.0722)),
            0,
            MOMENT_LUMINANCE_MAX
          );
          this.$return(this.boundedLuminance);
        });
        pb.main(function () {
          this.$l.uv = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.targetSize.xy);
          this.$l.current = pb.textureSampleLevel(this.currentTex, this.uv, 0);
          this.$l.currentAO = pb.textureSampleLevel(this.currentAOTex, this.uv, 0).r;
          this.$l.result = this.current.rgb;
          this.$l.resultAO = this.currentAO;
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
            this.$l.aoNeighborhoodMin = this.currentAO;
            this.$l.aoNeighborhoodMax = this.currentAO;
            for (let y = -1; y <= 1; y++) {
              for (let x = -1; x <= 1; x++) {
                if (x === 0 && y === 0) {
                  continue;
                }
                this.$l.neighborUV = pb.add(this.uv, pb.div(pb.vec2(x, y), this.targetSize.xy));
                this.$l.neighbor = pb.textureSampleLevel(this.currentTex, this.neighborUV, 0).rgb;
                this.neighborhoodMin = pb.min(this.neighborhoodMin, this.neighbor);
                this.neighborhoodMax = pb.max(this.neighborhoodMax, this.neighbor);
                this.$l.aoNeighbor = pb.textureSampleLevel(this.currentAOTex, this.neighborUV, 0).r;
                this.aoNeighborhoodMin = pb.min(this.aoNeighborhoodMin, this.aoNeighbor);
                this.aoNeighborhoodMax = pb.max(this.aoNeighborhoodMax, this.aoNeighbor);
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
            // AO accumulates on exactly the same validity and weight as the
            // irradiance: it was measured by the same rays against the same
            // surface, so any disagreement between the two would be an artifact.
            this.$l.previousAO = pb.textureSampleLevel(
              this.previousAOTex,
              pb.clamp(this.previousUV, pb.vec2(0), pb.vec2(1)),
              0
            ).r;
            this.$l.previousAOClamped = pb.clamp(
              this.previousAO,
              this.aoNeighborhoodMin,
              this.aoNeighborhoodMax
            );
            this.resultAO = pb.mix(this.currentAO, this.previousAOClamped, this.weight);
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
          this.$outputs.outAO = pb.vec4(pb.clamp(this.resultAO, 0, 1));
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
          this.$builtins.position = pb.vec4(this.$inputs.pos, DEPTH_FARTHEST, 1);
          this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
          this.$if(pb.notEqual(this.flip, 0), function () {
            this.$builtins.position.y = pb.neg(this.$builtins.position.y);
          });
        });
      },
      fragment(pb) {
        this.sourceTex = pb.tex2D().uniform(0);
        this.aoSourceTex = pb.tex2D().uniform(0);
        this.momentsTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.normalTex = pb.tex2D().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.filterParams = pb.vec4().uniform(0);
        this.denoiseParams = pb.vec4().uniform(0);
        this.cameraFar = pb.float().uniform(0);
        this.$outputs.outColor = pb.vec4();
        this.$outputs.outAO = pb.vec4();
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
          // A pixel with little accumulated history has an unreliable variance
          // estimate, so the edge-stopping functions would preserve Monte Carlo
          // noise as if it were detail. Widen the kernel and relax the luminance
          // and normal tests until enough frames have converged, then hand back
          // to the sharp weights (standard SVGF history-driven ramp).
          //
          // A path that never accumulates history (no temporal resolve, so
          // moments.z is pinned at 1) is permanently unconverged, not converged:
          // it is the noisiest input this filter ever sees. Sending it to the
          // relaxed end is the whole point of the ramp - the sharp end would give
          // it the narrowest kernel and one eighth the luminance tolerance.
          this.$l.historyConfidence = this.$choice(
            pb.greaterThan(this.denoiseParams.x, 0),
            pb.clamp(pb.div(this.moments.z, this.denoiseParams.x), 0, 1),
            pb.float(0)
          );
          this.$l.stepScale = pb.mix(pb.float(2), pb.float(1), this.historyConfidence);
          this.$l.effStep = pb.mul(this.filterParams.x, this.stepScale);
          this.$l.normalPower = pb.mix(
            pb.max(1, pb.mul(this.filterParams.z, 0.25)),
            this.filterParams.z,
            this.historyConfidence
          );
          this.$l.sigmaScale = pb.mix(pb.float(8), pb.float(1), this.historyConfidence);
          this.$l.sigma = pb.mul(pb.add(pb.sqrt(pb.max(this.moments.w, 0)), 0.02), this.sigmaScale);
          this.$l.centerAO = pb.textureSampleLevel(this.aoSourceTex, this.uv, 0).r;
          this.$l.sum = pb.vec3(0);
          this.$l.weightSum = pb.float(0);
          this.$l.aoSum = pb.float(0);
          this.$l.aoWeightSum = pb.float(0);
          const kernel = [1, 2 / 3, 1 / 6];
          for (let y = -2; y <= 2; y++) {
            for (let x = -2; x <= 2; x++) {
              const kernelWeight = kernel[Math.abs(x)] * kernel[Math.abs(y)];
              this.$l.sampleUV = pb.add(
                this.uv,
                pb.mul(pb.div(pb.vec2(x, y), this.targetSize.xy), this.effStep)
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
                    pb.mul(this.filterParams.y, this.effStep)
                  )
                )
              );
              this.$l.normalWeight = pb.pow(
                pb.max(0, pb.dot(this.centerNormal, this.sampleNormal)),
                this.normalPower
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
              // AO deliberately drops colorWeight: that term is driven by the
              // moments' luminance variance, which describes the irradiance and
              // says nothing about AO. Leaving it out is a stronger smoothing,
              // which is what a per-ray binary quantity needs - with 1-2 rays per
              // pixel, single-frame AO is close to binary.
              this.$l.aoWeight = pb.mul(
                kernelWeight,
                this.depthWeight,
                this.normalWeight,
                this.sampleValue.a
              );
              this.$l.sampleAO = pb.textureSampleLevel(this.aoSourceTex, this.sampleUV, 0).r;
              this.aoSum = pb.add(this.aoSum, pb.mul(this.sampleAO, this.aoWeight));
              this.aoWeightSum = pb.add(this.aoWeightSum, this.aoWeight);
            }
          }
          this.$l.filtered = this.$choice(
            pb.greaterThan(this.weightSum, 1e-5),
            pb.div(this.sum, this.weightSum),
            this.center.rgb
          );
          this.$l.filteredAO = this.$choice(
            pb.greaterThan(this.aoWeightSum, 1e-5),
            pb.div(this.aoSum, this.aoWeightSum),
            this.centerAO
          );
          this.$outputs.outColor = pb.vec4(this.filtered, this.center.a);
          this.$outputs.outAO = pb.vec4(pb.clamp(this.filteredAO, 0, 1));
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
          this.$builtins.position = pb.vec4(this.$inputs.pos, DEPTH_FARTHEST, 1);
          this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
          this.$if(pb.notEqual(this.flip, 0), function () {
            this.$builtins.position.y = pb.neg(this.$builtins.position.y);
          });
        });
      },
      fragment(pb) {
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
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

  /**
   * Multiply the traced ambient occlusion into the scene color.
   *
   * This is the same multiply-into-final-color semantics the standalone SAO post
   * effect applies, so enabling both double darkens.
   *
   * @internal
   */
  private compositeAO(ctx: DrawContext, sceneColor: Texture2D, ao: Texture2D, srgbOutput: boolean) {
    const key = srgbOutput ? 'srgb' : 'linear';
    let program = SSGI._compositePrograms[key];
    if (!program) {
      program = this.createCompositeProgram(ctx, srgbOutput);
      SSGI._compositePrograms[key] = program;
    }
    const hash = `${key}:${sceneColor.uid}:${ao.uid}`;
    let bindGroup = this._compositeBindGroups[hash];
    if (!bindGroup) {
      bindGroup = ctx.device.createBindGroup(program.bindGroupLayouts[0]);
      bindGroup.setTexture('colorTex', sceneColor, fetchSampler('clamp_nearest_nomip'));
      // Nearest, not linear: the AO handed to this pass is already at full
      // resolution, so filtering would only add a dependency on the WebGL
      // half-float linear filtering cap for no gain.
      bindGroup.setTexture('aoTex', ao, fetchSampler('clamp_nearest_nomip'));
      this._compositeBindGroups[hash] = bindGroup;
    }
    bindGroup.setValue(
      'aoParams',
      new Vector2(ctx.camera.ssgiAOIntensity, Math.max(1e-3, ctx.camera.ssgiAOPower))
    );
    bindGroup.setValue('flip', this.needFlip(ctx.device) ? 1 : 0);
    ctx.device.setProgram(program);
    ctx.device.setBindGroup(0, bindGroup);
    this.drawFullscreenQuad(AbstractPostEffect.getDefaultRenderState(ctx, 'always'));
  }

  /** @internal */
  private createCompositeProgram(ctx: DrawContext, srgbOutput: boolean) {
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
        this.aoTex = pb.tex2D().uniform(0);
        this.aoParams = pb.vec2().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.main(function () {
          this.$l.color = pb.textureSampleLevel(this.colorTex, this.$inputs.uv, 0);
          this.$l.ao = pb.clamp(pb.textureSampleLevel(this.aoTex, this.$inputs.uv, 0).r, 0, 1);
          // mix() toward 1 rather than a plain multiply: intensity then doubles as
          // the fallback for noisy or unresolved texels, which matters most on the
          // WebGL path where there is no temporal accumulation to converge them.
          this.$l.shapedAO = pb.pow(this.ao, this.aoParams.y);
          this.$l.finalAO = pb.mix(pb.float(1), this.shapedAO, this.aoParams.x);
          this.$l.occludedColor = pb.mul(this.color.rgb, this.finalAO);
          this.$outputs.outColor = pb.vec4(
            srgbOutput ? linearToGamma(this, this.occludedColor) : this.occludedColor,
            this.color.a
          );
        });
      }
    })!;
    program.name = srgbOutput ? '@SSGI_CompositeAO_sRGB' : '@SSGI_CompositeAO';
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
          this.$builtins.position = pb.vec4(this.$inputs.pos, DEPTH_FARTHEST, 1);
          this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
          this.$if(pb.notEqual(this.flip, 0), function () {
            this.$builtins.position.y = pb.neg(this.$builtins.position.y);
          });
        });
      },
      fragment(pb) {
        this.sourceTex = pb.tex2D().uniform(0);
        this.aoSourceTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.normalTex = pb.tex2D().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.guideParams = pb.vec4().uniform(0);
        this.$outputs.outColor = pb.vec4();
        this.$outputs.outAO = pb.vec4();
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
          this.$l.aoSum = pb.float(0);
          for (let y = -1; y <= 1; y++) {
            for (let x = -1; x <= 1; x++) {
              this.$l.sampleUV = pb.add(this.uv, pb.div(pb.vec2(x, y), this.targetSize.xy));
              this.$l.sampleValue = pb.textureSampleLevel(this.sourceTex, this.sampleUV, 0);
              this.$l.sampleAO = pb.textureSampleLevel(this.aoSourceTex, this.sampleUV, 0).r;
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
              // Same joint bilateral weights as the irradiance, so the upsampled
              // AO cannot cross a depth or normal edge the irradiance respects.
              this.aoSum = pb.add(this.aoSum, pb.mul(this.sampleAO, this.weight));
            }
          }
          this.$l.result = this.$choice(
            pb.greaterThan(this.weightSum, 1e-5),
            pb.div(this.sum, this.weightSum),
            pb.textureSampleLevel(this.sourceTex, this.uv, 0).rgb
          );
          this.$l.resultAO = this.$choice(
            pb.greaterThan(this.weightSum, 1e-5),
            pb.div(this.aoSum, this.weightSum),
            pb.textureSampleLevel(this.aoSourceTex, this.uv, 0).r
          );
          this.$outputs.outColor = pb.vec4(this.result, pb.float(pb.greaterThan(this.weightSum, 1e-5)));
          this.$outputs.outAO = pb.vec4(pb.clamp(this.resultAO, 0, 1));
        });
      }
    })!;
    program.name = '@SSGI_Upsample';
    return program;
  }
}
