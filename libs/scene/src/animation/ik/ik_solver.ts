import type { Vector3 } from '@zephyr3d/base';
import type { IKChain } from './ik_chain';

/**
 * Base class for IK solvers.
 *
 * @public
 */
export abstract class IKSolver {
  /** The IK chain to solve */
  protected _chain: IKChain;
  /** Maximum number of iterations */
  protected _maxIterations: number;
  /** Convergence tolerance (distance threshold) */
  protected _tolerance: number;

  /**
   * Create an IK solver.
   *
   * @param chain - The IK chain to solve
   * @param maxIterations - Maximum number of iterations (default: 10)
   * @param tolerance - Convergence tolerance in world units (default: 0.001)
   */
  constructor(chain: IKChain, maxIterations = 10, tolerance = 0.001) {
    this._chain = chain;
    this._maxIterations = maxIterations;
    this._tolerance = tolerance;
  }

  /**
   * Get the IK chain.
   */
  get chain(): IKChain {
    return this._chain;
  }

  /**
   * Set maximum number of iterations.
   */
  setMaxIterations(value: number): void {
    this._maxIterations = Math.max(1, value);
  }

  /**
   * Get maximum number of iterations.
   */
  getMaxIterations(): number {
    return this._maxIterations;
  }

  /**
   * Set convergence tolerance.
   */
  setTolerance(value: number): void {
    this._tolerance = Math.max(0, value);
  }

  /**
   * Get convergence tolerance.
   */
  getTolerance(): number {
    return this._tolerance;
  }

  /**
   * Solve the IK chain to reach the target position.
   *
   * @param target - Target position for the end effector
   * @returns True if converged, false otherwise
   */
  abstract solve(target: Vector3): boolean;

  /**
   * Apply the solved positions to the scene nodes as rotations.
   *
   * @param weight - Blend weight (0 = original, 1 = full IK)
   */
  abstract applyToNodes(weight?: number): void;
}
