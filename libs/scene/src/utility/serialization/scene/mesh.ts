import { base64ToUint8Array, uint8ArrayToBase64, Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import { getEngine } from '../../../app/api';
import { MeshMaterial } from '../../../material/meshmaterial';
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
        this.materialId = getEngine().resourceManager.getAssetId(material.coreMaterial) ?? '';
      }
    }
    const S: SerializableClass = {
      ctor: C,
      name: `${cls.name}InstanceUniforms`,
      async createFunc(_ctx, init) {
        const material = await getEngine().resourceManager.fetchMaterial<MeshMaterial>(init);
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
            value.str[0] = this.primitive ? getEngine().resourceManager.getAssetId(this.primitive) : '';
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
          name: 'MaterialObject',
          type: 'object',
          isPersistent() {
            return false;
          },
          options: {
            objectTypes: [MeshMaterial]
          },
          get(this: Mesh, value) {
            value.object[0] = this.material ?? null;
          }
        },
        {
          name: 'Geometry Instance',
          type: 'bool',
          get(this: Mesh, value) {
            value.bool[0] = !!this.material?.$isInstance;
          },
          set(this: Mesh, value) {
            this.material = value.bool[0] ? this.material?.createInstance() : this.material?.coreMaterial;
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
