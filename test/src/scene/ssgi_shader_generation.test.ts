import { ProgramBuilder } from '../../../libs/device/src';
import { SSGI } from '../../../libs/scene/src/posteffect/ssgi';

function createShaderContext(type: 'webgl' | 'webgpu') {
  const device: any = {
    type,
    buildRenderProgram(options: any) {
      const builder = new ProgramBuilder(device);
      const result = builder.buildRender(options);
      if (!result) {
        throw new Error(builder.lastError ?? 'SSGI shader generation failed');
      }
      return {
        bindGroupLayouts: result[2],
        name: ''
      };
    }
  };
  const envLight = {
    initShaderBindings: () => {},
    getRadiance: (scope: any) => scope.$builder.vec3(0.25)
  };
  return {
    device,
    camera: {
      ssgiResolvedSettings: {
        halfRes: false,
        raysPerPixel: 2,
        maxSteps: 64,
        denoisePasses: 3
      }
    },
    env: {
      light: {
        envLight
      }
    }
  } as any;
}

describe('SSGI shader generation', () => {
  test.each(['webgpu', 'webgl'] as const)('builds every %s shader variant', (type) => {
    const ctx = createShaderContext(type);
    const effect = new SSGI() as any;

    expect(effect.createTraceProgram(ctx, type === 'webgpu', false)).toBeTruthy();
    expect(effect.createTemporalProgram(ctx, false)).toBeTruthy();
    if (type === 'webgpu') {
      expect(effect.createTraceProgram(ctx, true, true)).toBeTruthy();
      expect(effect.createTemporalProgram(ctx, true)).toBeTruthy();
    }
    expect(effect.createAtrousProgram(ctx)).toBeTruthy();
    expect(effect.createSurfaceProgram(ctx)).toBeTruthy();
    expect(effect.createUpsampleProgram(ctx)).toBeTruthy();
  });
});
