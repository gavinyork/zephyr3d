import type { DrawContext } from '../render';
import type { Texture2D, TextureFormat } from '@zephyr3d/device';
import type { AbstractPostEffect, PostEffectHistoryRead, PostEffectSetupContext } from './posteffect';
import { PostEffectLayer } from './posteffect';
import type { Nullable } from '@zephyr3d/base';
import { DRef } from '@zephyr3d/base';
import type { RenderGraph } from '../render/rendergraph/rendergraph';
import type { RGHandle, RGTextureAttachment } from '../render/rendergraph/types';
import type { RGBlackboard } from '../render/rendergraph/blackboard';
import type { HistoryResourceManager } from '../render/rendergraph/history_resource_manager';
import type { FrameResourceRequirements } from '../render/rendergraph/frame_resource_requirements';
import { mergeFrameResourceRequirements } from '../render/rendergraph/frame_resource_requirements';

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
   * True when the chain input physically resides in the final target (final
   * framebuffer used as scene intermediate). An effect whose input is the
   * final target must never direct-write it — sampling and rendering the same
   * texture in one pass is a feedback loop.
   */
  inputResidesInFinalTarget?: boolean;
  /**
   * Depth attachment for intermediate effect outputs that request one:
   * either a graph texture handle or a backend depth texture.
   */
  sceneDepthAttachment?: Nullable<RGTextureAttachment>;
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
  /**
   * Creates an instance of Compositor
   */
  constructor() {
    this._postEffects = [];
    this._postEffects[PostEffectLayer.opaque] = [];
    this._postEffects[PostEffectLayer.transparent] = [];
    this._postEffects[PostEffectLayer.end] = [];
  }
  /** @internal */
  layerHasEnabledEffect(layer: PostEffectLayer): boolean {
    return this._postEffects[layer].some((ref) => !!ref.get()?.enabled);
  }
  /** Collect semantic frame resources requested by every enabled effect. @internal */
  collectRequirements(ctx: DrawContext): FrameResourceRequirements {
    const requirements: FrameResourceRequirements = {};
    for (const layer of this._postEffects) {
      for (const ref of layer) {
        const effect = ref.get();
        if (effect?.enabled) {
          mergeFrameResourceRequirements(requirements, effect.getFrameResourceRequirements(ctx));
        }
      }
    }
    return requirements;
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
    const inputResidesInFinalTarget = !!options.inputResidesInFinalTarget;
    const width = ctx.renderWidth;
    const height = ctx.renderHeight;
    let chain = input;
    let wroteFinal = false;
    for (let i = 0; i < effects.length; i++) {
      const effect = effects[i];
      const isLast = i === effects.length - 1;
      // An effect that samples the final target's texture must not render into
      // it in the same pass (feedback loop); force an intermediate output.
      const inputIsFinalTarget = inputResidesInFinalTarget && chain === input;
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
        sceneDepthAttachment,
        dependencies,
        historyReads,
        createOutput(builder, opts) {
          const needDepthAttachment = !!opts?.needDepthAttachment;
          // Direct write to the final target is only allowed for the last effect
          // of the chain, only when the effect does not depth-test against
          // scene depth (the final target does not carry the scene depth
          // buffer), and only when the effect does not sample the final
          // target's own texture as its input.
          if (isLast && finalOutput && !needDepthAttachment && !inputIsFinalTarget) {
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
  /** Move an existing post effect immediately before another effect in the same layer. @internal */
  movePostEffectBefore(postEffect: AbstractPostEffect, referenceEffect: AbstractPostEffect) {
    const list = this._postEffects[postEffect.layer];
    if (postEffect.layer !== referenceEffect.layer) {
      return;
    }
    const sourceIndex = list.findIndex((val) => val.get() === postEffect);
    const referenceIndex = list.findIndex((val) => val.get() === referenceEffect);
    if (sourceIndex < 0 || referenceIndex < 0 || sourceIndex === referenceIndex - 1) {
      return;
    }
    const [ref] = list.splice(sourceIndex, 1);
    const targetIndex = list.findIndex((val) => val.get() === referenceEffect);
    list.splice(targetIndex, 0, ref);
  }
  /** Move an existing post effect immediately after another effect in the same layer. @internal */
  movePostEffectAfter(postEffect: AbstractPostEffect, referenceEffect: AbstractPostEffect) {
    const list = this._postEffects[postEffect.layer];
    if (postEffect.layer !== referenceEffect.layer) {
      return;
    }
    const sourceIndex = list.findIndex((val) => val.get() === postEffect);
    const referenceIndex = list.findIndex((val) => val.get() === referenceEffect);
    if (sourceIndex < 0 || referenceIndex < 0 || sourceIndex === referenceIndex + 1) {
      return;
    }
    const [ref] = list.splice(sourceIndex, 1);
    const targetIndex = list.findIndex((val) => val.get() === referenceEffect);
    list.splice(targetIndex + 1, 0, ref);
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
}
