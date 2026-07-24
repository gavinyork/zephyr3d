import type { AbstractDevice, CompareFunc, RenderStateSet, Texture2D, TextureFormat } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { drawFullscreenQuad } from '../render/fullscreenquad';
import { copyTexture, fetchSampler } from '../utility/misc';
import { Disposable } from '@zephyr3d/base';
import type { Nullable } from '@zephyr3d/base';
import type { RenderGraph } from '../render/rendergraph/rendergraph';
import type { RGHandle, RGPassBuilder } from '../render/rendergraph/types';
import type { RGBlackboard } from '../render/rendergraph/blackboard';
import { FrameResources } from '../render/rendergraph/blackboard';
import type { FrameResourceRequirements } from '../render/rendergraph/frame_resource_requirements';
import type { HistoryResourceManager } from '../render/rendergraph/history_resource_manager';

/**
 * Rendering layer of post processing effects
 * @public
 *
 */
export enum PostEffectLayer {
  opaque = 0,
  transparent = 1,
  end = 2
}

/**
 * History texture binding required while a post effect executes.
 * @public
 */
export interface PostEffectHistoryRead {
  /** History resource name (see {@link RGHistoryResources}). */
  name: string;
  /** Graph handle of the imported previous-frame texture. */
  handle: RGHandle;
}

/**
 * Output target of a post effect, created through {@link PostEffectSetupContext.createOutput}.
 * @public
 */
export interface PostEffectOutput {
  /** Color handle produced by this effect. Return it from {@link AbstractPostEffect.setup}. */
  color: RGHandle;
  /**
   * Graph framebuffer to render into, or null when the effect must render to the
   * device default framebuffer (screen).
   */
  framebuffer: Nullable<RGHandle>;
  /** Whether the effect must gamma-correct its final write. */
  srgbOutput: boolean;
}

/**
 * Build-time context handed to {@link AbstractPostEffect.setup}.
 *
 * The context carries everything an effect needs to declare its passes on the
 * render graph. Where the effect output physically lands (intermediate texture,
 * backbuffer or screen) is decided by {@link PostEffectSetupContext.createOutput};
 * effect implementations never deal with final-target selection themselves.
 *
 * @public
 */
export interface PostEffectSetupContext {
  /** The render graph being built for this frame. */
  readonly graph: RenderGraph;
  /** Frame draw context. Read configuration from it, never textures. */
  readonly ctx: DrawContext;
  /** Named frame resources (linear depth, motion vectors, GBuffer, ...). */
  readonly blackboard: RGBlackboard;
  /** Chain input: color output of the previous effect (or the scene color). */
  readonly input: RGHandle;
  /** Intermediate color format of the post effect chain. */
  readonly colorFormat: TextureFormat;
  /** Render width in pixels. */
  readonly width: number;
  /** Render height in pixels. */
  readonly height: number;
  /** Cross-frame history resources, or null when unavailable. */
  readonly history: Nullable<HistoryResourceManager<Texture2D>>;
  /**
   * Scene depth attachment for intermediate passes that depth-test against
   * scene depth: either a graph texture handle or a backend depth texture.
   * Pass it as the depthAttachment of intermediate framebuffers; the final
   * pass gets it through createOutput({needDepthAttachment: true}).
   */
  readonly sceneDepthAttachment: unknown;
  /**
   * Ordering/lifetime dependencies that every pass created by this effect must
   * declare with {@link RGPassBuilder.read}.
   * @internal
   */
  readonly dependencies: readonly RGHandle[];
  /**
   * History texture bindings that must be in a read scope while this effect
   * executes (legacy apply path).
   * @internal
   */
  readonly historyReads: readonly PostEffectHistoryRead[];
  /**
   * Create the output target for the effect's final pass.
   *
   * Must be called exactly once, inside the setup callback of the pass that
   * produces the effect's final color. The compositor decides whether this
   * resolves to an intermediate texture or a direct write to the final target.
   *
   * @param builder - The pass builder of the effect's final pass.
   * @param opts - Set needDepthAttachment when the pass depth-tests against scene depth.
   * @returns The resolved output target.
   */
  createOutput(builder: RGPassBuilder, opts?: { needDepthAttachment?: boolean }): PostEffectOutput;
}

/**
 * Base class for any type of post effect
 * @public
 */
export class AbstractPostEffect extends Disposable {
  private static _defaultRenderStates: { CompareFunc?: RenderStateSet } = {};
  protected _enabled: boolean;
  protected _layer: PostEffectLayer;
  /**
   * Creates an instance of a post effect
   * @param name - Name of the post effect
   */
  constructor() {
    super();
    this._enabled = true;
    this._layer = PostEffectLayer.end;
  }
  /** Whether this post effect is enabled */
  get enabled() {
    return this._enabled;
  }
  set enabled(val) {
    this._enabled = !!val;
  }
  /** Whether this post effect will be rendered at opaque phase */
  get layer() {
    return this._layer;
  }
  /**
   * Check if the post effect should be rendered upside down.
   * @param device - The device object
   * @returns true if the post effect should be rendered upside down
   */
  needFlip(device: AbstractDevice) {
    return device.type === 'webgpu' && !!device.getFramebuffer();
  }
  /**
   * Checks whether this post effect requires the linear depth texture
   * @returns true if the linear depth texture is required.
   */
  requireLinearDepthTexture(_ctx: DrawContext) {
    return false;
  }
  /**
   * Checks whether this post effect requires the scene depth buffer
   * @returns true if the scene depth buffer is required.
   */
  requireDepthAttachment(_ctx: DrawContext) {
    return false;
  }
  /**
   * Checks whether this post effect requires the motion vector texture
   * @returns true if the motion vector texture is required.
   */
  requireMotionVectorTexture(_ctx: DrawContext) {
    return false;
  }
  /** Checks whether this post effect requires the Hi-Z depth pyramid. */
  requireHiZTexture(_ctx: DrawContext) {
    return false;
  }
  /** Checks whether this post effect requires opaque-scene world normals. */
  requireSceneNormalTexture(_ctx: DrawContext) {
    return false;
  }
  /** Checks whether this post effect requires opaque-scene roughness data. */
  requireSceneRoughnessTexture(_ctx: DrawContext) {
    return false;
  }
  /**
   * Checks whether this post effect requires the screen-space shadow mask.
   *
   * When true and the mask was produced this frame, the effect can sample
   * `DrawContext.shadowMaskTexture` in its apply() body; the graph keeps the
   * mask alive for the effect's pass.
   * @returns true if the shadow mask is required.
   */
  requireShadowMask(_ctx: DrawContext) {
    return false;
  }
  /** Collect this effect's semantic frame-resource requirements. @internal */
  getFrameResourceRequirements(ctx: DrawContext): FrameResourceRequirements {
    return {
      motionVector: this.requireMotionVectorTexture(ctx),
      hiZ: this.requireHiZTexture(ctx),
      sceneNormal: this.requireSceneNormalTexture(ctx),
      sceneRoughness: this.requireSceneRoughnessTexture(ctx),
      shadowMask: this.requireShadowMask(ctx)
    };
  }
  /**
   * Apply the post effect
   * @param camera - Camera used the render the scene
   * @param inputColorTexture - The previous scene color texture
   * @param sceneDepthTexture - The linear scene depth texture
   * @param srgbOutput - Whether the result should be gamma corrected
   *
   * @remarks
   * The frame buffer of the post effect is already set when apply() is called.
   */
  apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    this.passThrough(ctx, inputColorTexture, srgbOutput);
  }
  /**
   * Declare this effect's passes on the render graph.
   *
   * The default implementation wraps {@link AbstractPostEffect.apply} into a
   * single graph pass, so effects only overriding apply() work unchanged.
   * Multi-pass effects override this method to declare each internal step as
   * its own pass, calling {@link PostEffectSetupContext.createOutput} inside
   * the final pass.
   *
   * @param s - Build-time setup context.
   * @returns The effect's output color handle.
   */
  setup(s: PostEffectSetupContext): RGHandle {
    return this._setupFromApply(s);
  }
  /**
   * Wraps the legacy apply() entry into a single graph pass.
   * @internal
   */
  protected _setupFromApply(s: PostEffectSetupContext): RGHandle {
    const passName = `PostEffect:${this.constructor.name}`;
    return s.graph.addPass(passName, (builder) => {
      builder.read(s.input);
      for (const dep of s.dependencies) {
        builder.read(dep);
      }
      for (const binding of s.historyReads) {
        builder.read(binding.handle);
      }
      // Declare reads according to the effect's declared requirements so the
      // executor keeps exactly the textures this effect samples alive. Effects
      // reaching frame textures through DrawContext fields must declare them
      // via requireLinearDepthTexture / requireMotionVectorTexture.
      const linearDepthHandle = this.requireLinearDepthTexture(s.ctx)
        ? s.blackboard.get(FrameResources.LinearDepth)
        : null;
      if (linearDepthHandle) {
        builder.read(linearDepthHandle);
      }
      const motionVectorHandle = this.requireMotionVectorTexture(s.ctx)
        ? s.blackboard.get(FrameResources.MotionVector)
        : null;
      if (motionVectorHandle) {
        builder.read(motionVectorHandle);
      }
      const hiZHandle = this.requireHiZTexture(s.ctx) ? s.blackboard.get(FrameResources.HiZ) : null;
      if (hiZHandle) {
        builder.read(hiZHandle);
      }
      const sceneNormalHandle = this.requireSceneNormalTexture(s.ctx)
        ? s.blackboard.get(FrameResources.SceneNormal)
        : null;
      if (sceneNormalHandle) {
        builder.read(sceneNormalHandle);
      }
      const sceneRoughnessHandle = this.requireSceneRoughnessTexture(s.ctx)
        ? s.blackboard.get(FrameResources.SceneRoughness)
        : null;
      if (sceneRoughnessHandle) {
        builder.read(sceneRoughnessHandle);
      }
      // Keep the screen-space shadow mask alive for effects that sample it
      // (via DrawContext.shadowMaskTexture) instead of recomputing shadows.
      const shadowMaskHandle = this.requireShadowMask(s.ctx)
        ? s.blackboard.get(FrameResources.ShadowMask)
        : null;
      if (shadowMaskHandle) {
        builder.read(shadowMaskHandle);
      }
      const output = s.createOutput(builder, {
        needDepthAttachment: this.requireDepthAttachment(s.ctx)
      });
      builder.setExecute((rg) => {
        const device = s.ctx.device;
        const inputTexture = rg.getTexture<Texture2D>(s.input);
        const linearDepthTexture = linearDepthHandle
          ? rg.getTexture<Texture2D>(linearDepthHandle)
          : s.ctx.linearDepthTexture!;
        const applyEffect = () => {
          device.pushDeviceStates();
          try {
            device.setFramebuffer(output.framebuffer ? rg.getFramebuffer(output.framebuffer) : null);
            this.apply(s.ctx, inputTexture, linearDepthTexture, output.srgbOutput);
          } finally {
            device.popDeviceStates();
          }
        };
        if (s.history && s.historyReads.length > 0) {
          s.history.beginReadScope(
            s.historyReads.map((binding) => ({
              name: binding.name,
              texture: rg.getTexture<Texture2D>(binding.handle)
            }))
          );
          try {
            applyEffect();
          } finally {
            s.history.endReadScope();
          }
        } else {
          applyEffect();
        }
      });
      return output.color;
    });
  }
  /**
   *
   * @param ctx - Draw context
   * @param inputColorTexture - Input color texture
   * @param srgbOutput - Whether the result should be gamma corrected
   */
  protected passThrough(
    ctx: DrawContext,
    inputColorTexture: Texture2D,
    srgbOutput: boolean,
    renderStates?: RenderStateSet
  ) {
    copyTexture(
      inputColorTexture,
      ctx.device.getFramebuffer()!,
      fetchSampler('clamp_nearest_nomip'),
      renderStates,
      0,
      srgbOutput
    );
  }
  /**
   * Draws a fullscreen quad
   * @param renderStateSet - Render states that will be used when drawing the fullscreen quad.
   */
  protected drawFullscreenQuad(renderStateSet?: RenderStateSet) {
    drawFullscreenQuad(renderStateSet);
  }
  /** @internal */
  protected createVertexLayout(device: AbstractDevice) {
    return device.createVertexLayout({
      vertexBuffers: [
        {
          buffer: device.createVertexBuffer('position_f32x2', new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]))!
        }
      ]
    });
  }
  protected onDispose() {
    super.onDispose();
    this.destroy();
  }
  /** @internal */
  protected createRenderStates(device: AbstractDevice) {
    const renderStates = device.createRenderStateSet();
    renderStates.useRasterizerState().setCullMode('none');
    renderStates.useDepthState().enableTest(false).enableWrite(false);
    return renderStates;
  }
  /** @internal */
  protected destroy() {}
  /** @internal */
  static getDefaultRenderState(ctx: DrawContext, compareFunc: CompareFunc) {
    let renderState = this._defaultRenderStates[compareFunc as keyof typeof this._defaultRenderStates];
    if (!renderState) {
      renderState = ctx.device.createRenderStateSet();
      renderState.useRasterizerState().setCullMode('none');
      renderState
        .useDepthState()
        .enableTest(compareFunc !== 'always')
        .enableWrite(false)
        .setCompareFunc(compareFunc);
      this._defaultRenderStates[compareFunc as keyof typeof this._defaultRenderStates] = renderState;
    }
    return renderState;
  }
}
