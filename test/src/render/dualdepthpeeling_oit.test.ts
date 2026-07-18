import type { BlendEquation, BlendFunc, DeviceCaps, RenderStateSet } from '@zephyr3d/device';
import { DualDepthPeelingOIT } from '../../../libs/scene/src';

class FakeBlendingState {
  enabled = false;
  alphaToCoverageEnabled = false;
  srcBlendRGB: BlendFunc = 'one';
  dstBlendRGB: BlendFunc = 'zero';
  srcBlendAlpha: BlendFunc = 'one';
  dstBlendAlpha: BlendFunc = 'zero';
  rgbEquation: BlendEquation = 'add';
  alphaEquation: BlendEquation = 'add';

  enable(value: boolean) {
    this.enabled = value;
    return this;
  }

  enableAlphaToCoverage(value: boolean) {
    this.alphaToCoverageEnabled = value;
    return this;
  }

  setBlendFunc(src: BlendFunc, dest: BlendFunc) {
    this.srcBlendRGB = src;
    this.dstBlendRGB = dest;
    this.srcBlendAlpha = src;
    this.dstBlendAlpha = dest;
    return this;
  }

  setBlendFuncRGB(src: BlendFunc, dest: BlendFunc) {
    this.srcBlendRGB = src;
    this.dstBlendRGB = dest;
    return this;
  }

  setBlendFuncAlpha(src: BlendFunc, dest: BlendFunc) {
    this.srcBlendAlpha = src;
    this.dstBlendAlpha = dest;
    return this;
  }

  setBlendEquation(rgb: BlendEquation, alpha: BlendEquation) {
    this.rgbEquation = rgb;
    this.alphaEquation = alpha;
    return this;
  }
}

class FakeDepthState {
  testEnabled = true;
  writeEnabled = true;

  enableTest(value: boolean) {
    this.testEnabled = value;
    return this;
  }

  enableWrite(value: boolean) {
    this.writeEnabled = value;
    return this;
  }
}

function createCaps(overrides: Partial<DeviceCaps> = {}): DeviceCaps {
  return {
    framebufferCaps: {
      maxDrawBuffers: 4,
      supportPerTargetBlending: true,
      supportRenderMipmap: true,
      supportMultisampledFramebuffer: true,
      supportFloatBlending: true,
      supportDepth32float: true,
      supportDepth32floatStencil8: true,
      maxColorAttachmentBytesPerSample: 32
    },
    textureCaps: {
      supportHalfFloatColorBuffer: true,
      supportFloatColorBuffer: true,
      supportFloatBlending: true
    },
    shaderCaps: {
      maxUniformBufferSize: 16384
    },
    miscCaps: {
      supportBlendMinMax: true
    },
    ...overrides
  } as DeviceCaps;
}

describe('DualDepthPeelingOIT', () => {
  test('gates support on required framebuffer and shader capabilities', () => {
    expect(DualDepthPeelingOIT.supportDeviceCaps('webgpu', createCaps())).toBe(true);
    expect(
      DualDepthPeelingOIT.supportDeviceCaps(
        'webgpu',
        createCaps({
          framebufferCaps: { ...createCaps().framebufferCaps, supportPerTargetBlending: false }
        })
      )
    ).toBe(false);
    expect(
      DualDepthPeelingOIT.supportDeviceCaps(
        'webgpu',
        createCaps({ framebufferCaps: { ...createCaps().framebufferCaps, maxDrawBuffers: 2 } })
      )
    ).toBe(false);
    expect(
      DualDepthPeelingOIT.supportDeviceCaps(
        'webgpu',
        createCaps({
          framebufferCaps: { ...createCaps().framebufferCaps, maxColorAttachmentBytesPerSample: 16 }
        })
      )
    ).toBe(false);
    expect(
      DualDepthPeelingOIT.supportDeviceCaps(
        'webgpu',
        createCaps({ miscCaps: { ...createCaps().miscCaps, supportBlendMinMax: false } })
      )
    ).toBe(false);
    expect(
      DualDepthPeelingOIT.supportDeviceCaps(
        'webgpu',
        createCaps({ textureCaps: { ...createCaps().textureCaps, supportFloatBlending: false } })
      )
    ).toBe(false);
    expect(
      DualDepthPeelingOIT.supportDeviceCaps(
        'webgpu',
        createCaps({ textureCaps: { ...createCaps().textureCaps, supportFloatColorBuffer: false } })
      )
    ).toBe(false);
    expect(
      DualDepthPeelingOIT.supportDeviceCaps(
        'webgl',
        createCaps({ shaderCaps: { ...createCaps().shaderCaps, maxUniformBufferSize: 0 } })
      )
    ).toBe(false);
  });

  test('sets per-target blend states for depth, front and back targets', () => {
    const globalBlend = new FakeBlendingState();
    const depthState = new FakeDepthState();
    const targetBlendStates: FakeBlendingState[] = [];
    const renderStates = {
      useBlendingState: () => globalBlend,
      useDepthState: () => depthState,
      useTargetBlendingState: (index: number) =>
        (targetBlendStates[index] = targetBlendStates[index] ?? new FakeBlendingState())
    } as unknown as RenderStateSet;

    new DualDepthPeelingOIT().setRenderStates(renderStates);

    expect(globalBlend.enabled).toBe(false);
    expect(depthState).toMatchObject({ testEnabled: true, writeEnabled: false });
    expect(targetBlendStates[0]).toMatchObject({
      enabled: true,
      rgbEquation: 'max',
      alphaEquation: 'max',
      srcBlendRGB: 'one',
      dstBlendRGB: 'one',
      srcBlendAlpha: 'one',
      dstBlendAlpha: 'one'
    });
    expect(targetBlendStates[1]).toMatchObject({
      enabled: true,
      rgbEquation: 'add',
      alphaEquation: 'add',
      srcBlendRGB: 'dst-alpha',
      dstBlendRGB: 'one',
      srcBlendAlpha: 'zero',
      dstBlendAlpha: 'inv-src-alpha'
    });
    expect(targetBlendStates[2]).toMatchObject({
      enabled: true,
      rgbEquation: 'add',
      alphaEquation: 'add',
      srcBlendRGB: 'one',
      dstBlendRGB: 'inv-src-alpha',
      srcBlendAlpha: 'one',
      dstBlendAlpha: 'inv-src-alpha'
    });
  });
});
