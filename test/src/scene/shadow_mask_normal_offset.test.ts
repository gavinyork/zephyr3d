import { ProgramBuilder } from '../../../libs/device/src';
import { ShadowMaskRenderer } from '../../../libs/scene/src/render/shadow_mask_pass';
import { LIGHT_TYPE_DIRECTIONAL } from '../../../libs/scene/src/values';
import type { DrawContext } from '../../../libs/scene/src/render/drawable';
import type { ShadowMapParams } from '../../../libs/scene/src/shadow/shadowmapper';
import { PCFOPT } from '../../../libs/scene/src/shadow/pcf_opt';

/**
 * The screen-space shadow mask is the default path for the opaque queue
 * (`camera.screenSpaceShadowMask` defaults to true), so a material's
 * `calculateShadow` is bypassed there entirely. Normal offset bias applied only
 * in the material would therefore do nothing in the configuration almost every
 * scene actually renders with - the bug this guards against is not a wrong
 * image but a silently inert fix.
 *
 * A fullscreen pass has no interpolated normal, so the mask reconstructs a
 * geometric one from the depth prepass.
 */
function buildMaskShader() {
  const device: any = {
    type: 'webgpu',
    getDeviceCaps: () => ({
      textureCaps: { getTextureFormatInfo: () => ({ filterable: true }) },
      shaderCaps: { supportFragmentDepth: true }
    }),
    buildRenderProgram(options: any) {
      const builder = new ProgramBuilder(device);
      const result = builder.buildRender(options);
      if (!result) {
        throw new Error(builder.lastError ?? 'shadow mask shader generation failed');
      }
      return { bindGroupLayouts: result[2], name: '', vertexSource: result[0], fragmentSource: result[1] };
    }
  };
  const shadowMap: any = {
    format: 'd32f',
    isTextureCube: () => false,
    isTexture2D: () => true,
    isTexture2DArray: () => false,
    isDepth: () => true
  };
  const shadowMapParams = {
    lightType: LIGHT_TYPE_DIRECTIONAL,
    numShadowCascades: 1,
    shadowMap,
    impl: new PCFOPT(5),
    shaderHash: 'test'
  } as unknown as ShadowMapParams;
  const ctx = { device } as unknown as DrawContext;
  const renderer = new ShadowMaskRenderer() as any;
  return renderer.createProgram(ctx, shadowMapParams).fragmentSource as string;
}

describe('shadow mask normal offset', () => {
  test('reconstructs a normal from depth and spends the offset on it', () => {
    const source = buildMaskShader();
    // The reconstruction must exist and be fed by the offset, otherwise the
    // default opaque path silently keeps the old unoffset behaviour.
    expect(source).toContain('zReconstructNormal');
    expect(source).toContain('light.depthBiasValues.y');
    expect(source).toContain('sqrt(clamp(1.0 -');
  });

  test('picks the nearer depth neighbour on each axis', () => {
    // A plain cross(dpdx, dpdy) spans depth discontinuities and yields a garbage
    // normal along every silhouette, which would push those pixels far out of
    // their shadow texel. The reconstruction compares neighbour depths instead.
    const source = buildMaskShader();
    expect(source).toMatch(/abs\(left\.w - center\.w\) < abs\(right\.w - center\.w\)/);
    expect(source).toMatch(/abs\(down\.w - center\.w\) < abs\(up\.w - center\.w\)/);
  });

  test('derives NoL from the reconstructed normal rather than assuming 1', () => {
    const source = buildMaskShader();
    // A hardcoded NoL of 1 makes sin(theta) zero and the offset vanish; the
    // mask must compute a real one. Directional lights take it from the light
    // direction.
    expect(source).toContain('light.directionAndCutoff');
    expect(source).toMatch(/NoL = clamp\(dot\(normal,\s*lightDir\)/);
  });

  test('falls back to no offset when the reconstruction degenerates', () => {
    // Zero-length normal (flat depth, or a pixel with no geometry) must clamp to
    // NoL 1 - the smallest offset - not 0, which would be the largest.
    const source = buildMaskShader();
    expect(source).toMatch(/dot\(normal,\s*normal\) > 0\.5/);
  });
});
