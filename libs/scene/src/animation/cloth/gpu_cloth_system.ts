import type {
  AbstractDevice,
  BindGroup,
  GPUDataBuffer,
  GPUProgram,
  StructuredBuffer
} from '@zephyr3d/device';
import { PBPrimitiveType } from '@zephyr3d/device';
import { releaseObject, retainObject, Vector3, type Nullable } from '@zephyr3d/base';
import { getDevice } from '../../app/api';
import type { Primitive } from '../../render';
import type { Scene } from '../../scene';
import type { CapsuleCollider, SphereCollider, SpringCollider } from '../spring/spring_collider';
import { updateColliderFromNode } from '../spring/spring_collider';

export type GPUClothSystemOptions = {
  enabled?: boolean;
  device?: Nullable<AbstractDevice>;
  primitive?: Nullable<Primitive>;
  positionData?: Float32Array<ArrayBuffer>;
  indexData?: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>;
  pinnedVertexWeights?: ArrayLike<number>;
  pinnedVertexIndices?: number[];
  gravity?: Vector3;
  damping?: number;
  stiffness?: number;
  solverIterations?: number;
  maxNeighbors?: number;
  workgroupSize?: number;
  colliders?: SpringCollider[];
  maxTrianglesPerVertex?: number;
  rebuildNormals?: boolean;
  scene?: Nullable<Scene>;
  autoUpdate?: boolean;
};

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

const DEFAULT_DAMPING = 0.995;
const DEFAULT_STIFFNESS = 0.3;
const DEFAULT_SOLVER_ITERATIONS = 5;
const DEFAULT_MAX_NEIGHBORS = 8;
const DEFAULT_WORKGROUP_SIZE = 64;
const DEFAULT_MAX_TRIANGLES_PER_VERTEX = 16;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function distance3(positions: Float32Array<ArrayBuffer>, a: number, b: number) {
  const a0 = a * 3;
  const b0 = b * 3;
  const dx = positions[a0] - positions[b0];
  const dy = positions[a0 + 1] - positions[b0 + 1];
  const dz = positions[a0 + 2] - positions[b0 + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
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

function createIntegrateProgram(device: AbstractDevice, workgroupSize: number) {
  const program = device.buildComputeProgram({
    workgroupSize: [workgroupSize, 1, 1],
    compute(pb) {
      this.positions = pb.float[0]().storageBuffer(0);
      this.prevPositions = pb.float[0]().storageBuffer(0);
      this.restPositions = pb.float[0]().storageBufferReadonly(0);
      this.invMass = pb.float[0]().storageBufferReadonly(0);
      this.sphereData = pb.float[0]().storageBufferReadonly(0);
      this.capsuleData = pb.float[0]().storageBufferReadonly(0);
      this.vertexCount = pb.uint().uniform(0);
      this.deltaTime = pb.float().uniform(0);
      this.damping = pb.float().uniform(0);
      this.gravity = pb.vec3().uniform(0);
      this.sphereCount = pb.uint().uniform(0);
      this.capsuleCount = pb.uint().uniform(0);
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
          this.$l.freeWeight = this.invMass.at(this.index);
          this.$l.pinWeight = pb.sub(1, this.freeWeight);
          this.$l.current = pb.vec3(this.x, this.y, this.z);
          this.$l.previous = pb.vec3(this.px, this.py, this.pz);
          this.$l.rest = pb.vec3(this.restX, this.restY, this.restZ);
          this.$l.dt2 = pb.mul(this.deltaTime, this.deltaTime);
          this.$l.velocity = pb.mul(pb.sub(this.current, this.previous), pb.mul(this.damping, this.freeWeight));
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
                this.$if(pb.greaterThan(this.lenCol, this.minDistance), function () {
                  this.next = pb.add(this.center, pb.mul(pb.div(this.deltaCol, this.lenCol), this.radius));
                }).$else(function () {
                  this.next = pb.add(this.center, pb.vec3(0, this.radius, 0));
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
                this.$if(pb.greaterThan(this.lenCap, this.minDistance), function () {
                  this.next = pb.add(this.closest, pb.mul(pb.div(this.deltaCap, this.lenCap), this.cRadius));
                }).$else(function () {
                  this.next = pb.add(this.closest, pb.vec3(0, this.cRadius, 0));
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
      this.vertexCount = pb.uint().uniform(0);
      this.maxNeighbors = pb.uint().uniform(0);
      this.stiffness = pb.float().uniform(0);
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
            this.corrected = pb.add(pb.mul(this.corrected, this.freeWeight), pb.mul(this.rest, this.pinWeight));
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
  const info = primitive.getVertexBufferInfo('position');
  if (!info) {
    throw new Error('GPU cloth initialization failed: primitive has no position buffer.');
  }
  if (!info.type.isPrimitiveType() || info.type.scalarType !== PBPrimitiveType.F32 || info.type.cols < 3) {
    throw new Error('GPU cloth initialization failed: only f32 position attributes are supported.');
  }
  const bytes = await info.buffer.getBufferSubData();
  const raw = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
  const stride = info.stride >> 2;
  const drawOffset = info.drawOffset >> 2;
  const vertexCount = primitive.getNumVertices();
  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    const src = drawOffset + i * stride;
    const dst = i * 3;
    positions[dst] = raw[src];
    positions[dst + 1] = raw[src + 1];
    positions[dst + 2] = raw[src + 2];
  }
  return positions;
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
  private _prevPositionBuffer: Nullable<GPUDataBuffer>;
  private _restPositionBuffer: Nullable<GPUDataBuffer>;
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
  private _stiffness: number;
  private _solverIterations: number;
  private _colliders: SpringCollider[];
  private _sphereColliderBuffer: Nullable<GPUDataBuffer>;
  private _capsuleColliderBuffer: Nullable<GPUDataBuffer>;
  private _sphereColliderData: Float32Array<ArrayBuffer>;
  private _capsuleColliderData: Float32Array<ArrayBuffer>;
  private _triangleIndexBuffer: Nullable<GPUDataBuffer>;
  private _triangleNormalBuffer: Nullable<GPUDataBuffer>;
  private _vertexTriangleAdjacencyBuffer: Nullable<GPUDataBuffer>;
  private _normalBuffer: Nullable<StructuredBuffer>;
  private _rebuildNormals: boolean;
  private _boundScene: Nullable<Scene>;
  private _autoUpdate: boolean;

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
    this._prevPositionBuffer = null;
    this._restPositionBuffer = null;
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
    this._stiffness = clamp(options?.stiffness ?? DEFAULT_STIFFNESS, 0, 1);
    this._solverIterations = Math.max(1, (options?.solverIterations ?? DEFAULT_SOLVER_ITERATIONS) | 0);
    this._colliders = [...(options?.colliders ?? [])];
    this._sphereColliderBuffer = null;
    this._capsuleColliderBuffer = null;
    this._sphereColliderData = new Float32Array(4);
    this._capsuleColliderData = new Float32Array(8);
    this._triangleIndexBuffer = null;
    this._triangleNormalBuffer = null;
    this._vertexTriangleAdjacencyBuffer = null;
    this._normalBuffer = null;
    this._rebuildNormals = options?.rebuildNormals ?? true;
    this._boundScene = null;
    this._autoUpdate = options?.autoUpdate ?? true;

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

    const workgroupSize = clamp(options?.workgroupSize ?? DEFAULT_WORKGROUP_SIZE, 1, 256) | 0;
    const indexDataU32 = toUInt32Indices(options.indexData);
    const pinWeightArray = buildPinWeightArray(
      options.positionData,
      options.pinnedVertexWeights,
      options.pinnedVertexIndices
    );
    const neighbors = buildNeighborData(options.positionData, options.indexData, this._maxNeighbors);
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
      this._positionBuffer = this._device.createVertexBuffer('position_f32x3', options.positionData, {
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
      this._prevPositionBuffer.bufferSubData(0, options.positionData);

      this._restPositionBuffer = this._device.createBuffer(options.positionData.byteLength, {
        usage: 'uniform',
        storage: true,
        dynamic: false,
        managed: false
      });
      this._restPositionBuffer.bufferSubData(0, options.positionData);

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
      this._integrateBindGroup.setBuffer('invMass', this._invMassBuffer);
      this._integrateBindGroup.setBuffer('sphereData', this._sphereColliderBuffer);
      this._integrateBindGroup.setBuffer('capsuleData', this._capsuleColliderBuffer);
      this._integrateBindGroup.setValue('vertexCount', vertexCount);
      this._integrateBindGroup.setValue('damping', this._damping);
      this._integrateBindGroup.setValue('gravity', this._gravity);
      this._integrateBindGroup.setValue('sphereCount', 0);
      this._integrateBindGroup.setValue('capsuleCount', 0);
      this._integrateBindGroup.setValue('minDistance', 1e-5);

      this._constraintBindGroup = this._device.createBindGroup(this._constraintProgram.bindGroupLayouts[0]);
      this._constraintBindGroup.setBuffer('positions', this._positionBuffer!);
      this._constraintBindGroup.setBuffer('restPositions', this._restPositionBuffer);
      this._constraintBindGroup.setBuffer('invMass', this._invMassBuffer);
      this._constraintBindGroup.setBuffer('neighborIndices', this._neighborIndexBuffer);
      this._constraintBindGroup.setBuffer('restLengths', this._restLengthBuffer);
      this._constraintBindGroup.setValue('vertexCount', vertexCount);
      this._constraintBindGroup.setValue('maxNeighbors', this._maxNeighbors);
      this._constraintBindGroup.setValue('stiffness', this._stiffness);
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
    const indexData = await readIndexDataFromPrimitive(primitive, (positionData.length / 3) >> 0);
    return new GPUClothSystem({
      ...options,
      primitive,
      positionData,
      indexData
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
      scene: mesh.scene ?? null
    });
  }

  get enabled() {
    return this._enabled;
  }

  set enabled(value: boolean) {
    this._enabled = this.supported && !!value;
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

  get stiffness() {
    return this._stiffness;
  }

  set stiffness(value: number) {
    this._stiffness = clamp(value, 0, 1);
  }

  get solverIterations() {
    return this._solverIterations;
  }

  set solverIterations(value: number) {
    this._solverIterations = Math.max(1, value | 0);
  }

  get vertexCount() {
    return this._vertexCount;
  }

  bindToScene(scene: Nullable<Scene>) {
    if (this._boundScene === scene) {
      return;
    }
    if (this._boundScene) {
      this._boundScene.off('update', this._onSceneUpdate, this);
    }
    this._boundScene = scene ?? null;
    if (this._boundScene) {
      this._boundScene.on('update', this._onSceneUpdate, this);
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
    this.updateColliderBuffers();
    const dt = clamp(Number(deltaTime) || 0, 1 / 240, 1 / 20);
    this._device.pushDeviceStates();
    try {
      this._integrateBindGroup.setValue('deltaTime', dt);
      this._integrateBindGroup.setValue('damping', this._damping);
      this._integrateBindGroup.setValue('gravity', this._gravity);
      this._device.setProgram(this._integrateProgram);
      this._device.setBindGroup(0, this._integrateBindGroup);
      this._device.compute(this._workgroupCount, 1, 1);

      this._constraintBindGroup.setValue('stiffness', this._stiffness);
      this._device.setProgram(this._constraintProgram);
      this._device.setBindGroup(0, this._constraintBindGroup);
      for (let i = 0; i < this._solverIterations; i++) {
        this._device.compute(this._workgroupCount, 1, 1);
      }

      if (
        this._rebuildNormals &&
        this._faceNormalProgram &&
        this._vertexNormalProgram &&
        this._faceNormalBindGroup &&
        this._vertexNormalBindGroup
      ) {
        this._device.setProgram(this._faceNormalProgram);
        this._device.setBindGroup(0, this._faceNormalBindGroup);
        this._device.compute(this._triangleWorkgroupCount, 1, 1);

        this._device.setProgram(this._vertexNormalProgram);
        this._device.setBindGroup(0, this._vertexNormalBindGroup);
        this._device.compute(this._workgroupCount, 1, 1);
      }
    } finally {
      this._device.popDeviceStates();
    }
  }

  dispose() {
    this.unbindFromScene();
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
    releaseObject(this._originalPositionBuffer);
    this._originalPositionBuffer = null;
    releaseObject(this._originalNormalBuffer);
    this._originalNormalBuffer = null;
    this._enabled = false;
  }

  private updateColliderBuffers() {
    if (!this._device || !this._integrateBindGroup) {
      return;
    }

    const spheres: SphereCollider[] = [];
    const capsules: CapsuleCollider[] = [];
    for (const collider of this._colliders) {
      if (!collider?.enabled) {
        continue;
      }
      if (collider.node) {
        updateColliderFromNode(collider);
      }
      if (collider.type === 'sphere') {
        spheres.push(collider as SphereCollider);
      } else if (collider.type === 'capsule') {
        capsules.push(collider as CapsuleCollider);
      }
    }

    const sphereData = new Float32Array(Math.max(1, spheres.length) * 4);
    for (let i = 0; i < spheres.length; i++) {
      const base = i * 4;
      sphereData[base] = spheres[i].center.x;
      sphereData[base + 1] = spheres[i].center.y;
      sphereData[base + 2] = spheres[i].center.z;
      sphereData[base + 3] = spheres[i].radius;
    }

    const capsuleData = new Float32Array(Math.max(1, capsules.length) * 8);
    for (let i = 0; i < capsules.length; i++) {
      const base = i * 8;
      capsuleData[base] = capsules[i].start.x;
      capsuleData[base + 1] = capsules[i].start.y;
      capsuleData[base + 2] = capsules[i].start.z;
      capsuleData[base + 3] = capsules[i].radius;
      capsuleData[base + 4] = capsules[i].end.x;
      capsuleData[base + 5] = capsules[i].end.y;
      capsuleData[base + 6] = capsules[i].end.z;
      capsuleData[base + 7] = 0;
    }

    if (!this._sphereColliderBuffer || this._sphereColliderBuffer.byteLength < sphereData.byteLength) {
      this._sphereColliderBuffer?.dispose();
      this._sphereColliderBuffer = this._device.createBuffer(sphereData.byteLength, {
        usage: 'uniform',
        storage: true,
        dynamic: false,
        managed: false
      });
      this._integrateBindGroup.setBuffer('sphereData', this._sphereColliderBuffer);
    }
    this._sphereColliderBuffer.bufferSubData(0, sphereData);

    if (!this._capsuleColliderBuffer || this._capsuleColliderBuffer.byteLength < capsuleData.byteLength) {
      this._capsuleColliderBuffer?.dispose();
      this._capsuleColliderBuffer = this._device.createBuffer(capsuleData.byteLength, {
        usage: 'uniform',
        storage: true,
        dynamic: false,
        managed: false
      });
      this._integrateBindGroup.setBuffer('capsuleData', this._capsuleColliderBuffer);
    }
    this._capsuleColliderBuffer.bufferSubData(0, capsuleData);

    this._integrateBindGroup.setValue('sphereCount', spheres.length);
    this._integrateBindGroup.setValue('capsuleCount', capsules.length);
  }

  private _onSceneUpdate() {
    const dt = (getDevice().frameInfo.elapsedFrame || 16.6667) * 0.001;
    this.update(dt);
  }
}
