import { Vector3, Quaternion } from '@zephyr3d/base';
import { IKSolver } from './ik_solver';
import type { IKChain } from './ik_chain';
import { IKUtils } from './ik_utils';

/**
 * FABRIK (Forward And Backward Reaching Inverse Kinematics) solver.
 *
 * @remarks
 * FABRIK is an iterative IK algorithm that alternates between:
 * 1. Forward pass: Move from end effector to root, pulling joints toward target
 * 2. Backward pass: Move from root to end effector, restoring root position
 *
 * @public
 */
export class FABRIKSolver extends IKSolver {
  /**
   * Create a FABRIK solver.
   *
   * @param chain - The IK chain to solve
   * @param maxIterations - Maximum number of iterations (default: 15)
   * @param tolerance - Convergence tolerance in world units (default: 0.001)
   */
  constructor(chain: IKChain, maxIterations = 15, tolerance = 0.001) {
    super(chain, maxIterations, tolerance);
  }

  /**
   * Solve the IK chain to reach the target position using FABRIK algorithm.
   *
   * @param target - Target position for the end effector
   * @returns True if converged within tolerance, false otherwise
   */
  solve(target: Vector3): boolean {
    const joints = this._chain.joints;

    // Update joint positions from scene nodes before solving
    this._chain.updateFromNodes();

    // Store original positions
    this._chain.storeOriginalPositions();

    const rootPos = joints[0].originalPosition.clone();

    // Check if target is reachable
    const distToTarget = Vector3.distance(rootPos, target);
    if (distToTarget > this._chain.totalLength) {
      // Target unreachable - stretch chain toward target
      this._stretchToward(target);
      return false;
    }

    let converged = false;
    for (let iteration = 0; iteration < this._maxIterations; iteration++) {
      // Check convergence
      const distToEnd = Vector3.distance(joints[joints.length - 1].position, target);
      if (distToEnd < this._tolerance) {
        converged = true;
        break;
      }

      // Forward pass: end effector to root
      this._forwardPass(target);

      // Backward pass: root to end effector (constraints are applied within the pass)
      this._backwardPass(rootPos);
    }

    return converged;
  }

  /**
   * Apply the solved joint positions to scene nodes as rotations.
   *
   * @param weight - Blend weight (0 = original, 1 = full IK, default: 1)
   */
  applyToNodes(weight = 1): void {
    const joints = this._chain.joints;

    for (let i = 0; i < joints.length - 1; i++) {
      const joint = joints[i];
      const nextJoint = joints[i + 1];

      // Calculate direction from current joint to next joint in world space
      const originalDir = Vector3.sub(nextJoint.originalPosition, joint.originalPosition, new Vector3());
      const newDir = Vector3.sub(nextJoint.position, joint.position, new Vector3());

      // Calculate rotation needed to align original direction to new direction (in world space)
      const deltaRotation = new Quaternion();
      IKUtils.fromToRotation(originalDir, newDir, deltaRotation);

      // Calculate new world rotation
      let worldRotation = Quaternion.multiply(deltaRotation, joint.originalRotation, new Quaternion());

      // Blend with original rotation based on weight
      if (weight < 1) {
        Quaternion.slerp(joint.originalRotation, worldRotation, weight, worldRotation);
      }

      // Convert world rotation to local rotation (relative to parent)
      if (joint.node.parent) {
        const parentWorldRotation = new Quaternion();
        joint.node.parent.worldMatrix.decompose(null, parentWorldRotation, null);

        // localRotation = conjugate(parentWorldRotation) * worldRotation
        const parentInvRotation = Quaternion.conjugate(parentWorldRotation, new Quaternion());
        const localRotation = Quaternion.multiply(parentInvRotation, worldRotation, new Quaternion());

        joint.node.rotation = localRotation;
      } else {
        // Root node has no parent, world rotation is local rotation
        joint.node.rotation = worldRotation;
      }
    }
  }

  /**
   * Forward pass: move from end effector toward root.
   * Each joint is pulled toward its child, maintaining bone length.
   * Constraints are applied immediately after each joint adjustment.
   *
   * @param target - Target position for end effector
   */
  private _forwardPass(target: Vector3): void {
    const joints = this._chain.joints;

    // Set end effector to target
    joints[joints.length - 1].position.set(target);

    // Move backward through chain
    for (let i = joints.length - 2; i >= 0; i--) {
      const joint = joints[i];
      const childJoint = joints[i + 1];

      // Calculate direction from child to current joint
      const direction = Vector3.sub(joint.position, childJoint.position, new Vector3());
      const distance = direction.magnitude;

      if (distance > 0.000001) {
        direction.scaleBy(1 / distance);
        // Place joint at correct distance from child
        Vector3.scale(direction, joint.boneLength, direction);
        Vector3.add(childJoint.position, direction, joint.position);
      }

      // Apply constraints immediately after adjusting this joint
      // This ensures constraints are integrated into the FABRIK algorithm
      if (i > 0) {
        // Apply constraints for joint i (not for root joint)
        this._applyConstraintsForJoint(i);
      }
    }
  }

  /**
   * Backward pass: move from root toward end effector.
   * Each joint is pulled toward its parent, maintaining bone length.
   * Constraints are applied immediately after each joint adjustment.
   *
   * @param rootPos - Original root position to restore
   */
  private _backwardPass(rootPos: Vector3): void {
    const joints = this._chain.joints;

    // Restore root position
    joints[0].position.set(rootPos);

    // Move forward through chain
    for (let i = 0; i < joints.length - 1; i++) {
      const joint = joints[i];
      const childJoint = joints[i + 1];

      // Calculate direction from current joint to child
      const direction = Vector3.sub(childJoint.position, joint.position, new Vector3());
      const distance = direction.magnitude;

      if (distance > 0.000001) {
        direction.scaleBy(1 / distance);
        // Place child at correct distance from current joint
        Vector3.scale(direction, joint.boneLength, direction);
        Vector3.add(joint.position, direction, childJoint.position);
      }

      // Apply constraints immediately after adjusting this joint
      // This ensures constraints are integrated into the FABRIK algorithm
      this._applyConstraintsForJoint(i + 1);
    }
  }

  /**
   * Apply constraints for a specific joint.
   * This is called during the backward pass to integrate constraints into FABRIK.
   *
   * @param jointIndex - Index of the joint to apply constraints to
   */
  private _applyConstraintsForJoint(jointIndex: number): void {
    const constraints = this._chain.constraints;
    for (const constraint of constraints) {
      if (constraint.jointIndex === jointIndex) {
        constraint.apply(this._chain.joints);
      }
    }
  }

  /**
   * Stretch the chain toward an unreachable target.
   * All joints are aligned in a straight line toward the target.
   *
   * @param target - Unreachable target position
   */
  private _stretchToward(target: Vector3): void {
    const joints = this._chain.joints;
    const rootPos = joints[0].originalPosition;

    // Calculate direction from root to target
    const direction = Vector3.sub(target, rootPos, new Vector3()).inplaceNormalize();

    // Place each joint along the direction at its bone length
    let currentPos = rootPos.clone();
    for (let i = 0; i < joints.length; i++) {
      joints[i].position.set(currentPos);
      if (i < joints.length - 1) {
        const offset = Vector3.scale(direction, joints[i].boneLength, new Vector3());
        currentPos.addBy(offset);
      }
    }
  }
}
