import { SceneNode } from '../../../scene/scene_node';
import type { SceneNodeVisible } from '../../../scene/scene_node';
import { Scene } from '../../../scene/scene';
import { defineProps, type SerializableClass } from '../types';
import type { DiffPatch, DiffValue } from '@zephyr3d/base';
import { applyPatch, ASSERT, degree2radian, diff, DRef, radian2degree } from '@zephyr3d/base';
import { GraphNode } from '../../../scene';
import type { ResourceManager } from '../manager';
import { AnimationClip, NodeRotationTrack, NodeScaleTrack, NodeTranslationTrack } from '../../../animation';
import { JSONData } from '../json';
import { SpringScriptConfig } from './spring_script';
import { parseZABCBlob, attachZABCAnimationsToSceneNode } from '../../../asset/loaders/zabc/zabc_loader';
import { restoreGeometryCacheMeshBinding } from '../../../animation/geometry_cache_utils';

const BUILTIN_SPRING_TEST_SCRIPT = '/assets/@builtins/scripts/springtest';
const geometryCacheBindings = new WeakMap<
  SceneNode,
  {
    assetId: string;
    autoPlay: boolean;
    animationNames: string[];
  }
>();

function isSpringTestScript(script: string) {
  const normalized = (script ?? '').trim().toLowerCase().replace(/\\/g, '/');
  return /(^|\/)springtest(\.ts|\.js)?$/.test(normalized);
}

function isBuiltinSpringTestScript(script: string) {
  const normalized = (script ?? '').trim().toLowerCase().replace(/\\/g, '/');
  return normalized === BUILTIN_SPRING_TEST_SCRIPT || normalized === `${BUILTIN_SPRING_TEST_SCRIPT}.js`;
}

function normalizeSerializedSceneNodeData(data: DiffValue): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      ClassName: 'SceneNode',
      Object: {}
    };
  }
  const serialized = data as Record<string, unknown>;
  if (typeof serialized.ClassName === 'string') {
    return serialized;
  }
  const objectData =
    serialized.Object && typeof serialized.Object === 'object' && !Array.isArray(serialized.Object)
      ? (serialized.Object as Record<string, unknown>)
      : serialized;
  return {
    ClassName: 'SceneNode',
    Object: objectData
  };
}

function hasMeshDescendants(node: SceneNode) {
  let hasMesh = false;
  node.iterate((child) => {
    if (child.isMesh()) {
      hasMesh = true;
      return true;
    }
    return false;
  });
  return hasMesh;
}

async function restoreGeometryCacheMeshes(node: SceneNode) {
  const tasks: Promise<boolean>[] = [];
  node.iterate((child) => {
    if (child.isMesh()) {
      tasks.push(restoreGeometryCacheMeshBinding(child));
    }
    return false;
  });
  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
}

async function clearGeometryCacheBinding(node: SceneNode) {
  const previous = geometryCacheBindings.get(node);
  if (!previous) {
    return null;
  }
  for (const name of previous.animationNames) {
    if (node.animationSet.isPlayingAnimation(name)) {
      node.animationSet.stopAnimation(name);
    }
    node.animationSet.deleteAnimation(name);
  }
  await restoreGeometryCacheMeshes(node);
  geometryCacheBindings.delete(node);
  return previous;
}

/** @internal */
export function getSceneNodeClass(manager: ResourceManager): SerializableClass {
  return {
    ctor: SceneNode,
    name: 'SceneNode',
    async createFunc(ctx: Scene | SceneNode, init?: { prefabId?: string; assetId?: string; patch?: DiffPatch }) {
      const scene = ctx instanceof Scene ? ctx : ctx.scene;
      if (init?.prefabId) {
        const prefabData = (await manager.loadPrefabContent(init.prefabId))!.data as DiffValue;
        const nodeData = normalizeSerializedSceneNodeData(applyPatch(prefabData, init.patch ?? []) as DiffValue);
        const tmpNode = new DRef(new SceneNode(scene));
        tmpNode.get()!.remove();
        tmpNode.get()!.prefabId = init.prefabId;
        const sceneNode = await manager.deserializeObject<SceneNode>(tmpNode.get(), nodeData);
        if (sceneNode) {
          sceneNode.prefabId = init.prefabId;
          sceneNode.parent = ctx instanceof SceneNode ? ctx : ctx.rootNode;
        }
        tmpNode.dispose();
        return { obj: sceneNode, loadProps: false };
      }
      if (init?.assetId) {
        const fetchedModel = await manager.fetchModel(init.assetId, scene!);
        const sceneNode = fetchedModel?.group ?? null;
        if (sceneNode) {
          const originalAssetId = manager.getAssetId(sceneNode);
          try {
            manager.setAssetId(sceneNode, null);
            const baseNodeData = await manager.serializeObject(sceneNode);
            const nodeData = normalizeSerializedSceneNodeData(
              applyPatch(baseNodeData as DiffValue, init.patch ?? []) as DiffValue
            );
            await manager.deserializeObjectProps(sceneNode, nodeData.Object as Record<string, unknown>);
          } finally {
            manager.setAssetId(sceneNode, originalAssetId ?? init.assetId);
          }
          sceneNode.parent = ctx instanceof SceneNode ? ctx : ctx.rootNode;
        }
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
      const assetId = manager.getAssetId(obj);
      let patch: DiffPatch | undefined = undefined;
      if (prefabId) {
        try {
          obj.prefabId = '';
          const prefabData = (await manager.loadPrefabContent(prefabId))!.data as DiffValue;
          const nodeData = await manager.serializeObject(obj);
          patch = diff(prefabData, nodeData);
          ASSERT(diff(applyPatch(prefabData, patch), nodeData).length === 0, 'Patch test failed');
        } finally {
          obj.prefabId = prefabId;
        }
        flags.saveProps = false;
      }
      if (!prefabId && assetId) {
        const baseNode = (await manager.fetchModel(assetId, obj.scene!))?.group ?? null;
        if (baseNode) {
          const originalObjectAssetId = manager.getAssetId(obj);
          const originalBaseAssetId = manager.getAssetId(baseNode);
          try {
            manager.setAssetId(obj, null);
            manager.setAssetId(baseNode, null);
            const baseNodeData = await manager.serializeObject(baseNode);
            const nodeData = await manager.serializeObject(obj);
            patch = diff(baseNodeData, nodeData);
            ASSERT(diff(applyPatch(baseNodeData, patch), nodeData).length === 0, 'Patch test failed');
          } finally {
            manager.setAssetId(obj, originalObjectAssetId);
            manager.setAssetId(baseNode, originalBaseAssetId);
            baseNode.remove();
          }
          flags.saveProps = false;
        }
      }
      return prefabId
        ? {
            prefabId,
            patch
          }
        : assetId
          ? {
              assetId,
              patch
            }
          : null;
    },
    getProps() {
      return defineProps([
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
          name: 'PrefabId',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: SceneNode, value) {
            value.str[0] = this.prefabId;
          }
        },
        {
          name: 'Name',
          type: 'string',
          getDefaultValue() {
            return '';
          },
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
          default: [0, 0, 0],
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
          default: [1, 1, 1],
          options: {
            animatable: true
          },
          isPersistent(this: SceneNode) {
            return this.jointTypeS !== 'animated';
          },
          isHidden(this: SceneNode) {
            return this.isCamera();
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
          default: [0, 0, 0],
          options: {
            animatable: true,
            edit: 'quaternion'
          },
          isPersistent() {
            return false;
          },
          isHidden(this: SceneNode) {
            return this.isCamera() && this.isOrtho();
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
          default: [0, 0, 0, 1],
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
              if (!child.get()!.sealed) {
                value.object.push(child.get());
              }
            }
          },
          set(this: SceneNode, value) {
            for (let i = this.children.length - 1; i >= 0; i--) {
              const child = this.children[i].get()!;
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
          name: 'GeometryCache',
          type: 'string',
          options: {
            group: 'Animation',
            label: 'Geometry Cache',
            mimeTypes: ['application/vnd.zephyr3d.alembic-cache+json']
          },
          isValid(this: SceneNode) {
            return this !== this.scene?.rootNode && hasMeshDescendants(this);
          },
          get(this: SceneNode, value) {
            value.str[0] = geometryCacheBindings.get(this)?.assetId ?? '';
          },
          async set(this: SceneNode, value) {
            const previous = await clearGeometryCacheBinding(this);
            const assetId = value?.str?.[0]?.trim() ?? '';
            if (!assetId) {
              return;
            }
            const binary = (await manager.assetManager.fetchBinaryData(assetId)) as ArrayBuffer;
            const parsed = await parseZABCBlob(
              new Blob([binary], { type: manager.VFS.guessMIMEType(assetId) || 'application/octet-stream' })
            );
            const autoPlay = previous?.autoPlay ?? false;
            const result = await attachZABCAnimationsToSceneNode(this, parsed, {
              sourcePath: assetId,
              autoPlay,
              replaceAnimationNames: []
            });
            geometryCacheBindings.set(this, {
              assetId,
              autoPlay,
              animationNames: result.animationNames
            });
          }
        },
        {
          name: 'GeometryCacheAutoPlay',
          type: 'bool',
          default: false,
          options: {
            group: 'Animation',
            label: 'Cache AutoPlay'
          },
          isValid(this: SceneNode) {
            return this !== this.scene?.rootNode && hasMeshDescendants(this);
          },
          get(this: SceneNode, value) {
            value.bool[0] = geometryCacheBindings.get(this)?.autoPlay ?? false;
          },
          async set(this: SceneNode, value) {
            const current = geometryCacheBindings.get(this);
            if (!current) {
              return;
            }
            const autoPlay = !!value.bool[0];
            geometryCacheBindings.set(this, {
              assetId: current.assetId,
              autoPlay,
              animationNames: current.animationNames
            });
            for (const name of current.animationNames) {
              const animation = this.animationSet.getAnimationClip(name);
              if (animation) {
                animation.autoPlay = autoPlay;
                if (autoPlay) {
                  this.animationSet.playAnimation(name, { repeat: 0 });
                } else if (this.animationSet.isPlayingAnimation(name)) {
                  this.animationSet.stopAnimation(name);
                }
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
            if (isSpringTestScript(this.script) && !(this.scriptConfig instanceof SpringScriptConfig)) {
              this.scriptConfig = new SpringScriptConfig();
            }
          }
        },
        {
          name: 'BuiltInScript',
          type: 'string',
          options: {
            group: 'Script',
            label: 'BuiltIn',
            enum: {
              labels: ['None', 'Spring Test'],
              values: ['', BUILTIN_SPRING_TEST_SCRIPT]
            }
          },
          get(this: SceneNode, value) {
            value.str[0] = isBuiltinSpringTestScript(this.script) ? BUILTIN_SPRING_TEST_SCRIPT : '';
          },
          set(this: SceneNode, value) {
            const selected = value?.str?.[0] ?? '';
            if (selected) {
              this.script = selected;
              if (isSpringTestScript(this.script) && !(this.scriptConfig instanceof SpringScriptConfig)) {
                this.scriptConfig = new SpringScriptConfig();
              }
            } else if (isBuiltinSpringTestScript(this.script)) {
              this.script = '';
            }
          }
        },
        {
          name: 'SpringConfig',
          type: 'object',
          options: {
            objectTypes: [SpringScriptConfig],
            group: 'Script',
            label: 'Parameters'
          },
          isValid(this: SceneNode) {
            return isSpringTestScript(this.script);
          },
          get(this: SceneNode, value) {
            if (!(this.scriptConfig instanceof SpringScriptConfig)) {
              this.scriptConfig = new SpringScriptConfig();
            }
            value.object[0] = this.scriptConfig;
          },
          set(this: SceneNode, value) {
            this.scriptConfig = (value?.object?.[0] as SpringScriptConfig | null) ?? new SpringScriptConfig();
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
            const data = value?.object[0] as JSONData | Record<string, unknown> | null | undefined;
            this.metaData = data instanceof JSONData ? data.data : (data ?? null);
          }
        }
      ]);
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
      const node = new GraphNode(ctx.scene!);
      node.parent = ctx;
      return { obj: node };
    },
    getProps() {
      return [];
    }
  };
}
