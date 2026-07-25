import type { RenderContext } from './render_context';
import type { FrameResourceRequirements } from './frame_resource_requirements';
import type { RenderPipeline } from './render_pipeline';
import type { FrameResourceKey } from './blackboard';

/** Selects which declared writer satisfies a module resource read. @public */
export interface RenderModuleReadDescriptor {
  /** Blackboard resource key. */
  readonly resource: FrameResourceKey;
  /** Writer selection. `final` may reorder the module. Default `current`. */
  readonly version?: 'current' | 'final';
  /** Allow the read to have no enabled declared writer. Default false. */
  readonly optional?: boolean;
}

/** Module resource read declaration. @public */
export type RenderModuleRead = RenderModuleReadDescriptor;

/** Result of the module's per-frame feature preparation. @public */
export interface RenderModulePreparation {
  /** Whether setup should contribute passes this frame. */
  readonly enabled: boolean;
  /** Frame resources required by enabled modules. */
  readonly requirements?: FrameResourceRequirements;
}

/** A pipeline stage that declares dependencies and builds graph passes. @public */
export interface RenderModule<TCtx extends RenderContext = RenderContext> {
  /** Stable identifier used by pipeline editing methods. */
  readonly type: string;

  /** Blackboard resources required by `setup`, resolved before module ordering. */
  readonly reads?: readonly RenderModuleRead[];

  /** Blackboard resources published by `setup`, used for dependency ordering. */
  readonly writes?: readonly FrameResourceKey[];

  /** Called when this module becomes owned by a pipeline. */
  attach?(pipeline: RenderPipeline<TCtx>): void;

  /** Called immediately before this module leaves its owning pipeline. */
  detach?(pipeline: RenderPipeline<TCtx>): void;

  /** Release resources owned by this module. Called at most once by its pipeline. */
  dispose?(): void;

  /** Create an independent module for {@link RenderPipeline.clone}. */
  clone?(): RenderModule<TCtx>;

  /** Prepare pure feature state and requirements for the current frame. */
  prepare(context: TCtx): RenderModulePreparation;

  /** Add this module's passes and publish its outputs. */
  setup(context: TCtx): void;
}
