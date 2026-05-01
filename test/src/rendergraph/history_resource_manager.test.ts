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
      manager.importPreviousIfCompatible(
        new RenderGraph(),
        'color',
        { ...desc, format: 'rgba16f' },
        size
      )
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
    expect(manager.getPrevious('color')).toBe(resolved);
    manager.endReadScope();
    expect(() => manager.getPrevious('color')).toThrow(/not available in the current render graph read scope/);
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
});
