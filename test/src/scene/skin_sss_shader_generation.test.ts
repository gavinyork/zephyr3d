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

describe('SkinSSS shader generation', () => {
  test.each(['webgpu', 'webgl'] as const)('builds the %s composite shader', (type) => {
    const ctx = createShaderContext(type);
    const effect = new SkinSSS() as any;
    const program = effect.createProgram(ctx);
    expect(program).toBeTruthy();
    // Pixels without skin coverage must skip the 9x9 blur entirely.
    expect(program.fragmentSource).toContain('centerSkin');
    // The tap spacing derives from a projected world-space scatter radius and
    // the taps are Gaussian weighted.
    expect(program.fragmentSource).toContain('stepPx');
    expect(program.fragmentSource).toContain('spatialWeight');
    // Additive composite: LDR decode scale and mask coverage gating must both
    // reach the final add.
    expect(program.fragmentSource).toContain('encodeScale');
    expect(program.fragmentSource).toContain('coverage');
    // Skin smoothing blends toward the mask-weighted blurred color.
    expect(program.fragmentSource).toContain('smoothedBase');
    expect(program.fragmentSource).toContain('colorWeightSum');
  });
});
