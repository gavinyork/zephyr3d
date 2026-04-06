// Core physics simulation — direct port of JobExecuteSimulation from SPCRJointDynamicsJob.cs

import { Quaternion, Vector3, Matrix4x4, degree2radian, radian2degree } from '@zephyr3d/base';
import { clamp01, smoothStep } from './math';
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
  checkSurfaceCollision
} from './collision';

/** Parameters for a single simulation step */
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
  /** Triangle indices for surface collision (6 per quad: 2 triangles × 3 indices) */
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
}

/**
 * Run the full simulation step. Mutates pointsRW and collidersRW in place.
 * Returns { positionsToTransform, fakeWaveCounter }.
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
    let rotateAxis = new Vector3();
    if (!isFinite(rotateAxis.x) || !isFinite(rotateAxis.y) || !isFinite(rotateAxis.z)) {
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

    colliderUpdate(collidersR, collidersRW, stepDelta, params.collisionScale);
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
      flatPlanes
    );

    if (!params.isPaused) {
      fakeWaveFreq += params.fakeWaveSpeed * stepTime;

      if (params.enableSurfaceCollision) {
        surfaceCollision(pointsRW, collidersR, collidersRW, params.surfaceConstraints);
      }

      for (let iRelax = params.relaxation - 1; iRelax >= 0; --iRelax) {
        constraintUpdate(
          pointsR,
          pointsRW,
          constraints,
          collidersR,
          collidersRW,
          params.constraintShrinkLimit
        );
      }
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

// ── Collider interpolation ──

function computeCapsule(
  pos: Vector3,
  rot: Quaternion,
  height: number
): { head: Vector3; direction: Vector3 } {
  const dir = rot.transform(Vector3.scale(Vector3.axisPY(), height));
  const head = Vector3.sub(pos, Vector3.scale(dir, 0.5));
  return { head, direction: dir };
}

function colliderUpdate(
  collidersR: readonly ColliderR[],
  collidersRW: ColliderRW[],
  stepDelta: number,
  collisionScale: number
) {
  for (let i = 0; i < collidersR.length; i++) {
    const colR = collidersR[i];
    const colRW = collidersRW[i];
    colRW.radius = colR.radius * collisionScale;

    const curPos = Vector3.lerp(colRW.positionPreviousTransform, colRW.positionCurrentTransform, stepDelta);
    const curDir = Quaternion.slerp(
      colRW.directionPreviousTransform,
      colRW.directionCurrentTransform,
      stepDelta
    );

    const cap = computeCapsule(curPos, curDir, colR.height);
    colRW.positionCurrent = cap.head;
    colRW.directionCurrent = cap.direction;

    // Update local bounds
    const corner = Vector3.scale(Vector3.one(), colR.radius);
    const center = colRW.worldToLocal.transformPointAffine(colRW.positionCurrent);
    colRW.localBoundsMin = Vector3.sub(center, corner);
    colRW.localBoundsMax = Vector3.add(center, corner);

    if (colR.height > EPSILON) {
      const tailCorner = Vector3.scale(Vector3.one(), colR.radius * colR.radiusTailScale);
      const tailCenter = colRW.worldToLocal.transformPointAffine(
        Vector3.add(colRW.positionCurrent, colRW.directionCurrent)
      );
      colRW.localBoundsMin = new Vector3(
        Math.min(colRW.localBoundsMin.x, tailCenter.x - tailCorner.x),
        Math.min(colRW.localBoundsMin.y, tailCenter.y - tailCorner.y),
        Math.min(colRW.localBoundsMin.z, tailCenter.z - tailCorner.z)
      );
      colRW.localBoundsMax = new Vector3(
        Math.max(colRW.localBoundsMax.x, tailCenter.x + tailCorner.x),
        Math.max(colRW.localBoundsMax.y, tailCenter.y + tailCorner.y),
        Math.max(colRW.localBoundsMax.z, tailCenter.z + tailCorner.z)
      );
    }
  }
}

// ── Apply root motion transform ──

function applySystemTransform(
  point: Vector3,
  pivot: Vector3,
  slideOffset: Vector3,
  rotOffset: Quaternion
): Vector3 {
  const rotated = rotOffset.transform(Vector3.sub(point, pivot));
  return Vector3.add(Vector3.add(rotated, pivot), slideOffset);
}

// ── Pass 1: Verlet integration + forces ──

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
  flatPlanes: readonly FlatPlane[]
) {
  for (let index = 0; index < pointsR.length; index++) {
    const ptR = pointsR[index];
    const ptRW = pointsRW[index];

    const currentTransformPos = Vector3.lerp(
      ptRW.positionPreviousTransform,
      ptRW.positionCurrentTransform,
      stepDelta
    );

    if (ptR.weight <= EPSILON) {
      ptRW.positionPrevious = ptRW.positionCurrent.clone();
      ptRW.positionCurrent = currentTransformPos;
    } else {
      ptRW.positionPrevious = applySystemTransform(
        ptRW.positionPrevious,
        rootPosition,
        rootSlideOffset,
        rootRotationOffset
      );
      ptRW.positionCurrent = applySystemTransform(
        ptRW.positionCurrent,
        rootPosition,
        rootSlideOffset,
        rootRotationOffset
      );

      let displacement = Vector3.zero();
      if (!isPaused) {
        const moveDir = Vector3.sub(ptRW.positionCurrent, ptRW.positionPrevious);
        let extForce = ptR.gravity.clone();
        extForce = Vector3.add(extForce, Vector3.scale(windForce, ptR.windForceScale / ptR.mass));
        extForce = Vector3.scale(extForce, stepTime_x2_half);

        displacement = Vector3.add(moveDir, extForce);
        displacement = Vector3.scale(displacement, ptR.resistance);
        displacement = Vector3.scale(displacement, 1.0 - clamp01(ptRW.friction * ptR.frictionScale));
      }

      ptRW.positionPrevious = ptRW.positionCurrent.clone();
      ptRW.positionCurrent = Vector3.add(ptRW.positionCurrent, displacement);
      ptRW.friction = 0;

      if (!isPaused) {
        // Hardness restore
        if (ptR.hardness > 0) {
          const restore = Vector3.scale(Vector3.sub(currentTransformPos, ptRW.positionCurrent), ptR.hardness);
          ptRW.positionCurrent = Vector3.add(ptRW.positionCurrent, restore);
        }
        // Force fade ratio
        if (ptR.forceFadeRatio > 0) {
          ptRW.positionCurrent = Vector3.lerp(ptRW.positionCurrent, currentTransformPos, ptR.forceFadeRatio);
        }
        // Grabber
        if (ptRW.grabberIndex !== -1) {
          const grR = grabbersR[ptRW.grabberIndex];
          const grRW = grabbersRW[ptRW.grabberIndex];
          if (grRW.enabled === 0) {
            ptRW.grabberIndex = -1;
          } else {
            const vec = Vector3.sub(ptRW.positionCurrent, grRW.position);
            const pos = Vector3.add(
              grRW.position,
              Vector3.scale(Vector3.normalize(vec), ptRW.grabberDistance)
            );
            ptRW.positionCurrent = Vector3.add(
              ptRW.positionCurrent,
              Vector3.scale(Vector3.sub(pos, ptRW.positionCurrent), grR.force)
            );
          }
        } else {
          let nearIndex = -1;
          let sqrNearRange = 1000 * 1000;
          for (let ig = 0; ig < grabbersR.length; ig++) {
            const grRW = grabbersRW[ig];
            if (grRW.enabled !== 0) {
              const vec = Vector3.sub(grRW.position, ptRW.positionCurrent);
              const sqrLen = vec.magnitudeSq;
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
          const move = Vector3.sub(ptRW.positionCurrent, target);
          const moveLen = move.magnitude;
          if (moveLen > ptR.movableLimitRadius) {
            ptRW.positionCurrent = Vector3.add(target, Vector3.scale(move, ptR.movableLimitRadius / moveLen));
          }
        }
      }

      // Flat plane collision
      for (let i = 0; i < flatPlanes.length; i++) {
        const fp = flatPlanes[i];
        const dist = Vector3.dot(fp.normal, ptRW.positionCurrent) + fp.distance;
        if (dist < 0) {
          ptRW.positionCurrent = Vector3.sub(ptRW.positionCurrent, Vector3.scale(fp.normal, dist));
          ptRW.friction = 0.3;
        }
      }
    }
  }
}

// ── Surface collision (triangle-based cloth collision) ──

function surfaceCollision(
  pointsRW: PointRW[],
  collidersR: readonly ColliderR[],
  collidersRW: ColliderRW[],
  surfaceConstraints: readonly number[]
) {
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
          colRW
        );

        if (result.hit) {
          const triCenter = Vector3.lerp(
            Vector3.lerp(rwA.positionCurrent, rwB.positionCurrent, 0.5),
            Vector3.lerp(rwA.positionCurrent, rwC.positionCurrent, 0.5),
            0.5
          );
          const pushMag = result.pushOut.magnitude;
          if (pushMag < EPSILON) {
            continue;
          }
          const pushDir = Vector3.scale(result.pushOut, 1 / pushMag);

          for (let k = 0; k < 3; k++) {
            const idxR = surfaceConstraints[index + j + k];
            const rwPt = pointsRW[idxR];
            const centerToPt = Vector3.sub(rwPt.positionCurrent, triCenter);
            const intersectToPt = Vector3.sub(rwPt.positionCurrent, result.intersectionPoint);
            const intersectLen = intersectToPt.magnitude;
            let rate = intersectLen > EPSILON ? centerToPt.magnitude / intersectLen : 0;
            rate = clamp01(Math.abs(rate));
            const pushVec = Vector3.scale(pushDir, (result.radius - pushMag) * rate);
            rwPt.positionCurrent = Vector3.add(rwPt.positionCurrent, pushVec);
          }
        }
      }
    }
  }
}

// ── Constraint relaxation ──

function constraintUpdate(
  pointsR: readonly PointR[],
  pointsRW: PointRW[],
  constraints: readonly Constraint[],
  collidersR: readonly ColliderR[],
  collidersRW: ColliderRW[],
  constraintShrinkLimit: number
) {
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

    const direction = Vector3.sub(rwB.positionCurrent, rwA.positionCurrent);
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
      const dirN = distance > EPSILON ? Vector3.scale(direction, 1 / distance) : Vector3.zero();
      const disp = Vector3.scale(dirN, force * power);
      const wAB = weightA + weightB;
      rwA.positionCurrent = Vector3.add(rwA.positionCurrent, Vector3.scale(disp, weightA / wAB));
      rwB.positionCurrent = Vector3.sub(rwB.positionCurrent, Vector3.scale(disp, weightB / wAB));
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

        if (colR.height > EPSILON) {
          if (colR.isInverseCollider) {
            if (ptRA.applyInvertCollision === 1) {
              const res = pushInFromCapsule(colR, colRW, rwA.positionCurrent);
              if (res.hit) {
                rwA.positionCurrent = res.point;
                friction = Math.max(friction, colR.friction * 0.25);
              }
            }
            if (ptRB.applyInvertCollision === 1) {
              const res = pushInFromCapsule(colR, colRW, rwB.positionCurrent);
              if (res.hit) {
                rwB.positionCurrent = res.point;
                friction = Math.max(friction, colR.friction * 0.25);
              }
            }
          } else {
            let res = pushoutFromCapsule(colR, colRW, rwA.positionCurrent, ptRA);
            if (res.hit) {
              rwA.positionCurrent = res.point;
              friction = Math.max(friction, colR.friction * 0.25);
            }
            res = pushoutFromCapsule(colR, colRW, rwB.positionCurrent, ptRB);
            if (res.hit) {
              rwB.positionCurrent = res.point;
              friction = Math.max(friction, colR.friction * 0.25);
            }
          }
        } else {
          if (colR.isInverseCollider) {
            if (ptRA.applyInvertCollision === 1) {
              const res = pushInFromSphere(colRW.positionCurrent, colRW.radius, rwA.positionCurrent);
              if (res.hit) {
                rwA.positionCurrent = res.point;
                friction = Math.max(friction, colR.friction * 0.25);
              }
            }
            if (ptRB.applyInvertCollision === 1) {
              const res = pushInFromSphere(colRW.positionCurrent, colRW.radius, rwB.positionCurrent);
              if (res.hit) {
                rwB.positionCurrent = res.point;
                friction = Math.max(friction, colR.friction * 0.25);
              }
            }
          } else {
            let res = pushoutFromSphere(
              colRW.positionCurrent,
              colRW.radius,
              ptRA.pointRadius,
              rwA.positionCurrent
            );
            if (res.hit) {
              rwA.positionCurrent = res.point;
              friction = Math.max(friction, colR.friction * 0.25);
            }
            res = pushoutFromSphere(
              colRW.positionCurrent,
              colRW.radius,
              ptRB.pointRadius,
              rwB.positionCurrent
            );
            if (res.hit) {
              rwB.positionCurrent = res.point;
              friction = Math.max(friction, colR.friction * 0.25);
            }
          }
        }

        // Line segment collision
        if (!colR.isInverseCollider) {
          const lineRes = collisionDetection(colR, colRW, rwA.positionCurrent, rwB.positionCurrent);
          if (lineRes.hit) {
            const pushout = Vector3.sub(lineRes.pointOnLine, lineRes.pointOnCollider);
            const pushDist = pushout.magnitude;
            if (pushDist > EPSILON) {
              const ptDist = Vector3.sub(rwB.positionCurrent, rwA.positionCurrent).magnitude * 0.5;
              const rateP1 =
                ptDist > EPSILON
                  ? clamp01(Vector3.sub(lineRes.pointOnLine, rwA.positionCurrent).magnitude / ptDist)
                  : 0;
              const rateP2 =
                ptDist > EPSILON
                  ? clamp01(Vector3.sub(lineRes.pointOnLine, rwB.positionCurrent).magnitude / ptDist)
                  : 0;
              const pushN = Vector3.scale(pushout, 1 / pushDist);
              const pushVec = Vector3.scale(pushN, Math.max(lineRes.radius - pushDist, 0));
              if (weightA > EPSILON) {
                rwA.positionCurrent = Vector3.add(rwA.positionCurrent, Vector3.scale(pushVec, rateP2));
              }
              if (weightB > EPSILON) {
                rwB.positionCurrent = Vector3.add(rwB.positionCurrent, Vector3.scale(pushVec, rateP1));
              }

              const dotUp = Vector3.dot(Vector3.axisPY(), Vector3.normalize(pushout));
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

// ── Pass 2: blend + fake wave ──

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
  for (let index = 0; index < pointsR.length; index++) {
    const ptR = pointsR[index];
    const ptRW = pointsRW[index];

    const curTransformPos = Vector3.lerp(
      ptRW.positionPreviousTransform,
      ptRW.positionCurrentTransform,
      stepDelta
    );
    const blend = smoothStep(0, 1, Math.max(ptR.forceFadeRatio, blendRatio));
    ptRW.positionToTransform = Vector3.lerp(ptRW.positionCurrent, curTransformPos, blend);

    if (isFakeWave && ptR.child === -1 && ptR.parent !== -1) {
      const A = pointsRW[ptR.parent].positionToTransform;
      const B = ptRW.positionToTransform;
      const mAxis = Matrix4x4.lookAt(A, B, Vector3.axisPY());
      // Column 1 = up axis of the look-at matrix
      const col1 = mAxis.getCol(1).xyz();
      ptRW.fakeWindDirection = Vector3.lerp(ptRW.fakeWindDirection, col1, 0.5);

      freq += ptR.fakeWaveFreq;
      const power = Math.sin(freq) * fakeWavePower * ptR.fakeWavePower;
      ptRW.positionToTransform = Vector3.add(
        ptRW.positionToTransform,
        Vector3.scale(ptRW.fakeWindDirection, power)
      );
    }

    positionsToTransform[index] = ptRW.positionToTransform.clone();
  }
}

// ── Apply simulation result to transforms ──

export interface ApplyResultOutput {
  position: Vector3;
  rotation: Quaternion;
  localRotation: Quaternion;
}

export function applyResult(
  pointsR: readonly PointR[],
  pointsRW: PointRW[],
  positionsToTransform: readonly Vector3[],
  blendRatio: number,
  // Current transform rotations (world and local) read from engine
  transformRotations: readonly Quaternion[],
  transformLocalRotations: readonly Quaternion[]
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
      // Step 1: Reset localRotation → initialLocalRotation (blendRatio=0 → fully initial)
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

      // Step 3: Aim toward child using updated worldRot
      if (ptR.child !== -1) {
        const childDir = Vector3.sub(positionsToTransform[ptR.child], ptRW.positionToTransform);
        if (childDir.magnitudeSq > EPSILON) {
          const aimVec = worldRot.transform(ptR.boneAxis);
          const aimRot = Quaternion.unitVectorToUnitVector(aimVec, childDir);
          worldRot = Quaternion.multiply(aimRot, worldRot);
        }
      }
      results[index] = {
        position: pos,
        rotation: worldRot,
        localRotation: localRot
      };
    } else {
      // Fixed point — follow transform, blend rotation
      const childBlend =
        ptR.child !== -1 ? Math.max(pointsR[ptR.child].forceFadeRatio, blendRatio) : blendRatio;

      // Step 1: Blend localRotation
      localRot = Quaternion.slerp(ptR.initialLocalRotation, localRot, childBlend);

      // Step 2: Recompute worldRot from blended localRot
      if (ptR.parent !== -1) {
        const parentRot = results[ptR.parent] ? results[ptR.parent].rotation : transformRotations[ptR.parent];
        worldRot = Quaternion.multiply(parentRot, localRot);
      } else {
        worldRot = localRot.clone();
      }

      // Step 3: Aim toward child with blend
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

  return results;
}

// ── Angle limiting (post-simulation) ──

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
