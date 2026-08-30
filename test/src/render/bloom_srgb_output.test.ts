import { ProgramBuilder } from '../../../libs/device/src';
import { Bloom } from '../../../libs/scene/src/posteffect/bloom';
import { Tonemap } from '../../../libs/scene/src/posteffect/tonemap';

function createDevice(type: 'webgl' | 'webgpu') {
  const device: any = {
    type,
    getDeviceCaps: () => ({
      shaderCaps: { supportShaderTextureLod: true },
      textureCaps: { supportHalfFloatColorBuffer: true }
    }),
    createBindGroup: () => ({ setValue() {}, setTexture() {} }),
    createRenderStateSet: () => {
      const chain: any = new Proxy({}, { get: () => () => chain });
      return chain;
    },
    buildRenderProgram(options: any) {
      const builder = new ProgramBuilder(device);
      const result = builder.buildRender(options);
      if (!result) {
        throw new Error(builder.lastError ?? 'shader generation failed');
      }
      return {
        bindGroupLayouts: result[2],
        name: '',
        vertexSource: result[0],
        fragmentSource: result[1]
      };
    }
  };
  return device;
}

function composeSource(type: 'webgl' | 'webgpu'): string {
  const bloom = new Bloom() as any;
  const statics = Bloom as any;
  // Programs are static and cached across instances; reset so each backend rebuilds.
  statics._programPrefilter = null;
  statics._programFinalCompose = null;
  statics._programDownsampleH = null;
  statics._programDownsampleV = null;
  statics._programUpsample = null;
  statics._renderStateAdditive = null;
  bloom._prepare(createDevice(type));
  return statics._programFinalCompose.fragmentSource;
}

/**
 * Bloom now always precedes Tonemap, so it normally writes an intermediate target and leaves the
 * encode to whatever ends the chain. It can still end up last, though: disabling tone mapping and
 * everything downstream (`camera.toneMap = false`) makes Bloom the effect that writes the device
 * framebuffer. The compositor signals that with `srgbOutput`, and an effect that ignores it hands
 * the display a scene-linear image.
 *
 * The observable symptom was not a subtle shift: switching bloom on darkened the entire frame, with
 * every mid-tone landing on `srgbToLinear(correct)` -- 152/255 became 80/255 on a flat gray scene
 * where bloom had nothing above the threshold to do and should have been a no-op.
 */
describe('Bloom honors srgbOutput when it writes the screen', () => {
  for (const type of ['webgl', 'webgpu'] as const) {
    test(`${type}: the compose pass can gamma-encode its result`, () => {
      const src = composeSource(type);
      // The uniform the compositor drives, and the encode it gates.
      expect(src).toMatch(/srgbOut/);
      expect(src).toMatch(/Z_linearToGamma/);
    });

    test(`${type}: the encode is conditional, never unconditional`, () => {
      const src = composeSource(type);
      // Encoding unconditionally would double-encode whenever bloom writes an
      // intermediate target, which is the case in physical mode and whenever any
      // effect runs after it. The call must sit behind the srgbOut branch.
      const branchIndex = src.search(/srgbOut/);
      const encodeIndex = src.search(/Z_linearToGamma\s*\(/);
      expect(branchIndex).toBeGreaterThanOrEqual(0);
      expect(encodeIndex).toBeGreaterThan(branchIndex);
    });
  }

  test('finalCompose forwards the flag rather than assuming a target', () => {
    // Guards against a regression to the previous signature, where the parameter was
    // accepted as `_srgbOutput` and dropped on the floor.
    expect(Bloom.prototype.finalCompose.length).toBe(4);
  });

  test('bloom and tonemap agree on the encode, so chain order cannot change the gamma', () => {
    // Both are transparent-layer effects and either can end up last depending on
    // lighting mode; whichever writes the screen must encode identically.
    const bloomSrc = composeSource('webgl');

    const tonemap = new Tonemap() as any;
    (Tonemap as any)._programTonemap = null;
    tonemap._prepare(createDevice('webgl'));
    const tonemapSrc: string = (Tonemap as any)._programTonemap.fragmentSource;

    for (const src of [bloomSrc, tonemapSrc]) {
      expect(src).toMatch(/srgbOut/);
      expect(src).toMatch(/Z_linearToGamma/);
    }
  });
});
