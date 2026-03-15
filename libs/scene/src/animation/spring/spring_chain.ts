import { Vector3, Quaternion } from '@zephyr3d/base';
import type { SceneNode } from '../../scene/scene_node';
import type { SpringParticle } from './spring_particle';
import { createSpringParticle } from './spring_particle';
import type { SpringConstraint } from './spring_constraint';
import { createSpringConstraint } from './spring_constraint';

/**
 * Manages a chain of spring particles and constraints
 */
export class SpringChain {
  /** Array of particles in the chain */
  particles: SpringParticle[];
  /** Array of constraints between particles */
  constraints: SpringConstraint[];

  constructor() {
    this.particles = [];
    this.constraints = [];
  }

  /**
   * Creates a spring chain from a bone hierarchy
   * @param startNode - Root node of the bone chain
   * @param endNode - End node of the bone chain (optional, if null uses all descendants)
   * @param particlesPerBone - Number of particles per bone segment (default: 1)
   * @param options - Additional options
   * @returns A new SpringChain instance
   */
  static fromBoneChain(
    startNode: SceneNode,
    endNode: SceneNode | null = null,
    _particlesPerBone: number = 1,
    options?: {
      mass?: number;
      damping?: number;
      stiffness?: number;
    }
  ): SpringChain {
    const chain = new SpringChain();
    const mass = options?.mass ?? 1.0;
    const damping = options?.damping ?? 0.95;
    const stiffness = options?.stiffness ?? 0.8;

    // Collect nodes from startNode to endNode
    const nodes: SceneNode[] = [];
    let current: SceneNode | null = startNode;

    while (current) {
      nodes.push(current);
      if (current === endNode) {
        break;
      }

      // Follow the first child (assumes single chain)
      // children is DRef<SceneNode>[], so we use .get() to dereference
      if (current.children && current.children.length > 0) {
        current = current.children[0].get();
      } else {
        break;
      }
    }

    // Create particles for each bone
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const worldPos = new Vector3(node.worldMatrix.m03, node.worldMatrix.m13, node.worldMatrix.m23);

      // Get the original world rotation
      const originalRotation = new Quaternion();
      node.worldMatrix.decompose(null, originalRotation, null);

      const particle = createSpringParticle(worldPos, {
        mass,
        damping,
        fixed: i === 0, // First particle is fixed (anchor)
        node,
        originalRotation
      });

      const particleIndex = chain.addParticle(particle);

      // Create constraint with previous particle
      if (i > 0) {
        const prevIndex = particleIndex - 1;
        const prevParticle = chain.particles[prevIndex];
        const restLength = Vector3.distance(particle.position, prevParticle.position);

        chain.addConstraint(createSpringConstraint(prevIndex, particleIndex, restLength, stiffness));
      }
    }

    return chain;
  }

  /**
   * Adds a particle to the chain
   * @param particle - The particle to add
   * @returns The index of the added particle
   */
  addParticle(particle: SpringParticle): number {
    this.particles.push(particle);
    return this.particles.length - 1;
  }

  /**
   * Adds a constraint to the chain
   * @param constraint - The constraint to add
   */
  addConstraint(constraint: SpringConstraint): void {
    this.constraints.push(constraint);
  }

  /**
   * Adds cross constraints between particles for cloth-like behavior
   * @param stiffness - Stiffness of the cross constraints
   * @param skipDistance - Distance between particles to connect (default: 2)
   */
  addCrossConstraints(stiffness: number = 0.6, skipDistance: number = 2): void {
    for (let i = 0; i < this.particles.length - skipDistance; i++) {
      const pA = this.particles[i];
      const pB = this.particles[i + skipDistance];
      const restLength = Vector3.distance(pA.position, pB.position);

      this.addConstraint(createSpringConstraint(i, i + skipDistance, restLength, stiffness));
    }
  }

  /**
   * Merges another spring chain into this one
   * @param other - The chain to merge
   */
  merge(other: SpringChain): void {
    const offset = this.particles.length;

    // Add particles
    for (const particle of other.particles) {
      this.particles.push(particle);
    }

    // Add constraints with adjusted indices
    for (const constraint of other.constraints) {
      this.constraints.push({
        particleA: constraint.particleA + offset,
        particleB: constraint.particleB + offset,
        restLength: constraint.restLength,
        stiffness: constraint.stiffness
      });
    }
  }

  /**
   * Resets all particles to their original positions
   */
  reset(): void {
    for (const particle of this.particles) {
      particle.position.set(particle.originalPosition);
      particle.prevPosition.set(particle.originalPosition);
    }
  }
}
