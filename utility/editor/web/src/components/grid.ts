import { ImGui } from '@zephyr3d/imgui';

type PropertyType = 'bool' | 'int' | 'float' | 'vec2' | 'vec3' | 'vec4' | 'string' | 'rgb' | 'rgba';
type PropertyValue = {
  num?: number[];
  str?: string[];
  bool?: boolean[];
};

export type PropertyAccessor<T extends {}> = {
  type: PropertyType;
  name: string;
  options?: { minValue: number; maxValue: number; speed: number };
  enum?: { labels: string[]; values: (number | string)[] };
  get(this: T, value: PropertyValue): void;
  set?(this: T, value: PropertyValue): void;
};

interface Property<T extends {}> {
  path: string;
  name: string;
  value: PropertyAccessor<T>;
}

class PropertyGroup<T extends {}> {
  name: string;
  properties: Map<string, Property<T>>;
  subgroups: PropertyGroup<T>[];

  constructor(name: string) {
    this.name = name;
    this.properties = new Map();
    this.subgroups = [];
  }
}

const tmpProperty: PropertyValue = {
  num: [0, 0, 0, 0],
  str: [''],
  bool: [false]
};

export class PropertyEditor<T extends {} = unknown> {
  private _rootGroup: PropertyGroup<T>;
  private _top: number;
  private _bottom: number;
  private _width: number;
  private _maxWidth: number;
  private _minWidth: number;
  private _padding: number;
  private _labelPercent: number;
  private _object: T;
  private _groupStack: PropertyGroup<T>[];
  constructor(
    top: number,
    bottom: number,
    width: number,
    padding: number,
    maxWidth: number,
    minWidth: number,
    labelPercent = 0.4
  ) {
    this._rootGroup = new PropertyGroup('Root');
    this._top = top;
    this._bottom = bottom;
    this._width = width;
    this._maxWidth = maxWidth;
    this._minWidth = minWidth;
    this._padding = padding;
    this._labelPercent = labelPercent;
    this._groupStack = [this._rootGroup];
    this._object = null;
  }
  get object(): T {
    return this._object;
  }
  set object(value: T) {
    this._object = value;
  }
  get width(): number {
    return this._width;
  }
  beginGroup(name: string) {
    const newGroup = new PropertyGroup(name);
    const currentGroup = this._groupStack[this._groupStack.length - 1];
    currentGroup.subgroups.push(newGroup);
    this._groupStack.push(newGroup);
  }
  endGroup() {
    if (this._groupStack.length > 1) {
      this._groupStack.pop();
    }
  }
  addProperty<U extends T>(value: PropertyAccessor<U>) {
    const property: Property<T> = {
      path: `${this._groupStack.map((g) => g.name).join('/')}/${value.name}`,
      name: value.name,
      value
    };
    this._groupStack[this._groupStack.length - 1].properties.set(value.name, property);
  }
  clear() {
    this._rootGroup = new PropertyGroup('Root');
    this._groupStack = [this._rootGroup];
  }
  render() {
    const displaySize = ImGui.GetIO().DisplaySize;
    const windowPos = new ImGui.ImVec2(displaySize.x - this._width, this._top);
    const windowSize = new ImGui.ImVec2(this._width, displaySize.y - this._top - this._bottom);
    ImGui.SetNextWindowPos(windowPos, ImGui.Cond.Always);
    ImGui.SetNextWindowSize(windowSize, ImGui.Cond.Always);
    const flags =
      ImGui.WindowFlags.NoMove |
      ImGui.WindowFlags.NoResize |
      ImGui.WindowFlags.NoCollapse |
      ImGui.WindowFlags.NoTitleBar;
    if (ImGui.Begin('Property Editor', null, flags)) {
      const initialCursorPos = ImGui.GetCursorPos();
      this.renderContent();
      this.renderResizeBar(initialCursorPos);
      ImGui.End();
    }
  }
  private renderContent() {
    const resizeBarWidth = 4;
    const padding = 8;
    ImGui.SetCursorPosX(ImGui.GetCursorPosX() + resizeBarWidth + padding);
    // 为resize bar预留空间
    //ImGui.SetCursorPosX(ImGui.GetCursorPosX() + 4);

    // 计算内容区域宽度
    const availableWidth = this._width - this._padding * 2 - 4 - resizeBarWidth - padding;
    const labelWidth = availableWidth * this._labelPercent;
    const valueWidth = availableWidth * (1 - this._labelPercent);

    // 使用 ChildWindow 来处理滚动，但不强制显示滚动条
    const contentHeight = ImGui.GetContentRegionAvail().y;
    const childFlags = ImGui.WindowFlags.None; // 允许在需要时显示滚动条

    if (
      ImGui.BeginChild('ContentRegion', new ImGui.ImVec2(availableWidth, contentHeight), false, childFlags)
    ) {
      if (
        ImGui.BeginTable(
          'PropertyTable',
          2,
          ImGui.TableFlags.BordersInnerV | ImGui.TableFlags.PadOuterX | ImGui.TableFlags.SizingFixedFit
        )
      ) {
        ImGui.TableSetupColumn('Name', ImGui.TableColumnFlags.WidthFixed, labelWidth);
        ImGui.TableSetupColumn('Value', ImGui.TableColumnFlags.WidthFixed, valueWidth);

        this.renderGroup(this._rootGroup);
        ImGui.EndTable();
      }

      ImGui.EndChild();
    }
  }
  private renderResizeBar(initialCursorPos: ImGui.ImVec2) {
    const resizeBarWidth = 4;
    const availableHeight = ImGui.GetContentRegionAvail().y;

    // 保存当前的样式
    ImGui.PushStyleColor(ImGui.Col.Button, ImGui.GetColorU32(ImGui.Col.ScrollbarGrab));
    ImGui.PushStyleColor(ImGui.Col.ButtonHovered, ImGui.GetColorU32(ImGui.Col.ScrollbarGrabHovered));
    ImGui.PushStyleColor(ImGui.Col.ButtonActive, ImGui.GetColorU32(ImGui.Col.ScrollbarGrabActive));

    // 移除按钮的内边距
    ImGui.PushStyleVar(ImGui.StyleVar.FramePadding, new ImGui.ImVec2(0, 0));

    // 设置位置并创建按钮
    ImGui.SetCursorPos(initialCursorPos);
    ImGui.Button('##resize', new ImGui.ImVec2(resizeBarWidth, availableHeight));

    // 恢复样式
    ImGui.PopStyleVar();
    ImGui.PopStyleColor(3);

    // 处理拖动逻辑
    if (ImGui.IsItemActive()) {
      const mouseDelta = ImGui.GetIO().MouseDelta.x;
      this._width = Math.max(Math.min(this._width - mouseDelta, this._maxWidth), this._minWidth);
      ImGui.SetMouseCursor(ImGui.MouseCursor.ResizeEW);
    } else if (ImGui.IsItemHovered()) {
      ImGui.SetMouseCursor(ImGui.MouseCursor.ResizeEW);
    }
  }
  private renderGroup(group: PropertyGroup<T>, level = 0) {
    for (const property of group.properties) {
      this.renderProperty(property[1], level);
    }
    for (const subgroup of group.subgroups) {
      ImGui.TableNextRow();
      ImGui.TableNextColumn();
      const flags = ImGui.TreeNodeFlags.DefaultOpen | ImGui.TreeNodeFlags.SpanFullWidth;
      if (level > 0) {
        ImGui.Indent(level * 10);
      }
      const opened = ImGui.TreeNodeEx(subgroup.name, flags);
      if (level > 0) {
        ImGui.Unindent(level * 10);
      }
      ImGui.TableNextColumn();
      if (opened) {
        this.renderGroup(subgroup, level + 1);
        ImGui.TreePop();
      }
    }
  }
  private renderProperty(property: Property<T>, level: number) {
    const { name, value } = property;
    ImGui.PushID(property.path);
    ImGui.TableNextRow();
    ImGui.TableNextColumn();
    if (level > 0) {
      ImGui.Indent(level * 10);
    }
    ImGui.AlignTextToFramePadding();
    ImGui.Text(name);
    if (level > 0) {
      ImGui.Unindent(level * 10);
    }
    ImGui.TableNextColumn();
    ImGui.SetNextItemWidth(-1); // 使用剩余所有宽度
    const readonly = !value.set;
    let changed = false;
    value.get.call(this._object, tmpProperty);
    switch (value.type) {
      case 'bool': {
        const val = tmpProperty.bool as [boolean];
        changed = ImGui.Checkbox('##value', val) && !readonly;
        break;
      }
      case 'int': {
        if (value.enum) {
          const val = [value.enum.values.indexOf(tmpProperty.num[0])] as [number];
          changed = ImGui.Combo('##value', val, value.enum.labels) && !readonly;
          if (changed) {
            tmpProperty.num[0] = value.enum.values[val[0]] as number;
          }
        } else {
          const val = tmpProperty.num as [number];
          changed = ImGui.DragInt(
            '##value',
            val,
            readonly ? 0 : value.options?.speed ?? 0.1,
            value.options?.minValue ?? undefined,
            value.options?.maxValue ?? undefined
          );
        }
        break;
      }
      case 'float': {
        if (value.enum) {
          const val = [value.enum.values.indexOf(tmpProperty.num[0])] as [number];
          changed = ImGui.Combo('##value', val, value.enum.labels) && !readonly;
          if (changed) {
            tmpProperty.num[0] = value.enum.values[val[0]] as number;
          }
        } else {
          const val = tmpProperty.num as [number];
          changed = ImGui.DragFloat(
            '##value',
            val,
            readonly ? 0 : value.options?.speed ?? 0.01,
            value.options?.minValue ?? undefined,
            value.options?.maxValue ?? undefined,
            '%.3f'
          );
        }
        break;
      }
      case 'string': {
        if (value.enum) {
          const val = [value.enum.values.indexOf(tmpProperty.str[0])] as [number];
          changed = ImGui.Combo('##value', val, value.enum.labels) && !readonly;
          if (changed) {
            tmpProperty.str[0] = value.enum.values[val[0]] as string;
          }
        } else {
          const val = tmpProperty.str as [string];
          changed = ImGui.InputText(
            '##value',
            val,
            undefined,
            readonly ? ImGui.InputTextFlags.ReadOnly : undefined
          );
        }
        break;
      }
      case 'vec2': {
        const val = tmpProperty.num as [number, number];
        changed = ImGui.InputFloat2(
          '##value',
          val,
          undefined,
          readonly ? ImGui.InputTextFlags.ReadOnly : undefined
        );
        break;
      }
      case 'vec3': {
        const val = tmpProperty.num as [number, number, number];
        changed = ImGui.InputFloat3(
          '##value',
          val,
          undefined,
          readonly ? ImGui.InputTextFlags.ReadOnly : undefined
        );
        break;
      }
      case 'vec4': {
        const val = tmpProperty.num as [number, number, number, number];
        changed = ImGui.InputFloat4(
          '##value',
          val,
          undefined,
          readonly ? ImGui.InputTextFlags.ReadOnly : undefined
        );
        break;
      }
      case 'rgb': {
        const val = tmpProperty.num as [number, number, number];
        changed = ImGui.ColorEdit3('##value', val, readonly ? ImGui.ColorEditFlags.NoInputs : undefined);
        break;
      }
      case 'rgba': {
        const val = tmpProperty.num as [number, number, number, number];
        changed = ImGui.ColorEdit4('##value', val, readonly ? ImGui.ColorEditFlags.NoInputs : undefined);
        break;
      }
    }
    if (changed && value.set) {
      value.set.call(this.object, tmpProperty);
    }
    ImGui.PopID();
  }
}
