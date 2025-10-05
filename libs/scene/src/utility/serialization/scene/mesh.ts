import { getEngine } from '../../../app/api';
import type { MeshMaterial } from '../../../material';
import { GraphNode, Mesh, type SceneNode } from '../../../scene';
import type { SerializableClass } from '../types';

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
            value.str[0] = this.material ? getEngine().serializationManager.getAssetId(this.material) : '';
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
