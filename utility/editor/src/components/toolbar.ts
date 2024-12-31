import { ImGui } from '@zephyr3d/imgui';
import { makeEventTarget } from '@zephyr3d/base';
import type { BaseView } from '../views/baseview';

export type ToolBarItem = {
  label: string;
  id?: string;
  tooltip?: string;
  shortcut?: string;
  group?: number;
  selected?: boolean;
};

export class ToolBar extends makeEventTarget(Object)<{
  action: [id: string];
}>() {
  private _tools: ToolBarItem[];
  private _state: Record<number, string>;
  private _pos: ImGui.ImVec2;
  private _size: ImGui.ImVec2;
  private _size2: ImGui.ImVec2;
  private _spacing: ImGui.ImVec2;
  private _padding: ImGui.ImVec2;
  private _buttonSize: ImGui.ImVec2;
  private _sepColor: ImGui.ImVec4;
  private _textColorUnselected: ImGui.ImVec4;
  private _textColorSelected: ImGui.ImVec4;
  constructor(
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
    this._tools = [...items];
    this._state = {};
    this._pos = new ImGui.ImVec2(x, y);
    this._size = new ImGui.ImVec2(w, h);
    this._size2 = new ImGui.ImVec2(w, h);
    this._spacing = new ImGui.ImVec2(spacing, 0);
    this._buttonSize = new ImGui.ImVec2(buttonSizeX, buttonSizeY);
    this._padding = new ImGui.ImVec2();
    this._sepColor = ImGui.GetStyleColorVec4(ImGui.Col.Separator);
    this._textColorUnselected = new ImGui.ImVec4(0.6, 0.6, 0.6, 1);
    this._textColorSelected = new ImGui.ImVec4(1, 1, 1, 1);
    for (const item of this._tools) {
      if (item.group >= 0) {
        this._state[item.group] = item.selected ? item.id : this._state[item.group] ?? null;
      }
    }
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
  selectTool(id: string, select: boolean) {
    for (const tool of this._tools) {
      if (tool.id === id && tool.group >= 0) {
        this._state[tool.group] = select ? tool.id : null;
      }
    }
  }
  toolSelected(id: string) {
    for (const tool of this._tools) {
      if (tool.id === id && tool.group >= 0) {
        return this._state[tool.group] === tool.id;
      }
    }
    return false;
  }
  registerShortcuts(view: BaseView<any>) {
    for (const tool of this._tools) {
      if (tool.shortcut) {
        view.registerShortcut(tool.shortcut, () => {
          const selected = tool.group >= 0 && tool.id === this._state[tool.group];
          if (!selected) {
            this.dispatchEvent('action', tool.id);
            if (tool.group >= 0) {
              this._state[tool.group] = tool.id;
            }
          }
        });
      }
    }
  }
  unregisterShortcuts(view: BaseView<any>) {
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
        if (tool.label === '-') {
          ImGui.PushStyleColor(ImGui.Col.Button, this._sepColor);
          ImGui.PushStyleColor(ImGui.Col.ButtonHovered, this._sepColor);
          ImGui.PushStyleColor(ImGui.Col.ButtonActive, this._sepColor);
          ImGui.Button('##vsep', new ImGui.ImVec2(1, -1));
          ImGui.PopStyleColor(3);
        } else {
          let selected: boolean;
          if (tool.group >= 0) {
            selected = tool.id === this._state[tool.group];
            const col = selected ? this._textColorSelected : this._textColorUnselected;
            ImGui.PushStyleColor(ImGui.Col.Text, col);
          } else {
            selected = false;
          }
          if (ImGui.Button(`${tool.label}##${tool.id}`, this._buttonSize)) {
            if (!selected) {
              this.dispatchEvent('action', tool.id);
              if (tool.group >= 0) {
                this._state[tool.group] = tool.id;
              }
            }
          }
          if (tool.tooltip && ImGui.IsItemHovered()) {
            ImGui.SetTooltip(tool.tooltip);
          }
          if (tool.group >= 0) {
            ImGui.PopStyleColor();
          }
        }
        ImGui.SameLine();
      }
    }
    ImGui.End();
    ImGui.PopStyleVar(2);
    ImGui.PopStyleColor(4);
  }
}
