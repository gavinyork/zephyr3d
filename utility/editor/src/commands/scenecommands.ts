import type { Scene, SceneNode, ShapeOptionType, ShapeType } from '@zephyr3d/scene';
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
import { AssetStore } from '../helpers/assetstore';
import type { DBAssetInfo } from '../storage/db';

export class AddAssetCommand implements Command {
  private _scene: Scene;
  private _asset: DBAssetInfo;
  private _node: SceneNode;
  private _position: Vector3;
  private _loading: boolean;
  constructor(scene: Scene, asset: DBAssetInfo, position: Vector3) {
    this._scene = scene;
    this._node = null;
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
      AssetStore.fetchModel(this._scene, this._asset.uuid, { enableInstancing: true })
        .then((asset) => {
          if (!this._loading) {
            AssetStore.release(asset.group);
          } else {
            asset.group.position.set(this._position);
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
      this._node.parent = null;
      AssetStore.release(this._node);
      this._node = null;
    }
  }
}

export class AddShapeCommand<T extends ShapeType> implements Command {
  private _mesh: Mesh;
  private _desc: string;
  private _scene: Scene;
  private _poolId: symbol;
  private _shapeCls: GenericConstructor<T>;
  private _options: ShapeOptionType<T>;
  constructor(scene: Scene, shapeCls: GenericConstructor<T>, options?: ShapeOptionType<T>, poolId?: symbol) {
    this._mesh = null;
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
  }
  undo() {
    Application.instance.device.getPool(this._poolId).disposeNonCachedObjects();
    this._mesh.parent = null;
    this._mesh = null;
  }
}

export class NodeTransformCommand implements Command {
  private _node: SceneNode;
  private _oldTransform: TRS;
  private _newTransform: TRS;
  constructor(node: SceneNode, oldTransform: TRS, newTransform: TRS) {
    this._node = node;
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
  }
  get desc(): string {
    return 'Node transform';
  }
  execute() {
    this._node.position = this._newTransform.position;
    this._node.rotation = this._newTransform.rotation;
    this._node.scale = this._newTransform.scale;
  }
  undo() {
    this._node.position = this._oldTransform.position;
    this._node.rotation = this._oldTransform.rotation;
    this._node.scale = this._oldTransform.scale;
  }
}
