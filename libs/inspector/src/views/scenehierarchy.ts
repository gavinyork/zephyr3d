import { makeEventTarget } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';
import type { Scene, SerializableClass, SceneNode } from '@zephyr3d/scene';
import { getSerializationInfo } from '@zephyr3d/scene';
import { DockPannel } from './dockpanel';

export class SceneHierarchy extends makeEventTarget(Object)<{
  node_deselected: [node: SceneNode];
  node_selected: [node: SceneNode];
  node_request_delete: [node: SceneNode];
  node_drag_drop: [from: SceneNode, target: SceneNode];
}>() {
  private static baseFlags = ImGui.TreeNodeFlags.OpenOnArrow | ImGui.TreeNodeFlags.SpanAvailWidth;
  private _scene: Scene;
  private _selectedNode: SceneNode;
  private _panel: DockPannel;
  constructor(scene: Scene) {
    super();
    this._scene = scene;
    this._selectedNode = null;
    this._panel = new DockPannel(true, true, true, 8, 300, 200, 600);
  }
  render() {
    if (this._panel.begin('SceneHierarchy')) {
      this.renderSceneNode(this._scene.rootNode);
      this._panel.end();
    }
  }
  private renderSceneNode(node: SceneNode) {
    const serializationInfo = getSerializationInfo(null);
    let cls: SerializableClass = null;
    let ctor = node.constructor;
    while (!cls) {
      cls = serializationInfo.get(ctor);
      ctor = Object.getPrototypeOf(ctor);
    }
    const label = `${node.name || cls.className}##${node.id}`;
    let flags = SceneHierarchy.baseFlags;
    if (this._selectedNode === node) {
      flags |= ImGui.TreeNodeFlags.Selected;
    }
    if (node.children.length === 0) {
      flags |= ImGui.TreeNodeFlags.Leaf;
    }
    if (!node.parent) {
      flags |= ImGui.TreeNodeFlags.DefaultOpen;
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
      const payload = ImGui.AcceptDragDropPayload('NODE');
      if (payload) {
        this.dispatchEvent('node_drag_drop', payload.Data as SceneNode, node);
      }
      ImGui.EndDragDropTarget();
    }
    if (isOpen) {
      for (const child of node.children) {
        this.renderSceneNode(child.get());
      }
      ImGui.TreePop();
    }
  }
}
