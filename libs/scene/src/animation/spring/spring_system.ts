import { Vector3, Quaternion } from '@zephyr3d/base';
import type { SpringChain } from './spring_chain';
import type { SpringParticle } from './spring_particle';
import { IKUtils } from '../ik/ik_utils';
import type { SpringCollider } from './spring_collider';
import {
  resolveSphereCollision,
  resolveCapsuleCollision,
  resolvePlaneCollision,
  resolveBoxCollision,
  type CapsuleCollider,
  type BoxCollider,
  type PlaneCollider,
  type SphereCollider,
  updateColliderFromNode
} from './spring_collider';
import { SpringNodePoseTracker } from './spring_node_pose_tracker';
import {
  DEFAULT_INITIAL_COLLISION_PENETRATION_RELEASE_TIME,
  getIterationStrength,
  getKawaiiPoseTarget,
  getReleasedCollisionPenetration,
  getSpringPoseTopology,
  INITIAL_COLLISION_PENETRATION_SLOP,
  interpolateSpringValue,
  measureCollisionPenetration,
  resolveInelasticCollision,
  solveAngleLimit,
  solveDistanceConstraint,
  type SpringMotionModel
} from './spring_solver';

/**
 * Options for creating a SpringSystem
 *
 * @public
 */
export interface SpringSystemOptions {
  /** Integration behavior. `kawaii` preserves animated local shape while simulating (default: `kawaii`). */
  motionModel?: SpringMotionModel;
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
  /**
   * How strongly particles are pulled toward current animated pose [0-1].
   * This preserves the authored hair shape while still allowing secondary motion.
   * Higher values keep the original hairstyle better.
   */
  poseFollow?: number;
  /**
   * Optional root-follow override [0-1].
   * If provided, pose follow is interpolated from root to tip.
   */
  poseFollowRoot?: number;
  /**
   * Optional tip-follow override [0-1].
   * If provided, pose follow is interpolated from root to tip.
   */
  poseFollowTip?: number;
  /**
   * Exponent used when interpolating root-to-tip follow.
   * `1` is linear; values `\> 1` keep the root stiffer and the tip looser.
   */
  poseFollowExponent?: number;
  /**
   * Optional per-step limit for deviation from animated pose.
   * 0 disables clamping. Useful to prevent extreme stretch under high acceleration.
   */
  maxPoseOffset?: number;
  /**
   * Optional root max-offset override.
   * If provided, max offset is interpolated from root to tip.
   */
  maxPoseOffsetRoot?: number;
  /**
   * Optional tip max-offset override.
   * If provided, max offset is interpolated from root to tip.
   */
  maxPoseOffsetTip?: number;
  /** Root angle limit in degrees. 0 disables angle limiting. */
  angleLimitRoot?: number;
  /** Tip angle limit in degrees. 0 disables angle limiting. */
  angleLimitTip?: number;
  /** Fraction of XPBD positional correction retained in Verlet history (default: 0.35). */
  constraintVelocityHistoryRetention?: number;
  /** Temporarily preserve collider overlap present in the initialized pose while blocking deeper penetration. */
  preserveInitialCollisionPenetration?: boolean;
  /** Seconds used to smoothly release preserved startup overlap (default: 0.25). */
  initialCollisionPenetrationReleaseTime?: number;
}

const FIXED_SIMULATION_TIME_STEP = 1 / 60;
const MAX_ACCUMULATED_SIMULATION_TIME = 1 / 20;
const MAX_SIMULATION_STEPS_PER_UPDATE = Math.max(
  1,
  Math.ceil(MAX_ACCUMULATED_SIMULATION_TIME / FIXED_SIMULATION_TIME_STEP)
);
const DEFAULT_PARTICLE_TARGET_SMOOTHING_TIME = 1 / 30;
const DEFAULT_COLLIDER_SMOOTHING_TIME = 1 / 30;

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
  private _poseFollow: number;
  private _maxPoseOffset: number;
  private _poseFollowRoot: number;
  private _poseFollowTip: number;
  private _poseFollowExponent: number;
  private _maxPoseOffsetRoot: number;
  private _maxPoseOffsetTip: number;
  private _timeAccumulator: number;
  private _smoothedParticleTargets: WeakMap<object, Vector3>;
  private _smoothedSphereCenters: WeakMap<SphereCollider, Vector3>;
  private _smoothedCapsuleEndpoints: WeakMap<CapsuleCollider, { start: Vector3; end: Vector3 }>;
  private _smoothedPlaneData: WeakMap<PlaneCollider, { point: Vector3; normal: Vector3 }>;
  private _smoothedBoxData: WeakMap<
    BoxCollider,
    { center: Vector3; halfExtents: Vector3; axes: [Vector3, Vector3, Vector3] }
  >;
  private _nodePoseTracker: SpringNodePoseTracker;
  private _motionModel: SpringMotionModel;
  private _angleLimitRoot: number;
  private _angleLimitTip: number;
  private _constraintVelocityHistoryRetention: number;
  private _preserveInitialCollisionPenetration: boolean;
  private _initialCollisionPenetrationReleaseTime: number;
  private _initialCollisionPenetrationElapsed: number;
  private _initialCollisionPenetration: WeakMap<SpringParticle, WeakMap<SpringCollider, number>>;

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
    this._poseFollow = Math.max(0, Math.min(1, options?.poseFollow ?? 0.35));
    this._maxPoseOffset = Math.max(0, options?.maxPoseOffset ?? 0);
    this._poseFollowRoot = Math.max(0, Math.min(1, options?.poseFollowRoot ?? this._poseFollow));
    this._poseFollowTip = Math.max(0, Math.min(1, options?.poseFollowTip ?? this._poseFollow));
    this._poseFollowExponent = Math.max(0.1, options?.poseFollowExponent ?? 1.6);
    this._maxPoseOffsetRoot = Math.max(0, options?.maxPoseOffsetRoot ?? this._maxPoseOffset);
    this._maxPoseOffsetTip = Math.max(0, options?.maxPoseOffsetTip ?? this._maxPoseOffset);
    this._timeAccumulator = 0;
    this._smoothedParticleTargets = new WeakMap();
    this._smoothedSphereCenters = new WeakMap();
    this._smoothedCapsuleEndpoints = new WeakMap();
    this._smoothedPlaneData = new WeakMap();
    this._smoothedBoxData = new WeakMap();
    this._nodePoseTracker = new SpringNodePoseTracker();
    this._motionModel = options?.motionModel ?? 'kawaii';
    this._angleLimitRoot = Math.max(0, options?.angleLimitRoot ?? 0);
    this._angleLimitTip = Math.max(0, options?.angleLimitTip ?? this._angleLimitRoot);
    this._constraintVelocityHistoryRetention = Math.max(
      0,
      Math.min(1, options?.constraintVelocityHistoryRetention ?? 0.35)
    );
    this._preserveInitialCollisionPenetration =
      options?.preserveInitialCollisionPenetration ?? this._motionModel === 'kawaii';
    this._initialCollisionPenetrationReleaseTime = Math.max(
      0,
      options?.initialCollisionPenetrationReleaseTime ?? DEFAULT_INITIAL_COLLISION_PENETRATION_RELEASE_TIME
    );
    this._initialCollisionPenetrationElapsed = 0;
    this._initialCollisionPenetration = new WeakMap();
  }

  /**
   * Updates the physics simulation
   * @param deltaTime - Time step in seconds
   */
  update(deltaTime: number): void {
    this._nodePoseTracker.restoreInputPose();
    const frameDt = Math.min(Math.max(Number(deltaTime) || 0, 0), MAX_ACCUMULATED_SIMULATION_TIME);
    if (frameDt <= 0) {
      return;
    }
    this._timeAccumulator = Math.min(this._timeAccumulator + frameDt, MAX_ACCUMULATED_SIMULATION_TIME);
    const stepCount = Math.min(
      MAX_SIMULATION_STEPS_PER_UPDATE,
      Math.floor((this._timeAccumulator + 1e-8) / FIXED_SIMULATION_TIME_STEP)
    );
    if (stepCount <= 0) {
      return;
    }
    this._timeAccumulator = Math.max(0, this._timeAccumulator - stepCount * FIXED_SIMULATION_TIME_STEP);
    for (let i = 0; i < stepCount; i++) {
      this.simulateStep(FIXED_SIMULATION_TIME_STEP, i === 0 ? frameDt : 0, i, stepCount);
    }
  }

  private simulateStep(dt: number, inputDeltaTime: number, stepIndex: number, stepCount: number): void {
    // Step 1: Save all particle positions before updating
    if (this._enableInertialForces) {
      for (const p of this._chain.particles) {
        p.lastFramePosition.set(p.position);
      }
    }

    // Step 2: Update fixed particles from their scene nodes
    const substepBlend = 1 / Math.max(1, stepCount - stepIndex);
    this.updateFixedParticles(inputDeltaTime, substepBlend);

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
    if (this._motionModel === 'kawaii') {
      this.solvePosePreservation(1, true);
    }
    for (let iter = 0; iter < this._iterations; iter++) {
      const reverse = this._motionModel === 'kawaii' && !!(iter & 1);
      for (let constraintIndex = 0; constraintIndex < this._chain.constraints.length; constraintIndex++) {
        const constraint =
          this._chain.constraints[
            reverse ? this._chain.constraints.length - 1 - constraintIndex : constraintIndex
          ];
        if (this._solver === 'xpbd') {
          this.solveConstraintXPBD(constraint, dt);
        } else {
          this.solveConstraint(constraint);
        }
      }

      // Pull particles back toward the animated pose to preserve hair silhouette.
      // Normalize follow strength across solver iterations so tuning stays intuitive.
      if (this._motionModel === 'legacy') {
        this.solvePosePreservation(this._iterations, false);
      }

      if (this._motionModel === 'legacy') {
        this.solveCollisions(inputDeltaTime);
      }
    }
    if (this._motionModel === 'kawaii') {
      this.solveCollisions(inputDeltaTime, substepBlend);
      this.solveAngleLimits();
      if (this._solver === 'xpbd') {
        this.solveCollisions(0, 0);
        for (const constraint of this._chain.constraints) {
          constraint.lambda = 0;
        }
        const closureIterations = Math.min(16, Math.max(4, this._iterations));
        for (let iteration = 0; iteration < closureIterations; iteration++) {
          const reverse = !!(iteration & 1);
          for (let constraintIndex = 0; constraintIndex < this._chain.constraints.length; constraintIndex++) {
            const constraint =
              this._chain.constraints[
                reverse ? this._chain.constraints.length - 1 - constraintIndex : constraintIndex
              ];
            this.solveConstraintXPBD(constraint, dt);
          }
        }
        if (this._colliders.some((collider) => collider.enabled)) {
          for (const constraint of this._chain.constraints) {
            constraint.lambda = 0;
          }
          const contactClosureIterations = Math.min(4, closureIterations);
          for (let iteration = 0; iteration < contactClosureIterations; iteration++) {
            const reverse = !!(iteration & 1);
            for (
              let constraintIndex = 0;
              constraintIndex < this._chain.constraints.length;
              constraintIndex++
            ) {
              const constraint =
                this._chain.constraints[
                  reverse ? this._chain.constraints.length - 1 - constraintIndex : constraintIndex
                ];
              this.solveConstraintXPBD(constraint, dt);
            }
            this.solveCollisions(0, 0);
          }
        }
      } else {
        for (const constraint of this._chain.constraints) {
          this.solveConstraint(constraint);
        }
        this.solveCollisions(0, 0);
      }
    }
    this.advanceInitialCollisionPenetrationRelease(dt);
  }

  /**
   * Updates fixed particles to match their scene node positions
   */
  private updateFixedParticles(deltaTime: number, substepBlend: number): void {
    const blend =
      this._motionModel === 'kawaii'
        ? substepBlend
        : this.getTemporalBlendFactor(deltaTime, DEFAULT_PARTICLE_TARGET_SMOOTHING_TIME);
    for (const particle of this._chain.particles) {
      const sourceNode = particle.anchorNode ?? particle.node;
      if (!sourceNode) {
        continue;
      }
      const worldPos = particle.anchorOffset
        ? sourceNode.worldMatrix.transformPointAffine(particle.anchorOffset)
        : new Vector3(sourceNode.worldMatrix.m03, sourceNode.worldMatrix.m13, sourceNode.worldMatrix.m23);
      const smoothedTarget = this.getSmoothedParticleTarget(particle, worldPos, blend);
      particle.animPosition.set(smoothedTarget);
      if (particle.fixed) {
        particle.position.set(smoothedTarget);
        particle.prevPosition.set(smoothedTarget);

        // Maintain position history for rotation center estimation
        if (this._enableInertialForces) {
          if (!particle.positionHistory) {
            particle.positionHistory = [];
          }
          particle.positionHistory.push(smoothedTarget.clone());
          // Keep only last 5 frames
          if (particle.positionHistory.length > 5) {
            particle.positionHistory.shift();
          }
        }
      }
    }
  }

  /**
   * Solves pose preservation (long-range attachment to animated pose).
   * This keeps strands close to authored shape while preserving dynamic movement.
   */
  private solvePosePreservation(totalIterations: number, parentRelative: boolean): void {
    if (this._poseFollowRoot <= 0 && this._poseFollowTip <= 0) {
      return;
    }

    const topology = getSpringPoseTopology(this._chain.particles);
    for (let i = 0; i < this._chain.particles.length; i++) {
      const particle = this._chain.particles[i];
      if (particle.fixed) {
        continue;
      }

      const t = Math.pow(topology[i].normalizedDistance, this._poseFollowExponent);
      const particlePoseFollow = this.lerp(this._poseFollowRoot, this._poseFollowTip, t);
      // Convert user-facing per-frame follow into per-iteration follow:
      // effective = 1 - (1 - follow)^iterations
      const iterationFollow = getIterationStrength(particlePoseFollow, totalIterations);
      const poseTarget = parentRelative ? getKawaiiPoseTarget(particle, topology[i]) : particle.animPosition;
      const toAnim = Vector3.sub(poseTarget, particle.position, new Vector3());
      const correction = Vector3.scale(toAnim, iterationFollow, new Vector3());
      Vector3.add(particle.position, correction, particle.position);

      const particleMaxPoseOffset = this.lerp(this._maxPoseOffsetRoot, this._maxPoseOffsetTip, t);
      if (particleMaxPoseOffset > 0) {
        const offset = Vector3.sub(particle.position, poseTarget, new Vector3());
        const offsetLen = offset.magnitude;
        if (offsetLen > particleMaxPoseOffset && offsetLen > 1e-6) {
          offset.scaleBy(particleMaxPoseOffset / offsetLen);
          Vector3.add(poseTarget, offset, particle.position);
        }
      }
    }
  }

  private solveAngleLimits(): void {
    if (this._angleLimitRoot <= 0 && this._angleLimitTip <= 0) {
      return;
    }
    const particles = this._chain.particles;
    for (let i = 1; i < particles.length; i++) {
      const limit = interpolateSpringValue(
        this._angleLimitRoot,
        this._angleLimitTip,
        this._poseFollowExponent,
        i,
        particles.length
      );
      solveAngleLimit(particles[i - 1], particles[i], limit, this._solver === 'xpbd');
    }
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
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

    // Scaled compliance: alphaTilde = compliance / dt^2
    const alphaTilde = constraint.compliance / (dt * dt);

    // XPBD Lagrange multiplier update
    const deltaLambda = (-C - alphaTilde * constraint.lambda) / (wSum + alphaTilde);
    constraint.lambda += deltaLambda;

    // Correction direction (unit vector from A to B)
    const n = Vector3.scale(delta, 1.0 / currentLength, new Vector3());

    if (!pA.fixed) {
      // deltaX_a = -w_a * deltaLambda * n
      const correction = Vector3.scale(n, -wA * deltaLambda, new Vector3());
      Vector3.add(pA.position, correction, pA.position);
      if (this._motionModel === 'kawaii') {
        Vector3.add(
          pA.prevPosition,
          Vector3.scale(correction, this._constraintVelocityHistoryRetention, new Vector3()),
          pA.prevPosition
        );
      }
    }
    if (!pB.fixed) {
      // deltaX_b = +w_b * deltaLambda * n
      const correction = Vector3.scale(n, wB * deltaLambda, new Vector3());
      Vector3.add(pB.position, correction, pB.position);
      if (this._motionModel === 'kawaii') {
        Vector3.add(
          pB.prevPosition,
          Vector3.scale(correction, this._constraintVelocityHistoryRetention, new Vector3()),
          pB.prevPosition
        );
      }
    }
  }

  /**
   * Solves a single spring constraint (Verlet / PBD)
   */
  private solveConstraint(constraint: any): void {
    const pA = this._chain.particles[constraint.particleA];
    const pB = this._chain.particles[constraint.particleB];

    if (this._motionModel === 'kawaii') {
      solveDistanceConstraint(pA, pB, constraint.restLength, constraint.stiffness);
      return;
    }

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
  private solveCollisions(deltaTime: number, blendOverride?: number): void {
    // Update dynamic colliders from their nodes
    const blend = blendOverride ?? this.getTemporalBlendFactor(deltaTime, DEFAULT_COLLIDER_SMOOTHING_TIME);
    const spheres: { particleCollider: SphereCollider; collider: SphereCollider }[] = [];
    const capsules: { particleCollider: CapsuleCollider; collider: CapsuleCollider }[] = [];
    const planes: { particleCollider: PlaneCollider; collider: PlaneCollider }[] = [];
    const boxes: { particleCollider: BoxCollider; collider: BoxCollider }[] = [];
    for (const collider of this._colliders) {
      if (collider.node) {
        updateColliderFromNode(collider);
      }
      if (!collider.enabled) {
        continue;
      }
      switch (collider.type) {
        case 'sphere': {
          const source = collider as SphereCollider;
          spheres.push({
            particleCollider: source,
            collider: {
              ...source,
              center: this.getSmoothedSphereCenter(source, blend)
            }
          });
          break;
        }
        case 'capsule': {
          const source = collider as CapsuleCollider;
          const endpoints = this.getSmoothedCapsuleEndpoints(source, blend);
          capsules.push({
            particleCollider: source,
            collider: {
              ...source,
              start: endpoints.start,
              end: endpoints.end
            }
          });
          break;
        }
        case 'plane': {
          const source = collider as PlaneCollider;
          const plane = this.getSmoothedPlaneData(source, blend);
          planes.push({
            particleCollider: source,
            collider: {
              ...source,
              point: plane.point,
              normal: plane.normal
            }
          });
          break;
        }
        case 'box': {
          const source = collider as BoxCollider;
          boxes.push({
            particleCollider: source,
            collider: { ...source, ...this.getSmoothedBoxData(source, blend) }
          });
          break;
        }
      }
    }

    // Check each particle against all colliders
    for (const particle of this._chain.particles) {
      if (particle.fixed) {
        continue; // Skip fixed particles
      }

      for (const collider of spheres) {
        if (this._motionModel === 'kawaii') {
          resolveInelasticCollision(
            particle,
            collider.collider,
            resolveSphereCollision,
            this.getInitialCollisionPenetration(
              particle,
              collider.particleCollider,
              collider.collider,
              resolveSphereCollision
            )
          );
        } else {
          resolveSphereCollision(particle.position, collider.collider, particle.collisionRadius);
        }
      }
      for (const collider of capsules) {
        if (this._motionModel === 'kawaii') {
          resolveInelasticCollision(
            particle,
            collider.collider,
            resolveCapsuleCollision,
            this.getInitialCollisionPenetration(
              particle,
              collider.particleCollider,
              collider.collider,
              resolveCapsuleCollision
            )
          );
        } else {
          resolveCapsuleCollision(particle.position, collider.collider, particle.collisionRadius);
        }
      }
      for (const collider of planes) {
        if (this._motionModel === 'kawaii') {
          resolveInelasticCollision(
            particle,
            collider.collider,
            resolvePlaneCollision,
            this.getInitialCollisionPenetration(
              particle,
              collider.particleCollider,
              collider.collider,
              resolvePlaneCollision
            )
          );
        } else {
          resolvePlaneCollision(particle.position, collider.collider, particle.collisionRadius);
        }
      }
      for (const collider of boxes) {
        if (this._motionModel === 'kawaii') {
          resolveInelasticCollision(
            particle,
            collider.collider,
            resolveBoxCollision,
            this.getInitialCollisionPenetration(
              particle,
              collider.particleCollider,
              collider.collider,
              resolveBoxCollision
            )
          );
        } else {
          resolveBoxCollision(particle.position, collider.collider, particle.collisionRadius);
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
      const inputRotation = node.rotation.clone();
      if (parent) {
        const parentWorldRotation = new Quaternion();
        parent.worldMatrix.decompose(null, parentWorldRotation, null);

        // localRotation = conjugate(parentWorldRotation) * worldRotation
        const parentInvRotation = Quaternion.conjugate(parentWorldRotation, new Quaternion());
        const localRotation = Quaternion.multiply(parentInvRotation, worldRotation, new Quaternion());

        node.rotation = localRotation;
        this._nodePoseTracker.recordAppliedRotation(node, inputRotation, localRotation);
      } else {
        // Root node has no parent, world rotation is local rotation
        node.rotation = worldRotation;
        this._nodePoseTracker.recordAppliedRotation(node, inputRotation, worldRotation);
      }
    }
  }

  /**
   * Resets the simulation to initial state
   */
  reset(): void {
    this._nodePoseTracker.clear(true);
    this._chain.reset();
    for (const particle of this._chain.particles) {
      particle.animPosition.set(particle.originalPosition);
      particle.lastFramePosition.set(particle.originalPosition);
      if (particle.positionHistory) {
        particle.positionHistory.length = 0;
      }
    }
    this._timeAccumulator = 0;
    this._smoothedParticleTargets = new WeakMap();
    this._smoothedSphereCenters = new WeakMap();
    this._smoothedCapsuleEndpoints = new WeakMap();
    this._smoothedPlaneData = new WeakMap();
    this._smoothedBoxData = new WeakMap();
    this._initialCollisionPenetrationElapsed = 0;
    this._initialCollisionPenetration = new WeakMap();
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

  set coriolisScale(scale: number) {
    this._coriolisScale = Math.max(0, scale);
  }

  /**
   * Gets the constraint solver type
   */
  get solver(): 'verlet' | 'xpbd' {
    return this._solver;
  }

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

  get motionModel(): SpringMotionModel {
    return this._motionModel;
  }

  set motionModel(value: SpringMotionModel) {
    if (value !== 'legacy' && value !== 'kawaii') {
      return;
    }
    if (this._motionModel !== value) {
      this._motionModel = value;
      this.reset();
    }
  }

  get angleLimitRoot(): number {
    return this._angleLimitRoot;
  }

  set angleLimitRoot(value: number) {
    this._angleLimitRoot = Math.max(0, Number(value) || 0);
  }

  get angleLimitTip(): number {
    return this._angleLimitTip;
  }

  set angleLimitTip(value: number) {
    this._angleLimitTip = Math.max(0, Number(value) || 0);
  }

  get constraintVelocityHistoryRetention(): number {
    return this._constraintVelocityHistoryRetention;
  }

  set constraintVelocityHistoryRetention(value: number) {
    this._constraintVelocityHistoryRetention = Math.max(0, Math.min(1, Number(value) || 0));
  }

  get preserveInitialCollisionPenetration(): boolean {
    return this._preserveInitialCollisionPenetration;
  }

  set preserveInitialCollisionPenetration(value: boolean) {
    if (this._preserveInitialCollisionPenetration !== value) {
      this._preserveInitialCollisionPenetration = value;
      this._initialCollisionPenetrationElapsed = 0;
      this._initialCollisionPenetration = new WeakMap();
    }
  }

  get initialCollisionPenetrationReleaseTime(): number {
    return this._initialCollisionPenetrationReleaseTime;
  }

  set initialCollisionPenetrationReleaseTime(value: number) {
    const duration = Math.max(0, Number(value) || 0);
    if (this._initialCollisionPenetrationReleaseTime !== duration) {
      this._initialCollisionPenetrationReleaseTime = duration;
      this._initialCollisionPenetrationElapsed = 0;
      this._initialCollisionPenetration = new WeakMap();
    }
  }

  /**
   * Gets pose preservation strength [0-1]
   */
  get poseFollow(): number {
    return this._poseFollow;
  }

  set poseFollow(value: number) {
    const v = Math.max(0, Math.min(1, value));
    this._poseFollow = v;
    this._poseFollowRoot = v;
    this._poseFollowTip = v;
  }

  /**
   * Gets max allowed deviation from animated pose
   */
  get maxPoseOffset(): number {
    return this._maxPoseOffset;
  }

  set maxPoseOffset(value: number) {
    const v = Math.max(0, value);
    this._maxPoseOffset = v;
    this._maxPoseOffsetRoot = v;
    this._maxPoseOffsetTip = v;
  }

  /**
   * Gets root pose follow strength [0-1]
   */
  get poseFollowRoot(): number {
    return this._poseFollowRoot;
  }

  set poseFollowRoot(value: number) {
    this._poseFollowRoot = Math.max(0, Math.min(1, value));
  }

  /**
   * Gets tip pose follow strength [0-1]
   */
  get poseFollowTip(): number {
    return this._poseFollowTip;
  }

  set poseFollowTip(value: number) {
    this._poseFollowTip = Math.max(0, Math.min(1, value));
  }

  /**
   * Gets exponent for root-to-tip interpolation
   */
  get poseFollowExponent(): number {
    return this._poseFollowExponent;
  }

  set poseFollowExponent(value: number) {
    this._poseFollowExponent = Math.max(0.1, value);
  }

  /**
   * Gets root max allowed deviation from animated pose
   */
  get maxPoseOffsetRoot(): number {
    return this._maxPoseOffsetRoot;
  }

  set maxPoseOffsetRoot(value: number) {
    this._maxPoseOffsetRoot = Math.max(0, value);
  }

  /**
   * Gets tip max allowed deviation from animated pose
   */
  get maxPoseOffsetTip(): number {
    return this._maxPoseOffsetTip;
  }

  set maxPoseOffsetTip(value: number) {
    this._maxPoseOffsetTip = Math.max(0, value);
  }

  /**
   * Adds a collider to the system
   */
  addCollider(collider: SpringCollider): void {
    this._colliders.push(collider);
    this._smoothedSphereCenters = new WeakMap();
    this._smoothedCapsuleEndpoints = new WeakMap();
    this._smoothedPlaneData = new WeakMap();
    this._smoothedBoxData = new WeakMap();
    this._initialCollisionPenetrationElapsed = 0;
    this._initialCollisionPenetration = new WeakMap();
  }

  /**
   * Removes a collider from the system
   */
  removeCollider(collider: SpringCollider): boolean {
    const index = this._colliders.indexOf(collider);
    if (index >= 0) {
      this._colliders.splice(index, 1);
      this._smoothedSphereCenters = new WeakMap();
      this._smoothedCapsuleEndpoints = new WeakMap();
      this._smoothedPlaneData = new WeakMap();
      this._smoothedBoxData = new WeakMap();
      this._initialCollisionPenetrationElapsed = 0;
      this._initialCollisionPenetration = new WeakMap();
      return true;
    }
    return false;
  }

  /**
   * Clears all colliders
   */
  clearColliders(): void {
    this._colliders = [];
    this._smoothedSphereCenters = new WeakMap();
    this._smoothedCapsuleEndpoints = new WeakMap();
    this._smoothedPlaneData = new WeakMap();
    this._smoothedBoxData = new WeakMap();
    this._initialCollisionPenetrationElapsed = 0;
    this._initialCollisionPenetration = new WeakMap();
  }

  /**
   * Gets all colliders
   */
  get colliders(): SpringCollider[] {
    return this._colliders;
  }

  private getInitialCollisionPenetration<TCollider extends SpringCollider>(
    particle: SpringParticle,
    sourceCollider: SpringCollider,
    collider: TCollider,
    resolveCollision: (position: Vector3, collider: TCollider) => boolean
  ): number {
    if (!this._preserveInitialCollisionPenetration) {
      return 0;
    }
    let particlePenetrations = this._initialCollisionPenetration.get(particle);
    if (!particlePenetrations) {
      particlePenetrations = new WeakMap();
      this._initialCollisionPenetration.set(particle, particlePenetrations);
    }
    let penetration = particlePenetrations.get(sourceCollider);
    if (penetration === undefined) {
      penetration =
        measureCollisionPenetration(
          particle.animPosition,
          collider,
          resolveCollision,
          particle.collisionRadius
        ) + INITIAL_COLLISION_PENETRATION_SLOP;
      particlePenetrations.set(sourceCollider, penetration);
    }
    return getReleasedCollisionPenetration(
      penetration,
      this._initialCollisionPenetrationElapsed,
      this._initialCollisionPenetrationReleaseTime
    );
  }

  private advanceInitialCollisionPenetrationRelease(deltaTime: number): void {
    if (!this._preserveInitialCollisionPenetration) {
      return;
    }
    this._initialCollisionPenetrationElapsed = Math.min(
      this._initialCollisionPenetrationReleaseTime,
      this._initialCollisionPenetrationElapsed + Math.max(0, deltaTime)
    );
  }

  private getTemporalBlendFactor(deltaTime: number, smoothingTime: number): number {
    const dt = Math.min(Math.max(Number(deltaTime) || 0, 0), MAX_ACCUMULATED_SIMULATION_TIME);
    if (smoothingTime <= 0) {
      return 1;
    }
    if (dt <= 0) {
      return 0;
    }
    return 1 - Math.exp(-dt / smoothingTime);
  }

  private getSmoothedParticleTarget(target: object, current: Vector3, blend: number): Vector3 {
    const cached = this._smoothedParticleTargets.get(target);
    if (!cached || blend >= 1) {
      const next = current.clone();
      this._smoothedParticleTargets.set(target, next);
      return next;
    }
    cached.setXYZ(
      cached.x + (current.x - cached.x) * blend,
      cached.y + (current.y - cached.y) * blend,
      cached.z + (current.z - cached.z) * blend
    );
    return cached;
  }

  private getSmoothedSphereCenter(collider: SphereCollider, blend: number): Vector3 {
    const current = collider.center?.clone() ?? new Vector3();
    const cached = this._smoothedSphereCenters.get(collider);
    if (!cached || blend >= 1) {
      this._smoothedSphereCenters.set(collider, current);
      return current;
    }
    cached.setXYZ(
      cached.x + (current.x - cached.x) * blend,
      cached.y + (current.y - cached.y) * blend,
      cached.z + (current.z - cached.z) * blend
    );
    return cached;
  }

  private getSmoothedCapsuleEndpoints(
    collider: CapsuleCollider,
    blend: number
  ): { start: Vector3; end: Vector3 } {
    const currentStart = collider.start?.clone() ?? new Vector3();
    const currentEnd = collider.end?.clone() ?? new Vector3();
    const cached = this._smoothedCapsuleEndpoints.get(collider);
    if (!cached || blend >= 1) {
      const next = {
        start: currentStart,
        end: currentEnd
      };
      this._smoothedCapsuleEndpoints.set(collider, next);
      return next;
    }
    cached.start.setXYZ(
      cached.start.x + (currentStart.x - cached.start.x) * blend,
      cached.start.y + (currentStart.y - cached.start.y) * blend,
      cached.start.z + (currentStart.z - cached.start.z) * blend
    );
    cached.end.setXYZ(
      cached.end.x + (currentEnd.x - cached.end.x) * blend,
      cached.end.y + (currentEnd.y - cached.end.y) * blend,
      cached.end.z + (currentEnd.z - cached.end.z) * blend
    );
    return cached;
  }

  private getSmoothedPlaneData(collider: PlaneCollider, blend: number): { point: Vector3; normal: Vector3 } {
    const currentPoint = collider.point?.clone() ?? new Vector3();
    const currentNormal = collider.normal?.clone() ?? Vector3.axisPY();
    if (currentNormal.magnitudeSq > 1e-8) {
      currentNormal.inplaceNormalize();
    } else {
      currentNormal.setXYZ(0, 1, 0);
    }
    const cached = this._smoothedPlaneData.get(collider);
    if (!cached || blend >= 1) {
      const next = {
        point: currentPoint,
        normal: currentNormal
      };
      this._smoothedPlaneData.set(collider, next);
      return next;
    }
    cached.point.setXYZ(
      cached.point.x + (currentPoint.x - cached.point.x) * blend,
      cached.point.y + (currentPoint.y - cached.point.y) * blend,
      cached.point.z + (currentPoint.z - cached.point.z) * blend
    );
    cached.normal.setXYZ(
      cached.normal.x + (currentNormal.x - cached.normal.x) * blend,
      cached.normal.y + (currentNormal.y - cached.normal.y) * blend,
      cached.normal.z + (currentNormal.z - cached.normal.z) * blend
    );
    if (cached.normal.magnitudeSq > 1e-8) {
      cached.normal.inplaceNormalize();
    } else {
      cached.normal.setXYZ(0, 1, 0);
    }
    return cached;
  }

  private getSmoothedBoxData(
    collider: BoxCollider,
    blend: number
  ): { center: Vector3; halfExtents: Vector3; axes: [Vector3, Vector3, Vector3] } {
    const current = {
      center: collider.center.clone(),
      halfExtents: collider.halfExtents.clone(),
      axes: collider.axes.map((axis) => axis.clone()) as [Vector3, Vector3, Vector3]
    };
    const cached = this._smoothedBoxData.get(collider);
    if (!cached || blend >= 1) {
      this._smoothedBoxData.set(collider, current);
      return current;
    }
    Vector3.lerp(cached.center, current.center, blend, cached.center);
    Vector3.lerp(cached.halfExtents, current.halfExtents, blend, cached.halfExtents);
    for (let i = 0; i < 3; i++) {
      Vector3.lerp(cached.axes[i], current.axes[i], blend, cached.axes[i]);
      cached.axes[i].inplaceNormalize();
    }
    return cached;
  }
}
