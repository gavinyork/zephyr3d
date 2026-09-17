/**
 * Checks for the water surface sampler against a scripted surface.
 *
 * The sampler's job is bookkeeping around an asynchronous batch query: when it
 * fires, how it eases, how it interpolates. A fake water that answers the query
 * with a known height function pins all three down without a GPU.
 */

import { Vector3 } from '@zephyr3d/base';
import type { WaterSurfaceSource } from '../../../libs/scene/src/scene/water_surface_sampler';
import { WaterSurfaceSampler } from '../../../libs/scene/src/scene/water_surface_sampler';

/** A water whose surface is `level + height(x, z)`, answering after a tick. */
function createFakeWater(level: number, height: (x: number, z: number) => number) {
  let waveTime = 0;
  let queries = 0;
  const water: WaterSurfaceSource = {
    worldMatrix: { m03: 0, m13: level, m23: 0 },
    get waveTime() {
      return waveTime;
    },
    async getSurfacePoint(points: Vector3[], outPos?: Vector3[]) {
      queries++;
      await Promise.resolve();
      for (let i = 0; i < points.length; i++) {
        outPos?.[i].setXYZ(points[i].x, level + height(points[i].x, points[i].z), points[i].z);
      }
    }
  };
  return {
    water,
    advance(dt: number) {
      waveTime += dt;
    },
    get queries() {
      return queries;
    }
  };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('WaterSurfaceSampler', () => {
  test('answers the still-water level until the first batch lands', async () => {
    const fake = createFakeWater(2, () => 1);
    const sampler = new WaterSurfaceSampler(fake.water, { spacing: 1, cols: 4, rows: 4, updateHz: 1000 });
    expect(sampler.ready).toBe(false);
    expect(sampler.sampleWorldY(0, 0)).toBe(2);
    sampler.update(1 / 60);
    expect(sampler.pending).toBe(true);
    await flush();
    expect(sampler.ready).toBe(true);
    expect(sampler.readCount).toBe(1);
    // The first batch is adopted outright.
    expect(sampler.sampleWorldY(0, 0)).toBeCloseTo(3);
  });

  test('interpolates bilinearly across the lattice and clamps outside it', async () => {
    const fake = createFakeWater(0, (x, z) => 0.5 * x + 0.25 * z);
    const sampler = new WaterSurfaceSampler(fake.water, { spacing: 2, cols: 5, rows: 5, updateHz: 1000 });
    sampler.update(1 / 60);
    await flush();
    // A plane is reproduced exactly by bilinear interpolation.
    expect(sampler.sampleWorldYRaw(1.3, -0.7)).toBeCloseTo(0.5 * 1.3 + 0.25 * -0.7, 5);
    // The lattice spans -4..4; beyond it the nearest cell answers.
    expect(sampler.sampleWorldYRaw(100, 0)).toBeCloseTo(sampler.sampleWorldYRaw(4, 0), 5);
    const n = sampler.sampleNormal(0, 0);
    expect(n.y).toBeGreaterThan(0);
    expect(n.x).toBeLessThan(0);
    expect(n.z).toBeLessThan(0);
    expect(n.magnitude).toBeCloseTo(1, 5);
  });

  test('eases towards a new measurement instead of stepping to it', async () => {
    let h = 0;
    const fake = createFakeWater(0, () => h);
    const sampler = new WaterSurfaceSampler(fake.water, {
      spacing: 1,
      cols: 2,
      rows: 2,
      updateHz: 1000,
      timeConstant: 0.5
    });
    sampler.update(1 / 60);
    await flush();
    h = 1;
    sampler.update(1 / 60);
    await flush();
    // Easing runs once a frame, in update, so one more frame moves the eased
    // table a first small step. The raw table has the new value at once.
    sampler.update(1 / 60);
    expect(sampler.sampleWorldYRaw(0, 0)).toBeCloseTo(1);
    const eased = sampler.sampleWorldY(0, 0);
    expect(eased).toBeGreaterThan(0);
    expect(eased).toBeLessThan(0.2);
    // One time constant later it has closed most of the gap.
    for (let i = 0; i < 30; i++) {
      sampler.update(1 / 60);
    }
    expect(sampler.sampleWorldY(0, 0)).toBeGreaterThan(0.6);
  });

  test('respects the query rate and never overlaps batches', async () => {
    const fake = createFakeWater(0, () => 0);
    const sampler = new WaterSurfaceSampler(fake.water, { spacing: 1, cols: 2, rows: 2, updateHz: 10 });
    for (let i = 0; i < 60; i++) {
      sampler.update(1 / 60);
      await flush();
    }
    // A second at 10 Hz: about ten batches, less the frames the first one
    // waits for the rate window to open.
    expect(fake.queries).toBeGreaterThanOrEqual(8);
    expect(fake.queries).toBeLessThanOrEqual(11);
  });

  test('extra points ride along and report back in order', async () => {
    const fake = createFakeWater(0, (x) => x);
    const sampler = new WaterSurfaceSampler(fake.water, { spacing: 1, cols: 2, rows: 2, updateHz: 1000 });
    const inputs = [new Vector3(7, 0, 0), new Vector3(-3, 0, 0)];
    let got: number[] = [];
    const remove = sampler.addExtraPoints(inputs, (results) => {
      got = results.map((r) => r.y);
    });
    sampler.update(1 / 60);
    await flush();
    expect(got).toEqual([7, -3]);
    expect(sampler.batchSize).toBe(4 + 2);
    remove();
    sampler.update(1 / 60);
    await flush();
    expect(sampler.batchSize).toBe(4);
  });
});

describe('buoyancy source isolation', () => {
  test.each([false, true])('disturber sampling opt-in: %s', async (includeDisturbers) => {
    const query = jest.fn(async (points: Vector3[], out?: Vector3[], _norm?: Vector3[], wakes = true) => {
      points.forEach((p, i) => out?.[i].setXYZ(p.x, 2 + (wakes ? 10 : 0), p.z));
    });
    const water: WaterSurfaceSource = {
      worldMatrix: { m03: 0, m13: 0, m23: 0 },
      waveTime: 0,
      getSurfacePoint: query
    };
    const sampler = new WaterSurfaceSampler(water, {
      cols: 2,
      rows: 2,
      ...(includeDisturbers ? { includeDisturbers: true } : {})
    });
    sampler.update(1 / 30);
    await flush();
    expect(query.mock.calls[0][3]).toBe(includeDisturbers);
    expect(sampler.sampleWorldYRaw(0, 0)).toBe(includeDisturbers ? 12 : 2);
  });
});
