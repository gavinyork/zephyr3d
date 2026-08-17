import { Vector4 } from '@zephyr3d/base';
import type { Camera } from '../../../libs/scene/src/camera/camera';
import { ShadowMapper } from '../../../libs/scene/src/shadow/shadowmapper';
import type { PunctualLight } from '../../../libs/scene/src/scene/light';

/**
 * `depthBiasValues.y` is the world-space distance of one `normalBias` unit.
 *
 * The shader multiplies it by `sin(theta)` and offsets the receiver along its
 * normal, which is the only bias that fixes grazing-angle acne - a depth bias
 * cannot, because the depth spanned by one texel grows without bound as the
 * surface turns away from the light. If this packing drifts, the offset either
 * vanishes (acne returns) or overshoots (contact shadows detach), and neither
 * shows up as a build failure.
 */
class BiasProbe extends ShadowMapper {
  computeBias(
    shadowMapSize: number,
    depthBias: number,
    normalBias: number,
    sizeNear: number,
    sizeFar: number
  ) {
    const camera = {
      getProjectionMatrix: () => ({
        getNearPlaneWidth: () => sizeNear,
        getNearPlaneHeight: () => sizeNear,
        getFarPlaneWidth: () => sizeFar,
        getFarPlaneHeight: () => sizeFar
      })
    } as unknown as Camera;
    const out = new Vector4();
    this.calcDepthBiasParams(camera, shadowMapSize, depthBias, normalBias, 1, out);
    return out;
  }
}

function makeProbe() {
  const light = {
    isDirectionLight: () => true,
    isPointLight: () => false,
    isSpotLight: () => false,
    isRectLight: () => false
  } as unknown as PunctualLight;
  return new BiasProbe(light);
}

describe('shadow normal offset bias packing', () => {
  test('normalBias is packed as a world-space distance of that many texels', () => {
    const probe = makeProbe();
    // 20 world units across 1024 texels -> one texel spans 20/1024.
    const texelWorldSize = 20 / 1024;
    const params = probe.computeBias(1024, 0.003, 1.5, 20, 20);
    expect(params.y).toBeCloseTo(1.5 * texelWorldSize, 10);
  });

  test('a zero normalBias disables the offset entirely', () => {
    expect(makeProbe().computeBias(1024, 0.003, 0, 20, 20).y).toBe(0);
  });

  test('both bias terms scale with the cascade texel size, so one ratio serves both', () => {
    const probe = makeProbe();
    // Two cascades differing only in fitted extent. depthBiasScales is computed
    // from the `.x` ratio and then applied to `.y` as well, which is only valid
    // while the two stay proportional.
    const near = probe.computeBias(1024, 0.003, 1.5, 10, 10);
    const far = probe.computeBias(1024, 0.003, 1.5, 40, 40);
    expect(far.x / near.x).toBeCloseTo(4, 10);
    expect(far.y / near.y).toBeCloseTo(far.x / near.x, 10);
  });

  test('a denser shadow map shrinks the offset', () => {
    const probe = makeProbe();
    const coarse = probe.computeBias(1024, 0.003, 1.5, 20, 20);
    const fine = probe.computeBias(2048, 0.003, 1.5, 20, 20);
    expect(fine.y).toBeCloseTo(coarse.y / 2, 10);
  });

  test('the far/near footprint ratio still lands in w for perspective shadow cameras', () => {
    expect(makeProbe().computeBias(1024, 0.003, 1.5, 10, 25).w).toBeCloseTo(2.5, 10);
  });
});
