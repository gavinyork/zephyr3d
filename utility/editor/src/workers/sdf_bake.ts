// Bakes the signed distance field of a mesh and encodes it as a .zsdf, off the
// main thread: the closest-point query per voxel is the slow part of the bake.
import { bakeMeshSDF, writeZsdf } from '@zephyr3d/scene';
import type { MeshSDFBakeOptions, ZsdfHeader } from '@zephyr3d/scene';

export interface SDFBakeRequest {
  id: number;
  /** 3 floats per vertex, local space */
  positions: Float32Array;
  indices: Uint32Array;
  options: MeshSDFBakeOptions;
  source: NonNullable<ZsdfHeader['source']>;
}

export interface SDFBakeResponse {
  id: number;
  type: 'result' | 'error';
  data?: ArrayBuffer;
  resolution?: [number, number, number];
  voxelSize?: number;
  milliseconds?: number;
  message?: string;
}

self.onmessage = (e: MessageEvent<SDFBakeRequest>) => {
  const req = e.data;
  try {
    const start = performance.now();
    const sdf = bakeMeshSDF(req.positions, req.indices, req.options);
    const data = writeZsdf(sdf, req.source);
    const res: SDFBakeResponse = {
      id: req.id,
      type: 'result',
      data,
      resolution: sdf.resolution,
      voxelSize: sdf.voxelSize,
      milliseconds: performance.now() - start
    };
    (self as unknown as Worker).postMessage(res, [data]);
  } catch (err) {
    const res: SDFBakeResponse = {
      id: req.id,
      type: 'error',
      message: err instanceof Error ? err.message : String(err)
    };
    (self as unknown as Worker).postMessage(res);
  }
};
