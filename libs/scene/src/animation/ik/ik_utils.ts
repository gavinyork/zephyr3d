import type { Quaternion } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';

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
}
