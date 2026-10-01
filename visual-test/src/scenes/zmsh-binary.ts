import { Vector3, Vector4 } from '@zephyr3d/base';
import { getEngine, Mesh } from '@zephyr3d/scene';
import type { VisualScene } from '../types';
import { bareScene, keyLight, pbr, placeCamera } from './common';

/**
 * The same sphere loaded from both .zmsh versions: the JSON form (float normals)
 * on the left, the binary meshopt form (8-bit octahedral normals) on the right.
 * Fixtures come from tools/gen-zmsh-fixtures.mjs.
 *
 * Pins the runtime side of compressed meshes end to end: the binary container,
 * the meshopt decode in the browser, and the quantized normal format on the GPU.
 * The two should be indistinguishable but for faint highlight differences.
 */
export const zmshBinary: VisualScene = {
  name: 'zmsh-binary',
  description: 'A sphere loaded from a JSON .zmsh and from a binary meshopt .zmsh, side by side.',
  async setup({ scene, camera }) {
    bareScene(scene);
    keyLight(scene);
    const rm = getEngine().resourceManager;
    const [v1, v2] = await Promise.all([
      rm.fetchPrimitive('/assets/zmsh/sphere-v1.zmsh'),
      rm.fetchPrimitive('/assets/zmsh/sphere-v2-meshopt.zmsh')
    ]);
    if (!v1 || !v2) {
      throw new Error(`Failed to load the ${!v1 ? 'JSON' : 'binary'} .zmsh fixture`);
    }
    [v1, v2].forEach((primitive, i) => {
      const mesh = new Mesh(scene, primitive, pbr(new Vector4(0.8, 0.55, 0.35, 1), 0, 0.3));
      mesh.position.setXYZ(i === 0 ? -0.95 : 0.95, 0, 0);
    });
    placeCamera(camera, new Vector3(0, 0.5, 4));
  }
};
