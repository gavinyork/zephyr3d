import { ASSERT, type VFS } from '@zephyr3d/base';
import { SharedModel } from '../../loaders/model';
import type { ModelImporter } from '../../loaders/importer';
import { GLTFImporter } from '../../loaders/gltf/gltf_importer';
import type { SceneNode, SerializationManager } from '@zephyr3d/scene';

export class ResourceService {
  static async importModel(srcVFS: VFS, path: string): Promise<SharedModel> {
    const mimeType = srcVFS.guessMIMEType(path);
    let loader: ModelImporter = null;
    if (mimeType === 'model/gltf+json' || mimeType === 'model/gltf-binary') {
      console.info(`Start importing model ${path} - ${mimeType}`);
      loader = new GLTFImporter();
    } else {
      throw new Error(`No valid loader found`);
    }
    ASSERT(!!loader, `Unsupported model type: ${mimeType}`);
    const data = (await srcVFS.readFile(path, { encoding: 'binary' })) as ArrayBuffer;
    const blob = new Blob([data], { type: mimeType });
    const model = new SharedModel(srcVFS, path);
    await loader.import(blob, model);
    return model;
  }
  static async savePrefab(
    node: SceneNode,
    manager: SerializationManager,
    path: string,
    name: string
  ): Promise<void> {
    const prefabId = node.prefabId;
    const position = node.position.clone();
    const rotation = node.rotation.clone();
    const scale = node.scale.clone();
    node.position.setXYZ(0, 0, 0);
    node.rotation.identity();
    node.scale.setXYZ(1, 1, 1);
    node.prefabId = '';
    const data = await manager.serializeObject(node);
    node.prefabId = prefabId;
    node.position.set(position);
    node.rotation.set(rotation);
    node.scale.set(scale);
    const content = JSON.stringify({ type: 'SceneNode', data }, null, '  ');
    const fn = name.endsWith('.zprefab') ? name : `${name}.zprefab`;
    await manager.VFS.writeFile(manager.VFS.join(path, fn), content, {
      encoding: 'utf8',
      create: true
    });
  }
}
