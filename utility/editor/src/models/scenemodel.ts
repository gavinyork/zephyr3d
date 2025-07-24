import type { Camera } from '@zephyr3d/scene';
import { DirectionalLight, OrbitCameraController, PerspectiveCamera, Scene } from '@zephyr3d/scene';
import { BaseModel } from './basemodel';
import { Vector3 } from '@zephyr3d/base';
import type { Editor } from '../core/editor';

export class SceneModel extends BaseModel {
  private _editor: Editor;
  private _scene: Scene;
  private _camera: Camera;
  constructor(editor: Editor) {
    super();
    this._editor = editor;
    this._scene = null;
    this._camera = null;
    this.reset();
  }
  get editor() {
    return this._editor;
  }
  get scene() {
    return this._scene;
  }
  set camera(camera: Camera) {
    this._camera = camera;
  }
  get camera() {
    return this._camera;
  }
  reset(scene?: Scene, activeCameraId?: string, cameraLookAt?: number[]) {
    this._scene?.dispose();
    this._scene = scene ?? new Scene();
    this._camera = null;
    if (!scene) {
      const light = new DirectionalLight(this._scene);
      light.intensity = 18;
      light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());
      this._camera = new PerspectiveCamera(this._scene, Math.PI / 3, 1, 1, 1000);
      this._camera.lookAt(new Vector3(0, 80, 80), new Vector3(0, 0, 0), new Vector3(0, 1, 0));
    } else {
      this._scene.rootNode.iterate((child) => {
        if (child instanceof PerspectiveCamera) {
          if (!activeCameraId || child.persistentId === activeCameraId) {
            this._camera = child;
            return true;
          }
        }
      });
    }
    this._camera.controller = new OrbitCameraController({
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
