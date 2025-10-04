import type { EventMap } from '@zephyr3d/base';
import { Observable } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';

export abstract class ListViewData<T = unknown> {
  abstract getItems(): T[];
  abstract getId(item: T, index: number): string;
  abstract getDragSourcePayloadType(node: T): string;
  abstract getDragSourcePayload(node: T): unknown;
  abstract getDragTargetPayloadType(node: T): string;
}

export type ListViewType = 'list' | 'grid' | 'detail';
export class ListView<P extends EventMap, T = unknown> extends Observable<P> {
  protected _type: ListViewType;
  protected _gridItemSize: number;
  protected _selectedItems: Set<T>;
  protected _hoveredItem: T;
  protected _visibleRows: T[];
  protected _visibleDirty: boolean;
  protected _draggingItem: boolean;
  protected _clipper: ImGui.ListClipper;
  protected _data: ListViewData<T>;
  protected _id: string;
  protected _pendingFocusId: string;

  constructor(id: string, data: ListViewData<T>) {
    super();
    this._selectedItems = new Set();
    this._visibleRows = [];
    this._visibleDirty = true;
    this._draggingItem = false;
    this._data = data;
    this._id = id;
    this._pendingFocusId = null;
    this._clipper = new ImGui.ListClipper();
  }
  invalidate() {
    this._visibleDirty = true;
  }
  renderListView(items: T[]) {
    const rowH = ImGui.GetTextLineHeightWithSpacing();
    const total = items.length;
    this._clipper.Begin(total, rowH);
    while (this._clipper.Step()) {
      for (let i = this._clipper.DisplayStart; i < this._clipper.DisplayEnd; i++) {
        const item = this._visibleRows[i];
        this.renderListItem(item, i);
      }
    }
    this._clipper.End();
    this.handleAutoScrollWhileDragging();
    this.ensureSelectionVisible();
  }
  renderListItem(_item: T, _index: number) {}
  renderGridView(_items: T[]) {}
  renderDetailView(_items: T[]) {}
  render() {
    const items = this._data.getItems();
    const flags = this._draggingItem ? ImGui.WindowFlags.NoScrollbar : 0;
    ImGui.BeginChild(this._id, ImGui.GetContentRegionAvail(), false, flags);
    if (!ImGui.GetIO().MouseDown[0]) {
      this._draggingItem = false;
    }
    const rowH = ImGui.GetTextLineHeightWithSpacing();
    const total = items.length;
    this._clipper.Begin(total, rowH);
    if (this._type === 'list') {
      this.renderListView(items);
    } else if (this._type === 'detail') {
      this.renderDetailView(items);
    } else if (this._type === 'grid') {
      this.renderGridView(items);
    }
    this._clipper.End();
    this.handleAutoScrollWhileDragging();
    this.ensureSelectionVisible();
    ImGui.EndChild();
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
  private ensureSelectionVisible() {
    if (!this._pendingFocusId) {
      return;
    }
    const targetId = this._pendingFocusId;
    let rowIndex = -1;
    for (let i = 0; i < this._visibleRows.length; i++) {
      const n = this._visibleRows[i];
      if (this._data.getId(n, i) === targetId) {
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
}
