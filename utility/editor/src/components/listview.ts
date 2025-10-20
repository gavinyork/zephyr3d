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
  abstract getDragSourceHint(lv: ListView<any>, node: T): string;
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
  private _cellXGap: number;
  private _cellYGap: number;
  private _itemHeightCache: Map<string, number>;
  private _items: T[];

  constructor(id: string, data: ListViewData<T>) {
    super();
    this._type = 'list';
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
    this._cellXGap = 10;
    this._cellYGap = 10;
    this._itemHeightCache = new Map();
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
  get data() {
    return this._data;
  }
  set type(val: ListViewType) {
    if (this._type !== val) {
      this._type = val;
      const selected = [...this.selectedItems];
      this.deselectAll();
      this.selectItems(selected);
    }
  }
  get gridItemSize() {
    return this._gridItemSize;
  }
  set gridItemSize(val: number) {
    this._gridItemSize = val;
  }
  deselectItems(items: T[]) {
    let deselected = false;
    for (const item of items) {
      if (this._selectedItems.has(item)) {
        this._selectedItems.delete(item);
        deselected = true;
        if (item === this._pendingFocusId) {
          this._pendingFocusId = null;
        }
      }
    }
    if (deselected) {
      this.onSelectionChanged();
    }
  }
  deselectAll() {
    if (this._selectedItems.size > 0) {
      this._selectedItems.clear();
      this._pendingFocusId = null;
      this.onSelectionChanged();
    }
  }
  selectItems(items: T[]) {
    let selected = false;
    for (const item of items) {
      if (this._selectedItems.has(item)) {
        continue;
      }
      this._selectedItems.add(item);
      selected = true;
    }
    if (!this._pendingFocusId && this._selectedItems.size > 0) {
      const item = this._selectedItems.values().next().value;
      this._pendingFocusId = this._data.getItemName(item, this._items.indexOf(item));
    }
    if (selected) {
      this.onSelectionChanged();
    }
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
    const keyCtrlOrShift = ImGui.GetIO().KeyCtrl || ImGui.GetIO().KeyShift;
    if (ImGui.Selectable(label, isSelected, ImGui.SelectableFlags.AllowDoubleClick)) {
      if (isSelected && !keyCtrlOrShift) {
        this.handleItemClick(item);
      }
    }
    if (ImGui.IsItemHovered()) {
      this._hoveredItem = item;
    }
    if (ImGui.IsItemClicked(ImGui.MouseButton.Left) && (keyCtrlOrShift || !this._selectedItems.has(item))) {
      this.handleItemClick(item);
    }
    if (ImGui.IsItemHovered() && ImGui.IsMouseDoubleClicked(ImGui.MouseButton.Left)) {
      this.handleItemDoubleClick(item);
    }
    this.postRenderItem(item);
  }
  renderGridView() {
    // Compute columns
    const contentMinX = ImGui.GetWindowContentRegionMin().x;
    const contentMaxX = ImGui.GetWindowContentRegionMax().x;
    const windowWidth = contentMaxX - contentMinX;
    const cellW = this._gridItemSize;
    const gapX = this._cellXGap;
    const itemsPerRow = Math.max(1, Math.floor((windowWidth + gapX) / (cellW + gapX)));

    const draw = ImGui.GetWindowDrawList();
    const clipMin = draw.GetClipRectMin();
    const clipMax = draw.GetClipRectMax();

    let col = 0;

    for (let i = 0; i < this._items.length; i++) {
      const item = this._items[i];
      const key = this.getItemKey(item, i);

      if (col > 0) {
        ImGui.SameLine(0, gapX);
      }

      // Estimate height before drawing
      const estimatedH = this._itemHeightCache.get(key) ?? this._gridItemSize + 20;
      const cellMin = ImGui.GetCursorScreenPos();
      const cellMax = new ImGui.ImVec2(cellMin.x + cellW, cellMin.y + estimatedH);

      // Visibility test at the cursor
      const visible = this.rectsOverlap(cellMin, cellMax, clipMin, clipMax);
      if (!visible) {
        // Off-screen: Dummy to advance layout and keep scrollbars right
        ImGui.Dummy(new ImGui.ImVec2(cellW, estimatedH));
      } else {
        // Visible: render fully and measure actual height
        const actualH = this.renderGridItem(item, i, cellW);
        // Update cache if changed
        if (actualH !== estimatedH) {
          this._itemHeightCache.set(key, actualH);
        }
      }

      // Wrap to next row
      col++;
      if (col >= itemsPerRow) {
        col = 0;
        ImGui.Dummy(new ImGui.ImVec2(0, this._cellYGap)); // row gap
      }
    }
  }

  private rectsOverlap(aMin: ImGui.ImVec2, aMax: ImGui.ImVec2, bMin: ImGui.ImVec2, bMax: ImGui.ImVec2) {
    return !(aMax.x < bMin.x || aMin.x > bMax.x || aMax.y < bMin.y || aMin.y > bMax.y);
  }
  private renderGridItem(item: T, index: number, width: number): number {
    const isSelected = this._selectedItems.has(item);
    const keyCtrlOrShift = ImGui.GetIO().KeyCtrl || ImGui.GetIO().KeyShift;
    const icon = this._data.getItemIcon(item, index);
    const name = this._data.getItemName(item, index);
    const iconSize = this._gridItemSize;

    ImGui.BeginGroup();

    // Selectable icon area: enforce width for consistent wrapping downstream
    if (
      ImGui.Selectable(
        `##icon_${index}`,
        isSelected,
        ImGui.SelectableFlags.AllowDoubleClick,
        new ImGui.ImVec2(width, iconSize)
      )
    ) {
      if (isSelected && !keyCtrlOrShift) {
        this.handleItemClick(item);
      }
    }
    if (ImGui.IsItemHovered()) {
      this._hoveredItem = item;
    }
    if (ImGui.IsItemClicked(ImGui.MouseButton.Left) && (keyCtrlOrShift || !this._selectedItems.has(item))) {
      this.handleItemClick(item);
    }
    if (ImGui.IsItemHovered() && ImGui.IsMouseDoubleClicked(ImGui.MouseButton.Left)) {
      this.handleItemDoubleClick(item);
    }
    this.postRenderItem(item);

    // Draw emoji centered in the icon rect
    const drawList = ImGui.GetWindowDrawList();
    const iconMin = ImGui.GetItemRectMin();
    const emojiStr = convertEmojiString(icon);
    const emojiSize = ImGui.CalcTextSize(emojiStr);
    const emojiPos = new ImGui.ImVec2(
      iconMin.x + (width - emojiSize.x) * 0.5,
      iconMin.y + (iconSize - emojiSize.y) * 0.5
    );
    drawList.AddText(emojiPos, ImGui.GetColorU32(ImGui.Col.Text), emojiStr);

    // Name text, wrapped to the cell width
    ImGui.PushTextWrapPos(ImGui.GetCursorPosX() + width);
    ImGui.TextWrapped(name);
    ImGui.PopTextWrapPos();

    ImGui.EndGroup();

    if (this._pendingFocusId && name === this._pendingFocusId) {
      ImGui.SetScrollHereY(0.25);
      this._pendingFocusId = null; // 命中后清空
    }

    // Measure the group bounding box (screen coords)
    const minRect = ImGui.GetItemRectMin();
    const maxRect = ImGui.GetItemRectMax();
    const actualHeight = Math.max(1, maxRect.y - minRect.y);
    return actualHeight;
  }
  renderDetailView() {
    const flags =
      ImGui.TableFlags.Resizable |
      ImGui.TableFlags.Sortable |
      ImGui.TableFlags.BordersInnerV |
      ImGui.TableFlags.RowBg; // enable internal clipping + scroll

    const avail = ImGui.GetContentRegionAvail();
    const height = avail.y;
    // Optionally bound the table to a child with size if needed
    if (ImGui.BeginTable('##TableView', 1 + this._detailColumnsInfo.length, flags, avail)) {
      // Header
      ImGui.TableSetupColumn('Name', ImGui.TableColumnFlags.DefaultSort);
      for (const col of this._detailColumnsInfo) {
        ImGui.TableSetupColumn(col);
      }
      ImGui.TableHeadersRow();

      // Sorting
      const sortSpecs = ImGui.TableGetSortSpecs();
      if (sortSpecs && sortSpecs.SpecsDirty) {
        this.handleTableSort(sortSpecs);
        sortSpecs.SpecsDirty = false;
      }

      // Row height hint
      const rowH = ImGui.GetTextLineHeightWithSpacing();

      // Table clipping is built-in with ScrollY flag.
      // You still need to call TableNextRow per row, but only visible rows get drawn.
      for (let i = 0; i < this._items.length; i++) {
        const posY = ImGui.GetCursorPosY() - ImGui.GetScrollY();
        const IsVisible = posY >= -rowH && posY <= height;
        ImGui.TableNextRow(ImGui.TableRowFlags.None, rowH);
        if (!IsVisible) {
          continue;
        }
        const item = this._items[i];
        const name = this._data.getItemName(item, i);

        // Column 0: selectable with SpanAllColumns behavior
        ImGui.TableSetColumnIndex(0);
        const icon = this._data.getItemIcon(item, i);
        const label = convertEmojiString(`${icon ? `${icon} ` : ''}${name}##row_${i}`);
        const isSelected = this._selectedItems.has(item);
        const keyCtrlOrShift = ImGui.GetIO().KeyCtrl || ImGui.GetIO().KeyShift;

        if (
          ImGui.Selectable(
            label,
            isSelected,
            ImGui.SelectableFlags.SpanAllColumns | ImGui.SelectableFlags.AllowDoubleClick
          )
        ) {
          if (isSelected && !keyCtrlOrShift) {
            this.handleItemClick(item);
          }
        }
        if (ImGui.IsItemHovered()) {
          this._hoveredItem = item;
        }
        if (
          ImGui.IsItemClicked(ImGui.MouseButton.Left) &&
          (keyCtrlOrShift || !this._selectedItems.has(item))
        ) {
          this.handleItemClick(item);
        }
        if (ImGui.IsItemHovered() && ImGui.IsMouseDoubleClicked(ImGui.MouseButton.Left)) {
          this.handleItemDoubleClick(item);
        }
        this.postRenderItem(item);

        // Other columns
        for (let c = 0; c < this._detailColumnsInfo.length; c++) {
          ImGui.TableSetColumnIndex(1 + c);
          ImGui.Text(this._data.getDetailColumn(item, c));
        }

        if (this._pendingFocusId && name === this._pendingFocusId) {
          ImGui.SetScrollHereY(0.25);
          this._pendingFocusId = null;
        }
      }

      ImGui.EndTable();
    }
  }
  render() {
    this._hoveredItem = null;
    this._items = this._data.getItems();
    const flags = this._draggingItem ? ImGui.WindowFlags.NoScrollbar : 0;
    ImGui.BeginChild(this._id, ImGui.GetContentRegionAvail(), false, flags);
    if (!ImGui.GetIO().MouseDown[0]) {
      this._draggingItem = false;
    }
    if (this._type === 'list') {
      this.renderListView();
    } else if (this._type === 'detail') {
      this.renderDetailView();
    } else if (this._type === 'grid') {
      this.renderGridView();
    }
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
          () => ImGui.Text(this._data.getDragSourceHint(this, item))
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
      let anchor = -1;
      let anchorRenew = true;
      let current = -1;
      for (let i = 0; i < this._items.length; i++) {
        if (this._items[i] === item) {
          current = i;
          if (anchor < 0) {
            anchor = current;
          }
          break;
        } else if (this._selectedItems.has(this._items[i])) {
          if (anchorRenew) {
            anchor = i;
            anchorRenew = false;
          }
        } else {
          anchorRenew = true;
        }
      }
      this._selectedItems.clear();
      for (let i = anchor; i <= current; i++) {
        this._selectedItems.add(this._items[i]);
      }
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
    if (this._type === 'list') {
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
  private getItemKey(item: T, index: number): string {
    // Use stable key if available from data; fallback to index
    // Prefer something like a unique path/name from your data
    return this._data.getItemName(item, index);
  }
  static testDataCls = class extends ListViewData<number> {
    private randNumbers = Array.from({ length: 5000 }).map(() => Math.random());
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
    getDragSourceHint(): string {
      return 'Hint';
    }
  };
  static testListView = new ListView('Test##TestListView', new this.testDataCls());
  static testListViewRenderer() {
    if (ImGui.Begin('TestListView')) {
      if (ImGui.RadioButton('List', this.testListView.type === 'list')) {
        this.testListView.type = 'list';
      }
      ImGui.SameLine();
      if (ImGui.RadioButton('Grid', this.testListView.type === 'grid')) {
        this.testListView.type = 'grid';
      }
      ImGui.SameLine();
      if (ImGui.RadioButton('Detail', this.testListView.type === 'detail')) {
        this.testListView.type = 'detail';
      }
      ImGui.BeginChild('TestListViewContainer', ImGui.GetContentRegionAvail(), true);
      this.testListView.render();
      ImGui.EndChild();
    }
    ImGui.End();
  }
}
