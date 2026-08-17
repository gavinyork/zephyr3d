import { ProgramBuilder } from '../../../libs/device/src';
import { SkinSSS } from '../../../libs/scene/src/posteffect/skinsss';

function createShaderContext(type: 'webgl' | 'webgpu') {
  const device: any = {
    type,
    buildRenderProgram(options: any) {
      const builder = new ProgramBuilder(device);
      const result = builder.buildRender(options);
      if (!result) {
        throw new Error(builder.lastError ?? 'SkinSSS shader generation failed');
      }
      return {
        bindGroupLayouts: result[2],
        name: '',
        vertexSource: result[0],
        fragmentSource: result[1]
      };
    }
  };
  return { device } as any;
}

function buildPrograms(type: 'webgl' | 'webgpu') {
  const ctx = createShaderContext(type);
  const effect = new SkinSSS() as any;
  return {
    blur: effect.createBlurProgram(ctx).fragmentSource as string,
    combine: effect.createCombineProgram(ctx).fragmentSource as string
  };
}

describe('SkinSSS shader generation', () => {
  test.each(['webgpu', 'webgl'] as const)('builds both %s passes', (type) => {
    const { blur, combine } = buildPrograms(type);
    expect(blur).toBeTruthy();
    expect(combine).toBeTruthy();
    // Pixels with no skin coverage skip the kernel entirely.
    expect(blur).toContain('center');
    expect(combine).toContain('centerSkin');
  });

  test('diffuses each channel with its own radius', () => {
    // A shared radius across RGB is what makes Gaussian SSS read as flat haze:
    // red scatters several times further than blue in skin, and that difference
    // is the red-to-yellow gradient at the terminator.
    const { blur } = buildPrograms('webgpu');
    expect(blur).toContain('channelRadius');
    expect(blur).toContain('channelFalloff');
    expect(blur).toMatch(/radiusPx\.x/);
    expect(blur).toMatch(/radiusPx\.z/);
  });

  test('uses a two-exponential Burley profile rather than a single Gaussian', () => {
    const { blur } = buildPrograms('webgpu');
    expect(blur).toContain('lib_burleyDiffusionWeight');
    // Two exponentials: a sharp peak plus a long tail. One Gaussian can match
    // one or the other, not both.
    const kernel = blur.slice(blur.indexOf('fn lib_burleyDiffusionWeight'));
    expect(kernel.slice(0, 400).match(/exp\(/g)?.length).toBeGreaterThanOrEqual(2);
    // The old single-sigma Gaussian must be gone.
    expect(blur).not.toContain('spatialWeight');
  });

  test('is separable, driven by a direction uniform', () => {
    const { blur } = buildPrograms('webgpu');
    expect(blur).toContain('blurDirection');
  });

  test('excludes non-skin taps from the weight denominator', () => {
    // Counting them in the denominator drags the diffuse toward zero near every
    // silhouette. Under the old additive composite that was mild darkening;
    // now that the term is subtracted back out of the base color it would eat
    // real light.
    const { blur } = buildPrograms('webgpu');
    expect(blur).toMatch(/weightSum = weightSum \+ \(tapWeight \* isSkin\)/);
    // Coverage is the opposite measure - the skin fraction of the
    // neighbourhood - so it must keep every tap in its own denominator.
    expect(blur).toMatch(/coverageWeight = coverageWeight \+ tapWeight\.x/);
  });

  test('composites by subtracting the original diffuse before adding the diffused one', () => {
    // This identity is what makes the pass energy conserving: the light that
    // brightens the dark side of the terminator is light removed from the lit
    // side, not light invented on top of a finished image.
    const { combine } = buildPrograms('webgpu');
    expect(combine).toMatch(/diffused - original/);
    expect(combine).toContain('scatterTint');
    expect(combine).toContain('strength');
  });

  test('keeps the non-conserving glow as an explicit opt-in', () => {
    const { combine } = buildPrograms('webgpu');
    expect(combine).toMatch(/if \(\w*\.?glow > 0/);
    expect(combine).toContain('encodeScale');
    expect(combine).toContain('coverage');
  });

  test('keeps the beauty filter gated by the skin mask', () => {
    const { combine } = buildPrograms('webgpu');
    expect(combine).toMatch(/if \(\w*\.?smoothness > 0/);
    expect(combine).toContain('colorWeight');
  });

  test('clamps the composite against precision undershoot', () => {
    const { combine } = buildPrograms('webgpu');
    expect(combine).toMatch(/max\(result,\s*vec3<f32>\(0\.0\)\)/);
  });
});
