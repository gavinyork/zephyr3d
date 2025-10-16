import type {
  BlueprintDAG,
  ConstantTexture2DArrayNode,
  ConstantTexture2DNode,
  ConstantTextureCubeNode,
  IGraphNode,
  PropertyAccessor
} from '@zephyr3d/scene';
import {
  DirectionalLight,
  getApp,
  getDevice,
  Mesh,
  OrbitCameraController,
  PerspectiveCamera,
  Scene,
  SphereShape,
  UnlitMaterial
} from '@zephyr3d/scene';
import { MaterialBlueprintIR, PBRBlockNode, PBRBluePrintMaterial } from '@zephyr3d/scene';
import type { NodeCategory } from '../api';
import { GraphEditor } from '../grapheditor';
import { getConstantNodeCategories } from '../nodes/constants';
import { getMathNodeCategories } from '../nodes/math';
import { getTextureNodeCategories } from './texture';
import { GNode } from '../node';
import { ASSERT, DRef, randomUUID, Vector3, Vector4 } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';
import type { FrameBuffer } from '@zephyr3d/device';
import { getInputNodeCategories } from './inputs';
import { ProjectService } from '../../../core/services/project';
import { Dialog } from '../../../views/dlg/dlg';
import type { NodeEditorState } from '../nodeeditor';

export class PBRMaterialEditor extends GraphEditor {
  private _previewScene: DRef<Scene>;
  private _previewMesh: DRef<Mesh>;
  private _defaultMaterial: DRef<UnlitMaterial>;
  private _framebuffer: DRef<FrameBuffer>;
  private _version: number;
  constructor(label: string, outputName: string) {
    super(label);
    const block = this.nodeEditor.addNode(new GNode(this.nodeEditor, null, new PBRBlockNode()));
    block.title = outputName;
    block.locked = true;
    block.titleBg = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.5, 0.5, 0.28, 1));
    block.titleTextCol = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.1, 0.1, 0.1, 1));
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
    const sphere = new SphereShape({ radius: 4 });
    const defaultMat = new UnlitMaterial();
    defaultMat.albedoColor = new Vector4(1, 0, 1, 1);
    this._defaultMaterial = new DRef(defaultMat);
    const previewMesh = new Mesh(scene, sphere, this._defaultMaterial.get());
    this._previewMesh = new DRef(previewMesh);
    this.applyPreviewMaterial();
    this.nodePropEditor.on('object_property_changed', this.graphChanged, this);
    this.nodeEditor.on('changed', this.graphChanged, this);
    this.nodeEditor.on('save', this.save, this);
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
    return this._version === this.nodeEditor.version;
  }
  async save(path: string) {
    if (path) {
      const VFS = ProjectService.VFS;
      const bpPath = VFS.normalizePath(
        VFS.join(VFS.dirname(path), `${VFS.basename(path, VFS.extname(path))}.zbpt`)
      );
      // Save blueprint
      const state = await this.nodeEditor.saveState();
      try {
        await VFS.writeFile(bpPath, JSON.stringify({ type: 'PBRMaterial', state }, null, '  '), {
          encoding: 'utf8',
          create: true
        });
      } catch (err) {
        const msg = `Save material failed: ${err}`;
        console.error(msg);
        Dialog.messageBox('Error', msg);
      }
      // Save material
      const ir = this.createIR();
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
      for (const u of ir.uniformValues) {
        const v = [...this.nodeEditor.nodes.values()].find((v) => v.impl === u.node);
        ASSERT(!!v, 'Uniform node not found');
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
        const v = [...this.nodeEditor.nodes.values()].find((v) => v.impl === u.node);
        ASSERT(!!v, 'Uniform node not found');
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
      try {
        await VFS.writeFile(path, JSON.stringify(content, null, '  '), {
          encoding: 'utf8',
          create: true
        });
      } catch (err) {
        const msg = `Save material failed: ${err}`;
        console.error(msg);
        Dialog.messageBox('Error', msg);
      }
      this._version = this.nodeEditor.version;
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
      const state = blueprintData.state as NodeEditorState;
      await this.nodeEditor.loadState(state);
      this._version = this.nodeEditor.version;
    } catch (err) {
      const msg = `Load material failed: ${err}`;
      console.error(msg);
      Dialog.messageBox('Error', msg);
    }
  }
  createIR() {
    const dag = this.createDAG();
    for (const [, v] of this.nodeEditor.nodes) {
      v.impl.reset();
    }
    for (const i of dag.order) {
      const node = this.nodeEditor.nodes.get(i);
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
  createDAG(): BlueprintDAG {
    const nodeMap: Record<number, IGraphNode> = {};
    const roots: number[] = [];
    for (const [k, v] of this.nodeEditor.nodes) {
      nodeMap[k] = v.impl;
      if (v.outputs.length === 0) {
        roots.push(v.id);
      }
    }
    return ProjectService.serializationManager.createBluePrintDAG(nodeMap, roots, this.nodeEditor.links);
    /*
    return {
      graph: this.nodeEditor.graph,
      nodeMap,
      roots,
      order: this.nodeEditor.getReverseTopologicalOrderFromRoots(roots).order.reverse()
    };
    */
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
    const ir = this.createIR();
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
    if (!ir) {
      this._previewMesh.get().material = this._defaultMaterial.get();
    } else {
      const uniformNames: Set<string> = new Set();
      for (const u of [...ir.uniformValues, ...ir.uniformTextures]) {
        if (uniformNames.has(u.name)) {
          for (const i of ir.DAG.order) {
            const node = this.nodeEditor.nodes.get(i);
            if (node.impl === u.node) {
              node.impl.error = `Duplicated uniform name: ${u.name}`;
              return;
            }
          }
        } else {
          uniformNames.add(u.name);
        }
      }
      this._previewMesh.get().material = new PBRBluePrintMaterial(ir);
    }
  }
  protected onPropChanged(_obj: object, _prop: PropertyAccessor): void {
    this.applyPreviewMaterial();
  }
  private graphChanged() {
    this.applyPreviewMaterial();
  }
}
