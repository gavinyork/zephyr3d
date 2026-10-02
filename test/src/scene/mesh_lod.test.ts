import { Matrix4x4, Vector3 } from '@zephyr3d/base';
import type { Camera } from '../../../libs/scene/src/camera/camera';
import {
  computeBoundsScreenRadiusSquared,
  computeBoundsScreenSize,
  selectLod
} from '../../../libs/scene/src/render/lod';
import { readZmshBinary, writeZmshBinary } from '../../../libs/scene/src/asset/zmsh_binary';

function makeCamera(proj: Matrix4x4, position: Vector3): Camera {
  return {
    getProjectionMatrix: () => proj,
    isPerspective: () => proj.isPerspective(),
    getWorldPosition: (out?: Vector3) => {
      const v = out ?? new Vector3();
      v.setXYZ(position.x, position.y, position.z);
      return v;
    }
  } as unknown as Camera;
}

// Three levels after the first, UE screen sizes
const LODS = [
  { indexStart: 6, indexCount: 3, screenSize: 0.5, hysteresis: 0 },
  { indexStart: 9, indexCount: 3, screenSize: 0.25, hysteresis: 0 },
  { indexStart: 12, indexCount: 3, screenSize: 0.125, hysteresis: 0 }
];

describe('mesh level of detail', () => {
  test('screen size follows UE ComputeBoundsScreenSize', () => {
    // 90 degrees vertical fov, square: projection scale 1, ScreenMultiple 0.5
    const camera = makeCamera(Matrix4x4.perspective(Math.PI / 2, 1, 0.1, 1000), new Vector3(0, 0, 0));
    // Radius 1 at distance 10: 2 * 0.5 * 1 / 10
    expect(computeBoundsScreenSize(new Vector3(0, 0, -10), 1, camera)).toBeCloseTo(0.1, 6);
    expect(computeBoundsScreenRadiusSquared(new Vector3(0, 0, -10), 1, camera)).toBeCloseTo(0.0025, 8);
  });

  test('orthographic size ignores the distance', () => {
    const camera = makeCamera(Matrix4x4.ortho(-10, 10, -10, 10, 0.1, 100), new Vector3(0, 0, 0));
    const near = computeBoundsScreenSize(new Vector3(0, 0, -1), 1, camera);
    const far = computeBoundsScreenSize(new Vector3(0, 0, -90), 1, camera);
    expect(near).toBeCloseTo(far, 6);
    // ScreenMultiple 0.5 * 2 / 20
    expect(near).toBeCloseTo(0.1, 6);
  });

  test('picks the coarsest level whose screen size exceeds the projected size', () => {
    const r2 = (size: number) => (size * 0.5) ** 2;
    expect(selectLod(LODS, r2(1), 1, 0, 0)).toBe(0);
    expect(selectLod(LODS, r2(0.4), 1, 0, 0)).toBe(1);
    expect(selectLod(LODS, r2(0.2), 1, 0, 0)).toBe(2);
    expect(selectLod(LODS, r2(0.01), 1, 0, 0)).toBe(3);
    // A larger scale switches sooner
    expect(selectLod(LODS, r2(0.6), 2, 0, 0)).toBe(1);
    // The finest level allowed
    expect(selectLod(LODS, r2(1), 1, 0, 2)).toBe(2);
    expect(selectLod(LODS, r2(1), 1, 0, 9)).toBe(3);
  });

  test('hysteresis holds the current level until the size grows past it', () => {
    const lods = LODS.map((l) => ({ ...l, hysteresis: 0.02 }));
    const r2 = (size: number) => (size * 0.5) ** 2;
    // Just above the LOD 1 threshold: from LOD 0 it stays at 0, from LOD 1 it stays at 1
    expect(selectLod(lods, r2(0.51), 1, 0, 0)).toBe(0);
    expect(selectLod(lods, r2(0.51), 1, 1, 0)).toBe(1);
    // Past the hysteresis it goes back to LOD 0
    expect(selectLod(lods, r2(0.53), 1, 1, 0)).toBe(0);
  });

  test('binary .zmsh keeps the level table', () => {
    const lods = [{ indexStart: 0, indexCount: 6, screenSize: 2, hysteresis: 0 }, ...LODS];
    const file = writeZmshBinary(
      {
        primitiveType: 'triangle-list',
        vertexCount: 4,
        indexCount: 15,
        boxMin: [0, 0, 0],
        boxMax: [1, 1, 0],
        encoding: 'none',
        attributes: [{ format: 'position_f32x3', byteStride: 12 }],
        indices: { type: 'u16', mode: 'TRIANGLES' },
        lods
      },
      [new Uint8Array(48)],
      new Uint8Array(30)
    );
    expect(readZmshBinary(file).header.lods).toEqual(lods);
  });
});
