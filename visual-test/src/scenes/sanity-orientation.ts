import { Vector3, Vector4 } from '@zephyr3d/base';
import { BoxShape, Mesh, UnlitMaterial } from '@zephyr3d/scene';
import type { Scene } from '@zephyr3d/scene';
import type { VisualScene } from '../types';

function block(scene: Scene, color: Vector4, x: number, y: number, size: number) {
  const material = new UnlitMaterial();
  material.albedoColor = color;
  const mesh = new Mesh(scene, new BoxShape({ size, sizeY: size, sizeZ: size }), material);
  mesh.position.setXYZ(x, y, 0);
  return mesh;
}

/**
 * Deliberately asymmetric in both axes, and the cheapest possible scene: unlit
 * boxes, no lights, no sky, no environment light, no assets.
 *
 * Two jobs:
 *
 *  1. Smoke test. If this fails, nothing about the harness works, and the
 *     failure is readable rather than buried in a lighting difference.
 *  2. It is the assertion behind `normalizeRowOrder()`. `gl.readPixels` is
 *     bottom-up while WebGPU's `copyTextureToBuffer` is top-down, so a wrong
 *     row-order decision would otherwise bake a vertically mirrored baseline in
 *     and stay invisible forever. The layout below - one large block up and to
 *     the left, one small block down and to the right, in different colours -
 *     makes a flip obvious at a glance in the committed PNG, and makes the two
 *     backends disagree loudly if the normalisation is wrong on either side.
 */
export const sanityOrientation: VisualScene = {
  name: 'sanity-orientation',
  description:
    'Unlit asymmetric blocks. Smoke test for the whole harness, and the visual assertion for row-order normalisation.',
  setup({ scene, camera }) {
    scene.env.sky.skyType = 'none';
    scene.env.light.type = 'none';
    scene.env.sky.fogType = 'none';

    // Large, up and to the LEFT, warm.
    block(scene, new Vector4(0.9, 0.35, 0.15, 1), -1.4, 1.4, 1.6);
    // Small, down and to the RIGHT, cool.
    block(scene, new Vector4(0.15, 0.45, 0.9, 1), 1.6, -1.5, 0.7);
    // A thin marker hugging the top edge only, so a vertical flip cannot be
    // mistaken for a horizontal one.
    block(scene, new Vector4(0.95, 0.95, 0.2, 1), 0, 2.6, 0.35);

    camera.position.setXYZ(0, 0, 7);
    camera.lookAt(new Vector3(0, 0, 7), Vector3.zero(), Vector3.axisPY());
  }
};
