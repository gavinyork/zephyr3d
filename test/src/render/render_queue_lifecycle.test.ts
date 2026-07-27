import { InstanceBindGroupAllocator, RenderQueue, type RenderPass } from '../../../libs/scene/src/render';

describe('RenderQueue lifecycle', () => {
  test('reset invalidates old refs and clears per-content caches', () => {
    const queue = new RenderQueue({} as RenderPass);
    const oldRef = queue.ref;
    const internals = queue as any;
    internals._instanceInfo.set({}, {});
    internals._objectColorMaps[0].set(1, {});
    internals._objectColorMaps.push(new Map([[2, {}]]));

    queue.reset();

    expect(oldRef.valid).toBe(false);
    expect(queue.ref).not.toBe(oldRef);
    expect(queue.ref.valid).toBe(true);
    expect(internals._instanceInfo.size).toBe(0);
    expect(internals._objectColorMaps).toHaveLength(1);
    expect(internals._objectColorMaps[0].size).toBe(0);

    queue.dispose();
    expect(queue.ref.valid).toBe(false);
  });

  test('object-color lookup snapshot survives queue disposal', async () => {
    const queue = new RenderQueue({} as RenderPass);
    const firstDrawable = {};
    const mergedDrawable = {};
    const duplicateDrawable = {};
    const internals = queue as any;
    internals._objectColorMaps[0].set(0x01020304, firstDrawable);
    internals._objectColorMaps.push(
      new Map([
        [0x01020304, duplicateDrawable],
        [0x05060708, mergedDrawable]
      ])
    );
    const lookup = queue.createObjectColorLookupSnapshot();

    queue.dispose();
    await Promise.resolve();

    expect(lookup(new Uint8Array([1, 2, 3, 4]))).toBe(firstDrawable);
    expect(lookup(new Uint8Array([5, 6, 7, 8]))).toBe(mergedDrawable);
    expect(lookup(new Uint8Array([9, 10, 11, 12]))).toBeNull();
    expect(queue.getDrawableByColor(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  test('allocator reset reuses allocations and dispose releases bind groups', () => {
    const allocator = new InstanceBindGroupAllocator();
    const dispose = jest.fn();
    const allocation = {
      bindGroup: { dispose },
      buffer: new Float32Array(4),
      offset: 4,
      dirty: false
    };
    (allocator as any)._allocFrameStamp = 10;
    allocator._bindGroupList.push(allocation as any);

    allocator.reset();

    expect((allocator as any)._allocFrameStamp).toBe(-1);
    expect(allocation.offset).toBe(0);
    expect(allocation.dirty).toBe(true);

    allocator.dispose();
    allocator.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(allocator._bindGroupList).toHaveLength(0);
  });
});
