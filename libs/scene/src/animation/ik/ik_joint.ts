import type { Vector3, Quaternion } from '@zephyr3d/base';
import type { SceneNode } from '../../scene/scene_node';

/**
 * Represents a joint in an IK chain.
 *
 * @public
 */
export interface IKJoint {
  /** The scene node associated with this joint */
  node: SceneNode;
  /** Current position in world space (updated during solving) */
  position: Vector3;
  /** Original position before solving (for reference) */
  originalPosition: Vector3;
  /** Current rotation in world space */
  rotation: Quaternion;
  /** Original rotation before solving (for reference) */
  originalRotation: Quaternion;
  /** Length of the bone from this joint to the next (0 for end effector) */
  boneLength: number;
}
