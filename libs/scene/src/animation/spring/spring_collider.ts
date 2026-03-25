import type { Nullable } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import type { SceneNode } from '../../scene/scene_node';

/**
 * Base interface for spring collision shapes
 *
 * @public
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
 *
 * @public
 */
export interface SphereCollider extends SpringCollider {
  type: 'sphere';
  /** Center position in world space */
  center: Vector3;
  /** Radius of the sphere */
  radius: number;
  /** Authoring-space radius before node scaling (if node is set) */
  localRadius?: number;
  /** Baseline world scale captured at creation for backward compatibility */
  localRadiusScaleRef?: number;
  /** Local offset from node (if node is set) */
  localOffset?: Vector3;
}

/**
 * Capsule collider for spring collision detection
 *
 * @public
 */
export interface CapsuleCollider extends SpringCollider {
  type: 'capsule';
  /** Start point of the capsule axis in world space */
  start: Vector3;
  /** End point of the capsule axis in world space */
  end: Vector3;
  /** Radius of the capsule */
  radius: number;
  /** Authoring-space radius before node scaling (if node is set) */
  localRadius?: number;
  /** Baseline perpendicular scale captured at creation for backward compatibility */
  localRadiusScaleRef?: number;
  /** Local start offset from node (if node is set) */
  localStartOffset?: Vector3;
  /** Local end offset from node (if node is set) */
  localEndOffset?: Vector3;
}

/**
 * Plane collider for spring collision detection
 *
 * @public
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
 *
 * @public
 */
export function createSphereCollider(
  centerOrOffset: Vector3,
  radius: number,
  node?: SceneNode
): SphereCollider {
  if (node) {
    // If node is provided, treat centerOrOffset as local offset
    const worldMatrix = node.worldMatrix;
    const worldCenter = worldMatrix.transformPointAffine(centerOrOffset, new Vector3());

    return {
      type: 'sphere',
      center: worldCenter,
      radius,
      localRadius: radius,
      localRadiusScaleRef: getUniformScale(worldMatrix),
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
 *
 * @public
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
    const worldStart = worldMatrix.transformPointAffine(startOrOffset, new Vector3());
    const worldEnd = worldMatrix.transformPointAffine(endOrOffset, new Vector3());

    return {
      type: 'capsule',
      start: worldStart,
      end: worldEnd,
      radius,
      localRadius: radius,
      localRadiusScaleRef: getPerpendicularScale(
        worldMatrix,
        Vector3.sub(endOrOffset, startOrOffset, new Vector3())
      ),
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
 *
 * @public
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
    const worldPoint = worldMatrix.transformPointAffine(pointOrOffset, new Vector3());

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
 *
 * @public
 */
export function resolveSphereCollision(particlePos: Vector3, collider: SphereCollider): boolean {
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
 *
 * @public
 */
export function resolveCapsuleCollision(particlePos: Vector3, collider: CapsuleCollider): boolean {
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
  const closestPoint = Vector3.add(collider.start, Vector3.scale(axis, t, new Vector3()), new Vector3());

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
 *
 * @public
 */
export function resolvePlaneCollision(particlePos: Vector3, collider: PlaneCollider): boolean {
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
 *
 * @public
 */
export function updateColliderFromNode(collider: SpringCollider): void {
  if (!collider.node || !collider.enabled) {
    return;
  }

  const worldMatrix = collider.node.worldMatrix;

  switch (collider.type) {
    case 'sphere': {
      const sphere = collider as SphereCollider;
      if (sphere.localRadius !== undefined) {
        const currentScale = getUniformScale(worldMatrix);
        const refScale = Math.max(1e-6, sphere.localRadiusScaleRef ?? 1);
        sphere.radius = sphere.localRadius * (currentScale / refScale);
      }
      if (sphere.localOffset) {
        // Transform local offset to world space
        worldMatrix.transformPointAffine(sphere.localOffset, sphere.center);
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
      if (capsule.localRadius !== undefined) {
        const axisLocal =
          capsule.localStartOffset && capsule.localEndOffset
            ? Vector3.sub(capsule.localEndOffset, capsule.localStartOffset, new Vector3())
            : Vector3.axisPY();
        const currentScale = getPerpendicularScale(worldMatrix, axisLocal);
        const refScale = Math.max(1e-6, capsule.localRadiusScaleRef ?? 1);
        capsule.radius = capsule.localRadius * (currentScale / refScale);
      }
      if (capsule.localStartOffset && capsule.localEndOffset) {
        // Transform local offsets to world space
        worldMatrix.transformPointAffine(capsule.localStartOffset, capsule.start);
        worldMatrix.transformPointAffine(capsule.localEndOffset, capsule.end);
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
        worldMatrix.transformPointAffine(plane.localPointOffset, plane.point);
      } else {
        // No local offset, just use node position
        plane.point.x = worldMatrix.m03;
        plane.point.y = worldMatrix.m13;
        plane.point.z = worldMatrix.m23;
      }

      if (plane.localNormal) {
        // Transform local normal to world space (rotation only)
        worldMatrix.transformVectorAffine(plane.localNormal, plane.normal).inplaceNormalize();
      }
      break;
    }
  }
}

function getUniformScale(worldMatrix: any): number {
  const sx = worldMatrix.transformVectorAffine(Vector3.axisPX(), new Vector3()).magnitude;
  const sy = worldMatrix.transformVectorAffine(Vector3.axisPY(), new Vector3()).magnitude;
  const sz = worldMatrix.transformVectorAffine(Vector3.axisPZ(), new Vector3()).magnitude;
  return Math.max(1e-6, (sx + sy + sz) / 3);
}

function getPerpendicularScale(worldMatrix: any, axisLocal: Vector3): number {
  const axis = axisLocal.magnitudeSq > 1e-8 ? axisLocal.clone().inplaceNormalize() : Vector3.axisPY();
  const helper = Math.abs(axis.y) < 0.99 ? Vector3.axisPY() : Vector3.axisPX();
  const u = Vector3.cross(axis, helper, new Vector3()).inplaceNormalize();
  const v = Vector3.cross(axis, u, new Vector3()).inplaceNormalize();
  const su = worldMatrix.transformVectorAffine(u, new Vector3()).magnitude;
  const sv = worldMatrix.transformVectorAffine(v, new Vector3()).magnitude;
  return Math.max(1e-6, (su + sv) * 0.5);
}
