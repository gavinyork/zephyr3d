import { base64ToUint8Array } from '@zephyr3d/base';
import { writeZmshBinary } from '@zephyr3d/scene';
import type { MeshImportSettings, ZmshBinaryHeader, ZmshBinaryLod } from '@zephyr3d/scene';
import type { VertexAttribFormat } from '@zephyr3d/device';
import { describeFormat, readFloats } from '../../helpers/meshquantize';
import type { SourceStream } from '../../helpers/meshquantize';
import type {
  MeshEncodeRequest,
  MeshEncodeResponse,
  MeshLodRequest,
  MeshLodResponse
} from '../../workers/mesh_encode';

interface PrimitiveSource {
  vertices: Record<string, { format: string; data: string }>;
  indices: string | null;
  indexType: 'u16' | 'u32' | '';
  indexCount: number;
  type: ZmshBinaryHeader['primitiveType'];
  boxMin: number[];
  boxMax: number[];
}

/**
 * True for the JSON .zmsh form holding raw vertex buffers, the only one there is
 * anything to compress in; `Default` primitives are parametric shapes.
 */
export function isCompressiblePrimitive(
  content: unknown
): content is { type: 'Primitive'; data: PrimitiveSource } {
  const c = content as { type?: string; data?: { vertices?: unknown } };
  return c?.type === 'Primitive' && !!c.data?.vertices;
}

let worker: Worker | null = null;
let nextId = 1;
type WorkerResponse = MeshEncodeResponse | MeshLodResponse;
const pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('../../workers/mesh_encode.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = pending.get(e.data.id);
      if (p) {
        pending.delete(e.data.id);
        if (e.data.type !== 'error') {
          p.resolve(e.data);
        } else {
          p.reject(new Error(e.data.message));
        }
      }
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) {
        p.reject(new Error(e.message || 'Mesh encoder worker crashed'));
      }
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

function runEncode(req: Omit<MeshEncodeRequest, 'id' | 'type'>) {
  const id = nextId++;
  const transfer = [...req.streams.map((s) => s.data.buffer), ...(req.indices ? [req.indices.buffer] : [])];
  return new Promise<MeshEncodeResponse>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (r: WorkerResponse) => void, reject });
    getWorker().postMessage({ ...req, type: 'encode', id }, transfer);
  });
}

function runLod(req: Omit<MeshLodRequest, 'id' | 'type'>) {
  const id = nextId++;
  const transfer = [req.indices.buffer, req.positions.buffer, ...(req.normals ? [req.normals.buffer] : [])];
  return new Promise<MeshLodResponse>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (r: WorkerResponse) => void, reject });
    getWorker().postMessage({ ...req, type: 'lod', id }, transfer);
  });
}

/** Indices of a source primitive as 32 bit values, a sequence for a non-indexed one */
function readSourceIndices(src: PrimitiveSource, vertexCount: number) {
  if (src.indices && (src.indexType === 'u16' || src.indexType === 'u32')) {
    const bytes = base64ToUint8Array(src.indices).slice();
    const all =
      src.indexType === 'u16'
        ? new Uint16Array(bytes.buffer, 0, src.indexCount)
        : new Uint32Array(bytes.buffer, 0, src.indexCount);
    return Uint32Array.from(all);
  }
  const seq = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    seq[i] = i;
  }
  return seq;
}

/** Positions or normals as 3 floats per vertex, or null if the stream is missing or not float */
function readVec3(streams: SourceStream[], semantic: string, vertexCount: number) {
  const stream = streams.find((s) => s.semantic === semantic);
  const floats = stream ? readFloats(stream, vertexCount) : null;
  if (!floats || floats.count < 3) {
    return null;
  }
  const out = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    out.set(floats.values.subarray(i * floats.count, i * floats.count + 3), i * 3);
  }
  return out;
}

/**
 * Simplifies a source primitive into its level of detail chain, or returns null when the
 * settings ask for none, the mesh is not a triangle list or no coarser level could be made.
 */
async function buildLods(src: PrimitiveSource, streams: SourceStream[], settings: MeshImportSettings) {
  if (settings.lodCount <= 1 || src.type !== 'triangle-list') {
    return null;
  }
  const position = streams.find((s) => s.semantic === 'position');
  const fmt = position && describeFormat(position.format);
  if (!position || !fmt) {
    return null;
  }
  const vertexCount = position.data.byteLength / fmt.stride;
  const positions = readVec3(streams, 'position', vertexCount);
  const indices = readSourceIndices(src, vertexCount);
  if (!positions || indices.length < 3 || indices.length % 3 !== 0) {
    return null;
  }
  // The sphere the runtime measures the projected size with, around the bounds box
  const dx = (src.boxMax[0] - src.boxMin[0]) * 0.5;
  const dy = (src.boxMax[1] - src.boxMin[1]) * 0.5;
  const dz = (src.boxMax[2] - src.boxMin[2]) * 0.5;
  const res = await runLod({
    indices,
    positions,
    normals: readVec3(streams, 'normal', vertexCount),
    sphereRadius: Math.sqrt(dx * dx + dy * dy + dz * dz),
    settings: {
      lodCount: settings.lodCount,
      lodReduction: settings.lodReduction,
      lodPixelError: settings.lodPixelError
    }
  });
  if (res.levels!.length <= 1) {
    return null;
  }
  const levels: ZmshBinaryLod[] = res.levels!.map(({ indexStart, indexCount, screenSize, hysteresis }) => ({
    indexStart,
    indexCount,
    screenSize,
    hysteresis
  }));
  return { indices: res.indices!, levels, vertexCount };
}

/**
 * Turns a JSON .zmsh primitive into the binary .zmsh (container version 2) its mesh
 * settings ask for: meshopt-compressed and quantized, and/or with a level of detail
 * chain. Vertex order is kept: morph target data, skins and geometry caches index
 * vertices by position in the buffer, and every level draws the same vertices.
 */
export async function encodeDerivedPrimitive(json: string, settings: MeshImportSettings) {
  const content = JSON.parse(json);
  if (!isCompressiblePrimitive(content)) {
    throw new Error('Only primitives holding vertex buffers can be compressed');
  }
  const src = content.data;
  // Fresh copies: the buffers are transferred to the worker
  const streams: SourceStream[] = Object.entries(src.vertices).map(([semantic, v]) => ({
    semantic,
    format: v.format,
    data: base64ToUint8Array(v.data).slice()
  }));
  const lods = await buildLods(src, streams, settings);
  let indexType: 'u16' | 'u32' | null =
    src.indices && (src.indexType === 'u16' || src.indexType === 'u32') ? src.indexType : null;
  let indices: Uint8Array | null = null;
  let indexCount = src.indexCount;
  if (lods) {
    indexType ??= lods.vertexCount <= 0x10000 ? 'u16' : 'u32';
    const typed = indexType === 'u16' ? Uint16Array.from(lods.indices) : lods.indices;
    indices = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    indexCount = lods.indices.length;
  } else if (indexType) {
    const all = base64ToUint8Array(src.indices!);
    indices = all.slice(0, src.indexCount * (indexType === 'u16' ? 2 : 4));
  }
  const box = {
    boxMin: [src.boxMin[0], src.boxMin[1], src.boxMin[2]] as [number, number, number],
    boxMax: [src.boxMax[0], src.boxMax[1], src.boxMax[2]] as [number, number, number]
  };
  const lodHeader = lods ? { lods: lods.levels } : {};
  if (settings.compression === 'meshopt') {
    const res = await runEncode({
      streams,
      indices,
      indexType,
      indexCount,
      triangles: src.type === 'triangle-list',
      normalBits: settings.normalBits
    });
    return writeZmshBinary(
      {
        primitiveType: src.type,
        vertexCount: res.vertexCount!,
        indexCount,
        ...box,
        encoding: 'meshopt',
        attributes: res.attributes!.map((a) => ({ ...a, format: a.format as VertexAttribFormat })),
        indices: indexType ? { type: indexType, mode: res.indexMode! } : null,
        ...lodHeader
      },
      res.streams!,
      res.indices ?? null
    );
  }
  // Not compressed: the source streams as they are, with the level of detail indices
  let vertexCount = 0;
  const attributes = streams.map((stream) => {
    const fmt = describeFormat(stream.format);
    if (!fmt) {
      throw new Error(`Unknown vertex format ${stream.format}`);
    }
    if (stream.semantic === 'position') {
      vertexCount = stream.data.byteLength / fmt.stride;
    }
    return { format: stream.format as VertexAttribFormat, byteStride: fmt.stride };
  });
  return writeZmshBinary(
    {
      primitiveType: src.type,
      vertexCount,
      indexCount,
      ...box,
      encoding: 'none',
      attributes,
      indices: indexType
        ? { type: indexType, mode: src.type === 'triangle-list' ? 'TRIANGLES' : 'INDICES' }
        : null,
      ...lodHeader
    },
    streams.map((s) => s.data),
    indices
  );
}
