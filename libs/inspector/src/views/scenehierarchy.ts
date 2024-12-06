import { makeEventTarget } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';
import type { Scene } from '@zephyr3d/scene';
import { GraphNode, Mesh, ParticleSystem, SceneNode, Terrain } from '@zephyr3d/scene';

type ClassInfo = {
  classname: string;
};

export class SceneHierarchy extends makeEventTarget(Object)<{
  node_deselected: [node: SceneNode];
  node_selected: [node: SceneNode];
  node_request_delete: [node: SceneNode];
  node_drag_drop: [from: SceneNode, target: SceneNode];
}>() {
  private static classInfo: Map<Function, ClassInfo> = new Map([
    [SceneNode, { classname: 'SceneNode' }],
    [GraphNode, { classname: 'GraphNode' }],
    [Mesh, { classname: 'Mesh' }],
    [Terrain, { classname: 'Terrain' }],
    [ParticleSystem, { classname: 'ParticleSystem' }]
  ]);
  private static baseFlags = ImGui.TreeNodeFlags.OpenOnArrow | ImGui.TreeNodeFlags.SpanAvailWidth;
  private _scene: Scene;
  private _selectedNode: SceneNode;
  constructor(scene: Scene) {
    super();
    this._scene = scene;
    this._selectedNode = null;
  }
  render() {
    this.renderSceneNode(this._scene.rootNode);
  }
  private renderSceneNode(node: SceneNode) {
    const cls = SceneHierarchy.classInfo.get(node.constructor) ?? SceneHierarchy.classInfo.get(SceneNode);
    const label = `${node.name || cls.classname}##${node.id}`;
    let flags = SceneHierarchy.baseFlags;
    if (this._selectedNode === node) {
      flags |= ImGui.TreeNodeFlags.Selected;
    }
    if (node.children.length === 0) {
      flags |= ImGui.TreeNodeFlags.Leaf;
    }
    const isOpen = ImGui.TreeNodeEx(label, flags);
    if (ImGui.IsItemClicked(ImGui.MouseButton.Left)) {
      if (this._selectedNode !== node) {
        if (this._selectedNode) {
          this.dispatchEvent('node_deselected', this._selectedNode);
        }
        this._selectedNode = node;
        this.dispatchEvent('node_selected', this._selectedNode);
      }
    }
    if (ImGui.IsItemClicked(ImGui.MouseButton.Right)) {
      ImGui.OpenPopup(`context_${node.id}`);
    }
    if (ImGui.BeginPopup(`context_${node.id}`)) {
      if (ImGui.MenuItem('Delete')) {
        this.dispatchEvent('node_request_delete', node);
      }
      ImGui.EndPopup();
    }
    if (ImGui.BeginDragDropSource()) {
      if (node !== this._scene.rootNode) {
        ImGui.SetDragDropPayload('NODE', node);
      }
      ImGui.EndDragDropSource();
    }
    if (ImGui.BeginDragDropTarget()) {
      const payload = ImGui.AcceptDragDropPayload('NODE') as unknown as SceneNode;
      if (payload) {
        this.dispatchEvent('node_drag_drop', payload, node);
      }
      ImGui.EndDragDropTarget();
    }
    if (isOpen) {
      for (const child of node.children) {
        this.renderSceneNode(child);
      }
      ImGui.TreePop();
    }
  }
}
