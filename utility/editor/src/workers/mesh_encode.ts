// Encodes mesh streams for the derived mesh cache: applies the meshopt filters
// the quantization plan asks for, then meshopt-encodes every stream with the
// KHR_meshopt_compression bitstream (version 1). The main thread assembles the
// .zmsh container, which keeps engine code out of this worker.
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { planMeshStreams } from '../helpers/meshquantize';
import type { MeshNormalBits, SourceStream } from '../helpers/meshquantize';

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

self.onmessage = (e: MessageEvent<MeshEncodeRequest>) => {
  const req = e.data;
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
