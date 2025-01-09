import { SceneNode } from '../../../scene/scene_node';
import type { SceneNodeVisible } from '../../../scene/scene_node';
import { Scene } from '../../../scene/scene';
import type { SerializableClass } from '../types';
import { degree2radian, radian2degree } from '@zephyr3d/base';
import { GraphNode } from '../../../scene';
import type { AssetRegistry } from '../asset/asset';

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
          get(this: SceneNode, value) {
            value.object = this.children.slice();
          },
          set(this: SceneNode, value) {
            this.removeChildren();
            for (const child of value.object) {
              if (child instanceof SceneNode) {
                child.parent = this;
              } else if (typeof child === 'string' && child.startsWith('ASSET:')) {
                const assetId = child.slice(6);
                const assetInfo = assetRegistry.getAssetInfo(assetId);
                if (assetInfo?.type === 'model') {
                  assetRegistry.fetchModel(assetId, this.scene).then((modelInfo) => {
                    modelInfo.group.parent = this;
                  });
                }
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
