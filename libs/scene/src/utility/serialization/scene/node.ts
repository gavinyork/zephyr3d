import { SceneNode } from '../../../scene/scene_node';
import type { SceneNodeVisible } from '../../../scene/scene_node';
import { Scene } from '../../../scene/scene';
import type { SerializableClass } from '../types';
import { degree2radian, radian2degree } from '@zephyr3d/base';
import { GraphNode, Mesh, ParticleSystem, Visitor } from '../../../scene';
import type { AssetRegistry } from '../asset/asset';
import { Material } from '../../../material';
import { Primitive } from '../../../render';

export class GatherVisitor implements Visitor<SceneNode> {
  /** @internal */
  private _primitiveSet: Set<Primitive>;
  private _materialSet: Set<Material>;
  private _nodeList: SceneNode[];
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

export class NodeHierarchy {
  private _rootNode: SceneNode;
  private _materialList: Material[];
  private _primitiveList: Primitive[];
  constructor(node: SceneNode) {
    this._rootNode = node;
    this._materialList = null;
    this._primitiveList = null;
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

export function getNodeHierarchyClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: NodeHierarchy,
    className: 'NodeHierarchy',
    getProps() {
      return [
        {
          name: 'MaterialList',
          type: 'object_array',
          phase: 0,
          hidden: true,
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
          hidden: true,
          get(this: NodeHierarchy, value) {
            value.object = [...this.primitiveList];
          },
          set() {}
        },
        {
          name: 'NodeHierarchy',
          type: 'object',
          hidden: true,
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

export function getSceneNodeClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: SceneNode,
    className: 'SceneNode',
    async createFunc(ctx: Scene | SceneNode, init?: { asset?: string }) {
      if (init?.asset) {
        const scene = ctx instanceof Scene ? ctx : ctx.scene;
        return { obj: (await assetRegistry.fetchModel(init.asset, scene)).group };
      }
      if (ctx instanceof Scene) {
        return { obj: new SceneNode(ctx) };
      } else if (ctx instanceof SceneNode) {
        const node = new SceneNode(ctx.scene);
        node.parent = ctx;
        return { obj: node };
      } else {
        return null;
      }
    },
    getInitParams(obj: SceneNode) {
      const asset = assetRegistry.getAssetId(obj);
      return asset ? { asset } : undefined;
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
        return { obj: new GraphNode(scene) };
      } else if (scene instanceof SceneNode) {
        const node = new GraphNode(scene.scene);
        node.parent = scene;
        return { obj: node };
      } else {
        return null;
      }
    },
    getProps() {
      return [];
    }
  };
}
