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

    // Calculate bone vectors: incoming bone (parent->current) and outgoing bone (current->child)
    const incomingBone = Vector3.sub(currentJoint.position, parentJoint.position, new Vector3());
    const outgoingBone = Vector3.sub(childJoint.position, currentJoint.position, new Vector3());

    const incomingLen = incomingBone.magnitude;
    const outgoingLen = outgoingBone.magnitude;

    if (incomingLen < 0.000001 || outgoingLen < 0.000001) {
      return;
    }

    // Normalize
    const incomingNorm = Vector3.scale(incomingBone, 1 / incomingLen, new Vector3());
    const outgoingNorm = Vector3.scale(outgoingBone, 1 / outgoingLen, new Vector3());

    // Calculate current angle between incoming and outgoing bones (interior angle)
    const dot = Vector3.dot(incomingNorm, outgoingNorm);
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

    // Add a dead zone to prevent oscillation: if angle difference is very small, don't apply constraint
    const angleDifference = Math.abs(targetAngleDeg - currentAngleDeg);

    // Use larger dead zone for hard constraints (minAngle == maxAngle) to prevent oscillation
    const isHardConstraint = Math.abs(this._maxAngle - this._minAngle) < 0.01;
    const deadZone = isHardConstraint ? 1.0 : 0.5;

    if (angleDifference < deadZone) {
      return; // Too close to target, avoid over-correction
    }

    // Calculate rotation axis (perpendicular to both bone vectors)
    const axis = Vector3.cross(incomingNorm, outgoingNorm, new Vector3());
    const axisLen = axis.magnitude;

    if (axisLen < 0.001) {
      return; // Vectors are too close to parallel or anti-parallel
    }

    axis.scaleBy(1 / axisLen);

    // Calculate the angle we need to rotate
    const targetAngleRad = targetAngleDeg * (Math.PI / 180);
    const currentAngleRad = currentAngleDeg * (Math.PI / 180);
    let deltaAngle = targetAngleRad - currentAngleRad;

    // Clamp the maximum angle change per iteration to prevent violent oscillation
    // This is especially important during "cold start" (first application or after pause)
    const maxAngleChangeRad = (5.0 * Math.PI) / 180; // 5 degrees max per iteration
    if (Math.abs(deltaAngle) > maxAngleChangeRad) {
      deltaAngle = Math.sign(deltaAngle) * maxAngleChangeRad;
    }

    // Apply damping to reduce oscillation: only apply a fraction of the correction
    // Use stronger damping for hard constraints
    const dampingFactor = isHardConstraint ? 0.5 : 0.7;
    deltaAngle *= dampingFactor;

    // Rotate the outgoing bone vector around the axis by deltaAngle
    const cos = Math.cos(deltaAngle);
    const sin = Math.sin(deltaAngle);
    const oneMinusCos = 1 - cos;

    // Rodrigues' rotation formula
    const rotated = new Vector3();
    rotated.x =
      outgoingNorm.x * (cos + axis.x * axis.x * oneMinusCos) +
      outgoingNorm.y * (axis.x * axis.y * oneMinusCos - axis.z * sin) +
      outgoingNorm.z * (axis.x * axis.z * oneMinusCos + axis.y * sin);

    rotated.y =
      outgoingNorm.x * (axis.y * axis.x * oneMinusCos + axis.z * sin) +
      outgoingNorm.y * (cos + axis.y * axis.y * oneMinusCos) +
      outgoingNorm.z * (axis.y * axis.z * oneMinusCos - axis.x * sin);

    rotated.z =
      outgoingNorm.x * (axis.z * axis.x * oneMinusCos - axis.y * sin) +
      outgoingNorm.y * (axis.z * axis.y * oneMinusCos + axis.x * sin) +
      outgoingNorm.z * (cos + axis.z * axis.z * oneMinusCos);

    // Update child position using the rotated bone vector
    const boneLength = currentJoint.boneLength;
    rotated.scaleBy(boneLength);
    Vector3.add(currentJoint.position, rotated, childJoint.position);
  }
}
