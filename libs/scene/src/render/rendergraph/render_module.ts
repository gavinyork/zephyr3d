import type { RenderContext } from './render_context';
import type { FrameResourceRequirements } from './frame_resource_requirements';
import type { RenderPipeline } from './render_pipeline';

/** Selects which declared writer satisfies a module resource read. @public */
export interface RenderModuleReadDescriptor {
  /** Blackboard resource key. */
  readonly resource: string;
  /** Writer selection. `final` may reorder the module. Default `current`. */
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

/** A pipeline stage that declares dependencies and builds graph passes. @public */
export interface RenderModule<TCtx extends RenderContext = RenderContext> {
  /** Stable identifier used by pipeline editing methods. */
  readonly type: string;

  /**
   * Blackboard resources required by `setup`. String entries retain the legacy
   * optional-final behavior.
   */
  readonly reads?: readonly RenderModuleRead[];

  /** Blackboard resources published by `setup`, used for dependency ordering. */
  readonly writes?: readonly string[];

  /** Called when this module becomes owned by a pipeline. */
  attach?(pipeline: RenderPipeline<TCtx>): void;

  /** Called immediately before this module leaves its owning pipeline. */
  detach?(pipeline: RenderPipeline<TCtx>): void;

  /** Release resources owned by this module. Called at most once by its pipeline. */
  dispose?(): void;

  /** Create an independent module for {@link RenderPipeline.clone}. */
  clone?(): RenderModule<TCtx>;

  /**
   * Declare frame resources before setup. This must be pure and return no
   * requirements when the module will be disabled.
   */
  requirements?(context: TCtx): FrameResourceRequirements;

  /** Whether this module contributes to the current frame. */
  enabled(context: TCtx): boolean;

  /** Add this module's passes and publish its outputs. */
  setup(context: TCtx): void;
}
