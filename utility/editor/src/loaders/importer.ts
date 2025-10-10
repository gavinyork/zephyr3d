import { SharedModel } from './model';
import { GLTFImporter } from './gltf/gltf_importer';
import { ASSERT, type VFS } from '@zephyr3d/base';

export interface ModelImporter {
  import(data: Blob, model: SharedModel): void | Promise<void>;
}

export async function importModel(srcVFS: VFS, path: string): Promise<SharedModel> {
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
