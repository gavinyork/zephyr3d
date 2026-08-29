import { Vector4 } from '@zephyr3d/base';
import type { AbstractDevice, PBStructTypeInfo } from '@zephyr3d/device';
import { PBPrimitiveType, PBPrimitiveTypeInfo, PBStructTypeInfo as StructTypeInfo } from '@zephyr3d/device';
import type { NullDevice, NullTexture2D } from '@zephyr3d/backend-null';
import { backendNull, createNullDevice } from '@zephyr3d/backend-null';

// The null device must be usable anywhere an AbstractDevice is expected,
// otherwise it cannot stand in for a real backend in tests.
function useAsAbstractDevice(device: AbstractDevice) {
  return device.type;
}

describe('NullDevice basics', () => {
  test('reports the emulated device type and its capabilities', async () => {
    const gl2 = await createNullDevice();
    expect(gl2.type).toBe('webgl2');
    expect(gl2.getDeviceCaps().miscCaps.support32BitIndex).toBe(true);
    expect(gl2.getDeviceCaps().miscCaps.supportDrawIndirect).toBe(false);
    expect(gl2.getDeviceCaps().shaderCaps.supportShaderF16).toBe(false);

    const gl1 = await createNullDevice({ type: 'webgl' });
    expect(gl1.type).toBe('webgl');
    expect(gl1.getDeviceCaps().miscCaps.support32BitIndex).toBe(false);
    expect(gl1.getDeviceCaps().framebufferCaps.maxDrawBuffers).toBe(1);
    expect(gl1.getDeviceCaps().textureCaps.support3DTexture).toBe(false);

    const webgpu = await createNullDevice({ type: 'webgpu' });
    expect(webgpu.type).toBe('webgpu');
    expect(webgpu.getDeviceCaps().miscCaps.supportDrawIndirect).toBe(true);
    expect(webgpu.getDeviceCaps().shaderCaps.supportShaderF16).toBe(true);
    expect(webgpu.clipSpaceZeroToOne).toBe(true);
  });

  test('capability overrides win over the type defaults', async () => {
    const device = await createNullDevice({
      type: 'webgpu',
      caps: {
        shaderCaps: { supportShaderF16: false },
        miscCaps: { supportTimestampQuery: true },
        textureCaps: { maxTextureSize: 2048 }
      }
    });
    expect(device.getDeviceCaps().shaderCaps.supportShaderF16).toBe(false);
    expect(device.getDeviceCaps().miscCaps.supportTimestampQuery).toBe(true);
    expect(device.getDeviceCaps().textureCaps.maxTextureSize).toBe(2048);
    // Untouched capabilities keep the webgpu defaults
    expect(device.getDeviceCaps().miscCaps.supportDrawIndirect).toBe(true);
  });

  test('satisfies AbstractDevice and works through the backend interface', async () => {
    const device = await createNullDevice();
    expect(useAsAbstractDevice(device as unknown as AbstractDevice)).toBe('webgl2');
    expect(backendNull.typeName()).toBe('null');
    await expect(backendNull.supported()).resolves.toBe(true);
    const fromBackend = await backendNull.createDevice(null, {
      width: 64,
      height: 32
    });
    expect(fromBackend).not.toBeNull();
    expect(fromBackend!.getBackBufferWidth()).toBe(64);
    expect(fromBackend!.getBackBufferHeight()).toBe(32);
  });

  test('back buffer size comes from the creation options', async () => {
    const device = await createNullDevice({ width: 320, height: 240 });
    expect(device.getBackBufferWidth()).toBe(320);
    expect(device.getBackBufferHeight()).toBe(240);
    expect(device.getDrawingBufferWidth()).toBe(320);
    expect(device.getViewport()).toEqual({ x: 0, y: 0, width: 320, height: 240, default: true });
  });
});

describe('NullDevice frames and command recording', () => {
  let device: NullDevice;
  beforeEach(async () => {
    device = await createNullDevice({ width: 64, height: 64 });
  });

  test('begin/end frame advances the frame counter and records commands', () => {
    expect(device.beginFrame()).toBe(true);
    device.endFrame();
    expect(device.frameInfo.frameCounter).toBe(1);
    expect(device.getCommandCount('beginFrame')).toBe(1);
    expect(device.getCommandCount('endFrame')).toBe(1);
  });

  test('clear and draw calls are recorded with the current framebuffer', () => {
    const color = device.createTexture2D('rgba8unorm', 64, 64, { mipmapping: false })!;
    const fb = device.createFrameBuffer([color], null);
    device.beginFrame();
    device.setFramebuffer(fb);
    device.clearFrameBuffer(new Vector4(1, 0, 0, 1), 1, 0);
    device.draw('triangle-list', 0, 3);
    device.drawInstanced('triangle-list', 0, 3, 4);
    device.endFrame();

    const setFb = device.getCommands('setFramebuffer');
    expect(setFb).toHaveLength(1);
    expect(setFb[0].framebuffer).toBe(fb);

    const clears = device.getCommands('clear');
    expect(clears).toHaveLength(1);
    expect(clears[0].framebuffer).toBe(fb);
    expect(clears[0].depth).toBe(1);
    expect(clears[0].stencil).toBe(0);

    const draws = device.getCommands('draw');
    expect(draws).toHaveLength(2);
    expect(draws[0]).toMatchObject({ primitiveType: 'triangle-list', count: 3, numInstances: 0 });
    expect(draws[1]).toMatchObject({ count: 3, numInstances: 4 });
    expect(device.frameInfo.drawCalls).toBe(2);
  });

  test('clearCommands() empties the log', () => {
    device.beginFrame();
    device.endFrame();
    expect(device.commands.length).toBeGreaterThan(0);
    device.clearCommands();
    expect(device.commands.length).toBe(0);
  });

  test('recording can be disabled', async () => {
    const quiet = await createNullDevice({ recordCommands: false });
    quiet.beginFrame();
    quiet.draw('triangle-list', 0, 3);
    quiet.endFrame();
    expect(quiet.commands.length).toBe(0);
    // Frame statistics are still tracked
    expect(quiet.frameInfo.drawCalls).toBe(1);
  });

  test('the command log is capped', async () => {
    const capped = await createNullDevice({ maxCommandLogSize: 4 });
    for (let i = 0; i < 10; i++) {
      capped.draw('triangle-list', 0, i);
    }
    expect(capped.commands.length).toBe(4);
    // The oldest commands are dropped first
    expect(capped.getCommands('draw').map((cmd) => cmd.count)).toEqual([6, 7, 8, 9]);
  });

  test('indirect draws honor the device capabilities', async () => {
    const webgl2 = await createNullDevice({ type: 'webgl2' });
    const buffer = webgl2.createBuffer(64, { usage: 'indirect' });
    expect(() => webgl2.drawIndirect('triangle-list', buffer, 0)).toThrow(/indirect draw/);

    const webgpu = await createNullDevice({ type: 'webgpu' });
    const indirect = webgpu.createBuffer(64, { usage: 'indirect' });
    webgpu.drawIndirect('triangle-list', indirect, 4);
    webgpu.drawIndexedIndirect('triangle-list', indirect, 8);
    const cmds = webgpu.getCommands('drawIndirect');
    expect(cmds).toHaveLength(2);
    expect(cmds[0]).toMatchObject({ indexed: false, indirectOffset: 4 });
    expect(cmds[1]).toMatchObject({ indexed: true, indirectOffset: 8 });
  });

  test('compute is rejected unless the device emulates webgpu', async () => {
    const webgl2 = await createNullDevice({ type: 'webgl2' });
    expect(() => webgl2.compute(1, 1, 1)).toThrow(/compute shader/);

    const webgpu = await createNullDevice({ type: 'webgpu' });
    webgpu.compute(2, 3, 4);
    expect(webgpu.getCommands('compute')[0].workgroupCount).toEqual([2, 3, 4]);
    expect(webgpu.frameInfo.computeCalls).toBe(1);
  });
});

describe('NullDevice buffers', () => {
  let device: NullDevice;
  beforeEach(async () => {
    device = await createNullDevice();
  });

  test('buffer writes are observable through getBufferSubData()', async () => {
    const buffer = device.createBuffer(16, { usage: 'vertex' });
    buffer.bufferSubData(4, new Uint8Array([1, 2, 3, 4]));
    const data = await buffer.getBufferSubData();
    expect(Array.from(data)).toEqual([0, 0, 0, 0, 1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  test('out of range writes are rejected', () => {
    const buffer = device.createBuffer(8, { usage: 'vertex' });
    expect(() => buffer.bufferSubData(6, new Uint8Array([1, 2, 3, 4]))).toThrow(/dest buffer is too small/);
  });

  test('copyBuffer() copies through system memory', async () => {
    const src = device.createBuffer(8, { usage: 'vertex' });
    const dst = device.createBuffer(8, { usage: 'vertex' });
    src.bufferSubData(0, new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]));
    device.copyBuffer(src, dst, 2, 0, 4);
    expect(Array.from(await dst.getBufferSubData())).toEqual([7, 6, 5, 4, 0, 0, 0, 0]);
  });

  test('index buffers report their index type and length', () => {
    const short = device.createIndexBuffer(new Uint16Array([0, 1, 2]));
    expect(short.length).toBe(3);
    expect(short.indexType).toBe(PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16));
    const long = device.createIndexBuffer(new Uint32Array([0, 1, 2, 3]));
    expect(long.length).toBe(4);
    expect(long.indexType).toBe(PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32));
  });

  test('structured buffers round-trip member values', async () => {
    const structure = new StructTypeInfo('Test', 'default', [
      { name: 'value', type: PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32VEC4) }
    ]) as unknown as PBStructTypeInfo;
    const buffer = device.createStructuredBuffer(structure, { usage: 'uniform' });
    buffer.set('value', new Float32Array([1, 2, 3, 4]));
    const data = await buffer.getBufferSubData();
    expect(Array.from(new Float32Array(data.buffer, data.byteOffset, 4))).toEqual([1, 2, 3, 4]);
  });

  test('video memory usage tracks buffer allocation and disposal', () => {
    const before = device.videoMemoryUsage;
    const buffer = device.createBuffer(1024, { usage: 'vertex' });
    expect(device.videoMemoryUsage).toBe(before + 1024);
    buffer.dispose();
    buffer.destroy();
    expect(device.videoMemoryUsage).toBe(before);
  });
});

describe('NullDevice textures', () => {
  let device: NullDevice;
  beforeEach(async () => {
    device = await createNullDevice();
  });

  test('2D textures derive a full mip chain and report memory cost', () => {
    const tex = device.createTexture2D('rgba8unorm', 8, 8)!;
    expect(tex.width).toBe(8);
    expect(tex.height).toBe(8);
    expect(tex.mipLevelCount).toBe(4);
    // 64 + 16 + 4 + 1 texels at 4 bytes each
    expect(tex.memCost).toBe((64 + 16 + 4 + 1) * 4);
    expect(tex.isTexture2D()).toBe(true);
    expect(tex.isDepth()).toBe(false);
  });

  test('mipmapping can be disabled', () => {
    const tex = device.createTexture2D('rgba8unorm', 8, 8, { mipmapping: false })!;
    expect(tex.mipLevelCount).toBe(1);
  });

  test('depth textures never have mipmaps', () => {
    const tex = device.createTexture2D('d24s8', 16, 16)!;
    expect(tex.mipLevelCount).toBe(1);
    expect(tex.isDepth()).toBe(true);
  });

  test('texture writes can be read back', async () => {
    const tex = device.createTexture2D('rgba8unorm', 4, 4, { mipmapping: false })! as NullTexture2D;
    const pixels = new Uint8Array(2 * 2 * 4).fill(0);
    pixels[0] = 255;
    pixels[7] = 128;
    tex.update(pixels, 1, 1, 2, 2);
    const out = new Uint8Array(2 * 2 * 4);
    await tex.readPixels(1, 1, 2, 2, 0, 0, out);
    expect(out[0]).toBe(255);
    expect(out[7]).toBe(128);
    // Pixels outside the written region stay zero
    const outside = new Uint8Array(4);
    await tex.readPixels(0, 0, 1, 1, 0, 0, outside);
    expect(Array.from(outside)).toEqual([0, 0, 0, 0]);
  });

  test('generateMipmaps() is recorded and counted', () => {
    const tex = device.createTexture2D('rgba8unorm', 8, 8)! as NullTexture2D;
    device.clearCommands();
    tex.generateMipmaps();
    expect(tex.mipmapsGenerated).toBe(1);
    expect(device.getCommands('generateMipmaps')[0].texture).toBe(tex);
  });

  test('cube and array textures keep per-face and per-layer data', async () => {
    const cube = device.createCubeTexture('rgba8unorm', 4, { mipmapping: false })!;
    cube.update(new Uint8Array([1, 2, 3, 4]), 0, 0, 1, 1, 2);
    const face = new Uint8Array(4);
    await cube.readPixels(0, 0, 1, 1, 2, 0, face);
    expect(Array.from(face)).toEqual([1, 2, 3, 4]);
    const otherFace = new Uint8Array(4);
    await cube.readPixels(0, 0, 1, 1, 0, 0, otherFace);
    expect(Array.from(otherFace)).toEqual([0, 0, 0, 0]);

    const array = device.createTexture2DArray('rgba8unorm', 4, 4, 3, { mipmapping: false })!;
    array.update(new Uint8Array([5, 6, 7, 8]), 0, 0, 1, 1, 1, 1);
    const layer = new Uint8Array(4);
    await array.readPixels(0, 0, 1, 1, 1, 0, layer);
    expect(Array.from(layer)).toEqual([5, 6, 7, 8]);
  });

  test('3D textures are rejected when the device emulates webgl1', async () => {
    const webgl1 = await createNullDevice({ type: 'webgl' });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(webgl1.createTexture3D('rgba8unorm', 4, 4, 4)).toBeNull();
    spy.mockRestore();
  });

  test('copyTexture2D() copies level content', async () => {
    const src = device.createTexture2D('rgba8unorm', 4, 4, { mipmapping: false })!;
    const dst = device.createTexture2D('rgba8unorm', 4, 4, { mipmapping: false })!;
    src.update(new Uint8Array([10, 20, 30, 40]), 0, 0, 1, 1);
    device.copyTexture2D(src, 0, dst, 0);
    const out = new Uint8Array(4);
    await dst.readPixels(0, 0, 1, 1, 0, 0, out);
    expect(Array.from(out)).toEqual([10, 20, 30, 40]);
    expect(device.getCommands('copyTexture')).toHaveLength(1);
  });
});

describe('NullDevice framebuffers', () => {
  let device: NullDevice;
  beforeEach(async () => {
    device = await createNullDevice({ width: 64, height: 64 });
  });

  test('reports size, attachments and sample count', () => {
    const color = device.createTexture2D('rgba8unorm', 32, 32, { mipmapping: false })!;
    const depth = device.createTexture2D('d24s8', 32, 32)!;
    const fb = device.createFrameBuffer([color], depth);
    expect(fb.getWidth()).toBe(32);
    expect(fb.getHeight()).toBe(32);
    expect(fb.getSampleCount()).toBe(1);
    expect(fb.getColorAttachments()).toEqual([color]);
    expect(fb.getColorAttachment(0)).toBe(color);
    expect(fb.getDepthAttachment()).toBe(depth);
    expect(fb.isFramebuffer()).toBe(true);
  });

  test('mismatched attachment sizes are rejected', () => {
    const a = device.createTexture2D('rgba8unorm', 32, 32, { mipmapping: false })!;
    const b = device.createTexture2D('rgba8unorm', 16, 16, { mipmapping: false })!;
    expect(() => device.createFrameBuffer([a, b], null)).toThrow(/same width and height/);
  });

  test('an empty framebuffer is rejected', () => {
    expect(() => device.createFrameBuffer([], null)).toThrow(/must be specified/);
  });

  test('setting the framebuffer resets the viewport to the attachment size', () => {
    const color = device.createTexture2D('rgba8unorm', 16, 16, { mipmapping: false })!;
    const fb = device.createFrameBuffer([color], null);
    device.setFramebuffer(fb);
    expect(device.getFramebuffer()).toBe(fb);
    expect(device.getDrawingBufferWidth()).toBe(16);
    expect(device.getViewport()).toEqual({ x: 0, y: 0, width: 16, height: 16, default: true });
    device.setFramebuffer(null);
    expect(device.getFramebuffer()).toBeNull();
    expect(device.getDrawingBufferWidth()).toBe(64);
  });

  test('unbinding regenerates mipmaps of color attachments that were drawn to', () => {
    const color = device.createTexture2D('rgba8unorm', 16, 16)! as NullTexture2D;
    const fb = device.createFrameBuffer([color], null);
    device.setFramebuffer(fb);
    const before = color.mipmapsGenerated;
    device.draw('triangle-list', 0, 3);
    device.setFramebuffer(null);
    expect(color.mipmapsGenerated).toBe(before + 1);
  });

  test('mip level and layer selection is remembered', () => {
    const color = device.createTexture2D('rgba8unorm', 16, 16)!;
    const fb = device.createFrameBuffer([color], null);
    fb.setColorAttachmentMipLevel(0, 2);
    fb.setColorAttachmentGenerateMipmaps(0, false);
    fb.setColorAttachmentLayer(0, 3);
    expect(fb.getColorAttachmentMipLevel(0)).toBe(2);
    expect(fb.getColorAttachmentGenerateMipmaps(0)).toBe(false);
    expect(fb.getColorAttachmentLayer(0)).toBe(3);
    // Width follows the selected mip level
    expect(fb.getWidth()).toBe(4);
  });

  test('multisampling is unavailable when emulating webgl1', async () => {
    const webgl1 = await createNullDevice({ type: 'webgl' });
    const color = webgl1.createTexture2D('rgba8unorm', 16, 16, { mipmapping: false })!;
    // The sample count request is clamped instead of throwing, matching the webgl backend
    const fb = webgl1.createFrameBuffer([color], null, { sampleCount: 4 });
    expect(fb.getSampleCount()).toBe(1);
  });

  test('readPixels() reads the bound color attachment', async () => {
    const color = device.createTexture2D('rgba8unorm', 4, 4, { mipmapping: false })!;
    color.update(new Uint8Array([1, 2, 3, 4]), 0, 0, 1, 1);
    const fb = device.createFrameBuffer([color], null);
    device.setFramebuffer(fb);
    const out = new Uint8Array(4);
    await device.readPixels(0, 0, 0, 1, 1, out);
    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
    expect(device.getCommands('readPixels')).toHaveLength(1);
  });
});

describe('NullDevice programs and bind groups', () => {
  let device: NullDevice;
  beforeEach(async () => {
    device = await createNullDevice();
  });

  test('programs keep their shader sources and never fail to compile', () => {
    const program = device.createGPUProgram({
      type: 'render',
      label: 'test-program',
      params: {
        vs: 'VS SOURCE',
        fs: 'FS SOURCE',
        bindGroupLayouts: [],
        vertexAttributes: []
      }
    });
    expect(program.type).toBe('render');
    expect(program.name).toBe('test-program');
    expect(program.getShaderSource('vertex')).toBe('VS SOURCE');
    expect(program.getShaderSource('fragment')).toBe('FS SOURCE');
    expect(program.getCompileError()).toBeNull();
  });

  test('bind group resources are observable', () => {
    const structure = new StructTypeInfo('U', 'std140', [
      { name: 'color', type: PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32VEC4) }
    ]);
    const bindGroup = device.createBindGroup({
      // The program builder emits a nameMap that routes uniform names to the
      // buffer entry holding them.
      nameMap: { color: 'u' },
      entries: [
        {
          binding: 0,
          name: 'u',
          visibility: 1,
          type: structure as unknown as PBStructTypeInfo,
          buffer: {
            type: 'uniform',
            hasDynamicOffset: false,
            uniformLayout: structure.toBufferLayout(0, structure.layout)!,
            dynamicOffsetIndex: 0
          }
        },
        {
          binding: 1,
          name: 'tex',
          visibility: 2,
          type: structure as unknown as PBStructTypeInfo,
          texture: {
            sampleType: 'float',
            viewDimension: '2d',
            multisampled: false,
            autoBindSampler: 'sample',
            autoBindSamplerComparison: null
          }
        }
      ]
    });
    const version = bindGroup.getVersion();
    const texture = device.createTexture2D('rgba8unorm', 4, 4, { mipmapping: false })!;
    bindGroup.setTexture('tex', texture);
    expect(bindGroup.getTexture('tex')).toBe(texture);
    expect(bindGroup.getTextureBinding('tex')?.sampler).not.toBeNull();
    // Changing a resource invalidates the bind group
    expect(bindGroup.getVersion()).not.toBe(version);

    // A uniform buffer is created on demand and written through setValue()
    bindGroup.setValue('color', new Float32Array([1, 0, 0, 1]));
    const buffer = bindGroup.getBuffer('u');
    expect(buffer).not.toBeNull();
    expect(buffer!.byteLength).toBeGreaterThanOrEqual(16);
  });

  test('drawing without a required bind group reports an error', () => {
    const program = device.createGPUProgram({
      type: 'render',
      params: {
        vs: '',
        fs: '',
        bindGroupLayouts: [{ entries: [] }],
        vertexAttributes: []
      }
    });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    device.setProgram(program);
    device.draw('triangle-list', 0, 3);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Missing bind group'));
    spy.mockRestore();
    // The draw was aborted, so nothing was recorded
    expect(device.getCommandCount('draw')).toBe(0);
  });

  test('strict mode turns reported errors into exceptions', async () => {
    const strict = await createNullDevice({ strict: true });
    const program = strict.createGPUProgram({
      type: 'render',
      params: { vs: '', fs: '', bindGroupLayouts: [{ entries: [] }], vertexAttributes: [] }
    });
    strict.setProgram(program);
    expect(() => strict.draw('triangle-list', 0, 3)).toThrow(/Missing bind group/);
  });
});

describe('NullDevice state and render bundles', () => {
  let device: NullDevice;
  beforeEach(async () => {
    device = await createNullDevice({ width: 64, height: 64 });
  });

  test('push/popDeviceStates() restores the full device state', () => {
    const color = device.createTexture2D('rgba8unorm', 16, 16, { mipmapping: false })!;
    const fb = device.createFrameBuffer([color], null);
    const stateSet = device.createRenderStateSet();
    device.setFramebuffer(fb);
    device.setViewport([1, 2, 3, 4]);
    device.setRenderStates(stateSet);
    device.reverseVertexWindingOrder(true);

    device.pushDeviceStates();
    device.setFramebuffer(null);
    device.setViewport([5, 6, 7, 8]);
    device.setRenderStates(null);
    device.reverseVertexWindingOrder(false);
    device.popDeviceStates();

    expect(device.getFramebuffer()).toBe(fb);
    expect(device.getViewport()).toMatchObject({ x: 1, y: 2, width: 3, height: 4 });
    expect(device.getRenderStates()).toBe(stateSet);
    expect(device.isWindingOrderReversed()).toBe(true);
  });

  test('render state sets are applied on draw', () => {
    const stateSet = device.createRenderStateSet();
    stateSet.useDepthState().enableTest(false);
    device.setRenderStates(stateSet);
    device.draw('triangle-list', 0, 3);
    device.draw('triangle-list', 0, 3);
    expect((stateSet as unknown as { applyCount: number }).applyCount).toBe(2);
    expect(stateSet.depthState!.testEnabled).toBe(false);
  });

  test('captured render bundles replay their draw calls', () => {
    device.beginCapture();
    device.draw('triangle-list', 0, 3);
    device.drawInstanced('line-list', 1, 2, 5);
    const bundle = device.endCapture();
    device.clearCommands();
    device.executeRenderBundle(bundle);
    const draws = device.getCommands('draw');
    expect(draws).toHaveLength(2);
    expect(draws[0]).toMatchObject({ primitiveType: 'triangle-list', first: 0, count: 3, numInstances: 0 });
    expect(draws[1]).toMatchObject({ primitiveType: 'line-list', first: 1, count: 2, numInstances: 5 });
  });

  test('nested captures are rejected', () => {
    device.beginCapture();
    expect(() => device.beginCapture()).toThrow(/already capturing/);
    device.endCapture();
    expect(() => device.endCapture()).toThrow(/not capturing/);
  });
});

describe('NullDevice context loss', () => {
  test('losing and restoring the context invalidates and reloads objects', async () => {
    const device = await createNullDevice();
    const lost: string[] = [];
    device.on('devicelost', () => {
      lost.push('lost');
    });
    device.on('devicerestored', () => {
      lost.push('restored');
    });
    const texture = device.createTexture2D('rgba8unorm', 8, 8, { mipmapping: false })!;

    device.looseContext();
    expect(device.isContextLost()).toBe(true);
    // Matching the WebGL backend, losing the context drops the native handles
    // of all GPU objects while leaving the objects themselves alive.
    expect(texture.object).toBeNull();
    expect(device.beginFrame()).toBe(false);

    device.restoreContext();
    expect(device.isContextLost()).toBe(false);
    expect(lost).toEqual(['lost', 'restored']);
    expect(device.beginFrame()).toBe(true);
    device.endFrame();
    texture.restore();
    expect(texture.object).not.toBeNull();
  });
});

describe('NullDevice resource pool integration', () => {
  test('the device pool reuses textures and framebuffers', async () => {
    const device = await createNullDevice();
    const pool = device.pool;
    const tex = pool.fetchTemporalTexture2D(false, 'rgba8unorm', 32, 32);
    expect(pool.hasTexture(tex)).toBe(true);
    pool.releaseTexture(tex);
    const again = pool.fetchTemporalTexture2D(false, 'rgba8unorm', 32, 32);
    expect(again).toBe(tex);

    const fb = pool.fetchTemporalFramebuffer(false, 32, 32, 'rgba8unorm', 'd24s8');
    expect(fb.getWidth()).toBe(32);
    expect(fb.getColorAttachments()).toHaveLength(1);
    expect(fb.getDepthAttachment()).not.toBeNull();
    pool.releaseFrameBuffer(fb);
    const fbAgain = pool.fetchTemporalFramebuffer(false, 32, 32, 'rgba8unorm', 'd24s8');
    expect(fbAgain).toBe(fb);
    pool.releaseFrameBuffer(fbAgain);
    pool.releaseTexture(again);
    pool.purge();
  });

  test('setFramebuffer() with attachments allocates a temporal framebuffer', async () => {
    const device = await createNullDevice();
    const color = device.createTexture2D('rgba8unorm', 16, 16, { mipmapping: false })!;
    device.setFramebuffer([color]);
    const fb = device.getFramebuffer();
    expect(fb).not.toBeNull();
    expect(fb!.getColorAttachment(0)).toBe(color);
    device.setFramebuffer(null);
    expect(device.getFramebuffer()).toBeNull();
  });
});

describe('NullDevice shader generation', () => {
  test('the emulated type selects the shader language', async () => {
    const webgl2 = await createNullDevice({ type: 'webgl2' });
    const glsl = webgl2.buildRenderProgram({
      vertex(pb) {
        this.$outputs.dummy = pb.vec4().tag('dummy');
        pb.main(function () {
          this.$outputs.dummy = pb.vec4(1);
          this.$builtins.position = pb.vec4(0, 0, 0, 1);
        });
      },
      fragment(pb) {
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.$outputs.color = this.$inputs.dummy;
        });
      }
    });
    expect(glsl).not.toBeNull();
    expect(glsl!.getShaderSource('vertex')).toContain('#version 300 es');

    const webgpu = await createNullDevice({ type: 'webgpu' });
    const wgsl = webgpu.buildRenderProgram({
      vertex(pb) {
        this.$outputs.dummy = pb.vec4().tag('dummy');
        pb.main(function () {
          this.$outputs.dummy = pb.vec4(1);
          this.$builtins.position = pb.vec4(0, 0, 0, 1);
        });
      },
      fragment(pb) {
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.$outputs.color = this.$inputs.dummy;
        });
      }
    });
    expect(wgsl).not.toBeNull();
    expect(wgsl!.getShaderSource('vertex')).toContain('@vertex');
  });
});
