import { AABB, Vector3 } from '@zephyr3d/base';
import { ShadowRegion } from '@zephyr3d/scene';

function box(min: [number, number, number], max: [number, number, number]) {
  return new AABB(new Vector3(...min), new Vector3(...max));
}

describe('ShadowRegion limit', () => {
  it('clips the region to the limit', () => {
    const region = new ShadowRegion(box([-5, -50, -5], [5, 5, 5]));
    region.setLimit(box([-10, -1, -10], [10, 10, 10]));
    const r = region.region!;
    expect([r.minPoint.x, r.minPoint.y, r.minPoint.z]).toEqual([-5, -1, -5]);
    expect([r.maxPoint.x, r.maxPoint.y, r.maxPoint.z]).toEqual([5, 5, 5]);
  });

  it('has no region when everything is outside the limit', () => {
    const region = new ShadowRegion(box([0, -50, 0], [1, -40, 1]));
    region.setLimit(box([-10, -1, -10], [10, 10, 10]));
    expect(region.region).toBeNull();
  });

  it('restores the full region when the limit is removed and keeps the limit on clear', () => {
    const region = new ShadowRegion(box([-5, -50, -5], [5, 5, 5]));
    region.setLimit(box([-10, -1, -10], [10, 10, 10]));
    region.setLimit(null);
    expect(region.region!.minPoint.y).toBe(-50);
    region.setLimit(box([-10, -1, -10], [10, 10, 10]));
    region.clear();
    expect(region.limit).not.toBeNull();
    region.setRegion(box([-20, -20, -20], [20, 20, 20]));
    expect(region.region!.maxPoint.x).toBe(10);
  });
});
