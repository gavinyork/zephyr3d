import { Vector3, Quaternion } from '@zephyr3d/base';
import { IKSolver } from './ik_solver';
import type { IKChain } from './ik_chain';
import { IKUtils } from './ik_utils';
import type { TwistConstraint } from './ik_constraint';

/**
 * Pole vector configuration for a specific joint.
 */
interface PoleVectorConfig {
  /** Pole vector position in world space */
  position: Vector3;
  /** Weight of the pole vector constraint (0-1) */
  weight: number;
}

/**
 * FABRIK (Forward And Backward Reaching Inverse Kinematics) solver.
 *
 * @remarks
 * FABRIK is an iterative IK algorithm that alternates between:
 * 1. Forward pass: Move from end effector to root, pulling joints toward target
 * 2. Backward pass: Move from root to end effector, restoring root position
 *
 * Supports multiple pole vectors to control the bending direction of different joints.
 *
 * @public
 */
export class FABRIKSolver extends IKSolver {
  /** Map of joint index to pole vector configuration */
  private _poleVectors: Map<number, PoleVectorConfig>;
  /** Twist constraints for each joint (indexed by joint index) */
  private _twistConstraints: Map<number, TwistConstraint>;

  /**
   * Create a FABRIK solver.
   *
   * @param chain - The IK chain to solve
   * @param maxIterations - Maximum number of iterations (default: 15)
   * @param tolerance - Convergence tolerance in world units (default: 0.001)
   */
  constructor(chain: IKChain, maxIterations = 15, tolerance = 0.001) {
    super(chain, maxIterations, tolerance);
    this._poleVectors = new Map();
    this._twistConstraints = new Map();

    // Set default twist constraints for all joints
    for (let i = 0; i < chain.joints.length - 1; i++) {
      // Middle joints have more restrictive twist limits
      const isMiddleJoint = i > 0 && i < chain.joints.length - 2;
      this._twistConstraints.set(i, {
        minTwist: isMiddleJoint ? -Math.PI * 0.2 : -Math.PI * 0.3,
        maxTwist: isMiddleJoint ? Math.PI * 0.2 : Math.PI * 0.3,
        smoothFactor: 0.3
      });
    }
  }

  /**
   * Set twist constraint for a specific joint.
   *
   * @param jointIndex - Index of the joint
   * @param minTwist - Minimum twist angle in radians
   * @param maxTwist - Maximum twist angle in radians
   * @param smoothFactor - Smoothing factor [0-1] (default: 0.3)
   */
  setTwistConstraint(
    jointIndex: number,
    minTwist: number,
    maxTwist: number,
    smoothFactor: number = 0.3
  ): void {
    if (jointIndex < 0 || jointIndex >= this._chain.joints.length - 1) {
      throw new Error(`Invalid joint index: ${jointIndex}`);
    }

    this._twistConstraints.set(jointIndex, {
      minTwist,
      maxTwist,
      smoothFactor: Math.max(0, Math.min(1, smoothFactor))
    });
  }

  /**
   * Get twist constraint for a specific joint.
   *
   * @param jointIndex - Index of the joint
   * @returns Twist constraint or undefined if not set
   */
  getTwistConstraint(jointIndex: number): TwistConstraint | undefined {
    return this._twistConstraints.get(jointIndex);
  }

  /**
   * Remove twist constraint for a specific joint.
   *
   * @param jointIndex - Index of the joint
   * @returns True if a constraint was removed
   */
  removeTwistConstraint(jointIndex: number): boolean {
    return this._twistConstraints.delete(jointIndex);
  }

  /**
   * Clear all twist constraints.
   */
  clearTwistConstraints(): void {
    this._twistConstraints.clear();
  }

  /**
   * Set pole vector for a specific joint.
   *
   * @param jointIndex - Index of the joint to apply pole vector to
   * @param poleVector - Pole vector position in world space
   * @param weight - Weight of the pole vector constraint (0-1, default: 1)
   */
  setPoleVector(jointIndex: number, poleVector: Vector3, weight = 1): void {
    if (jointIndex < 0 || jointIndex >= this._chain.joints.length) {
      throw new Error(`Invalid joint index: ${jointIndex}`);
    }

    this._poleVectors.set(jointIndex, {
      position: poleVector.clone(),
      weight: Math.max(0, Math.min(1, weight))
    });
  }

  /**
   * Remove pole vector for a specific joint.
   *
   * @param jointIndex - Index of the joint to remove pole vector from
   * @returns True if a pole vector was removed, false if none existed
   */
  removePoleVector(jointIndex: number): boolean {
    return this._poleVectors.delete(jointIndex);
  }

  /**
   * Clear all pole vectors.
   */
  clearPoleVectors(): void {
    this._poleVectors.clear();
  }

  /**
   * Get pole vector configuration for a specific joint.
   *
   * @param jointIndex - Index of the joint
   * @returns Pole vector configuration or undefined if not set
   */
  getPoleVector(jointIndex: number): { position: Vector3; weight: number } | undefined {
    const config = this._poleVectors.get(jointIndex);
    if (config) {
      return {
        position: config.position.clone(),
        weight: config.weight
      };
    }
    return undefined;
  }

  /**
   * Check if a joint has a pole vector.
   *
   * @param jointIndex - Index of the joint
   * @returns True if the joint has a pole vector
   */
  hasPoleVector(jointIndex: number): boolean {
    return this._poleVectors.has(jointIndex);
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

      const originalDirNorm = Vector3.normalize(originalDir, new Vector3());
      const newDirNorm = Vector3.normalize(newDir, new Vector3());

      // Calculate basic rotation
      const deltaRotation = new Quaternion();
      IKUtils.fromToRotation(originalDirNorm, newDirNorm, deltaRotation);

      // Calculate new world rotation
      let worldRotation = Quaternion.multiply(deltaRotation, joint.originalRotation, new Quaternion());

      // Apply swing-twist constraint to prevent over-rotation
      const swing = new Quaternion();
      const twist = new Quaternion();
      worldRotation.decomposeSwingTwist(newDirNorm, swing, twist);

      // Get twist angle
      let twistAngle = twist.getTwistAngle(newDirNorm);

      // Get twist constraint for this joint
      const constraint = this._twistConstraints.get(i);
      if (constraint) {
        // Clamp and smooth twist
        twistAngle = IKUtils.clampAndSmoothTwist(
          twistAngle,
          joint.previousTwist,
          constraint.minTwist,
          constraint.maxTwist,
          constraint.smoothFactor
        );
      }

      // Store for next frame
      joint.previousTwist = twistAngle;

      // Reconstruct rotation from clamped twist: Q = Twist * Swing
      const clampedTwist = Quaternion.fromAxisAngle(newDirNorm, twistAngle);
      worldRotation = Quaternion.multiply(clampedTwist, swing, worldRotation);

      // Blend with original rotation based on weight
      if (weight < 1) {
        Quaternion.slerp(joint.originalRotation, worldRotation, weight, worldRotation);
      }

      // Store this frame's world rotation
      if (!joint.previousIKRotation) {
        joint.previousIKRotation = worldRotation.clone();
      } else {
        joint.previousIKRotation.set(worldRotation);
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
   * This is called during the FABRIK passes to integrate constraints into the algorithm.
   *
   * @param jointIndex - Index of the joint to apply constraints to
   */
  private _applyConstraintsForJoint(jointIndex: number): void {
    const constraints = this._chain.constraints;

    // Apply non-pole-vector constraints
    // IKPoleVectorConstraint is deprecated and ignored in favor of built-in pole vectors
    for (const constraint of constraints) {
      if (constraint.jointIndex === jointIndex) {
        // Skip IKPoleVectorConstraint - use built-in pole vectors instead
        if (constraint.constructor.name === 'IKPoleVectorConstraint') {
          continue;
        }
        constraint.apply(this._chain.joints);
      }
    }

    // Apply built-in pole vector if configured for this joint
    const poleConfig = this._poleVectors.get(jointIndex);
    if (poleConfig && poleConfig.weight > 0.001) {
      this._applyPoleVectorTwist(jointIndex, poleConfig.position, poleConfig.weight);
    }
  }

  /**
   * Apply pole vector twist to a specific joint.
   *
   * @remarks
   * This method adjusts the joint position to align with the pole vector.
   * It uses the same algorithm as IKPoleVectorConstraint but is integrated
   * into the solver for better performance and control.
   *
   * @param jointIndex - Index of the pole joint
   * @param poleVector - Pole vector position in world space
   * @param weight - Weight of the pole vector constraint (0-1)
   */
  private _applyPoleVectorTwist(jointIndex: number, poleVector: Vector3, weight: number): void {
    const joints = this._chain.joints;

    // We need at least 3 joints to apply pole vector (parent, pole joint, child)
    if (jointIndex < 1 || jointIndex >= joints.length - 1) {
      return;
    }

    const parentJoint = joints[jointIndex - 1];
    const currentJoint = joints[jointIndex];
    const childJoint = joints[jointIndex + 1];

    const parentPos = parentJoint.position;
    const currentPos = currentJoint.position;
    const childPos = childJoint.position;

    // Calculate the plane defined by parent, child, and pole vector
    // Vector from parent to child (the "line" we're bending around)
    const parentToChild = Vector3.sub(childPos, parentPos, new Vector3());
    const lineLength = parentToChild.magnitude;

    if (lineLength < 0.000001) {
      return; // Parent and child are at same position
    }

    const lineDir = Vector3.scale(parentToChild, 1 / lineLength, new Vector3());

    // Project current joint onto the parent-child line
    const parentToCurrent = Vector3.sub(currentPos, parentPos, new Vector3());
    const projectionLength = Vector3.dot(parentToCurrent, lineDir);
    const projectionPoint = Vector3.scale(lineDir, projectionLength, new Vector3());
    Vector3.add(parentPos, projectionPoint, projectionPoint);

    // Vector from projection point to current joint (perpendicular to line)
    const perpendicular = Vector3.sub(currentPos, projectionPoint, new Vector3());
    const perpLength = perpendicular.magnitude;

    if (perpLength < 0.000001) {
      return; // Current joint is on the line
    }

    // Calculate desired direction toward pole vector
    const parentToPole = Vector3.sub(poleVector, parentPos, new Vector3());
    const poleProjectionLength = Vector3.dot(parentToPole, lineDir);
    const poleProjectionPoint = Vector3.scale(lineDir, poleProjectionLength, new Vector3());
    Vector3.add(parentPos, poleProjectionPoint, poleProjectionPoint);

    // Direction from projection to pole (perpendicular to line)
    const poleDirection = Vector3.sub(poleVector, poleProjectionPoint, new Vector3());
    const poleDirLength = poleDirection.magnitude;

    if (poleDirLength < 0.000001) {
      return; // Pole is on the line
    }

    poleDirection.scaleBy(1 / poleDirLength);

    // Calculate new position for current joint
    // Keep the same distance from the line, but rotate toward pole direction
    const desiredPerpendicular = Vector3.scale(poleDirection, perpLength, new Vector3());
    const newPosition = Vector3.add(projectionPoint, desiredPerpendicular, new Vector3());

    // Apply weight (blend between original and constrained position)
    if (weight < 0.999) {
      const blended = new Vector3();
      blended.x = currentPos.x + (newPosition.x - currentPos.x) * weight;
      blended.y = currentPos.y + (newPosition.y - currentPos.y) * weight;
      blended.z = currentPos.z + (newPosition.z - currentPos.z) * weight;
      currentJoint.position.set(blended);
    } else {
      currentJoint.position.set(newPosition);
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
