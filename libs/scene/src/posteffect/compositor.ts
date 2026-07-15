import { linearToGamma } from '../shaders/misc';
import type { DrawContext } from '../render';
import type {
  AbstractDevice,
  BindGroup,
  FrameBuffer,
  GPUProgram,
  RenderStateSet,
  Texture2D,
  TextureFormat,
  VertexLayout
} from '@zephyr3d/device';
import type { AbstractPostEffect, PostEffectHistoryRead, PostEffectSetupContext } from './posteffect';
import { PostEffectLayer } from './posteffect';
import { MaterialVaryingFlags } from '../values';
import { fetchSampler } from '../utility/misc';
import type { Nullable } from '@zephyr3d/base';
import { DRef } from '@zephyr3d/base';
import type { RenderGraph } from '../render/rendergraph/rendergraph';
import type { RGHandle } from '../render/rendergraph/types';
import type { RGBlackboard } from '../render/rendergraph/blackboard';
import type { HistoryResourceManager } from '../render/rendergraph/history_resource_manager';

/**
 * Posteffect rendering context
 * @public
 */
export interface CompositorContext {
  pingpongFramebuffers: FrameBuffer[];
  finalFramebuffer: FrameBuffer;
  writeIndex: number;
}

/**
 * Options for building a post effect layer as render graph passes.
 * @public
 */
export interface CompositorBuildLayerOptions {
  /** The render graph being built. */
  graph: RenderGraph;
  /** Frame draw context. */
  ctx: DrawContext;
  /** The layer to build. */
  layer: PostEffectLayer;
  /** Named frame resources. */
  blackboard: RGBlackboard;
  /** Chain input color handle. */
  input: RGHandle;
  /**
   * Direct final target for the last effect of the chain, or null to always
   * end the chain in an intermediate texture. Pass the imported backbuffer
   * handle together with isScreen=false when rendering into a framebuffer,
   * or isScreen=true when the final target is the device default framebuffer.
   */
  finalOutput?: Nullable<{ handle: RGHandle; isScreen: boolean }>;
  /**
   * Depth attachment for intermediate effect outputs that request one:
   * either a graph texture handle or a backend depth texture.
   */
  sceneDepthAttachment?: unknown;
  /** Ordering/lifetime dependencies declared by every effect pass. */
  dependencies?: RGHandle[];
  /** History bindings kept in a read scope while effects execute. */
  historyReads?: PostEffectHistoryRead[];
  /** Cross-frame history resource manager. */
  history?: Nullable<HistoryResourceManager<Texture2D>>;
}

/**
 * Result of {@link Compositor.buildLayer}.
 * @public
 */
export interface CompositorBuildLayerResult {
  /** Chain output color handle. Equals the input when no effect is enabled. */
  color: RGHandle;
  /** True when the last effect wrote the final target directly. */
  wroteFinal: boolean;
}

/**
 * Post processing compositor
 * @public
 */
export class Compositor {
  /** @internal */
  protected _postEffects: DRef<AbstractPostEffect>[][];
  /** @internal */
  private _finalFramebuffer: Nullable<FrameBuffer>;
  /** @internal */
  private _prevInputTexture: Nullable<Texture2D>;
  /** @internal */
  private _prevFrameBuffer: Nullable<FrameBuffer>;
  /** @internal */
  private _textureFormat: TextureFormat;
  /** @internal */
  private static _blitProgram: Nullable<GPUProgram> = null;
  /** @internal */
  private static _blitBindgroup: Nullable<BindGroup> = null;
  /** @internal */
  private static _blitRenderStates: Nullable<RenderStateSet> = null;
  /** @internal */
  private static _blitVertexLayout: Nullable<VertexLayout> = null;
  /**
   * Creates an instance of Compositor
   */
  constructor() {
    this._postEffects = [];
    this._postEffects[PostEffectLayer.opaque] = [];
    this._postEffects[PostEffectLayer.transparent] = [];
    this._postEffects[PostEffectLayer.end] = [];
    this._finalFramebuffer = null;
    this._prevInputTexture = null;
    this._prevFrameBuffer = null;
    this._textureFormat = 'rgba16f';
  }
  /** @internal */
  requireLinearDepth(ctx: DrawContext) {
    for (const list of this._postEffects) {
      for (const postEffect of list) {
        if (postEffect.get()!.requireLinearDepthTexture(ctx)) {
          return true;
        }
      }
    }
    return false;
  }
  /** @internal */
  layerHasEnabledEffect(layer: PostEffectLayer): boolean {
    return this._postEffects[layer].some((ref) => !!ref.get()?.enabled);
  }
  /** @internal */
  private getIntermediateFormat(ctx: DrawContext): TextureFormat {
    return ctx.camera.HDR && ctx.device.getDeviceCaps().textureCaps.supportHalfFloatColorBuffer
      ? 'rgba16f'
      : 'rgba8unorm';
  }
  /**
   * Build the enabled effects of a layer as render graph passes.
   *
   * Effects are chained through graph texture handles: each effect's setup()
   * declares its passes reading the previous output. Where each effect output
   * lands (intermediate texture or the final target) is decided here through
   * the {@link PostEffectSetupContext.createOutput} implementation, so effect
   * code never handles final-target selection.
   *
   * @param options - Build inputs.
   * @returns The chain output handle and whether the final target was written directly.
   */
  buildLayer(options: CompositorBuildLayerOptions): CompositorBuildLayerResult {
    const { graph, ctx, layer, blackboard, input } = options;
    const effects = this._postEffects[layer]
      .map((ref) => ref.get())
      .filter((effect): effect is AbstractPostEffect => !!effect && effect.enabled);
    if (effects.length === 0) {
      return { color: input, wroteFinal: false };
    }
    const colorFormat = this.getIntermediateFormat(ctx);
    const finalOutput = options.finalOutput ?? null;
    const history = options.history ?? null;
    const dependencies = options.dependencies ?? [];
    const historyReads = options.historyReads ?? [];
    const sceneDepthAttachment = options.sceneDepthAttachment ?? null;
    const width = ctx.renderWidth;
    const height = ctx.renderHeight;
    let chain = input;
    let wroteFinal = false;
    for (let i = 0; i < effects.length; i++) {
      const effect = effects[i];
      const isLast = i === effects.length - 1;
      const label = `PostEffect:${effect.constructor.name}`;
      const setupContext: PostEffectSetupContext = {
        graph,
        ctx,
        blackboard,
        input: chain,
        colorFormat,
        width,
        height,
        history,
        dependencies,
        historyReads,
        createOutput(builder, opts) {
          const needDepthAttachment = !!opts?.needDepthAttachment;
          // Direct write to the final target is only allowed for the last effect
          // of the chain, and only when the effect does not depth-test against
          // scene depth (the final target does not carry the scene depth buffer).
          if (isLast && finalOutput && !needDepthAttachment) {
            wroteFinal = true;
            const color = builder.write(finalOutput.handle);
            if (finalOutput.isScreen) {
              // Device default framebuffer: not a graph resource; the effect
              // must gamma-correct since the screen is sRGB.
              return { color, framebuffer: null, srgbOutput: true };
            }
            const framebuffer = builder.createFramebuffer({
              label: `${label}:finalFB`,
              width,
              height,
              colorAttachments: color,
              depthAttachment: null
            });
            return { color, framebuffer, srgbOutput: false };
          }
          const color = builder.createTexture({ format: colorFormat, label: `${label}:out` });
          const framebuffer = builder.createFramebuffer({
            label: `${label}:outFB`,
            width,
            height,
            colorAttachments: color,
            depthAttachment: needDepthAttachment ? sceneDepthAttachment : null,
            ignoreDepthStencil: !needDepthAttachment
          });
          return { color, framebuffer, srgbOutput: false };
        }
      };
      chain = effect.setup(setupContext);
    }
    return { color: chain, wroteFinal };
  }
  /**
   * Adds a posteffect
   *
   * @param postEffect - The post effect to add
   * @param opaque - true if the post effect should be applied after the opaque pass and before the transparent pass, otherwise the post effect should be applied after the transparent pass
   */
  appendPostEffect(postEffect: AbstractPostEffect) {
    if (postEffect) {
      for (const list of this._postEffects) {
        if (list.findIndex((val) => val.get() === postEffect) >= 0) {
          console.error(`Posteffect cannot be added to same compositor multiple times`);
          return;
        }
      }
      this._postEffects[postEffect.layer].push(new DRef(postEffect));
    }
  }
  /**
   * Removes a posteffect that was previously added
   *
   * @param postEffect - The posteffect to be remove.
   */
  removePostEffect(postEffect: AbstractPostEffect) {
    for (const list of this._postEffects) {
      const index = list.findIndex((val) => val.get() === postEffect);
      if (index >= 0) {
        list[index].dispose();
        list.splice(index, 1);
        return;
      }
    }
  }
  /**
   * Removes all post effects
   */
  clear() {
    for (const list of this._postEffects) {
      for (const p of list) {
        p.dispose();
      }
      list.splice(0, list.length);
    }
  }
  /** @internal */
  begin(ctx: DrawContext) {
    const device = ctx.device;
    this._textureFormat = this.getIntermediateFormat(ctx);
    this._finalFramebuffer = device.getFramebuffer();
    // Only the opaque/transparent layers still render through the legacy
    // ping-pong path inside the light pass. The end layer is built as render
    // graph passes (see buildLayer), so scene rendering only needs to be
    // redirected when a mid-scene effect will actually run.
    const needScenePingPong =
      this.layerHasEnabledEffect(PostEffectLayer.opaque) ||
      this.layerHasEnabledEffect(PostEffectLayer.transparent);
    if (!needScenePingPong) {
      return;
    }
    const depth = this._finalFramebuffer?.getDepthAttachment() as Texture2D;
    const w = depth ? depth.width : device.getDrawingBufferWidth();
    const h = depth ? depth.height : device.getDrawingBufferHeight();
    const attachments: any[] = [this._textureFormat];
    if (ctx.materialFlags & MaterialVaryingFlags.SSR_STORE_ROUGHNESS) {
      attachments.push(ctx.SSRRoughnessTexture!, ctx.SSRNormalTexture!);
    } else if (ctx.materialFlags & MaterialVaryingFlags.SSS_STORE_NORMAL) {
      attachments.push(ctx.SSRNormalTexture!);
    }
    if (ctx.materialFlags & MaterialVaryingFlags.SSS_STORE_PROFILE) {
      attachments.push(ctx.SSSProfileTexture!, ctx.SSSParamTexture!);
    }
    if (ctx.materialFlags & MaterialVaryingFlags.SSS_STORE_DIFFUSE) {
      attachments.push(ctx.SSSDiffuseTexture!);
    }
    if (ctx.materialFlags & MaterialVaryingFlags.SSS_STORE_TRANSMISSION) {
      attachments.push(ctx.SSSTransmissionTexture!);
    }
    if (ctx.materialFlags & MaterialVaryingFlags.SKIN_SSS_STORE) {
      attachments.push(ctx.SkinSSSTexture!);
    }
    const tmpFramebuffer = device.pool.fetchTemporalFramebuffer(
      true,
      w,
      h,
      attachments.length === 1 ? attachments[0] : attachments,
      depth ?? ctx.depthFormat
    );
    device.setFramebuffer(tmpFramebuffer);
  }
  /** @internal */
  drawPostEffects(ctx: DrawContext, layer: PostEffectLayer, sceneDepthTexture: Texture2D) {
    const postEffects = this._postEffects[layer];
    if (postEffects.length > 0) {
      const device = ctx.device;
      const inputFramebuffer = device.getFramebuffer()!;
      const inputTexture = inputFramebuffer!.getColorAttachments()[0] as Texture2D;
      let tmpTexture: Nullable<Texture2D> = null;
      for (let i = 0; i < postEffects.length; i++) {
        const postEffect = postEffects[i].get()!;
        if (!postEffect.enabled) {
          continue;
        }
        if (this._prevFrameBuffer) {
          device.pool.releaseFrameBuffer(this._prevFrameBuffer);
          this._prevFrameBuffer = null;
        }
        const isLast = this.isLastPostEffect(layer, i);
        const finalEffect = isLast && (!postEffect.requireDepthAttachment(ctx) || !!this._finalFramebuffer);
        let singleColorFramebuffer: Nullable<FrameBuffer> = null;
        if (finalEffect) {
          singleColorFramebuffer = this.createSingleColorFramebuffer(
            device,
            this._finalFramebuffer,
            postEffect.requireDepthAttachment(ctx)
          );
          device.setFramebuffer(singleColorFramebuffer ?? this._finalFramebuffer);
        } else {
          this._prevFrameBuffer = device.pool.fetchTemporalFramebuffer(
            false,
            inputFramebuffer.getWidth(),
            inputFramebuffer.getHeight(),
            this._textureFormat,
            inputFramebuffer.getDepthAttachment() ?? null
          );
          device.setFramebuffer(this._prevFrameBuffer);
        }
        const inputColorTexture = tmpTexture ?? inputTexture;
        try {
          postEffect.apply(ctx, inputColorTexture, sceneDepthTexture, !device.getFramebuffer());
        } finally {
          if (singleColorFramebuffer) {
            device.setFramebuffer(this._finalFramebuffer);
            device.pool.releaseFrameBuffer(singleColorFramebuffer);
          }
        }
        if (this._prevInputTexture) {
          device.pool.releaseTexture(this._prevInputTexture);
          this._prevInputTexture = null;
        }
        if (this._prevFrameBuffer) {
          tmpTexture = this._prevFrameBuffer.getColorAttachments()[0] as Texture2D;
          device.pool.retainTexture(tmpTexture);
          this._prevInputTexture = tmpTexture;
        }
      }
    }
  }
  /** @internal */
  end(ctx: DrawContext) {
    const device = ctx.device;
    if (device.getFramebuffer() !== this._finalFramebuffer) {
      const srcTex = device.getFramebuffer()!.getColorAttachments()[0] as Texture2D;
      const singleColorFramebuffer = this.createSingleColorFramebuffer(device, this._finalFramebuffer, false);
      device.setFramebuffer(singleColorFramebuffer ?? this._finalFramebuffer);
      device.setViewport(null);
      device.setScissor(null);
      try {
        Compositor._blit(device, srcTex, !this._finalFramebuffer);
      } finally {
        if (singleColorFramebuffer) {
          device.setFramebuffer(this._finalFramebuffer);
          device.pool.releaseFrameBuffer(singleColorFramebuffer);
        }
      }
    }
    if (this._prevInputTexture) {
      device.pool.releaseTexture(this._prevInputTexture);
      this._prevInputTexture = null;
    }
    if (this._prevFrameBuffer) {
      device.pool.releaseFrameBuffer(this._prevFrameBuffer);
      this._prevFrameBuffer = null;
    }
  }
  /** @internal */
  private isLastPostEffect(layer: PostEffectLayer, index: number) {
    for (let i = layer; i < this._postEffects.length; i++) {
      const start = i === layer ? index + 1 : 0;
      for (let j = start; j < this._postEffects[i].length; j++) {
        if (this._postEffects[i][j].get()!.enabled) {
          return false;
        }
      }
    }
    return true;
  }
  /** @internal */
  private createSingleColorFramebuffer(
    device: AbstractDevice,
    framebuffer: Nullable<FrameBuffer>,
    withDepth: boolean
  ) {
    const colorAttachment = framebuffer?.getColorAttachments()[0] ?? null;
    if (!framebuffer || framebuffer.getColorAttachments().length <= 1 || !colorAttachment) {
      return null;
    }
    return device.pool.fetchTemporalFramebuffer(
      false,
      0,
      0,
      colorAttachment,
      withDepth ? framebuffer.getDepthAttachment() : null,
      false
    );
  }
  /** @internal */
  static _blit(device: AbstractDevice, srcTex: Texture2D, srgbOutput: boolean) {
    if (!this._blitProgram) {
      this._blitProgram = device.buildRenderProgram({
        vertex(pb) {
          this.$inputs.pos = pb.vec2().attrib('position');
          this.$outputs.uv = pb.vec2();
          this.flip = pb.int().uniform(0);
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
            this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
            this.$if(pb.notEqual(this.flip, 0), function () {
              this.$builtins.position.y = pb.neg(this.$builtins.position.y);
            });
          });
        },
        fragment(pb) {
          this.srcTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
          this.srgbOutput = pb.int().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$outputs.outColor = pb.textureSample(this.srcTex, this.$inputs.uv);
            this.$if(pb.notEqual(this.srgbOutput, 0), function () {
              this.$outputs.outColor = pb.vec4(linearToGamma(this, this.$outputs.outColor.rgb), 1);
            });
          });
        }
      })!;
      this._blitProgram.name = '@Compositor_blit';
      this._blitBindgroup = device.createBindGroup(this._blitProgram.bindGroupLayouts[0]);
      this._blitVertexLayout = device.createVertexLayout({
        vertexBuffers: [
          {
            buffer: device.createVertexBuffer(
              'position_f32x2',
              new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
            )!
          }
        ]
      });
      this._blitRenderStates = device.createRenderStateSet();
      this._blitRenderStates.useRasterizerState().setCullMode('none');
      this._blitRenderStates.useDepthState().enableTest(false).enableWrite(false);
    }
    this._blitBindgroup!.setTexture('srcTex', srcTex, fetchSampler('clamp_nearest_nomip'));
    this._blitBindgroup!.setValue('srgbOutput', srgbOutput ? 1 : 0);
    this._blitBindgroup!.setValue('flip', device.type === 'webgpu' && !!device.getFramebuffer() ? 1 : 0);
    device.setRenderStates(this._blitRenderStates);
    device.setProgram(this._blitProgram);
    device.setBindGroup(0, this._blitBindgroup!);
    device.setVertexLayout(this._blitVertexLayout);
    device.draw('triangle-strip', 0, 4);
  }
}
