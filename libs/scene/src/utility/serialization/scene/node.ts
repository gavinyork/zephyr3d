import { SceneNode } from '../../../scene/scene_node';
import type { SceneNodeVisible } from '../../../scene/scene_node';
import { Scene } from '../../../scene/scene';
import type { SerializableClass } from '../types';
import { degree2radian, radian2degree } from '@zephyr3d/base';
import { GraphNode } from '../../../scene';
import type { AssetRegistry } from '../asset/asset';

export class AssetNode {
  constructor(public id: string, public node: SceneNode) {}
}

export function getSceneNodeClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: SceneNode,
    className: 'SceneNode',
    createFunc(scene: Scene | SceneNode) {
      if (scene instanceof Scene) {
        return new SceneNode(scene);
      } else if (scene instanceof SceneNode) {
        const batchGroup = new SceneNode(scene.scene);
        batchGroup.parent = scene;
        return batchGroup;
      } else {
        return null;
      }
    },
    getProps() {
      return [
        {
          name: 'Id',
          type: 'string',
          hidden: true,
          get(this: SceneNode, value) {
            value.str[0] = this.id;
          },
          set(this: SceneNode, value) {
            this.id = value.str[0];
          }
        },
        {
          name: 'Name',
          type: 'string',
          defaultValue: '',
          get(this: SceneNode, value) {
            value.str[0] = this.name;
          },
          set(this: SceneNode, value) {
            this.name = value.str[0];
          }
        },
        {
          name: 'Position',
          type: 'vec3',
          get(this: SceneNode, value) {
            value.num[0] = this.position.x;
            value.num[1] = this.position.y;
            value.num[2] = this.position.z;
          },
          set(this: SceneNode, value) {
            this.position.setXYZ(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'Scale',
          type: 'vec3',
          get(this: SceneNode, value) {
            value.num[0] = this.scale.x;
            value.num[1] = this.scale.y;
            value.num[2] = this.scale.z;
          },
          set(this: SceneNode, value) {
            this.scale.setXYZ(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'Rotation',
          type: 'vec3',
          get(this: SceneNode, value) {
            const zyx = this.rotation.toEulerAngles();
            value.num[0] = Math.round(radian2degree(zyx.x));
            value.num[1] = Math.round(radian2degree(zyx.y));
            value.num[2] = Math.round(radian2degree(zyx.z));
          },
          set(this: SceneNode, value) {
            this.rotation.fromEulerAngle(
              degree2radian(value.num[0]),
              degree2radian(value.num[1]),
              degree2radian(value.num[2]),
              'ZYX'
            );
          }
        },
        {
          name: 'Pickable',
          type: 'bool',
          get(this: SceneNode, value) {
            value.bool[0] = this.pickable;
          },
          set(this: SceneNode, value) {
            this.pickable = value.bool[0];
          }
        },
        {
          name: 'Visible',
          type: 'string',
          enum: {
            labels: ['Visible', 'Hidden', 'Inherit'],
            values: ['visible', 'hidden', 'inherit']
          },
          get(this: SceneNode, value) {
            value.str[0] = this.showState;
          },
          set(this: SceneNode, value) {
            this.showState = value.str[0] as SceneNodeVisible;
          }
        },
        {
          name: 'Children',
          type: 'object_array',
          hidden: true,
          get(this: SceneNode, value) {
            value.object = [];
            for (const child of this.children) {
              const assetId = assetRegistry.getAssetId(child);
              if (assetId) {
                value.object.push(new AssetNode(assetId, this));
              } else {
                value.object.push(child);
              }
            }
          },
          set(this: SceneNode, value) {
            this.removeChildren();
            for (const child of value.object) {
              if (child instanceof SceneNode) {
                child.parent = this;
              } else {
                console.error(`Invalid scene node: ${child}`);
              }
            }
          }
        }
      ];
    }
  };
}

export function getAssetNodeClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: AssetNode,
    className: 'AssetNode',
    async createFunc(ctx: Scene | SceneNode, id: string) {
      const scene = ctx instanceof Scene ? ctx : ctx.scene;
      const model = await assetRegistry.fetchModel(id, scene);
      return model?.group ?? null;
    },
    getInitParams(obj: AssetNode) {
      return [obj.id];
    },
    getObject(obj: AssetNode) {
      return obj.node;
    },
    getProps(obj: SceneNode) {
      return getSceneNodeClass(assetRegistry)
        .getProps(obj)
        .filter((val) => val.name !== 'Children');
    }
  };
}

export function getGraphNodeClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: GraphNode,
    parent: getSceneNodeClass(assetRegistry),
    className: 'GraphNode',
    createFunc(scene: Scene | SceneNode) {
      if (scene instanceof Scene) {
        return new GraphNode(scene);
      } else if (scene instanceof SceneNode) {
        const batchGroup = new GraphNode(scene.scene);
        batchGroup.parent = scene;
        return batchGroup;
      } else {
        return null;
      }
    },
    getProps() {
      return [];
    }
  };
}
