import { makeEventTarget } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';
import type { Scene, SceneNode, SerializableClass } from '@zephyr3d/scene';
import { nodeSerializationInfo } from '@zephyr3d/scene';

export class SceneHierarchy extends makeEventTarget(Object)<{
  node_deselected: [node: SceneNode];
  node_selected: [node: SceneNode];
  node_request_delete: [node: SceneNode];
  node_drag_drop: [from: SceneNode, target: SceneNode];
}>() {
  private static baseFlags = ImGui.TreeNodeFlags.OpenOnArrow | ImGui.TreeNodeFlags.SpanAvailWidth;
  private _scene: Scene;
  private _selectedNode: SceneNode;
  constructor(scene: Scene) {
    super();
    this._scene = scene;
    this._selectedNode = null;
  }
  get scene() {
    return this._scene;
  }
  render() {
    this.renderSceneNode(this._scene.rootNode);
  }
  selectNode(node: SceneNode) {
    if (this._selectedNode !== node) {
      if (this._selectedNode) {
        this.dispatchEvent('node_deselected', this._selectedNode);
      }
      this._selectedNode = node;
      if (this._selectedNode) {
        this.dispatchEvent('node_selected', this._selectedNode);
      }
    }
  }
  private renderSceneNode(node: SceneNode) {
    let cls: SerializableClass = null;
    let ctor = node.constructor;
    while (!cls) {
      cls = nodeSerializationInfo.get(ctor);
      ctor = Object.getPrototypeOf(ctor);
    }
    const label = `${node.name || cls.className}##${node.id}`;
    let flags = SceneHierarchy.baseFlags;
    if (this._selectedNode === node) {
      flags |= ImGui.TreeNodeFlags.Selected;
    }
    if (node.sealed || node.children.length === 0) {
      flags |= ImGui.TreeNodeFlags.Leaf;
    }
    const isOpen = ImGui.TreeNodeEx(label, flags);
    if (ImGui.IsItemClicked(ImGui.MouseButton.Left)) {
      this.selectNode(node);
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
    if (ImGui.BeginDragDropTarget()) {
      const payload = ImGui.AcceptDragDropPayload('NODE');
      if (payload) {
        this.dispatchEvent('node_drag_drop', payload.Data as SceneNode, node);
      }
      ImGui.EndDragDropTarget();
    }
    if (ImGui.BeginDragDropSource()) {
      if (node !== this._scene.rootNode) {
        ImGui.SetDragDropPayload('NODE', node);
      }
      ImGui.EndDragDropSource();
    }
    if (isOpen) {
      if (!node.sealed) {
        for (const child of node.children) {
          this.renderSceneNode(child);
        }
      }
      ImGui.TreePop();
    }
  }
}
