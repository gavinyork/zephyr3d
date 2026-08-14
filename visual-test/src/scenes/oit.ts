import { Vector3, Vector4 } from '@zephyr3d/base';
import { Mesh, SphereShape } from '@zephyr3d/scene';
import type { CameraOITMode } from '@zephyr3d/scene';
import type { VisualScene } from '../types';
import { bareScene, keyLight, pbr, placeCamera } from './common';

/**
 * Interpenetrating translucent spheres, staggered in depth.
 *
 * Order-independent transparency is only meaningfully tested when the correct
 * answer depends on resolving several overlapping fragments per pixel, so the
 * spheres deliberately intersect and are spread along Z. Non-overlapping quads
 * would look identical under all three implementations - and under a broken one.
 */
function oitScene(mode: CameraOITMode, note: string): VisualScene {
  return {
    name: `oit-${mode}`,
    description: note,
    setup({ scene, camera }) {
      bareScene(scene);
      keyLight(scene);

      const colors = [
        new Vector4(0.9, 0.25, 0.2, 0.45),
        new Vector4(0.25, 0.8, 0.35, 0.45),
        new Vector4(0.3, 0.4, 0.95, 0.45),
        new Vector4(0.95, 0.85, 0.2, 0.45),
        new Vector4(0.85, 0.3, 0.9, 0.45)
      ];
      colors.forEach((color, i) => {
        const material = pbr(color, 0, 0.5);
        material.blendMode = 'blend';
        const sphere = new Mesh(scene, new SphereShape({ radius: 1.1 }), material);
        // Overlapping in screen space and interleaved in depth.
        sphere.position.setXYZ((i - 2) * 0.75, ((i % 2) - 0.5) * 0.7, (i - 2) * 0.9);
      });

      // Setting oitMode is sufficient - its setter builds the matching OIT
      // instance. `camera.oit` takes an OIT object, not a flag.
      camera.oitMode = mode;
      placeCamera(camera, new Vector3(0, 0, 7.5));
    }
  };
}

export const oitWeighted = oitScene(
  'weighted',
  'Weighted-blended OIT over interpenetrating translucent spheres.'
);
export const oitABuffer = oitScene('abuffer', 'A-buffer OIT: per-pixel fragment lists, exact ordering.');
export const oitDualDepth = oitScene(
  'dual-depth',
  'Dual depth peeling OIT: exact ordering via iterated peeling.'
);
