import { DRef, Vector3 } from '@zephyr3d/base';
import type { FrameBuffer, Texture2D } from '@zephyr3d/device';
import { ImGui } from '@zephyr3d/imgui';
import type {
  IControllerPointerDownEvent,
  IControllerPointerMoveEvent,
  IControllerPointerUpEvent,
  IControllerWheelEvent,
  MeshMaterial,
  Primitive,
  SceneNode
} from '@zephyr3d/scene';
import { Shape } from '@zephyr3d/scene';
import {
  CopyBlitter,
  DirectionalLight,
  getApp,
  getDevice,
  getEngine,
  LambertMaterial,
  Mesh,
  OrbitCameraController,
  PerspectiveCamera
} from '@zephyr3d/scene';
import { Scene } from '@zephyr3d/scene';
import { ProjectService } from '../core/services/project';
import { Dialog } from '../views/dlg/dlg';
import { GraphEditor } from './blueprint/grapheditor';

let wasDragging = false;

export class ShapeEditor extends GraphEditor {
  private _previewScene: DRef<Scene>;
  private _previewMesh: DRef<SceneNode>;
  private _defaultMaterial: DRef<MeshMaterial>;
  private _framebuffer: DRef<FrameBuffer>;
  private _previewTex: DRef<Texture2D>;
  private _shape: DRef<Primitive>;
  private _blitter: CopyBlitter;
  private _version: number;
  private _options: any;
  constructor(label: string) {
    super(label, []);
    this._version = 0;
    this._previewScene = new DRef();
    this._previewMesh = new DRef();
    this._shape = new DRef();
    this._defaultMaterial = new DRef();
    this._framebuffer = new DRef();
    this._previewTex = new DRef();
    this._blitter = new CopyBlitter();
    this._blitter.srgbOut = true;
    this._options = null;
  }
  initPreview(primitive: Primitive) {
    const scene = new Scene();
    scene.env.light.type = 'ibl';
    const camera = new PerspectiveCamera(scene);
    camera.fovY = Math.PI / 3;
    camera.lookAt(new Vector3(0, 5, 10), Vector3.zero(), Vector3.axisPY());
    camera.controller = new OrbitCameraController();
    const light = new DirectionalLight(scene);
    light.intensity = 10;
    light.sunLight = true;
    light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());
    this._previewScene.set(scene);
    this._previewMesh.get()?.remove();
    this._previewMesh.dispose();
    const defaultMat = new LambertMaterial();
    this._defaultMaterial.set(defaultMat);
    const previewMesh = new Mesh(this._previewScene.get()!, primitive, this._defaultMaterial.get());
    this._previewMesh.set(previewMesh);
  }
  open() {
    //getApp().inputManager.useFirst(this.handleEvent, this);
  }
  close() {
    getApp().inputManager.unuse(this.handleEvent, this);
    this._previewScene.dispose();
    this._previewMesh.dispose();
    this._previewTex.dispose();
    if (this._framebuffer.get()) {
      this._framebuffer.get()!.getColorAttachment(0).dispose();
      this._framebuffer.get()!.getDepthAttachment()!.dispose();
      this._framebuffer.dispose();
    }
    this._defaultMaterial.dispose();
  }
  handleEvent(ev: Event, type?: string) {
    if (!(ev instanceof PointerEvent)) {
      return false;
    }
    if (ImGui.IsPopupOpen('', ImGui.PopupFlags.AnyPopupId)) {
      return false;
    }
    return this._previewScene.get()!.mainCamera!.handleEvent(ev, type);
  }
  get saved() {
    return this._version === 0;
  }
  async save(path: string) {
    if (path) {
      const VFS = ProjectService.VFS;
      const primitive = this._shape.get();
      if (!primitive) {
        return;
      }
      try {
        const json = {
          type: 'Default',
          data: await getEngine().resourceManager.serializeObject(primitive)
        };
        await VFS.writeFile(path, JSON.stringify(json, null, 2), { encoding: 'utf8', create: true });
      } catch (err) {
        const msg = `Save primitive failed: ${err}`;
        console.error(msg);
        Dialog.messageBox('Error', msg);
      }
      this._version = 0;
    }
  }
  async init(path: string) {
    const shape = await getEngine().resourceManager.fetchPrimitive(path);
    if (!shape) {
      throw new Error(`Load shape failed: ${path}`);
    }
    this._shape.set(shape);
    this._options = shape instanceof Shape ? JSON.parse(JSON.stringify(shape.options)) : null;
    this.readonly = !this._options || getEngine().VFS.isParentOf('/assets/@builtins', path);
    this.initPreview(shape);
    this.propEditor.object = shape;
  }
  renderNodeEditor() {
    const v = ImGui.GetContentRegionAvail();
    this.renderPreviewScene(v);
  }
  restoreState() {
    if (!this.readonly) {
      const shape = this._shape.get();
      if (!shape) {
        return;
      }
      (shape as Shape).options = this._options;
    }
  }
  private renderPreviewScene(size: ImGui.ImVec2) {
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
    this._previewScene.get()!.render();
    this._blitter.blit(this._framebuffer.get()!.getColorAttachment(0), this._previewTex.get());
    device.popDeviceStates();

    const camera = this._previewScene.get()!.mainCamera!;
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
      this._previewScene.get()?.mainCamera?.handleEvent(evtWheel);
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
        this._previewScene.get()?.mainCamera?.handleEvent(evtPointerDown);
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
        this._previewScene.get()?.mainCamera?.handleEvent(evtPointerMove);
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
      this._previewScene.get()?.mainCamera?.handleEvent(evtPointerUp);
      wasDragging = false;
    }
    camera.updateController();
  }
  protected onPropChanged(): void {
    this.markDirty();
  }
  private markDirty() {
    this._version = -1;
  }
}
