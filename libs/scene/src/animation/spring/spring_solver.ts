import { Quaternion, Vector3 } from '@zephyr3d/base';
import type { SpringParticle } from './spring_particle';

/** Motion model used by the spring integration pipeline. */
export type SpringMotionModel = 'legacy' | 'kawaii';

const EPSILON = 1e-6;

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
