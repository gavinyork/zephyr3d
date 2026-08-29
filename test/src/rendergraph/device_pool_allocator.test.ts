/**
 * Render graph execution against the real device pool allocator.
 *
 * The other render graph tests drive the executor through hand-written mock
 * allocators, which cannot catch a mismatch between the executor's release
 * schedule and the pool's actual refcounting. A null device provides a real
 * Pool, so DevicePoolAllocator can be exercised end to end without a GPU.
 */

import type { Texture2D } from '@zephyr3d/device';
import type { NullDevice } from '@zephyr3d/backend-null';
import { createNullDevice } from '@zephyr3d/backend-null';
import { RenderGraph, RenderGraphExecutor } from '../../../libs/scene/src/render/rendergraph';
import { DevicePoolAllocator } from '../../../libs/scene/src/render/rendergraph/device_pool_allocator';
import type { RGHandle } from '../../../libs/scene/src/render/rendergraph';

describe('DevicePoolAllocator on a null device', () => {
  let device: NullDevice;
  let allocator: DevicePoolAllocator;

  beforeEach(async () => {
    device = await createNullDevice({ width: 256, height: 256 });
    allocator = new DevicePoolAllocator(device as never);
  });

  test('allocates pooled textures of the requested format and size', () => {
    const texture = allocator.allocate({ format: 'rgba16f', label: 'test' }, { width: 64, height: 32 });
    expect(texture.format).toBe('rgba16f');
    expect(texture.width).toBe(64);
    expect(texture.height).toBe(32);
    expect(texture.mipLevelCount).toBe(1);
    expect(device.pool.hasTexture(texture)).toBe(true);
    allocator.release(texture);
    expect(device.pool.hasTexture(texture)).toBe(false);
  });

  test('a mip chain request that the size cannot satisfy is rejected', () => {
    expect(() => allocator.allocate({ format: 'rgba8unorm', mipLevels: 8 }, { width: 4, height: 4 })).toThrow(
      /mip levels/
    );
  });

  test('arrayLayers requests a 2d array texture', () => {
    const texture = allocator.allocate({ format: 'rgba8unorm', arrayLayers: 4 }, { width: 32, height: 32 });
    expect(texture.isTexture2DArray()).toBe(true);
    expect(texture.depth).toBe(4);
    allocator.release(texture);
  });

  test('graph execution releases every transient texture back to the pool', () => {
    const graph = new RenderGraph();
    let depth: RGHandle;
    let color: RGHandle;
    let depthFb: RGHandle;
    let depthTexture: Texture2D;
    let colorTexture: Texture2D;

    graph.addPass('DepthPrepass', (builder) => {
      depth = builder.createTexture({ format: 'd24s8', label: 'sceneDepth' });
      depthFb = builder.createFramebuffer({
        label: 'DepthFramebuffer',
        colorAttachments: null,
        depthAttachment: depth
      });
      builder.setExecute((rgCtx) => {
        // The framebuffer must be a real device framebuffer over the pooled texture
        depthTexture = rgCtx.getTexture<Texture2D>(depth as never);
        const fb = rgCtx.getFramebuffer(depthFb as never);
        expect(fb.getDepthAttachment()).toBe(depthTexture);
        expect(device.pool.hasTexture(depthTexture)).toBe(true);
        device.setFramebuffer(fb);
        device.clearFrameBuffer(null, 1, 0);
      });
    });

    let backbuffer = graph.importTexture('backbuffer');
    graph.addPass('LightPass', (builder) => {
      builder.read(depthFb);
      color = builder.createTexture({ format: 'rgba16f', label: 'sceneColor' });
      backbuffer = builder.write(backbuffer);
      builder.setExecute((rgCtx) => {
        colorTexture = rgCtx.getTexture<Texture2D>(color as never);
        device.setFramebuffer([colorTexture]);
        device.clearFrameBuffer(null, null, null);
        device.draw('triangle-list', 0, 3);
        device.setFramebuffer(null);
      });
    });

    const compiled = graph.compile([backbuffer]);
    const backbufferTexture = device.createTexture2D('rgba8unorm', 256, 256, { mipmapping: false })!;
    const executor = new RenderGraphExecutor(allocator, 256, 256);
    executor.setImportedTexture(backbuffer, backbufferTexture);
    executor.execute(compiled);
    executor.reset();

    // Everything the graph allocated came from the pool and went back to it:
    // a leak would leave the texture allocated after execution.
    expect(depthTexture!.format).toBe('d24s8');
    expect(colorTexture!.format).toBe('rgba16f');
    expect(device.pool.hasTexture(depthTexture!)).toBe(false);
    expect(device.pool.hasTexture(colorTexture!)).toBe(false);
    // The imported backbuffer is not pool managed and must be untouched
    expect(backbufferTexture.disposed).toBe(false);

    expect(device.getCommandCount('clear')).toBe(2);
    expect(device.getCommandCount('draw')).toBe(1);
  });

  test('a second execution reuses the pooled textures of the first', () => {
    const backbufferTexture = device.createTexture2D('rgba8unorm', 256, 256, { mipmapping: false })!;

    const run = () => {
      const graph = new RenderGraph();
      let handle: RGHandle;
      let resolved: Texture2D;
      let backbuffer = graph.importTexture('backbuffer');
      graph.addPass('Pass', (builder) => {
        handle = builder.createTexture({ format: 'rgba8unorm', label: 'tmp' });
        backbuffer = builder.write(backbuffer);
        builder.setExecute((rgCtx) => {
          resolved = rgCtx.getTexture<Texture2D>(handle as never);
        });
      });
      const executor = new RenderGraphExecutor(allocator, 256, 256);
      executor.setImportedTexture(backbuffer, backbufferTexture);
      executor.execute(graph.compile([backbuffer]));
      executor.reset();
      return resolved!;
    };

    expect(run()).toBe(run());
  });
});
