import { Mesh, PBRMetallicRoughnessMaterial, Scene, ShapeOptionType, ShapeType } from '@zephyr3d/scene';
import { Command } from '../core/command';
import { GenericConstructor } from '@zephyr3d/base';

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
