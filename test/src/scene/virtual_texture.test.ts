import { createNullDevice } from '@zephyr3d/backend-null';
import type { NullDevice } from '@zephyr3d/backend-null';
import { VirtualTexture, virtualMipChain } from '../../../libs/scene/src';

/**
 * Shader generation and layout checks for the sparse virtual texture core. The null device runs
 * the real program builder, so every compute pass, the fill template and the sampling helpers
 * are generated here without a GPU; the page management itself is verified visually in
 * examples/src/virtualtexture.
 */
describe('VirtualTexture', () => {
  async function create(atlasSize = 1024) {
    const device = (await createNullDevice({ type: 'webgpu' })) as NullDevice;
    const vt = new VirtualTexture(device, {
      levels: virtualMipChain(65536, 128),
      atlasSize,
      planes: [{ name: 'color', format: 'rgba8unorm' }],
      allocBudget: 8
    });
    return { device, vt };
  }

  test('mip chain levels halve down to a single page', () => {
    const levels = virtualMipChain(65536, 128);
    expect(levels.length).toBe(10);
    expect(levels[0]).toEqual({ pagesX: 512, pagesY: 512 });
    expect(levels[9]).toEqual({ pagesX: 1, pagesY: 1 });
    expect(() => virtualMipChain(1000, 128)).toThrow();
  });

  test('non-square mip chain stops each axis at one page', () => {
    const levels = virtualMipChain(32768, 8192, 128);
    expect(levels.length).toBe(9);
    expect(levels[0]).toEqual({ pagesX: 256, pagesY: 64 });
    expect(levels[6]).toEqual({ pagesX: 4, pagesY: 1 });
    expect(levels[8]).toEqual({ pagesX: 1, pagesY: 1 });
    expect(() => virtualMipChain(32768, 64, 128)).toThrow();
  });

  test('physical pool and pinned levels', async () => {
    const { vt } = await create();
    // 1024 / (128 + 2 * 4) = 7 slots per row
    expect(vt.physicalPageCount).toBe(49);
    // an eighth of the pool is 6 pages: the 1x1 and 2x2 levels fit, the 4x4 one does not
    expect(vt.pinnedFromLevel).toBe(8);
  });

  test('builds every page management pass', async () => {
    const { device, vt } = await create();
    expect(() => vt.update(1)).not.toThrow();
    const computes = [...device.getCommands('compute'), ...device.getCommands('computeIndirect')];
    expect(computes.length).toBeGreaterThanOrEqual(12);
    expect(device.getCommandCount('computeIndirect')).toBe(1);
    const sources = computes.map((c) => c.program!.getShaderSource('compute')!);
    // the physical page lists are updated atomically and the pack pass scans in workgroup memory
    expect(sources.some((s) => s.includes('atomicAdd'))).toBe(true);
    expect(sources.some((s) => s.includes('var<workgroup>') && s.includes('workgroupBarrier'))).toBe(true);
  });

  test('the first update reads the initial LRU order', async () => {
    // Every physical page must appear once in the REQUESTED list the first update walks as its
    // LRU input; a wrong buffer there makes every thread process the same page and loses the rest
    const { vt } = await create();
    vt.update(1);
    const internals = vt as unknown as {
      _bindGroups: Map<string, { getBuffer(name: string): { getBufferSubData(): Promise<Uint8Array> } }>;
    };
    const prev = internals._bindGroups.get('updatePhysical1')!.getBuffer('zVT_prevLists');
    const data = new Uint32Array((await prev.getBufferSubData()).slice().buffer);
    const N = vt.physicalPageCount;
    const requested = Array.from(data.subarray(3 * N, 4 * N));
    expect(requested).toEqual(Array.from({ length: N }, (_, i) => i));
  });

  test('binds every buffer the passes declare', async () => {
    // Buffers are declared under the builder's block names (zUBC_*) and bound by variable name
    // through the layout name map; an entry left unbound fails bind group creation on WebGPU
    const { vt } = await create();
    vt.update(1);
    const internals = vt as unknown as {
      _programs: Map<string, { bindGroupLayouts: { entries: { name: string; buffer?: unknown }[] }[] }>;
      _bindGroups: Map<string, { getBuffer(name: string): unknown }>;
    };
    for (const [name, program] of internals._programs) {
      const bindGroup = internals._bindGroups.get(name)!;
      for (const entry of program.bindGroupLayouts[0].entries) {
        if (entry.buffer) {
          expect([name, entry.name, !!bindGroup.getBuffer(entry.name)]).toEqual([name, entry.name, true]);
        }
      }
    }
  });

  test('builds the fill template, the debug view and the sampling helpers', async () => {
    const { device, vt } = await create();
    vt.update(1);
    const fill = vt.createFillProgram('fill', null, (scope, level, texel) => {
      const pb = scope.$builder;
      return [pb.vec4(pb.fract(pb.mul(texel, 1 / 128)), pb.float(level), 1)];
    });
    expect(fill.getShaderSource('compute')).toContain('textureStore');
    vt.fill(fill, device.createBindGroup(fill.bindGroupLayouts[0]));
    expect(vt.renderDebugTexture(3)).toBeTruthy();

    const render = device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.pos = pb.vec2().attrib('position');
        this.$outputs.uv = pb.vec2();
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
          this.$outputs.uv = this.$inputs.pos;
        });
      },
      fragment(pb) {
        vt.declareBindings(this, 0);
        this.atlas = pb.tex2D().uniform(0);
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.$l.level = vt.computeLevel(this, this.$inputs.uv);
          vt.request(this, pb.uint(this.level), this.$inputs.uv);
          this.$l.loc = vt.resolve(this, pb.uint(this.level), this.$inputs.uv);
          this.$outputs.color = pb.textureSampleLevel(this.atlas, this.loc.xy, 0);
        });
      }
    });
    expect(render).toBeTruthy();
    const fs = render!.getShaderSource('fragment')!;
    expect(fs).toContain('zVT_resolve');
    expect(fs).toContain('atomicAdd');
  });
});
