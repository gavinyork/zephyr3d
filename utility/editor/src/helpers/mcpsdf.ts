/**
 * Signed distance field tools of the editor MCP bridge: baking mesh fields and
 * querying them at world positions.
 */
import { Vector3 } from '@zephyr3d/base';
import type { Mesh, SceneNode } from '@zephyr3d/scene';
import { getEngine, sampleMeshSDF } from '@zephyr3d/scene';
import type { SceneController } from '../controllers/scenecontroller';
import { MeshSDFBaker } from '../core/services/sdfbaker';

/** Mesh asset paths used by the meshes under a node, the node included */
function collectMeshPaths(root: SceneNode) {
  const paths = new Set<string>();
  root.iterate((node) => {
    if (node.isMesh()) {
      const primitive = (node as Mesh).primitive;
      const id = primitive ? getEngine().resourceManager.getAssetId(primitive) : null;
      if (id && id.toLowerCase().endsWith('.zmsh')) {
        paths.add(id);
      }
    }
    return false;
  });
  return [...paths];
}

/**
 * Bakes mesh fields: the meshes at `paths`, or every mesh used in the current
 * scene (under `node_id` when given). Up-to-date fields are skipped unless `force`.
 */
export async function bakeMeshSDFs(controller: SceneController | null, params: any) {
  let paths: string[];
  if (Array.isArray(params.paths) && params.paths.length > 0) {
    paths = params.paths.map((p: unknown) => String(p));
  } else {
    const scene = controller?.model?.scene ?? null;
    if (!scene) {
      return { results: null, err: 'No scene is currently opened; pass `paths`' };
    }
    const root = params.node_id ? scene.findNodeById<SceneNode>(String(params.node_id)) : scene.rootNode;
    if (!root) {
      return { results: null, err: `Node not found in current scene: ${params.node_id}` };
    }
    paths = collectMeshPaths(root);
  }
  const results = await MeshSDFBaker.bakeAll(paths, !!params.force);
  return { results, err: null };
}

/**
 * Signed distance from world positions to a mesh node's surface, from its baked
 * field. The field is in the mesh's local space; under non-uniform scale the
 * local distance is scaled by the smallest axis scale, which never overshoots.
 */
export async function queryMeshSDF(controller: SceneController | null, params: any) {
  const scene = controller?.model?.scene ?? null;
  if (!scene) {
    return { distances: null, err: 'No scene is currently opened' };
  }
  const node = scene.findNodeById<SceneNode>(String(params.node_id ?? ''));
  if (!node || !node.isMesh()) {
    return { distances: null, err: `Not a mesh node: ${params.node_id}` };
  }
  const primitive = (node as Mesh).primitive;
  const path = primitive ? getEngine().resourceManager.getAssetId(primitive) : null;
  if (!path) {
    return { distances: null, err: 'The mesh has no primitive asset' };
  }
  const sdf = await MeshSDFBaker.load(path);
  if (!sdf) {
    return { distances: null, err: `No distance field baked for ${path}; run sdf_bake first` };
  }
  const points: unknown[] = Array.isArray(params.points) ? params.points : [];
  const m = node.worldMatrix;
  const sx = Math.hypot(m.m00, m.m10, m.m20);
  const sy = Math.hypot(m.m01, m.m11, m.m21);
  const sz = Math.hypot(m.m02, m.m12, m.m22);
  const scale = Math.min(sx, sy, sz);
  const inv = node.invWorldMatrix;
  const local = new Vector3();
  const distances = points.map((p) => {
    const [x, y, z] = (p as number[]).map(Number);
    inv.transformPointAffine(new Vector3(x, y, z), local);
    return sampleMeshSDF(sdf, local.x, local.y, local.z) * scale;
  });
  return {
    sdf_path: path,
    resolution: sdf.resolution,
    voxel_size: sdf.voxelSize * scale,
    distances,
    err: null
  };
}
