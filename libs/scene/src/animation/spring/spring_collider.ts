import type { Nullable } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import type { SceneNode } from '../../scene/scene_node';

const COLLISION_DISTANCE_EPSILON_SQ = 1e-12;

function getCapsuleAxisFallbackNormal(axis: Vector3, result: Vector3): Vector3 {
  const reference = Math.abs(axis.z) < 0.9 ? Vector3.axisPZ() : Vector3.axisPX();
  Vector3.sub(reference, Vector3.scale(axis, Vector3.dot(reference, axis), result), result);
  return result.inplaceNormalize();
}

/**
 * Base interface for spring collision shapes
 *
 * @public
 */
export interface SpringCollider {
  /** Type of collider */
  type: 'sphere' | 'capsule' | 'plane' | 'box';
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
 * Oriented box collider for spring collision detection.
 *
 * The three axes are normalized world-space directions and halfExtents are
 * measured along the corresponding axes.
 *
 * @public
 */
export interface BoxCollider extends SpringCollider {
  type: 'box';
  /** Center position in world space */
  center: Vector3;
  /** World-space half extents along each local axis */
  halfExtents: Vector3;
  /** Normalized world-space local X/Y/Z axes */
  axes: [Vector3, Vector3, Vector3];
  /** Local center offset from node */
  localOffset?: Vector3;
  /** Authoring-space half extents before node scaling */
  localHalfExtents?: Vector3;
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
 * Creates an oriented box collider.
 * @param centerOrOffset - Center position in world space, or local offset if node is provided
 * @param halfExtents - Local/world half extents of the box
 * @param node - Optional scene node to attach to
 *
 * @public
 */
export function createBoxCollider(
  centerOrOffset: Vector3,
  halfExtents: Vector3,
  node?: SceneNode
): BoxCollider {
  const localExtents = new Vector3(
    Math.max(0.0001, Math.abs(halfExtents.x)),
    Math.max(0.0001, Math.abs(halfExtents.y)),
    Math.max(0.0001, Math.abs(halfExtents.z))
  );
  if (node) {
    const worldMatrix = node.worldMatrix;
    const center = worldMatrix.transformPointAffine(centerOrOffset, new Vector3());
    const axes = createWorldAxes(worldMatrix);
    const scales = getAxisScales(worldMatrix);
    return {
      type: 'box',
      center,
      halfExtents: new Vector3(
        localExtents.x * scales.x,
        localExtents.y * scales.y,
        localExtents.z * scales.z
      ),
      axes,
      localOffset: centerOrOffset.clone(),
      localHalfExtents: localExtents,
      node,
      enabled: true
    };
  }
  return {
    type: 'box',
    center: centerOrOffset.clone(),
    halfExtents: localExtents,
    axes: [Vector3.axisPX(), Vector3.axisPY(), Vector3.axisPZ()],
    node: null,
    enabled: true
  };
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

  if (distSq < radiusSq) {
    // Particle is inside sphere, push it out
    const dist = distSq > COLLISION_DISTANCE_EPSILON_SQ ? Math.sqrt(distSq) : 0;
    const penetration = collider.radius - dist;

    // Push particle to sphere surface
    if (dist > 0) {
      toParticle.scaleBy(1 / dist);
    } else {
      toParticle.setXYZ(0, 1, 0);
    }
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

    if (distSq < radiusSq) {
      const dist = distSq > COLLISION_DISTANCE_EPSILON_SQ ? Math.sqrt(distSq) : 0;
      const penetration = collider.radius - dist;
      if (dist > 0) {
        toParticle.scaleBy(1 / dist);
      } else {
        toParticle.setXYZ(0, 1, 0);
      }
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

  if (distSq < radiusSq) {
    const dist = distSq > COLLISION_DISTANCE_EPSILON_SQ ? Math.sqrt(distSq) : 0;
    const penetration = collider.radius - dist;
    if (dist > 0) {
      toParticleFromAxis.scaleBy(1 / dist);
    } else {
      getCapsuleAxisFallbackNormal(axis, toParticleFromAxis);
    }
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
 * Resolves collision between a particle and an oriented box collider.
 * @returns true if collision occurred
 *
 * @public
 */
export function resolveBoxCollision(particlePos: Vector3, collider: BoxCollider): boolean {
  const delta = Vector3.sub(particlePos, collider.center, new Vector3());
  const local = new Vector3(
    Vector3.dot(delta, collider.axes[0]),
    Vector3.dot(delta, collider.axes[1]),
    Vector3.dot(delta, collider.axes[2])
  );
  const penetration = new Vector3(
    collider.halfExtents.x - Math.abs(local.x),
    collider.halfExtents.y - Math.abs(local.y),
    collider.halfExtents.z - Math.abs(local.z)
  );
  if (penetration.x < 0 || penetration.y < 0 || penetration.z < 0) {
    return false;
  }
  let axis = 0;
  let minPenetration = penetration.x;
  if (penetration.y < minPenetration) {
    axis = 1;
    minPenetration = penetration.y;
  }
  if (penetration.z < minPenetration) {
    axis = 2;
    minPenetration = penetration.z;
  }
  const localAxis = axis === 0 ? local.x : axis === 1 ? local.y : local.z;
  const sign = localAxis < 0 ? -1 : 1;
  const correction = Vector3.scale(collider.axes[axis], minPenetration * sign, new Vector3());
  Vector3.add(particlePos, correction, particlePos);
  return true;
}

/**
 * Updates collider position from its associated node
 *
 * @public
 */
export function updateColliderFromNode(collider: SpringCollider, runtimeNode?: Nullable<SceneNode>): void {
  const node = runtimeNode ?? collider.node;
  if (!node || !collider.enabled) {
    return;
  }

  const worldMatrix = node.worldMatrix;

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

    case 'box': {
      const box = collider as BoxCollider;
      if (box.localOffset) {
        worldMatrix.transformPointAffine(box.localOffset, box.center);
      } else {
        box.center.x = worldMatrix.m03;
        box.center.y = worldMatrix.m13;
        box.center.z = worldMatrix.m23;
      }
      const axes = createWorldAxes(worldMatrix);
      box.axes[0].set(axes[0]);
      box.axes[1].set(axes[1]);
      box.axes[2].set(axes[2]);
      if (box.localHalfExtents) {
        const scales = getAxisScales(worldMatrix);
        box.halfExtents.setXYZ(
          box.localHalfExtents.x * scales.x,
          box.localHalfExtents.y * scales.y,
          box.localHalfExtents.z * scales.z
        );
      }
      break;
    }
  }
}

function createWorldAxes(worldMatrix: any): [Vector3, Vector3, Vector3] {
  const x = worldMatrix.transformVectorAffine(Vector3.axisPX(), new Vector3()).inplaceNormalize();
  const y = worldMatrix.transformVectorAffine(Vector3.axisPY(), new Vector3()).inplaceNormalize();
  const z = worldMatrix.transformVectorAffine(Vector3.axisPZ(), new Vector3()).inplaceNormalize();
  return [x, y, z];
}

function getAxisScales(worldMatrix: any) {
  return {
    x: Math.max(1e-6, worldMatrix.transformVectorAffine(Vector3.axisPX(), new Vector3()).magnitude),
    y: Math.max(1e-6, worldMatrix.transformVectorAffine(Vector3.axisPY(), new Vector3()).magnitude),
    z: Math.max(1e-6, worldMatrix.transformVectorAffine(Vector3.axisPZ(), new Vector3()).magnitude)
  };
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
