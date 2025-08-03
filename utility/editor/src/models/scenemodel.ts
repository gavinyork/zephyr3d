import type { Camera } from '@zephyr3d/scene';
import { DRef } from '@zephyr3d/scene';
import { DirectionalLight, OrbitCameraController, PerspectiveCamera, Scene } from '@zephyr3d/scene';
import { BaseModel } from './basemodel';
import { Vector3 } from '@zephyr3d/base';
import type { Editor } from '../core/editor';

export class SceneModel extends BaseModel {
  private readonly _editor: Editor;
  private _scene: Scene;
  private readonly _editorCamera: DRef<Camera>;
  constructor(editor: Editor) {
    super();
    this._editor = editor;
    this._scene = null;
    this._editorCamera = new DRef();
    this._scene = null;
  }
  get editor() {
    return this._editor;
  }
  get scene() {
    return this._scene;
  }
  get camera() {
    return this._editorCamera.get();
  }
  reset(scene?: Scene, cameraLookAt?: number[]) {
    this._editorCamera.get()?.remove();
    this._editorCamera.dispose();
    this._scene?.dispose();
    this._scene = scene ?? new Scene();
    if (!scene) {
      this._scene.env.sky.fogType = 'height_fog';
      const light = new DirectionalLight(this._scene);
      light.intensity = 18;
      light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());
    }
    this._editorCamera.set(new PerspectiveCamera(this._scene, Math.PI / 3, 1, 1, 1000));
    this._editorCamera.get().lookAt(new Vector3(0, 80, 180), new Vector3(0, 0, 0), new Vector3(0, 1, 0));
    this._editorCamera.get().controller = new OrbitCameraController({
      damping: 1,
      center: cameraLookAt ? new Vector3(cameraLookAt[0], cameraLookAt[1], cameraLookAt[2]) : Vector3.zero(),
      controls: {
        rotate: {
          button: 1,
          shiftKey: false,
          altKey: false,
          ctrlKey: false,
          metaKey: false
        },
        zoom: {
          button: 1,
          shiftKey: false,
          altKey: false,
          ctrlKey: true,
          metaKey: false
        },
        pan: {
          button: 1,
          shiftKey: true,
          altKey: false,
          ctrlKey: false,
          metaKey: false
        },
        zoomWheel: true
      }
    });
  }
}
