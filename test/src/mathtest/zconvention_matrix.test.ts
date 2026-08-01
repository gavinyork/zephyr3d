/**
 * Depth-convention aware projection matrix tests. These run under both
 * Z_CONVENTION=standard and Z_CONVENTION=reverse and derive their expected
 * values from the active convention, anchored by the exact invariant
 * `standardDepth + reverseDepth === 1` for the same eye-space position.
 */

import { REVERSE_Z, DEPTH_NEAREST, DEPTH_FARTHEST, Matrix4x4, Vector4, Plane } from '@zephyr3d/base';

/** Device depth produced by the engine's canonical clip space for eye z. */
function deviceDepth(proj: Matrix4x4, eyeZ: number): number {
  const clip = proj.transform(new Vector4(0, 0, eyeZ, 1));
  const ndcZ = clip.z / clip.w;
  // Standard convention uses GL [-1,1] canonical clip space mapped to [0,1]
  // window depth; reverse convention uses ZO [0,1] directly.
  return REVERSE_Z ? ndcZ : (ndcZ + 1) / 2;
}

/** Closed-form standard-Z ZO device depth for a perspective projection. */
function analyticStandardPerspectiveDepth(near: number, far: number, dist: number): number {
  return (far * (dist - near)) / (dist * (far - near));
}

/** Closed-form standard-Z ZO device depth for an orthographic projection. */
function analyticStandardOrthoDepth(near: number, far: number, dist: number): number {
  return (dist - near) / (far - near);
}

describe('projection matrices under the active depth convention', () => {
  const NEAR = 1.5;
  const FAR = 1000;

  test('perspective endpoints map near/far to DEPTH_NEAREST/DEPTH_FARTHEST', () => {
    const proj = Matrix4x4.perspective(Math.PI / 3, 16 / 9, NEAR, FAR);
    expect(deviceDepth(proj, -NEAR)).toBeCloseTo(DEPTH_NEAREST, 6);
    expect(deviceDepth(proj, -FAR)).toBeCloseTo(DEPTH_FARTHEST, 6);
  });

  test('ortho endpoints map near/far to DEPTH_NEAREST/DEPTH_FARTHEST', () => {
    const proj = Matrix4x4.ortho(-10, 10, -10, 10, NEAR, FAR);
    expect(deviceDepth(proj, -NEAR)).toBeCloseTo(DEPTH_NEAREST, 6);
    expect(deviceDepth(proj, -FAR)).toBeCloseTo(DEPTH_FARTHEST, 6);
  });

  test('perspective depth satisfies the d_std + d_rev = 1 invariant', () => {
    const proj = Matrix4x4.perspective(Math.PI / 3, 1, NEAR, FAR);
    for (const dist of [NEAR, 2, 10, 100, 500, FAR]) {
      const dStd = analyticStandardPerspectiveDepth(NEAR, FAR, dist);
      const expected = REVERSE_Z ? 1 - dStd : dStd;
      expect(deviceDepth(proj, -dist)).toBeCloseTo(expected, 6);
    }
  });

  test('ortho depth satisfies the d_std + d_rev = 1 invariant', () => {
    const proj = Matrix4x4.ortho(-10, 10, -10, 10, NEAR, FAR);
    for (const dist of [NEAR, 2, 10, 100, 500, FAR]) {
      const dStd = analyticStandardOrthoDepth(NEAR, FAR, dist);
      const expected = REVERSE_Z ? 1 - dStd : dStd;
      expect(deviceDepth(proj, -dist)).toBeCloseTo(expected, 6);
    }
  });

  test('device depth is monotone from DEPTH_NEAREST towards DEPTH_FARTHEST', () => {
    const proj = Matrix4x4.perspective(Math.PI / 3, 1, NEAR, FAR);
    let prev = deviceDepth(proj, -NEAR);
    for (let i = 1; i <= 32; i++) {
      const dist = NEAR + ((FAR - NEAR) * i) / 32;
      const d = deviceDepth(proj, -dist);
      if (DEPTH_FARTHEST > DEPTH_NEAREST) {
        expect(d).toBeGreaterThan(prev);
      } else {
        expect(d).toBeLessThan(prev);
      }
      prev = d;
    }
  });

  test('getNearPlane/getFarPlane invert perspective construction', () => {
    const proj = Matrix4x4.perspective(Math.PI / 4, 2, NEAR, FAR);
    expect(proj.getNearPlane()).toBeCloseTo(NEAR, 4);
    expect(Math.abs(proj.getFarPlane() - FAR) / FAR).toBeLessThan(1e-4);
  });

  test('getNearPlane/getFarPlane invert ortho construction', () => {
    const proj = Matrix4x4.ortho(-4, 4, -3, 3, NEAR, FAR);
    expect(proj.getNearPlane()).toBeCloseTo(NEAR, 4);
    expect(Math.abs(proj.getFarPlane() - FAR) / FAR).toBeLessThan(1e-4);
  });

  test('setNearFar reconstructs matching projections', () => {
    const newNear = 0.25;
    const newFar = 128;
    const persp = Matrix4x4.perspective(Math.PI / 3, 1, NEAR, FAR).setNearFar(newNear, newFar);
    expect(persp.getNearPlane()).toBeCloseTo(newNear, 4);
    expect(Math.abs(persp.getFarPlane() - newFar) / newFar).toBeLessThan(1e-4);
    const expected = Matrix4x4.perspective(Math.PI / 3, 1, newNear, newFar);
    for (let i = 0; i < 16; i++) {
      expect(persp[i]).toBeCloseTo(expected[i], 5);
    }
    const ortho = Matrix4x4.ortho(-10, 10, -10, 10, NEAR, FAR).setNearFar(newNear, newFar);
    expect(ortho.getNearPlane()).toBeCloseTo(newNear, 4);
    expect(Math.abs(ortho.getFarPlane() - newFar) / newFar).toBeLessThan(1e-4);
  });

  test('isPerspective/isOrtho classification is convention independent', () => {
    expect(Matrix4x4.perspective(Math.PI / 3, 1, NEAR, FAR).isPerspective()).toBe(true);
    expect(Matrix4x4.ortho(-1, 1, -1, 1, NEAR, FAR).isOrtho()).toBe(true);
  });

  test('oblique projection helpers are gated under reverse-Z', () => {
    const proj = Matrix4x4.perspective(Math.PI / 3, 1, NEAR, FAR);
    const plane = new Plane(0, 1, 0, 0);
    const nearPlane = new Vector4(0, 1, 0, 0);
    if (REVERSE_Z) {
      expect(() => Matrix4x4.obliqueProjection(proj, plane)).toThrow(/reverse-Z/);
      expect(() => Matrix4x4.obliquePerspective(proj, nearPlane)).toThrow(/reverse-Z/);
    } else {
      expect(() => Matrix4x4.obliqueProjection(proj, plane)).not.toThrow();
      expect(() => Matrix4x4.obliquePerspective(proj, nearPlane)).not.toThrow();
    }
  });
});
