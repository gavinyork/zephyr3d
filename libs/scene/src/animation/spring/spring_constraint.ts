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
  /** Stiffness coefficient [0-1] used by Verlet solver (0 = no constraint, 1 = rigid) */
  stiffness: number;
  /**
   * XPBD compliance (inverse stiffness) in m/N.
   * 0 = perfectly rigid, larger values = softer spring.
   * Typical ranges: 0 (rigid) ~ 1e-7 (very stiff) ~ 1e-3 (soft cloth) ~ 1e-1 (rubber band).
   * Only used when solver is 'xpbd'.
   */
  compliance: number;
  /**
   * XPBD Lagrange multiplier accumulator, reset to 0 at the start of each time step.
   * Managed internally by the solver — do not set manually.
   */
  lambda: number;
}

/**
 * Creates a new spring constraint
 */
export function createSpringConstraint(
  particleA: number,
  particleB: number,
  restLength: number,
  stiffness: number = 0.8,
  compliance: number = 0
): SpringConstraint {
  return {
    particleA,
    particleB,
    restLength,
    stiffness,
    compliance,
    lambda: 0
  };
}
