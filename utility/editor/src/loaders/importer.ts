import { SharedModel } from './model';
import { GLTFImporter } from './gltf/gltf_importer';
import type { VFS } from '@zephyr3d/base';

export interface ModelImporter {
  import(data: Blob, model: SharedModel): Promise<boolean>;
}

export async function importModel(srcVFS: VFS, path: string): Promise<SharedModel> {
  const mimeType = srcVFS.guessMIMEType(path);
  let loader: ModelImporter = null;
  if (mimeType === 'model/gltf+json' || mimeType === 'model/gltf-binary') {
    loader = new GLTFImporter();
  }
  if (loader) {
    const data = (await srcVFS.readFile(path, { encoding: 'binary' })) as ArrayBuffer;
    const blob = new Blob([data], { type: mimeType });
    const model = new SharedModel(srcVFS, path);
    if (await loader.import(blob, model)) {
      return model;
    }
  }
  return null;
}
