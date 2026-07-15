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

describe('Transient write-version aliasing', () => {
  test('write-versions of a transient resolve to the same physical texture', () => {
    const { allocator, allocated, released } = createMockAllocator();
    const graph = new RenderGraph();

    let texHandle: any;
    const seen: number[] = [];

    graph.addPass('Produce', (builder) => {
      texHandle = builder.createTexture({ format: 'rgba8unorm', label: 'accum' });
      builder.setExecute((rgCtx) => {
        seen.push(rgCtx.getTexture<MockTexture>(texHandle).id);
      });
    });

    let version1: any;
    graph.addPass('AccumulateA', (builder) => {
      builder.read(texHandle);
      version1 = builder.write(texHandle);
      builder.setExecute((rgCtx) => {
        seen.push(rgCtx.getTexture<MockTexture>(version1).id);
      });
    });

    let version2: any;
    graph.addPass('AccumulateB', (builder) => {
      builder.read(version1);
      version2 = builder.write(version1);
      builder.setExecute((rgCtx) => {
        seen.push(rgCtx.getTexture<MockTexture>(version2).id);
      });
    });

    let backbuffer = graph.importTexture('backbuffer');
    graph.addPass('Consume', (builder) => {
      builder.read(version2);
      backbuffer = builder.write(backbuffer);
      builder.setExecute((rgCtx) => {
        seen.push(rgCtx.getTexture<MockTexture>(version2).id);
      });
    });

    const compiled = graph.compile([backbuffer]);
    const executor = new RenderGraphExecutor(allocator, 256, 256);
    executor.setImportedTexture(backbuffer, { id: -1, desc: {} as any, size: { width: 256, height: 256 } });
    executor.execute(compiled);

    // One allocation shared by every version, all passes see the same texture
    expect(allocated.length).toBe(1);
    expect(seen).toEqual([allocated[0].id, allocated[0].id, allocated[0].id, allocated[0].id]);
    // Released exactly once, after the last consumer
    expect(released.length).toBe(1);
    expect(released[0]).toBe(allocated[0]);
  });

  test('release is deferred until the last use of any version', () => {
    const { allocator, allocated, released } = createMockAllocator();
    const graph = new RenderGraph();

    let texHandle: any;
    let version1: any;
    const releasedAt: string[] = [];

    graph.addPass('Produce', (builder) => {
      texHandle = builder.createTexture({ format: 'rgba8unorm', label: 'accum' });
      builder.setExecute(() => {
        releasedAt.push(`Produce:${released.length}`);
      });
    });

    graph.addPass('Write', (builder) => {
      builder.read(texHandle);
      version1 = builder.write(texHandle);
      builder.setExecute(() => {
        releasedAt.push(`Write:${released.length}`);
      });
    });

    let backbuffer = graph.importTexture('backbuffer');
    graph.addPass('Consume', (builder) => {
      builder.read(version1);
      backbuffer = builder.write(backbuffer);
      builder.setExecute(() => {
        releasedAt.push(`Consume:${released.length}`);
      });
    });

    const compiled = graph.compile([backbuffer]);
    const executor = new RenderGraphExecutor(allocator, 256, 256);
    executor.setImportedTexture(backbuffer, { id: -1, desc: {} as any, size: { width: 256, height: 256 } });
    executor.execute(compiled);

    expect(allocated.length).toBe(1);
    // Nothing released while any version still has pending uses
    expect(releasedAt).toEqual(['Produce:0', 'Write:0', 'Consume:0']);
    expect(released.length).toBe(1);
  });
});
