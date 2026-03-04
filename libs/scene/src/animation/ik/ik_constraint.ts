import type { IKJoint } from './ik_joint';

/**
 * Base class for IK constraints.
 *
 * Constraints are applied after each FABRIK iteration to enforce
 * joint limitations (angle limits, pole vectors, etc.).
 *
 * @public
 */
export abstract class IKConstraint {
  /** The joint index this constraint applies to */
  protected _jointIndex: number;

  /**
   * Create an IK constraint.
   *
   * @param jointIndex - Index of the joint in the chain (0 = root)
   */
  constructor(jointIndex: number) {
    this._jointIndex = jointIndex;
  }

  /**
   * Get the joint index this constraint applies to.
   */
  get jointIndex(): number {
    return this._jointIndex;
  }

  /**
   * Apply the constraint to the joint chain.
   *
   * This method modifies joint positions to satisfy the constraint.
   *
   * @param joints - Array of all joints in the chain
   */
  abstract apply(joints: IKJoint[]): void;
}
