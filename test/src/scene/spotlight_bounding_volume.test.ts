import { Scene, SpotLight } from '../../../libs/scene/src';
import type { BoundingBox } from '../../../libs/scene/src';

/**
 * In legacy lighting mode `SpotLight.cutoff` stores the *cosine* of the cone half-angle
 * (the constructor defaults it to `Math.cos(Math.PI / 4)` and `computeUniforms` hands it to the
 * shader unchanged, where it is compared against a dot product).
 *
 * `computeBoundingVolume` used to apply `Math.cos()` to it a second time, which produced a cone
 * radius unrelated to the actual cone.
 */
describe('SpotLight bounding volume', () => {
  function boundsOf(light: SpotLight): BoundingBox {
    // computeBoundingVolume is @internal but is the unit under test.
    return (light as unknown as { computeBoundingVolume(): BoundingBox }).computeBoundingVolume();
  }

  test('legacy cutoff is treated as a cosine, giving radius = range * tan(halfAngle)', () => {
    const scene = new Scene();
    expect(scene.lightingMode).toBe('legacy');

    for (const halfAngle of [Math.PI * 0.1, Math.PI * 0.2, Math.PI / 4, Math.PI / 3]) {
      const light = new SpotLight(scene);
      light.range = 200;
      light.cutoff = Math.cos(halfAngle);

      const bbox = boundsOf(light);
      const expectedRadius = 200 * Math.tan(halfAngle);

      expect(bbox.maxPoint.x).toBeCloseTo(expectedRadius, 4);
      expect(bbox.maxPoint.y).toBeCloseTo(expectedRadius, 4);
      expect(bbox.minPoint.x).toBeCloseTo(-expectedRadius, 4);
      expect(bbox.minPoint.y).toBeCloseTo(-expectedRadius, 4);
      // The cone extends along +Z up to the light range.
      expect(bbox.minPoint.z).toBeCloseTo(0, 6);
      expect(bbox.maxPoint.z).toBeCloseTo(200, 6);
    }
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

    // Default is Math.cos(Math.PI / 4), so radius == range.
    expect(boundsOf(light).maxPoint.x).toBeCloseTo(50, 4);
  });

  test('a degenerate cutoff of 0 stays finite', () => {
    const scene = new Scene();
    const light = new SpotLight(scene);
    light.range = 10;
    light.cutoff = 0;

    const bbox = boundsOf(light);
    expect(Number.isFinite(bbox.maxPoint.x)).toBe(true);
    expect(Number.isFinite(bbox.maxPoint.y)).toBe(true);
  });
});
