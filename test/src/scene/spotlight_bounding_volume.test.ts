import { Vector3 } from '@zephyr3d/base';
import { Scene, SpotLight } from '../../../libs/scene/src';
import type { BoundingBox } from '../../../libs/scene/src';

/**
 * In legacy lighting mode `SpotLight.cutoff` stores the *cosine* of the cone half-angle
 * (the constructor defaults it to `Math.cos(Math.PI / 4)` and `computeUniforms` hands it to the
 * shader unchanged, where it is compared against a dot product).
 *
 * The lit region is the cone intersected with the range sphere (attenuation reaches zero at the
 * range), opening towards the light direction, which is the node's local -Z.
 *
 * Past bugs: the cutoff cosine was passed through `Math.cos()` a second time, and the bounds were
 * built on local +Z - behind the light - so the light got culled whenever only its lit area was
 * in view.
 */
describe('SpotLight bounding volume', () => {
  function boundsOf(light: SpotLight): BoundingBox {
    // computeBoundingVolume is @internal but is the unit under test.
    return (light as unknown as { computeBoundingVolume(): BoundingBox }).computeBoundingVolume();
  }

  test('legacy cutoff is treated as a cosine, giving radius = range * sin(halfAngle)', () => {
    const scene = new Scene();
    expect(scene.lightingMode).toBe('legacy');

    for (const halfAngle of [Math.PI * 0.1, Math.PI * 0.2, Math.PI / 4, Math.PI / 3]) {
      const light = new SpotLight(scene);
      light.range = 200;
      light.cutoff = Math.cos(halfAngle);

      const bbox = boundsOf(light);
      const expectedRadius = 200 * Math.sin(halfAngle);

      expect(bbox.maxPoint.x).toBeCloseTo(expectedRadius, 4);
      expect(bbox.maxPoint.y).toBeCloseTo(expectedRadius, 4);
      expect(bbox.minPoint.x).toBeCloseTo(-expectedRadius, 4);
      expect(bbox.minPoint.y).toBeCloseTo(-expectedRadius, 4);
      // The cone opens along local -Z up to the light range.
      expect(bbox.minPoint.z).toBeCloseTo(-200, 6);
      expect(bbox.maxPoint.z).toBeCloseTo(0, 6);
    }
  });

  test('the bounds lie on the side the light shines into', () => {
    const scene = new Scene();
    const light = new SpotLight(scene);
    light.range = 20;
    light.position.setXYZ(3, 10, -4);
    light.rotation.fromEulerAngle(-Math.PI / 3, 0.4, 0);

    const pos = light.positionAndRange.xyz();
    const dir = light.directionAndCutoff.xyz();
    const bbox = light.getWorldBoundingVolume()!.toAABB();
    // Halfway down the cone axis must be inside, the mirrored point behind the light must not.
    const inFront = Vector3.add(pos, Vector3.scale(dir, 10));
    const behind = Vector3.add(pos, Vector3.scale(dir, -10));
    expect(bbox.containsPoint(inFront)).toBe(true);
    expect(bbox.containsPoint(behind)).toBe(false);
  });

  test('a wider cone yields a larger radius', () => {
    const scene = new Scene();
    const narrow = new SpotLight(scene);
    narrow.range = 100;
    narrow.cutoff = Math.cos(Math.PI * 0.1);
    const wide = new SpotLight(scene);
    wide.range = 100;
    wide.cutoff = Math.cos(Math.PI * 0.3);

    expect(boundsOf(wide).maxPoint.x).toBeGreaterThan(boundsOf(narrow).maxPoint.x);
  });

  test('the default cutoff corresponds to a 45 degree half-angle', () => {
    const scene = new Scene();
    const light = new SpotLight(scene);
    light.range = 50;

    // Default is Math.cos(Math.PI / 4)
    expect(boundsOf(light).maxPoint.x).toBeCloseTo(50 * Math.SQRT1_2, 4);
  });

  test('a 90 degree cone reaches the full range sideways and stays finite', () => {
    const scene = new Scene();
    const light = new SpotLight(scene);
    light.range = 10;
    light.cutoff = 0;

    const bbox = boundsOf(light);
    expect(bbox.maxPoint.x).toBeCloseTo(10, 6);
    expect(bbox.maxPoint.y).toBeCloseTo(10, 6);
    expect(bbox.maxPoint.z).toBeCloseTo(0, 6);
  });
});
