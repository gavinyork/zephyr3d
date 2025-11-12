import { Quaternion, Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import type { FrameBuffer, Texture2D } from '@zephyr3d/device';
import { ImGui } from '@zephyr3d/imgui';
import {
  DirectionalLight,
  getDevice,
  LambertMaterial,
  Mesh,
  PerspectiveCamera,
  Scene
} from '@zephyr3d/scene';
import { createRotationEditGizmo } from '../views/gizmo/gizmo';

export class RotationEditor {
  private static readonly _rotation: Quaternion = Quaternion.identity();
  private static _fb: FrameBuffer = null;
  private static _scene: Scene = null;
  private static _camera: PerspectiveCamera = null;
  private static _mesh: Mesh = null;
  private static _isDragging = false;
  private static _lastMousePos: ImGui.ImVec2 = null;
  private static _dirty = false;
  private static readonly _axisLength = 8;
  private static readonly _axisRadius = 0.5;
  private static readonly _arrowLength = 3;
  private static readonly _arrowRadius = 1;
  private static readonly _sphereRaidus = 8;
  private static _canvasSize: ImGui.ImVec2 = null;
  static reset(rotation: Quaternion, canvasSize: ImGui.ImVec2) {
    this._rotation.set(rotation);
    this._canvasSize = new ImGui.ImVec2(canvasSize.x, canvasSize.y);
    const device = getDevice();
    if (!this._fb || this._fb.getWidth() !== canvasSize.x || this._fb.getHeight() !== canvasSize.y) {
      if (this._fb) {
        this._fb.getColorAttachments()[0].dispose();
        this._fb.getDepthAttachment().dispose();
        this._fb.dispose();
      }
      this._fb = device.createFrameBuffer(
        [
          device.createTexture2D('rgba8unorm', canvasSize.x, canvasSize.y, {
            mipmapping: false
          })
        ],
        device.createTexture2D('d24', canvasSize.x, canvasSize.y)
      );
      this._fb.getColorAttachments()[0].name = 'EDIT ROTATION';
    }
    if (!this._scene) {
      this._scene = this._createScene();
    }
    if (!this._camera) {
      this._camera = new PerspectiveCamera(this._scene, Math.PI * 0.5, 1, 200);
      this._camera.position = new Vector3(0, 0, this._axisLength + this._arrowLength * 3);
    }
    if (!this._mesh) {
      this._mesh = this._createMesh();
    }
    if (this._camera.aspect !== canvasSize.x / canvasSize.y) {
      this._camera.aspect = canvasSize.x / canvasSize.y;
    }
    this._mesh.rotation.set(this._rotation);
    this._dirty = true;
  }
  static render() {
    if (this._canvasSize.x <= 0 || this._canvasSize.y <= 0) {
      return this._mesh.rotation;
    }
    if (this._camera.aspect !== this._canvasSize.x / this._canvasSize.y) {
      this._camera.aspect = this._canvasSize.x / this._canvasSize.y;
      this._dirty = true;
    }
    const cursorPos = ImGui.GetCursorScreenPos();
    if (this._dirty) {
      const device = getDevice();
      device.pushDeviceStates();
      device.setFramebuffer(this._fb);
      this._camera.render(this._scene);
      device.popDeviceStates();
      this._dirty = false;
    }
    ImGui.InvisibleButton('EditRotationBtn', this._canvasSize);
    const drawList = ImGui.GetWindowDrawList();
    drawList.AddImage(
      this._fb.getColorAttachments()[0] as Texture2D,
      new ImGui.ImVec2(cursorPos.x, cursorPos.y + this._canvasSize.y),
      new ImGui.ImVec2(cursorPos.x + this._canvasSize.x, cursorPos.y)
    );
    if (ImGui.IsItemActive()) {
      const mousePos = ImGui.GetMousePos();
      if (!this._isDragging) {
        this._isDragging = true;
        this._lastMousePos = mousePos;
        this._rotation.set(this._mesh.rotation);
      } else {
        const mvp = this._camera.viewProjectionMatrix;
        const clipPos = mvp.transform(new Vector4(this._sphereRaidus, 0, 0, 1));
        const radius = clipPos.xyz().scaleBy(1 / clipPos.w).magnitude;
        const sphereRadius = this._canvasSize.y * 0.5 * radius;
        const center = new Vector2(
          cursorPos.x + this._canvasSize.x * 0.5,
          cursorPos.y + this._canvasSize.y * 0.5
        );
        const va = this._projectToSphere(
          new Vector2(this._lastMousePos.x, this._lastMousePos.y),
          center,
          sphereRadius
        );
        const vb = this._projectToSphere(new Vector2(mousePos.x, mousePos.y), center, sphereRadius);
        const dot = Math.min(Math.max(Vector3.dot(va, vb), -1), 1);
        const angle = Math.acos(dot);
        const axis = Vector3.cross(va, vb);
        if (axis.magnitude > 0.0001) {
          const quat = Quaternion.fromAxisAngle(axis.inplaceNormalize(), angle);
          const newRotation = Quaternion.multiply(quat, this._rotation);
          this._mesh.rotation.set(newRotation);
          this._dirty = true;
        }
      }
    } else {
      this._isDragging = false;
    }
    return this._mesh.rotation;
  }
  private static _createScene() {
    const scene = new Scene();
    const light = new DirectionalLight(scene);
    light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());
    scene.env.sky.skyType = 'image';
    scene.env.sky.skyColor = new Vector4(0, 0.5, 0.5, 1);
    scene.env.sky.fogType = 'none';
    scene.env.light.type = 'constant';
    scene.env.light.ambientColor = new Vector4(0.3, 0.3, 0.3, 1);
    return scene;
  }
  private static _createMesh() {
    const primitive = createRotationEditGizmo(
      this._axisLength,
      this._axisRadius,
      this._arrowLength,
      this._arrowRadius,
      this._sphereRaidus
    );
    const material = new LambertMaterial();
    material.vertexColor = true;
    const mesh = new Mesh(this._scene, primitive, material);
    mesh.rotation.set(this._rotation);
    return mesh;
  }
  private static _projectToSphere(screenPos: Vector2, center: Vector2, radius: number) {
    const p = new Vector2((screenPos.x - center.x) / radius, (center.y - screenPos.y) / radius);
    const d = p.magnitude;
    const v = new Vector3();
    if (d > 1) {
      v.setXYZ(p.x / d, p.y / d, 0);
    } else {
      const z = Math.sqrt(1 - d * d);
      v.setXYZ(p.x, p.y, z);
    }
    return v.inplaceNormalize();
  }
}
