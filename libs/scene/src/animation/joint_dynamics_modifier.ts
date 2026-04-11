import { SkeletonModifier } from './skeleton_modifier';
import type { Skeleton } from './skeleton';
import type { JointDynamicsSystem } from './joint_dynamics/joint_dynamics_system';

/**
 * Post-processor wrapper for joint dynamics systems.
 *
 * Integrates joint-based physics simulation into the skeleton post-processing pipeline.
 * The joint dynamics system is updated each frame and results are blended with the base animation.
 *
 * @public
 */
export class JointDynamicsModifier extends SkeletonModifier {
  private _jointDynamicsSystem: JointDynamicsSystem;

  /**
   * Create a joint dynamics post-processor.
   *
   * @param jointDynamicsSystem - The joint dynamics system to integrate
   */
  constructor(jointDynamicsSystem: JointDynamicsSystem) {
    super();
    this._jointDynamicsSystem = jointDynamicsSystem;
  }

  /**
   * Get the joint dynamics system.
   */
  get jointDynamicsSystem(): JointDynamicsSystem {
    return this._jointDynamicsSystem;
  }

  /**
   * Apply spring physics to skeleton joints.
   */
  apply(_skeleton: Skeleton, deltaTime: number): void {
    if (!this._enabled || this.weight <= 0) {
      return;
    }

    // Update spring physics simulation
    this._jointDynamicsSystem.update(deltaTime);
  }

  /**
   * Reset the spring system to initial state.
   */
  reset(): void {
    this._jointDynamicsSystem.controller.reset();
  }

  warp(): void {
    this._jointDynamicsSystem.controller.warp();
  }

  protected _getWeight(): number {
    return 1 - this._jointDynamicsSystem.controller.blendRatio;
  }

  protected _setWeight(value: number): void {
    this._jointDynamicsSystem.controller.blendRatio = 1 - Math.max(0, Math.min(1, value));
  }
}
