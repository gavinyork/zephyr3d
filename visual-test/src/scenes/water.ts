import { Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import {
  BoxShape,
  DirectionalLight,
  FBMWaveGenerator,
  FFTWaveGenerator,
  LambertMaterial,
  Mesh,
  PlaneShape,
  Water
} from '@zephyr3d/scene';
import type { Scene } from '@zephyr3d/scene';
import type { VisualScene } from '../types';
import { bareScene, placeCamera } from './common';

// Steep and close. A shallow view angle makes the light path through the water
// long enough that the medium swallows the sea bed, and the bed is the only
// thing in the frame that can show a caustic.
const EYE = new Vector3(0, 11, 9);
const TARGET = new Vector3(0, -2.5, 0);
const FAR = 80;
/** Depth of the sea bed below the surface, and the caustic focal depth. */
const BED_DEPTH = 2.5;

/**
 * A pale, matte sea bed with one solid on it.
 *
 * Matte and bright on purpose: caustics arrive as a multiplier on the sun's
 * contribution, so a dark or shiny receiver would hide exactly what these scenes
 * are here to pin. The box gives the sun something to cast a shadow from, which
 * is where caustics and shadowing interact.
 */
function seaBed(scene: Scene) {
  const bed = new Mesh(scene, new PlaneShape({ size: 44 }), lambert(new Vector4(0.72, 0.69, 0.6, 1)));
  bed.position.setXYZ(0, -BED_DEPTH, 0);

  const box = new Mesh(scene, new BoxShape({ size: 1.6 }), lambert(new Vector4(0.55, 0.5, 0.45, 1)));
  box.position.setXYZ(2.6, -BED_DEPTH + 0.8, -1.2);
}

function lambert(albedo: Vector4) {
  const m = new LambertMaterial();
  m.albedoColor = albedo;
  return m;
}

/**
 * The sun. Shadow-casting and steeply inclined, both of which the caustics pass
 * requires: it only attaches to a light that owns an additive shadow pass, and
 * it switches itself off once the sun drops near the horizon.
 */
function sun(scene: Scene) {
  scene.env.light.type = 'constant';
  scene.env.light.ambientColor = new Vector4(0.1, 0.13, 0.16, 1);
  const light = new DirectionalLight(scene);
  light.lookAt(new Vector3(-4, 12, 3), Vector3.zero(), Vector3.axisPY());
  light.color = new Vector4(1, 0.97, 0.9, 1);
  light.castShadow = true;
  light.shadow.applyQualityPreset('character-small');
  return light;
}

/** Depth of the floor under the pool used by the deep-bed scenes. */
const DEEP_BED_DEPTH = 6;

/**
 * A 16 m pool over a large, dark floor 6 m down, lit by a sun well off vertical.
 *
 * Shared by the two scenes built on it because the pool edge is the point of
 * both: it is the only structure in the caustic map strong enough to make a
 * misplaced lookup visible.
 */
function deepBed(scene: Scene, causticsEnabled: boolean) {
  bareScene(scene);
  scene.env.light.type = 'constant';
  scene.env.light.ambientColor = new Vector4(0.1, 0.13, 0.16, 1);
  const light = new DirectionalLight(scene);
  // Low enough that depth / tan(elevation) is a large fraction of the pool size.
  light.lookAt(new Vector3(-5, 7, 3), Vector3.zero(), Vector3.axisPY());
  light.color = new Vector4(1, 0.97, 0.9, 1);
  light.castShadow = true;
  light.shadow.applyQualityPreset('outdoor-large');

  const floor = new Mesh(scene, new PlaneShape({ size: 120 }), lambert(new Vector4(0.2, 0.34, 0.16, 1)));
  floor.position.setXYZ(0, -DEEP_BED_DEPTH, 0);

  const water = new Water(scene);
  water.scale.setXYZ(8, 1, 8);
  water.position.setXYZ(0, 0, 0);
  const waves = new FBMWaveGenerator();
  waves.numOctaves = 5;
  waves.wind = new Vector2(0.35, 0.12);
  waves.amplitude = 0.1;
  waves.frequency = 8;
  water.waveGenerator = waves;
  // Very clear, or six metres of medium would black the floor out and hide
  // exactly the shear these scenes exist to show.
  water.material.absorption = new Vector3(0.08, 0.03, 0.02);
  water.material.scattering = new Vector3(0.01, 0.015, 0.02);
  water.causticsEnabled = causticsEnabled;
  water.causticsDepth = DEEP_BED_DEPTH;
  water.causticsRange = 30;
  return water;
}

/** A water surface with deterministic, analytic waves. */
function calmWater(scene: Scene, causticsEnabled: boolean) {
  const water = new Water(scene);
  // Scale drives the water region: +/-scale around the node position.
  water.scale.setXYZ(22, 1, 22);
  water.position.setXYZ(0, 0, 0);

  // FBM rather than FFT: its noise is analytic, so it is reproducible frame for
  // frame on both backends. FFT seeds itself from a random noise texture.
  // Short, steep ripples. Caustics are driven by surface *curvature*, not wave
  // height: a long smooth swell refracts almost uniformly and produces a single
  // faint cusp line, where a higher-frequency surface focuses light into the
  // characteristic web. Amplitude stays low so the surface itself is calm.
  const waves = new FBMWaveGenerator();
  waves.numOctaves = 5;
  waves.wind = new Vector2(0.35, 0.12);
  waves.amplitude = 0.1;
  waves.frequency = 8;
  water.waveGenerator = waves;

  // Clear, shallow-lagoon water rather than the open-ocean default. At the
  // default coefficients the medium is close to opaque by 3 m, which is
  // faithful but leaves nothing of the sea bed for a caustic to land on.
  water.material.absorption = new Vector3(0.3, 0.07, 0.04);
  water.material.scattering = new Vector3(0.02, 0.04, 0.05);

  water.causticsEnabled = causticsEnabled;
  water.causticsDepth = BED_DEPTH;
  water.causticsRange = 18;
  return water;
}

/**
 * Caustics on and off over an identical scene.
 *
 * The pair is the point. On its own, the "on" baseline would go on matching if
 * the caustic map silently degenerated to its calm-water value of 1.0, because
 * that is a legitimate frame - the feature would simply have stopped doing
 * anything. What makes a regression legible is that the two frames must differ:
 * the "off" scene pins the Phase 0 medium (Beer-Lambert absorption through the
 * surface) with no caustic modulation at all, and the "on" scene pins that same
 * medium plus the focused sunlight and the light-path transmittance the caustics
 * pass adds on top.
 */
function waterScene(name: string, causticsEnabled: boolean, description: string): VisualScene {
  return {
    name,
    description,
    // Waves animate off elapsed time; a couple of steps moves the surface off
    // its t=0 state, where the FBM normal field is at its least interesting.
    frames: 3,
    setup({ scene, camera }) {
      bareScene(scene);
      sun(scene);
      seaBed(scene);
      calmWater(scene, causticsEnabled);
      placeCamera(camera, EYE, TARGET);
      camera.far = FAR;
    }
  };
}

export const waterCausticsOff = waterScene(
  'water-caustics-off',
  false,
  'Water over a sea bed with caustics disabled. Pins the physical medium: Beer-Lambert absorption applied to the refracted background, with the sun reaching the bed unattenuated and unfocused.'
);

export const waterCausticsOn = waterScene(
  'water-caustics-on',
  true,
  'The same scene with caustics on. Pins the photon splat, its blur, and the light-path transmittance the caustic term folds into the sun. Must differ from water-caustics-off; if the two ever converge, the caustic map has gone uniform and the feature is dead.'
);

/**
 * Steep waves seen nearly edge-on against a low sun, in scattering-heavy water.
 *
 * Every condition the forward-scattering term needs, at once, because it needs
 * all of them: the eye almost along the direction the refracted sunlight
 * continues in, crests tall enough to saturate the thickness ramp, and a medium
 * whose single-scattering albedo is high enough for the light to come back out
 * rather than be absorbed. `water-surface-grazing` has the first condition only
 * in a thin band at the horizon and clear ocean water for the third, which is
 * why the term is nearly invisible there and needs a scene of its own.
 *
 * The sky is deliberately dim relative to the sun. The ambient scattering term
 * is driven by sky irradiance and would otherwise wash out the directional term
 * this scene exists to pin - and washing it out is exactly the regression that
 * would go unnoticed, since both terms carry the same medium hue.
 */
export const waterSubsurfaceBacklit: VisualScene = {
  name: 'water-subsurface-backlit',
  description:
    'Steep waves edge-on against a low sun in turbid water. Pins the directional subsurface term: sunlight scattered forward through a crest towards the eye. Distinct from the ambient scattering term in that it needs the sun, the view direction and the wave height together - a regression that drops any one of the three leaves this scene flat while every other water baseline still passes.',
  frames: 3,
  setup({ scene, camera }) {
    bareScene(scene);
    // A sky to reflect - at this grazing an angle the surface is nearly all
    // reflection, and without one the frame is black. The environment *light*
    // stays a dim constant rather than an IBL of that sky, which keeps the
    // ambient scattering term small so the directional one is what this
    // baseline is measuring.
    scene.env.sky.skyType = 'scatter';
    scene.env.light.type = 'constant';
    scene.env.light.ambientColor = new Vector4(0.05, 0.07, 0.09, 1);

    // Just above the horizon, directly behind the water from the camera's point
    // of view, so the refracted sun continues almost straight at the eye.
    const light = new DirectionalLight(scene);
    light.lookAt(new Vector3(0, 3, -60), Vector3.zero(), Vector3.axisPY());
    light.color = new Vector4(1, 0.95, 0.85, 1);
    light.intensity = 4;

    const water = new Water(scene);
    water.scale.setXYZ(120, 1, 120);
    water.position.setXYZ(0, 0, 0);
    // FFT rather than FBM, which every other water scene uses. FBM's base
    // wavelength is fixed at 100 m, so at any sane amplitude its surface is
    // flat to within a fraction of a degree - measured at 1e-4 off vertical -
    // and a term gated on how steeply the surface tilts has nothing to work
    // with. FFT's shortest cascade is metres across and genuinely steep. It is
    // just as reproducible: its spectrum is seeded from randomSeed through a
    // PRNG, not from anything ambient.
    const waves = new FFTWaveGenerator();
    waves.wind = new Vector2(6, 2);
    waves.setWaveLength(0, 200);
    waves.setWaveLength(1, 40);
    waves.setWaveLength(2, 8);
    waves.setWaveStrength(0, 0.4);
    waves.setWaveStrength(1, 0.5);
    waves.setWaveStrength(2, 0.6);
    water.waveGenerator = waves;

    // Turbid, shallow-tropical water: scattering comparable to absorption, so
    // the single-scattering albedo is high and light that enters a crest comes
    // back out instead of being swallowed.
    water.material.absorption = new Vector3(0.25, 0.12, 0.1);
    water.material.scattering = new Vector3(0.25, 0.45, 0.4);
    water.causticsEnabled = false;

    // A moderate downward angle, not a grazing one. Grazing maximises the
    // alignment between the eye and the refracted sunlight, but it also drives
    // Fresnel to 1, and a surface that is all reflection shows nothing of what
    // came through it - the glow is there and drowned. Tilting down trades a
    // little of that alignment for a surface that is mostly transmission, which
    // is also where the effect appears in photographs.
    placeCamera(camera, new Vector3(0, 3.2, 11), new Vector3(0, 0.1, -22));
    camera.far = 400;
  }
};

/**
 * A storm sea under an overcast sky, close enough that individual crests break.
 *
 * Foam is the one part of the water that is not shaded like water: it is a dense
 * scattering layer sitting on the surface, so it takes light diffusely, hides
 * the specular reflection underneath, and hides the light coming up through the
 * water column. Before this it was a flat white composited before the lights ran
 * at all, which meant a breaking crest looked identical at noon, at sunset, and
 * inside a shadow.
 *
 * The sky is overcast rather than clear, and the sun weak, so that most of what
 * reaches the foam is ambient. That is deliberate: the ambient and direct paths
 * are separate code, and a scene lit mostly by the sun would pin only one of
 * them. Steep short cascades and a high croppiness are what make the surface
 * actually fold - foam comes from the Jacobian of the displacement going
 * negative, which gentle swell never does.
 */
export const waterFoamStorm: VisualScene = {
  name: 'water-foam-storm',
  description:
    'A breaking storm sea under an overcast sky. Pins foam as a lit surface: diffuse response to both the sun and the ambient, suppression of the specular underneath it, and suppression of the water body scattering it covers. A regression that returns foam to a flat white composite leaves this scene bright but unlit, and identical whatever the lighting does.',
  frames: 3,
  setup({ scene, camera }) {
    bareScene(scene);
    scene.env.sky.skyType = 'scatter';
    scene.env.light.type = 'ibl';

    // Weak and high: an overcast day, where the ambient dominates.
    const light = new DirectionalLight(scene);
    light.lookAt(new Vector3(-10, 16, 12), Vector3.zero(), Vector3.axisPY());
    light.color = new Vector4(1, 0.98, 0.95, 1);
    light.intensity = 6;
    light.castShadow = true;
    light.shadow.applyQualityPreset('outdoor-large');

    const water = new Water(scene);
    water.scale.setXYZ(150, 1, 150);
    water.position.setXYZ(0, 0, 0);
    const waves = new FFTWaveGenerator();
    waves.wind = new Vector2(14, 5);
    waves.setWaveLength(0, 120);
    waves.setWaveLength(1, 30);
    waves.setWaveLength(2, 6);
    waves.setWaveStrength(0, 0.7);
    waves.setWaveStrength(1, 0.8);
    waves.setWaveStrength(2, 0.9);
    // Croppiness is the horizontal displacement that sharpens crests until they
    // fold; without pushing it there is no foam to shade.
    waves.setWaveCroppiness(0, -2.2);
    waves.setWaveCroppiness(1, -2);
    waves.setWaveCroppiness(2, -1.4);
    waves.foamWidth = 1.1;
    waves.foamContrast = 2.5;
    water.waveGenerator = waves;
    water.material.absorption = new Vector3(0.4, 0.14, 0.09);
    water.material.scattering = new Vector3(0.06, 0.12, 0.15);
    water.causticsEnabled = false;

    placeCamera(camera, new Vector3(0, 5, 14), new Vector3(0, 1.5, -20));
    camera.far = 500;
  }
};

/**
 * A small pool over a deep floor, with the camera sliding sideways as it
 * renders.
 *
 * The caustic map is centred on the camera, so moving the camera scrolls it, and
 * the temporal resolve has to undo that scroll before it can reuse the previous
 * map. No scene that builds itself once exercises that: a static camera makes
 * the previous slice equal to the current one and the reprojection the identity,
 * so a version reprojecting to entirely the wrong place passes every other
 * baseline here.
 *
 * The small pool is what makes this measurable, and it took a wrong turn to
 * find. Over open water the map is a stationary speckle field, and the resolve
 * clamps the reprojected value into the current 3x3 range - so history fetched
 * from completely the wrong texel still lands inside that range and still reads
 * as a plausible, temporally smooth result. Deliberately negating the
 * reprojection there moved the frame by 0.4/255 on average: the accumulation
 * looked healthy either way. A pool inside a much larger map puts a hard edge in
 * the field, and a misplaced fetch pulls lit values into unlit ground where no
 * clamp can hide it.
 *
 * The step is a few map texels per frame: far enough for a sign error to land
 * well outside the clamp, close enough that most of the map still has history.
 */
export const waterCausticsMoving: VisualScene = {
  name: 'water-caustics-moving',
  description:
    'A pool over a deep floor with a laterally moving camera. Pins the temporal resolve reprojection, which every other scene leaves as the identity. The pool edge is load-bearing: on open water the neighbourhood clamp makes even a completely wrong reprojection look plausible.',
  frames: 6,
  setup(ctx) {
    deepBed(ctx.scene, true);
    ctx.camera.far = 120;
    this.onFrame!(ctx, 0);
  },
  onFrame({ camera }, frame) {
    // Small steps on purpose: the map is centred on the camera, and walking far
    // enough would push the pool out to the map's rim, where the photon grid
    // stops covering it. That is a coverage limit of the pass, not a temporal
    // one, and it would dominate what this scene is trying to show.
    placeCamera(camera, new Vector3(14 + frame * 0.35, 22, 20), new Vector3(0, -DEEP_BED_DEPTH, 0));
  }
};

/**
 * Open water seen at a grazing angle under a real sky, with the sun ahead.
 *
 * The caustics scenes look almost straight down at a dull constant environment,
 * which is the one configuration where the surface shading terms barely move.
 * This one is built to be the opposite, and pins the four of them that the
 * caustic scenes cannot see:
 *
 * - **Fresnel.** A grazing camera spans the whole incidence range in one frame,
 *   from near-normal at its feet to near-tangent at the horizon, so the
 *   reflection/refraction crossover is laid out across the image. It also has a
 *   sky bright enough to tell the two apart, which is what makes the F0 floor
 *   at normal incidence visible at all.
 * - **Horizon reflections.** Grazing is exactly where the sky reflection carries
 *   the most detail, and where a directional clamp would flatten it into bands.
 * - **Distance roughness.** The sun sits ahead of the camera, so its glitter
 *   track runs from the near field out to the horizon - the full range over
 *   which the wave detail fades out and the specular lobe has to widen to
 *   compensate.
 * - **Refraction scaling.** The bed is visible near the camera and lost to the
 *   medium further out, covering both ends of the depth and distance ramps.
 *
 * Caustics are off on purpose: they would put the caustic pass into this
 * baseline too, and then a failure here would no longer say which half broke.
 */
export const waterSurfaceGrazing: VisualScene = {
  name: 'water-surface-grazing',
  description:
    'Open water at a grazing angle under a scattering sky, sun ahead of the camera. Pins surface shading rather than the medium: the Fresnel crossover across the frame, horizon sky reflections, the sun glitter track widening with distance, and the depth/distance-scaled refraction offset. Caustics off so this baseline stays attributable to the surface.',
  frames: 3,
  setup({ scene, camera }) {
    bareScene(scene);
    scene.env.sky.skyType = 'scatter';
    scene.env.light.type = 'ibl';

    // Ahead of the camera and low, which is what puts a glitter track on the
    // water instead of a single highlight off to one side.
    const light = new DirectionalLight(scene);
    light.lookAt(new Vector3(0, 9, -40), Vector3.zero(), Vector3.axisPY());
    light.color = new Vector4(1, 0.96, 0.88, 1);
    light.castShadow = true;
    light.shadow.applyQualityPreset('outdoor-large');

    const bedDepth = 3;
    const bed = new Mesh(scene, new PlaneShape({ size: 400 }), lambert(new Vector4(0.7, 0.66, 0.55, 1)));
    bed.position.setXYZ(0, -bedDepth, 0);

    const water = new Water(scene);
    water.scale.setXYZ(200, 1, 200);
    water.position.setXYZ(0, 0, 0);
    const waves = new FBMWaveGenerator();
    waves.numOctaves = 5;
    waves.wind = new Vector2(0.3, 0.1);
    waves.amplitude = 0.14;
    waves.frequency = 5;
    water.waveGenerator = waves;
    water.material.absorption = new Vector3(0.35, 0.09, 0.05);
    water.material.scattering = new Vector3(0.03, 0.05, 0.06);
    water.causticsEnabled = false;

    // Low over the surface, aimed just under the horizon.
    placeCamera(camera, new Vector3(0, 2.2, 16), new Vector3(0, 1.1, -40));
    camera.far = 600;
  }
};

/**
 * A small pool over a large, deep, dark floor that lies entirely below the water
 * level, lit by a sun well off vertical.
 *
 * The receiver is far enough under the surface that the sun ray reaching it
 * entered the water several metres sideways from the point itself. That makes
 * the two ways of asking "is this point lit through the water" disagree:
 * testing the point's own footprint against the water region wrongly shades a
 * band inside the pool's outline whose sun actually arrives from open air (no
 * photons landed there, so the map reads zero and the sun is switched off
 * outright), and wrongly leaves unshaded the band beyond the outline that the
 * sun does reach through the pool. The correct picture is the pool's outline
 * sheared along the sun direction: caustics and attenuation offset from the
 * water, and the floor directly under the pool's up-sun edge lit plainly.
 */
export const waterCausticsDeepBed: VisualScene = {
  name: 'water-caustics-deep-bed',
  description:
    'A 16 m pool over a dark floor 6 m down, sun ~40 degrees off vertical. Pins that the caustic term is gated by where the sun ray entered the water, not by the receiver footprint: the shaded patch must be the pool outline sheared down-sun, with no dark band inside the outline and no unshaded band beyond it.',
  frames: 3,
  setup(ctx) {
    deepBed(ctx.scene, true);
    placeCamera(ctx.camera, new Vector3(14, 22, 20), new Vector3(0, -DEEP_BED_DEPTH, 0));
    ctx.camera.far = 120;
  }
};
