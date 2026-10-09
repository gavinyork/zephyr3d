/**
 * Asset tools of the editor MCP bridge: importing models into prefabs, and saving scene nodes as prefabs.
 */
import { MemoryFS, PathUtils, base64ToUint8Array } from '@zephyr3d/base';
import type { VFS } from '@zephyr3d/base';
import { getEngine } from '@zephyr3d/scene';
import type { Editor } from '../core/editor';
import type { SceneController } from '../controllers/scenecontroller';
import { ProjectService } from '../core/services/project';
import { ResourceService } from '../core/services/resource';
import { DerivedAssetService } from '../core/services/derivedassets';
import { eventBus } from '../core/eventbus';

function checkWritableDir(dir: string) {
  const path = ProjectService.VFS.normalizePath(dir);
  if (!path.startsWith('/assets/') || path.startsWith('/assets/@builtins')) {
    return { path: null, err: `Destination must be under /assets and outside /assets/@builtins: ${dir}` };
  }
  return { path, err: null };
}

/**
 * Imports a model (glTF, glb, fbx...) into a prefab plus its meshes, materials and textures,
 * the same way as importing it through the content browser.
 *
 * The model comes either as files downloaded by the MCP server (`files`, base64, `main` naming the
 * model file among them) or as a model already in the project (`src_path`).
 */
export async function importModelAsset(_editor: Editor, params: any) {
  const dest = checkWritableDir(String(params.dest_dir ?? ''));
  if (!dest.path) {
    return { prefab_path: null, err: dest.err };
  }
  let srcVFS: VFS;
  let srcPath: string;
  if (Array.isArray(params.files) && params.files.length > 0) {
    const fs = new MemoryFS();
    for (const file of params.files) {
      const path = `/${String(file.path).replace(/^\/+/, '')}`;
      const dir = PathUtils.dirname(path);
      if (dir && dir !== '/' && !(await fs.exists(dir))) {
        await fs.makeDirectory(dir, true);
      }
      await fs.writeFile(path, base64ToUint8Array(String(file.content)).buffer as ArrayBuffer, {
        encoding: 'binary',
        create: true
      });
    }
    srcVFS = fs;
    srcPath = `/${String(params.main).replace(/^\/+/, '')}`;
  } else if (typeof params.src_path === 'string' && params.src_path.trim()) {
    srcVFS = ProjectService.VFS;
    srcPath = ProjectService.VFS.normalizePath(params.src_path.trim());
    if (!(await srcVFS.exists(srcPath))) {
      return { prefab_path: null, err: `Model not found: ${srcPath}` };
    }
  } else {
    return { prefab_path: null, err: 'Pass `url` or `src_path`' };
  }
  const ext = PathUtils.extname(srcPath);
  const name =
    typeof params.name === 'string' && params.name.trim()
      ? params.name.trim().replace(/\.zprefab$/i, '')
      : PathUtils.basename(srcPath, ext);
  const model = await ResourceService.importModel(srcVFS, srcPath);
  const generateLods = params.generate_lods !== false;
  await ResourceService.savePrefab(model, getEngine().resourceManager, name, dest.path, srcVFS, {
    importMeshes: model.primitives.length > 0,
    importSkeletons: params.import_skeletons !== false && model.skeletons.length > 0,
    importAnimations: params.import_animations !== false && model.animations.length > 0,
    importJointDynamics: model.jointDynamicsSpringBones.length > 0,
    rebuildPrefab: true,
    rebuildMaterial: true,
    compressTextures: !!params.compress_textures,
    compressVertices: !!params.compress_vertices,
    generateLods,
    ...(params.lod_reduction !== undefined ? { lodReduction: Number(params.lod_reduction) } : {}),
    ...(params.lod_min_triangles !== undefined ? { lodMinTriangles: Number(params.lod_min_triangles) } : {})
  });
  const meshes = model.primitives.map((info) => info.path).filter((path): path is string => !!path);
  if (generateLods && meshes.length > 0) {
    await DerivedAssetService.deriveMeshesNow(meshes);
  }
  const prefabPath = ProjectService.VFS.join(dest.path, `${name}.zprefab`);
  eventBus.dispatchEvent('reveal_asset', prefabPath);
  return {
    prefab_path: prefabPath,
    meshes,
    num_textures: model.imageCount,
    num_animations: model.animations.length,
    err: null
  };
}

/** Saves a scene node and its descendants as a .zprefab asset */
export async function saveNodeAsPrefab(controller: SceneController | null, params: any) {
  const scene = controller?.model?.scene ?? null;
  if (!scene) {
    return { prefab_path: null, err: 'No scene is currently opened' };
  }
  const node = scene.findNodeById(String(params.node_id ?? ''));
  if (!node) {
    return { prefab_path: null, err: `Node not found in current scene: ${params.node_id}` };
  }
  let hasTerrain = false;
  node.iterate((child) => {
    hasTerrain ||= child.isClipmapTerrain();
    return false;
  });
  if (hasTerrain) {
    return { prefab_path: null, err: 'A terrain cannot be saved as a prefab' };
  }
  const path = ProjectService.VFS.normalizePath(String(params.path ?? ''));
  const dest = checkWritableDir(PathUtils.dirname(path));
  if (!dest.path) {
    return { prefab_path: null, err: dest.err };
  }
  const fileName = PathUtils.basename(path).toLowerCase().endsWith('.zprefab')
    ? PathUtils.basename(path)
    : `${PathUtils.basename(path)}.zprefab`;
  if (!(await ProjectService.VFS.exists(dest.path))) {
    await ProjectService.VFS.makeDirectory(dest.path, true);
  }
  await ResourceService.savePrefabNode(node, getEngine().resourceManager, dest.path, fileName);
  const prefabPath = ProjectService.VFS.join(dest.path, fileName);
  eventBus.dispatchEvent('reveal_asset', prefabPath);
  return { prefab_path: prefabPath, err: null };
}
