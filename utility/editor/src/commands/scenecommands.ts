import type { AssetRegistry, Scene, SceneNode, ShapeOptionType, ShapeType } from '@zephyr3d/scene';
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

export class AddAssetCommand implements Command {
  private _scene: Scene;
  private _assetRegistry: AssetRegistry;
  private _asset: DBAssetInfo;
  private _node: SceneNode;
  private _nodeId: string;
  private _position: Vector3;
  private _loading: boolean;
  constructor(scene: Scene, assetRegistry: AssetRegistry, asset: DBAssetInfo, position: Vector3) {
    this._scene = scene;
    this._assetRegistry = assetRegistry;
    this._node = null;
    this._nodeId = '';
    this._asset = { ...asset };
    this._position = new Vector3(position);
    this._loading = false;
  }
  get desc(): string {
    return 'Add asset';
  }
  execute() {
    if (!this._loading) {
      this._loading = true;
      this._assetRegistry
        .fetchModel(this._asset.uuid, this._scene, { enableInstancing: true })
        .then((asset) => {
          if (!this._loading) {
            this._assetRegistry.releaseAsset(asset.group);
          } else {
            asset.group.position.set(this._position);
            if (this._nodeId) {
              asset.group.id = this._nodeId;
            } else {
              this._nodeId = asset.group.id;
            }
            idNodeMap[asset.group.id] = asset.group;
            this._loading = false;
            this._node = asset.group;
          }
        })
        .catch(() => {
          this._loading = false;
        });
    }
  }
  undo() {
    this._loading = false;
    if (this._node) {
      idNodeMap[this._node.id] = undefined;
      this._node.parent = null;
      this._assetRegistry.releaseAsset(this._node);
      this._node = null;
    }
  }
}

export class AddParticleSystemCommand implements Command {
  private _scene: Scene;
  private _poolId: symbol;
  private _node: ParticleSystem;
  private _nodeId: string;
  constructor(scene: Scene, poolId?: symbol) {
    this._scene = scene;
    this._node = null;
    this._nodeId = '';
    this._poolId = poolId;
  }
  get desc(): string {
    return 'Add particle system';
  }
  execute(): void {
    this._node = new ParticleSystem(this._scene);
    if (this._nodeId) {
      this._node.id = this._nodeId;
    } else {
      this._nodeId = this._node.id;
    }
    idNodeMap[this._node.id] = this._node;
  }
  undo(): void {
    Application.instance.device.getPool(this._poolId).disposeNonCachedObjects();
    idNodeMap[this._node.id] = undefined;
    this._node.parent = null;
    this._node = null;
  }
}
export class AddShapeCommand<T extends ShapeType> implements Command {
  private _mesh: Mesh;
  private _desc: string;
  private _scene: Scene;
  private _nodeId: string;
  private _poolId: symbol;
  private _shapeCls: GenericConstructor<T>;
  private _options: ShapeOptionType<T>;
  constructor(scene: Scene, shapeCls: GenericConstructor<T>, options?: ShapeOptionType<T>, poolId?: symbol) {
    this._mesh = null;
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
  execute() {
    const shape = new this._shapeCls(this._options, this._poolId);
    this._mesh = new Mesh(this._scene, shape, new PBRMetallicRoughnessMaterial(this._poolId));
    if (this._nodeId) {
      this._mesh.id = this._nodeId;
    } else {
      this._nodeId = this._mesh.id;
    }
    idNodeMap[this._mesh.id] = this._mesh;
  }
  undo() {
    Application.instance.device.getPool(this._poolId).disposeNonCachedObjects();
    idNodeMap[this._mesh.id] = undefined;
    this._mesh.parent = null;
    this._mesh = null;
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
  execute() {
    const node = idNodeMap[this._nodeId];
    if (node) {
      node.position = this._newTransform.position;
      node.rotation = this._newTransform.rotation;
      node.scale = this._newTransform.scale;
    }
  }
  undo() {
    const node = idNodeMap[this._nodeId];
    if (node) {
      node.position = this._oldTransform.position;
      node.rotation = this._oldTransform.rotation;
      node.scale = this._oldTransform.scale;
    }
  }
}
