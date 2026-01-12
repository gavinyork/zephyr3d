import { ImGui } from '@zephyr3d/imgui';
import { Observable } from '@zephyr3d/base';
import type { BaseView } from '../views/baseview';

export type ToolBarItem = {
  label: string;
  id?: string;
  shortcut?: string;
  render?: (buttonSize: ImGui.ImVec2) => boolean;
  action?: () => void;
  tooltip?: () => string;
  visible?: () => boolean;
  selected?: () => boolean;
};

export class ToolBar extends Observable<{
  action: [id: string];
}> {
  private readonly _id: string;
  private readonly _tools: ToolBarItem[];
  private readonly _pos: ImGui.ImVec2;
  private readonly _size: ImGui.ImVec2;
  private readonly _size2: ImGui.ImVec2;
  private readonly _spacing: ImGui.ImVec2;
  private readonly _padding: ImGui.ImVec2;
  private readonly _buttonSize: ImGui.ImVec2;
  private readonly _sepColor: ImGui.ImVec4;
  private readonly _textColorUnselected: ImGui.ImVec4;
  private readonly _textColorSelected: ImGui.ImVec4;
  constructor(
    id: string,
    items: ToolBarItem[],
    x: number,
    y: number,
    w: number,
    h: number,
    buttonSizeX: number,
    buttonSizeY: number,
    spacing: number
  ) {
    super();
    this._id = id;
    this._tools = (items ?? []).map((item) => ({
      ...item
    }));
    this._pos = new ImGui.ImVec2(x, y);
    this._size = new ImGui.ImVec2(w, h);
    this._size2 = new ImGui.ImVec2(w, h);
    this._spacing = new ImGui.ImVec2(spacing, 0);
    this._buttonSize = new ImGui.ImVec2(buttonSizeX, buttonSizeY);
    this._padding = new ImGui.ImVec2();
    this._sepColor = ImGui.GetStyleColorVec4(ImGui.Col.Separator);
    this._textColorUnselected = new ImGui.ImVec4(0.6, 0.6, 0.6, 1);
    this._textColorSelected = new ImGui.ImVec4(1, 1, 1, 1);
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
  registerShortcuts(view: BaseView<any, any>) {
    for (const tool of this._tools) {
      if (tool.shortcut) {
        view.registerShortcut(tool.shortcut, () => {
          if (tool.action) {
            tool.action();
          } else if (tool.id) {
            this.dispatchEvent('action', tool.id);
          }
        });
      }
    }
  }
  unregisterShortcuts(view: BaseView<any, any>) {
    for (const tool of this._tools) {
      if (tool.shortcut) {
        view.unregisterShortcut(tool.shortcut);
      }
    }
  }
  render() {
    const displaySize = ImGui.GetIO().DisplaySize;
    this._size2.x = this._size.x >= 0 ? this._size.x : displaySize.x;
    this._size2.y = this._size.y >= 0 ? this._size.y : displaySize.y;
    this._padding.x = this._spacing.x;
    this._padding.y = (this._size2.y - this._buttonSize.y) >> 1;
    ImGui.PushStyleVar(ImGui.StyleVar.ItemSpacing, this._spacing);
    ImGui.PushStyleVar(ImGui.StyleVar.WindowPadding, this._padding);
    ImGui.PushStyleColor(ImGui.Col.WindowBg, ImGui.GetStyle().Colors[ImGui.Col.MenuBarBg]);
    ImGui.PushStyleColor(ImGui.Col.Button, new ImGui.ImVec4(0, 0, 0, 0));
    ImGui.PushStyleColor(ImGui.Col.ButtonHovered, new ImGui.ImVec4(0.3, 0.3, 0.3, 0.2));
    ImGui.PushStyleColor(ImGui.Col.ButtonActive, new ImGui.ImVec4(0.3, 0.3, 0.3, 0.4));
    ImGui.SetNextWindowPos(this._pos);
    ImGui.SetNextWindowSize(this._size2);
    this._buttonSize.y = this._size2.y - 2 * this._padding.y;
    if (
      ImGui.Begin(
        `##${this._id}`,
        null,
        ImGui.WindowFlags.NoTitleBar |
          ImGui.WindowFlags.NoResize |
          ImGui.WindowFlags.NoMove |
          ImGui.WindowFlags.NoScrollbar |
          ImGui.WindowFlags.NoScrollWithMouse |
          ImGui.WindowFlags.NoCollapse
      )
    ) {
      ImGui.PushID(this._id);
      for (let i = 0; i < this._tools.length; i++) {
        ImGui.PushID(i);
        const tool = this._tools[i];
        if (tool.label === '-') {
          ImGui.PushStyleColor(ImGui.Col.Button, this._sepColor);
          ImGui.PushStyleColor(ImGui.Col.ButtonHovered, this._sepColor);
          ImGui.PushStyleColor(ImGui.Col.ButtonActive, this._sepColor);
          ImGui.Button('##vsep', new ImGui.ImVec2(1, -1));
          ImGui.PopStyleColor(3);
        } else if (!tool.visible || tool.visible()) {
          ImGui.PushStyleColor(
            ImGui.Col.Text,
            tool.selected?.() ? this._textColorSelected : this._textColorUnselected
          );
          if (tool.render ? tool.render(this._buttonSize) : ImGui.Button(tool.label, this._buttonSize)) {
            if (tool.action) {
              tool.action();
            } else if (tool.id) {
              this.dispatchEvent('action', tool.id);
            }
          }
          ImGui.PopStyleColor();
          if (tool.tooltip && ImGui.IsItemHovered()) {
            const tooltip = tool.tooltip();
            if (tooltip) {
              ImGui.SetTooltip(tool.shortcut ? `${tooltip} (${tool.shortcut})` : tooltip);
            }
          }
        }
        ImGui.SameLine();
        ImGui.PopID();
      }
      ImGui.PopID();
    }
    ImGui.End();
    ImGui.PopStyleVar(2);
    ImGui.PopStyleColor(4);
  }
}
