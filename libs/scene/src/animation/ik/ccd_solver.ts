import { Vector3, Quaternion } from '@zephyr3d/base';
import { IKSolver } from './ik_solver';
import type { IKChain } from './ik_chain';
import { IKUtils } from './ik_utils';

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
 * Twist constraint configuration for a joint.
 */
export interface TwistConstraint {
  /** Minimum twist angle in radians */
  minTwist: number;
  /** Maximum twist angle in radians */
  maxTwist: number;
  /** Smoothing factor [0-1], 0 = no smoothing, 1 = full smoothing */
  smoothFactor: number;
}

/**
 * CCD (Cyclic Coordinate Descent) IK solver.
 *
 * @remarks
 * CCD is an iterative IK algorithm that works by:
 * 1. Starting from the joint closest to the end effector
 * 2. Rotating each joint to point the end effector toward the target
 * 3. Moving backward through the chain to the root
 * 4. Repeating until convergence or max iterations
 *
 * CCD is generally faster than FABRIK and works well for chains of any length.
 * It's particularly good for tentacles, tails, and other flexible chains.
 *
 * Supports multiple pole vectors to control the bending direction of different joints.
 *
 * @public
 */
export class CCDSolver extends IKSolver {
  /** Map of joint index to pole vector configuration */
  private _poleVectors: Map<number, PoleVectorConfig>;
  /** Twist constraints for each joint (indexed by joint index) */
  private _twistConstraints: Map<number, TwistConstraint>;

  /**
   * Create a CCD solver.
   *
   * @param chain - The IK chain to solve
   * @param maxIterations - Maximum number of iterations (default: 10)
   * @param tolerance - Convergence tolerance in world units (default: 0.001)
   */
  constructor(chain: IKChain, maxIterations = 10, tolerance = 0.001) {
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
   * Solve the IK chain to reach the target position using CCD algorithm.
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

    let converged = false;

    for (let iteration = 0; iteration < this._maxIterations; iteration++) {
      // Check convergence
      const endEffector = joints[joints.length - 1];
      const distToTarget = Vector3.distance(endEffector.position, target);

      if (distToTarget < this._tolerance) {
        converged = true;
        break;
      }

      // Iterate backward through joints (from second-to-last to root)
      // We skip the end effector itself since it doesn't have a child to rotate toward
      for (let i = joints.length - 2; i >= 0; i--) {
        const joint = joints[i];

        // Vector from current joint to end effector
        const toEnd = Vector3.sub(endEffector.position, joint.position, new Vector3());
        const toEndDist = toEnd.magnitude;

        // Vector from current joint to target
        const toTarget = Vector3.sub(target, joint.position, new Vector3());
        const toTargetDist = toTarget.magnitude;

        // Skip if either vector is too small
        if (toEndDist < 0.000001 || toTargetDist < 0.000001) {
          continue;
        }

        // Normalize vectors
        const toEndDir = Vector3.scale(toEnd, 1 / toEndDist, new Vector3());
        const toTargetDir = Vector3.scale(toTarget, 1 / toTargetDist, new Vector3());

        // Calculate rotation needed to align end effector toward target
        let rotation = new Quaternion();
        IKUtils.fromToRotation(toEndDir, toTargetDir, rotation);

        // Apply rotation to all joints from current to end effector
        this._rotateJointsFromIndex(i, rotation, joint.position);

        // Apply constraints after rotating this joint
        this._applyConstraintsForJoint(i);
      }

      // Apply all pole vector constraints after each full iteration
      // This is more stable than applying them during the CCD loop
      this._applyAllPoleVectors();
    }

    return converged;
  }

  /**
   * Rotate all joints from the given index to the end effector around a pivot point.
   *
   * @param startIndex - Index of the joint to start rotating from
   * @param rotation - Rotation to apply
   * @param pivot - Pivot point for rotation (position of the joint being adjusted)
   */
  private _rotateJointsFromIndex(startIndex: number, rotation: Quaternion, pivot: Vector3): void {
    const joints = this._chain.joints;

    // Rotate all joints from startIndex+1 to end effector
    for (let i = startIndex + 1; i < joints.length; i++) {
      const joint = joints[i];

      // Translate to pivot
      const offset = Vector3.sub(joint.position, pivot, new Vector3());

      // Rotate around pivot
      const rotated = rotation.transform(offset, new Vector3());

      // Translate back
      joint.position.set(Vector3.add(pivot, rotated, new Vector3()));
    }
  }

  /**
   * Apply all pole vector constraints.
   *
   * @remarks
   * This method applies all configured pole vectors to their respective joints.
   * Pole vectors are applied in reverse order (from end to root) to minimize
   * interference between multiple pole vectors. This ensures that pole vectors
   * closer to the end effector are not affected by pole vectors closer to the root.
   */
  private _applyAllPoleVectors(): void {
    if (this._poleVectors.size === 0) {
      return;
    }

    // Apply pole vectors in reverse order (from end to root)
    // This prevents earlier pole vectors from affecting later ones
    const sortedIndices = Array.from(this._poleVectors.keys()).sort((a, b) => b - a);

    for (const jointIndex of sortedIndices) {
      const config = this._poleVectors.get(jointIndex);
      if (config && config.weight > 0.001) {
        this._applyPoleVectorTwist(jointIndex, config.position, config.weight);
      }
    }
  }

  /**
   * Apply pole vector twist to a specific joint.
   *
   * @remarks
   * This method is called after the base CCD rotation has been applied.
   * It adds an additional twist rotation around the joint-to-end axis
   * to make the next joint (child) bend toward the pole vector.
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
   * Apply constraints for a specific joint.
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
   * Apply the solved joint positions to scene nodes as rotations.
   *
   * @param weight - Blend weight (0 = original, 1 = full IK, default: 1)
   */
  applyToNodes(weight = 1): void {
    const joints = this._chain.joints;

    // Apply rotation for all joints except the end effector
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
      IKUtils.decomposeSwingTwist(worldRotation, newDirNorm, swing, twist);

      // Get twist angle
      let twistAngle = IKUtils.getTwistAngle(twist, newDirNorm);

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
      const clampedTwist = new Quaternion();
      IKUtils.createTwist(twistAngle, newDirNorm, clampedTwist);
      worldRotation = Quaternion.multiply(clampedTwist, swing, worldRotation);

      // Blend with original rotation based on weight
      if (weight < 1) {
        Quaternion.slerp(joint.originalRotation, worldRotation, weight, worldRotation);
      }

      // Store this frame's world rotation for next frame's twist continuity
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
}
