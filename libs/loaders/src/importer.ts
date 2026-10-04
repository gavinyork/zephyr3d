import type { SceneNode, Scene, ModelLoadOptions } from '@zephyr3d/scene';
import { getEngine, SharedModel } from '@zephyr3d/scene';
import { PathUtils, type VFS } from '@zephyr3d/base';

/**
 * Generic model importer interface
 * @public
 */
export abstract class AbstractModelImporter {
  abstract import(data: Blob, model: SharedModel, basePath: string, vfs?: VFS): void | Promise<void>;
  /**
   * Load a model.
   * @param path - Model path
   * @param vfs - File system to read from, the engine's by default
   * @param options - What to apply to the model, levels of detail generation for instance
   */
  async loadModel(path: string, vfs?: VFS, options?: ModelLoadOptions): Promise<SharedModel> {
    if (!vfs) {
      vfs = getEngine().VFS;
    }
    const mimeType = vfs.guessMIMEType(path);
    const data = (await vfs.readFile(path, { encoding: 'binary' })) as ArrayBuffer;
    const blob = new Blob([data], { type: mimeType });
    const model = new SharedModel();
    await this.import(blob, model, PathUtils.dirname(path), vfs);
    if (options?.generateLods) {
      await model.generateLods(options.generateLods === true ? undefined : options.generateLods);
    }
    return model;
  }
  async loadModelToScene(
    scene: Scene,
    path: string,
    instancing?: boolean,
    vfs?: VFS,
    options?: ModelLoadOptions
  ): Promise<SceneNode> {
    const model = await this.loadModel(path, vfs, options);
    return model.createSceneNode(
      getEngine().resourceManager,
      scene,
      instancing ?? false,
      true,
      true,
      true,
      true,
      vfs ?? getEngine().VFS
    );
  }
}
