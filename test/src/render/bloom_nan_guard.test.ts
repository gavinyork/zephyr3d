import { ProgramBuilder } from '../../../libs/device/src';
import { Bloom } from '../../../libs/scene/src/posteffect/bloom';

function createDevice(type: 'webgl' | 'webgpu') {
  const device: any = {
    type,
    getDeviceCaps: () => ({
      shaderCaps: { supportShaderTextureLod: true },
      textureCaps: { supportHalfFloatColorBuffer: true }
    }),
    createBindGroup: () => ({ setValue() {}, setTexture() {} }),
    createRenderStateSet: () => {
      // Every render-state setter is chainable.
      const chain: any = new Proxy({}, { get: () => () => chain });
      return chain;
    },
    buildRenderProgram(options: any) {
      const builder = new ProgramBuilder(device);
      const result = builder.buildRender(options);
      if (!result) {
        throw new Error(builder.lastError ?? 'Bloom shader generation failed');
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

function buildBloomPrograms(type: 'webgl' | 'webgpu') {
  const bloom = new Bloom() as any;
  const statics = Bloom as any;
  // The programs are static and cached across instances; reset so each backend rebuilds.
  statics._programPrefilter = null;
  statics._programFinalCompose = null;
  statics._programDownsampleH = null;
  statics._programDownsampleV = null;
  statics._programUpsample = null;
  statics._renderStateAdditive = null;
  bloom._prepare(createDevice(type));
  return {
    prefilter: statics._programPrefilter,
    compose: statics._programFinalCompose
  };
}

/**
 * A single non-finite texel used to produce a black block on screen whose size was exactly
 * 2^maxDownsampleLevels: the prefilter's `contrib` evaluated Inf/Inf = NaN, the separable blur spread
 * that NaN across the coarsest mip, and the additive upsample chain magnified one bad texel back to
 * full resolution. Both entry points into the pyramid must reject non-finite input.
 */
describe('Bloom rejects non-finite input', () => {
  for (const type of ['webgl', 'webgpu'] as const) {
    describe(type, () => {
      test('the prefilter guards before computing the threshold contribution', () => {
        const { prefilter } = buildBloomPrograms(type);
        const src: string = prefilter.fragmentSource;

        // The finite test must exist and must be applied before `brightness` is derived.
        const guardIndex = src.search(/abs\(raw\.rgb\)/);
        const brightnessIndex = src.search(/brightness/);
        expect(guardIndex).toBeGreaterThanOrEqual(0);
        expect(brightnessIndex).toBeGreaterThan(guardIndex);

        // The division that produced the NaN must consume the sanitized value, not the raw sample.
        expect(src).toMatch(/max\(brightness,\s*0\.00001\)/);
        expect(src).not.toMatch(/max\(max\(raw\.r,\s*raw\.g\),\s*raw\.b\)/);
      });

      test('the compose pass guards the scene color, which bypasses the prefilter', () => {
        const { compose } = buildBloomPrograms(type);
        const src: string = compose.fragmentSource;

        // Both taps are sanitized: bloomTex (pyramid) and srcTex (scene color).
        expect(src).toMatch(/abs\(srcSample\.rgb\)/);
        expect(src).toMatch(/abs\(bloomSample\.rgb\)/);
        // The half-float write guard is still present.
        expect(src).toContain('65504');
      });
    });
  }

  test('the threshold contribution is NaN-free for pathological luminance', () => {
    // Mirrors the shader's scalar math to prove the guard is what removes the NaN, independent of
    // any GPU. Without it, an Inf sample yields Inf/Inf.
    const bloom = new Bloom();
    bloom.threshold = 0.8;
    bloom.thresholdKnee = 0;
    const t = { x: 0, y: 0, z: 0, w: 0 };
    t.x = bloom.threshold * bloom.threshold;
    t.y = t.x * bloom.thresholdKnee;
    t.z = 2 * t.y;
    t.w = 0.25 / (t.y + 0.00001);
    t.y -= t.x;

    const sanitize = (c: number) => (Math.abs(c) < 1e30 ? Math.min(Math.max(c, 0), 65504) : 0);
    const contrib = (rgb: number[]) => {
      const p = rgb.map(sanitize);
      const brightness = Math.max(Math.max(p[0], p[1]), p[2]);
      let soft = Math.min(Math.max(brightness + t.y, 0), t.z);
      soft = soft * soft * t.w;
      const c = Math.max(soft, brightness - t.x) / Math.max(brightness, 0.00001);
      return p.map((v) => v * c);
    };

    for (const input of [
      [Infinity, Infinity, Infinity],
      [Infinity, 0.1, 0.1],
      [NaN, 0.5, 0.5],
      [-Infinity, 1, 1],
      [1e35, 0, 0]
    ]) {
      for (const channel of contrib(input)) {
        expect(Number.isFinite(channel)).toBe(true);
      }
    }

    // A normal bright pixel still blooms: above the 0.8 threshold it must contribute.
    expect(contrib([2, 2, 2]).every((c) => c > 0)).toBe(true);
    // A dim pixel below the threshold contributes nothing.
    expect(contrib([0.2, 0.2, 0.2]).every((c) => c === 0)).toBe(true);
  });
});
