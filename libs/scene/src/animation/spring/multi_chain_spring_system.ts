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

  constructor(options?: MultiChainSpringSystemOptions) {
    this._chains = [];
    this._interChainConstraints = [];
    this._iterations = options?.iterations ?? 5;
    this._gravity = options?.gravity?.clone() ?? new Vector3(0, -9.8, 0);
    this._wind = options?.wind?.clone() ?? new Vector3(0, 0, 0);
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
    this.updateFixedParticles();

    for (const chain of this._chains) {
      for (const particle of chain.particles) {
        if (particle.fixed) {
          continue;
        }

        const velocity = Vector3.sub(particle.position, particle.prevPosition, new Vector3());
        velocity.scaleBy(particle.damping);

        const acceleration = Vector3.add(this._gravity, this._wind, new Vector3());
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
        }
      }
    }
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

      if (!particle.node || !particle.originalRotation) {
        continue;
      }

      const originalDir = Vector3.sub(
        nextParticle.originalPosition,
        particle.originalPosition,
        new Vector3()
      );
      const newDir = Vector3.sub(nextParticle.position, particle.position, new Vector3());

      const deltaRotation = new Quaternion();
      IKUtils.fromToRotation(originalDir, newDir, deltaRotation);

      let worldRotation = Quaternion.multiply(deltaRotation, particle.originalRotation, new Quaternion());

      if (weight < 1) {
        Quaternion.slerp(particle.originalRotation, worldRotation, weight, worldRotation);
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
}
