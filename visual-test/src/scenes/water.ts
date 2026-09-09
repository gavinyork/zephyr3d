import { Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import {
  BoxShape,
  DirectionalLight,
  FBMWaveGenerator,
  FFTWaveGenerator,
  GerstnerWaveGenerator,
  LambertMaterial,
  Mesh,
  PlaneShape,
  Water
} from '@zephyr3d/scene';
import type { Scene } from '@zephyr3d/scene';
import type { VisualScene } from '../types';
import { bareScene, placeCamera, proceduralTexture } from './common';

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

  // FBM rather than FFT, for the shape of the surface rather than for
  // determinism - FFT is reproducible too, from PRNG(randomSeed). FBM's noise
  // is analytic, so the ripple field is set directly by the four parameters
  // below instead of by a spectrum.
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
 * Two pools at different heights over one floor, both casting caustics.
 *
 * The renderer builds a single caustic map for the whole scene, so more than one
 * body has to share it: they share the light-space slice and the texture, and
 * what each keeps of its own is its footprint, its surface height and its
 * medium. A receiver resolves which of them is above it before reading the map.
 *
 * The two pools are deliberately unlike each other. Different heights, because
 * the surface height is what turns a world position into a depth and a light
 * path, and one shared height would let a bug that ignores the per-body value
 * pass. Different media, because the transmittance is per body too - the near
 * pool is clear and the far one turbid, which is visible as a colour difference
 * on the floor rather than only a brightness one.
 *
 * The sun is well off vertical so the entry-point offset is large: each pool
 * lights a patch of floor sheared away from its own outline, and the two patches
 * must not bleed into one another.
 */
export const waterCausticsTwoPools: VisualScene = {
  name: 'water-caustics-two-pools',
  description:
    'Two pools at different heights and with different media over one floor. Pins multi-body caustics: a shared map and slice, per-body surface height, footprint and transmittance. A regression that keeps only one body leaves one pool unlit; one that shares a height or a medium across bodies puts the wrong depth or the wrong colour under one of them.',
  frames: 3,
  setup({ scene, camera }) {
    bareScene(scene);
    scene.env.light.type = 'constant';
    scene.env.light.ambientColor = new Vector4(0.11, 0.14, 0.17, 1);

    const light = new DirectionalLight(scene);
    light.lookAt(new Vector3(-7, 9, 4), Vector3.zero(), Vector3.axisPY());
    light.color = new Vector4(1, 0.97, 0.9, 1);
    light.castShadow = true;
    light.shadow.applyQualityPreset('outdoor-large');

    const floorDepth = 5;
    const floor = new Mesh(scene, new PlaneShape({ size: 120 }), lambert(new Vector4(0.62, 0.6, 0.5, 1)));
    floor.position.setXYZ(0, -floorDepth, 0);

    const pool = (x: number, level: number, half: number, absorption: Vector3, scattering: Vector3) => {
      const water = new Water(scene);
      water.scale.setXYZ(half, 1, half);
      water.position.setXYZ(x, level, 0);
      const waves = new FBMWaveGenerator();
      waves.numOctaves = 5;
      waves.wind = new Vector2(0.3, 0.1);
      waves.amplitude = 0.1;
      waves.frequency = 8;
      water.waveGenerator = waves;
      water.material.absorption = absorption;
      water.material.scattering = scattering;
      water.causticsEnabled = true;
      water.causticsDepth = level + floorDepth;
      water.causticsRange = 40;
      return water;
    };
    // Near pool: clear, low. Far pool: turbid, raised, so neither its depth nor
    // its colour can be inherited from the other.
    pool(-9, 0, 6, new Vector3(0.1, 0.04, 0.03), new Vector3(0.02, 0.03, 0.04));
    pool(9, 1.2, 6, new Vector3(0.18, 0.08, 0.05), new Vector3(0.07, 0.06, 0.07));

    placeCamera(camera, new Vector3(2, 20, 22), new Vector3(0, -floorDepth, 0));
    camera.far = 200;
  }
};

/**
 * A reef breaking the surface under a high swell.
 *
 * The caustic term used to measure depth against the rest plane, so anything
 * above it - the top metre of this reef - read as dry even while a crest was
 * rolling over it, and the caustics and the medium's tint stopped dead along a
 * flat line at the rest level. The photon splat, meanwhile, refracted through
 * the displaced surface, so the two ends of the light path disagreed.
 *
 * The swell is tall on purpose and the reef's top sits inside it: at the rest
 * level the reef is half a wave height under the crests and half a wave height
 * above the troughs. The correct picture follows the water line frame by frame,
 * with the caustic web and the medium's colour reaching up the reef face as far
 * as the crest does; the wrong one is a straight horizontal cut at the rest
 * level, bright and untinted above it.
 */
export const waterCausticsCrest: VisualScene = {
  name: 'water-caustics-crest',
  description:
    'A reef whose top rises above the rest level, under a swell taller than that rise. Pins that the caustic gate and the light-path depth follow the displaced surface, not the rest plane: the caustics and the medium tint must climb the reef face with the crest, with no flat cut at the rest level.',
  frames: 3,
  setup({ scene, camera }) {
    bareScene(scene);
    sun(scene);
    seaBed(scene);

    // A slab rising well above the rest level. Its side facing the camera and
    // the sun is the receiver under test; the top is out of the water at every
    // trough and under it at every crest.
    const reef = new Mesh(scene, new BoxShape({ size: 1 }), lambert(new Vector4(0.7, 0.66, 0.58, 1)));
    reef.scale.setXYZ(5, BED_DEPTH + 0.7, 2.4);
    reef.position.setXYZ(0, (-BED_DEPTH + 0.7) / 2, 0);

    const water = calmWater(scene, true);
    // Replace the ripples with a swell tall enough to bury the reef top. FBM
    // cannot do it: its base octave is scaled to tens of meters, so across a
    // 5 m reef it is a constant offset rather than a crest. Gerstner waves of a
    // few meters' length put a whole crest and trough over the reef, and their
    // horizontal displacement also exercises the height lookup's assumption
    // that the surface can be sampled by its rest-plane xz. Every parameter the
    // shader reads is set explicitly, because the constructor draws the initial
    // ones from Math.random().
    const waves = new GerstnerWaveGenerator();
    waves.numWaves = 2;
    const wave = (i: number, angle: number, amplitude: number, length: number) => {
      waves.setWaveDirection(i, angle);
      waves.setWaveSteepness(i, 0.35);
      waves.setWaveAmplitude(i, amplitude);
      waves.setWaveLength(i, length);
      waves.setOmniWave(i, false);
    };
    wave(0, 0.4, 0.65, 6.5);
    wave(1, 2.1, 0.3, 3.4);
    water.waveGenerator = waves;
    // Focus at the reef top rather than the bed, which is what is under test.
    water.causticsDepth = 0.5;

    // Close and low, looking across the reef face from the lit side.
    placeCamera(camera, new Vector3(1.5, 3.2, 7), new Vector3(0, -0.4, 0));
    camera.far = FAR;
  }
};

/**
 * Open water under a tall, choppy swell, with the caustic map bounded by
 * `causticsRange` rather than by the water.
 *
 * The map border falls in open water here, which is the one configuration the
 * other caustic scenes never produce: each of them either fits the map to a
 * pool (`two-pools`, `deep-bed`, `moving`) or keeps the camera close enough
 * that the water fills the range (`on`, `crest`). A seam at that border is
 * therefore invisible to all of them, and two separate ones shipped because of
 * it.
 *
 * Three properties have to hold at once for either seam to appear, which is why
 * they are all set deliberately here:
 *
 * 1. **The range, not the water, bounds the map.** 100 m of water against a
 *    20 m range, so the border is a free-standing arc across the sea bed rather
 *    than the edge of a pool.
 * 2. **Horizontal displacement.** Photons launch from rest-plane points and land
 *    where the displaced surface refracts them, so displacement carries them
 *    across the border in both directions. A grid cut exactly at the border only
 *    loses the ones leaving, which piles up a bright rim just inside it.
 * 3. **A turbid medium.** `exp(-sigma * depth)` is convex, so switching the
 *    depth from the displaced surface to the rest plane at the border makes the
 *    wavy side systematically brighter by `exp((sigma * sigma_w)^2 / 2)`. That
 *    is under 5% in the clear water the other scenes use and about 2x here - the
 *    difference between invisible and a hard line across the frame.
 *
 * FFT rather than Gerstner, because FFT is what shows this in practice and it is
 * reproducible: its noise texture comes from `PRNG(randomSeed)` - mulberry32,
 * seeded 0 by default - not from `Math.random`. Every parameter the spectrum
 * depends on is set explicitly all the same.
 */
export const waterCausticsRangeBorder: VisualScene = {
  name: 'water-caustics-range-border',
  description:
    'Turbid water under a tall choppy FFT swell, with causticsRange well inside the water so the map border falls in open sea. Pins that the border is seamless: the photon grid is launched from past it, and the wave height is faded into the rest plane across it. A regression in either leaves a hard arc - a bright rim from the clipped photon grid, or a mean brightness step from switching the depth to the rest plane under a convex transmittance.',
  frames: 4,
  setup({ scene, camera }) {
    bareScene(scene);
    scene.env.light.type = 'constant';
    scene.env.light.ambientColor = new Vector4(0.1, 0.13, 0.16, 1);

    const light = new DirectionalLight(scene);
    light.lookAt(new Vector3(-4, 12, 3), Vector3.zero(), Vector3.axisPY());
    light.color = new Vector4(1, 0.97, 0.9, 1);
    light.castShadow = true;
    light.shadow.applyQualityPreset('outdoor-large');

    const bedDepth = 2.5;
    const bed = new Mesh(scene, new PlaneShape({ size: 400 }), lambert(new Vector4(0.72, 0.69, 0.6, 1)));
    bed.position.setXYZ(0, -bedDepth, 0);

    const water = new Water(scene);
    // Far larger than the range, so the map is cut by the range on every side.
    water.scale.setXYZ(100, 1, 100);
    water.position.setXYZ(0, 0, 0);

    const waves = new FFTWaveGenerator();
    waves.wind = new Vector2(12, 5);
    waves.setWaveLength(0, 120);
    waves.setWaveLength(1, 30);
    waves.setWaveLength(2, 6);
    waves.setWaveStrength(0, 0.9);
    waves.setWaveStrength(1, 0.9);
    waves.setWaveStrength(2, 0.9);
    // The horizontal displacement itself - property 2 above.
    waves.setWaveCroppiness(0, -1.5);
    waves.setWaveCroppiness(1, -1.2);
    waves.setWaveCroppiness(2, -0.5);
    water.waveGenerator = waves;

    // Turbid - property 3. Roughly twice the extinction the other caustic
    // scenes use, which is what brings the convexity gap up to a visible level.
    water.material.absorption = new Vector3(0.55, 0.14, 0.09);
    water.material.scattering = new Vector3(0.04, 0.08, 0.11);

    water.causticsEnabled = true;
    water.causticsDepth = bedDepth;
    water.causticsRange = 20;

    // High and steep, so the whole border arc is in frame at once.
    placeCamera(camera, new Vector3(0, 30, 30), new Vector3(0, -bedDepth, 0));
    camera.far = 300;
  }
};

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
 * A Gerstner storm sea, close enough that the crests of several long waves
 * coincide and fold.
 *
 * Where `water-foam-storm` gets foam from the FFT generator, this pins the
 * Gerstner generator's own foam: the horizontal-displacement Jacobian, computed
 * analytically per wave in the fragment shader, must produce the same folded-
 * crest foam the FFT path does. Gerstner needs fewer waves to fold than FFT -
 * each wave is a full finite-amplitude shape whose horizontal displacement
 * sharpens its own crest - so four steep waves are enough, which is also what
 * makes the baseline cheap while still exercising the Jacobian against a crest
 * that actually overlaps.
 *
 * Steepness above 1.5 is deliberate: the generator divides each wave's
 * horizontal displacement by `numWaves`, so the fold limit is on the *sum* of
 * steepness, not a single wave - at 1.7+1.6+1.55+1.45 over four waves (~1.5x
 * the count) the combined crest actually folds, and the determinant that gates
 * the foam crosses the threshold. Below that a Gerstner wave never folds and
 * the foam stays at zero. Foam must appear on the folded crests and nowhere on
 * the open water between them.
 */
export const waterFoamGerstner: VisualScene = {
  name: 'water-foam-gerstner',
  description:
    'A Gerstner storm sea of four steep waves. Pins the analytic Jacobian foam in the Gerstner generator: folded crests must be covered, open water between them not. A regression that leaves the foam channel at zero, or gates foam on the wrong sign of the determinant, shows up here as a bare storm.',
  frames: 3,
  setup({ scene, camera }) {
    bareScene(scene);
    scene.env.sky.skyType = 'scatter';
    scene.env.light.type = 'ibl';

    // Weak and high: an overcast day, where the ambient dominates, so the foam
    // is lit mostly by the sky and the baseline pins the ambient path.
    const light = new DirectionalLight(scene);
    light.lookAt(new Vector3(-10, 16, 12), Vector3.zero(), Vector3.axisPY());
    light.color = new Vector4(1, 0.98, 0.95, 1);
    light.intensity = 6;
    light.castShadow = true;
    light.shadow.applyQualityPreset('outdoor-large');

    const water = new Water(scene);
    water.scale.setXYZ(200, 1, 200);
    water.position.setXYZ(0, 0, 0);
    const waves = new GerstnerWaveGenerator();
    waves.numWaves = 4;
    // All parameters set explicitly, because the constructor draws the initial
    // ones from Math.random(). The first three angles are near each other so
    // their crests coincide in space - the generator divides each wave's
    // horizontal displacement by numWaves, so the fold limit is on the *sum* of
    // steepness; 1.7+1.6+1.55+1.45 over four waves is ~1.5x the count, enough
    // to fold. The fourth crosses them at a right angle so the foam breaks into
    // patches where the crests interfere instead of running as one straight line.
    const wave = (i: number, angle: number, amplitude: number, length: number, steepness: number) => {
      waves.setWaveDirection(i, angle);
      waves.setWaveSteepness(i, steepness);
      waves.setWaveAmplitude(i, amplitude);
      waves.setWaveLength(i, length);
      waves.setOmniWave(i, false);
    };
    wave(0, 0.0, 0.42, 18, 1.7);
    wave(1, 0.3, 0.3, 11, 1.6);
    wave(2, -0.28, 0.24, 7, 1.55);
    wave(3, 0.9, 0.18, 4.5, 1.45);
    // Foam threshold tuned so only the *deepest* fold - the crest of the
    // combined wave, not its whole flank - turns white; the contrast makes the
    // white sit in tight patches along the crest rather than a broad sheet.
    waves.foamWidth = 0.55;
    waves.foamContrast = 3.2;
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

/**
 * The cheap refraction mode, over a bed with a hard edge to displace.
 *
 * `refractionMode = 'offset'` drops the depth-buffer search that locates where
 * the refracted ray actually meets the scene - {@link REFRACT_MARCH_STEPS}
 * fetches per water pixel - and displaces the screen UV by the wave normal
 * instead. This scene exists to pin that the cheap path still refracts: a
 * regression that reduces it to a straight-through sample leaves the checker
 * under the water undistorted, which is the failure this cannot otherwise
 * detect, because a wrong-but-plausible displacement looks like water either
 * way.
 *
 * The bed is checkered rather than plain, and a box sits on it: the mode's
 * characteristic error is that a submerged silhouette smears instead of holding
 * still, so the frame has to contain a silhouette. Sharing the geometry with
 * `water-caustics-*` would not do - those beds are flat and matte, and the
 * difference between a searched and a guessed hit is invisible on a surface with
 * no features to displace.
 *
 * Waves are steep on purpose. The two modes agree exactly on calm water viewed
 * from above - `refractDir` is the view line plus a wave-normal perturbation, so
 * with no perturbation the guessed hit *is* the true one - and diverge with
 * steepness, so a calm scene here would pin nothing.
 */
export const waterRefractionCheap: VisualScene = {
  name: 'water-refraction-cheap',
  description:
    'Steep water over a checkered bed with a submerged box, using the cheap offset refraction mode. Pins that the no-search path still displaces what is behind the water: a regression to a straight-through sample leaves the checker undistorted, and one that loses the border fade smears the frame edge along the waterline.',
  frames: 3,
  setup({ scene, camera }) {
    bareScene(scene);
    scene.env.light.type = 'constant';
    scene.env.light.ambientColor = new Vector4(0.12, 0.15, 0.18, 1);
    const light = new DirectionalLight(scene);
    light.lookAt(new Vector3(-3, 10, 4), Vector3.zero(), Vector3.axisPY());
    light.color = new Vector4(1, 0.97, 0.9, 1);
    light.castShadow = true;
    light.shadow.applyQualityPreset('character-small');

    const bedDepth = 2.2;
    // Checkered, so a displacement of the refracted sample is visible at all.
    const bedMaterial = new LambertMaterial();
    bedMaterial.albedoTexture = proceduralTexture();
    const bed = new Mesh(scene, new PlaneShape({ size: 40 }), bedMaterial);
    bed.position.setXYZ(0, -bedDepth, 0);

    // A silhouette breaking the surface, which is where the cheap mode's error
    // is worst. Partly emergent rather than wholly submerged on purpose: the
    // distance from the water to what is behind it collapses to nearly nothing
    // on the object and jumps to metres on the water beside it, so an offset
    // scaled by that distance reaches from the water back onto the object and
    // paints a second copy of it. A fully submerged box shows a milder form of
    // the same thing, which is not the case worth pinning.
    const box = new Mesh(scene, new BoxShape({ size: 1.4 }), lambert(new Vector4(0.6, 0.3, 0.25, 1)));
    box.position.setXYZ(2, -bedDepth + 1.3, -1);

    const water = new Water(scene);
    water.scale.setXYZ(20, 1, 20);
    water.position.setXYZ(0, 0, 0);
    const waves = new FBMWaveGenerator();
    waves.numOctaves = 5;
    waves.wind = new Vector2(0.5, 0.2);
    // Steeper than the caustics scenes: the two modes are identical on flat
    // water, so the wave slope is what this scene is actually testing.
    waves.amplitude = 0.22;
    waves.frequency = 6;
    water.waveGenerator = waves;
    water.material.absorption = new Vector3(0.22, 0.06, 0.04);
    water.material.scattering = new Vector3(0.02, 0.04, 0.05);
    water.material.refractionMode = 'offset';
    water.causticsEnabled = false;

    placeCamera(camera, new Vector3(0, 7, 9), new Vector3(0, -1.5, 0));
    camera.far = 80;
  }
};
