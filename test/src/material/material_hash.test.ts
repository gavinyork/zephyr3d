import { Material } from '../../../libs/scene/src/material/material';

describe('Material shader variant hash', () => {
  test('ignores runtime resource identities when a shader variant hash is provided', () => {
    const material = new Material() as any;
    const baseContext = {
      materialFlags: 0,
      drawEnvLight: false,
      currentShadowLight: null,
      lightBlending: false,
      shaderVariantHash: 'LightPassShaderVariant:stable',
      renderPassHash: 'LightPass:sceneColor=101:linearDepth=202'
    };

    const first = material.calcGlobalHash(baseContext, 0);
    const second = material.calcGlobalHash(
      {
        ...baseContext,
        renderPassHash: 'LightPass:sceneColor=303:linearDepth=404'
      },
      0
    );

    expect(second).toBe(first);
  });

  test('falls back to the full render pass hash for legacy passes', () => {
    const material = new Material() as any;
    const baseContext = {
      materialFlags: 0,
      drawEnvLight: false,
      currentShadowLight: null,
      lightBlending: false,
      shaderVariantHash: null,
      renderPassHash: 'LegacyPass:resource=101'
    };

    const first = material.calcGlobalHash(baseContext, 0);
    const second = material.calcGlobalHash(
      {
        ...baseContext,
        renderPassHash: 'LegacyPass:resource=202'
      },
      0
    );

    expect(second).not.toBe(first);
  });
});
