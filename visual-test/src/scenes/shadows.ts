import { Vector3 } from '@zephyr3d/base';
import type { ShadowMode } from '@zephyr3d/scene';
import type { VisualScene } from '../types';
import { bareScene, placeCamera, shadowKeyLight, shadowStage } from './common';

const EYE = new Vector3(0.5, 5.2, 9);
const TARGET = new Vector3(0.3, 1, 0);
const FAR = 40;

/**
 * One scene per shadow filter, over an identical stage.
 *
 * Filters are the most cross-backend-fragile part of the renderer - VSM and ESM
 * depend on float texture filtering, PCSS on a fairly long dynamic loop - so
 * each gets its own baseline rather than being folded into one "shadows" scene
 * where one filter's regression could hide behind another's noise.
 *
 * The shared lighting and shadow configuration lives in `shadowKeyLight`; see
 * the comment there for why it is what it is. The short version: the first
 * version of these scenes buried every filter under ground acne and left ESM
 * looking broken, so the only thing the baselines really pinned was the acne
 * pattern.
 *
 * `camera.far` is pinned at 40 rather than left at the harness default of 100.
 * A directional shadow map is fitted to the camera frustum before being clamped
 * to the scene bounds, so an oversized far plane is not free.
 */
function shadowScene(mode: ShadowMode, note: string): VisualScene {
  return {
    name: `shadow-${mode}`,
    description: note,
    setup({ scene, camera }) {
      bareScene(scene);
      shadowStage(scene);
      shadowKeyLight(scene, mode);
      placeCamera(camera, EYE, TARGET);
      camera.far = FAR;
    }
  };
}

export const shadowHard = shadowScene(
  'hard',
  'Unfiltered shadow map. The baseline every filter is a variation on, and the most sensitive to depth-bias regressions - the self-shadowing moire on the solids is what unfiltered shadow mapping genuinely does at grazing angles, not a scene defect.'
);
export const shadowPcf = shadowScene('pcf', 'PCF-filtered directional shadow.');
export const shadowPcss = shadowScene(
  'pcss',
  'PCSS contact-hardening shadow: tight at the contact points, softening with distance. The longest dynamic loop in the shadow path.'
);
export const shadowVsm = shadowScene(
  'vsm',
  'Variance shadow map. Depends on float texture filtering, which differs most between backends; its light leaking is expected, not a regression.'
);
export const shadowEsm = shadowScene(
  'esm',
  'Exponential shadow map. Sensitive to float precision in the exponent, and to shadow-map density - it degrades to a smeared mess long before the other filters do.'
);

/**
 * The depth-bias sentinel. This one is supposed to look bad.
 *
 * The scenes above deliberately avoid shadow acne so that what separates their
 * baselines is the filter. That costs something real, and it is worth being
 * explicit about what: **acne is the signal that depth bias is being tested at
 * all.** Bias changes show up as the acne pattern shifting, so a scene with no
 * acne cannot see them. Measured, not assumed - nudging the default `depthBias`
 * from 0.003 to 0.0035 was caught by six scenes before they were retuned, and by
 * none of them afterwards.
 *
 * So this scene reconstructs the worst case on purpose: engine defaults (no
 * quality preset, so 1024 map / shadowDistance 2000 / depthBias 0.003 /
 * normalBias 0.2), a grazing light ~47 deg off vertical, and a ground plane far
 * larger than the subject. Every one of those choices makes the shadow map
 * sparser and the acne heavier, and together they make the frame sensitive to
 * exactly the constants the other scenes override.
 *
 * The heavy diagonal striping in this baseline is therefore the point, not a
 * defect - do not "fix" it. If it ever needs regenerating, check that it still
 * fails on a small default-bias change before accepting the new image.
 */
export const shadowDefaults: VisualScene = {
  name: 'shadow-defaults',
  description:
    'Depth-bias sentinel: engine defaults, grazing light, oversized ground. Deliberately acne-heavy, because acne shifting is what makes bias regressions visible. The other shadow scenes trade this sensitivity away for filter legibility.',
  setup({ scene, camera }) {
    bareScene(scene);
    shadowStage(scene, 16);
    const light = shadowKeyLight(scene, 'pcf', 1, false);
    // ~47 deg off vertical: shallow enough that the depth slope across the
    // ground is large, which is what produces the bias-sensitive striping.
    light.lookAt(new Vector3(4, 6, 5), Vector3.zero(), Vector3.axisPY());
    placeCamera(camera, EYE, TARGET);
    camera.far = 100;
  }
};

/**
 * Cascaded shadows need a stage deep enough for the cascade splits to land in
 * different places; on the compact stage the other scenes use, every cascade
 * would see the same geometry and a split regression would be invisible. So this
 * one keeps a long ground plane and looks down its length.
 */
export const shadowCsm: VisualScene = {
  name: 'shadow-csm',
  description: '4-cascade CSM down a receding stage, so cascade splits and their seams are pinned.',
  setup({ scene, camera }) {
    bareScene(scene);
    shadowStage(scene, 20);
    const light = shadowKeyLight(scene, 'pcf', 4);
    // The preset's shadowDistance of 120 is meant for an open scene; here it is
    // twice the camera's far plane, so the cascades get fitted to a volume the
    // stage never fills and the far ground picks up moire. Matching it to the
    // stage puts the texels where the geometry actually is.
    light.shadow.shadowDistance = 28;
    // Four cascades over a receding plane need more bias than the preset's
    // single-cascade default: each cascade is fitted tightly, and the bias is
    // applied in that cascade's normalised depth, so a tighter cascade means a
    // smaller world-space offset. The engine does scale bias per cascade
    // (calcDepthBiasParams is called per split), but the starting value is still
    // tuned for one cascade covering the whole range.
    light.shadow.normalBias = 0.7;
    light.shadow.depthBias = 0.008;
    // Looking down at the stage rather than along it. A near-horizontal view
    // over a large flat plane is the worst case for perspective aliasing - one
    // shadow texel smears across a huge screen area - and it banded the far
    // ground even with four cascades. Tilting down trades a little of the
    // receding depth for a readable image; the splits still land in different
    // places, which is what this scene is for.
    placeCamera(camera, new Vector3(0, 5.5, 10), new Vector3(0, 0.5, -5));
    camera.far = 40;
  }
};
