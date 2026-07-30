import { SceneNode } from '../../../scene/scene_node';
import type { SceneNodeVisible, SerializedMorphTargetGroup } from '../../../scene/scene_node';
import { Scene } from '../../../scene/scene';
import { defineProps, type SerializableClass } from '../types';
import type { DiffPatch, DiffValue } from '@zephyr3d/base';
import {
  applyPatch,
  ASSERT,
  degree2radian,
  diff,
  DRef,
  guessMimeType,
  mimeTypeOf,
  radian2degree
} from '@zephyr3d/base';
import { GraphNode } from '../../../scene';
import type { ResourceManager } from '../manager';
import {
  AnimationClip,
  JointDynamicsModifier,
  SpringModifier,
  NodeRotationTrack,
  NodeScaleTrack,
  NodeTranslationTrack
} from '../../../animation';
import { JSONArray, JSONData } from '../json';
import { ScriptAttachment, normalizeScriptAttachmentConfig } from '../../../scene/script_attachment';
import { parseZABCBlob, attachZABCAnimationsToSceneNode } from '../../../asset/loaders/zabc/zabc_loader';
import { restoreGeometryCacheMeshBinding } from '../../../animation/geometry_cache_utils';
import {
  getJointDynamicsModifierSkeleton,
  getSpringModifierSkeleton,
  setJointDynamicsModifierSkeleton,
  setSpringModifierSkeleton
} from './animation';
const geometryCacheBindings = new WeakMap<
  SceneNode,
  {
    assetId: string;
    autoPlay: boolean;
    animationNames: string[];
  }
>();

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

function normalizePatchData(data: DiffValue): DiffValue {
  const serialized = JSON.stringify(data);
  ASSERT(serialized !== undefined, 'Prefab patch data is not JSON serializable');
  return JSON.parse(serialized) as DiffValue;
}

function createVerifiedPatch(baseData: DiffValue, nodeData: DiffValue): DiffPatch | undefined {
  const normalizedBaseData = normalizePatchData(baseData);
  const normalizedNodeData = normalizePatchData(nodeData);
  const patch = diff(normalizedBaseData, normalizedNodeData);
  if (patch.length === 0) {
    return undefined;
  }
  if (diff(applyPatch(normalizedBaseData, patch), normalizedNodeData).length === 0) {
    return patch;
  }
  const fallbackPatch: DiffPatch = [{ kind: 'set', path: [], value: normalizedNodeData }];
  ASSERT(
    diff(applyPatch(normalizedBaseData, fallbackPatch), normalizedNodeData).length === 0,
    'Fallback patch test failed'
  );
  return fallbackPatch;
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
    async createFunc(
      ctx: Scene | SceneNode,
      init?: { prefabId?: string; assetId?: string; patch?: DiffPatch }
    ) {
      const scene = ctx instanceof Scene ? ctx : ctx.scene;
      if (init?.prefabId) {
        const prefabContent = await manager.loadPrefabContent(init.prefabId);
        if (!prefabContent?.data) {
          console.warn(`Skip scene node because prefab asset is missing: ${init.prefabId}`);
          return { obj: null, loadProps: false };
        }
        const prefabData = prefabContent.data as DiffValue;
        const nodeData = normalizeSerializedSceneNodeData(
          applyPatch(prefabData, init.patch ?? []) as DiffValue
        );
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
        let fetchedModel: SceneNode | null = null;
        try {
          fetchedModel = (await manager.fetchModel(init.assetId, scene!)) ?? null;
        } catch (err) {
          console.warn(`Skip scene node because model asset failed to load: ${init.assetId}: ${err}`);
          fetchedModel = null;
        }
        const sceneNode = fetchedModel ?? null;
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
        } else {
          console.warn(`Skip scene node because model asset is missing: ${init.assetId}`);
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
      let prefabId = obj.prefabId;
      const assetId = manager.getAssetId(obj);
      let patch: DiffPatch | undefined = undefined;
      if (prefabId && guessMimeType(prefabId) === mimeTypeOf('.zprefab')) {
        try {
          const prefabData = (await manager.loadPrefabContent(prefabId))!.data as DiffValue;
          obj.prefabId = '';
          const nodeData = await manager.serializeObject(obj);
          patch = createVerifiedPatch(prefabData, nodeData);
        } finally {
          obj.prefabId = prefabId;
        }
        flags.saveProps = false;
      } else {
        prefabId = '';
      }
      if (!prefabId && assetId) {
        const baseNode = (await manager.fetchModel(assetId, obj.scene!)) ?? null;
        if (baseNode) {
          const originalObjectAssetId = manager.getAssetId(obj);
          const originalBaseAssetId = manager.getAssetId(baseNode);
          try {
            manager.setAssetId(obj, null);
            manager.setAssetId(baseNode, null);
            const baseNodeData = await manager.serializeObject(baseNode);
            const nodeData = await manager.serializeObject(obj);
            patch = createVerifiedPatch(baseNodeData, nodeData);
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
          description: 'Unique persistent id for the node',
          type: 'string',
          readonly: true,
          get(this: SceneNode, value) {
            value.str[0] = this.persistentId;
          },
          set(this: SceneNode, value) {
            this.persistentId = value.str[0];
          }
        },
        {
          name: 'PrefabId',
          description: 'Persistent ID of the prefab source for this node',
          type: 'string',
          readonly: true,
          isHidden() {
            return true;
          },
          get(this: SceneNode, value) {
            value.str[0] = this.prefabId;
          }
        },
        {
          name: 'Name',
          description: 'Display name of the node',
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
          description: 'Local position of the node',
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
          description: 'Local scale of the node',
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
          description: 'Euler rotation of this node in ZYX order',
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
          description: 'Node rotation quaternion',
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
          description: 'If true, enable ray-cast for this object',
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
          description: 'Node visible state',
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
          description: 'Children nodes of this node',
          type: 'object_array',
          phase: 0,
          isHidden() {
            return true;
          },
          isPersistent(this: SceneNode) {
            return !this._prefabId || guessMimeType(this._prefabId) === mimeTypeOf('.zprefab');
          },
          get(this: SceneNode, value) {
            value.object = [];
            for (const child of this.children) {
              if (!child.sealed) {
                value.object.push(child);
              }
            }
          },
          set(this: SceneNode, value) {
            const children = this.children;
            for (let i = children.length - 1; i >= 0; i--) {
              const child = children[i];
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
          name: 'MorphTargetGroups',
          description: 'Serialized model-level morph target groups for this node',
          type: 'object',
          phase: 10,
          options: { objectTypes: [JSONArray] },
          isHidden() {
            return true;
          },
          isPersistent(this: SceneNode) {
            return !this._prefabId || guessMimeType(this._prefabId) === mimeTypeOf('.zprefab');
          },
          get(this: SceneNode, value) {
            const groups = this.getSerializedMorphTargetGroups();
            value.object[0] = groups.length > 0 ? new JSONArray(null, groups) : null;
          },
          set(this: SceneNode, value) {
            const data = value?.object[0] as JSONArray | SerializedMorphTargetGroup[] | null | undefined;
            if (data) {
              this.setSerializedMorphTargetGroups(data instanceof JSONArray ? data.data : data);
            }
          }
        },
        {
          name: 'GeometryCache',
          description: 'Alembic geometry cache asset used by this node',
          type: 'string',
          options: {
            group: 'Animation',
            label: 'Geometry Cache',
            mimeTypes: [mimeTypeOf('.zabc')]
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
          description: 'If true, plays the geometry cache automatically when loaded',
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
          description: 'Animation clips which affect this object or children',
          type: 'object_array',
          phase: 2,
          readonly: true,
          options: {
            objectTypes: [AnimationClip]
          },
          isPersistent(this: SceneNode) {
            return !this._prefabId || guessMimeType(this._prefabId) === mimeTypeOf('.zprefab');
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
          name: 'Rigs',
          description: 'Shared skeleton rigs used by the node animations',
          type: 'object_array',
          phase: 1,
          isHidden() {
            return true;
          },
          isPersistent(this: SceneNode) {
            return !this._prefabId || guessMimeType(this._prefabId) === mimeTypeOf('.zprefab');
          },
          get(this: SceneNode, value) {
            const animationSet = this.animationSet;
            const rigs = new Set(animationSet.rigs.map((v) => v.get()));
            for (const binding of animationSet.skeletons) {
              const rig = binding.get()?.rig;
              if (rig) {
                rigs.add(rig);
              }
            }
            value.object = [...rigs];
          },
          set(this: SceneNode, value) {
            const animationSet = this.animationSet;
            animationSet.rigs.forEach((v) => v.dispose());
            animationSet.rigs.splice(0, animationSet.rigs.length);
            animationSet.rigs.push(...(value.object as any[]).map((v) => new DRef(v)));
          }
        },
        {
          name: 'Skeletons',
          description: 'Skin bindings used by the node animations',
          type: 'object_array',
          phase: 2,
          isHidden() {
            return true;
          },
          isPersistent(this: SceneNode) {
            return !this._prefabId || guessMimeType(this._prefabId) === mimeTypeOf('.zprefab');
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
            for (const binding of animationSet.skeletons) {
              const rig = binding.get()?.rig;
              if (rig && !animationSet.rigs.some((ref) => ref.get() === rig)) {
                animationSet.rigs.push(new DRef(rig));
              }
            }
          }
        },
        {
          name: 'JointDynamics',
          description: 'Joint dynamics systems which affect this object or children',
          type: 'object_array',
          phase: 3,
          readonly: true,
          options: {
            objectTypes: [JointDynamicsModifier]
          },
          isPersistent(this: SceneNode) {
            return !this._prefabId || guessMimeType(this._prefabId) === mimeTypeOf('.zprefab');
          },
          getDefaultValue(this: SceneNode) {
            const animationSet = this.animationSet;
            const jdm: JointDynamicsModifier[] = [];
            const rigs = new Set(animationSet.rigs.map((v) => v.get()));
            for (const binding of animationSet.skeletons) {
              const rig = binding.get()?.rig;
              if (rig) {
                rigs.add(rig);
              }
            }
            for (const sk of rigs) {
              for (const mod of sk!.modifiers) {
                if (mod instanceof JointDynamicsModifier) {
                  setJointDynamicsModifierSkeleton(mod, sk!);
                  jdm.push(mod);
                }
              }
            }
            return jdm;
          },
          get(this: SceneNode, value) {
            const animationSet = this.animationSet;
            const jdm: JointDynamicsModifier[] = [];
            const rigs = new Set(animationSet.rigs.map((v) => v.get()));
            for (const binding of animationSet.skeletons) {
              const rig = binding.get()?.rig;
              if (rig) {
                rigs.add(rig);
              }
            }
            for (const sk of rigs) {
              for (const mod of sk!.modifiers) {
                if (mod instanceof JointDynamicsModifier) {
                  setJointDynamicsModifierSkeleton(mod, sk!);
                  jdm.push(mod);
                }
              }
            }
            value.object = jdm;
          },
          set(this: SceneNode, value) {
            const animationSet = this.animationSet;
            for (const sk of animationSet.rigs) {
              const modifiers = sk.get()!.modifiers;
              for (let i = modifiers.length - 1; i >= 0; i--) {
                if (modifiers[i] instanceof JointDynamicsModifier) {
                  modifiers.splice(i, 1);
                }
              }
            }
            for (const mod of value.object) {
              if (!(mod instanceof JointDynamicsModifier)) {
                continue;
              }
              const skeleton = getJointDynamicsModifierSkeleton(mod);
              if (skeleton && animationSet.rigs.some((sk) => sk.get() === skeleton)) {
                skeleton.modifiers.push(mod);
                setJointDynamicsModifierSkeleton(mod, skeleton);
                continue;
              }
              for (const sk of animationSet.rigs) {
                if (
                  mod.jointDynamicsSystem.chainConfig.chains.every((chain) =>
                    sk.get()!.joints.includes(chain.start)
                  )
                ) {
                  sk.get()!.modifiers.push(mod);
                  setJointDynamicsModifierSkeleton(mod, sk.get()!);
                  break;
                }
              }
            }
          },
          delete(this: SceneNode, index) {
            const animationSet = this.animationSet;
            let n = 0;
            for (const sk of animationSet.rigs) {
              for (const mod of sk.get()!.modifiers) {
                if (mod instanceof JointDynamicsModifier) {
                  if (n === index) {
                    const index = sk.get()!.modifiers.indexOf(mod);
                    sk.get()!.modifiers.splice(index, 1);
                    return;
                  }
                  n++;
                }
              }
            }
          }
        },
        {
          name: 'SpringModifiers',
          description: 'Spring systems which affect this object or children',
          type: 'object_array',
          phase: 3,
          readonly: true,
          options: {
            objectTypes: [SpringModifier]
          },
          isPersistent(this: SceneNode) {
            return !this._prefabId || guessMimeType(this._prefabId) === mimeTypeOf('.zprefab');
          },
          getDefaultValue(this: SceneNode) {
            const animationSet = this.animationSet;
            const springModifiers: SpringModifier[] = [];
            const rigs = new Set(animationSet.rigs.map((v) => v.get()));
            for (const binding of animationSet.skeletons) {
              const rig = binding.get()?.rig;
              if (rig) {
                rigs.add(rig);
              }
            }
            for (const rig of rigs) {
              for (const modifier of rig!.modifiers) {
                if (modifier instanceof SpringModifier) {
                  setSpringModifierSkeleton(modifier, rig!);
                  springModifiers.push(modifier);
                }
              }
            }
            return springModifiers;
          },
          get(this: SceneNode, value) {
            const animationSet = this.animationSet;
            const springModifiers: SpringModifier[] = [];
            const rigs = new Set(animationSet.rigs.map((v) => v.get()));
            for (const binding of animationSet.skeletons) {
              const rig = binding.get()?.rig;
              if (rig) {
                rigs.add(rig);
              }
            }
            for (const rig of rigs) {
              for (const modifier of rig!.modifiers) {
                if (modifier instanceof SpringModifier) {
                  setSpringModifierSkeleton(modifier, rig!);
                  springModifiers.push(modifier);
                }
              }
            }
            value.object = springModifiers;
          },
          set(this: SceneNode, value) {
            const animationSet = this.animationSet;
            for (const rigRef of animationSet.rigs) {
              const modifiers = rigRef.get()!.modifiers;
              for (let i = modifiers.length - 1; i >= 0; i--) {
                if (modifiers[i] instanceof SpringModifier) {
                  modifiers.splice(i, 1);
                }
              }
            }
            for (const modifier of value.object) {
              if (!(modifier instanceof SpringModifier)) {
                continue;
              }
              const skeleton = getSpringModifierSkeleton(modifier);
              if (skeleton && animationSet.rigs.some((rigRef) => rigRef.get() === skeleton)) {
                skeleton.modifiers.push(modifier);
                setSpringModifierSkeleton(modifier, skeleton);
                continue;
              }
              const system = modifier.springSystem as any;
              const chains = Array.isArray(system?.chains)
                ? system.chains
                : system?.chain
                  ? [system.chain]
                  : [];
              const particleNodes = chains.flatMap((chain: any) =>
                (chain?.particles ?? []).map((particle: any) => particle?.node).filter(Boolean)
              );
              for (const rigRef of animationSet.rigs) {
                const rig = rigRef.get()!;
                if (
                  particleNodes.length > 0 &&
                  particleNodes.every((node: SceneNode) => rig.joints.includes(node))
                ) {
                  rig.modifiers.push(modifier);
                  setSpringModifierSkeleton(modifier, rig);
                  break;
                }
              }
            }
          },
          delete(this: SceneNode, index) {
            const animationSet = this.animationSet;
            let current = 0;
            for (const rigRef of animationSet.rigs) {
              const modifiers = rigRef.get()!.modifiers;
              for (const modifier of modifiers) {
                if (modifier instanceof SpringModifier) {
                  if (current === index) {
                    modifiers.splice(modifiers.indexOf(modifier), 1);
                    return;
                  }
                  current++;
                }
              }
            }
          }
        },
        {
          name: 'Script',
          description: 'First script file path which is attached to this node',
          type: 'object',
          options: {
            mimeTypes: ['text/x-typescript']
          },
          isHidden() {
            return true;
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
          name: 'Scripts',
          description: 'All script file paths which are attached to this node',
          type: 'object_array',
          options: {
            objectTypes: [ScriptAttachment]
          },
          isHidden() {
            return true;
          },
          getDefaultValue(this: SceneNode) {
            return this.scripts;
          },
          isNullable() {
            return false;
          },
          get(this: SceneNode, value) {
            value.object = this.scripts;
          },
          set(this: SceneNode, value) {
            this.scripts = (value.object as ScriptAttachment[]) ?? [];
          },
          create() {
            return new ScriptAttachment();
          },
          add(this: SceneNode, value, index) {
            const attachments = this.scripts;
            attachments.splice(
              index ?? attachments.length,
              0,
              (value.object?.[0] as ScriptAttachment) ?? new ScriptAttachment()
            );
            this.scripts = attachments;
          },
          delete(this: SceneNode, index) {
            const attachments = this.scripts;
            if (index >= 0 && index < attachments.length) {
              attachments.splice(index, 1);
              this.scripts = attachments;
            }
          }
        },
        {
          name: 'ScriptConfig',
          description: 'Configuration object passed to the attached script',
          type: 'object',
          options: { objectTypes: [JSONData, JSONArray] },
          isHidden() {
            return true;
          },
          isNullable() {
            return true;
          },
          isPersistent(this: SceneNode) {
            return !!this.script;
          },
          get(this: SceneNode, value) {
            const config = normalizeScriptAttachmentConfig(this.scriptConfig);
            value.object[0] =
              config == null
                ? null
                : Array.isArray(config)
                  ? new JSONArray(null, config)
                  : new JSONData(null, config);
          },
          set(this: SceneNode, value) {
            const data = value?.object[0] as
              | JSONData
              | JSONArray
              | Record<string, unknown>
              | unknown[]
              | null
              | undefined;
            this.scriptConfig =
              data instanceof JSONData || data instanceof JSONArray
                ? normalizeScriptAttachmentConfig(data.data)
                : normalizeScriptAttachmentConfig(data);
          }
        },
        {
          name: 'ScriptConfigs',
          description: 'Per-script configuration array for all attached scripts',
          type: 'object',
          options: { objectTypes: [JSONArray] },
          getDefaultValue(this: SceneNode) {
            return this.scriptConfigs;
          },
          isHidden() {
            return true;
          },
          isNullable() {
            return true;
          },
          isPersistent(this: SceneNode) {
            return this.scripts.length > 0;
          },
          get(this: SceneNode, value) {
            value.object[0] = this.scriptConfigs.length > 0 ? new JSONArray(null, this.scriptConfigs) : null;
          },
          set(this: SceneNode, value) {
            const data = value?.object[0] as JSONArray | unknown[] | null | undefined;
            this.scriptConfigs = data instanceof JSONArray ? data.data : Array.isArray(data) ? data : [];
          }
        },
        {
          name: 'Metadata',
          description: 'Meta data for this node',
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
