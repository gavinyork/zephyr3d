import { createNullDevice } from '@zephyr3d/backend-null';
import type { NullDevice } from '@zephyr3d/backend-null';
import type { FrameBuffer, Texture2D } from '@zephyr3d/device';
import { RenderGraph, RenderGraphExecutor } from '../../../libs/scene/src/render/rendergraph';
import { DevicePoolAllocator } from '../../../libs/scene/src/render/rendergraph/device_pool_allocator';
import type {
  RGFramebufferDesc,
  RGHandle,
  RGResolvedSize,
  RGTextureAllocator,
  RGTextureDesc
} from '../../../libs/scene/src/render/rendergraph';

// ─── Strict Allocator ────────────────────────────────────────────────
//
// Wraps the real device pool allocator, but unlike the pool it does NOT
// refcount framebuffer attachments: a texture released back to the allocator
// is immediately disposed. This models the weakest legal RGTextureAllocator and
// catches any executor schedule that releases a texture while a graph-managed
// framebuffer referencing it can still be used by a later pass.
//
// The textures and framebuffers are real device objects, so "still usable" is
// decided by the device itself rather than by bookkeeping in the test.

function createStrictAllocator(device: NullDevice) {
  const pool = new DevicePoolAllocator(device as never);
  const allocated: Texture2D[] = [];
  const released: Texture2D[] = [];
  const framebuffers: FrameBuffer[] = [];
  const allocator: RGTextureAllocator<Texture2D> = {
    allocate(desc: RGTextureDesc, size: RGResolvedSize, preferred?: Texture2D): Texture2D {
      const texture = pool.allocate(desc, size, preferred);
      allocated.push(texture);
      return texture;
    },
    release(texture: Texture2D): void {
      if (texture.disposed) {
        throw new Error(`double release of texture ${texture.uid}`);
      }
      released.push(texture);
      // Dispose instead of recycling: the weakest allowed allocator behavior.
      texture.dispose();
      texture.destroy();
    },
    allocateFramebuffer(desc: RGFramebufferDesc): FrameBuffer {
      const fb = pool.allocateFramebuffer(desc);
      framebuffers.push(fb);
      return fb;
    },
    releaseFramebuffer(framebuffer: FrameBuffer): void {
      pool.releaseFramebuffer(framebuffer);
    }
  };
  // Simulates a pass rendering through a framebuffer: binding fails on the
  // device when any attachment has been disposed.
  const renderThrough = (fb: FrameBuffer) => {
    device.setFramebuffer(fb);
    if (device.getFramebuffer() !== fb) {
      throw new Error(`render through framebuffer ${fb.uid} with a released attachment`);
    }
    device.draw('triangle-list', 0, 3);
    device.setFramebuffer(null);
  };
  return { allocator, allocated, released, framebuffers, renderThrough };
}

// ─── Regression Tests ────────────────────────────────────────────────
//
// Scenario mirrored from the forward+ builder: DepthPrepass creates a depth
// texture and a framebuffer over it; later passes read the *framebuffer*
// handle (not the texture) and render through it. The backing texture must
// stay alive until the framebuffer's last reader, even though the texture
// itself has no direct consumers after its producer.

describe('Framebuffer attachment lifetime', () => {
  let device: NullDevice;

  beforeEach(async () => {
    // strict: a device level validation failure fails the test instead of
    // only writing to the console.
    device = await createNullDevice({ width: 256, height: 256, strict: true });
  });

  test('attachment texture outlives the last pass reading the framebuffer', () => {
    const { allocator, allocated, released, renderThrough } = createStrictAllocator(device);
    const graph = new RenderGraph();

    let depthTexHandle: RGHandle;
    let depthFbHandle: RGHandle;
    graph.addPass('DepthPrepass', (builder) => {
      depthTexHandle = builder.createTexture({ format: 'd24s8', label: 'sceneDepth' });
      depthFbHandle = builder.createFramebuffer({
        label: 'DepthFramebuffer',
        colorAttachments: null,
        depthAttachment: depthTexHandle
      });
      builder.setExecute((rgCtx) => {
        renderThrough(rgCtx.getFramebuffer(depthFbHandle as never));
      });
    });

    // Intermediate pass that neither reads the depth texture nor the
    // framebuffer: without lifetime propagation the texture's lastUse would
    // be DepthPrepass and it would be released before TransparentPass runs.
    let colorHandle: RGHandle;
    graph.addPass('LightPass', (builder) => {
      builder.read(depthFbHandle);
      colorHandle = builder.createTexture({ format: 'rgba8unorm', label: 'sceneColor' });
      builder.setExecute((rgCtx) => {
        renderThrough(rgCtx.getFramebuffer(depthFbHandle as never));
        rgCtx.getTexture<Texture2D>(colorHandle as never);
      });
    });

    let backbuffer = graph.importTexture('backbuffer');
    graph.addPass('TransparentPass', (builder) => {
      builder.read(depthFbHandle);
      builder.read(colorHandle);
      backbuffer = builder.write(backbuffer);
      builder.setExecute((rgCtx) => {
        // Renders depth-tested geometry through the prepass framebuffer's
        // depth attachment: the backing texture must still be alive here.
        renderThrough(rgCtx.getFramebuffer(depthFbHandle as never));
      });
    });

    const compiled = graph.compile([backbuffer]);

    // The depth texture's lifetime must extend to the framebuffer's last reader.
    const graphResources = [...graph.resources.values()];
    const depthRes = graphResources.find((res) => res.name === 'sceneDepth')!;
    const fbRes = graphResources.find((res) => res.name === 'DepthFramebuffer')!;
    const depthLifetime = compiled.lifetimes.get(depthRes.id)!;
    const fbLifetime = compiled.lifetimes.get(fbRes.id)!;
    expect(depthLifetime.lastUse).toBeGreaterThanOrEqual(fbLifetime.lastUse);

    const executor = new RenderGraphExecutor(allocator, 256, 256);
    executor.setImportedTexture(
      backbuffer,
      device.createTexture2D('rgba8unorm', 256, 256, { mipmapping: false })!
    );
    // Throws "render through framebuffer with a released attachment" without
    // framebuffer-attachment lifetime propagation.
    executor.execute(compiled);

    // Everything allocated was eventually released, exactly once each.
    expect(released.length).toBe(allocated.length);
    executor.reset();
  });

  test('color attachment shared by two framebuffers stays alive for both', () => {
    const { allocator, allocated, released, renderThrough } = createStrictAllocator(device);
    const graph = new RenderGraph();

    // Mirrors DepthPrepass creating both the MRT depth framebuffer and the
    // sky motion vector framebuffer over the same motionVector texture, with
    // the second framebuffer read much later.
    let mvHandle: RGHandle;
    let fbA: RGHandle;
    let fbB: RGHandle;
    graph.addPass('Produce', (builder) => {
      mvHandle = builder.createTexture({ format: 'rgba16f', label: 'motionVector' });
      fbA = builder.createFramebuffer({ label: 'fbA', colorAttachments: mvHandle });
      fbB = builder.createFramebuffer({ label: 'fbB', colorAttachments: mvHandle });
      builder.setExecute((rgCtx) => {
        renderThrough(rgCtx.getFramebuffer(fbA as never));
        renderThrough(rgCtx.getFramebuffer(fbB as never));
      });
    });

    let backbuffer = graph.importTexture('backbuffer');
    graph.addPass('LateConsumer', (builder) => {
      builder.read(fbB);
      backbuffer = builder.write(backbuffer);
      builder.setExecute((rgCtx) => {
        renderThrough(rgCtx.getFramebuffer(fbB as never));
      });
    });

    const compiled = graph.compile([backbuffer]);
    const executor = new RenderGraphExecutor(allocator, 128, 128);
    executor.setImportedTexture(
      backbuffer,
      device.createTexture2D('rgba8unorm', 128, 128, { mipmapping: false })!
    );
    executor.execute(compiled);

    expect(released.length).toBe(allocated.length);
    executor.reset();
  });
});
