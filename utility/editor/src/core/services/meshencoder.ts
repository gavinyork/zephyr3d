import { base64ToUint8Array } from '@zephyr3d/base';
import { writeZmshBinary } from '@zephyr3d/scene';
import type { MeshImportSettings, ZmshBinaryHeader } from '@zephyr3d/scene';
import type { VertexAttribFormat } from '@zephyr3d/device';
import type { SourceStream } from '../../helpers/meshquantize';
import type { MeshEncodeRequest, MeshEncodeResponse } from '../../workers/mesh_encode';

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
const pending = new Map<number, { resolve: (r: MeshEncodeResponse) => void; reject: (e: Error) => void }>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('../../workers/mesh_encode.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<MeshEncodeResponse>) => {
      const p = pending.get(e.data.id);
      if (p) {
        pending.delete(e.data.id);
        if (e.data.type === 'result') {
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
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...req, type: 'encode', id }, transfer);
  });
}

/**
 * Compresses a JSON .zmsh primitive into a binary meshopt .zmsh (container
 * version 2) following its mesh settings. Vertex order is kept: morph target
 * data, skins and geometry caches index vertices by position in the buffer.
 */
export async function encodeCompressedPrimitive(json: string, settings: MeshImportSettings) {
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
  const indexType =
    src.indices && (src.indexType === 'u16' || src.indexType === 'u32') ? src.indexType : null;
  let indices: Uint8Array | null = null;
  if (indexType) {
    const all = base64ToUint8Array(src.indices!);
    indices = all.slice(0, src.indexCount * (indexType === 'u16' ? 2 : 4));
  }
  const res = await runEncode({
    streams,
    indices,
    indexType,
    indexCount: src.indexCount,
    triangles: src.type === 'triangle-list',
    normalBits: settings.normalBits
  });
  return writeZmshBinary(
    {
      primitiveType: src.type,
      vertexCount: res.vertexCount!,
      indexCount: src.indexCount,
      boxMin: [src.boxMin[0], src.boxMin[1], src.boxMin[2]],
      boxMax: [src.boxMax[0], src.boxMax[1], src.boxMax[2]],
      encoding: 'meshopt',
      attributes: res.attributes!.map((a) => ({ ...a, format: a.format as VertexAttribFormat })),
      indices: indexType ? { type: indexType, mode: res.indexMode! } : null
    },
    res.streams!,
    res.indices ?? null
  );
}
