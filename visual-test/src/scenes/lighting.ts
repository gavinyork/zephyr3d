import { Vector3, Vector4 } from '@zephyr3d/base';
import { Mesh, PlaneShape, PointLight, SphereShape, SpotLight } from '@zephyr3d/scene';
import type { VisualScene } from '../types';
import { bareScene, lambert, pbr, placeCamera } from './common';

/**
 * Many small point lights over a plane, laid out on a fixed lattice.
 *
 * This is the clustered forward path's actual job: light-to-cluster assignment.
 * A handful of lights would all land in the same few clusters and pass even with
 * the binning badly wrong, so the lattice is sized and spaced to straddle cluster
 * boundaries, and the lights are given short ranges so each one's footprint has a
 * visible edge where a misassignment shows up as a hard discontinuity.
 */
export const clusterManyLights: VisualScene = {
  name: 'cluster-many-lights',
  description: '24 short-range point lights on a lattice. Pins clustered-forward light assignment.',
  setup({ scene, camera }) {
    bareScene(scene);

    new Mesh(scene, new PlaneShape({ size: 24 }), lambert(new Vector4(0.5, 0.52, 0.55, 1)));

    // A few solids so the lights also have vertical surfaces to fall on.
    for (let i = 0; i < 5; i++) {
      const sphere = new Mesh(
        scene,
        new SphereShape({ radius: 0.6 }),
        pbr(new Vector4(0.8, 0.8, 0.82, 1), 0, 0.4)
      );
      sphere.position.setXYZ((i - 2) * 2.2, 0.6, -1.5);
    }

    const COLS = 6;
    const ROWS = 4;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const light = new PointLight(scene);
        light.position.setXYZ((c - (COLS - 1) / 2) * 2.1, 1.1, (r - (ROWS - 1) / 2) * 2.4);
        light.range = 2.6;
        light.intensity = 6;
        // Deterministic colour cycle - no randomness anywhere in this harness.
        const t = (r * COLS + c) / (ROWS * COLS);
        light.color = new Vector4(
          0.5 + 0.5 * Math.sin(t * 6.283),
          0.5 + 0.5 * Math.sin(t * 6.283 + 2.09),
          0.5 + 0.5 * Math.sin(t * 6.283 + 4.19),
          1
        );
      }
    }

    placeCamera(camera, new Vector3(0, 6.5, 9.5), new Vector3(0, 0.5, 0));
  }
};

/**
 * A spot light's cone edge and its shadow, which exercise a different projection
 * and a different shadow-map layout from the directional cases in shadows.ts.
 */
export const spotShadow: VisualScene = {
  name: 'spot-shadow',
  description: 'Shadow-casting spot light. Pins perspective shadow projection and cone falloff.',
  setup({ scene, camera }) {
    bareScene(scene);
    // Same reasoning as the directional shadow scenes: a little ambient so the
    // unlit surfaces stay readable, and a ground plane sized to the subject
    // rather than generously, since the shadow map is fitted to the bounds.
    scene.env.light.type = 'constant';
    scene.env.light.ambientColor = new Vector4(0.11, 0.12, 0.15, 1);
    new Mesh(scene, new PlaneShape({ size: 9 }), lambert(new Vector4(0.6, 0.61, 0.64, 1)));
    const sphere = new Mesh(scene, new SphereShape({ radius: 1 }), lambert(new Vector4(0.85, 0.4, 0.3, 1)));
    sphere.position.setXYZ(0, 1.4, 0);

    const light = new SpotLight(scene);
    light.lookAt(new Vector3(-4, 6, 2), Vector3.zero(), Vector3.axisPY());
    light.range = 22;
    light.intensity = 14;
    light.castShadow = true;
    light.shadow.applyQualityPreset('character-small');
    light.shadow.mode = 'pcf';

    placeCamera(camera, new Vector3(0.5, 4.2, 8), new Vector3(0, 0.8, 0));
    camera.far = 40;
  }
};
