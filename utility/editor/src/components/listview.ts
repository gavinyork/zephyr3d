import type { EventMap } from '@zephyr3d/base';
import { Observable } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';
import { convertEmojiString } from '../helpers/emoji';
import { enableWorkspaceDragging } from './dragdrop';

export abstract class ListViewData<T = unknown> {
  abstract getItems(): T[];
  abstract getItemIcon(item: T, index: number): string;
  abstract getItemName(item: T, index: number): string;
  abstract getDetailColumnsInfo(): string[];
  abstract getDetailColumn(item: T, col: number): string;
  abstract sortDetailItems(a: T, b: T, sortBy: number, sortAscending: boolean): number;
  abstract getDragSourcePayloadType(lv: ListView<any>, node: T): string;
  abstract getDragSourcePayload(lv: ListView<any>, node: T): unknown;
  abstract getDragTargetPayloadType(lv: ListView<any>, node: T): string;
}

export type ListViewType = 'list' | 'grid' | 'detail';
export class ListView<P extends EventMap, T = unknown> extends Observable<P> {
  protected _type: ListViewType;
  protected _multiSelect: boolean;
  protected _gridItemSize: number;
  protected _selectedItems: Set<T>;
  protected _hoveredItem: T;
  protected _draggingItem: boolean;
  protected _clipper: ImGui.ListClipper;
  protected _data: ListViewData<T>;
  protected _id: string;
  protected _pendingFocusId: string;
  protected _detailColumnsInfo: string[];
  private _sortBy: number;
  private _sortAscending: boolean;
  private _items: T[];

  constructor(id: string, data: ListViewData<T>) {
    super();
    this._selectedItems = new Set();
    this._multiSelect = true;
    this._draggingItem = false;
    this._hoveredItem = null;
    this._data = data;
    this._id = id;
    this._gridItemSize = 80;
    this._pendingFocusId = null;
    this._detailColumnsInfo = this._data.getDetailColumnsInfo();
    this._clipper = new ImGui.ListClipper();
    this._sortBy = 0;
    this._sortAscending = true;
    this._items = [];
  }
  get selectedItems() {
    return this._selectedItems;
  }
  get type() {
    return this._type;
  }
  set type(val: ListViewType) {
    this._type = val;
  }
  renderListView() {
    const rowH = ImGui.GetTextLineHeightWithSpacing();
    const total = this._items.length;
    this._clipper.Begin(total, rowH);
    while (this._clipper.Step()) {
      for (let i = this._clipper.DisplayStart; i < this._clipper.DisplayEnd; i++) {
        const item = this._items[i];
        this.renderListItem(item, i);
      }
    }
    this._clipper.End();
    this.handleAutoScrollWhileDragging();
    this.ensureSelectionVisible();
  }
  renderListItem(item: T, index: number) {
    const name = this._data.getItemName(item, index);
    const icon = this._data.getItemIcon(item, index);
    const label = convertEmojiString(`${icon ? `${icon} ` : ''}${name}##item_${index}`);
    const isSelected = this._selectedItems.has(item);
    const keyCtrl = ImGui.GetIO().KeyCtrl;
    if (ImGui.Selectable(label, isSelected, ImGui.SelectableFlags.AllowDoubleClick)) {
      if (isSelected && !keyCtrl) {
        this.handleItemClick(item);
      }
    }
    if (ImGui.IsItemHovered()) {
      this._hoveredItem = item;
    }
    if (ImGui.IsItemClicked(ImGui.MouseButton.Left) && (keyCtrl || !this._selectedItems.has(item))) {
      this.handleItemClick(item);
    }
    if (ImGui.IsItemHovered() && ImGui.IsMouseDoubleClicked(ImGui.MouseButton.Left)) {
      this.handleItemDoubleClick(item);
    }
    this.postRenderItem(item);
  }
  renderGridView() {
    const windowWidth = ImGui.GetWindowContentRegionMax().x - ImGui.GetWindowContentRegionMin().x;
    const itemsPerRow = Math.max(1, Math.floor(windowWidth / (this._gridItemSize + 10)));

    for (let i = 0; i < this._items.length; i++) {
      const item = this._items[i];

      if (i % itemsPerRow !== 0) {
        ImGui.SameLine();
      }

      this.renderGridItem(item, i);
    }
  }
  renderGridItem(item: T, index: number) {
    const name = this._data.getItemName(item, index);
    const icon = this._data.getItemIcon(item, index);
    const isSelected = this._selectedItems.has(item);
    const keyCtrl = ImGui.GetIO().KeyCtrl;

    ImGui.BeginGroup();

    const iconSize = this._gridItemSize;
    if (
      ImGui.Selectable(
        `##icon_${index}`,
        isSelected,
        ImGui.SelectableFlags.AllowDoubleClick,
        new ImGui.ImVec2(iconSize, iconSize)
      )
    ) {
      if (isSelected && !keyCtrl) {
        this.handleItemClick(item);
      }
    }
    if (ImGui.IsItemHovered()) {
      this._hoveredItem = item;
    }
    if (ImGui.IsItemClicked(ImGui.MouseButton.Left) && (keyCtrl || !this._selectedItems.has(item))) {
      this.handleItemClick(item);
    }
    if (ImGui.IsItemHovered() && ImGui.IsMouseDoubleClicked(ImGui.MouseButton.Left)) {
      this.handleItemDoubleClick(item);
    }
    this.postRenderItem(item);

    const drawList = ImGui.GetWindowDrawList();
    const pos = ImGui.GetItemRectMin();
    const emojiStr = convertEmojiString(icon);
    const emojiSize = ImGui.CalcTextSize(emojiStr);
    const emojiPos = new ImGui.ImVec2(
      pos.x + (iconSize - emojiSize.x) * 0.5,
      pos.y + (iconSize - emojiSize.y) * 0.5
    );
    drawList.AddText(emojiPos, ImGui.GetColorU32(ImGui.Col.Text), emojiStr);

    ImGui.PushTextWrapPos(ImGui.GetCursorPosX() + iconSize);
    ImGui.TextWrapped(name);
    ImGui.PopTextWrapPos();

    ImGui.EndGroup();
  }
  renderDetailView() {
    if (
      ImGui.BeginTable(
        '##TableView',
        1 + this._detailColumnsInfo.length,
        ImGui.TableFlags.Resizable |
          ImGui.TableFlags.Sortable |
          ImGui.TableFlags.BordersInnerV |
          ImGui.TableFlags.RowBg
      )
    ) {
      ImGui.TableSetupColumn('Name', ImGui.TableColumnFlags.DefaultSort);
      for (const col of this._detailColumnsInfo) {
        ImGui.TableSetupColumn(col);
      }
      ImGui.TableHeadersRow();

      const sortSpecs = ImGui.TableGetSortSpecs();
      if (sortSpecs && sortSpecs.SpecsDirty) {
        this.handleTableSort(sortSpecs);
        sortSpecs.SpecsDirty = false;
      }

      for (let i = 0; i < this._items.length; i++) {
        const item = this._items[i];
        this.renderTableRow(item, i);
      }

      ImGui.EndTable();
    }
  }
  private renderTableRow(item: T, index: number) {
    const name = this._data.getItemName(item, index);

    ImGui.TableNextRow();
    ImGui.TableSetColumnIndex(0);
    const icon = this._data.getItemIcon(item, index);
    const label = convertEmojiString(`${icon ? `${icon} ` : ''}${name}##row_${index}`);
    const isSelected = this._selectedItems.has(item);
    const keyCtrl = ImGui.GetIO().KeyCtrl;
    if (
      ImGui.Selectable(
        label,
        isSelected,
        ImGui.SelectableFlags.SpanAllColumns | ImGui.SelectableFlags.AllowDoubleClick
      )
    ) {
      if (isSelected && !keyCtrl) {
        this.handleItemClick(item);
      }
    }
    if (ImGui.IsItemHovered()) {
      this._hoveredItem = item;
    }
    if (ImGui.IsItemClicked(ImGui.MouseButton.Left) && (keyCtrl || !this._selectedItems.has(item))) {
      this.handleItemClick(item);
    }
    if (ImGui.IsItemHovered() && ImGui.IsMouseDoubleClicked(ImGui.MouseButton.Left)) {
      this.handleItemDoubleClick(item);
    }
    this.postRenderItem(item);

    for (let i = 0; i < this._detailColumnsInfo.length; i++) {
      ImGui.TableSetColumnIndex(i + 1);
      const text = this._data.getDetailColumn(item, i);
      ImGui.Text(text);
    }
  }
  render() {
    this._items = this._data.getItems();
    const flags = this._draggingItem ? ImGui.WindowFlags.NoScrollbar : 0;
    ImGui.BeginChild(this._id, ImGui.GetContentRegionAvail(), false, flags);
    if (!ImGui.GetIO().MouseDown[0]) {
      this._draggingItem = false;
    }
    const rowH = ImGui.GetTextLineHeightWithSpacing();
    const total = this._items.length;
    this._clipper.Begin(total, rowH);
    if (this._type === 'list') {
      this.renderListView();
    } else if (this._type === 'detail') {
      this.renderDetailView();
    } else if (this._type === 'grid') {
      this.renderGridView();
    }
    this._clipper.End();
    this.handleContextMenu();
    this.handleAutoScrollWhileDragging();
    this.ensureSelectionVisible();
    ImGui.EndChild();
  }
  protected postRenderItem(item: T) {
    const targetPayloadType = this._data.getDragTargetPayloadType(this, item);
    if (targetPayloadType && ImGui.BeginDragDropTarget()) {
      const payload = ImGui.AcceptDragDropPayload(targetPayloadType);
      if (payload) {
        this.onDragDrop(item, targetPayloadType, payload.Data);
      }
      ImGui.EndDragDropTarget();
    }
    const sourcePayloadType = this._data.getDragSourcePayloadType(this, item);
    if (sourcePayloadType) {
      if (
        enableWorkspaceDragging(
          item,
          sourcePayloadType,
          () => this._data.getDragSourcePayload(this, item),
          () => ImGui.Text('Hint')
        )
      ) {
        this._draggingItem = true;
      }
    }
  }
  protected handleItemClick(item: T) {
    const io = ImGui.GetIO();

    if (this._multiSelect && io.KeyCtrl) {
      if (this._selectedItems.has(item)) {
        this._selectedItems.delete(item);
      } else {
        this._selectedItems.add(item);
      }
    } else if (this._multiSelect && io.KeyShift && this._selectedItems.size > 0) {
      this._selectedItems.clear();
      this._selectedItems.add(item);
    } else {
      this._selectedItems.clear();
      this._selectedItems.add(item);
    }
    this.onSelectionChanged();
  }
  protected handleItemDoubleClick(_item: T) {}
  protected handleListItemRendered(_item: T): boolean {
    return false;
  }
  protected onSelectionChanged() {}
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
  protected onItemContextMenu() {}
  protected onContentContextMenu() {}
  protected onDragDrop(_node: T, _type: string, _payload: unknown) {}
  private ensureSelectionVisible() {
    if (!this._pendingFocusId) {
      return;
    }
    const targetId = this._pendingFocusId;
    let rowIndex = -1;
    for (let i = 0; i < this._items.length; i++) {
      const n = this._items[i];
      if (this._data.getItemName(n, i) === targetId) {
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
  private handleTableSort(sortSpecs: any) {
    if (sortSpecs.Specs.length > 0) {
      const spec = sortSpecs.Specs[0];
      this._sortBy = spec.ColumnIndex;
      this._sortAscending = spec.SortDirection === ImGui.SortDirection.Ascending;
      this._items.sort((a, b) => this._data.sortDetailItems(a, b, this._sortBy, this._sortAscending));
    }
  }
  private handleContextMenu() {
    if (ImGui.IsWindowHovered() && ImGui.IsMouseClicked(ImGui.MouseButton.Right)) {
      const clickedItem = this.getItemUnderMouse();
      if (clickedItem) {
        if (!this._selectedItems.has(clickedItem)) {
          this._selectedItems.clear();
          this._selectedItems.add(clickedItem);
          this.onSelectionChanged();
        }
        ImGui.OpenPopup('##ItemContextMenu');
      } else {
        ImGui.OpenPopup('##ContentContextMenu');
      }
    }

    if (ImGui.BeginPopup('##ItemContextMenu')) {
      this.onItemContextMenu();
      ImGui.EndPopup();
    }

    if (ImGui.BeginPopup('##ContentContextMenu')) {
      this.onContentContextMenu();
      ImGui.EndPopup();
    }
  }
  private getItemUnderMouse(): T {
    return this._hoveredItem;
  }
  static testDataCls = class extends ListViewData<number> {
    private randNumbers = Array.from({ length: 100 }).map(() => Math.random());
    getItems(): number[] {
      return this.randNumbers;
    }
    getItemIcon(): string {
      return '🖼️';
    }
    getItemName(item: number, index: number): string {
      return `${index} - ${item}`;
    }
    getDetailColumnsInfo(): string[] {
      return ['Sign', 'Value'];
    }
    getDetailColumn(item: number, col: number): string {
      return col === 0 ? String(item >= 0) : String(item);
    }
    sortDetailItems(a: number, b: number, _sortBy: number, sortAscending: boolean): number {
      return sortAscending ? a - b : b - a;
    }
    getDragSourcePayloadType(lv: ListView<{}, number>): string {
      return lv.selectedItems.size > 0 ? 'Number' : null;
    }
    getDragSourcePayload(lv: ListView<{}, number>): unknown {
      return [...lv.selectedItems];
    }
    getDragTargetPayloadType(): string {
      return 'Number';
    }
  };
  static testListView = new ListView('Test##TestListView', new this.testDataCls());
  static testListViewRenderer(type: ListViewType) {
    this.testListView.type = type;
    if (ImGui.Begin('TestListView')) {
      ImGui.BeginChild('TestListViewContainer', ImGui.GetContentRegionAvail(), false);
      this.testListView.render();
      ImGui.EndChild();
    }
    ImGui.End();
  }
}
