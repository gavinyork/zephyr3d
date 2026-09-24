import { SkeletonModifier } from './skeleton_modifier';
import type { SkeletonRig } from './skeleton';
import type { SpringSystem } from './spring/spring_system';

/**
 * Post-processor wrapper for spring physics systems.
 *
 * Integrates spring-based physics simulation into the skeleton post-processing pipeline.
 * The spring system is updated each frame and results are blended with the base animation.
 *
 * @deprecated Use the new {@link JointDynamicsModifier} class instead.
 *
 * @public
 */
export class SpringModifier extends SkeletonModifier {
  private _springSystem: SpringSystem;
  private _weight: number;
  private _sourceId: string;
  private _startupDelay: number;
  private _startupDelayRemaining: number;

  /**
   * Create a spring post-processor.
   *
   * @param springSystem - The spring system to integrate
   * @param weight - Blend weight [0-1] (default: 1.0)
   * @param startupDelay - Seconds spent following the animated pose before simulation starts (default: 0.1)
   */
  constructor(springSystem: SpringSystem, weight: number = 1.0, startupDelay: number = 0.1) {
    super();
    this._weight = weight;
    this._springSystem = springSystem;
    this._sourceId = '';
    this._startupDelay = Math.max(0, Number(startupDelay) || 0);
    this._startupDelayRemaining = this._startupDelay;
  }

  /**
   * Get the spring system.
   */
  get springSystem(): SpringSystem {
    return this._springSystem;
  }

  /**
   * Get the identifier of the configuration that created this modifier.
   */
  get sourceId(): string {
    return this._sourceId;
  }

  set sourceId(value: string) {
    this._sourceId = value;
  }

  /**
   * Apply spring physics to skeleton joints.
   */
  apply(_skeleton: SkeletonRig, deltaTime: number): void {
    if (!this._enabled || this._weight <= 0) {
      return;
    }

    if (this._startupDelayRemaining > 0 && this.reinitializeFromCurrentPose()) {
      this._startupDelayRemaining = Math.max(
        0,
        this._startupDelayRemaining - Math.max(0, Number(deltaTime) || 0)
      );
      return;
    }

    // Update spring physics simulation
    this._springSystem.update(deltaTime);

    // Apply results to scene nodes with blending
    this._springSystem.applyToNodes(this._weight);
  }

  /**
   * Reset the spring system to initial state.
   */
  reset(): void {
    this._springSystem.reset();
    this._startupDelayRemaining = this._startupDelay;
  }

  /** Restarts the pose-following startup window after a runtime hierarchy or binding change. */
  restartSimulation(startupDelay: number = this._startupDelay): void {
    this._startupDelayRemaining = Math.max(0, Number(startupDelay) || 0);
  }

  get startupDelay(): number {
    return this._startupDelay;
  }

  set startupDelay(value: number) {
    this._startupDelay = Math.max(0, Number(value) || 0);
  }

  /**
   * Get the blend weight for this processor.
   * @returns The current blend weight (0-1)
   */
  protected _getWeight(): number {
    return this._weight;
  }

  /**
   * Set the blend weight for this processor.
   * @param value - New blend weight (0-1)
   */
  protected _setWeight(value: number): void {
    this._weight = Math.max(0, Math.min(1, value));
  }

  private reinitializeFromCurrentPose(): boolean {
    const system = this._springSystem as SpringSystem & {
      reinitializeFromCurrentPose?: (options?: {
        recomputeAnchorOffsets?: boolean;
        recalculateRestLengths?: boolean;
      }) => void;
    };
    if (typeof system.reinitializeFromCurrentPose !== 'function') {
      this._startupDelayRemaining = 0;
      return false;
    }
    system.reinitializeFromCurrentPose({
      recomputeAnchorOffsets: true,
      recalculateRestLengths: true
    });
    return true;
  }
}
