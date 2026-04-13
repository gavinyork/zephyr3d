import type { Nullable } from '@zephyr3d/base';
import { AABB, DRef, Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import type { FrameBuffer, Texture2D } from '@zephyr3d/device';
import { ImGui } from '@zephyr3d/imgui';
import type {
  IControllerPointerDownEvent,
  IControllerPointerMoveEvent,
  IControllerPointerUpEvent,
  IControllerWheelEvent,
  SceneNode
} from '@zephyr3d/scene';
import { BatchGroup, CopyBlitter, TetrahedronShape } from '@zephyr3d/scene';
import { getDevice } from '@zephyr3d/scene';
import {
  DirectionalLight,
  LambertMaterial,
  Mesh,
  OrbitCameraController,
  PerspectiveCamera,
  Scene,
  SphereShape
} from '@zephyr3d/scene';
import type { AssetHierarchyNode, AssetSkeleton } from '../loaders/model';

let wasDragging = false;

export class SkeletonView {
  private _framebuffer: DRef<FrameBuffer>;
  private _previewTex: DRef<Texture2D>;
  private _scene: DRef<Scene>;
  private _blitter: CopyBlitter;
  private _skeleton: Nullable<AssetSkeleton>;
  private _skeletonRoot: Nullable<AssetHierarchyNode>;
  constructor() {
    this._framebuffer = new DRef();
    this._previewTex = new DRef();
    this._blitter = new CopyBlitter();
    this._blitter.srgbOut = true;
    this._scene = new DRef();
    this._skeleton = null;
    this._skeletonRoot = null;
  }
  dispose() {
    this._framebuffer.dispose();
    this._scene.dispose();
    this._skeleton = null;
    this._skeletonRoot = null;
  }
  get skeleton() {
    return this._skeleton;
  }
  set skeleton(sk: AssetSkeleton) {
    if (sk !== this._skeleton) {
      this._skeleton = sk;
      this._skeletonRoot = this._skeleton.root;
      this.createScene();
    }
  }
  render(size: ImGui.ImVec2) {
    if (size.x <= 0 || size.y <= 0) {
      return;
    }
    const device = getDevice();
    if (
      this._framebuffer.get() &&
      (this._framebuffer.get()!.getWidth() !== size.x || this._framebuffer.get()!.getHeight() !== size.y)
    ) {
      this._framebuffer.get()!.getColorAttachment(0).dispose();
      this._framebuffer.get()!.getDepthAttachment()!.dispose();
      this._framebuffer.dispose();
      this._previewTex.dispose();
    }
    if (!this._framebuffer.get()) {
      const tex = device.createTexture2D('rgba16f', size.x, size.y, {
        mipmapping: false
      })!;
      const depth = device.createTexture2D('d24s8', size.x, size.y)!;
      this._framebuffer.set(device.createFrameBuffer([tex], depth));
      const previewTex = device.createTexture2D('rgba8unorm', size.x, size.y, { mipmapping: false });
      this._previewTex.set(previewTex);
    }
    device.pushDeviceStates();
    device.setFramebuffer(this._framebuffer.get());
    this._scene.get()!.render();
    this._blitter.blit(this._framebuffer.get()!.getColorAttachment(0), this._previewTex.get());
    device.popDeviceStates();

    const camera = this._scene.get()!.mainCamera!;
    const cursorScreenPos = ImGui.GetCursorScreenPos();
    camera.interactionRect = [
      cursorScreenPos.x,
      cursorScreenPos.y,
      size.x < 0 ? 0 : size.x,
      size.y < 0 ? 0 : size.y
    ];
    const cursorPos = ImGui.GetCursorPos();
    ImGui.Image(this._previewTex.get(), size, new ImGui.ImVec2(0, 1), new ImGui.ImVec2(1, 0));
    ImGui.SetCursorPos(cursorPos);
    ImGui.InvisibleButton('Button##previewScene', size);
    const io = ImGui.GetIO();
    if (ImGui.IsItemHovered()) {
      const x = io.MousePos.x - cursorScreenPos.x;
      const y = io.MousePos.y - cursorScreenPos.y;
      const ray = this._scene.get().mainCamera!.constructRay(x, y, size.x, size.y);
      const pickResult = this._scene.get()!.raycast(ray);
      if (pickResult?.target?.node) {
        console.log(pickResult.target.node.name);
      }
    }
    if (ImGui.IsItemHovered() && io.MouseWheel !== 0) {
      const evtWheel: IControllerWheelEvent = {
        type: 'wheel',
        offsetX: io.MousePos.x,
        offsetY: io.MousePos.y,
        ctrlKey: io.KeyCtrl,
        shiftKey: io.KeyShift,
        altKey: io.KeyAlt,
        metaKey: io.KeySuper,
        deltaX: 0,
        deltaY: -io.MouseWheel * 100,
        deltaMode: 0,
        button: 1
      };
      this._scene.get()?.mainCamera?.handleEvent(evtWheel);
    }
    if (ImGui.IsItemActive()) {
      if (ImGui.IsMouseClicked(ImGui.MouseButton.Left)) {
        const evtPointerDown: IControllerPointerDownEvent = {
          type: 'pointerdown',
          offsetX: io.MousePos.x,
          offsetY: io.MousePos.y,
          ctrlKey: io.KeyCtrl,
          shiftKey: io.KeyShift,
          altKey: io.KeyAlt,
          metaKey: io.KeySuper,
          button: 0
        };
        this._scene.get()?.mainCamera?.handleEvent(evtPointerDown);
        wasDragging = true;
      } else if (io.MouseDelta.x !== 0 || io.MouseDelta.y !== 0) {
        const evtPointerMove: IControllerPointerMoveEvent = {
          type: 'pointermove',
          offsetX: io.MousePos.x,
          offsetY: io.MousePos.y,
          ctrlKey: io.KeyCtrl,
          shiftKey: io.KeyShift,
          altKey: io.KeyAlt,
          metaKey: io.KeySuper,
          button: 0
        };
        this._scene.get()?.mainCamera?.handleEvent(evtPointerMove);
      }
    } else if (wasDragging) {
      // 鼠标释放时触发
      const evtPointerUp: IControllerPointerUpEvent = {
        type: 'pointerup',
        offsetX: io.MousePos.x,
        offsetY: io.MousePos.y,
        ctrlKey: io.KeyCtrl,
        shiftKey: io.KeyShift,
        altKey: io.KeyAlt,
        metaKey: io.KeySuper,
        button: 0
      };
      this._scene.get()?.mainCamera?.handleEvent(evtPointerUp);
      wasDragging = false;
    }
    camera.updateController();
  }
  private createScene() {
    this._scene.dispose();
    const scene = new Scene();
    scene.env.light.type = 'constant';
    scene.env.light.ambientColor = new Vector4(0.3, 0.3, 0.3, 1);
    scene.env.sky.skyType = 'image';
    scene.env.sky.skyColor = new Vector4(0.05, 0.05, 0.05, 1);
    scene.env.sky.fogType = 'none';
    const camera = new PerspectiveCamera(scene);
    camera.fovY = Math.PI / 3;
    camera.FXAA = true;
    camera.controller = new OrbitCameraController();
    const light = new DirectionalLight(scene);
    light.intensity = 10;
    light.sunLight = true;
    light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());
    const matJoint = new LambertMaterial();
    matJoint.albedoColor = new Vector4(0.8, 0.2, 0.2, 1);
    const matBone = new LambertMaterial();
    if (this._skeleton && this._skeletonRoot) {
      const aabb = this.calculateBoundingBox();
      const extents = aabb.extents;
      const size = Math.max(extents.x, extents.y, extents.z);
      const parent = new BatchGroup(scene);
      this.createBonePrimitive(scene, size, this._skeleton, this._skeletonRoot, parent, matJoint, matBone);
      this.lookAt(aabb, camera, parent);
    }
    this._scene.set(scene);
  }
  private lookAt(bbox: AABB, camera: PerspectiveCamera, parent: SceneNode) {
    const minSize = 10;
    const maxSize = 100;
    if (bbox) {
      const center = bbox.center;
      const extents = bbox.extents;
      let size = Math.max(extents.x, extents.y);
      if (size < minSize || size > maxSize) {
        const scale = size < minSize ? minSize / size : maxSize / size;
        parent.scaleBy(new Vector3(scale, scale, scale));
        center.scaleBy(scale);
        extents.scaleBy(scale);
        size *= scale;
      }
      const dist = size / Math.tan(camera.fovY * 0.5) + extents.z + camera.near;

      camera.lookAt(Vector3.add(center, Vector3.scale(Vector3.axisPZ(), dist)), center, Vector3.axisPY());
      camera.near = Math.min(1, camera.near);
      camera.far = Math.max(1000, dist + extents.z + 100);
      if (camera.controller instanceof OrbitCameraController) {
        camera.controller.setOptions({ center });
      }
    }
  }
  private calculateBoundingBox() {
    const rootPos = this._skeletonRoot.getWorldPosition();
    const bbox = new AABB(rootPos, rootPos);
    for (const joint of this._skeleton.joints) {
      bbox.extend(joint.getWorldPosition());
    }
    return bbox;
  }
  private createBonePrimitive(
    scene: Scene,
    size: number,
    skeleton: AssetSkeleton,
    bone: AssetHierarchyNode,
    parent: SceneNode,
    matJoint: LambertMaterial,
    matBone: LambertMaterial
  ) {
    const jointRadius = size * 0.02;
    const jointMesh = new Mesh(scene, new SphereShape({ radius: jointRadius }), matJoint);
    const pos = bone.getWorldPosition();
    jointMesh.position = pos;
    jointMesh.parent = parent;
    jointMesh.name = bone.name;
    jointMesh.pickable = true;
    for (const child of bone.children) {
      if (skeleton.joints.includes(child)) {
        const childPos = child.getWorldPosition();
        const dir = Vector3.sub(childPos, pos);
        const length = dir.magnitude;
        dir.scaleBy(1 / length);
        const height = Math.max(0, length - 2 * jointRadius);
        const cone = new TetrahedronShape({ sizeX: length * 0.05, sizeZ: length * 0.05, height });
        const coneMesh = new Mesh(scene, cone, matBone);
        Vector3.add(Vector3.scale(dir, jointRadius, coneMesh.position), pos, coneMesh.position);
        Quaternion.unitVectorToUnitVector(Vector3.axisPY(), dir, coneMesh.rotation);
        coneMesh.parent = parent;
        coneMesh.name = bone.name;
        coneMesh.pickable = true;
        this.createBonePrimitive(scene, size, skeleton, child, parent, matJoint, matBone);
      }
    }
  }
}
