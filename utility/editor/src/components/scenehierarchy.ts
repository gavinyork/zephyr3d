import { makeEventTarget } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';
import type { AssetRegistry, Scene, SceneNode, SerializableClass } from '@zephyr3d/scene';
import { getSerializationInfo } from '@zephyr3d/scene';
import { eventBus } from '../core/eventbus';

export class SceneHierarchy extends makeEventTarget(Object)<{
  node_deselected: [node: SceneNode];
  node_selected: [node: SceneNode];
  node_request_delete: [node: SceneNode];
  node_double_clicked: [node: SceneNode];
  node_drag_drop: [from: SceneNode, target: SceneNode];
}>() {
  private static baseFlags = ImGui.TreeNodeFlags.OpenOnArrow | ImGui.TreeNodeFlags.SpanAvailWidth;
  private _scene: Scene;
  private _selectedNode: SceneNode;
  private _assetRegistry: AssetRegistry;
  constructor(scene: Scene, assetRegistry: AssetRegistry) {
    super();
    this._scene = scene;
    this._selectedNode = null;
    this._assetRegistry = assetRegistry;
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
  private renderSceneNode(node: SceneNode) {
    const serializationInfo = getSerializationInfo(this._assetRegistry);
    let cls: SerializableClass = null;
    let ctor = node.constructor;
    while (!cls) {
      cls = serializationInfo.get(ctor);
      ctor = Object.getPrototypeOf(ctor);
    }
    const label = `${(node === node.scene.rootNode ? 'Scene' : node.name) || cls.className}##${node.id}`;
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
      ImGui.OpenPopup(`context_${node.id}`);
    }
    if (node !== this._scene.rootNode) {
      if (ImGui.BeginPopup(`context_${node.id}`)) {
        const animationSet = node.animationSet;
        if (animationSet && animationSet.getAnimationNames().length > 0) {
          if (ImGui.BeginMenu('Animation')) {
            ImGui.PushID(node.id);
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
        if (ImGui.MenuItem('Delete')) {
          this.dispatchEvent('node_request_delete', node);
        }
        ImGui.EndPopup();
      }
    } else {
      if (ImGui.BeginPopup(`context_${node.id}`)) {
        if (ImGui.MenuItem('Create static batch')) {
          eventBus.dispatchEvent('scene_add_batch');
        }
        ImGui.EndPopup();
      }
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
