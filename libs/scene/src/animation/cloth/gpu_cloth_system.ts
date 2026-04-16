import type {
  AbstractDevice,
  BindGroup,
  GPUDataBuffer,
  GPUProgram,
  StructuredBuffer
} from '@zephyr3d/device';
import { PBPrimitiveType } from '@zephyr3d/device';
import {
  Matrix4x4,
  base64ToUint8Array,
  releaseObject,
  retainObject,
  uint8ArrayToBase64,
  Vector3,
  type Nullable
} from '@zephyr3d/base';
import { getDevice } from '../../app/api';
import type { Primitive } from '../../render';
import type { Scene } from '../../scene';
import type { MeshUpdateCallback } from '../../scene/mesh';
import { BoundingBox } from '../../utility/bounding_volume';
import type { CapsuleCollider, PlaneCollider, SphereCollider, SpringCollider } from '../spring/spring_collider';
import { updateColliderFromNode } from '../spring/spring_collider';

export type GPUClothSystemOptions = {
  enabled?: boolean;
  device?: Nullable<AbstractDevice>;
  primitive?: Nullable<Primitive>;
  collisionSpaceNode?: any;
  positionData?: Float32Array<ArrayBuffer>;
  indexData?: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>;
  skinningBlendIndices?: Float32Array<ArrayBuffer>;
  skinningBlendWeights?: Float32Array<ArrayBuffer>;
  pinnedVertexWeights?: ArrayLike<number>;
  pinnedVertexIndices?: number[];
  gravity?: Vector3;
  damping?: number;
  dynamicFriction?: number;
  staticFriction?: number;
  stiffness?: number;
  poseFollow?: number;
  substeps?: number;
  solverIterations?: number;
  maxNeighbors?: number;
  workgroupSize?: number;
  colliders?: SpringCollider[];
  maxTrianglesPerVertex?: number;
  rebuildNormals?: boolean;
  scene?: Nullable<Scene>;
  autoUpdate?: boolean;
};

export type GPUClothWrapBindingData = {
  version: 4;
  vertexCount: number;
  sourceVertexCount: number;
  influenceCount: number;
  maxOffsetDistance: number;
  sourceTriangleIndices: string;
  sourceBarycentrics: string;
  targetLocalOffsets: string;
};

export type GPUClothWrapBindingTarget = {
  target: any;
  data: GPUClothWrapBindingData;
};

function encodeTypedArrayBase64(view: ArrayBufferView) {
  return uint8ArrayToBase64(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

function decodeTypedArrayFromBase64<T extends Uint32Array | Float32Array>(
  ctor: {
    new (buffer: ArrayBuffer): T;
    BYTES_PER_ELEMENT: number;
  },
  base64: string,
  expectedLength: number
) {
  const bytes = base64ToUint8Array(base64);
  const byteLength = bytes.byteLength;
  if (byteLength % ctor.BYTES_PER_ELEMENT !== 0) {
    throw new Error('GPU cloth wrap failed: binding cache data is corrupted.');
  }
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const result = new ctor(buffer);
  if (expectedLength >= 0 && result.length !== expectedLength) {
    throw new Error('GPU cloth wrap failed: binding cache size does not match target mesh.');
  }
  return result;
}

function isWrapBindingDataCompatible(
  data: GPUClothWrapBindingData,
  sourceRestPositions: Float32Array<ArrayBuffer>,
  targetVertexCount: number
) {
  return (
    data?.version === 4 &&
    data.vertexCount === targetVertexCount &&
    data.sourceVertexCount === ((sourceRestPositions.length / 3) >> 0) &&
    data.influenceCount === WRAP_TRIANGLE_VERTEX_COUNT
  );
}

function resolveDevice(explicitDevice?: Nullable<AbstractDevice>) {
  if (explicitDevice) {
    return explicitDevice;
  }
  try {
    return getDevice();
  } catch {
    return null;
  }
}

/**
 * Returns whether GPU cloth is supported on the given device.
 *
 * GPU cloth in this engine is WebGPU-only. WebGL backends are explicitly unsupported.
 */
export function isGPUClothSupported(device?: Nullable<AbstractDevice>) {
  const resolved = resolveDevice(device);
  return resolved?.type === 'webgpu';
}

const DEFAULT_DAMPING = 0.02;
const DEFAULT_DYNAMIC_FRICTION = 0.15;
const DEFAULT_STATIC_FRICTION = 0.3;
const DEFAULT_STIFFNESS = 0.3;
const DEFAULT_POSE_FOLLOW = 0;
const DEFAULT_SUBSTEPS = 2;
const DEFAULT_SOLVER_ITERATIONS = 5;
const DEFAULT_MAX_NEIGHBORS = 8;
const DEFAULT_WORKGROUP_SIZE = 64;
const DEFAULT_MAX_TRIANGLES_PER_VERTEX = 16;
const DEFAULT_REST_POSITION_SMOOTHING_TIME = 1 / 25;
const DEFAULT_COLLIDER_SMOOTHING_TIME = 1 / 30;
const FIXED_SIMULATION_TIME_STEP = 1 / 60;
const MAX_ACCUMULATED_SIMULATION_TIME = 1 / 20;
const MAX_SIMULATION_STEPS_PER_UPDATE = Math.max(
  1,
  Math.ceil(MAX_ACCUMULATED_SIMULATION_TIME / FIXED_SIMULATION_TIME_STEP)
);
const WRAP_TRIANGLE_VERTEX_COUNT = 3;
const WRAP_MIN_DISTANCE = 1e-8;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getInitialColliderBufferFloatCount(
  colliders: SpringCollider[] | undefined,
  type: SpringCollider['type'],
  stride: number
) {
  const count = (colliders ?? []).reduce((total, collider) => total + (collider?.type === type ? 1 : 0), 0);
  return Math.max(1, count) * stride;
}

function getPrimitiveScalarByteSize(type: PBPrimitiveType) {
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

function readPrimitiveScalar(
  view: DataView,
  byteOffset: number,
  scalarType: PBPrimitiveType,
  normalized: boolean
) {
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
      throw new Error(`Unsupported vertex scalar type: ${scalarType}`);
  }
}

function distance3(positions: Float32Array<ArrayBuffer>, a: number, b: number) {
  const a0 = a * 3;
  const b0 = b * 3;
  const dx = positions[a0] - positions[b0];
  const dy = positions[a0 + 1] - positions[b0 + 1];
  const dz = positions[a0 + 2] - positions[b0 + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function dot3(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  return ax * bx + ay * by + az * bz;
}

function normalize3(x: number, y: number, z: number, fallback: [number, number, number]): [number, number, number] {
  const length = Math.hypot(x, y, z);
  if (length <= WRAP_MIN_DISTANCE) {
    return fallback;
  }
  return [x / length, y / length, z / length];
}

function buildWrapTriangleFrame(
  p0x: number,
  p0y: number,
  p0z: number,
  p1x: number,
  p1y: number,
  p1z: number,
  p2x: number,
  p2y: number,
  p2z: number,
  out: Float32Array<ArrayBuffer> | number[]
) {
  const edge01x = p1x - p0x;
  const edge01y = p1y - p0y;
  const edge01z = p1z - p0z;
  const edge02x = p2x - p0x;
  const edge02y = p2y - p0y;
  const edge02z = p2z - p0z;

  let tangent = normalize3(edge01x, edge01y, edge01z, [0, 0, 0]);
  if (tangent[0] === 0 && tangent[1] === 0 && tangent[2] === 0) {
    tangent = normalize3(edge02x, edge02y, edge02z, [1, 0, 0]);
  }

  let normal = normalize3(
    edge01y * edge02z - edge01z * edge02y,
    edge01z * edge02x - edge01x * edge02z,
    edge01x * edge02y - edge01y * edge02x,
    [0, 0, 0]
  );
  if (normal[0] === 0 && normal[1] === 0 && normal[2] === 0) {
    const fallbackAxis = Math.abs(tangent[1]) < 0.999 ? [0, 1, 0] : [1, 0, 0];
    normal = normalize3(
      tangent[1] * fallbackAxis[2] - tangent[2] * fallbackAxis[1],
      tangent[2] * fallbackAxis[0] - tangent[0] * fallbackAxis[2],
      tangent[0] * fallbackAxis[1] - tangent[1] * fallbackAxis[0],
      [0, 0, 1]
    );
  }

  let bitangent = normalize3(
    normal[1] * tangent[2] - normal[2] * tangent[1],
    normal[2] * tangent[0] - normal[0] * tangent[2],
    normal[0] * tangent[1] - normal[1] * tangent[0],
    [0, 0, 0]
  );
  if (bitangent[0] === 0 && bitangent[1] === 0 && bitangent[2] === 0) {
    bitangent = Math.abs(tangent[1]) < 0.999 ? [0, 1, 0] : [1, 0, 0];
  }

  normal = normalize3(
    tangent[1] * bitangent[2] - tangent[2] * bitangent[1],
    tangent[2] * bitangent[0] - tangent[0] * bitangent[2],
    tangent[0] * bitangent[1] - tangent[1] * bitangent[0],
    [0, 0, 1]
  );

  out[0] = tangent[0];
  out[1] = tangent[1];
  out[2] = tangent[2];
  out[3] = bitangent[0];
  out[4] = bitangent[1];
  out[5] = bitangent[2];
  out[6] = normal[0];
  out[7] = normal[1];
  out[8] = normal[2];
}

function closestPointOnTriangle(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  closestOut: Float32Array<ArrayBuffer> | number[],
  baryOut: Float32Array<ArrayBuffer> | number[]
) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  const d1 = dot3(abx, aby, abz, apx, apy, apz);
  const d2 = dot3(acx, acy, acz, apx, apy, apz);
  if (d1 <= 0 && d2 <= 0) {
    closestOut[0] = ax;
    closestOut[1] = ay;
    closestOut[2] = az;
    baryOut[0] = 1;
    baryOut[1] = 0;
    baryOut[2] = 0;
  } else {
    const bpx = px - bx;
    const bpy = py - by;
    const bpz = pz - bz;
    const d3 = dot3(abx, aby, abz, bpx, bpy, bpz);
    const d4 = dot3(acx, acy, acz, bpx, bpy, bpz);
    if (d3 >= 0 && d4 <= d3) {
      closestOut[0] = bx;
      closestOut[1] = by;
      closestOut[2] = bz;
      baryOut[0] = 0;
      baryOut[1] = 1;
      baryOut[2] = 0;
    } else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / Math.max(WRAP_MIN_DISTANCE, d1 - d3);
        closestOut[0] = ax + abx * v;
        closestOut[1] = ay + aby * v;
        closestOut[2] = az + abz * v;
        baryOut[0] = 1 - v;
        baryOut[1] = v;
        baryOut[2] = 0;
      } else {
        const cpx = px - cx;
        const cpy = py - cy;
        const cpz = pz - cz;
        const d5 = dot3(abx, aby, abz, cpx, cpy, cpz);
        const d6 = dot3(acx, acy, acz, cpx, cpy, cpz);
        if (d6 >= 0 && d5 <= d6) {
          closestOut[0] = cx;
          closestOut[1] = cy;
          closestOut[2] = cz;
          baryOut[0] = 0;
          baryOut[1] = 0;
          baryOut[2] = 1;
        } else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / Math.max(WRAP_MIN_DISTANCE, d2 - d6);
            closestOut[0] = ax + acx * w;
            closestOut[1] = ay + acy * w;
            closestOut[2] = az + acz * w;
            baryOut[0] = 1 - w;
            baryOut[1] = 0;
            baryOut[2] = w;
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / Math.max(WRAP_MIN_DISTANCE, d4 - d3 + d5 - d6);
              closestOut[0] = bx + (cx - bx) * w;
              closestOut[1] = by + (cy - by) * w;
              closestOut[2] = bz + (cz - bz) * w;
              baryOut[0] = 0;
              baryOut[1] = 1 - w;
              baryOut[2] = w;
            } else {
              const denom = 1 / Math.max(WRAP_MIN_DISTANCE, va + vb + vc);
              const v = vb * denom;
              const w = vc * denom;
              const u = 1 - v - w;
              closestOut[0] = ax * u + bx * v + cx * w;
              closestOut[1] = ay * u + by * v + cy * w;
              closestOut[2] = az * u + bz * v + cz * w;
              baryOut[0] = u;
              baryOut[1] = v;
              baryOut[2] = w;
            }
          }
        }
      }
    }
  }
  const dx = px - closestOut[0];
  const dy = py - closestOut[1];
  const dz = pz - closestOut[2];
  return dx * dx + dy * dy + dz * dz;
}

function buildPinWeightArray(
  positions: Float32Array<ArrayBuffer>,
  explicitWeights?: ArrayLike<number>,
  explicitPinned?: number[]
): Float32Array<ArrayBuffer> {
  const vertexCount = (positions.length / 3) >> 0;
  const result = new Float32Array(vertexCount);
  if (explicitWeights && explicitWeights.length > 0) {
    const len = Math.min(vertexCount, explicitWeights.length);
    for (let i = 0; i < len; i++) {
      result[i] = clamp(Number(explicitWeights[i]) || 0, 0, 1);
    }
    return result;
  }
  if (explicitPinned && explicitPinned.length > 0) {
    for (const i of explicitPinned) {
      if (Number.isFinite(i) && i >= 0 && i < vertexCount) {
        result[i >> 0] = 1;
      }
    }
  }
  return result;
}

function buildNeighborData(
  positions: Float32Array<ArrayBuffer>,
  indexData: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>,
  maxNeighbors: number
) {
  const vertexCount = (positions.length / 3) >> 0;
  const neighborMap: Array<Map<number, number>> = Array.from({ length: vertexCount }, () => new Map());

  const addEdge = (a: number, b: number) => {
    if (a < 0 || b < 0 || a >= vertexCount || b >= vertexCount || a === b) {
      return;
    }
    const len = distance3(positions, a, b);
    const mapA = neighborMap[a];
    const mapB = neighborMap[b];
    const oldAB = mapA.get(b);
    if (oldAB === undefined || len < oldAB) {
      mapA.set(b, len);
    }
    const oldBA = mapB.get(a);
    if (oldBA === undefined || len < oldBA) {
      mapB.set(a, len);
    }
  };

  for (let i = 0; i + 2 < indexData.length; i += 3) {
    const a = indexData[i];
    const b = indexData[i + 1];
    const c = indexData[i + 2];
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  const totalEntries = vertexCount * maxNeighbors;
  const neighborIndices = new Int32Array(totalEntries);
  const restLengths = new Float32Array(totalEntries);
  neighborIndices.fill(-1);

  let hasConstraint = false;
  for (let i = 0; i < vertexCount; i++) {
    const sorted = [...neighborMap[i].entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, maxNeighbors);
    for (let j = 0; j < sorted.length; j++) {
      const slot = i * maxNeighbors + j;
      neighborIndices[slot] = sorted[j][0];
      restLengths[slot] = sorted[j][1];
      hasConstraint = true;
    }
  }

  return {
    neighborIndices,
    restLengths,
    hasConstraint
  };
}

function toUInt32Indices(indexData: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>) {
  if (indexData instanceof Uint32Array) {
    return indexData;
  }
  const out = new Uint32Array(indexData.length);
  for (let i = 0; i < indexData.length; i++) {
    out[i] = indexData[i];
  }
  return out;
}

function buildVertexTriangleAdjacency(
  vertexCount: number,
  indexData: Uint32Array<ArrayBuffer>,
  maxTrianglesPerVertex: number
) {
  const triangleCount = (indexData.length / 3) >> 0;
  const trianglesPerVertex: number[][] = Array.from({ length: vertexCount }, () => []);
  for (let tri = 0; tri < triangleCount; tri++) {
    const base = tri * 3;
    const i0 = indexData[base];
    const i1 = indexData[base + 1];
    const i2 = indexData[base + 2];
    if (i0 < vertexCount) {
      trianglesPerVertex[i0].push(tri);
    }
    if (i1 < vertexCount) {
      trianglesPerVertex[i1].push(tri);
    }
    if (i2 < vertexCount) {
      trianglesPerVertex[i2].push(tri);
    }
  }
  const adjacency = new Int32Array(vertexCount * maxTrianglesPerVertex);
  adjacency.fill(-1);
  for (let i = 0; i < vertexCount; i++) {
    const tris = trianglesPerVertex[i];
    const len = Math.min(maxTrianglesPerVertex, tris.length);
    for (let t = 0; t < len; t++) {
      adjacency[i * maxTrianglesPerVertex + t] = tris[t];
    }
  }
  return {
    triangleCount,
    adjacency
  };
}

function buildInitialSimulationPositions(options?: GPUClothSystemOptions) {
  const sourcePositions = options?.positionData;
  if (!sourcePositions) {
    return null;
  }
  const target = options?.collisionSpaceNode;
  const blendIndices = options?.skinningBlendIndices;
  const blendWeights = options?.skinningBlendWeights;
  if (
    !target?.invWorldMatrix ||
    !blendIndices ||
    !blendWeights ||
    typeof target?.findSkeletonById !== 'function'
  ) {
    return new Float32Array(sourcePositions);
  }
  const skeletonId = String(target.skeletonName ?? '');
  const skeleton = skeletonId ? target.findSkeletonById(skeletonId) : null;
  if (!skeleton?.skinPositionsToLocal) {
    return new Float32Array(sourcePositions);
  }
  return skeleton.skinPositionsToLocal(
    sourcePositions,
    blendIndices,
    blendWeights,
    target.invWorldMatrix
  );
}

async function resolveWrapBindPositions(
  mesh: any,
  basePositions: Float32Array<ArrayBuffer>
): Promise<Float32Array<ArrayBuffer>> {
  if (!basePositions || basePositions.length === 0) {
    return new Float32Array(0);
  }
  const primitive = mesh?.primitive;
  if (!primitive) {
    return new Float32Array(basePositions);
  }
  const blendData = await readSkinningDataFromPrimitive(primitive);
  if (
    !mesh?.invWorldMatrix ||
    !blendData?.blendIndices ||
    !blendData?.blendWeights ||
    typeof mesh?.findSkeletonById !== 'function'
  ) {
    return new Float32Array(basePositions);
  }
  const skeletonId = String(mesh.skeletonName ?? '');
  const skeleton = skeletonId ? mesh.findSkeletonById(skeletonId) : null;
  if (!skeleton?.skinPositionsToLocal) {
    return new Float32Array(basePositions);
  }
  return skeleton.skinPositionsToLocal(
    basePositions,
    blendData.blendIndices,
    blendData.blendWeights,
    mesh.invWorldMatrix
  );
}

function createIntegrateProgram(device: AbstractDevice, workgroupSize: number) {
  const program = device.buildComputeProgram({
    workgroupSize: [workgroupSize, 1, 1],
    compute(pb) {
      this.positions = pb.float[0]().storageBuffer(0);
      this.prevPositions = pb.float[0]().storageBuffer(0);
      this.restPositions = pb.float[0]().storageBufferReadonly(0);
      this.prevRestPositions = pb.float[0]().storageBufferReadonly(0);
      this.invMass = pb.float[0]().storageBufferReadonly(0);
      this.sphereData = pb.float[0]().storageBufferReadonly(0);
      this.capsuleData = pb.float[0]().storageBufferReadonly(0);
      this.planeData = pb.float[0]().storageBufferReadonly(0);
      this.vertexCount = pb.uint().uniform(0);
      this.deltaTime = pb.float().uniform(0);
      this.damping = pb.float().uniform(0);
      this.gravity = pb.vec3().uniform(0);
      this.sphereCount = pb.uint().uniform(0);
      this.capsuleCount = pb.uint().uniform(0);
      this.planeCount = pb.uint().uniform(0);
      this.dynamicFriction = pb.float().uniform(0);
      this.staticFriction = pb.float().uniform(0);
      this.minDistance = pb.float().uniform(0);
      pb.main(function () {
        this.$l.index = this.$builtins.globalInvocationId.x;
        this.$if(pb.lessThan(this.index, this.vertexCount), function () {
          this.$l.base = pb.mul(this.index, 3);
          this.$l.x = this.positions.at(this.base);
          this.$l.y = this.positions.at(pb.add(this.base, 1));
          this.$l.z = this.positions.at(pb.add(this.base, 2));
          this.$l.px = this.prevPositions.at(this.base);
          this.$l.py = this.prevPositions.at(pb.add(this.base, 1));
          this.$l.pz = this.prevPositions.at(pb.add(this.base, 2));
          this.$l.restX = this.restPositions.at(this.base);
          this.$l.restY = this.restPositions.at(pb.add(this.base, 1));
          this.$l.restZ = this.restPositions.at(pb.add(this.base, 2));
          this.$l.prevRestX = this.prevRestPositions.at(this.base);
          this.$l.prevRestY = this.prevRestPositions.at(pb.add(this.base, 1));
          this.$l.prevRestZ = this.prevRestPositions.at(pb.add(this.base, 2));
          this.$l.freeWeight = this.invMass.at(this.index);
          this.$l.pinWeight = pb.sub(1, this.freeWeight);
          this.$l.current = pb.vec3(this.x, this.y, this.z);
          this.$l.previous = pb.vec3(this.px, this.py, this.pz);
          this.$l.rest = pb.vec3(this.restX, this.restY, this.restZ);
          this.$l.prevRest = pb.vec3(this.prevRestX, this.prevRestY, this.prevRestZ);
          this.$l.restDelta = pb.sub(this.rest, this.prevRest);
          this.current = pb.add(this.current, this.restDelta);
          this.previous = pb.add(this.previous, this.restDelta);
          this.$l.dt2 = pb.mul(this.deltaTime, this.deltaTime);
          // Damping is modeled as velocity loss strength: 0 keeps full inertia, 1 removes it entirely.
          this.$l.velocity = pb.mul(
            pb.sub(this.current, this.previous),
            pb.mul(pb.sub(1, this.damping), this.freeWeight)
          );
          this.$l.next = pb.add(this.current, this.velocity, pb.mul(this.gravity, pb.mul(this.dt2, this.freeWeight)));

          this.$if(pb.greaterThan(this.freeWeight, this.minDistance), function () {
            this.$for(pb.uint('i'), 0, this.sphereCount, function () {
              this.$l.sphereBase = pb.mul(this.i, 4);
              this.$l.center = pb.vec3(
                this.sphereData.at(this.sphereBase),
                this.sphereData.at(pb.add(this.sphereBase, 1)),
                this.sphereData.at(pb.add(this.sphereBase, 2))
              );
              this.$l.radius = this.sphereData.at(pb.add(this.sphereBase, 3));
              this.$l.deltaCol = pb.sub(this.next, this.center);
              this.$l.lenCol = pb.length(this.deltaCol);
              this.$if(pb.lessThan(this.lenCol, this.radius), function () {
                this.$l.contactNormal = pb.vec3(0, 1, 0);
                this.$if(pb.greaterThan(this.lenCol, this.minDistance), function () {
                  this.contactNormal = pb.div(this.deltaCol, this.lenCol);
                  this.next = pb.add(this.center, pb.mul(this.contactNormal, this.radius));
                }).$else(function () {
                  this.next = pb.add(this.center, pb.vec3(0, this.radius, 0));
                });
                this.$l.correctionDelta = pb.sub(this.next, pb.add(this.center, this.deltaCol));
                this.$l.correctionLen = pb.length(this.correctionDelta);
                this.$l.surfaceDelta = pb.sub(this.next, this.current);
                this.$l.normalStep = pb.mul(this.contactNormal, pb.dot(this.surfaceDelta, this.contactNormal));
                this.$l.tangentStep = pb.sub(this.surfaceDelta, this.normalStep);
                this.$l.normalTravel = pb.length(this.normalStep);
                this.$l.tangentLen = pb.length(this.tangentStep);
                this.$if(pb.greaterThan(this.tangentLen, this.minDistance), function () {
                  this.$l.dynamicBasis = pb.max(
                    this.correctionLen,
                    pb.max(this.normalTravel, pb.mul(this.tangentLen, 0.5))
                  );
                  this.$l.staticBasis = pb.max(this.correctionLen, pb.max(this.normalTravel, this.tangentLen));
                  this.$l.staticLimit = pb.max(
                    this.minDistance,
                    pb.mul(this.staticBasis, pb.mul(this.staticFriction, 2))
                  );
                  this.$if(pb.lessThanEqual(this.tangentLen, this.staticLimit), function () {
                    this.next = pb.sub(this.next, this.tangentStep);
                  }).$else(function () {
                    this.$l.dynamicRemove = pb.min(
                      this.tangentLen,
                      pb.mul(this.dynamicBasis, this.dynamicFriction)
                    );
                    this.next = pb.sub(
                      this.next,
                      pb.mul(pb.div(this.tangentStep, this.tangentLen), this.dynamicRemove)
                    );
                  });
                });
              });
            });

            this.$for(pb.uint('j'), 0, this.capsuleCount, function () {
              this.$l.capsuleBase = pb.mul(this.j, 8);
              this.$l.cStart = pb.vec3(
                this.capsuleData.at(this.capsuleBase),
                this.capsuleData.at(pb.add(this.capsuleBase, 1)),
                this.capsuleData.at(pb.add(this.capsuleBase, 2))
              );
              this.$l.cRadius = this.capsuleData.at(pb.add(this.capsuleBase, 3));
              this.$l.cEnd = pb.vec3(
                this.capsuleData.at(pb.add(this.capsuleBase, 4)),
                this.capsuleData.at(pb.add(this.capsuleBase, 5)),
                this.capsuleData.at(pb.add(this.capsuleBase, 6))
              );
              this.$l.ab = pb.sub(this.cEnd, this.cStart);
              this.$l.abLen2 = pb.dot(this.ab, this.ab);
              this.$l.closest = this.cStart;
              this.$if(pb.greaterThan(this.abLen2, this.minDistance), function () {
                this.$l.ap = pb.sub(this.next, this.cStart);
                this.$l.t = pb.clamp(pb.div(pb.dot(this.ap, this.ab), this.abLen2), 0, 1);
                this.closest = pb.add(this.cStart, pb.mul(this.ab, this.t));
              });
              this.$l.deltaCap = pb.sub(this.next, this.closest);
              this.$l.lenCap = pb.length(this.deltaCap);
              this.$if(pb.lessThan(this.lenCap, this.cRadius), function () {
                this.$l.contactNormal = pb.vec3(0, 1, 0);
                this.$if(pb.greaterThan(this.lenCap, this.minDistance), function () {
                  this.contactNormal = pb.div(this.deltaCap, this.lenCap);
                  this.next = pb.add(this.closest, pb.mul(this.contactNormal, this.cRadius));
                }).$else(function () {
                  this.next = pb.add(this.closest, pb.vec3(0, this.cRadius, 0));
                });
                this.$l.correctionDelta = pb.sub(this.next, pb.add(this.closest, this.deltaCap));
                this.$l.correctionLen = pb.length(this.correctionDelta);
                this.$l.surfaceDelta = pb.sub(this.next, this.current);
                this.$l.normalStep = pb.mul(this.contactNormal, pb.dot(this.surfaceDelta, this.contactNormal));
                this.$l.tangentStep = pb.sub(this.surfaceDelta, this.normalStep);
                this.$l.normalTravel = pb.length(this.normalStep);
                this.$l.tangentLen = pb.length(this.tangentStep);
                this.$if(pb.greaterThan(this.tangentLen, this.minDistance), function () {
                  this.$l.dynamicBasis = pb.max(
                    this.correctionLen,
                    pb.max(this.normalTravel, pb.mul(this.tangentLen, 0.5))
                  );
                  this.$l.staticBasis = pb.max(this.correctionLen, pb.max(this.normalTravel, this.tangentLen));
                  this.$l.staticLimit = pb.max(
                    this.minDistance,
                    pb.mul(this.staticBasis, pb.mul(this.staticFriction, 2))
                  );
                  this.$if(pb.lessThanEqual(this.tangentLen, this.staticLimit), function () {
                    this.next = pb.sub(this.next, this.tangentStep);
                  }).$else(function () {
                    this.$l.dynamicRemove = pb.min(
                      this.tangentLen,
                      pb.mul(this.dynamicBasis, this.dynamicFriction)
                    );
                    this.next = pb.sub(
                      this.next,
                      pb.mul(pb.div(this.tangentStep, this.tangentLen), this.dynamicRemove)
                    );
                  });
                });
              });
            });

            this.$for(pb.uint('k'), 0, this.planeCount, function () {
              this.$l.planeBase = pb.mul(this.k, 8);
              this.$l.planePoint = pb.vec3(
                this.planeData.at(this.planeBase),
                this.planeData.at(pb.add(this.planeBase, 1)),
                this.planeData.at(pb.add(this.planeBase, 2))
              );
              this.$l.planeNormal = pb.vec3(
                this.planeData.at(pb.add(this.planeBase, 4)),
                this.planeData.at(pb.add(this.planeBase, 5)),
                this.planeData.at(pb.add(this.planeBase, 6))
              );
              this.$l.planeDistance = pb.dot(pb.sub(this.next, this.planePoint), this.planeNormal);
              this.$if(pb.lessThan(this.planeDistance, 0), function () {
                this.$l.contactNormal = this.planeNormal;
                this.$l.preProject = this.next;
                this.next = pb.sub(this.next, pb.mul(this.contactNormal, this.planeDistance));
                this.$l.correctionDelta = pb.sub(this.next, this.preProject);
                this.$l.correctionLen = pb.length(this.correctionDelta);
                this.$l.surfaceDelta = pb.sub(this.next, this.current);
                this.$l.normalStep = pb.mul(this.contactNormal, pb.dot(this.surfaceDelta, this.contactNormal));
                this.$l.tangentStep = pb.sub(this.surfaceDelta, this.normalStep);
                this.$l.normalTravel = pb.length(this.normalStep);
                this.$l.tangentLen = pb.length(this.tangentStep);
                this.$if(pb.greaterThan(this.tangentLen, this.minDistance), function () {
                  this.$l.dynamicBasis = pb.max(
                    this.correctionLen,
                    pb.max(this.normalTravel, pb.mul(this.tangentLen, 0.5))
                  );
                  this.$l.staticBasis = pb.max(this.correctionLen, pb.max(this.normalTravel, this.tangentLen));
                  this.$l.staticLimit = pb.max(
                    this.minDistance,
                    pb.mul(this.staticBasis, pb.mul(this.staticFriction, 2))
                  );
                  this.$if(pb.lessThanEqual(this.tangentLen, this.staticLimit), function () {
                    this.next = pb.sub(this.next, this.tangentStep);
                  }).$else(function () {
                    this.$l.dynamicRemove = pb.min(
                      this.tangentLen,
                      pb.mul(this.dynamicBasis, this.dynamicFriction)
                    );
                    this.next = pb.sub(
                      this.next,
                      pb.mul(pb.div(this.tangentStep, this.tangentLen), this.dynamicRemove)
                    );
                  });
                });
              });
            });
          });

          this.next = pb.add(pb.mul(this.next, this.freeWeight), pb.mul(this.rest, this.pinWeight));
          this.$l.prevOut = pb.add(pb.mul(this.current, this.freeWeight), pb.mul(this.rest, this.pinWeight));
          this.prevPositions.setAt(this.base, this.prevOut.x);
          this.prevPositions.setAt(pb.add(this.base, 1), this.prevOut.y);
          this.prevPositions.setAt(pb.add(this.base, 2), this.prevOut.z);
          this.positions.setAt(this.base, this.next.x);
          this.positions.setAt(pb.add(this.base, 1), this.next.y);
          this.positions.setAt(pb.add(this.base, 2), this.next.z);
        });
      });
    }
  });
  if (program) {
    program.name = '@GPUCloth_Integrate';
  }
  return program;
}

function createConstraintProgram(device: AbstractDevice, workgroupSize: number) {
  const program = device.buildComputeProgram({
    workgroupSize: [workgroupSize, 1, 1],
    compute(pb) {
      this.positions = pb.float[0]().storageBuffer(0);
      this.restPositions = pb.float[0]().storageBufferReadonly(0);
      this.invMass = pb.float[0]().storageBufferReadonly(0);
      this.neighborIndices = pb.int[0]().storageBufferReadonly(0);
      this.restLengths = pb.float[0]().storageBufferReadonly(0);
      this.sphereData = pb.float[0]().storageBufferReadonly(0);
      this.capsuleData = pb.float[0]().storageBufferReadonly(0);
      this.planeData = pb.float[0]().storageBufferReadonly(0);
      this.vertexCount = pb.uint().uniform(0);
      this.maxNeighbors = pb.uint().uniform(0);
      this.stiffness = pb.float().uniform(0);
      this.poseFollow = pb.float().uniform(0);
      this.sphereCount = pb.uint().uniform(0);
      this.capsuleCount = pb.uint().uniform(0);
      this.planeCount = pb.uint().uniform(0);
      this.dynamicFriction = pb.float().uniform(0);
      this.staticFriction = pb.float().uniform(0);
      this.minDistance = pb.float().uniform(0);
      pb.main(function () {
        this.$l.index = this.$builtins.globalInvocationId.x;
        this.$if(pb.lessThan(this.index, this.vertexCount), function () {
          this.$l.freeWeight = this.invMass.at(this.index);
          this.$l.pinWeight = pb.sub(1, this.freeWeight);
          this.$l.base = pb.mul(this.index, 3);
          this.$l.rest = pb.vec3(
            this.restPositions.at(this.base),
            this.restPositions.at(pb.add(this.base, 1)),
            this.restPositions.at(pb.add(this.base, 2))
          );
          this.$if(pb.greaterThan(this.freeWeight, this.minDistance), function () {
            this.$l.pos = pb.vec3(
              this.positions.at(this.base),
              this.positions.at(pb.add(this.base, 1)),
              this.positions.at(pb.add(this.base, 2))
            );
            this.$l.correction = pb.vec3(0);
            this.$l.validCount = pb.uint(0);
            this.$l.neighborStart = pb.mul(this.index, this.maxNeighbors);
            this.$for(pb.uint('i'), 0, this.maxNeighbors, function () {
              this.$l.slot = pb.add(this.neighborStart, this.i);
              this.$l.neighbor = this.neighborIndices.at(this.slot);
              this.$if(pb.greaterThanEqual(this.neighbor, 0), function () {
                this.$l.neighborBase = pb.mul(pb.uint(this.neighbor), 3);
                this.$l.neighborPos = pb.vec3(
                  this.positions.at(this.neighborBase),
                  this.positions.at(pb.add(this.neighborBase, 1)),
                  this.positions.at(pb.add(this.neighborBase, 2))
                );
                this.$l.restLength = this.restLengths.at(this.slot);
                this.$l.delta = pb.sub(this.pos, this.neighborPos);
                this.$l.len = pb.length(this.delta);
                this.$if(pb.greaterThan(this.len, this.minDistance), function () {
                  this.$l.offset = pb.mul(pb.div(this.delta, this.len), pb.sub(this.len, this.restLength));
                  this.correction = pb.add(this.correction, this.offset);
                  this.validCount = pb.add(this.validCount, 1);
                });
              });
            });
            this.$l.corrected = this.pos;
            this.$if(pb.greaterThan(this.validCount, 0), function () {
              this.$l.scale = pb.div(pb.mul(this.stiffness, this.freeWeight), pb.float(this.validCount));
              this.corrected = pb.sub(this.pos, pb.mul(this.correction, this.scale));
            });
            this.$if(pb.greaterThan(this.poseFollow, this.minDistance), function () {
              this.$l.followStrength = pb.mul(this.poseFollow, this.freeWeight);
              this.corrected = pb.add(
                this.corrected,
                pb.mul(pb.sub(this.rest, this.corrected), this.followStrength)
              );
            });
            this.corrected = pb.add(pb.mul(this.corrected, this.freeWeight), pb.mul(this.rest, this.pinWeight));
            this.$for(pb.uint('i'), 0, this.sphereCount, function () {
              this.$l.sphereBase = pb.mul(this.i, 4);
              this.$l.center = pb.vec3(
                this.sphereData.at(this.sphereBase),
                this.sphereData.at(pb.add(this.sphereBase, 1)),
                this.sphereData.at(pb.add(this.sphereBase, 2))
              );
              this.$l.radius = this.sphereData.at(pb.add(this.sphereBase, 3));
              this.$l.deltaCol = pb.sub(this.corrected, this.center);
              this.$l.lenCol = pb.length(this.deltaCol);
              this.$if(pb.lessThan(this.lenCol, this.radius), function () {
                this.$if(pb.greaterThan(this.lenCol, this.minDistance), function () {
                  this.corrected = pb.add(this.center, pb.mul(pb.div(this.deltaCol, this.lenCol), this.radius));
                }).$else(function () {
                  this.corrected = pb.add(this.center, pb.vec3(0, this.radius, 0));
                });
              });
            });
            this.$for(pb.uint('j'), 0, this.capsuleCount, function () {
              this.$l.capsuleBase = pb.mul(this.j, 8);
              this.$l.cStart = pb.vec3(
                this.capsuleData.at(this.capsuleBase),
                this.capsuleData.at(pb.add(this.capsuleBase, 1)),
                this.capsuleData.at(pb.add(this.capsuleBase, 2))
              );
              this.$l.cRadius = this.capsuleData.at(pb.add(this.capsuleBase, 3));
              this.$l.cEnd = pb.vec3(
                this.capsuleData.at(pb.add(this.capsuleBase, 4)),
                this.capsuleData.at(pb.add(this.capsuleBase, 5)),
                this.capsuleData.at(pb.add(this.capsuleBase, 6))
              );
              this.$l.ab = pb.sub(this.cEnd, this.cStart);
              this.$l.abLen2 = pb.dot(this.ab, this.ab);
              this.$l.closest = this.cStart;
              this.$if(pb.greaterThan(this.abLen2, this.minDistance), function () {
                this.$l.ap = pb.sub(this.corrected, this.cStart);
                this.$l.t = pb.clamp(pb.div(pb.dot(this.ap, this.ab), this.abLen2), 0, 1);
                this.closest = pb.add(this.cStart, pb.mul(this.ab, this.t));
              });
              this.$l.deltaCap = pb.sub(this.corrected, this.closest);
              this.$l.lenCap = pb.length(this.deltaCap);
              this.$if(pb.lessThan(this.lenCap, this.cRadius), function () {
                this.$if(pb.greaterThan(this.lenCap, this.minDistance), function () {
                  this.corrected = pb.add(
                    this.closest,
                    pb.mul(pb.div(this.deltaCap, this.lenCap), this.cRadius)
                  );
                }).$else(function () {
                  this.corrected = pb.add(this.closest, pb.vec3(0, this.cRadius, 0));
                });
              });
            });
            this.$for(pb.uint('k'), 0, this.planeCount, function () {
              this.$l.planeBase = pb.mul(this.k, 8);
              this.$l.planePoint = pb.vec3(
                this.planeData.at(this.planeBase),
                this.planeData.at(pb.add(this.planeBase, 1)),
                this.planeData.at(pb.add(this.planeBase, 2))
              );
              this.$l.planeNormal = pb.vec3(
                this.planeData.at(pb.add(this.planeBase, 4)),
                this.planeData.at(pb.add(this.planeBase, 5)),
                this.planeData.at(pb.add(this.planeBase, 6))
              );
              this.$l.planeDistance = pb.dot(pb.sub(this.corrected, this.planePoint), this.planeNormal);
              this.$if(pb.lessThan(this.planeDistance, 0), function () {
                this.corrected = pb.sub(this.corrected, pb.mul(this.planeNormal, this.planeDistance));
              });
            });
            this.positions.setAt(this.base, this.corrected.x);
            this.positions.setAt(pb.add(this.base, 1), this.corrected.y);
            this.positions.setAt(pb.add(this.base, 2), this.corrected.z);
          }).$else(function () {
            this.positions.setAt(this.base, this.rest.x);
            this.positions.setAt(pb.add(this.base, 1), this.rest.y);
            this.positions.setAt(pb.add(this.base, 2), this.rest.z);
          });
        });
      });
    }
  });
  if (program) {
    program.name = '@GPUCloth_Constraint';
  }
  return program;
}

function createFaceNormalProgram(device: AbstractDevice, workgroupSize: number) {
  const program = device.buildComputeProgram({
    workgroupSize: [workgroupSize, 1, 1],
    compute(pb) {
      this.positions = pb.float[0]().storageBufferReadonly(0);
      this.triangleIndices = pb.uint[0]().storageBufferReadonly(0);
      this.triangleNormals = pb.float[0]().storageBuffer(0);
      this.triangleCount = pb.uint().uniform(0);
      this.minDistance = pb.float().uniform(0);
      pb.main(function () {
        this.$l.tri = this.$builtins.globalInvocationId.x;
        this.$if(pb.lessThan(this.tri, this.triangleCount), function () {
          this.$l.indexBase = pb.mul(this.tri, 3);
          this.$l.i0 = this.triangleIndices.at(this.indexBase);
          this.$l.i1 = this.triangleIndices.at(pb.add(this.indexBase, 1));
          this.$l.i2 = this.triangleIndices.at(pb.add(this.indexBase, 2));
          this.$l.p0Base = pb.mul(this.i0, 3);
          this.$l.p1Base = pb.mul(this.i1, 3);
          this.$l.p2Base = pb.mul(this.i2, 3);
          this.$l.p0 = pb.vec3(
            this.positions.at(this.p0Base),
            this.positions.at(pb.add(this.p0Base, 1)),
            this.positions.at(pb.add(this.p0Base, 2))
          );
          this.$l.p1 = pb.vec3(
            this.positions.at(this.p1Base),
            this.positions.at(pb.add(this.p1Base, 1)),
            this.positions.at(pb.add(this.p1Base, 2))
          );
          this.$l.p2 = pb.vec3(
            this.positions.at(this.p2Base),
            this.positions.at(pb.add(this.p2Base, 1)),
            this.positions.at(pb.add(this.p2Base, 2))
          );
          this.$l.n = pb.cross(pb.sub(this.p1, this.p0), pb.sub(this.p2, this.p0));
          this.$l.nLen = pb.length(this.n);
          this.$if(pb.greaterThan(this.nLen, this.minDistance), function () {
            this.n = pb.div(this.n, this.nLen);
          }).$else(function () {
            this.n = pb.vec3(0, 1, 0);
          });
          this.$l.outBase = pb.mul(this.tri, 3);
          this.triangleNormals.setAt(this.outBase, this.n.x);
          this.triangleNormals.setAt(pb.add(this.outBase, 1), this.n.y);
          this.triangleNormals.setAt(pb.add(this.outBase, 2), this.n.z);
        });
      });
    }
  });
  if (program) {
    program.name = '@GPUCloth_FaceNormal';
  }
  return program;
}

function createVertexNormalProgram(device: AbstractDevice, workgroupSize: number) {
  const program = device.buildComputeProgram({
    workgroupSize: [workgroupSize, 1, 1],
    compute(pb) {
      this.triangleNormals = pb.float[0]().storageBufferReadonly(0);
      this.vertexTriangleAdjacency = pb.int[0]().storageBufferReadonly(0);
      this.vertexNormals = pb.float[0]().storageBuffer(0);
      this.vertexCount = pb.uint().uniform(0);
      this.maxTrianglesPerVertex = pb.uint().uniform(0);
      this.minDistance = pb.float().uniform(0);
      pb.main(function () {
        this.$l.vertex = this.$builtins.globalInvocationId.x;
        this.$if(pb.lessThan(this.vertex, this.vertexCount), function () {
          this.$l.sum = pb.vec3(0);
          this.$l.valid = pb.uint(0);
          this.$l.start = pb.mul(this.vertex, this.maxTrianglesPerVertex);
          this.$for(pb.uint('i'), 0, this.maxTrianglesPerVertex, function () {
            this.$l.tri = this.vertexTriangleAdjacency.at(pb.add(this.start, this.i));
            this.$if(pb.greaterThanEqual(this.tri, 0), function () {
              this.$l.nBase = pb.mul(pb.uint(this.tri), 3);
              this.sum = pb.add(
                this.sum,
                pb.vec3(
                  this.triangleNormals.at(this.nBase),
                  this.triangleNormals.at(pb.add(this.nBase, 1)),
                  this.triangleNormals.at(pb.add(this.nBase, 2))
                )
              );
              this.valid = pb.add(this.valid, 1);
            });
          });
          this.$if(pb.greaterThan(this.valid, 0), function () {
            this.sum = pb.div(this.sum, pb.float(this.valid));
          }).$else(function () {
            this.sum = pb.vec3(0, 1, 0);
          });
          this.$l.len = pb.length(this.sum);
          this.$if(pb.greaterThan(this.len, this.minDistance), function () {
            this.sum = pb.div(this.sum, this.len);
          }).$else(function () {
            this.sum = pb.vec3(0, 1, 0);
          });
          this.$l.outBase = pb.mul(this.vertex, 3);
          this.vertexNormals.setAt(this.outBase, this.sum.x);
          this.vertexNormals.setAt(pb.add(this.outBase, 1), this.sum.y);
          this.vertexNormals.setAt(pb.add(this.outBase, 2), this.sum.z);
        });
      });
    }
  });
  if (program) {
    program.name = '@GPUCloth_VertexNormal';
  }
  return program;
}

async function readPositionDataFromPrimitive(primitive: Primitive) {
  const positions = await readVertexAttributeDataFromPrimitive(primitive, 'position', 3);
  if (!positions) {
    throw new Error('GPU cloth initialization failed: primitive has no position buffer.');
  }
  return positions;
}

async function readVertexAttributeDataFromPrimitive(
  primitive: Primitive,
  semantic: 'position' | 'normal' | 'blendIndices' | 'blendWeights',
  componentCount: number
) {
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
  const componentByteSize = getPrimitiveScalarByteSize(scalarType);
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
    throw new Error(`GPU cloth initialization failed: unsupported ${semantic} attribute format.`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < vertexCount; i++) {
    const src = baseByteOffset + i * info.stride;
    const dst = i * componentCount;
    for (let c = 0; c < componentCount; c++) {
      result[dst + c] = readPrimitiveScalar(
        view,
        src + c * componentByteSize,
        scalarType,
        normalized
      );
    }
  }
  return result;
}

async function readSkinningDataFromPrimitive(primitive: Primitive) {
  try {
    const [blendIndices, blendWeights] = await Promise.all([
      readVertexAttributeDataFromPrimitive(primitive, 'blendIndices', 4),
      readVertexAttributeDataFromPrimitive(primitive, 'blendWeights', 4)
    ]);
    if (!blendIndices || !blendWeights) {
      return null;
    }
    return { blendIndices, blendWeights };
  } catch {
    return null;
  }
}

function buildNonIndexedTriangles(primitive: Primitive, vertexCount: number) {
  if (primitive.primitiveType !== 'triangle-list') {
    throw new Error('GPU cloth initialization failed: only triangle-list primitive is supported.');
  }
  const start = primitive.indexStart;
  const count = primitive.indexCount;
  if (count <= 0 || count % 3 !== 0 || start < 0 || start + count > vertexCount) {
    throw new Error('GPU cloth initialization failed: invalid non-indexed triangle range.');
  }
  const indices = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    indices[i] = start + i;
  }
  return indices;
}

async function readIndexDataFromPrimitive(primitive: Primitive, vertexCount: number) {
  const indexBuffer = primitive.getIndexBuffer();
  if (!indexBuffer) {
    return buildNonIndexedTriangles(primitive, vertexCount);
  }
  if (primitive.primitiveType !== 'triangle-list') {
    throw new Error('GPU cloth initialization failed: only triangle-list primitive is supported.');
  }
  const bytes = await indexBuffer.getBufferSubData();
  if (indexBuffer.indexType.primitiveType === PBPrimitiveType.U16) {
    const src = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
    return new Uint16Array(src);
  }
  const src = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
  return new Uint32Array(src);
}

function createWrapDeformerProgram(device: AbstractDevice, workgroupSize: number) {
  const program = device.buildComputeProgram({
    workgroupSize: [workgroupSize, 1, 1],
    compute(pb) {
      this.sourcePositions = pb.float[0]().storageBufferReadonly(0);
      this.sourceTriangleIndices = pb.uint[0]().storageBufferReadonly(0);
      this.sourceBarycentrics = pb.float[0]().storageBufferReadonly(0);
      this.targetLocalOffsets = pb.float[0]().storageBufferReadonly(0);
      this.targetPositions = pb.float[0]().storageBuffer(0);
      this.targetNormals = pb.float[0]().storageBuffer(0);
      this.vertexCount = pb.uint().uniform(0);
      this.sourceToTargetMatrix = pb.mat4().uniform(0);
      this.minDistance = pb.float().uniform(0);
      pb.main(function () {
        this.$l.vertex = this.$builtins.globalInvocationId.x;
        this.$if(pb.lessThan(this.vertex, this.vertexCount), function () {
          this.$l.targetBase = pb.mul(this.vertex, 3);
          this.$l.influenceBase = pb.mul(this.vertex, WRAP_TRIANGLE_VERTEX_COUNT);
          this.$l.i0 = this.sourceTriangleIndices.at(this.influenceBase);
          this.$l.i1 = this.sourceTriangleIndices.at(pb.add(this.influenceBase, 1));
          this.$l.i2 = this.sourceTriangleIndices.at(pb.add(this.influenceBase, 2));
          this.$l.base0 = pb.mul(this.i0, 3);
          this.$l.base1 = pb.mul(this.i1, 3);
          this.$l.base2 = pb.mul(this.i2, 3);
          this.$l.w0 = this.sourceBarycentrics.at(this.influenceBase);
          this.$l.w1 = this.sourceBarycentrics.at(pb.add(this.influenceBase, 1));
          this.$l.w2 = this.sourceBarycentrics.at(pb.add(this.influenceBase, 2));
          this.$l.p0 = pb.mul(
            this.sourceToTargetMatrix,
            pb.vec4(
              this.sourcePositions.at(this.base0),
              this.sourcePositions.at(pb.add(this.base0, 1)),
              this.sourcePositions.at(pb.add(this.base0, 2)),
              1
            )
          ).xyz;
          this.$l.p1 = pb.mul(
            this.sourceToTargetMatrix,
            pb.vec4(
              this.sourcePositions.at(this.base1),
              this.sourcePositions.at(pb.add(this.base1, 1)),
              this.sourcePositions.at(pb.add(this.base1, 2)),
              1
            )
          ).xyz;
          this.$l.p2 = pb.mul(
            this.sourceToTargetMatrix,
            pb.vec4(
              this.sourcePositions.at(this.base2),
              this.sourcePositions.at(pb.add(this.base2, 1)),
              this.sourcePositions.at(pb.add(this.base2, 2)),
              1
            )
          ).xyz;
          this.$l.basePoint = pb.add(pb.mul(this.p0, this.w0), pb.mul(this.p1, this.w1), pb.mul(this.p2, this.w2));
          this.$l.edge01 = pb.sub(this.p1, this.p0);
          this.$l.edge02 = pb.sub(this.p2, this.p0);
          this.$l.tangent = this.edge01;
          this.$l.tangentLen = pb.length(this.tangent);
          this.$if(pb.lessThanEqual(this.tangentLen, this.minDistance), function () {
            this.tangent = this.edge02;
            this.tangentLen = pb.length(this.tangent);
          });
          this.$if(pb.greaterThan(this.tangentLen, this.minDistance), function () {
            this.tangent = pb.div(this.tangent, this.tangentLen);
          }).$else(function () {
            this.tangent = pb.vec3(1, 0, 0);
          });
          this.$l.normal = pb.cross(this.edge01, this.edge02);
          this.$l.normalLen = pb.length(this.normal);
          this.$if(pb.greaterThan(this.normalLen, this.minDistance), function () {
            this.normal = pb.div(this.normal, this.normalLen);
          }).$else(function () {
            this.$l.fallbackAxis = pb.vec3(0, 1, 0);
            this.$if(
              pb.or(pb.greaterThan(this.tangent.y, 0.999), pb.lessThan(this.tangent.y, -0.999)),
              function () {
                this.fallbackAxis = pb.vec3(1, 0, 0);
              }
            );
            this.normal = pb.cross(this.tangent, this.fallbackAxis);
            this.normalLen = pb.length(this.normal);
            this.$if(pb.greaterThan(this.normalLen, this.minDistance), function () {
              this.normal = pb.div(this.normal, this.normalLen);
            }).$else(function () {
              this.normal = pb.vec3(0, 0, 1);
            });
          });
          this.$l.bitangent = pb.cross(this.normal, this.tangent);
          this.$l.bitangentLen = pb.length(this.bitangent);
          this.$if(pb.greaterThan(this.bitangentLen, this.minDistance), function () {
            this.bitangent = pb.div(this.bitangent, this.bitangentLen);
          }).$else(function () {
            this.bitangent = pb.vec3(0, 1, 0);
          });
          this.normal = pb.cross(this.tangent, this.bitangent);
          this.normalLen = pb.length(this.normal);
          this.$if(pb.greaterThan(this.normalLen, this.minDistance), function () {
            this.normal = pb.div(this.normal, this.normalLen);
          }).$else(function () {
            this.normal = pb.vec3(0, 0, 1);
          });
          this.$l.localOffset = pb.vec3(
            this.targetLocalOffsets.at(this.targetBase),
            this.targetLocalOffsets.at(pb.add(this.targetBase, 1)),
            this.targetLocalOffsets.at(pb.add(this.targetBase, 2))
          );
          this.$l.deformedPosition = pb.add(
            this.basePoint,
            pb.add(
              pb.mul(this.tangent, this.localOffset.x),
              pb.mul(this.bitangent, this.localOffset.y),
              pb.mul(this.normal, this.localOffset.z)
            )
          );
          this.targetPositions.setAt(this.targetBase, this.deformedPosition.x);
          this.targetPositions.setAt(pb.add(this.targetBase, 1), this.deformedPosition.y);
          this.targetPositions.setAt(pb.add(this.targetBase, 2), this.deformedPosition.z);
          this.targetNormals.setAt(this.targetBase, this.normal.x);
          this.targetNormals.setAt(pb.add(this.targetBase, 1), this.normal.y);
          this.targetNormals.setAt(pb.add(this.targetBase, 2), this.normal.z);
        });
      });
    }
  });
  if (program) {
    program.name = '@GPUCloth_DisplacementWrapTarget';
  }
  return program;
}

function transformPointArrayByMatrix(
  matrix: Matrix4x4,
  source: Float32Array<ArrayBuffer>,
  out?: Float32Array<ArrayBuffer>
) {
  const target = out && out.length === source.length ? out : new Float32Array(source.length);
  for (let i = 0; i + 2 < source.length; i += 3) {
    const x = source[i];
    const y = source[i + 1];
    const z = source[i + 2];
    target[i] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    target[i + 1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    target[i + 2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  }
  return target;
}

function getWrapSourceToTargetMatrix(source: any, target: any, out?: Matrix4x4) {
  if (!source?.worldMatrix || !target?.invWorldMatrix) {
    return (out ?? new Matrix4x4()).identity();
  }
  return Matrix4x4.multiplyAffine(target.invWorldMatrix, source.worldMatrix, out);
}

class GPUClothWrapBinding {
  private readonly _device: AbstractDevice;
  private readonly _source: any;
  private readonly _target: any;
  private readonly _targetPrimitive: Primitive;
  private readonly _wrapTriangleIndexBuffer: GPUDataBuffer;
  private readonly _wrapBarycentricBuffer: GPUDataBuffer;
  private readonly _wrapLocalOffsetBuffer: GPUDataBuffer;
  private readonly _program: GPUProgram;
  private readonly _bindGroup: BindGroup;
  private readonly _workgroupCount: number;
  private readonly _maxOffsetDistance: number;
  private readonly _sourceToTargetMatrix: Matrix4x4;
  private readonly _positionBuffer: StructuredBuffer;
  private readonly _normalBuffer: StructuredBuffer;
  private readonly _originalPositionBuffer: Nullable<StructuredBuffer>;
  private readonly _originalNormalBuffer: Nullable<StructuredBuffer>;
  private readonly _restoreSkinning: Nullable<boolean>;

  private constructor(
    device: AbstractDevice,
    source: any,
    target: any,
    targetPrimitive: Primitive,
    wrapTriangleIndexBuffer: GPUDataBuffer,
    wrapBarycentricBuffer: GPUDataBuffer,
    wrapLocalOffsetBuffer: GPUDataBuffer,
    program: GPUProgram,
    bindGroup: BindGroup,
    positionBuffer: StructuredBuffer,
    normalBuffer: StructuredBuffer,
    originalPositionBuffer: Nullable<StructuredBuffer>,
    originalNormalBuffer: Nullable<StructuredBuffer>,
    workgroupCount: number,
    maxOffsetDistance: number,
    restoreSkinning: Nullable<boolean>
  ) {
    this._device = device;
    this._source = source;
    this._target = target;
    this._targetPrimitive = targetPrimitive;
    this._wrapTriangleIndexBuffer = wrapTriangleIndexBuffer;
    this._wrapBarycentricBuffer = wrapBarycentricBuffer;
    this._wrapLocalOffsetBuffer = wrapLocalOffsetBuffer;
    this._program = program;
    this._bindGroup = bindGroup;
    this._workgroupCount = workgroupCount;
    this._maxOffsetDistance = maxOffsetDistance;
    this._sourceToTargetMatrix = new Matrix4x4();
    this._positionBuffer = positionBuffer;
    this._normalBuffer = normalBuffer;
    this._originalPositionBuffer = originalPositionBuffer;
    this._originalNormalBuffer = originalNormalBuffer;
    this._restoreSkinning = restoreSkinning;
  }

  static async create(
    device: AbstractDevice,
    source: any,
    sourcePositionBuffer: StructuredBuffer,
    sourceRestPositions: Float32Array<ArrayBuffer>,
    sourceIndexData: Uint32Array<ArrayBuffer>,
    target: any,
    workgroupSize: number
  ) {
    const data = await GPUClothWrapBinding.createBindingData(source, sourceRestPositions, sourceIndexData, target);
    return GPUClothWrapBinding.createFromData(
      device,
      source,
      sourcePositionBuffer,
      sourceRestPositions,
      sourceIndexData,
      target,
      workgroupSize,
      data
    );
  }

  static async createBindingData(
    source: any,
    sourceRestPositions: Float32Array<ArrayBuffer>,
    sourceIndexData: Uint32Array<ArrayBuffer>,
    target: any
  ): Promise<GPUClothWrapBindingData> {
    if (!target?.primitive) {
      throw new Error('GPU cloth wrap failed: target mesh has no primitive.');
    }
    const targetPrimitive = target.primitive as Primitive;
    const targetBasePositions = await readPositionDataFromPrimitive(targetPrimitive);
    const sourceToTargetBindMatrix = getWrapSourceToTargetMatrix(source, target);
    const [resolvedSourcePositions, targetPositions] = await Promise.all([
      resolveWrapBindPositions(source, sourceRestPositions),
      resolveWrapBindPositions(target, targetBasePositions)
    ]);
    const sourcePositionsInTargetSpace = transformPointArrayByMatrix(sourceToTargetBindMatrix, resolvedSourcePositions);
    const sourceVertexCount = (sourcePositionsInTargetSpace.length / 3) >> 0;
    const sourceTriangleCount = (sourceIndexData.length / 3) >> 0;
    if (sourceVertexCount <= 0) {
      throw new Error('GPU cloth wrap failed: source mesh has no vertices.');
    }
    if (sourceTriangleCount <= 0) {
      throw new Error('GPU cloth wrap failed: source mesh has no triangles.');
    }
    const vertexCount = (targetPositions.length / 3) >> 0;
    const sourceTriangleIndices = new Uint32Array(vertexCount * WRAP_TRIANGLE_VERTEX_COUNT);
    const sourceBarycentrics = new Float32Array(vertexCount * WRAP_TRIANGLE_VERTEX_COUNT);
    const targetLocalOffsets = new Float32Array(vertexCount * 3);
    let maxOffsetDistance = 0;
    const closestPoint = new Float32Array(3);
    const barycentrics = new Float32Array(3);
    const frame = new Float32Array(9);
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const targetBase = vertex * 3;
      const vx = targetPositions[targetBase];
      const vy = targetPositions[targetBase + 1];
      const vz = targetPositions[targetBase + 2];
      let bestDistanceSq = Number.POSITIVE_INFINITY;
      let bestI0 = 0;
      let bestI1 = 0;
      let bestI2 = 0;
      let bestClosestX = vx;
      let bestClosestY = vy;
      let bestClosestZ = vz;
      let bestBary0 = 1;
      let bestBary1 = 0;
      let bestBary2 = 0;
      for (let tri = 0; tri < sourceTriangleCount; tri++) {
        const triBase = tri * 3;
        const i0 = sourceIndexData[triBase];
        const i1 = sourceIndexData[triBase + 1];
        const i2 = sourceIndexData[triBase + 2];
        if (i0 >= sourceVertexCount || i1 >= sourceVertexCount || i2 >= sourceVertexCount) {
          continue;
        }
        const base0 = i0 * 3;
        const base1 = i1 * 3;
        const base2 = i2 * 3;
        const distanceSq = closestPointOnTriangle(
          vx,
          vy,
          vz,
          sourcePositionsInTargetSpace[base0],
          sourcePositionsInTargetSpace[base0 + 1],
          sourcePositionsInTargetSpace[base0 + 2],
          sourcePositionsInTargetSpace[base1],
          sourcePositionsInTargetSpace[base1 + 1],
          sourcePositionsInTargetSpace[base1 + 2],
          sourcePositionsInTargetSpace[base2],
          sourcePositionsInTargetSpace[base2 + 1],
          sourcePositionsInTargetSpace[base2 + 2],
          closestPoint,
          barycentrics
        );
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          bestI0 = i0;
          bestI1 = i1;
          bestI2 = i2;
          bestClosestX = closestPoint[0];
          bestClosestY = closestPoint[1];
          bestClosestZ = closestPoint[2];
          bestBary0 = barycentrics[0];
          bestBary1 = barycentrics[1];
          bestBary2 = barycentrics[2];
        }
      }
      if (!Number.isFinite(bestDistanceSq)) {
        throw new Error('GPU cloth wrap failed: source mesh triangle data is invalid.');
      }
      const influenceBase = vertex * WRAP_TRIANGLE_VERTEX_COUNT;
      sourceTriangleIndices[influenceBase] = bestI0;
      sourceTriangleIndices[influenceBase + 1] = bestI1;
      sourceTriangleIndices[influenceBase + 2] = bestI2;
      sourceBarycentrics[influenceBase] = bestBary0;
      sourceBarycentrics[influenceBase + 1] = bestBary1;
      sourceBarycentrics[influenceBase + 2] = bestBary2;
      const bestBase0 = bestI0 * 3;
      const bestBase1 = bestI1 * 3;
      const bestBase2 = bestI2 * 3;
      buildWrapTriangleFrame(
        sourcePositionsInTargetSpace[bestBase0],
        sourcePositionsInTargetSpace[bestBase0 + 1],
        sourcePositionsInTargetSpace[bestBase0 + 2],
        sourcePositionsInTargetSpace[bestBase1],
        sourcePositionsInTargetSpace[bestBase1 + 1],
        sourcePositionsInTargetSpace[bestBase1 + 2],
        sourcePositionsInTargetSpace[bestBase2],
        sourcePositionsInTargetSpace[bestBase2 + 1],
        sourcePositionsInTargetSpace[bestBase2 + 2],
        frame
      );
      const deltaX = vx - bestClosestX;
      const deltaY = vy - bestClosestY;
      const deltaZ = vz - bestClosestZ;
      targetLocalOffsets[targetBase] = dot3(deltaX, deltaY, deltaZ, frame[0], frame[1], frame[2]);
      targetLocalOffsets[targetBase + 1] = dot3(deltaX, deltaY, deltaZ, frame[3], frame[4], frame[5]);
      targetLocalOffsets[targetBase + 2] = dot3(deltaX, deltaY, deltaZ, frame[6], frame[7], frame[8]);
      maxOffsetDistance = Math.max(maxOffsetDistance, Math.sqrt(bestDistanceSq));
    }

    return {
      version: 4,
      vertexCount,
      sourceVertexCount,
      influenceCount: WRAP_TRIANGLE_VERTEX_COUNT,
      maxOffsetDistance,
      sourceTriangleIndices: encodeTypedArrayBase64(sourceTriangleIndices),
      sourceBarycentrics: encodeTypedArrayBase64(sourceBarycentrics),
      targetLocalOffsets: encodeTypedArrayBase64(targetLocalOffsets)
    };
  }

  static createFromData(
    device: AbstractDevice,
    source: any,
    sourcePositionBuffer: StructuredBuffer,
    sourceRestPositions: Float32Array<ArrayBuffer>,
    _sourceIndexData: Uint32Array<ArrayBuffer>,
    target: any,
    workgroupSize: number,
    data: GPUClothWrapBindingData
  ) {
    if (!target?.primitive) {
      throw new Error('GPU cloth wrap failed: target mesh has no primitive.');
    }
    const targetPrimitive = target.primitive as Primitive;
    const vertexCount = targetPrimitive.getNumVertices();
    if (!isWrapBindingDataCompatible(data, sourceRestPositions, vertexCount)) {
      throw new Error('GPU cloth wrap failed: binding cache is incompatible with current meshes.');
    }
    const expectedElementCount = vertexCount * 3;
    const influenceElementCount = vertexCount * data.influenceCount;
    const wrapSourceTriangleIndices = decodeTypedArrayFromBase64(
      Uint32Array,
      data.sourceTriangleIndices,
      influenceElementCount
    );
    const wrapSourceBarycentrics = decodeTypedArrayFromBase64(
      Float32Array,
      data.sourceBarycentrics,
      influenceElementCount
    );
    const wrapTargetLocalOffsets = decodeTypedArrayFromBase64(
      Float32Array,
      data.targetLocalOffsets,
      expectedElementCount
    );
    const positionBuffer = device.createVertexBuffer('position_f32x3', new Float32Array(expectedElementCount), {
      storage: true,
      managed: false
    });
    if (!positionBuffer) {
      throw new Error('GPU cloth wrap failed: could not create target position buffer.');
    }
    const normalBuffer = device.createVertexBuffer('normal_f32x3', new Float32Array(expectedElementCount), {
      storage: true,
      managed: false
    });
    if (!normalBuffer) {
      throw new Error('GPU cloth wrap failed: could not create target normal buffer.');
    }

    const wrapTriangleIndexBuffer = device.createBuffer(wrapSourceTriangleIndices.byteLength, {
      usage: 'uniform',
      storage: true,
      dynamic: false,
      managed: false
    });
    wrapTriangleIndexBuffer.bufferSubData(0, wrapSourceTriangleIndices);
    const wrapBarycentricBuffer = device.createBuffer(wrapSourceBarycentrics.byteLength, {
      usage: 'uniform',
      storage: true,
      dynamic: false,
      managed: false
    });
    wrapBarycentricBuffer.bufferSubData(0, wrapSourceBarycentrics);
    const wrapLocalOffsetBuffer = device.createBuffer(wrapTargetLocalOffsets.byteLength, {
      usage: 'uniform',
      storage: true,
      dynamic: false,
      managed: false
    });
    wrapLocalOffsetBuffer.bufferSubData(0, wrapTargetLocalOffsets);
    const program = createWrapDeformerProgram(device, workgroupSize);
    if (!program) {
      throw new Error('GPU cloth wrap failed: could not create compute program.');
    }
    const bindGroup = device.createBindGroup(program.bindGroupLayouts[0]);
    bindGroup.setBuffer('sourcePositions', sourcePositionBuffer);
    bindGroup.setBuffer('sourceTriangleIndices', wrapTriangleIndexBuffer);
    bindGroup.setBuffer('sourceBarycentrics', wrapBarycentricBuffer);
    bindGroup.setBuffer('targetLocalOffsets', wrapLocalOffsetBuffer);
    bindGroup.setBuffer('targetPositions', positionBuffer);
    bindGroup.setBuffer('targetNormals', normalBuffer);
    const sourceToTargetBindMatrix = getWrapSourceToTargetMatrix(source, target);
    bindGroup.setValue('vertexCount', vertexCount);
    bindGroup.setValue('sourceToTargetMatrix', sourceToTargetBindMatrix);
    bindGroup.setValue('minDistance', 1e-5);

    const originalPositionBuffer = targetPrimitive.getVertexBuffer('position');
    const originalNormalBuffer = targetPrimitive.getVertexBuffer('normal');
    retainObject(originalPositionBuffer);
    retainObject(originalNormalBuffer);
    targetPrimitive.removeVertexBuffer('position');
    targetPrimitive.setVertexBuffer(positionBuffer!);
    targetPrimitive.removeVertexBuffer('normal');
    targetPrimitive.setVertexBuffer(normalBuffer!);

    let restoreSkinning: Nullable<boolean> = null;
    if (typeof target?.suspendSkinning === 'boolean') {
      restoreSkinning = target.suspendSkinning;
      target.suspendSkinning = true;
      target.setBoneMatrices?.(null);
      target.setAnimatedBoundingBox?.(null);
    }

    const binding = new GPUClothWrapBinding(
      device,
      source,
      target,
      targetPrimitive,
      wrapTriangleIndexBuffer,
      wrapBarycentricBuffer,
      wrapLocalOffsetBuffer,
      program,
      bindGroup,
      positionBuffer!,
      normalBuffer!,
      originalPositionBuffer,
      originalNormalBuffer,
      Math.max(1, Math.ceil(vertexCount / workgroupSize)),
      Math.max(0, Number(data.maxOffsetDistance) || 0),
      restoreSkinning
    );
    binding.update();
    return binding;
  }

  update() {
    getWrapSourceToTargetMatrix(this._source, this._target, this._sourceToTargetMatrix);
    this._bindGroup.setValue('sourceToTargetMatrix', this._sourceToTargetMatrix);
    this._device.setProgram(this._program);
    this._device.setBindGroup(0, this._bindGroup);
    this._device.compute(this._workgroupCount, 1, 1);
    this.updateBoundingBox();
  }

  dispose() {
    this._bindGroup.dispose();
    this._program.dispose();
    this._wrapTriangleIndexBuffer.dispose();
    this._wrapBarycentricBuffer.dispose();
    this._wrapLocalOffsetBuffer.dispose();
    if (this._targetPrimitive) {
      this._targetPrimitive.removeVertexBuffer('position');
      if (this._originalPositionBuffer) {
        this._targetPrimitive.setVertexBuffer(this._originalPositionBuffer);
      }
      this._targetPrimitive.removeVertexBuffer('normal');
      if (this._originalNormalBuffer) {
        this._targetPrimitive.setVertexBuffer(this._originalNormalBuffer);
      }
    }
    releaseObject(this._originalPositionBuffer);
    releaseObject(this._originalNormalBuffer);
    this._positionBuffer.dispose();
    this._normalBuffer.dispose();
    if (this._target && this._restoreSkinning !== null) {
      this._target.setAnimatedBoundingBox?.(null);
      this._target.suspendSkinning = this._restoreSkinning;
    }
  }

  private updateBoundingBox() {
    const sourceBBox =
      this._source?.getAnimatedBoundingBox?.() ??
      this._source?.primitive?.getBoundingVolume?.()?.toAABB?.() ??
      null;
    if (!sourceBBox) {
      return;
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    getWrapSourceToTargetMatrix(this._source, this._target, this._sourceToTargetMatrix);
    const corners = [
      [sourceBBox.minPoint.x, sourceBBox.minPoint.y, sourceBBox.minPoint.z],
      [sourceBBox.minPoint.x, sourceBBox.minPoint.y, sourceBBox.maxPoint.z],
      [sourceBBox.minPoint.x, sourceBBox.maxPoint.y, sourceBBox.minPoint.z],
      [sourceBBox.minPoint.x, sourceBBox.maxPoint.y, sourceBBox.maxPoint.z],
      [sourceBBox.maxPoint.x, sourceBBox.minPoint.y, sourceBBox.minPoint.z],
      [sourceBBox.maxPoint.x, sourceBBox.minPoint.y, sourceBBox.maxPoint.z],
      [sourceBBox.maxPoint.x, sourceBBox.maxPoint.y, sourceBBox.minPoint.z],
      [sourceBBox.maxPoint.x, sourceBBox.maxPoint.y, sourceBBox.maxPoint.z]
    ];
    for (const corner of corners) {
      const x =
        this._sourceToTargetMatrix[0] * corner[0] +
        this._sourceToTargetMatrix[4] * corner[1] +
        this._sourceToTargetMatrix[8] * corner[2] +
        this._sourceToTargetMatrix[12];
      const y =
        this._sourceToTargetMatrix[1] * corner[0] +
        this._sourceToTargetMatrix[5] * corner[1] +
        this._sourceToTargetMatrix[9] * corner[2] +
        this._sourceToTargetMatrix[13];
      const z =
        this._sourceToTargetMatrix[2] * corner[0] +
        this._sourceToTargetMatrix[6] * corner[1] +
        this._sourceToTargetMatrix[10] * corner[2] +
        this._sourceToTargetMatrix[14];
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
    const padding = Math.max(0.001, this._maxOffsetDistance);
    this._target?.setAnimatedBoundingBox?.(
      new BoundingBox(
        new Vector3(minX - padding, minY - padding, minZ - padding),
        new Vector3(maxX + padding, maxY + padding, maxZ + padding)
      )
    );
  }
}

export async function createGPUClothWrapBindingData(source: any, target: any): Promise<GPUClothWrapBindingData> {
  if (!source?.primitive) {
    throw new Error('GPU cloth wrap failed: source mesh has no primitive.');
  }
  const sourcePrimitive = source.primitive as Primitive;
  const sourcePositions = await readPositionDataFromPrimitive(sourcePrimitive);
  const sourceIndices = toUInt32Indices(await readIndexDataFromPrimitive(sourcePrimitive, (sourcePositions.length / 3) >> 0));
  return GPUClothWrapBinding.createBindingData(source, sourcePositions, sourceIndices, target);
}

/**
 * WebGPU-only cloth simulation entry.
 *
 * On non-WebGPU backends (including WebGL), the system is always disabled.
 */
export class GPUClothSystem {
  private _enabled: boolean;
  private _disabledReason: Nullable<string>;
  private _device: Nullable<AbstractDevice>;
  private _primitive: Nullable<Primitive>;
  private _originalPositionBuffer: Nullable<StructuredBuffer>;
  private _originalNormalBuffer: Nullable<StructuredBuffer>;
  private _positionBuffer: Nullable<StructuredBuffer>;
  private _sourceIndexData: Nullable<Uint32Array<ArrayBuffer>>;
  private _prevPositionBuffer: Nullable<GPUDataBuffer>;
  private _restPositionBuffer: Nullable<GPUDataBuffer>;
  private _prevRestPositionBuffer: Nullable<GPUDataBuffer>;
  private _invMassBuffer: Nullable<GPUDataBuffer>;
  private _neighborIndexBuffer: Nullable<GPUDataBuffer>;
  private _restLengthBuffer: Nullable<GPUDataBuffer>;
  private _integrateProgram: Nullable<GPUProgram>;
  private _constraintProgram: Nullable<GPUProgram>;
  private _faceNormalProgram: Nullable<GPUProgram>;
  private _vertexNormalProgram: Nullable<GPUProgram>;
  private _integrateBindGroup: Nullable<BindGroup>;
  private _constraintBindGroup: Nullable<BindGroup>;
  private _faceNormalBindGroup: Nullable<BindGroup>;
  private _vertexNormalBindGroup: Nullable<BindGroup>;
  private _vertexCount: number;
  private _workgroupCount: number;
  private _triangleCount: number;
  private _triangleWorkgroupCount: number;
  private _maxNeighbors: number;
  private _maxTrianglesPerVertex: number;
  private _gravity: Vector3;
  private _damping: number;
  private _dynamicFriction: number;
  private _staticFriction: number;
  private _stiffness: number;
  private _poseFollow: number;
  private _substeps: number;
  private _solverIterations: number;
  private _colliders: SpringCollider[];
  private _sphereColliderBuffer: Nullable<GPUDataBuffer>;
  private _capsuleColliderBuffer: Nullable<GPUDataBuffer>;
  private _planeColliderBuffer: Nullable<GPUDataBuffer>;
  private _sphereColliderData: Float32Array<ArrayBuffer>;
  private _capsuleColliderData: Float32Array<ArrayBuffer>;
  private _planeColliderData: Float32Array<ArrayBuffer>;
  private _triangleIndexBuffer: Nullable<GPUDataBuffer>;
  private _triangleNormalBuffer: Nullable<GPUDataBuffer>;
  private _vertexTriangleAdjacencyBuffer: Nullable<GPUDataBuffer>;
  private _normalBuffer: Nullable<StructuredBuffer>;
  private _rebuildNormals: boolean;
  private _collisionSpaceNode: any;
  private _sourcePositionData: Nullable<Float32Array<ArrayBuffer>>;
  private _skinningBlendIndices: Nullable<Float32Array<ArrayBuffer>>;
  private _skinningBlendWeights: Nullable<Float32Array<ArrayBuffer>>;
  private _dynamicRestPositionData: Nullable<Float32Array<ArrayBuffer>>;
  private _smoothedRestPositionData: Nullable<Float32Array<ArrayBuffer>>;
  private _usingDynamicRestPose: boolean;
  private _skinAnimationTarget: any;
  private _restoreSkinAnimation: Nullable<boolean>;
  private _boundScene: Nullable<Scene>;
  private _autoUpdate: boolean;
  private _workgroupSize: number;
  private _wrapBindings: GPUClothWrapBinding[];
  private _latestInputDeltaTime: number;
  private _smoothedSphereCenters: WeakMap<SphereCollider, Vector3>;
  private _smoothedCapsuleEndpoints: WeakMap<CapsuleCollider, { start: Vector3; end: Vector3 }>;
  private _smoothedPlaneData: WeakMap<PlaneCollider, { point: Vector3; normal: Vector3 }>;
  private _timeAccumulator: number;
  private _pendingAutoUpdateDeltaTime: number;
  private readonly _meshPostUpdateCallback: MeshUpdateCallback;

  constructor(options?: GPUClothSystemOptions) {
    this._device = resolveDevice(options?.device ?? null);
    const supported = isGPUClothSupported(this._device);
    const wantEnabled = options?.enabled ?? true;
    this._enabled = false;
    this._disabledReason = null;
    this._primitive = options?.primitive ?? null;
    this._originalPositionBuffer = null;
    this._originalNormalBuffer = null;
    this._positionBuffer = null;
    this._sourceIndexData = null;
    this._prevPositionBuffer = null;
    this._restPositionBuffer = null;
    this._prevRestPositionBuffer = null;
    this._invMassBuffer = null;
    this._neighborIndexBuffer = null;
    this._restLengthBuffer = null;
    this._integrateProgram = null;
    this._constraintProgram = null;
    this._faceNormalProgram = null;
    this._vertexNormalProgram = null;
    this._integrateBindGroup = null;
    this._constraintBindGroup = null;
    this._faceNormalBindGroup = null;
    this._vertexNormalBindGroup = null;
    this._vertexCount = 0;
    this._workgroupCount = 0;
    this._triangleCount = 0;
    this._triangleWorkgroupCount = 0;
    this._maxNeighbors = clamp(options?.maxNeighbors ?? DEFAULT_MAX_NEIGHBORS, 1, 64) | 0;
    this._maxTrianglesPerVertex = clamp(
      options?.maxTrianglesPerVertex ?? DEFAULT_MAX_TRIANGLES_PER_VERTEX,
      1,
      64
    );
    this._gravity = options?.gravity?.clone() ?? new Vector3(0, -9.8, 0);
    this._damping = clamp(options?.damping ?? DEFAULT_DAMPING, 0, 1);
    this._dynamicFriction = clamp(options?.dynamicFriction ?? DEFAULT_DYNAMIC_FRICTION, 0, 1);
    this._staticFriction = clamp(options?.staticFriction ?? DEFAULT_STATIC_FRICTION, 0, 1);
    this._stiffness = clamp(options?.stiffness ?? DEFAULT_STIFFNESS, 0, 1);
    this._poseFollow = clamp(options?.poseFollow ?? DEFAULT_POSE_FOLLOW, 0, 1);
    this._substeps = clamp(options?.substeps ?? DEFAULT_SUBSTEPS, 1, 8) | 0;
    this._solverIterations = Math.max(1, (options?.solverIterations ?? DEFAULT_SOLVER_ITERATIONS) | 0);
    this._colliders = [...(options?.colliders ?? [])];
    this._sphereColliderBuffer = null;
    this._capsuleColliderBuffer = null;
    this._planeColliderBuffer = null;
    this._sphereColliderData = new Float32Array(
      getInitialColliderBufferFloatCount(this._colliders, 'sphere', 4)
    );
    this._capsuleColliderData = new Float32Array(
      getInitialColliderBufferFloatCount(this._colliders, 'capsule', 8)
    );
    this._planeColliderData = new Float32Array(
      getInitialColliderBufferFloatCount(this._colliders, 'plane', 8)
    );
    this._triangleIndexBuffer = null;
    this._triangleNormalBuffer = null;
    this._vertexTriangleAdjacencyBuffer = null;
    this._normalBuffer = null;
    this._rebuildNormals = options?.rebuildNormals ?? true;
    this._collisionSpaceNode = options?.collisionSpaceNode ?? null;
    this._sourcePositionData = options?.positionData ? new Float32Array(options.positionData) : null;
    this._skinningBlendIndices = options?.skinningBlendIndices
      ? new Float32Array(options.skinningBlendIndices)
      : null;
    this._skinningBlendWeights = options?.skinningBlendWeights
      ? new Float32Array(options.skinningBlendWeights)
      : null;
    this._dynamicRestPositionData = null;
    this._smoothedRestPositionData = null;
    this._usingDynamicRestPose = false;
    this._skinAnimationTarget = null;
    this._restoreSkinAnimation = null;
    this._boundScene = null;
    this._autoUpdate = options?.autoUpdate ?? true;
    this._workgroupSize = clamp(options?.workgroupSize ?? DEFAULT_WORKGROUP_SIZE, 1, 256) | 0;
    this._wrapBindings = [];
    this._latestInputDeltaTime = 0;
    this._smoothedSphereCenters = new WeakMap();
    this._smoothedCapsuleEndpoints = new WeakMap();
    this._smoothedPlaneData = new WeakMap();
    this._timeAccumulator = 0;
    this._pendingAutoUpdateDeltaTime = 0;
    this._meshPostUpdateCallback = (_frameId, _elapsedInSeconds, deltaInSeconds) => {
      const dt = this._pendingAutoUpdateDeltaTime || deltaInSeconds;
      if (dt > 0) {
        this._pendingAutoUpdateDeltaTime = 0;
        this.update(dt);
      }
    };

    if (!supported) {
      this._disabledReason = 'GPU cloth is disabled: current backend is not WebGPU.';
      return;
    }

    if (!this._device) {
      this._disabledReason = 'GPU cloth is disabled: no active rendering device.';
      return;
    }

    if (!this._primitive) {
      this._disabledReason = 'GPU cloth is disabled: primitive is required.';
      return;
    }

    if (!options?.positionData || !options?.indexData) {
      this._disabledReason =
        'GPU cloth is disabled: positionData and indexData are required. Use createFromPrimitive(...) to build them automatically.';
      return;
    }

    const vertexCount = (options.positionData.length / 3) >> 0;
    if (vertexCount <= 0 || options.positionData.length % 3 !== 0) {
      this._disabledReason = 'GPU cloth is disabled: invalid positionData.';
      return;
    }
    if (options.indexData.length < 3 || options.indexData.length % 3 !== 0) {
      this._disabledReason = 'GPU cloth is disabled: indexData must be triangle indices.';
      return;
    }

    const initialSimulationPositions = buildInitialSimulationPositions(options) ?? new Float32Array(options.positionData);
    const workgroupSize = this._workgroupSize;
    const indexDataU32 = toUInt32Indices(options.indexData);
    this._sourceIndexData = new Uint32Array(indexDataU32);
    const pinWeightArray = buildPinWeightArray(
      initialSimulationPositions,
      options.pinnedVertexWeights,
      options.pinnedVertexIndices
    );
    const neighbors = buildNeighborData(initialSimulationPositions, options.indexData, this._maxNeighbors);
    const adjacency = buildVertexTriangleAdjacency(
      vertexCount,
      indexDataU32,
      this._maxTrianglesPerVertex
    );
    if (!neighbors.hasConstraint) {
      this._disabledReason = 'GPU cloth is disabled: could not build cloth constraints from indexData.';
      return;
    }

    try {
      this._positionBuffer = this._device.createVertexBuffer('position_f32x3', initialSimulationPositions, {
        storage: true,
        managed: false
      });
      if (!this._positionBuffer) {
        this._disabledReason = 'GPU cloth is disabled: failed to create cloth position buffer.';
        return;
      }
      this._prevPositionBuffer = this._device.createBuffer(options.positionData.byteLength, {
        usage: 'uniform',
        storage: true,
        dynamic: false,
        managed: false
      });
      this._prevPositionBuffer.bufferSubData(0, initialSimulationPositions);

      this._restPositionBuffer = this._device.createBuffer(options.positionData.byteLength, {
        usage: 'uniform',
        storage: true,
        dynamic: false,
        managed: false
      });
      this._restPositionBuffer.bufferSubData(0, initialSimulationPositions);

      this._prevRestPositionBuffer = this._device.createBuffer(options.positionData.byteLength, {
        usage: 'uniform',
        storage: true,
        dynamic: false,
        managed: false
      });
      this._prevRestPositionBuffer.bufferSubData(0, initialSimulationPositions);

      const invMassArray = new Float32Array(vertexCount);
      for (let i = 0; i < vertexCount; i++) {
        invMassArray[i] = 1 - pinWeightArray[i];
      }
      this._invMassBuffer = this._device.createBuffer(invMassArray.byteLength, {
        usage: 'uniform',
        storage: true,
        dynamic: false,
        managed: false
      });
      this._invMassBuffer.bufferSubData(0, invMassArray);

      this._neighborIndexBuffer = this._device.createBuffer(neighbors.neighborIndices.byteLength, {
        usage: 'uniform',
        storage: true,
        dynamic: false,
        managed: false
      });
      this._neighborIndexBuffer.bufferSubData(0, neighbors.neighborIndices);

      this._restLengthBuffer = this._device.createBuffer(neighbors.restLengths.byteLength, {
        usage: 'uniform',
        storage: true,
        dynamic: false,
        managed: false
      });
      this._restLengthBuffer.bufferSubData(0, neighbors.restLengths);

      this._triangleIndexBuffer = this._device.createBuffer(indexDataU32.byteLength, {
        usage: 'uniform',
        storage: true,
        dynamic: false,
        managed: false
      });
      this._triangleIndexBuffer.bufferSubData(0, indexDataU32);

      this._triangleNormalBuffer = this._device.createBuffer(adjacency.triangleCount * 3 * 4, {
        usage: 'uniform',
        storage: true,
        dynamic: false,
        managed: false
      });

      this._vertexTriangleAdjacencyBuffer = this._device.createBuffer(adjacency.adjacency.byteLength, {
        usage: 'uniform',
        storage: true,
        dynamic: false,
        managed: false
      });
      this._vertexTriangleAdjacencyBuffer.bufferSubData(0, adjacency.adjacency);

      this._sphereColliderBuffer = this._device.createBuffer(this._sphereColliderData.byteLength, {
        usage: 'uniform',
        storage: true,
        dynamic: false,
        managed: false
      });
      this._sphereColliderBuffer.bufferSubData(0, this._sphereColliderData);

      this._capsuleColliderBuffer = this._device.createBuffer(this._capsuleColliderData.byteLength, {
        usage: 'uniform',
        storage: true,
        dynamic: false,
        managed: false
      });
      this._capsuleColliderBuffer.bufferSubData(0, this._capsuleColliderData);

      this._planeColliderBuffer = this._device.createBuffer(this._planeColliderData.byteLength, {
        usage: 'uniform',
        storage: true,
        dynamic: false,
        managed: false
      });
      this._planeColliderBuffer.bufferSubData(0, this._planeColliderData);

      this._integrateProgram = createIntegrateProgram(this._device, workgroupSize);
      this._constraintProgram = createConstraintProgram(this._device, workgroupSize);
      if (!this._integrateProgram || !this._constraintProgram) {
        this._disabledReason = 'GPU cloth is disabled: failed to create compute programs.';
        return;
      }

      this._integrateBindGroup = this._device.createBindGroup(this._integrateProgram.bindGroupLayouts[0]);
      this._integrateBindGroup.setBuffer('positions', this._positionBuffer!);
      this._integrateBindGroup.setBuffer('prevPositions', this._prevPositionBuffer);
      this._integrateBindGroup.setBuffer('restPositions', this._restPositionBuffer);
      this._integrateBindGroup.setBuffer('prevRestPositions', this._prevRestPositionBuffer);
      this._integrateBindGroup.setBuffer('invMass', this._invMassBuffer);
      this._integrateBindGroup.setBuffer('sphereData', this._sphereColliderBuffer);
      this._integrateBindGroup.setBuffer('capsuleData', this._capsuleColliderBuffer);
      this._integrateBindGroup.setBuffer('planeData', this._planeColliderBuffer);
      this._integrateBindGroup.setValue('vertexCount', vertexCount);
      this._integrateBindGroup.setValue('damping', this._damping);
      this._integrateBindGroup.setValue('gravity', this._gravity);
      this._integrateBindGroup.setValue('sphereCount', 0);
      this._integrateBindGroup.setValue('capsuleCount', 0);
      this._integrateBindGroup.setValue('planeCount', 0);
      this._integrateBindGroup.setValue('dynamicFriction', this._dynamicFriction);
      this._integrateBindGroup.setValue('staticFriction', this._staticFriction);
      this._integrateBindGroup.setValue('minDistance', 1e-5);

      this._constraintBindGroup = this._device.createBindGroup(this._constraintProgram.bindGroupLayouts[0]);
      this._constraintBindGroup.setBuffer('positions', this._positionBuffer!);
      this._constraintBindGroup.setBuffer('restPositions', this._restPositionBuffer);
      this._constraintBindGroup.setBuffer('invMass', this._invMassBuffer);
      this._constraintBindGroup.setBuffer('neighborIndices', this._neighborIndexBuffer);
      this._constraintBindGroup.setBuffer('restLengths', this._restLengthBuffer);
      this._constraintBindGroup.setBuffer('sphereData', this._sphereColliderBuffer);
      this._constraintBindGroup.setBuffer('capsuleData', this._capsuleColliderBuffer);
      this._constraintBindGroup.setBuffer('planeData', this._planeColliderBuffer);
      this._constraintBindGroup.setValue('vertexCount', vertexCount);
      this._constraintBindGroup.setValue('maxNeighbors', this._maxNeighbors);
      this._constraintBindGroup.setValue('stiffness', this._stiffness);
      this._constraintBindGroup.setValue('poseFollow', this.getSubstepPoseFollow());
      this._constraintBindGroup.setValue('sphereCount', 0);
      this._constraintBindGroup.setValue('capsuleCount', 0);
      this._constraintBindGroup.setValue('planeCount', 0);
      this._constraintBindGroup.setValue('dynamicFriction', this._dynamicFriction);
      this._constraintBindGroup.setValue('staticFriction', this._staticFriction);
      this._constraintBindGroup.setValue('minDistance', 1e-5);

      if (this._rebuildNormals) {
        this._normalBuffer = this._device.createVertexBuffer(
          'normal_f32x3',
          new Float32Array(vertexCount * 3),
          {
            storage: true,
            managed: false
          }
        );
        if (this._normalBuffer) {
          this._faceNormalProgram = createFaceNormalProgram(this._device, workgroupSize);
          this._vertexNormalProgram = createVertexNormalProgram(this._device, workgroupSize);
          if (!this._faceNormalProgram || !this._vertexNormalProgram) {
            this._disabledReason = 'GPU cloth is disabled: failed to create normal reconstruction programs.';
            return;
          }
          this._faceNormalBindGroup = this._device.createBindGroup(
            this._faceNormalProgram.bindGroupLayouts[0]
          );
          this._faceNormalBindGroup.setBuffer('positions', this._positionBuffer!);
          this._faceNormalBindGroup.setBuffer('triangleIndices', this._triangleIndexBuffer);
          this._faceNormalBindGroup.setBuffer('triangleNormals', this._triangleNormalBuffer);
          this._faceNormalBindGroup.setValue('triangleCount', adjacency.triangleCount);
          this._faceNormalBindGroup.setValue('minDistance', 1e-5);

          this._vertexNormalBindGroup = this._device.createBindGroup(
            this._vertexNormalProgram.bindGroupLayouts[0]
          );
          this._vertexNormalBindGroup.setBuffer('triangleNormals', this._triangleNormalBuffer);
          this._vertexNormalBindGroup.setBuffer(
            'vertexTriangleAdjacency',
            this._vertexTriangleAdjacencyBuffer
          );
          this._vertexNormalBindGroup.setBuffer('vertexNormals', this._normalBuffer);
          this._vertexNormalBindGroup.setValue('vertexCount', vertexCount);
          this._vertexNormalBindGroup.setValue('maxTrianglesPerVertex', this._maxTrianglesPerVertex);
          this._vertexNormalBindGroup.setValue('minDistance', 1e-5);
        }
      }

      this._originalPositionBuffer = this._primitive.getVertexBuffer('position');
      retainObject(this._originalPositionBuffer);
      this._primitive.removeVertexBuffer('position');
      this._primitive.setVertexBuffer(this._positionBuffer!);
      if (this._normalBuffer) {
        this._originalNormalBuffer = this._primitive.getVertexBuffer('normal');
        retainObject(this._originalNormalBuffer);
        this._primitive.removeVertexBuffer('normal');
        this._primitive.setVertexBuffer(this._normalBuffer);
      }
      this._vertexCount = vertexCount;
      this._workgroupCount = Math.max(1, Math.ceil(vertexCount / workgroupSize));
      this._triangleCount = adjacency.triangleCount;
      this._triangleWorkgroupCount = Math.max(1, Math.ceil(this._triangleCount / workgroupSize));
      this.disableTargetSkinning();
      this.updateTargetBoundingBox(initialSimulationPositions);
      this.updateColliderBuffers();
      if (this._autoUpdate && options?.scene) {
        this.bindToScene(options.scene);
      }
      this._enabled = !!wantEnabled;
      this._disabledReason = null;
    } catch (err) {
      this._disabledReason = `GPU cloth initialization failed: ${
        err instanceof Error ? err.message : String(err)
      }`;
      this._enabled = false;
    }
  }

  static async createFromPrimitive(
    primitive: Primitive,
    options?: Omit<GPUClothSystemOptions, 'primitive' | 'positionData' | 'indexData'>
  ) {
    const positionData = await readPositionDataFromPrimitive(primitive);
    const skinningData = await readSkinningDataFromPrimitive(primitive);
    const indexData = await readIndexDataFromPrimitive(primitive, (positionData.length / 3) >> 0);
    return new GPUClothSystem({
      ...options,
      primitive,
      positionData,
      indexData,
      skinningBlendIndices: skinningData?.blendIndices ?? undefined,
      skinningBlendWeights: skinningData?.blendWeights ?? undefined
    });
  }

  static async createFromMesh(
    mesh: { primitive: Nullable<Primitive>; scene?: Nullable<Scene> },
    options?: Omit<GPUClothSystemOptions, 'primitive' | 'positionData' | 'indexData' | 'scene'>
  ) {
    if (!mesh.primitive) {
      throw new Error('GPU cloth initialization failed: mesh has no primitive.');
    }
    return GPUClothSystem.createFromPrimitive(mesh.primitive, {
      ...options,
      collisionSpaceNode: mesh,
      scene: mesh.scene ?? null
    });
  }

  async setWrapTargets(targets: any[]) {
    this.clearWrapTargets();
    if (!this.supported || !this._device || !this._positionBuffer || !this._sourcePositionData || !this._sourceIndexData) {
      return;
    }
    const uniqueTargets = [
      ...new Set((targets ?? []).filter((target) => target?.primitive && target !== this._collisionSpaceNode))
    ];
    for (const target of uniqueTargets) {
      try {
        const binding = await GPUClothWrapBinding.create(
          this._device,
          this._collisionSpaceNode,
          this._positionBuffer,
          this._sourcePositionData,
          this._sourceIndexData,
          target,
          this._workgroupSize
        );
        this._wrapBindings.push(binding);
      } catch (err) {
        console.error('GPU cloth wrap target initialization failed:', err);
      }
    }
  }

  setWrapTargetsFromBindingData(targets: GPUClothWrapBindingTarget[]) {
    this.clearWrapTargets();
    if (!this.supported || !this._device || !this._positionBuffer || !this._sourcePositionData || !this._sourceIndexData) {
      return;
    }
    const seen = new Set<any>();
    for (const entry of targets ?? []) {
      const target = entry?.target;
      if (!target?.primitive || target === this._collisionSpaceNode || seen.has(target)) {
        continue;
      }
      seen.add(target);
      try {
        const binding = GPUClothWrapBinding.createFromData(
          this._device,
          this._collisionSpaceNode,
          this._positionBuffer,
          this._sourcePositionData,
          this._sourceIndexData,
          target,
          this._workgroupSize,
          entry.data
        );
        this._wrapBindings.push(binding);
      } catch (err) {
        console.error('GPU cloth wrap target binding cache initialization failed:', err);
      }
    }
  }

  clearWrapTargets() {
    if (this._wrapBindings.length === 0) {
      return;
    }
    for (const binding of this._wrapBindings) {
      binding.dispose();
    }
    this._wrapBindings = [];
  }

  get enabled() {
    return this._enabled;
  }

  set enabled(value: boolean) {
    const enabled = this.supported && !!value;
    if (this._enabled !== enabled) {
      this.resetSimulationTiming();
    }
    this._enabled = enabled;
  }

  get supported() {
    return this._disabledReason === null;
  }

  get disabledReason() {
    return this._disabledReason;
  }

  get colliders() {
    return this._colliders;
  }

  set colliders(value: SpringCollider[]) {
    this._colliders = [...(value ?? [])];
    this.resetColliderSmoothing();
    this.updateColliderBuffers();
  }

  addCollider(collider: SpringCollider) {
    this._colliders.push(collider);
    this.updateColliderBuffers();
  }

  removeCollider(collider: SpringCollider) {
    const idx = this._colliders.indexOf(collider);
    if (idx >= 0) {
      this._colliders.splice(idx, 1);
      this.updateColliderBuffers();
      return true;
    }
    return false;
  }

  clearColliders() {
    this._colliders.length = 0;
    this.resetColliderSmoothing();
    this.updateColliderBuffers();
  }

  get gravity() {
    return this._gravity;
  }

  set gravity(value: Vector3) {
    this._gravity.set(value);
  }

  get damping() {
    return this._damping;
  }

  set damping(value: number) {
    this._damping = clamp(value, 0, 1);
  }

  get dynamicFriction() {
    return this._dynamicFriction;
  }

  set dynamicFriction(value: number) {
    this._dynamicFriction = clamp(value, 0, 1);
  }

  get staticFriction() {
    return this._staticFriction;
  }

  set staticFriction(value: number) {
    this._staticFriction = clamp(value, 0, 1);
  }

  get stiffness() {
    return this._stiffness;
  }

  set stiffness(value: number) {
    this._stiffness = clamp(value, 0, 1);
  }

  get poseFollow() {
    return this._poseFollow;
  }

  set poseFollow(value: number) {
    this._poseFollow = clamp(value, 0, 1);
  }

  get solverIterations() {
    return this._solverIterations;
  }

  set solverIterations(value: number) {
    this._solverIterations = Math.max(1, value | 0);
  }

  get substeps() {
    return this._substeps;
  }

  set substeps(value: number) {
    this._substeps = clamp(value, 1, 8) | 0;
  }

  get vertexCount() {
    return this._vertexCount;
  }

  bindToScene(scene: Nullable<Scene>) {
    if (this._boundScene === scene) {
      return;
    }
    this.detachAutoUpdateTarget();
    if (this._boundScene) {
      this._boundScene.off('update', this._onSceneUpdate, this);
    }
    this._boundScene = scene ?? null;
    if (this._boundScene) {
      this._boundScene.on('update', this._onSceneUpdate, this);
      this.attachAutoUpdateTarget();
    }
  }

  unbindFromScene() {
    this.bindToScene(null);
  }

  update(deltaTime: number) {
    if (!this._enabled) {
      return;
    }
    if (
      !this._device ||
      !this._integrateProgram ||
      !this._constraintProgram ||
      !this._integrateBindGroup ||
      !this._constraintBindGroup
    ) {
      return;
    }
    const frameDt = clamp(Number(deltaTime) || 0, 0, MAX_ACCUMULATED_SIMULATION_TIME);
    this._latestInputDeltaTime = frameDt;
    this.updateSkinnedRestPositions(frameDt);
    this.updateColliderBuffers(frameDt);
    if (frameDt <= 0) {
      return;
    }
    this._timeAccumulator = Math.min(this._timeAccumulator + frameDt, MAX_ACCUMULATED_SIMULATION_TIME);
    const stepCount = Math.min(
      MAX_SIMULATION_STEPS_PER_UPDATE,
      Math.floor((this._timeAccumulator + 1e-8) / FIXED_SIMULATION_TIME_STEP)
    );
    if (stepCount <= 0) {
      return;
    }
    this._timeAccumulator = Math.max(0, this._timeAccumulator - stepCount * FIXED_SIMULATION_TIME_STEP);
    this._device.pushDeviceStates();
    try {
      for (let step = 0; step < stepCount; step++) {
        this.simulateStep(FIXED_SIMULATION_TIME_STEP);
      }
      this.updateSimulationOutputs();
    } finally {
      this._device.popDeviceStates();
    }
  }

  dispose() {
    this.unbindFromScene();
    this.clearWrapTargets();
    this.restoreTargetSkinning();
    if (this._primitive) {
      if (this._positionBuffer) {
        this._primitive.removeVertexBuffer('position');
        if (this._originalPositionBuffer) {
          this._primitive.setVertexBuffer(this._originalPositionBuffer);
        }
      }
      if (this._normalBuffer || this._originalNormalBuffer) {
        this._primitive.removeVertexBuffer('normal');
        if (this._originalNormalBuffer) {
          this._primitive.setVertexBuffer(this._originalNormalBuffer);
        }
      }
    }
    this._integrateBindGroup?.dispose();
    this._integrateBindGroup = null;
    this._constraintBindGroup?.dispose();
    this._constraintBindGroup = null;
    this._faceNormalBindGroup?.dispose();
    this._faceNormalBindGroup = null;
    this._vertexNormalBindGroup?.dispose();
    this._vertexNormalBindGroup = null;
    this._integrateProgram?.dispose();
    this._integrateProgram = null;
    this._constraintProgram?.dispose();
    this._constraintProgram = null;
    this._faceNormalProgram?.dispose();
    this._faceNormalProgram = null;
    this._vertexNormalProgram?.dispose();
    this._vertexNormalProgram = null;
    this._prevPositionBuffer?.dispose();
    this._prevPositionBuffer = null;
    this._restPositionBuffer?.dispose();
    this._restPositionBuffer = null;
    this._prevRestPositionBuffer?.dispose();
    this._prevRestPositionBuffer = null;
    this._invMassBuffer?.dispose();
    this._invMassBuffer = null;
    this._neighborIndexBuffer?.dispose();
    this._neighborIndexBuffer = null;
    this._restLengthBuffer?.dispose();
    this._restLengthBuffer = null;
    this._triangleIndexBuffer?.dispose();
    this._triangleIndexBuffer = null;
    this._triangleNormalBuffer?.dispose();
    this._triangleNormalBuffer = null;
    this._vertexTriangleAdjacencyBuffer?.dispose();
    this._vertexTriangleAdjacencyBuffer = null;
    this._sphereColliderBuffer?.dispose();
    this._sphereColliderBuffer = null;
    this._capsuleColliderBuffer?.dispose();
    this._capsuleColliderBuffer = null;
    this._planeColliderBuffer?.dispose();
    this._planeColliderBuffer = null;
    releaseObject(this._originalPositionBuffer);
    this._originalPositionBuffer = null;
    releaseObject(this._originalNormalBuffer);
    this._originalNormalBuffer = null;
    this._enabled = false;
    this.resetSimulationTiming();
  }

  private simulateStep(deltaTime: number) {
    const substeps = this._substeps;
    const substepDt = deltaTime / substeps;
    try {
      for (let substep = 0; substep < substeps; substep++) {
        this._integrateBindGroup!.setValue('deltaTime', substepDt);
        this._integrateBindGroup!.setValue('damping', this._damping);
        this._integrateBindGroup!.setValue('gravity', this._gravity);
        this._integrateBindGroup!.setValue('dynamicFriction', this._dynamicFriction);
        this._integrateBindGroup!.setValue('staticFriction', this._staticFriction);
        this._device!.setProgram(this._integrateProgram!);
        this._device!.setBindGroup(0, this._integrateBindGroup!);
        this._device!.compute(this._workgroupCount, 1, 1);

        this._constraintBindGroup!.setValue('stiffness', this._stiffness);
        this._constraintBindGroup!.setValue('dynamicFriction', this._dynamicFriction);
        this._constraintBindGroup!.setValue('staticFriction', this._staticFriction);
        this._device!.setProgram(this._constraintProgram!);
        this._device!.setBindGroup(0, this._constraintBindGroup!);
        for (let i = 0; i < this._solverIterations; i++) {
          this._constraintBindGroup!.setValue(
            'poseFollow',
            i === this._solverIterations - 1 ? this.getSubstepPoseFollow() : 0
          );
          this._device!.compute(this._workgroupCount, 1, 1);
        }
      }
    } finally {
      // Advance the animated rest pose once per fixed simulation step so a
      // single dropped frame does not inject the same pose delta repeatedly.
      this.commitRestPositions();
    }
  }

  private updateSimulationOutputs() {
    if (
      this._rebuildNormals &&
      this._faceNormalProgram &&
      this._vertexNormalProgram &&
      this._faceNormalBindGroup &&
      this._vertexNormalBindGroup
    ) {
      this._device!.setProgram(this._faceNormalProgram);
      this._device!.setBindGroup(0, this._faceNormalBindGroup);
      this._device!.compute(this._triangleWorkgroupCount, 1, 1);

      this._device!.setProgram(this._vertexNormalProgram);
      this._device!.setBindGroup(0, this._vertexNormalBindGroup);
      this._device!.compute(this._workgroupCount, 1, 1);
    }
    for (const binding of this._wrapBindings) {
      binding.update();
    }
  }

  private resetSimulationTiming() {
    this._timeAccumulator = 0;
    this._latestInputDeltaTime = 0;
    this._pendingAutoUpdateDeltaTime = 0;
    this._smoothedRestPositionData = null;
    this.resetColliderSmoothing();
  }

  private resetColliderSmoothing() {
    this._smoothedSphereCenters = new WeakMap();
    this._smoothedCapsuleEndpoints = new WeakMap();
    this._smoothedPlaneData = new WeakMap();
  }

  private updateColliderBuffers(deltaTime = this._latestInputDeltaTime) {
    if (!this._device || !this._integrateBindGroup) {
      return;
    }

    const spheres: { collider: SphereCollider; center: Vector3 }[] = [];
    const capsules: { collider: CapsuleCollider; start: Vector3; end: Vector3 }[] = [];
    const planes: { collider: PlaneCollider; point: Vector3; normal: Vector3 }[] = [];
    const blend = this.getTemporalBlendFactor(deltaTime, DEFAULT_COLLIDER_SMOOTHING_TIME);
    for (const collider of this._colliders) {
      if (!collider?.enabled) {
        continue;
      }
      if (collider.node) {
        updateColliderFromNode(collider);
      }
      if (collider.type === 'sphere') {
        const sphere = collider as SphereCollider;
        spheres.push({
          collider: sphere,
          center: this.getSmoothedSphereCenter(sphere, blend)
        });
      } else if (collider.type === 'capsule') {
        const capsule = collider as CapsuleCollider;
        const smoothed = this.getSmoothedCapsuleEndpoints(capsule, blend);
        capsules.push({
          collider: capsule,
          start: smoothed.start,
          end: smoothed.end
        });
      } else if (collider.type === 'plane') {
        const plane = collider as PlaneCollider;
        const smoothed = this.getSmoothedPlaneData(plane, blend);
        planes.push({
          collider: plane,
          point: smoothed.point,
          normal: smoothed.normal
        });
      }
    }

    const sphereData = new Float32Array(Math.max(1, spheres.length) * 4);
    for (let i = 0; i < spheres.length; i++) {
      const base = i * 4;
      const center = this.toCollisionSpacePoint(spheres[i].center);
      sphereData[base] = center.x;
      sphereData[base + 1] = center.y;
      sphereData[base + 2] = center.z;
      sphereData[base + 3] = this.toCollisionSpaceRadius(spheres[i].collider.radius);
    }

    const capsuleData = new Float32Array(Math.max(1, capsules.length) * 8);
    for (let i = 0; i < capsules.length; i++) {
      const base = i * 8;
      const start = this.toCollisionSpacePoint(capsules[i].start);
      const end = this.toCollisionSpacePoint(capsules[i].end);
      const axis = Vector3.sub(capsules[i].end, capsules[i].start, new Vector3());
      capsuleData[base] = start.x;
      capsuleData[base + 1] = start.y;
      capsuleData[base + 2] = start.z;
      capsuleData[base + 3] = this.toCollisionSpaceRadius(capsules[i].collider.radius, axis);
      capsuleData[base + 4] = end.x;
      capsuleData[base + 5] = end.y;
      capsuleData[base + 6] = end.z;
      capsuleData[base + 7] = 0;
    }

    const planeData = new Float32Array(Math.max(1, planes.length) * 8);
    for (let i = 0; i < planes.length; i++) {
      const base = i * 8;
      const point = this.toCollisionSpacePoint(planes[i].point);
      const normal = this.toCollisionSpaceVector(planes[i].normal);
      if (normal.magnitudeSq > 1e-8) {
        normal.inplaceNormalize();
      } else {
        normal.setXYZ(0, 1, 0);
      }
      planeData[base] = point.x;
      planeData[base + 1] = point.y;
      planeData[base + 2] = point.z;
      planeData[base + 3] = 0;
      planeData[base + 4] = normal.x;
      planeData[base + 5] = normal.y;
      planeData[base + 6] = normal.z;
      planeData[base + 7] = 0;
    }

    if (!this._sphereColliderBuffer || this._sphereColliderBuffer.byteLength < sphereData.byteLength) {
      if (this._sphereColliderBuffer) {
        // Drain queued uploads for the old buffer before replacing it.
        this._device.flush();
        this._sphereColliderBuffer.dispose();
      }
      this._sphereColliderBuffer = this._device.createBuffer(sphereData.byteLength, {
        usage: 'uniform',
        storage: true,
        dynamic: false,
        managed: false
      });
      this._integrateBindGroup.setBuffer('sphereData', this._sphereColliderBuffer);
      this._constraintBindGroup?.setBuffer('sphereData', this._sphereColliderBuffer);
    }
    this._sphereColliderBuffer.bufferSubData(0, sphereData);

    if (!this._capsuleColliderBuffer || this._capsuleColliderBuffer.byteLength < capsuleData.byteLength) {
      if (this._capsuleColliderBuffer) {
        // Drain queued uploads for the old buffer before replacing it.
        this._device.flush();
        this._capsuleColliderBuffer.dispose();
      }
      this._capsuleColliderBuffer = this._device.createBuffer(capsuleData.byteLength, {
        usage: 'uniform',
        storage: true,
        dynamic: false,
        managed: false
      });
      this._integrateBindGroup.setBuffer('capsuleData', this._capsuleColliderBuffer);
      this._constraintBindGroup?.setBuffer('capsuleData', this._capsuleColliderBuffer);
    }
    this._capsuleColliderBuffer.bufferSubData(0, capsuleData);

    if (!this._planeColliderBuffer || this._planeColliderBuffer.byteLength < planeData.byteLength) {
      if (this._planeColliderBuffer) {
        // Drain queued uploads for the old buffer before replacing it.
        this._device.flush();
        this._planeColliderBuffer.dispose();
      }
      this._planeColliderBuffer = this._device.createBuffer(planeData.byteLength, {
        usage: 'uniform',
        storage: true,
        dynamic: false,
        managed: false
      });
      this._integrateBindGroup.setBuffer('planeData', this._planeColliderBuffer);
      this._constraintBindGroup?.setBuffer('planeData', this._planeColliderBuffer);
    }
    this._planeColliderBuffer.bufferSubData(0, planeData);

    this._integrateBindGroup.setValue('sphereCount', spheres.length);
    this._integrateBindGroup.setValue('capsuleCount', capsules.length);
    this._integrateBindGroup.setValue('planeCount', planes.length);
    this._constraintBindGroup?.setValue('sphereCount', spheres.length);
    this._constraintBindGroup?.setValue('capsuleCount', capsules.length);
    this._constraintBindGroup?.setValue('planeCount', planes.length);
  }

  private getSubstepPoseFollow() {
    const effectivePoseFollow = this.getEffectivePoseFollow();
    if (effectivePoseFollow <= 0) {
      return 0;
    }
    const totalPoseFollowApplications = Math.max(1, this._substeps);
    return totalPoseFollowApplications > 1
      ? 1 - Math.pow(Math.max(0, 1 - effectivePoseFollow), 1 / totalPoseFollowApplications)
      : effectivePoseFollow;
  }

  private getEffectivePoseFollow() {
    // Cloth uses a dense per-vertex animated target, so the same numeric follow value
    // feels much stronger than sparse spring chains. Square the UI value to keep the
    // low range usable while preserving 1 => full follow.
    return this._poseFollow * this._poseFollow;
  }

  private toCollisionSpacePoint(worldPoint: Vector3): Vector3 {
    const invWorldMatrix = this._collisionSpaceNode?.invWorldMatrix;
    if (!invWorldMatrix?.transformPointAffine) {
      return worldPoint;
    }
    return invWorldMatrix.transformPointAffine(worldPoint, new Vector3());
  }

  private toCollisionSpaceVector(worldVector: Vector3): Vector3 {
    const invWorldMatrix = this._collisionSpaceNode?.invWorldMatrix;
    if (!invWorldMatrix?.transformVectorAffine) {
      return worldVector;
    }
    return invWorldMatrix.transformVectorAffine(worldVector, new Vector3());
  }

  private toCollisionSpaceRadius(worldRadius: number, axisWorld?: Vector3): number {
    const radius = Math.max(0, Number(worldRadius) || 0);
    if (radius <= 0) {
      return 0;
    }
    const invWorldMatrix = this._collisionSpaceNode?.invWorldMatrix;
    if (!invWorldMatrix?.transformVectorAffine) {
      return radius;
    }
    if (axisWorld && axisWorld.magnitudeSq > 1e-6) {
      const axis = axisWorld.clone().inplaceNormalize();
      let tangent = Vector3.cross(Math.abs(axis.y) < 0.999 ? Vector3.axisPY() : Vector3.axisPX(), axis, new Vector3());
      if (tangent.magnitudeSq <= 1e-6) {
        tangent = Vector3.cross(Vector3.axisPZ(), axis, tangent);
      }
      tangent.inplaceNormalize();
      const bitangent = Vector3.cross(axis, tangent, new Vector3()).inplaceNormalize();
      const localTangent = this.toCollisionSpaceVector(Vector3.scale(tangent, radius, new Vector3())).magnitude;
      const localBitangent = this.toCollisionSpaceVector(Vector3.scale(bitangent, radius, new Vector3())).magnitude;
      return Math.max(1e-6, (localTangent + localBitangent) * 0.5);
    }
    const localX = this.toCollisionSpaceVector(new Vector3(radius, 0, 0)).magnitude;
    const localY = this.toCollisionSpaceVector(new Vector3(0, radius, 0)).magnitude;
    const localZ = this.toCollisionSpaceVector(new Vector3(0, 0, radius)).magnitude;
    return Math.max(1e-6, (localX + localY + localZ) / 3);
  }

  private _onSceneUpdate() {
    const dt = (getDevice().frameInfo.elapsedFrame || 16.6667) * 0.001;
    if (this.hasAutoUpdateTarget()) {
      this._pendingAutoUpdateDeltaTime = dt;
      this._collisionSpaceNode?.scene?.queueUpdateNode?.(this._collisionSpaceNode);
      return;
    }
    this.update(dt);
  }
  private hasAutoUpdateTarget() {
    const target = this._collisionSpaceNode;
    return !!(target?.addPostUpdateCallback && target?.removePostUpdateCallback);
  }
  private attachAutoUpdateTarget() {
    if (this.hasAutoUpdateTarget()) {
      this._collisionSpaceNode.addPostUpdateCallback(this._meshPostUpdateCallback);
    }
  }
  private detachAutoUpdateTarget() {
    if (this.hasAutoUpdateTarget()) {
      this._collisionSpaceNode.removePostUpdateCallback(this._meshPostUpdateCallback);
    }
    this._pendingAutoUpdateDeltaTime = 0;
  }
  private updateSkinnedRestPositions(deltaTime = 0) {
    if (
      !this._sourcePositionData ||
      !this._skinningBlendIndices ||
      !this._skinningBlendWeights ||
      !this._restPositionBuffer ||
      !this._prevRestPositionBuffer
    ) {
      return;
    }
    const target = this._collisionSpaceNode;
    const skeletonId = String(target?.skeletonName ?? '');
    const skeleton =
      skeletonId && typeof target?.findSkeletonById === 'function' ? target.findSkeletonById(skeletonId) : null;
    if (skeleton?.skinPositionsToLocal && target?.invWorldMatrix) {
      const restPositions =
        this._dynamicRestPositionData && this._dynamicRestPositionData.length === this._sourcePositionData.length
          ? this._dynamicRestPositionData
          : new Float32Array(this._sourcePositionData.length);
      skeleton.skinPositionsToLocal(
        this._sourcePositionData,
        this._skinningBlendIndices,
        this._skinningBlendWeights,
        target.invWorldMatrix,
        restPositions
      );
      const smoothedRestPositions = this.smoothRestPositions(restPositions, deltaTime, restPositions);
      this._dynamicRestPositionData = restPositions;
      this._restPositionBuffer.bufferSubData(0, smoothedRestPositions);
      this._usingDynamicRestPose = true;
      this.updateTargetBoundingBox(smoothedRestPositions);
      return;
    }
    if (this._usingDynamicRestPose) {
      this._restPositionBuffer.bufferSubData(0, this._sourcePositionData);
      this._prevRestPositionBuffer.bufferSubData(0, this._sourcePositionData);
      this._usingDynamicRestPose = false;
      this._dynamicRestPositionData = null;
      this._smoothedRestPositionData = null;
      this.updateTargetBoundingBox(this._sourcePositionData);
    }
  }

  private smoothRestPositions(
    rawRestPositions: Float32Array<ArrayBuffer>,
    deltaTime: number,
    out: Float32Array<ArrayBuffer>
  ) {
    const blend = this.getTemporalBlendFactor(deltaTime, DEFAULT_REST_POSITION_SMOOTHING_TIME);
    const smoothed =
      this._smoothedRestPositionData && this._smoothedRestPositionData.length === rawRestPositions.length
        ? this._smoothedRestPositionData
        : new Float32Array(rawRestPositions.length);
    if (!this._smoothedRestPositionData || blend >= 1) {
      smoothed.set(rawRestPositions);
    } else {
      const retain = 1 - blend;
      for (let i = 0; i < rawRestPositions.length; i++) {
        smoothed[i] = smoothed[i] * retain + rawRestPositions[i] * blend;
      }
    }
    out.set(smoothed);
    this._smoothedRestPositionData = smoothed;
    return out;
  }

  private getTemporalBlendFactor(deltaTime: number, smoothingTime: number) {
    const dt = clamp(Number(deltaTime) || 0, 0, MAX_ACCUMULATED_SIMULATION_TIME);
    if (dt <= 0 || smoothingTime <= 0) {
      return 1;
    }
    return 1 - Math.exp(-dt / smoothingTime);
  }

  private getSmoothedSphereCenter(collider: SphereCollider, blend: number) {
    const current = collider.center?.clone() ?? new Vector3();
    const cached = this._smoothedSphereCenters.get(collider);
    if (!cached || blend >= 1) {
      this._smoothedSphereCenters.set(collider, current);
      return current;
    }
    cached.setXYZ(
      cached.x + (current.x - cached.x) * blend,
      cached.y + (current.y - cached.y) * blend,
      cached.z + (current.z - cached.z) * blend
    );
    return cached;
  }

  private getSmoothedCapsuleEndpoints(collider: CapsuleCollider, blend: number) {
    const currentStart = collider.start?.clone() ?? new Vector3();
    const currentEnd = collider.end?.clone() ?? new Vector3();
    const cached = this._smoothedCapsuleEndpoints.get(collider);
    if (!cached || blend >= 1) {
      const next = {
        start: currentStart,
        end: currentEnd
      };
      this._smoothedCapsuleEndpoints.set(collider, next);
      return next;
    }
    cached.start.setXYZ(
      cached.start.x + (currentStart.x - cached.start.x) * blend,
      cached.start.y + (currentStart.y - cached.start.y) * blend,
      cached.start.z + (currentStart.z - cached.start.z) * blend
    );
    cached.end.setXYZ(
      cached.end.x + (currentEnd.x - cached.end.x) * blend,
      cached.end.y + (currentEnd.y - cached.end.y) * blend,
      cached.end.z + (currentEnd.z - cached.end.z) * blend
    );
    return cached;
  }

  private getSmoothedPlaneData(collider: PlaneCollider, blend: number) {
    const currentPoint = collider.point?.clone() ?? new Vector3();
    const currentNormal = collider.normal?.clone() ?? Vector3.axisPY();
    if (currentNormal.magnitudeSq > 1e-8) {
      currentNormal.inplaceNormalize();
    } else {
      currentNormal.setXYZ(0, 1, 0);
    }
    const cached = this._smoothedPlaneData.get(collider);
    if (!cached || blend >= 1) {
      const next = {
        point: currentPoint,
        normal: currentNormal
      };
      this._smoothedPlaneData.set(collider, next);
      return next;
    }
    cached.point.setXYZ(
      cached.point.x + (currentPoint.x - cached.point.x) * blend,
      cached.point.y + (currentPoint.y - cached.point.y) * blend,
      cached.point.z + (currentPoint.z - cached.point.z) * blend
    );
    cached.normal.setXYZ(
      cached.normal.x + (currentNormal.x - cached.normal.x) * blend,
      cached.normal.y + (currentNormal.y - cached.normal.y) * blend,
      cached.normal.z + (currentNormal.z - cached.normal.z) * blend
    );
    if (cached.normal.magnitudeSq > 1e-8) {
      cached.normal.inplaceNormalize();
    } else {
      cached.normal.setXYZ(0, 1, 0);
    }
    return cached;
  }

  private updateTargetBoundingBox(positions: Float32Array<ArrayBuffer>) {
    if (!positions || positions.length < 3) {
      return;
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
    if (!Number.isFinite(minX)) {
      return;
    }
    const padding = Math.max(maxX - minX, maxY - minY, maxZ - minZ) * 0.15;
    const bbox = new BoundingBox(
      new Vector3(minX - padding, minY - padding, minZ - padding),
      new Vector3(maxX + padding, maxY + padding, maxZ + padding)
    );
    const target = this._collisionSpaceNode;
    if (typeof target?.setAnimatedBoundingBox === 'function') {
      target.setAnimatedBoundingBox(bbox);
    } else {
      this._primitive?.setBoundingVolume(bbox);
    }
  }
  private commitRestPositions() {
    if (!this._prevRestPositionBuffer || !this._usingDynamicRestPose) {
      return;
    }
    if (this._dynamicRestPositionData) {
      this._prevRestPositionBuffer.bufferSubData(0, this._dynamicRestPositionData);
    }
  }
  private disableTargetSkinning() {
    const target = this._collisionSpaceNode;
    if (!target || typeof target.suspendSkinning !== 'boolean' || this._restoreSkinAnimation !== null) {
      return;
    }
    this._skinAnimationTarget = target;
    this._restoreSkinAnimation = target.suspendSkinning;
    target.suspendSkinning = true;
    target.setBoneMatrices?.(null);
    target.setAnimatedBoundingBox?.(null);
  }
  private restoreTargetSkinning() {
    if (!this._skinAnimationTarget || this._restoreSkinAnimation === null) {
      return;
    }
    this.detachAutoUpdateTarget();
    this._skinAnimationTarget.setAnimatedBoundingBox?.(null);
    this._skinAnimationTarget.suspendSkinning = this._restoreSkinAnimation;
    this._skinAnimationTarget = null;
    this._restoreSkinAnimation = null;
  }
}
