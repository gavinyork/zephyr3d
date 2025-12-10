import type {
  BlueprintDAG,
  BluePrintUniformTexture,
  BluePrintUniformValue,
  IControllerPointerDownEvent,
  IControllerPointerMoveEvent,
  IControllerPointerUpEvent,
  IControllerWheelEvent,
  IGraphNode,
  MeshMaterial,
  SceneNode
} from '@zephyr3d/scene';
import {
  CopyBlitter,
  MaterialBlueprintIR,
  Sprite3D,
  Sprite3DBlueprintMaterial,
  Sprite3DMaterial
} from '@zephyr3d/scene';
import {
  DirectionalLight,
  FunctionCallNode,
  getApp,
  getDevice,
  getEngine,
  Mesh,
  OrbitCameraController,
  PerspectiveCamera,
  Scene,
  SphereShape,
  UnlitMaterial
} from '@zephyr3d/scene';
import { PBRBluePrintMaterial } from '@zephyr3d/scene';
import type { NodeCategory } from '../api';
import { GraphEditor } from '../grapheditor';
import { getConstantNodeCategories } from '../nodes/constants';
import { getMathNodeCategories } from '../nodes/math';
import { getTextureNodeCategories } from './texture';
import { GNode } from '../node';
import type { GenericConstructor } from '@zephyr3d/base';
import { ASSERT, DRef, guessMimeType, randomUUID, Vector3, Vector4 } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';
import type { FrameBuffer, Texture2D, TextureAddressMode, TextureFilterMode } from '@zephyr3d/device';
import { getInputNodeCategories } from './inputs';
import { ProjectService } from '../../../core/services/project';
import { Dialog } from '../../../views/dlg/dlg';
import type { NodeEditor } from '../nodeeditor';

let wasDragging = false;

export class PBRMaterialEditor extends GraphEditor {
  private _previewScene: DRef<Scene>;
  private _previewMesh: DRef<SceneNode>;
  private _defaultMaterial: DRef<MeshMaterial>;
  private _editMaterial: DRef<MeshMaterial>;
  private _framebuffer: DRef<FrameBuffer>;
  private _previewTex: DRef<Texture2D>;
  private _blitter: CopyBlitter;
  private _version: number;
  private _irChanged: boolean;
  private _outputName: string;
  private _blueprintPath: string;
  private _savedState: {
    props: any;
    irFrag: MaterialBlueprintIR;
    irVert: MaterialBlueprintIR;
    uniformValues: BluePrintUniformValue[];
    uniformTextures: BluePrintUniformTexture[];
  };
  constructor(label: string, outputName: string) {
    super(label, []);
    this._outputName = outputName;
    this._version = 0;
    this._irChanged = false;
    this._previewScene = new DRef();
    this._previewMesh = new DRef();
    this._defaultMaterial = new DRef();
    this._editMaterial = new DRef();
    this._framebuffer = new DRef();
    this._previewTex = new DRef();
    this._blitter = new CopyBlitter();
    this._blitter.srgbOut = true;
    this._blueprintPath = '';
    this._savedState = null;
    this.propEditor.on('object_property_changed', this.graphChanged, this);
  }
  //protected create
  get fragmentEditor() {
    return this.getNodeEditor('fragment');
  }
  get vertexEditor() {
    return this.getNodeEditor('vertex');
  }
  initPreview(mat: MeshMaterial) {
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
    if (mat instanceof Sprite3DMaterial || mat instanceof Sprite3DBlueprintMaterial) {
      const defaultMat = new Sprite3DMaterial();
      this._defaultMaterial.set(defaultMat);
      const previewMesh = new Sprite3D(this._previewScene.get(), mat);
      this._previewMesh.set(previewMesh);
    } else {
      const sphere = new SphereShape({ radius: 4, horizonalDetail: 50, verticalDetail: 50 });
      const defaultMat = new UnlitMaterial();
      defaultMat.albedoColor = new Vector4(1, 0, 1, 1);
      this._defaultMaterial = new DRef(defaultMat);
      const previewMesh = new Mesh(this._previewScene.get(), sphere, mat);
      this._previewMesh = new DRef(previewMesh);
    }
    this.propEditor.on('object_property_changed', this.graphChanged, this);
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
      this._framebuffer.get().getColorAttachment(0).dispose();
      this._framebuffer.get().getDepthAttachment().dispose();
      this._framebuffer.dispose();
    }
    this._defaultMaterial.dispose();
    this._editMaterial.dispose();
    this.propEditor.off('object_property_changed', this.graphChanged, this);
    this.fragmentEditor?.off('changed', this.graphChanged, this);
    this.fragmentEditor?.off('dragdrop', this.dragdropFrag, this);
    this.vertexEditor?.off('changed', this.graphChanged, this);
    this.vertexEditor?.off('dragdrop', this.dragdropFrag, this);
    if (this._savedState?.uniformTextures) {
      for (const u of this._savedState.uniformTextures) {
        u.finalTexture?.dispose();
      }
    }
    this._savedState = null;
  }
  getNodeCategory(): NodeCategory[] {
    return [
      ...getConstantNodeCategories(),
      ...getInputNodeCategories(),
      ...getTextureNodeCategories(),
      ...getMathNodeCategories()
    ];
  }
  handleEvent(ev: Event, type?: string) {
    if (!(ev instanceof PointerEvent)) {
      return false;
    }
    if (ImGui.IsPopupOpen('', ImGui.PopupFlags.AnyPopupId)) {
      return false;
    }
    return this._previewScene.get().mainCamera.handleEvent(ev, type);
  }
  get saved() {
    return this._version === 0;
  }
  async getSavedState(mat: MeshMaterial) {
    return {
      props: await getEngine().resourceManager.serializeObjectProps(mat),
      irFrag:
        mat instanceof PBRBluePrintMaterial || mat instanceof Sprite3DBlueprintMaterial
          ? mat.fragmentIR
          : null,
      irVert: mat instanceof PBRBluePrintMaterial ? mat.vertexIR : null,
      uniformValues:
        mat instanceof PBRBluePrintMaterial || mat instanceof Sprite3DBlueprintMaterial
          ? (mat.uniformValues?.map((u) => {
              return {
                name: u.name,
                type: u.type,
                value: u.value?.slice() ?? null,
                inFragmentShader: u.inFragmentShader,
                inVertexShader: u.inVertexShader,
                finalValue: typeof u.finalValue === 'number' ? u.finalValue : (u.finalValue?.slice() ?? null)
              };
            }) ?? null)
          : null,
      uniformTextures:
        mat instanceof PBRBluePrintMaterial || mat instanceof Sprite3DBlueprintMaterial
          ? (mat.uniformTextures?.map((u) => {
              return {
                name: u.name,
                params: u.params?.clone() ?? null,
                sRGB: u.sRGB,
                texture: u.texture,
                type: u.type,
                wrapS: u.wrapS,
                wrapT: u.wrapT,
                minFilter: u.minFilter,
                magFilter: u.magFilter,
                mipFilter: u.mipFilter,
                inFragmentShader: u.inFragmentShader,
                inVertexShader: u.inVertexShader,
                finalTexture: u.finalTexture ? new DRef(u.finalTexture.get()) : null,
                finalSampler: u.finalSampler
              };
            }) ?? null)
          : null
    };
  }
  async save(path: string) {
    if (path) {
      const VFS = ProjectService.VFS;
      const mat = this._editMaterial.get();
      if (mat instanceof PBRBluePrintMaterial || mat instanceof Sprite3DBlueprintMaterial) {
        const bpPath =
          this._blueprintPath ||
          VFS.normalizePath(VFS.join(VFS.dirname(path), `${VFS.basename(path, VFS.extname(path))}.zbpt`));
        // Save blueprint
        const fragmentState = await this.fragmentEditor.saveState();
        const vertexState =
          mat instanceof PBRBluePrintMaterial ? await this.vertexEditor.saveState() : undefined;
        try {
          await VFS.writeFile(
            bpPath,
            JSON.stringify(
              {
                type: mat instanceof PBRBluePrintMaterial ? 'PBRMaterial' : 'Sprite3DMaterial',
                state: { fragment: fragmentState, vertex: vertexState }
              },
              null,
              2
            ),
            {
              encoding: 'utf8',
              create: true
            }
          );
          getEngine().resourceManager.invalidateBluePrint(bpPath);
        } catch (err) {
          const msg = `Save BluePrint failed: ${err}`;
          console.error(msg);
          Dialog.messageBox('Error', msg);
          return;
        }
        // Save material
        const uniforms = this.getUniforms(
          mat.fragmentIR,
          mat instanceof PBRBluePrintMaterial ? mat.vertexIR : null
        );
        const content: {
          type: string;
          props: any;
          data: {
            IR: string;
            uniformValues: BluePrintUniformValue[];
            uniformTextures: BluePrintUniformTexture[];
          };
        } = {
          type: mat instanceof PBRBluePrintMaterial ? 'PBRBluePrintMaterial' : 'Sprite3DBluePrintMaterial',
          props: await getEngine().resourceManager.serializeObjectProps(this._editMaterial.get()),
          data: {
            IR: bpPath,
            uniformValues: uniforms.uniformValues,
            uniformTextures: uniforms.uniformTextures
          }
        };
        try {
          await VFS.writeFile(path, JSON.stringify(content, null, 2), {
            encoding: 'utf8',
            create: true
          });
        } catch (err) {
          const msg = `Save material failed: ${err}`;
          console.error(msg);
          Dialog.messageBox('Error', msg);
        }
        await getEngine().resourceManager.reloadBluePrintMaterials();
      } else if (mat) {
        try {
          const json = {
            type: 'Default',
            data: await getEngine().resourceManager.serializeObject(mat)
          };
          await VFS.writeFile(path, JSON.stringify(json, null, 2), { encoding: 'utf8', create: true });
        } catch (err) {
          const msg = `Save material failed: ${err}`;
          console.error(msg);
          Dialog.messageBox('Error', msg);
        }
        await getEngine().resourceManager.reloadBluePrintMaterials();
      }
      this._version = 0;
      this._savedState = await this.getSavedState(mat);
    }
  }
  getUniforms(fragmentIR: MaterialBlueprintIR, vertexIR?: MaterialBlueprintIR) {
    const uniformValues: BluePrintUniformValue[] = [];
    const uniformTextures: BluePrintUniformTexture[] = [];
    for (const ir of [fragmentIR, vertexIR]) {
      if (!ir) {
        continue;
      }
      for (const u of ir.uniformValues) {
        const exists = uniformValues.find((v) => v.name === u.name);
        if (exists) {
          ASSERT(exists.type === u.type, 'Uniform with same name must have same type');
          if (ir === fragmentIR) {
            exists.inFragmentShader = true;
          } else if (ir === vertexIR) {
            exists.inVertexShader = true;
          }
          continue;
        }
        uniformValues.push({
          name: u.name,
          type: u.type,
          value: typeof u.value === 'number' ? [u.value] : [...u.value],
          inVertexShader: ir === vertexIR,
          inFragmentShader: ir === fragmentIR
        });
      }
      for (const u of ir.uniformTextures) {
        const exists = uniformTextures.find((v) => v.name === u.name);
        if (exists) {
          ASSERT(
            exists.type === u.type &&
              exists.texture === u.texture &&
              exists.wrapS === u.wrapS &&
              exists.wrapT === u.wrapT &&
              exists.minFilter === u.minFilter &&
              exists.magFilter === u.magFilter &&
              exists.mipFilter === u.mipFilter,
            'Uniform with same name must have same type'
          );
          if (ir === fragmentIR) {
            exists.inFragmentShader = true;
          } else if (ir === vertexIR) {
            exists.inVertexShader = true;
          }
          continue;
        }
        uniformTextures.push({
          name: u.name,
          type: u.type,
          texture: u.texture,
          sRGB: u.sRGB,
          wrapS: u.wrapS,
          wrapT: u.wrapT,
          minFilter: u.minFilter,
          magFilter: u.magFilter,
          mipFilter: u.mipFilter,
          inVertexShader: ir === vertexIR,
          inFragmentShader: ir === fragmentIR
        });
      }
    }
    return {
      uniformValues,
      uniformTextures
    };
  }
  async restoreState() {
    const mat = this._editMaterial.get();
    if (mat && this._savedState) {
      await getEngine().resourceManager.deserializeObjectProps(mat, this._savedState.props);
      if (mat instanceof PBRBluePrintMaterial || mat instanceof Sprite3DBlueprintMaterial) {
        if (this._savedState.irFrag) {
          mat.fragmentIR = this._savedState.irFrag;
        }
        if (mat instanceof PBRBluePrintMaterial && this._savedState.irVert) {
          mat.vertexIR = this._savedState.irVert;
        }
        mat.uniformValues = this._savedState.uniformValues ?? [];
        mat.uniformTextures = this._savedState.uniformTextures ?? [];
      }
    }
  }
  async init(path: string, type?: GenericConstructor<MeshMaterial>) {
    const mat = type ? new type() : await getEngine().resourceManager.fetchMaterial(path);
    this._editMaterial.set(mat);
    this._savedState = await this.getSavedState(mat);
    this.readonly = !type && getEngine().VFS.isParentOf('/assets/@builtins', path);
    if (type) {
      if (mat instanceof PBRBluePrintMaterial) {
        mat.fragmentIR.editorState.nodes[0].title = this._outputName;
        mat.vertexIR.editorState.nodes[0].title = this._outputName;
      } else if (mat instanceof Sprite3DBlueprintMaterial) {
        mat.fragmentIR.editorState.nodes[0].title = this._outputName;
      }
    }
    if (mat instanceof PBRBluePrintMaterial || mat instanceof Sprite3DBlueprintMaterial) {
      const fragEditor = this.addTab('fragment');
      await fragEditor.loadState(mat.fragmentIR.editorState);
      fragEditor.on('changed', this.graphChanged, this);
      fragEditor.on('dragdrop', this.dragdropFrag, this);
      if (mat instanceof PBRBluePrintMaterial) {
        const vertexEditor = this.addTab('vertex');
        await vertexEditor.loadState(mat.vertexIR.editorState);
        vertexEditor.on('changed', this.graphChanged, this);
        vertexEditor.on('dragdrop', this.dragdropVertex, this);
      }
    }
    this.initPreview(mat);
    this.propEditor.object = mat;
  }
  async createIR(editor: NodeEditor) {
    const state = await editor.saveState();
    const dag = this.createDAG(editor);
    for (const [, v] of editor.nodes) {
      v.impl.reset();
    }
    for (const i of dag.order) {
      const node = editor.nodes.get(i);
      node.impl.check();
      if (node.impl.error) {
        return null;
      }
    }
    const ir = new MaterialBlueprintIR(dag, randomUUID(), state);
    if (!ir.ok) {
      return null;
    }
    return ir;
  }
  createDAG(editor: NodeEditor): BlueprintDAG {
    const nodeMap: Record<number, IGraphNode> = {};
    const roots: number[] = [];
    for (const [k, v] of editor.nodes) {
      nodeMap[k] = v.impl;
      if (v.outputs.length === 0) {
        roots.push(v.id);
      }
    }
    return getEngine().resourceManager.createBluePrintDAG(nodeMap, roots, editor.links);
  }
  renderNodeEditor() {
    if (this._irChanged) {
      this._irChanged = false;
      this.applyPreviewMaterial();
    }
    const mat = this._editMaterial.get();
    if (mat instanceof PBRBluePrintMaterial || mat instanceof Sprite3DBlueprintMaterial) {
      if (this.readonly) {
        ImGui.BeginChild(
          '##GraphAreaMask',
          ImGui.GetContentRegionAvail(),
          false,
          ImGui.WindowFlags.NoMouseInputs
        );
      }
      super.renderNodeEditor();
      if (this.readonly) {
        ImGui.EndChild();
      }
    } else {
      const v = ImGui.GetContentRegionAvail();
      this.renderPreviewScene(v);
    }
  }
  protected renderRightPanel() {
    const mat = this._editMaterial.get();
    if (mat instanceof PBRBluePrintMaterial || mat instanceof Sprite3DBlueprintMaterial) {
      const v = ImGui.GetContentRegionAvail();
      v.y >>= 1;
      if (ImGui.BeginChild('##BluePrintNodeProps', v, true)) {
        super.renderRightPanel();
      }
      ImGui.EndChild();
      if (ImGui.BeginChild('##BluePrintMaterialPreview', new ImGui.ImVec2(-1, -1), true)) {
        ImGui.GetContentRegionAvail(v);
        this.renderPreviewScene(v);
      }
      ImGui.EndChild();
    } else {
      super.renderRightPanel();
    }
  }
  private renderPreviewScene(size: ImGui.ImVec2) {
    if (size.x <= 0 || size.y <= 0) {
      return;
    }
    const device = getDevice();
    if (
      this._framebuffer.get() &&
      (this._framebuffer.get().getWidth() !== size.x || this._framebuffer.get().getHeight() !== size.y)
    ) {
      this._framebuffer.get().getColorAttachment(0).dispose();
      this._framebuffer.get().getDepthAttachment().dispose();
      this._framebuffer.dispose();
      this._previewTex.dispose();
    }
    if (!this._framebuffer.get()) {
      const tex = device.createTexture2D('rgba16f', size.x, size.y, {
        mipmapping: false
      });
      const depth = device.createTexture2D('d24s8', size.x, size.y);
      this._framebuffer.set(device.createFrameBuffer([tex], depth));
      const previewTex = device.createTexture2D('rgba8unorm', size.x, size.y, { mipmapping: false });
      this._previewTex.set(previewTex);
    }
    device.pushDeviceStates();
    device.setFramebuffer(this._framebuffer.get());
    this._previewScene.get().render();
    this._blitter.blit(this._framebuffer.get().getColorAttachment(0), this._previewTex.get());
    device.popDeviceStates();

    const camera = this._previewScene.get().mainCamera;
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
  private async applyPreviewMaterial() {
    const mat = this._editMaterial.get();
    if (mat instanceof PBRBluePrintMaterial || mat instanceof Sprite3DBlueprintMaterial) {
      const irFrag = await this.createIR(this.fragmentEditor);
      const irVert = this.vertexEditor ? await this.createIR(this.vertexEditor) : null;
      if (!irFrag || (mat instanceof PBRBluePrintMaterial && !irVert)) {
        (this._previewMesh.get() as Mesh | Sprite3D).material = this._defaultMaterial.get();
      } else {
        const uniformNames: Set<string> = new Set();
        for (const i of irFrag.DAG.order) {
          const node = this.fragmentEditor.nodes.get(i);
          if (node.impl.isUniform && uniformNames.has(node.impl.paramName)) {
            node.impl.error = `Duplicated uniform name: ${node.impl.paramName}`;
            return;
          }
          uniformNames.add(node.impl.paramName);
        }
        if (this.vertexEditor) {
          uniformNames.clear();
          for (const i of irVert.DAG.order) {
            const node = this.vertexEditor.nodes.get(i);
            if (node.impl.isUniform && uniformNames.has(node.impl.paramName)) {
              node.impl.error = `Duplicated uniform name: ${node.impl.paramName}`;
              return;
            }
            uniformNames.add(node.impl.paramName);
          }
        }
        const uniforms = this.getUniforms(irFrag, irVert);
        for (const u of uniforms.uniformValues) {
          u.finalValue = u.value.length === 1 ? u.value[0] : new Float32Array(u.value);
        }
        for (const u of uniforms.uniformTextures) {
          const tex = await getEngine().resourceManager.fetchTexture(u.texture, {
            linearColorSpace: !u.sRGB
          });
          u.finalTexture?.dispose();
          u.finalTexture = new DRef(tex);
          u.finalSampler = getDevice().createSampler({
            addressU: u.wrapS as TextureAddressMode,
            addressV: u.wrapT as TextureAddressMode,
            minFilter: u.minFilter as TextureFilterMode,
            magFilter: u.magFilter as TextureFilterMode,
            mipFilter: u.mipFilter as TextureFilterMode
          });
        }
        mat.fragmentIR = irFrag;
        if (mat instanceof PBRBluePrintMaterial) {
          mat.vertexIR = irVert;
        }
        mat.uniformValues = uniforms.uniformValues;
        mat.uniformTextures = uniforms.uniformTextures;
        (this._previewMesh.get() as Mesh | Sprite3D).material = mat;
      }
    }
  }
  protected onPropChanged(): void {
    this.graphChanged();
  }
  protected onSelectionChanged(object: IGraphNode): void {
    if (!object) {
      this.propEditor.object = this._editMaterial.get();
      /*
      this.propEditor.root.addRawProperty(
        'BlendMode',
        'string',
        (value) => {
          value.str[0] = this._blendMode;
        },
        (value) => {
          this._blendMode = value.str[0] as BlendMode;
          this.onPropChanged(null, null);
        },
        {
          enum: { labels: ['None', 'Blend', 'Additive'], values: ['none', 'blend', 'additive'] }
        }
      );
      this.propEditor.root.addRawProperty(
        'DoubleSided',
        'bool',
        (value) => {
          value.bool[0] = this._doubleSided;
        },
        (value) => {
          this._doubleSided = value.bool[0];
          this.onPropChanged(null, null);
        }
      );
      */
    }
  }
  private graphChanged() {
    this._version = -1;
    const mat = this._editMaterial.get();
    if (mat instanceof PBRBluePrintMaterial || mat instanceof Sprite3DBlueprintMaterial) {
      this._irChanged = true;
    }
  }
  private dragdropFrag(x: number, y: number, _payload: { isDir: boolean; path: string }[]) {
    if (
      _payload.length === 1 &&
      guessMimeType(_payload[0].path) === 'application/vnd.zephyr3d.blueprint.mf+json'
    ) {
      getEngine()
        .resourceManager.loadBluePrint(_payload[0].path)
        .then((IRs) => {
          if (IRs) {
            const world = this.fragmentEditor.canvasToWorld(new ImGui.ImVec2(x, y));
            const snapped = this.fragmentEditor.snapWorldToScreenGrid(world, this.fragmentEditor.canvasScale);
            const node = new GNode(
              this.fragmentEditor,
              snapped,
              new FunctionCallNode(
                _payload[0].path,
                ProjectService.VFS.basename(_payload[0].path, ProjectService.VFS.extname(_payload[0].path)),
                IRs['func']
              )
            );
            this.fragmentEditor.addNode(node);
          }
        });
    }
  }
  private dragdropVertex(x: number, y: number, _payload: { isDir: boolean; path: string }[]) {
    if (
      _payload.length === 1 &&
      guessMimeType(_payload[0].path) === 'application/vnd.zephyr3d.blueprint.mf+json'
    ) {
      getEngine()
        .resourceManager.loadBluePrint(_payload[0].path)
        .then((IRs) => {
          if (IRs) {
            const world = this.vertexEditor.canvasToWorld(new ImGui.ImVec2(x, y));
            const snapped = this.vertexEditor.snapWorldToScreenGrid(world, this.vertexEditor.canvasScale);
            const node = new GNode(
              this.vertexEditor,
              snapped,
              new FunctionCallNode(
                _payload[0].path,
                ProjectService.VFS.basename(_payload[0].path, ProjectService.VFS.extname(_payload[0].path)),
                IRs['func']
              )
            );
            this.vertexEditor.addNode(node);
          }
        });
    }
  }
}
