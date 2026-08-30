import { PerspectiveCamera, Scene } from '../../../libs/scene/src';
import { Bloom } from '../../../libs/scene/src/posteffect/bloom';
import { Tonemap } from '../../../libs/scene/src/posteffect/tonemap';
import { FXAA } from '../../../libs/scene/src/posteffect/fxaa';
import { ColorAdjust } from '../../../libs/scene/src/posteffect/coloradjust';
import { MotionBlur } from '../../../libs/scene/src/posteffect/motionblur';
import { PostEffectLayer } from '../../../libs/scene/src/posteffect/posteffect';
import type { AbstractPostEffect } from '../../../libs/scene/src/posteffect/posteffect';
import type { Compositor } from '../../../libs/scene/src/posteffect/compositor';

/** The transparent layer's effects, in the order the compositor will chain them. */
function transparentChain(compositor: Compositor): AbstractPostEffect[] {
  // The layer arrays are internal; reading them is the only way to assert order without
  // building a whole render graph, and order is precisely what this file pins.
  const layers = (compositor as unknown as { _postEffects: { get(): AbstractPostEffect }[][] })
    ._postEffects;
  return layers[PostEffectLayer.transparent].map((ref) => ref.get());
}

function indexOfEffect(chain: AbstractPostEffect[], ctor: new () => AbstractPostEffect): number {
  return chain.findIndex((effect) => effect instanceof ctor);
}

/**
 * Bloom's threshold, its separable blur and its additive compose are only meaningful on
 * scene-linear radiance. It used to run after Tonemap in `legacy` lighting, where ACES had already
 * compressed the buffer into [0, 1]: a 100x brighter emitter then produced the same halo as a 1x
 * one (measured: core 0.727 -> 0.759 across a 1..300 emissive ramp), and the compose could only
 * hard-clip because nothing downstream re-applied a curve.
 *
 * The order is now fixed at construction and identical in both lighting modes, so these tests pin
 * the invariant rather than the mode-dependent behaviour that replaced it.
 */
describe('Bloom always runs on scene-linear radiance', () => {
  for (const mode of ['legacy', 'physical'] as const) {
    test(`${mode}: Bloom precedes Tonemap`, () => {
      const scene = new Scene();
      scene.lightingMode = mode;
      const camera = new PerspectiveCamera(scene);
      // render() calls syncPostProcessingMode(); reach it directly to avoid needing a device.
      (camera as unknown as { syncPostProcessingMode(s: Scene): void }).syncPostProcessingMode(scene);

      const chain = transparentChain(camera.compositor);
      const bloom = indexOfEffect(chain, Bloom);
      const tonemap = indexOfEffect(chain, Tonemap);
      expect(bloom).toBeGreaterThanOrEqual(0);
      expect(tonemap).toBeGreaterThanOrEqual(0);
      expect(bloom).toBeLessThan(tonemap);
    });
  }

  test('switching lighting mode does not reorder the chain', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera(scene);
    const sync = (camera as unknown as { syncPostProcessingMode(s: Scene): void }).syncPostProcessingMode.bind(
      camera
    );

    sync(scene);
    const before = transparentChain(camera.compositor).map((e) => e.constructor.name);
    scene.lightingMode = 'physical';
    sync(scene);
    const afterPhysical = transparentChain(camera.compositor).map((e) => e.constructor.name);
    scene.lightingMode = 'legacy';
    sync(scene);
    const backToLegacy = transparentChain(camera.compositor).map((e) => e.constructor.name);

    expect(afterPhysical).toEqual(before);
    expect(backToLegacy).toEqual(before);
  });

  test('the transparent layer is in HDR pipeline order', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera(scene);
    const chain = transparentChain(camera.compositor);

    // Bloom before tone mapping (linear light), grading and AA after it (display-referred).
    const order = [MotionBlur, Bloom, Tonemap, ColorAdjust, FXAA].map((ctor) =>
      indexOfEffect(chain, ctor as new () => AbstractPostEffect)
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1]);
    }
  });
});
