import { getEngine } from '../../../app/api';
import type { MeshMaterial } from '../../../material/meshmaterial';
import { GraphNode, type SceneNode } from '../../../scene';
import { defineProps, type SerializableClass } from '../types';
import { meshInstanceClsMap } from './common';
import { Sprite } from '../../../scene/sprite';
import { SpriteMaterial } from '../../../material/sprite';
import { Vector2 } from '@zephyr3d/base';

/** @internal */
export function getSpriteClass(): SerializableClass {
  return {
    ctor: Sprite,
    name: 'Sprite',
    parent: GraphNode,
    noTitle: true,
    createFunc(ctx: SceneNode) {
      const node = new Sprite(ctx.scene!);
      node.parent = ctx;
      return { obj: node };
    },
    getProps() {
      return defineProps([
        {
          name: 'Anchor',
          type: 'vec2',
          default: [0.5, 0.5],
          get(this: Sprite, value) {
            value.num[0] = this.anchorX;
            value.num[1] = this.anchorY;
          },
          set(this: Sprite, value) {
            this.anchorX = value.num[0];
            this.anchorY = value.num[1];
          }
        },
        {
          name: 'UVTopLeft',
          type: 'vec2',
          default: [0, 0],
          get(this: Sprite, value) {
            const lt = this.uvTopLeft;
            value.num[0] = lt.x;
            value.num[1] = lt.y;
          },
          set(this: Sprite, value) {
            this.uvTopLeft = new Vector2(value.num[0], value.num[1]);
          }
        },
        {
          name: 'UVBottomRight',
          type: 'vec2',
          default: [1, 1],
          get(this: Sprite, value) {
            const rb = this.uvBottomRight;
            value.num[0] = rb.x;
            value.num[1] = rb.y;
          },
          set(this: Sprite, value) {
            this.uvBottomRight = new Vector2(value.num[0], value.num[1]);
          }
        },
        {
          name: 'Material',
          type: 'object',
          options: {
            mimeTypes: ['application/vnd.zephyr3d.material+json']
          },
          get(this: Sprite, value) {
            const m = this.material?.coreMaterial;
            value.str[0] = getEngine().resourceManager.getAssetId(m) ?? '';
          },
          async set(this: Sprite, value) {
            if (value?.str[0]) {
              const material = await getEngine().resourceManager.fetchMaterial<MeshMaterial>(value.str[0]);
              if (material && material instanceof SpriteMaterial) {
                this.material = material;
              } else {
                console.error(
                  material ? `Not a sprite material: ${value.str[0]}` : `Material not found: ${value.str[0]}`
                );
              }
            }
          }
        },
        {
          name: 'Geometry Instance',
          type: 'bool',
          get(this: Sprite, value) {
            value.bool[0] = !!this.material?.$isInstance;
          },
          set(this: Sprite, value) {
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
          isHidden(this: Sprite) {
            return this.material && !this.material?.$isInstance;
          },
          isNullable() {
            return true;
          },
          get(this: Sprite, value) {
            const C = this.material?.$isInstance
              ? meshInstanceClsMap.get(this.material.coreMaterial.constructor as typeof MeshMaterial)
              : null;
            value.object[0] = C ? new C.C(this.material) : null;
          },
          set(this: Sprite, value) {
            if (value.object[0]) {
              this.material = (value.object[0] as any)?.material;
            }
          }
        }
      ]);
    }
  };
}
