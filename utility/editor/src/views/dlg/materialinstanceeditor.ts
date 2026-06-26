import { ImGui } from '@zephyr3d/imgui';
import { DRef, Vector3, Vector4 } from '@zephyr3d/base';
import type { PropertyAccessor } from '@zephyr3d/scene';
import type { BluePrintUniformTexture, BluePrintUniformValue } from '@zephyr3d/scene';
import type {
  IControllerPointerDownEvent,
  IControllerPointerMoveEvent,
  IControllerPointerUpEvent,
  IControllerWheelEvent,
  MeshMaterial
} from '@zephyr3d/scene';
import {
  CopyBlitter,
  DirectionalLight,
  getDevice,
  Mesh,
  OrbitCameraController,
  PBRBluePrintMaterial,
  PerspectiveCamera,
  Scene,
  SphereShape,
  UnlitMaterial,
  getEngine
} from '@zephyr3d/scene';
import { DialogRenderer } from '../../components/modal';
import { PropertyEditor } from '../../components/grid';
import { DlgMessageBoxEx } from './messageexdlg';
import { DlgMessage } from './messagedlg';
import { ProjectService } from '../../core/services/project';
import type { FrameBuffer, Texture2D, Texture2DArray, TextureCube } from '@zephyr3d/device';
import { TextureAddressMode, TextureFilterMode } from '@zephyr3d/device';

type InstanceFileContent = {
  type: 'PBRBluePrintMaterialInstance';
  props?: Record<string, unknown>;
  data: {
    parent: string;
    uniformValues?: unknown[];
    uniformTextures?: unknown[];
  };
};

type PBRBluePrintMaterialInstanceLike = PBRBluePrintMaterial & {
  parentMaterialId: string;
  parentMaterial: PBRBluePrintMaterial | null;
  setOverrides: (
    uniformValues: BluePrintUniformValue[] | null | undefined,
    uniformTextures: BluePrintUniformTexture[] | null | undefined
  ) => void;
  getOverrideUniformValues: () => BluePrintUniformValue[];
  getOverrideUniformTextures: () => BluePrintUniformTexture[];
  setParentMaterial: (parentMaterial: PBRBluePrintMaterial | null, parentMaterialId?: string) => void;
  syncInheritedUniforms: (parentMaterial?: PBRBluePrintMaterial | null) => void;
};

export class DlgMaterialInstanceEditor extends DialogRenderer<void> {
  private readonly _propEditor: PropertyEditor;
  private readonly _material: DRef<PBRBluePrintMaterialInstanceLike>;
  private readonly _parent: DRef<PBRBluePrintMaterial>;
  private readonly _path: string;
  private readonly _previewScene: DRef<Scene>;
  private readonly _previewMesh: DRef<Mesh>;
  private readonly _previewFallbackMaterial: DRef<MeshMaterial>;
  private readonly _previewFramebuffer: DRef<FrameBuffer>;
  private readonly _previewTexture: DRef<Texture2D>;
  private readonly _previewBlitter: CopyBlitter;
  private _version: number;
  private _savedProps: Record<string, unknown>;
  private readonly _propChangeHandler: (object: object | null, prop: PropertyAccessor) => void;
  private _previewDragging: boolean;

  constructor(id: string, width: number, height: number, path: string) {
    super(id, width, height, false, false, false, false);
    this._propEditor = new PropertyEditor(0.4);
    this._material = new DRef();
    this._parent = new DRef();
    this._path = path;
    this._previewScene = new DRef();
    this._previewMesh = new DRef();
    this._previewFallbackMaterial = new DRef();
    this._previewFramebuffer = new DRef();
    this._previewTexture = new DRef();
    this._previewBlitter = new CopyBlitter();
    this._previewBlitter.srgbOut = true;
    this._version = 0;
    this._savedProps = {};
    this._previewDragging = false;
    this._propChangeHandler = this.handlePropChanged.bind(this);
    this._propEditor.on('object_property_changed', this._propChangeHandler, this);
    this._propEditor.setExtraPropertiesProvider('blueprint-params', (object) =>
      object === this._material.get() ? this.getBlueprintParameterProps() : []
    );
  }

  static async editMaterialInstance(title: string, path: string, width?: number, height?: number) {
    const existing = DialogRenderer.findModeless(title);
    if (existing >= 0) {
      ImGui.SetWindowFocus(title);
      return DialogRenderer.getModeless(existing).promise;
    }
    const dlg = new DlgMaterialInstanceEditor(title, width ?? 960, height ?? 720, path);
    await dlg.init();
    return dlg.show();
  }

  private async init() {
    const content = JSON.parse(
      (await ProjectService.VFS.readFile(this._path, { encoding: 'utf8' })) as string
    ) as InstanceFileContent;
    const material = (await getEngine().resourceManager.fetchMaterial(this._path, {
      overrideVFS: ProjectService.VFS
    })) as PBRBluePrintMaterialInstanceLike | null;
    if (!material || content.type !== 'PBRBluePrintMaterialInstance') {
      throw new Error(`Load material instance failed: ${this._path}`);
    }
    const parent = await getEngine().resourceManager.fetchMaterial<PBRBluePrintMaterial>(
      content.data.parent,
      { overrideVFS: ProjectService.VFS }
    );
    if (!(parent instanceof PBRBluePrintMaterial)) {
      throw new Error(`Load parent material failed: ${content.data.parent}`);
    }
    this._material.set(material);
    this._parent.set(parent);
    this._savedProps = (content.props as Record<string, unknown>) ?? {};
    this._propEditor.object = material;
    this.initPreview(material);
  }

  override close(): void {
    this._propEditor.off('object_property_changed', this._propChangeHandler, this);
    this.disposePreview();
    this._material.dispose();
    this._parent.dispose();
    super.close();
  }

  private handlePropChanged() {
    const material = this._material.get();
    if (material) {
      material.setOverrides(
        material.uniformValues as BluePrintUniformValue[],
        material.uniformTextures as BluePrintUniformTexture[]
      );
      material.uniformChanged();
    }
    this._propEditor.refresh();
    this._version = -1;
  }

  private initPreview(material: MeshMaterial) {
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
    const sphere = new SphereShape({ radius: 4, horizonalDetail: 50, verticalDetail: 50 });
    const previewMesh = new Mesh(scene, sphere, material);
    const fallbackMaterial = new UnlitMaterial();
    fallbackMaterial.albedoColor = new Vector4(1, 0, 1, 1);
    this._previewScene.set(scene);
    this._previewMesh.set(previewMesh);
    this._previewFallbackMaterial.set(fallbackMaterial);
  }

  private disposePreview() {
    this._previewScene.dispose();
    this._previewMesh.dispose();
    this._previewTexture.dispose();
    if (this._previewFramebuffer.get()) {
      this._previewFramebuffer.get()!.getColorAttachment(0).dispose();
      this._previewFramebuffer.get()!.getDepthAttachment()!.dispose();
      this._previewFramebuffer.dispose();
    }
    this._previewFallbackMaterial.dispose();
  }

  private prettifyUniformName(name: string) {
    const base = name.startsWith('u_') ? name.slice(2) : name;
    return base.replace(/_/g, ' ');
  }

  private isColorUniformName(name: string) {
    const normalized = name.toLowerCase();
    return (
      normalized.includes('color') ||
      normalized.includes('colour') ||
      normalized.includes('albedo') ||
      normalized.includes('basecolor') ||
      normalized.includes('diffuse') ||
      normalized.includes('emissive') ||
      normalized.includes('specular') ||
      normalized.includes('tint')
    );
  }

  private getUniformDisplayType(uniform: BluePrintUniformValue) {
    if (uniform.type === 'vec3' && this.isColorUniformName(uniform.name)) {
      return 'rgb';
    }
    if (uniform.type === 'vec4' && this.isColorUniformName(uniform.name)) {
      return 'rgba';
    }
    return uniform.type === 'float' ? 'float' : uniform.type;
  }

  private getTextureMimeTypes(type: string) {
    if (type === 'texCube' || type === 'tex2DArray') {
      return ['image/x-dds'];
    }
    return ['image/jpeg', 'image/png', 'image/tga', 'image/vnd.radiance', 'image/x-dds', 'image/webp'];
  }

  private createTextureSampler(uniform: BluePrintUniformTexture) {
    return getDevice().createSampler({
      addressU: uniform.wrapS as TextureAddressMode,
      addressV: uniform.wrapT as TextureAddressMode,
      minFilter: uniform.minFilter as TextureFilterMode,
      magFilter: uniform.magFilter as TextureFilterMode,
      mipFilter: uniform.mipFilter as TextureFilterMode
    });
  }

  private getBlueprintParameterProps(): PropertyAccessor[] {
    const material = this._material.get();
    if (!material) {
      return [];
    }
    const createTextureSampler = this.createTextureSampler.bind(this);
    const props: PropertyAccessor[] = [];
    for (const uniform of material.uniformValues) {
      const type = this.getUniformDisplayType(uniform);
      if (!['float', 'vec2', 'vec3', 'vec4', 'rgb', 'rgba'].includes(type)) {
        continue;
      }
      props.push({
        name: uniform.name,
        description: `Override blueprint parameter ${uniform.name}`,
        type,
        options: {
          group: 'Blueprint Parameters',
          label: this.prettifyUniformName(uniform.name),
          minValue: uniform.minValue,
          maxValue: uniform.maxValue
        },
        get(value: any) {
          const target = material.uniformValues.find((v) => v.name === uniform.name) ?? uniform;
          for (let i = 0; i < target.value.length; i++) {
            value.num[i] = target.value[i];
          }
        },
        set(value: any) {
          const target = material.uniformValues.find((v) => v.name === uniform.name);
          if (!target) {
            return;
          }
          target.value = target.value.map((_, index) => value.num[index] ?? 0);
          target.finalValue =
            target.value.length === 1 ? target.value[0] : new Float32Array(target.value);
        }
      });
    }
    for (const uniform of material.uniformTextures.filter((u) => u.exposed !== false)) {
      props.push({
        name: uniform.name,
        description: `Override blueprint texture parameter ${uniform.name}`,
        type: 'string',
        options: {
          group: 'Blueprint Parameters',
          label: this.prettifyUniformName(uniform.name),
          mimeTypes: this.getTextureMimeTypes(uniform.type)
        },
        get(value: any) {
          const target = material.uniformTextures.find((v) => v.name === uniform.name) ?? uniform;
          value.str[0] = target.texture ?? '';
        },
        async set(value: any) {
          const target = material.uniformTextures.find((v) => v.name === uniform.name);
          if (!target) {
            return;
          }
          target.texture = value.str[0] ?? '';
          if (!target.texture) {
            target.finalTexture?.dispose();
            target.finalTexture = new DRef(null);
            target.finalSampler = createTextureSampler(target);
            target.params = Vector4.zero();
            return;
          }
          const tex = await getEngine().resourceManager.fetchTexture<Texture2D | TextureCube | Texture2DArray>(
            target.texture,
            {
              linearColorSpace: !target.sRGB,
              overrideVFS: ProjectService.VFS
            }
          );
          target.finalTexture?.dispose();
          target.finalTexture = new DRef(tex);
          target.finalSampler = createTextureSampler(target);
          target.params = tex ? new Vector4(tex.width, tex.height, tex.depth, tex.mipLevelCount) : Vector4.zero();
        }
      });
    }
    return props;
  }

  private get saved() {
    return this._version === 0;
  }

  private async save() {
    const material = this._material.get();
    const parent = this._parent.get();
    if (!material || !parent) {
      return;
    }
    const allProps = ((await getEngine().resourceManager.serializeObjectProps(material)) ?? {}) as Record<
      string,
      unknown
    >;
    const parentProps = ((await getEngine().resourceManager.serializeObjectProps(parent)) ?? {}) as Record<
      string,
      unknown
    >;
    const overrideProps: Record<string, unknown> = {};
    for (const key of Object.keys(allProps)) {
      if (JSON.stringify(allProps[key]) !== JSON.stringify(parentProps[key])) {
        overrideProps[key] = allProps[key];
      }
    }
    const content: InstanceFileContent = {
      type: 'PBRBluePrintMaterialInstance',
      props: overrideProps,
      data: {
        parent: material.parentMaterialId,
        uniformValues: material.getOverrideUniformValues(),
        uniformTextures: material.getOverrideUniformTextures()
      }
    };
    await ProjectService.VFS.writeFile(this._path, JSON.stringify(content, null, 2), {
      encoding: 'utf8',
      create: true
    });
    (getEngine().resourceManager as any).invalidateMaterial(this._path);
    const reloaded = (await getEngine().resourceManager.fetchMaterial(this._path, {
      overrideVFS: ProjectService.VFS
    })) as PBRBluePrintMaterialInstanceLike | null;
    if (reloaded) {
      material.setParentMaterial(reloaded.parentMaterial, reloaded.parentMaterialId);
      material.uniformValues = reloaded.uniformValues;
      material.uniformTextures = reloaded.uniformTextures;
    }
    this._savedProps = overrideProps;
    this._version = 0;
  }

  private async restoreState() {
    const material = this._material.get();
    if (!material) {
      return;
    }
    (getEngine().resourceManager as any).invalidateMaterial(this._path);
    const reloaded = (await getEngine().resourceManager.fetchMaterial(this._path, {
      overrideVFS: ProjectService.VFS
    })) as PBRBluePrintMaterialInstanceLike | null;
    if (!reloaded) {
      throw new Error(`Reload material instance failed: ${this._path}`);
    }
    this._parent.set(reloaded.parentMaterial);
    material.setParentMaterial(reloaded.parentMaterial, reloaded.parentMaterialId);
    material.uniformValues = reloaded.uniformValues;
    material.uniformTextures = reloaded.uniformTextures;
    await getEngine().resourceManager.deserializeObjectProps(material, this._savedProps);
    this._propEditor.object = material;
    this._version = 0;
  }

  private renderPreviewScene(size: ImGui.ImVec2) {
    const scene = this._previewScene.get();
    const previewMesh = this._previewMesh.get();
    if (!scene || !previewMesh || size.x <= 0 || size.y <= 0) {
      return;
    }
    const device = getDevice();
    if (
      this._previewFramebuffer.get() &&
      (this._previewFramebuffer.get()!.getWidth() !== size.x || this._previewFramebuffer.get()!.getHeight() !== size.y)
    ) {
      this._previewFramebuffer.get()!.getColorAttachment(0).dispose();
      this._previewFramebuffer.get()!.getDepthAttachment()!.dispose();
      this._previewFramebuffer.dispose();
      this._previewTexture.dispose();
    }
    if (!this._previewFramebuffer.get()) {
      const tex = device.createTexture2D('rgba16f', size.x, size.y, { mipmapping: false })!;
      const depth = device.createTexture2D('d24s8', size.x, size.y)!;
      this._previewFramebuffer.set(device.createFrameBuffer([tex], depth));
      this._previewTexture.set(device.createTexture2D('rgba8unorm', size.x, size.y, { mipmapping: false }));
    }
    device.pushDeviceStates();
    device.setFramebuffer(this._previewFramebuffer.get());
    scene.render();
    this._previewBlitter.blit(this._previewFramebuffer.get()!.getColorAttachment(0), this._previewTexture.get());
    device.popDeviceStates();

    const camera = scene.mainCamera!;
    const cursorScreenPos = ImGui.GetCursorScreenPos();
    camera.interactionRect = [cursorScreenPos.x, cursorScreenPos.y, Math.max(0, size.x), Math.max(0, size.y)];
    const cursorPos = ImGui.GetCursorPos();
    ImGui.Image(this._previewTexture.get(), size, new ImGui.ImVec2(0, 1), new ImGui.ImVec2(1, 0));
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
      camera.handleEvent(evtWheel);
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
        camera.handleEvent(evtPointerDown);
        this._previewDragging = true;
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
        camera.handleEvent(evtPointerMove);
      }
    } else if (this._previewDragging) {
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
      camera.handleEvent(evtPointerUp);
      this._previewDragging = false;
    }
    camera.updateController();
  }

  public doRender(): void {
    const material = this._material.get();
    const parent = this._parent.get();
    if (!material || !parent) {
      ImGui.Text('Material instance not loaded.');
      return;
    }
    ImGui.Text(`Parent: ${material.parentMaterialId}`);
    ImGui.Separator();
    const contentHeight = -ImGui.GetFrameHeightWithSpacing();
    if (ImGui.BeginChild('##MaterialInstanceBody', new ImGui.ImVec2(0, contentHeight), false)) {
      const region = ImGui.GetContentRegionAvail();
      const spacing = ImGui.GetStyle().ItemSpacing.x;
      const inspectorWidth = Math.min(400, Math.max(300, region.x * 0.32));
      const previewWidth = Math.max(320, region.x - inspectorWidth - spacing);
      if (ImGui.BeginChild('##MaterialInstancePreview', new ImGui.ImVec2(previewWidth, -1), true)) {
        const previewSize = ImGui.GetContentRegionAvail();
        this.renderPreviewScene(previewSize);
      }
      ImGui.EndChild();
      ImGui.SameLine();
      if (ImGui.BeginChild('##MaterialInstanceInspector', new ImGui.ImVec2(inspectorWidth, -1), true)) {
        this._propEditor.render();
      }
      ImGui.EndChild();
    }
    ImGui.EndChild();
    if (ImGui.Button('Save')) {
      this.save().catch((err) => {
        DlgMessage.messageBox('Error', `Save material instance failed: ${err}`);
      });
    }
    ImGui.SameLine();
    if (ImGui.Button('Close')) {
      if (!this.saved) {
        DlgMessageBoxEx.messageBoxEx('##SaveMaterialInstance', 'Material instance has changed, do you want to save it?', [
          'Yes',
          'No',
          'Cancel'
        ]).then((value) => {
          if (value === 'Yes') {
            this.save()
              .then(() => this.close())
              .catch((err) => {
                DlgMessage.messageBox('Error', `Save material instance failed: ${err}`);
              });
          } else if (value === 'No') {
            this.restoreState().then(() => this.close());
          }
        });
      } else {
        this.close();
      }
    }
  }
}
