import { SceneNode } from '../../../scene/scene_node';
import type { SceneNodeVisible } from '../../../scene/scene_node';
import type { Scene } from '../../../scene/scene';
import type { SerializableClass } from '../types';
import { degree2radian, radian2degree } from '@zephyr3d/base';
import type { Mesh, ParticleSystem, Visitor } from '../../../scene';
import { GraphNode } from '../../../scene';
import type { Material } from '../../../material';
import type { Primitive } from '../../../render';
import type { SerializationManager } from '../manager';
import { AnimationClip } from '../../../animation';
import { JSONData } from '../json';

/** @internal */
export class GatherVisitor implements Visitor<SceneNode> {
  /** @internal */
  private readonly _primitiveSet: Set<Primitive>;
  private readonly _materialSet: Set<Material>;
  private readonly _nodeList: SceneNode[];
  /**
   * Creates an instance of CullVisitor
   * @param renderPass - Render pass for the culling task
   * @param camera - Camera that will be used for culling
   * @param rendeQueue - RenderQueue
   * @param viewPoint - Camera position of the primary render pass
   */
  constructor() {
    this._primitiveSet = new Set();
    this._materialSet = new Set();
    this._nodeList = [];
  }
  get primitiveSet() {
    return this._primitiveSet;
  }
  get materialSet() {
    return this._materialSet;
  }
  get nodeList() {
    return this._nodeList;
  }
  visit(target: SceneNode): unknown {
    this._nodeList.push(target);
    if (target.isMesh()) {
      return this.visitMesh(target);
    } else if (target.isParticleSystem()) {
      return this.visitParticleSystem(target);
    }
  }
  /** @internal */
  visitParticleSystem(node: ParticleSystem) {
    this.addMaterial(node.material);
    return true;
  }
  /** @internal */
  visitMesh(node: Mesh) {
    if (!node.sealed) {
      this.addMaterial(node.material);
      this.addPrimitive(node.primitive);
    }
    return true;
  }
  /** @internal */
  private addMaterial(material: Material) {
    if (material) {
      this._materialSet.add(material);
      if (material.$isInstance) {
        this._materialSet.add(material.coreMaterial);
      }
    }
  }
  private addPrimitive(primitive: Primitive) {
    if (primitive) {
      this._primitiveSet.add(primitive);
    }
  }
}

/** @internal */
export class NodeHierarchy {
  private readonly _scene: Scene;
  private _rootNode: SceneNode;
  private _materialList: Material[];
  private _primitiveList: Primitive[];
  constructor(scene: Scene, node?: SceneNode) {
    this._scene = scene;
    this._rootNode = node ?? null;
    this._materialList = null;
    this._primitiveList = null;
  }
  get scene() {
    return this._scene;
  }
  get rootNode() {
    return this._rootNode;
  }
  set rootNode(node: SceneNode) {
    this._rootNode = node;
  }
  get materialList() {
    if (!this._materialList) {
      this.gather();
    }
    return this._materialList;
  }
  get primitiveList() {
    if (!this._primitiveList) {
      this.gather();
    }
    return this._primitiveList;
  }
  private gather() {
    const v = new GatherVisitor();
    this._rootNode.traverse(v);
    this._materialList = [...v.materialSet];
    this._primitiveList = [...v.primitiveSet];
  }
}

/** @internal */
export function getNodeHierarchyClass(): SerializableClass {
  return {
    ctor: NodeHierarchy,
    name: 'NodeHierarchy',
    createFunc(ctx) {
      return { obj: new NodeHierarchy(ctx as Scene) };
    },
    getProps() {
      return [
        {
          name: 'MaterialList',
          type: 'object_array',
          phase: 0,
          isHidden() {
            return true;
          },
          get(this: NodeHierarchy, value) {
            value.object = [...this.materialList].sort(
              (a, b) => Number(!!a.$isInstance) - Number(!!b.$isInstance)
            );
          },
          set() {}
        },
        {
          name: 'PrimitiveList',
          type: 'object_array',
          phase: 0,
          isHidden() {
            return true;
          },
          get(this: NodeHierarchy, value) {
            value.object = [...this.primitiveList];
          },
          set() {}
        },
        {
          name: 'NodeHierarchy',
          type: 'object',
          phase: 1,
          isHidden() {
            return true;
          },
          get(this: NodeHierarchy, value) {
            value.object = [this.rootNode];
          },
          set(this: NodeHierarchy, value) {
            this.rootNode = value.object[0] as SceneNode;
          }
        }
      ];
    }
  };
}

/** @internal */
export function getSceneNodeClass(manager: SerializationManager): SerializableClass {
  return {
    ctor: SceneNode,
    name: 'SceneNode',
    async createFunc(ctx: NodeHierarchy | SceneNode, init?: { asset?: string }) {
      if (init?.asset) {
        return { obj: (await manager.fetchModel(init.asset, ctx.scene)).group };
      }
      const node = new SceneNode(ctx.scene);
      if (ctx instanceof SceneNode) {
        node.parent = ctx;
      }
      return { obj: node };
    },
    getInitParams(obj: SceneNode) {
      const asset = manager.getAssetId(obj);
      return asset ? { asset } : undefined;
    },
    getProps() {
      return [
        {
          name: 'Id',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: SceneNode, value) {
            value.str[0] = this.persistentId;
          },
          set(this: SceneNode, value) {
            this.persistentId = value.str[0];
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
                  }
                }
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
    createFunc(ctx: NodeHierarchy | SceneNode) {
      const node = new GraphNode(ctx.scene);
      if (ctx instanceof SceneNode) {
        node.parent = ctx;
      }
      return { obj: node };
    },
    getProps() {
      return [];
    }
  };
}
