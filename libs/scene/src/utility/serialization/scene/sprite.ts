import { getEngine } from '../../../app/api';
import type { MeshMaterial } from '../../../material/meshmaterial';
import { GraphNode, type SceneNode } from '../../../scene';
import type { SerializableClass } from '../types';
import { meshInstanceClsMap } from './common';
import { Sprite3D } from '../../../scene/sprite3d';
import { Sprite3DMaterial } from '../../../material/sprite3d';

/** @internal */
export function getSprite3DClass(): SerializableClass {
  return {
    ctor: Sprite3D,
    name: 'Sprite3D',
    parent: GraphNode,
    noTitle: true,
    createFunc(ctx: SceneNode) {
      const node = new Sprite3D(ctx.scene);
      node.parent = ctx;
      return { obj: node };
    },
    getProps() {
      return [
        {
          name: 'Anchor',
          type: 'vec2',
          default: [0.5, 0.5],
          get(this: Sprite3D, value) {
            value.num[0] = this.anchorX;
            value.num[1] = this.anchorY;
          },
          set(this: Sprite3D, value) {
            this.anchorX = value.num[0];
            this.anchorY = value.num[1];
          }
        },
        {
          name: 'Material',
          type: 'object',
          options: {
            mimeTypes: ['application/vnd.zephyr3d.material+json']
          },
          get(this: Sprite3D, value) {
            const m = this.material?.coreMaterial;
            value.str[0] = getEngine().resourceManager.getAssetId(m) ?? '';
          },
          async set(this: Sprite3D, value) {
            if (value?.str[0]) {
              const material = await getEngine().resourceManager.fetchMaterial<MeshMaterial>(value.str[0]);
              if (material && material instanceof Sprite3DMaterial) {
                this.material = material;
              } else {
                console.error(
                  material
                    ? `Not a sprite3d material: ${value.str[0]}`
                    : `Material not found: ${value.str[0]}`
                );
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
            objectTypes: [Sprite3DMaterial]
          },
          get(this: Sprite3D, value) {
            value.object[0] = this.material ?? null;
          }
        },
        {
          name: 'Geometry Instance',
          type: 'bool',
          get(this: Sprite3D, value) {
            value.bool[0] = !!this.material?.$isInstance;
          },
          set(this: Sprite3D, value) {
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
          isHidden(this: Sprite3D) {
            return this.material && !this.material?.$isInstance;
          },
          isNullable() {
            return true;
          },
          get(this: Sprite3D, value) {
            const C = this.material?.$isInstance
              ? meshInstanceClsMap.get(this.material.coreMaterial.constructor as typeof MeshMaterial)
              : null;
            value.object[0] = C ? new C.C(this.material) : null;
          },
          set(this: Sprite3D, value) {
            if (value.object[0]) {
              this.material = (value.object[0] as any)?.material;
            }
          }
        }
      ];
    }
  };
}
