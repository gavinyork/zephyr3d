import { SkeletonModifier } from './skeleton_modifier';
import type { Skeleton } from './skeleton';
import type { SpringSystem } from './spring/spring_system';

/**
 * Post-processor wrapper for spring physics systems.
 *
 * Integrates spring-based physics simulation into the skeleton post-processing pipeline.
 * The spring system is updated each frame and results are blended with the base animation.
 *
 * @example
 * ```typescript
 * const springChain = new SpringChain([joint1, joint2, joint3]);
 * const springSystem = new SpringSystem(springChain);
 * const processor = new SpringPostProcessor(springSystem, 1.0);
 * skeleton.addPostProcessor(processor);
 * ```
 *
 * @public
 */
export class SpringModifier extends SkeletonModifier {
  private _springSystem: SpringSystem;

  /**
   * Create a spring post-processor.
   *
   * @param springSystem - The spring system to integrate
   * @param weight - Blend weight [0-1] (default: 1.0)
   * @param priority - Priority for ordering (default: 50)
   */
  constructor(springSystem: SpringSystem, weight: number = 1.0, priority: number = 50) {
    super(weight, priority);
    this._springSystem = springSystem;
  }

  /**
   * Get the spring system.
   */
  get springSystem(): SpringSystem {
    return this._springSystem;
  }

  /**
   * Apply spring physics to skeleton joints.
   */
  apply(_skeleton: Skeleton, deltaTime: number): void {
    if (!this._enabled || this._weight <= 0) {
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
  }
}
