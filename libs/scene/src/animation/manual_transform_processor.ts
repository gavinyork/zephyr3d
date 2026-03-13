import { Vector3, Quaternion } from '@zephyr3d/base';
import { SkeletonPostProcessor } from './skeleton_postprocessor';
import type { Skeleton } from './skeleton';

/**
 * Manual transform override for specific joints.
 *
 * Stores position, rotation, and scale overrides for joints and blends them
 * with the base animation layer.
 */
interface JointOverride {
  position?: Vector3;
  rotation?: Quaternion;
  scale?: Vector3;
}

/**
 * Post-processor for manual joint transform control.
 *
 * Allows setting custom transforms for specific joints that blend with
 * the base animation/bind pose layer.
 *
 * @example
 * ```typescript
 * const processor = new ManualTransformProcessor();
 * processor.setJointPosition(5, new Vector3(1, 2, 3));
 * processor.setJointRotation(5, Quaternion.fromEuler(0, Math.PI / 2, 0));
 * skeleton.addPostProcessor(processor);
 * ```
 *
 * @public
 */
export class ManualTransformProcessor extends SkeletonPostProcessor {
  /** Map of joint index to transform overrides */
  private _overrides: Map<number, JointOverride>;

  constructor(weight: number = 1.0, priority: number = 100) {
    super(weight, priority);
    this._overrides = new Map();
  }

  /**
   * Set position override for a joint.
   *
   * @param jointIndex - Index of the joint in the skeleton
   * @param position - New local position (will be cloned)
   */
  setJointPosition(jointIndex: number, position: Vector3): void {
    let override = this._overrides.get(jointIndex);
    if (!override) {
      override = {};
      this._overrides.set(jointIndex, override);
    }
    override.position = position.clone();
  }

  /**
   * Set rotation override for a joint.
   *
   * @param jointIndex - Index of the joint in the skeleton
   * @param rotation - New local rotation (will be cloned)
   */
  setJointRotation(jointIndex: number, rotation: Quaternion): void {
    let override = this._overrides.get(jointIndex);
    if (!override) {
      override = {};
      this._overrides.set(jointIndex, override);
    }
    override.rotation = rotation.clone();
  }

  /**
   * Set scale override for a joint.
   *
   * @param jointIndex - Index of the joint in the skeleton
   * @param scale - New local scale (will be cloned)
   */
  setJointScale(jointIndex: number, scale: Vector3): void {
    let override = this._overrides.get(jointIndex);
    if (!override) {
      override = {};
      this._overrides.set(jointIndex, override);
    }
    override.scale = scale.clone();
  }

  /**
   * Set full transform override for a joint.
   *
   * @param jointIndex - Index of the joint in the skeleton
   * @param position - New local position (optional)
   * @param rotation - New local rotation (optional)
   * @param scale - New local scale (optional)
   */
  setJointTransform(jointIndex: number, position?: Vector3, rotation?: Quaternion, scale?: Vector3): void {
    const override: JointOverride = {};
    if (position) {
      override.position = position.clone();
    }
    if (rotation) {
      override.rotation = rotation.clone();
    }
    if (scale) {
      override.scale = scale.clone();
    }
    this._overrides.set(jointIndex, override);
  }

  /**
   * Clear override for a specific joint.
   *
   * @param jointIndex - Index of the joint to clear
   */
  clearJoint(jointIndex: number): void {
    this._overrides.delete(jointIndex);
  }

  /**
   * Clear all joint overrides.
   */
  clearAll(): void {
    this._overrides.clear();
  }

  /**
   * Check if a joint has any overrides.
   *
   * @param jointIndex - Index of the joint to check
   * @returns True if the joint has overrides
   */
  hasOverride(jointIndex: number): boolean {
    return this._overrides.has(jointIndex);
  }

  /**
   * Get the number of joints with overrides.
   */
  get overrideCount(): number {
    return this._overrides.size;
  }

  /**
   * Apply manual transform overrides to skeleton joints.
   */
  apply(skeleton: Skeleton, _deltaTime: number): void {
    if (!this._enabled || this._overrides.size === 0 || this._weight <= 0) {
      return;
    }

    const joints = skeleton.joints;
    const weight = this._weight;

    this._overrides.forEach((override, jointIndex) => {
      if (jointIndex < 0 || jointIndex >= joints.length) {
        return;
      }

      const joint = joints[jointIndex];

      // Blend position
      if (override.position) {
        if (weight >= 1) {
          joint.position = override.position;
        } else {
          joint.position = Vector3.combine(joint.position, override.position, weight, 1 - weight);
        }
      }

      // Blend rotation
      if (override.rotation) {
        if (weight >= 1) {
          joint.rotation = override.rotation;
        } else {
          joint.rotation = Quaternion.slerp(joint.rotation, override.rotation, weight);
        }
      }

      // Blend scale
      if (override.scale) {
        if (weight >= 1) {
          joint.scale = override.scale;
        } else {
          joint.scale = Vector3.combine(joint.scale, override.scale, weight, 1 - weight);
        }
      }
    });
  }

  /**
   * Reset the processor (clears all overrides).
   */
  reset(): void {
    this._overrides.clear();
  }
}
