import type { Scene } from '@zephyr3d/scene';
import { Camera } from '@zephyr3d/scene';
import {
  BaseLight,
  BatchGroup,
  ClipmapTerrain,
  Mesh,
  ParticleSystem,
  SceneNode,
  Water
} from '@zephyr3d/scene';
import { TreeViewData, TreeView } from './treeview';
import { ImGui } from '@zephyr3d/imgui';
import { convertEmojiString } from '../helpers/emoji';

class SceneData extends TreeViewData<SceneNode> {
  private _scene: Scene;
  constructor(scene: Scene) {
    super();
    this._scene = scene;
  }
  getRoot(): SceneNode {
    return this._scene.rootNode;
  }
  getChildren(parent: SceneNode): SceneNode[] {
    return parent?.children?.map((c) => c.get()).filter((c) => !c.sealed) ?? [];
  }
  getParent(node: SceneNode): SceneNode {
    return node.parent;
  }
  getId(node: SceneNode): string {
    return String(node.runtimeId);
  }
  getNodeName(node: SceneNode, forceUpdate: boolean): string {
    if (node instanceof SceneNode) {
      if (node === node.scene.rootNode) {
        return `${node.scene.name || 'Scene'}${forceUpdate ? ' (Unsaved)' : ''}`;
      }
      let emoj: string;
      if (node instanceof Mesh) {
        emoj = '🧊';
      } else if (node instanceof Water) {
        emoj = '🌊';
      } else if (node instanceof ClipmapTerrain) {
        emoj = '⛰️';
      } else if (node instanceof ParticleSystem) {
        emoj = '✨';
      } else if (node instanceof BaseLight) {
        emoj = '💡';
      } else if (node instanceof Camera) {
        emoj = '🎥';
      } else {
        emoj = '🟪';
      }
      return convertEmojiString(`${emoj}${node.name || '(noname)'}`);
    }
    return '(unknown)';
  }
  getDragSourcePayloadType(): string {
    return 'NODE';
  }
  getDragSourcePayload(node: SceneNode): unknown {
    return node;
  }
  getDragTargetPayloadType(): string {
    return 'NODE';
  }
}

export class SceneHierarchy extends TreeView<
  {
    node_deselected: [node: SceneNode];
    node_selected: [node: SceneNode];
    node_request_delete: [node: SceneNode];
    node_double_clicked: [node: SceneNode];
    node_drag_drop: [from: SceneNode, target: SceneNode];
    set_main_camera: [camea: Camera];
    request_add_child: [node: SceneNode, ctor: { new (scene: Scene): SceneNode }];
    request_save_prefab: [node: SceneNode];
  },
  SceneNode
> {
  private _scene: Scene;
  constructor(scene) {
    super('###SceneHierarchyInner', new SceneData(scene));
    this._scene = scene;
  }
  get scene() {
    return this._scene;
  }
  set scene(scene: Scene) {
    if (this._scene !== scene) {
      this.selectNode(null);
      this._scene = scene;
      this.invalidate();
    }
  }
  protected onNodeDeselected(node: SceneNode) {
    this.dispatchEvent('node_deselected', node);
  }
  protected onNodeSelected(node: SceneNode) {
    this.dispatchEvent('node_selected', node);
  }
  protected onNodeDblClicked(node: SceneNode) {
    this.dispatchEvent('node_double_clicked', node);
  }
  protected onGetContextMenuId(node: SceneNode): string {
    return `context_${node.runtimeId}`;
  }
  protected onDrawContextMenu(node: SceneNode, _menuId: string) {
    if (node !== this._scene.rootNode) {
      if (ImGui.MenuItem('Delete', 'Delete')) {
        this.dispatchEvent('node_request_delete', node);
      }
      ImGui.Separator();
    }
    if (ImGui.MenuItem('Create Batch Group')) {
      this.dispatchEvent('request_add_child', node, BatchGroup);
    }
    ImGui.Separator();
    if (ImGui.MenuItem('Create Empty Node')) {
      this.dispatchEvent('request_add_child', node, SceneNode);
    }
    ImGui.Separator();
    if (ImGui.MenuItem('Create Prefab...')) {
      this.dispatchEvent('request_save_prefab', node);
    }
    const animationSet = node.animationSet;
    if (animationSet && animationSet.getAnimationNames().length > 0) {
      ImGui.Separator();
      if (ImGui.BeginMenu('Animation')) {
        ImGui.PushID(node.runtimeId);
        for (let i = 0; i < animationSet.getAnimationNames().length; i++) {
          if (i > 0) {
            ImGui.Separator();
          }
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

    if (node.isCamera() && node !== node.scene.mainCamera) {
      ImGui.Separator();
      if (ImGui.MenuItem('Make Active')) {
        this.dispatchEvent('set_main_camera', node);
      }
    }
  }
  protected onDragDrop(node: SceneNode, _type: string, payload: unknown) {
    this.dispatchEvent('node_drag_drop', payload as SceneNode, node);
  }
}
