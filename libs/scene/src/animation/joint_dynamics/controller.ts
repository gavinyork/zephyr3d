// High-level orchestrator - SPCRJointDynamicsController API

import {
  EPSILON,
  type PointR,
  type PointRW,
  type Constraint,
  type ColliderR,
  type ColliderRW,
  type GrabberR,
  type GrabberRW,
  type AngleLimitConfig,
  type FlatPlane,
  type TransformAccess,
  type BoneNode
} from './types';
import { buildConstraints, buildSurfaceFaces, type ConstraintBuildOptions } from './constraints';
import { simulate, applyResult, applyAngleLimits, type SimulationParams } from './solver';
import type { InterpolatorScalar } from '@zephyr3d/base';
import { Vector3, Quaternion, Matrix4x4, clamp01 } from '@zephyr3d/base';

/**
 * Depth-based physics parameter curves.
 * Each curve is evaluated with t = pointDepth / maxDepth (0 at root, 1 at tip).
 * This allows parameters to vary smoothly along the bone chain.
 */
export interface PhysicsCurves {
  /** Scales point mass by depth */
  massScale: InterpolatorScalar;
  /** Scales gravity strength by depth */
  gravityScale: InterpolatorScalar;
  /** Scales wind force effect by depth (also multiplied by depth rate) */
  windForceScale: InterpolatorScalar;
  /** Velocity damping [0-1]. Higher = less damping. Controls how much velocity is preserved */
  resistance: InterpolatorScalar;
  /** Restore-to-animation stiffness [0-1]. Higher = bone stays closer to animated pose */
  hardness: InterpolatorScalar;
  /** Friction multiplier by depth. Scales collision friction accumulation */
  friction: InterpolatorScalar;
  /** Collision radius by depth, mapped from VRM SpringBone hitRadius when available */
  pointRadius: InterpolatorScalar;
  /** Extra slack length for horizontal/shear constraints (allows stretching) */
  sliderJointLength: InterpolatorScalar;
  /** Global shrink stiffness multiplier (applied to all constraint types) */
  allShrinkScale: InterpolatorScalar;
  /** Global stretch stiffness multiplier (applied to all constraint types) */
  allStretchScale: InterpolatorScalar;
  /** Structural vertical constraint shrink stiffness by depth */
  structuralShrinkVertical: InterpolatorScalar;
  /** Structural vertical constraint stretch stiffness by depth */
  structuralStretchVertical: InterpolatorScalar;
  /** Structural horizontal constraint shrink stiffness by depth */
  structuralShrinkHorizontal: InterpolatorScalar;
  /** Structural horizontal constraint stretch stiffness by depth */
  structuralStretchHorizontal: InterpolatorScalar;
  /** Shear constraint shrink stiffness by depth */
  shearShrink: InterpolatorScalar;
  /** Shear constraint stretch stiffness by depth */
  shearStretch: InterpolatorScalar;
  /** Bending vertical constraint shrink stiffness by depth */
  bendingShrinkVertical: InterpolatorScalar;
  /** Bending vertical constraint stretch stiffness by depth */
  bendingStretchVertical: InterpolatorScalar;
  /** Bending horizontal constraint shrink stiffness by depth */
  bendingShrinkHorizontal: InterpolatorScalar;
  /** Bending horizontal constraint stretch stiffness by depth */
  bendingStretchHorizontal: InterpolatorScalar;
  /** Fake wave amplitude by depth (sinusoidal pseudo-wind on leaf bones) */
  fakeWavePower: InterpolatorScalar;
  /** Fake wave frequency offset by depth */
  fakeWaveFreq: InterpolatorScalar;
}

/** Top-level configuration for the physics controller */
export interface ControllerConfig {
  /** Global gravity vector (e.g. {x:0, y:-9.8, z:0}) */
  gravity: Vector3;
  /** Global wind force vector applied to all dynamic points */
  windForce: Vector3;
  /** Number of constraint relaxation iterations per substep. Higher = more stable but slower */
  relaxation: number;
  /** Number of simulation substeps per frame. Higher = more stable at cost of performance */
  subSteps: number;
  /** Max root bone slide distance per substep. Excess is distributed as offset. -1 = unlimited */
  rootSlideLimit: number;
  /** Max root bone rotation angle (degrees) per substep. Excess is distributed. -1 = unlimited */
  rootRotateLimit: number;
  /** Upper limit for horizontal/shear constraint shrink power. Prevents over-compression */
  constraintShrinkLimit: number;
  /** Global blend ratio between physics and animation [0-1]. 0 = full physics, 1 = full animation */
  blendRatio: number;
  /** Target frame rate for stabilization (currently unused, reserved) */
  stabilizationFrameRate: number;
  /** Enable sinusoidal fake wave effect on leaf bones */
  isFakeWave: boolean;
  /** Fake wave global speed (accumulates over time) */
  fakeWaveSpeed: number;
  /** Fake wave global amplitude multiplier */
  fakeWavePower: number;
  /** Enable triangle-based surface collision (cloth vs colliders) */
  enableSurfaceCollision: boolean;
  /** Enable broad-phase pruning before precise collider tests */
  enableBroadPhase: boolean;
  /** Preserve each joint's initial local twist (axial roll) after physics simulation */
  preserveTwist: boolean;
  /** Post-simulation angle limiting between parent-child bones */
  angleLimitConfig: AngleLimitConfig;
  /** Depth-based physics parameter curves */
  curves: PhysicsCurves;
  /** Which constraint types to generate and their collision flags */
  constraintOptions: ConstraintBuildOptions;
}

/** Stable runtime handle for a JointDynamics collider. */
export interface JointDynamicsColliderHandle {
  readonly type: 'collider';
  readonly id: number;
}

/** Stable runtime handle for a JointDynamics flat plane. */
export interface JointDynamicsFlatPlaneHandle {
  readonly type: 'flatPlane';
  readonly id: number;
}

/** Stable runtime handle for a JointDynamics grabber. */
export interface JointDynamicsGrabberHandle {
  readonly type: 'grabber';
  readonly id: number;
}

export class JointDynamicsSystemController {
  private _config: ControllerConfig;
  private _pointsR: PointR[] = [];
  private _pointsRW: PointRW[] = [];
  private _constraints: Constraint[] = [];
  private _collidersR: ColliderR[] = [];
  private _collidersRW: ColliderRW[] = [];
  private _grabbersR: GrabberR[] = [];
  private _grabbersRW: GrabberRW[] = [];
  private _movableLimitTargets: Vector3[] = [];
  private _flatPlanes: FlatPlane[] = [];
  private _flatPlaneEnabled: boolean[] = [];
  private _flatPlaneAll: FlatPlane[] = [];
  private _surfaceConstraints: number[] = [];
  private _positionsToTransform: Vector3[] = [];
  private _fakeWaveCounter = 0;
  private _previousRootPosition = Vector3.zero();
  private _previousRootRotation = Quaternion.identity();
  private _rootTransform: TransformAccess | null = null;
  private _pointTransforms: TransformAccess[] = [];
  private _colliderTransforms: TransformAccess[] = [];
  private _grabberTransforms: TransformAccess[] = [];
  private _colliderHandleIds: number[] = [];
  private _flatPlaneHandleIds: number[] = [];
  private _grabberHandleIds: number[] = [];
  private _colliderHandleToIndex = new Map<number, number>();
  private _flatPlaneHandleToIndex = new Map<number, number>();
  private _grabberHandleToIndex = new Map<number, number>();
  private _nextColliderHandleId = 1;
  private _nextFlatPlaneHandleId = 1;
  private _nextGrabberHandleId = 1;
  private _initialized = false;
  private _isPaused = false;
  private _fadeState: 'none' | 'in' | 'out' = 'none';
  private _fadeTimer = 0;
  private _fadeDuration = 0;

  constructor(config: ControllerConfig) {
    this._config = config;
  }

  /**
   * Initializes the physics system.
   * @param rootTransform Root bone transform used to detect root motion.
   * @param rootPoints Root nodes of the bone hierarchy. Multiple roots are allowed.
   * @param pointTransforms Transform array for all physics points. Order must match `BoneNode.index`.
   * @param colliders Collider array (spheres/capsules).
   * @param grabbers Grabber array used for interactions such as mouse dragging.
   * @param flatPlanes Plane limiters such as the floor to prevent penetration.
   */
  initialize(
    rootTransform: TransformAccess,
    rootPoints: BoneNode[],
    pointTransforms: TransformAccess[],
    colliders: Array<{ r: ColliderR; transform: TransformAccess }>,
    grabbers: Array<{
      r: GrabberR;
      transform: TransformAccess;
      enabled: boolean;
    }>,
    flatPlanes: Array<{ up: Vector3; position: Vector3 }>
  ): void {
    this._rootTransform = rootTransform;
    this._pointTransforms = pointTransforms;
    this._colliderTransforms = colliders.map((c) => c.transform);
    this._grabberTransforms = grabbers.map((g) => g.transform);

    // Build constraints
    this._constraints = buildConstraints(rootPoints, this._config.constraintOptions);
    this._surfaceConstraints = buildSurfaceFaces(rootPoints, this._config.constraintOptions.isLoop);

    // Flatten bone hierarchy to point list, build parent map
    const allPoints: BoneNode[] = [];
    const parentMap = new Map<number, number>(); // child index -> parent index
    function walk(node: BoneNode) {
      allPoints.push(node);
      for (const c of node.children) {
        parentMap.set(c.index, node.index);
        walk(c);
      }
    }
    for (const r of rootPoints) {
      walk(r);
    }

    const maxDepth = Math.max(...allPoints.map((p) => p.depth));

    // Compute boneAxis from transforms: local-space direction to first child
    // This is critical for correct bone rotation in skinned meshes
    const indexToNode = new Map<number, BoneNode>();
    for (const p of allPoints) {
      indexToNode.set(p.index, p);
    }

    for (const p of allPoints) {
      if (!p.boneAxis && p.children.length > 0) {
        const childPos = pointTransforms[p.children[0].index].getWorldPosition();
        const parentPos = pointTransforms[p.index].getWorldPosition();
        // InverseTransformPoint: convert child world pos to parent local space
        const parentRot = pointTransforms[p.index].getWorldRotation();
        const parentScale = pointTransforms[p.index].getLocalScale();
        const diff = Vector3.sub(childPos, parentPos);
        const invRot = Quaternion.inverse(parentRot);
        const localDir = invRot.transform(diff);
        // Apply inverse scale
        const unscaled = new Vector3(
          parentScale.x !== 0 ? localDir.x / parentScale.x : 0,
          parentScale.y !== 0 ? localDir.y / parentScale.y : 0,
          parentScale.z !== 0 ? localDir.z / parentScale.z : 0
        );
        p.boneAxis = Vector3.normalize(unscaled);
      }
    }

    // Build PointR/RW arrays
    this._pointsR = allPoints.map((p) => this._createPointR(p, maxDepth, parentMap, pointTransforms));
    this._pointsRW = allPoints.map(() => this._createPointRW());
    this._positionsToTransform = new Array(allPoints.length).fill(Vector3.zero());

    // Initialize colliders
    this._collidersR = colliders.map((c) => c.r);
    this._collidersRW = colliders.map((c) => this._createColliderRW(c.transform));
    this._colliderHandleIds = this._collidersR.map(() => this._nextColliderHandleId++);
    this._rebuildColliderHandleMap();

    // Initialize grabbers
    this._grabbersR = grabbers.map((g) => g.r);
    this._grabbersRW = grabbers.map((g) => ({
      enabled: g.enabled ? 1 : 0,
      position: g.transform.getWorldPosition()
    }));
    this._grabberHandleIds = this._grabbersR.map(() => this._nextGrabberHandleId++);
    this._rebuildGrabberHandleMap();

    // Flat planes
    this._flatPlanes = flatPlanes.map((fp) => ({
      normal: Vector3.normalize(fp.up),
      distance: -Vector3.dot(Vector3.normalize(fp.up), fp.position)
    }));
    this._flatPlaneAll = [...this._flatPlanes];
    this._flatPlaneEnabled = this._flatPlaneAll.map(() => true);
    this._flatPlaneHandleIds = this._flatPlaneAll.map(() => this._nextFlatPlaneHandleId++);
    this._rebuildFlatPlaneHandleMap();

    // Capture initial state
    this._previousRootPosition = rootTransform.getWorldPosition();
    this._previousRootRotation = rootTransform.getWorldRotation();

    for (let i = 0; i < this._pointsRW.length; i++) {
      const pos = pointTransforms[i].getWorldPosition();
      this._pointsRW[i].positionCurrent = pos.clone();
      this._pointsRW[i].positionPrevious = pos.clone();
      this._pointsRW[i].positionCurrentTransform = pos.clone();
      this._pointsRW[i].positionPreviousTransform = pos.clone();
      this._pointsRW[i].positionToTransform = pos.clone();
      this._pointsRW[i].directionPrevious = Vector3.axisPZ();
      this._pointsRW[i].fakeWindDirection = Vector3.axisPZ();
      this._pointsRW[i].grabberIndex = -1;
      this._pointsRW[i].grabberDistance = 0;
      this._pointsRW[i].friction = 0;
    }

    this._initialized = true;
  }

  /**
   * Advances the simulation by one frame.
   * Internal flow: read current transforms, run Verlet integration and constraint solving,
   * then write the result back to the transforms.
   * @param deltaTime Frame delta time in seconds. Internally subdivided by `subSteps`.
   */
  step(deltaTime: number): void {
    if (!this._initialized || !this._rootTransform) {
      return;
    }

    // Update fade
    if (this._fadeState !== 'none') {
      this._fadeTimer += deltaTime;
      if (this._fadeTimer >= this._fadeDuration) {
        this._fadeState = 'none';
        this._fadeTimer = 0;
      }
    }

    const blendRatio = this._computeBlendRatio();

    // Capture current transforms
    const rootPos = this._rootTransform.getWorldPosition();
    const rootRot = this._rootTransform.getWorldRotation();

    for (let i = 0; i < this._pointsRW.length; i++) {
      this._pointsRW[i].positionPreviousTransform = this._pointsRW[i].positionCurrentTransform.clone();
      this._pointsRW[i].positionCurrentTransform = this._pointTransforms[i].getWorldPosition();
    }

    for (let i = 0; i < this._collidersRW.length; i++) {
      const t = this._colliderTransforms[i];
      this._collidersRW[i].positionPreviousTransform = this._collidersRW[i].positionCurrentTransform.clone();
      this._collidersRW[i].directionPreviousTransform =
        this._collidersRW[i].directionCurrentTransform.clone();
      this._collidersRW[i].positionCurrentTransform = t.getWorldPosition();
      this._collidersRW[i].directionCurrentTransform = t.getWorldRotation();
      this._collidersRW[i].worldScale = t.getWorldScale();
      this._collidersRW[i].worldToLocal = Matrix4x4.compose(
        this._collidersRW[i].worldScale,
        this._collidersRW[i].directionCurrentTransform,
        this._collidersRW[i].positionCurrentTransform
      ).inplaceInvertAffine();
    }

    for (let i = 0; i < this._grabbersRW.length; i++) {
      this._grabbersRW[i].position = this._grabberTransforms[i].getWorldPosition();
    }

    // Run simulation
    const params: SimulationParams = {
      isPaused: this._isPaused,
      stepTime: deltaTime,
      subSteps: this._config.subSteps,
      rootPosition: rootPos,
      previousRootPosition: this._previousRootPosition,
      rootSlideLimit: this._config.rootSlideLimit,
      rootRotation: rootRot,
      previousRootRotation: this._previousRootRotation,
      rootRotateLimit: this._config.rootRotateLimit,
      windForce: this._config.windForce,
      enableSurfaceCollision: this._config.enableSurfaceCollision,
      surfaceConstraints: this._surfaceConstraints,
      relaxation: this._config.relaxation,
      constraintShrinkLimit: this._config.constraintShrinkLimit,
      blendRatio,
      isFakeWave: this._config.isFakeWave,
      fakeWaveSpeed: this._config.fakeWaveSpeed,
      fakeWavePower: this._config.fakeWavePower,
      fakeWaveCounter: this._fakeWaveCounter,
      collisionScale: 1.0,
      enableBroadPhase: this._config.enableBroadPhase
    };

    const result = simulate(
      params,
      this._pointsR,
      this._pointsRW,
      this._constraints,
      this._collidersR,
      this._collidersRW,
      this._grabbersR,
      this._grabbersRW,
      this._movableLimitTargets,
      this._flatPlanes
    );

    this._positionsToTransform = result.positionsToTransform;
    this._fakeWaveCounter = result.fakeWaveCounter;

    // Angle limits
    if (this._config.angleLimitConfig.angleLimit >= 0) {
      applyAngleLimits(this._pointsR, this._pointsRW, this._config.angleLimitConfig);
    }

    // Apply results
    const transformRots = this._pointTransforms.map((t) => t.getWorldRotation());
    const transformLocalRots = this._pointTransforms.map((t) => t.getLocalRotation());
    const outputs = applyResult(
      this._pointsR,
      this._pointsRW,
      this._positionsToTransform,
      blendRatio,
      transformRots,
      transformLocalRots,
      this._config.preserveTwist
    );

    for (let i = 0; i < outputs.length; i++) {
      this._pointTransforms[i].setWorldPosition(outputs[i].position);
      this._pointTransforms[i].setWorldRotation(outputs[i].rotation);
    }

    this._previousRootPosition = rootPos;
    this._previousRootRotation = rootRot;
  }

  /**
   * Returns the simulated results for all points as world-space positions and rotations.
   * Usually this does not need to be called manually because `step()` already writes the
   * output back to the transforms.
   */
  getResults(): Array<{ position: Vector3; rotation: Quaternion }> {
    const transformRots = this._pointTransforms.map((t) => t.getWorldRotation());
    const transformLocalRots = this._pointTransforms.map((t) => t.getLocalRotation());
    const outputs = applyResult(
      this._pointsR,
      this._pointsRW,
      this._positionsToTransform,
      this._config.blendRatio,
      transformRots,
      transformLocalRots,
      this._config.preserveTwist
    );
    return outputs.map((o) => ({ position: o.position, rotation: o.rotation }));
  }

  /**
   * Compensates for teleportation by resetting the previous root transform to the current one.
   * Call this after a character warp or teleport to avoid a large root-motion impulse on the
   * next simulation step.
   */
  warp(): void {
    if (!this._rootTransform) {
      return;
    }
    this._previousRootPosition = this._rootTransform.getWorldPosition();
    this._previousRootRotation = this._rootTransform.getWorldRotation();
  }

  /**
   * Resets all physics state.
   * Each simulated point is snapped back to the current transform position and grab state
   * is cleared.
   */
  reset(): void {
    for (let i = 0; i < this._pointsRW.length; i++) {
      const pos = this._pointTransforms[i].getWorldPosition();
      this._pointsRW[i].positionCurrent = pos.clone();
      this._pointsRW[i].positionPrevious = pos.clone();
      this._pointsRW[i].grabberIndex = -1;
    }
    this._fakeWaveCounter = 0;
  }

  /**
   * Releases a fixed point so it becomes dynamic, for example when cloth is detached.
   * The point state is reset to avoid a sudden impulse.
   * @param index Point index.
   */
  releasePoint(index: number): void {
    if (index < 0 || index >= this._pointsR.length) {
      return;
    }
    (this._pointsR[index] as any).weight = 1;
    const pos = this._pointTransforms[index].getWorldPosition();
    this._pointsRW[index].positionCurrent = pos.clone();
    this._pointsRW[index].positionPrevious = pos.clone();
    this._pointsRW[index].grabberIndex = -1;
  }

  /**
   * Fixes a dynamic point back to the animation pose, for example when an item is reattached.
   * The point grab state is cleared.
   * @param index Point index.
   */
  fixPoint(index: number): void {
    if (index < 0 || index >= this._pointsR.length) {
      return;
    }
    (this._pointsR[index] as any).weight = 0;
    this._pointsRW[index].grabberIndex = -1;
  }

  /**
   * Returns whether a point is fixed to animation (`weight = 0`).
   * @param index Point index.
   */
  isPointFixed(index: number): boolean {
    if (index < 0 || index >= this._pointsR.length) {
      return false;
    }
    return this._pointsR[index].weight <= EPSILON;
  }

  /** Gets the total number of physics points. */
  get pointCount(): number {
    return this._pointsR.length;
  }

  /**
   * Fades physics in by blending from animation pose to simulation.
   * `blendRatio` moves from `1` (animation only) to `0` (physics only).
   * @param seconds Transition duration in seconds.
   */
  fadeIn(seconds: number): void {
    this._fadeState = 'in';
    this._fadeTimer = 0;
    this._fadeDuration = seconds;
  }

  /**
   * Fades physics out by blending from simulation back to animation pose.
   * `blendRatio` moves from `0` (physics only) to `1` (animation only).
   * @param seconds Transition duration in seconds.
   */
  fadeOut(seconds: number): void {
    this._fadeState = 'out';
    this._fadeTimer = 0;
    this._fadeDuration = seconds;
  }

  /**
   * Sets the global wind force vector.
   * The final wind contribution is still scaled per point by `windForceScale` and mass.
   * @param wind Wind vector in world space.
   */
  setWindForce(wind: Vector3): void {
    this._config.windForce = wind;
  }

  /** Enable/disable broad-phase pruning for runtime performance comparison */
  setBroadPhaseEnabled(enabled: boolean): void {
    this._config.enableBroadPhase = enabled;
  }

  /** The blend ratio for the physics simulation */
  get blendRatio(): number {
    return this._config.blendRatio;
  }

  set blendRatio(value: number) {
    this._config.blendRatio = clamp01(value);
  }

  /**
   * Pauses or resumes the physics simulation.
   * While paused, the system still follows root motion but skips force integration and
   * constraint solving.
   * @param paused `true` to pause, `false` to resume.
   */
  setPaused(paused: boolean): void {
    this._isPaused = paused;
  }

  /**
   * Enable or disable a collider by current array index.
   * Transform state is still read from the collider's TransformAccess each frame.
   * Prefer setColliderEnabled(handle, enabled) for runtime-owned colliders.
   */
  setColliderEnabledAt(index: number, enabled: boolean): boolean {
    if (index >= 0 && index < this._collidersRW.length) {
      this._collidersRW[index].enabled = enabled ? 1 : 0;
      return true;
    }
    return false;
  }

  /**
   * Enable or disable a runtime collider by stable handle.
   * @returns true if the handle is still valid.
   */
  setColliderEnabled(handle: JointDynamicsColliderHandle, enabled: boolean): boolean {
    const index = this._getColliderIndex(handle);
    if (index === -1) {
      return false;
    }
    return this.setColliderEnabledAt(index, enabled);
  }

  /**
   * Add a collider at runtime.
   * @returns A stable handle that remains valid until this collider is removed.
   */
  addCollider(r: ColliderR, transform: TransformAccess): JointDynamicsColliderHandle {
    const id = this._nextColliderHandleId++;
    this._collidersR.push(r);
    this._colliderTransforms.push(transform);
    this._collidersRW.push(this._createColliderRW(transform));
    this._colliderHandleIds.push(id);
    this._colliderHandleToIndex.set(id, this._collidersR.length - 1);
    return { type: 'collider', id };
  }

  /**
   * Remove a collider by stable handle.
   * @returns true if the collider existed and was removed.
   */
  removeCollider(handle: JointDynamicsColliderHandle): boolean {
    const index = this._getColliderIndex(handle);
    if (index === -1) {
      return false;
    }
    return this.removeColliderAt(index);
  }

  /**
   * Remove a collider by current array index.
   * Prefer removeCollider(handle) for runtime-owned colliders.
   */
  removeColliderAt(index: number): boolean {
    if (index < 0 || index >= this._collidersR.length) {
      return false;
    }
    this._collidersR.splice(index, 1);
    this._colliderTransforms.splice(index, 1);
    this._collidersRW.splice(index, 1);
    this._colliderHandleIds.splice(index, 1);
    this._rebuildColliderHandleMap();
    return true;
  }

  /**
   * Enable or disable a flat plane by current array index.
   * Prefer setFlatPlaneEnabled(handle, enabled) for runtime-owned flat planes.
   */
  setFlatPlaneEnabledAt(index: number, enabled: boolean): boolean {
    if (index < 0 || index >= this._flatPlaneAll.length) {
      return false;
    }
    this._flatPlaneEnabled[index] = enabled;
    this._rebuildActiveFlatPlanes();
    return true;
  }

  /**
   * Enable or disable a runtime flat plane by stable handle.
   * @returns true if the handle is still valid.
   */
  setFlatPlaneEnabled(handle: JointDynamicsFlatPlaneHandle, enabled: boolean): boolean {
    const index = this._getFlatPlaneIndex(handle);
    if (index === -1) {
      return false;
    }
    return this.setFlatPlaneEnabledAt(index, enabled);
  }

  /**
   * Add a flat plane at runtime.
   * @returns A stable handle that remains valid until this flat plane is removed.
   */
  addFlatPlane(up: Vector3, position: Vector3): JointDynamicsFlatPlaneHandle {
    const id = this._nextFlatPlaneHandleId++;
    const normal = Vector3.normalize(up);
    this._flatPlaneAll.push({
      normal,
      distance: -Vector3.dot(normal, position)
    });
    this._flatPlaneEnabled.push(true);
    this._flatPlaneHandleIds.push(id);
    this._flatPlaneHandleToIndex.set(id, this._flatPlaneAll.length - 1);
    this._rebuildActiveFlatPlanes();
    return { type: 'flatPlane', id };
  }

  /**
   * Remove a flat plane by stable handle.
   * @returns true if the flat plane existed and was removed.
   */
  removeFlatPlane(handle: JointDynamicsFlatPlaneHandle): boolean {
    const index = this._getFlatPlaneIndex(handle);
    if (index === -1) {
      return false;
    }
    return this.removeFlatPlaneAt(index);
  }

  /**
   * Remove a flat plane by current array index.
   * Prefer removeFlatPlane(handle) for runtime-owned flat planes.
   */
  removeFlatPlaneAt(index: number): boolean {
    if (index < 0 || index >= this._flatPlaneAll.length) {
      return false;
    }
    this._flatPlaneAll.splice(index, 1);
    this._flatPlaneEnabled.splice(index, 1);
    this._flatPlaneHandleIds.splice(index, 1);
    this._rebuildFlatPlaneHandleMap();
    this._rebuildActiveFlatPlanes();
    return true;
  }

  /**
   * Enable or disable a grabber by current array index.
   * Transform state is still read from the grabber's TransformAccess each frame.
   * Prefer setGrabberEnabled(handle, enabled) for runtime-owned grabbers.
   */
  setGrabberEnabledAt(index: number, enabled: boolean): boolean {
    if (index >= 0 && index < this._grabbersRW.length) {
      this._grabbersRW[index].enabled = enabled ? 1 : 0;
      if (!enabled) {
        this._releaseGrabber(index);
      }
      return true;
    }
    return false;
  }

  /**
   * Enable or disable a runtime grabber by stable handle.
   * @returns true if the handle is still valid.
   */
  setGrabberEnabled(handle: JointDynamicsGrabberHandle, enabled: boolean): boolean {
    const index = this._getGrabberIndex(handle);
    if (index === -1) {
      return false;
    }
    return this.setGrabberEnabledAt(index, enabled);
  }

  /**
   * Add a grabber at runtime.
   * @returns A stable handle that remains valid until this grabber is removed.
   */
  addGrabber(r: GrabberR, transform: TransformAccess, enabled = false): JointDynamicsGrabberHandle {
    const id = this._nextGrabberHandleId++;
    this._grabbersR.push(r);
    this._grabberTransforms.push(transform);
    this._grabbersRW.push({
      enabled: enabled ? 1 : 0,
      position: transform.getWorldPosition()
    });
    this._grabberHandleIds.push(id);
    this._grabberHandleToIndex.set(id, this._grabbersR.length - 1);
    return { type: 'grabber', id };
  }

  /**
   * Remove a grabber by stable handle.
   * @returns true if the grabber existed and was removed.
   */
  removeGrabber(handle: JointDynamicsGrabberHandle): boolean {
    const index = this._getGrabberIndex(handle);
    if (index === -1) {
      return false;
    }
    return this.removeGrabberAt(index);
  }

  /**
   * Remove a grabber by current array index.
   * Prefer removeGrabber(handle) for runtime-owned grabbers.
   */
  removeGrabberAt(index: number): boolean {
    if (index < 0 || index >= this._grabbersR.length) {
      return false;
    }
    this._grabbersR.splice(index, 1);
    this._grabberTransforms.splice(index, 1);
    this._grabbersRW.splice(index, 1);
    this._grabberHandleIds.splice(index, 1);
    this._rebuildGrabberHandleMap();

    this._releaseGrabber(index);
    for (const ptRW of this._pointsRW) {
      if (ptRW.grabberIndex > index) {
        ptRW.grabberIndex--;
      }
    }
    return true;
  }

  /** Gets the number of runtime colliders. */
  get colliderCount(): number {
    return this._collidersR.length;
  }

  /** Gets the number of runtime flat planes. */
  get flatPlaneCount(): number {
    return this._flatPlaneAll.length;
  }

  /** Gets the number of runtime grabbers. */
  get grabberCount(): number {
    return this._grabbersR.length;
  }

  private _computeBlendRatio(): number {
    if (this._fadeState === 'in') {
      return 1.0 - clamp01(this._fadeTimer / this._fadeDuration);
    }
    if (this._fadeState === 'out') {
      return clamp01(this._fadeTimer / this._fadeDuration);
    }
    return this._config.blendRatio;
  }

  private _getColliderIndex(handle: JointDynamicsColliderHandle): number {
    if (handle.type !== 'collider') {
      return -1;
    }
    return this._colliderHandleToIndex.get(handle.id) ?? -1;
  }

  private _getGrabberIndex(handle: JointDynamicsGrabberHandle): number {
    if (handle.type !== 'grabber') {
      return -1;
    }
    return this._grabberHandleToIndex.get(handle.id) ?? -1;
  }

  private _getFlatPlaneIndex(handle: JointDynamicsFlatPlaneHandle): number {
    if (handle.type !== 'flatPlane') {
      return -1;
    }
    return this._flatPlaneHandleToIndex.get(handle.id) ?? -1;
  }

  private _releaseGrabber(index: number): void {
    for (const ptRW of this._pointsRW) {
      if (ptRW.grabberIndex === index) {
        ptRW.grabberIndex = -1;
        ptRW.grabberDistance = 0;
      }
    }
  }

  private _rebuildColliderHandleMap(): void {
    this._colliderHandleToIndex.clear();
    for (let i = 0; i < this._colliderHandleIds.length; i++) {
      this._colliderHandleToIndex.set(this._colliderHandleIds[i], i);
    }
  }

  private _rebuildFlatPlaneHandleMap(): void {
    this._flatPlaneHandleToIndex.clear();
    for (let i = 0; i < this._flatPlaneHandleIds.length; i++) {
      this._flatPlaneHandleToIndex.set(this._flatPlaneHandleIds[i], i);
    }
  }

  private _rebuildActiveFlatPlanes(): void {
    this._flatPlanes = [];
    for (let i = 0; i < this._flatPlaneAll.length; i++) {
      if (this._flatPlaneEnabled[i]) {
        this._flatPlanes.push(this._flatPlaneAll[i]);
      }
    }
  }

  private _rebuildGrabberHandleMap(): void {
    this._grabberHandleToIndex.clear();
    for (let i = 0; i < this._grabberHandleIds.length; i++) {
      this._grabberHandleToIndex.set(this._grabberHandleIds[i], i);
    }
  }

  private _createPointR(
    node: BoneNode,
    maxDepth: number,
    parentMap: Map<number, number>,
    transforms: TransformAccess[]
  ): PointR {
    const rate = maxDepth > 0 ? node.depth / maxDepth : 0;
    const c = this._config.curves;

    const parentIdx = parentMap.get(node.index) ?? -1;
    const childIdx = node.children.length > 0 ? node.children[0].index : -1;

    // Capture initial local transform for rotation blending
    const t = transforms[node.index];
    const initLocalPos = t.getLocalPosition();
    const initLocalRot = t.getLocalRotation();
    const initLocalScale = t.getLocalScale();

    // BoneAxis: local-space direction to first child (computed in initialize)
    const boneAxis = node.boneAxis ?? new Vector3(0, -1, 0);

    // ParentLength: distance to parent
    let parentLength = 0;
    if (parentIdx !== -1) {
      const pPos = transforms[parentIdx].getWorldPosition();
      const cPos = transforms[node.index].getWorldPosition();
      parentLength = Vector3.distance(pPos, cPos);
    }

    return {
      parent: parentIdx,
      child: childIdx,
      applyInvertCollision: 0,
      movableLimitIndex: -1,
      movableLimitRadius: 0,
      weight: node.isFixed ? 0 : 1,
      mass: c.massScale.evaluate(rate),
      resistance: clamp01(c.resistance.evaluate(rate)),
      hardness: clamp01(c.hardness.evaluate(rate)),
      frictionScale: c.friction.evaluate(rate),
      sliderJointLength: c.sliderJointLength.evaluate(rate),
      parentLength,
      structuralShrinkVertical: c.structuralShrinkVertical.evaluate(rate) * 0.5,
      structuralStretchVertical: c.structuralStretchVertical.evaluate(rate) * 0.5,
      structuralShrinkHorizontal: c.structuralShrinkHorizontal.evaluate(rate) * 0.5,
      structuralStretchHorizontal: c.structuralStretchHorizontal.evaluate(rate) * 0.5,
      shearShrink: c.shearShrink.evaluate(rate) * 0.5,
      shearStretch: c.shearStretch.evaluate(rate) * 0.5,
      bendingShrinkVertical: c.bendingShrinkVertical.evaluate(rate) * 0.5,
      bendingStretchVertical: c.bendingStretchVertical.evaluate(rate) * 0.5,
      bendingShrinkHorizontal: c.bendingShrinkHorizontal.evaluate(rate) * 0.5,
      bendingStretchHorizontal: c.bendingStretchHorizontal.evaluate(rate) * 0.5,
      windForceScale: c.windForceScale.evaluate(rate) * rate,
      fakeWavePower: c.fakeWavePower.evaluate(rate),
      fakeWaveFreq: c.fakeWaveFreq.evaluate(rate),
      forceFadeRatio: 0,
      pointRadius: Math.max(0, c.pointRadius.evaluate(rate)),
      gravity: Vector3.scale(this._config.gravity, c.gravityScale.evaluate(rate)),
      boneAxis,
      initialLocalScale: initLocalScale,
      initialLocalRotation: initLocalRot,
      initialLocalTwist: (() => {
        const tw = new Quaternion();
        initLocalRot.decomposeSwingTwist(boneAxis, undefined, tw);
        return tw;
      })(),
      initialLocalPosition: initLocalPos
    };
  }

  private _createPointRW(): PointRW {
    return {
      positionToTransform: Vector3.zero(),
      positionCurrentTransform: Vector3.zero(),
      positionPreviousTransform: Vector3.zero(),
      positionCurrent: Vector3.zero(),
      positionPrevious: Vector3.zero(),
      directionPrevious: Vector3.axisPZ(),
      fakeWindDirection: Vector3.axisPZ(),
      grabberIndex: -1,
      grabberDistance: 0,
      friction: 0
    };
  }

  private _createColliderRW(transform: TransformAccess): ColliderRW {
    const pos = transform.getWorldPosition();
    const rot = transform.getWorldRotation();
    const scale = transform.getWorldScale();
    return {
      positionCurrent: pos.clone(),
      directionCurrent: Vector3.zero(),
      boundsCenter: pos.clone(),
      boundsRadius: 0,
      positionCurrentTransform: pos.clone(),
      positionPreviousTransform: pos.clone(),
      directionCurrentTransform: rot.clone(),
      directionPreviousTransform: rot.clone(),
      worldToLocal: Matrix4x4.identity(),
      worldScale: scale.clone(),
      localBoundsMin: Vector3.zero(),
      localBoundsMax: Vector3.zero(),
      radius: 0,
      enabled: 1
    };
  }
}
