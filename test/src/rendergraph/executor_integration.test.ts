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

describe('Transient write-version aliasing', () => {
  test('write-versions of a transient share one texture, released after the last use of any version', () => {
    const { allocator, allocated, released } = createMockAllocator();
    const graph = new RenderGraph();

    let texHandle: any;
    const seen: number[] = [];
    // How many textures were released when each pass ran.
    const releasedDuring: number[] = [];

    graph.addPass('Produce', (builder) => {
      texHandle = builder.createTexture({ format: 'rgba8unorm', label: 'accum' });
      builder.setExecute((rgCtx) => {
        seen.push(rgCtx.getTexture<MockTexture>(texHandle).id);
        releasedDuring.push(released.length);
      });
    });

    let version1: any;
    graph.addPass('AccumulateA', (builder) => {
      builder.read(texHandle);
      version1 = builder.write(texHandle);
      builder.setExecute((rgCtx) => {
        seen.push(rgCtx.getTexture<MockTexture>(version1).id);
        releasedDuring.push(released.length);
      });
    });

    let version2: any;
    graph.addPass('AccumulateB', (builder) => {
      builder.read(version1);
      version2 = builder.write(version1);
      builder.setExecute((rgCtx) => {
        seen.push(rgCtx.getTexture<MockTexture>(version2).id);
        releasedDuring.push(released.length);
      });
    });

    let backbuffer = graph.importTexture('backbuffer');
    graph.addPass('Consume', (builder) => {
      builder.read(version2);
      backbuffer = builder.write(backbuffer);
      builder.setExecute((rgCtx) => {
        seen.push(rgCtx.getTexture<MockTexture>(version2).id);
        releasedDuring.push(released.length);
      });
    });

    const compiled = graph.compile([backbuffer]);
    const executor = new RenderGraphExecutor(allocator, 256, 256);
    executor.setImportedTexture(backbuffer, { id: -1, desc: {} as any, size: { width: 256, height: 256 } });
    executor.execute(compiled);

    // One allocation shared by every version, all passes see the same texture
    expect(allocated.length).toBe(1);
    expect(seen).toEqual([allocated[0].id, allocated[0].id, allocated[0].id, allocated[0].id]);
    // Nothing released while any version still has pending uses, then exactly once
    expect(releasedDuring).toEqual([0, 0, 0, 0]);
    expect(released.length).toBe(1);
    expect(released[0]).toBe(allocated[0]);
  });
});
