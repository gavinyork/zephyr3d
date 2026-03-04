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

    // Calculate vectors
    const toParent = Vector3.sub(parentJoint.position, currentJoint.position, new Vector3());
    const toChild = Vector3.sub(childJoint.position, currentJoint.position, new Vector3());

    const parentLen = toParent.magnitude;
    const childLen = toChild.magnitude;

    if (parentLen < 0.000001 || childLen < 0.000001) {
      return;
    }

    // Normalize
    toParent.scaleBy(1 / parentLen);
    toChild.scaleBy(1 / childLen);

    // Calculate current angle
    const dot = Vector3.dot(toParent, toChild);
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
    const axis = Vector3.cross(toParent, toChild, new Vector3());
    const axisLen = axis.magnitude;

    if (axisLen < 0.000001) {
      return; // Vectors are parallel
    }

    axis.scaleBy(1 / axisLen);

    // Rotate child position to satisfy constraint
    const targetAngleRad = targetAngleDeg * (Math.PI / 180);
    const currentAngleRad = currentAngleDeg * (Math.PI / 180);
    const deltaAngle = targetAngleRad - currentAngleRad;

    // Rotate toChild vector around axis
    const cos = Math.cos(deltaAngle);
    const sin = Math.sin(deltaAngle);
    const oneMinusCos = 1 - cos;

    // Rodrigues' rotation formula
    const rotated = new Vector3();
    rotated.x =
      toChild.x * (cos + axis.x * axis.x * oneMinusCos) +
      toChild.y * (axis.x * axis.y * oneMinusCos - axis.z * sin) +
      toChild.z * (axis.x * axis.z * oneMinusCos + axis.y * sin);

    rotated.y =
      toChild.x * (axis.y * axis.x * oneMinusCos + axis.z * sin) +
      toChild.y * (cos + axis.y * axis.y * oneMinusCos) +
      toChild.z * (axis.y * axis.z * oneMinusCos - axis.x * sin);

    rotated.z =
      toChild.x * (axis.z * axis.x * oneMinusCos - axis.y * sin) +
      toChild.y * (axis.z * axis.y * oneMinusCos + axis.x * sin) +
      toChild.z * (cos + axis.z * axis.z * oneMinusCos);

    // Update child position
    rotated.scaleBy(childLen);
    Vector3.add(currentJoint.position, rotated, childJoint.position);
  }
}
