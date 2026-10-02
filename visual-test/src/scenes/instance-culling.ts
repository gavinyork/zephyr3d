import { Vector3, Vector4 } from '@zephyr3d/base';
import { BatchGroup, BoxShape, Mesh, PlaneShape } from '@zephyr3d/scene';
import type { Scene } from '@zephyr3d/scene';
import type { VisualScene } from '../types';
import { bareScene, lambert, placeCamera, shadowKeyLight } from './common';

/** Boxes along each side of the grid, most of them out of view */
const GRID = 13;
const SPACING = 1.6;

/**
 * A BatchGroup of boxes on a grid much larger than the view, one batch of instanced
 * boxes, each tinted by its own instance uniform. A tall pillar stands just out of
 * view on the side the light comes from, so its shadow falls into view only if
 * shadow passes cull with the light's frustum rather than the camera's.
 */
function buildGrid(scene: Scene, gpuInstanceCulling: boolean) {
  bareScene(scene);
  shadowKeyLight(scene, 'pcf', 2);
  const ground = new Mesh(scene, new PlaneShape({ size: 40 }), lambert(new Vector4(0.62, 0.63, 0.66, 1)));
  ground.castShadow = false;

  const group = new BatchGroup(scene);
  group.gpuInstanceCulling = gpuInstanceCulling;
  const box = new BoxShape({ size: 0.8 });
  const core = lambert(new Vector4(1, 1, 1, 1));
  const half = (GRID - 1) / 2;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const material = core.createInstance();
      material.albedoColor = new Vector4(
        0.25 + (0.7 * i) / (GRID - 1),
        0.35,
        0.25 + (0.7 * j) / (GRID - 1),
        1
      );
      const mesh = new Mesh(scene, box, material);
      mesh.position.setXYZ((i - half) * SPACING, 0.4, (j - half) * SPACING);
      mesh.parent = group;
    }
  }
  // Out of view to the left, where the light comes from
  const pillarMaterial = core.createInstance();
  pillarMaterial.albedoColor = new Vector4(0.9, 0.85, 0.3, 1);
  const pillar = new Mesh(scene, box, pillarMaterial);
  pillar.scale.setXYZ(1, 7, 1);
  pillar.position.setXYZ(-5.2, 2.8, 1.5);
  pillar.parent = group;
}

export const batchInstanceCulling: VisualScene = {
  name: 'batch-instance-culling',
  description:
    'A BatchGroup grid of instanced boxes far larger than the view, culled per instance on the GPU for the camera and each shadow cascade, with a pillar out of view casting a shadow into it. Must match batch-instance-culling-off.',
  // Bundles are recorded on the first frame and replayed afterwards, which is the path culling must survive
  frames: 3,
  setup({ scene, camera }) {
    buildGrid(scene, true);
    placeCamera(camera, new Vector3(0, 5.5, 7.5), new Vector3(0, 0, 0.5));
  }
};

export const batchInstanceCullingOff: VisualScene = {
  name: 'batch-instance-culling-off',
  description: 'batch-instance-culling with GPU instance culling turned off: the reference it must match.',
  frames: 3,
  setup({ scene, camera }) {
    buildGrid(scene, false);
    placeCamera(camera, new Vector3(0, 5.5, 7.5), new Vector3(0, 0, 0.5));
  }
};
