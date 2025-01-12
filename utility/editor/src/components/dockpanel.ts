import { ImGui } from '@zephyr3d/imgui';

export class DockPannel {
  static _resizeId = 0;
  private _left: boolean;
  private _top: number;
  private _bottom: number;
  private _padding: number;
  private _width: number;
  private _minWidth: number;
  private _maxWidth: number;
  private _initialCursorPos: ImGui.ImVec2;
  private _availableHeight: number;
  private _buttonId: string;
  constructor(
    left: boolean,
    top: number,
    bottom: number,
    padding: number,
    width: number,
    minWidth: number,
    maxWidth: number
  ) {
    this._left = left;
    this._top = top;
    this._bottom = bottom;
    this._padding = padding;
    this._width = width;
    this._minWidth = minWidth;
    this._maxWidth = maxWidth;
    this._initialCursorPos = null;
    this._availableHeight = 0;
    this._buttonId = `##RESIZE${++DockPannel._resizeId}`;
  }
  get left() {
    return this._left;
  }
  set left(val) {
    this._left = val;
  }
  get top() {
    return this._top;
  }
  set top(val) {
    this._top = val;
  }
  get bottom() {
    return this._bottom;
  }
  set bottom(val) {
    this._bottom = val;
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
  begin(id: string) {
    const displaySize = ImGui.GetIO().DisplaySize;
    const frameHeightTop = this._top;
    const frameHeightBottom = this._bottom;
    const windowPos = this._left
      ? new ImGui.ImVec2(0, frameHeightTop)
      : new ImGui.ImVec2(displaySize.x - this._width, frameHeightTop);
    const windowSize = new ImGui.ImVec2(this._width, displaySize.y - frameHeightTop - frameHeightBottom);
    ImGui.SetNextWindowPos(windowPos, ImGui.Cond.Always);
    ImGui.SetNextWindowSize(windowSize, ImGui.Cond.Always);
    const flags =
      ImGui.WindowFlags.NoMove |
      ImGui.WindowFlags.NoResize |
      ImGui.WindowFlags.NoCollapse |
      ImGui.WindowFlags.NoTitleBar |
      ImGui.WindowFlags.NoBringToFrontOnFocus;
    if (ImGui.Begin(id, null, flags)) {
      this._initialCursorPos = ImGui.GetCursorPos();
      this._availableHeight = ImGui.GetContentRegionAvail().y;
      this.beginContent();
      return true;
    }
    return false;
  }
  end() {
    this.endContent();
    this.renderResizeBar(this._initialCursorPos);
    ImGui.End();
  }
  private beginContent() {
    const resizeBarWidth = 4;
    const padding = 8;
    if (!this._left) {
      ImGui.SetCursorPosX(ImGui.GetCursorPosX() + resizeBarWidth + padding);
    }
    const availableWidth = this._width - this._padding * 2 - 4 - resizeBarWidth - padding;
    const contentHeight = ImGui.GetContentRegionAvail().y;
    const childFlags = ImGui.WindowFlags.None; // 允许在需要时显示滚动条
    ImGui.BeginChild('ContentRegion', new ImGui.ImVec2(availableWidth, contentHeight), false, childFlags);
  }
  private endContent() {
    ImGui.EndChild();
  }
  private renderResizeBar(initialCursorPos: ImGui.ImVec2) {
    const resizeBarWidth = 4;
    const padding = 8;
    const availableHeight = this._availableHeight; //ImGui.GetContentRegionAvail().y;

    // 保存当前的样式
    ImGui.PushStyleColor(ImGui.Col.Button, ImGui.GetColorU32(ImGui.Col.ScrollbarGrab));
    ImGui.PushStyleColor(ImGui.Col.ButtonHovered, ImGui.GetColorU32(ImGui.Col.ScrollbarGrabHovered));
    ImGui.PushStyleColor(ImGui.Col.ButtonActive, ImGui.GetColorU32(ImGui.Col.ScrollbarGrabActive));

    // 移除按钮的内边距
    ImGui.PushStyleVar(ImGui.StyleVar.FramePadding, new ImGui.ImVec2(0, 0));

    // 设置位置并创建按钮
    if (this._left) {
      const windowWidth = ImGui.GetWindowSize().x;
      ImGui.SetCursorPos(new ImGui.ImVec2(windowWidth - resizeBarWidth - padding, initialCursorPos.y));
    } else {
      ImGui.SetCursorPos(initialCursorPos);
    }
    ImGui.Button(this._buttonId, new ImGui.ImVec2(resizeBarWidth, availableHeight));

    // 恢复样式
    ImGui.PopStyleVar();
    ImGui.PopStyleColor(3);

    // 处理拖动逻辑
    if (ImGui.IsItemActive()) {
      let mouseDelta = ImGui.GetIO().MouseDelta.x;
      if (this._left) {
        mouseDelta = -mouseDelta;
      }
      this._width = Math.max(Math.min(this._width - mouseDelta, this._maxWidth), this._minWidth);
      ImGui.SetMouseCursor(ImGui.MouseCursor.ResizeEW);
    } else if (ImGui.IsItemHovered()) {
      ImGui.SetMouseCursor(ImGui.MouseCursor.ResizeEW);
    }
  }
}
