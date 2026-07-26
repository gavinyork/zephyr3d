import { ProgramBuilder } from '../../../libs/device/src';
import { SSGI } from '../../../libs/scene/src/posteffect/ssgi';
import { EnvShIBL } from '../../../libs/scene/src/render/envlight';

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
    getRadiance: (scope: any) => scope.$builder.vec3(0.25),
    getIrradiance: (scope: any) => scope.$builder.vec3(0.5)
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

function buildSSGIHistoryRepairProgram(type: 'webgl' | 'webgpu') {
  const device: any = { type };
  const builder = new ProgramBuilder(device);
  const envLight = Object.create(EnvShIBL.prototype) as EnvShIBL;
  Object.defineProperty(envLight, 'irradianceSHFB', { value: null });
  const ctx = {
    device,
    SSGI: true,
    SSGIIrradianceHistoryTexture: {},
    SSGISurfaceHistoryTexture: {},
    motionVectorTexture: type === 'webgpu' ? {} : null,
    linearDepthTexture: {}
  } as any;
  const result = builder.buildRender({
    vertex(pb) {
      this.$inputs.pos = pb.vec2().attrib('position');
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 1, 1);
      });
    },
    fragment(pb) {
      this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH] = pb.vec4[9]().uniformBuffer(0);
      this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_WINDOW] = pb.vec3().uniform(0);
      this[EnvShIBL.UNIFORM_NAME_SSGI_IRRADIANCE] = pb.tex2D().uniform(0);
      this[EnvShIBL.UNIFORM_NAME_SSGI_SURFACE] = pb.tex2D().uniform(0);
      this[EnvShIBL.UNIFORM_NAME_SSGI_CURRENT_DEPTH] = pb.tex2D().uniform(0);
      if (type === 'webgpu') {
        this[EnvShIBL.UNIFORM_NAME_SSGI_MOTION] = pb.tex2D().uniform(0);
      }
      this[EnvShIBL.UNIFORM_NAME_SSGI_TARGET_SIZE] = pb.vec2().uniform(0);
      this[EnvShIBL.UNIFORM_NAME_SSGI_REPROJECTION] = pb.vec4().uniform(0);
      const lightStruct = pb.defineStruct([pb.float('envLightStrength')]);
      this.light = lightStruct().uniform(0);
      this.$outputs.color = pb.vec4();
      pb.main(function () {
        const irradiance = envLight.getIrradiance(this as any, pb.vec3(0, 1, 0) as any, ctx) as any;
        this.$outputs.color = pb.vec4(irradiance, 1);
      });
    }
  });
  if (!result) {
    throw new Error(builder.lastError ?? 'SSGI history repair shader generation failed');
  }
  return result;
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

  test.each(['webgpu', 'webgl'] as const)('builds %s lighting history repair', (type) => {
    expect(buildSSGIHistoryRepairProgram(type)).toBeTruthy();
  });
});
