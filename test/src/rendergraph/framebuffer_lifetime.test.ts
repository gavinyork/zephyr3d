import { RenderGraph, RenderGraphExecutor } from '../../../libs/scene/src/render/rendergraph';
import type {
  RGTextureAllocator,
  RGTextureDesc,
  RGResolvedSize,
  RGFramebufferDesc,
  RGHandle
} from '../../../libs/scene/src/render/rendergraph';

// ─── Strict Mock Allocator ───────────────────────────────────────────
//
// Unlike the device pool, this allocator does NOT refcount framebuffer
// attachments: a texture released back to the allocator is immediately
// invalid. This models the weakest legal RGTextureAllocator and catches
// any executor schedule that releases a texture while a graph-managed
// framebuffer referencing it can still be used by a later pass.

interface MockTexture {
  id: number;
  desc: RGTextureDesc;
  size: RGResolvedSize;
  alive: boolean;
}

interface MockFramebuffer {
  id: number;
  attachments: MockTexture[];
  alive: boolean;
}

function createStrictAllocator() {
  let nextTextureId = 0;
  let nextFramebufferId = 0;
  const allocated: MockTexture[] = [];
  const released: MockTexture[] = [];
  const framebuffers: MockFramebuffer[] = [];
  const allocator: RGTextureAllocator<MockTexture, MockFramebuffer> = {
    allocate(desc: RGTextureDesc, size: RGResolvedSize): MockTexture {
      const tex: MockTexture = { id: nextTextureId++, desc, size, alive: true };
      allocated.push(tex);
      return tex;
    },
    release(texture: MockTexture): void {
      if (!texture.alive) {
        throw new Error(`double release of texture ${texture.id}`);
      }
      texture.alive = false;
      released.push(texture);
    },
    allocateFramebuffer(desc: RGFramebufferDesc): MockFramebuffer {
      const colors = Array.isArray(desc.colorAttachments)
        ? desc.colorAttachments
        : desc.colorAttachments
          ? [desc.colorAttachments]
          : [];
      const attachments = [...colors, desc.depthAttachment].filter(
        (attachment): attachment is MockTexture =>
          !!attachment && typeof attachment === 'object' && 'alive' in (attachment as object)
      );
      for (const tex of attachments) {
        if (!tex.alive) {
          throw new Error(`framebuffer created with released texture ${tex.id}`);
        }
      }
      const fb: MockFramebuffer = { id: nextFramebufferId++, attachments, alive: true };
      framebuffers.push(fb);
      return fb;
    },
    releaseFramebuffer(framebuffer: MockFramebuffer): void {
      framebuffer.alive = false;
    }
  };
  // Simulates a pass rendering through a framebuffer: every attachment must
  // still be alive.
  const renderThrough = (fb: MockFramebuffer) => {
    if (!fb.alive) {
      throw new Error(`render through released framebuffer ${fb.id}`);
    }
    for (const tex of fb.attachments) {
      if (!tex.alive) {
        throw new Error(`render through framebuffer ${fb.id} with released attachment ${tex.id}`);
      }
    }
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
  test('attachment texture outlives the last pass reading the framebuffer', () => {
    const { allocator, allocated, released, renderThrough } = createStrictAllocator();
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
        renderThrough(rgCtx.getFramebuffer<MockFramebuffer>(depthFbHandle));
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
        renderThrough(rgCtx.getFramebuffer<MockFramebuffer>(depthFbHandle));
        rgCtx.getTexture<MockTexture>(colorHandle);
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
        renderThrough(rgCtx.getFramebuffer<MockFramebuffer>(depthFbHandle));
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
    executor.setImportedTexture(backbuffer, {
      id: -1,
      desc: {} as RGTextureDesc,
      size: { width: 256, height: 256 },
      alive: true
    });
    // Throws "render through framebuffer with released attachment" without
    // framebuffer-attachment lifetime propagation.
    executor.execute(compiled);

    // Everything allocated was eventually released, exactly once each.
    expect(released.length).toBe(allocated.length);
    executor.reset();
  });

  test('color attachment shared by two framebuffers stays alive for both', () => {
    const { allocator, allocated, released, renderThrough } = createStrictAllocator();
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
        renderThrough(rgCtx.getFramebuffer<MockFramebuffer>(fbA));
        renderThrough(rgCtx.getFramebuffer<MockFramebuffer>(fbB));
      });
    });

    let backbuffer = graph.importTexture('backbuffer');
    graph.addPass('LateConsumer', (builder) => {
      builder.read(fbB);
      backbuffer = builder.write(backbuffer);
      builder.setExecute((rgCtx) => {
        renderThrough(rgCtx.getFramebuffer<MockFramebuffer>(fbB));
      });
    });

    const compiled = graph.compile([backbuffer]);
    const executor = new RenderGraphExecutor(allocator, 128, 128);
    executor.setImportedTexture(backbuffer, {
      id: -1,
      desc: {} as RGTextureDesc,
      size: { width: 128, height: 128 },
      alive: true
    });
    executor.execute(compiled);

    expect(released.length).toBe(allocated.length);
    executor.reset();
  });
});
