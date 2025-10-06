import { base64ToUint8Array, uint8ArrayToBase64, Vector3 } from '@zephyr3d/base';
import { getEngine } from '../../../app/api';
import type { MeshMaterial } from '../../../material';
import { GraphNode, Mesh, type SceneNode } from '../../../scene';
import type { SerializableClass } from '../types';
import { BoundingBox } from '../../bounding_volume';

/** @internal */
export function getMeshClass(): SerializableClass {
  return {
    ctor: Mesh,
    name: 'Mesh',
    parent: GraphNode,
    createFunc(ctx: SceneNode) {
      const node = new Mesh(ctx.scene);
      node.parent = ctx;
      return { obj: node };
    },
    getProps() {
      return [
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
          name: 'Skeleton',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: Mesh, value) {
            value.str[0] = this.skeletonName;
          },
          set(this: Mesh, value) {
            this.skeletonName = value.str[0];
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
          name: 'Primitive',
          type: 'object',
          options: {
            mimeTypes: ['application/vnd.zephyr3d.mesh+json']
          },
          get(this: Mesh, value) {
            value.str[0] = this.primitive ? getEngine().serializationManager.getAssetId(this.primitive) : '';
          },
          async set(this: Mesh, value) {
            if (value?.str[0]) {
              const primitive = await getEngine().serializationManager.fetchPrimitive(value.str[0]);
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
            value.str[0] = getEngine().serializationManager.getAssetId(m) ?? '';
          },
          async set(this: Mesh, value) {
            if (value?.str[0]) {
              const material = await getEngine().serializationManager.fetchMaterial<MeshMaterial>(
                value.str[0]
              );
              if (material) {
                this.material = material;
              } else {
                console.error(`Material not found: ${value.str[0]}`);
              }
            }
          }
        }
      ];
    }
  };
}
