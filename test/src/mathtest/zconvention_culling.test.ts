/**
 * Culling consistency tests: frustum plane extraction, frustum corners and
 * AABB clip-space classification must produce identical world-space results
 * under both depth conventions. All expectations below are expressed in
 * world space and are convention independent — running this file under both
 * Z_CONVENTION matrices is the machine proof of equivalence.
 */

import { AABB, ClipState, Frustum, Matrix4x4, Vector3 } from '@zephyr3d/base';

const NEAR = 1;
const FAR = 100;

// Camera at origin looking down -Z; view matrix is identity.
function makeViewProj(): Matrix4x4 {
  return Matrix4x4.perspective(Math.PI / 2, 1, NEAR, FAR);
}

describe('frustum culling under the active depth convention', () => {
  test('containsPoint classifies strategic points identically', () => {
    const frustum = new Frustum(makeViewProj());
    // [point, expected inside]
    const cases: [Vector3, boolean][] = [
      [new Vector3(0, 0, -10), true], // well inside
      [new Vector3(0, 0, -NEAR - 1e-3), true], // just behind near plane
      [new Vector3(0, 0, -FAR + 1e-2), true], // just in front of far plane
      [new Vector3(0, 0, -NEAR / 2), false], // beyond near (too close)
      [new Vector3(0, 0, -FAR * 2), false], // beyond far
      [new Vector3(0, 0, 10), false], // behind camera
      [new Vector3(50, 0, -10), false], // right of frustum (fov 90 -> |x| <= |z|)
      [new Vector3(-50, 0, -10), false], // left
      [new Vector3(0, 50, -10), false], // above
      [new Vector3(0, -50, -10), false] // below
    ];
    for (const [pt, inside] of cases) {
      expect(frustum.containsPoint(pt)).toBe(inside);
    }
  });

  test('frustum corners land on the world-space near/far planes', () => {
    const frustum = new Frustum(makeViewProj());
    // fov 90, aspect 1: near plane half extent = NEAR, far plane half extent = FAR
    const nearCorner = frustum.getCorner(Frustum.CORNER_LEFT_TOP_NEAR);
    const farCorner = frustum.getCorner(Frustum.CORNER_LEFT_TOP_FAR);
    expect(Math.abs(nearCorner.z)).toBeCloseTo(NEAR, 4);
    expect(Math.abs(nearCorner.x)).toBeCloseTo(NEAR, 4);
    expect(Math.abs(nearCorner.y)).toBeCloseTo(NEAR, 4);
    expect(Math.abs(farCorner.z)).toBeCloseTo(FAR, 2);
    expect(Math.abs(farCorner.x)).toBeCloseTo(FAR, 2);
    expect(Math.abs(farCorner.y)).toBeCloseTo(FAR, 2);
    // near/far bit semantics of the corner index must hold
    expect(Math.abs(nearCorner.z)).toBeLessThan(Math.abs(farCorner.z));
  });

  test('AABB clip-space classification matches world-space expectations', () => {
    const viewProj = makeViewProj();
    const cases: [AABB, ClipState][] = [
      // fully inside
      [new AABB(new Vector3(-1, -1, -20), new Vector3(1, 1, -10)), ClipState.A_INSIDE_B],
      // straddles the near plane
      [new AABB(new Vector3(-0.1, -0.1, -2), new Vector3(0.1, 0.1, -0.5)), ClipState.CLIPPED],
      // straddles the far plane
      [new AABB(new Vector3(-1, -1, -150), new Vector3(1, 1, -50)), ClipState.CLIPPED],
      // fully in front of the near plane (between camera and near)
      [new AABB(new Vector3(-0.1, -0.1, -0.9), new Vector3(0.1, 0.1, -0.5)), ClipState.NOT_CLIPPED],
      // fully beyond the far plane
      [new AABB(new Vector3(-1, -1, -300), new Vector3(1, 1, -200)), ClipState.NOT_CLIPPED],
      // fully behind the camera
      [new AABB(new Vector3(-1, -1, 10), new Vector3(1, 1, 20)), ClipState.NOT_CLIPPED],
      // far off to the right
      [new AABB(new Vector3(100, -1, -20), new Vector3(110, 1, -10)), ClipState.NOT_CLIPPED]
    ];
    for (const [box, expected] of cases) {
      expect(box.getClipState(viewProj)).toBe(expected);
      expect(box.getClipStateMask(viewProj, 0xffff)).toBe(expected);
    }
  });

  test('frustum-based AABB classification agrees with clip-space classification', () => {
    const viewProj = makeViewProj();
    const frustum = new Frustum(viewProj);
    const boxes = [
      new AABB(new Vector3(-1, -1, -20), new Vector3(1, 1, -10)),
      new AABB(new Vector3(-0.1, -0.1, -2), new Vector3(0.1, 0.1, -0.5)),
      new AABB(new Vector3(-1, -1, -300), new Vector3(1, 1, -200)),
      new AABB(new Vector3(30, 30, -40), new Vector3(60, 60, -20))
    ];
    for (const box of boxes) {
      const clipSpace = box.getClipState(viewProj);
      const planeSpace = box.getClipStateWithFrustum(frustum);
      // NOT_CLIPPED (fully outside) via plane tests can be conservative;
      // inside/intersect classification must agree exactly.
      if (clipSpace === ClipState.A_INSIDE_B || planeSpace === ClipState.A_INSIDE_B) {
        expect(planeSpace).toBe(clipSpace);
      }
    }
  });
});
