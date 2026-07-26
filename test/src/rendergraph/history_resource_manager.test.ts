import {
  HistoryResourceManager,
  RenderGraph,
  RenderGraphExecutor,
  type RGResolvedSize,
  type RGTextureAllocator,
  type RGTextureDesc
} from '../../../libs/scene/src/render/rendergraph';

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
    allocate(desc, size) {
      const texture = { id: nextId++, desc, size };
      allocated.push(texture);
      return texture;
    },
    release(texture) {
      released.push(texture);
    }
  };
  return { allocator, allocated, released };
}

function createTexture(id: number, desc: RGTextureDesc, size: RGResolvedSize): MockTexture {
  return { id, desc, size };
}

function createRefcountAllocator() {
  let nextId = 0;
  const refs = new Map<MockTexture, number>();
  const events: string[] = [];
  const allocator: RGTextureAllocator<MockTexture> = {
    allocate(desc, size) {
      const texture = { id: nextId++, desc, size };
      refs.set(texture, 1);
      events.push(`allocate:${texture.id}:1`);
      return texture;
    },
    retain(texture) {
      const nextRef = (refs.get(texture) ?? 0) + 1;
      refs.set(texture, nextRef);
      events.push(`retain:${texture.id}:${nextRef}`);
    },
    release(texture) {
      const nextRef = (refs.get(texture) ?? 0) - 1;
      refs.set(texture, nextRef);
      events.push(`release:${texture.id}:${nextRef}`);
    }
  };
  return { allocator, refs, events };
}

describe('HistoryResourceManager', () => {
  const desc: RGTextureDesc = {
    format: 'rgba8unorm',
    sizeMode: 'absolute',
    width: 64,
    height: 32
  };
  const size: RGResolvedSize = { width: 64, height: 32 };

  test('does not import history before a successful commit', () => {
    const { allocator } = createMockAllocator();
    const manager = new HistoryResourceManager(allocator);
    const graph = new RenderGraph();

    manager.beginFrame();

    expect(manager.importPrevious(graph, 'color')).toBeNull();
    expect(manager.importPreviousIfCompatible(graph, 'color', desc, size)).toBeNull();
  });

  test('discardFrame releases owned pending commits without making them visible', () => {
    const { allocator, released } = createMockAllocator();
    const manager = new HistoryResourceManager(allocator);
    const texture = createTexture(1, desc, size);

    manager.beginFrame();
    manager.queueCommit('color', desc, size, texture);
    manager.discardFrame();

    expect(released).toEqual([texture]);
    expect(manager.isCompatible('color', desc, size)).toBe(false);
    expect(manager.importPrevious(new RenderGraph(), 'color')).toBeNull();
  });

  test('commitFrame exposes history as a declared render graph import', () => {
    const { allocator } = createMockAllocator();
    const manager = new HistoryResourceManager(allocator);
    const historyTexture = createTexture(1, desc, size);

    manager.beginFrame();
    manager.queueCommit('color', desc, size, historyTexture);
    manager.commitFrame();

    manager.beginFrame();
    const graph = new RenderGraph();
    const historyHandle = manager.importPreviousIfCompatible(graph, 'color', desc, size);
    let backbuffer = graph.importTexture('backbuffer');
    let resolvedHistory: MockTexture | null = null;

    expect(historyHandle).not.toBeNull();

    graph.addPass('UseHistory', (builder) => {
      builder.read(historyHandle!);
      backbuffer = builder.write(backbuffer);
      builder.setExecute((ctx) => {
        resolvedHistory = ctx.getTexture<MockTexture>(historyHandle!);
      });
    });

    const executor = new RenderGraphExecutor(allocator, 64, 32);
    executor.setImportedTexture(backbuffer, createTexture(2, desc, size));
    manager.bindImportedTextures(executor);
    executor.execute(graph.compile([backbuffer]));

    expect(resolvedHistory).toBe(historyTexture);
  });

  test('importPreviousIfCompatible filters stale history after resize or format changes', () => {
    const { allocator } = createMockAllocator();
    const manager = new HistoryResourceManager(allocator);
    const texture = createTexture(1, desc, size);

    manager.beginFrame();
    manager.queueCommit('color', desc, size, texture);
    manager.commitFrame();

    manager.beginFrame();

    expect(
      manager.importPreviousIfCompatible(
        new RenderGraph(),
        'color',
        { ...desc, width: 128 },
        { width: 128, height: 32 }
      )
    ).toBeNull();
    expect(
      manager.importPreviousIfCompatible(new RenderGraph(), 'color', { ...desc, format: 'rgba16f' }, size)
    ).toBeNull();
  });

  test('read scopes make getPrevious return the render graph resolved texture', () => {
    const { allocator } = createMockAllocator();
    const manager = new HistoryResourceManager(allocator);
    const committed = createTexture(1, desc, size);
    const resolved = createTexture(2, desc, size);

    manager.beginFrame();
    manager.queueCommit('color', desc, size, committed);
    manager.commitFrame();

    manager.beginReadScope([{ name: 'color', texture: resolved }]);
    expect(manager.tryGetPrevious('color')).toBe(resolved);
    expect(manager.getPrevious('color')).toBe(resolved);
    manager.endReadScope();
    expect(manager.tryGetPrevious('color')).toBeNull();
    expect(() => manager.getPrevious('color')).toThrow(
      /not available in the current render graph read scope/
    );
  });

  test('frameActive is true only between beginFrame and commit or discard', () => {
    const { allocator } = createMockAllocator();
    const manager = new HistoryResourceManager(allocator);

    expect(manager.frameActive).toBe(false);
    manager.beginFrame();
    expect(manager.frameActive).toBe(true);
    manager.queueCommit('color', desc, size, createTexture(1, desc, size));
    manager.commitFrame();
    expect(manager.frameActive).toBe(false);

    manager.beginFrame();
    expect(manager.frameActive).toBe(true);
    manager.discardFrame();
    expect(manager.frameActive).toBe(false);
  });

  test('invalidate releases only the named history resource', () => {
    const { allocator, released } = createMockAllocator();
    const manager = new HistoryResourceManager(allocator);
    const color = createTexture(1, desc, size);
    const irradiance = createTexture(2, desc, size);

    manager.beginFrame();
    manager.queueCommit('color', desc, size, color);
    manager.queueCommit('irradiance', desc, size, irradiance);
    manager.commitFrame();

    manager.invalidate('irradiance');

    expect(released).toEqual([irradiance]);
    expect(manager.isCompatible('irradiance', desc, size)).toBe(false);
    expect(manager.isCompatible('color', desc, size)).toBe(true);
  });

  test('invalidate during a frame defers release so imported reads remain alive', () => {
    const { allocator, released } = createMockAllocator();
    const manager = new HistoryResourceManager(allocator);
    const texture = createTexture(1, desc, size);

    manager.beginFrame();
    manager.queueCommit('irradiance', desc, size, texture);
    manager.commitFrame();
    manager.beginFrame();
    expect(manager.importPrevious(new RenderGraph(), 'irradiance')).not.toBeNull();

    manager.invalidate('irradiance');
    expect(released).toEqual([]);
    manager.commitFrame();

    expect(released).toEqual([texture]);
    expect(manager.isCompatible('irradiance', desc, size)).toBe(false);
  });

  test('owned history textures are released when their slot is overwritten', () => {
    const { allocator, released } = createMockAllocator();
    const manager = new HistoryResourceManager(allocator);
    const first = createTexture(1, desc, size);
    const second = createTexture(2, desc, size);
    const third = createTexture(3, desc, size);

    manager.beginFrame();
    manager.queueCommit('color', desc, size, first);
    manager.commitFrame();

    manager.beginFrame();
    manager.queueCommit('color', desc, size, second);
    manager.commitFrame();

    manager.beginFrame();
    manager.queueCommit('color', desc, size, third);
    manager.commitFrame();

    expect(released).toEqual([first]);

    manager.beginFrame();
    const graph = new RenderGraph();
    const historyHandle = manager.importPreviousIfCompatible(graph, 'color', desc, size);
    let backbuffer = graph.importTexture('backbuffer');
    let resolvedHistory: MockTexture | null = null;

    graph.addPass('UseHistory', (builder) => {
      builder.read(historyHandle!);
      backbuffer = builder.write(backbuffer);
      builder.setExecute((ctx) => {
        resolvedHistory = ctx.getTexture<MockTexture>(historyHandle!);
      });
    });

    const executor = new RenderGraphExecutor(allocator, 64, 32);
    executor.setImportedTexture(backbuffer, createTexture(4, desc, size));
    manager.bindImportedTextures(executor);
    executor.execute(graph.compile([backbuffer]));

    expect(resolvedHistory).toBe(third);
  });

  test('queueCommitFromGraph retains graph-produced texture across executor release', () => {
    const { allocator, refs, events } = createRefcountAllocator();
    const manager = new HistoryResourceManager(allocator);
    const graph = new RenderGraph();
    let committedTexture: MockTexture | null = null;

    manager.beginFrame();

    graph.addPass('ProduceHistory', (builder) => {
      const current = builder.createTexture(desc);
      builder.sideEffect();
      builder.setExecute((ctx) => {
        committedTexture = manager.queueCommitFromGraph('color', desc, size, ctx, current);
        expect(refs.get(committedTexture)).toBe(2);
      });
    });

    const executor = new RenderGraphExecutor(allocator, 64, 32);
    executor.execute(graph.compile([]));

    expect(committedTexture).not.toBeNull();
    expect(refs.get(committedTexture!)).toBe(1);

    manager.commitFrame();
    expect(manager.importPrevious(new RenderGraph(), 'color')).not.toBeNull();

    manager.dispose();
    expect(refs.get(committedTexture!)).toBe(0);
    expect(events).toEqual(['allocate:0:1', 'retain:0:2', 'release:0:1', 'release:0:0']);
  });

  test('queueCommitFromGraph requires allocator retain support and still releases transient', () => {
    const { allocator, released } = createMockAllocator();
    const manager = new HistoryResourceManager(allocator);
    const graph = new RenderGraph();

    manager.beginFrame();

    graph.addPass('ProduceHistory', (builder) => {
      const current = builder.createTexture(desc);
      builder.sideEffect();
      builder.setExecute((ctx) => {
        manager.queueCommitFromGraph('color', desc, size, ctx, current);
      });
    });

    const executor = new RenderGraphExecutor(allocator, 64, 32);
    expect(() => executor.execute(graph.compile([]))).toThrow(/does not support retained graph texture/);
    expect(released).toHaveLength(1);
    expect(manager.importPrevious(new RenderGraph(), 'color')).toBeNull();
  });

  test('overwriting a slot releases its reference even when both slots hold the same texture', () => {
    const { allocator, refs } = createRefcountAllocator();
    const manager = new HistoryResourceManager(allocator);
    const shared = allocator.allocate(desc, size); // refcount 1 (external owner)

    // Commit the same texture two frames running: both slots hold it, each
    // holding its own retained reference (refcount 3).
    manager.beginFrame();
    manager.queueRetainedCommit('color', desc, size, shared);
    manager.commitFrame();
    manager.beginFrame();
    manager.queueRetainedCommit('color', desc, size, shared);
    manager.commitFrame();
    expect(refs.get(shared)).toBe(3);

    // Two more commits with fresh textures evict both slots; each eviction
    // must release one retained reference of the shared texture.
    manager.beginFrame();
    manager.queueRetainedCommit('color', desc, size, allocator.allocate(desc, size));
    manager.commitFrame();
    manager.beginFrame();
    manager.queueRetainedCommit('color', desc, size, allocator.allocate(desc, size));
    manager.commitFrame();

    // Only the external owner's initial reference remains.
    expect(refs.get(shared)).toBe(1);
  });

  test('isCompatible distinguishes arrayLayers, including undefined vs 1', () => {
    const { allocator } = createMockAllocator();
    const manager = new HistoryResourceManager(allocator);
    const arrayDesc: RGTextureDesc = { ...desc, arrayLayers: 1 };

    manager.beginFrame();
    manager.queueCommit('mask', arrayDesc, size, createTexture(1, arrayDesc, size));
    manager.commitFrame();

    expect(manager.isCompatible('mask', arrayDesc, size)).toBe(true);
    // undefined (plain 2D) and 1 (single-layer array) are distinct texture types.
    expect(manager.isCompatible('mask', desc, size)).toBe(false);
    expect(manager.isCompatible('mask', { ...desc, arrayLayers: 4 }, size)).toBe(false);
  });

  test('queueCommit outside an active frame throws', () => {
    const { allocator } = createMockAllocator();
    const manager = new HistoryResourceManager(allocator);

    expect(() => manager.queueCommit('color', desc, size, createTexture(1, desc, size))).toThrow(
      /outside an active frame/
    );
  });
});
