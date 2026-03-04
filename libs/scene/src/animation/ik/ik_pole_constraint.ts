import { Vector3 } from '@zephyr3d/base';
import { IKConstraint } from './ik_constraint';
import type { IKJoint } from './ik_joint';

/**
 * Pole vector constraint for IK chains.
 *
 * Controls the twist/rotation of a joint chain by ensuring the middle joint
 * bends toward a specified pole vector position.
 *
 * @remarks
 * This is commonly used for arms and legs to control which direction
 * the elbow or knee points. For example, ensuring an elbow points
 * backward or a knee points forward.
 *
 * The pole vector defines a plane, and the middle joint is constrained
 * to lie on this plane.
 *
 * @public
 */
export class IKPoleVectorConstraint extends IKConstraint {
  /** The pole vector position in world space */
  private _poleVector: Vector3;
  /** Weight of the constraint (0 = no effect, 1 = full effect) */
  private _weight: number;

  /**
   * Create a pole vector constraint.
   *
   * @param jointIndex - Index of the middle joint to constrain (typically elbow or knee)
   * @param poleVector - Position in world space that the joint should point toward
   * @param weight - Constraint weight (0-1, default: 1)
   */
  constructor(jointIndex: number, poleVector: Vector3, weight = 1) {
    super(jointIndex);
    this._poleVector = poleVector.clone();
    this._weight = Math.max(0, Math.min(1, weight));
  }

  /**
   * Get the pole vector position.
   */
  get poleVector(): Vector3 {
    return this._poleVector;
  }

  /**
   * Set the pole vector position.
   */
  set poleVector(value: Vector3) {
    this._poleVector.set(value);
  }

  /**
   * Get the constraint weight.
   */
  get weight(): number {
    return this._weight;
  }

  /**
   * Set the constraint weight (0-1).
   */
  set weight(value: number) {
    this._weight = Math.max(0, Math.min(1, value));
  }

  /**
   * Apply the pole vector constraint.
   *
   * This adjusts the middle joint position to align with the pole vector
   * while maintaining bone lengths.
   */
  apply(joints: IKJoint[]): void {
    const index = this._jointIndex;

    // Need at least 3 joints (parent, this, child)
    if (index < 1 || index >= joints.length - 1) {
      return;
    }

    if (this._weight < 0.001) {
      return; // No effect
    }

    const parentJoint = joints[index - 1];
    const currentJoint = joints[index];
    const childJoint = joints[index + 1];

    // Calculate the plane defined by parent, child, and pole vector
    const parentPos = parentJoint.position;
    const childPos = childJoint.position;
    const currentPos = currentJoint.position;

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
    projectionPoint.addBy(parentPos);

    // Vector from projection point to current joint (perpendicular to line)
    const perpendicular = Vector3.sub(currentPos, projectionPoint, new Vector3());
    const perpLength = perpendicular.magnitude;

    if (perpLength < 0.000001) {
      return; // Current joint is on the line
    }

    // Calculate desired direction toward pole vector
    const parentToPole = Vector3.sub(this._poleVector, parentPos, new Vector3());
    const poleProjectionLength = Vector3.dot(parentToPole, lineDir);
    const poleProjectionPoint = Vector3.scale(lineDir, poleProjectionLength, new Vector3());
    poleProjectionPoint.addBy(parentPos);

    // Direction from projection to pole (perpendicular to line)
    const poleDirection = Vector3.sub(this._poleVector, poleProjectionPoint, new Vector3());
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
    if (this._weight < 0.999) {
      // Manual lerp: result = a + (b - a) * t
      const blended = new Vector3();
      blended.x = currentPos.x + (newPosition.x - currentPos.x) * this._weight;
      blended.y = currentPos.y + (newPosition.y - currentPos.y) * this._weight;
      blended.z = currentPos.z + (newPosition.z - currentPos.z) * this._weight;
      currentJoint.position.set(blended);
    } else {
      currentJoint.position.set(newPosition);
    }
  }
}
