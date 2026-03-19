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

    // For end effector (last joint), we constrain the angle between the last two bones
    // For other joints, we constrain the angle at the joint itself
    if (index === joints.length - 1) {
      // End effector: constrain angle between (parent-1 -> parent) and (parent -> this)
      if (index < 2) {
        return; // Need at least 3 joints total
      }
      this._applyEndEffectorConstraint(joints, index);
    } else {
      // Regular joint: constrain angle between (parent -> this) and (this -> child)
      if (index < 1) {
        return; // Root joint cannot be constrained this way
      }
      this._applyRegularConstraint(joints, index);
    }
  }

  /**
   * Apply constraint to end effector joint.
   */
  private _applyEndEffectorConstraint(joints: IKJoint[], index: number): void {
    const grandParentJoint = joints[index - 2];
    const parentJoint = joints[index - 1];
    const currentJoint = joints[index];

    // Calculate bone vectors
    const incomingBone = Vector3.sub(parentJoint.position, grandParentJoint.position, new Vector3());
    const outgoingBone = Vector3.sub(currentJoint.position, parentJoint.position, new Vector3());

    const incomingLen = incomingBone.magnitude;
    const outgoingLen = outgoingBone.magnitude;

    if (incomingLen < 0.000001 || outgoingLen < 0.000001) {
      return;
    }

    // Normalize
    const incomingNorm = Vector3.scale(incomingBone, 1 / incomingLen, new Vector3());
    const outgoingNorm = Vector3.scale(outgoingBone, 1 / outgoingLen, new Vector3());

    // Calculate current angle
    const dot = Vector3.dot(incomingNorm, outgoingNorm);
    const currentAngleDeg = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);

    // Check if constraint is violated
    let targetAngleDeg = currentAngleDeg;
    if (currentAngleDeg < this._minAngle) {
      targetAngleDeg = this._minAngle;
    } else if (currentAngleDeg > this._maxAngle) {
      targetAngleDeg = this._maxAngle;
    } else {
      return;
    }

    // Apply the same constraint logic as regular joints
    this._adjustJointAngle(
      incomingNorm,
      outgoingNorm,
      currentAngleDeg,
      targetAngleDeg,
      parentJoint,
      currentJoint
    );
  }

  /**
   * Apply constraint to regular joint.
   */
  private _applyRegularConstraint(joints: IKJoint[], index: number): void {
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
      return;
    }

    // Apply the constraint
    this._adjustJointAngle(
      incomingNorm,
      outgoingNorm,
      currentAngleDeg,
      targetAngleDeg,
      currentJoint,
      childJoint
    );
  }

  /**
   * Adjust joint angle by rotating the outgoing bone.
   */
  private _adjustJointAngle(
    incomingNorm: Vector3,
    outgoingNorm: Vector3,
    currentAngleDeg: number,
    targetAngleDeg: number,
    pivotJoint: IKJoint,
    targetJoint: IKJoint
  ): void {
    // Add a dead zone to prevent oscillation
    const angleDifference = Math.abs(targetAngleDeg - currentAngleDeg);
    const isHardConstraint = Math.abs(this._maxAngle - this._minAngle) < 0.01;
    const deadZone = isHardConstraint ? 0.2 : 0.1;

    if (angleDifference < deadZone) {
      return; // Too close to target, avoid over-correction
    }

    // Calculate rotation axis (perpendicular to both bone vectors)
    const axis = Vector3.cross(incomingNorm, outgoingNorm, new Vector3());
    const axisLen = axis.magnitude;

    // Use a smaller threshold to allow constraint to work at small angles
    if (axisLen < 0.0001) {
      return; // Vectors are too close to parallel or anti-parallel
    }

    axis.scaleBy(1 / axisLen);

    // Calculate the angle we need to rotate
    const targetAngleRad = targetAngleDeg * (Math.PI / 180);
    const currentAngleRad = currentAngleDeg * (Math.PI / 180);
    let deltaAngle = targetAngleRad - currentAngleRad;

    // Apply full correction without damping to ensure constraints are enforced
    // This is necessary because FABRIK will try to undo the constraint in the next iteration
    // So we need strong constraint enforcement

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

    // Update target joint position using the rotated bone vector
    const boneLength = pivotJoint.boneLength;
    rotated.scaleBy(boneLength);
    Vector3.add(pivotJoint.position, rotated, targetJoint.position);

    // Note: We do NOT recursively update subsequent joints here.
    // Instead, we let FABRIK algorithm handle the propagation in subsequent iterations.
    // This ensures that each joint's constraint is properly applied.
  }
}
