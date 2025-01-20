import type { AssetRegistry, ModelInfo, Scene, SceneNode, ShapeOptionType, ShapeType } from '@zephyr3d/scene';
import { ParticleSystem } from '@zephyr3d/scene';
import {
  Application,
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
import { Quaternion, Vector3, type GenericConstructor } from '@zephyr3d/base';
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
      console.error(`Load asset failed: ${this._asset.name}`);
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

export class AddParticleSystemCommand implements Command<ParticleSystem> {
  private _scene: Scene;
  private _poolId: symbol;
  private _nodeId: string;
  constructor(scene: Scene, poolId?: symbol) {
    this._scene = scene;
    this._nodeId = '';
    this._poolId = poolId;
  }
  get desc(): string {
    return 'Add particle system';
  }
  async execute() {
    const node = new ParticleSystem(this._scene, this._poolId);
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
        idNodeMap[this._nodeId] = undefined;
        Application.instance.device.getPool(this._poolId).disposeNonCachedObjects();
        node.parent = null;
      }
    }
  }
}
export class AddShapeCommand<T extends ShapeType> implements Command<Mesh> {
  private _desc: string;
  private _scene: Scene;
  private _nodeId: string;
  private _poolId: symbol;
  private _shapeCls: GenericConstructor<T>;
  private _options: ShapeOptionType<T>;
  constructor(scene: Scene, shapeCls: GenericConstructor<T>, options?: ShapeOptionType<T>, poolId?: symbol) {
    this._nodeId = '';
    this._poolId = poolId;
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
    const shape = new this._shapeCls(this._options, this._poolId);
    const mesh = new Mesh(this._scene, shape, new PBRMetallicRoughnessMaterial(this._poolId));
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
        idNodeMap[this._nodeId] = undefined;
        Application.instance.device.getPool(this._poolId).disposeNonCachedObjects();
        node.parent = null;
      }
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
