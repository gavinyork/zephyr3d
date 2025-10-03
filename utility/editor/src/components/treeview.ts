import type { EventMap } from '@zephyr3d/base';
import { Observable } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';

export abstract class TreeData<T = unknown> {
  abstract getRoot(): T;
  abstract getChildren(parent: T): T[];
  abstract getParent(node: T): T;
  abstract getId(node: T): string;
  abstract getNodeName(node: T, forceUpdate: boolean): string;
  abstract getDragSourcePayloadType(node: T): string;
  abstract getDragSourcePayload(node: T): unknown;
  abstract getDragTargetPayloadType(node: T): string;
}

type VisibleRow<T = unknown> = {
  node: T;
  depth: number;
  leaf: boolean;
  defaultOpen: boolean;
};

export class TreeView<P extends EventMap, T = unknown> extends Observable<P> {
  private static readonly baseFlags = ImGui.TreeNodeFlags.OpenOnArrow | ImGui.TreeNodeFlags.SpanAvailWidth;

  private _selectedNode: T;
  private _openState: Map<string, boolean>; // key = node.persistentId
  private _visibleRows: VisibleRow<T>[];
  private _visibleDirty: boolean;
  private _draggingItem: boolean;
  private _clipper: ImGui.ListClipper;
  private _data: TreeData<T>;
  private _id: string;

  constructor(id: string, data: TreeData<T>) {
    super();
    this._selectedNode = null;
    this._openState = new Map();
    this._visibleRows = [];
    this._visibleDirty = true;
    this._draggingItem = false;
    this._data = data;
    this._id = id;
    this._clipper = new ImGui.ListClipper();
  }

  selectNode(node: T) {
    if (this._selectedNode !== node) {
      if (this._selectedNode) {
        this.onNodeDeselected(this._selectedNode);
      }
      this._selectedNode = node;
      if (this._selectedNode) {
        this.onNodeSelected(this._selectedNode);
      }
    }
  }
  get selectedNode() {
    return this._selectedNode;
  }
  get draggingItem() {
    return this._draggingItem;
  }
  invalidate() {
    this._openState.clear();
    this._visibleDirty = true;
  }
  render(forceUpdate: boolean) {
    if (this._visibleDirty || forceUpdate) {
      this.rebuildVisible(forceUpdate);
      this._visibleDirty = false;
    }
    const flags = this._draggingItem ? ImGui.WindowFlags.NoScrollbar : 0;
    ImGui.BeginChild(this._id, ImGui.GetContentRegionAvail(), false, flags);
    this._draggingItem = false;
    const rowH = ImGui.GetTextLineHeightWithSpacing();
    const total = this._visibleRows.length;
    this._clipper.Begin(total, rowH);
    while (this._clipper.Step()) {
      for (let i = this._clipper.DisplayStart; i < this._clipper.DisplayEnd; i++) {
        const row = this._visibleRows[i];
        this.renderRow(row, forceUpdate, rowH);
      }
    }
    this._clipper.End();
    this.handleAutoScrollWhileDragging();
    ImGui.EndChild();
  }

  private rebuildVisible(_sceneChanged: boolean) {
    const out: VisibleRow<T>[] = [];
    const root = this._data.getRoot();

    const dfs = (node: T, depth: number) => {
      const children = this._data.getChildren(node);
      const leaf = children.length === 0;
      const defaultOpen = !this._data.getParent(node);
      out.push({
        node,
        depth,
        leaf,
        defaultOpen
      });
      const id = this._data.getId(node);
      const isOpen = this.isNodeOpen(id, defaultOpen);
      if (isOpen && !leaf) {
        for (const child of children) {
          dfs(child, depth + 1);
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

  private renderRow(row: VisibleRow<T>, forceUpdate: boolean, _rowH: number) {
    const node = row.node;
    const label = `${this._data.getNodeName(node, forceUpdate)}##${this._data.getId(node)}`;

    const perDepth = ImGui.GetFontSize();
    if (row.depth > 0) {
      ImGui.Indent(row.depth * perDepth);
    }

    let flags = TreeView.baseFlags;
    if (this._selectedNode === node) {
      flags |= ImGui.TreeNodeFlags.Selected;
    }
    if (row.leaf) {
      flags |= ImGui.TreeNodeFlags.Leaf | ImGui.TreeNodeFlags.NoTreePushOnOpen;
    }

    const id = this._data.getId(node);
    const isOpen = this.isNodeOpen(id, row.defaultOpen);

    const openBefore = isOpen;

    const clickedOpen = ImGui.TreeNodeEx(label, flags);

    if (ImGui.IsItemClicked(ImGui.MouseButton.Left)) {
      this.selectNode(node);
    }
    if (ImGui.IsItemHovered() && ImGui.IsMouseDoubleClicked(ImGui.MouseButton.Left)) {
      this.onNodeDblClicked(node);
    }

    let menuId: string = '';
    if (ImGui.IsItemClicked(ImGui.MouseButton.Right)) {
      menuId = this.onGetContextMenuId(node);
      if (menuId) {
        ImGui.OpenPopup(menuId);
      }
    }
    if (menuId && ImGui.BeginPopup(menuId)) {
      this.onDrawContextMenu(node, menuId);
      ImGui.EndPopup();
    }

    const targetPayloadType = this._data.getDragTargetPayloadType(node);
    if (targetPayloadType && ImGui.BeginDragDropTarget()) {
      const payload = ImGui.AcceptDragDropPayload(targetPayloadType);
      if (payload) {
        this.onDragDrop(node, targetPayloadType, payload.Data);
      }
      ImGui.EndDragDropTarget();
    }
    const sourcePayloadType = this._data.getDragSourcePayloadType(node);
    if (sourcePayloadType && ImGui.BeginDragDropSource()) {
      this._draggingItem = true;
      const payload = this._data.getDragSourcePayload(node);
      if (payload) {
        ImGui.SetDragDropPayload(sourcePayloadType, payload);
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
  protected onNodeDeselected(_node: T) {}
  protected onNodeSelected(_node: T) {}
  protected onNodeDblClicked(_node: T) {}
  protected onGetContextMenuId(_node: T): string {
    return '';
  }
  protected onDrawContextMenu(_node: T, _menuId: string) {}
  protected onDragDrop(_node: T, _type: string, _payload: unknown) {}
}
