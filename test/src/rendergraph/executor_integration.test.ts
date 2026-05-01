import { RenderGraph, RenderGraphExecutor } from '../../../libs/scene/src/render/rendergraph';
import type {
  RGTextureAllocator,
  RGTextureDesc,
  RGResolvedSize
} from '../../../libs/scene/src/render/rendergraph';

// ─── Mock Allocator ──────────────────────────────────────────────────

interface MockTexture {
  id: number;
  desc: RGTextureDesc;
  size: RGResolvedSize;
}

function createMockAllocator() {
  let nextId = 0;
  const allocated: MockTexture[] = [];
  const released: MockTexture[] = [];
  const allocator: RGTextureAllocator<MockTexture> = {
    allocate(desc: RGTextureDesc, size: RGResolvedSize): MockTexture {
      const tex = { id: nextId++, desc, size };
      allocated.push(tex);
      return tex;
    },
    release(texture: MockTexture): void {
      released.push(texture);
    }
  };
  return { allocator, allocated, released };
}

// ─── Integration Tests ───────────────────────────────────────────────

describe('RenderGraphExecutor Integration', () => {
  test('mixed transient and imported resources', () => {
    const { allocator, allocated, released } = createMockAllocator();
    const graph = new RenderGraph();

    // Imported resources (managed externally)
    let backbuffer = graph.importTexture('backbuffer');
    let depthBuffer = graph.importTexture('depth');

    // Transient resource (managed by executor)
    let hiZHandle: any;

    const events: string[] = [];

    graph.addPass('DepthPass', (builder) => {
      depthBuffer = builder.write(depthBuffer);
      builder.setExecute(() => {
        events.push('DepthPass');
      });
    });

    graph.addPass('HiZPass', (builder) => {
      builder.read(depthBuffer);
      hiZHandle = builder.createTexture({ format: 'r32f', label: 'hiZ', mipLevels: 8 });
      builder.setExecute((rgCtx) => {
        const hiZ = rgCtx.getTexture<MockTexture>(hiZHandle);
        events.push(`HiZPass:hiZ=${hiZ.id}`);
      });
    });

    graph.addPass('LightPass', (builder) => {
      builder.read(depthBuffer);
      builder.read(hiZHandle);
      backbuffer = builder.write(backbuffer);
      builder.setExecute(() => {
        events.push('LightPass');
      });
    });

    const compiled = graph.compile([backbuffer]);
    const executor = new RenderGraphExecutor(allocator, 1920, 1080);

    // Register imported resources
    const mockBackbuffer: MockTexture = { id: -1, desc: {} as any, size: { width: 1920, height: 1080 } };
    const mockDepth: MockTexture = { id: -2, desc: {} as any, size: { width: 1920, height: 1080 } };
    executor.setImportedTexture(backbuffer, mockBackbuffer);
    executor.setImportedTexture(depthBuffer, mockDepth);

    executor.execute(compiled);

    // Verify execution order
    expect(events).toEqual(['DepthPass', 'HiZPass:hiZ=0', 'LightPass']);

    // Verify HiZ was allocated and released
    expect(allocated).toHaveLength(1);
    expect(allocated[0].desc.format).toBe('r32f');
    expect(released).toHaveLength(1);

    executor.reset();
  });
});
