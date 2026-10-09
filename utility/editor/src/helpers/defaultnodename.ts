import { PathUtils } from '@zephyr3d/base';
import type { Nullable } from '@zephyr3d/base';
import type { Scene, SceneNode } from '@zephyr3d/scene';

export type SceneNodeCtor<T extends SceneNode = SceneNode> = { new (scene: Scene): T };

const ctorNameOverrides: Record<string, string> = {
  SceneNode: 'Empty Node',
  BatchGroup: 'Batch Group',
  ClipmapTerrain: 'Terrain',
  FoliageSystem: 'Foliage',
  MSDFText: 'MSDFText'
};

function toTitleCase(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => (word ? `${word[0].toUpperCase()}${word.slice(1)}` : ''))
    .join(' ');
}

export function getDefaultNodeNameFromAssetPath(path: string) {
  const ext = PathUtils.extname(path);
  return PathUtils.basename(path, ext);
}

export function getDefaultShapeNodeName(path: string) {
  const ext = PathUtils.extname(path);
  return toTitleCase(PathUtils.basename(path, ext));
}

export function getDefaultNodeNameFromCtor(ctor: SceneNodeCtor) {
  return ctorNameOverrides[ctor.name] ?? toTitleCase(ctor.name || 'Node');
}

export function ensureNodeDefaultName(node: Nullable<SceneNode>, name: string) {
  if (!node || node.name?.trim() || !name?.trim()) {
    return;
  }
  node.name = name;
}
