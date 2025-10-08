import { base64ToUint8Array, uint8ArrayToBase64, Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import { getEngine } from '../../../app/api';
import type { MeshMaterial } from '../../../material/meshmaterial';
import { GraphNode, Mesh, type SceneNode } from '../../../scene';
import type { SerializableClass } from '../types';
import { BoundingBox } from '../../bounding_volume';

const meshInstanceClsMap: Map<
  {
    new (...args: any[]): MeshMaterial;
  },
  { C: { new (m: MeshMaterial) }; S: SerializableClass }
> = new Map();

/** @internal */
export function getMeshMaterialInstanceUniformsClass(cls: {
  new (...args: any[]): MeshMaterial;
}): SerializableClass {
  let info = meshInstanceClsMap.get(cls);
  if (!info) {
    class C {
      materialId: string;
      constructor(public material: MeshMaterial) {
        this.materialId = getEngine().serializationManager.getAssetId(material.coreMaterial) ?? '';
      }
    }
    const S: SerializableClass = {
      ctor: C,
      name: `${cls.name}InstanceUniforms`,
      async createFunc(_ctx, init) {
        const material = await getEngine().serializationManager.fetchMaterial<MeshMaterial>(init);
        return { obj: new C(material.createInstance()) };
      },
      getInitParams(obj: C) {
        return obj.materialId;
      },
      getProps() {
        return (cls as typeof MeshMaterial).INSTANCE_UNIFORMS.filter((u) => !!u.name).map((u) => ({
          name: u.name,
          type: u.type,
          get(this: C, value) {
            const val = this.material[u.prop];
            if (u.type === 'float') {
              value.num[0] = val;
            } else if (u.type === 'vec2') {
              value.num[0] = val.x;
              value.num[1] = val.y;
            } else if (u.type === 'vec3' || u.type === 'rgb') {
              value.num[0] = val.x;
              value.num[1] = val.y;
              value.num[2] = val.z;
            } else if (u.type === 'vec4' || u.type === 'rgba') {
              value.num[0] = val.x;
              value.num[1] = val.y;
              value.num[2] = val.z;
              value.num[3] = val.w;
            }
          },
          set(this: C, value) {
            if (u.type === 'float') {
              this.material[u.prop] = value.num[0];
            } else if (u.type === 'vec2') {
              this.material[u.prop] = new Vector2(value.num[0], value.num[1]);
            } else if (u.type === 'vec3' || u.type === 'rgb') {
              this.material[u.prop] = new Vector3(value.num[0], value.num[1], value.num[2]);
            } else if (u.type === 'vec4' || u.type === 'rgba') {
              this.material[u.prop] = new Vector4(value.num[0], value.num[1], value.num[2], value.num[3]);
            }
          }
        }));
      }
    };
    info = { C, S };
    meshInstanceClsMap.set(cls, info);
  }
  return info.S;
}
/** @internal */
export function getMeshClass(): SerializableClass {
  return {
    ctor: Mesh,
    name: 'Mesh',
    parent: GraphNode,
    noTitle: true,
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
        },
        {
          name: 'MaterialInstanceUniforms',
          type: 'object',
          phase: 1,
          options: {
            objectTypes: []
          },
          isHidden(this: Mesh) {
            return this.material && !this.material?.$isInstance;
          },
          isNullable() {
            return true;
          },
          get(this: Mesh, value) {
            const C = this.material?.$isInstance
              ? meshInstanceClsMap.get(this.material.coreMaterial.constructor as typeof MeshMaterial)
              : null;
            value.object[0] = C ? new C.C(this.material) : null;
          },
          set(this: Mesh, value) {
            if (value.object[0]) {
              this.material = (value.object[0] as any)?.material;
            }
          }
        }
      ];
    }
  };
}
