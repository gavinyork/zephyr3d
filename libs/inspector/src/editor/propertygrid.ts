import { makeEventTarget } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';

interface Vec2 {
  x: number;
  y: number;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Vec4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

type PropertyType = 'int' | 'float' | 'vec2' | 'vec3' | 'vec4' | 'string' | 'color3' | 'color4';
type PropertyValue = number | string | Vec2 | Vec3 | Vec4;

interface Property {
  path: string;
  name: string;
  type: PropertyType;
  value: PropertyValue;
}

class PropertyGroup {
  name: string;
  properties: Map<string, Property>;
  subgroups: Map<string, PropertyGroup>;

  constructor(name: string) {
    this.name = name;
    this.properties = new Map();
    this.subgroups = new Map();
  }
}

export class PropertyEditor extends makeEventTarget(Object)<{
  property_changed: [path: string, value: PropertyValue];
}>() {
  private _rootGroup: PropertyGroup;
  private _tempInputValue;
  private _name: string;
  private _width: number;
  private _maxWidth: number;
  private _minWidth: number;
  private _padding: number;
  private _labelPercent: number;
  constructor(
    name: string,
    width: number,
    padding: number,
    maxWidth: number,
    minWidth: number,
    labelPercent = 0.4
  ) {
    super();
    this._name = name;
    this._rootGroup = new PropertyGroup(this._name);
    this._tempInputValue = '';
    this._width = width;
    this._maxWidth = maxWidth;
    this._minWidth = minWidth;
    this._padding = padding;
    this._labelPercent = labelPercent;
  }
  setProperty(path: string, type: PropertyType, value: PropertyValue) {
    const parts = path.split('/');
    const propertyName = parts[parts.length - 1];
    const property: Property = {
      path,
      name: propertyName,
      type,
      value
    };
    let currentGroup = this._rootGroup;
    for (let i = 0; i < parts.length - 1; i++) {
      const groupName = parts[i];
      if (!currentGroup.subgroups.has(groupName)) {
        currentGroup.subgroups.set(groupName, new PropertyGroup(groupName));
      }
      currentGroup = currentGroup.subgroups.get(groupName);
    }
    currentGroup.properties.set(propertyName, property);
  }
  getProperty(path: string): Property | undefined {
    const parts = path.split('/');
    const propertyName = parts[parts.length - 1];
    let currentGroup = this._rootGroup;
    for (let i = 0; i < parts.length - 1; i++) {
      currentGroup = currentGroup.subgroups.get(parts[i]);
      if (!currentGroup) return undefined;
    }
    return currentGroup.properties.get(propertyName);
  }
  removeProperty(path: string) {
    const parts = path.split('/');
    const propertyName = parts[parts.length - 1];
    let currentGroup = this._rootGroup;

    for (let i = 0; i < parts.length - 1; i++) {
      currentGroup = currentGroup.subgroups.get(parts[i]);
      if (!currentGroup) return;
    }
    currentGroup.properties.delete(propertyName);
  }
  clear() {
    this._rootGroup = new PropertyGroup(this._name);
  }
  render() {
    const displaySize = ImGui.GetIO().DisplaySize;
    const frameHeight = ImGui.GetFrameHeight();
    const windowPos = new ImGui.ImVec2(displaySize.x - this._width, frameHeight);
    const windowSize = new ImGui.ImVec2(this._width, displaySize.y - 2 * frameHeight);
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
    // 为resize bar预留空间
    ImGui.SetCursorPosX(ImGui.GetCursorPosX() + 4);

    // 计算内容区域宽度
    const availableWidth = this._width - this._padding * 2 - 4;
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
    const windowPos = ImGui.GetWindowPos();
    const windowHeight = ImGui.GetWindowSize().y;

    // 设置resize bar的位置（窗口最左侧）
    const resizeBarPos = new ImGui.ImVec2(windowPos.x, windowPos.y);

    // 绘制resize bar
    const drawList = ImGui.GetWindowDrawList();
    drawList.AddRectFilled(
      resizeBarPos,
      new ImGui.ImVec2(resizeBarPos.x + resizeBarWidth, resizeBarPos.y + windowHeight),
      ImGui.GetColorU32(ImGui.Col.ScrollbarGrabHovered)
    );

    // 处理拖动逻辑
    ImGui.SetCursorPos(initialCursorPos); // 恢复到初始光标位置
    ImGui.InvisibleButton('##resize', new ImGui.ImVec2(resizeBarWidth, windowHeight));

    if (ImGui.IsItemActive()) {
      const mouseDelta = ImGui.GetIO().MouseDelta.x;
      this._width = Math.max(Math.min(this._width - mouseDelta, this._maxWidth), this._minWidth);
      ImGui.SetMouseCursor(ImGui.MouseCursor.ResizeEW);
    } else if (ImGui.IsItemHovered()) {
      ImGui.SetMouseCursor(ImGui.MouseCursor.ResizeEW);
    }
  }
  private renderGroup(group: PropertyGroup, level = 0) {
    for (const [groupName, subgroup] of group.subgroups) {
      ImGui.TableNextRow();
      ImGui.TableNextColumn();
      const flags = ImGui.TreeNodeFlags.DefaultOpen | ImGui.TreeNodeFlags.SpanFullWidth;
      if (level > 0) {
        ImGui.Indent(level * 10);
      }
      const opened = ImGui.TreeNodeEx(groupName, flags);
      if (level > 0) {
        ImGui.Unindent(level * 10);
      }
      ImGui.TableNextColumn();
      if (opened) {
        this.renderGroup(subgroup, level + 1);
        ImGui.TreePop();
      }
    }
    for (const property of group.properties) {
      this.renderProperty(property[1], level);
    }
  }
  private renderProperty(property: Property, level: number) {
    const { name, type, value } = property;
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
    let changed = false;
    let newValue: PropertyValue = value;
    switch (type) {
      case 'int': {
        const val = [value] as [number];
        changed = ImGui.DragInt('##value', val, 0.1);
        newValue = val[0];
        break;
      }
      case 'float': {
        const val = [value] as [number];
        changed = ImGui.DragFloat('##value', val, 0.01, undefined, undefined, '%.3f');
        newValue = val[0];
        break;
      }
      case 'string': {
        if (this._tempInputValue === '') {
          this._tempInputValue = value as string;
        }
        const val = [this._tempInputValue] as [string];
        if (ImGui.InputText('##value', val)) {
          this._tempInputValue = val[0];
          changed = true;
          newValue = val[0];
        }
        break;
      }
      case 'vec2': {
        const v = value as Vec2;
        const val = [v.x, v.y] as [number, number];
        changed = ImGui.DragFloat2('##value', val, 0.01, undefined, undefined, '%.3f');
        newValue = { x: val[0], y: val[1] };
        break;
      }
      case 'vec3': {
        const v = value as Vec3;
        const val = [v.x, v.y, v.z] as [number, number, number];
        changed = ImGui.DragFloat3('##value', val, 0.01, undefined, undefined, '%.3f');
        newValue = { x: val[0], y: val[1], z: val[2] };
        break;
      }
      case 'vec4': {
        const v = value as Vec4;
        const val = [v.x, v.y, v.z, v.w] as [number, number, number, number];
        changed = ImGui.DragFloat4('##value', val, 0.01, undefined, undefined, '%.3f');
        newValue = { x: val[0], y: val[1], z: val[2], w: val[3] };
        break;
      }
      case 'color3': {
        const c = value as Vec3;
        const val = [c.x, c.y, c.z] as [number, number, number];
        changed = ImGui.ColorEdit3('##value', val);
        newValue = { x: val[0], y: val[1], z: val[2] };
        break;
      }
      case 'color4': {
        const c = value as Vec4;
        const val = [c.x, c.y, c.z, c.w] as [number, number, number, number];
        changed = ImGui.ColorEdit4('##value', val);
        newValue = { x: val[0], y: val[1], z: val[2], w: val[3] };
        break;
      }
    }
    if (changed) {
      this.setProperty(property.path, type, newValue);
      this.dispatchEvent('property_changed', property.path, newValue);
    }
    ImGui.PopID();
  }
}

// 使用示例：
/*
const editor = new PropertyEditor((path, value) => {
  console.log(`Property ${path} changed to:`, value);
});

// 添加分组属性
editor.setProperty("Transform/Position", "vec3", { x: 0, y: 0, z: 0 });
editor.setProperty("Transform/Rotation", "vec3", { x: 0, y: 0, z: 0 });
editor.setProperty("Transform/Scale", "vec3", { x: 1, y: 1, z: 1 });

editor.setProperty("Material/Color", "color4", { r: 1, g: 1, b: 1, a: 1 });
editor.setProperty("Material/Roughness", "float", 0.5);
editor.setProperty("Material/Metallic", "float", 0.0);

editor.setProperty("General/Name", "string", "Object");
editor.setProperty("General/ID", "int", 1);

// 在渲染循环中调用
function render() {
  ImGui.NewFrame();
  editor.render();
  ImGui.EndFrame();
  ImGui.Render();
}
*/
