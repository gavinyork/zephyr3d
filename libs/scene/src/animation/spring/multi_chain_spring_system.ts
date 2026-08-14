import { Vector3, Quaternion } from '@zephyr3d/base';
import type { SceneNode } from '../../scene/scene_node';
import type { SpringChain } from './spring_chain';
import type { SpringParticle } from './spring_particle';
import type { SpringConstraint } from './spring_constraint';
import { IKUtils } from '../ik/ik_utils';
import type { SpringCollider } from './spring_collider';
import {
  resolveSphereCollision,
  resolveCapsuleCollision,
  resolvePlaneCollision,
  type CapsuleCollider,
  type PlaneCollider,
  type SphereCollider,
  updateColliderFromNode
} from './spring_collider';
import { SpringNodePoseTracker } from './spring_node_pose_tracker';

export interface InterChainConstraint {
  chainAIndex: number;
  chainBIndex: number;
  particleAIndex: number;
  particleBIndex: number;
  restLength: number;
  stiffness: number;
  compliance: number;
  lambda: number;
}

export interface MultiChainSpringSystemOptions {
  iterations?: number;
  gravity?: Vector3;
  wind?: Vector3;
  enableInertialForces?: boolean;
  centrifugalScale?: number;
  coriolisScale?: number;
  solver?: 'verlet' | 'xpbd';
  poseFollow?: number;
  poseFollowRoot?: number;
  poseFollowTip?: number;
  poseFollowExponent?: number;
  maxPoseOffset?: number;
  maxPoseOffsetRoot?: number;
  maxPoseOffsetTip?: number;
}

/** Options used when rebuilding runtime spring state from the current node pose. */
export interface SpringPoseReinitializeOptions {
  /** Recompute maintained anchor offsets against runtime-remapped anchor nodes. */
  recomputeAnchorOffsets?: boolean;
  /** Recompute structural and inter-chain rest lengths from the current pose. */
  recalculateRestLengths?: boolean;
}

const FIXED_SIMULATION_TIME_STEP = 1 / 60;
const MAX_ACCUMULATED_SIMULATION_TIME = 1 / 20;
const MAX_SIMULATION_STEPS_PER_UPDATE = Math.max(
  1,
  Math.ceil(MAX_ACCUMULATED_SIMULATION_TIME / FIXED_SIMULATION_TIME_STEP)
);
const DEFAULT_PARTICLE_TARGET_SMOOTHING_TIME = 1 / 30;
const DEFAULT_COLLIDER_SMOOTHING_TIME = 1 / 30;

export class MultiChainSpringSystem {
  private _chains: SpringChain[];
  private _interChainConstraints: InterChainConstraint[];
  private _iterations: number;
  private _gravity: Vector3;
  private _wind: Vector3;
  private _enableInertialForces: boolean;
  private _centrifugalScale: number;
  private _coriolisScale: number;
  private _solver: 'verlet' | 'xpbd';
  private _poseFollow: number;
  private _maxPoseOffset: number;
  private _poseFollowRoot: number;
  private _poseFollowTip: number;
  private _poseFollowExponent: number;
  private _maxPoseOffsetRoot: number;
  private _maxPoseOffsetTip: number;
  private _colliders: SpringCollider[];
  private _timeAccumulator: number;
  private _smoothedParticleTargets: WeakMap<object, Vector3>;
  private _smoothedSphereCenters: WeakMap<SphereCollider, Vector3>;
  private _smoothedCapsuleEndpoints: WeakMap<CapsuleCollider, { start: Vector3; end: Vector3 }>;
  private _smoothedPlaneData: WeakMap<PlaneCollider, { point: Vector3; normal: Vector3 }>;
  private _runtimeNodeMap: ReadonlyMap<SceneNode, SceneNode> | null;
  private _runtimeAnchorOffsets: WeakMap<SpringParticle, Vector3>;
  private _runtimeRestLengths: WeakMap<object, number>;
  private _nodePoseTracker: SpringNodePoseTracker;

  constructor(options?: MultiChainSpringSystemOptions) {
    this._chains = [];
    this._interChainConstraints = [];
    this._iterations = options?.iterations ?? 5;
    this._gravity = options?.gravity?.clone() ?? new Vector3(0, -9.8, 0);
    this._wind = options?.wind?.clone() ?? new Vector3(0, 0, 0);
    this._enableInertialForces = options?.enableInertialForces ?? true;
    this._centrifugalScale = options?.centrifugalScale ?? 1.0;
    this._coriolisScale = options?.coriolisScale ?? 1.0;
    this._solver = options?.solver ?? 'verlet';
    this._poseFollow = Math.max(0, Math.min(1, options?.poseFollow ?? 0.35));
    this._maxPoseOffset = Math.max(0, options?.maxPoseOffset ?? 0);
    this._poseFollowRoot = Math.max(0, Math.min(1, options?.poseFollowRoot ?? this._poseFollow));
    this._poseFollowTip = Math.max(0, Math.min(1, options?.poseFollowTip ?? this._poseFollow));
    this._poseFollowExponent = Math.max(0.1, options?.poseFollowExponent ?? 1.6);
    this._maxPoseOffsetRoot = Math.max(0, options?.maxPoseOffsetRoot ?? this._maxPoseOffset);
    this._maxPoseOffsetTip = Math.max(0, options?.maxPoseOffsetTip ?? this._maxPoseOffset);
    this._colliders = [];
    this._timeAccumulator = 0;
    this._smoothedParticleTargets = new WeakMap();
    this._smoothedSphereCenters = new WeakMap();
    this._smoothedCapsuleEndpoints = new WeakMap();
    this._smoothedPlaneData = new WeakMap();
    this._runtimeNodeMap = null;
    this._runtimeAnchorOffsets = new WeakMap();
    this._runtimeRestLengths = new WeakMap();
    this._nodePoseTracker = new SpringNodePoseTracker();
  }

  addChain(chain: SpringChain): number {
    this._chains.push(chain);
    return this._chains.length - 1;
  }

  addInterChainConstraint(constraint: InterChainConstraint): void {
    this._interChainConstraints.push(constraint);
  }

  createRadialConstraints(options: {
    stiffness: number;
    maxDistance: number;
    skipRows?: number;
    connectDistance?: number;
    compliance?: number;
  }): void {
    const skipRows = options.skipRows ?? 0;
    const connectDistance = options.connectDistance ?? 1;
    const compliance = options.compliance ?? 0;

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
              stiffness: options.stiffness,
              compliance,
              lambda: 0
            });
          }
        }
      }
    }
  }

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
      this.simulateStep(FIXED_SIMULATION_TIME_STEP, i === 0 ? frameDt : 0);
    }
  }

  applyToNodes(weight: number = 1.0): void {
    const baseNodeStates = new Map<any, { position: Vector3; rotation: Quaternion }>();
    const desiredWorldRotations = new Map<any, Quaternion>();

    for (const chain of this._chains) {
      this.collectChainNodeRotations(chain, weight, baseNodeStates, desiredWorldRotations);
    }

    const nodes = Array.from(desiredWorldRotations.keys());
    nodes.sort((a, b) => this.getNodeDepth(a) - this.getNodeDepth(b));

    for (const node of nodes) {
      const worldRotation = desiredWorldRotations.get(node);
      if (!worldRotation) {
        continue;
      }
      const parent = node.parent;
      const inputRotation = node.rotation.clone();
      if (parent) {
        const parentWorldRotation = new Quaternion();
        parent.worldMatrix.decompose(null, parentWorldRotation, null);
        const parentInvRotation = Quaternion.conjugate(parentWorldRotation, new Quaternion());
        const localRotation = Quaternion.multiply(parentInvRotation, worldRotation, new Quaternion());
        node.rotation = localRotation;
        this._nodePoseTracker.recordAppliedRotation(node, inputRotation, localRotation);
      } else {
        node.rotation = worldRotation;
        this._nodePoseTracker.recordAppliedRotation(node, inputRotation, worldRotation);
      }
    }
  }

  reset(): void {
    this._nodePoseTracker.clear(true);
    for (const chain of this._chains) {
      chain.reset();
      for (const particle of chain.particles) {
        particle.animPosition.set(particle.originalPosition);
        particle.lastFramePosition.set(particle.originalPosition);
        if (particle.positionHistory) {
          particle.positionHistory.length = 0;
        }
      }
    }
    for (const constraint of this._interChainConstraints) {
      constraint.lambda = 0;
    }
    this._timeAccumulator = 0;
    this._smoothedParticleTargets = new WeakMap();
    this._smoothedSphereCenters = new WeakMap();
    this._smoothedCapsuleEndpoints = new WeakMap();
    this._smoothedPlaneData = new WeakMap();
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

  set gravity(gravity: Vector3) {
    this._gravity.set(gravity);
  }

  get wind(): Vector3 {
    return this._wind;
  }

  set wind(wind: Vector3) {
    this._wind.set(wind);
  }

  get iterations(): number {
    return this._iterations;
  }

  set iterations(count: number) {
    this._iterations = Math.max(1, count);
  }

  get enableInertialForces(): boolean {
    return this._enableInertialForces;
  }

  set enableInertialForces(enabled: boolean) {
    this._enableInertialForces = enabled;
  }

  get centrifugalScale(): number {
    return this._centrifugalScale;
  }

  set centrifugalScale(scale: number) {
    this._centrifugalScale = Math.max(0, scale);
  }

  get coriolisScale(): number {
    return this._coriolisScale;
  }

  set coriolisScale(scale: number) {
    this._coriolisScale = Math.max(0, scale);
  }

  get solver(): 'verlet' | 'xpbd' {
    return this._solver;
  }

  set solver(type: 'verlet' | 'xpbd') {
    if (this._solver !== type) {
      this._solver = type;
      if (type === 'xpbd') {
        this.resetConstraintLambdas();
      }
    }
  }

  get poseFollow(): number {
    return this._poseFollow;
  }

  set poseFollow(value: number) {
    const v = Math.max(0, Math.min(1, value));
    this._poseFollow = v;
    this._poseFollowRoot = v;
    this._poseFollowTip = v;
  }

  get poseFollowRoot(): number {
    return this._poseFollowRoot;
  }

  set poseFollowRoot(value: number) {
    this._poseFollowRoot = Math.max(0, Math.min(1, value));
  }

  get poseFollowTip(): number {
    return this._poseFollowTip;
  }

  set poseFollowTip(value: number) {
    this._poseFollowTip = Math.max(0, Math.min(1, value));
  }

  get poseFollowExponent(): number {
    return this._poseFollowExponent;
  }

  set poseFollowExponent(value: number) {
    this._poseFollowExponent = Math.max(0.1, value);
  }

  get maxPoseOffset(): number {
    return this._maxPoseOffset;
  }

  set maxPoseOffset(value: number) {
    const v = Math.max(0, value);
    this._maxPoseOffset = v;
    this._maxPoseOffsetRoot = v;
    this._maxPoseOffsetTip = v;
  }

  get maxPoseOffsetRoot(): number {
    return this._maxPoseOffsetRoot;
  }

  set maxPoseOffsetRoot(value: number) {
    this._maxPoseOffsetRoot = Math.max(0, value);
  }

  get maxPoseOffsetTip(): number {
    return this._maxPoseOffsetTip;
  }

  set maxPoseOffsetTip(value: number) {
    this._maxPoseOffsetTip = Math.max(0, value);
  }

  addCollider(collider: SpringCollider): void {
    this._colliders.push(collider);
    this._smoothedSphereCenters = new WeakMap();
    this._smoothedCapsuleEndpoints = new WeakMap();
    this._smoothedPlaneData = new WeakMap();
  }

  removeCollider(collider: SpringCollider): boolean {
    const index = this._colliders.indexOf(collider);
    if (index >= 0) {
      this._colliders.splice(index, 1);
      this._smoothedSphereCenters = new WeakMap();
      this._smoothedCapsuleEndpoints = new WeakMap();
      this._smoothedPlaneData = new WeakMap();
      return true;
    }
    return false;
  }

  clearColliders(): void {
    this._colliders = [];
    this._smoothedSphereCenters = new WeakMap();
    this._smoothedCapsuleEndpoints = new WeakMap();
    this._smoothedPlaneData = new WeakMap();
  }

  get colliders(): SpringCollider[] {
    return this._colliders;
  }

  /**
   * Sets a runtime-only node remapping used by particles, anchors and colliders.
   * The authored node references remain unchanged and therefore serialize normally.
   */
  setRuntimeNodeMap(nodeMap: ReadonlyMap<SceneNode, SceneNode> | null): void {
    this._nodePoseTracker.clear(false);
    this._runtimeNodeMap = nodeMap;
    this._runtimeAnchorOffsets = new WeakMap();
    this._runtimeRestLengths = new WeakMap();
    this.clearRuntimeCaches();
  }

  /**
   * Rebuilds particle history from the current runtime-remapped node pose.
   * This must be called after a hierarchy graft or skeleton rebind.
   */
  reinitializeFromCurrentPose(options?: SpringPoseReinitializeOptions): void {
    this._nodePoseTracker.clear(false);
    const recomputeAnchorOffsets = options?.recomputeAnchorOffsets ?? true;
    const recalculateRestLengths = options?.recalculateRestLengths ?? true;
    this._runtimeAnchorOffsets = new WeakMap();
    this._runtimeRestLengths = new WeakMap();

    for (const chain of this._chains) {
      for (const particle of chain.particles) {
        const particleNode = this.resolveRuntimeNode(particle.node);
        let position = particleNode
          ? new Vector3(
              particleNode.worldMatrix.m03,
              particleNode.worldMatrix.m13,
              particleNode.worldMatrix.m23
            )
          : particle.position.clone();
        const anchorNode = this.resolveRuntimeNode(particle.anchorNode);
        if (particle.fixed && anchorNode) {
          let anchorOffset = particle.anchorOffset;
          if (recomputeAnchorOffsets && anchorOffset && particleNode) {
            anchorOffset = anchorNode.worldToThis(position, new Vector3());
            this._runtimeAnchorOffsets.set(particle, anchorOffset);
          }
          position = anchorOffset
            ? anchorNode.worldMatrix.transformPointAffine(anchorOffset, new Vector3())
            : new Vector3(anchorNode.worldMatrix.m03, anchorNode.worldMatrix.m13, anchorNode.worldMatrix.m23);
        }
        particle.position.set(position);
        particle.prevPosition.set(position);
        particle.animPosition.set(position);
        particle.lastFramePosition.set(position);
        if (particle.positionHistory) {
          particle.positionHistory.length = 0;
        }
      }

      for (const constraint of chain.constraints) {
        constraint.lambda = 0;
        if (recalculateRestLengths) {
          this._runtimeRestLengths.set(
            constraint,
            Vector3.distance(
              chain.particles[constraint.particleA].position,
              chain.particles[constraint.particleB].position
            )
          );
        }
      }
    }

    for (const constraint of this._interChainConstraints) {
      constraint.lambda = 0;
      if (recalculateRestLengths) {
        const particleA = this._chains[constraint.chainAIndex]?.particles[constraint.particleAIndex];
        const particleB = this._chains[constraint.chainBIndex]?.particles[constraint.particleBIndex];
        if (particleA && particleB) {
          this._runtimeRestLengths.set(constraint, Vector3.distance(particleA.position, particleB.position));
        }
      }
    }

    for (const collider of this._colliders) {
      const colliderNode = this.resolveRuntimeNode(collider.node);
      if (colliderNode) {
        updateColliderFromNode(collider, colliderNode);
      }
    }
    this.clearRuntimeCaches();
  }

  private simulateStep(dt: number, inputDeltaTime: number): void {
    if (this._enableInertialForces) {
      for (const chain of this._chains) {
        for (const particle of chain.particles) {
          particle.lastFramePosition.set(particle.position);
        }
      }
    }

    this.updateFixedParticles(inputDeltaTime);

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

    if (this._solver === 'xpbd') {
      this.resetConstraintLambdas();
    }

    for (let iter = 0; iter < this._iterations; iter++) {
      for (const chain of this._chains) {
        for (const constraint of chain.constraints) {
          if (this._solver === 'xpbd') {
            this.solveConstraintXPBD(chain, constraint, dt);
          } else {
            this.solveConstraint(chain, constraint);
          }
        }
      }

      for (const constraint of this._interChainConstraints) {
        if (this._solver === 'xpbd') {
          this.solveInterChainConstraintXPBD(constraint, dt);
        } else {
          this.solveInterChainConstraint(constraint);
        }
      }

      this.solvePosePreservation(this._iterations);
      this.solveCollisions(inputDeltaTime);
    }
  }

  private updateFixedParticles(deltaTime: number): void {
    const blend = this.getTemporalBlendFactor(deltaTime, DEFAULT_PARTICLE_TARGET_SMOOTHING_TIME);
    for (const chain of this._chains) {
      for (const particle of chain.particles) {
        const sourceNode = this.resolveRuntimeNode(particle.anchorNode ?? particle.node);
        if (!sourceNode) {
          continue;
        }
        const anchorOffset = this._runtimeAnchorOffsets.get(particle) ?? particle.anchorOffset;
        const worldPos = anchorOffset
          ? sourceNode.worldMatrix.transformPointAffine(anchorOffset)
          : new Vector3(sourceNode.worldMatrix.m03, sourceNode.worldMatrix.m13, sourceNode.worldMatrix.m23);
        const smoothedTarget = this.getSmoothedParticleTarget(particle, worldPos, blend);
        particle.animPosition.set(smoothedTarget);
        if (particle.fixed) {
          particle.position.set(smoothedTarget);
          particle.prevPosition.set(smoothedTarget);
          if (this._enableInertialForces) {
            if (!particle.positionHistory) {
              particle.positionHistory = [];
            }
            particle.positionHistory.push(smoothedTarget.clone());
            if (particle.positionHistory.length > 5) {
              particle.positionHistory.shift();
            }
          }
        }
      }
    }
  }

  private solvePosePreservation(totalIterations: number): void {
    if (this._poseFollowRoot <= 0 && this._poseFollowTip <= 0) {
      return;
    }

    for (const chain of this._chains) {
      const lastIndex = Math.max(1, chain.particles.length - 1);
      for (let i = 0; i < chain.particles.length; i++) {
        const particle = chain.particles[i];
        if (particle.fixed) {
          continue;
        }

        const t = Math.pow(i / lastIndex, this._poseFollowExponent);
        const particlePoseFollow = this.lerp(this._poseFollowRoot, this._poseFollowTip, t);
        const iterationFollow =
          totalIterations > 1
            ? 1 - Math.pow(Math.max(0, 1 - particlePoseFollow), 1 / totalIterations)
            : particlePoseFollow;
        const toAnim = Vector3.sub(particle.animPosition, particle.position, new Vector3());
        const correction = Vector3.scale(toAnim, iterationFollow, new Vector3());
        Vector3.add(particle.position, correction, particle.position);

        const particleMaxPoseOffset = this.lerp(this._maxPoseOffsetRoot, this._maxPoseOffsetTip, t);
        if (particleMaxPoseOffset > 0) {
          const offset = Vector3.sub(particle.position, particle.animPosition, new Vector3());
          const offsetLen = offset.magnitude;
          if (offsetLen > particleMaxPoseOffset && offsetLen > 1e-6) {
            offset.scaleBy(particleMaxPoseOffset / offsetLen);
            Vector3.add(particle.animPosition, offset, particle.position);
          }
        }
      }
    }
  }

  private solveCollisions(deltaTime: number): void {
    const blend = this.getTemporalBlendFactor(deltaTime, DEFAULT_COLLIDER_SMOOTHING_TIME);
    const spheres: SphereCollider[] = [];
    const capsules: CapsuleCollider[] = [];
    const planes: PlaneCollider[] = [];

    for (const collider of this._colliders) {
      const colliderNode = this.resolveRuntimeNode(collider.node);
      if (colliderNode) {
        updateColliderFromNode(collider, colliderNode);
      }
      if (!collider.enabled) {
        continue;
      }
      switch (collider.type) {
        case 'sphere': {
          const source = collider as SphereCollider;
          spheres.push({
            ...source,
            center: this.getSmoothedSphereCenter(source, blend)
          });
          break;
        }
        case 'capsule': {
          const source = collider as CapsuleCollider;
          const endpoints = this.getSmoothedCapsuleEndpoints(source, blend);
          capsules.push({
            ...source,
            start: endpoints.start,
            end: endpoints.end
          });
          break;
        }
        case 'plane': {
          const source = collider as PlaneCollider;
          const plane = this.getSmoothedPlaneData(source, blend);
          planes.push({
            ...source,
            point: plane.point,
            normal: plane.normal
          });
          break;
        }
      }
    }

    for (const chain of this._chains) {
      for (const particle of chain.particles) {
        if (particle.fixed) {
          continue;
        }
        const positionBeforeCollision = particle.position.clone();
        let collided = false;
        for (const collider of spheres) {
          collided = resolveSphereCollision(particle.position, collider) || collided;
        }
        for (const collider of capsules) {
          collided = resolveCapsuleCollision(particle.position, collider) || collided;
        }
        for (const collider of planes) {
          collided = resolvePlaneCollision(particle.position, collider) || collided;
        }
        if (collided) {
          Vector3.add(
            particle.prevPosition,
            Vector3.sub(particle.position, positionBeforeCollision, new Vector3()),
            particle.prevPosition
          );
        }
      }
    }
  }

  private calculateGlobalRotation(dt: number): { center: Vector3; omega: Vector3 } {
    const fixedParticles: any[] = [];
    const velocities: Vector3[] = [];
    const drivenNodes = new Set<SceneNode>();

    for (const chain of this._chains) {
      for (const particle of chain.particles) {
        const node = this.resolveRuntimeNode(particle.node);
        if (node) {
          drivenNodes.add(node);
        }
      }
    }

    for (const chain of this._chains) {
      for (const particle of chain.particles) {
        if (!particle.fixed || !this.isExternalInertialAnchor(particle, drivenNodes)) {
          continue;
        }
        const velocity = Vector3.sub(particle.position, particle.lastFramePosition, new Vector3());
        velocity.scaleBy(1.0 / dt);
        if (velocity.magnitudeSq > 0.001) {
          fixedParticles.push(particle);
          velocities.push(velocity);
        }
      }
    }

    if (fixedParticles.length === 0) {
      return { center: new Vector3(0, 0, 0), omega: new Vector3(0, 0, 0) };
    }

    let center: Vector3;
    if (fixedParticles.length === 1) {
      center = this.estimateRotationCenterFromHistory(fixedParticles[0], velocities[0]);
    } else {
      center = new Vector3(0, 0, 0);
      for (const particle of fixedParticles) {
        Vector3.add(center, particle.position, center);
      }
      center.scaleBy(1.0 / fixedParticles.length);
    }

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
        perpDir.inplaceNormalize();
      }

      return Vector3.add(
        particle.position,
        Vector3.scale(perpDir, estimatedRadius, new Vector3()),
        new Vector3()
      );
    }

    const p1 = history[0];
    const p2 = history[Math.floor(history.length / 2)];
    const p3 = history[history.length - 1];
    return this.calculateCircleCenter(p1, p2, p3);
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

    normal.inplaceNormalize();
    const perp12 = Vector3.cross(dir12, normal, new Vector3()).inplaceNormalize();
    const perp23 = Vector3.cross(dir23, normal, new Vector3()).inplaceNormalize();
    const diff = Vector3.sub(mid23, mid12, new Vector3());
    const det = perp12.x * perp23.y - perp12.y * perp23.x;

    if (Math.abs(det) > 0.0001) {
      const t = (diff.x * perp23.y - diff.y * perp23.x) / det;
      return Vector3.add(mid12, Vector3.scale(perp12, t, new Vector3()), new Vector3());
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
    return Vector3.add(centrifugalAccel, coriolisAccel, new Vector3());
  }

  private solveConstraint(chain: SpringChain, constraint: SpringConstraint): void {
    const pA = chain.particles[constraint.particleA];
    const pB = chain.particles[constraint.particleB];
    const delta = Vector3.sub(pB.position, pA.position, new Vector3());
    const currentLength = delta.magnitude;
    if (currentLength < 0.0001) {
      return;
    }
    const diff = (currentLength - this.getRuntimeRestLength(constraint)) / currentLength;
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
    const diff = (currentLength - this.getRuntimeRestLength(constraint)) / currentLength;
    const correction = Vector3.scale(delta, diff * constraint.stiffness * 0.5, new Vector3());
    if (!pA.fixed) {
      Vector3.add(pA.position, correction, pA.position);
    }
    if (!pB.fixed) {
      Vector3.sub(pB.position, correction, pB.position);
    }
  }

  private solveConstraintXPBD(chain: SpringChain, constraint: SpringConstraint, dt: number): void {
    const pA = chain.particles[constraint.particleA];
    const pB = chain.particles[constraint.particleB];
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
    const C = currentLength - this.getRuntimeRestLength(constraint);
    const alphaTilde = constraint.compliance / (dt * dt);
    const deltaLambda = (-C - alphaTilde * constraint.lambda) / (wSum + alphaTilde);
    constraint.lambda += deltaLambda;
    const n = Vector3.scale(delta, 1.0 / currentLength, new Vector3());
    if (!pA.fixed) {
      Vector3.add(pA.position, Vector3.scale(n, -wA * deltaLambda, new Vector3()), pA.position);
    }
    if (!pB.fixed) {
      Vector3.add(pB.position, Vector3.scale(n, wB * deltaLambda, new Vector3()), pB.position);
    }
  }

  private solveInterChainConstraintXPBD(constraint: InterChainConstraint, dt: number): void {
    const chainA = this._chains[constraint.chainAIndex];
    const chainB = this._chains[constraint.chainBIndex];
    const pA = chainA.particles[constraint.particleAIndex];
    const pB = chainB.particles[constraint.particleBIndex];
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
    const C = currentLength - this.getRuntimeRestLength(constraint);
    const alphaTilde = constraint.compliance / (dt * dt);
    const deltaLambda = (-C - alphaTilde * constraint.lambda) / (wSum + alphaTilde);
    constraint.lambda += deltaLambda;
    const n = Vector3.scale(delta, 1.0 / currentLength, new Vector3());
    if (!pA.fixed) {
      Vector3.add(pA.position, Vector3.scale(n, -wA * deltaLambda, new Vector3()), pA.position);
    }
    if (!pB.fixed) {
      Vector3.add(pB.position, Vector3.scale(n, wB * deltaLambda, new Vector3()), pB.position);
    }
  }

  private collectChainNodeRotations(
    chain: SpringChain,
    weight: number,
    baseNodeStates: Map<any, { position: Vector3; rotation: Quaternion }>,
    desiredWorldRotations: Map<any, Quaternion>
  ): void {
    for (let i = 0; i < chain.particles.length - 1; i++) {
      const particle = chain.particles[i];
      const nextParticle = chain.particles[i + 1];
      const node = this.resolveRuntimeNode(particle.node);
      if (!node) {
        continue;
      }

      const nextNode = this.resolveRuntimeNode(nextParticle.node);
      if (!nextNode) {
        continue;
      }

      let nodeState = baseNodeStates.get(node);
      if (!nodeState) {
        const currentBoneRotation = new Quaternion();
        node.worldMatrix.decompose(null, currentBoneRotation, null);
        nodeState = {
          position: new Vector3(node.worldMatrix.m03, node.worldMatrix.m13, node.worldMatrix.m23),
          rotation: currentBoneRotation
        };
        baseNodeStates.set(node, nodeState);
      }
      let nextNodeState = baseNodeStates.get(nextNode);
      if (!nextNodeState) {
        const nextBoneRotation = new Quaternion();
        nextNode.worldMatrix.decompose(null, nextBoneRotation, null);
        nextNodeState = {
          position: new Vector3(nextNode.worldMatrix.m03, nextNode.worldMatrix.m13, nextNode.worldMatrix.m23),
          rotation: nextBoneRotation
        };
        baseNodeStates.set(nextNode, nextNodeState);
      }

      const originalDir = Vector3.sub(nextNodeState.position, nodeState.position, new Vector3());
      const currentBoneRotation = nodeState.rotation;

      const newDir = Vector3.sub(nextParticle.position, particle.position, new Vector3());
      const deltaRotation = new Quaternion();
      IKUtils.fromToRotation(originalDir, newDir, deltaRotation);
      let worldRotation = Quaternion.multiply(deltaRotation, currentBoneRotation, new Quaternion());

      if (weight < 1) {
        Quaternion.slerp(currentBoneRotation, worldRotation, weight, worldRotation);
      }

      desiredWorldRotations.set(node, worldRotation);
    }
  }

  private getNodeDepth(node: any): number {
    let depth = 0;
    let current = node?.parent;
    while (current) {
      depth++;
      current = current.parent;
    }
    return depth;
  }

  private resetConstraintLambdas(): void {
    for (const chain of this._chains) {
      for (const constraint of chain.constraints) {
        constraint.lambda = 0;
      }
    }
    for (const constraint of this._interChainConstraints) {
      constraint.lambda = 0;
    }
  }

  private resolveRuntimeNode(node: SceneNode | null | undefined): SceneNode | null {
    return node ? (this._runtimeNodeMap?.get(node) ?? node) : null;
  }

  private isExternalInertialAnchor(particle: SpringParticle, drivenNodes: Set<SceneNode>): boolean {
    const particleNode = this.resolveRuntimeNode(particle.node);
    let current = this.resolveRuntimeNode(particle.anchorNode ?? particle.node);
    while (current) {
      if (current !== particleNode && drivenNodes.has(current)) {
        return false;
      }
      current = current.parent;
    }
    return true;
  }

  private getRuntimeRestLength(constraint: SpringConstraint | InterChainConstraint): number {
    return this._runtimeRestLengths.get(constraint) ?? constraint.restLength;
  }

  private clearRuntimeCaches(): void {
    this._timeAccumulator = 0;
    this._smoothedParticleTargets = new WeakMap();
    this._smoothedSphereCenters = new WeakMap();
    this._smoothedCapsuleEndpoints = new WeakMap();
    this._smoothedPlaneData = new WeakMap();
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
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
      const next = { start: currentStart, end: currentEnd };
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
    const currentNormal = collider.normal?.clone() ?? new Vector3(0, 1, 0);
    const cached = this._smoothedPlaneData.get(collider);
    if (!cached || blend >= 1) {
      const next = { point: currentPoint, normal: currentNormal };
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
    cached.normal.inplaceNormalize();
    return cached;
  }
}
