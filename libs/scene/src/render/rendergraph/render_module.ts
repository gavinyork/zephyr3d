import type { RenderContext } from './render_context';
import type { FrameResourceRequirements } from './frame_resource_requirements';
import type { RenderPipeline } from './render_pipeline';

/** Selects which declared writer satisfies a module resource read. @public */
export interface RenderModuleReadDescriptor {
  /** Blackboard resource key. */
  readonly resource: string;
  /**
   * `current` selects the nearest prior writer in authored order. `final`
   * selects the last writer in the pipeline and may reorder this module.
   * Default `current`.
   */
  readonly version?: 'current' | 'final';
  /** Allow the read to have no enabled declared writer. Default false. */
  readonly optional?: boolean;
}

/**
 * Module resource read declaration. A string is the compatibility shorthand
 * for `{ resource, version: 'final', optional: true }`.
 * @public
 */
export type RenderModuleRead = string | RenderModuleReadDescriptor;

/**
 * A self-describing unit of a {@link ./render_pipeline#RenderPipeline}.
 *
 * Each module owns the setup of one logical stage (depth prepass, light pass,
 * the composite post-effect tail, ...): it declares its own gating condition and
 * adds its passes to the graph, reading inputs from and publishing outputs to
 * the shared context — the blackboard for resource handles (see
 * {@link ./blackboard#FrameResources}) and the ordering scope for side-effect
 * tokens.
 *
 * Modules run in the pipeline's authored order. A module never reaches into
 * another module's local variables — all cross-module data flows through the
 * context — which is what lets a pipeline be recomposed (insert/replace/remove).
 *
 * The module is parameterized over its context type `TCtx`. The default,
 * pipeline-agnostic {@link RenderContext} gives access to `graph` (to add
 * passes), `blackboard` (to read/publish named frame resources) and `ordering`.
 * A module targeting a concrete pipeline narrows `TCtx` to that pipeline's
 * context (e.g. {@link ./frame_graph_context#ForwardPlusModuleContext}) to reach
 * the pipeline-specific state; such a module is only composable into a pipeline
 * of the matching context type.
 *
 * Note: `setup` runs at graph-build time. Execute-time work stays in the pass
 * execute callbacks the module registers.
 *
 * @public
 */
export interface RenderModule<TCtx extends RenderContext = RenderContext> {
  /**
   * Stable identifier for this module (e.g. 'DepthPrepass', 'LightPass'). Used
   * as the anchor for pipeline insertion/replacement/removal. Where a module
   * maps to a single pass, it matches the pass name.
   */
  readonly type: string;

  /**
   * Named frame resources (blackboard keys, see {@link ./blackboard#FrameResources})
   * this module's `setup` depends on being published already.
   *
   * Descriptor reads distinguish the resource visible at the authored position
   * (`version: 'current'`) from the pipeline's last writer (`version: 'final'`).
   * Required reads reject missing enabled writers; set `optional: true` when
   * absence is supported. String reads retain legacy optional-final behavior.
   * `enabled()` is evaluated before setup and must not depend on resources
   * published by another module's setup.
   *
   * Omit for a module whose position is authored explicitly (append / insertAfter / ...).
   */
  readonly reads?: readonly RenderModuleRead[];

  /**
   * Named frame resources (blackboard keys) this module's `setup` publishes.
   * Used only to anchor other modules' {@link RenderModule.reads}; declaring a
   * resource here does not by itself change this module's own position.
   */
  readonly writes?: readonly string[];

  /** Called when this module becomes owned by a pipeline. */
  attach?(pipeline: RenderPipeline<TCtx>): void;

  /** Called immediately before this module leaves its owning pipeline. */
  detach?(pipeline: RenderPipeline<TCtx>): void;

  /** Release resources owned by this module. Called at most once by its pipeline. */
  dispose?(): void;

  /**
   * Create an independent module for {@link RenderPipeline.clone}. Modules with
   * lifecycle hooks must provide this method; stateless modules may be shared.
   */
  clone?(): RenderModule<TCtx>;

  /**
   * Declare semantic frame resources this module needs the pipeline to produce.
   * This preflight hook runs before any module setup and before the blackboard is
   * populated. It must be pure and may only inspect frame/camera/queue state.
   * The hook is called even when `enabled()` will later return false, so it must
   * return an empty object when the module will not participate in this frame.
   */
  requirements?(context: TCtx): FrameResourceRequirements;

  /**
   * Whether this module contributes to the current frame. Derived from
   * scene/camera/render-queue state and the pipeline options on the context.
   * Disabled modules are removed before `reads`/`writes` dependency resolution,
   * and their {@link RenderModule.setup} is skipped entirely. Consequently a
   * disabled writer cannot become the producer that orders an enabled consumer.
   *
   * @param context - The render module build context.
   * @returns true if the module should build its passes this frame.
   */
  enabled(context: TCtx): boolean;

  /**
   * Add this module's passes to the graph.
   *
   * Reads inputs from `context.blackboard` / `context.ordering`, adds passes
   * through `context.graph`, and publishes named outputs back to the blackboard
   * for downstream modules.
   *
   * @param context - The render module build context.
   */
  setup(context: TCtx): void;
}
