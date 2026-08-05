import { REVERSE_Z, type Vector4 } from '@zephyr3d/base';
import type { TextureFormat } from '@zephyr3d/device';
import { ESM } from '../../../libs/scene/src/shadow/esm';
import { PCFOPT } from '../../../libs/scene/src/shadow/pcf_opt';
import { PCSS } from '../../../libs/scene/src/shadow/pcss';
import type { ShadowMapParams } from '../../../libs/scene/src/shadow/shadowmapper';
import { LIGHT_TYPE_DIRECTIONAL, LIGHT_TYPE_POINT } from '../../../libs/scene/src/values';

function createShadowMapParams(lightType: number, format: TextureFormat): ShadowMapParams {
  const colorAttachment = {
    format,
    isFloatFormat: () => format !== 'rgba8unorm'
  };
  return {
    lightType,
    shadowMapFramebuffer: {
      getColorAttachments: () => [colorAttachment]
    }
  } as unknown as ShadowMapParams;
}

function components(value: Vector4 | null) {
  return value ? [value.x, value.y, value.z, value.w] : null;
}

describe('shadow map clear color depth encoding', () => {
  const directionalFarthest = REVERSE_Z ? 0 : 1;

  test('PCF packs the directional farthest depth into RGBA8', () => {
    const params = createShadowMapParams(LIGHT_TYPE_DIRECTIONAL, 'rgba8unorm');
    expect(components(new PCFOPT().getShadowMapClearColor(params))).toEqual([0, 0, 0, directionalFarthest]);
  });

  test('linear point-light depth remains standard-Z encoded', () => {
    const params = createShadowMapParams(LIGHT_TYPE_POINT, 'rgba8unorm');
    expect(components(new PCFOPT().getShadowMapClearColor(params))).toEqual([0, 0, 0, 1]);
  });

  test.each([
    ['PCSS', new PCSS()],
    ['ESM', new ESM()]
  ])('%s uses the same RGBA8 endpoint encoding', (_name, shadowImpl) => {
    const params = createShadowMapParams(LIGHT_TYPE_DIRECTIONAL, 'rgba8unorm');
    expect(components(shadowImpl.getShadowMapClearColor(params))).toEqual([0, 0, 0, directionalFarthest]);
  });
});
