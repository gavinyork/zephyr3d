import { ASSERT, PathUtils, type VFS } from '@zephyr3d/base';
import type { AbstractModelImporter } from '@zephyr3d/loaders';
import { FBXImporter, GLTFImporter } from '@zephyr3d/loaders';
import {
  type AssetHierarchyNode,
  type AssetSkeleton,
  type HumanoidJointMapping,
  type SceneNode,
  type ResourceManager,
  Scene,
  Skeleton,
  getEngine,
  SharedModel
} from '@zephyr3d/scene';

export type SaveOptions = {
  importMeshes: boolean;
  importSkeletons: boolean;
  importAnimations: boolean;
  importJointDynamics: boolean;
  rebuildPrefab?: boolean;
  rebuildMaterial?: boolean;
  sourceReference?: boolean;
  sourceModelPath?: string;
};

type SharedModelWithPreprocessOptions = SharedModel & {
  _preprocessOptions?: {
    rebuildMaterial?: boolean;
    sourceMorphReferenceAssetPath?: string;
  };
};

export class ResourceService {
  private static normalizeSkeletonJointName(name: string) {
    const normalized = name.trim();
    const separator = Math.max(normalized.lastIndexOf(':'), normalized.lastIndexOf('|'));
    return normalized.slice(separator + 1).toLowerCase();
  }
  private static getUniqueJointMap(skeleton: AssetSkeleton) {
    const result = new Map<string, AssetHierarchyNode>();
    const duplicates = new Set<string>();
    for (const joint of skeleton.joints) {
      const name = ResourceService.normalizeSkeletonJointName(joint.name);
      if (result.has(name)) {
        result.delete(name);
        duplicates.add(name);
      } else if (!duplicates.has(name)) {
        result.set(name, joint);
      }
    }
    return result;
  }
  private static getSkeletonCompatibility(target: AssetSkeleton, reference: AssetSkeleton) {
    const targetJointSet = new Set(target.joints);
    const referenceJointSet = new Set(reference.joints);
    const referenceByName = ResourceService.getUniqueJointMap(reference);
    let nameMatches = 0;
    let hierarchyMatches = 0;
    const findSkeletonParent = (
      joint: AssetHierarchyNode,
      jointSet: Set<AssetHierarchyNode>
    ): AssetHierarchyNode | null => {
      let parent = joint.parent;
      while (parent && !jointSet.has(parent)) {
        parent = parent.parent;
      }
      return parent;
    };
    for (const targetJoint of target.joints) {
      const referenceJoint = referenceByName.get(
        ResourceService.normalizeSkeletonJointName(targetJoint.name)
      );
      if (!referenceJoint) {
        continue;
      }
      nameMatches++;
      const targetParent = findSkeletonParent(targetJoint, targetJointSet);
      const referenceParent = findSkeletonParent(referenceJoint, referenceJointSet);
      if (
        (!targetParent && !referenceParent) ||
        (targetParent &&
          referenceParent &&
          ResourceService.normalizeSkeletonJointName(targetParent.name) ===
            ResourceService.normalizeSkeletonJointName(referenceParent.name))
      ) {
        hierarchyMatches++;
      }
    }
    return { nameMatches, hierarchyMatches };
  }
  private static getAssetHumanoidMapping(skeleton: AssetSkeleton) {
    const mapping =
      skeleton.humanoidJointMapping ??
      (skeleton.root ? Skeleton.tryExtractHumanoidJoints(skeleton.root) : null);
    if (mapping && !skeleton.humanoidJointMapping) {
      skeleton.humanoidJointMapping = mapping;
    }
    return mapping;
  }
  private static flattenHumanoidMapping(mapping: HumanoidJointMapping<AssetHierarchyNode> | null) {
    const result = new Map<string, AssetHierarchyNode>();
    if (!mapping) {
      return result;
    }
    const append = (prefix: string, joints?: Record<string, AssetHierarchyNode>) => {
      if (joints) {
        for (const key of Object.keys(joints)) {
          result.set(`${prefix}:${key}`, joints[key]);
        }
      }
    };
    append('body', mapping.body);
    append('leftHand', mapping.leftHand);
    append('rightHand', mapping.rightHand);
    return result;
  }
  private static cloneAssetPoseTransform(skeleton: AssetSkeleton, joint: AssetHierarchyNode) {
    const index = skeleton.joints.indexOf(joint);
    if (index < 0) {
      return null;
    }
    const transform = skeleton.bindPose[index];
    return {
      position: transform.position.clone(),
      rotation: transform.rotation.clone(),
      scale: transform.scale.clone()
    };
  }
  /** Load a single-file GLB/VRM as an external retarget reference. */
  static async importRetargetPoseModel(file: File): Promise<SharedModel> {
    if (!/\.(glb|vrm|vrma)$/i.test(file.name)) {
      throw new Error('Retarget pose source must be a GLB, VRM, or VRMA file');
    }
    const model = new SharedModel();
    try {
      await new GLTFImporter().import(file, model, '', getEngine().resourceManager.VFS);
      return model;
    } catch (err) {
      model.dispose();
      throw err;
    }
  }
  /** Apply reference skeleton local transforms to matching skeletons in an imported model. */
  static applyRetargetPoseModel(model: SharedModel, referenceModel: SharedModel) {
    let skeletonCount = 0;
    let jointCount = 0;
    for (const targetSkeleton of model.skeletons) {
      const targetSemantic = ResourceService.flattenHumanoidMapping(
        ResourceService.getAssetHumanoidMapping(targetSkeleton)
      );
      let bestReference: AssetSkeleton | null = null;
      let bestScore = 0;
      for (const referenceSkeleton of referenceModel.skeletons) {
        const referenceSemantic = ResourceService.flattenHumanoidMapping(
          ResourceService.getAssetHumanoidMapping(referenceSkeleton)
        );
        const semanticMatches = [...targetSemantic.keys()].filter((key) => referenceSemantic.has(key)).length;
        const { nameMatches, hierarchyMatches } = ResourceService.getSkeletonCompatibility(
          targetSkeleton,
          referenceSkeleton
        );
        const minimumNameMatches = Math.max(
          1,
          Math.ceil(Math.min(targetSkeleton.joints.length, referenceSkeleton.joints.length) * 0.5)
        );
        const minimumHierarchyMatches = Math.ceil(nameMatches * 0.8);
        if (nameMatches < minimumNameMatches || hierarchyMatches < minimumHierarchyMatches) {
          continue;
        }
        const score = semanticMatches * 1000000 + hierarchyMatches * 1000 + nameMatches;
        if (score > bestScore) {
          bestScore = score;
          bestReference = referenceSkeleton;
        }
      }
      if (!bestReference) {
        continue;
      }

      const pose = targetSkeleton.bindPose.map((transform) => ({
        position: transform.position.clone(),
        rotation: transform.rotation.clone(),
        scale: transform.scale.clone()
      }));
      const matchedTargetIndices = new Set<number>();
      const referenceByName = ResourceService.getUniqueJointMap(bestReference);
      for (let i = 0; i < targetSkeleton.joints.length; i++) {
        const referenceJoint = referenceByName.get(
          ResourceService.normalizeSkeletonJointName(targetSkeleton.joints[i].name)
        );
        const transform = referenceJoint
          ? ResourceService.cloneAssetPoseTransform(bestReference, referenceJoint)
          : null;
        if (transform) {
          pose[i] = transform;
          matchedTargetIndices.add(i);
        }
      }
      const referenceSemantic = ResourceService.flattenHumanoidMapping(
        ResourceService.getAssetHumanoidMapping(bestReference)
      );
      for (const [key, targetJoint] of targetSemantic) {
        const referenceJoint = referenceSemantic.get(key);
        const targetIndex = targetSkeleton.joints.indexOf(targetJoint);
        const transform = referenceJoint
          ? ResourceService.cloneAssetPoseTransform(bestReference, referenceJoint)
          : null;
        if (targetIndex >= 0 && transform) {
          pose[targetIndex] = transform;
          matchedTargetIndices.add(targetIndex);
        }
      }
      if (matchedTargetIndices.size > 0) {
        targetSkeleton.retargetPose = pose;
        skeletonCount++;
        jointCount += matchedTargetIndices.size;
      }
    }
    if (skeletonCount === 0) {
      throw new Error('The external pose GLB does not contain a skeleton matching this asset');
    }
    return { skeletonCount, jointCount };
  }
  static clearRetargetPose(model: SharedModel) {
    for (const skeleton of model.skeletons) {
      skeleton.retargetPose = null;
    }
  }
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
      !saveOptions?.sourceReference ||
      !saveOptions.sourceModelPath ||
      !ResourceService.modelHasMorphTargets(model)
    ) {
      return null;
    }
    const sourceModelPath = saveOptions.sourceModelPath;
    const mimeType = srcVFS.guessMIMEType(sourceModelPath);
    if (mimeType !== 'model/gltf-binary' && mimeType !== 'model/fbx') {
      console.info(
        `Skip source morph reference for ${sourceModelPath}: only single-file GLB/VRM/FBX sources are supported`
      );
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
