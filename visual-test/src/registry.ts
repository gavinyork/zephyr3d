import type { VisualScene } from './types';
import { sanityOrientation } from './scenes/sanity-orientation';
import { hair, pbrMetalRoughGrid, skinSss, unlitTextured } from './scenes/materials';
import { pbrIbl, skyAtmosphere } from './scenes/env';
import {
  shadowCsm,
  shadowDefaults,
  shadowEsm,
  shadowHard,
  shadowPcf,
  shadowPcss,
  shadowVsm
} from './scenes/shadows';
import { clusterManyLights, spotShadow } from './scenes/lighting';
import { oitABuffer, oitDualDepth, oitWeighted } from './scenes/oit';
import { postFxaa, postToneMapBloom, taaMultiframe } from './scenes/post';
import { eyeAngled, eyeFrontal, eyePupilDilated } from './scenes/eye';

/**
 * Every scene, in a fixed order.
 *
 * Order matters only for reading test output: each scene gets a fresh Scene and
 * camera (see SceneCapturer.capture), so scenes must never depend on having run
 * after another. tests/visual.spec.ts asserts this list against its own copy, so
 * adding a scene here without registering it there fails loudly rather than
 * silently going untested.
 */
export const SCENES: VisualScene[] = [
  // Harness integrity first - if this fails, read nothing else.
  sanityOrientation,
  // Core surface shading.
  unlitTextured,
  pbrMetalRoughGrid,
  pbrIbl,
  skyAtmosphere,
  // Shadows: one scene per filter.
  shadowHard,
  shadowPcf,
  shadowPcss,
  shadowVsm,
  shadowEsm,
  shadowCsm,
  shadowDefaults,
  // Lighting paths.
  clusterManyLights,
  spotShadow,
  // Transparency: one scene per OIT implementation.
  oitWeighted,
  oitABuffer,
  oitDualDepth,
  // Post-processing.
  postToneMapBloom,
  postFxaa,
  taaMultiframe,
  // Digital-human materials.
  skinSss,
  hair,
  eyeFrontal,
  eyeAngled,
  eyePupilDilated
];

export function findScene(name: string): VisualScene | undefined {
  return SCENES.find((s) => s.name === name);
}
