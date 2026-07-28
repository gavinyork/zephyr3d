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
      // Every state setter is chainable, so return a self-referencing proxy.
      const chain: any = new Proxy(
        {},
        {
          get: () => () => chain
        }
      );
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

/**
 * The Bloom pyramid is the post-effect whose shaders the physical alignment touched most: the
 * pre-exposure compensation (preExposure / inversePreExposure uniforms and the EXPOSED_COLOR_CLAMP)
 * was removed once lighting became pre-exposed on the CPU. These snapshots pin the resulting source
 * so the legacy-visible chain cannot silently regain a physical-only uniform.
 */
describe('Bloom shader source after removing the pre-exposure compensation', () => {
  for (const type of ['webgl', 'webgpu'] as const) {
    test(`${type}: prefilter and compose carry no exposure uniforms`, () => {
      const device = createDevice(type);
      const bloom = new Bloom() as any;
      bloom._prepare(device);

      const prefilter = (Bloom as any)._programPrefilter;
      const compose = (Bloom as any)._programFinalCompose;
      const sources = [
        prefilter.vertexSource,
        prefilter.fragmentSource,
        compose.vertexSource,
        compose.fragmentSource
      ].join('\n');

      // The compensation plumbing is gone in both modes.
      expect(sources).not.toMatch(/preExposure/i);
      expect(sources).not.toMatch(/inversePreExposure/i);
      // The half-float write guard is retained; it protects the render target, not the units.
      expect(compose.fragmentSource).toContain('65504');
    });
  }
});
