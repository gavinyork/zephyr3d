import type {
  ModelInfo,
  NodeCloneMethod,
  Scene,
  SceneNode,
  ShapeOptionType,
  ShapeType
} from '@zephyr3d/scene';
import { NodeHierarchy } from '@zephyr3d/scene';
import { ParticleSystem } from '@zephyr3d/scene';
import {
  BoxFrameShape,
  BoxShape,
  CylinderShape,
  Mesh,
  PBRMetallicRoughnessMaterial,
  PlaneShape,
  SphereShape,
  TorusShape
} from '@zephyr3d/scene';
import { Command } from '../core/command';
import { Matrix4x4, Quaternion, Vector3, type GenericConstructor } from '@zephyr3d/base';
import type { TRS } from '../types';
import { ProjectService } from '../core/services/project';

const idNodeMap: Record<string, SceneNode> = {};

export type CommandExecuteResult<T> = T extends AddAssetCommand ? SceneNode : void;

export class AddAssetCommand extends Command<SceneNode> {
  private readonly _scene: Scene;
  private readonly _asset: string;
  private _nodeId: string;
  private readonly _position: Vector3;
  constructor(scene: Scene, asset: string, position: Vector3) {
    super('Add asset');
    this._scene = scene;
    this._nodeId = '';
    this._asset = asset;
    this._position = new Vector3(position);
  }
  async execute() {
    let asset: ModelInfo = null;
    try {
      asset = await ProjectService.serializationManager.fetchModel(this._asset, this._scene);
    } catch (err) {
      console.error(`Load asset failed: ${this._asset}: ${err}`);
    }
    if (asset) {
      asset.group.position.set(this._position);
      if (this._nodeId) {
        asset.group.persistentId = this._nodeId;
      } else {
        this._nodeId = asset.group.persistentId;
      }
      idNodeMap[asset.group.persistentId] = asset.group;
      return asset.group;
    } else {
      this._nodeId = '';
      return null;
    }
  }
  async undo() {
    if (this._nodeId) {
      const node = idNodeMap[this._nodeId];
      if (node) {
        idNodeMap[this._nodeId] = undefined;
        node.parent = null;
      }
    }
  }
}
export class AddChildCommand<T extends SceneNode = SceneNode> extends Command<T> {
  private readonly _parentId: string;
  private readonly _position: Vector3;
  private _nodeId: string;
  private readonly _ctor: { new (scene: Scene): T };
  constructor(parentNode: SceneNode, ctor: { new (scene: Scene): T }, position?: Vector3) {
    super('Add child node');
    this._parentId = parentNode.persistentId;
    idNodeMap[this._parentId] = parentNode;
    this._nodeId = '';
    this._ctor = ctor;
    this._position = position;
  }
  async execute() {
    const parent = idNodeMap[this._parentId];
    if (!parent) {
      console.error('Add batch group failed: parent node not found');
      this._nodeId = '';
      return null;
    }
    const node = new this._ctor(parent.scene);
    node.parent = parent;
    if (this._position) {
      node.position.set(this._position);
    }
    if (this._nodeId) {
      node.persistentId = this._nodeId;
    } else {
      this._nodeId = node.persistentId;
    }
    idNodeMap[this._nodeId] = node;
    return node;
  }
  async undo() {
    if (this._nodeId) {
      const node = idNodeMap[this._nodeId];
      if (node) {
        node.remove();
        idNodeMap[this._nodeId] = undefined;
      }
    }
  }
}
export class AddParticleSystemCommand extends Command<ParticleSystem> {
  private readonly _scene: Scene;
  private _nodeId: string;
  private readonly _position: Vector3;
  constructor(scene: Scene, pos: Vector3) {
    super('Add particle system');
    this._scene = scene;
    this._nodeId = '';
    this._position = pos.clone();
  }
  async execute() {
    const node = new ParticleSystem(this._scene);
    node.position.set(this._position);
    if (this._nodeId) {
      node.persistentId = this._nodeId;
    } else {
      this._nodeId = node.persistentId;
    }
    idNodeMap[this._nodeId] = node;
    return node;
  }
  async undo() {
    if (this._nodeId) {
      const node = idNodeMap[this._nodeId];
      if (node) {
        node.remove();
        node.dispose();
        idNodeMap[this._nodeId] = undefined;
      }
    }
  }
}
export class AddShapeCommand<T extends ShapeType> extends Command<Mesh> {
  private readonly _scene: Scene;
  private _nodeId: string;
  private readonly _shapeCls: GenericConstructor<T>;
  private readonly _options: ShapeOptionType<T>;
  private readonly _position: Vector3;
  constructor(scene: Scene, shapeCls: GenericConstructor<T>, pos: Vector3, options?: ShapeOptionType<T>) {
    super();
    this._nodeId = '';
    this._scene = scene;
    this._position = pos.clone();
    switch (shapeCls as any) {
      case BoxShape: {
        this._desc = 'Add box';
        break;
      }
      case SphereShape: {
        this._desc = 'Add sphere';
        break;
      }
      case BoxFrameShape: {
        this._desc = 'Add box frame';
        break;
      }
      case PlaneShape: {
        this._desc = 'Add plane';
        break;
      }
      case CylinderShape: {
        this._desc = 'Add cylinder';
        break;
      }
      case TorusShape: {
        this._desc = 'Add torus';
        break;
      }
      default: {
        this._desc = 'Add unknown shape';
        break;
      }
    }
    this._shapeCls = shapeCls;
    this._options = options;
  }
  async execute() {
    const shape = new this._shapeCls(this._options);
    const mesh = new Mesh(this._scene, shape, new PBRMetallicRoughnessMaterial());
    mesh.position.set(this._position);
    if (this._nodeId) {
      mesh.persistentId = this._nodeId;
    } else {
      this._nodeId = mesh.persistentId;
    }
    idNodeMap[this._nodeId] = mesh;
    return mesh;
  }
  async undo() {
    if (this._nodeId) {
      const node = idNodeMap[this._nodeId];
      if (node) {
        node.remove();
        node.dispose();
        idNodeMap[this._nodeId] = undefined;
      }
    }
  }
}

export class NodeDeleteCommand extends Command {
  private readonly _scene: any;
  private _archive: any;
  private readonly _nodeId: string;
  private readonly _parentId: string;
  constructor(node: SceneNode) {
    super('Delete node');
    this._scene = node.scene;
    this._nodeId = node.persistentId;
    idNodeMap[this._nodeId] = node;
    this._parentId = node.parent.persistentId;
    idNodeMap[this._parentId] = node.parent;
    this._archive = null;
  }
  async execute(): Promise<void> {
    const node = idNodeMap[this._nodeId];
    if (node) {
      const nodeHierarchy = new NodeHierarchy(node.scene, node);
      this._archive = await ProjectService.serializationManager.serializeObject(nodeHierarchy, null, null);
      node.remove();
      node.iterate((child) => {
        delete idNodeMap[child.persistentId];
      });
      delete idNodeMap[this._nodeId];
    }
  }
  async undo() {
    if (this._archive) {
      const parent = idNodeMap[this._parentId];
      if (parent) {
        const nodeHierarchy = await ProjectService.serializationManager.deserializeObject<NodeHierarchy>(
          this._scene,
          this._archive
        );
        const node = nodeHierarchy.rootNode;
        if (node) {
          node.iterate((child) => {
            idNodeMap[child.persistentId] = child;
          });
          node.parent = parent;
        }
      }
    }
  }
}
export class NodeReparentCommand extends Command {
  private readonly _nodeId: string;
  private readonly _newParentId: string;
  private _oldParentId: string;
  private _oldLocalMatrix: Matrix4x4;
  constructor(node: SceneNode, newParent: SceneNode) {
    super('Reparent object');
    this._nodeId = node.persistentId;
    idNodeMap[this._nodeId] = node;
    this._newParentId = newParent.persistentId;
    idNodeMap[this._newParentId] = newParent;
    this._oldParentId = '';
    this._oldLocalMatrix = null;
  }
  async execute(): Promise<void> {
    const node = idNodeMap[this._nodeId];
    const newParent = idNodeMap[this._newParentId];
    if (node && newParent) {
      this._oldParentId = node.parent.persistentId;
      idNodeMap[this._oldParentId] = node.parent;
      this._oldLocalMatrix = new Matrix4x4(node.localMatrix);
      const newLocalMatrix = Matrix4x4.invertAffine(newParent.worldMatrix).multiplyRight(node.worldMatrix);
      newLocalMatrix.decompose(node.scale, node.rotation, node.position);
      node.parent = newParent;
    }
  }
  async undo() {
    const node = idNodeMap[this._nodeId];
    const oldParent = idNodeMap[this._oldParentId];
    if (node && oldParent) {
      this._oldLocalMatrix.decompose(node.scale, node.rotation, node.position);
      node.parent = oldParent;
    }
  }
}

export class NodeCloneCommand extends Command<SceneNode> {
  private readonly _nodeId: string;
  private _newNodeId: string;
  private readonly _method: NodeCloneMethod;
  constructor(node: SceneNode, method: NodeCloneMethod) {
    super('Clone node');
    this._nodeId = node.persistentId;
    idNodeMap[this._nodeId] = node;
    this._method = method;
    this._newNodeId = '';
  }
  async execute(): Promise<SceneNode> {
    const node = idNodeMap[this._nodeId];
    if (!node) {
      return null;
    }
    const that = this;
    async function cloneNode(node: SceneNode) {
      let newNode: SceneNode;
      if (!node || node.sealed) {
        return null;
      }
      const assetId = ProjectService.serializationManager.getAssetId(node);
      if (assetId) {
        newNode = (
          await ProjectService.serializationManager.fetchModel(assetId, node.scene, {
            enableInstancing: that._method === 'instance'
          })
        ).group;
        newNode.position = node.position;
        newNode.rotation = node.rotation;
        newNode.scale = node.scale;
      } else {
        newNode = node.clone(that._method, false);
      }
      const promises = node.children.map((val) => cloneNode(val.get()));
      const newChildren = await Promise.all(promises);
      for (const newChild of newChildren) {
        if (newChild) {
          newChild.parent = newNode;
        }
      }
      return newNode;
    }
    const newNode = await cloneNode(node);
    this._newNodeId = newNode.persistentId;
    idNodeMap[newNode.persistentId] = newNode;

    return newNode;
  }
  async undo() {
    if (this._newNodeId) {
      const newNode = idNodeMap[this._newNodeId];
      if (newNode) {
        newNode.parent = null;
      }
      this._newNodeId = '';
    }
  }
}
export class NodeTransformCommand extends Command {
  private readonly _nodeId: string;
  private readonly _oldTransform: TRS;
  private readonly _newTransform: TRS;
  constructor(node: SceneNode, oldTransform: TRS, newTransform: TRS, desc: string) {
    super(desc);
    this._nodeId = node.persistentId;
    idNodeMap[this._nodeId] = node;
    this._oldTransform = {
      position: new Vector3(oldTransform.position),
      rotation: new Quaternion(oldTransform.rotation),
      scale: new Vector3(oldTransform.scale)
    };
    this._newTransform = {
      position: new Vector3(newTransform.position),
      rotation: new Quaternion(newTransform.rotation),
      scale: new Vector3(newTransform.scale)
    };
    this._desc = desc;
  }
  get desc(): string {
    return this._desc;
  }
  async execute() {
    const node = idNodeMap[this._nodeId];
    if (node) {
      node.position = this._newTransform.position;
      node.rotation = this._newTransform.rotation;
      node.scale = this._newTransform.scale;
    }
  }
  async undo() {
    const node = idNodeMap[this._nodeId];
    if (node) {
      node.position = this._oldTransform.position;
      node.rotation = this._oldTransform.rotation;
      node.scale = this._oldTransform.scale;
    }
  }
}
