// Turns the vertex streams of a JSON .zmsh into the streams a compressed .zmsh
// stores: which attributes get quantized, to what format, through which meshopt
// filter. Pure data work with no engine or meshoptimizer imports, so it runs in
// the encoding worker and in unit tests alike; the worker applies the meshopt
// filters and stream encoding the plan asks for.
//
// What is quantized and why (see the phase 6 plan):
//  - normals and tangents: octahedral, snorm8 at 8 bits, snorm16 at 12/16 bits;
//    the shader reads normalized integers as floats, so nothing else changes
//  - vertex colours within [0, 1]: unorm8 through the COLOR filter
//  - skin weights: unorm8, rounded so every vertex sums to exactly 255
//  - positions, texture coordinates, skin indices: unchanged; quantizing them
//    needs decode work in shaders or breaks consumers that read them as floats
// Every stream is then meshopt-encoded losslessly.

export type MeshNormalBits = 0 | 8 | 12 | 16;

/** Source vertex stream as stored in a JSON .zmsh */
export interface SourceStream {
  semantic: string;
  format: string;
  data: Uint8Array;
}

/** How one stream goes into the compressed file */
export type StreamPlan =
  | { kind: 'copy'; format: string; data: Uint8Array; byteStride: number }
  | {
      kind: 'octahedral';
      format: string;
      /** Unit vectors, 4 floats per vertex (w kept, used for the tangent sign) */
      vectors: Float32Array;
      byteStride: 4 | 8;
      bits: number;
    }
  | { kind: 'color'; format: string; colors: Float32Array; byteStride: 4 }
  | { kind: 'weights'; format: string; data: Uint8Array; byteStride: 4 };

/** Bytes per component and count of the formats a JSON .zmsh may hold */
export function describeFormat(format: string) {
  const m = /_(u8norm|i8norm|u16norm|i16norm|u16|i16|u32|i32|f16|f32)x?(\d)?$/.exec(format);
  if (!m) {
    return null;
  }
  const type = m[1];
  const count = Number(m[2] ?? 1);
  const size = type.includes('8') ? 1 : type.includes('16') ? 2 : 4;
  return { type, count, size, stride: size * count };
}

function halfToFloat(h: number) {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) {
    return s * 2 ** -14 * (f / 1024);
  }
  if (e === 31) {
    return f ? NaN : s * Infinity;
  }
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

/** Reads a float stream (f32 or f16) as `count` components per vertex, or null for other types */
export function readFloats(stream: SourceStream, vertexCount: number) {
  const fmt = describeFormat(stream.format);
  if (!fmt || (fmt.type !== 'f32' && fmt.type !== 'f16')) {
    return null;
  }
  const view = new DataView(stream.data.buffer, stream.data.byteOffset, stream.data.byteLength);
  const out = new Float32Array(vertexCount * fmt.count);
  for (let i = 0; i < out.length; i++) {
    out[i] = fmt.type === 'f32' ? view.getFloat32(i * 4, true) : halfToFloat(view.getUint16(i * 2, true));
  }
  return { values: out, count: fmt.count };
}

/** Normalizes 3- or 4-component vectors into 4 floats per vertex, `w` defaulting to `defaultW` */
function toUnitVec4(values: Float32Array, count: number, vertexCount: number, defaultW: number) {
  const out = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) {
    const x = values[i * count];
    const y = values[i * count + 1];
    const z = values[i * count + 2];
    const len = Math.hypot(x, y, z);
    const k = len > 1e-12 ? 1 / len : 0;
    out[i * 4] = x * k;
    out[i * 4 + 1] = y * k;
    // A degenerate vector still has to encode as something valid; +Z is what glTF tools use
    out[i * 4 + 2] = len > 1e-12 ? z * k : 1;
    out[i * 4 + 3] = count >= 4 ? (values[i * count + 3] < 0 ? -1 : 1) : defaultW;
  }
  return out;
}

/**
 * Quantizes skin weights to unorm8 so each vertex sums to exactly 255, which a
 * plain round does not guarantee. Follows gltfpack (meshoptimizer gltf/stream.cpp,
 * the weights branch of writeVertexStream and renormalizeWeights, commit 4c203430ca56):
 * normalize by the sum, quantize, then add the rounding error to the largest
 * quantized component.
 */
export function quantizeSkinWeights(weights: Float32Array, vertexCount: number) {
  const out = new Uint8Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) {
    const w = weights.subarray(i * 4, i * 4 + 4);
    const sum = w[0] + w[1] + w[2] + w[3];
    if (!(sum > 0)) {
      continue;
    }
    let total = 0;
    for (let c = 0; c < 4; c++) {
      out[i * 4 + c] = Math.round(Math.min(1, Math.max(0, w[c] / sum)) * 255);
      total += out[i * 4 + c];
    }
    let largest = 0;
    for (let c = 1; c < 4; c++) {
      if (out[i * 4 + c] > out[i * 4 + largest]) {
        largest = c;
      }
    }
    out[i * 4 + largest] += 255 - total;
  }
  return out;
}

/**
 * Decides how each stream is stored. Throws when the mesh cannot be compressed
 * (a stream whose stride meshopt cannot encode, or inconsistent vertex counts),
 * in which case the source ships as it is.
 */
export function planMeshStreams(streams: SourceStream[], normalBits: MeshNormalBits) {
  const position = streams.find((s) => s.semantic === 'position');
  const positionFormat = position && describeFormat(position.format);
  if (!position || !positionFormat) {
    throw new Error('A mesh needs a position stream to be compressed');
  }
  const vertexCount = position.data.byteLength / positionFormat.stride;
  const plans: StreamPlan[] = [];
  for (const stream of streams) {
    const fmt = describeFormat(stream.format);
    if (!fmt) {
      throw new Error(`Unknown vertex format ${stream.format}`);
    }
    if (stream.data.byteLength !== vertexCount * fmt.stride) {
      throw new Error(`Stream ${stream.semantic} does not have ${vertexCount} vertices`);
    }
    const floats = readFloats(stream, vertexCount);
    if (
      (stream.semantic === 'normal' || stream.semantic === 'tangent') &&
      normalBits > 0 &&
      floats &&
      floats.count >= 3
    ) {
      const wide = normalBits > 8;
      plans.push({
        kind: 'octahedral',
        format: `${stream.semantic}_${wide ? 'i16normx4' : 'i8normx4'}`,
        vectors: toUnitVec4(floats.values, floats.count, vertexCount, 1),
        byteStride: wide ? 8 : 4,
        bits: normalBits
      });
      continue;
    }
    if (stream.semantic === 'diffuse' && floats && floats.count >= 3) {
      const inRange = floats.values.every((v) => v >= 0 && v <= 1);
      if (inRange) {
        const colors = new Float32Array(vertexCount * 4);
        for (let i = 0; i < vertexCount; i++) {
          for (let c = 0; c < 4; c++) {
            colors[i * 4 + c] = c < floats.count ? floats.values[i * floats.count + c] : 1;
          }
        }
        plans.push({ kind: 'color', format: 'diffuse_u8normx4', colors, byteStride: 4 });
        continue;
      }
    }
    if (stream.semantic === 'blendWeights' && floats && floats.count === 4) {
      plans.push({
        kind: 'weights',
        format: 'blendweights_u8normx4',
        data: quantizeSkinWeights(floats.values, vertexCount),
        byteStride: 4
      });
      continue;
    }
    if (fmt.stride % 4 !== 0 || fmt.stride > 256) {
      throw new Error(
        `Stream ${stream.semantic} has a ${fmt.stride}-byte stride, which meshopt cannot encode`
      );
    }
    plans.push({ kind: 'copy', format: stream.format, data: stream.data, byteStride: fmt.stride });
  }
  return { vertexCount, plans };
}
