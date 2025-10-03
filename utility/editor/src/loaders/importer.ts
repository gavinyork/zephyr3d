import { SharedModel } from './model';
import { GLTFImporter } from './gltf/gltf_importer';
import { ProjectService } from '../core/services/project';

export interface ModelImporter {
  import(data: Blob, model: SharedModel): Promise<boolean>;
}

export async function importModel(path: string): Promise<SharedModel> {
  const mimeType = ProjectService.VFS.guessMIMEType(path);
  let loader: ModelImporter = null;
  if (mimeType === 'model/gltf+json' || mimeType === 'model/gltf-binary') {
    loader = new GLTFImporter();
  }
  if (loader) {
    const data = (await ProjectService.VFS.readFile(path, { encoding: 'binary' })) as ArrayBuffer;
    const blob = new Blob([data], { type: mimeType });
    const model = new SharedModel(ProjectService.VFS, path);
    if (await loader.import(blob, model)) {
      return model;
    }
  }
  return null;
}
