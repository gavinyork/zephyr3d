import { ImGui } from '@zephyr3d/imgui';
import { eventBus } from '../core/eventbus';

export class ToolBar {
  private _tools: { label: string; id: string }[];
  private _pos: ImGui.ImVec2;
  private _size: ImGui.ImVec2;
  private _size2: ImGui.ImVec2;
  private _padding: ImGui.ImVec2;
  private _spacing: ImGui.ImVec2;
  private _buttonSize: ImGui.ImVec2;
  constructor(
    x: number,
    y: number,
    w: number,
    h: number,
    paddingX: number,
    paddingY: number,
    spacing: number,
    buttonWidth: number
  ) {
    this._tools = [];
    this._pos = new ImGui.ImVec2(x, y);
    this._size = new ImGui.ImVec2(w, h);
    this._size2 = new ImGui.ImVec2(w, h);
    this._padding = new ImGui.ImVec2(paddingX, paddingY);
    this._spacing = new ImGui.ImVec2(spacing, 0);
    this._buttonSize = new ImGui.ImVec2(buttonWidth, 0);
  }
  get x() {
    return this._pos.x;
  }
  set x(val) {
    this._pos.x = val;
  }
  get y() {
    return this._pos.y;
  }
  set y(val) {
    this._pos.y = val;
  }
  get width() {
    return this._size.x;
  }
  set width(val) {
    this._size.x = val;
  }
  get height() {
    return this._size.y;
  }
  set height(val) {
    this._size.y = val;
  }
  get tools() {
    return this._tools;
  }
  render() {
    const displaySize = ImGui.GetIO().DisplaySize;
    this._size2.x = this._size.x >= 0 ? this._size.x : displaySize.x;
    this._size2.y = this._size.y >= 0 ? this._size.y : displaySize.y;
    ImGui.PushStyleVar(ImGui.StyleVar.ItemSpacing, this._spacing);
    ImGui.PushStyleVar(ImGui.StyleVar.WindowPadding, this._padding);
    ImGui.PushStyleColor(ImGui.Col.Button, new ImGui.ImVec4(0, 0, 0, 0));
    ImGui.PushStyleColor(ImGui.Col.ButtonHovered, new ImGui.ImVec4(0.3, 0.3, 0.3, 0.2));
    ImGui.PushStyleColor(ImGui.Col.ButtonActive, new ImGui.ImVec4(0.3, 0.3, 0.3, 0.4));
    ImGui.SetNextWindowPos(this._pos);
    ImGui.SetNextWindowSize(this._size2);
    this._buttonSize.y = this._size2.y - 2 * this._padding.y;
    if (
      ImGui.Begin(
        'ToolBar',
        null,
        ImGui.WindowFlags.NoTitleBar |
          ImGui.WindowFlags.NoResize |
          ImGui.WindowFlags.NoMove |
          ImGui.WindowFlags.NoScrollbar |
          ImGui.WindowFlags.NoScrollWithMouse |
          ImGui.WindowFlags.NoCollapse
      )
    ) {
      for (const tool of this._tools) {
        if (ImGui.Button(`${tool.label}##${tool.id}`, this._buttonSize)) {
          eventBus.dispatchEvent('action', tool.id);
        }
        ImGui.SameLine();
      }
    }
    ImGui.End();
    ImGui.PopStyleVar(2);
    ImGui.PopStyleColor(3);
  }
}
