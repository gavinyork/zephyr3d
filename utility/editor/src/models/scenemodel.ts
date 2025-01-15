import {
  Compositor,
  DirectionalLight,
  OrbitCameraController,
  PerspectiveCamera,
  Scene,
  Tonemap
} from '@zephyr3d/scene';
import { BaseModel } from './basemodel';
import { Vector3 } from '@zephyr3d/base';

export class SceneModel extends BaseModel {
  private _scene: Scene;
  private _camera: PerspectiveCamera;
  private _compositor: Compositor;
  constructor() {
    super();
    this._scene = null;
    this._camera = null;
    this._compositor = null;
    this.reset();
  }
  get scene() {
    return this._scene;
  }
  get compositor() {
    return this._compositor;
  }
  set camera(camera: PerspectiveCamera) {
    this._camera = camera;
  }
  get camera() {
    return this._camera;
  }
  reset(scene?: Scene, activeCameraId?: string) {
    this._scene?.dispose();
    this._scene = scene ?? new Scene();
    this._camera = null;
    this._compositor = null;
    if (!scene) {
      const light = new DirectionalLight(this._scene);
      light.intensity = 8;
      light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());
      this._camera = new PerspectiveCamera(this._scene, Math.PI / 3, 1, 1, 1000);
      this._camera.lookAt(new Vector3(0, 5, 15), new Vector3(0, 0, 0), new Vector3(0, 1, 0));
    } else {
      this._scene.rootNode.iterate((child) => {
        if (child instanceof PerspectiveCamera) {
          if (!activeCameraId || child.id === activeCameraId) {
            this._camera = child;
            return true;
          }
        }
      });
    }
    this._camera.controller = new OrbitCameraController({
      center: Vector3.zero(),
      damping: 1,
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
    this._compositor = new Compositor();
    this._compositor.appendPostEffect(new Tonemap());
  }
}
