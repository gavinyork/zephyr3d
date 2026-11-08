import type { Nullable } from '@zephyr3d/base';
import { Matrix4x4 } from '@zephyr3d/base';
import type { Scene } from '../scene/scene';
import { SceneNode } from '../scene/scene_node';
import type { MeshMaterial } from '../material/meshmaterial';
import { getEngine } from '../app/api';
import type { ImpostorBakePart, ImpostorBakeSettings } from '../render/impostor/baker';

/**
 * Directory impostors are baked into, one sub-directory per baked asset
 * @public
 */
export const IMPOSTOR_DIR = '/assets/.impostor';

/** Version of the impostor files, bumped when their layout changes @public */
export const IMPOSTOR_VERSION = 1;

/**
 * Description of a baked impostor, `impostor.json` beside its atlases
 * @public
 */
export interface ImpostorInfo {
  version: number;
  /** Asset the impostor was baked from */
  asset: string;
  /** Hash of the asset and every file it refers to, and of the settings; a changed one needs a rebake */
  hash: string;
  settings: ImpostorBakeSettings;
  /** Centre of the bounding sphere, in the asset's space */
  center: [number, number, number];
  /** Radius of the bounding sphere */
  radius: number;
  /** Edge of the normal-depth and occlusion atlases */
  detailSize: number;
}

/**
 * Directory of the impostor baked for an asset: its path flattened into one name under
 * {@link IMPOSTOR_DIR}, so the runtime finds it without an index
 * @param assetPath - Path of the prefab or model, e.g. `/assets/trees/pine.zprefab`
 * @public
 */
export function getImpostorDir(assetPath: string) {
  const rel = assetPath.replace(/^\/assets\//, '').replace(/^\/+/, '');
  return `${IMPOSTOR_DIR}/${rel.replace(/[\\/]/g, '__')}`;
}

/**
 * Files of the impostor baked for an asset
 * @param assetPath - Path of the prefab or model
 * @public
 */
export function getImpostorFiles(assetPath: string) {
  const dir = getImpostorDir(assetPath);
  return {
    dir,
    info: `${dir}/impostor.json`,
    base: `${dir}/base.png`,
    normalDepth: `${dir}/normaldepth.png`,
    orm: `${dir}/orm.png`
  };
}

/**
 * Loads a prefab or model and takes its static meshes, in the asset's own space, as the parts an
 * impostor is baked from. Skinned and morphed meshes are left out, as foliage leaves them out.
 *
 * @param scene - Scene to load the asset into, off its graph
 * @param assetPath - Path of the prefab (.zprefab) or model
 * @returns The parts, and a function releasing what was loaded
 * @public
 */
export async function loadImpostorParts(
  scene: Scene,
  assetPath: string
): Promise<{ parts: ImpostorBakePart[]; skipped: string[]; dispose: () => void }> {
  const tmp = new SceneNode(scene);
  tmp.remove();
  const manager = getEngine().resourceManager;
  let root: Nullable<SceneNode> = null;
  try {
    root = assetPath.toLowerCase().endsWith('.zprefab')
      ? await manager.instantiatePrefab(tmp, assetPath)
      : ((await manager.fetchModel(assetPath, scene)) ?? null);
  } catch (err) {
    tmp.dispose();
    throw err;
  }
  if (root) {
    root.parent = tmp;
    root.position.setXYZ(0, 0, 0);
    root.rotation.identity();
    root.scale.setXYZ(1, 1, 1);
  }
  const parts: ImpostorBakePart[] = [];
  const skipped: string[] = [];
  root?.iterate((node) => {
    if (node.isMesh() && node.primitive && node.material) {
      if (node.skeletonName || node.morphTargetGroups?.length) {
        skipped.push(node.name || node.primitive.constructor.name);
      } else {
        parts.push({
          primitive: node.primitive,
          material: node.material as MeshMaterial,
          matrix: new Matrix4x4(node.worldMatrix)
        });
      }
    }
    return false;
  });
  return { parts, skipped, dispose: () => tmp.dispose() };
}
