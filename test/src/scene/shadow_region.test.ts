import { AABB, Vector3 } from '@zephyr3d/base';
import { BoundingBox } from '../../../libs/scene/src/utility/bounding_volume';
import { ShadowRegion } from '../../../libs/scene/src/shadow/shadow_region';
import type { SceneNode } from '../../../libs/scene/src/scene/scene_node';

class MockShadowCaster {
  castShadow = true;
  disposed = false;
  private _aabb: AABB;
  private readonly _listeners = new Set<(node: SceneNode) => void>();

  constructor(aabb: AABB) {
    this._aabb = aabb;
  }

  dispose() {
    this.disposed = true;
  }

  isMesh() {
    return true;
  }

  isClipmapTerrain() {
    return false;
  }

  getWorldBoundingVolume() {
    return new BoundingBox(this._aabb);
  }

  setAABB(aabb: AABB) {
    this._aabb = aabb;
    this.dispatchBVChanged();
  }

  get listenerCount() {
    return this._listeners.size;
  }

  on(type: 'bvchanged', listener: (node: SceneNode) => void) {
    if (type === 'bvchanged') {
      this._listeners.add(listener);
    }
  }

  off(type: 'bvchanged', listener?: (node: SceneNode) => void) {
    if (type !== 'bvchanged' || !listener) {
      return;
    }
    this._listeners.delete(listener);
  }

  private dispatchBVChanged() {
    for (const listener of [...this._listeners]) {
      listener(this as unknown as SceneNode);
    }
  }
}

function makeAABB(minX: number, maxX: number) {
  return new AABB(new Vector3(minX, 0, 0), new Vector3(maxX, 1, 1));
}

describe('ShadowRegion', () => {
  test('keeps static caster snapshots while updating dynamic casters', () => {
    const region = new ShadowRegion();
    const staticCaster = new MockShadowCaster(makeAABB(0, 1));
    const dynamicCaster = new MockShadowCaster(makeAABB(2, 3));

    expect(region.addStaticCaster(staticCaster as unknown as SceneNode)).toBe(region);
    expect(region.addDynamicCaster(dynamicCaster as unknown as SceneNode)).toBe(region);
    expect(region.region!.minPoint.x).toBe(0);
    expect(region.region!.maxPoint.x).toBe(3);

    staticCaster.setAABB(makeAABB(-10, -9));
    expect(region.region!.minPoint.x).toBe(0);

    dynamicCaster.setAABB(makeAABB(4, 5));
    expect(region.region!.minPoint.x).toBe(0);
    expect(region.region!.maxPoint.x).toBe(5);
  });

  test('removes dynamic caster subscriptions', () => {
    const region = new ShadowRegion();
    const dynamicCaster = new MockShadowCaster(makeAABB(0, 1));

    region.addDynamicCaster(dynamicCaster as unknown as SceneNode);
    expect(dynamicCaster.listenerCount).toBe(1);
    expect(region.removeCaster(dynamicCaster as unknown as SceneNode)).toBe(region);
    expect(dynamicCaster.listenerCount).toBe(0);
    expect(region.region).toBeNull();

    dynamicCaster.setAABB(makeAABB(10, 11));
    expect(region.region).toBeNull();
  });

  test('unsubscribes dynamic casters on dispose', () => {
    const region = new ShadowRegion();
    const dynamicCaster = new MockShadowCaster(makeAABB(0, 1));

    region.addDynamicCaster(dynamicCaster as unknown as SceneNode);
    expect(dynamicCaster.listenerCount).toBe(1);
    region.dispose();
    expect(dynamicCaster.listenerCount).toBe(0);
  });
});
