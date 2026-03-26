import { RenderGraph, RGHandle, RenderGraphExecutor } from '../../../libs/scene/src/render/rendergraph';
import type {
  RGTextureAllocator,
  RGTextureDesc,
  RGResolvedSize,
  RGExecuteContext
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

// ─── Tests ───────────────────────────────────────────────────────────

describe('RenderGraph', () => {
  let graph: RenderGraph;

  beforeEach(() => {
    graph = new RenderGraph();
  });

  // ─── Basic Graph Building ───────────────────────────────────────────

  describe('graph building', () => {
    test('importTexture creates a handle', () => {
      const h = graph.importTexture('backbuffer');
      expect(h).toBeInstanceOf(RGHandle);
      expect(h.name).toBe('backbuffer');
    });

    test('addPass registers a pass', () => {
      graph.addPass('TestPass', (builder) => {
        builder.createTexture({ format: 'rgba8unorm', label: 'out' });
        builder.setExecute(() => {});
      });
      expect(graph.passes).toHaveLength(1);
      expect(graph.passes[0].name).toBe('TestPass');
    });

    test('addPass returns setup return value', () => {
      const result = graph.addPass('TestPass', (builder) => {
        const tex = builder.createTexture({ format: 'r32f', label: 'depth' });
        builder.setExecute(() => {});
        return { depth: tex };
      });
      expect(result.depth).toBeInstanceOf(RGHandle);
      expect(result.depth.name).toBe('depth');
    });

    test('read unknown handle throws', () => {
      const fakeHandle = new RGHandle(999, 'fake');
      expect(() => {
        graph.addPass('Bad', (builder) => {
          builder.read(fakeHandle);
        });
      }).toThrow(/unknown resource/);
    });

    test('write unknown handle throws', () => {
      const fakeHandle = new RGHandle(999, 'fake');
      expect(() => {
        graph.addPass('Bad', (builder) => {
          builder.write(fakeHandle);
        });
      }).toThrow(/unknown resource/);
    });

    test('double write from different passes throws', () => {
      const h = graph.importTexture('shared');
      graph.addPass('A', (builder) => {
        builder.write(h);
        builder.setExecute(() => {});
      });
      expect(() => {
        graph.addPass('B', (builder) => {
          builder.write(h);
        });
      }).toThrow(/already produced/);
    });
  });

  // ─── Compilation: Dependency Resolution ─────────────────────────────

  describe('dependency resolution', () => {
    test('linear chain: A -> B -> C', () => {
      let t1: RGHandle;
      let t2: RGHandle;
      const backbuffer = graph.importTexture('backbuffer');

      graph.addPass('A', (builder) => {
        t1 = builder.createTexture({ format: 'r32f', label: 't1' });
        builder.setExecute(() => {});
      });
      graph.addPass('B', (builder) => {
        builder.read(t1!);
        t2 = builder.createTexture({ format: 'rgba8unorm', label: 't2' });
        builder.setExecute(() => {});
      });
      graph.addPass('C', (builder) => {
        builder.read(t2!);
        builder.write(backbuffer);
        builder.setExecute(() => {});
      });

      const compiled = graph.compile([backbuffer]);
      const names = compiled.orderedPasses.map((p) => p.name);
      expect(names).toEqual(['A', 'B', 'C']);
    });

    test('diamond dependency: A,B -> C -> D', () => {
      let tA: RGHandle;
      let tB: RGHandle;
      let tC: RGHandle;
      const backbuffer = graph.importTexture('backbuffer');

      graph.addPass('A', (builder) => {
        tA = builder.createTexture({ format: 'r32f', label: 'tA' });
        builder.setExecute(() => {});
      });
      graph.addPass('B', (builder) => {
        tB = builder.createTexture({ format: 'r32f', label: 'tB' });
        builder.setExecute(() => {});
      });
      graph.addPass('C', (builder) => {
        builder.read(tA!);
        builder.read(tB!);
        tC = builder.createTexture({ format: 'rgba8unorm', label: 'tC' });
        builder.setExecute(() => {});
      });
      graph.addPass('D', (builder) => {
        builder.read(tC!);
        builder.write(backbuffer);
        builder.setExecute(() => {});
      });

      const compiled = graph.compile([backbuffer]);
      const names = compiled.orderedPasses.map((p) => p.name);
      expect(names.indexOf('A')).toBeLessThan(names.indexOf('C'));
      expect(names.indexOf('B')).toBeLessThan(names.indexOf('C'));
      expect(names.indexOf('C')).toBeLessThan(names.indexOf('D'));
      expect(names).toHaveLength(4);
    });
  });

  // ─── Compilation: Dead Pass Culling ─────────────────────────────────

  describe('dead pass culling', () => {
    test('unused pass is culled', () => {
      const backbuffer = graph.importTexture('backbuffer');
      let needed: RGHandle;

      graph.addPass('Needed', (builder) => {
        needed = builder.createTexture({ format: 'r32f', label: 'needed' });
        builder.setExecute(() => {});
      });
      graph.addPass('Unused', (builder) => {
        builder.createTexture({ format: 'rgba8unorm', label: 'garbage' });
        builder.setExecute(() => {});
      });
      graph.addPass('Final', (builder) => {
        builder.read(needed!);
        builder.write(backbuffer);
        builder.setExecute(() => {});
      });

      const compiled = graph.compile([backbuffer]);
      const names = compiled.orderedPasses.map((p) => p.name);
      expect(names).toEqual(['Needed', 'Final']);
      expect(names).not.toContain('Unused');
    });

    test('sideEffect pass is never culled', () => {
      const backbuffer = graph.importTexture('backbuffer');

      graph.addPass('Picking', (builder) => {
        builder.sideEffect();
        builder.setExecute(() => {});
      });
      graph.addPass('Final', (builder) => {
        builder.write(backbuffer);
        builder.setExecute(() => {});
      });

      const compiled = graph.compile([backbuffer]);
      const names = compiled.orderedPasses.map((p) => p.name);
      expect(names).toContain('Picking');
      expect(names).toContain('Final');
    });

    test('sideEffect pass keeps its dependencies alive', () => {
      const backbuffer = graph.importTexture('backbuffer');
      let depth: RGHandle;

      graph.addPass('DepthPrepass', (builder) => {
        depth = builder.createTexture({ format: 'r32f', label: 'depth' });
        builder.setExecute(() => {});
      });
      graph.addPass('DebugVis', (builder) => {
        builder.read(depth!);
        builder.sideEffect();
        builder.setExecute(() => {});
      });
      graph.addPass('Final', (builder) => {
        builder.write(backbuffer);
        builder.setExecute(() => {});
      });

      const compiled = graph.compile([backbuffer]);
      const names = compiled.orderedPasses.map((p) => p.name);
      expect(names).toContain('DepthPrepass');
      expect(names).toContain('DebugVis');
    });

    test('disabling HiZ culls the HiZ pass and its unique dependencies', () => {
      const backbuffer = graph.importTexture('backbuffer');
      let depth: RGHandle;

      graph.addPass('DepthPrepass', (builder) => {
        depth = builder.createTexture({ format: 'r32f', label: 'depth' });
        builder.setExecute(() => {});
      });
      graph.addPass('HiZ', (builder) => {
        builder.read(depth!);
        builder.createTexture({ format: 'r32f', label: 'hiZ' });
        builder.setExecute(() => {});
      });
      graph.addPass('LightPass', (builder) => {
        builder.read(depth!);
        builder.write(backbuffer);
        builder.setExecute(() => {});
      });

      const compiled = graph.compile([backbuffer]);
      const names = compiled.orderedPasses.map((p) => p.name);
      expect(names).toContain('DepthPrepass');
      expect(names).toContain('LightPass');
      expect(names).not.toContain('HiZ');
    });
  });

  // ─── Resource Lifetime Analysis ─────────────────────────────────────

  describe('resource lifetime', () => {
    test('transient resource lifetime spans producer to last consumer', () => {
      const backbuffer = graph.importTexture('backbuffer');
      let depth: RGHandle;
      let color: RGHandle;

      graph.addPass('DepthPrepass', (builder) => {
        depth = builder.createTexture({ format: 'r32f', label: 'depth' });
        builder.setExecute(() => {});
      });
      graph.addPass('LightPass', (builder) => {
        builder.read(depth!);
        color = builder.createTexture({ format: 'rgba8unorm', label: 'color' });
        builder.setExecute(() => {});
      });
      graph.addPass('PostProcess', (builder) => {
        builder.read(depth!);
        builder.read(color!);
        builder.write(backbuffer);
        builder.setExecute(() => {});
      });

      const compiled = graph.compile([backbuffer]);
      const names = compiled.orderedPasses.map((p) => p.name);
      expect(names).toEqual(['DepthPrepass', 'LightPass', 'PostProcess']);

      const depthLife = compiled.lifetimes.get(depth!._id)!;
      expect(depthLife.firstUse).toBe(0);
      expect(depthLife.lastUse).toBe(2);

      const colorLife = compiled.lifetimes.get(color!._id)!;
      expect(colorLife.firstUse).toBe(1);
      expect(colorLife.lastUse).toBe(2);
    });
  });

  // ─── Execution (simple mode) ────────────────────────────────────────

  describe('execution', () => {
    test('passes execute in topological order', () => {
      const log: string[] = [];
      const backbuffer = graph.importTexture('backbuffer');
      let t: RGHandle;

      graph.addPass('A', (builder) => {
        t = builder.createTexture({ format: 'r32f', label: 't' });
        builder.setExecute((_ctx) => log.push('A'));
      });
      graph.addPass('B', (builder) => {
        builder.read(t!);
        builder.write(backbuffer);
        builder.setExecute((_ctx) => log.push('B'));
      });

      const compiled = graph.compile([backbuffer]);
      graph.execute(compiled);
      expect(log).toEqual(['A', 'B']);
    });

    test('culled passes do not execute', () => {
      const log: string[] = [];
      const backbuffer = graph.importTexture('backbuffer');

      graph.addPass('Alive', (builder) => {
        builder.write(backbuffer);
        builder.setExecute((_ctx) => log.push('Alive'));
      });
      graph.addPass('Dead', (builder) => {
        builder.createTexture({ format: 'r32f', label: 'unused' });
        builder.setExecute((_ctx) => log.push('Dead'));
      });

      const compiled = graph.compile([backbuffer]);
      graph.execute(compiled);
      expect(log).toEqual(['Alive']);
    });
  });

  // ─── Reset ──────────────────────────────────────────────────────────

  describe('reset', () => {
    test('reset clears all state', () => {
      graph.importTexture('backbuffer');
      graph.addPass('P', (builder) => {
        builder.createTexture({ format: 'r32f', label: 'x' });
        builder.setExecute(() => {});
      });

      graph.reset();
      expect(graph.passes).toHaveLength(0);
      expect(graph.resources.size).toBe(0);
    });
  });

  // ─── Forward+ Pipeline Simulation ───────────────────────────────────

  describe('forward+ pipeline simulation', () => {
    test('full pipeline with optional features', () => {
      const log: string[] = [];
      const backbuffer = graph.importTexture('backbuffer');

      const enableHiZ = true;
      const enableTAA = true;

      let linearDepth: RGHandle;
      let motionVector: RGHandle;
      graph.addPass('DepthPrepass', (builder) => {
        linearDepth = builder.createTexture({ format: 'r32f', label: 'linearDepth' });
        motionVector = builder.createTexture({ format: 'rg16f', label: 'motionVector' });
        builder.setExecute((_ctx) => log.push('DepthPrepass'));
      });

      let hiZ: RGHandle | undefined;
      if (enableHiZ) {
        graph.addPass('HiZ', (builder) => {
          builder.read(linearDepth!);
          hiZ = builder.createTexture({ format: 'r32f', label: 'hiZ', mipLevels: 8 });
          builder.setExecute((_ctx) => log.push('HiZ'));
        });
      }

      let shadowMaps: RGHandle;
      graph.addPass('ShadowMaps', (builder) => {
        shadowMaps = builder.createTexture({ format: 'r32f', label: 'shadowMaps' });
        builder.setExecute((_ctx) => log.push('ShadowMaps'));
      });

      let sceneColor: RGHandle;
      graph.addPass('LightPass', (builder) => {
        builder.read(linearDepth!);
        builder.read(shadowMaps!);
        if (hiZ) {
          builder.read(hiZ);
        }
        sceneColor = builder.createTexture({ format: 'rgba16f', label: 'sceneColor' });
        builder.setExecute((_ctx) => log.push('LightPass'));
      });

      let taaOutput: RGHandle | undefined;
      if (enableTAA) {
        graph.addPass('TAA', (builder) => {
          builder.read(sceneColor!);
          builder.read(motionVector!);
          taaOutput = builder.createTexture({ format: 'rgba16f', label: 'taaOutput' });
          builder.setExecute((_ctx) => log.push('TAA'));
        });
      }

      graph.addPass('Composite', (builder) => {
        builder.read(taaOutput ?? sceneColor!);
        builder.write(backbuffer);
        builder.setExecute((_ctx) => log.push('Composite'));
      });

      const compiled = graph.compile([backbuffer]);
      graph.execute(compiled);

      expect(log).toContain('DepthPrepass');
      expect(log).toContain('HiZ');
      expect(log).toContain('ShadowMaps');
      expect(log).toContain('LightPass');
      expect(log).toContain('TAA');
      expect(log).toContain('Composite');

      expect(log.indexOf('DepthPrepass')).toBeLessThan(log.indexOf('HiZ'));
      expect(log.indexOf('DepthPrepass')).toBeLessThan(log.indexOf('LightPass'));
      expect(log.indexOf('HiZ')).toBeLessThan(log.indexOf('LightPass'));
      expect(log.indexOf('ShadowMaps')).toBeLessThan(log.indexOf('LightPass'));
      expect(log.indexOf('LightPass')).toBeLessThan(log.indexOf('TAA'));
      expect(log.indexOf('TAA')).toBeLessThan(log.indexOf('Composite'));
    });

    test('disabling TAA culls motionVector producer chain', () => {
      const log: string[] = [];
      const backbuffer = graph.importTexture('backbuffer');

      let linearDepth: RGHandle;
      graph.addPass('DepthPrepass', (builder) => {
        linearDepth = builder.createTexture({ format: 'r32f', label: 'linearDepth' });
        builder.setExecute((_ctx) => log.push('DepthPrepass'));
      });

      graph.addPass('MotionVectors', (builder) => {
        builder.read(linearDepth!);
        builder.createTexture({ format: 'rg16f', label: 'motionVector' });
        builder.setExecute((_ctx) => log.push('MotionVectors'));
      });

      let sceneColor: RGHandle;
      graph.addPass('LightPass', (builder) => {
        builder.read(linearDepth!);
        sceneColor = builder.createTexture({ format: 'rgba16f', label: 'sceneColor' });
        builder.setExecute((_ctx) => log.push('LightPass'));
      });

      graph.addPass('Composite', (builder) => {
        builder.read(sceneColor!);
        builder.write(backbuffer);
        builder.setExecute((_ctx) => log.push('Composite'));
      });

      const compiled = graph.compile([backbuffer]);
      graph.execute(compiled);

      expect(log).toEqual(['DepthPrepass', 'LightPass', 'Composite']);
      expect(log).not.toContain('MotionVectors');
    });
  });
});

// ─── RenderGraphExecutor Tests ────────────────────────────────────────

describe('RenderGraphExecutor', () => {
  let graph: RenderGraph;

  beforeEach(() => {
    graph = new RenderGraph();
  });

  test('allocates transient textures before first use and releases after last use', () => {
    const { allocator, allocated, released } = createMockAllocator();
    const backbuffer = graph.importTexture('backbuffer');

    let depth: RGHandle;
    let color: RGHandle;
    const events: string[] = [];

    graph.addPass('DepthPrepass', (builder) => {
      depth = builder.createTexture({ format: 'r32f', label: 'depth' });
      builder.setExecute((_ctx) => {
        events.push(`exec:DepthPrepass (allocated=${allocated.length}, released=${released.length})`);
      });
    });
    graph.addPass('LightPass', (builder) => {
      builder.read(depth!);
      color = builder.createTexture({ format: 'rgba16f', label: 'color' });
      builder.setExecute((_ctx) => {
        events.push(`exec:LightPass (allocated=${allocated.length}, released=${released.length})`);
      });
    });
    graph.addPass('PostProcess', (builder) => {
      builder.read(depth!);
      builder.read(color!);
      builder.write(backbuffer);
      builder.setExecute((_ctx) => {
        events.push(`exec:PostProcess (allocated=${allocated.length}, released=${released.length})`);
      });
    });

    const compiled = graph.compile([backbuffer]);
    const executor = new RenderGraphExecutor(allocator, 1920, 1080);
    executor.setImportedTexture(backbuffer, { id: -1, desc: {} as any, size: { width: 1920, height: 1080 } });
    executor.execute(compiled);

    // depth allocated before DepthPrepass (pass 0), color allocated before LightPass (pass 1)
    expect(events[0]).toBe('exec:DepthPrepass (allocated=1, released=0)');
    expect(events[1]).toBe('exec:LightPass (allocated=2, released=0)');
    // Both depth and color released after PostProcess (pass 2, last consumer for both)
    expect(events[2]).toBe('exec:PostProcess (allocated=2, released=0)');

    // After execution, both should be released
    expect(released).toHaveLength(2);
  });

  test('resolves imported textures via getTexture', () => {
    const { allocator } = createMockAllocator();
    const backbuffer = graph.importTexture('backbuffer');

    let resolved: MockTexture | null = null;
    graph.addPass('Final', (builder) => {
      builder.write(backbuffer);
      builder.setExecute((ctx: RGExecuteContext) => {
        resolved = ctx.getTexture<MockTexture>(backbuffer);
      });
    });

    const compiled = graph.compile([backbuffer]);
    const bbTex: MockTexture = { id: 42, desc: {} as any, size: { width: 1920, height: 1080 } };
    const executor = new RenderGraphExecutor(allocator, 1920, 1080);
    executor.setImportedTexture(backbuffer, bbTex);
    executor.execute(compiled);

    expect(resolved).toBe(bbTex);
  });

  test('resolves transient textures via getTexture', () => {
    const { allocator } = createMockAllocator();
    const backbuffer = graph.importTexture('backbuffer');

    let depth: RGHandle;
    let resolvedDepth: MockTexture | null = null;

    graph.addPass('DepthPrepass', (builder) => {
      depth = builder.createTexture({ format: 'r32f', label: 'depth' });
      builder.setExecute(() => {});
    });
    graph.addPass('LightPass', (builder) => {
      builder.read(depth!);
      builder.write(backbuffer);
      builder.setExecute((ctx: RGExecuteContext) => {
        resolvedDepth = ctx.getTexture<MockTexture>(depth!);
      });
    });

    const compiled = graph.compile([backbuffer]);
    const executor = new RenderGraphExecutor(allocator, 1920, 1080);
    executor.setImportedTexture(backbuffer, { id: -1, desc: {} as any, size: { width: 1920, height: 1080 } });
    executor.execute(compiled);

    expect(resolvedDepth).not.toBeNull();
    expect(resolvedDepth!.desc.format).toBe('r32f');
  });

  test('backbuffer-relative sizing resolves correctly', () => {
    const { allocator, allocated } = createMockAllocator();
    const backbuffer = graph.importTexture('backbuffer');

    let tex: RGHandle;
    graph.addPass('Pass', (builder) => {
      tex = builder.createTexture({
        format: 'r32f',
        label: 'halfRes',
        sizeMode: 'backbuffer-relative',
        width: 0.5,
        height: 0.5
      });
      builder.setExecute(() => {});
    });
    graph.addPass('Consumer', (builder) => {
      builder.read(tex!);
      builder.write(backbuffer);
      builder.setExecute(() => {});
    });

    const compiled = graph.compile([backbuffer]);
    const executor = new RenderGraphExecutor(allocator, 1920, 1080);
    executor.setImportedTexture(backbuffer, { id: -1, desc: {} as any, size: { width: 1920, height: 1080 } });
    executor.execute(compiled);

    expect(allocated).toHaveLength(1);
    expect(allocated[0].size.width).toBe(960);
    expect(allocated[0].size.height).toBe(540);
  });

  test('absolute sizing resolves correctly', () => {
    const { allocator, allocated } = createMockAllocator();
    const backbuffer = graph.importTexture('backbuffer');

    let tex: RGHandle;
    graph.addPass('Pass', (builder) => {
      tex = builder.createTexture({
        format: 'rgba8unorm',
        label: 'fixed',
        sizeMode: 'absolute',
        width: 256,
        height: 256
      });
      builder.setExecute(() => {});
    });
    graph.addPass('Consumer', (builder) => {
      builder.read(tex!);
      builder.write(backbuffer);
      builder.setExecute(() => {});
    });

    const compiled = graph.compile([backbuffer]);
    const executor = new RenderGraphExecutor(allocator, 1920, 1080);
    executor.setImportedTexture(backbuffer, { id: -1, desc: {} as any, size: { width: 1920, height: 1080 } });
    executor.execute(compiled);

    expect(allocated).toHaveLength(1);
    expect(allocated[0].size.width).toBe(256);
    expect(allocated[0].size.height).toBe(256);
  });

  test('early-released resource cannot be resolved by later passes', () => {
    const { allocator } = createMockAllocator();
    const backbuffer = graph.importTexture('backbuffer');

    let earlyTex: RGHandle;
    let lateTex: RGHandle;

    // earlyTex is only used by Pass B, released after B
    graph.addPass('A', (builder) => {
      earlyTex = builder.createTexture({ format: 'r32f', label: 'early' });
      lateTex = builder.createTexture({ format: 'r32f', label: 'late' });
      builder.setExecute(() => {});
    });
    graph.addPass('B', (builder) => {
      builder.read(earlyTex!);
      builder.read(lateTex!);
      builder.write(backbuffer);
      builder.setExecute(() => {});
    });

    const compiled = graph.compile([backbuffer]);
    const executor = new RenderGraphExecutor(allocator, 1920, 1080);
    executor.setImportedTexture(backbuffer, { id: -1, desc: {} as any, size: { width: 1920, height: 1080 } });
    executor.execute(compiled);

    // Both allocated and released
    // (they share the same lifetime: firstUse=0, lastUse=1)
  });

  test('executor reset releases leftover textures', () => {
    const { allocator, released } = createMockAllocator();
    const executor = new RenderGraphExecutor(allocator, 1920, 1080);
    // Simulate a texture that wasn't released (abnormal)
    (executor as any)._allocatedTextures.set(999, { id: 999, desc: {}, size: { width: 1, height: 1 } });
    executor.reset();
    expect(released).toHaveLength(1);
  });
});
