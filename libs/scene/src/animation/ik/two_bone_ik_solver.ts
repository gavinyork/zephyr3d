import { Vector3, Quaternion } from '@zephyr3d/base';
import { IKSolver } from './ik_solver';
import type { IKChain } from './ik_chain';
import { IKUtils } from './ik_utils';

/**
 * Two Bone IK solver for chains with exactly 3 joints (2 bones).
 *
 * @remarks
 * This solver uses an analytical solution specifically optimized for
 * two-bone chains like arms (shoulder-elbow-wrist) or legs (hip-knee-ankle).
 * It's faster and more stable than iterative methods like FABRIK for this case.
 *
 * The solver supports an optional pole vector to control the bending direction
 * of the middle joint (elbow/knee).
 *
 * @public
 */
export class TwoBoneIKSolver extends IKSolver {
  /** Optional pole vector position in world space */
  private _poleVector: Vector3 | null;
  /** Weight of the pole vector constraint (0-1) */
  private _poleWeight: number;

  /**
   * Create a Two Bone IK solver.
   *
   * @param chain - The IK chain to solve (must have exactly 3 joints)
   * @param poleVector - Optional pole vector position in world space
   * @param poleWeight - Weight of the pole vector constraint (0-1, default: 1)
   */
  constructor(chain: IKChain, poleVector: Vector3 | null = null, poleWeight = 1) {
    super(chain, 1, 0.001); // Two bone IK doesn't need iterations

    if (chain.joints.length !== 3) {
      throw new Error('Two Bone IK requires exactly 3 joints (2 bones)');
    }

    this._poleVector = poleVector ? poleVector.clone() : null;
    this._poleWeight = Math.max(0, Math.min(1, poleWeight));
  }

  /**
   * Get the pole vector position.
   */
  get poleVector(): Vector3 | null {
    return this._poleVector;
  }

  /**
   * Set the pole vector position.
   */
  set poleVector(value: Vector3 | null) {
    if (value) {
      if (!this._poleVector) {
        this._poleVector = value.clone();
      } else {
        this._poleVector.set(value);
      }
    } else {
      this._poleVector = null;
    }
  }

  /**
   * Get the pole vector weight.
   */
  get poleWeight(): number {
    return this._poleWeight;
  }

  /**
   * Set the pole vector weight (0-1).
   */
  set poleWeight(value: number) {
    this._poleWeight = Math.max(0, Math.min(1, value));
  }

  /**
   * Solve the IK chain to reach the target position using Two Bone IK algorithm.
   *
   * @param target - Target position for the end effector
   * @returns True if the target is reachable, false if stretched to maximum
   */
  solve(target: Vector3): boolean {
    const joints = this._chain.joints;

    // Update joint positions from scene nodes before solving
    this._chain.updateFromNodes();

    // Store original positions
    this._chain.storeOriginalPositions();

    const root = joints[0];
    const middle = joints[1];
    const end = joints[2];

    const rootPos = root.position;
    const upperLength = root.boneLength; // Length from root to middle
    const lowerLength = middle.boneLength; // Length from middle to end
    const totalLength = upperLength + lowerLength;

    // Calculate direction and distance from root to target
    const rootToTarget = Vector3.sub(target, rootPos, new Vector3());
    const targetDistance = rootToTarget.magnitude;

    // Check if target is reachable
    if (targetDistance < 0.000001) {
      // Target is at root position, keep original pose
      return true;
    }

    let reachable = true;

    // If target is unreachable, clamp to maximum distance
    let effectiveTarget = target;
    if (targetDistance >= totalLength - 0.0001) {
      // Stretch to maximum length
      const direction = Vector3.scale(rootToTarget, 1 / targetDistance, new Vector3());
      effectiveTarget = Vector3.add(
        rootPos,
        Vector3.scale(direction, totalLength - 0.0001, new Vector3()),
        new Vector3()
      );
      reachable = false;
    }

    // Calculate the distance from root to effective target
    const rootToEffectiveTarget = Vector3.sub(effectiveTarget, rootPos, new Vector3());
    const distance = rootToEffectiveTarget.magnitude;

    // Use law of cosines to find the angle at the root joint
    // cos(rootAngle) = (a² + c² - b²) / (2ac)
    const cosRootAngle =
      (upperLength * upperLength + distance * distance - lowerLength * lowerLength) /
      (2 * upperLength * distance);
    const clampedCosRootAngle = Math.max(-1, Math.min(1, cosRootAngle));
    const rootAngle = Math.acos(clampedCosRootAngle);

    // Determine the plane of bending
    let bendNormal: Vector3;

    if (this._poleVector && this._poleWeight > 0.001) {
      // Use pole vector to determine bend direction
      const rootToTargetDir = Vector3.normalize(rootToEffectiveTarget, new Vector3());
      const rootToPole = Vector3.sub(this._poleVector, rootPos, new Vector3());

      // Project pole vector onto plane perpendicular to root-target direction
      const projectionLength = Vector3.dot(rootToPole, rootToTargetDir);
      const projection = Vector3.scale(rootToTargetDir, projectionLength, new Vector3());
      const perpendicular = Vector3.sub(rootToPole, projection, new Vector3());

      const perpLength = perpendicular.magnitude;
      if (perpLength > 0.000001) {
        // Bend normal is perpendicular to both root-target and pole direction
        bendNormal = Vector3.cross(rootToTargetDir, perpendicular, new Vector3()).inplaceNormalize();
      } else {
        // Pole is on the line, use default bend direction
        bendNormal = this._getDefaultBendNormal(rootToEffectiveTarget);
      }

      // Apply pole weight
      if (this._poleWeight < 0.999) {
        const defaultNormal = this._getDefaultBendNormal(rootToEffectiveTarget);
        // Slerp between default and pole-based normal
        const angle = Math.acos(Math.max(-1, Math.min(1, Vector3.dot(defaultNormal, bendNormal))));
        if (angle > 0.001) {
          const axis = Vector3.cross(defaultNormal, bendNormal, new Vector3()).inplaceNormalize();
          const rotation = new Quaternion().fromAxisAngle(axis, angle * this._poleWeight);
          bendNormal = rotation.transform(defaultNormal, new Vector3());
        }
      }
    } else {
      // No pole vector, use default bend direction
      bendNormal = this._getDefaultBendNormal(rootToEffectiveTarget);
    }

    // Calculate middle joint position
    const rootToTargetDir = Vector3.normalize(rootToEffectiveTarget, new Vector3());

    // Rotate root-to-target direction by rootAngle around bendNormal
    const rotationToMiddle = new Quaternion().fromAxisAngle(bendNormal, rootAngle);
    const rootToMiddleDir = rotationToMiddle.transform(rootToTargetDir, new Vector3());

    // Place middle joint
    middle.position.set(
      Vector3.add(rootPos, Vector3.scale(rootToMiddleDir, upperLength, new Vector3()), new Vector3())
    );

    // Place end joint at target
    end.position.set(effectiveTarget);

    // Apply constraints after solving
    // Note: Constraints may modify joint positions, which could affect bone lengths
    // For Two Bone IK, we apply constraints and then restore bone lengths
    this._applyConstraints();

    return reachable;
  }

  /**
   * Apply all constraints to the joint chain.
   * After applying constraints, we need to restore bone lengths.
   */
  private _applyConstraints(): void {
    const constraints = this._chain.constraints;
    if (constraints.length === 0) {
      return;
    }

    const joints = this._chain.joints;

    // Apply each constraint
    for (const constraint of constraints) {
      constraint.apply(joints);
    }

    // After constraints are applied, we need to restore bone lengths
    // because constraints may have moved joints in ways that change bone lengths
    // For Two Bone IK, we fix this by adjusting positions while maintaining the constraint
    this._restoreBoneLengths();
  }

  /**
   * Restore bone lengths after constraints have been applied.
   * This ensures that the chain maintains correct bone lengths.
   */
  private _restoreBoneLengths(): void {
    const joints = this._chain.joints;
    const root = joints[0];
    const middle = joints[1];
    const end = joints[2];

    const upperLength = root.boneLength;
    const lowerLength = middle.boneLength;

    // Fix middle joint position to maintain upper bone length
    const rootToMiddle = Vector3.sub(middle.position, root.position, new Vector3());
    const rootToMiddleDist = rootToMiddle.magnitude;

    if (rootToMiddleDist > 0.000001 && Math.abs(rootToMiddleDist - upperLength) > 0.0001) {
      const rootToMiddleDir = Vector3.scale(rootToMiddle, 1 / rootToMiddleDist, new Vector3());
      middle.position.set(
        Vector3.add(root.position, Vector3.scale(rootToMiddleDir, upperLength, new Vector3()), new Vector3())
      );
    }

    // Fix end joint position to maintain lower bone length
    const middleToEnd = Vector3.sub(end.position, middle.position, new Vector3());
    const middleToEndDist = middleToEnd.magnitude;

    if (middleToEndDist > 0.000001 && Math.abs(middleToEndDist - lowerLength) > 0.0001) {
      const middleToEndDir = Vector3.scale(middleToEnd, 1 / middleToEndDist, new Vector3());
      end.position.set(
        Vector3.add(middle.position, Vector3.scale(middleToEndDir, lowerLength, new Vector3()), new Vector3())
      );
    }
  }

  /**
   * Apply the solved joint positions to scene nodes as rotations.
   *
   * @param weight - Blend weight (0 = original, 1 = full IK, default: 1)
   */
  applyToNodes(weight = 1): void {
    const joints = this._chain.joints;

    // Apply rotation for root and middle joints (end joint doesn't need rotation)
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
   * Get a default bend normal when no pole vector is specified.
   * This tries to find a reasonable perpendicular direction.
   *
   * @param rootToTarget - Direction from root to target
   * @returns A normalized perpendicular vector
   */
  private _getDefaultBendNormal(rootToTarget: Vector3): Vector3 {
    const rootToTargetDir = Vector3.normalize(rootToTarget, new Vector3());

    // Try to use world up (Y axis) as reference
    let bendNormal = Vector3.cross(rootToTargetDir, Vector3.axisPY(), new Vector3());
    const lenSq = bendNormal.x * bendNormal.x + bendNormal.y * bendNormal.y + bendNormal.z * bendNormal.z;

    // If root-to-target is parallel to Y axis, use X axis instead
    if (lenSq < 0.000001) {
      bendNormal = Vector3.cross(rootToTargetDir, Vector3.axisPX(), new Vector3());
    }

    return bendNormal.inplaceNormalize();
  }
}
