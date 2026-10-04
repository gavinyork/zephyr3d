import {
  autoScreenSize,
  buildLodChain,
  calculateViewDistance
} from '../../../libs/scene/src/asset/mesh_lod_builder';
import type { MeshSimplifier } from '../../../libs/scene/src/asset/mesh_lod_builder';
import { getMeshLodTargets, MAX_MESH_LODS } from '../../../libs/scene/src/asset/mesh_settings';
import { SharedModel } from '../../../libs/scene/src/asset/model';
import type { AssetPrimitiveInfo } from '../../../libs/scene/src/asset/model';
import { Vector3 } from '../../../libs/base/src';

// Stands in for meshoptimizer's simplifier, which is ESM only: keeps the first target indices and
// reports an error growing as the triangle count shrinks
function fakeSimplifier(errorScale = 0.01, floor = 0): MeshSimplifier & { calls: number[] } {
  const calls: number[] = [];
  const run = (indices: Uint32Array, target: number): [Uint32Array, number] => {
    calls.push(target);
    const count = Math.max(target, floor);
    return [indices.slice(0, Math.min(count, indices.length)), errorScale * (indices.length / count)];
  };
  return {
    calls,
    simplify: (indices, _p, _s, target) => run(indices, target),
    simplifyWithAttributes: (indices, _p, _s, _a, _as, _w, _l, target) => run(indices, target)
  };
}

const TRIANGLES = 1000;
const indices = new Uint32Array(TRIANGLES * 3).map((_, i) => i % 300);
const positions = new Float32Array(300 * 3);

describe('mesh level of detail chain', () => {
  test('UE automatic screen size', () => {
    // CalculateViewDistance: deviation * 960 / pixel error
    expect(calculateViewDistance(0.01, 8)).toBeCloseTo(1.2, 6);
    // ComputeBoundsScreenSize with FPerspectiveMatrix(PI/4, 1920, 1080): ScreenMultiple 0.5 * 16/9
    expect(autoScreenSize(1, 10)).toBeCloseTo((2 * (8 / 9)) / 10, 6);
  });

  test('levels reduce from the source by the reduction per step', () => {
    const simplifier = fakeSimplifier();
    // 1000 -> 500 -> 250 -> 125; 62 would fall below the minimum
    const { indices: all, levels } = buildLodChain(simplifier, indices, positions, null, 1, {
      lodMinTriangles: 100,
      lodReduction: 0.5,
      lodPixelError: 8
    });
    expect(simplifier.calls).toEqual([1500, 750, 375].map((n) => Math.floor(n / 3) * 3));
    expect(levels.map((l) => l.indexCount)).toEqual([3000, 1500, 750, 375]);
    // Back to back, the source first and unchanged
    expect(levels.map((l) => l.indexStart)).toEqual([0, 3000, 4500, 5250]);
    expect(all.length).toBe(3000 + 1500 + 750 + 375);
    expect(Array.from(all.subarray(0, 3000))).toEqual(Array.from(indices));
    // Sizes follow the error and decrease, levels after the first get the hysteresis
    expect(levels[0].screenSize).toBe(2);
    for (let i = 1; i < levels.length; i++) {
      const expected = autoScreenSize(1, calculateViewDistance(levels[i].error, 8) + 1);
      expect(levels[i].screenSize).toBeCloseTo(Math.min(expected, levels[i - 1].screenSize), 6);
      expect(levels[i].screenSize).toBeLessThan(levels[i - 1].screenSize);
      expect(levels[i].hysteresis).toBe(0.02);
    }
  });

  test('a level larger than its predecessor is halved as UE does', () => {
    // The second reduction reports a smaller error than the first, so a larger automatic size
    const errors = [0.1, 0.001];
    const simplifier: MeshSimplifier = {
      simplify: (idx, _p, _s, target) => [idx.slice(0, target), errors.shift()!],
      simplifyWithAttributes: () => {
        throw new Error('no normals given');
      }
    };
    const { levels } = buildLodChain(simplifier, indices, positions, null, 1, {
      lodMinTriangles: 250,
      lodReduction: 0.5,
      lodPixelError: 8
    });
    expect(levels.length).toBe(3);
    expect(levels[2].screenSize).toBeCloseTo(levels[1].screenSize / 2, 9);
  });

  test('stops when simplification makes no progress', () => {
    // Cannot go below 1500 indices
    const { levels } = buildLodChain(fakeSimplifier(0.01, 1500), indices, positions, null, 1, {
      lodMinTriangles: 1,
      lodReduction: 0.5,
      lodPixelError: 8
    });
    expect(levels.map((l) => l.indexCount)).toEqual([3000, 1500]);
  });

  test('a level simplified below the minimum is dropped', () => {
    // Pruning overshoots: every target comes back 20 triangles short
    const simplifier: MeshSimplifier = {
      simplify: (idx, _p, _s, target) => [idx.slice(0, target - 60), 0.01],
      simplifyWithAttributes: () => {
        throw new Error('no normals given');
      }
    };
    // Targets 500 and 250 triangles; 250 comes back as 230, under the minimum of 240
    const { levels } = buildLodChain(simplifier, indices, positions, null, 1, {
      lodMinTriangles: 240,
      lodReduction: 0.5,
      lodPixelError: 8
    });
    expect(levels.map((l) => l.indexCount)).toEqual([3000, 1440]);
  });

  test('no level for a source at or below the minimum', () => {
    const simplifier = fakeSimplifier();
    const { levels } = buildLodChain(simplifier, indices, positions, null, 1, {
      lodMinTriangles: 501,
      lodReduction: 0.5,
      lodPixelError: 8
    });
    expect(levels.length).toBe(1);
    expect(simplifier.calls).toEqual([]);
  });

  test('the level count is capped at the engine maximum', () => {
    const { levels } = buildLodChain(fakeSimplifier(), indices, positions, null, 1, {
      lodMinTriangles: 1,
      lodReduction: 0.9,
      lodPixelError: 8
    });
    expect(levels.length).toBe(8);
  });

  test('the engine predicts the targets the chain aims for', () => {
    const settings = { lodEnabled: true, lodMinTriangles: 100, lodReduction: 0.5 };
    expect(getMeshLodTargets(TRIANGLES, settings)).toEqual([1000, 500, 250, 125]);
    expect(getMeshLodTargets(TRIANGLES, { ...settings, lodEnabled: false })).toEqual([1000]);
    expect(getMeshLodTargets(150, settings)).toEqual([150]);
    expect(getMeshLodTargets(TRIANGLES, { ...settings, lodMinTriangles: 1, lodReduction: 0.9 }).length).toBe(
      MAX_MESH_LODS
    );
  });
});

describe('SharedModel.generateLods', () => {
  function triangleInfo(indexed: boolean): AssetPrimitiveInfo {
    const vertexCount = TRIANGLES * 3;
    const positions = new Float32Array(vertexCount * 3).map((_, i) => i % 7);
    return {
      vertices: { position: { format: 'position_f32x3', data: positions } } as AssetPrimitiveInfo['vertices'],
      indices: indexed ? new Uint32Array(vertexCount).map((_, i) => i) : null,
      indexCount: vertexCount,
      type: 'triangle-list',
      boxMin: new Vector3(0, 0, 0),
      boxMax: new Vector3(2, 2, 2)
    };
  }

  test('levels are appended to the indices of the first level', async () => {
    const model = new SharedModel();
    const info = triangleInfo(true);
    model.addPrimitive(info);
    expect(await model.generateLods(fakeSimplifier(), { lodMinTriangles: 100, lodReduction: 0.5 })).toBe(1);
    // 1000 -> 500 -> 250 -> 125 triangles
    expect(info.indexCount).toBe(3000);
    expect(info.lods!.map((l) => [l.indexStart, l.indexCount])).toEqual([
      [3000, 1500],
      [4500, 750],
      [5250, 375]
    ]);
    expect(info.indices!.length).toBe(3000 + 1500 + 750 + 375);
    // Fewer than 65536 vertices: 16 bit indices
    expect(info.indices).toBeInstanceOf(Uint16Array);
    expect(info.lods![0].screenSize).toBeLessThan(2);
  });

  test('a mesh without indices gets the vertices in order as its first level', async () => {
    const model = new SharedModel();
    const info = triangleInfo(false);
    model.addPrimitive(info);
    await model.generateLods(fakeSimplifier(), { lodMinTriangles: 400 });
    expect(Array.from(info.indices!.subarray(0, 6))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(info.lods!.length).toBe(1);
  });

  test('meshes that are not triangle lists or too small are left alone', async () => {
    const model = new SharedModel();
    const lines = { ...triangleInfo(true), type: 'line-list' as const };
    const small = triangleInfo(true);
    model.addPrimitive(lines);
    model.addPrimitive(small);
    expect(await model.generateLods(fakeSimplifier(), { lodMinTriangles: 600 })).toBe(0);
    expect(lines.lods).toBeUndefined();
    expect(small.lods).toBeUndefined();
    expect(small.indices!.length).toBe(3000);
  });
});
