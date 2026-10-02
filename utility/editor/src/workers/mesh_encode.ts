// Encodes mesh streams for the derived mesh cache: applies the meshopt filters
// the quantization plan asks for, then meshopt-encodes every stream with the
// KHR_meshopt_compression bitstream (version 1). Also simplifies meshes into their
// level of detail chain. The main thread assembles the .zmsh container, which
// keeps engine code out of this worker.
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import { planMeshStreams } from '../helpers/meshquantize';
import type { MeshNormalBits, SourceStream } from '../helpers/meshquantize';
import { buildLodChain } from '../helpers/meshlod';
import type { MeshLodLevel, MeshLodSettings, MeshSimplifier } from '../helpers/meshlod';

export interface MeshEncodeRequest {
  type: 'encode';
  id: number;
  streams: SourceStream[];
  indices: Uint8Array | null;
  indexType: 'u16' | 'u32' | null;
  indexCount: number;
  triangles: boolean;
  normalBits: MeshNormalBits;
}

export interface MeshLodRequest {
  type: 'lod';
  id: number;
  indices: Uint32Array;
  /** 3 floats per vertex */
  positions: Float32Array;
  /** 3 floats per vertex, or null */
  normals: Float32Array | null;
  sphereRadius: number;
  settings: MeshLodSettings;
}

export interface MeshLodResponse {
  type: 'lod-result' | 'error';
  id: number;
  indices?: Uint32Array;
  levels?: MeshLodLevel[];
  message?: string;
}

export interface MeshEncodeResponse {
  type: 'result' | 'error';
  id: number;
  vertexCount?: number;
  attributes?: { format: string; byteStride: number; filter?: string }[];
  streams?: Uint8Array[];
  indices?: Uint8Array | null;
  indexMode?: 'TRIANGLES' | 'INDICES';
  message?: string;
}

const VERSION = 1;

async function encode(req: MeshEncodeRequest): Promise<MeshEncodeResponse> {
  await MeshoptEncoder.ready;
  const { vertexCount, plans } = planMeshStreams(req.streams, req.normalBits);
  const attributes: NonNullable<MeshEncodeResponse['attributes']> = [];
  const streams: Uint8Array[] = [];
  for (const plan of plans) {
    let data: Uint8Array;
    let filter: string | undefined;
    switch (plan.kind) {
      case 'octahedral':
        data = MeshoptEncoder.encodeFilterOct(plan.vectors, vertexCount, plan.byteStride, plan.bits);
        filter = 'OCTAHEDRAL';
        break;
      case 'color':
        data = MeshoptEncoder.encodeFilterColor(plan.colors, vertexCount, plan.byteStride, 8);
        filter = 'COLOR';
        break;
      default:
        data = plan.data;
        break;
    }
    streams.push(MeshoptEncoder.encodeGltfBuffer(data, vertexCount, plan.byteStride, 'ATTRIBUTES', VERSION));
    attributes.push({ format: plan.format, byteStride: plan.byteStride, filter });
  }
  let indices: Uint8Array | null = null;
  // TRIANGLES compresses triangle lists far better; INDICES takes any topology
  const indexMode = req.triangles && req.indexCount % 3 === 0 ? 'TRIANGLES' : 'INDICES';
  if (req.indices && req.indexType) {
    const size = req.indexType === 'u16' ? 2 : 4;
    indices = MeshoptEncoder.encodeGltfBuffer(req.indices, req.indexCount, size, indexMode, VERSION);
  }
  return { type: 'result', id: req.id, vertexCount, attributes, streams, indices, indexMode };
}

async function lod(req: MeshLodRequest): Promise<MeshLodResponse> {
  await MeshoptSimplifier.ready;
  const { indices, levels } = buildLodChain(
    MeshoptSimplifier as unknown as MeshSimplifier,
    req.indices,
    req.positions,
    req.normals,
    req.sphereRadius,
    req.settings
  );
  return { type: 'lod-result', id: req.id, indices, levels };
}

self.onmessage = (e: MessageEvent<MeshEncodeRequest | MeshLodRequest>) => {
  const req = e.data;
  if (req.type === 'lod') {
    lod(req).then(
      (res) => (self as unknown as Worker).postMessage(res, [res.indices!.buffer]),
      (err) =>
        (self as unknown as Worker).postMessage({
          type: 'error',
          id: req.id,
          message: String(err?.message ?? err)
        } as MeshLodResponse)
    );
    return;
  }
  encode(req).then(
    (res) =>
      (self as unknown as Worker).postMessage(res, [
        ...res.streams!.map((s) => s.buffer),
        ...(res.indices ? [res.indices.buffer] : [])
      ]),
    (err) =>
      (self as unknown as Worker).postMessage({
        type: 'error',
        id: req.id,
        message: String(err?.message ?? err)
      } as MeshEncodeResponse)
  );
};
