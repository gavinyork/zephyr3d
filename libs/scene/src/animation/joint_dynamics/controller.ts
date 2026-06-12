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
import { simulate, applyResult, applyAngleLimits, extractLocalTwist, type SimulationParams } from './solver';
import type { DeepPartial, Nullable } from '@zephyr3d/base';
import { InterpolatorScalar, Vector3, Quaternion, Matrix4x4, clamp01 } from '@zephyr3d/base';
import type { SceneNode } from '../../scene';

/**
 * Depth-based physics parameter curves.
 * Each curve is evaluated with t = pointDepth / maxDepth (0 at root, 1 at tip).
 * This allows parameters to vary smoothly along the bone chain.
 *
 * @public
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

/**
 * Top-level configuration for the physics controller
 * @public
 **/
export interface ControllerConfig {
  /** Global gravity vector */
  gravity: Vector3;
  /** Global wind force vector applied to all dynamic points */
  windForce: Vector3;
  /** Number of constraint relaxation iterations per substep. Higher = more stable but slower */
  relaxation: number;
  /** Number of simulation substeps per frame. Higher = more stable at cost of performance */
  subSteps: number;
  /** Max system-local root slide distance retained after root motion. Excess is applied to physics state. -1 = unlimited */
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

/**
 * Partial runtime update for JointDynamics controller configuration.
 *
 * @public
 */
export type ControllerConfigUpdate = DeepPartial<ControllerConfig, 2>;

/**
 * Stable runtime handle for a JointDynamics collider.
 * @public
 */
export interface JointDynamicsColliderHandle {
  readonly type: 'collider';
  readonly id: number;
}

/**
 * Stable runtime handle for a JointDynamics flat plane.
 * @public
 */
export interface JointDynamicsFlatPlaneHandle {
  readonly type: 'flatPlane';
  readonly id: number;
}

/**
 * Stable runtime handle for a JointDynamics grabber.
 * @public
 */
export interface JointDynamicsGrabberHandle {
  readonly type: 'grabber';
  readonly id: number;
}

/**
 * Serializable snapshot of a runtime collider.
 * @public
 */
export interface JointDynamicsColliderSnapshot {
  r: ColliderR;
  transform: Nullable<SceneNode>;
  enabled: boolean;
}

/**
 * Serializable snapshot of a runtime flat plane.
 * @public
 */
export interface JointDynamicsFlatPlaneSnapshot {
  up: Vector3;
  position: Vector3;
  enabled: boolean;
}

/**
 * Serializable snapshot of a runtime grabber.
 * @public
 */
export interface JointDynamicsGrabberSnapshot {
  r: GrabberR;
  transform: Nullable<SceneNode>;
  enabled: boolean;
}

/**
 * High-level controller for joint dynamics simulation.
 *
 * This class manages the physics simulation for a hierarchy of bones, including constraints,
 * colliders, and grabbers. It provides an API for initializing the system with bone data and
 * transforms, stepping the simulation each frame, and modifying colliders and grabbers at runtime.
 * The controller handles the internal state and logic for blending between animation and physics,
 * applying forces, and enforcing constraints.
 *
 * @public
 */
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
  private _rootPoints: BoneNode[] = [];
  private _allPoints: BoneNode[] = [];
  private _parentMap = new Map<number, number>();
  private _maxPointDepth = 0;
  private _pointTransforms: TransformAccess[] = [];
  private _colliderTransforms: TransformAccess[] = [];
  private _grabberTransforms: TransformAccess[] = [];
  private _colliderHandleIds: number[] = [];
  private _flatPlaneHandleIds: number[] = [];
  private _grabberHandleIds: number[] = [];
  private _colliderHandleToIndex = new Map<number, number>();
  private _flatPlaneHandleToIndex = new Map<number, number>();
  private _grabberHandleToIndex = new Map<number, number>();
  private _lastOutputLocalRotations: Quaternion[] = [];
  private _baseSystemScale = 1;
  private _currentSystemScale = 1;
  private _basePointParentLengths: number[] = [];
  private _baseConstraintLengths: number[] = [];
  private _nextColliderHandleId = 1;
  private _nextFlatPlaneHandleId = 1;
  private _nextGrabberHandleId = 1;
  private _initialized = false;
  private _isPaused = false;
  private _fadeState: 'none' | 'in' | 'out' = 'none';
  private _fadeTimer = 0;
  private _fadeDuration = 0;

  constructor(config: ControllerConfig) {
    this._config = this._sanitizeControllerConfig(this._cloneControllerConfig(config));
  }

  /**
   * Initializes the physics system.
   * @param rootTransform - Root bone transform used to detect root motion.
   * @param rootPoints - Root nodes of the bone hierarchy. Multiple roots are allowed.
   * @param pointTransforms - Transform array for all physics points. Order must match `BoneNode.index`.
   * @param colliders - Collider array (spheres/capsules).
   * @param grabbers - Grabber array used for interactions such as mouse dragging.
   * @param flatPlanes - Plane limiters such as the floor to prevent penetration.
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
    this._baseSystemScale = this._getSystemUniformScale();
    this._currentSystemScale = this._baseSystemScale;
    this._rootPoints = [...rootPoints];
    this._pointTransforms = pointTransforms;
    this._colliderTransforms = colliders.map((c) => c.transform);
    this._grabberTransforms = grabbers.map((g) => g.transform);

    // Build constraints
    this._rebuildConstraints();
    this._baseConstraintLengths = this._constraints.map((constraint) => constraint.length);

    // Flatten bone hierarchy to point list, build parent map
    const allPoints: BoneNode[] = [];
    const visitedPoints = new Set<number>();
    this._parentMap = new Map<number, number>(); // child index -> parent index
    const walk = (node: BoneNode) => {
      if (visitedPoints.has(node.index)) {
        return;
      }
      visitedPoints.add(node.index);
      allPoints.push(node);
      for (const c of node.children) {
        this._parentMap.set(c.index, node.index);
        walk(c);
      }
    };
    for (const r of rootPoints) {
      walk(r);
    }
    allPoints.sort((a, b) => a.index - b.index);

    this._allPoints = allPoints;
    this._maxPointDepth = allPoints.length > 0 ? Math.max(...allPoints.map((p) => p.depth)) : 0;

    // Compute boneAxis from transforms: local-space direction to first child
    // This is critical for correct bone rotation in skinned meshes
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
    this._pointsR = allPoints.map((p) => this._createPointR(p));
    this._basePointParentLengths = this._pointsR.map((point) => point.parentLength);
    this._pointsRW = allPoints.map(() => this._createPointRW());
    this._positionsToTransform = new Array(allPoints.length).fill(Vector3.zero());
    this._clearOutputTransformCache();

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
   * @param deltaTime - Frame delta time in seconds. Internally subdivided by `subSteps`.
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
    this._updateScaleDependentParameters();
    const rootSlideLimit =
      this._config.rootSlideLimit < 0 ? -1 : this._config.rootSlideLimit * this._currentSystemScale;

    // Capture current transforms
    const rootPos = this._rootTransform.getWorldPosition();
    const rootRot = this._rootTransform.getWorldRotation();

    const inputLocalRotations = this._getInputLocalRotations();
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
      rootSlideLimit,
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
    const transformLocalRots = inputLocalRotations;
    const sceneParentRots = this._pointTransforms.map((t) => this._getSceneParentWorldRotation(t));
    const outputs = applyResult(
      this._pointsR,
      this._pointsRW,
      this._positionsToTransform,
      blendRatio,
      transformRots,
      transformLocalRots,
      this._config.preserveTwist,
      sceneParentRots
    );

    for (let i = 0; i < outputs.length; i++) {
      this._pointTransforms[i].setWorldPosition(outputs[i].position);
      this._pointTransforms[i].setWorldRotation(outputs[i].rotation);
    }
    this._lastOutputLocalRotations = this._pointTransforms.map((t) => t.getLocalRotation());

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
    const transformLocalRots = this._getInputLocalRotations();
    const sceneParentRots = this._pointTransforms.map((t) => this._getSceneParentWorldRotation(t));
    const outputs = applyResult(
      this._pointsR,
      this._pointsRW,
      this._positionsToTransform,
      this._config.blendRatio,
      transformRots,
      transformLocalRots,
      this._config.preserveTwist,
      sceneParentRots
    );
    return outputs.map((o) => ({ position: o.position, rotation: o.rotation }));
  }

  /**
   * Returns a detached snapshot of the current runtime configuration.
   */
  getConfig(): ControllerConfig {
    return this._cloneControllerConfig(this._config);
  }

  /**
   * Returns detached collider snapshots for persistence.
   */
  getColliderSnapshots(): JointDynamicsColliderSnapshot[] {
    return this._collidersR.map((r, index) => ({
      r: { ...r },
      transform: this._colliderTransforms[index]?.node ?? null,
      enabled: this._collidersRW[index]?.enabled !== 0
    }));
  }

  /**
   * Returns detached flat-plane snapshots for persistence.
   */
  getFlatPlaneSnapshots(): JointDynamicsFlatPlaneSnapshot[] {
    return this._flatPlaneAll.map((plane, index) => ({
      up: plane.normal.clone(),
      position: Vector3.scale(plane.normal, -plane.distance),
      enabled: this._flatPlaneEnabled[index] ?? true
    }));
  }

  /**
   * Returns detached grabber snapshots for persistence.
   */
  getGrabberSnapshots(): JointDynamicsGrabberSnapshot[] {
    return this._grabbersR.map((r, index) => ({
      r: { ...r },
      transform: this._grabberTransforms[index]?.node ?? null,
      enabled: this._grabbersRW[index]?.enabled !== 0
    }));
  }

  /**
   * Replaces the runtime configuration.
   *
   * If the controller is already initialized, cached per-point parameters and generated
   * constraints are refreshed immediately so editor-driven changes take effect in the next step.
   *
   * @param config - Complete controller configuration to apply.
   */
  setConfig(config: ControllerConfig): void {
    this._config = this._sanitizeControllerConfig(this._cloneControllerConfig(config));
    this._clearOutputTransformCache();
    this._refreshCachedSimulationConfig();
  }

  /**
   * Applies a partial runtime configuration update.
   *
   * This is intended for editor workflows that tweak one or more simulation parameters live.
   * The controller updates only the affected caches: global step parameters are applied directly,
   * per-point curve/gravity changes rebuild cached point coefficients, and constraint option
   * changes rebuild the generated constraints.
   *
   * @param config - Partial configuration update.
   */
  updateConfig(config: ControllerConfigUpdate): void {
    let refreshPoints = false;
    let refreshConstraints = false;

    if (config.gravity) {
      this._config.gravity = config.gravity.clone();
      refreshPoints = true;
    }
    if (config.windForce) {
      this._config.windForce = config.windForce.clone();
    }
    if (typeof config.relaxation === 'number') {
      this._config.relaxation = Math.max(0, Math.trunc(config.relaxation));
    }
    if (typeof config.subSteps === 'number') {
      this._config.subSteps = Math.max(1, Math.trunc(config.subSteps));
    }
    if (typeof config.rootSlideLimit === 'number') {
      this._config.rootSlideLimit = config.rootSlideLimit;
    }
    if (typeof config.rootRotateLimit === 'number') {
      this._config.rootRotateLimit = config.rootRotateLimit;
    }
    if (typeof config.constraintShrinkLimit === 'number') {
      this._config.constraintShrinkLimit = Math.max(0, config.constraintShrinkLimit);
    }
    if (typeof config.blendRatio === 'number') {
      this._config.blendRatio = clamp01(config.blendRatio);
    }
    if (typeof config.stabilizationFrameRate === 'number') {
      this._config.stabilizationFrameRate = config.stabilizationFrameRate;
    }
    if (typeof config.isFakeWave === 'boolean') {
      this._config.isFakeWave = config.isFakeWave;
    }
    if (typeof config.fakeWaveSpeed === 'number') {
      this._config.fakeWaveSpeed = config.fakeWaveSpeed;
    }
    if (typeof config.fakeWavePower === 'number') {
      this._config.fakeWavePower = config.fakeWavePower;
    }
    if (typeof config.enableSurfaceCollision === 'boolean') {
      this._config.enableSurfaceCollision = config.enableSurfaceCollision;
      if (!config.constraintOptions || config.constraintOptions.enableSurfaceCollision === undefined) {
        this._config.constraintOptions.enableSurfaceCollision = config.enableSurfaceCollision;
        refreshConstraints = true;
      }
    }
    if (typeof config.enableBroadPhase === 'boolean') {
      this._config.enableBroadPhase = config.enableBroadPhase;
    }
    if (typeof config.preserveTwist === 'boolean') {
      this._config.preserveTwist = config.preserveTwist;
      this._clearOutputTransformCache();
    }

    if (config.angleLimitConfig) {
      if (typeof config.angleLimitConfig.angleLimit === 'number') {
        this._config.angleLimitConfig.angleLimit = config.angleLimitConfig.angleLimit;
      }
      if (typeof config.angleLimitConfig.limitFromRoot === 'boolean') {
        this._config.angleLimitConfig.limitFromRoot = config.angleLimitConfig.limitFromRoot;
      }
    }

    if (config.curves) {
      const curveKeys: Array<keyof PhysicsCurves> = [
        'massScale',
        'gravityScale',
        'windForceScale',
        'resistance',
        'hardness',
        'friction',
        'pointRadius',
        'sliderJointLength',
        'allShrinkScale',
        'allStretchScale',
        'structuralShrinkVertical',
        'structuralStretchVertical',
        'structuralShrinkHorizontal',
        'structuralStretchHorizontal',
        'shearShrink',
        'shearStretch',
        'bendingShrinkVertical',
        'bendingStretchVertical',
        'bendingShrinkHorizontal',
        'bendingStretchHorizontal',
        'fakeWavePower',
        'fakeWaveFreq'
      ];
      for (const key of curveKeys) {
        const curve = config.curves[key];
        if (curve !== undefined) {
          this._config.curves[key] = this._cloneInterpolatorScalar(curve);
          refreshPoints = true;
        }
      }
    }

    if (config.constraintOptions) {
      const optionKeys: Array<keyof ConstraintBuildOptions> = [
        'structuralVertical',
        'structuralHorizontal',
        'shear',
        'bendingVertical',
        'bendingHorizontal',
        'isLoop',
        'collideStructuralVertical',
        'collideStructuralHorizontal',
        'collideShear',
        'enableSurfaceCollision'
      ];
      for (const key of optionKeys) {
        const value = config.constraintOptions[key];
        if (value !== undefined) {
          this._config.constraintOptions[key] = value;
          if (key === 'enableSurfaceCollision' && config.enableSurfaceCollision === undefined) {
            this._config.enableSurfaceCollision = value;
          }
          refreshConstraints = true;
        }
      }
    }

    if (refreshConstraints) {
      this._rebuildConstraints();
      this._baseConstraintLengths = this._constraints.map((constraint) => constraint.length);
      this._updateScaleDependentParameters(true);
    }
    if (refreshPoints) {
      this._refreshPointParameters();
    }
  }

  /**
   * Resets all physics state after teleportation.
   * @deprecated Use {@link JointDynamicsSystemController.reset}. This method is kept as a compatibility alias.
   */
  warp(): void {
    this.reset();
  }

  /**
   * Resets all physics state.
   * Simulated points, transform history, root-motion history, grab state and wave phase are
   * snapped back to the current scene transforms. Runtime configuration and fixed/released
   * point weights are preserved.
   */
  reset(): void {
    for (let i = 0; i < this._pointsRW.length; i++) {
      const pos = this._pointTransforms[i].getWorldPosition();
      const ptRW = this._pointsRW[i];
      ptRW.positionCurrent = pos.clone();
      ptRW.positionPrevious = pos.clone();
      ptRW.positionCurrentTransform = pos.clone();
      ptRW.positionPreviousTransform = pos.clone();
      ptRW.positionToTransform = pos.clone();
      this._positionsToTransform[i] = pos.clone();
      ptRW.fakeWindDirection = Vector3.axisPZ();
      ptRW.grabberIndex = -1;
      ptRW.grabberDistance = 0;
      ptRW.friction = 0;
    }
    for (let i = 0; i < this._pointsRW.length; i++) {
      const parent = this._pointsR[i]?.parent ?? -1;
      if (parent !== -1) {
        const direction = Vector3.sub(
          this._pointsRW[i].positionCurrent,
          this._pointsRW[parent].positionCurrent
        );
        this._pointsRW[i].directionPrevious = direction.magnitudeSq > EPSILON ? direction : Vector3.axisPZ();
      } else {
        this._pointsRW[i].directionPrevious = Vector3.axisPZ();
      }
    }
    for (let i = 0; i < this._collidersRW.length; i++) {
      const transform = this._colliderTransforms[i];
      const pos = transform.getWorldPosition();
      const rot = transform.getWorldRotation();
      const scale = transform.getWorldScale();
      const colRW = this._collidersRW[i];
      colRW.positionCurrentTransform = pos.clone();
      colRW.positionPreviousTransform = pos.clone();
      colRW.directionCurrentTransform = rot.clone();
      colRW.directionPreviousTransform = rot.clone();
      colRW.worldScale = scale.clone();
      colRW.worldToLocal = Matrix4x4.compose(scale, rot, pos).inplaceInvertAffine();
    }
    for (let i = 0; i < this._grabbersRW.length; i++) {
      this._grabbersRW[i].position = this._grabberTransforms[i].getWorldPosition();
    }
    if (this._rootTransform) {
      this._previousRootPosition = this._rootTransform.getWorldPosition();
      this._previousRootRotation = this._rootTransform.getWorldRotation();
    }
    this._fakeWaveCounter = 0;
    this._clearOutputTransformCache();
  }

  /**
   * Releases a fixed point so it becomes dynamic, for example when cloth is detached.
   * The point state is reset to avoid a sudden impulse.
   * @param index - Point index.
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
   * @param index - Point index.
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
   * @param index - Point index.
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
   * @param seconds - Transition duration in seconds.
   */
  fadeIn(seconds: number): void {
    this._fadeState = 'in';
    this._fadeTimer = 0;
    this._fadeDuration = seconds;
  }

  /**
   * Fades physics out by blending from simulation back to animation pose.
   * `blendRatio` moves from `0` (physics only) to `1` (animation only).
   * @param seconds - Transition duration in seconds.
   */
  fadeOut(seconds: number): void {
    this._fadeState = 'out';
    this._fadeTimer = 0;
    this._fadeDuration = seconds;
  }

  /**
   * Sets the global wind force vector.
   * The final wind contribution is still scaled per point by `windForceScale` and mass.
   * @param wind - Wind vector in world space.
   */
  setWindForce(wind: Vector3): void {
    this._config.windForce = wind.clone();
  }

  /**
   * Enable/disable broad-phase pruning for runtime performance comparison
   * @param enabled - `true` to enable broad-phase, `false` to disable.
   */
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
   * @param paused - `true` to pause, `false` to resume.
   */
  setPaused(paused: boolean): void {
    this._isPaused = paused;
  }

  /**
   * Enable or disable a collider by current array index.
   * Transform state is still read from the collider's TransformAccess each frame.
   * Prefer setColliderEnabled(handle, enabled) for runtime-owned colliders.
   *
   * @param index - Collider index in the current array. Note that this may change when colliders are added or removed.
   * @param enabled - `true` to enable the collider, `false` to disable it.
   *
   * @returns `true` if the index is valid and the collider was updated, `false` if the index is out of range.
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
   *
   * @param handle - Stable handle for the collider to enable or disable.
   * @param enabled - `true` to enable the collider, `false` to disable it.
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
   * @param r - Read-only collider data such as shape and size.
   * @param transform - TransformAccess that provides the collider's position and rotation each frame.
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
   * @param handle - Stable handle for the collider to remove.
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
   * @param index - Collider index in the current array. Note that this may change when colliders are added or removed.
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
   * @param index - Flat plane index in the current array. Note that this may change when flat planes are added or removed.
   * @param enabled - `true` to enable the flat plane, `false` to disable it.
   * @returns `true` if the index is valid and the flat plane was updated, `false` if the index is out of range.
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
   * @param handle - Stable handle for the flat plane to enable or disable.
   * @param enabled - `true` to enable the flat plane, `false` to disable it.
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
   * @param up - Up direction of the plane. The normal is computed as `Vector3.normalize(up)`.
   * @param position - A point on the plane. The distance is computed as `-Vector3.dot(normal, position)`.
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
   * @param handle - Stable handle for the flat plane to remove.
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
   * @param index - Flat plane index in the current array. Note that this may change when flat planes are added or removed.
   * @returns true if the index was valid and the flat plane was removed, false if the index was out of range.
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
   *
   * @param index - Grabber index in the current array. Note that this may change when grabbers are added or removed.
   * @param enabled - `true` to enable the grabber, `false` to disable it.
   * @returns `true` if the index is valid and the grabber was updated, `false` if the index is out of range.
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
   * @param handle - Stable handle for the grabber to enable or disable.
   * @param enabled - `true` to enable the grabber, `false` to disable it.
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
   * @param r - Read-only grabber data such as interaction radius.
   * @param transform - TransformAccess that provides the grabber's position each frame.
   * @param enabled - Whether the grabber starts enabled. The grabber can still be moved by its transform while disabled, but it won't affect any points until enabled.
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
   * @param handle - Stable handle for the grabber to remove.
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
   *
   * @param index - Grabber index in the current array. Note that this may change when grabbers are added or removed.
   * @returns true if the index was valid and the grabber was removed, false if the index was out of range.
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

  private _refreshCachedSimulationConfig(): void {
    this._rebuildConstraints();
    this._refreshPointParameters();
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

  private _rebuildConstraints(): void {
    if (this._rootPoints.length === 0) {
      this._constraints = [];
      this._surfaceConstraints = [];
      return;
    }
    this._constraints = buildConstraints(this._rootPoints, this._config.constraintOptions);
    this._surfaceConstraints = buildSurfaceFaces(this._rootPoints, this._config.constraintOptions.isLoop);
  }

  private _getSystemUniformScale(): number {
    if (!this._rootTransform) {
      return 1;
    }
    const scale = this._rootTransform.getWorldScale();
    return Math.max((Math.abs(scale.x) + Math.abs(scale.y) + Math.abs(scale.z)) / 3, EPSILON);
  }

  private _getSceneParentWorldRotation(transform: TransformAccess): Quaternion | undefined {
    const parent = transform.node?.parent;
    if (!parent) {
      return undefined;
    }
    const rotation = new Quaternion();
    parent.worldMatrix.decompose(null, rotation, null);
    return rotation;
  }

  private _clearOutputTransformCache(): void {
    this._lastOutputLocalRotations = [];
  }

  private _getInputLocalRotations(): Quaternion[] {
    return this._pointTransforms.map((transform, index) => {
      const localRotation = transform.getLocalRotation();
      const lastOutput = this._lastOutputLocalRotations[index];
      if (
        lastOutput &&
        Quaternion.angleBetween(localRotation, lastOutput) <= EPSILON &&
        this._pointsR[index]
      ) {
        return this._pointsR[index].initialLocalRotation.clone();
      }
      return localRotation;
    });
  }

  private _updateScaleDependentParameters(force = false): void {
    const systemScale = this._getSystemUniformScale();
    const scaleChanged = Math.abs(systemScale - this._currentSystemScale) > EPSILON;
    if (!force && !scaleChanged) {
      return;
    }
    this._currentSystemScale = systemScale;
    const ratio = this._baseSystemScale > EPSILON ? systemScale / this._baseSystemScale : 1;
    for (let i = 0; i < this._pointsR.length; i++) {
      this._pointsR[i].parentLength =
        (this._basePointParentLengths[i] ?? this._pointsR[i].parentLength) * ratio;
    }
    for (let i = 0; i < this._constraints.length; i++) {
      this._constraints[i].length = (this._baseConstraintLengths[i] ?? this._constraints[i].length) * ratio;
    }
    this._refreshPointParameters();
    if (scaleChanged) {
      this.reset();
    }
  }

  private _refreshPointParameters(): void {
    if (!this._initialized) {
      return;
    }
    for (let i = 0; i < this._allPoints.length; i++) {
      this._applyConfigToPoint(this._pointsR[i], this._allPoints[i]);
    }
  }

  private _createPointR(node: BoneNode): PointR {
    const parentIdx = this._parentMap.get(node.index) ?? -1;
    const childIdx = node.children.length > 0 ? node.children[0].index : -1;

    // Capture initial local transform for rotation blending
    const t = this._pointTransforms[node.index];
    const initLocalPos = t.getLocalPosition();
    const initLocalRot = t.getLocalRotation();
    const initLocalScale = t.getLocalScale();

    // BoneAxis: local-space direction to first child (computed in initialize)
    const boneAxis = node.boneAxis ?? new Vector3(0, -1, 0);

    // ParentLength: distance to parent
    let parentLength = 0;
    if (parentIdx !== -1) {
      const pPos = this._pointTransforms[parentIdx].getWorldPosition();
      const cPos = this._pointTransforms[node.index].getWorldPosition();
      parentLength = Vector3.distance(pPos, cPos);
    }

    const point: PointR = {
      parent: parentIdx,
      child: childIdx,
      applyInvertCollision: 0,
      movableLimitIndex: -1,
      movableLimitRadius: 0,
      weight: node.isFixed ? 0 : 1,
      mass: 0,
      resistance: 0,
      hardness: 0,
      frictionScale: 0,
      sliderJointLength: 0,
      parentLength,
      structuralShrinkVertical: 0,
      structuralStretchVertical: 0,
      structuralShrinkHorizontal: 0,
      structuralStretchHorizontal: 0,
      shearShrink: 0,
      shearStretch: 0,
      bendingShrinkVertical: 0,
      bendingStretchVertical: 0,
      bendingShrinkHorizontal: 0,
      bendingStretchHorizontal: 0,
      windForceScale: 0,
      fakeWavePower: 0,
      fakeWaveFreq: 0,
      forceFadeRatio: 0,
      pointRadius: 0,
      gravity: Vector3.zero(),
      boneAxis,
      initialLocalScale: initLocalScale,
      initialLocalRotation: initLocalRot,
      initialLocalTwist: extractLocalTwist(initLocalRot, boneAxis),
      initialLocalPosition: initLocalPos
    };
    this._applyConfigToPoint(point, node);
    return point;
  }

  private _applyConfigToPoint(point: PointR, node: BoneNode): void {
    const rate = this._maxPointDepth > 0 ? node.depth / this._maxPointDepth : 0;
    const c = this._config.curves;
    const allShrinkScale = c.allShrinkScale.evaluate(rate);
    const allStretchScale = c.allStretchScale.evaluate(rate);

    point.mass = c.massScale.evaluate(rate);
    point.resistance = clamp01(c.resistance.evaluate(rate));
    point.hardness = clamp01(c.hardness.evaluate(rate));
    point.frictionScale = c.friction.evaluate(rate);
    point.sliderJointLength = c.sliderJointLength.evaluate(rate);
    point.structuralShrinkVertical = c.structuralShrinkVertical.evaluate(rate) * allShrinkScale * 0.5;
    point.structuralStretchVertical = c.structuralStretchVertical.evaluate(rate) * allStretchScale * 0.5;
    point.structuralShrinkHorizontal = c.structuralShrinkHorizontal.evaluate(rate) * allShrinkScale * 0.5;
    point.structuralStretchHorizontal = c.structuralStretchHorizontal.evaluate(rate) * allStretchScale * 0.5;
    point.shearShrink = c.shearShrink.evaluate(rate) * allShrinkScale * 0.5;
    point.shearStretch = c.shearStretch.evaluate(rate) * allStretchScale * 0.5;
    point.bendingShrinkVertical = c.bendingShrinkVertical.evaluate(rate) * allShrinkScale * 0.5;
    point.bendingStretchVertical = c.bendingStretchVertical.evaluate(rate) * allStretchScale * 0.5;
    point.bendingShrinkHorizontal = c.bendingShrinkHorizontal.evaluate(rate) * allShrinkScale * 0.5;
    point.bendingStretchHorizontal = c.bendingStretchHorizontal.evaluate(rate) * allStretchScale * 0.5;
    point.windForceScale = c.windForceScale.evaluate(rate) * rate;
    point.fakeWavePower = c.fakeWavePower.evaluate(rate);
    point.fakeWaveFreq = c.fakeWaveFreq.evaluate(rate);
    const systemScale = this._currentSystemScale;
    point.pointRadius = Math.max(0, c.pointRadius.evaluate(rate) * systemScale);
    point.gravity = Vector3.scale(this._config.gravity, c.gravityScale.evaluate(rate) * systemScale);
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
      height: 0,
      enabled: 1
    };
  }

  private _cloneControllerConfig(config: ControllerConfig): ControllerConfig {
    const curves: PhysicsCurves = {
      massScale: this._cloneInterpolatorScalar(config.curves.massScale),
      gravityScale: this._cloneInterpolatorScalar(config.curves.gravityScale),
      windForceScale: this._cloneInterpolatorScalar(config.curves.windForceScale),
      resistance: this._cloneInterpolatorScalar(config.curves.resistance),
      hardness: this._cloneInterpolatorScalar(config.curves.hardness),
      friction: this._cloneInterpolatorScalar(config.curves.friction),
      pointRadius: this._cloneInterpolatorScalar(config.curves.pointRadius),
      sliderJointLength: this._cloneInterpolatorScalar(config.curves.sliderJointLength),
      allShrinkScale: this._cloneInterpolatorScalar(config.curves.allShrinkScale),
      allStretchScale: this._cloneInterpolatorScalar(config.curves.allStretchScale),
      structuralShrinkVertical: this._cloneInterpolatorScalar(config.curves.structuralShrinkVertical),
      structuralStretchVertical: this._cloneInterpolatorScalar(config.curves.structuralStretchVertical),
      structuralShrinkHorizontal: this._cloneInterpolatorScalar(config.curves.structuralShrinkHorizontal),
      structuralStretchHorizontal: this._cloneInterpolatorScalar(config.curves.structuralStretchHorizontal),
      shearShrink: this._cloneInterpolatorScalar(config.curves.shearShrink),
      shearStretch: this._cloneInterpolatorScalar(config.curves.shearStretch),
      bendingShrinkVertical: this._cloneInterpolatorScalar(config.curves.bendingShrinkVertical),
      bendingStretchVertical: this._cloneInterpolatorScalar(config.curves.bendingStretchVertical),
      bendingShrinkHorizontal: this._cloneInterpolatorScalar(config.curves.bendingShrinkHorizontal),
      bendingStretchHorizontal: this._cloneInterpolatorScalar(config.curves.bendingStretchHorizontal),
      fakeWavePower: this._cloneInterpolatorScalar(config.curves.fakeWavePower),
      fakeWaveFreq: this._cloneInterpolatorScalar(config.curves.fakeWaveFreq)
    };
    return {
      gravity: config.gravity.clone(),
      windForce: config.windForce.clone(),
      relaxation: config.relaxation,
      subSteps: config.subSteps,
      rootSlideLimit: config.rootSlideLimit,
      rootRotateLimit: config.rootRotateLimit,
      constraintShrinkLimit: config.constraintShrinkLimit,
      blendRatio: config.blendRatio,
      stabilizationFrameRate: config.stabilizationFrameRate,
      isFakeWave: config.isFakeWave,
      fakeWaveSpeed: config.fakeWaveSpeed,
      fakeWavePower: config.fakeWavePower,
      enableSurfaceCollision: config.enableSurfaceCollision,
      enableBroadPhase: config.enableBroadPhase,
      preserveTwist: config.preserveTwist,
      angleLimitConfig: {
        angleLimit: config.angleLimitConfig.angleLimit,
        limitFromRoot: config.angleLimitConfig.limitFromRoot
      },
      curves,
      constraintOptions: {
        structuralVertical: config.constraintOptions.structuralVertical,
        structuralHorizontal: config.constraintOptions.structuralHorizontal,
        shear: config.constraintOptions.shear,
        bendingVertical: config.constraintOptions.bendingVertical,
        bendingHorizontal: config.constraintOptions.bendingHorizontal,
        isLoop: config.constraintOptions.isLoop,
        collideStructuralVertical: config.constraintOptions.collideStructuralVertical,
        collideStructuralHorizontal: config.constraintOptions.collideStructuralHorizontal,
        collideShear: config.constraintOptions.collideShear,
        enableSurfaceCollision: config.constraintOptions.enableSurfaceCollision
      }
    };
  }

  private _cloneInterpolatorScalar(curve: InterpolatorScalar): InterpolatorScalar {
    return new InterpolatorScalar(
      curve.mode,
      new Float32Array(curve.inputs),
      new Float32Array(curve.outputs)
    );
  }

  private _sanitizeControllerConfig(config: ControllerConfig): ControllerConfig {
    config.relaxation = Math.max(0, Math.trunc(config.relaxation));
    config.subSteps = Math.max(1, Math.trunc(config.subSteps));
    config.constraintShrinkLimit = Math.max(0, config.constraintShrinkLimit);
    config.blendRatio = clamp01(config.blendRatio);
    return config;
  }
}
