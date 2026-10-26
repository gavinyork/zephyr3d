/**
 * Signed distance field tools of the editor MCP bridge: baking mesh fields and
 * querying them at world positions.
 */
import { Vector3 } from '@zephyr3d/base';
import type { Mesh, SceneNode } from '@zephyr3d/scene';
import {
  getEngine,
  getSDFProgramErrors,
  Mesh as MeshNode,
  PlaneShape,
  sampleMeshSDF,
  SDFDebugMaterial
} from '@zephyr3d/scene';
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
  // Streamed copies of the rebaked fields are stale
  const sdf = controller?.model?.scene?.sdf;
  for (const r of results) {
    if (!r.skipped && !r.err) {
      sdf?.invalidate(r.path);
    }
  }
  sdf?.invalidate();
  return { results, err: null };
}

/**
 * State of the scene SDF: instances, streamed fields and atlas use. `enabled`
 * turns the tracking on or off first when given.
 */
export function getSceneSDFStats(controller: SceneController | null, params: any) {
  const scene = controller?.model?.scene ?? null;
  if (!scene) {
    return { stats: null, err: 'No scene is currently opened' };
  }
  if (typeof params.enabled === 'boolean') {
    scene.sdf.enabled = params.enabled;
  }
  const instances = [...scene.sdf.instances].map((inst) => ({
    node_id: inst.mesh.persistentId,
    mode: inst.mode,
    mesh: inst.asset?.meshPath ?? null,
    state: inst.asset ? inst.asset.state : 'no_asset',
    ready: scene.sdf.isReady(inst),
    slot: inst.asset ? scene.sdf.atlas.getSlot(inst.asset) : null,
    bounds: [
      [inst.bounds.minPoint.x, inst.bounds.minPoint.y, inst.bounds.minPoint.z],
      [inst.bounds.maxPoint.x, inst.bounds.maxPoint.y, inst.bounds.maxPoint.z]
    ]
  }));
  return {
    enabled: scene.sdf.enabled,
    stats: scene.sdf.getStats(),
    global: scene.sdf.global?.getStats() ?? null,
    program_errors: getSDFProgramErrors(),
    instances,
    err: null
  };
}

/** Name of the temporary slice plane {@link setSDFDebugSlice} manages. */
const SLICE_NODE_NAME = '__SDFDebugSlice';

/**
 * Shows a horizontal slice of the scene field: a plane with the SDF debug
 * material at `height`, `size` metres across, centred on `center` (default the
 * camera). `enabled: false` removes it. The plane is an ordinary node, so it
 * would be saved with the scene; remove it before saving.
 */
export function setSDFDebugSlice(controller: SceneController | null, params: any) {
  const scene = controller?.model?.scene ?? null;
  if (!scene) {
    return { node_id: null, err: 'No scene is currently opened' };
  }
  let node: SceneNode | null = null;
  scene.rootNode.iterate((n) => {
    if (n.name === SLICE_NODE_NAME) {
      node = n;
      return true;
    }
    return false;
  });
  if (params.enabled === false) {
    (node as SceneNode | null)?.remove();
    return { node_id: null, err: null };
  }
  if (!scene.sdf.enabled) {
    scene.sdf.enabled = true;
  }
  const size = Math.max(0.1, Number(params.size ?? 64));
  let mesh = node as MeshNode | null;
  if (!mesh) {
    const material = new SDFDebugMaterial();
    mesh = new MeshNode(scene, new PlaneShape({ size: 1, twoSided: true }), material);
    mesh.name = SLICE_NODE_NAME;
    mesh.sdfMode = 'none';
    mesh.castShadow = false;
    mesh.parent = scene.rootNode;
  }
  const material = mesh.material as SDFDebugMaterial;
  if (params.iso_spacing !== undefined) {
    material.isoSpacing = Number(params.iso_spacing);
  }
  const cam = scene.mainCamera?.getWorldPosition() ?? new Vector3();
  const [cx, cz] = Array.isArray(params.center) ? params.center.map(Number) : [cam.x, cam.z];
  mesh.position.setXYZ(cx, Number(params.height ?? 0), cz);
  mesh.scale.setXYZ(size, 1, size);
  return { node_id: mesh.persistentId, err: null };
}

/** Signed distance at world positions from the scene's global clipmap field, read back from the GPU. */
export async function sampleGlobalSDF(controller: SceneController | null, params: any) {
  const scene = controller?.model?.scene ?? null;
  if (!scene) {
    return { distances: null, err: 'No scene is currently opened' };
  }
  if (!scene.sdf.enabled) {
    return { distances: null, err: 'The scene SDF is off; enable it with sdf_stats { enabled: true }' };
  }
  const global = scene.sdf.global;
  if (!global) {
    return { distances: null, err: 'The global SDF needs WebGPU' };
  }
  const points: unknown[] = Array.isArray(params.points) ? params.points : [];
  const distances = await global.queryDistances(
    points.map((p) => {
      const [x, y, z] = (p as number[]).map(Number);
      return new Vector3(x, y, z);
    })
  );
  return { distances: Array.from(distances), global: global.getStats(), err: null };
}

/**
 * Signed distance from world positions to a mesh node's surface, from its baked
 * field. The field is in the mesh's local space; under non-uniform scale the
 * distance to the field box is measured per axis and the field's own value is
 * scaled by the smallest axis scale, which never overshoots.
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
  const clamp = (v: number, axis: number) => Math.min(Math.max(v, sdf.boxMin[axis]), sdf.boxMax[axis]);
  const distances = points.map((p) => {
    const [x, y, z] = (p as number[]).map(Number);
    inv.transformPointAffine(new Vector3(x, y, z), local);
    // As the scene field composites it: the distance to the field box per
    // axis in world units, the field's value on the box by the smallest scale
    const cx = clamp(local.x, 0);
    const cy = clamp(local.y, 1);
    const cz = clamp(local.z, 2);
    const outside = Math.hypot((local.x - cx) * sx, (local.y - cy) * sy, (local.z - cz) * sz);
    return sampleMeshSDF(sdf, cx, cy, cz) * scale + outside;
  });
  return {
    sdf_path: path,
    resolution: sdf.resolution,
    voxel_size: sdf.voxelSize * scale,
    distances,
    err: null
  };
}
