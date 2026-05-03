type GltfAccessorType = 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4';

type GltfAttributeInfo = {
  componentFormat: string;
  componentType: number | null;
  componentSize: number;
  componentCount: number;
  type: GltfAccessorType;
  normalized?: boolean;
};

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;
const GLB_BIN_CHUNK_TYPE = 0x004e4942;
const GLTF_ARRAY_BUFFER = 34962;
const GLTF_ELEMENT_ARRAY_BUFFER = 34963;

export function buildPrimitiveGlbFromZmshContent(
  content: string | unknown,
  name: string,
  srcPath = '<memory>'
): ArrayBuffer {
  const primitive = parsePrimitiveAssetForGlb(
    typeof content === 'string' ? JSON.parse(content) : content,
    srcPath
  );
  return buildPrimitiveGlb(primitive, name);
}

function parsePrimitiveAssetForGlb(content: any, srcPath: string) {
  if (!content || typeof content !== 'object' || content.type !== 'Primitive') {
    throw new Error(`Unsupported primitive asset type in ${srcPath}: ${content?.type ?? '<missing>'}`);
  }
  const data = content.data;
  if (!data || typeof data !== 'object') {
    throw new Error(`Invalid primitive asset data in ${srcPath}`);
  }
  if (!data.vertices || typeof data.vertices !== 'object') {
    throw new Error(`Primitive asset has no vertex buffers: ${srcPath}`);
  }
  if (!data.vertices.position) {
    throw new Error(`Primitive asset requires a position vertex buffer: ${srcPath}`);
  }
  if (data.indices && data.indexType !== 'u16' && data.indexType !== 'u32') {
    throw new Error(`Invalid primitive index type in ${srcPath}: ${data.indexType}`);
  }
  return data as {
    vertices: Record<string, { format: string; data: string }>;
    indices?: string;
    indexType?: 'u16' | 'u32';
    indexCount?: number;
    type?: string;
    boxMin?: number[];
    boxMax?: number[];
  };
}

function buildPrimitiveGlb(
  primitive: ReturnType<typeof parsePrimitiveAssetForGlb>,
  name: string
): ArrayBuffer {
  const bufferViews: any[] = [];
  const accessors: any[] = [];
  const attributes: Record<string, number> = {};
  const chunks: Uint8Array[] = [];
  let byteOffset = 0;
  let vertexCount: number | null = null;

  const appendBufferView = (bytes: Uint8Array, target: number) => {
    const padding = align4(byteOffset) - byteOffset;
    if (padding > 0) {
      chunks.push(new Uint8Array(padding));
      byteOffset += padding;
    }
    const viewIndex = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: bytes.byteLength,
      target
    });
    chunks.push(bytes);
    byteOffset += bytes.byteLength;
    return viewIndex;
  };

  for (const [semantic, vertex] of Object.entries(primitive.vertices)) {
    const attributeName = getGltfAttributeName(semantic);
    if (!attributeName) {
      continue;
    }
    if (!vertex || typeof vertex.format !== 'string' || typeof vertex.data !== 'string') {
      throw new Error(`Invalid vertex buffer for semantic ${semantic}`);
    }
    const sourceInfo = getGltfAttributeInfo(vertex.format);
    const sourceBytes = base64ToUint8Array(vertex.data);
    const sourceStride = sourceInfo.componentSize * sourceInfo.componentCount;
    if (sourceBytes.byteLength === 0 || sourceBytes.byteLength % sourceStride !== 0) {
      throw new Error(`Vertex buffer byte length does not match format ${vertex.format}`);
    }
    const count = sourceBytes.byteLength / sourceStride;
    if (semantic === 'position') {
      vertexCount = count;
    } else if (vertexCount !== null && count !== vertexCount) {
      throw new Error(
        `Vertex buffer ${semantic} count ${count} does not match position count ${vertexCount}`
      );
    }

    const { info, bytes } = normalizeAttributeForGltf(attributeName, sourceInfo, sourceBytes, count);
    validateGltfAttribute(attributeName, info, vertex.format);
    const accessor: any = {
      bufferView: appendBufferView(bytes, GLTF_ARRAY_BUFFER),
      componentType: info.componentType,
      count,
      type: info.type
    };
    if (info.normalized) {
      accessor.normalized = true;
    }
    if (attributeName === 'POSITION') {
      if (isNumberArray(primitive.boxMin, 3) && isNumberArray(primitive.boxMax, 3)) {
        accessor.min = primitive.boxMin;
        accessor.max = primitive.boxMax;
      } else {
        const bounds = computePositionBounds(new Float32Array(bytes.buffer, bytes.byteOffset, count * 3));
        accessor.min = bounds.min;
        accessor.max = bounds.max;
      }
    }
    attributes[attributeName] = accessors.length;
    accessors.push(accessor);
  }

  if (vertexCount === null) {
    throw new Error('Primitive asset requires a position vertex buffer');
  }

  let indicesAccessor: number | undefined;
  if (primitive.indices) {
    const indexBytes = base64ToUint8Array(primitive.indices);
    const indexComponentType = primitive.indexType === 'u16' ? 5123 : 5125;
    const indexElementSize = primitive.indexType === 'u16' ? 2 : 4;
    if (indexBytes.byteLength % indexElementSize !== 0) {
      throw new Error(`Index buffer byte length does not match index type ${primitive.indexType}`);
    }
    const indexCount = Number(primitive.indexCount ?? indexBytes.byteLength / indexElementSize);
    indicesAccessor = accessors.length;
    accessors.push({
      bufferView: appendBufferView(indexBytes, GLTF_ELEMENT_ARRAY_BUFFER),
      componentType: indexComponentType,
      count: indexCount,
      type: 'SCALAR'
    });
  }

  const binLength = align4(byteOffset);
  const binChunk = new Uint8Array(binLength);
  let chunkOffset = 0;
  for (const chunk of chunks) {
    binChunk.set(chunk, chunkOffset);
    chunkOffset += chunk.byteLength;
  }
  const json = {
    asset: {
      version: '2.0',
      generator: 'Zephyr3D Editor primitive_export_glb'
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [
      {
        name,
        primitives: [
          {
            attributes,
            ...(indicesAccessor !== undefined ? { indices: indicesAccessor } : {}),
            mode: getGltfPrimitiveMode(primitive.type)
          }
        ]
      }
    ],
    buffers: [{ byteLength: byteOffset }],
    bufferViews,
    accessors
  };
  return encodeGlb(json, binChunk);
}

function getGltfAttributeName(semantic: string): string | null {
  if (semantic === 'position') {
    return 'POSITION';
  }
  if (semantic === 'normal') {
    return 'NORMAL';
  }
  if (semantic === 'tangent') {
    return 'TANGENT';
  }
  if (semantic === 'diffuse') {
    return 'COLOR_0';
  }
  if (semantic === 'blendIndices') {
    return 'JOINTS_0';
  }
  if (semantic === 'blendWeights') {
    return 'WEIGHTS_0';
  }
  const texCoordMatch = /^texCoord([0-7])$/.exec(semantic);
  if (texCoordMatch) {
    return `TEXCOORD_${texCoordMatch[1]}`;
  }
  return null;
}

function normalizeAttributeForGltf(
  attributeName: string,
  sourceInfo: GltfAttributeInfo,
  sourceBytes: Uint8Array,
  count: number
): { info: GltfAttributeInfo; bytes: Uint8Array } {
  if (attributeName === 'JOINTS_0') {
    const output = new Uint16Array(count * 4);
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < sourceInfo.componentCount; c++) {
        const value = Math.round(readComponent(sourceBytes, sourceInfo, i, c));
        if (!Number.isFinite(value) || value < 0 || value > 65535) {
          throw new Error(`JOINTS_0 value out of range for GLB export: ${value}`);
        }
        output[i * 4 + c] = value;
      }
    }
    return {
      info: {
        componentFormat: 'u16',
        componentType: 5123,
        componentSize: 2,
        componentCount: 4,
        type: 'VEC4'
      },
      bytes: typedArrayBytes(output)
    };
  }
  if (attributeName === 'WEIGHTS_0') {
    if (
      sourceInfo.componentFormat === 'f32' &&
      sourceInfo.componentCount === 4 &&
      sourceInfo.componentType === 5126
    ) {
      return { info: sourceInfo, bytes: sourceBytes };
    }
    const output = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < sourceInfo.componentCount; c++) {
        output[i * 4 + c] = readComponent(sourceBytes, sourceInfo, i, c);
      }
    }
    return {
      info: {
        componentFormat: 'f32',
        componentType: 5126,
        componentSize: 4,
        componentCount: 4,
        type: 'VEC4'
      },
      bytes: typedArrayBytes(output)
    };
  }
  return { info: sourceInfo, bytes: sourceBytes };
}

function getGltfAttributeInfo(format: string): GltfAttributeInfo {
  const match = /_(u8norm|i8norm|u8|i8|u16norm|i16norm|u16|i16|u32|i32|f16|f32)(?:x([234]))?$/.exec(format);
  if (!match) {
    throw new Error(`Unsupported vertex attribute format for GLB export: ${format}`);
  }
  const [, componentFormat, componentCountText] = match;
  const componentCount = Number(componentCountText ?? 1);
  const componentTypes: Record<
    string,
    { componentType: number | null; componentSize: number; normalized?: boolean }
  > = {
    i8: { componentType: 5120, componentSize: 1 },
    i8norm: { componentType: 5120, componentSize: 1, normalized: true },
    u8: { componentType: 5121, componentSize: 1 },
    u8norm: { componentType: 5121, componentSize: 1, normalized: true },
    i16: { componentType: 5122, componentSize: 2 },
    i16norm: { componentType: 5122, componentSize: 2, normalized: true },
    u16: { componentType: 5123, componentSize: 2 },
    u16norm: { componentType: 5123, componentSize: 2, normalized: true },
    u32: { componentType: 5125, componentSize: 4 },
    f16: { componentType: null, componentSize: 2 },
    f32: { componentType: 5126, componentSize: 4 }
  };
  const component = componentTypes[componentFormat];
  if (!component) {
    throw new Error(`Unsupported vertex component format for GLB export: ${format}`);
  }
  const typeByCount: Record<number, GltfAccessorType> = {
    1: 'SCALAR',
    2: 'VEC2',
    3: 'VEC3',
    4: 'VEC4'
  };
  return {
    ...component,
    componentFormat,
    componentCount,
    type: typeByCount[componentCount]
  };
}

function validateGltfAttribute(attributeName: string, info: GltfAttributeInfo, format: string): void {
  if (info.componentType === null) {
    throw new Error(`Vertex format is not directly supported by GLB export: ${format}`);
  }
  if (attributeName === 'POSITION' && (info.componentType !== 5126 || info.type !== 'VEC3')) {
    throw new Error(`POSITION must be f32x3 for GLB export, got ${format}`);
  }
  if (attributeName === 'NORMAL' && (info.componentType !== 5126 || info.type !== 'VEC3')) {
    throw new Error(`NORMAL must be f32x3 for GLB export, got ${format}`);
  }
  if (attributeName === 'TANGENT' && (info.componentType !== 5126 || info.type !== 'VEC4')) {
    throw new Error(`TANGENT must be f32x4 for GLB export, got ${format}`);
  }
  if (attributeName.startsWith('TEXCOORD_') && info.type !== 'VEC2') {
    throw new Error(`${attributeName} must be a vec2 format for GLB export, got ${format}`);
  }
  if (attributeName.startsWith('COLOR_') && info.type !== 'VEC3' && info.type !== 'VEC4') {
    throw new Error(`${attributeName} must be a vec3 or vec4 format for GLB export, got ${format}`);
  }
  if (attributeName === 'JOINTS_0' && (info.componentType !== 5123 || info.type !== 'VEC4')) {
    throw new Error(`JOINTS_0 must be exported as u16x4, got ${format}`);
  }
  if (attributeName === 'WEIGHTS_0' && (info.componentType !== 5126 || info.type !== 'VEC4')) {
    throw new Error(`WEIGHTS_0 must be exported as f32x4, got ${format}`);
  }
}

function getGltfPrimitiveMode(type: string | undefined): number {
  switch (type) {
    case 'point-list':
      return 0;
    case 'line-list':
      return 1;
    case 'line-strip':
      return 3;
    case 'triangle-strip':
      return 5;
    case 'triangle-fan':
      return 6;
    case 'triangle-list':
    case undefined:
      return 4;
    default:
      throw new Error(`Unsupported primitive type for GLB export: ${type}`);
  }
}

function encodeGlb(json: any, binChunk: Uint8Array): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = align4(jsonBytes.byteLength);
  const binLength = align4(binChunk.byteLength);
  const totalLength = 12 + 8 + jsonLength + 8 + binLength;
  const out = new Uint8Array(totalLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, GLB_JSON_CHUNK_TYPE, true);
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(jsonBytes, 20);
  const binHeaderOffset = 20 + jsonLength;
  view.setUint32(binHeaderOffset, binLength, true);
  view.setUint32(binHeaderOffset + 4, GLB_BIN_CHUNK_TYPE, true);
  out.set(binChunk, binHeaderOffset + 8);
  return out.buffer;
}

function computePositionBounds(positions: Float32Array): { min: number[]; max: number[] } {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let i = 0; i < positions.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const value = positions[i + c];
      min[c] = Math.min(min[c], value);
      max[c] = Math.max(max[c], value);
    }
  }
  return { min, max };
}

function readComponent(
  bytes: Uint8Array,
  info: GltfAttributeInfo,
  vertexIndex: number,
  componentIndex: number
) {
  const offset = (vertexIndex * info.componentCount + componentIndex) * info.componentSize;
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, info.componentSize);
  switch (info.componentFormat) {
    case 'i8': {
      return view.getInt8(0);
    }
    case 'i8norm': {
      return Math.max(view.getInt8(0) / 127, -1);
    }
    case 'u8': {
      return view.getUint8(0);
    }
    case 'u8norm': {
      return view.getUint8(0) / 255;
    }
    case 'i16': {
      return view.getInt16(0, true);
    }
    case 'i16norm': {
      return Math.max(view.getInt16(0, true) / 32767, -1);
    }
    case 'u16': {
      return view.getUint16(0, true);
    }
    case 'u16norm': {
      return view.getUint16(0, true) / 65535;
    }
    case 'u32': {
      return view.getUint32(0, true);
    }
    case 'f16': {
      return halfToFloat(view.getUint16(0, true));
    }
    case 'f32': {
      return view.getFloat32(0, true);
    }
    default:
      throw new Error(`Unsupported vertex component format for GLB export: ${info.componentFormat}`);
  }
}

function halfToFloat(value: number): number {
  const sign = value & 0x8000 ? -1 : 1;
  const exponent = (value >> 10) & 0x1f;
  const fraction = value & 0x03ff;
  if (exponent === 0) {
    return sign * (fraction / 1024) * 2 ** -14;
  }
  if (exponent === 0x1f) {
    return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  }
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function typedArrayBytes(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

function isNumberArray(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every((item) => typeof item === 'number');
}
