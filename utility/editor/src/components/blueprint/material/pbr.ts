import type {
  BlendMode,
  BlueprintDAG,
  BluePrintUniformTexture,
  BluePrintUniformValue,
  IControllerPointerDownEvent,
  IControllerPointerMoveEvent,
  IControllerPointerUpEvent,
  IControllerWheelEvent,
  IGraphNode,
  MeshMaterial,
  PropertyAccessor
} from '@zephyr3d/scene';
import { CopyBlitter } from '@zephyr3d/scene';
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
  UnlitMaterial,
  VertexBlockNode
} from '@zephyr3d/scene';
import { MaterialBlueprintIR, PBRBlockNode, PBRBluePrintMaterial } from '@zephyr3d/scene';
import type { NodeCategory } from '../api';
import { GraphEditor } from '../grapheditor';
import { getConstantNodeCategories } from '../nodes/constants';
import { getMathNodeCategories } from '../nodes/math';
import { getTextureNodeCategories } from './texture';
import { GNode } from '../node';
import { ASSERT, DRef, guessMimeType, randomUUID, Vector3, Vector4 } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';
import type { FrameBuffer, Texture2D } from '@zephyr3d/device';
import { getInputNodeCategories } from './inputs';
import { ProjectService } from '../../../core/services/project';
import { Dialog } from '../../../views/dlg/dlg';
import type { NodeEditor, NodeEditorState } from '../nodeeditor';

let wasDragging = false;

export class PBRMaterialEditor extends GraphEditor {
  private _previewScene: DRef<Scene>;
  private _previewMesh: DRef<Mesh>;
  private _defaultMaterial: DRef<UnlitMaterial>;
  private _editMaterial: DRef<MeshMaterial>;
  private _framebuffer: DRef<FrameBuffer>;
  private _previewTex: DRef<Texture2D>;
  private _blitter: CopyBlitter;
  private _version: number;
  private _blendMode: BlendMode;
  private _doubleSided: boolean;
  private _isBlueprint: boolean;
  private _outputName: string;
  private _blueprintPath: string;
  constructor(label: string, outputName: string) {
    super(label, []);
    this._outputName = outputName;
    this._isBlueprint = false;
    const scene = new Scene();
    scene.env.light.type = 'ibl-sh';
    const camera = new PerspectiveCamera(scene);
    camera.fovY = Math.PI / 3;
    camera.lookAt(new Vector3(0, 5, 10), Vector3.zero(), Vector3.axisPY());
    camera.controller = new OrbitCameraController();
    this._version = 0;
    this._previewScene = new DRef(scene);
    this._framebuffer = new DRef();
    this._previewTex = new DRef();
    this._blitter = new CopyBlitter();
    this._blitter.srgbOut = true;
    const light = new DirectionalLight(scene);
    light.intensity = 10;
    light.sunLight = true;
    light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());
    const sphere = new SphereShape({ radius: 4, horizonalDetail: 50, verticalDetail: 50 });
    const defaultMat = new UnlitMaterial();
    defaultMat.albedoColor = new Vector4(1, 0, 1, 1);
    this._editMaterial = new DRef();
    this._defaultMaterial = new DRef(defaultMat);
    const previewMesh = new Mesh(scene, sphere, this._defaultMaterial.get());
    this._previewMesh = new DRef(previewMesh);
    this._blendMode = 'none';
    this._doubleSided = false;
    this._blueprintPath = '';
    //this.applyPreviewMaterial();
    this.propEditor.on('object_property_changed', this.graphChanged, this);
  }
  get fragmentEditor() {
    return this.getNodeEditor('fragment');
  }
  get vertexEditor() {
    return this.getNodeEditor('vertex');
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
    if (this._isBlueprint) {
      this.fragmentEditor.off('changed', this.graphChanged, this);
      this.fragmentEditor.off('dragdrop', this.dragdropFrag, this);
      this.vertexEditor.off('changed', this.graphChanged, this);
      this.vertexEditor.off('dragdrop', this.dragdropFrag, this);
    }
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
    return this._version === (this._isBlueprint ? this.getNodeEditor('fragment').version : 0);
  }
  async save(path: string) {
    if (path) {
      const VFS = ProjectService.VFS;
      if (this._isBlueprint) {
        const bpPath =
          this._blueprintPath ||
          VFS.normalizePath(VFS.join(VFS.dirname(path), `${VFS.basename(path, VFS.extname(path))}.zbpt`));
        // Save blueprint
        const fragmentState = await this.fragmentEditor.saveState();
        const vertexState = await this.vertexEditor.saveState();
        try {
          await VFS.writeFile(
            bpPath,
            JSON.stringify(
              { type: 'PBRMaterial', state: { fragment: fragmentState, vertex: vertexState } },
              null,
              2
            ),
            {
              encoding: 'utf8',
              create: true
            }
          );
        } catch (err) {
          const msg = `Save BluePrint failed: ${err}`;
          console.error(msg);
          Dialog.messageBox('Error', msg);
          return;
        }
        // Save material
        const uniforms = this.getUniforms();
        const content: {
          type: string;
          data: {
            IR: string;
            uniformValues: BluePrintUniformValue[];
            uniformTextures: BluePrintUniformTexture[];
          };
        } = {
          type: 'PBRBluePrintMaterial',
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
        this._version = this.getNodeEditor('fragment').version;
        await getEngine().serializationManager.reloadBluePrintMaterials();
      } else {
        try {
          const json = {
            type: 'Default',
            data: await ProjectService.serializationManager.serializeObject(this._editMaterial.get())
          };
          await VFS.writeFile(path, JSON.stringify(json, null, 2), { encoding: 'utf8', create: true });
        } catch (err) {
          const msg = `Save material failed: ${err}`;
          console.error(msg);
          Dialog.messageBox('Error', msg);
        }
        this._version = 0;
        await getEngine().serializationManager.reloadBluePrintMaterials();
      }
    }
  }
  getUniforms() {
    const editors = [this.fragmentEditor, this.vertexEditor];
    const uniformValues: BluePrintUniformValue[] = [];
    const uniformTextures: BluePrintUniformTexture[] = [];
    for (const editor of editors) {
      const ir = this.createIR(editor);
      for (const u of ir.uniformValues) {
        const exists = uniformValues.find((v) => v.name === u.name);
        if (exists) {
          ASSERT(exists.type === u.type, 'Uniform with same name must have same type');
          if (editor === this.fragmentEditor) {
            exists.inFragmentShader = true;
          } else if (editor === this.vertexEditor) {
            exists.inVertexShader = true;
          }
          continue;
        }
        uniformValues.push({
          name: u.name,
          type: u.type,
          value: typeof u.value === 'number' ? [u.value] : [...u.value],
          inVertexShader: editor === this.vertexEditor,
          inFragmentShader: editor === this.fragmentEditor
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
          if (editor === this.fragmentEditor) {
            exists.inFragmentShader = true;
          } else if (editor === this.vertexEditor) {
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
          inVertexShader: editor === this.vertexEditor,
          inFragmentShader: editor === this.fragmentEditor
        });
      }
    }
    return {
      uniformValues,
      uniformTextures
    };
  }
  async load(path: string) {
    let blueprintState: { fragment: NodeEditorState; vertex: NodeEditorState } = null;
    this._isBlueprint = true;
    try {
      if (path) {
        const content = (await ProjectService.VFS.readFile(path, { encoding: 'utf8' })) as string;
        const data = JSON.parse(content);
        if (data.type === 'PBRBluePrintMaterial') {
          this._blueprintPath = data.data.IR as string;
          const blueprintContent = (await ProjectService.VFS.readFile(this._blueprintPath, {
            encoding: 'utf8'
          })) as string;
          const blueprintData = JSON.parse(blueprintContent);
          ASSERT(blueprintData.type === 'PBRMaterial', 'Invalid PBR Material BluePrint');
          blueprintState = blueprintData.state;
          this._isBlueprint = true;
        } else {
          const material = await ProjectService.serializationManager.deserializeObject<MeshMaterial>(
            null,
            data.data
          );
          this._editMaterial.set(material);
          this._previewMesh.get().material = material;
          this.propEditor.object = material;
          this._isBlueprint = false;
        }
      }
      if (this._isBlueprint) {
        const fragEditor = this.addTab('fragment');
        const fragBlock = fragEditor.addNode(new GNode(fragEditor, null, new PBRBlockNode()));
        fragBlock.title = this._outputName;
        fragBlock.locked = true;
        fragBlock.titleBg = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.5, 0.5, 0.28, 1));
        fragBlock.titleTextCol = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.1, 0.1, 0.1, 1));
        const vertexEditor = this.addTab('vertex');
        const vertexBlock = vertexEditor.addNode(new GNode(vertexEditor, null, new VertexBlockNode()));
        vertexBlock.title = this._outputName;
        vertexBlock.locked = true;
        vertexBlock.titleBg = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.5, 0.5, 0.28, 1));
        vertexBlock.titleTextCol = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.1, 0.1, 0.1, 1));
        fragEditor.on('changed', this.graphChanged, this);
        fragEditor.on('dragdrop', this.dragdropFrag, this);
        vertexEditor.on('changed', this.graphChanged, this);
        vertexEditor.on('dragdrop', this.dragdropVertex, this);
        if (blueprintState) {
          await fragEditor.loadState(blueprintState.fragment);
          await vertexEditor.loadState(blueprintState.vertex);
        }
        await this.applyPreviewMaterial();
        this._version = fragEditor.version;
      }
    } catch (err) {
      const msg = `Load material failed: ${err}`;
      console.error(msg);
      Dialog.messageBox('Error', msg);
    }
  }
  createIR(editor: NodeEditor) {
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
    const ir = new MaterialBlueprintIR(dag, randomUUID());
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
    return ProjectService.serializationManager.createBluePrintDAG(nodeMap, roots, editor.links);
  }
  renderNodeEditor() {
    if (this._isBlueprint) {
      super.renderNodeEditor();
    } else {
      const v = ImGui.GetContentRegionAvail();
      this.renderPreviewScene(v);
    }
  }
  protected renderRightPanel() {
    if (this._isBlueprint) {
      const v = new ImGui.ImVec2();
      ImGui.GetContentRegionAvail(v);
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
    if (!this._isBlueprint) {
      return;
    }
    const irFrag = this.createIR(this.fragmentEditor);
    const irVert = this.createIR(this.vertexEditor);
    /*
    const dag = this.createDAG();
    for (const [, v] of this.nodeEditor.nodes) {
      v.impl.reset();
    }
    let error = false;
    let ir: MaterialBlueprintIR = null;
    for (const i of dag.order) {
      const node = this.nodeEditor.nodes.get(i);
      node.impl.check();
      if (node.impl.error) {
        error = true;
      }
    }
    if (!error) {
      ir = new MaterialBlueprintIR(dag, randomUUID());
      if (!ir.ok) {
        ir = null;
        error = true;
      }
    }
    */
    if (!irFrag || !irVert) {
      this._previewMesh.get().material = this._defaultMaterial.get();
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
      uniformNames.clear();
      for (const i of irVert.DAG.order) {
        const node = this.vertexEditor.nodes.get(i);
        if (node.impl.isUniform && uniformNames.has(node.impl.paramName)) {
          node.impl.error = `Duplicated uniform name: ${node.impl.paramName}`;
          return;
        }
        uniformNames.add(node.impl.paramName);
      }
      const uniforms = this.getUniforms();
      for (const u of uniforms.uniformValues) {
        u.finalValue = u.value.length === 1 ? u.value[0] : new Float32Array(u.value);
      }
      for (const u of uniforms.uniformTextures) {
        const tex = await ProjectService.serializationManager.fetchTexture(u.texture, {
          linearColorSpace: !u.sRGB
        });
        u.finalTexture?.dispose();
        u.finalTexture = new DRef(tex);
      }
      const newMaterial = new PBRBluePrintMaterial(
        irFrag,
        irVert,
        uniforms.uniformValues,
        uniforms.uniformTextures
      );
      newMaterial.blendMode = this._blendMode;
      newMaterial.cullMode = this._doubleSided ? 'none' : 'back';
      newMaterial.doubleSidedLighting = !!this._doubleSided;
      this._editMaterial.set(newMaterial);
      this._previewMesh.get().material = newMaterial;
    }
  }
  protected onPropChanged(_obj: object, _prop: PropertyAccessor): void {
    this.applyPreviewMaterial();
  }
  protected onSelectionChanged(object: IGraphNode): void {
    if (!object) {
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
    }
  }
  private graphChanged() {
    if (this._isBlueprint) {
      this.applyPreviewMaterial();
    } else {
      this._version = 1;
    }
  }
  private dragdropFrag(x: number, y: number, _payload: { isDir: boolean; path: string }[]) {
    if (
      _payload.length === 1 &&
      guessMimeType(_payload[0].path) === 'application/vnd.zephyr3d.blueprint.mf+json'
    ) {
      ProjectService.serializationManager.loadBluePrint(_payload[0].path).then((IRs) => {
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
      ProjectService.serializationManager.loadBluePrint(_payload[0].path).then((IRs) => {
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
