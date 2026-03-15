import { Vector3, Nullable } from '@zephyr3d/base';
import type { SceneNode } from '../../scene/scene_node';

/**
 * Base interface for spring collision shapes
 */
export interface SpringCollider {
  /** Type of collider */
  type: 'sphere' | 'capsule' | 'plane';
  /** Associated scene node (optional, for dynamic colliders) */
  node?: Nullable<SceneNode>;
  /** Whether this collider is enabled */
  enabled: boolean;
}

/**
 * Sphere collider for spring collision detection
 */
export interface SphereCollider extends SpringCollider {
  type: 'sphere';
  /** Center position in world space */
  center: Vector3;
  /** Radius of the sphere */
  radius: number;
  /** Local offset from node (if node is set) */
  localOffset?: Vector3;
}

/**
 * Capsule collider for spring collision detection
 */
export interface CapsuleCollider extends SpringCollider {
  type: 'capsule';
  /** Start point of the capsule axis in world space */
  start: Vector3;
  /** End point of the capsule axis in world space */
  end: Vector3;
  /** Radius of the capsule */
  radius: number;
  /** Local start offset from node (if node is set) */
  localStartOffset?: Vector3;
  /** Local end offset from node (if node is set) */
  localEndOffset?: Vector3;
}

/**
 * Plane collider for spring collision detection
 */
export interface PlaneCollider extends SpringCollider {
  type: 'plane';
  /** Point on the plane in world space */
  point: Vector3;
  /** Normal vector of the plane (should be normalized) */
  normal: Vector3;
  /** Local point offset from node (if node is set) */
  localPointOffset?: Vector3;
  /** Local normal direction (if node is set) */
  localNormal?: Vector3;
}

/**
 * Creates a sphere collider
 * @param centerOrOffset - Center position in world space, or local offset if node is provided
 * @param radius - Radius of the sphere
 * @param node - Optional scene node to attach to (if provided, centerOrOffset is treated as local offset)
 */
export function createSphereCollider(
  centerOrOffset: Vector3,
  radius: number,
  node?: SceneNode
): SphereCollider {
  if (node) {
    // If node is provided, treat centerOrOffset as local offset
    const worldMatrix = node.worldMatrix;
    const worldCenter = new Vector3(
      worldMatrix.m03 + centerOrOffset.x,
      worldMatrix.m13 + centerOrOffset.y,
      worldMatrix.m23 + centerOrOffset.z
    );

    return {
      type: 'sphere',
      center: worldCenter,
      radius,
      node,
      enabled: true,
      localOffset: centerOrOffset.clone()
    };
  } else {
    // No node, use as world position
    return {
      type: 'sphere',
      center: centerOrOffset.clone(),
      radius,
      node: null,
      enabled: true
    };
  }
}

/**
 * Creates a capsule collider
 * @param startOrOffset - Start point in world space, or local offset if node is provided
 * @param endOrOffset - End point in world space, or local offset if node is provided
 * @param radius - Radius of the capsule
 * @param node - Optional scene node to attach to (if provided, offsets are treated as local)
 */
export function createCapsuleCollider(
  startOrOffset: Vector3,
  endOrOffset: Vector3,
  radius: number,
  node?: SceneNode
): CapsuleCollider {
  if (node) {
    // If node is provided, treat as local offsets
    const worldMatrix = node.worldMatrix;
    const worldStart = new Vector3(
      worldMatrix.m03 + startOrOffset.x,
      worldMatrix.m13 + startOrOffset.y,
      worldMatrix.m23 + startOrOffset.z
    );
    const worldEnd = new Vector3(
      worldMatrix.m03 + endOrOffset.x,
      worldMatrix.m13 + endOrOffset.y,
      worldMatrix.m23 + endOrOffset.z
    );

    return {
      type: 'capsule',
      start: worldStart,
      end: worldEnd,
      radius,
      node,
      enabled: true,
      localStartOffset: startOrOffset.clone(),
      localEndOffset: endOrOffset.clone()
    };
  } else {
    // No node, use as world positions
    return {
      type: 'capsule',
      start: startOrOffset.clone(),
      end: endOrOffset.clone(),
      radius,
      node: null,
      enabled: true
    };
  }
}

/**
 * Creates a plane collider
 * @param pointOrOffset - Point on plane in world space, or local offset if node is provided
 * @param normal - Normal vector (will be normalized)
 * @param node - Optional scene node to attach to (if provided, pointOrOffset is treated as local offset)
 */
export function createPlaneCollider(
  pointOrOffset: Vector3,
  normal: Vector3,
  node?: SceneNode
): PlaneCollider {
  const normalizedNormal = new Vector3();
  Vector3.normalize(normal, normalizedNormal);

  if (node) {
    // If node is provided, treat as local offset
    const worldMatrix = node.worldMatrix;
    const worldPoint = new Vector3(
      worldMatrix.m03 + pointOrOffset.x,
      worldMatrix.m13 + pointOrOffset.y,
      worldMatrix.m23 + pointOrOffset.z
    );

    return {
      type: 'plane',
      point: worldPoint,
      normal: normalizedNormal.clone(),
      node,
      enabled: true,
      localPointOffset: pointOrOffset.clone(),
      localNormal: normalizedNormal.clone()
    };
  } else {
    // No node, use as world position
    return {
      type: 'plane',
      point: pointOrOffset.clone(),
      normal: normalizedNormal,
      node: null,
      enabled: true
    };
  }
}

/**
 * Resolves collision between a particle and a sphere collider
 * @returns true if collision occurred
 */
export function resolveSphereCollision(
  particlePos: Vector3,
  collider: SphereCollider
): boolean {
  const toParticle = Vector3.sub(particlePos, collider.center, new Vector3());
  const distSq = toParticle.magnitudeSq;
  const radiusSq = collider.radius * collider.radius;

  if (distSq < radiusSq && distSq > 0.0001) {
    // Particle is inside sphere, push it out
    const dist = Math.sqrt(distSq);
    const penetration = collider.radius - dist;

    // Push particle to sphere surface
    Vector3.normalize(toParticle, toParticle);
    toParticle.scaleBy(penetration);
    Vector3.add(particlePos, toParticle, particlePos);

    return true;
  }

  return false;
}

/**
 * Resolves collision between a particle and a capsule collider
 * @returns true if collision occurred
 */
export function resolveCapsuleCollision(
  particlePos: Vector3,
  collider: CapsuleCollider
): boolean {
  // Find closest point on capsule axis
  const axis = Vector3.sub(collider.end, collider.start, new Vector3());
  const axisLength = axis.magnitude;

  if (axisLength < 0.0001) {
    // Degenerate capsule, treat as sphere
    const toParticle = Vector3.sub(particlePos, collider.start, new Vector3());
    const distSq = toParticle.magnitudeSq;
    const radiusSq = collider.radius * collider.radius;

    if (distSq < radiusSq && distSq > 0.0001) {
      const dist = Math.sqrt(distSq);
      const penetration = collider.radius - dist;
      Vector3.normalize(toParticle, toParticle);
      toParticle.scaleBy(penetration);
      Vector3.add(particlePos, toParticle, particlePos);
      return true;
    }
    return false;
  }

  Vector3.normalize(axis, axis);

  const toParticle = Vector3.sub(particlePos, collider.start, new Vector3());
  const projection = Vector3.dot(toParticle, axis);

  // Clamp projection to capsule length
  const t = Math.max(0, Math.min(axisLength, projection));

  // Closest point on capsule axis
  const closestPoint = Vector3.add(
    collider.start,
    Vector3.scale(axis, t, new Vector3()),
    new Vector3()
  );

  // Check distance from closest point
  const toParticleFromAxis = Vector3.sub(particlePos, closestPoint, new Vector3());
  const distSq = toParticleFromAxis.magnitudeSq;
  const radiusSq = collider.radius * collider.radius;

  if (distSq < radiusSq && distSq > 0.0001) {
    const dist = Math.sqrt(distSq);
    const penetration = collider.radius - dist;
    Vector3.normalize(toParticleFromAxis, toParticleFromAxis);
    toParticleFromAxis.scaleBy(penetration);
    Vector3.add(particlePos, toParticleFromAxis, particlePos);
    return true;
  }

  return false;
}

/**
 * Resolves collision between a particle and a plane collider
 * @returns true if collision occurred
 */
export function resolvePlaneCollision(
  particlePos: Vector3,
  collider: PlaneCollider
): boolean {
  const toParticle = Vector3.sub(particlePos, collider.point, new Vector3());
  const distance = Vector3.dot(toParticle, collider.normal);

  if (distance < 0) {
    // Particle is below plane, push it up
    const correction = Vector3.scale(collider.normal, -distance, new Vector3());
    Vector3.add(particlePos, correction, particlePos);
    return true;
  }

  return false;
}

/**
 * Updates collider position from its associated node
 */
export function updateColliderFromNode(collider: SpringCollider): void {
  if (!collider.node || !collider.enabled) {
    return;
  }

  const worldMatrix = collider.node.worldMatrix;

  switch (collider.type) {
    case 'sphere': {
      const sphere = collider as SphereCollider;
      if (sphere.localOffset) {
        // Transform local offset to world space
        sphere.center.x = worldMatrix.m03 + sphere.localOffset.x;
        sphere.center.y = worldMatrix.m13 + sphere.localOffset.y;
        sphere.center.z = worldMatrix.m23 + sphere.localOffset.z;
      } else {
        // No local offset, just use node position
        sphere.center.x = worldMatrix.m03;
        sphere.center.y = worldMatrix.m13;
        sphere.center.z = worldMatrix.m23;
      }
      break;
    }

    case 'capsule': {
      const capsule = collider as CapsuleCollider;
      if (capsule.localStartOffset && capsule.localEndOffset) {
        // Transform local offsets to world space
        capsule.start.x = worldMatrix.m03 + capsule.localStartOffset.x;
        capsule.start.y = worldMatrix.m13 + capsule.localStartOffset.y;
        capsule.start.z = worldMatrix.m23 + capsule.localStartOffset.z;

        capsule.end.x = worldMatrix.m03 + capsule.localEndOffset.x;
        capsule.end.y = worldMatrix.m13 + capsule.localEndOffset.y;
        capsule.end.z = worldMatrix.m23 + capsule.localEndOffset.z;
      } else {
        // No local offsets, just use node position for start
        capsule.start.x = worldMatrix.m03;
        capsule.start.y = worldMatrix.m13;
        capsule.start.z = worldMatrix.m23;
      }
      break;
    }

    case 'plane': {
      const plane = collider as PlaneCollider;
      if (plane.localPointOffset) {
        // Transform local offset to world space
        plane.point.x = worldMatrix.m03 + plane.localPointOffset.x;
        plane.point.y = worldMatrix.m13 + plane.localPointOffset.y;
        plane.point.z = worldMatrix.m23 + plane.localPointOffset.z;
      } else {
        // No local offset, just use node position
        plane.point.x = worldMatrix.m03;
        plane.point.y = worldMatrix.m13;
        plane.point.z = worldMatrix.m23;
      }

      if (plane.localNormal) {
        // Transform local normal to world space (rotation only)
        // For proper normal transformation, we should use the inverse transpose
        // But for simplicity, we'll just rotate the normal
        const rotatedNormal = new Vector3(
          worldMatrix.m00 * plane.localNormal.x + worldMatrix.m01 * plane.localNormal.y + worldMatrix.m02 * plane.localNormal.z,
          worldMatrix.m10 * plane.localNormal.x + worldMatrix.m11 * plane.localNormal.y + worldMatrix.m12 * plane.localNormal.z,
          worldMatrix.m20 * plane.localNormal.x + worldMatrix.m21 * plane.localNormal.y + worldMatrix.m22 * plane.localNormal.z
        );
        Vector3.normalize(rotatedNormal, plane.normal);
      }
      break;
    }
  }
}
