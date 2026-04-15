// High-level orchestrator — SPCRJointDynamicsController API

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
  /** Post-simulation angle limiting between parent-child bones */
  angleLimitConfig: AngleLimitConfig;
  /** Depth-based physics parameter curves */
  curves: PhysicsCurves;
  /** Which constraint types to generate and their collision flags */
  constraintOptions: ConstraintBuildOptions;
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
  private _surfaceConstraints: number[] = [];
  private _positionsToTransform: Vector3[] = [];
  private _fakeWaveCounter = 0;
  private _previousRootPosition = Vector3.zero();
  private _previousRootRotation = Quaternion.identity();
  private _rootTransform: TransformAccess | null = null;
  private _pointTransforms: TransformAccess[] = [];
  private _colliderTransforms: TransformAccess[] = [];
  private _grabberTransforms: TransformAccess[] = [];
  private _initialized = false;
  private _isPaused = false;
  private _fadeState: 'none' | 'in' | 'out' = 'none';
  private _fadeTimer = 0;
  private _fadeDuration = 0;

  constructor(config: ControllerConfig) {
    this._config = config;
  }

  /**
   * 初始化物理系统
   * @param rootTransform 根骨骼的 transform（用于检测根运动）
   * @param rootPoints 骨骼层级的根节点数组（可以有多个根，如裙子的多条链）
   * @param pointTransforms 所有物理点的 transform 数组（顺序必须与 BoneNode.index 对应）
   * @param colliders 碰撞器数组（球体/胶囊体）
   * @param grabbers 抓取器数组（用于鼠标交互等）
   * @param flatPlanes 平面限制器数组（如地板，防止穿透）
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
    const parentMap = new Map<number, number>(); // child index → parent index
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

    // Initialize grabbers
    this._grabbersR = grabbers.map((g) => g.r);
    this._grabbersRW = grabbers.map((g) => ({
      enabled: g.enabled ? 1 : 0,
      position: g.transform.getWorldPosition()
    }));

    // Flat planes
    this._flatPlanes = flatPlanes.map((fp) => ({
      normal: Vector3.normalize(fp.up),
      distance: -Vector3.dot(Vector3.normalize(fp.up), fp.position)
    }));

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
   * 执行一帧物理模拟
   * 内部流程：读取当前 transform → 运行 Verlet 积分和约束求解 → 写回 transform
   * @param deltaTime 帧间隔时间（秒）。内部会被 subSteps 细分
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
      transformLocalRots
    );

    for (let i = 0; i < outputs.length; i++) {
      this._pointTransforms[i].setWorldPosition(outputs[i].position);
      this._pointTransforms[i].setWorldRotation(outputs[i].rotation);
    }

    this._previousRootPosition = rootPos;
    this._previousRootRotation = rootRot;
  }

  /**
   * 获取所有点的模拟结果（世界坐标位置和旋转）
   * 通常不需要手动调用——step() 已经自动写回 transform。
   * 适用于需要在不写回 transform 的情况下读取物理结果的场景。
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
      transformLocalRots
    );
    return outputs.map((o) => ({ position: o.position, rotation: o.rotation }));
  }

  /**
   * 瞬移补偿——在角色传送/瞬移后调用
   * 将上一帧的根骨骼位置和旋转设为当前值，
   * 使下一帧的根运动增量为零，避免物理点因巨大位移而弹射。
   */
  warp(): void {
    if (!this._rootTransform) {
      return;
    }
    this._previousRootPosition = this._rootTransform.getWorldPosition();
    this._previousRootRotation = this._rootTransform.getWorldRotation();
  }

  /**
   * 重置所有物理状态
   * 将所有点的模拟位置重置为当前 transform 位置，清除速度和抓取状态。
   * 适用于场景切换或需要消除所有物理运动的场景。
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
   * 释放固定点为动态点（如脱衣、布料脱落）
   * 将 weight 从 0 改为 1，同时重置该点的模拟状态避免瞬间弹射。
   * @param index 点的索引
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
   * 将动态点重新固定为跟随动画（如重新穿戴）
   * 将 weight 从 1 改为 0，清除抓取状态。
   * @param index 点的索引
   */
  fixPoint(index: number): void {
    if (index < 0 || index >= this._pointsR.length) {
      return;
    }
    (this._pointsR[index] as any).weight = 0;
    this._pointsRW[index].grabberIndex = -1;
  }

  /**
   * 查询某个点是否为固定状态（weight=0，跟随动画）
   * @param index 点的索引
   */
  isPointFixed(index: number): boolean {
    if (index < 0 || index >= this._pointsR.length) {
      return false;
    }
    return this._pointsR[index].weight <= EPSILON;
  }

  /** 获取物理点总数 */
  get pointCount(): number {
    return this._pointsR.length;
  }

  /**
   * 渐入物理——从动画姿态平滑过渡到物理模拟
   * blendRatio 从 1（纯动画）渐变到 0（纯物理）
   * @param seconds 过渡时长（秒）
   */
  fadeIn(seconds: number): void {
    this._fadeState = 'in';
    this._fadeTimer = 0;
    this._fadeDuration = seconds;
  }

  /**
   * 渐出物理——从物理模拟平滑过渡回动画姿态
   * blendRatio 从 0（纯物理）渐变到 1（纯动画）
   * @param seconds 过渡时长（秒）
   */
  fadeOut(seconds: number): void {
    this._fadeState = 'out';
    this._fadeTimer = 0;
    this._fadeDuration = seconds;
  }

  /**
   * 设置全局风力向量
   * 风力会按每个点的 windForceScale 和质量进行缩放
   * @param wind 风力向量（世界坐标）
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
   * 暂停/恢复物理模拟
   * 暂停时仍会跟随根骨骼运动，但不进行力学积分和约束求解
   * @param paused true=暂停, false=恢复
   */
  setPaused(paused: boolean): void {
    this._isPaused = paused;
  }

  /**
   * 运行时更新碰撞器状态
   * 用于外部直接控制碰撞器的启用/禁用和位置，而不通过 TransformAccess 读取
   * @param index 碰撞器索引
   * @param enabled 是否启用
   * @param position 世界坐标位置
   * @param rotation 世界旋转
   */
  updateColliderState(index: number, enabled: boolean, position: Vector3, rotation: Quaternion): void {
    if (index >= 0 && index < this._collidersRW.length) {
      this._collidersRW[index].enabled = enabled ? 1 : 0;
      this._collidersRW[index].positionCurrentTransform = position;
      this._collidersRW[index].directionCurrentTransform = rotation;
    }
  }

  /**
   * 运行时更新抓取器状态
   * 用于鼠标拖拽等交互场景，控制抓取器的启用和位置
   * @param index 抓取器索引
   * @param enabled 是否启用（鼠标按下=true，松开=false）
   * @param position 抓取器世界坐标位置
   */
  updateGrabberState(index: number, enabled: boolean, position: Vector3): void {
    if (index >= 0 && index < this._grabbersRW.length) {
      this._grabbersRW[index].enabled = enabled ? 1 : 0;
      this._grabbersRW[index].position = position;
    }
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
      pointRadius: 0.05,
      gravity: Vector3.scale(this._config.gravity, c.gravityScale.evaluate(rate)),
      boneAxis,
      initialLocalScale: initLocalScale,
      initialLocalRotation: initLocalRot,
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
