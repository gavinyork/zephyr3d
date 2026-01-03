import { base64ToUint8Array, uint8ArrayToBase64, Vector3 } from '@zephyr3d/base';
import { getEngine } from '../../../app/api';
import type { MeshMaterial } from '../../../material/meshmaterial';
import { GraphNode, Mesh, type SceneNode } from '../../../scene';
import { defineProps, type SerializableClass } from '../types';
import { BoundingBox } from '../../bounding_volume';
import { meshInstanceClsMap } from './common';

/** @internal */
export function getMeshClass(): SerializableClass {
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
          name: 'Skeleton',
          type: 'string',
          isHidden() {
            return false;
          },
          get(this: Mesh, value) {
            value.str[0] = this.skeletonName;
          },
          set(this: Mesh, value) {
            this.skeletonName = value.str[0];
          }
        },
        {
          name: 'MorphData',
          type: 'string',
          isHidden() {
            return true;
          },
          async get(this: Mesh, value) {
            const morphData = this.getMorphData();
            if (morphData) {
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
              const dataView = new DataView(data.buffer);
              const width = dataView.getUint32(0, true);
              const height = dataView.getUint32(4, true);
              const pixels = new Float32Array(data.buffer, 8, 4 * width * height);
              this.setMorphData({ width, height, data: pixels });
            } else {
              this.setMorphData(null);
            }
          }
        },
        {
          name: 'MorphInfo',
          type: 'string',
          isHidden() {
            return true;
          },
          async get(this: Mesh, value) {
            const morphInfo = this.getMorphInfo();
            if (morphInfo) {
              const data = new Uint8Array(
                morphInfo.data.buffer,
                morphInfo.data.byteOffset,
                morphInfo.data.byteLength
              );
              value.str[0] = uint8ArrayToBase64(data);
            } else {
              value.str[0] = '';
            }
          },
          set(this: Mesh, value) {
            if (value.str[0]) {
              const data = base64ToUint8Array(value.str[0]);
              this.setMorphInfo({ data });
            } else {
              this.setMorphInfo(null);
            }
          }
        },
        {
          name: 'MorphBoundingBox',
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
              const data = new Float32Array(base64ToUint8Array(value.str[0]).buffer);
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
          name: 'Primitive',
          type: 'object',
          options: {
            mimeTypes: ['application/vnd.zephyr3d.mesh+json']
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
          type: 'object',
          options: {
            mimeTypes: ['application/vnd.zephyr3d.material+json']
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
