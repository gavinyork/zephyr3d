// Collision detection & response - direct port of SPCRJointDynamicsJob.cs Collision class

import { Vector3 } from '@zephyr3d/base';
import type { ColliderR, ColliderRW, PointR } from './types';
import { EPSILON, ColliderForce } from './types';

export interface CollisionResult {
  hit: boolean;
  point: Vector3;
}

export interface LineCollisionResult {
  hit: boolean;
  pointOnLine: Vector3;
  pointOnCollider: Vector3;
  radius: number;
}

export interface SurfaceCheckResult {
  hit: boolean;
  intersectionPoint: Vector3;
  pushOut: Vector3;
  pointOnCollider: Vector3;
  radius: number;
}

export interface NearestPointsResult {
  tP: number;
  tQ: number;
  pointOnP: Vector3;
  pointOnQ: Vector3;
  sqrDistance: number;
}

const _pushoutSphereDirection = new Vector3();
const _pushoutSphereScaled = new Vector3();
const _pushoutCapsuleVecN = new Vector3();
const _pushoutCapsuleTargetVec = new Vector3();
const _pushoutCapsuleTail = new Vector3();
const _pushoutCapsulePosOnVec = new Vector3();
const _pushoutCapsulePushVec = new Vector3();
const _pushoutCapsuleScaled = new Vector3();
const _pushInSphereDirection = new Vector3();
const _pushInSphereDirectionN = new Vector3();
const _pushInSphereScaled = new Vector3();
const _pushInCapsuleVecN = new Vector3();
const _pushInCapsuleTargetVec = new Vector3();
const _pushInCapsuleTail = new Vector3();
const _pushInCapsulePosOnVec = new Vector3();
const _pushInCapsulePullVec = new Vector3();
const _pushInCapsulePullVecN = new Vector3();
const _pushInCapsuleScaled = new Vector3();
const _collisionSphereDir = new Vector3();
const _collisionSphereDirN = new Vector3();
const _collisionSphereToCenter = new Vector3();
const _collisionSphereScaled = new Vector3();
const _collisionSphereDiff = new Vector3();
const _collisionCapsuleTail = new Vector3();
const _collisionCapsulePointDir = new Vector3();
const _collisionCapsulePtOnCol = new Vector3();
const _collisionCapsulePtOnLine = new Vector3();
const _collisionCapsuleDiff = new Vector3();
const _collisionCapsuleTempLineResult: LineCollisionResult = {
  hit: false,
  pointOnLine: new Vector3(),
  pointOnCollider: new Vector3(),
  radius: 0
};
const _nearestCross0 = new Vector3();
const _nearestCross1 = new Vector3();
const _nearestN1 = new Vector3();
const _nearestN2 = new Vector3();
const _nearestPosDiff = new Vector3();
const _nearestPointOnP = new Vector3();
const _nearestPointOnQ = new Vector3();
const _nearestPointDiff = new Vector3();
const _nearestResult: NearestPointsResult = {
  tP: 0,
  tQ: 0,
  pointOnP: new Vector3(),
  pointOnQ: new Vector3(),
  sqrDistance: 0
};
const _surfaceNoHit: SurfaceCheckResult = {
  hit: false,
  intersectionPoint: new Vector3(),
  pushOut: new Vector3(),
  pointOnCollider: new Vector3(),
  radius: 0
};
const _surfaceTriCenter = new Vector3();
const _surfaceEdgeAB = new Vector3();
const _surfaceEdgeAC = new Vector3();
const _surfacePlaneNormal = new Vector3();
const _surfacePlaneNormalNeg = new Vector3();
const _surfaceColliderDir = new Vector3();
const _surfaceRayDir = new Vector3();
const _surfaceRayDirN = new Vector3();
const _surfaceTail = new Vector3();
const _surfaceIntersection = new Vector3();
const _surfacePushOut = new Vector3();
const _surfaceToCol = new Vector3();
const _surfaceEndVec = new Vector3();
const _surfaceColDirVec = new Vector3();
const _surfaceIntersecToEnd = new Vector3();
const _surfaceColToEnd = new Vector3();
const _surfaceColToIntersect = new Vector3();
const _surfaceEVec = new Vector3();
const _surfacePoc2 = new Vector3();
const _triangleAp = new Vector3();
const _triangleBp = new Vector3();
const _triangleCp = new Vector3();
const _triangleU = new Vector3();
const _triangleV = new Vector3();
const _triangleW = new Vector3();

function writeCollisionResult(
  out: CollisionResult | undefined,
  hit: boolean,
  point: Vector3,
  copyPoint: boolean
) {
  if (!out) {
    return { hit, point: copyPoint ? point.clone() : point };
  }
  if (!out.point) {
    out.point = new Vector3();
  }
  out.hit = hit;
  out.point.set(point);
  return out;
}

function writeLineCollisionResult(
  out: LineCollisionResult | undefined,
  hit: boolean,
  pointOnLine: Vector3,
  pointOnCollider: Vector3,
  radius: number,
  copyVectors: boolean
) {
  if (!out) {
    return {
      hit,
      pointOnLine: copyVectors ? pointOnLine.clone() : pointOnLine,
      pointOnCollider: copyVectors ? pointOnCollider.clone() : pointOnCollider,
      radius
    };
  }
  if (!out.pointOnLine) {
    out.pointOnLine = new Vector3();
  }
  if (!out.pointOnCollider) {
    out.pointOnCollider = new Vector3();
  }
  out.hit = hit;
  out.pointOnLine.set(pointOnLine);
  out.pointOnCollider.set(pointOnCollider);
  out.radius = radius;
  return out;
}

function writeSurfaceCheckResult(
  out: SurfaceCheckResult | undefined,
  hit: boolean,
  intersectionPoint: Vector3,
  pushOut: Vector3,
  pointOnCollider: Vector3,
  radius: number,
  copyVectors: boolean
) {
  if (!out) {
    return {
      hit,
      intersectionPoint: copyVectors ? intersectionPoint.clone() : intersectionPoint,
      pushOut: copyVectors ? pushOut.clone() : pushOut,
      pointOnCollider: copyVectors ? pointOnCollider.clone() : pointOnCollider,
      radius
    };
  }
  if (!out.intersectionPoint) {
    out.intersectionPoint = new Vector3();
  }
  if (!out.pushOut) {
    out.pushOut = new Vector3();
  }
  if (!out.pointOnCollider) {
    out.pointOnCollider = new Vector3();
  }
  out.hit = hit;
  out.intersectionPoint.set(intersectionPoint);
  out.pushOut.set(pushOut);
  out.pointOnCollider.set(pointOnCollider);
  out.radius = radius;
  return out;
}

function writeNearestPointsResult(
  out: NearestPointsResult | undefined,
  tP: number,
  tQ: number,
  pointOnP: Vector3,
  pointOnQ: Vector3,
  sqrDistance: number,
  copyVectors: boolean
) {
  if (!out) {
    return {
      tP,
      tQ,
      pointOnP: copyVectors ? pointOnP.clone() : pointOnP,
      pointOnQ: copyVectors ? pointOnQ.clone() : pointOnQ,
      sqrDistance
    };
  }
  out.tP = tP;
  out.tQ = tQ;
  out.pointOnP.set(pointOnP);
  out.pointOnQ.set(pointOnQ);
  out.sqrDistance = sqrDistance;
  return out;
}

// Pushout (keep point outside collider)

export function pushoutFromSphere(
  center: Vector3,
  radius: number,
  pointRadius: number,
  point: Vector3,
  out?: CollisionResult
): CollisionResult {
  const direction = Vector3.sub(point, center, _pushoutSphereDirection);
  const sqrLen = direction.magnitudeSq;
  if (sqrLen > EPSILON) {
    const dirLen = Math.sqrt(sqrLen) - pointRadius;
    if (dirLen < radius) {
      const scaled = Vector3.scale(direction, radius / dirLen, _pushoutSphereScaled);
      Vector3.add(center, scaled, scaled);
      return writeCollisionResult(out, true, scaled, !out);
    }
  }
  return writeCollisionResult(out, false, point, !out);
}

export function pushoutFromCollider(
  colR: ColliderR,
  colRW: ColliderRW,
  point: Vector3,
  ptR: PointR,
  out?: CollisionResult
): CollisionResult {
  if (colR.height <= EPSILON) {
    return pushoutFromSphere(colRW.positionCurrent, colRW.radius, ptR.pointRadius, point, out);
  }
  return pushoutFromCapsule(colR, colRW, point, ptR, out);
}

export function pushoutFromCapsule(
  colR: ColliderR,
  colRW: ColliderRW,
  point: Vector3,
  ptR: PointR,
  out?: CollisionResult
): CollisionResult {
  const capsuleVec = colRW.directionCurrent;
  const capsuleVecN = Vector3.normalize(capsuleVec, _pushoutCapsuleVecN);
  const capsulePos = colRW.positionCurrent;
  const targetVec = Vector3.sub(point, capsulePos, _pushoutCapsuleTargetVec);
  const distOnVec = Vector3.dot(capsuleVecN, targetVec);

  if (distOnVec <= EPSILON) {
    return pushoutFromSphere(capsulePos, colRW.radius, ptR.pointRadius, point, out);
  }
  if (distOnVec >= colR.height) {
    const tail = Vector3.add(capsulePos, capsuleVec, _pushoutCapsuleTail);
    return pushoutFromSphere(tail, colRW.radius * colR.radiusTailScale, ptR.pointRadius, point, out);
  }

  const posOnVec = Vector3.scale(capsuleVecN, distOnVec, _pushoutCapsulePosOnVec);
  Vector3.add(capsulePos, posOnVec, posOnVec);
  const pushVec = Vector3.sub(point, posOnVec, _pushoutCapsulePushVec);
  const sqrPushDist = pushVec.magnitudeSq;
  if (sqrPushDist > EPSILON) {
    const pushDist = Math.sqrt(sqrPushDist) - ptR.pointRadius;
    const r = colRW.radius * lerp(1.0, colR.radiusTailScale, distOnVec / colR.height);
    if (pushDist < r) {
      const scaled = Vector3.scale(pushVec, r / pushDist, _pushoutCapsuleScaled);
      Vector3.add(posOnVec, scaled, scaled);
      return writeCollisionResult(out, true, scaled, !out);
    }
  }
  return writeCollisionResult(out, false, point, !out);
}

// PushIn (keep point inside collider - inverse mode)

export function pushInFromSphere(
  center: Vector3,
  radius: number,
  point: Vector3,
  out?: CollisionResult
): CollisionResult {
  const direction = Vector3.sub(center, point, _pushInSphereDirection);
  const sqrLen = direction.magnitudeSq;
  if (sqrLen > EPSILON && sqrLen > radius * radius) {
    const dirLen = Math.sqrt(sqrLen);
    const directionN = Vector3.normalize(direction, _pushInSphereDirectionN);
    const scaled = Vector3.scale(directionN, dirLen - radius, _pushInSphereScaled);
    Vector3.add(point, scaled, scaled);
    return writeCollisionResult(out, true, scaled, !out);
  }
  return writeCollisionResult(out, false, point, !out);
}

export function pushInFromCollider(
  colR: ColliderR,
  colRW: ColliderRW,
  point: Vector3,
  out?: CollisionResult
): CollisionResult {
  if (colR.height <= EPSILON) {
    return pushInFromSphere(colRW.positionCurrent, colRW.radius, point, out);
  }
  return pushInFromCapsule(colR, colRW, point, out);
}

export function pushInFromCapsule(
  colR: ColliderR,
  colRW: ColliderRW,
  point: Vector3,
  out?: CollisionResult
): CollisionResult {
  const capsuleVec = colRW.directionCurrent;
  const capsuleVecN = Vector3.normalize(capsuleVec, _pushInCapsuleVecN);
  const capsulePos = colRW.positionCurrent;
  const targetVec = Vector3.sub(point, capsulePos, _pushInCapsuleTargetVec);
  const distOnVec = Vector3.dot(capsuleVecN, targetVec);

  if (distOnVec <= EPSILON) {
    return pushInFromSphere(capsulePos, colRW.radius, point, out);
  }
  if (distOnVec >= colR.height) {
    const tail = Vector3.add(capsulePos, capsuleVec, _pushInCapsuleTail);
    return pushInFromSphere(tail, colRW.radius * colR.radiusTailScale, point, out);
  }

  const posOnVec = Vector3.scale(capsuleVecN, distOnVec, _pushInCapsulePosOnVec);
  Vector3.add(capsulePos, posOnVec, posOnVec);
  const pullVec = Vector3.sub(posOnVec, point, _pushInCapsulePullVec);
  const sqrPullDist = pullVec.magnitudeSq;
  if (sqrPullDist > EPSILON) {
    const r = colRW.radius * lerp(1.0, colR.radiusTailScale, colR.height / distOnVec);
    if (sqrPullDist > r * r) {
      const pullDist = Math.sqrt(sqrPullDist);
      const pullVecN = Vector3.normalize(pullVec, _pushInCapsulePullVecN);
      const scaled = Vector3.scale(pullVecN, pullDist - r, _pushInCapsuleScaled);
      Vector3.add(point, scaled, scaled);
      return writeCollisionResult(out, true, scaled, !out);
    }
  }
  return writeCollisionResult(out, false, point, !out);
}

// Line segment vs collider detection

export function collisionDetectionSphere(
  center: Vector3,
  radius: number,
  point1: Vector3,
  point2: Vector3,
  out?: LineCollisionResult
): LineCollisionResult {
  const dir = Vector3.sub(point2, point1, _collisionSphereDir);
  const dirLen = dir.magnitude;
  if (dirLen < EPSILON) {
    return writeLineCollisionResult(out, false, point1, center, radius, !out);
  }
  const dirN = Vector3.scale(dir, 1 / dirLen, _collisionSphereDirN);
  const toCenter = Vector3.sub(center, point1, _collisionSphereToCenter);
  const dot = Vector3.dot(dirN, toCenter);
  const clamped = Math.max(0, Math.min(dot, dirLen));
  const ptOnLine = Vector3.scale(dirN, clamped, _collisionSphereScaled);
  Vector3.add(point1, ptOnLine, ptOnLine);
  const diff = Vector3.sub(center, ptOnLine, _collisionSphereDiff);
  const hit = diff.magnitudeSq <= radius * radius;
  return writeLineCollisionResult(out, hit, ptOnLine, center, radius, !out);
}

export function collisionDetectionCapsule(
  colR: ColliderR,
  colRW: ColliderRW,
  point1: Vector3,
  point2: Vector3,
  out?: LineCollisionResult
): LineCollisionResult {
  const capsuleDir = colRW.directionCurrent;
  const capsulePos = colRW.positionCurrent;

  let res = collisionDetectionSphere(capsulePos, colRW.radius, point1, point2, out);
  if (res.hit) {
    return res;
  }

  const tail = Vector3.add(capsulePos, capsuleDir, _collisionCapsuleTail);
  res = collisionDetectionSphere(
    tail,
    colRW.radius * colR.radiusTailScale,
    point1,
    point2,
    _collisionCapsuleTempLineResult
  );
  if (res.hit) {
    return writeLineCollisionResult(out, true, res.pointOnLine, res.pointOnCollider, res.radius, !out);
  }

  const pointDir = Vector3.sub(point2, point1, _collisionCapsulePointDir);
  const nearest = computeNearestPoints(capsulePos, capsuleDir, point1, pointDir, _nearestResult);
  const t1 = Math.max(0, Math.min(1, nearest.tP));
  const r = colRW.radius * lerp(1.0, colR.radiusTailScale, t1);

  if (nearest.sqrDistance > r * r) {
    return writeLineCollisionResult(out, false, point1, capsulePos, r, !out);
  }

  const t2 = Math.max(0, Math.min(1, nearest.tQ));
  const ptOnCol = Vector3.scale(capsuleDir, t1, _collisionCapsulePtOnCol);
  Vector3.add(capsulePos, ptOnCol, ptOnCol);
  const ptOnLine = Vector3.scale(pointDir, t2, _collisionCapsulePtOnLine);
  Vector3.add(point1, ptOnLine, ptOnLine);
  const diff = Vector3.sub(ptOnCol, ptOnLine, _collisionCapsuleDiff);
  const hit = diff.magnitudeSq <= r * r;
  return writeLineCollisionResult(out, hit, ptOnLine, ptOnCol, r, !out);
}

export function collisionDetection(
  colR: ColliderR,
  colRW: ColliderRW,
  point1: Vector3,
  point2: Vector3,
  out?: LineCollisionResult
): LineCollisionResult {
  if (colR.height <= EPSILON) {
    return collisionDetectionSphere(colRW.positionCurrent, colRW.radius, point1, point2, out);
  }
  return collisionDetectionCapsule(colR, colRW, point1, point2, out);
}

export function pushInCollisionDetection(
  colR: ColliderR,
  colRW: ColliderRW,
  point1: Vector3,
  point2: Vector3,
  out?: LineCollisionResult
): LineCollisionResult {
  if (colR.height <= EPSILON) {
    return collisionDetectionSphere(colRW.positionCurrent, colRW.radius, point1, point2, out);
  }
  const res = collisionDetectionCapsule(colR, colRW, point1, point2, out);
  res.hit = false;
  return res;
}

// Nearest points between two line segments

export function computeNearestPoints(
  posP: Vector3,
  dirP: Vector3,
  posQ: Vector3,
  dirQ: Vector3,
  out?: NearestPointsResult
): {
  tP: number;
  tQ: number;
  pointOnP: Vector3;
  pointOnQ: Vector3;
  sqrDistance: number;
} {
  const cross0 = Vector3.cross(dirQ, dirP, _nearestCross0);
  const n1 = Vector3.cross(dirP, cross0, _nearestN1);
  const cross1 = Vector3.cross(dirP, dirQ, _nearestCross1);
  const n2 = Vector3.cross(dirQ, cross1, _nearestN2);
  const dP_n2 = Vector3.dot(dirP, n2);
  const dQ_n1 = Vector3.dot(dirQ, n1);
  const posDiff = Vector3.sub(posQ, posP, _nearestPosDiff);
  const tP = dP_n2 !== 0 ? Vector3.dot(posDiff, n2) / dP_n2 : 0;
  const tQ = dQ_n1 !== 0 ? Vector3.dot(Vector3.scale(posDiff, -1, posDiff), n1) / dQ_n1 : 0;
  const pointOnP = Vector3.scale(dirP, tP, _nearestPointOnP);
  Vector3.add(posP, pointOnP, pointOnP);
  const pointOnQ = Vector3.scale(dirQ, tQ, _nearestPointOnQ);
  Vector3.add(posQ, pointOnQ, pointOnQ);
  const diff = Vector3.sub(pointOnQ, pointOnP, _nearestPointDiff);
  return writeNearestPointsResult(out, tP, tQ, pointOnP, pointOnQ, diff.magnitudeSq, !out);
}

// Surface collision (triangle-based)

export function checkSurfaceCollision(
  ptA: Vector3,
  ptB: Vector3,
  ptC: Vector3,
  colliderPos: Vector3,
  colR: ColliderR,
  colRW: ColliderRW,
  out?: SurfaceCheckResult
): SurfaceCheckResult {
  _surfaceNoHit.hit = false;
  _surfaceNoHit.intersectionPoint.setXYZ(0, 0, 0);
  _surfaceNoHit.pushOut.setXYZ(0, 0, 0);
  _surfaceNoHit.pointOnCollider.set(colliderPos);
  _surfaceNoHit.radius = colRW.radius;

  let pointOnCollider = colliderPos;
  let radius = colRW.radius;
  const isCapsule = colR.height > EPSILON;

  const triCenter = centerOfTriangle(ptA, ptB, ptC, _surfaceTriCenter);
  const edgeAB = Vector3.sub(ptB, ptA, _surfaceEdgeAB);
  const edgeAC = Vector3.sub(ptC, ptA, _surfaceEdgeAC);
  const planeNormal = Vector3.cross(edgeAB, edgeAC, _surfacePlaneNormal);
  Vector3.normalize(planeNormal, planeNormal);
  Vector3.scale(planeNormal, -1, planeNormal);
  const planeNormalNeg = Vector3.scale(planeNormal, -1, _surfacePlaneNormalNeg);
  const planeDist = -Vector3.dot(planeNormalNeg, ptA);
  const colliderDir = Vector3.sub(colliderPos, triCenter, _surfaceColliderDir);
  Vector3.normalize(colliderDir, colliderDir);
  const dot = Vector3.dot(colliderDir, planeNormal);

  if (isCapsule) {
    const side = Vector3.dot(colRW.directionCurrent, planeNormal) * dot;
    const rayDir = Vector3.scale(planeNormal, dot * -1, _surfaceRayDir);
    const tempPOC = pointOnCollider;

    if (side < 0) {
      radius = colRW.radius * colR.radiusTailScale;
      pointOnCollider = Vector3.add(colliderPos, colRW.directionCurrent, _surfaceTail);
    }

    const rayDirN = Vector3.normalize(rayDir, _surfaceRayDirN);
    const enter = raycast(planeNormalNeg, planeDist, pointOnCollider, rayDirN);
    if (enter !== null) {
      const ip = Vector3.scale(rayDirN, enter, _surfaceIntersection);
      Vector3.add(pointOnCollider, ip, ip);
      if (triangleContainsPoint(ptA, ptB, ptC, ip)) {
        const pushOut = Vector3.sub(ip, pointOnCollider, _surfacePushOut);
        const toCol = Vector3.sub(pointOnCollider, ip, _surfaceToCol);
        if (toCol.magnitudeSq <= radius * radius) {
          return writeSurfaceCheckResult(out, true, ip, pushOut, pointOnCollider, radius, !out);
        }
      }
    } else if (colR.forceType !== ColliderForce.Off) {
      pointOnCollider = tempPOC;
      let endVec = Vector3.add(colliderPos, colRW.directionCurrent, _surfaceEndVec);
      _surfaceColDirVec.set(colRW.directionCurrent);
      let colDirVec = _surfaceColDirVec;
      if (colR.forceType === ColliderForce.Pull) {
        const tmp = pointOnCollider;
        pointOnCollider = endVec;
        endVec = tmp;
        colDirVec = Vector3.scale(colDirVec, -1, colDirVec);
      }
      const enter2 = raycast(planeNormalNeg, planeDist, pointOnCollider, colDirVec);
      if (enter2 !== null) {
        const ip = Vector3.scale(colDirVec, enter2, _surfaceIntersection);
        Vector3.add(pointOnCollider, ip, ip);
        if (triangleContainsPoint(ptA, ptB, ptC, ip)) {
          const intersecToEnd = Vector3.sub(endVec, ip, _surfaceIntersecToEnd);
          const colToEnd = Vector3.sub(endVec, pointOnCollider, _surfaceColToEnd);
          const colToIntersect = Vector3.sub(ip, pointOnCollider, _surfaceColToIntersect);
          const pDot = Vector3.dot(intersecToEnd, colToIntersect);
          const lDot = Vector3.dot(colToEnd, colToEnd);
          if (!(pDot >= 0 && pDot <= lDot)) {
            return writeSurfaceCheckResult(
              out,
              _surfaceNoHit.hit,
              _surfaceNoHit.intersectionPoint,
              _surfaceNoHit.pushOut,
              _surfaceNoHit.pointOnCollider,
              _surfaceNoHit.radius,
              !out
            );
          }
          const dotVal = Vector3.dot(colToEnd, colToIntersect);
          const s2eMag = Vector3.dot(colToEnd, colToEnd);
          const colToEndN = Vector3.normalize(colToEnd, colToEnd);
          const eVec = Vector3.scale(colToEndN, -radius, _surfaceEVec);
          Vector3.add(pointOnCollider, eVec, eVec);
          const pushOut = Vector3.sub(ip, eVec, _surfacePushOut);
          const poc2 = Vector3.scale(colToEnd, dotVal / s2eMag, _surfacePoc2);
          Vector3.add(pointOnCollider, poc2, poc2);
          const toCol = Vector3.sub(poc2, ip, _surfaceToCol);
          if (toCol.magnitudeSq <= radius * radius) {
            return writeSurfaceCheckResult(out, true, ip, pushOut, poc2, radius, !out);
          }
        }
      }
    }
  } else {
    const rayDir = Vector3.scale(planeNormal, dot * -1, _surfaceRayDir);
    const rayDirN = Vector3.normalize(rayDir, _surfaceRayDirN);
    const enter = raycast(planeNormalNeg, planeDist, pointOnCollider, rayDirN);
    if (enter !== null) {
      const ip = Vector3.scale(rayDirN, enter, _surfaceIntersection);
      Vector3.add(pointOnCollider, ip, ip);
      if (triangleContainsPoint(ptA, ptB, ptC, ip)) {
        const pushOut = Vector3.sub(ip, pointOnCollider, _surfacePushOut);
        const toCol = Vector3.sub(pointOnCollider, ip, _surfaceToCol);
        if (toCol.magnitudeSq <= radius * radius) {
          return writeSurfaceCheckResult(out, true, ip, pushOut, pointOnCollider, radius, !out);
        }
      }
    }
  }

  return writeSurfaceCheckResult(
    out,
    _surfaceNoHit.hit,
    _surfaceNoHit.intersectionPoint,
    _surfaceNoHit.pushOut,
    _surfaceNoHit.pointOnCollider,
    _surfaceNoHit.radius,
    !out
  );
}

// Helpers

function raycast(normal: Vector3, planeDist: number, origin: Vector3, direction: Vector3): number | null {
  const vdot = Vector3.dot(direction, normal);
  const ndot = -Vector3.dot(origin, normal) - planeDist;
  if (Math.abs(vdot) <= EPSILON) {
    return null;
  }
  const enter = ndot / vdot;
  return enter > 0 ? enter : null;
}

function centerOfTriangle(a: Vector3, b: Vector3, c: Vector3, result?: Vector3): Vector3 {
  result = result || new Vector3();
  return result.setXYZ((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3);
}

function triangleContainsPoint(a: Vector3, b: Vector3, c: Vector3, p: Vector3): boolean {
  const ap = Vector3.sub(a, p, _triangleAp);
  const bp = Vector3.sub(b, p, _triangleBp);
  const cp = Vector3.sub(c, p, _triangleCp);
  const u = Vector3.cross(ap, bp, _triangleU);
  const vv = Vector3.cross(bp, cp, _triangleV);
  const w = Vector3.cross(cp, ap, _triangleW);
  if (Vector3.dot(u, vv) < 0) {
    return false;
  }
  if (Vector3.dot(vv, w) < 0) {
    return false;
  }
  return true;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
