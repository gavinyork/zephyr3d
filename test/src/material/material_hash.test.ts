import { Material } from '../../../libs/scene/src/material/material';
import { RenderBundleWrapper } from '../../../libs/scene/src/render/renderbundle_wrapper';

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

  test('keeps shared programs alive and invalidates render bundles while clearing one material cache', () => {
    const first = new Material() as any;
    const second = new Material() as any;
    const hash = 'test-shared-program-cache-entry';
    const program = { dispose: jest.fn() };
    const firstBindGroup = { dispose: jest.fn() };
    const secondBindGroup = { dispose: jest.fn() };
    const programCache = (Material as any)._programCache;
    programCache[hash] = { program, refCount: 2 };
    first._states[hash] = { program, bindGroup: firstBindGroup };
    second._states[hash] = { program, bindGroup: secondBindGroup };
    const materialChanged = jest
      .spyOn(RenderBundleWrapper, 'materialChanged')
      .mockImplementation(() => undefined);

    try {
      first.clearCache();

      expect(firstBindGroup.dispose).toHaveBeenCalledTimes(1);
      expect(materialChanged).toHaveBeenCalledWith(first);
      expect(program.dispose).not.toHaveBeenCalled();
      expect(programCache[hash]).toEqual({ program, refCount: 1 });

      second.clearCache();

      expect(secondBindGroup.dispose).toHaveBeenCalledTimes(1);
      expect(materialChanged).toHaveBeenCalledWith(second);
      expect(program.dispose).toHaveBeenCalledTimes(1);
      expect(programCache[hash]).toBeUndefined();
    } finally {
      materialChanged.mockRestore();
      delete programCache[hash];
    }
  });
});
