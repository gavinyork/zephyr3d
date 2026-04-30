// Core physics simulation - direct port of JobExecuteSimulation from SPCRJointDynamicsJob.cs

import {
  Quaternion,
  Vector3,
  Matrix4x4,
  degree2radian,
  radian2degree,
  clamp01,
  smoothStep
} from '@zephyr3d/base';
import {
  EPSILON,
  ConstraintType,
  type PointR,
  type PointRW,
  type Constraint,
  type ColliderR,
  type ColliderRW,
  type GrabberR,
  type GrabberRW,
  type AngleLimitConfig,
  type FlatPlane
} from './types';
import {
  pushoutFromSphere,
  pushoutFromCapsule,
  pushInFromSphere,
  pushInFromCapsule,
  collisionDetection,
  checkSurfaceCollision,
  type CollisionResult,
  type SurfaceCheckResult
} from './collision';

const AXIS_Y = new Vector3(0, 1, 0);
const VEC3_ONE = new Vector3(1, 1, 1);
const _computeCapsuleAxis = new Vector3();
const _computeCapsuleHalfDir = new Vector3();
const _applySystemTransformOffset = new Vector3();
const _applySystemTransformRotated = new Vector3();
const _broadPhaseSegmentDir = new Vector3();
const _broadPhaseToCenter = new Vector3();
const _broadPhaseClosestPoint = new Vector3();
const _broadPhaseDelta = new Vector3();

/**
 * Parameters for a single simulation step.
 *
 * @public
 */
export interface SimulationParams {
  /** If true, skip force integration (only apply root motion and output positions) */
  isPaused: boolean;
  /** Frame delta time in seconds (will be subdivided by subSteps) */
  stepTime: number;
  /** Number of substeps per frame. Higher = more stable simulation */
  subSteps: number;
  /** Current root bone world position */
  rootPosition: Vector3;
  /** Previous frame's root bone world position (for root motion limiting) */
  previousRootPosition: Vector3;
  /** Max root slide distance per substep. -1 = no limit */
  rootSlideLimit: number;
  /** Current root bone world rotation */
  rootRotation: Quaternion;
  /** Previous frame's root bone world rotation */
  previousRootRotation: Quaternion;
  /** Max root rotation angle (degrees) per substep. -1 = no limit */
  rootRotateLimit: number;
  /** Global wind force vector */
  windForce: Vector3;
  /** Enable triangle-based surface collision */
  enableSurfaceCollision: boolean;
  /** Triangle indices for surface collision (6 per quad: 2 triangles, 3 indices each) */
  surfaceConstraints: number[];
  /** Number of constraint relaxation iterations per substep */
  relaxation: number;
  /** Upper limit for horizontal/shear shrink power */
  constraintShrinkLimit: number;
  /** Blend ratio between physics and animation [0-1]. 0 = full physics */
  blendRatio: number;
  /** Enable sinusoidal fake wave on leaf bones */
  isFakeWave: boolean;
  /** Fake wave speed (frequency accumulation rate) */
  fakeWaveSpeed: number;
  /** Fake wave global amplitude */
  fakeWavePower: number;
  /** Current fake wave phase counter (accumulated across frames) */
  fakeWaveCounter: number;
  /** Global scale multiplier for all collider radii */
  collisionScale: number;
  /** Enable broad-phase pruning before precise collision checks */
  enableBroadPhase: boolean;
}

/**
 * Run the full simulation step. Mutates `pointsRW` and `collidersRW` in place.
 * Returns `{ positionsToTransform, fakeWaveCounter }`.
 *
 * @public
 */
export function simulate(
  params: SimulationParams,
  pointsR: readonly PointR[],
  pointsRW: PointRW[],
  constraints: readonly Constraint[],
  collidersR: readonly ColliderR[],
  collidersRW: ColliderRW[],
  grabbersR: readonly GrabberR[],
  grabbersRW: readonly GrabberRW[],
  movableLimitTargets: readonly Vector3[],
  flatPlanes: readonly FlatPlane[]
): { positionsToTransform: Vector3[]; fakeWaveCounter: number } {
  const pointCount = pointsR.length;
  const positionsToTransform: Vector3[] = new Array(pointCount);

  let subSteps = params.subSteps;
  if (params.isPaused) {
    subSteps = 1;
  }

  let fakeWaveFreq = params.fakeWaveCounter;

  // Root slide offset
  let rootSlideOffset = Vector3.zero();
  const rootDeltaSlide = Vector3.sub(params.rootPosition, params.previousRootPosition);
  const rootDeltaSlideLen = rootDeltaSlide.magnitude;
  if (params.rootSlideLimit >= 0 && rootDeltaSlideLen > params.rootSlideLimit) {
    rootSlideOffset = Vector3.scale(
      rootDeltaSlide,
      (1.0 - params.rootSlideLimit / rootDeltaSlideLen) / subSteps
    );
  }

  // Root rotation offset
  let rootRotationOffset = Quaternion.identity();
  const rootDeltaRot = Quaternion.multiply(
    params.rootRotation,
    Quaternion.inverse(params.previousRootRotation)
  );
  let rotateAngle = Math.acos(Math.max(-1, Math.min(1, rootDeltaRot.w))) * 2.0 * (180 / Math.PI);
  if (rotateAngle > 180) {
    rotateAngle -= 360;
  }

  if (params.rootRotateLimit >= 0 && Math.abs(rotateAngle) > params.rootRotateLimit) {
    // Extract the rotation axis from the delta quaternion
    const sinHalf = Math.sqrt(Math.max(0, 1 - rootDeltaRot.w * rootDeltaRot.w));
    let rotateAxis: Vector3;
    if (sinHalf > 0.0001) {
      rotateAxis = new Vector3(rootDeltaRot.x / sinHalf, rootDeltaRot.y / sinHalf, rootDeltaRot.z / sinHalf);
    } else {
      rotateAxis = Vector3.axisPY();
    }
    let angle = rotateAngle > 0 ? rotateAngle - params.rootRotateLimit : rotateAngle + params.rootRotateLimit;
    angle /= subSteps;
    rootRotationOffset = Quaternion.fromAxisAngle(rotateAxis, degree2radian(angle));
  }

  if (params.isPaused) {
    rootSlideOffset = rootDeltaSlide;
    rootRotationOffset = rootDeltaRot;
  }

  const stepTime = params.stepTime / subSteps;

  for (let iSubStep = 1; iSubStep <= subSteps; iSubStep++) {
    const stepDelta = iSubStep / subSteps;
    const stepTime_x2_half = stepTime * stepTime * 0.5;

    colliderUpdate(collidersR, collidersRW, stepDelta);
    pointUpdatePass1(
      pointsR,
      pointsRW,
      stepDelta,
      stepTime_x2_half,
      rootSlideOffset,
      rootRotationOffset,
      params.rootPosition,
      params.windForce,
      params.isPaused,
      grabbersR,
      grabbersRW,
      movableLimitTargets,
      flatPlanes,
      collidersR,
      collidersRW
    );

    if (!params.isPaused) {
      fakeWaveFreq += params.fakeWaveSpeed * stepTime;

      if (params.enableSurfaceCollision) {
        surfaceCollision(pointsRW, collidersR, collidersRW, params.surfaceConstraints);
      }

      // Push fixed points out of colliders before constraint solving.
      // Fixed points follow animation and cannot be moved by the solver, but if
      // their animated position is inside a collider, the distance constraint will
      // pull free children inward through the surface �?causing the characteristic
      // "hair flipping outward" artifact at the back of the head.
      // By temporarily clamping fixed-point positionCurrent to the collider surface
      // before each substep's constraint pass, we ensure constraints operate from
      // a geometrically valid anchor.  The original animated position is restored
      // at the start of the next substep via positionCurrentTransform.
      fixedPointColliderPushout(pointsR, pointsRW, collidersR, collidersRW);

      for (let iRelax = params.relaxation - 1; iRelax >= 0; --iRelax) {
        constraintUpdate(
          pointsR,
          pointsRW,
          constraints,
          collidersR,
          collidersRW,
          params.constraintShrinkLimit,
          params.enableBroadPhase
        );
      }

      // After all constraint/collision iterations are done, cancel any residual
      // normal velocity that would push points back into colliders next frame.
      // We compare the final positionCurrent (guaranteed outside all colliders)
      // against positionPrevious (the Verlet integration start point) and zero
      // out the component pointing into each collider.
      postCollisionVelocityFix(pointsR, pointsRW, collidersR, collidersRW);
    }

    pointUpdatePass2(
      pointsR,
      pointsRW,
      positionsToTransform,
      stepDelta,
      fakeWaveFreq,
      params.blendRatio,
      params.isFakeWave,
      params.fakeWavePower
    );
  }

  return { positionsToTransform, fakeWaveCounter: fakeWaveFreq };
}

function computeCapsule(
  pos: Vector3,
  rot: Quaternion,
  height: number,
  head: Vector3,
  direction: Vector3
): void {
  rot.transform(Vector3.scale(AXIS_Y, height, _computeCapsuleAxis), direction);
  Vector3.scale(direction, 0.5, _computeCapsuleHalfDir);
  Vector3.sub(pos, _computeCapsuleHalfDir, head);
}

function colliderUpdate(collidersR: readonly ColliderR[], collidersRW: ColliderRW[], stepDelta: number) {
  const curPos = new Vector3();
  const curDir = new Quaternion();
  const corner = new Vector3();
  const center = new Vector3();
  const tailCorner = new Vector3();
  const tailCenter = new Vector3();
  for (let i = 0; i < collidersR.length; i++) {
    const colR = collidersR[i];
    const colRW = collidersRW[i];
    // Scale radius by the uniform world scale of the collider node.
    // Use the average of x/y/z components to handle non-uniform scale gracefully.
    const ws = colRW.worldScale;
    const worldScaleUniform = (ws.x + ws.y + ws.z) / 3;
    colRW.radius = colR.radius * worldScaleUniform;

    Vector3.lerp(colRW.positionPreviousTransform, colRW.positionCurrentTransform, stepDelta, curPos);
    Quaternion.slerp(colRW.directionPreviousTransform, colRW.directionCurrentTransform, stepDelta, curDir);

    computeCapsule(curPos, curDir, colR.height, colRW.positionCurrent, colRW.directionCurrent);
    if (colR.height > EPSILON) {
      Vector3.scale(colRW.directionCurrent, 0.5, _computeCapsuleHalfDir);
      Vector3.add(colRW.positionCurrent, _computeCapsuleHalfDir, colRW.boundsCenter);
      colRW.boundsRadius =
        Math.sqrt(colRW.directionCurrent.magnitudeSq) * 0.5 +
        Math.max(colRW.radius, colRW.radius * colR.radiusTailScale);
    } else {
      colRW.boundsCenter.set(colRW.positionCurrent);
      colRW.boundsRadius = colRW.radius;
    }

    // Update local bounds
    Vector3.scale(VEC3_ONE, colR.radius, corner);
    colRW.worldToLocal.transformPointAffine(colRW.positionCurrent, center);
    Vector3.sub(center, corner, colRW.localBoundsMin);
    Vector3.add(center, corner, colRW.localBoundsMax);

    if (colR.height > EPSILON) {
      Vector3.scale(VEC3_ONE, colR.radius * colR.radiusTailScale, tailCorner);
      Vector3.add(colRW.positionCurrent, colRW.directionCurrent, tailCenter);
      colRW.worldToLocal.transformPointAffine(tailCenter, tailCenter);
      colRW.localBoundsMin.setXYZ(
        Math.min(colRW.localBoundsMin.x, tailCenter.x - tailCorner.x),
        Math.min(colRW.localBoundsMin.y, tailCenter.y - tailCorner.y),
        Math.min(colRW.localBoundsMin.z, tailCenter.z - tailCorner.z)
      );
      colRW.localBoundsMax.setXYZ(
        Math.max(colRW.localBoundsMax.x, tailCenter.x + tailCorner.x),
        Math.max(colRW.localBoundsMax.y, tailCenter.y + tailCorner.y),
        Math.max(colRW.localBoundsMax.z, tailCenter.z + tailCorner.z)
      );
    }
  }
}

function applySystemTransform(
  point: Vector3,
  pivot: Vector3,
  slideOffset: Vector3,
  rotOffset: Quaternion,
  result?: Vector3
): Vector3 {
  const rotated = rotOffset.transform(
    Vector3.sub(point, pivot, _applySystemTransformOffset),
    result || _applySystemTransformRotated
  );
  Vector3.add(rotated, pivot, rotated);
  return Vector3.add(rotated, slideOffset, rotated);
}

function pointMayCollideBroadPhase(point: Vector3, colRW: ColliderRW, padding = 0): boolean {
  const radius = colRW.boundsRadius + padding;
  const delta = Vector3.sub(point, colRW.boundsCenter, _broadPhaseDelta);
  return delta.magnitudeSq <= radius * radius;
}

function segmentMayCollideBroadPhase(point1: Vector3, point2: Vector3, colRW: ColliderRW): boolean {
  const segmentDir = Vector3.sub(point2, point1, _broadPhaseSegmentDir);
  const lenSq = segmentDir.magnitudeSq;
  if (lenSq <= EPSILON) {
    return pointMayCollideBroadPhase(point1, colRW);
  }
  const toCenter = Vector3.sub(colRW.boundsCenter, point1, _broadPhaseToCenter);
  const t = clamp01(Vector3.dot(toCenter, segmentDir) / lenSq);
  const closestPoint = Vector3.scale(segmentDir, t, _broadPhaseClosestPoint);
  Vector3.add(point1, closestPoint, closestPoint);
  const delta = Vector3.sub(colRW.boundsCenter, closestPoint, _broadPhaseDelta);
  return delta.magnitudeSq <= colRW.boundsRadius * colRW.boundsRadius;
}

// Core physics simulation - direct port of JobExecuteSimulation from SPCRJointDynamicsJob.cs

function pointUpdatePass1(
  pointsR: readonly PointR[],
  pointsRW: PointRW[],
  stepDelta: number,
  stepTime_x2_half: number,
  rootSlideOffset: Vector3,
  rootRotationOffset: Quaternion,
  rootPosition: Vector3,
  windForce: Vector3,
  isPaused: boolean,
  grabbersR: readonly GrabberR[],
  grabbersRW: readonly GrabberRW[],
  movableLimitTargets: readonly Vector3[],
  flatPlanes: readonly FlatPlane[],
  collidersR: readonly ColliderR[],
  collidersRW: readonly ColliderRW[]
) {
  const currentTransformPos = new Vector3();
  const moveDir = new Vector3();
  const extForce = new Vector3();
  const displacement = new Vector3();
  const restore = new Vector3();
  const tempVec0 = new Vector3();
  const tempVec1 = new Vector3();
  const planeOffset = new Vector3();
  for (let index = 0; index < pointsR.length; index++) {
    const ptR = pointsR[index];
    const ptRW = pointsRW[index];

    Vector3.lerp(
      ptRW.positionPreviousTransform,
      ptRW.positionCurrentTransform,
      stepDelta,
      currentTransformPos
    );

    if (ptR.weight <= EPSILON) {
      ptRW.positionPrevious.set(ptRW.positionCurrent);
      ptRW.positionCurrent.set(currentTransformPos);
    } else {
      applySystemTransform(
        ptRW.positionPrevious,
        rootPosition,
        rootSlideOffset,
        rootRotationOffset,
        ptRW.positionPrevious
      );
      applySystemTransform(
        ptRW.positionCurrent,
        rootPosition,
        rootSlideOffset,
        rootRotationOffset,
        ptRW.positionCurrent
      );

      displacement.setXYZ(0, 0, 0);
      if (!isPaused) {
        Vector3.sub(ptRW.positionCurrent, ptRW.positionPrevious, moveDir);
        Vector3.scale(windForce, ptR.windForceScale / ptR.mass, extForce);
        Vector3.add(ptR.gravity, extForce, extForce);
        Vector3.scale(extForce, stepTime_x2_half, extForce);

        // Clamp the per-step force displacement to half the bone's rest length.
        // Without this, large gravity values (e.g. -50 in world space) produce a
        // per-step displacement comparable to the bone spacing, which exceeds what
        // the constraint relaxation can correct in one pass and causes surface jitter.
        if (ptR.parentLength > EPSILON) {
          const maxForceDisp = ptR.parentLength * 0.5;
          const forceDispSq = extForce.magnitudeSq;
          if (forceDispSq > maxForceDisp * maxForceDisp) {
            Vector3.scale(extForce, maxForceDisp / Math.sqrt(forceDispSq), extForce);
          }
        }

        // Apply resistance (damping) only to the velocity term, not to external forces.
        // Applying resistance to gravity would incorrectly attenuate acceleration each frame,
        // causing energy errors and instability under high gravity.
        Vector3.scale(moveDir, ptR.resistance, moveDir);
        Vector3.scale(moveDir, 1.0 - clamp01(ptRW.friction * ptR.frictionScale), moveDir);

        // Clamp per-step velocity to a multiple of bone rest length.
        // During fast root rotations the Verlet velocity can become very large,
        // overwhelming the constraint solver and causing the hair to lose shape.
        // Limiting velocity keeps the simulation stable regardless of how fast
        // the root moves, while still allowing natural large-amplitude swings.
        if (ptR.parentLength > EPSILON) {
          const maxVelDisp = ptR.parentLength * 2.0;
          const velDispSq = moveDir.magnitudeSq;
          if (velDispSq > maxVelDisp * maxVelDisp) {
            Vector3.scale(moveDir, maxVelDisp / Math.sqrt(velDispSq), moveDir);
          }
        }

        Vector3.add(moveDir, extForce, displacement);
      }

      ptRW.positionPrevious.set(ptRW.positionCurrent);
      Vector3.add(ptRW.positionCurrent, displacement, ptRW.positionCurrent);
      ptRW.friction = 0;

      if (!isPaused) {
        // Hardness restore
        if (ptR.hardness > 0) {
          Vector3.sub(currentTransformPos, ptRW.positionCurrent, restore);
          Vector3.scale(restore, ptR.hardness, restore);
          Vector3.add(ptRW.positionCurrent, restore, ptRW.positionCurrent);
        }
        // Force fade ratio
        if (ptR.forceFadeRatio > 0) {
          Vector3.lerp(ptRW.positionCurrent, currentTransformPos, ptR.forceFadeRatio, ptRW.positionCurrent);
        }
        // Push out of colliders immediately after hardness/fade pulls the point
        // toward the animated position (which may be inside a collider).
        // This prevents the hardness↔collision tug-of-war that causes jitter.
        for (let ci = 0; ci < collidersR.length; ci++) {
          const colRci = collidersR[ci];
          const colRWci = collidersRW[ci];
          if (colRWci.enabled === 0 || colRci.isInverseCollider) {
            continue;
          }
          const hRes =
            colRci.height <= EPSILON
              ? pushoutFromSphere(
                  colRWci.positionCurrent,
                  colRWci.radius,
                  ptR.pointRadius,
                  ptRW.positionCurrent
                )
              : pushoutFromCapsule(colRci, colRWci, ptRW.positionCurrent, ptR);
          if (hRes.hit) {
            ptRW.positionCurrent.set(hRes.point);
          }
        }
        // Grabber
        if (ptRW.grabberIndex !== -1) {
          const grR = grabbersR[ptRW.grabberIndex];
          const grRW = grabbersRW[ptRW.grabberIndex];
          if (grRW.enabled === 0) {
            ptRW.grabberIndex = -1;
          } else {
            Vector3.sub(ptRW.positionCurrent, grRW.position, tempVec0);
            Vector3.normalize(tempVec0, tempVec0);
            Vector3.scale(tempVec0, ptRW.grabberDistance, tempVec1);
            Vector3.add(grRW.position, tempVec1, tempVec1);
            Vector3.sub(tempVec1, ptRW.positionCurrent, tempVec0);
            Vector3.scale(tempVec0, grR.force, tempVec0);
            Vector3.add(ptRW.positionCurrent, tempVec0, ptRW.positionCurrent);
          }
        } else {
          let nearIndex = -1;
          let sqrNearRange = 1000 * 1000;
          for (let ig = 0; ig < grabbersR.length; ig++) {
            const grRW = grabbersRW[ig];
            if (grRW.enabled !== 0) {
              const sqrLen = Vector3.sub(grRW.position, ptRW.positionCurrent, tempVec0).magnitudeSq;
              if (sqrLen < grabbersR[ig].radius * grabbersR[ig].radius && sqrLen < sqrNearRange) {
                sqrNearRange = sqrLen;
                nearIndex = ig;
              }
            }
          }
          if (nearIndex !== -1) {
            ptRW.grabberIndex = nearIndex;
            ptRW.grabberDistance = Math.sqrt(sqrNearRange) / 2.0;
          }
        }
        // Movable limit
        if (ptR.movableLimitIndex !== -1) {
          const target = movableLimitTargets[ptR.movableLimitIndex];
          const move = Vector3.sub(ptRW.positionCurrent, target, tempVec0);
          const moveLen = move.magnitude;
          if (moveLen > ptR.movableLimitRadius) {
            Vector3.scale(move, ptR.movableLimitRadius / moveLen, move);
            Vector3.add(target, move, ptRW.positionCurrent);
          }
        }
      }

      // Flat plane collision
      for (let i = 0; i < flatPlanes.length; i++) {
        const fp = flatPlanes[i];
        const dist = Vector3.dot(fp.normal, ptRW.positionCurrent) + fp.distance;
        if (dist < 0) {
          Vector3.scale(fp.normal, dist, planeOffset);
          Vector3.sub(ptRW.positionCurrent, planeOffset, ptRW.positionCurrent);
          ptRW.friction = 0.3;
        }
      }
    }
  }
}

// Core physics simulation - direct port of JobExecuteSimulation from SPCRJointDynamicsJob.cs

function surfaceCollision(
  pointsRW: PointRW[],
  collidersR: readonly ColliderR[],
  collidersRW: ColliderRW[],
  surfaceConstraints: readonly number[]
) {
  const surfaceResult: SurfaceCheckResult = {
    hit: false,
    intersectionPoint: new Vector3(),
    pushOut: new Vector3(),
    pointOnCollider: new Vector3(),
    radius: 0
  };
  const triCenter = new Vector3();
  const pushDir = new Vector3();
  const centerToPt = new Vector3();
  const intersectToPt = new Vector3();
  const pushVec = new Vector3();
  for (let index = 0; index < surfaceConstraints.length; index += 6) {
    for (let i = 0; i < collidersR.length; i++) {
      const colR = collidersR[i];
      const colRW = collidersRW[i];
      if (colRW.enabled === 0) {
        continue;
      }

      const colliderPos = colRW.positionCurrent;

      for (let j = 0; j < 6; j += 3) {
        const idxA = surfaceConstraints[index + j + 0];
        const idxB = surfaceConstraints[index + j + 1];
        const idxC = surfaceConstraints[index + j + 2];

        const rwA = pointsRW[idxA];
        const rwB = pointsRW[idxB];
        const rwC = pointsRW[idxC];

        const result = checkSurfaceCollision(
          rwA.positionCurrent,
          rwB.positionCurrent,
          rwC.positionCurrent,
          colliderPos,
          colR,
          colRW,
          surfaceResult
        );

        if (result.hit) {
          triCenter.setXYZ(
            (rwA.positionCurrent.x + rwB.positionCurrent.x + rwC.positionCurrent.x) / 3,
            (rwA.positionCurrent.y + rwB.positionCurrent.y + rwC.positionCurrent.y) / 3,
            (rwA.positionCurrent.z + rwB.positionCurrent.z + rwC.positionCurrent.z) / 3
          );
          const pushMag = result.pushOut.magnitude;
          if (pushMag < EPSILON) {
            continue;
          }
          Vector3.scale(result.pushOut, 1 / pushMag, pushDir);

          for (let k = 0; k < 3; k++) {
            const idxR = surfaceConstraints[index + j + k];
            const rwPt = pointsRW[idxR];
            Vector3.sub(rwPt.positionCurrent, triCenter, centerToPt);
            Vector3.sub(rwPt.positionCurrent, result.intersectionPoint, intersectToPt);
            const intersectLen = intersectToPt.magnitude;
            let rate = intersectLen > EPSILON ? centerToPt.magnitude / intersectLen : 0;
            rate = clamp01(Math.abs(rate));
            Vector3.scale(pushDir, (result.radius - pushMag) * rate, pushVec);
            Vector3.add(rwPt.positionCurrent, pushVec, rwPt.positionCurrent);
          }
        }
      }
    }
  }
}

const _postFixNormal = new Vector3();
const _fixedPushResult: CollisionResult = { hit: false, point: new Vector3() };

/**
 * Before constraint solving each substep, push fixed points (weight=0) out of
 * any colliders they animate into.  Fixed points normally follow animation
 * exactly, but when their animated position lies inside a collider the distance
 * constraint pulls free children inward through the surface, producing the
 * classic "hair flipping outward" artifact.
 *
 * We clamp positionCurrent to the collider surface so that constraints operate
 * from a geometrically valid anchor.  The temporary change is overwritten at the
 * start of the next substep when positionCurrent is refreshed from the animation
 * transform, so the skeleton itself is never permanently altered.
 */
function fixedPointColliderPushout(
  pointsR: readonly PointR[],
  pointsRW: PointRW[],
  collidersR: readonly ColliderR[],
  collidersRW: readonly ColliderRW[]
): void {
  for (let pi = 0; pi < pointsR.length; pi++) {
    if (pointsR[pi].weight > EPSILON) {
      continue;
    }
    const ptRW = pointsRW[pi];
    const ptR = pointsR[pi];
    for (let ci = 0; ci < collidersR.length; ci++) {
      const colR = collidersR[ci];
      const colRW = collidersRW[ci];
      if (colRW.enabled === 0 || colR.isInverseCollider) {
        continue;
      }
      const res =
        colR.height <= EPSILON
          ? pushoutFromSphere(
              colRW.positionCurrent,
              colRW.radius,
              ptR.pointRadius,
              ptRW.positionCurrent,
              _fixedPushResult
            )
          : pushoutFromCapsule(colR, colRW, ptRW.positionCurrent, ptR, _fixedPushResult);
      if (res.hit) {
        ptRW.positionCurrent.set(res.point);
      }
    }
  }
}

/**
 * Called once per substep after ALL constraint + collision relaxation iterations finish.
 * For each dynamic point that is actually touching a collider surface (within radius),
 * cancel the normal-direction component of the Verlet velocity from positionPrevious.
 * Points far from all colliders are untouched, preserving wind-driven velocity.
 */
function postCollisionVelocityFix(
  pointsR: readonly PointR[],
  pointsRW: PointRW[],
  collidersR: readonly ColliderR[],
  collidersRW: readonly ColliderRW[]
): void {
  for (let pi = 0; pi < pointsR.length; pi++) {
    const ptR = pointsR[pi];
    if (ptR.weight <= EPSILON) {
      continue;
    }
    const ptRW = pointsRW[pi];

    for (let ci = 0; ci < collidersR.length; ci++) {
      const colR = collidersR[ci];
      const colRW = collidersRW[ci];
      if (colRW.enabled === 0 || colR.isInverseCollider) {
        continue;
      }

      let nx = 0,
        ny = 0,
        nz = 0;
      if (colR.height <= EPSILON) {
        nx = ptRW.positionCurrent.x - colRW.positionCurrent.x;
        ny = ptRW.positionCurrent.y - colRW.positionCurrent.y;
        nz = ptRW.positionCurrent.z - colRW.positionCurrent.z;
      } else {
        const capsuleVec = colRW.directionCurrent;
        const capsuleVecLenSq = capsuleVec.magnitudeSq;
        if (capsuleVecLenSq > EPSILON) {
          const tx = ptRW.positionCurrent.x - colRW.positionCurrent.x;
          const ty = ptRW.positionCurrent.y - colRW.positionCurrent.y;
          const tz = ptRW.positionCurrent.z - colRW.positionCurrent.z;
          const t = Math.max(
            0,
            Math.min(1, (tx * capsuleVec.x + ty * capsuleVec.y + tz * capsuleVec.z) / capsuleVecLenSq)
          );
          nx = ptRW.positionCurrent.x - (colRW.positionCurrent.x + capsuleVec.x * t);
          ny = ptRW.positionCurrent.y - (colRW.positionCurrent.y + capsuleVec.y * t);
          nz = ptRW.positionCurrent.z - (colRW.positionCurrent.z + capsuleVec.z * t);
        } else {
          nx = ptRW.positionCurrent.x - colRW.positionCurrent.x;
          ny = ptRW.positionCurrent.y - colRW.positionCurrent.y;
          nz = ptRW.positionCurrent.z - colRW.positionCurrent.z;
        }
      }

      const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nLen < EPSILON) {
        continue;
      }

      const surfaceDist = nLen - colRW.radius - ptR.pointRadius;
      if (surfaceDist > colRW.radius * 0.05) {
        continue;
      }

      _postFixNormal.setXYZ(nx / nLen, ny / nLen, nz / nLen);
      const vx = ptRW.positionCurrent.x - ptRW.positionPrevious.x;
      const vy = ptRW.positionCurrent.y - ptRW.positionPrevious.y;
      const vz = ptRW.positionCurrent.z - ptRW.positionPrevious.z;
      const vDotN = vx * _postFixNormal.x + vy * _postFixNormal.y + vz * _postFixNormal.z;
      if (vDotN < 0) {
        ptRW.positionPrevious.x += _postFixNormal.x * vDotN;
        ptRW.positionPrevious.y += _postFixNormal.y * vDotN;
        ptRW.positionPrevious.z += _postFixNormal.z * vDotN;
      }
    }
  }
}

function constraintUpdate(
  pointsR: readonly PointR[],
  pointsRW: PointRW[],
  constraints: readonly Constraint[],
  collidersR: readonly ColliderR[],
  collidersRW: ColliderRW[],
  constraintShrinkLimit: number,
  enableBroadPhase: boolean
) {
  const direction = new Vector3();
  const dirN = new Vector3();
  const disp = new Vector3();
  const scaledDisp = new Vector3();
  const pointResultA: CollisionResult = { hit: false, point: new Vector3() };
  const pointResultB: CollisionResult = { hit: false, point: new Vector3() };
  const lineResult = {
    hit: false,
    pointOnLine: new Vector3(),
    pointOnCollider: new Vector3(),
    radius: 0
  };
  const pushout = new Vector3();
  const segment = new Vector3();
  const pointToA = new Vector3();
  const pointToB = new Vector3();
  const pushN = new Vector3();
  const pushVec = new Vector3();
  for (let index = 0; index < constraints.length; index++) {
    const c = constraints[index];
    const ptRA = pointsR[c.indexA];
    const ptRB = pointsR[c.indexB];
    const weightA = ptRA.weight;
    const weightB = ptRB.weight;
    if (weightA <= EPSILON && weightB <= EPSILON) {
      continue;
    }

    const rwA = pointsRW[c.indexA];
    const rwB = pointsRW[c.indexB];

    Vector3.sub(rwB.positionCurrent, rwA.positionCurrent, direction);
    const distance = direction.magnitude;

    let shrinkLen = c.length;
    let stretchLen = shrinkLen;
    if (
      c.type === ConstraintType.Structural_Horizontal ||
      c.type === ConstraintType.Bending_Horizontal ||
      c.type === ConstraintType.Shear
    ) {
      stretchLen += ptRA.sliderJointLength + ptRB.sliderJointLength;
    }

    let force = 0;
    if (distance <= shrinkLen) {
      force = distance - shrinkLen;
    } else if (distance >= stretchLen) {
      force = distance - stretchLen;
    }

    const isShrink = force >= 0;
    let power = 0;
    switch (c.type) {
      case ConstraintType.Structural_Vertical:
        power = isShrink
          ? ptRA.structuralShrinkVertical + ptRB.structuralShrinkVertical
          : ptRA.structuralStretchVertical + ptRB.structuralStretchVertical;
        break;
      case ConstraintType.Structural_Horizontal:
        power = isShrink
          ? Math.min(constraintShrinkLimit, ptRA.structuralShrinkHorizontal + ptRB.structuralShrinkHorizontal)
          : ptRA.structuralStretchHorizontal + ptRB.structuralStretchHorizontal;
        break;
      case ConstraintType.Shear:
        power = isShrink
          ? Math.min(constraintShrinkLimit, ptRA.shearShrink + ptRB.shearShrink)
          : ptRA.shearStretch + ptRB.shearStretch;
        break;
      case ConstraintType.Bending_Vertical:
        power = isShrink
          ? ptRA.bendingShrinkVertical + ptRB.bendingShrinkVertical
          : ptRA.bendingStretchVertical + ptRB.bendingStretchVertical;
        break;
      case ConstraintType.Bending_Horizontal:
        power = isShrink
          ? Math.min(constraintShrinkLimit, ptRA.bendingShrinkHorizontal + ptRB.bendingShrinkHorizontal)
          : ptRA.bendingStretchHorizontal + ptRB.bendingStretchHorizontal;
        break;
    }

    if (power > 0) {
      if (distance > EPSILON) {
        Vector3.scale(direction, 1 / distance, dirN);
      } else {
        dirN.setXYZ(0, 0, 0);
      }
      Vector3.scale(dirN, force * power, disp);
      const wAB = weightA + weightB;
      Vector3.scale(disp, weightA / wAB, scaledDisp);
      Vector3.add(rwA.positionCurrent, scaledDisp, rwA.positionCurrent);
      Vector3.scale(disp, weightB / wAB, scaledDisp);
      Vector3.sub(rwB.positionCurrent, scaledDisp, rwB.positionCurrent);
    }

    // Per-constraint collision
    if (c.isCollision !== 0) {
      let friction = 0;
      for (let i = 0; i < collidersR.length; i++) {
        const colRW = collidersRW[i];
        if (colRW.enabled === 0) {
          continue;
        }
        const colR = collidersR[i];
        const canPointA =
          !enableBroadPhase ||
          colR.isInverseCollider ||
          pointMayCollideBroadPhase(rwA.positionCurrent, colRW, ptRA.pointRadius);
        const canPointB =
          !enableBroadPhase ||
          colR.isInverseCollider ||
          pointMayCollideBroadPhase(rwB.positionCurrent, colRW, ptRB.pointRadius);
        const canLine =
          !colR.isInverseCollider &&
          (!enableBroadPhase || segmentMayCollideBroadPhase(rwA.positionCurrent, rwB.positionCurrent, colRW));

        if (!canPointA && !canPointB && !canLine) {
          continue;
        }

        if (colR.height > EPSILON) {
          if (colR.isInverseCollider) {
            if (ptRA.applyInvertCollision === 1 && canPointA) {
              const res = pushInFromCapsule(colR, colRW, rwA.positionCurrent, pointResultA);
              if (res.hit) {
                rwA.positionCurrent.set(res.point);
                friction = Math.max(friction, colR.friction * 0.25);
              }
            }
            if (ptRB.applyInvertCollision === 1 && canPointB) {
              const res = pushInFromCapsule(colR, colRW, rwB.positionCurrent, pointResultB);
              if (res.hit) {
                rwB.positionCurrent.set(res.point);
                friction = Math.max(friction, colR.friction * 0.25);
              }
            }
          } else {
            if (canPointA) {
              const res = pushoutFromCapsule(colR, colRW, rwA.positionCurrent, ptRA, pointResultA);
              if (res.hit) {
                rwA.positionCurrent.set(res.point);
                friction = Math.max(friction, colR.friction * 0.25);
              }
            }
            if (canPointB) {
              const res = pushoutFromCapsule(colR, colRW, rwB.positionCurrent, ptRB, pointResultB);
              if (res.hit) {
                rwB.positionCurrent.set(res.point);
                friction = Math.max(friction, colR.friction * 0.25);
              }
            }
          }
        } else {
          if (colR.isInverseCollider) {
            if (ptRA.applyInvertCollision === 1 && canPointA) {
              const res = pushInFromSphere(
                colRW.positionCurrent,
                colRW.radius,
                rwA.positionCurrent,
                pointResultA
              );
              if (res.hit) {
                rwA.positionCurrent.set(res.point);
                friction = Math.max(friction, colR.friction * 0.25);
              }
            }
            if (ptRB.applyInvertCollision === 1 && canPointB) {
              const res = pushInFromSphere(
                colRW.positionCurrent,
                colRW.radius,
                rwB.positionCurrent,
                pointResultB
              );
              if (res.hit) {
                rwB.positionCurrent.set(res.point);
                friction = Math.max(friction, colR.friction * 0.25);
              }
            }
          } else {
            if (canPointA) {
              const res = pushoutFromSphere(
                colRW.positionCurrent,
                colRW.radius,
                ptRA.pointRadius,
                rwA.positionCurrent,
                pointResultA
              );
              if (res.hit) {
                rwA.positionCurrent.set(res.point);
                friction = Math.max(friction, colR.friction * 0.25);
              }
            }
            if (canPointB) {
              const res = pushoutFromSphere(
                colRW.positionCurrent,
                colRW.radius,
                ptRB.pointRadius,
                rwB.positionCurrent,
                pointResultB
              );
              if (res.hit) {
                rwB.positionCurrent.set(res.point);
                friction = Math.max(friction, colR.friction * 0.25);
              }
            }
          }
        }

        // Line segment collision
        if (!colR.isInverseCollider && canLine) {
          const lineRes = collisionDetection(
            colR,
            colRW,
            rwA.positionCurrent,
            rwB.positionCurrent,
            lineResult
          );
          if (lineRes.hit) {
            Vector3.sub(lineRes.pointOnLine, lineRes.pointOnCollider, pushout);
            const pushDist = pushout.magnitude;
            if (pushDist > EPSILON) {
              const ptDist = Vector3.sub(rwB.positionCurrent, rwA.positionCurrent, segment).magnitude * 0.5;
              const rateP1 =
                ptDist > EPSILON
                  ? clamp01(
                      Vector3.sub(lineRes.pointOnLine, rwA.positionCurrent, pointToA).magnitude / ptDist
                    )
                  : 0;
              const rateP2 =
                ptDist > EPSILON
                  ? clamp01(
                      Vector3.sub(lineRes.pointOnLine, rwB.positionCurrent, pointToB).magnitude / ptDist
                    )
                  : 0;
              Vector3.scale(pushout, 1 / pushDist, pushN);
              Vector3.scale(pushN, Math.max(lineRes.radius - pushDist, 0), pushVec);
              if (weightA > EPSILON) {
                Vector3.scale(pushVec, rateP2, scaledDisp);
                Vector3.add(rwA.positionCurrent, scaledDisp, rwA.positionCurrent);
              }
              if (weightB > EPSILON) {
                Vector3.scale(pushVec, rateP1, scaledDisp);
                Vector3.add(rwB.positionCurrent, scaledDisp, rwB.positionCurrent);
              }

              const dotUp = Vector3.dot(AXIS_Y, Vector3.normalize(pushout, pushN));
              friction = Math.max(friction, colR.friction * clamp01(dotUp));
            }
          }
        }
      }
      rwA.friction = Math.max(friction, rwA.friction);
      rwB.friction = Math.max(friction, rwB.friction);
    }
  }
}

function pointUpdatePass2(
  pointsR: readonly PointR[],
  pointsRW: PointRW[],
  positionsToTransform: Vector3[],
  stepDelta: number,
  fakeWaveFreq: number,
  blendRatio: number,
  isFakeWave: boolean,
  fakeWavePower: number
) {
  let freq = fakeWaveFreq;
  const curTransformPos = new Vector3();
  const fakeWindOffset = new Vector3();
  for (let index = 0; index < pointsR.length; index++) {
    const ptR = pointsR[index];
    const ptRW = pointsRW[index];

    Vector3.lerp(ptRW.positionPreviousTransform, ptRW.positionCurrentTransform, stepDelta, curTransformPos);
    const blend = smoothStep(0, 1, Math.max(ptR.forceFadeRatio, blendRatio));
    Vector3.lerp(ptRW.positionCurrent, curTransformPos, blend, ptRW.positionToTransform);

    if (isFakeWave && ptR.child === -1 && ptR.parent !== -1) {
      const A = pointsRW[ptR.parent].positionToTransform;
      const B = ptRW.positionToTransform;
      const mAxis = Matrix4x4.lookAt(A, B, AXIS_Y);
      // Column 1 = up axis of the look-at matrix
      const col1 = mAxis.getCol(1).xyz();
      Vector3.lerp(ptRW.fakeWindDirection, col1, 0.5, ptRW.fakeWindDirection);

      freq += ptR.fakeWaveFreq;
      const power = Math.sin(freq) * fakeWavePower * ptR.fakeWavePower;
      Vector3.scale(ptRW.fakeWindDirection, power, fakeWindOffset);
      Vector3.add(ptRW.positionToTransform, fakeWindOffset, ptRW.positionToTransform);
    }

    positionsToTransform[index] = ptRW.positionToTransform.clone();
  }
}

/**
 * Output of applying the simulated result back to transforms.
 *
 * @public
 */
export interface ApplyResultOutput {
  position: Vector3;
  rotation: Quaternion;
  localRotation: Quaternion;
}

/**
 * Computes transform outputs from the simulated point positions.
 *
 * @public
 */
export function applyResult(
  pointsR: readonly PointR[],
  pointsRW: PointRW[],
  positionsToTransform: readonly Vector3[],
  blendRatio: number,
  // Current transform rotations (world and local) read from engine
  transformRotations: readonly Quaternion[],
  transformLocalRotations: readonly Quaternion[],
  preserveTwist: boolean
): ApplyResultOutput[] {
  const results: ApplyResultOutput[] = new Array(pointsR.length);

  for (let index = 0; index < pointsR.length; index++) {
    const ptR = pointsR[index];
    const ptRW = pointsRW[index];
    let worldRot = transformRotations[index];
    let localRot = transformLocalRotations[index];

    if (ptR.weight >= EPSILON) {
      // Dynamic point
      if (ptR.parent !== -1) {
        const direction = Vector3.sub(ptRW.positionToTransform, positionsToTransform[ptR.parent]);
        const realLen = direction.magnitude;
        if (realLen > EPSILON) {
          ptRW.directionPrevious = direction;
        } else {
          ptRW.positionToTransform = Vector3.add(positionsToTransform[ptR.parent], ptRW.directionPrevious);
        }
      }
      const pos = ptRW.positionToTransform;
      // SetRotation with blendRatio=0 for dynamic points
      // Step 1: Reset localRotation to initialLocalRotation (blendRatio = 0 means fully initial)
      localRot = ptR.initialLocalRotation.clone();

      // Step 2: Recompute worldRot from the new localRot
      // In C#, setting localRotation immediately updates the world rotation.
      // worldRot = parentWorldRot * localRot
      // We approximate: the parent's current world rotation is in transformRotations[ptR.parent]
      if (ptR.parent !== -1) {
        // Use the parent's OUTPUT rotation (already computed if parent index < current index)
        const parentRot = results[ptR.parent] ? results[ptR.parent].rotation : transformRotations[ptR.parent];
        worldRot = Quaternion.multiply(parentRot, localRot);
      } else {
        worldRot = localRot.clone();
      }

      // Step 3: Aim toward child (simple shortest-arc, no twist correction here)
      if (ptR.child !== -1) {
        const childDir = Vector3.sub(positionsToTransform[ptR.child], ptRW.positionToTransform);
        if (childDir.magnitudeSq > EPSILON) {
          const aimVec = worldRot.transform(ptR.boneAxis);
          const aimRot = Quaternion.unitVectorToUnitVector(aimVec, childDir);
          Quaternion.multiply(aimRot, worldRot, worldRot);
        }
      }
      results[index] = {
        position: pos,
        rotation: worldRot,
        localRotation: localRot
      };
    } else {
      const childBlend =
        ptR.child !== -1 ? Math.max(pointsR[ptR.child].forceFadeRatio, blendRatio) : blendRatio;

      // Fixed joints are fully driven by the scene graph (animation + parent transforms).
      // Use the engine's current world rotation directly as the baseline �?do NOT
      // reconstruct it from localRot, because localRot was read from the transform that
      // was written back last frame (after aim correction), so it carries stale physics
      // noise that would accumulate each frame and cause periodic spin artifacts.
      // transformRotations[index] is read before applyResult runs, so it still holds
      // the correct animated world rotation for this frame.
      worldRot = transformRotations[index];

      // Aim toward simulated child position, blended back toward the animated direction.
      if (ptR.child !== -1) {
        const childDir = Vector3.sub(positionsToTransform[ptR.child], ptRW.positionToTransform);
        if (childDir.magnitudeSq > EPSILON) {
          const aimVec = worldRot.transform(ptR.boneAxis);
          const aimRot = Quaternion.unitVectorToUnitVector(aimVec, childDir);
          worldRot = Quaternion.slerp(Quaternion.multiply(aimRot, worldRot), worldRot, childBlend);
        }
      }
      results[index] = {
        position: ptRW.positionCurrentTransform,
        rotation: worldRot,
        localRotation: localRot
      };
    }
  }

  // Post-process: twist correction pass (parent �?child order).
  if (preserveTwist) {
    for (let index = 0; index < pointsR.length; index++) {
      const ptR = pointsR[index];
      if (ptR.weight < EPSILON || ptR.child === -1) {
        continue;
      }
      const result = results[index];
      const parentWorldRot = ptR.parent !== -1 ? results[ptR.parent].rotation : Quaternion.identity();
      const effectiveLocal = Quaternion.multiply(Quaternion.inverse(parentWorldRot), result.rotation);
      const curTwist = new Quaternion();
      effectiveLocal.decomposeSwingTwist(ptR.boneAxis, undefined, curTwist);
      const swingTF = Quaternion.multiply(effectiveLocal, Quaternion.inverse(curTwist));
      const correctedLocal = Quaternion.multiply(swingTF, ptR.initialLocalTwist);
      Quaternion.multiply(parentWorldRot, correctedLocal, result.rotation);
    }
  }

  return results;
}

/**
 * Applies post-simulation angle limits to the point state.
 *
 * @public
 */
export function applyAngleLimits(
  pointsR: readonly PointR[],
  pointsRW: PointRW[],
  config: AngleLimitConfig
): void {
  if (config.angleLimit < 0) {
    return;
  }

  for (let index = 0; index < pointsR.length; index++) {
    const ptR = pointsR[index];
    if (ptR.parent === -1) {
      continue;
    }
    const ptRW = pointsRW[index];

    const ptRp = pointsR[ptR.parent];
    const ptRWp = pointsRW[ptR.parent];

    const superParentPos = ptRp.parent !== -1 ? pointsRW[ptRp.parent].positionCurrent : ptRWp.positionCurrent;

    const boneDir = Vector3.sub(ptRW.positionCurrent, ptRWp.positionCurrent);
    let parentBoneDir = Vector3.sub(ptRWp.positionCurrent, superParentPos);

    if (parentBoneDir.magnitude === 0 || config.limitFromRoot) {
      parentBoneDir = Vector3.sub(ptRW.positionCurrentTransform, ptRWp.positionCurrentTransform);
    }

    const angle = Vector3.angleBetween(parentBoneDir, boneDir);
    const remaining = radian2degree(angle) - config.angleLimit;

    if (remaining > 0) {
      const axis = Vector3.cross(parentBoneDir, boneDir);
      const rotated = Quaternion.fromAxisAngle(axis, degree2radian(-remaining)).transform(boneDir);
      ptRW.positionCurrent = Vector3.add(ptRWp.positionCurrent, rotated);
    }
  }
}
