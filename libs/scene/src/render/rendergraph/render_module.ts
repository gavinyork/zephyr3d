import type { FrameGraphContext } from './frame_graph_context';

/**
 * A self-describing unit of a render pipeline.
 *
 * Each module owns the setup of one logical stage (depth prepass, light pass,
 * a post-effect chain step, ...): it declares its own gating condition and adds
 * its passes to the graph, reading inputs from and publishing outputs to the
 * shared {@link FrameGraphContext} (the blackboard for resource handles, the
 * ordering scope for side-effect tokens, and the build state for intermediate
 * results that are not render-graph resources).
 *
 * Modules run in a fixed authored order. A module never reaches into another
 * module's local variables — all cross-module data flows through the context —
 * which is what lets the pipeline be recomposed (Phase 2) and, eventually,
 * described by a blueprint (Phase 3).
 *
 * Note: a module's `setup` runs at graph-build time. Execute-time work stays in
 * the pass execute callbacks it registers, which continue to share the process
 * singletons (`_scenePass`, ...) and DrawContext bridge fields exactly as
 * before — modularization does not change the execute-time state contract.
 *
 * @internal
 */
export interface RenderModule {
  /**
   * Stable identifier for this module (e.g. 'DepthPrepass'). Matches the pass
   * name where a module maps to a single pass. Used for ordering, insertion,
   * and (later) blueprint serialization.
   */
  readonly type: string;

  /**
   * Whether this module contributes to the current frame. Derived from
   * scene/camera/render-queue state and the pipeline options on the context.
   * A disabled module's {@link RenderModule.setup} is skipped entirely.
   *
   * @param fg - The frame graph build context.
   * @returns true if the module should build its passes this frame.
   */
  enabled(fg: FrameGraphContext): boolean;

  /**
   * Add this module's passes to the graph.
   *
   * Reads inputs from `fg.blackboard` / `fg.ordering` / `fg.state`, adds passes
   * through `fg.graph`, and publishes outputs back to the blackboard/build state
   * for downstream modules.
   *
   * @param fg - The frame graph build context.
   */
  setup(fg: FrameGraphContext): void;
}
