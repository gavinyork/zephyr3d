import type {
  BlendMode,
  BlueprintDAG,
  ConstantTexture2DArrayNode,
  ConstantTexture2DNode,
  ConstantTextureCubeNode,
  IGraphNode,
  PropertyAccessor
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
import type { FrameBuffer } from '@zephyr3d/device';
import { getInputNodeCategories } from './inputs';
import { ProjectService } from '../../../core/services/project';
import { Dialog } from '../../../views/dlg/dlg';
import type { NodeEditor, NodeEditorState } from '../nodeeditor';

export class PBRMaterialEditor extends GraphEditor {
  private _previewScene: DRef<Scene>;
  private _previewMesh: DRef<Mesh>;
  private _defaultMaterial: DRef<UnlitMaterial>;
  private _framebuffer: DRef<FrameBuffer>;
  private _version: number;
  private _blendMode: BlendMode;
  private _doubleSided: boolean;
  constructor(label: string, outputName: string) {
    super(label, ['fragment', 'vertex']);
    const fragEditor = this.getNodeEditor('fragment');
    const fragBlock = fragEditor.addNode(new GNode(fragEditor, null, new PBRBlockNode()));
    fragBlock.title = outputName;
    fragBlock.locked = true;
    fragBlock.titleBg = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.5, 0.5, 0.28, 1));
    fragBlock.titleTextCol = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.1, 0.1, 0.1, 1));
    const vertexEditor = this.getNodeEditor('vertex');
    const vertexBlock = vertexEditor.addNode(new GNode(vertexEditor, null, new VertexBlockNode()));
    vertexBlock.title = outputName;
    vertexBlock.locked = true;
    vertexBlock.titleBg = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.5, 0.5, 0.28, 1));
    vertexBlock.titleTextCol = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.1, 0.1, 0.1, 1));

    const scene = new Scene();
    scene.env.light.type = 'ibl-sh';
    scene.env.sky.cameraHeightScale = 5000;
    const camera = new PerspectiveCamera(scene);
    camera.fovY = Math.PI / 3;
    camera.lookAt(new Vector3(0, 5, 10), Vector3.zero(), Vector3.axisPY());
    camera.controller = new OrbitCameraController();
    this._version = 0;
    this._previewScene = new DRef(scene);
    this._framebuffer = new DRef();
    const light = new DirectionalLight(scene);
    light.intensity = 10;
    light.sunLight = true;
    light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());
    const sphere = new SphereShape({ radius: 4, horizonalDetail: 50, verticalDetail: 50 });
    const defaultMat = new UnlitMaterial();
    defaultMat.albedoColor = new Vector4(1, 0, 1, 1);
    this._defaultMaterial = new DRef(defaultMat);
    const previewMesh = new Mesh(scene, sphere, this._defaultMaterial.get());
    this._previewMesh = new DRef(previewMesh);
    this._blendMode = 'none';
    this._doubleSided = false;
    this.applyPreviewMaterial();
    this.nodePropEditor.on('object_property_changed', this.graphChanged, this);
    fragEditor.on('changed', this.graphChanged, this);
    fragEditor.on('dragdrop', this.dragdropFrag, this);
    vertexEditor.on('changed', this.graphChanged, this);
    vertexEditor.on('dragdrop', this.dragdropVertex, this);
  }
  get fragmentEditor() {
    return this.getNodeEditor('fragment');
  }
  get vertexEditor() {
    return this.getNodeEditor('vertex');
  }
  open() {
    getApp().inputManager.useFirst(
      this._previewScene.get().mainCamera.handleEvent,
      this._previewScene.get().mainCamera
    );
  }
  close() {
    getApp().inputManager.unuse(
      this._previewScene.get().mainCamera.handleEvent,
      this._previewScene.get().mainCamera
    );
    this._previewScene.dispose();
    this._previewMesh.dispose();
    this._defaultMaterial.dispose();
    this.nodePropEditor.on('object_property_changed', this.graphChanged, this);
    this.fragmentEditor.off('changed', this.graphChanged, this);
    this.fragmentEditor.off('dragdrop', this.dragdropFrag, this);
    this.vertexEditor.off('changed', this.graphChanged, this);
    this.vertexEditor.off('dragdrop', this.dragdropFrag, this);
  }
  getNodeCategory(): NodeCategory[] {
    return [
      ...getConstantNodeCategories(),
      ...getInputNodeCategories(),
      ...getTextureNodeCategories(),
      ...getMathNodeCategories()
    ];
  }
  get saved() {
    return this._version === this.getNodeEditor('fragment').version;
  }
  async save(path: string) {
    if (path) {
      const VFS = ProjectService.VFS;
      const bpPath = VFS.normalizePath(
        VFS.join(VFS.dirname(path), `${VFS.basename(path, VFS.extname(path))}.zbpt`)
      );
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
      const editors = [this.fragmentEditor, this.vertexEditor];
      const content: {
        type: string;
        data: {
          IR: string;
          uniformValues: {
            name: string;
            id: number;
            value: number[];
          }[];
          uniformTextures: {
            name: string;
            id: number;
            texture: string;
            wrapS: string;
            wrapT: string;
            minFilter: string;
            magFilter: string;
            mipFilter: string;
          }[];
        };
      } = {
        type: 'PBRBluePrintMaterial',
        data: {
          IR: bpPath,
          uniformValues: [],
          uniformTextures: []
        }
      };
      for (const editor of editors) {
        const ir = this.createIR(editor);
        for (const u of ir.uniformValues) {
          const v = [...editor.nodes.values()].find((v) => v.impl === u.node);
          ASSERT(!!v, 'Uniform node not found');
          if (content.data.uniformValues.find((v) => v.name === u.name)) {
            continue;
          }
          content.data.uniformValues.push({
            name: u.name,
            id: v.id,
            value: typeof u.value === 'number' ? [u.value] : [...u.value]
          });
        }
        for (const u of ir.uniformTextures) {
          const texnode = u.node as
            | ConstantTexture2DNode
            | ConstantTexture2DArrayNode
            | ConstantTextureCubeNode;
          const v = [...editor.nodes.values()].find((v) => v.impl === u.node);
          ASSERT(!!v, 'Uniform node not found');
          if (content.data.uniformTextures.find((v) => v.name === u.name)) {
            continue;
          }
          content.data.uniformTextures.push({
            name: u.name,
            id: v.id,
            texture: texnode.textureId,
            wrapS: texnode.addressU,
            wrapT: texnode.addressV,
            minFilter: texnode.filterMin,
            magFilter: texnode.filterMag,
            mipFilter: texnode.filterMip
          });
        }
      }
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
    }
  }
  async load(path: string) {
    try {
      const content = (await ProjectService.VFS.readFile(path, { encoding: 'utf8' })) as string;
      const data = JSON.parse(content);
      ASSERT(data.type === 'PBRBluePrintMaterial', 'Invalid PBR Material BluePrint');
      const blueprint = data.data?.IR as string;
      const blueprintContent = (await ProjectService.VFS.readFile(blueprint, { encoding: 'utf8' })) as string;
      const blueprintData = JSON.parse(blueprintContent);
      ASSERT(blueprintData.type === 'PBRMaterial', 'Invalid PBR Material BluePrint');
      const state = blueprintData.state as { fragment: NodeEditorState; vertex: NodeEditorState };
      await this.fragmentEditor.loadState(state.fragment);
      await this.vertexEditor.loadState(state.vertex);
      this._version = this.fragmentEditor.version;
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
  protected renderRightPanel() {
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
      this._framebuffer.dispose();
    }
    if (!this._framebuffer.get()) {
      const tex = device.createTexture2D('rgba16f', size.x, size.y, {
        mipmapping: false
      });
      const depth = device.createTexture2D('d24s8', size.x, size.y);
      this._framebuffer.set(device.createFrameBuffer([tex], depth));
    }
    device.pushDeviceStates();
    device.setFramebuffer(this._framebuffer.get());
    this._previewScene.get().render();
    device.popDeviceStates();

    const camera = this._previewScene.get().mainCamera;
    const cursorScreenPos = ImGui.GetCursorScreenPos();
    camera.interactionRect = [
      cursorScreenPos.x,
      cursorScreenPos.y,
      size.x < 0 ? 0 : size.x,
      size.y < 0 ? 0 : size.y
    ];
    ImGui.Image(
      this._framebuffer.get().getColorAttachment(0),
      size,
      new ImGui.ImVec2(0, 1),
      new ImGui.ImVec2(1, 0)
    );
    camera.updateController();
  }
  private applyPreviewMaterial() {
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
      for (const u of [...irFrag.uniformValues, ...irFrag.uniformTextures]) {
        if (uniformNames.has(u.name)) {
          for (const i of irFrag.DAG.order) {
            const node = this.fragmentEditor.nodes.get(i);
            if (node.impl === u.node) {
              node.impl.error = `Duplicated uniform name: ${u.name}`;
              return;
            }
          }
        } else {
          uniformNames.add(u.name);
        }
      }
      uniformNames.clear();
      for (const u of [...irVert.uniformValues, ...irVert.uniformTextures]) {
        if (uniformNames.has(u.name)) {
          for (const i of irVert.DAG.order) {
            const node = this.vertexEditor.nodes.get(i);
            if (node.impl === u.node) {
              node.impl.error = `Duplicated uniform name: ${u.name}`;
              return;
            }
          }
        } else {
          uniformNames.add(u.name);
        }
      }
      const newMaterial = new PBRBluePrintMaterial(irFrag, irVert);
      newMaterial.blendMode = this._blendMode;
      newMaterial.cullMode = this._doubleSided ? 'none' : 'back';
      newMaterial.doubleSidedLighting = !!this._doubleSided;
      this._previewMesh.get().material = newMaterial;
    }
  }
  protected onPropChanged(_obj: object, _prop: PropertyAccessor): void {
    this.applyPreviewMaterial();
  }
  protected onSelectionChanged(object: IGraphNode): void {
    if (!object) {
      this.nodePropEditor.root.addRawProperty(
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
      this.nodePropEditor.root.addRawProperty(
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
    this.applyPreviewMaterial();
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
