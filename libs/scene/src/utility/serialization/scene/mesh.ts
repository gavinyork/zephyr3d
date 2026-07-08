import { base64ToUint8Array, uint8ArrayToBase64, Vector3, mimeTypeOf } from '@zephyr3d/base';
import { getEngine } from '../../../app/api';
import {
  applyMeshMorphData,
  applyMeshMorphMetadata,
  type AssetHierarchyNode,
  type AssetSubMeshData
} from '../../../asset/model';
import type { MeshMaterial } from '../../../material/meshmaterial';
import { GraphNode, Mesh, type MorphSourceDescriptor, type MorphTargetSourceData, type SceneNode } from '../../../scene';
import type { ResourceManager } from '../manager';
import { defineProps, type SerializableClass } from '../types';
import { BoundingBox } from '../../bounding_volume';
import { meshInstanceClsMap } from './common';
import { JSONData } from '../json';

function serializeBoundingBox(box: BoundingBox): number[] {
  return [...box.minPoint, ...box.maxPoint];
}

function deserializeBoundingBox(data: unknown): BoundingBox | null {
  if (!Array.isArray(data) || data.length < 6 || !data.every((v) => typeof v === 'number')) {
    return null;
  }
  return new BoundingBox(new Vector3(data.slice(0, 3)), new Vector3(data.slice(3, 6)));
}

function encodeFloat32Array(data: Float32Array): string {
  return uint8ArrayToBase64(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
}

function decodeFloat32Array(data: string): Float32Array {
  const bytes = base64ToUint8Array(data);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function encodeUint32Array(data: Uint32Array): string {
  return uint8ArrayToBase64(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
}

function decodeUint32Array(data: string): Uint32Array {
  const bytes = base64ToUint8Array(data);
  return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function normalizeNodePath(path: string) {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).join('/');
}

function getNodePathCandidates(path: string) {
  const normalized = normalizeNodePath(path);
  const candidates = [normalized];
  if (normalized.endsWith('Shape')) {
    candidates.push(normalized.slice(0, -'Shape'.length));
  }
  const parts = normalized.split('/');
  const last = parts.length > 0 ? parts[parts.length - 1] : '';
  if (last.endsWith('Shape') && parts.length > 1) {
    parts[parts.length - 1] = last.slice(0, -'Shape'.length);
    candidates.push(parts.join('/'));
    parts.pop();
    candidates.push(parts.join('/'));
  }
  return candidates.filter((value, index, array) => !!value && array.indexOf(value) === index);
}

function getAssetNodePath(node: Pick<AssetHierarchyNode, 'name' | 'parent'>) {
  const segments: string[] = [];
  let current: Pick<AssetHierarchyNode, 'name' | 'parent'> | null | undefined = node;
  while (current) {
    if (current.name) {
      segments.push(current.name);
    }
    current = current.parent;
  }
  return normalizeNodePath(segments.reverse().join('/'));
}

function resolveMorphSourceSubMesh(subMeshes: AssetSubMeshData[], subMeshName: string) {
  return subMeshes.find((subMesh) => (subMesh?.name ?? '') === subMeshName) ?? null;
}

function resolveMorphSource(nodes: AssetHierarchyNode[], source: MorphSourceDescriptor) {
  if (!source.nodePath || !source.subMeshName) {
    return null;
  }
  for (const candidatePath of getNodePathCandidates(source.nodePath)) {
    for (const node of nodes) {
      const mesh = node?.mesh;
      if (!mesh || getAssetNodePath(node) !== candidatePath) {
        continue;
      }
      const subMesh = resolveMorphSourceSubMesh(mesh.subMeshes, source.subMeshName);
      if (subMesh) {
        return {
          node,
          mesh,
          subMesh
        };
      }
    }
  }
  return null;
}

function serializeMorphSourceData(data: MorphTargetSourceData) {
  return JSON.stringify({
    numTargets: data.numTargets,
    numVertices: data.numVertices,
    targets: Object.fromEntries(
      Object.entries(data.targets).map(([attrib, source]) => [
        attrib,
        {
          numComponents: source!.numComponents,
          data: source!.data.map((item) => encodeFloat32Array(item)),
          indices: source!.indices?.map((item) => encodeUint32Array(item)) ?? null
        }
      ])
    )
  });
}

function deserializeMorphSourceData(data: string): MorphTargetSourceData | null {
  try {
    const parsed = JSON.parse(data) as {
      numTargets: number;
      numVertices: number;
      targets: Record<string, { numComponents: number; data: string[]; indices?: string[] | null }>;
    };
    const targets: MorphTargetSourceData['targets'] = {};
    for (const [attrib, source] of Object.entries(parsed.targets ?? {})) {
      targets[Number(attrib)] = {
        numComponents: source.numComponents,
        data: (source.data ?? []).map((item) => decodeFloat32Array(item)),
        indices: source.indices ? source.indices.map((item) => decodeUint32Array(item)) : undefined
      };
    }
    return {
      numTargets: parsed.numTargets ?? 0,
      numVertices: parsed.numVertices ?? 0,
      targets
    };
  } catch {
    return null;
  }
}

/** @internal */
export function getMeshClass(manager: ResourceManager): SerializableClass {
  return {
    ctor: Mesh,
    name: 'Mesh',
    parent: GraphNode,
    noTitle: true,
    createFunc(ctx: SceneNode) {
      const node = new Mesh(ctx.scene!);
      node.parent = ctx;
      return { obj: node };
    },
    getProps() {
      return defineProps([
        {
          name: 'CastShadow',
          description: 'If true, the mesh can cast shadows',
          type: 'bool',
          default: false,
          get(this: Mesh, value) {
            value.bool[0] = this.castShadow;
          },
          set(this: Mesh, value) {
            this.castShadow = value.bool[0];
          }
        },
        {
          name: 'SkinnedBoundingInfo',
          description: 'Serialized skinned bounding data for the mesh',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: Mesh, value) {
            if (this.skinnedBoundingInfo) {
              const arr = new Float32Array(24 + 24 + 6 * 3);
              arr.set(this.skinnedBoundingInfo.boundingVertexBlendIndices, 0);
              arr.set(this.skinnedBoundingInfo.boundingVertexJointWeights, 24);
              for (let i = 0; i < 6; i++) {
                arr.set(this.skinnedBoundingInfo.boundingVertices[i], 24 + 24 + i * 3);
              }
              value.str[0] = uint8ArrayToBase64(new Uint8Array(arr.buffer));
            } else {
              value.str[0] = '';
            }
          },
          set(this: Mesh, value) {
            if (value.str[0]) {
              const buf = new Float32Array(base64ToUint8Array(value.str[0]).buffer);
              const boundingVertexBlendIndices = buf.subarray(0, 24);
              const boundingVertexJointWeights = buf.subarray(24, 48);
              const boundingVertices: Vector3[] = [];
              for (let i = 0; i < 6; i++) {
                boundingVertices.push(new Vector3(buf.subarray(48 + i * 3, 48 + (i + 1) * 3)));
              }
              this.setSkinnedBoundingInfo({
                boundingVertexBlendIndices,
                boundingVertexJointWeights,
                boundingVertices,
                boundingBox: new BoundingBox()
              });
            } else {
              this.setSkinnedBoundingInfo(null);
            }
          }
        },
        {
          name: 'SkinBinding',
          description: 'Persistent ID of the skin binding bound to this mesh',
          type: 'string',
          isHidden() {
            return false;
          },
          get(this: Mesh, value) {
            value.str[0] = this.skinBindingName;
          },
          set(this: Mesh, value) {
            this.skinBindingName = value.str[0];
          }
        },
        {
          name: 'Skeleton',
          description: 'Legacy persistent ID of the skin binding bound to this mesh',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: Mesh, value) {
            value.str[0] = '';
          },
          set(this: Mesh, value) {
            if (value.str[0]) {
              this.skeletonName = value.str[0];
            }
          }
        },
        {
          name: 'MorphData',
          description: 'Serialized morph-target vertex data',
          type: 'string',
          isHidden() {
            return true;
          },
          async get(this: Mesh, value) {
            const morphData = this.getMorphData();
            if (morphData && !this.getMorphSource()) {
              const buffer = new ArrayBuffer(4 + 4 + 4 * 4 * morphData.width * morphData.height);
              const dataView = new DataView(buffer);
              dataView.setUint32(0, morphData.width, true);
              dataView.setUint32(4, morphData.height, true);
              new Float32Array(buffer, 8, 4 * morphData.width * morphData.height).set(morphData.data);
              value.str[0] = uint8ArrayToBase64(new Uint8Array(buffer));
            } else {
              value.str[0] = '';
            }
          },
          set(this: Mesh, value) {
            if (value.str[0]) {
              const data = base64ToUint8Array(value.str[0]);
              const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
              const width = dataView.getUint32(0, true);
              const height = dataView.getUint32(4, true);
              const pixels = new Float32Array(data.buffer, data.byteOffset + 8, 4 * width * height);
              this.setMorphData({ width, height, data: pixels });
            } else {
              this.setMorphData(null);
            }
          }
        },
        {
          name: 'MorphSource',
          description: 'External morph-target source reference',
          type: 'string',
          phase: 1,
          isHidden() {
            return true;
          },
          get(this: Mesh, value) {
            value.str[0] = this.getMorphSource() ? JSON.stringify(this.getMorphSource()) : '';
          },
          async set(this: Mesh, value) {
            if (!value.str[0]) {
              this.setMorphSource(null);
              return;
            }
            const source = JSON.parse(value.str[0]) as MorphSourceDescriptor;
            this.setMorphSource(source);
            const sourceModel = await manager.assetManager.fetchModelData(source.sourcePath);
            const resolvedSource = resolveMorphSource(sourceModel.nodes, source);
            const sourceNode = resolvedSource?.node;
            const sourceMesh = resolvedSource?.mesh;
            const sourceSubMesh = resolvedSource?.subMesh;
            if (!sourceNode || !sourceMesh || !sourceSubMesh) {
              throw new Error(`Morph source not found: ${source.sourcePath}#${source.nodePath}/${source.subMeshName}`);
            }
            if (!this.getMorphInfo() || !this.getMorphBoundingInfo()) {
              applyMeshMorphMetadata(
                sourceSubMesh,
                this,
                sourceNode.weights ?? sourceMesh.morphWeights,
                sourceMesh.morphNames
              );
            }
            const expectedVertexCount = sourceSubMesh.primitive
              ? ((sourceSubMesh.primitive.vertices['position'].data.length / 3) >> 0)
              : 0;
            if (
              this.primitive &&
              expectedVertexCount > 0 &&
              this.primitive.getNumVertices() > 0 &&
              this.primitive.getNumVertices() !== expectedVertexCount
            ) {
              throw new Error(
                `Morph source vertex count mismatch: expected ${expectedVertexCount}, got ${this.primitive.getNumVertices()}`
              );
            }
            applyMeshMorphData(sourceSubMesh, this);
          }
        },
        {
          name: 'MorphSourceData',
          description: 'Serialized CPU-side morph-target source data',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: Mesh, value) {
            const sourceData = this.getMorphSourceData();
            value.str[0] = sourceData ? serializeMorphSourceData(sourceData) : '';
          },
          set(this: Mesh, value) {
            if (!value.str[0]) {
              this.setMorphSourceData(null);
              return;
            }
            this.setMorphSourceData(deserializeMorphSourceData(value.str[0]));
          }
        },
        {
          name: 'MorphTargets',
          description: 'Named morph-target weights for this mesh',
          type: 'object',
          options: { objectTypes: [JSONData] },
          isPersistent() {
            return false;
          },
          isHidden(this: Mesh) {
            return !this.getMorphInfo();
          },
          get(this: Mesh, value) {
            const morphInfo = this.getMorphInfo()!;
            const numTargets = morphInfo.data[3];
            const data: Record<string, number> = {};
            for (let i = 0; i < numTargets; i++) {
              const name = Object.keys(morphInfo.names).find((key) => morphInfo.names![key] === i);
              if (name) {
                Object.defineProperty(data, name, {
                  enumerable: true,
                  configurable: true,
                  get: () => this.getMorphWeight(name),
                  set: (v) => this.setMorphWeight(name, v)
                });
              }
            }
            value.object[0] = new JSONData(null, data);
          }
        },
        {
          name: 'MorphInfo',
          description: 'Serialized morph-target layout and metadata',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: Mesh, value) {
            const morphInfo = this.getMorphInfo();
            if (morphInfo) {
              const data = new Uint8Array(
                morphInfo.data.buffer,
                morphInfo.data.byteOffset,
                morphInfo.data.byteLength
              );
              value.str[0] = JSON.stringify({ data: uint8ArrayToBase64(data), names: morphInfo.names });
            } else {
              value.str[0] = '';
            }
          },
          set(this: Mesh, value) {
            if (value.str[0]) {
              try {
                const info = JSON.parse(value.str[0]);
                const bytes = base64ToUint8Array(info.data);
                const data = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
                const names = info.names;
                this.setMorphInfo({ data, names });
              } catch {
                const bytes = base64ToUint8Array(value.str[0]);
                const data = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
                const names: Record<string, number> = {};
                for (let i = 0; i < data[3]; i++) {
                  names[`Target${i}`] = i;
                }
                this.setMorphInfo({ data, names });
              }
            } else {
              this.setMorphInfo(null);
            }
          }
        },
        {
          name: 'MorphBoundingBox',
          description: 'Serialized bounding box for morphed geometry',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: Mesh, value) {
            value.str[0] = '';
            if (this.getMorphData()) {
              const box = this.getAnimatedBoundingBox();
              if (box) {
                const data = new Float32Array([...box.minPoint, ...box.maxPoint]);
                value.str[0] = uint8ArrayToBase64(new Uint8Array(data.buffer));
              }
            }
          },
          set(this: Mesh, value) {
            if (value.str[0]) {
              const bytes = base64ToUint8Array(value.str[0]);
              const data = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
              const bbox = new BoundingBox();
              bbox.minPoint.setXYZ(data[0], data[1], data[2]);
              bbox.maxPoint.setXYZ(data[3], data[4], data[5]);
              this.setAnimatedBoundingBox(bbox);
            } else {
              this.setAnimatedBoundingBox(null);
            }
          }
        },
        {
          name: 'MorphBoundingInfo',
          description: 'Serialized morph-target bounding data',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: Mesh, value) {
            const info = this.getMorphBoundingInfo();
            value.str[0] = info
              ? JSON.stringify({
                  originBox: serializeBoundingBox(info.originBox),
                  targetBoxes: info.targetBoxes.map((box) => serializeBoundingBox(box))
                })
              : '';
          },
          set(this: Mesh, value) {
            if (!value.str[0]) {
              this.setMorphBoundingInfo(null);
              return;
            }
            try {
              const data = JSON.parse(value.str[0]);
              const originBox = deserializeBoundingBox(data.originBox);
              const targetBoxes = Array.isArray(data.targetBoxes)
                ? data.targetBoxes
                    .map((item: unknown) => deserializeBoundingBox(item))
                    .filter((box: BoundingBox | null): box is BoundingBox => !!box)
                : [];
              this.setMorphBoundingInfo(
                originBox && targetBoxes.length > 0 ? { originBox, targetBoxes } : null
              );
            } catch {
              this.setMorphBoundingInfo(null);
            }
          }
        },
        {
          name: 'Primitive',
          description: 'Primitive object of this mesh',
          type: 'object',
          options: {
            mimeTypes: [mimeTypeOf('.zmsh')]
          },
          get(this: Mesh, value) {
            value.str[0] = this.primitive
              ? (getEngine().resourceManager.getAssetId(this.primitive) ?? '')
              : '';
          },
          async set(this: Mesh, value) {
            if (value?.str[0]) {
              const primitive = await getEngine().resourceManager.fetchPrimitive(value.str[0]);
              if (primitive) {
                this.primitive = primitive;
              } else {
                console.error(`Primitive not found: ${value.str[0]}`);
              }
            }
          }
        },
        {
          name: 'Material',
          description: 'Material object of this mesh',
          type: 'object',
          options: {
            mimeTypes: [mimeTypeOf('.zmtl')]
          },
          get(this: Mesh, value) {
            const m = this.material?.coreMaterial;
            value.str[0] = getEngine().resourceManager.getAssetId(m) ?? '';
          },
          async set(this: Mesh, value) {
            if (value?.str[0]) {
              const material = await getEngine().resourceManager.fetchMaterial<MeshMaterial>(value.str[0]);
              if (material) {
                this.material = material;
              } else {
                console.error(`Material not found: ${value.str[0]}`);
              }
            }
          }
        },
        {
          name: 'Geometry Instance',
          description: 'If true, geometry instancing is enabled for this mesh',
          type: 'bool',
          get(this: Mesh, value) {
            value.bool[0] = !!this.material?.$isInstance;
          },
          set(this: Mesh, value) {
            this.material = value.bool[0]
              ? (this.material?.createInstance() ?? null)
              : (this.material?.coreMaterial ?? null);
          }
        },
        {
          name: 'MaterialInstanceUniforms',
          description: 'Per-instance material uniform properties',
          type: 'object',
          phase: 1,
          options: {
            objectTypes: []
          },
          isHidden(this: Mesh) {
            return !!this.material && !this.material?.$isInstance;
          },
          isNullable() {
            return true;
          },
          get(this: Mesh, value) {
            const C = this.material?.$isInstance
              ? meshInstanceClsMap.get(this.material.coreMaterial.constructor as typeof MeshMaterial)
              : null;
            value.object[0] = C ? new C.C(this.material!) : null;
          },
          set(this: Mesh, value) {
            if (value.object[0]) {
              this.material = (value.object[0] as any)?.material;
            }
          }
        }
      ]);
    }
  };
}
