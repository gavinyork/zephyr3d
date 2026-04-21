import type { Vector3, Quaternion, Nullable } from '@zephyr3d/base';
import type { SceneNode } from '../../scene/scene_node';

/**
 * Represents a particle in the spring system
 *
 * @public
 */
export interface SpringParticle {
  /** Current position in world space */
  position: Vector3;
  /** Previous position for Verlet integration */
  prevPosition: Vector3;
  /** Original position for reset */
  originalPosition: Vector3;
  /** Animated (target) position for pose preservation */
  animPosition: Vector3;
  /** Original world rotation (for calculating rotation delta) */
  originalRotation: Quaternion | null;
  /** Mass of the particle (affects inertia) */
  mass: number;
  /** Damping coefficient [0-1] (0 = no damping, 1 = full damping) */
  damping: number;
  /** Whether this particle is fixed (anchor point) */
  fixed: boolean;
  /** Associated scene node (optional) */
  node: Nullable<SceneNode>;
  /** Previous frame position (used to calculate velocity for inertial forces) */
  lastFramePosition: Vector3;
  /** Position history for rotation center estimation (for fixed particles) */
  positionHistory?: Vector3[];
}

/**
 * Creates a new spring particle
 *
 * @public
 */
export function createSpringParticle(
  position: Vector3,
  options?: {
    mass?: number;
    damping?: number;
    fixed?: boolean;
    node?: SceneNode;
    originalRotation?: Quaternion;
  }
): SpringParticle {
  return {
    position: position.clone(),
    prevPosition: position.clone(),
    originalPosition: position.clone(),
    animPosition: position.clone(),
    originalRotation: options?.originalRotation?.clone() ?? null,
    mass: options?.mass ?? 1.0,
    damping: options?.damping ?? 0.95,
    fixed: options?.fixed ?? false,
    node: options?.node ?? null,
    lastFramePosition: position.clone()
  };
}
