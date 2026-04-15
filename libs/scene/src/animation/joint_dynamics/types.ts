// Data structure definitions — direct port of C# structs from SPCRJointDynamicsJob.cs

import type { Matrix4x4, Quaternion, Vector3 } from '@zephyr3d/base';

export const EPSILON = 0.001;

/** Constraint topology type */
export const enum ConstraintType {
  /** Parent-child bone pairs along vertical chains */
  Structural_Vertical = 0,
  /** Same-depth bones across adjacent chains */
  Structural_Horizontal = 1,
  /** Diagonal cross-bracing between adjacent chains */
  Shear = 2,
  /** Skip-one vertical (grandparent→grandchild) for bending resistance */
  Bending_Vertical = 3,
  /** Skip-one horizontal across chains for bending resistance */
  Bending_Horizontal = 4
}

/** Collider surface force direction (used for surface/triangle collision) */
export const enum ColliderForce {
  /** No surface force */
  Off = 0,
  /** Push surface outward from collider */
  Push = 1,
  /** Pull surface inward toward collider */
  Pull = 2
}

/**
 * Read-only per-point physics parameters.
 * Set once at initialization, immutable during simulation.
 * Constraint scale values are pre-multiplied by 0.5 (summed between two points in solver).
 */
export interface PointR {
  /** Index of parent point in the hierarchy (-1 = root, no parent) */
  parent: number;
  /** Index of first child point (-1 = leaf, no child) */
  child: number;
  /** Whether this point responds to inverse colliders (0 or 1) */
  applyInvertCollision: number;
  /** Index into movableLimitTargets array (-1 = no limit) */
  movableLimitIndex: number;
  /** Max distance from movable limit target (sphere constraint radius) */
  movableLimitRadius: number;
  /** 0 = fixed (follows animation), 1 = dynamic (simulated) */
  weight: number;
  /** Mass of the point, affects wind force scaling */
  mass: number;
  /** Velocity damping factor [0-1]. Higher = less damping, more movement */
  resistance: number;
  /** Restore-to-animation strength [0-1]. Higher = stiffer, pulls toward animated pose */
  hardness: number;
  /** Multiplier for accumulated friction from collisions */
  frictionScale: number;
  /** Extra slack length added to horizontal/shear constraint stretch limits */
  sliderJointLength: number;
  /** Distance to parent point (used for angle limiting) */
  parentLength: number;
  /** Structural vertical constraint shrink stiffness (×0.5, summed with other point) */
  structuralShrinkVertical: number;
  /** Structural vertical constraint stretch stiffness */
  structuralStretchVertical: number;
  /** Structural horizontal constraint shrink stiffness */
  structuralShrinkHorizontal: number;
  /** Structural horizontal constraint stretch stiffness */
  structuralStretchHorizontal: number;
  /** Shear constraint shrink stiffness */
  shearShrink: number;
  /** Shear constraint stretch stiffness */
  shearStretch: number;
  /** Bending vertical constraint shrink stiffness */
  bendingShrinkVertical: number;
  /** Bending vertical constraint stretch stiffness */
  bendingStretchVertical: number;
  /** Bending horizontal constraint shrink stiffness */
  bendingShrinkHorizontal: number;
  /** Bending horizontal constraint stretch stiffness */
  bendingStretchHorizontal: number;
  /** Wind force multiplier (scaled by depth rate) */
  windForceScale: number;
  /** Fake wave amplitude multiplier for leaf bones */
  fakeWavePower: number;
  /** Fake wave frequency offset for leaf bones */
  fakeWaveFreq: number;
  /** Blend ratio toward animation pose [0-1]. Used for fade in/out */
  forceFadeRatio: number;
  /** Collision radius of this point (used in sphere/capsule pushout) */
  pointRadius: number;
  /** Gravity vector applied to this point (scaled by depth curve) */
  gravity: Vector3;
  /** Local-space direction from this bone to its first child (for rotation calculation) */
  boneAxis: Vector3;
  /** Initial local scale captured at init (for transform reset) */
  initialLocalScale: Vector3;
  /** Initial local rotation captured at init (for rotation blending) */
  initialLocalRotation: Quaternion;
  /** Initial local position captured at init (for transform reset) */
  initialLocalPosition: Vector3;
}

/**
 * Mutable per-point simulation state.
 * Updated every substep during simulation.
 */
export interface PointRW {
  /** Final output position to write back to the transform */
  positionToTransform: Vector3;
  /** Current frame's animated world position (read from transform) */
  positionCurrentTransform: Vector3;
  /** Previous frame's animated world position */
  positionPreviousTransform: Vector3;
  /** Current simulated world position (Verlet integration state) */
  positionCurrent: Vector3;
  /** Previous simulated world position (Verlet integration state) */
  positionPrevious: Vector3;
  /** Previous frame's bone direction (fallback when direction is zero-length) */
  directionPrevious: Vector3;
  /** Interpolated wind direction for fake wave effect */
  fakeWindDirection: Vector3;
  /** Index of the grabber currently holding this point (-1 = not grabbed) */
  grabberIndex: number;
  /** Distance maintained from grabber center when grabbed */
  grabberDistance: number;
  /** Accumulated friction from collisions this frame (reset each substep) */
  friction: number;
}

/** Distance constraint between two points */
export interface Constraint {
  /** Whether collision detection runs for this constraint's bone pair (0 or 1) */
  isCollision: number;
  /** Constraint topology type */
  type: ConstraintType;
  /** Index of first connected point */
  indexA: number;
  /** Index of second connected point */
  indexB: number;
  /** Rest length — the target distance between the two points */
  length: number;
}

/** Read-only collider shape parameters (set at init) */
export interface ColliderR {
  /** Base radius of the collider sphere (or capsule head) */
  radius: number;
  /** Scale factor for capsule tail radius relative to head (1.0 = uniform) */
  radiusTailScale: number;
  /** Capsule height. 0 = sphere collider, >0 = capsule collider */
  height: number;
  /** Friction coefficient applied on collision contact */
  friction: number;
  /** If true, keeps points INSIDE the collider (e.g. muscle volume) */
  isInverseCollider: boolean;
  /** Surface force direction for triangle/surface collision */
  forceType: ColliderForce;
}

/** Mutable collider runtime state (updated each frame) */
export interface ColliderRW {
  /** Current interpolated head position (for this substep) */
  positionCurrent: Vector3;
  /** Current interpolated capsule direction vector (head→tail) */
  directionCurrent: Vector3;
  /** World-space broad-phase center for current collider */
  boundsCenter: Vector3;
  /** World-space broad-phase radius for current collider */
  boundsRadius: number;
  /** This frame's world position (read from transform) */
  positionCurrentTransform: Vector3;
  /** Previous frame's world position */
  positionPreviousTransform: Vector3;
  /** This frame's world rotation (read from transform) */
  directionCurrentTransform: Quaternion;
  /** Previous frame's world rotation */
  directionPreviousTransform: Quaternion;
  /** World-to-local matrix for AABB bounds computation */
  worldToLocal: Matrix4x4;
  /** World-space scale of the collider node (product of all ancestor scales × own local scale) */
  worldScale: Vector3;
  /** Local-space AABB min corner */
  localBoundsMin: Vector3;
  /** Local-space AABB max corner */
  localBoundsMax: Vector3;
  /** Scaled radius for current frame (base radius × world scale) */
  radius: number;
  /** Whether this collider is active (0 = disabled, 1 = enabled) */
  enabled: number;
}

/** Read-only grabber parameters (set at init) */
export interface GrabberR {
  /** Grab activation radius — points within this distance can be grabbed */
  radius: number;
  /** Pull strength toward grabber [0-1]. 1 = snap to grabber, 0 = no pull */
  force: number;
}

/** Mutable grabber runtime state (updated each frame) */
export interface GrabberRW {
  /** Whether this grabber is active (0 = disabled, 1 = enabled) */
  enabled: number;
  /** Current world position of the grabber */
  position: Vector3;
}

/** Angle limiting configuration for post-simulation bone angle clamping */
export interface AngleLimitConfig {
  /** Max angle in degrees between parent and child bone. Negative = disabled */
  angleLimit: number;
  /** If true, measure angle from original transform orientation instead of simulated parent */
  limitFromRoot: boolean;
}

/** Flat plane limiter — infinite plane that points cannot pass through */
export interface FlatPlane {
  /** Plane normal (points toward the "allowed" side) */
  normal: Vector3;
  /** Signed distance from origin (plane equation: dot(normal, point) + distance = 0) */
  distance: number;
}

/**
 * Input point data for low-level initialization (mirrors C# Point struct).
 * Used when bypassing the Controller and calling the solver directly.
 */
export interface PointInit {
  /** Parent point index (-1 = no parent) */
  parent: number;
  /** Child point index (-1 = no child) */
  child: number;
  /** Index into movable limit targets array (-1 = none) */
  movableLimitIndex: number;
  /** Whether to respond to inverse colliders (0 or 1) */
  applyInvertCollision: number;
  /** Movable limit sphere radius */
  movableLimitRadius: number;
  /** 0 = fixed, 1 = dynamic */
  weight: number;
  /** Point mass */
  mass: number;
  /** Velocity damping [0-1] */
  resistance: number;
  /** Restore-to-animation stiffness [0-1] */
  hardness: number;
  /** Friction scale multiplier */
  frictionScale: number;
  /** Extra slack for horizontal/shear stretch */
  sliderJointLength: number;
  /** Fake wave amplitude */
  fakeWavePower: number;
  /** Fake wave frequency offset */
  fakeWaveFreq: number;
  /** Distance to parent point */
  parentLength: number;
  /** Structural vertical shrink stiffness */
  structuralShrinkVertical: number;
  /** Structural vertical stretch stiffness */
  structuralStretchVertical: number;
  /** Structural horizontal shrink stiffness */
  structuralShrinkHorizontal: number;
  /** Structural horizontal stretch stiffness */
  structuralStretchHorizontal: number;
  /** Shear shrink stiffness */
  shearShrink: number;
  /** Shear stretch stiffness */
  shearStretch: number;
  /** Bending vertical shrink stiffness */
  bendingShrinkVertical: number;
  /** Bending vertical stretch stiffness */
  bendingStretchVertical: number;
  /** Bending horizontal shrink stiffness */
  bendingShrinkHorizontal: number;
  /** Bending horizontal stretch stiffness */
  bendingStretchHorizontal: number;
  /** Wind force multiplier */
  windForceScale: number;
  /** Collision radius */
  pointRadius: number;
  /** Gravity vector */
  gravity: Vector3;
  /** Local-space bone axis direction */
  boneAxis: Vector3;
  /** Initial world position */
  position: Vector3;
  /** Initial direction */
  direction: Vector3;
}

/**
 * Engine-agnostic transform read/write interface.
 * Implement this to bridge the solver with any rendering engine (Three.js, Babylon, custom).
 */
export interface TransformAccess {
  /** Read world-space position */
  getWorldPosition(): Vector3;
  /** Read world-space rotation */
  getWorldRotation(): Quaternion;
  /** Read world-space scale (product of all ancestor scales and own local scale) */
  getWorldScale(): Vector3;
  /** Read local-space position (relative to parent) */
  getLocalPosition(): Vector3;
  /** Read local-space rotation (relative to parent) */
  getLocalRotation(): Quaternion;
  /** Read local scale */
  getLocalScale(): Vector3;
  /** Write world-space position (implementation must convert to local if parented) */
  setWorldPosition(p: Vector3): void;
  /** Write world-space rotation (implementation must convert to local if parented) */
  setWorldRotation(q: Quaternion): void;
  /** Write local-space position */
  setLocalPosition(p: Vector3): void;
  /** Write local-space rotation */
  setLocalRotation(q: Quaternion): void;
  /** Write local scale */
  setLocalScale(s: Vector3): void;
}

/**
 * Bone hierarchy node for constraint building.
 * Represents a single bone in the tree structure passed to buildConstraints().
 */
export interface BoneNode {
  /** Unique index of this bone (must match the position in the pointTransforms array) */
  index: number;
  /** World-space position at initialization time (used for rest-length calculation) */
  position: Vector3;
  /** Child nodes in the hierarchy */
  children: BoneNode[];
  /** If true, this point is fixed (weight=0, follows animation) — typically depth=0 roots */
  isFixed: boolean;
  /** Depth in the hierarchy (0 = root, increments per level) */
  depth: number;
  /** Whether to include in surface collision triangle generation (default: true) */
  useForSurfaceCollision?: boolean;
  /** Local-space direction to first child. Auto-computed from transforms if omitted */
  boneAxis?: Vector3;
}
