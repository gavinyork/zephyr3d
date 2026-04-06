// Collision detection & response — direct port of SPCRJointDynamicsJob.cs Collision class

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

// ── Pushout (keep point outside collider) ──

export function pushoutFromSphere(
  center: Vector3,
  radius: number,
  pointRadius: number,
  point: Vector3
): CollisionResult {
  const direction = Vector3.sub(point, center);
  const sqrLen = direction.magnitudeSq;
  if (sqrLen > EPSILON) {
    const dirLen = Math.sqrt(sqrLen) - pointRadius;
    if (dirLen < radius) {
      return {
        hit: true,
        point: Vector3.add(center, Vector3.scale(direction, radius / dirLen))
      };
    }
  }
  return { hit: false, point };
}

export function pushoutFromCollider(
  colR: ColliderR,
  colRW: ColliderRW,
  point: Vector3,
  ptR: PointR
): CollisionResult {
  if (colR.height <= EPSILON) {
    return pushoutFromSphere(colRW.positionCurrent, colRW.radius, ptR.pointRadius, point);
  }
  return pushoutFromCapsule(colR, colRW, point, ptR);
}

export function pushoutFromCapsule(
  colR: ColliderR,
  colRW: ColliderRW,
  point: Vector3,
  ptR: PointR
): CollisionResult {
  const capsuleVec = colRW.directionCurrent;
  const capsuleVecN = Vector3.normalize(capsuleVec);
  const capsulePos = colRW.positionCurrent;
  const targetVec = Vector3.sub(point, capsulePos);
  const distOnVec = Vector3.dot(capsuleVecN, targetVec);

  if (distOnVec <= EPSILON) {
    return pushoutFromSphere(capsulePos, colRW.radius, ptR.pointRadius, point);
  }
  if (distOnVec >= colR.height) {
    return pushoutFromSphere(
      Vector3.add(capsulePos, capsuleVec),
      colRW.radius * colR.radiusTailScale,
      ptR.pointRadius,
      point
    );
  }

  const posOnVec = Vector3.add(capsulePos, Vector3.scale(capsuleVecN, distOnVec));
  const pushVec = Vector3.sub(point, posOnVec);
  const sqrPushDist = pushVec.magnitudeSq;
  if (sqrPushDist > EPSILON) {
    const pushDist = Math.sqrt(sqrPushDist) - ptR.pointRadius;
    const r = colRW.radius * lerp(1.0, colR.radiusTailScale, distOnVec / colR.height);
    if (pushDist < r) {
      return {
        hit: true,
        point: Vector3.add(posOnVec, Vector3.scale(pushVec, r / pushDist))
      };
    }
  }
  return { hit: false, point };
}

// ── PushIn (keep point inside collider — inverse mode) ──

export function pushInFromSphere(center: Vector3, radius: number, point: Vector3): CollisionResult {
  const direction = Vector3.sub(center, point);
  const sqrLen = direction.magnitudeSq;
  if (sqrLen > EPSILON) {
    if (sqrLen > radius * radius) {
      const dirLen = Math.sqrt(sqrLen);
      const newPt = Vector3.add(point, Vector3.scale(Vector3.normalize(direction), dirLen - radius));
      return { hit: true, point: newPt };
    }
  }
  return { hit: false, point };
}

export function pushInFromCollider(colR: ColliderR, colRW: ColliderRW, point: Vector3): CollisionResult {
  if (colR.height <= EPSILON) {
    return pushInFromSphere(colRW.positionCurrent, colRW.radius, point);
  }
  return pushInFromCapsule(colR, colRW, point);
}

export function pushInFromCapsule(colR: ColliderR, colRW: ColliderRW, point: Vector3): CollisionResult {
  const capsuleVec = colRW.directionCurrent;
  const capsuleVecN = Vector3.normalize(capsuleVec);
  const capsulePos = colRW.positionCurrent;
  const targetVec = Vector3.sub(point, capsulePos);
  const distOnVec = Vector3.dot(capsuleVecN, targetVec);

  if (distOnVec <= EPSILON) {
    return pushInFromSphere(capsulePos, colRW.radius, point);
  }
  if (distOnVec >= colR.height) {
    return pushInFromSphere(Vector3.add(capsulePos, capsuleVec), colRW.radius * colR.radiusTailScale, point);
  }

  const posOnVec = Vector3.add(capsulePos, Vector3.scale(capsuleVecN, distOnVec));
  const pullVec = Vector3.sub(posOnVec, point);
  const sqrPullDist = pullVec.magnitudeSq;
  if (sqrPullDist > EPSILON) {
    const r = colRW.radius * lerp(1.0, colR.radiusTailScale, colR.height / distOnVec);
    if (sqrPullDist > r * r) {
      const pullDist = Math.sqrt(sqrPullDist);
      return {
        hit: true,
        point: Vector3.add(point, Vector3.scale(Vector3.normalize(pullVec), pullDist - r))
      };
    }
  }
  return { hit: false, point };
}

// ── Line segment vs collider detection ──

export function collisionDetectionSphere(
  center: Vector3,
  radius: number,
  point1: Vector3,
  point2: Vector3
): LineCollisionResult {
  const dir = Vector3.sub(point2, point1);
  const dirLen = dir.magnitude;
  if (dirLen < EPSILON) {
    return { hit: false, pointOnLine: point1, pointOnCollider: center, radius };
  }
  const dirN = Vector3.scale(dir, 1 / dirLen);
  const toCenter = Vector3.sub(center, point1);
  const dot = Vector3.dot(dirN, toCenter);
  const clamped = Math.max(0, Math.min(dot, dirLen));
  const ptOnLine = Vector3.add(point1, Vector3.scale(dirN, clamped));
  const hit = Vector3.sub(center, ptOnLine).magnitudeSq <= radius * radius;
  return { hit, pointOnLine: ptOnLine, pointOnCollider: center, radius };
}

export function collisionDetectionCapsule(
  colR: ColliderR,
  colRW: ColliderRW,
  point1: Vector3,
  point2: Vector3
): LineCollisionResult {
  const capsuleDir = colRW.directionCurrent;
  const capsulePos = colRW.positionCurrent;

  // Check head sphere
  let res = collisionDetectionSphere(capsulePos, colRW.radius, point1, point2);
  if (res.hit) {
    return res;
  }
  // Check tail sphere
  res = collisionDetectionSphere(
    Vector3.add(capsulePos, capsuleDir),
    colRW.radius * colR.radiusTailScale,
    point1,
    point2
  );
  if (res.hit) {
    return res;
  }

  // Closest points between capsule axis and constraint line
  const pointDir = Vector3.sub(point2, point1);
  const nearest = computeNearestPoints(capsulePos, capsuleDir, point1, pointDir);
  const t1 = Math.max(0, Math.min(1, nearest.tP));
  const r = colRW.radius * lerp(1.0, colR.radiusTailScale, t1);

  if (nearest.sqrDistance > r * r) {
    return {
      hit: false,
      pointOnLine: Vector3.zero(),
      pointOnCollider: Vector3.zero(),
      radius: r
    };
  }

  const t2 = Math.max(0, Math.min(1, nearest.tQ));
  const ptOnCol = Vector3.add(capsulePos, Vector3.scale(capsuleDir, t1));
  const ptOnLine = Vector3.add(point1, Vector3.scale(pointDir, t2));
  const hit = Vector3.sub(ptOnCol, ptOnLine).magnitudeSq <= r * r;
  return { hit, pointOnLine: ptOnLine, pointOnCollider: ptOnCol, radius: r };
}

export function collisionDetection(
  colR: ColliderR,
  colRW: ColliderRW,
  point1: Vector3,
  point2: Vector3
): LineCollisionResult {
  if (colR.height <= EPSILON) {
    return collisionDetectionSphere(colRW.positionCurrent, colRW.radius, point1, point2);
  }
  return collisionDetectionCapsule(colR, colRW, point1, point2);
}

export function pushInCollisionDetection(
  colR: ColliderR,
  colRW: ColliderRW,
  point1: Vector3,
  point2: Vector3
): LineCollisionResult {
  if (colR.height <= EPSILON) {
    return collisionDetectionSphere(colRW.positionCurrent, colRW.radius, point1, point2);
  }
  const res = collisionDetectionCapsule(colR, colRW, point1, point2);
  return { ...res, hit: false };
}

// ── Nearest points between two line segments ──

export function computeNearestPoints(
  posP: Vector3,
  dirP: Vector3,
  posQ: Vector3,
  dirQ: Vector3
): {
  tP: number;
  tQ: number;
  pointOnP: Vector3;
  pointOnQ: Vector3;
  sqrDistance: number;
} {
  const n1 = Vector3.cross(dirP, Vector3.cross(dirQ, dirP));
  const n2 = Vector3.cross(dirQ, Vector3.cross(dirP, dirQ));
  const dP_n2 = Vector3.dot(dirP, n2);
  const dQ_n1 = Vector3.dot(dirQ, n1);
  const tP = dP_n2 !== 0 ? Vector3.dot(Vector3.sub(posQ, posP), n2) / dP_n2 : 0;
  const tQ = dQ_n1 !== 0 ? Vector3.dot(Vector3.sub(posP, posQ), n1) / dQ_n1 : 0;
  const pointOnP = Vector3.add(posP, Vector3.scale(dirP, tP));
  const pointOnQ = Vector3.add(posQ, Vector3.scale(dirQ, tQ));
  return {
    tP,
    tQ,
    pointOnP,
    pointOnQ,
    sqrDistance: Vector3.sub(pointOnQ, pointOnP).magnitudeSq
  };
}

// ── Surface collision (triangle-based) ──

export function checkSurfaceCollision(
  ptA: Vector3,
  ptB: Vector3,
  ptC: Vector3,
  colliderPos: Vector3,
  colR: ColliderR,
  colRW: ColliderRW
): SurfaceCheckResult {
  const noHit: SurfaceCheckResult = {
    hit: false,
    intersectionPoint: Vector3.zero(),
    pushOut: Vector3.zero(),
    pointOnCollider: colliderPos,
    radius: colRW.radius
  };
  let pointOnCollider = colliderPos;
  let radius = colRW.radius;
  const isCapsule = colR.height > EPSILON;

  const triCenter = centerOfTriangle(ptA, ptB, ptC);
  const planeNormal = Vector3.scale(
    Vector3.normalize(Vector3.cross(Vector3.sub(ptB, ptA), Vector3.sub(ptC, ptA))),
    -1
  );
  const planeDist = -Vector3.dot(Vector3.scale(planeNormal, -1), ptA);
  const colliderDir = Vector3.normalize(Vector3.sub(colliderPos, triCenter));
  const dot = Vector3.dot(colliderDir, planeNormal);

  if (isCapsule) {
    const side = Vector3.dot(colRW.directionCurrent, planeNormal) * dot;
    const rayDir = Vector3.scale(planeNormal, dot * -1);
    const tempPOC = pointOnCollider;

    if (side < 0) {
      radius = colRW.radius * colR.radiusTailScale;
      pointOnCollider = Vector3.add(colliderPos, colRW.directionCurrent);
    }

    const enter = raycast(
      Vector3.scale(planeNormal, -1),
      planeDist,
      pointOnCollider,
      Vector3.normalize(rayDir)
    );
    if (enter !== null) {
      const ip = Vector3.add(pointOnCollider, Vector3.scale(Vector3.normalize(rayDir), enter));
      if (triangleContainsPoint(ptA, ptB, ptC, ip)) {
        const pushOut = Vector3.sub(ip, pointOnCollider);
        const toCol = Vector3.sub(pointOnCollider, ip);
        if (toCol.magnitudeSq <= radius * radius) {
          return {
            hit: true,
            intersectionPoint: ip,
            pushOut,
            pointOnCollider,
            radius
          };
        }
      }
    } else if (colR.forceType !== ColliderForce.Off) {
      pointOnCollider = tempPOC;
      let endVec = Vector3.add(colliderPos, colRW.directionCurrent);
      let colDirVec = colRW.directionCurrent.clone();
      if (colR.forceType === ColliderForce.Pull) {
        const tmp = pointOnCollider;
        pointOnCollider = endVec;
        endVec = tmp;
        colDirVec = Vector3.scale(colDirVec, -1);
      }
      const enter2 = raycast(Vector3.scale(planeNormal, -1), planeDist, pointOnCollider, colDirVec);
      if (enter2 !== null) {
        const ip = Vector3.add(pointOnCollider, Vector3.scale(colDirVec, enter2));
        if (triangleContainsPoint(ptA, ptB, ptC, ip)) {
          const intersecToEnd = Vector3.sub(endVec, ip);
          const colToEnd = Vector3.sub(endVec, pointOnCollider);
          const colToIntersect = Vector3.sub(ip, pointOnCollider);
          const pDot = Vector3.dot(intersecToEnd, colToIntersect);
          const lDot = Vector3.dot(colToEnd, colToEnd);
          if (!(pDot >= 0 && pDot <= lDot)) {
            return noHit;
          }
          const dotVal = Vector3.dot(colToEnd, colToIntersect);
          const s2eMag = Vector3.dot(colToEnd, colToEnd);
          const eVec = Vector3.add(pointOnCollider, Vector3.scale(Vector3.normalize(colToEnd), -radius));
          const pushOut = Vector3.sub(ip, eVec);
          const poc2 = Vector3.add(pointOnCollider, Vector3.scale(colToEnd, dotVal / s2eMag));
          const toCol = Vector3.sub(poc2, ip);
          if (toCol.magnitudeSq <= radius * radius) {
            return {
              hit: true,
              intersectionPoint: ip,
              pushOut,
              pointOnCollider: poc2,
              radius
            };
          }
        }
      }
    }
  } else {
    // Sphere collider
    const rayDir = Vector3.scale(planeNormal, dot * -1);
    const rayDirN = Vector3.normalize(rayDir);
    const enter = raycast(Vector3.scale(planeNormal, -1), planeDist, pointOnCollider, rayDirN);
    if (enter !== null) {
      const ip = Vector3.add(pointOnCollider, Vector3.scale(rayDirN, enter));
      if (triangleContainsPoint(ptA, ptB, ptC, ip)) {
        const pushOut = Vector3.sub(ip, pointOnCollider);
        const toCol = Vector3.sub(pointOnCollider, ip);
        if (toCol.magnitudeSq <= radius * radius) {
          return {
            hit: true,
            intersectionPoint: ip,
            pushOut,
            pointOnCollider,
            radius
          };
        }
      }
    }
  }
  return noHit;
}

// ── Helpers ──

function raycast(normal: Vector3, planeDist: number, origin: Vector3, direction: Vector3): number | null {
  const vdot = Vector3.dot(direction, normal);
  const ndot = -Vector3.dot(origin, normal) - planeDist;
  if (Math.abs(vdot) <= EPSILON) {
    return null;
  }
  const enter = ndot / vdot;
  return enter > 0 ? enter : null;
}

function centerOfTriangle(a: Vector3, b: Vector3, c: Vector3): Vector3 {
  return Vector3.lerp(Vector3.lerp(a, b, 0.5), Vector3.lerp(a, c, 0.5), 0.5);
}

function triangleContainsPoint(a: Vector3, b: Vector3, c: Vector3, p: Vector3): boolean {
  const ap = Vector3.sub(a, p),
    bp = Vector3.sub(b, p),
    cp = Vector3.sub(c, p);
  const u = Vector3.cross(ap, bp);
  const vv = Vector3.cross(bp, cp);
  const w = Vector3.cross(cp, ap);
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
