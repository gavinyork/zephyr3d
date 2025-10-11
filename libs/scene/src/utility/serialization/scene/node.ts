import { SceneNode } from '../../../scene/scene_node';
import type { SceneNodeVisible } from '../../../scene/scene_node';
import { Scene } from '../../../scene/scene';
import type { SerializableClass } from '../types';
import type { DiffPatch, DiffValue } from '@zephyr3d/base';
import { applyPatch, ASSERT, degree2radian, diff, DRef, radian2degree } from '@zephyr3d/base';
import { GraphNode } from '../../../scene';
import type { SerializationManager } from '../manager';
import { AnimationClip, NodeRotationTrack, NodeScaleTrack, NodeTranslationTrack } from '../../../animation';
import { JSONData } from '../json';

/** @internal */
export function getSceneNodeClass(manager: SerializationManager): SerializableClass {
  return {
    ctor: SceneNode,
    name: 'SceneNode',
    async createFunc(ctx: Scene | SceneNode, init?: { prefabId: string; patch: DiffPatch }) {
      const scene = ctx instanceof Scene ? ctx : ctx.scene;
      if (init) {
        const prefabData = (await manager.loadPrefabContent(init.prefabId)).data as DiffValue;
        const nodeData = applyPatch(prefabData, init.patch);
        const tmpNode = new DRef(new SceneNode(scene));
        tmpNode.get().remove();
        tmpNode.get().prefabId = init.prefabId;
        const sceneNode = await manager.deserializeObject<SceneNode>(tmpNode.get(), nodeData as object);
        sceneNode.prefabId = init.prefabId;
        sceneNode.parent = ctx instanceof SceneNode ? ctx : ctx.rootNode;
        tmpNode.dispose();
        return { obj: sceneNode, loadProps: false };
      }
      const node = new SceneNode(scene);
      if (ctx instanceof SceneNode) {
        node.parent = ctx;
      }
      return { obj: node };
    },
    async getInitParams(obj: SceneNode, flags) {
      const prefabId = obj.prefabId;
      let patch: DiffPatch;
      if (prefabId) {
        try {
          obj.prefabId = '';
          const prefabData = (await manager.loadPrefabContent(prefabId)).data as DiffValue;
          const nodeData = await manager.serializeObject(obj);
          patch = diff(prefabData, nodeData);
          ASSERT(diff(applyPatch(prefabData, patch), nodeData).length === 0, 'Patch test failed');
        } finally {
          obj.prefabId = prefabId;
        }
        flags.saveProps = false;
      }
      return prefabId
        ? {
            prefabId,
            patch
          }
        : null;
    },
    getProps() {
      return [
        {
          name: 'Id',
          type: 'string',
          get(this: SceneNode, value) {
            value.str[0] = this.persistentId;
          },
          set(this: SceneNode, value) {
            this.persistentId = value.str[0];
          }
        },
        {
          name: 'RuntimeId',
          type: 'string',
          isPersistent() {
            return false;
          },
          get(this: SceneNode, value) {
            value.str[0] = `${this.runtimeId}`;
          }
        },
        {
          name: 'PrefabNode',
          type: 'string',
          isPersistent() {
            return false;
          },
          get(this: SceneNode, value) {
            const node = this.getPrefabNode();
            value.str[0] = node ? `${node.runtimeId}` : '';
          }
        },
        {
          name: 'PrefabId',
          type: 'string',
          get(this: SceneNode, value) {
            value.str[0] = this.prefabId;
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
          options: {
            animatable: true
          },
          isPersistent(this: SceneNode) {
            return this.jointTypeT !== 'animated';
          },
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
          options: {
            animatable: true
          },
          isPersistent(this: SceneNode) {
            return this.jointTypeS !== 'animated';
          },
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
          options: {
            animatable: true,
            edit: 'quaternion'
          },
          isPersistent() {
            return false;
          },
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
              degree2radian(value.num[2])
            );
          }
        },
        {
          name: 'QuatRotation',
          type: 'vec4',
          isHidden() {
            return true;
          },
          isPersistent(this: SceneNode) {
            return this.jointTypeR !== 'animated';
          },
          get(this: SceneNode, value) {
            value.num[0] = this.rotation.x;
            value.num[1] = this.rotation.y;
            value.num[2] = this.rotation.z;
            value.num[3] = this.rotation.w;
          },
          set(this: SceneNode, value) {
            this.rotation.setXYZW(value.num[0], value.num[1], value.num[2], value.num[3]);
          }
        },
        {
          name: 'Pickable',
          type: 'bool',
          default: false,
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
          default: 'inherit',
          options: {
            enum: {
              labels: ['Visible', 'Hidden', 'Inherit'],
              values: ['visible', 'hidden', 'inherit']
            }
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
          phase: 0,
          isHidden() {
            return true;
          },
          get(this: SceneNode, value) {
            value.object = [];
            for (const child of this.children) {
              if (!child.get().sealed) {
                value.object.push(child.get());
              }
            }
          },
          set(this: SceneNode, value) {
            for (let i = this.children.length - 1; i >= 0; i--) {
              const child = this.children[i].get();
              if (!value.object.includes(child) && !child.sealed) {
                child.remove();
              }
            }
            for (const child of value.object) {
              if (child instanceof SceneNode) {
                child.parent = this;
              } else {
                console.error(`Invalid scene node: ${child}`);
              }
            }
          }
        },
        {
          name: 'Animations',
          type: 'object_array',
          phase: 2,
          readonly: true,
          options: {
            objectTypes: [AnimationClip]
          },
          get(this: SceneNode, value) {
            const animationSet = this.animationSet;
            value.object = animationSet
              .getAnimationNames()
              .map((name) => animationSet.getAnimationClip(name));
          },
          set(this: SceneNode, value) {
            for (const ani of value.object) {
              const animation = ani as AnimationClip;
              for (const tracks of animation.tracks) {
                for (const track of tracks[1]) {
                  if (!track.embedded) {
                    animation.addTrack(tracks[0], track);
                    if (tracks[0] instanceof SceneNode) {
                      if (track instanceof NodeTranslationTrack) {
                        tracks[0].jointTypeT = 'animated';
                      } else if (track instanceof NodeScaleTrack) {
                        tracks[0].jointTypeS = 'animated';
                      } else if (track instanceof NodeRotationTrack) {
                        tracks[0].jointTypeR = 'animated';
                      }
                    }
                  }
                }
              }
              if (!manager.editorMode && animation.autoPlay) {
                this.animationSet.playAnimation(animation.name, { repeat: 0 });
              }
            }
          },
          delete(this: SceneNode, index) {
            const animationSet = this.animationSet;
            const name = animationSet.getAnimationNames()[index];
            const animation = animationSet.getAnimationClip(name);
            if (animation) {
              animationSet.deleteAnimation(name);
            }
          }
        },
        {
          name: 'Skeletons',
          type: 'object_array',
          phase: 1,
          isHidden() {
            return true;
          },
          get(this: SceneNode, value) {
            const animationSet = this.animationSet;
            value.object = animationSet.skeletons.map((v) => v.get());
          },
          set(this: SceneNode, value) {
            const animationSet = this.animationSet;
            animationSet.skeletons.forEach((v) => v.dispose());
            animationSet.skeletons.splice(0, animationSet.skeletons.length);
            animationSet.skeletons.push(...(value.object as any[]).map((v) => new DRef(v)));
          }
        },
        {
          name: 'Script',
          type: 'object',
          options: {
            mimeTypes: ['text/x-typescript']
          },
          isNullable() {
            return true;
          },
          get(this: SceneNode, value) {
            value.str[0] = this.script;
          },
          set(this: SceneNode, value) {
            this.script = value?.str?.[0] ?? '';
          }
        },
        {
          name: 'Metadata',
          type: 'object',
          options: { objectTypes: [JSONData] },
          isNullable() {
            return true;
          },
          get(this: SceneNode, value) {
            value.object[0] = this.metaData ? new JSONData(null, this.metaData) : null;
          },
          set(this: SceneNode, value) {
            this.metaData = (value?.object[0] as JSONData)?.data ?? null;
          }
        }
      ];
    }
  };
}

/** @internal */
export function getGraphNodeClass(): SerializableClass {
  return {
    ctor: GraphNode,
    parent: SceneNode,
    name: 'GraphNode',
    createFunc(ctx: SceneNode) {
      const node = new GraphNode(ctx.scene);
      node.parent = ctx;
      return { obj: node };
    },
    getProps() {
      return [];
    }
  };
}
