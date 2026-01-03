import type { Nullable } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';

export enum ResizeDirection {
  Left = 'left',
  Right = 'right',
  Top = 'top'
}

export class DockPannel {
  static _resizeId = 0;
  private _left: number;
  private _top: number;
  private _width: number;
  private _height: number;
  private readonly _padding: number;
  private _minWidth: number;
  private _maxWidth: number;
  private _minHeight: number;
  private _maxHeight: number;
  private _resizeDirection: ResizeDirection;
  private _initialCursorPos: Nullable<ImGui.ImVec2>;
  private _availableHeight: number;
  private readonly _buttonId: string;
  private _renderContent: boolean;
  constructor(
    left: number,
    top: number,
    width: number,
    height: number,
    padding: number,
    minWidth: number,
    maxWidth: number,
    resizeDirection: ResizeDirection = ResizeDirection.Right,
    minHeight: number = 0,
    maxHeight?: number
  ) {
    this._left = left;
    this._top = top;
    this._padding = padding;
    this._width = width;
    this._height = height;
    this._minWidth = minWidth;
    this._maxWidth = maxWidth;
    this._resizeDirection = resizeDirection;
    this._minHeight = minHeight;
    this._maxHeight = maxHeight ?? top * 2; // Default max top
    this._initialCursorPos = null;
    this._availableHeight = 0;
    this._buttonId = `##RESIZE${++DockPannel._resizeId}`;
    this._renderContent = false;
  }
  get top() {
    return this._top;
  }
  set top(val) {
    this._top = val;
  }
  get left() {
    return this._left;
  }
  set left(val) {
    this._left = val;
  }
  get width() {
    return this._width;
  }
  set width(val) {
    this._width = val;
  }
  get minWidth() {
    return this._minWidth;
  }
  set minWidth(val) {
    this._minWidth = val;
  }
  get maxWidth() {
    return this._maxWidth;
  }
  set maxWidth(val) {
    this._maxWidth = val;
  }
  get resizeDirection() {
    return this._resizeDirection;
  }
  set resizeDirection(val) {
    this._resizeDirection = val;
  }
  get height() {
    return this._height;
  }
  set height(val) {
    this._height = val;
  }

  get maxHeight() {
    return this._minHeight;
  }
  set maxHeight(val) {
    this._minHeight = val;
  }

  get maxTop() {
    return this._maxHeight;
  }
  set maxTop(val) {
    this._maxHeight = val;
  }
  get padding() {
    return this._padding;
  }
  beginChild(id: string, extraFlags = 0) {
    const windowPos = new ImGui.ImVec2(this._left, this._top);
    ImGui.SetCursorPos(windowPos);
    const windowSize = new ImGui.ImVec2(this._width, this._height);
    this._renderContent = false;
    if (ImGui.BeginChild(id, windowSize, true, extraFlags)) {
      this._initialCursorPos = ImGui.GetCursorPos();
      this._availableHeight = ImGui.GetContentRegionAvail().y;
      this.beginContent(extraFlags);
      return true;
    }
    return false;
  }
  endChild() {
    this.endContent();
    this.renderResizeBar(this._initialCursorPos!);
    ImGui.EndChild();
  }
  begin(id: string, extraFlags = 0) {
    const windowPos = new ImGui.ImVec2(this._left, this._top);
    const windowSize = new ImGui.ImVec2(this._width, this._height);
    ImGui.SetNextWindowPos(windowPos, ImGui.Cond.Always);
    ImGui.SetNextWindowSize(windowSize, ImGui.Cond.Always);
    const flags =
      ImGui.WindowFlags.NoMove |
      ImGui.WindowFlags.NoResize |
      ImGui.WindowFlags.NoCollapse |
      ImGui.WindowFlags.NoTitleBar |
      ImGui.WindowFlags.NoBringToFrontOnFocus;
    this._renderContent = false;
    if (ImGui.Begin(id, null, flags)) {
      this._initialCursorPos = ImGui.GetCursorPos();
      this._availableHeight = ImGui.GetContentRegionAvail().y;
      this.beginContent(extraFlags);
      return true;
    }
    return false;
  }
  end() {
    this.endContent();
    this.renderResizeBar(this._initialCursorPos!);
    ImGui.End();
  }
  private beginContent(extraFlags = 0) {
    const resizeBarSize = 4;
    const padding = 8;

    let leftOffset = 0;
    let topOffset = 0;
    let availableWidth = this._width - this._padding * 2;
    let availableHeight = ImGui.GetContentRegionAvail().y;

    // Adjust offsets based on resize direction
    switch (this._resizeDirection) {
      case ResizeDirection.Left:
        leftOffset = resizeBarSize + padding;
        availableWidth -= resizeBarSize + padding;
        break;
      case ResizeDirection.Right:
        availableWidth -= resizeBarSize + padding;
        break;
      case ResizeDirection.Top:
        topOffset = resizeBarSize + padding;
        availableHeight -= resizeBarSize + padding;
        break;
    }

    ImGui.SetCursorPosX(ImGui.GetCursorPosX() + leftOffset);
    ImGui.SetCursorPosY(ImGui.GetCursorPosY() + topOffset);

    //const childFlags = extraFlags; // Allow scrollbars when needed
    ImGui.BeginChild('ContentRegion', new ImGui.ImVec2(availableWidth, availableHeight), false, extraFlags);
    this._renderContent = true;
  }
  private endContent() {
    if (this._renderContent) {
      ImGui.EndChild();
      this._renderContent = false;
    }
  }
  private renderResizeBar(initialCursorPos: ImGui.ImVec2) {
    if (!initialCursorPos) {
      return;
    }
    const resizeBarSize = 4;
    const padding = 8;

    // Save current style
    ImGui.PushStyleColor(ImGui.Col.Button, ImGui.GetColorU32(ImGui.Col.ScrollbarGrab));
    ImGui.PushStyleColor(ImGui.Col.ButtonHovered, ImGui.GetColorU32(ImGui.Col.ScrollbarGrabHovered));
    ImGui.PushStyleColor(ImGui.Col.ButtonActive, ImGui.GetColorU32(ImGui.Col.ScrollbarGrabActive));
    ImGui.PushStyleVar(ImGui.StyleVar.FramePadding, new ImGui.ImVec2(0, 0));

    let buttonSize: ImGui.ImVec2;
    let buttonPos: ImGui.ImVec2;
    let cursorType: ImGui.MouseCursor;

    switch (this._resizeDirection) {
      case ResizeDirection.Left:
        buttonSize = new ImGui.ImVec2(resizeBarSize, this._availableHeight);
        buttonPos = initialCursorPos;
        cursorType = ImGui.MouseCursor.ResizeEW;
        break;

      case ResizeDirection.Right: {
        buttonSize = new ImGui.ImVec2(resizeBarSize, this._availableHeight);
        const windowWidth = ImGui.GetWindowSize().x;
        buttonPos = new ImGui.ImVec2(windowWidth - resizeBarSize - padding, initialCursorPos.y);
        cursorType = ImGui.MouseCursor.ResizeEW;
        break;
      }

      case ResizeDirection.Top: {
        const windowWidth = ImGui.GetWindowSize().x;
        buttonSize = new ImGui.ImVec2(windowWidth - padding * 2, resizeBarSize);
        buttonPos = new ImGui.ImVec2(padding, padding);
        cursorType = ImGui.MouseCursor.ResizeNS;
        break;
      }
    }

    ImGui.SetCursorPos(buttonPos);
    ImGui.Button(this._buttonId, buttonSize);

    // Restore style
    ImGui.PopStyleVar();
    ImGui.PopStyleColor(3);

    // Handle drag logic
    if (ImGui.IsItemActive()) {
      this.handleResize();
      ImGui.SetMouseCursor(cursorType);
    } else if (ImGui.IsItemHovered()) {
      ImGui.SetMouseCursor(cursorType);
    }
  }
  private handleResize() {
    const mouseDelta = ImGui.GetIO().MouseDelta;

    switch (this._resizeDirection) {
      case ResizeDirection.Left:
        // Dragging left edge: moving left increases width, moving right decreases width
        this._width = Math.max(Math.min(this._width - mouseDelta.x, this._maxWidth), this._minWidth);
        break;

      case ResizeDirection.Right: {
        // Dragging right edge: behavior depends on panel side
        let deltaX = mouseDelta.x;
        deltaX = -deltaX; // Invert for left-side panels
        this._width = Math.max(Math.min(this._width - deltaX, this._maxWidth), this._minWidth);
        break;
      }
      case ResizeDirection.Top: {
        // Dragging top edge: moving up decreases top (increases height), moving down increases top (decreases height)
        const newHeight = this._height - mouseDelta.y;
        // Clamp height to min/max limits
        const clampedHeight = Math.max(Math.min(newHeight, this._maxHeight), this._minHeight);
        // Update top to achieve the desired height
        this._top = this._top + this._height - clampedHeight;
        // Update height
        this._height = clampedHeight;
        break;
      }
    }
  }
}
