import { SkeletonModifier } from './skeleton_modifier';
import type { Skeleton } from './skeleton';
import type { IKSolver } from './ik/ik_solver';
import type { Vector3 } from '@zephyr3d/base';

/**
 * Post-processor wrapper for IK solvers.
 *
 * Integrates IK solving into the skeleton post-processing pipeline.
 * The IK solver is executed each frame and results are blended with the base animation.
 *
 * @example
 * ```typescript
 * const ikChain = new IKChain([joint1, joint2, joint3]);
 * const ikSolver = new FABRIKSolver(ikChain);
 * const targetPos = new Vector3(1, 2, 3);
 * const processor = new IKPostProcessor(ikSolver, targetPos, 1.0);
 * skeleton.addPostProcessor(processor);
 * ```
 *
 * @public
 */
export class IKModifier<Solver extends IKSolver = IKSolver> extends SkeletonModifier {
  private _solver: Solver;
  private _target: Vector3;

  /**
   * Create an IK post-processor.
   *
   * @param solver - The IK solver to integrate
   * @param target - Target position for the end effector
   * @param weight - Blend weight [0-1] (default: 1.0)
   * @param priority - Priority for ordering (default: 50)
   */
  constructor(solver: Solver, target: Vector3, weight: number = 1.0, priority: number = 50) {
    super(weight, priority);
    this._solver = solver;
    this._target = target.clone();
  }

  /**
   * Get the IK solver.
   */
  get solver(): Solver {
    return this._solver;
  }

  /**
   * Get the current target position.
   */
  get target(): Vector3 {
    return this._target.clone();
  }

  /**
   * Set the target position for the end effector.
   *
   * @param target - New target position (will be cloned)
   */
  setTarget(target: Vector3): void {
    this._target.set(target);
  }

  /**
   * Apply IK solving to skeleton joints.
   */
  apply(_skeleton: Skeleton, _deltaTime: number): void {
    if (!this._enabled || this._weight <= 0) {
      return;
    }

    // Solve IK
    this._solver.solve(this._target);

    // Apply to nodes with blending
    this._solver.applyToNodes(this._weight);
  }

  /**
   * Reset the IK solver to initial state.
   */
  reset(): void {
    // IK solvers typically don't need explicit reset
    // as they solve based on current joint positions
  }
}
