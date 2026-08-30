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

function bloomPrograms(type: 'webgl' | 'webgpu') {
  const bloom = new Bloom() as any;
  const statics = Bloom as any;
  statics._programPrefilter = null;
  statics._programFinalCompose = null;
  statics._programDownsampleH = null;
  statics._programDownsampleV = null;
  statics._programUpsample = null;
  statics._renderStateAdditive = null;
  bloom._prepare(createDevice(type));
  return { upsample: statics._programUpsample, prefilter: statics._programPrefilter };
}

/**
 * Count texture fetches in a generated fragment shader. The builder emits
 * `texture2DLodEXT`/`textureLod` for GLSL and `textureSampleLevel` for WGSL, so match the
 * common `texture...(` prefix rather than any one spelling.
 */
function countSamples(src: string): number {
  return (src.match(/\btexture\w*\s*\(/g) ?? []).length;
}

/**
 * The upsample pass used to be a single bilinear tap. One coarse-level texel then covered a large
 * screen area, so the level's square texel grid survived magnification as axis-aligned blocky
 * banding -- exactly the artifact the Call of Duty: Advanced Warfare presentation replaces with a
 * 3x3 tent filter. The prefilter doubles as the first downsample and carries the Karis average,
 * which keeps one blown-out specular texel from dominating (and flickering in) its 2x2 group.
 */
describe('Bloom pyramid filtering', () => {
  for (const type of ['webgl', 'webgpu'] as const) {
    describe(type, () => {
      test('upsample is a multi-tap tent, not a single bilinear fetch', () => {
        const { upsample } = bloomPrograms(type);
        // 3x3 tent = 9 taps. A bare bilinear upsample had exactly 1.
        expect(countSamples(upsample.fragmentSource)).toBe(9);
      });

      test('the tent is scaled by a configurable radius in source texels', () => {
        const { upsample } = bloomPrograms(type);
        const src: string = upsample.fragmentSource;
        expect(src).toMatch(/invTexSize/);
        expect(src).toMatch(/radius/);
      });

      test('the first downsample applies the Karis average', () => {
        const { prefilter } = bloomPrograms(type);
        const src: string = prefilter.fragmentSource;
        // Four half-texel-diagonal fetches, each covering a 2x2 group.
        expect(countSamples(src)).toBeGreaterThanOrEqual(5);
        expect(src).toMatch(/karis/);
        // The weight is 1/(1+luma), so a reciprocal of a luminance dot product appears.
        expect(src).toMatch(/0\.2126/);
      });
    });
  }

  test('tent weights are normalized, so the filter preserves energy', () => {
    // Mirrors the kernel in the shader: (1 2 1 / 2 4 2 / 1 2 1) / 16.
    const weights = [1, 2, 1, 2, 4, 2, 1, 2, 1].map((w) => w / 16);
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  test('filterRadius and karisAverage are exposed and clamped sanely', () => {
    const bloom = new Bloom();
    // Defaults match the presentation: unit-width tent, Karis on.
    expect(bloom.filterRadius).toBe(1);
    expect(bloom.karisAverage).toBe(true);
    bloom.filterRadius = -5;
    expect(bloom.filterRadius).toBe(0);
    bloom.karisAverage = false;
    expect(bloom.karisAverage).toBe(false);
  });

  test('the Karis average holds a lone bright texel down', () => {
    // Scalar model of the shader's weighting, to show it does what it is for.
    const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const karis = (taps: number[][]) => {
      let acc = [0, 0, 0];
      let wsum = 0;
      for (const t of taps) {
        const w = 1 / (1 + luma(t));
        acc = acc.map((v, i) => v + t[i] * w);
        wsum += w;
      }
      return acc.map((v) => v / wsum);
    };
    const plain = (taps: number[][]) => taps[0].map((_, i) => taps.reduce((a, t) => a + t[i], 0) / taps.length);

    // One firefly among three dim neighbours.
    const group = [
      [400, 400, 400],
      [0.2, 0.2, 0.2],
      [0.2, 0.2, 0.2],
      [0.2, 0.2, 0.2]
    ];
    const box = plain(group)[0];
    const weighted = karis(group)[0];
    // The box filter passes ~1/4 of the spike; Karis suppresses it by orders of magnitude.
    expect(box).toBeGreaterThan(90);
    expect(weighted).toBeLessThan(box / 10);
    // A uniform group must be left essentially untouched.
    const flat = [
      [2, 2, 2],
      [2, 2, 2],
      [2, 2, 2],
      [2, 2, 2]
    ];
    expect(karis(flat)[0]).toBeCloseTo(2, 6);
  });
});

/**
 * Bloom halos are the shallowest gradients the renderer produces -- they can fall by less than one
 * 8-bit code value over several pixels, which rounding turns into wide flat bands. Tonemap ends the
 * HDR chain, so it is where that quantization happens and where the dither belongs.
 */
describe('Tonemap dithers the 8-bit write', () => {
  for (const type of ['webgl', 'webgpu'] as const) {
    test(`${type}: the shader can dither before output`, () => {
      const tonemap = new Tonemap() as any;
      (Tonemap as any)._programTonemap = null;
      tonemap._prepare(createDevice(type));
      const src: string = (Tonemap as any)._programTonemap.fragmentSource;
      expect(src).toMatch(/dither/);
      // Interleaved gradient noise, shared with the SSR passes.
      expect(src).toMatch(/52\.9829189/);
    });
  }

  test('dither defaults on and is togglable', () => {
    const tonemap = new Tonemap();
    expect(tonemap.dither).toBe(true);
    tonemap.dither = false;
    expect(tonemap.dither).toBe(false);
  });

  test('triangular-PDF dither breaks up bands a plain rounding leaves', () => {
    // A ramp shallower than one code value per pixel is the banding case.
    const N = 240;
    const ramp = [...Array(N)].map((_, i) => 0.6 - i * 0.0015);
    const q = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
    const runsOf = (arr: number[]) => {
      const out: number[] = [];
      let cur = arr[0];
      let len = 0;
      for (const v of arr) {
        if (v === cur) {
          len++;
        } else {
          out.push(len);
          cur = v;
          len = 1;
        }
      }
      out.push(len);
      return out;
    };
    let seed = 1;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const plainBands = runsOf(ramp.map(q)).filter((r) => r >= 3).length;
    const ditherBands = runsOf(ramp.map((v) => q(v + (rnd() + rnd() - 1) / 255))).filter((r) => r >= 3).length;
    expect(plainBands).toBeGreaterThan(0);
    expect(ditherBands).toBeLessThan(plainBands);
  });
});
