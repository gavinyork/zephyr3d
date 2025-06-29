import type { GenericConstructor } from '@zephyr3d/base';
import { makeEventTarget } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';
import type { Scene, SerializableClass, SerializationManager } from '@zephyr3d/scene';
import { SceneNode } from '@zephyr3d/scene';
import { BatchGroup } from '@zephyr3d/scene';

export class SceneHierarchy extends makeEventTarget(Object)<{
  node_deselected: [node: SceneNode];
  node_selected: [node: SceneNode];
  node_request_delete: [node: SceneNode];
  node_double_clicked: [node: SceneNode];
  node_drag_drop: [from: SceneNode, target: SceneNode];
  request_add_child: [node: SceneNode, ctor: { new (scene: Scene): SceneNode }];
}>() {
  private static baseFlags = ImGui.TreeNodeFlags.OpenOnArrow | ImGui.TreeNodeFlags.SpanAvailWidth;
  private _scene: Scene;
  private _selectedNode: SceneNode;
  private _serializationManager: SerializationManager;
  constructor(scene: Scene, serializationManager: SerializationManager) {
    super();
    this._scene = scene;
    this._selectedNode = null;
    this._serializationManager = serializationManager;
  }
  get scene() {
    return this._scene;
  }
  set scene(scene: Scene) {
    if (this._scene !== scene) {
      this.selectNode(null);
      this._scene = scene;
    }
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
  get selectedNode() {
    return this._selectedNode;
  }
  private getNodeName(node: unknown): string {
    if (node instanceof SceneNode) {
      if (node === node.scene.rootNode) {
        return 'Scene';
      }
      if (node.name) {
        return node.name;
      }
    }
    let cls: SerializableClass = null;
    let ctor = node.constructor as GenericConstructor;
    while (!cls) {
      cls = this._serializationManager.getClassByConstructor(ctor);
      ctor = Object.getPrototypeOf(ctor);
    }
    return cls.ctor.name;
  }
  private renderSceneNode(node: SceneNode) {
    let cls: SerializableClass = null;
    let ctor = node.constructor as GenericConstructor;
    while (!cls) {
      cls = this._serializationManager.getClassByConstructor(ctor);
      ctor = Object.getPrototypeOf(ctor);
    }
    const label = `${this.getNodeName(node)}##${node.persistentId}`;
    let flags = SceneHierarchy.baseFlags;
    if (this._selectedNode === node) {
      flags |= ImGui.TreeNodeFlags.Selected;
    }
    const leaf = node.children.findIndex((val) => !val.get().sealed) < 0;
    if (leaf) {
      flags |= ImGui.TreeNodeFlags.Leaf;
    }
    const isOpen = ImGui.TreeNodeEx(label, flags);
    if (ImGui.IsItemClicked(ImGui.MouseButton.Left)) {
      this.selectNode(node);
    }
    if (ImGui.IsItemHovered() && ImGui.IsMouseDoubleClicked(ImGui.MouseButton.Left)) {
      this.dispatchEvent('node_double_clicked', node);
    }
    if (ImGui.IsItemClicked(ImGui.MouseButton.Right)) {
      ImGui.OpenPopup(`context_${node.persistentId}`);
    }
    if (ImGui.BeginPopup(`context_${node.persistentId}`)) {
      if (node !== this._scene.rootNode) {
        if (ImGui.MenuItem('Delete', 'Delete')) {
          this.dispatchEvent('node_request_delete', node);
        }
      }
      if (ImGui.MenuItem('Create static batch')) {
        this.dispatchEvent('request_add_child', node, BatchGroup);
      }
      if (ImGui.MenuItem('Create group')) {
        this.dispatchEvent('request_add_child', node, SceneNode);
      }
      const animationSet = node.animationSet;
      if (animationSet && animationSet.getAnimationNames().length > 0) {
        if (ImGui.BeginMenu('Animation')) {
          ImGui.PushID(node.persistentId);
          for (let i = 0; i < animationSet.getAnimationNames().length; i++) {
            ImGui.PushID(i);
            const name = animationSet.getAnimationNames()[i];
            const playing = animationSet.isPlayingAnimation(name);
            if (ImGui.MenuItem(name, null, playing)) {
              if (playing) {
                animationSet.stopAnimation(name);
              } else {
                for (const ani of animationSet.getAnimationNames()) {
                  if (ani !== name) {
                    animationSet.stopAnimation(ani);
                  } else {
                    animationSet.playAnimation(ani);
                  }
                }
              }
            }
            ImGui.PopID();
          }
          ImGui.PopID();
          ImGui.EndMenu();
        }
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
      if (!leaf) {
        for (const child of node.children) {
          if (!child.get().sealed) {
            this.renderSceneNode(child.get());
          }
        }
      }
      ImGui.TreePop();
    }
  }
}
