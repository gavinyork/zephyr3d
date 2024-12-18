import type { Scene, SceneNode, ShapeOptionType, ShapeType } from '@zephyr3d/scene';
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
import { Quaternion, Vector3, type GenericConstructor } from '@zephyr3d/base';
import type { TRS } from '../types';

export class AddShapeCommand<T extends ShapeType> implements Command {
  private _mesh: Mesh;
  private _desc: string;
  private _scene: Scene;
  private _shapeCls: GenericConstructor<T>;
  private _options: ShapeOptionType<T>;
  constructor(scene: Scene, shapeCls: GenericConstructor<T>, options?: ShapeOptionType<T>) {
    this._mesh = null;
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
    const shape = new this._shapeCls(this._options);
    this._mesh = new Mesh(this._scene, shape, new PBRMetallicRoughnessMaterial());
  }
  undo() {
    this._mesh.parent = null;
    this._mesh.primitive?.dispose();
    this._mesh.dispose();
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
