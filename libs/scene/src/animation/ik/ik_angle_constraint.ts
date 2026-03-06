import { Vector3 } from '@zephyr3d/base';
import { IKConstraint } from './ik_constraint';
import type { IKJoint } from './ik_joint';

/**
 * Angle constraint for IK joints.
 *
 * Limits the angle between the bone from parent to this joint
 * and the bone from this joint to child.
 *
 * @remarks
 * This is useful for joints like elbows and knees that have
 * limited range of motion.
 *
 * @public
 */
export class IKAngleConstraint extends IKConstraint {
  /** Minimum angle in degrees */
  private _minAngle: number;
  /** Maximum angle in degrees */
  private _maxAngle: number;

  /**
   * Create an angle constraint.
   *
   * @param jointIndex - Index of the joint in the chain
   * @param minAngle - Minimum angle in degrees (0 = straight)
   * @param maxAngle - Maximum angle in degrees (180 = fully bent)
   */
  constructor(jointIndex: number, minAngle: number, maxAngle: number) {
    super(jointIndex);
    this._minAngle = Math.max(0, minAngle);
    this._maxAngle = Math.min(180, maxAngle);

    if (this._minAngle > this._maxAngle) {
      throw new Error('IKAngleConstraint: minAngle must be <= maxAngle');
    }
  }

  /**
   * Get the minimum angle in degrees.
   */
  get minAngle(): number {
    return this._minAngle;
  }

  /**
   * Set the minimum angle in degrees.
   */
  set minAngle(value: number) {
    this._minAngle = Math.max(0, Math.min(value, this._maxAngle));
  }

  /**
   * Get the maximum angle in degrees.
   */
  get maxAngle(): number {
    return this._maxAngle;
  }

  /**
   * Set the maximum angle in degrees.
   */
  set maxAngle(value: number) {
    this._maxAngle = Math.min(180, Math.max(value, this._minAngle));
  }

  /**
   * Apply the angle constraint to limit joint bending.
   */
  apply(joints: IKJoint[]): void {
    const index = this._jointIndex;

    // Need at least 3 joints (parent, this, child)
    if (index < 1 || index >= joints.length - 1) {
      return;
    }

    const parentJoint = joints[index - 1];
    const currentJoint = joints[index];
    const childJoint = joints[index + 1];

    // Calculate vectors from current joint
    const toParent = Vector3.sub(parentJoint.position, currentJoint.position, new Vector3());
    const toChild = Vector3.sub(childJoint.position, currentJoint.position, new Vector3());

    const parentLen = toParent.magnitude;
    const childLen = toChild.magnitude;

    if (parentLen < 0.000001 || childLen < 0.000001) {
      return;
    }

    // Normalize
    const toParentNorm = Vector3.scale(toParent, 1 / parentLen, new Vector3());
    const toChildNorm = Vector3.scale(toChild, 1 / childLen, new Vector3());

    // Calculate current angle between parent and child bones
    const dot = Vector3.dot(toParentNorm, toChildNorm);
    const currentAngleDeg = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);

    // Check if constraint is violated
    let targetAngleDeg = currentAngleDeg;
    if (currentAngleDeg < this._minAngle) {
      targetAngleDeg = this._minAngle;
    } else if (currentAngleDeg > this._maxAngle) {
      targetAngleDeg = this._maxAngle;
    } else {
      return; // Within limits
    }

    // Calculate rotation axis (perpendicular to both vectors)
    const axis = Vector3.cross(toParentNorm, toChildNorm, new Vector3());
    const axisLen = axis.magnitude;

    if (axisLen < 0.000001) {
      return; // Vectors are parallel or anti-parallel
    }

    axis.scaleBy(1 / axisLen);

    // Calculate the angle we need to rotate
    const targetAngleRad = targetAngleDeg * (Math.PI / 180);
    const currentAngleRad = currentAngleDeg * (Math.PI / 180);
    const deltaAngle = targetAngleRad - currentAngleRad;

    // Rotate the toChild vector around the axis by deltaAngle
    const cos = Math.cos(deltaAngle);
    const sin = Math.sin(deltaAngle);
    const oneMinusCos = 1 - cos;

    // Rodrigues' rotation formula
    const rotated = new Vector3();
    rotated.x =
      toChildNorm.x * (cos + axis.x * axis.x * oneMinusCos) +
      toChildNorm.y * (axis.x * axis.y * oneMinusCos - axis.z * sin) +
      toChildNorm.z * (axis.x * axis.z * oneMinusCos + axis.y * sin);

    rotated.y =
      toChildNorm.x * (axis.y * axis.x * oneMinusCos + axis.z * sin) +
      toChildNorm.y * (cos + axis.y * axis.y * oneMinusCos) +
      toChildNorm.z * (axis.y * axis.z * oneMinusCos - axis.x * sin);

    rotated.z =
      toChildNorm.x * (axis.z * axis.x * oneMinusCos - axis.y * sin) +
      toChildNorm.y * (axis.z * axis.y * oneMinusCos + axis.x * sin) +
      toChildNorm.z * (cos + axis.z * axis.z * oneMinusCos);

    // Update child position using the original bone length
    const boneLength = currentJoint.boneLength;
    rotated.scaleBy(boneLength);
    Vector3.add(currentJoint.position, rotated, childJoint.position);

    // Recursively update all subsequent joints to maintain bone lengths
    for (let i = index + 1; i < joints.length - 1; i++) {
      const joint = joints[i];
      const nextJoint = joints[i + 1];

      // Calculate direction from current joint to next
      const dir = Vector3.sub(nextJoint.position, joint.position, new Vector3());
      const dist = dir.magnitude;

      if (dist > 0.000001) {
        // Normalize and scale to correct bone length
        dir.scaleBy(joint.boneLength / dist);
        Vector3.add(joint.position, dir, nextJoint.position);
      }
    }
  }
}
