import type { RenderModuleContext } from './frame_graph_context';

/**
 * A self-describing unit of a {@link ./render_pipeline#RenderPipeline}.
 *
 * Each module owns the setup of one logical stage (depth prepass, light pass,
 * the composite post-effect tail, ...): it declares its own gating condition and
 * adds its passes to the graph, reading inputs from and publishing outputs to
 * the shared {@link RenderModuleContext} — the blackboard for resource handles
 * (see {@link ./blackboard#FrameResources}) and the ordering scope for
 * side-effect tokens.
 *
 * Modules run in the pipeline's authored order. A module never reaches into
 * another module's local variables — all cross-module data flows through the
 * context — which is what lets a pipeline be recomposed (insert/replace/remove).
 *
 * A custom module inserted into the Forward+ pipeline typically only needs
 * `ctx.graph` (to add passes), `ctx.blackboard` (to read/publish named frame
 * resources), and `ctx.ctx` (the {@link ../drawable#DrawContext}). Replacing a
 * built-in producer additionally requires reproducing whatever that module
 * publishes for downstream modules.
 *
 * Note: `setup` runs at graph-build time. Execute-time work stays in the pass
 * execute callbacks the module registers.
 *
 * @public
 */
export interface RenderModule {
  /**
   * Stable identifier for this module (e.g. 'DepthPrepass', 'LightPass'). Used
   * as the anchor for pipeline insertion/replacement/removal. Where a module
   * maps to a single pass, it matches the pass name.
   */
  readonly type: string;

  /**
   * Whether this module contributes to the current frame. Derived from
   * scene/camera/render-queue state and the pipeline options on the context.
   * A disabled module's {@link RenderModule.setup} is skipped entirely.
   *
   * @param context - The render module build context.
   * @returns true if the module should build its passes this frame.
   */
  enabled(context: RenderModuleContext): boolean;

  /**
   * Add this module's passes to the graph.
   *
   * Reads inputs from `context.blackboard` / `context.ordering`, adds passes
   * through `context.graph`, and publishes named outputs back to the blackboard
   * for downstream modules.
   *
   * @param context - The render module build context.
   */
  setup(context: RenderModuleContext): void;
}
