import { Vector3, Vector4 } from '@zephyr3d/base';
import { Mesh, SphereShape } from '@zephyr3d/scene';
import type { VisualScene } from '../types';
import { bareScene, keyLight, pbr, placeCamera, shadowStage } from './common';

/**
 * Bright emissive-ish spheres against black, so the bloom threshold has
 * something unambiguous to select. Tone mapping is on because bloom feeds into
 * it; the pair is what ships together, and pinning them together is what
 * catches an ordering regression between them.
 */
export const postToneMapBloom: VisualScene = {
  name: 'post-tonemap-bloom',
  description:
    'Tone mapping plus bloom over high-intensity highlights. Pins the threshold and the chain order.',
  setup({ scene, camera }) {
    bareScene(scene);
    const light = keyLight(scene);
    // Well above 1.0 so the bloom threshold has real work to do.
    light.color = new Vector4(6, 5.6, 5.2, 1);

    for (let i = 0; i < 4; i++) {
      const sphere = new Mesh(
        scene,
        new SphereShape({ radius: 0.55 }),
        pbr(new Vector4(1, 1, 1, 1), 0.1, 0.12)
      );
      sphere.position.setXYZ((i - 1.5) * 1.5, ((i % 2) - 0.5) * 1.2, 0);
    }

    camera.toneMap = true;
    camera.bloom = true;
    // Threshold deliberately left at the engine default. It happens to be the
    // 0.8 this scene wants anyway, so inheriting it costs nothing visually and
    // buys sensitivity to the default drifting - setting it explicitly made the
    // scene immune to exactly that, which tools/sensitivity.mjs caught.
    camera.bloomIntensity = 1.2;
    placeCamera(camera, new Vector3(0, 0, 7));
  }
};

/**
 * FXAA needs high-contrast near-diagonal edges to do anything at all; a
 * axis-aligned scene would leave the filter with nothing to find and the
 * baseline would pass with FXAA entirely broken.
 */
export const postFxaa: VisualScene = {
  name: 'post-fxaa',
  description: 'FXAA over deliberately near-diagonal high-contrast edges.',
  setup({ scene, camera }) {
    bareScene(scene);
    keyLight(scene);
    const stage = shadowStage(scene);
    stage.box.rotation.fromEulerAngle(0.3, 0.62, 0.15, 'ZYX');
    camera.FXAA = true;
    placeCamera(camera, new Vector3(1.0, 4.4, 9.5), new Vector3(0.3, 0.9, 0));
  }
};

/**
 * TAA across eight frames.
 *
 * This is the harness's own integrity test as much as a TAA test: jitter comes
 * from `Camera._halton23[frameCounter % n]` and the resolve reads the previous
 * frame's colour and motion vectors out of the history manager, so a stable
 * baseline here proves that `stepFrame()` really is advancing per-frame state
 * exactly once and that history ping-pong is not leaking between scenes.
 *
 * Eight frames rather than two, so the Halton sequence actually cycles.
 *
 * Runs on the default tolerance, deliberately. It originally carried a loosened
 * one, on the plausible-sounding assumption that temporal accumulation would
 * compound per-frame floating-point differences into flakiness. That assumption
 * was never measured, and it was wrong twice over: the scene is byte-stable
 * across repeated runs on both backends, and the loosened per-pixel threshold
 * was silently swallowing real regressions - a 1.5x change to the TAA jitter
 * amplitude registered as 4.0% of pixels at the default threshold but only 0.15%
 * at the loosened one, which slipped under the budget and passed.
 *
 * The general lesson, since it will come up again: loosen a tolerance only after
 * observing flakiness, never in anticipation of it, and re-run
 * tools/sensitivity.mjs afterwards to see what the slack cost.
 */
export const taaMultiframe: VisualScene = {
  name: 'taa-multiframe',
  description: 'TAA resolved over 8 stepped frames. Also proves frame-state advance and history isolation.',
  frames: 8,
  setup({ scene, camera }) {
    bareScene(scene);
    keyLight(scene);
    shadowStage(scene);
    camera.TAA = true;
    placeCamera(camera, new Vector3(1.0, 4.4, 9.5), new Vector3(0.3, 0.9, 0));
  }
};
