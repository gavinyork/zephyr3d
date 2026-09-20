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
    burley: effect.createBurleyProgram(ctx).fragmentSource as string,
    bvar: effect.createBVarProgram(ctx).fragmentSource as string,
    recombine: effect.createRecombineProgram(ctx).fragmentSource as string
  };
}

describe('SkinSSS shader generation', () => {
  test.each(['webgpu', 'webgl'] as const)('builds all %s passes', (type) => {
    const { burley, bvar, recombine } = buildPrograms(type);
    expect(burley).toBeTruthy();
    expect(bvar).toBeTruthy();
    expect(recombine).toBeTruthy();
  });

  test('Burley pass uses importance sampling with inverse CDF', () => {
    const { burley } = buildPrograms('webgpu');
    expect(burley).toContain('burleyW');
    expect(burley).toContain('xi_mapped');
    expect(burley).toContain('invShape');
    expect(burley).toContain('pdf');
    expect(burley).not.toContain('blurDirection');
  });

  test('Burley pass uses 3D distance for depth rejection', () => {
    const { burley } = buildPrograms('webgpu');
    expect(burley).toContain('combinedDist');
  });

  test('BVar pass is a passthrough (no velocity/shadow inputs yet)', () => {
    const { bvar } = buildPrograms('webgpu');
    expect(bvar).toContain('diffusedTex');
    // Transmission = 0 when velocity buffer and shadow map are unavailable
    expect(bvar).not.toContain('lumVariance');
    expect(bvar).not.toContain('thinness');
  });

  test('Recombine uses diffusible replacement', () => {
    const { recombine } = buildPrograms('webgpu');
    expect(recombine).toContain('redistributed');
    expect(recombine).toContain('original');
    expect(recombine).toContain('diffused');
  });

  test('Recombine applies transmission from BVar', () => {
    const { recombine } = buildPrograms('webgpu');
    expect(recombine).toContain('transmission');
    expect(recombine).toContain('scatterTint');
  });

  test('no legacy uniforms remain', () => {
    const { recombine } = buildPrograms('webgpu');
    expect(recombine).not.toContain('smoothness');
  });

  test('Recombine clamps against precision undershoot', () => {
    const { recombine } = buildPrograms('webgpu');
    expect(recombine).toMatch(/max\(result,\s*vec3<f32>\(0\.0\)\)/);
  });
});
