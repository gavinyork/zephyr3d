import type { Scene, SceneNode, ShapeOptionType, ShapeType } from '@zephyr3d/scene';
import { Mesh, PBRMetallicRoughnessMaterial } from '@zephyr3d/scene';
import type { Command } from '../core/command';
import type { GenericConstructor } from '@zephyr3d/base';
import type { TRS } from '../types';

export class AddShapeCommand<T extends ShapeType> implements Command {
  private _mesh: Mesh;
  private _desc: string;
  private _scene: Scene;
  constructor(scene: Scene, shapeCls: GenericConstructor<T>, options?: ShapeOptionType<T>) {
    const shape = new shapeCls(options);
    this._mesh = new Mesh(null, shape, new PBRMetallicRoughnessMaterial());
    this._scene = scene;
    this._desc = `Add ${shape.type}`;
  }
  get desc(): string {
    return this._desc;
  }
  execute() {
    this._mesh.parent = this._scene.rootNode;
  }
  undo() {
    this._mesh.parent = null;
    this._mesh.primitive.dispose();
    this._mesh.dispose();
  }
}

export class NodeTransformCommand implements Command {
  constructor(private node: SceneNode, private oldTransform: TRS, private newTransform: TRS) {}
  get desc(): string {
    return 'Node transform';
  }
  execute() {
    this.node.position = this.newTransform.position;
    this.node.rotation = this.newTransform.rotation;
    this.node.scale = this.newTransform.scale;
  }
  undo() {
    this.node.position = this.oldTransform.position;
    this.node.rotation = this.oldTransform.rotation;
    this.node.scale = this.oldTransform.scale;
  }
}
