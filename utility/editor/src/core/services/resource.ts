import { ASSERT, PathUtils, type VFS } from '@zephyr3d/base';
import type { AbstractModelImporter } from '@zephyr3d/loaders';
import { FBXImporter, GLTFImporter } from '@zephyr3d/loaders';
import { type SceneNode, type ResourceManager, Scene, getEngine, SharedModel } from '@zephyr3d/scene';

export type SaveOptions = {
  importMeshes: boolean;
  importSkeletons: boolean;
  importAnimations: boolean;
  importJointDynamics: boolean;
  rebuildPrefab?: boolean;
  rebuildMaterial?: boolean;
  sourceGlbReference?: boolean;
  sourceModelPath?: string;
};

type SharedModelWithPreprocessOptions = SharedModel & {
  _preprocessOptions?: {
    rebuildMaterial?: boolean;
    sourceMorphReferenceAssetPath?: string;
  };
};

export class ResourceService {
  private static modelHasMorphTargets(model: SharedModel) {
    return model.nodes.some((node) => node.mesh?.subMeshes?.some((subMesh) => subMesh.numTargets > 0));
  }
  private static async prepareSourceMorphReference(
    model: SharedModel,
    manager: ResourceManager,
    path: string,
    srcVFS: VFS,
    saveOptions?: SaveOptions
  ) {
    if (
      !saveOptions?.sourceGlbReference ||
      !saveOptions.sourceModelPath ||
      !ResourceService.modelHasMorphTargets(model)
    ) {
      return null;
    }
    const sourceModelPath = saveOptions.sourceModelPath;
    const mimeType = srcVFS.guessMIMEType(sourceModelPath);
    if (mimeType !== 'model/gltf-binary') {
      console.info(`Skip source GLB morph reference for ${sourceModelPath}: only GLB/VRM sources are supported`);
      return null;
    }
    const targetSourcePath = manager.VFS.join(path, PathUtils.basename(sourceModelPath));
    await srcVFS.copyFile(sourceModelPath, targetSourcePath, {
      overwrite: true,
      targetVFS: manager.VFS
    });
    return manager.VFS.normalizePath(targetSourcePath);
  }
  static async importModel(srcVFS: VFS, path: string): Promise<SharedModel> {
    const mimeType = srcVFS.guessMIMEType(path);
    let loader: AbstractModelImporter = null;
    if (mimeType === 'model/gltf+json' || mimeType === 'model/gltf-binary') {
      console.info(`Start importing model ${path} - ${mimeType}`);
      loader = new GLTFImporter();
    } else if (mimeType === 'model/fbx') {
      console.info(`Start importing model ${path} - ${mimeType}`);
      loader = new FBXImporter();
    } else {
      throw new Error(`No valid loader found`);
    }
    ASSERT(!!loader, `Unsupported model type: ${mimeType}`);
    const data = (await srcVFS.readFile(path, { encoding: 'binary' })) as ArrayBuffer;
    const blob = new Blob([data], { type: mimeType });
    const model = new SharedModel();
    await loader.import(blob, model, PathUtils.dirname(path), srcVFS);
    return model;
  }
  static async savePrefabNode(
    node: SceneNode,
    manager: ResourceManager,
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
    const content = JSON.stringify({ type: 'SceneNode', data }, null, 2);
    const fn = name.endsWith('.zprefab') ? name : `${name}.zprefab`;
    await manager.VFS.writeFile(manager.VFS.join(path, fn), content, {
      encoding: 'utf8',
      create: true
    });
  }
  static async savePrefab(
    model: SharedModel,
    manager: ResourceManager,
    name: string,
    path: string,
    srcVFS: VFS,
    saveOptions?: SaveOptions
  ) {
    const sourceMorphReferenceAssetPath = await ResourceService.prepareSourceMorphReference(
      model,
      manager,
      path,
      srcVFS,
      saveOptions
    );
    const modelWithOptions = model as SharedModelWithPreprocessOptions;
    modelWithOptions._preprocessOptions = {
      rebuildMaterial: saveOptions?.rebuildMaterial ?? true,
      sourceMorphReferenceAssetPath: sourceMorphReferenceAssetPath ?? undefined
    };
    try {
      await model.preprocess(manager, name, path, srcVFS, getEngine().resourceManager.VFS);
      const prefabName = name.endsWith('.zprefab') ? name : `${name}.zprefab`;
      const prefabPath = manager.VFS.join(path, prefabName);
      if (!saveOptions?.rebuildPrefab && (await manager.VFS.exists(prefabPath))) {
        console.info(
          `Prefab already exists, keep existing prefab and refresh referenced assets only: ${prefabPath}`
        );
        return;
      }
      const saveMeshes = saveOptions?.importMeshes ?? true;
      const saveSkeletons = saveOptions?.importSkeletons ?? true;
      const saveAnimations = saveOptions?.importAnimations ?? true;
      const saveJointDynamics = saveOptions?.importJointDynamics ?? true;
      const tmpScene = new Scene();
      try {
        const node = await model.createSceneNode(
          manager,
          tmpScene,
          false,
          saveMeshes,
          saveSkeletons,
          saveAnimations,
          saveJointDynamics,
          getEngine().resourceManager.VFS
        );
        const numSkeletons = node.animationSet?.skeletons?.length ?? 0;
        const numAnimations = node.animationSet?.getAnimationNames().length ?? 0;
        await ResourceService.saveNodeToPrefab(node, manager, path, name);
        console.info(
          `Successfully created prefab with ${numSkeletons} skeletons and ${numAnimations} animations: ${path}`
        );
      } finally {
        tmpScene.dispose();
      }
    } finally {
      delete modelWithOptions._preprocessOptions;
    }
  }
  static async saveNodeToPrefab(
    node: SceneNode,
    manager: ResourceManager,
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
    const content = JSON.stringify({ type: 'SceneNode', data }, null, 2);
    const fn = name.endsWith('.zprefab') ? name : `${name}.zprefab`;
    await manager.VFS.writeFile(manager.VFS.join(path, fn), content, {
      encoding: 'utf8',
      create: true
    });
  }
}
