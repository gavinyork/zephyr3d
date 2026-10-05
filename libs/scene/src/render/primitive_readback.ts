import { PBPrimitiveType } from '@zephyr3d/device';
import type { Primitive } from './primitive';

/**
 * Triangles read back from a primitive, with only the vertices they use.
 *
 * @public
 */
export interface PrimitiveTriangles {
  /** Vertex positions in the primitive's local space, xyz per vertex. */
  positions: Float32Array<ArrayBuffer>;
  /** Three indices into `positions` per triangle. */
  indices: Uint32Array<ArrayBuffer>;
}

function scalarByteSize(type: PBPrimitiveType) {
  switch (type) {
    case PBPrimitiveType.I16:
    case PBPrimitiveType.I16_NORM:
    case PBPrimitiveType.U16:
    case PBPrimitiveType.U16_NORM:
    case PBPrimitiveType.F16:
      return 2;
    case PBPrimitiveType.I32:
    case PBPrimitiveType.I32_NORM:
    case PBPrimitiveType.U32:
    case PBPrimitiveType.U32_NORM:
    case PBPrimitiveType.F32:
      return 4;
    default:
      return 1;
  }
}

function readScalar(view: DataView, byteOffset: number, scalarType: PBPrimitiveType, normalized: boolean) {
  switch (scalarType) {
    case PBPrimitiveType.I8:
    case PBPrimitiveType.I8_NORM: {
      const value = view.getInt8(byteOffset);
      return normalized ? Math.max(-1, value / 127) : value;
    }
    case PBPrimitiveType.U8:
    case PBPrimitiveType.U8_NORM: {
      const value = view.getUint8(byteOffset);
      return normalized ? value / 255 : value;
    }
    case PBPrimitiveType.I16:
    case PBPrimitiveType.I16_NORM: {
      const value = view.getInt16(byteOffset, true);
      return normalized ? Math.max(-1, value / 32767) : value;
    }
    case PBPrimitiveType.U16:
    case PBPrimitiveType.U16_NORM: {
      const value = view.getUint16(byteOffset, true);
      return normalized ? value / 65535 : value;
    }
    case PBPrimitiveType.I32:
    case PBPrimitiveType.I32_NORM: {
      const value = view.getInt32(byteOffset, true);
      return normalized ? Math.max(-1, value / 2147483647) : value;
    }
    case PBPrimitiveType.U32:
    case PBPrimitiveType.U32_NORM: {
      const value = view.getUint32(byteOffset, true);
      return normalized ? value / 4294967295 : value;
    }
    case PBPrimitiveType.F32:
      return view.getFloat32(byteOffset, true);
    default:
      return 0;
  }
}

/**
 * Reads a vertex attribute of a primitive back from the GPU, as tightly packed
 * floats: `componentCount` per vertex, for every vertex in the vertex buffer.
 *
 * @remarks
 * Handles interleaved buffers and integer formats, normalized or not. Half
 * float attributes are not supported and throw.
 *
 * @returns The data, or null if the primitive has no such attribute or it has
 *   fewer than `componentCount` components.
 *
 * @public
 */
export async function readPrimitiveAttribute(
  primitive: Primitive,
  semantic: 'position' | 'normal' | 'blendIndices' | 'blendWeights',
  componentCount: number
): Promise<Float32Array<ArrayBuffer> | null> {
  const info = primitive.getVertexBufferInfo(semantic);
  if (!info || !info.type.isPrimitiveType() || info.type.cols < componentCount) {
    return null;
  }
  const vertexCount = primitive.getNumVertices();
  if (vertexCount <= 0) {
    return null;
  }
  const bytes = await info.buffer.getBufferSubData();
  const result = new Float32Array(vertexCount * componentCount);
  const scalarType = info.type.scalarType;
  const normalized = info.type.normalized;
  const componentByteSize = scalarByteSize(scalarType);
  const baseByteOffset = info.drawOffset + info.offset;
  if (
    scalarType === PBPrimitiveType.F32 &&
    !normalized &&
    baseByteOffset % 4 === 0 &&
    info.stride % 4 === 0
  ) {
    const raw = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
    const stride = info.stride >> 2;
    const srcOffset = baseByteOffset >> 2;
    for (let i = 0; i < vertexCount; i++) {
      const src = srcOffset + i * stride;
      const dst = i * componentCount;
      for (let c = 0; c < componentCount; c++) {
        result[dst + c] = raw[src + c];
      }
    }
    return result;
  }
  if (scalarType === PBPrimitiveType.F16) {
    throw new Error(`Unsupported ${semantic} attribute format: half float`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < vertexCount; i++) {
    const src = baseByteOffset + i * info.stride;
    const dst = i * componentCount;
    for (let c = 0; c < componentCount; c++) {
      result[dst + c] = readScalar(view, src + c * componentByteSize, scalarType, normalized);
    }
  }
  return result;
}

/**
 * Reads a range of a triangle-list primitive's indices back from the GPU, as
 * indices into its whole vertex buffer.
 *
 * @remarks
 * The range defaults to what the primitive draws at full detail: its
 * `indexStart` and `indexCount`, which for a primitive with LODs is LOD 0 only
 * (the other levels are further ranges of the same index buffer). For a
 * primitive without an index buffer the range is of vertices.
 *
 * @public
 */
export async function readPrimitiveIndices(
  primitive: Primitive,
  indexStart = primitive.indexStart,
  indexCount = primitive.indexCount
): Promise<Uint32Array<ArrayBuffer>> {
  if (primitive.primitiveType !== 'triangle-list') {
    throw new Error(`Only triangle-list primitives can be read as triangles, not ${primitive.primitiveType}`);
  }
  if (indexCount <= 0 || indexCount % 3 !== 0 || indexStart < 0) {
    throw new Error(`Invalid triangle range: start ${indexStart}, count ${indexCount}`);
  }
  const indexBuffer = primitive.getIndexBuffer();
  if (!indexBuffer) {
    if (indexStart + indexCount > primitive.getNumVertices()) {
      throw new Error(`Invalid triangle range: start ${indexStart}, count ${indexCount}`);
    }
    const indices = new Uint32Array(indexCount);
    for (let i = 0; i < indexCount; i++) {
      indices[i] = indexStart + i;
    }
    return indices;
  }
  const bytes = await indexBuffer.getBufferSubData();
  const is16 = indexBuffer.indexType.primitiveType === PBPrimitiveType.U16;
  const all = is16
    ? new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1)
    : new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
  if (indexStart + indexCount > all.length) {
    throw new Error(`Invalid triangle range: start ${indexStart}, count ${indexCount}`);
  }
  return Uint32Array.from(all.subarray(indexStart, indexStart + indexCount));
}

/**
 * Reads the triangles of one level of detail of a triangle-list primitive back
 * from the GPU, keeping only the vertices they use.
 *
 * @param lod - Level of detail; 0 is full detail. Levels beyond the primitive's
 *   lowest detail use the lowest.
 *
 * @public
 */
export async function readPrimitiveTriangles(primitive: Primitive, lod = 0): Promise<PrimitiveTriangles> {
  const level = Math.min(Math.max(0, Math.floor(lod)), primitive.lods.length);
  const [indexStart, indexCount] =
    level === 0
      ? [primitive.indexStart, primitive.indexCount]
      : [primitive.lods[level - 1].indexStart, primitive.lods[level - 1].indexCount];
  const [positions, indices] = await Promise.all([
    readPrimitiveAttribute(primitive, 'position', 3),
    readPrimitiveIndices(primitive, indexStart, indexCount)
  ]);
  if (!positions) {
    throw new Error('Primitive has no vertex positions');
  }
  // Other levels share the vertex buffer; keep only the vertices this one uses.
  const vertexCount = positions.length / 3;
  const remap = new Int32Array(vertexCount).fill(-1);
  let used = 0;
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    if (v >= vertexCount) {
      throw new Error(`Index ${v} out of range of ${vertexCount} vertices`);
    }
    if (remap[v] < 0) {
      remap[v] = used++;
    }
    indices[i] = remap[v];
  }
  const compact = new Float32Array(used * 3);
  for (let v = 0; v < vertexCount; v++) {
    const dst = remap[v];
    if (dst >= 0) {
      compact[dst * 3] = positions[v * 3];
      compact[dst * 3 + 1] = positions[v * 3 + 1];
      compact[dst * 3 + 2] = positions[v * 3 + 2];
    }
  }
  return { positions: compact, indices };
}
