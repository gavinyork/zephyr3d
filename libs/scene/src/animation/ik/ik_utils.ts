import { Vector3, Quaternion } from '@zephyr3d/base';

/**
 * Utility functions for IK calculations.
 *
 * @internal
 */
export class IKUtils {
  /**
   * Calculate the rotation needed to align 'from' direction to 'to' direction.
   *
   * @param from - Starting direction vector
   * @param to - Target direction vector
   * @param result - Output quaternion
   * @returns The rotation quaternion
   */
  static fromToRotation(from: Vector3, to: Vector3, result: Quaternion): Quaternion {
    const fromNorm = Vector3.normalize(from, new Vector3());
    const toNorm = Vector3.normalize(to, new Vector3());

    const dot = Vector3.dot(fromNorm, toNorm);

    // Vectors are parallel
    if (dot >= 0.999999) {
      return result.identity();
    }

    // Vectors are opposite
    if (dot <= -0.999999) {
      // Find an orthogonal axis
      let axis = Vector3.cross(Vector3.axisPX(), fromNorm, new Vector3());
      const lenSq = axis.x * axis.x + axis.y * axis.y + axis.z * axis.z;
      if (lenSq < 0.000001) {
        axis = Vector3.cross(Vector3.axisPY(), fromNorm, new Vector3());
      }
      axis.inplaceNormalize();
      return result.fromAxisAngle(axis, Math.PI);
    }

    // General case
    const axis = Vector3.cross(fromNorm, toNorm).inplaceNormalize();
    const angle = Math.acos(dot);
    return result.fromAxisAngle(axis, angle);
  }

  /**
   * Calculate bone length between two positions.
   *
   * @param start - Start position
   * @param end - End position
   * @returns Distance between positions
   */
  static calculateBoneLength(start: Vector3, end: Vector3): number {
    return Vector3.distance(start, end);
  }

  /**
   * Decompose a quaternion into swing and twist components around a given axis.
   *
   * @remarks
   * Given a rotation Q and an axis A, decompose Q into:
   * - Twist: rotation around A
   * - Swing: rotation perpendicular to A
   * Such that Q = Twist * Swing
   *
   * Algorithm:
   * 1. Project Q's imaginary part onto axis to get twist component
   * 2. Normalize to get pure twist rotation
   * 3. Calculate swing = twist^-1 * Q
   *
   * @param q - The quaternion to decompose
   * @param axis - The twist axis (must be normalized)
   * @param outSwing - Output swing rotation
   * @param outTwist - Output twist rotation
   */
  static decomposeSwingTwist(
    q: Quaternion,
    axis: Vector3,
    outSwing: Quaternion,
    outTwist: Quaternion
  ): void {
    // Project quaternion's imaginary part (xyz) onto twist axis
    // twist quaternion = (w, (xyz · axis) * axis)
    const dot = q.x * axis.x + q.y * axis.y + q.z * axis.z;

    outTwist.x = axis.x * dot;
    outTwist.y = axis.y * dot;
    outTwist.z = axis.z * dot;
    outTwist.w = q.w;

    // Normalize twist quaternion
    const twistLen = Math.sqrt(
      outTwist.x * outTwist.x +
        outTwist.y * outTwist.y +
        outTwist.z * outTwist.z +
        outTwist.w * outTwist.w
    );

    if (twistLen < 0.000001) {
      // No rotation or rotation perpendicular to axis
      outTwist.identity();
      outSwing.set(q);
      return;
    }

    outTwist.x /= twistLen;
    outTwist.y /= twistLen;
    outTwist.z /= twistLen;
    outTwist.w /= twistLen;

    // Calculate swing: Q = Twist * Swing => Swing = Twist^-1 * Q
    const twistInv = Quaternion.conjugate(outTwist, new Quaternion());
    Quaternion.multiply(twistInv, q, outSwing);
  }

  /**
   * Get the twist angle (in radians) from a twist quaternion around an axis.
   *
   * @param twist - The twist quaternion
   * @param axis - The twist axis (must be normalized)
   * @returns Twist angle in radians, range [-PI, PI]
   */
  static getTwistAngle(twist: Quaternion, axis: Vector3): number {
    // For a twist quaternion around axis: twist = (cos(θ/2), sin(θ/2) * axis)
    // We can extract the angle from the quaternion components

    // Ensure twist is normalized
    const len = Math.sqrt(twist.x * twist.x + twist.y * twist.y + twist.z * twist.z + twist.w * twist.w);
    if (len < 0.000001) {
      return 0;
    }

    const w = twist.w / len;
    const halfAngle = Math.acos(Math.max(-1, Math.min(1, w)));

    // Determine sign based on axis direction
    const dot = twist.x * axis.x + twist.y * axis.y + twist.z * axis.z;
    const sign = dot >= 0 ? 1 : -1;

    return sign * 2 * halfAngle;
  }

  /**
   * Create a twist quaternion from an angle and axis.
   *
   * @param angle - Twist angle in radians
   * @param axis - The twist axis (must be normalized)
   * @param result - Output quaternion
   * @returns The twist quaternion
   */
  static createTwist(angle: number, axis: Vector3, result: Quaternion): Quaternion {
    const halfAngle = angle * 0.5;
    const s = Math.sin(halfAngle);
    result.x = axis.x * s;
    result.y = axis.y * s;
    result.z = axis.z * s;
    result.w = Math.cos(halfAngle);
    return result;
  }

  /**
   * Clamp twist angle and optionally smooth with previous twist.
   *
   * @param currentTwist - Current twist angle in radians
   * @param previousTwist - Previous frame's twist angle in radians (optional)
   * @param minTwist - Minimum allowed twist angle in radians
   * @param maxTwist - Maximum allowed twist angle in radians
   * @param smoothFactor - Smoothing factor [0-1], 0 = no smoothing, 1 = full smoothing
   * @returns Clamped and smoothed twist angle
   */
  static clampAndSmoothTwist(
    currentTwist: number,
    previousTwist: number | undefined,
    minTwist: number,
    maxTwist: number,
    smoothFactor: number = 0.5
  ): number {
    // Clamp to range
    let clampedTwist = Math.max(minTwist, Math.min(maxTwist, currentTwist));

    // Smooth with previous frame if available
    if (previousTwist !== undefined && smoothFactor > 0.001) {
      // Normalize angle difference to [-PI, PI]
      let diff = clampedTwist - previousTwist;
      while (diff > Math.PI) {
        diff -= 2 * Math.PI;
      }
      while (diff < -Math.PI) {
        diff += 2 * Math.PI;
      }

      // Lerp
      clampedTwist = previousTwist + diff * (1 - smoothFactor);
    }

    return clampedTwist;
  }

  /**
   * Calculate a look-at rotation with twist constraint using a pole vector.
   *
   * @remarks
   * This creates a rotation that:
   * 1. Aligns 'forward' direction to 'targetDir'
   * 2. Keeps the perpendicular plane aligned with 'poleDir'
   *
   * This prevents unwanted twist around the bone axis by using an external
   * reference direction (pole vector) rather than relying on previous rotations.
   *
   * @param forward - Current forward direction (will be aligned to targetDir)
   * @param targetDir - Desired forward direction
   * @param poleDir - Direction that should be in the "up" hemisphere (from joint position)
   * @param result - Output quaternion
   * @returns The rotation quaternion
   */
  static lookAtRotationWithPole(
    forward: Vector3,
    targetDir: Vector3,
    poleDir: Vector3,
    result: Quaternion
  ): Quaternion {
    const forwardNorm = Vector3.normalize(forward, new Vector3());
    const targetDirNorm = Vector3.normalize(targetDir, new Vector3());
    const poleDirNorm = Vector3.normalize(poleDir, new Vector3());

    // First, align forward to targetDir (swing rotation)
    const swingRotation = new Quaternion();
    this.fromToRotation(forwardNorm, targetDirNorm, swingRotation);

    // Calculate the "right" vector perpendicular to targetDir and poleDir
    // This defines the plane that the bone should bend in
    const right = Vector3.cross(targetDirNorm, poleDirNorm, new Vector3());
    const rightLenSq = right.x * right.x + right.y * right.y + right.z * right.z;

    // If pole is parallel to target direction, no twist correction possible
    if (rightLenSq < 0.000001) {
      result.set(swingRotation);
      return result;
    }

    right.scaleBy(1 / Math.sqrt(rightLenSq));

    // Calculate the "up" vector perpendicular to targetDir in the pole plane
    const up = Vector3.cross(right, targetDirNorm, new Vector3()).inplaceNormalize();

    // Now we need to find the twist rotation around targetDir
    // We want the local "up" axis to align with the calculated "up" vector

    // Get a perpendicular vector to forward in the original space
    let originalUp = Vector3.cross(forwardNorm, Vector3.axisPY(), new Vector3());
    const originalUpLenSq =
      originalUp.x * originalUp.x + originalUp.y * originalUp.y + originalUp.z * originalUp.z;
    if (originalUpLenSq < 0.000001) {
      originalUp = Vector3.cross(forwardNorm, Vector3.axisPX(), new Vector3());
    }
    originalUp.inplaceNormalize();

    // Rotate originalUp by swing rotation to see where it ends up
    const rotatedUp = swingRotation.transform(originalUp, new Vector3());

    // Project rotatedUp onto the plane perpendicular to targetDir
    const rotatedUpDot = Vector3.dot(rotatedUp, targetDirNorm);
    const rotatedUpProj = Vector3.scale(targetDirNorm, rotatedUpDot, new Vector3());
    const rotatedUpPerp = Vector3.sub(rotatedUp, rotatedUpProj, new Vector3());
    const rotatedUpPerpLen = rotatedUpPerp.magnitude;

    if (rotatedUpPerpLen < 0.000001) {
      result.set(swingRotation);
      return result;
    }

    rotatedUpPerp.scaleBy(1 / rotatedUpPerpLen);

    // Calculate twist rotation to align rotatedUpPerp with up
    const twistRotation = new Quaternion();
    this.fromToRotation(rotatedUpPerp, up, twistRotation);

    // Combine swing and twist
    return Quaternion.multiply(twistRotation, swingRotation, result);
  }

  /**
   * Calculate a look-at rotation with twist constraint.
   *
   * @remarks
   * This creates a rotation that:
   * 1. Aligns 'forward' direction to 'targetDir'
   * 2. Keeps 'up' direction as close as possible to 'targetUp'
   *
   * This prevents unwanted twist around the bone axis.
   *
   * @param forward - Current forward direction (will be aligned to targetDir)
   * @param targetDir - Desired forward direction
   * @param up - Current up direction (perpendicular to forward)
   * @param targetUp - Desired up direction (will be projected perpendicular to targetDir)
   * @param result - Output quaternion
   * @returns The rotation quaternion
   */
  static lookAtRotation(
    forward: Vector3,
    targetDir: Vector3,
    up: Vector3,
    targetUp: Vector3,
    result: Quaternion
  ): Quaternion {
    const forwardNorm = Vector3.normalize(forward, new Vector3());
    const targetDirNorm = Vector3.normalize(targetDir, new Vector3());

    // First, align forward to targetDir (swing rotation)
    const swingRotation = new Quaternion();
    this.fromToRotation(forwardNorm, targetDirNorm, swingRotation);

    // Rotate the up vector by swing rotation
    const rotatedUp = swingRotation.transform(up, new Vector3());

    // Project targetUp onto plane perpendicular to targetDir
    const dot = Vector3.dot(targetUp, targetDirNorm);
    const projection = Vector3.scale(targetDirNorm, dot, new Vector3());
    const targetUpPerp = Vector3.sub(targetUp, projection, new Vector3());
    const targetUpPerpLen = targetUpPerp.magnitude;

    // If targetUp is parallel to targetDir, no twist correction needed
    if (targetUpPerpLen < 0.000001) {
      result.set(swingRotation);
      return result;
    }

    targetUpPerp.scaleBy(1 / targetUpPerpLen);

    // Project rotatedUp onto the same plane
    const rotatedUpDot = Vector3.dot(rotatedUp, targetDirNorm);
    const rotatedUpProj = Vector3.scale(targetDirNorm, rotatedUpDot, new Vector3());
    const rotatedUpPerp = Vector3.sub(rotatedUp, rotatedUpProj, new Vector3());
    const rotatedUpPerpLen = rotatedUpPerp.magnitude;

    if (rotatedUpPerpLen < 0.000001) {
      result.set(swingRotation);
      return result;
    }

    rotatedUpPerp.scaleBy(1 / rotatedUpPerpLen);

    // Calculate twist rotation around targetDir
    const twistRotation = new Quaternion();
    this.fromToRotation(rotatedUpPerp, targetUpPerp, twistRotation);

    // Combine swing and twist
    return Quaternion.multiply(twistRotation, swingRotation, result);
  }
}
