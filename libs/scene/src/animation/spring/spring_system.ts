import { Vector3, Quaternion } from '@zephyr3d/base';
import type { SpringChain } from './spring_chain';
import { IKUtils } from '../ik/ik_utils';
import type { SpringCollider } from './spring_collider';
import {
  resolveSphereCollision,
  resolveCapsuleCollision,
  resolvePlaneCollision,
  updateColliderFromNode
} from './spring_collider';

/**
 * Options for creating a SpringSystem
 *
 * @public
 */
export interface SpringSystemOptions {
  /** Number of constraint solver iterations (default: 5) */
  iterations?: number;
  /** Gravity force vector (default: (0, -9.8, 0)) */
  gravity?: Vector3;
  /** Wind force vector (default: (0, 0, 0)) */
  wind?: Vector3;
  /** Enable inertial forces (centrifugal/Coriolis) when root rotates (default: true) */
  enableInertialForces?: boolean;
  /** Centrifugal force multiplier (default: 1.0) */
  centrifugalScale?: number;
  /** Coriolis force multiplier (default: 1.0) */
  coriolisScale?: number;
  /**
   * Constraint solver type (default: 'verlet').
   * - 'verlet': Classic Verlet integration with iterative position correction.
   *   stiffness [0-1] controls correction strength per iteration.
   * - 'xpbd': Extended Position-Based Dynamics (Müller et al. 2020).
   *   Uses compliance (inverse stiffness in m/N) for physically correct,
   *   iteration-count-independent constraint solving.
   */
  solver?: 'verlet' | 'xpbd';
}

/**
 * Physics engine for spring-based particle simulation
 * Uses Verlet integration and iterative constraint solving
 *
 * @public
 */
export class SpringSystem {
  private _chain: SpringChain;
  private _iterations: number;
  private _gravity: Vector3;
  private _wind: Vector3;
  private _enableInertialForces: boolean;
  private _centrifugalScale: number;
  private _coriolisScale: number;
  private _colliders: SpringCollider[];
  private _solver: 'verlet' | 'xpbd';

  constructor(chain: SpringChain, options?: SpringSystemOptions) {
    this._chain = chain;
    this._iterations = options?.iterations ?? 5;
    this._gravity = options?.gravity?.clone() ?? new Vector3(0, -9.8, 0);
    this._wind = options?.wind?.clone() ?? new Vector3(0, 0, 0);
    this._enableInertialForces = options?.enableInertialForces ?? true;
    this._centrifugalScale = options?.centrifugalScale ?? 1.0;
    this._coriolisScale = options?.coriolisScale ?? 1.0;
    this._colliders = [];
    this._solver = options?.solver ?? 'verlet';
  }

  /**
   * Updates the physics simulation
   * @param deltaTime - Time step in seconds
   */
  update(deltaTime: number): void {
    // Clamp deltaTime to prevent instability
    const dt = Math.min(deltaTime, 0.033); // Max 30 FPS

    // Step 1: Save all particle positions before updating
    if (this._enableInertialForces) {
      for (const p of this._chain.particles) {
        p.lastFramePosition.set(p.position);
      }
    }

    // Step 2: Update fixed particles from their scene nodes
    this.updateFixedParticles();

    // Step 3: Calculate global rotation parameters
    let rotationCenter: Vector3 | null = null;
    let angularVelocity: Vector3 | null = null;

    if (this._enableInertialForces && dt > 0.0001) {
      const result = this.calculateGlobalRotation(dt);
      rotationCenter = result.center;
      angularVelocity = result.omega;
    }

    // Step 4: Verlet integration with inertial forces
    for (let i = 0; i < this._chain.particles.length; i++) {
      const p = this._chain.particles[i];
      if (p.fixed) {
        continue;
      }

      // Calculate velocity (implicit in Verlet)
      const velocity = Vector3.sub(p.position, p.prevPosition, new Vector3());
      velocity.scaleBy(p.damping);

      // Apply external forces (gravity + wind)
      const acceleration = Vector3.add(this._gravity, this._wind, new Vector3());

      // Apply inertial forces from rotating reference frame
      if (this._enableInertialForces && rotationCenter && angularVelocity) {
        const inertialAccel = this.calculateInertialAcceleration(
          p,
          rotationCenter,
          angularVelocity,
          velocity,
          this._centrifugalScale,
          this._coriolisScale
        );
        Vector3.add(acceleration, inertialAccel, acceleration);
      }

      const positionDelta = Vector3.scale(acceleration, dt * dt, new Vector3());
      Vector3.add(velocity, positionDelta, velocity);

      // Update position
      p.prevPosition.set(p.position);
      Vector3.add(p.position, velocity, p.position);
    }

    // Step 5: Iteratively solve constraints
    if (this._solver === 'xpbd') {
      // Reset Lagrange multipliers at the start of each time step
      for (const constraint of this._chain.constraints) {
        constraint.lambda = 0;
      }
    }
    for (let iter = 0; iter < this._iterations; iter++) {
      for (const constraint of this._chain.constraints) {
        if (this._solver === 'xpbd') {
          this.solveConstraintXPBD(constraint, dt);
        } else {
          this.solveConstraint(constraint);
        }
      }

      // Apply collision constraints
      this.solveCollisions();
    }
  }

  /**
   * Updates fixed particles to match their scene node positions
   */
  private updateFixedParticles(): void {
    for (const particle of this._chain.particles) {
      if (particle.node && particle.fixed) {
        const worldMatrix = particle.node.worldMatrix;
        const worldPos = new Vector3(worldMatrix.m03, worldMatrix.m13, worldMatrix.m23);
        particle.position.set(worldPos);
        particle.prevPosition.set(worldPos);

        // Maintain position history for rotation center estimation
        if (this._enableInertialForces) {
          if (!particle.positionHistory) {
            particle.positionHistory = [];
          }
          particle.positionHistory.push(worldPos.clone());
          // Keep only last 5 frames
          if (particle.positionHistory.length > 5) {
            particle.positionHistory.shift();
          }
        }
      }
    }
  }

  /**
   * Calculates global rotation parameters from fixed particle movements
   * Uses position history to estimate rotation center
   */
  private calculateGlobalRotation(dt: number): { center: Vector3; omega: Vector3 } {
    // Collect fixed particles with movement
    const fixedParticles: any[] = [];
    const velocities: Vector3[] = [];

    for (const p of this._chain.particles) {
      if (!p.fixed) {
        continue;
      }

      const velocity = Vector3.sub(p.position, p.lastFramePosition, new Vector3());
      velocity.scaleBy(1.0 / dt);

      if (velocity.magnitudeSq > 0.001) {
        fixedParticles.push(p);
        velocities.push(velocity);
      }
    }

    if (fixedParticles.length === 0) {
      return { center: new Vector3(0, 0, 0), omega: new Vector3(0, 0, 0) };
    }

    // Estimate rotation center using position history
    let center: Vector3;

    if (fixedParticles.length === 1) {
      // Single fixed particle: use position history to estimate rotation center
      center = this.estimateRotationCenterFromHistory(fixedParticles[0], velocities[0]);
    } else {
      // Multiple fixed particles: use their average position
      center = new Vector3(0, 0, 0);
      for (const p of fixedParticles) {
        Vector3.add(center, p.position, center);
      }
      center.scaleBy(1.0 / fixedParticles.length);
    }

    // Estimate angular velocity
    let sumOmega = new Vector3(0, 0, 0);
    let count = 0;

    for (let i = 0; i < fixedParticles.length; i++) {
      const r = Vector3.sub(fixedParticles[i].position, center, new Vector3());
      const v = velocities[i];
      const rLengthSq = r.magnitudeSq;

      if (rLengthSq > 0.0001) {
        // ω = (r × v) / |r|²
        const omega = Vector3.cross(r, v, new Vector3());
        omega.scaleBy(1.0 / rLengthSq);
        Vector3.add(sumOmega, omega, sumOmega);
        count++;
      }
    }

    if (count > 0) {
      sumOmega.scaleBy(1.0 / count);
    }

    return { center, omega: sumOmega };
  }

  /**
   * Estimates rotation center from a single particle's position history
   * Uses circular motion fitting
   */
  private estimateRotationCenterFromHistory(particle: any, currentVelocity: Vector3): Vector3 {
    const history = particle.positionHistory;
    if (!history || history.length < 3) {
      // Not enough history: estimate using velocity perpendicular direction
      // Assume rotation center is perpendicular to velocity
      // Use a default radius based on velocity magnitude
      const speed = currentVelocity.magnitude;
      if (speed < 0.001) {
        return particle.position.clone();
      }

      // Estimate radius: for typical character rotation, assume ~0.5-1.0m radius
      const estimatedRadius = Math.max(0.5, speed * 0.5);

      // Direction perpendicular to velocity (in the plane of motion)
      // We need to guess which perpendicular direction - use cross product with up vector
      const up = new Vector3(0, 1, 0);
      const perpDir = Vector3.cross(currentVelocity, up, new Vector3());

      if (perpDir.magnitudeSq < 0.0001) {
        // Velocity is vertical, use another perpendicular
        perpDir.set(new Vector3(1, 0, 0));
      } else {
        perpDir.inplaceNormalize();
      }

      // Rotation center is perpendicular to velocity
      const center = Vector3.add(
        particle.position,
        Vector3.scale(perpDir, estimatedRadius, new Vector3()),
        new Vector3()
      );
      return center;
    }

    // Fit a circle through the last 3 positions
    // Use positions at indices: 0 (oldest), middle, last (newest)
    const p1 = history[0];
    const p2 = history[Math.floor(history.length / 2)];
    const p3 = history[history.length - 1];

    // Calculate circle center from 3 points
    const center = this.calculateCircleCenter(p1, p2, p3);
    return center;
  }

  /**
   * Calculates the center of a circle passing through 3 points
   * Uses perpendicular bisector method
   */
  private calculateCircleCenter(p1: Vector3, p2: Vector3, p3: Vector3): Vector3 {
    // Midpoints
    const mid12 = Vector3.scale(Vector3.add(p1, p2, new Vector3()), 0.5, new Vector3());
    const mid23 = Vector3.scale(Vector3.add(p2, p3, new Vector3()), 0.5, new Vector3());

    // Direction vectors
    const dir12 = Vector3.sub(p2, p1, new Vector3());
    const dir23 = Vector3.sub(p3, p2, new Vector3());

    // Normal vectors (perpendicular bisectors)
    // For 3D, we need to find perpendiculars in the plane of the three points
    const normal = Vector3.cross(dir12, dir23, new Vector3());

    if (normal.magnitudeSq < 0.0001) {
      // Points are collinear, return midpoint
      return Vector3.scale(
        Vector3.add(Vector3.add(p1, p2, new Vector3()), p3, new Vector3()),
        1.0 / 3.0,
        new Vector3()
      );
    }

    normal.inplaceNormalize();

    // Perpendicular to dir12 in the plane
    const perp12 = Vector3.cross(dir12, normal, new Vector3()).inplaceNormalize();

    // Perpendicular to dir23 in the plane
    const perp23 = Vector3.cross(dir23, normal, new Vector3()).inplaceNormalize();

    // Find intersection of two lines:
    // Line 1: mid12 + t * perp12
    // Line 2: mid23 + s * perp23
    // Solve: mid12 + t * perp12 = mid23 + s * perp23

    const diff = Vector3.sub(mid23, mid12, new Vector3());

    // Use 2D projection for simplicity (project onto plane perpendicular to normal)
    // Solve in the plane: t * perp12 - s * perp23 = diff
    // Use least squares or pick the dominant components

    const det = perp12.x * perp23.y - perp12.y * perp23.x;

    if (Math.abs(det) > 0.0001) {
      const t = (diff.x * perp23.y - diff.y * perp23.x) / det;
      const center = Vector3.add(mid12, Vector3.scale(perp12, t, new Vector3()), new Vector3());
      return center;
    }

    // Fallback: use centroid
    return Vector3.scale(
      Vector3.add(Vector3.add(p1, p2, new Vector3()), p3, new Vector3()),
      1.0 / 3.0,
      new Vector3()
    );
  }

  /**
   * Calculates inertial acceleration for a particle in a rotating reference frame
   */
  private calculateInertialAcceleration(
    particle: any,
    rotationCenter: Vector3,
    angularVelocity: Vector3,
    particleVelocity: Vector3,
    centrifugalScale: number,
    coriolisScale: number
  ): Vector3 {
    // Vector from rotation center to particle
    const r = Vector3.sub(particle.position, rotationCenter, new Vector3());

    // Centrifugal acceleration: a_centrifugal = ω × (ω × r)
    const omegaCrossR = Vector3.cross(angularVelocity, r, new Vector3());
    const centrifugalAccel = Vector3.cross(angularVelocity, omegaCrossR, new Vector3());
    centrifugalAccel.scaleBy(centrifugalScale);

    // Coriolis acceleration: a_coriolis = -2ω × v_relative
    // v_relative is the particle's velocity in the rotating frame
    // Use the velocity passed in (already calculated from prevPosition)
    const coriolisAccel = Vector3.cross(angularVelocity, particleVelocity, new Vector3());
    coriolisAccel.scaleBy(-2.0 * coriolisScale);

    // Total inertial acceleration
    const totalAccel = Vector3.add(centrifugalAccel, coriolisAccel, new Vector3());
    return totalAccel;
  }

  /**
   * Solves a single spring constraint using XPBD (Extended Position-Based Dynamics).
   *
   * Reference: Müller et al., "Detailed Rigid Body Simulation with Extended Position Based Dynamics", 2020.
   *
   * The XPBD correction for a distance constraint C(x) = |x_b - x_a| - L is:
   *   α̃ = compliance / dt²          (scaled compliance)
   *   Δλ = (-C - α̃·λ) / (w_a + w_b + α̃)
   *   λ  += Δλ
   *   Δx_a = -w_a · Δλ · n̂
   *   Δx_b = +w_b · Δλ · n̂
   * where w = 1/mass (0 for fixed particles), n̂ = unit vector from a to b.
   */
  private solveConstraintXPBD(constraint: any, dt: number): void {
    const pA = this._chain.particles[constraint.particleA];
    const pB = this._chain.particles[constraint.particleB];

    const wA = pA.fixed ? 0 : 1.0 / pA.mass;
    const wB = pB.fixed ? 0 : 1.0 / pB.mass;
    const wSum = wA + wB;
    if (wSum < 1e-10) {
      return;
    }

    const delta = Vector3.sub(pB.position, pA.position, new Vector3());
    const currentLength = delta.magnitude;
    if (currentLength < 0.0001) {
      return;
    }

    // Constraint value C = currentLength - restLength
    const C = currentLength - constraint.restLength;

    // Scaled compliance: α̃ = compliance / dt²
    const alphaTilde = constraint.compliance / (dt * dt);

    // XPBD Lagrange multiplier update
    const deltaLambda = (-C - alphaTilde * constraint.lambda) / (wSum + alphaTilde);
    constraint.lambda += deltaLambda;

    // Correction direction (unit vector from A to B)
    const n = Vector3.scale(delta, 1.0 / currentLength, new Vector3());

    if (!pA.fixed) {
      // Δx_a = -w_a · Δλ · n̂
      Vector3.add(pA.position, Vector3.scale(n, -wA * deltaLambda, new Vector3()), pA.position);
    }
    if (!pB.fixed) {
      // Δx_b = +w_b · Δλ · n̂
      Vector3.add(pB.position, Vector3.scale(n, wB * deltaLambda, new Vector3()), pB.position);
    }
  }

  /**
   * Solves a single spring constraint (Verlet / PBD)
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
   * Solves collisions for all particles
   */
  private solveCollisions(): void {
    // Update dynamic colliders from their nodes
    for (const collider of this._colliders) {
      if (collider.node) {
        updateColliderFromNode(collider);
      }
    }

    // Check each particle against all colliders
    for (const particle of this._chain.particles) {
      if (particle.fixed) {
        continue; // Skip fixed particles
      }

      for (const collider of this._colliders) {
        if (!collider.enabled) {
          continue;
        }

        switch (collider.type) {
          case 'sphere':
            resolveSphereCollision(particle.position, collider as any);
            break;
          case 'capsule':
            resolveCapsuleCollision(particle.position, collider as any);
            break;
          case 'plane':
            resolvePlaneCollision(particle.position, collider as any);
            break;
        }
      }
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
      const node = particle.node;

      // Skip if no node
      if (!node) {
        continue;
      }

      // Get current bone direction from node's world matrix (before physics)
      // This reflects the current animation/skeleton state
      const currentBonePos = new Vector3(node.worldMatrix.m03, node.worldMatrix.m13, node.worldMatrix.m23);

      const nextNode = nextParticle.node;
      if (!nextNode) {
        continue;
      }

      const nextBonePos = new Vector3(
        nextNode.worldMatrix.m03,
        nextNode.worldMatrix.m13,
        nextNode.worldMatrix.m23
      );
      const originalDir = Vector3.sub(nextBonePos, currentBonePos, new Vector3());

      // Get current bone rotation from node's world matrix
      const currentBoneRotation = new Quaternion();
      node.worldMatrix.decompose(null, currentBoneRotation, null);

      // Calculate new direction from physics simulation
      const newDir = Vector3.sub(nextParticle.position, particle.position, new Vector3());

      // Calculate rotation needed to align original direction to new direction
      const deltaRotation = new Quaternion();
      IKUtils.fromToRotation(originalDir, newDir, deltaRotation);

      // Calculate new world rotation
      let worldRotation = Quaternion.multiply(deltaRotation, currentBoneRotation, new Quaternion());

      // Blend with current rotation based on weight
      if (weight < 1) {
        Quaternion.slerp(currentBoneRotation, worldRotation, weight, worldRotation);
      }

      // Convert world rotation to local rotation (relative to parent)
      const parent = node.parent;
      if (parent) {
        const parentWorldRotation = new Quaternion();
        parent.worldMatrix.decompose(null, parentWorldRotation, null);

        // localRotation = conjugate(parentWorldRotation) * worldRotation
        const parentInvRotation = Quaternion.conjugate(parentWorldRotation, new Quaternion());
        const localRotation = Quaternion.multiply(parentInvRotation, worldRotation, new Quaternion());

        node.rotation = localRotation;
      } else {
        // Root node has no parent, world rotation is local rotation
        node.rotation = worldRotation;
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

  set gravity(gravity: Vector3) {
    this._gravity.set(gravity);
  }

  /**
   * Gets the current wind
   */
  get wind(): Vector3 {
    return this._wind;
  }

  set wind(wind: Vector3) {
    this._wind.set(wind);
  }

  /**
   * Gets the number of iterations
   */
  get iterations(): number {
    return this._iterations;
  }

  set iterations(count: number) {
    this._iterations = Math.max(1, count);
  }

  /**
   * Gets whether inertial forces are enabled
   */
  get enableInertialForces(): boolean {
    return this._enableInertialForces;
  }

  set enableInertialForces(enabled: boolean) {
    this._enableInertialForces = enabled;
  }

  /**
   * Gets the centrifugal force scale
   */
  get centrifugalScale(): number {
    return this._centrifugalScale;
  }

  set centrifugalScale(scale: number) {
    this._centrifugalScale = Math.max(0, scale);
  }

  /**
   * Gets the Coriolis force scale
   */
  get coriolisScale(): number {
    return this._coriolisScale;
  }

  /**
   * Sets the Coriolis force scale
   */
  set coriolisScale(scale: number) {
    this._coriolisScale = Math.max(0, scale);
  }

  /**
   * Gets the constraint solver type
   */
  get solver(): 'verlet' | 'xpbd' {
    return this._solver;
  }

  /**
   * Sets the constraint solver type.
   * Switching to 'xpbd' resets all Lagrange multipliers.
   */
  set solver(type: 'verlet' | 'xpbd') {
    if (this._solver !== type) {
      this._solver = type;
      if (type === 'xpbd') {
        for (const c of this._chain.constraints) {
          c.lambda = 0;
        }
      }
    }
  }

  /**
   * Adds a collider to the system
   */
  addCollider(collider: SpringCollider): void {
    this._colliders.push(collider);
  }

  /**
   * Removes a collider from the system
   */
  removeCollider(collider: SpringCollider): boolean {
    const index = this._colliders.indexOf(collider);
    if (index >= 0) {
      this._colliders.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Clears all colliders
   */
  clearColliders(): void {
    this._colliders = [];
  }

  /**
   * Gets all colliders
   */
  get colliders(): SpringCollider[] {
    return this._colliders;
  }
}
