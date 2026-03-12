/**
 * Represents a spring constraint between two particles
 */
export interface SpringConstraint {
  /** Index of the first particle */
  particleA: number;
  /** Index of the second particle */
  particleB: number;
  /** Rest length of the spring */
  restLength: number;
  /** Stiffness coefficient [0-1] (0 = no constraint, 1 = rigid) */
  stiffness: number;
}

/**
 * Creates a new spring constraint
 */
export function createSpringConstraint(
  particleA: number,
  particleB: number,
  restLength: number,
  stiffness: number = 0.8
): SpringConstraint {
  return {
    particleA,
    particleB,
    restLength,
    stiffness
  };
}
