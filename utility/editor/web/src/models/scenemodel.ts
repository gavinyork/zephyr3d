import { Scene } from '@zephyr3d/scene';
import { BaseModel } from './basemodel';

export class SceneModel extends BaseModel {
  private _scene: Scene;
  constructor() {
    super();
    this._scene = new Scene();
  }
  get scene() {
    return this._scene;
  }
}
