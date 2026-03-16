import { Vector3, Quaternion } from '@zephyr3d/base';
import type { SpringChain } from './spring_chain';
import type { SpringConstraint } from './spring_constraint';
import { IKUtils } from '../ik/ik_utils';

/**
 * Constraint between particles in different chains
 */
export interface InterChainConstraint {
  /** Index of the first chain */
  chainAIndex: number;
  /** Index of the second chain */
  chainBIndex: number;
  /** Index of particle in chain A */
  particleAIndex: number;
  /** Index of particle in chain B */
  particleBIndex: number;
  /** Desired distance between particles */
  restLength: number;
  /** Constraint strength [0-1] */
  stiffness: number;
}

/**
 * Options for creating a MultiChainSpringSystem
 */
export interface MultiChainSpringSystemOptions {
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
}

/**
 * Physics engine for multiple spring chains with inter-chain constraints
 * Suitable for cloth, skirts, capes, and other multi-chain simulations
 */
export class MultiChainSpringSystem {
  private _chains: SpringChain[];
  private _interChainConstraints: InterChainConstraint[];
  private _iterations: number;
  private _gravity: Vector3;
  private _wind: Vector3;
  private _enableInertialForces: boolean;
  private _centrifugalScale: number;
  private _coriolisScale: number;

  constructor(options?: MultiChainSpringSystemOptions) {
    this._chains = [];
    this._interChainConstraints = [];
    this._iterations = options?.iterations ?? 5;
    this._gravity = options?.gravity?.clone() ?? new Vector3(0, -9.8, 0);
    this._wind = options?.wind?.clone() ?? new Vector3(0, 0, 0);
    this._enableInertialForces = options?.enableInertialForces ?? true;
    this._centrifugalScale = options?.centrifugalScale ?? 1.0;
    this._coriolisScale = options?.coriolisScale ?? 1.0;
  }

  /**
   * Adds a spring chain to the system
   * @param chain - The chain to add
   * @returns The index of the added chain
   */
  addChain(chain: SpringChain): number {
    this._chains.push(chain);
    return this._chains.length - 1;
  }

  /**
   * Adds an inter-chain constraint
   * @param constraint - The constraint to add
   */
  addInterChainConstraint(constraint: InterChainConstraint): void {
    this._interChainConstraints.push(constraint);
  }

  /**
   * Creates radial constraints between adjacent chains
   * Useful for skirts, capes, and other radial multi-chain structures
   * @param options - Configuration options
   */
  createRadialConstraints(options: {
    /** Constraint stiffness [0-1] */
    stiffness: number;
    /** Maximum distance to create constraints (particles further apart are not connected) */
    maxDistance: number;
    /** Skip first N rows of particles (e.g., anchor points at waist) */
    skipRows?: number;
    /** Connect to next N chains (default: 1, only adjacent chains) */
    connectDistance?: number;
  }): void {
    const skipRows = options.skipRows ?? 0;
    const connectDistance = options.connectDistance ?? 1;

    for (let i = 0; i < this._chains.length; i++) {
      for (let offset = 1; offset <= connectDistance; offset++) {
        const j = (i + offset) % this._chains.length;
        const chainA = this._chains[i];
        const chainB = this._chains[j];

        const minLength = Math.min(chainA.particles.length, chainB.particles.length);

        for (let row = skipRows; row < minLength; row++) {
          const pA = chainA.particles[row];
          const pB = chainB.particles[row];
          const distance = Vector3.distance(pA.position, pB.position);

          if (distance <= options.maxDistance) {
            this.addInterChainConstraint({
              chainAIndex: i,
              chainBIndex: j,
              particleAIndex: row,
              particleBIndex: row,
              restLength: distance,
              stiffness: options.stiffness
            });
          }
        }
      }
    }
  }

  /**
   * Updates the physics simulation for all chains
   * @param deltaTime - Time step in seconds
   */
  update(deltaTime: number): void {
    const dt = Math.min(deltaTime, 0.033);

    // Save all particle positions before updating
    if (this._enableInertialForces) {
      for (const chain of this._chains) {
        for (const p of chain.particles) {
          p.lastFramePosition.set(p.position);
        }
      }
    }

    this.updateFixedParticles();

    // Calculate global rotation parameters
    let rotationCenter: Vector3 | null = null;
    let angularVelocity: Vector3 | null = null;

    if (this._enableInertialForces && dt > 0.0001) {
      const result = this.calculateGlobalRotation(dt);
      rotationCenter = result.center;
      angularVelocity = result.omega;
    }

    for (const chain of this._chains) {
      for (const particle of chain.particles) {
        if (particle.fixed) {
          continue;
        }

        const velocity = Vector3.sub(particle.position, particle.prevPosition, new Vector3());
        velocity.scaleBy(particle.damping);

        const acceleration = Vector3.add(this._gravity, this._wind, new Vector3());

        // Apply inertial forces
        if (this._enableInertialForces && rotationCenter && angularVelocity) {
          const inertialAccel = this.calculateInertialAcceleration(
            particle,
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

        particle.prevPosition.set(particle.position);
        Vector3.add(particle.position, velocity, particle.position);
      }
    }

    for (let iter = 0; iter < this._iterations; iter++) {
      for (const chain of this._chains) {
        for (const constraint of chain.constraints) {
          this.solveConstraint(chain, constraint);
        }
      }

      for (const constraint of this._interChainConstraints) {
        this.solveInterChainConstraint(constraint);
      }
    }
  }

  private updateFixedParticles(): void {
    for (const chain of this._chains) {
      for (const particle of chain.particles) {
        if (particle.fixed && particle.node) {
          const worldPos = new Vector3(
            particle.node.worldMatrix.m03,
            particle.node.worldMatrix.m13,
            particle.node.worldMatrix.m23
          );
          particle.position.set(worldPos);
          particle.prevPosition.set(worldPos);

          // Maintain position history
          if (this._enableInertialForces) {
            if (!particle.positionHistory) {
              particle.positionHistory = [];
            }
            particle.positionHistory.push(worldPos.clone());
            if (particle.positionHistory.length > 5) {
              particle.positionHistory.shift();
            }
          }
        }
      }
    }
  }

  private calculateGlobalRotation(dt: number): { center: Vector3; omega: Vector3 } {
    const fixedParticles: any[] = [];
    const velocities: Vector3[] = [];

    for (const chain of this._chains) {
      for (const p of chain.particles) {
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
    }

    if (fixedParticles.length === 0) {
      return { center: new Vector3(0, 0, 0), omega: new Vector3(0, 0, 0) };
    }

    // Estimate rotation center
    let center: Vector3;

    if (fixedParticles.length === 1) {
      center = this.estimateRotationCenterFromHistory(fixedParticles[0], velocities[0]);
    } else {
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

  private estimateRotationCenterFromHistory(particle: any, currentVelocity: Vector3): Vector3 {
    const history = particle.positionHistory;
    if (!history || history.length < 3) {
      const speed = currentVelocity.magnitude;
      if (speed < 0.001) {
        return particle.position.clone();
      }

      const estimatedRadius = Math.max(0.5, speed * 0.5);
      const up = new Vector3(0, 1, 0);
      const perpDir = Vector3.cross(currentVelocity, up, new Vector3());

      if (perpDir.magnitudeSq < 0.0001) {
        perpDir.set(new Vector3(1, 0, 0));
      } else {
        Vector3.normalize(perpDir, perpDir);
      }

      const center = Vector3.add(
        particle.position,
        Vector3.scale(perpDir, estimatedRadius, new Vector3()),
        new Vector3()
      );
      return center;
    }

    const p1 = history[0];
    const p2 = history[Math.floor(history.length / 2)];
    const p3 = history[history.length - 1];

    const center = this.calculateCircleCenter(p1, p2, p3);
    return center;
  }

  private calculateCircleCenter(p1: Vector3, p2: Vector3, p3: Vector3): Vector3 {
    const mid12 = Vector3.scale(Vector3.add(p1, p2, new Vector3()), 0.5, new Vector3());
    const mid23 = Vector3.scale(Vector3.add(p2, p3, new Vector3()), 0.5, new Vector3());

    const dir12 = Vector3.sub(p2, p1, new Vector3());
    const dir23 = Vector3.sub(p3, p2, new Vector3());

    const normal = Vector3.cross(dir12, dir23, new Vector3());

    if (normal.magnitudeSq < 0.0001) {
      return Vector3.scale(
        Vector3.add(Vector3.add(p1, p2, new Vector3()), p3, new Vector3()),
        1.0 / 3.0,
        new Vector3()
      );
    }

    Vector3.normalize(normal, normal);

    const perp12 = Vector3.cross(dir12, normal, new Vector3());
    Vector3.normalize(perp12, perp12);

    const perp23 = Vector3.cross(dir23, normal, new Vector3());
    Vector3.normalize(perp23, perp23);

    const diff = Vector3.sub(mid23, mid12, new Vector3());

    const det = perp12.x * perp23.y - perp12.y * perp23.x;

    if (Math.abs(det) > 0.0001) {
      const t = (diff.x * perp23.y - diff.y * perp23.x) / det;
      const center = Vector3.add(mid12, Vector3.scale(perp12, t, new Vector3()), new Vector3());
      return center;
    }

    return Vector3.scale(
      Vector3.add(Vector3.add(p1, p2, new Vector3()), p3, new Vector3()),
      1.0 / 3.0,
      new Vector3()
    );
  }

  private calculateInertialAcceleration(
    particle: any,
    rotationCenter: Vector3,
    angularVelocity: Vector3,
    particleVelocity: Vector3,
    centrifugalScale: number,
    coriolisScale: number
  ): Vector3 {
    const r = Vector3.sub(particle.position, rotationCenter, new Vector3());

    const omegaCrossR = Vector3.cross(angularVelocity, r, new Vector3());
    const centrifugalAccel = Vector3.cross(angularVelocity, omegaCrossR, new Vector3());
    centrifugalAccel.scaleBy(centrifugalScale);

    const coriolisAccel = Vector3.cross(angularVelocity, particleVelocity, new Vector3());
    coriolisAccel.scaleBy(-2.0 * coriolisScale);

    const totalAccel = Vector3.add(centrifugalAccel, coriolisAccel, new Vector3());
    return totalAccel;
  }

  private solveConstraint(chain: SpringChain, constraint: SpringConstraint): void {
    const pA = chain.particles[constraint.particleA];
    const pB = chain.particles[constraint.particleB];

    const delta = Vector3.sub(pB.position, pA.position, new Vector3());
    const currentLength = delta.magnitude;

    if (currentLength < 0.0001) {
      return;
    }

    const diff = (currentLength - constraint.restLength) / currentLength;
    const correction = Vector3.scale(delta, diff * constraint.stiffness * 0.5, new Vector3());

    if (!pA.fixed) {
      Vector3.add(pA.position, correction, pA.position);
    }
    if (!pB.fixed) {
      Vector3.sub(pB.position, correction, pB.position);
    }
  }

  private solveInterChainConstraint(constraint: InterChainConstraint): void {
    const chainA = this._chains[constraint.chainAIndex];
    const chainB = this._chains[constraint.chainBIndex];
    const pA = chainA.particles[constraint.particleAIndex];
    const pB = chainB.particles[constraint.particleBIndex];

    const delta = Vector3.sub(pB.position, pA.position, new Vector3());
    const currentLength = delta.magnitude;

    if (currentLength < 0.0001) {
      return;
    }

    const diff = (currentLength - constraint.restLength) / currentLength;
    const correction = Vector3.scale(delta, diff * constraint.stiffness * 0.5, new Vector3());

    if (!pA.fixed) {
      Vector3.add(pA.position, correction, pA.position);
    }
    if (!pB.fixed) {
      Vector3.sub(pB.position, correction, pB.position);
    }
  }

  applyToNodes(weight: number = 1.0): void {
    for (const chain of this._chains) {
      this.applyChainToNodes(chain, weight);
    }
  }

  private applyChainToNodes(chain: SpringChain, weight: number): void {
    for (let i = 0; i < chain.particles.length - 1; i++) {
      const particle = chain.particles[i];
      const nextParticle = chain.particles[i + 1];

      if (!particle.node) {
        continue;
      }

      // Get current bone direction from node's world matrix (before physics)
      const currentBonePos = new Vector3(
        particle.node.worldMatrix.m03,
        particle.node.worldMatrix.m13,
        particle.node.worldMatrix.m23
      );

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
      particle.node.worldMatrix.decompose(null, currentBoneRotation, null);

      // Calculate new direction from physics simulation
      const newDir = Vector3.sub(nextParticle.position, particle.position, new Vector3());

      const deltaRotation = new Quaternion();
      IKUtils.fromToRotation(originalDir, newDir, deltaRotation);

      let worldRotation = Quaternion.multiply(deltaRotation, currentBoneRotation, new Quaternion());

      if (weight < 1) {
        Quaternion.slerp(currentBoneRotation, worldRotation, weight, worldRotation);
      }

      const parent = particle.node.parent;
      if (parent) {
        const parentWorldRotation = new Quaternion();
        parent.worldMatrix.decompose(null, parentWorldRotation, null);
        const parentInvRotation = Quaternion.conjugate(parentWorldRotation, new Quaternion());
        const localRotation = Quaternion.multiply(parentInvRotation, worldRotation, new Quaternion());
        particle.node.rotation = localRotation;
      } else {
        particle.node.rotation = worldRotation;
      }
    }
  }

  reset(): void {
    for (const chain of this._chains) {
      chain.reset();
    }
  }

  setGravity(gravity: Vector3): void {
    this._gravity.set(gravity);
  }

  setWind(wind: Vector3): void {
    this._wind.set(wind);
  }

  setIterations(count: number): void {
    this._iterations = Math.max(1, count);
  }

  get chains(): SpringChain[] {
    return this._chains;
  }

  get interChainConstraints(): InterChainConstraint[] {
    return this._interChainConstraints;
  }

  get gravity(): Vector3 {
    return this._gravity;
  }

  get wind(): Vector3 {
    return this._wind;
  }

  get iterations(): number {
    return this._iterations;
  }

  get enableInertialForces(): boolean {
    return this._enableInertialForces;
  }

  setEnableInertialForces(enabled: boolean): void {
    this._enableInertialForces = enabled;
  }

  get centrifugalScale(): number {
    return this._centrifugalScale;
  }

  setCentrifugalScale(scale: number): void {
    this._centrifugalScale = Math.max(0, scale);
  }

  get coriolisScale(): number {
    return this._coriolisScale;
  }

  setCoriolisScale(scale: number): void {
    this._coriolisScale = Math.max(0, scale);
  }
}
