import type { BlueprintDAG, IGraphNode } from '@zephyr3d/scene';
import {
  DirectionalLight,
  getDevice,
  Mesh,
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
import { DRef, randomUUID, Vector3, Vector4 } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';
import type { FrameBuffer } from '@zephyr3d/device';

export class PBRMaterialEditor extends GraphEditor {
  private _outputNodeId: number;
  private _previewScene: DRef<Scene>;
  private _previewMesh: DRef<Mesh>;
  private _defaultMaterial: DRef<UnlitMaterial>;
  private _framebuffer: DRef<FrameBuffer>;
  constructor() {
    super();
    const block = this.nodeEditor.addNode(new GNode(this.nodeEditor, null, new PBRBlockNode()));
    block.locked = true;
    this._outputNodeId = block.id;
    this.nodeEditor.on('changed', this.graphChanged, this);
    const scene = new Scene();
    scene.env.light.type = 'ibl-sh';
    const camera = new PerspectiveCamera(scene);
    camera.fovY = Math.PI / 3;
    camera.lookAt(new Vector3(0, 0, 10), Vector3.zero(), Vector3.axisPY());
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
  }

  getNodeCategory(): NodeCategory[] {
    return [...getConstantNodeCategories(), ...getTextureNodeCategories(), ...getMathNodeCategories()];
  }
  createDAG(): BlueprintDAG {
    const nodeMap: Record<number, IGraphNode> = {};
    for (const [k, v] of this.nodeEditor.nodes) {
      nodeMap[k] = v.impl;
    }
    return {
      graph: this.nodeEditor.graph,
      nodeMap,
      roots: [this._outputNodeId],
      order: this.nodeEditor.getReverseTopologicalOrderFromRoots([this._outputNodeId]).order.reverse()
    };
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
        samplerOptions: { mipFilter: 'none' }
      });
      const depth = device.createTexture2D('d24s8', size.x, size.y);
      this._framebuffer.set(device.createFrameBuffer([tex], depth));
    }
    device.pushDeviceStates();
    device.setFramebuffer(this._framebuffer.get());
    this._previewScene.get().render();
    device.popDeviceStates();

    ImGui.Image(
      this._framebuffer.get().getColorAttachment(0),
      size,
      new ImGui.ImVec2(0, 1),
      new ImGui.ImVec2(1, 0)
    );
  }
  private applyPreviewMaterial() {
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
    if (error) {
      this._previewMesh.get().material = this._defaultMaterial.get();
    } else {
      const ir = new MaterialBlueprintIR(dag, randomUUID());
      this._previewMesh.get().material = new PBRBluePrintMaterial(ir);
    }
  }
  private graphChanged() {
    this.applyPreviewMaterial();
  }
}
