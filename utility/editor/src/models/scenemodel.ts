import { DirectionalLight, PerspectiveCamera, Scene } from '@zephyr3d/scene';
import { BaseModel } from './basemodel';
import { Vector3 } from '@zephyr3d/base';
import { EditorCameraController } from '../helpers/editorcontroller';

export class SceneModel extends BaseModel {
  private _scene: Scene;
  constructor() {
    super();
    this._scene = null;
  }
  get scene() {
    return this._scene;
  }
  reset(scene?: Scene) {
    this._scene?.dispose();
    this._scene = scene ?? new Scene();
    if (!scene) {
      this._scene.env.sky.fogType = 'height_fog';
      const light = new DirectionalLight(this._scene);
      light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());
    }
    if (!this._scene.mainCamera) {
      const defaultCamera = new PerspectiveCamera(this._scene, Math.PI / 3, 1, 1000);
      defaultCamera.lookAt(new Vector3(0, 8, 18), new Vector3(0, 0, 0), new Vector3(0, 1, 0));
      this._scene.mainCamera = defaultCamera;
    }
    this._scene.mainCamera.controller = new EditorCameraController();
  }
}
