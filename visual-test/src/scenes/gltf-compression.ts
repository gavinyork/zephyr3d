import { Vector3, Vector4 } from '@zephyr3d/base';
import { getEngine } from '@zephyr3d/scene';
import { GLTFImporter } from '@zephyr3d/loaders';
import type { VisualScene } from '../types';
import { bareScene, keyLight, placeCamera } from './common';

/**
 * Compressed glTF geometry, one duck per codec.
 *
 * Left is the Khronos sample Duck in its KHR_draco_mesh_compression variant;
 * right is the same model run through gltfpack 1.3 `-cc`, which stores it with
 * EXT_meshopt_compression on top of KHR_mesh_quantization (16-bit positions,
 * 8-bit octahedral normals, quantized UVs undone by KHR_texture_transform).
 *
 * Both decoders are fetched on demand, so the scene also pins that loading path:
 * a decoder that fails to load or decodes garbage leaves a missing or shredded
 * duck. The two should match closely; quantization alone accounts for the small
 * shading differences between them.
 */
export const gltfCompression: VisualScene = {
  name: 'gltf-compression',
  description:
    'Draco and meshopt compressed glTF side by side. Pins on-demand decoding and quantized attributes.',
  async setup({ scene, camera }) {
    bareScene(scene);
    scene.env.light.type = 'constant';
    scene.env.light.ambientColor = new Vector4(0.25, 0.25, 0.28, 1);
    keyLight(scene);
    const rm = getEngine().resourceManager;
    rm.setModelLoader('model/gltf+json', new GLTFImporter());
    const [draco, meshopt] = await Promise.all([
      rm.fetchModel('/assets/gltf/duck-draco/Duck.gltf', scene),
      rm.fetchModel('/assets/gltf/duck-meshopt/Duck.gltf', scene)
    ]);
    if (!draco || !meshopt) {
      throw new Error(`Failed to load ${!draco ? 'Draco' : 'meshopt'} compressed Duck`);
    }
    draco.position.setXYZ(-0.95, 0, 0);
    meshopt.position.setXYZ(0.95, 0, 0);
    placeCamera(camera, new Vector3(0, 1.2, 4.2), new Vector3(0, 0.8, 0));
  }
};
