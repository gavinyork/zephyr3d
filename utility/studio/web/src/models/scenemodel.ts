import { Scene } from '@zephyr3d/scene';

export class SceneModel {
  private _scene: Scene;
  constructor() {
    this._scene = new Scene();
  }
  get scene() {
    return this._scene;
  }
}
