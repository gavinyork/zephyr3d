import {
  RenderGraph,
  RGHandle,
  RenderGraphExecutor,
  RGTextureAffinityCache
} from '../../../libs/scene/src/render/rendergraph';
import type {
  RGTextureAllocator,
  RGTextureDesc,
  RGResolvedSize,
  RGExecuteContext,
  RGFramebufferDesc
} from '../../../libs/scene/src/render/rendergraph';
import type { AbstractDevice, TimestampQueryOptions, TimestampQueryResult } from '@zephyr3d/device';
import { Pool } from '../../../libs/device/src/pool';

// ─── Mock Allocator ──────────────────────────────────────────────────

interface MockTexture {
  id: number;
  desc: RGTextureDesc;
  size: RGResolvedSize;
}

interface MockFramebuffer {
  id: number;
  desc: RGFramebufferDesc;
}

function createMockAllocator() {
  let nextId = 0;
  let nextFramebufferId = 0;
  const allocated: MockTexture[] = [];
  const released: MockTexture[] = [];
  const allocatedFramebuffers: MockFramebuffer[] = [];
  const releasedFramebuffers: MockFramebuffer[] = [];
  const allocator: RGTextureAllocator<MockTexture, MockFramebuffer> = {
    allocate(desc: RGTextureDesc, size: RGResolvedSize): MockTexture {
      const tex = { id: nextId++, desc, size };
      allocated.push(tex);
      return tex;
    },
    release(texture: MockTexture): void {
      released.push(texture);
    },
    allocateFramebuffer(desc: RGFramebufferDesc): MockFramebuffer {
      const fb = { id: nextFramebufferId++, desc };
      allocatedFramebuffers.push(fb);
      return fb;
    },
    releaseFramebuffer(framebuffer: MockFramebuffer): void {
      releasedFramebuffers.push(framebuffer);
    }
  };
  return { allocator, allocated, released, allocatedFramebuffers, releasedFramebuffers };
}

function createMockTimestampDevice(supportTimestampQuery = true) {
  let nextQueryId = 0;
  const labels = new Map<number, string>();
  const begun: number[] = [];
  const ended: number[] = [];
  const device = {
    frameInfo: {
      frameCounter: 42
    },
    getDeviceCaps() {
      return {
        miscCaps: {
          supportTimestampQuery
        }
      };
    },
    beginTimestampQuery(label?: string, _options?: TimestampQueryOptions): number {
      if (!supportTimestampQuery) {
        return 0;
      }
      const id = ++nextQueryId;
      labels.set(id, label ?? '');
      begun.push(id);
      return id;
    },
    endTimestampQuery(id: number): void {
      ended.push(id);
    },
    resolveTimestampQuery(id: number): Promise<TimestampQueryResult> {
      return Promise.resolve({
        id,
        label: labels.get(id) ?? '',
        frameId: 42,
        durationMs: id,
        start: BigInt(id * 1000),
        end: BigInt(id * 1000 + id * 1000000),
        status: 'resolved'
      } as TimestampQueryResult);
    }
  } as unknown as AbstractDevice;
  return { device, begun, ended, labels };
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

    test('compile unknown output throws', () => {
      const fakeHandle = new RGHandle(999, 'fake');
      expect(() => {
        graph.compile([fakeHandle]);
      }).toThrow(/unknown output resource/);
    });

    test('compile stale output version throws', () => {
      const original = graph.importTexture('backbuffer');
      let latest: RGHandle;

      graph.addPass('Final', (builder) => {
        latest = builder.write(original);
        builder.setExecute(() => {});
      });

      expect(() => {
        graph.compile([original]);
      }).toThrow(/not the latest version/);
      expect(graph.compile([latest!]).orderedPasses.map((p) => p.name)).toEqual(['Final']);
    });

    test('setExecute and addSubpass are mutually exclusive', () => {
      expect(() => {
        graph.addPass('BadPass', (builder) => {
          builder.addSubpass('A', () => {});
          builder.setExecute(() => {});
        });
      }).toThrow(/cannot use setExecute\(\) after addSubpass\(\)/);

      graph = new RenderGraph();
      expect(() => {
        graph.addPass('BadPass', (builder) => {
          builder.setExecute(() => {});
          builder.addSubpass('A', () => {});
        });
      }).toThrow(/cannot use addSubpass\(\) after setExecute\(\)/);
    });

    test('framebuffer attachment must be a texture handle', () => {
      expect(() => {
        graph.addPass('BadFramebuffer', (builder) => {
          const token = builder.createToken('done');
          builder.createFramebuffer({
            colorAttachments: token,
            depthAttachment: null
          });
        });
      }).toThrow(/must be a texture resource/);
    });

    test('double write from different passes creates ordered versions', () => {
      const h = graph.importTexture('shared');
      let h1: RGHandle;
      let h2: RGHandle;
      graph.addPass('A', (builder) => {
        h1 = builder.write(h);
        builder.setExecute(() => {});
      });
      graph.addPass('B', (builder) => {
        h2 = builder.write(h1);
        builder.setExecute(() => {});
      });
      const compiled = graph.compile([h2!]);
      expect(compiled.orderedPasses.map((p) => p.name)).toEqual(['A', 'B']);
    });
  });

  // ─── Compilation: Dependency Resolution ─────────────────────────────

  describe('dependency resolution', () => {
    test('framebuffer attachments infer texture dependencies', () => {
      let color: RGHandle;
      let backbuffer = graph.importTexture('backbuffer');

      graph.addPass('ProduceColor', (builder) => {
        color = builder.createTexture({ format: 'rgba8unorm', label: 'color' });
        builder.setExecute(() => {});
      });
      graph.addPass('UseFramebuffer', (builder) => {
        builder.createFramebuffer({
          colorAttachments: color!,
          depthAttachment: null
        });
        backbuffer = builder.write(backbuffer);
        builder.setExecute(() => {});
      });

      const compiled = graph.compile([backbuffer]);
      expect(compiled.orderedPasses.map((p) => p.name)).toEqual(['ProduceColor', 'UseFramebuffer']);
      expect(compiled.lifetimes.get(color!._id)!.lastUse).toBe(1);
    });

    test('linear chain: A -> B -> C', () => {
      let t1: RGHandle;
      let t2: RGHandle;
      let backbuffer = graph.importTexture('backbuffer');

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
        backbuffer = builder.write(backbuffer);
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
      let backbuffer = graph.importTexture('backbuffer');

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
        backbuffer = builder.write(backbuffer);
        builder.setExecute(() => {});
      });

      const compiled = graph.compile([backbuffer]);
      const names = compiled.orderedPasses.map((p) => p.name);
      expect(names.indexOf('A')).toBeLessThan(names.indexOf('C'));
      expect(names.indexOf('B')).toBeLessThan(names.indexOf('C'));
      expect(names.indexOf('C')).toBeLessThan(names.indexOf('D'));
      expect(names).toHaveLength(4);
    });

    test('compile honors different output handles on the same graph', () => {
      let first: RGHandle;
      let second: RGHandle;

      graph.addPass('FirstOutput', (builder) => {
        first = builder.createTexture({ format: 'r32f', label: 'first' });
        builder.setExecute(() => {});
      });
      graph.addPass('SecondOutput', (builder) => {
        second = builder.createTexture({ format: 'r32f', label: 'second' });
        builder.setExecute(() => {});
      });

      expect(graph.compile([first!]).orderedPasses.map((p) => p.name)).toEqual(['FirstOutput']);
      expect(graph.compile([second!]).orderedPasses.map((p) => p.name)).toEqual(['SecondOutput']);
    });
  });

  // ─── Compilation: Dead Pass Culling ─────────────────────────────────

  describe('dead pass culling', () => {
    test('unused pass is culled', () => {
      let backbuffer = graph.importTexture('backbuffer');
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
        backbuffer = builder.write(backbuffer);
        builder.setExecute(() => {});
      });

      const compiled = graph.compile([backbuffer]);
      const names = compiled.orderedPasses.map((p) => p.name);
      expect(names).toEqual(['Needed', 'Final']);
      expect(names).not.toContain('Unused');
    });

    test('sideEffect pass is never culled', () => {
      let backbuffer = graph.importTexture('backbuffer');

      graph.addPass('Picking', (builder) => {
        builder.sideEffect();
        builder.setExecute(() => {});
      });
      graph.addPass('Final', (builder) => {
        backbuffer = builder.write(backbuffer);
        builder.setExecute(() => {});
      });

      const compiled = graph.compile([backbuffer]);
      const names = compiled.orderedPasses.map((p) => p.name);
      expect(names).toContain('Picking');
      expect(names).toContain('Final');
    });

    test('sideEffect pass keeps its dependencies alive', () => {
      let backbuffer = graph.importTexture('backbuffer');
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
        backbuffer = builder.write(backbuffer);
        builder.setExecute(() => {});
      });

      const compiled = graph.compile([backbuffer]);
      const names = compiled.orderedPasses.map((p) => p.name);
      expect(names).toContain('DepthPrepass');
      expect(names).toContain('DebugVis');
    });

    test('disabling HiZ culls the HiZ pass and its unique dependencies', () => {
      let backbuffer = graph.importTexture('backbuffer');
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
        backbuffer = builder.write(backbuffer);
        builder.setExecute(() => {});
      });

      const compiled = graph.compile([backbuffer]);
      const names = compiled.orderedPasses.map((p) => p.name);
      expect(names).toContain('DepthPrepass');
      expect(names).toContain('LightPass');
      expect(names).not.toContain('HiZ');
    });

    test('reader of an overwritten version is still culled when its output is unused', () => {
      let backbuffer = graph.importTexture('backbuffer');
      let color: RGHandle;

      graph.addPass('LightPass', (builder) => {
        color = builder.createTexture({ format: 'rgba8unorm', label: 'color' });
        builder.setExecute(() => {});
      });
      // Reads the pre-write scene color but produces nothing anyone consumes:
      // the WAR hazard with TransparentPass is ordering-only and must not keep
      // this pass alive.
      graph.addPass('DebugRead', (builder) => {
        builder.read(color!);
        builder.createTexture({ format: 'rgba8unorm', label: 'debug' });
        builder.setExecute(() => {});
      });
      graph.addPass('TransparentPass', (builder) => {
        builder.read(color!);
        color = builder.write(color!);
        builder.setExecute(() => {});
      });
      graph.addPass('Present', (builder) => {
        builder.read(color!);
        backbuffer = builder.write(backbuffer);
        builder.setExecute(() => {});
      });

      const names = graph.compile([backbuffer]).orderedPasses.map((p) => p.name);
      expect(names).toEqual(['LightPass', 'TransparentPass', 'Present']);
      expect(names).not.toContain('DebugRead');
    });
  });

  // ─── Resource Lifetime Analysis ─────────────────────────────────────

  describe('resource lifetime', () => {
    test('transient resource lifetime spans producer to last consumer', () => {
      let backbuffer = graph.importTexture('backbuffer');
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
        backbuffer = builder.write(backbuffer);
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
      let backbuffer = graph.importTexture('backbuffer');
      let t: RGHandle;

      graph.addPass('A', (builder) => {
        t = builder.createTexture({ format: 'r32f', label: 't' });
        builder.setExecute((_ctx) => log.push('A'));
      });
      graph.addPass('B', (builder) => {
        builder.read(t!);
        backbuffer = builder.write(backbuffer);
        builder.setExecute((_ctx) => log.push('B'));
      });

      const compiled = graph.compile([backbuffer]);
      graph.execute(compiled);
      expect(log).toEqual(['A', 'B']);
    });

    test('culled passes do not execute', () => {
      const log: string[] = [];
      let backbuffer = graph.importTexture('backbuffer');

      graph.addPass('Alive', (builder) => {
        backbuffer = builder.write(backbuffer);
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

    test('subpasses execute in registration order and receive pass data', () => {
      const log: string[] = [];
      let backbuffer = graph.importTexture('backbuffer');

      graph.addPass('MultiStep', (builder) => {
        backbuffer = builder.write(backbuffer);
        builder.addSubpass<{ label: string }>('First', (_ctx, data) => log.push(`First:${data.label}`));
        builder.addSubpass<{ label: string }>('Second', (_ctx, data) => log.push(`Second:${data.label}`));
        return { label: 'payload' };
      });

      const compiled = graph.compile([backbuffer]);
      graph.execute(compiled);

      expect(log).toEqual(['First:payload', 'Second:payload']);
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
      let backbuffer = graph.importTexture('backbuffer');

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
        backbuffer = builder.write(backbuffer);
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
      let backbuffer = graph.importTexture('backbuffer');

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
        backbuffer = builder.write(backbuffer);
        builder.setExecute((_ctx) => log.push('Composite'));
      });

      const compiled = graph.compile([backbuffer]);
      graph.execute(compiled);

      expect(log).toEqual(['DepthPrepass', 'LightPass', 'Composite']);
      expect(log).not.toContain('MotionVectors');
    });
  });
});

describe('RenderGraph mutation safety', () => {
  test('setup failure rolls back resources and consumers', () => {
    const graph = new RenderGraph();
    const imported = graph.importTexture('backbuffer');
    expect(() =>
      graph.addPass('Broken', (builder) => {
        builder.read(imported);
        builder.createTexture({ format: 'rgba8unorm' });
        throw new Error('setup failed');
      })
    ).toThrow('setup failed');
    expect(graph.passes).toHaveLength(0);
    expect(graph.resources.size).toBe(1);
    expect(graph.getResource(imported)?.consumers).toHaveLength(0);
  });

  test('serializes forked writes even when topo order would otherwise diverge', () => {
    const graph = new RenderGraph();
    const backbuffer = graph.importTexture('backbuffer');

    const gate = graph.addPass('Gate', (builder) => {
      const token = builder.createToken('gate');
      builder.setExecute(() => {});
      return token;
    });
    graph.addPass('First', (builder) => {
      builder.read(gate);
      builder.write(backbuffer);
      builder.sideEffect();
      builder.setExecute(() => {});
    });
    const second = graph.addPass('Second', (builder) => {
      const output = builder.write(backbuffer);
      builder.setExecute(() => {});
      return output;
    });
    // Without the WAW edge, Second is ready before First and the stable Kahn
    // queue emits [Gate, Second, First].
    const names = graph.compile([second]).orderedPasses.map((pass) => pass.name);
    expect(names.indexOf('First')).toBeLessThan(names.indexOf('Second'));
  });

  test('WAR: reader of the old version runs before the overwriting pass', () => {
    const graph = new RenderGraph();
    let backbuffer = graph.importTexture('backbuffer');
    let color: RGHandle;
    let debugOut: RGHandle;

    graph.addPass('LightPass', (builder) => {
      color = builder.createTexture({ format: 'rgba8unorm', label: 'color' });
      builder.setExecute(() => {});
    });
    // Gate the reader behind a token so the stable Kahn queue would otherwise
    // emit the writer first; the WAR edge must force the reader ahead.
    const gate = graph.addPass('Gate', (builder) => {
      const token = builder.createToken('gate');
      builder.setExecute(() => {});
      return token;
    });
    graph.addPass('DebugRead', (builder) => {
      builder.read(gate);
      builder.read(color!);
      debugOut = builder.createTexture({ format: 'rgba8unorm', label: 'debug' });
      builder.setExecute(() => {});
    });
    graph.addPass('TransparentPass', (builder) => {
      builder.read(color!);
      color = builder.write(color!);
      builder.setExecute(() => {});
    });
    graph.addPass('Present', (builder) => {
      builder.read(color!);
      builder.read(debugOut!);
      backbuffer = builder.write(backbuffer);
      builder.setExecute(() => {});
    });

    const names = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);
    expect(names.indexOf('DebugRead')).toBeLessThan(names.indexOf('TransparentPass'));
  });

  test('read of a superseded version is ordered before the overwriting pass', () => {
    const graph = new RenderGraph();
    let backbuffer = graph.importTexture('backbuffer');
    let colorV0: RGHandle;
    let colorV1: RGHandle;
    let lateOut: RGHandle;

    graph.addPass('LightPass', (builder) => {
      colorV0 = builder.createTexture({ format: 'rgba8unorm', label: 'color' });
      builder.setExecute(() => {});
    });
    graph.addPass('TransparentPass', (builder) => {
      builder.read(colorV0!);
      colorV1 = builder.write(colorV0!);
      builder.setExecute(() => {});
    });
    // Declared AFTER the overwriting pass but reads the old version: it must be
    // scheduled before TransparentPass clobbers the physical texture.
    graph.addPass('LateReader', (builder) => {
      builder.read(colorV0!);
      lateOut = builder.createTexture({ format: 'rgba8unorm', label: 'late' });
      builder.setExecute(() => {});
    });
    graph.addPass('Present', (builder) => {
      builder.read(colorV1!);
      builder.read(lateOut!);
      backbuffer = builder.write(backbuffer);
      builder.setExecute(() => {});
    });

    const names = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);
    expect(names.indexOf('LateReader')).toBeLessThan(names.indexOf('TransparentPass'));
  });

  test('stale read of a forked write is ordered before the FIRST overwriting pass', () => {
    const graph = new RenderGraph();
    let backbuffer = graph.importTexture('backbuffer');
    let colorV0: RGHandle;
    let lateOut: RGHandle;

    graph.addPass('Producer', (builder) => {
      colorV0 = builder.createTexture({ format: 'rgba8unorm', label: 'color' });
      builder.setExecute(() => {});
    });
    // Two forked writes of v0; the WAW edge serializes W1 before W2.
    graph.addPass('W1', (builder) => {
      builder.write(colorV0!);
      builder.sideEffect();
      builder.setExecute(() => {});
    });
    const v2 = graph.addPass('W2', (builder) => {
      const out = builder.write(colorV0!);
      builder.setExecute(() => {});
      return out;
    });
    graph.addPass('LateReader', (builder) => {
      builder.read(colorV0!);
      lateOut = builder.createTexture({ format: 'rgba8unorm', label: 'late' });
      builder.setExecute(() => {});
    });
    graph.addPass('Present', (builder) => {
      builder.read(v2);
      builder.read(lateOut!);
      backbuffer = builder.write(backbuffer);
      builder.setExecute(() => {});
    });

    const names = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);
    expect(names.indexOf('LateReader')).toBeLessThan(names.indexOf('W1'));
  });

  test('setup failure rolls back retroactive WAR edges and nextWriter', () => {
    const graph = new RenderGraph();
    let color: RGHandle;

    graph.addPass('Producer', (builder) => {
      color = builder.createTexture({ format: 'rgba8unorm', label: 'color' });
      builder.setExecute(() => {});
    });
    const v1 = graph.addPass('Writer', (builder) => {
      builder.read(color!);
      const out = builder.write(color!);
      builder.setExecute(() => {});
      return out;
    });

    // The stale read adds a WAR edge into Writer before the setup throws.
    expect(() =>
      graph.addPass('BrokenReader', (builder) => {
        builder.read(color!);
        throw new Error('setup failed');
      })
    ).toThrow('setup failed');
    const writerPass = graph.passes.find((pass) => pass.name === 'Writer')!;
    expect(writerPass.warDependencies).toHaveLength(0);

    // A failed writer must not leave a nextWriter marker on the version it wrote.
    expect(() =>
      graph.addPass('BrokenWriter', (builder) => {
        builder.write(v1);
        throw new Error('setup failed');
      })
    ).toThrow('setup failed');
    expect(graph.getResource(v1)?.nextWriter).toBeNull();

    const names = graph.compile([v1]).orderedPasses.map((pass) => pass.name);
    expect(names).toEqual(['Producer', 'Writer']);
  });
});

// ─── RenderGraphExecutor Tests ────────────────────────────────────────

describe('RenderGraphExecutor', () => {
  let graph: RenderGraph;

  beforeEach(() => {
    graph = new RenderGraph();
  });

  test('reacquires the previous logical texture across newly-created executors', () => {
    let nextId = 0;
    const allocateCalls: Array<{ preferred?: MockTexture; result: MockTexture }> = [];
    const allocator: RGTextureAllocator<MockTexture> = {
      allocate(desc, size, preferred) {
        const result = preferred ?? { id: nextId++, desc, size };
        allocateCalls.push({ preferred, result });
        return result;
      },
      release() {}
    };
    const affinityCache = new RGTextureAffinityCache<MockTexture>();

    const executeFrame = (format: RGTextureDesc['format'] = 'rgba8unorm') => {
      const frameGraph = new RenderGraph();
      let backbuffer = frameGraph.importTexture('backbuffer');
      let color!: RGHandle;
      frameGraph.addPass('ColorPass', (builder) => {
        color = builder.createTexture({
          format,
          label: 'color',
          allocationKey: 'test.color'
        });
        builder.setExecute(() => {});
      });
      frameGraph.addPass('Present', (builder) => {
        builder.read(color);
        backbuffer = builder.write(backbuffer);
        builder.setExecute(() => {});
      });
      const compiled = frameGraph.compile([backbuffer]);
      const executor = new RenderGraphExecutor(allocator, 64, 64, {
        textureAffinityCache: affinityCache
      });
      executor.setImportedTexture(backbuffer, { id: -1, desc: {} as any, size: { width: 64, height: 64 } });
      executor.execute(compiled);
    };

    executeFrame();
    executeFrame();

    expect(allocateCalls).toHaveLength(2);
    expect(allocateCalls[0].preferred).toBeUndefined();
    expect(allocateCalls[1].preferred).toBe(allocateCalls[0].result);
    expect(allocateCalls[1].result).toBe(allocateCalls[0].result);
  });

  test('falls back when the descriptor changes and updates the affinity snapshot', () => {
    let nextId = 0;
    const allocateCalls: Array<{ preferred?: MockTexture; result: MockTexture }> = [];
    const allocator: RGTextureAllocator<MockTexture> = {
      allocate(desc, size, preferred) {
        const result = { id: nextId++, desc, size };
        allocateCalls.push({ preferred, result });
        return result;
      },
      release() {}
    };
    const affinityCache = new RGTextureAffinityCache<MockTexture>();

    const executeFrame = (format: RGTextureDesc['format']) => {
      const frameGraph = new RenderGraph();
      let backbuffer = frameGraph.importTexture('backbuffer');
      let color!: RGHandle;
      frameGraph.addPass('ColorPass', (builder) => {
        color = builder.createTexture({ format, allocationKey: 'test.color' });
        builder.setExecute(() => {});
      });
      frameGraph.addPass('Present', (builder) => {
        builder.read(color);
        backbuffer = builder.write(backbuffer);
        builder.setExecute(() => {});
      });
      const executor = new RenderGraphExecutor(allocator, 64, 64, { textureAffinityCache: affinityCache });
      executor.setImportedTexture(backbuffer, { id: -1, desc: {} as any, size: { width: 64, height: 64 } });
      executor.execute(frameGraph.compile([backbuffer]));
    };

    executeFrame('rgba8unorm');
    executeFrame('rgba16f');
    executeFrame('rgba16f');

    expect(allocateCalls[0].preferred).toBeUndefined();
    expect(allocateCalls[1].preferred).toBeUndefined();
    expect(allocateCalls[2].preferred).toBe(allocateCalls[1].result);
  });

  test('does not commit fallback allocations when execution fails', () => {
    let nextId = 0;
    let rejectPreferred = false;
    const allocateCalls: Array<{ preferred?: MockTexture; result: MockTexture }> = [];
    const allocator: RGTextureAllocator<MockTexture> = {
      allocate(desc, size, preferred) {
        const result = !rejectPreferred && preferred ? preferred : { id: nextId++, desc, size };
        allocateCalls.push({ preferred, result });
        return result;
      },
      release() {}
    };
    const affinityCache = new RGTextureAffinityCache<MockTexture>();

    const executeFrame = (shouldThrow: boolean) => {
      const frameGraph = new RenderGraph();
      let backbuffer = frameGraph.importTexture('backbuffer');
      let color!: RGHandle;
      frameGraph.addPass('ColorPass', (builder) => {
        color = builder.createTexture({ format: 'rgba8unorm', allocationKey: 'test.color' });
        builder.setExecute(() => {
          if (shouldThrow) {
            throw new Error('frame failed');
          }
        });
      });
      frameGraph.addPass('Present', (builder) => {
        builder.read(color);
        backbuffer = builder.write(backbuffer);
        builder.setExecute(() => {});
      });
      const executor = new RenderGraphExecutor(allocator, 64, 64, { textureAffinityCache: affinityCache });
      executor.setImportedTexture(backbuffer, { id: -1, desc: {} as any, size: { width: 64, height: 64 } });
      executor.execute(frameGraph.compile([backbuffer]));
    };

    executeFrame(false);
    rejectPreferred = true;
    expect(() => executeFrame(true)).toThrow('frame failed');
    rejectPreferred = false;
    executeFrame(false);

    expect(allocateCalls[1].preferred).toBe(allocateCalls[0].result);
    expect(allocateCalls[2].preferred).toBe(allocateCalls[0].result);
  });

  test('allocates transient textures before first use and releases after last use', () => {
    const { allocator, allocated, released } = createMockAllocator();
    let backbuffer = graph.importTexture('backbuffer');

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
      backbuffer = builder.write(backbuffer);
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
    let backbuffer = graph.importTexture('backbuffer');

    let resolved: MockTexture | null = null;
    graph.addPass('Final', (builder) => {
      backbuffer = builder.write(backbuffer);
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
    let backbuffer = graph.importTexture('backbuffer');

    let depth: RGHandle;
    let resolvedDepth: MockTexture | null = null;

    graph.addPass('DepthPrepass', (builder) => {
      depth = builder.createTexture({ format: 'r32f', label: 'depth' });
      builder.setExecute(() => {});
    });
    graph.addPass('LightPass', (builder) => {
      builder.read(depth!);
      backbuffer = builder.write(backbuffer);
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

  test('executor runs subpasses in order with shared declared resource access', () => {
    const { allocator } = createMockAllocator();
    let backbuffer = graph.importTexture('backbuffer');
    const events: string[] = [];

    graph.addPass('MultiStep', (builder) => {
      const color = builder.createTexture({ format: 'rgba8unorm', label: 'color' });
      const framebuffer = builder.createFramebuffer({
        colorAttachments: color,
        depthAttachment: null
      });
      backbuffer = builder.write(backbuffer);
      builder.addSubpass('ResolveTexture', (ctx: RGExecuteContext) => {
        const texture = ctx.getTexture<MockTexture>(color);
        events.push(`texture:${texture.desc.label}`);
      });
      builder.addSubpass('ResolveFramebuffer', (ctx: RGExecuteContext) => {
        ctx.getFramebuffer<MockFramebuffer>(framebuffer);
        events.push('framebuffer');
      });
    });

    const compiled = graph.compile([backbuffer]);
    const executor = new RenderGraphExecutor(allocator, 1920, 1080);
    executor.setImportedTexture(backbuffer, { id: -1, desc: {} as any, size: { width: 1920, height: 1080 } });
    executor.execute(compiled);

    expect(events).toEqual(['texture:color', 'framebuffer']);
  });

  test('getTexture requires a declared read or write dependency', () => {
    const { allocator } = createMockAllocator();
    let texture: RGHandle;
    let done: RGHandle;

    graph.addPass('Producer', (builder) => {
      texture = builder.createTexture({ format: 'r32f', label: 'hiddenTexture' });
      done = builder.createToken('ProducerDone');
      builder.setExecute(() => {});
    });
    graph.addPass('BadConsumer', (builder) => {
      builder.read(done!);
      builder.sideEffect();
      builder.setExecute((ctx: RGExecuteContext) => {
        ctx.getTexture<MockTexture>(texture!);
      });
    });

    const compiled = graph.compile([]);
    const executor = new RenderGraphExecutor(allocator, 1920, 1080);

    expect(() => executor.execute(compiled)).toThrow(
      /pass "BadConsumer" tried to access texture "hiddenTexture" without declaring a read\/write dependency/
    );
  });

  test('subpass access validation reports pass and subpass names', () => {
    const { allocator } = createMockAllocator();
    let texture: RGHandle;
    let done: RGHandle;

    graph.addPass('Producer', (builder) => {
      texture = builder.createTexture({ format: 'r32f', label: 'hiddenTexture' });
      done = builder.createToken('ProducerDone');
      builder.setExecute(() => {});
    });
    graph.addPass('BadConsumer', (builder) => {
      builder.read(done!);
      builder.sideEffect();
      builder.addSubpass('Lookup', (ctx: RGExecuteContext) => {
        ctx.getTexture<MockTexture>(texture!);
      });
    });

    const compiled = graph.compile([]);
    const executor = new RenderGraphExecutor(allocator, 1920, 1080);

    expect(() => executor.execute(compiled)).toThrow(
      /pass "BadConsumer" subpass "Lookup" failed: .*hiddenTexture.*without declaring a read\/write dependency/
    );
  });

  test('allocates graph framebuffers with resolved texture attachments', () => {
    const { allocator, allocatedFramebuffers, releasedFramebuffers } = createMockAllocator();
    let backbuffer = graph.importTexture('backbuffer');

    let framebuffer: RGHandle;
    let resolvedFramebuffer: MockFramebuffer | null = null;

    graph.addPass('RenderToFramebuffer', (builder) => {
      const color = builder.createTexture({ format: 'rgba8unorm', label: 'color' });
      const depth = builder.createTexture({ format: 'd24s8' as any, label: 'depth' });
      framebuffer = builder.createFramebuffer({
        colorAttachments: color,
        depthAttachment: depth
      });
      backbuffer = builder.write(backbuffer);
      builder.setExecute((ctx: RGExecuteContext) => {
        resolvedFramebuffer = ctx.getFramebuffer<MockFramebuffer>(framebuffer);
      });
    });

    const compiled = graph.compile([backbuffer]);
    const executor = new RenderGraphExecutor(allocator, 1920, 1080);
    executor.setImportedTexture(backbuffer, { id: -1, desc: {} as any, size: { width: 1920, height: 1080 } });
    executor.execute(compiled);

    expect(resolvedFramebuffer).toBe(allocatedFramebuffers[0]);
    expect((allocatedFramebuffers[0].desc.colorAttachments as MockTexture).desc.label).toBe('color');
    expect((allocatedFramebuffers[0].desc.depthAttachment as MockTexture).desc.label).toBe('depth');
    expect(releasedFramebuffers).toHaveLength(1);
  });

  test('keeps graph framebuffers alive until their last reader', () => {
    const { allocator, releasedFramebuffers } = createMockAllocator();
    let backbuffer = graph.importTexture('backbuffer');

    let framebuffer: RGHandle;
    const events: string[] = [];

    graph.addPass('CreateFramebuffer', (builder) => {
      const color = builder.createTexture({ format: 'rgba8unorm', label: 'color' });
      framebuffer = builder.createFramebuffer({
        label: 'hiddenFramebuffer',
        colorAttachments: color,
        depthAttachment: null
      });
      builder.setExecute(() => {
        events.push(`create:released=${releasedFramebuffers.length}`);
      });
    });
    graph.addPass('UseFramebuffer', (builder) => {
      builder.read(framebuffer!);
      backbuffer = builder.write(backbuffer);
      builder.setExecute((ctx: RGExecuteContext) => {
        ctx.getFramebuffer<MockFramebuffer>(framebuffer);
        events.push(`use:released=${releasedFramebuffers.length}`);
      });
    });

    const compiled = graph.compile([backbuffer]);
    const executor = new RenderGraphExecutor(allocator, 1920, 1080);
    executor.setImportedTexture(backbuffer, { id: -1, desc: {} as any, size: { width: 1920, height: 1080 } });
    executor.execute(compiled);

    expect(events).toEqual(['create:released=0', 'use:released=0']);
    expect(releasedFramebuffers).toHaveLength(1);
  });

  test('getFramebuffer requires a declared read or write dependency', () => {
    const { allocator } = createMockAllocator();
    let framebuffer: RGHandle;
    let done: RGHandle;

    graph.addPass('CreateFramebuffer', (builder) => {
      const color = builder.createTexture({ format: 'rgba8unorm', label: 'color' });
      framebuffer = builder.createFramebuffer({
        label: 'hiddenFramebuffer',
        colorAttachments: color,
        depthAttachment: null
      });
      done = builder.createToken('FramebufferDone');
      builder.setExecute(() => {});
    });
    graph.addPass('BadConsumer', (builder) => {
      builder.read(done!);
      builder.sideEffect();
      builder.setExecute((ctx: RGExecuteContext) => {
        ctx.getFramebuffer<MockFramebuffer>(framebuffer!);
      });
    });

    const compiled = graph.compile([]);
    const executor = new RenderGraphExecutor(allocator, 1920, 1080);

    expect(() => executor.execute(compiled)).toThrow(
      /pass "BadConsumer" tried to access framebuffer "hiddenFramebuffer" without declaring a read\/write dependency/
    );
  });

  test('createFramebuffer requires declared dependencies for handle attachments', () => {
    const { allocator } = createMockAllocator();
    let texture: RGHandle;
    let done: RGHandle;

    graph.addPass('Producer', (builder) => {
      texture = builder.createTexture({ format: 'rgba8unorm', label: 'hiddenAttachment' });
      done = builder.createToken('ProducerDone');
      builder.setExecute(() => {});
    });
    graph.addPass('BadConsumer', (builder) => {
      builder.read(done!);
      builder.sideEffect();
      builder.setExecute((ctx: RGExecuteContext) => {
        ctx.createFramebuffer<MockFramebuffer>({
          colorAttachments: texture!,
          depthAttachment: null
        });
      });
    });

    const compiled = graph.compile([]);
    const executor = new RenderGraphExecutor(allocator, 1920, 1080);

    expect(() => executor.execute(compiled)).toThrow(
      /pass "BadConsumer" tried to access texture "hiddenAttachment" without declaring a read\/write dependency/
    );
  });

  test('releases graph and temporary resources when a pass throws', () => {
    const { allocator, released, releasedFramebuffers } = createMockAllocator();
    let backbuffer = graph.importTexture('backbuffer');

    graph.addPass('ThrowingPass', (builder) => {
      const color = builder.createTexture({ format: 'rgba8unorm', label: 'color' });
      const framebuffer = builder.createFramebuffer({
        colorAttachments: color,
        depthAttachment: null
      });
      backbuffer = builder.write(backbuffer);
      builder.setExecute((ctx: RGExecuteContext) => {
        ctx.getFramebuffer<MockFramebuffer>(framebuffer);
        ctx.createFramebuffer<MockFramebuffer>({
          colorAttachments: 'rgba8unorm',
          depthAttachment: null
        });
        throw new Error('pass failed');
      });
    });

    const compiled = graph.compile([backbuffer]);
    const executor = new RenderGraphExecutor(allocator, 1920, 1080);
    executor.setImportedTexture(backbuffer, { id: -1, desc: {} as any, size: { width: 1920, height: 1080 } });

    expect(() => executor.execute(compiled)).toThrow(/pass failed/);
    expect(released).toHaveLength(1);
    expect(releasedFramebuffers).toHaveLength(2);

    executor.reset();
    expect(released).toHaveLength(1);
    expect(releasedFramebuffers).toHaveLength(2);
  });

  test('releases graph and temporary resources when a subpass throws', () => {
    const { allocator, released, releasedFramebuffers } = createMockAllocator();
    let backbuffer = graph.importTexture('backbuffer');

    graph.addPass('ThrowingPass', (builder) => {
      const color = builder.createTexture({ format: 'rgba8unorm', label: 'color' });
      const framebuffer = builder.createFramebuffer({
        colorAttachments: color,
        depthAttachment: null
      });
      backbuffer = builder.write(backbuffer);
      builder.addSubpass('ThrowingSubpass', (ctx: RGExecuteContext) => {
        ctx.getFramebuffer<MockFramebuffer>(framebuffer);
        ctx.createFramebuffer<MockFramebuffer>({
          colorAttachments: 'rgba8unorm',
          depthAttachment: null
        });
        throw new Error('subpass failed');
      });
    });

    const compiled = graph.compile([backbuffer]);
    const executor = new RenderGraphExecutor(allocator, 1920, 1080);
    executor.setImportedTexture(backbuffer, { id: -1, desc: {} as any, size: { width: 1920, height: 1080 } });

    expect(() => executor.execute(compiled)).toThrow(/subpass "ThrowingSubpass" failed: subpass failed/);
    expect(released).toHaveLength(1);
    expect(releasedFramebuffers).toHaveLength(2);
  });

  test('runs deferred cleanup callbacks in reverse order after successful execution', () => {
    const { allocator } = createMockAllocator();
    let backbuffer = graph.importTexture('backbuffer');
    const events: string[] = [];

    graph.addPass('CleanupPass', (builder) => {
      backbuffer = builder.write(backbuffer);
      builder.setExecute((ctx: RGExecuteContext) => {
        events.push('execute');
        ctx.deferCleanup(() => events.push('cleanup:first'));
        ctx.deferCleanup(() => events.push('cleanup:second'));
      });
    });

    const compiled = graph.compile([backbuffer]);
    const executor = new RenderGraphExecutor(allocator, 1920, 1080);
    executor.setImportedTexture(backbuffer, { id: -1, desc: {} as any, size: { width: 1920, height: 1080 } });
    executor.execute(compiled);

    expect(events).toEqual(['execute', 'cleanup:second', 'cleanup:first']);
  });

  test('preserves pass execution error when deferred cleanup also throws', () => {
    const { allocator } = createMockAllocator();
    let backbuffer = graph.importTexture('backbuffer');

    graph.addPass('ThrowingPass', (builder) => {
      backbuffer = builder.write(backbuffer);
      builder.setExecute((ctx: RGExecuteContext) => {
        ctx.deferCleanup(() => {
          throw new Error('cleanup failed');
        });
        throw new Error('pass failed');
      });
    });

    const compiled = graph.compile([backbuffer]);
    const executor = new RenderGraphExecutor(allocator, 1920, 1080);
    executor.setImportedTexture(backbuffer, { id: -1, desc: {} as any, size: { width: 1920, height: 1080 } });

    expect(() => executor.execute(compiled)).toThrow(/pass failed/);
  });

  test('preserves pass execution error when automatic resource release also throws', () => {
    const { allocator } = createMockAllocator();
    allocator.release = () => {
      throw new Error('release failed');
    };
    let backbuffer = graph.importTexture('backbuffer');

    graph.addPass('ThrowingPass', (builder) => {
      builder.createTexture({ format: 'rgba8unorm', label: 'temporary' });
      backbuffer = builder.write(backbuffer);
      builder.setExecute(() => {
        throw new Error('pass failed');
      });
    });

    const compiled = graph.compile([backbuffer]);
    const executor = new RenderGraphExecutor(allocator, 1920, 1080);
    executor.setImportedTexture(backbuffer, { id: -1, desc: {} as any, size: { width: 1920, height: 1080 } });

    expect(() => executor.execute(compiled)).toThrow(/pass failed/);
  });

  test('backbuffer-relative sizing resolves correctly', () => {
    const { allocator, allocated } = createMockAllocator();
    let backbuffer = graph.importTexture('backbuffer');

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
      backbuffer = builder.write(backbuffer);
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
    let backbuffer = graph.importTexture('backbuffer');

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
      backbuffer = builder.write(backbuffer);
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
    let backbuffer = graph.importTexture('backbuffer');

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
      backbuffer = builder.write(backbuffer);
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

  test('render graph profiling is disabled by default', () => {
    const { allocator } = createMockAllocator();
    const { device, begun } = createMockTimestampDevice();
    let backbuffer = graph.importTexture('backbuffer');

    graph.addPass('Pass', (builder) => {
      backbuffer = builder.write(backbuffer);
      builder.setExecute(() => {});
    });

    const compiled = graph.compile([backbuffer]);
    const executor = new RenderGraphExecutor(allocator, 1920, 1080, { device });
    executor.setImportedTexture(backbuffer, { id: -1, desc: {} as any, size: { width: 1920, height: 1080 } });
    executor.execute(compiled);

    expect(begun).toHaveLength(0);
    expect(executor.getLatestProfileResult()).toBeNull();
  });

  test('render graph profiling resolves graph pass and subpass tree', async () => {
    const { allocator } = createMockAllocator();
    const { device, begun, ended, labels } = createMockTimestampDevice();
    let backbuffer = graph.importTexture('backbuffer');
    const events: string[] = [];

    graph.addPass('MainPass', (builder) => {
      backbuffer = builder.write(backbuffer);
      builder.addSubpass('Opaque', () => {
        events.push('Opaque');
      });
      builder.addSubpass('Overlay', () => {
        events.push('Overlay');
      });
    });

    const compiled = graph.compile([backbuffer]);
    const executor = new RenderGraphExecutor(allocator, 1920, 1080, {
      device,
      profiling: true
    });
    executor.setImportedTexture(backbuffer, { id: -1, desc: {} as any, size: { width: 1920, height: 1080 } });
    executor.execute(compiled);
    const profile = await executor.resolveProfileResult();

    expect(events).toEqual(['Opaque', 'Overlay']);
    expect(begun).toHaveLength(4);
    expect(ended).toEqual([3, 4, 2, 1]);
    expect(labels.get(1)).toBe('RenderGraph');
    expect(profile?.status).toBe('resolved');
    expect(profile?.frameId).toBe(42);
    expect(profile?.graph.name).toBe('RenderGraph');
    expect(profile?.graph.durationMs).toBe(1);
    expect(profile?.passes.map((pass) => pass.name)).toEqual(['MainPass']);
    expect(profile?.passes[0].children.map((child) => child.name)).toEqual(['Opaque', 'Overlay']);
    expect(profile?.passes[0].children.map((child) => child.durationMs)).toEqual([3, 4]);
  });

  test('render graph profiling exposes unsupported results without timestamp queries', async () => {
    const { allocator } = createMockAllocator();
    const { device, begun, ended } = createMockTimestampDevice(false);
    let backbuffer = graph.importTexture('backbuffer');

    graph.addPass('Pass', (builder) => {
      backbuffer = builder.write(backbuffer);
      builder.setExecute(() => {});
    });

    const compiled = graph.compile([backbuffer]);
    const executor = new RenderGraphExecutor(allocator, 1920, 1080, {
      device,
      profiling: true
    });
    executor.setImportedTexture(backbuffer, { id: -1, desc: {} as any, size: { width: 1920, height: 1080 } });
    executor.execute(compiled);
    const profile = await executor.resolveProfileResult();

    expect(begun).toHaveLength(0);
    expect(ended).toHaveLength(0);
    expect(profile?.status).toBe('unsupported');
    expect(profile?.passes[0].status).toBe('unsupported');
  });

  test('render graph profiling can be enabled globally for new executors', async () => {
    const { allocator } = createMockAllocator();
    const { device, begun } = createMockTimestampDevice();
    let backbuffer = graph.importTexture('backbuffer');

    graph.addPass('Pass', (builder) => {
      backbuffer = builder.write(backbuffer);
      builder.setExecute(() => {});
    });

    try {
      RenderGraphExecutor.setDefaultProfilingOptions({ enabled: true, device });
      const compiled = graph.compile([backbuffer]);
      const executor = new RenderGraphExecutor(allocator, 1920, 1080);
      executor.setImportedTexture(backbuffer, {
        id: -1,
        desc: {} as any,
        size: { width: 1920, height: 1080 }
      });
      executor.execute(compiled);
      const profile = await RenderGraphExecutor.resolveProfileResult();

      expect(begun).toHaveLength(2);
      expect(profile?.passes.map((pass) => pass.name)).toEqual(['Pass']);
    } finally {
      RenderGraphExecutor.setDefaultProfilingOptions(false);
    }
  });

  test('render graph global profile result uses the newest executor frame', async () => {
    const first = createMockAllocator();
    const second = createMockAllocator();
    const { device } = createMockTimestampDevice();
    let backbuffer = graph.importTexture('backbuffer');

    graph.addPass('Pass', (builder) => {
      backbuffer = builder.write(backbuffer);
      builder.setExecute(() => {});
    });

    const compiled = graph.compile([backbuffer]);
    const firstExecutor = new RenderGraphExecutor(first.allocator, 1920, 1080, {
      device,
      profiling: { enabled: true, label: 'FirstGraph' }
    });
    firstExecutor.setImportedTexture(backbuffer, {
      id: -1,
      desc: {} as any,
      size: { width: 1920, height: 1080 }
    });
    firstExecutor.execute(compiled);
    await firstExecutor.resolveProfileResult();
    firstExecutor.setImportedTexture(backbuffer, {
      id: -1,
      desc: {} as any,
      size: { width: 1920, height: 1080 }
    });
    firstExecutor.execute(compiled);
    await firstExecutor.resolveProfileResult();

    const secondExecutor = new RenderGraphExecutor(second.allocator, 1920, 1080, {
      device,
      profiling: { enabled: true, label: 'SecondGraph' }
    });
    secondExecutor.setImportedTexture(backbuffer, {
      id: -1,
      desc: {} as any,
      size: { width: 1920, height: 1080 }
    });
    secondExecutor.execute(compiled);
    const profile = await RenderGraphExecutor.resolveProfileResult();

    expect(profile?.graph.name).toBe('SecondGraph');
    expect(RenderGraphExecutor.getLatestProfileResult()?.graph.name).toBe('SecondGraph');
  });
});

describe('Pool preferred transient allocation', () => {
  test('takes the preferred matching texture instead of the stack top', () => {
    let nextId = 0;
    const device = {
      createTexture2D: () => ({ id: nextId++, memCost: 1 }),
      getGPUObjects: () => ({ stacks: new WeakMap() })
    } as any;
    const pool = new Pool(device, 'rendergraph-test');
    const first = pool.fetchTemporalTexture2D(false, 'rgba8unorm', 16, 16);
    const second = pool.fetchTemporalTexture2D(false, 'rgba8unorm', 16, 16);
    pool.releaseTexture(first);
    pool.releaseTexture(second);

    expect(pool.fetchTemporalTexture2D(false, 'rgba8unorm', 16, 16, false, first)).toBe(first);
  });
});
