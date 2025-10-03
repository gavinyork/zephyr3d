import type { Camera, Scene, SerializableClass } from '@zephyr3d/scene';
import { BatchGroup, SceneNode } from '@zephyr3d/scene';
import { TreeData, TreeView } from './treeview';
import type { GenericConstructor } from '@zephyr3d/base';
import { ProjectService } from '../core/services/project';
import { ImGui } from '@zephyr3d/imgui';

class SceneData extends TreeData<SceneNode> {
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
    return node.persistentId;
  }
  getNodeName(node: SceneNode, forceUpdate: boolean): string {
    if (node instanceof SceneNode) {
      if (node === node.scene.rootNode) {
        return `${node.scene.name || 'Scene'}${forceUpdate ? ' (Unsaved)' : ''}`;
      }
      if (node.name) {
        return node.name;
      }
    }
    let cls: SerializableClass = null;
    let ctor = (node as any).constructor as GenericConstructor;
    while (!cls) {
      cls = ProjectService.serializationManager.getClassByConstructor(ctor);
      ctor = Object.getPrototypeOf(ctor);
    }
    return cls.name;
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
    return `context_${node.persistentId}`;
  }
  protected onDrawContextMenu(node: SceneNode, _menuId: string) {
    if (node !== this._scene.rootNode) {
      if (ImGui.MenuItem('Delete', 'Delete')) {
        this.dispatchEvent('node_request_delete', node);
      }
      ImGui.Separator();
    }
    if (ImGui.MenuItem('Create static batch')) {
      this.dispatchEvent('request_add_child', node, BatchGroup);
    }
    ImGui.Separator();
    if (ImGui.MenuItem('Create group')) {
      this.dispatchEvent('request_add_child', node, SceneNode);
    }

    const animationSet = node.animationSet;
    if (animationSet && animationSet.getAnimationNames().length > 0) {
      ImGui.Separator();
      if (ImGui.BeginMenu('Animation')) {
        ImGui.PushID(node.persistentId);
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
/*
import type { GenericConstructor } from '@zephyr3d/base';
import { Observable } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';
import type { Camera, Scene, SerializableClass } from '@zephyr3d/scene';
import { SceneNode } from '@zephyr3d/scene';
import { BatchGroup } from '@zephyr3d/scene';
import { ProjectService } from '../core/services/project';

type VisibleRow = {
  node: SceneNode;
  depth: number;
  leaf: boolean;
  defaultOpen: boolean;
};

export class SceneHierarchy extends Observable<{
  node_deselected: [node: SceneNode];
  node_selected: [node: SceneNode];
  node_request_delete: [node: SceneNode];
  node_double_clicked: [node: SceneNode];
  node_drag_drop: [from: SceneNode, target: SceneNode];
  set_main_camera: [camea: Camera];
  request_add_child: [node: SceneNode, ctor: { new (scene: Scene): SceneNode }];
}> {
  private static readonly baseFlags = ImGui.TreeNodeFlags.OpenOnArrow | ImGui.TreeNodeFlags.SpanAvailWidth;

  private _scene: Scene;
  private _selectedNode: SceneNode;
  private _openState: Map<string, boolean>; // key = node.persistentId
  private _visibleRows: VisibleRow[];
  private _visibleDirty: boolean;
  private _draggingItem: boolean;
  private _clipper: ImGui.ListClipper;

  constructor(scene: Scene) {
    super();
    this._scene = scene;
    this._selectedNode = null;
    this._openState = new Map();
    this._visibleRows = [];
    this._visibleDirty = true;
    this._draggingItem = false;
    this._clipper = new ImGui.ListClipper();
  }

  get scene() {
    return this._scene;
  }

  get draggingItem() {
    return this._draggingItem;
  }
  set scene(scene: Scene) {
    if (this._scene !== scene) {
      this.selectNode(null);
      this._scene = scene;
      this._openState.clear();
      this._visibleDirty = true;
    }
  }

  render(sceneChanged: boolean) {
    if (this._visibleDirty || sceneChanged) {
      this.rebuildVisible(sceneChanged);
      this._visibleDirty = false;
    }
    const flags = this._draggingItem ? ImGui.WindowFlags.NoScrollbar : 0;
    ImGui.BeginChild('###SceneHierarchyInner', ImGui.GetContentRegionAvail(), false, flags);
    this._draggingItem = false;
    const rowH = ImGui.GetTextLineHeightWithSpacing();
    const total = this._visibleRows.length;
    this._clipper.Begin(total, rowH);
    while (this._clipper.Step()) {
      for (let i = this._clipper.DisplayStart; i < this._clipper.DisplayEnd; i++) {
        const row = this._visibleRows[i];
        this.renderRow(row, sceneChanged, rowH);
      }
    }
    this._clipper.End();
    this.handleAutoScrollWhileDragging();
    ImGui.EndChild();
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

  private getNodeName(node: unknown, sceneChanged: boolean): string {
    if (node instanceof SceneNode) {
      if (node === node.scene.rootNode) {
        return `${node.scene.name || 'Scene'}${sceneChanged ? ' (Unsaved)' : ''}`;
      }
      if (node.name) {
        return node.name;
      }
    }
    let cls: SerializableClass = null;
    let ctor = (node as any).constructor as GenericConstructor;
    while (!cls) {
      cls = ProjectService.serializationManager.getClassByConstructor(ctor);
      ctor = Object.getPrototypeOf(ctor);
    }
    return cls.name;
  }

  private rebuildVisible(_sceneChanged: boolean) {
    const out: VisibleRow[] = [];
    const root = this._scene.rootNode;

    const dfs = (node: SceneNode, depth: number) => {
      const leaf = node.children.findIndex((val) => !val.get().sealed) < 0;
      const defaultOpen = !node.parent;
      out.push({
        node,
        depth,
        leaf,
        defaultOpen
      });
      const id = node.persistentId;
      const isOpen = this.isNodeOpen(id, defaultOpen);
      if (isOpen && !leaf) {
        for (const child of node.children) {
          const c = child.get();
          if (!c.sealed) {
            dfs(c, depth + 1);
          }
        }
      }
    };

    dfs(root, 0);
    this._visibleRows = out;
  }

  private isNodeOpen(id: string, defaultOpen: boolean): boolean {
    const v = this._openState.get(id);
    return v !== undefined ? v : defaultOpen;
  }

  private toggleNodeOpen(id: string, defaultOpen: boolean) {
    const now = this.isNodeOpen(id, defaultOpen);
    this._openState.set(id, !now);
    this._visibleDirty = true;
  }

  private renderRow(row: VisibleRow, sceneChanged: boolean, _rowH: number) {
    const node = row.node;
    const label = `${this.getNodeName(node, sceneChanged)}##${node.persistentId}`;

    const perDepth = ImGui.GetFontSize();
    if (row.depth > 0) {
      ImGui.Indent(row.depth * perDepth);
    }

    let flags = SceneHierarchy.baseFlags;
    if (this._selectedNode === node) {
      flags |= ImGui.TreeNodeFlags.Selected;
    }
    if (row.leaf) {
      flags |= ImGui.TreeNodeFlags.Leaf | ImGui.TreeNodeFlags.NoTreePushOnOpen;
    }

    const id = node.persistentId;
    const isOpen = this.isNodeOpen(id, row.defaultOpen);

    const openBefore = isOpen;

    const clickedOpen = ImGui.TreeNodeEx(label, flags);

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
        ImGui.Separator();
      }
      if (ImGui.MenuItem('Create static batch')) {
        this.dispatchEvent('request_add_child', node, BatchGroup);
      }
      ImGui.Separator();
      if (ImGui.MenuItem('Create group')) {
        this.dispatchEvent('request_add_child', node, SceneNode);
      }

      const animationSet = node.animationSet;
      if (animationSet && animationSet.getAnimationNames().length > 0) {
        ImGui.Separator();
        if (ImGui.BeginMenu('Animation')) {
          ImGui.PushID(node.persistentId);
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
      this._draggingItem = true;
      if (node !== this._scene.rootNode) {
        ImGui.SetDragDropPayload('NODE', node);
      }
      ImGui.EndDragDropSource();
    }

    if (!row.leaf) {
      if (clickedOpen !== openBefore) {
        this.toggleNodeOpen(id, row.defaultOpen);
      }
    }

    if (!row.leaf && clickedOpen) {
      ImGui.TreePop();
    }

    if (row.depth > 0) {
      ImGui.Unindent(row.depth * perDepth);
    }
  }
  private handleAutoScrollWhileDragging() {
    if (!this._draggingItem) {
      return;
    }

    const hovered = ImGui.IsWindowHovered(
      ImGui.HoveredFlags.AllowWhenBlockedByActiveItem |
        ImGui.HoveredFlags.AllowWhenBlockedByPopup |
        ImGui.HoveredFlags.ChildWindows
    );
    if (!hovered) {
      return;
    }

    const winPos = ImGui.GetWindowPos();
    const winSize = ImGui.GetWindowSize();
    const winTop = winPos.y;
    const winBottom = winPos.y + winSize.y;

    const io = ImGui.GetIO();
    const mouseY = io.MousePos.y;

    const scrollY = ImGui.GetScrollY();
    const scrollMaxY = ImGui.GetScrollMaxY();

    if (scrollMaxY <= 0) {
      return;
    }

    const edgePx = 24.0;
    const minSpeed = 80.0;
    const maxSpeed = 480.0;
    const dt = io.DeltaTime || 1 / 60;

    let delta = 0.0;

    if (mouseY >= winTop && mouseY <= winTop + edgePx) {
      const t = 1.0 - (mouseY - winTop) / edgePx; // 0..1
      const speed = minSpeed + (maxSpeed - minSpeed) * t;
      delta = -speed * dt;
    } else if (mouseY <= winBottom && mouseY >= winBottom - edgePx) {
      const t = 1.0 - (winBottom - mouseY) / edgePx; // 0..1
      const speed = minSpeed + (maxSpeed - minSpeed) * t;
      delta = +speed * dt;
    }

    if (delta !== 0.0) {
      const newY = Math.max(0, Math.min(scrollMaxY, scrollY + delta));
      if (newY !== scrollY) {
        ImGui.SetScrollY(newY);
      }
    }
  }
}
*/
