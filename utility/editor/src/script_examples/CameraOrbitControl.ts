import { Vector3 } from '@zephyr3d/base';
import type { BaseCameraController, Camera, SceneNode } from '@zephyr3d/scene';
import { OrbitCameraController, RuntimeScript, getApp, getInput } from '@zephyr3d/scene';

export default class extends RuntimeScript<SceneNode> {
  private _camera: Camera | null = null;
  private _controller: OrbitCameraController | null = null;
  private _previousController: BaseCameraController | null = null;
  private readonly _onContextMenu = (evt: Event) => {
    evt.preventDefault();
  };
  private readonly _handleClick = async (evt: PointerEvent) => {
    if (!this._camera || !this._controller || this._camera.controller !== this._controller || evt.button !== 0) {
      return;
    }
    const result = await this._camera.pickAsync(evt.offsetX, evt.offsetY);
    const node = result?.target?.node ?? null;
    if (!node) {
      return;
    }
    const worldCenter = this._getNodeCenter(node);
    const eye = this._camera.getWorldPosition();
    const worldUpPoint = this._camera.thisToWorld(new Vector3(0, 1, 0), new Vector3()) as Vector3;
    const up = Vector3.sub(worldUpPoint, eye, new Vector3()).inplaceNormalize();
    this._controller.lookAt(eye, worldCenter, up);
  };

  onAttached(host: SceneNode) {
    if (!host.isCamera()) {
      console.warn('[CameraOrbitControl] This script must be attached to a camera node.');
      return;
    }
    this._camera = host;
    this._previousController = this._camera.controller;

    const eye = this._camera.getWorldPosition();
    const worldForwardPoint = this._camera.thisToWorld(new Vector3(0, 0, -1), new Vector3()) as Vector3;
    const worldUpPoint = this._camera.thisToWorld(new Vector3(0, 1, 0), new Vector3()) as Vector3;
    const forward = Vector3.sub(worldForwardPoint, eye, new Vector3()).inplaceNormalize();
    const up = Vector3.sub(worldUpPoint, eye, new Vector3()).inplaceNormalize();
    const center = Vector3.add(eye, Vector3.scale(forward, 5, new Vector3()), new Vector3());

    this._controller = new OrbitCameraController({
      center,
      rotateSpeed: 1,
      zoomSpeed: 1,
      panSpeed: 0.02,
      damping: 1,
      controls: {
        rotate: {
          button: 2,
          shiftKey: false,
          ctrlKey: false,
          altKey: false,
          metaKey: false
        },
        pan: {
          button: 0,
          shiftKey: false,
          ctrlKey: false,
          altKey: false,
          metaKey: false
        },
        zoom: {
          button: 1,
          shiftKey: false,
          ctrlKey: false,
          altKey: false,
          metaKey: false
        },
        zoomWheel: true
      }
    });

    this._camera.controller = this._controller;
    // Keep the authored initial camera transform (position + orientation) on startup.
    this._controller.lookAt(eye, center, up);
    getInput().use(this._camera.handleEvent, this._camera);
    getApp().on('click', this._handleClick, this);
    window.addEventListener('contextmenu', this._onContextMenu);
  }

  onDetached() {
    window.removeEventListener('contextmenu', this._onContextMenu);
    getApp().off('click', this._handleClick, this);
    if (this._camera) {
      getInput().unuse(this._camera.handleEvent, this._camera);
      if (this._camera.controller === this._controller) {
        this._camera.controller = this._previousController;
      }
    }
    this._camera = null;
    this._controller = null;
    this._previousController = null;
  }

  private _getNodeCenter(node: SceneNode) {
    const bv = node.getWorldBoundingVolume?.();
    const aabb = bv?.toAABB?.();
    return aabb?.isValid?.() ? aabb.center : node.getWorldPosition();
  }
}
