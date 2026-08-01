/**
 * CPU mirrors of the ShaderHelper depth linearization formulas, validated
 * under both depth conventions:
 *  - round trip: linearize(delinearize(d)) == d
 *  - consistency with the projection matrices (device depth of an eye-space
 *    point linearizes back to its view distance)
 *  - the normalized linear depth convention (1 = far plane) holds regardless
 *    of the depth convention
 */

import { Matrix4x4, REVERSE_Z, Vector4 } from '@zephyr3d/base';

const NEAR = 0.5;
const FAR = 750;

// Mirrors of ShaderHelper formulas (helper.ts)
function nonLinearDepthToLinear(d: number, n = NEAR, f = FAR): number {
  return REVERSE_Z ? (n * f) / (n + (f - n) * d) : (n * f) / (f + (n - f) * d);
}
function linearDepthToNonLinear(z: number, n = NEAR, f = FAR): number {
  return REVERSE_Z ? ((n * f) / z - n) / (f - n) : (f - (n * f) / z) / (f - n);
}
function nonLinearDepthToLinearNormalized(d: number, n = NEAR, f = FAR): number {
  return REVERSE_Z ? n / (n + (f - n) * d) : n / (f + (n - f) * d);
}
function linearNormalizedToNonLinearDepth(lin: number, n = NEAR, f = FAR): number {
  return REVERSE_Z ? (n / lin - n) / (f - n) : (n / lin - f) / (n - f);
}

function deviceDepth(proj: Matrix4x4, eyeZ: number): number {
  const clip = proj.transform(new Vector4(0, 0, eyeZ, 1));
  const ndcZ = clip.z / clip.w;
  return REVERSE_Z ? ndcZ : (ndcZ + 1) / 2;
}

describe('depth linearization under the active convention', () => {
  test('linearize/delinearize round trip', () => {
    for (let i = 0; i <= 16; i++) {
      const d = i / 16;
      expect(linearDepthToNonLinear(nonLinearDepthToLinear(d))).toBeCloseTo(d, 6);
    }
  });

  test('normalized linearize/delinearize round trip', () => {
    for (let i = 0; i <= 16; i++) {
      const d = i / 16;
      expect(linearNormalizedToNonLinearDepth(nonLinearDepthToLinearNormalized(d))).toBeCloseTo(d, 6);
    }
  });

  test('device depth from projection linearizes back to view distance', () => {
    const proj = Matrix4x4.perspective(Math.PI / 3, 1, NEAR, FAR);
    for (const dist of [NEAR, 1, 10, 100, FAR]) {
      const d = deviceDepth(proj, -dist);
      expect(nonLinearDepthToLinear(d) / dist).toBeCloseTo(1, 3);
    }
  });

  test('normalized linear depth keeps 1 = far plane in both conventions', () => {
    const proj = Matrix4x4.perspective(Math.PI / 3, 1, NEAR, FAR);
    const dFar = deviceDepth(proj, -FAR);
    const dNear = deviceDepth(proj, -NEAR);
    expect(nonLinearDepthToLinearNormalized(dFar)).toBeCloseTo(1, 4);
    expect(nonLinearDepthToLinearNormalized(dNear)).toBeCloseTo(NEAR / FAR, 6);
  });
});
