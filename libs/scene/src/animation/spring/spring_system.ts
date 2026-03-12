import { Vector3, Quaternion } from '@zephyr3d/base';
import type { SpringChain } from './spring_chain';
import { IKUtils } from '../ik/ik_utils';

/**
 * Options for creating a SpringSystem
 */
export interface SpringSystemOptions {
  /** Number of constraint solver iterations (default: 5) */
  iterations?: number;
  /** Gravity force vector (default: (0, -9.8, 0)) */
  gravity?: Vector3;
  /** Wind force vector (default: (0, 0, 0)) */
  wind?: Vector3;
}

/**
 * Physics engine for spring-based particle simulation
 * Uses Verlet integration and iterative constraint solving
 */
export class SpringSystem {
  private _chain: SpringChain;
  private _iterations: number;
  private _gravity: Vector3;
  private _wind: Vector3;

  constructor(chain: SpringChain, options?: SpringSystemOptions) {
    this._chain = chain;
    this._iterations = options?.iterations ?? 5;
    this._gravity = options?.gravity?.clone() ?? new Vector3(0, -9.8, 0);
    this._wind = options?.wind?.clone() ?? new Vector3(0, 0, 0);
  }

  /**
   * Updates the physics simulation
   * @param deltaTime - Time step in seconds
   */
  update(deltaTime: number): void {
    // Clamp deltaTime to prevent instability
    const dt = Math.min(deltaTime, 0.033); // Max 30 FPS

    // Step 1: Update fixed particles from their scene nodes
    this.updateFixedParticles();

    // Step 2: Verlet integration
    for (let i = 0; i < this._chain.particles.length; i++) {
      const p = this._chain.particles[i];
      if (p.fixed) {
        continue;
      }

      // Calculate velocity (implicit in Verlet)
      const velocity = Vector3.sub(p.position, p.prevPosition, new Vector3());
      velocity.scaleBy(p.damping);

      // Apply external forces (gravity + wind)
      // Note: gravity and wind are accelerations (m/s²), not forces (N)
      // This means acceleration is independent of mass (Galileo's principle)
      const acceleration = Vector3.add(this._gravity, this._wind, new Vector3());
      const positionDelta = Vector3.scale(acceleration, dt * dt, new Vector3());
      Vector3.add(velocity, positionDelta, velocity);

      // Update position
      p.prevPosition.set(p.position);
      Vector3.add(p.position, velocity, p.position);
    }

    // Step 3: Iteratively solve constraints
    for (let iter = 0; iter < this._iterations; iter++) {
      for (const constraint of this._chain.constraints) {
        this.solveConstraint(constraint);
      }
    }
  }

  /**
   * Updates fixed particles to match their scene node positions
   */
  private updateFixedParticles(): void {
    for (const particle of this._chain.particles) {
      if (particle.fixed && particle.node) {
        const worldPos = new Vector3(
          particle.node.worldMatrix.m03,
          particle.node.worldMatrix.m13,
          particle.node.worldMatrix.m23
        );
        particle.position.set(worldPos);
        particle.prevPosition.set(worldPos);
      }
    }
  }

  /**
   * Solves a single spring constraint
   */
  private solveConstraint(constraint: any): void {
    const pA = this._chain.particles[constraint.particleA];
    const pB = this._chain.particles[constraint.particleB];

    // Calculate current distance
    const delta = Vector3.sub(pB.position, pA.position, new Vector3());
    const currentLength = delta.magnitude;

    if (currentLength < 0.0001) {
      return;
    } // Avoid division by zero

    // Calculate correction
    const diff = (currentLength - constraint.restLength) / currentLength;
    const correction = Vector3.scale(delta, diff * constraint.stiffness * 0.5, new Vector3());

    // Apply correction (considering mass and fixed state)
    if (!pA.fixed) {
      Vector3.add(pA.position, correction, pA.position);
    }
    if (!pB.fixed) {
      Vector3.sub(pB.position, correction, pB.position);
    }
  }

  /**
   * Applies simulation results to scene nodes
   * @param weight - Blend weight [0-1] (default: 1.0)
   */
  applyToNodes(weight: number = 1.0): void {
    for (let i = 0; i < this._chain.particles.length - 1; i++) {
      const particle = this._chain.particles[i];
      const nextParticle = this._chain.particles[i + 1];

      // Skip if no node or no original rotation
      if (!particle.node || !particle.originalRotation) {
        continue;
      }

      // Calculate direction from current particle to next in world space
      const originalDir = Vector3.sub(
        nextParticle.originalPosition,
        particle.originalPosition,
        new Vector3()
      );
      const newDir = Vector3.sub(nextParticle.position, particle.position, new Vector3());

      // Calculate rotation needed to align original direction to new direction
      const deltaRotation = new Quaternion();
      IKUtils.fromToRotation(originalDir, newDir, deltaRotation);

      // Calculate new world rotation
      let worldRotation = Quaternion.multiply(deltaRotation, particle.originalRotation, new Quaternion());

      // Blend with original rotation based on weight
      if (weight < 1) {
        Quaternion.slerp(particle.originalRotation, worldRotation, weight, worldRotation);
      }

      // Convert world rotation to local rotation (relative to parent)
      const parent = particle.node.parent;
      if (parent) {
        const parentWorldRotation = new Quaternion();
        parent.worldMatrix.decompose(null, parentWorldRotation, null);

        // localRotation = conjugate(parentWorldRotation) * worldRotation
        const parentInvRotation = Quaternion.conjugate(parentWorldRotation, new Quaternion());
        const localRotation = Quaternion.multiply(parentInvRotation, worldRotation, new Quaternion());

        particle.node.rotation = localRotation;
      } else {
        // Root node has no parent, world rotation is local rotation
        particle.node.rotation = worldRotation;
      }
    }
  }

  /**
   * Resets the simulation to initial state
   */
  reset(): void {
    this._chain.reset();
  }

  /**
   * Sets the gravity force
   */
  setGravity(gravity: Vector3): void {
    this._gravity.set(gravity);
  }

  /**
   * Sets the wind force
   */
  setWind(wind: Vector3): void {
    this._wind.set(wind);
  }

  /**
   * Sets the number of constraint solver iterations
   */
  setIterations(count: number): void {
    this._iterations = Math.max(1, count);
  }

  /**
   * Gets the spring chain
   */
  get chain(): SpringChain {
    return this._chain;
  }

  /**
   * Gets the current gravity
   */
  get gravity(): Vector3 {
    return this._gravity;
  }

  /**
   * Gets the current wind
   */
  get wind(): Vector3 {
    return this._wind;
  }

  /**
   * Gets the number of iterations
   */
  get iterations(): number {
    return this._iterations;
  }
}
