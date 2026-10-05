import { ProgramBuilder } from '../../../libs/device/src';
import { TransmissionThicknessRenderer } from '../../../libs/scene/src/render/transmission_thickness_pass';
import { LIGHT_TYPE_POINT, LIGHT_TYPE_SPOT, LIGHT_TYPE_DIRECTIONAL } from '../../../libs/scene/src/values';

function createDevice(type: 'webgl2' | 'webgpu') {
  const device: any = {
    type,
    getDeviceCaps: () => ({
      shaderCaps: { supportShaderTextureLod: true },
      textureCaps: { supportHalfFloatColorBuffer: true }
    }),
    buildRenderProgram(options: any) {
      const builder = new ProgramBuilder(device);
      const result = builder.buildRender(options);
      if (!result) {
        throw new Error(builder.lastError ?? 'shader generation failed');
      }
      return { bindGroupLayouts: result[2], vertexSource: result[0], fragmentSource: result[1] };
    }
  };
  return device;
}

function shadowMapParams(lightType: number, kind: '2d' | 'array' | 'cube', numShadowCascades: number) {
  const depth = {
    isTexture2DArray: () => kind === 'array',
    isTextureCube: () => kind === 'cube'
  };
  return {
    lightType,
    numShadowCascades,
    shadowMapFramebuffer: { getDepthAttachment: () => depth }
  };
}

const cases = [
  { name: 'spot / 2d', lightType: LIGHT_TYPE_SPOT, kind: '2d', cascades: 1 },
  { name: 'directional / cascaded array', lightType: LIGHT_TYPE_DIRECTIONAL, kind: 'array', cascades: 4 },
  { name: 'point / cube', lightType: LIGHT_TYPE_POINT, kind: 'cube', cascades: 1 }
] as const;

/**
 * The thickness pass reads the shadow map's raw depth. WebGL2 has no shadow
 * sampler that allows that (texelFetch on sampler2DShadow is undefined, and a
 * samplerCubeShadow always compares), so it must read the depth texture through
 * a plain float sampler there; this is what lets transmission run on WebGL2.
 */
describe('Transmission thickness pass on WebGL2', () => {
  for (const c of cases) {
    test(`${c.name}: reads shadow depth without a comparison sampler`, () => {
      const renderer = new TransmissionThicknessRenderer() as any;
      const program = renderer.createProgram(
        { device: createDevice('webgl2') },
        shadowMapParams(c.lightType, c.kind, c.cascades)
      );
      const fs: string = program.fragmentSource;
      expect(fs).not.toMatch(/sampler(2D|2DArray|Cube)Shadow/);
      if (c.kind === 'cube') {
        expect(fs).toMatch(/samplerCube\b/);
      } else {
        expect(fs).toContain('texelFetch');
      }
    });
  }

  test('WebGPU keeps the depth texture types', () => {
    const renderer = new TransmissionThicknessRenderer() as any;
    const program = renderer.createProgram(
      { device: createDevice('webgpu') },
      shadowMapParams(LIGHT_TYPE_SPOT, '2d', 1)
    );
    expect(program.fragmentSource).toContain('texture_depth_2d');
  });
});
