import type { EventMap, Nullable } from '@zephyr3d/base';
import { Observable } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';

export abstract class TreeViewData<T = unknown> {
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
  private static readonly baseFlags =
    ImGui.TreeNodeFlags.OpenOnArrow | ImGui.TreeNodeFlags.SpanAvailWidth | ImGui.TreeNodeFlags.SpanFullWidth;

  private _multiSelect: boolean;
  private _selectedNode: Nullable<T>;
  private _selectedNodes: Set<T>;
  private _selectionAnchorId: Nullable<string>;
  private _openState: Map<string, boolean>; // key = node.persistentId
  private _visibleRows: VisibleRow<T>[];
  private _visibleDirty: boolean;
  private _draggingItem: boolean;
  private _clipper: ImGui.ListClipper;
  private _data: TreeViewData<T>;
  private _id: string;
  private _pendingFocusId: Nullable<string>;
  private _pendingClickNode: Nullable<T>;
  private _pendingClickRowIndex: number;
  private _pendingClickCtrl: boolean;
  private _pendingClickShift: boolean;

  constructor(id: string, data: TreeViewData<T>, multiSelect = false) {
    super();
    this._multiSelect = multiSelect;
    this._selectedNode = null;
    this._selectedNodes = new Set();
    this._selectionAnchorId = null;
    this._openState = new Map();
    this._visibleRows = [];
    this._visibleDirty = true;
    this._draggingItem = false;
    this._data = data;
    this._id = id;
    this._pendingFocusId = null;
    this._pendingClickNode = null;
    this._pendingClickRowIndex = -1;
    this._pendingClickCtrl = false;
    this._pendingClickShift = false;
    this._clipper = new ImGui.ListClipper();
  }

  selectNode(node: Nullable<T>) {
    this.applySelection(node ? [node] : [], node, true);
  }
  selectNodes(nodes: T[], activeNode?: Nullable<T>) {
    const selected = [...new Set(nodes)];
    const active =
      activeNode !== undefined ? activeNode : selected.length > 0 ? selected[selected.length - 1] : null;
    this.applySelection(selected, active ?? null, true);
    this._selectionAnchorId = active ? this._data.getId(active) : null;
  }
  get selectedNode() {
    return this._selectedNode;
  }
  get selectedNodes() {
    return this._selectedNodes;
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
      this.rebuildVisible();
      this._visibleDirty = false;
    }
    const flags = this._draggingItem ? ImGui.WindowFlags.NoScrollbar : 0;
    ImGui.BeginChild(this._id, ImGui.GetContentRegionAvail(), false, flags);
    ImGui.PushID(this._id);
    if (!ImGui.GetIO().MouseDown[0]) {
      this._draggingItem = false;
    }
    const rowH = ImGui.GetTextLineHeightWithSpacing();
    const total = this._visibleRows.length;
    this._clipper.Begin(total, rowH);
    while (this._clipper.Step()) {
      for (let i = this._clipper.DisplayStart; i < this._clipper.DisplayEnd; i++) {
        const row = this._visibleRows[i];
        this.renderRow(row, i, forceUpdate, rowH);
      }
    }
    this._clipper.End();
    this.flushPendingClick();
    this.handleAutoScrollWhileDragging();
    this.ensureSelectionVisible();
    ImGui.PopID();
    ImGui.EndChild();
  }

  private rebuildVisible() {
    const out: VisibleRow<T>[] = [];

    const root = this._data.getRoot();

    const dfs = (node: T, depth: number) => {
      const children = this._data.getChildren(node);
      const leaf = children.length === 0;
      const defaultOpen = !this._data.getParent(node);

      out.push({ node, depth, leaf, defaultOpen });

      const id = this._data.getId(node);
      const isOpen = this.isNodeOpen(id, defaultOpen);

      if (isOpen && !leaf) {
        for (const child of children) {
          dfs(child, depth + 1);
        }
      }
    };

    if (root) {
      dfs(root, 0);
    }
    this._visibleRows = out;
  }

  private isNodeOpen(id: string, defaultOpen: boolean): boolean {
    const v = this._openState.get(id);
    return v !== undefined ? v : defaultOpen;
  }

  private renderRow(row: VisibleRow<T>, rowIndex: number, forceUpdate: boolean, _rowH: number) {
    const node = row.node;
    const label = `${this._data.getNodeName(node, forceUpdate)}##${this._data.getId(node)}`;

    const perDepth = ImGui.GetFontSize();
    if (row.depth > 0) {
      ImGui.Indent(row.depth * perDepth);
    }

    let flags = TreeView.baseFlags;
    if (this._selectedNodes.has(node)) {
      flags |= ImGui.TreeNodeFlags.Selected;
    }
    if (row.leaf) {
      flags |= ImGui.TreeNodeFlags.Leaf | ImGui.TreeNodeFlags.NoTreePushOnOpen;
    }

    const id = this._data.getId(node);
    const isOpen = this.isNodeOpen(id, row.defaultOpen);

    ImGui.SetNextItemOpen(isOpen, ImGui.Cond.Always);
    const textColor = this.onGetNodeTextColor(node);
    if (textColor) {
      ImGui.PushStyleColor(ImGui.Col.Text, textColor);
    }
    const clickedOpen = ImGui.TreeNodeEx(label, flags);
    if (textColor) {
      ImGui.PopStyleColor();
    }

    if (ImGui.IsItemClicked(ImGui.MouseButton.Left)) {
      if (this._data.getDragSourcePayloadType(node)) {
        this.queuePendingClick(node, rowIndex);
      } else {
        this.handleNodeClick(node, rowIndex);
      }
    }
    if (ImGui.IsItemHovered() && ImGui.IsMouseDoubleClicked(ImGui.MouseButton.Left)) {
      this.onNodeDblClicked(node);
    }

    const menuId = this.onGetContextMenuId(node);
    if (menuId) {
      if (ImGui.IsItemClicked(ImGui.MouseButton.Right)) {
        ImGui.OpenPopup(menuId);
      }
      if (ImGui.BeginPopup(menuId)) {
        this.onDrawContextMenu(node, menuId);
        ImGui.EndPopup();
      }
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
      this.clearPendingClick();
      const payload = this._data.getDragSourcePayload(node);
      if (payload) {
        ImGui.SetDragDropPayload(sourcePayloadType, payload);
      }
      ImGui.EndDragDropSource();
    }

    if (!row.leaf) {
      if (ImGui.IsItemToggledOpen()) {
        const nowOpen = clickedOpen;
        this._openState.set(id, nowOpen);
        this._visibleDirty = true;
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
  protected onSelectionChanged(_selectedNodes: Set<T>, _activeNode: Nullable<T>) {}
  protected onNodeDblClicked(_node: T) {}
  protected onGetNodeTextColor(_node: T): Nullable<ImGui.ImVec4> {
    return null;
  }
  protected onGetContextMenuId(_node: T): string {
    return '';
  }
  protected onDrawContextMenu(_node: T, _menuId: string) {}
  protected onDragDrop(_node: T, _type: string, _payload: unknown) {}
  private expandAncestors(node: T) {
    let cur = node;
    for (;;) {
      const parent = this._data.getParent(cur);
      if (!parent) {
        break;
      }
      const parentId = this._data.getId(parent);
      this._openState.set(parentId, true);
      cur = parent;
    }
    this._visibleDirty = true;
  }
  private ensureSelectionVisible() {
    if (!this._pendingFocusId) {
      return;
    }
    const targetId = this._pendingFocusId;
    let rowIndex = -1;
    for (let i = 0; i < this._visibleRows.length; i++) {
      const n = this._visibleRows[i].node;
      if (this._data.getId(n) === targetId) {
        rowIndex = i;
        break;
      }
    }
    if (rowIndex < 0) {
      return;
    }
    const rowH = ImGui.GetTextLineHeightWithSpacing();
    const itemTop = rowIndex * rowH;
    const itemBottom = itemTop + rowH;

    const curScroll = ImGui.GetScrollY();
    const viewHeight = ImGui.GetWindowSize().y;
    const viewTop = curScroll;
    const viewBottom = curScroll + viewHeight;

    let newScroll = curScroll;

    if (itemTop < viewTop) {
      newScroll = itemTop;
    } else if (itemBottom > viewBottom) {
      newScroll = itemBottom - viewHeight;
    }

    newScroll = Math.max(0, Math.min(ImGui.GetScrollMaxY(), newScroll));

    if (newScroll !== curScroll) {
      ImGui.SetScrollY(newScroll);
    }

    this._pendingFocusId = null;
  }
  private applySelection(nodes: T[], activeNode: Nullable<T>, requestFocus: boolean) {
    const nextSelected = new Set(nodes);
    const deselected: T[] = [];
    const newlySelected: T[] = [];
    for (const node of this._selectedNodes) {
      if (!nextSelected.has(node)) {
        deselected.push(node);
      }
    }
    for (const node of nextSelected) {
      if (!this._selectedNodes.has(node)) {
        newlySelected.push(node);
      }
    }

    this._selectedNodes = nextSelected;
    this._selectedNode = activeNode && this._selectedNodes.has(activeNode) ? activeNode : null;
    if (!this._selectedNode && this._selectedNodes.size > 0) {
      this._selectedNode = this._selectedNodes.values().next().value ?? null;
    }
    if (requestFocus && this._selectedNode) {
      this.expandAncestors(this._selectedNode);
      this._pendingFocusId = this._data.getId(this._selectedNode);
    }

    if (deselected.length > 0 || newlySelected.length > 0) {
      for (const node of deselected) {
        this.onNodeDeselected(node);
      }
      for (const node of newlySelected) {
        this.onNodeSelected(node);
      }
      this.onSelectionChanged(this._selectedNodes, this._selectedNode);
    }
  }
  private queuePendingClick(node: T, rowIndex: number) {
    const io = ImGui.GetIO();
    this._pendingClickNode = node;
    this._pendingClickRowIndex = rowIndex;
    this._pendingClickCtrl = !!io.KeyCtrl;
    this._pendingClickShift = !!io.KeyShift;
  }
  private clearPendingClick() {
    this._pendingClickNode = null;
    this._pendingClickRowIndex = -1;
    this._pendingClickCtrl = false;
    this._pendingClickShift = false;
  }
  private flushPendingClick() {
    if (!this._pendingClickNode || this._draggingItem || ImGui.GetIO().MouseDown[0]) {
      return;
    }
    const node = this._pendingClickNode;
    const rowIndex = this._pendingClickRowIndex;
    const withCtrl = this._pendingClickCtrl;
    const withShift = this._pendingClickShift;
    this.clearPendingClick();
    this.handleNodeClick(node, rowIndex, withCtrl, withShift);
  }
  private handleNodeClick(
    node: T,
    rowIndex: number,
    ctrl = ImGui.GetIO().KeyCtrl,
    shift = ImGui.GetIO().KeyShift
  ) {
    if (!this._multiSelect) {
      this.applySelection([node], node, true);
      this._selectionAnchorId = this._data.getId(node);
      return;
    }

    const nodeId = this._data.getId(node);
    const currentRows = this._visibleRows;
    const anchorIndex =
      this._selectionAnchorId !== null
        ? currentRows.findIndex((r) => this._data.getId(r.node) === this._selectionAnchorId)
        : -1;
    const fallbackActiveIndex = this._selectedNode
      ? currentRows.findIndex((r) => r.node === this._selectedNode)
      : -1;
    const fromIndex =
      anchorIndex >= 0 ? anchorIndex : fallbackActiveIndex >= 0 ? fallbackActiveIndex : rowIndex;

    if (shift) {
      const start = Math.min(fromIndex, rowIndex);
      const end = Math.max(fromIndex, rowIndex);
      const rangeNodes = currentRows.slice(start, end + 1).map((r) => r.node);
      if (ctrl) {
        const selected = new Set(this._selectedNodes);
        for (const item of rangeNodes) {
          selected.add(item);
        }
        this.applySelection([...selected], node, true);
      } else {
        this.applySelection(rangeNodes, node, true);
      }
      this._selectionAnchorId = currentRows[fromIndex]
        ? this._data.getId(currentRows[fromIndex].node)
        : nodeId;
      return;
    }

    if (ctrl) {
      const selected = new Set(this._selectedNodes);
      if (selected.has(node)) {
        selected.delete(node);
      } else {
        selected.add(node);
      }
      let active: Nullable<T> = node;
      if (selected.size === 0) {
        active = null;
      } else if (!selected.has(active)) {
        active = selected.values().next().value ?? null;
      }
      this.applySelection([...selected], active, true);
      this._selectionAnchorId = nodeId;
      return;
    }

    this.applySelection([node], node, true);
    this._selectionAnchorId = nodeId;
  }
}
