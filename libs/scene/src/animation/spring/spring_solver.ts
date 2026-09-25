import { Quaternion, Vector3 } from '@zephyr3d/base';
import type { SpringParticle } from './spring_particle';

/** Motion model used by the spring integration pipeline. */
export type SpringMotionModel = 'legacy' | 'kawaii';

const EPSILON = 1e-6;
export const INITIAL_COLLISION_PENETRATION_SLOP = 1e-4;
export const DEFAULT_INITIAL_COLLISION_PENETRATION_RELEASE_TIME = 0.25;

export function clampSpringRatio(value: number): number {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export function interpolateSpringValue(
  root: number,
  tip: number,
  exponent: number,
  index: number,
  count: number
) {
  const t = Math.pow(index / Math.max(1, count - 1), Math.max(0.1, exponent));
  return root + (tip - root) * t;
}

/**
 * Converts a user-facing per-step strength into a strength that can be applied
 * repeatedly without changing the effective response.
 */
export function getIterationStrength(strength: number, iterations: number): number {
  const value = clampSpringRatio(strength);
  return iterations > 1 ? 1 - Math.pow(1 - value, 1 / iterations) : value;
}

/** Smoothly releases startup collider overlap so particles reach the real surface after `duration`. */
export function getReleasedCollisionPenetration(
  initialPenetration: number,
  elapsed: number,
  duration: number
): number {
  if (initialPenetration <= 0 || duration <= 0) {
    return 0;
  }
  const t = Math.max(0, Math.min(1, elapsed / duration));
  const progress = t * t * (3 - 2 * t);
  return initialPenetration * (1 - progress);
}

/** Returns the Kawaii-style pose target relative to the simulated parent. */
export function getParentRelativePoseTarget(
  particle: SpringParticle,
  parent: SpringParticle | null,
  result = new Vector3()
): Vector3 {
  if (!parent) {
    result.set(particle.animPosition);
    return result;
  }
  Vector3.sub(particle.animPosition, parent.animPosition, result);
  return Vector3.add(parent.position, result, result);
}

export interface SpringPoseTopologyEntry {
  parent: SpringParticle | null;
  nearestAnchor: SpringParticle | null;
  normalizedDistance: number;
}

/** Builds a pose-follow direction and falloff measured from the nearest fixed particle. */
export function getSpringPoseTopology(particles: readonly SpringParticle[]): SpringPoseTopologyEntry[] {
  const fixedIndices: number[] = [];
  for (let i = 0; i < particles.length; i++) {
    if (particles[i].fixed) {
      fixedIndices.push(i);
    }
  }

  if (fixedIndices.length === 0) {
    const lastIndex = Math.max(1, particles.length - 1);
    return particles.map((_, index) => ({
      parent: index > 0 ? particles[index - 1] : null,
      nearestAnchor: null,
      normalizedDistance: index / lastIndex
    }));
  }

  const nearestFixedIndices = new Array<number>(particles.length);
  const distances = new Array<number>(particles.length);
  let maxDistance = 1;
  for (let i = 0; i < particles.length; i++) {
    let nearestFixedIndex = fixedIndices[0];
    let nearestDistance = Math.abs(i - nearestFixedIndex);
    for (let j = 1; j < fixedIndices.length; j++) {
      const distance = Math.abs(i - fixedIndices[j]);
      if (distance < nearestDistance) {
        nearestFixedIndex = fixedIndices[j];
        nearestDistance = distance;
      }
    }
    nearestFixedIndices[i] = nearestFixedIndex;
    distances[i] = nearestDistance;
    maxDistance = Math.max(maxDistance, nearestDistance);
  }

  return particles.map((_, index) => {
    const nearestFixedIndex = nearestFixedIndices[index];
    return {
      parent: index > 0 ? particles[index - 1] : null,
      nearestAnchor: particles[nearestFixedIndex],
      normalizedDistance: distances[index] / maxDistance
    };
  });
}

/** Returns the Kawaii target, blending hierarchy shape with the nearest fixed anchor. */
export function getKawaiiPoseTarget(
  particle: SpringParticle,
  topology: SpringPoseTopologyEntry,
  result = new Vector3()
): Vector3 {
  getParentRelativePoseTarget(particle, topology.parent, result);
  if (!topology.nearestAnchor || topology.nearestAnchor === topology.parent) {
    return result;
  }
  const anchorTarget = getParentRelativePoseTarget(particle, topology.nearestAnchor);
  return Vector3.lerp(result, anchorTarget, 1 - topology.normalizedDistance, result);
}

/** Position-based distance projection with inverse-mass weighting. */
export function solveDistanceConstraint(
  particleA: SpringParticle,
  particleB: SpringParticle,
  restLength: number,
  stiffness: number
): void {
  const inverseMassA = particleA.fixed ? 0 : 1 / Math.max(particleA.mass, EPSILON);
  const inverseMassB = particleB.fixed ? 0 : 1 / Math.max(particleB.mass, EPSILON);
  const inverseMassSum = inverseMassA + inverseMassB;
  if (inverseMassSum <= EPSILON) {
    return;
  }

  const delta = Vector3.sub(particleB.position, particleA.position, new Vector3());
  const length = delta.magnitude;
  if (length <= EPSILON) {
    return;
  }

  const correctionScale = ((length - restLength) / length) * clampSpringRatio(stiffness);
  if (inverseMassA > 0) {
    Vector3.add(
      particleA.position,
      Vector3.scale(delta, correctionScale * (inverseMassA / inverseMassSum), new Vector3()),
      particleA.position
    );
  }
  if (inverseMassB > 0) {
    Vector3.sub(
      particleB.position,
      Vector3.scale(delta, correctionScale * (inverseMassB / inverseMassSum), new Vector3()),
      particleB.position
    );
  }
}

/** Resolves a contact as an inelastic projection while preserving tangential Verlet velocity. */
export function resolveInelasticCollision<TCollider>(
  particle: SpringParticle,
  collider: TCollider,
  resolveCollision: (position: Vector3, collider: TCollider) => boolean,
  allowedPenetration: number = 0
): boolean {
  const positionBeforeCollision = particle.position.clone();
  const preservedDisplacement = Vector3.sub(positionBeforeCollision, particle.prevPosition, new Vector3());
  if (!resolveCollision(particle.position, collider)) {
    return false;
  }

  const correction = Vector3.sub(particle.position, positionBeforeCollision, new Vector3());
  const correctionLength = correction.magnitude;
  const excessPenetration = correctionLength - Math.max(0, allowedPenetration);
  if (excessPenetration <= EPSILON) {
    particle.position.set(positionBeforeCollision);
    return false;
  }

  const outwardNormal = correction.scaleBy(1 / correctionLength);
  Vector3.add(
    positionBeforeCollision,
    Vector3.scale(outwardNormal, excessPenetration, new Vector3()),
    particle.position
  );
  if (correctionLength > EPSILON) {
    const inwardDistance = Vector3.dot(preservedDisplacement, outwardNormal);
    if (inwardDistance < 0) {
      Vector3.sub(
        preservedDisplacement,
        Vector3.scale(outwardNormal, inwardDistance, new Vector3()),
        preservedDisplacement
      );
    }
  }
  Vector3.sub(particle.position, preservedDisplacement, particle.prevPosition);
  return true;
}

/** Returns how far a point is inside a collider according to its resolver. */
export function measureCollisionPenetration<TCollider>(
  position: Vector3,
  collider: TCollider,
  resolveCollision: (position: Vector3, collider: TCollider) => boolean
): number {
  const resolvedPosition = position.clone();
  return resolveCollision(resolvedPosition, collider) ? Vector3.distance(position, resolvedPosition) : 0;
}

function getFallbackRotationAxis(direction: Vector3): Vector3 {
  const reference = Math.abs(direction.x) < 0.8 ? Vector3.axisPX() : Vector3.axisPY();
  return Vector3.cross(direction, reference, new Vector3()).inplaceNormalize();
}

/**
 * Limits a child direction around its current animated direction while
 * preserving the current simulated segment length.
 */
export function solveAngleLimit(
  parent: SpringParticle,
  child: SpringParticle,
  maxAngleDegrees: number,
  preserveVelocity: boolean
): void {
  if (maxAngleDegrees <= 0 || child.fixed) {
    return;
  }

  const poseDirection = Vector3.sub(child.animPosition, parent.animPosition, new Vector3());
  const simulatedDirection = Vector3.sub(child.position, parent.position, new Vector3());
  const simulatedLength = simulatedDirection.magnitude;
  if (poseDirection.magnitudeSq <= EPSILON || simulatedLength <= EPSILON) {
    return;
  }
  poseDirection.inplaceNormalize();
  simulatedDirection.scaleBy(1 / simulatedLength);

  const dot = Math.max(-1, Math.min(1, Vector3.dot(poseDirection, simulatedDirection)));
  const angle = Math.acos(dot);
  const limit = (maxAngleDegrees * Math.PI) / 180;
  if (angle <= limit) {
    return;
  }

  let axis = Vector3.cross(poseDirection, simulatedDirection, new Vector3());
  if (axis.magnitudeSq <= EPSILON) {
    axis = getFallbackRotationAxis(poseDirection);
  } else {
    axis.inplaceNormalize();
  }
  const allowedDirection = Quaternion.fromAxisAngle(axis, limit).transform(poseDirection, new Vector3());
  const previousPosition = child.position.clone();
  Vector3.add(
    parent.position,
    Vector3.scale(allowedDirection, simulatedLength, allowedDirection),
    child.position
  );
  if (preserveVelocity) {
    Vector3.add(
      child.prevPosition,
      Vector3.sub(child.position, previousPosition, previousPosition),
      child.prevPosition
    );
  }
}
