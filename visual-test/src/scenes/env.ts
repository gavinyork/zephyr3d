import { Vector3, Vector4 } from '@zephyr3d/base';
import { Mesh, SphereShape } from '@zephyr3d/scene';
import type { VisualScene } from '../types';
import { bareScene, pbr, placeCamera } from './common';

/**
 * Atmospheric scattering on its own, with no geometry to distract from it.
 *
 * The camera tilts up towards the horizon because that is where the scattering
 * model varies fastest; aimed at the zenith the frame would be a near-flat
 * gradient that could absorb a substantial regression.
 */
export const skyAtmosphere: VisualScene = {
  name: 'sky-atmosphere',
  description: 'Procedural atmospheric scattering across the horizon. No geometry.',
  setup({ scene, camera }) {
    bareScene(scene);
    scene.env.sky.skyType = 'scatter';
    placeCamera(camera, new Vector3(0, 0.5, 0), new Vector3(0, 1.1, -4));
  }
};

/**
 * Image-based lighting fed by the procedural sky.
 *
 * Uses the sky as the light source rather than a loaded HDR: the engine fills
 * missing environment fields from the sky, so this needs no binary fixture and
 * the environment can never be the reason a baseline moves. Spheres run from
 * rough dielectric to polished metal, since IBL splits into an irradiance path
 * and a radiance path and only the polished end exercises the latter.
 */
export const pbrIbl: VisualScene = {
  name: 'pbr-ibl',
  description:
    'IBL from the procedural sky across a roughness sweep. Pins both irradiance and radiance paths.',
  setup({ scene, camera }) {
    bareScene(scene);
    scene.env.sky.skyType = 'scatter';
    scene.env.light.type = 'ibl';

    const N = 5;
    for (let i = 0; i < N; i++) {
      const sphere = new Mesh(
        scene,
        new SphereShape({ radius: 0.55 }),
        pbr(new Vector4(0.9, 0.85, 0.8, 1), i / (N - 1), Math.max(0.05, 1 - i / (N - 1)))
      );
      sphere.position.setXYZ((i - (N - 1) / 2) * 1.35, 0, 0);
    }
    placeCamera(camera, new Vector3(0, 0.2, 6.2));
  }
};
