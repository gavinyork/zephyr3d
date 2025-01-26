import type { AssetRegistry, ModelInfo, Scene, SceneNode, ShapeOptionType, ShapeType } from '@zephyr3d/scene';
import { BatchGroup, deserializeObject } from '@zephyr3d/scene';
import { ParticleSystem, serializeObject } from '@zephyr3d/scene';
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
import type { Command } from '../core/command';
import { Matrix4x4, Quaternion, Vector3, type GenericConstructor } from '@zephyr3d/base';
import type { TRS } from '../types';
import type { DBAssetInfo } from '../storage/db';

const idNodeMap: Record<string, SceneNode> = {};

export type CommandExecuteResult<T> = T extends AddAssetCommand ? SceneNode : void;

export class AddAssetCommand implements Command<SceneNode> {
  private _scene: Scene;
  private _assetRegistry: AssetRegistry;
  private _asset: DBAssetInfo;
  private _nodeId: string;
  private _position: Vector3;
  constructor(scene: Scene, assetRegistry: AssetRegistry, asset: DBAssetInfo, position: Vector3) {
    this._scene = scene;
    this._assetRegistry = assetRegistry;
    this._nodeId = '';
    this._asset = { ...asset };
    this._position = new Vector3(position);
  }
  get desc(): string {
    return 'Add asset';
  }
  async execute() {
    let asset: ModelInfo = null;
    try {
      asset = await this._assetRegistry.fetchModel(this._asset.uuid, this._scene, {
        enableInstancing: true
      });
    } catch (err) {
      console.error(`Load asset failed: ${this._asset.name}: ${err}`);
    }
    if (asset) {
      asset.group.position.set(this._position);
      if (this._nodeId) {
        asset.group.id = this._nodeId;
      } else {
        this._nodeId = asset.group.id;
      }
      idNodeMap[asset.group.id] = asset.group;
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
        this._assetRegistry.releaseAsset(node);
      }
    }
  }
}
export class AddBatchGroupCommand implements Command<BatchGroup> {
  private _scene: Scene;
  private _nodeId: string;
  constructor(scene: Scene) {
    this._scene = scene;
    this._nodeId = '';
  }
  get desc(): string {
    return 'Add particle system';
  }
  async execute() {
    const node = new BatchGroup(this._scene);
    if (this._nodeId) {
      node.id = this._nodeId;
    } else {
      this._nodeId = node.id;
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
export class AddParticleSystemCommand implements Command<ParticleSystem> {
  private _scene: Scene;
  private _nodeId: string;
  constructor(scene: Scene) {
    this._scene = scene;
    this._nodeId = '';
  }
  get desc(): string {
    return 'Add particle system';
  }
  async execute() {
    const node = new ParticleSystem(this._scene);
    if (this._nodeId) {
      node.id = this._nodeId;
    } else {
      this._nodeId = node.id;
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
export class AddShapeCommand<T extends ShapeType> implements Command<Mesh> {
  private _desc: string;
  private _scene: Scene;
  private _nodeId: string;
  private _shapeCls: GenericConstructor<T>;
  private _options: ShapeOptionType<T>;
  constructor(scene: Scene, shapeCls: GenericConstructor<T>, options?: ShapeOptionType<T>) {
    this._nodeId = '';
    this._scene = scene;
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
  get desc(): string {
    return this._desc;
  }
  async execute() {
    const shape = new this._shapeCls(this._options);
    const mesh = new Mesh(this._scene, shape, new PBRMetallicRoughnessMaterial());
    if (this._nodeId) {
      mesh.id = this._nodeId;
    } else {
      this._nodeId = mesh.id;
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

export class NodeDeleteCommand implements Command {
  private _assetRegistry: AssetRegistry;
  private _scene: any;
  private _archive: any;
  private _nodeId: string;
  private _parentId: string;
  constructor(node: SceneNode, assetRegistry: AssetRegistry) {
    this._scene = node.scene;
    this._assetRegistry = assetRegistry;
    this._nodeId = node.id;
    idNodeMap[this._nodeId] = node;
    this._parentId = node.parent.id;
    idNodeMap[this._parentId] = node.parent;
    this._archive = null;
  }
  get desc() {
    return 'Delete node';
  }
  async execute(): Promise<void> {
    const node = idNodeMap[this._nodeId];
    if (node) {
      this._archive = await serializeObject(node, this._assetRegistry);
      node.remove();
      node.iterate((child) => {
        delete idNodeMap[child.id];
      });
      delete idNodeMap[this._nodeId];
    }
  }
  async undo() {
    if (this._archive) {
      const parent = idNodeMap[this._parentId];
      if (parent) {
        const node = (await deserializeObject(this._scene, this._archive, this._assetRegistry)) as SceneNode;
        if (node) {
          node.iterate((child) => {
            idNodeMap[child.id] = child;
          });
          node.parent = parent;
        }
      }
    }
  }
}
export class NodeReparentCommand implements Command {
  private _nodeId: string;
  private _newParentId: string;
  private _oldParentId: string;
  private _oldLocalMatrix: Matrix4x4;
  constructor(node: SceneNode, newParent: SceneNode) {
    this._nodeId = node.id;
    idNodeMap[this._nodeId] = node;
    this._newParentId = newParent.id;
    idNodeMap[this._newParentId] = newParent;
    this._oldParentId = '';
    this._oldLocalMatrix = null;
  }
  get desc() {
    return 'reparent object';
  }
  async execute(): Promise<void> {
    const node = idNodeMap[this._nodeId];
    const newParent = idNodeMap[this._newParentId];
    if (node && newParent) {
      this._oldParentId = node.parent.id;
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
export class NodeTransformCommand implements Command {
  private _nodeId: string;
  private _desc: string;
  private _oldTransform: TRS;
  private _newTransform: TRS;
  constructor(node: SceneNode, oldTransform: TRS, newTransform: TRS, desc: string) {
    this._nodeId = node.id;
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
