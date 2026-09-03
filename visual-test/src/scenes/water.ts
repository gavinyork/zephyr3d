import { Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import {
  BoxShape,
  DirectionalLight,
  FBMWaveGenerator,
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
  setup({ scene, camera }) {
    bareScene(scene);
    scene.env.light.type = 'constant';
    scene.env.light.ambientColor = new Vector4(0.1, 0.13, 0.16, 1);
    const light = new DirectionalLight(scene);
    // Low enough that depth / tan(elevation) is a large fraction of the pool size.
    light.lookAt(new Vector3(-5, 7, 3), Vector3.zero(), Vector3.axisPY());
    light.color = new Vector4(1, 0.97, 0.9, 1);
    light.castShadow = true;
    light.shadow.applyQualityPreset('outdoor-large');

    const floorDepth = 6;
    const floor = new Mesh(scene, new PlaneShape({ size: 120 }), lambert(new Vector4(0.2, 0.34, 0.16, 1)));
    floor.position.setXYZ(0, -floorDepth, 0);

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
    // exactly the shear this scene exists to show.
    water.material.absorption = new Vector3(0.08, 0.03, 0.02);
    water.material.scattering = new Vector3(0.01, 0.015, 0.02);
    water.causticsEnabled = true;
    water.causticsDepth = floorDepth;
    water.causticsRange = 30;

    placeCamera(camera, new Vector3(14, 22, 20), new Vector3(0, -floorDepth, 0));
    camera.far = 120;
  }
};
