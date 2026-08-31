import { PerspectiveCamera, Scene } from '../../../libs/scene/src';
import { Bloom } from '../../../libs/scene/src/posteffect/bloom';
import { Tonemap } from '../../../libs/scene/src/posteffect/tonemap';
import { FXAA } from '../../../libs/scene/src/posteffect/fxaa';
import { ColorAdjust } from '../../../libs/scene/src/posteffect/coloradjust';
import { MotionBlur } from '../../../libs/scene/src/posteffect/motionblur';
import { TAA } from '../../../libs/scene/src/posteffect/taa';
import { PostEffectLayer } from '../../../libs/scene/src/posteffect/posteffect';
import type { AbstractPostEffect } from '../../../libs/scene/src/posteffect/posteffect';
import type { Compositor } from '../../../libs/scene/src/posteffect/compositor';

function layerChain(compositor: Compositor, layer: PostEffectLayer): AbstractPostEffect[] {
  // The layer arrays are internal; reading them is the only way to assert order without
  // building a whole render graph, and order is precisely what this file pins.
  const layers = (compositor as unknown as { _postEffects: { get(): AbstractPostEffect }[][] })._postEffects;
  return layers[layer].map((ref) => ref.get());
}

/**
 * The post chain, in the order the compositor will chain it.
 *
 * @remarks
 * It lives in the `end` layer, not `transparent`. The resolve has to lead the chain, and the
 * transparent layer is built before the TransmissionDepth pass rewrites the linear depth with the
 * full scene depth -- TAA dilates its velocities by that depth, so run there it reads opaque-only
 * depth and picks up its neighbours' motion on anything the prepass never saw. None of the display
 * effects read depth, so they move instead and TAA stays where its inputs are correct.
 */
function displayChain(compositor: Compositor): AbstractPostEffect[] {
  return layerChain(compositor, PostEffectLayer.end);
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

      const chain = displayChain(camera.compositor);
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
    const sync = (
      camera as unknown as { syncPostProcessingMode(s: Scene): void }
    ).syncPostProcessingMode.bind(camera);

    sync(scene);
    const before = displayChain(camera.compositor).map((e) => e.constructor.name);
    scene.lightingMode = 'physical';
    sync(scene);
    const afterPhysical = displayChain(camera.compositor).map((e) => e.constructor.name);
    scene.lightingMode = 'legacy';
    sync(scene);
    const backToLegacy = displayChain(camera.compositor).map((e) => e.constructor.name);

    expect(afterPhysical).toEqual(before);
    expect(backToLegacy).toEqual(before);
  });

  test('the chain is in HDR pipeline order', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera(scene);
    const chain = displayChain(camera.compositor);

    // Temporal resolve first, Bloom before tone mapping (linear light), grading and AA after it
    // (display-referred).
    const order = [TAA, MotionBlur, Bloom, Tonemap, ColorAdjust, FXAA].map((ctor) =>
      indexOfEffect(chain, ctor as new () => AbstractPostEffect)
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1]);
    }
  });
});

/**
 * Bloom used to precede the resolve: it built its pyramid from the jittered, temporally
 * unconverged frame, so the per-frame brightness swing of a sub-pixel specular highlight was
 * smeared across a wide halo that pulsed, and the resolve downstream could not take it back --
 * the halo is low frequency, so the 3x3 neighbourhood the history clip is built from pulses in
 * step with it and admits the pulsing value as valid.
 *
 * The fix moved the display chain into `end` behind TAA rather than moving TAA forward into
 * `transparent`, because TAA is the one effect here whose inputs the layer boundary changes. See
 * {@link displayChain}.
 */
describe('TAA resolves before anything spreads energy', () => {
  test('TAA leads the chain, ahead of MotionBlur and Bloom', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera(scene);
    const chain = displayChain(camera.compositor);

    const taa = indexOfEffect(chain, TAA);
    expect(taa).toBe(0);
    expect(taa).toBeLessThan(indexOfEffect(chain, MotionBlur));
    expect(taa).toBeLessThan(indexOfEffect(chain, Bloom));
  });

  test('nothing the camera builds is left in the transparent layer', () => {
    // The layer is kept for effects that genuinely need the pre-TransmissionDepth linear depth.
    // Anything of the camera's own landing there would be running ahead of the resolve.
    const scene = new Scene();
    const camera = new PerspectiveCamera(scene);

    expect(layerChain(camera.compositor, PostEffectLayer.transparent)).toHaveLength(0);
  });

  test('TAA is not left behind in a layer of its own', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera(scene);

    expect(indexOfEffect(layerChain(camera.compositor, PostEffectLayer.transparent), TAA)).toBe(-1);
    expect(indexOfEffect(layerChain(camera.compositor, PostEffectLayer.opaque), TAA)).toBe(-1);
  });
});
