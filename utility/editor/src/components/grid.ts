import { ImGui } from '@zephyr3d/imgui';
import type { AssetRegistry } from '@zephyr3d/scene';
import {
  getSerializationInfo,
  type PropertyAccessor,
  type PropertyValue,
  type SerializableClass
} from '@zephyr3d/scene';
import type { DBAssetInfo } from '../storage/db';

interface Property<T extends {}> {
  path: string;
  name: string;
  value: PropertyAccessor<T>;
}

class PropertyGroup {
  grid: PropertyEditor;
  name: string;
  value: PropertyValue;
  parent: PropertyGroup;
  property: Property<any>;
  currentType: number;
  objectTypes: SerializableClass[];
  prop: PropertyAccessor<any>;
  properties: Map<string, Property<any>>;
  object: any;
  subgroups: PropertyGroup[];
  constructor(name: string, grid: PropertyEditor) {
    this.grid = grid;
    this.name = name;
    this.parent = null;
    this.value = { num: [], str: [], bool: [], object: [null] };
    this.property = null;
    this.prop = null;
    this.currentType = -1;
    this.objectTypes = [];
    this.properties = new Map();
    this.subgroups = [];
  }
  addProperty(obj: any, value: PropertyAccessor<any>) {
    const tmpProperty: PropertyValue = {
      num: [0, 0, 0, 0],
      str: [''],
      bool: [false],
      object: []
    };
    if (value.type === 'object' && value.objectTypes?.length > 0) {
      const propGroup = this.addGroup(value.name);
      value.get.call(obj, tmpProperty);
      propGroup.setObject(tmpProperty.object[0], value, obj);
    } else {
      const property: Property<any> = {
        path: `${this.name}/${value.name}`,
        name: value.name,
        value
      };
      value.get.call(obj, this.value);
      this.properties.set(value.name, property);
    }
  }
  addGroup(name: string) {
    const group = new PropertyGroup(name, this.grid);
    group.parent = this;
    this.subgroups.push(group);
    return group;
  }
  getObject() {
    let group: PropertyGroup = this;
    while (group) {
      if (group.value.object[0]) {
        return group.value.object[0];
      }
      group = group.parent;
    }
    return null;
  }
  setObject(obj: any, prop?: PropertyAccessor<any>, parentObj?: any) {
    if (this.value.object[0] !== obj) {
      const serializationInfo = this.grid.serailizationInfo;
      this.value.object[0] = obj ?? null;
      this.property = null;
      this.object = parentObj;
      this.currentType = -1;
      this.prop = prop ?? null;
      this.objectTypes =
        prop?.objectTypes?.length > 0
          ? prop.objectTypes.map((ctor) => this.grid.serailizationInfo.get(ctor)) ?? []
          : [];
      //this.objectTypes = objTypes ?? [];
      this.properties = new Map();
      this.subgroups = [];
      if (this.value.object[0]) {
        let cls: SerializableClass = null;
        let ctor = this.value.object[0].constructor;
        while (ctor) {
          cls = serializationInfo.get(ctor);
          if (cls) {
            const props = cls.getProps(this.value.object[0], false).filter((p) => !p.hidden);
            if (props.length > 0) {
              const group = this.addGroup(cls.className);
              for (const prop of props) {
                group.addProperty(this.value.object[0], prop);
              }
            }
          }
          ctor = Object.getPrototypeOf(ctor);
        }
      }
    }
  }
}

export class PropertyEditor {
  private _rootGroup: PropertyGroup;
  private _top: number;
  private _bottom: number;
  private _width: number;
  private _maxWidth: number;
  private _minWidth: number;
  private _padding: number;
  private _labelPercent: number;
  private _serializationInfo: Map<any, SerializableClass>;
  private _assetRegistry: AssetRegistry;
  private _dragging: boolean;
  private _dirty: boolean;
  constructor(
    assetRegistry: AssetRegistry,
    top: number,
    bottom: number,
    width: number,
    padding: number,
    maxWidth: number,
    minWidth: number,
    labelPercent = 0.4
  ) {
    this._assetRegistry = assetRegistry;
    this._serializationInfo = getSerializationInfo(assetRegistry);
    this._rootGroup = new PropertyGroup('Root', this);
    this._top = top;
    this._bottom = bottom;
    this._width = width;
    this._maxWidth = maxWidth;
    this._minWidth = minWidth;
    this._padding = padding;
    this._labelPercent = labelPercent;
    this._dragging = false;
    this._dirty = false;
  }
  get serailizationInfo(): Map<any, SerializableClass> {
    return this._serializationInfo;
  }
  get object(): any {
    return this._rootGroup.getObject();
  }
  set object(value: any) {
    this._rootGroup.setObject(value);
  }
  get width(): number {
    return this._width;
  }
  clear() {
    this._rootGroup = new PropertyGroup('Root', this);
  }
  refresh() {
    this._dirty = true;
  }
  render() {
    if (this._dirty) {
      this._dirty = false;
      const object = this.object;
      this.clear();
      this.object = object;
    }
    const displaySize = ImGui.GetIO().DisplaySize;
    const windowPos = new ImGui.ImVec2(displaySize.x - this._width, this._top);
    const windowSize = new ImGui.ImVec2(this._width, displaySize.y - this._top - this._bottom);
    ImGui.SetNextWindowPos(windowPos, ImGui.Cond.Always);
    ImGui.SetNextWindowSize(windowSize, ImGui.Cond.Always);
    const flags =
      ImGui.WindowFlags.NoMove |
      ImGui.WindowFlags.NoResize |
      ImGui.WindowFlags.NoCollapse |
      ImGui.WindowFlags.NoTitleBar |
      ImGui.WindowFlags.NoBringToFrontOnFocus;
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
    const availableWidth = this._width - this._padding * 2 - 4 - resizeBarWidth - padding;
    const labelWidth = availableWidth * this._labelPercent;
    const valueWidth = availableWidth * (1 - this._labelPercent);
    const contentHeight = ImGui.GetContentRegionAvail().y;
    const childFlags = ImGui.WindowFlags.None; // 允许在需要时显示滚动条

    if (
      ImGui.BeginChild('ContentRegion', new ImGui.ImVec2(availableWidth, contentHeight), false, childFlags)
    ) {
      // Prevent unexpected scrolling
      if (
        ImGui.IsWindowHovered(ImGui.HoveredFlags.AllowWhenBlockedByActiveItem) &&
        ImGui.IsMouseClicked(ImGui.MouseButton.Left)
      ) {
        this._dragging = true;
      }
      if (!ImGui.IsMouseDown(ImGui.MouseButton.Left)) {
        this._dragging = false;
      }
      if (!this._dragging) {
        ImGui.SetScrollY(ImGui.GetScrollY());
      }
      // Draw properties
      if (
        ImGui.BeginTable(
          'PropertyTable',
          2,
          ImGui.TableFlags.BordersInnerV | ImGui.TableFlags.PadOuterX | ImGui.TableFlags.SizingFixedFit
        )
      ) {
        ImGui.TableSetupColumn('Name', ImGui.TableColumnFlags.WidthFixed, labelWidth);
        ImGui.TableSetupColumn('Value', ImGui.TableColumnFlags.WidthFixed, valueWidth);
        this.renderSubGroups(this._rootGroup, 0);

        ImGui.EndTable();
      }

      ImGui.EndChild();
    }
  }
  private renderSubGroups(group: PropertyGroup, level: number) {
    for (let i = 0; i < group.subgroups.length; i++) {
      const subgroup = group.subgroups[i];
      ImGui.PushID(i);
      this.renderGroup(subgroup, level);
      ImGui.PopID();
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
  private renderGroup(group: PropertyGroup, level = 0) {
    ImGui.TableNextRow();
    ImGui.TableNextColumn();
    if (level > 0) {
      ImGui.Indent(level * 10);
    }
    const flags = ImGui.TreeNodeFlags.DefaultOpen | ImGui.TreeNodeFlags.SpanFullWidth;
    const opened = ImGui.TreeNodeEx(group.name, flags);
    if (group.object && group.prop && group.objectTypes.length > 0) {
      ImGui.TableNextColumn();
      ImGui.BeginChild('', new ImGui.ImVec2(-1, ImGui.GetFrameHeight()));
      ImGui.SetNextItemWidth(ImGui.GetContentRegionAvail().x);
      const index = [
        group.objectTypes.findIndex((val) => val.ctor === (group.getObject()?.constructor ?? null))
      ] as [number];
      if (
        ImGui.Combo(
          '',
          index,
          group.objectTypes.map((val) => val.className),
          group.objectTypes.length
        )
      ) {
        const newObj = new group.objectTypes[index[0]].ctor();
        group.prop.set.call(group.object, { object: [newObj] });
        this.refresh();
      }
      ImGui.EndChild();
    }
    if (opened) {
      ImGui.TreePop();
      for (const property of group.properties) {
        this.renderProperty(property[1], level + 1, group.getObject());
      }
      this.renderSubGroups(group, level + 1);
    }
    if (level > 0) {
      ImGui.Unindent(level * 10);
    }
  }
  private renderProperty(property: Property<any>, level: number, object?: any) {
    const { name, value } = property;
    object = object ?? this.object;
    if (value.isValid && !value.isValid.call(object)) {
      return;
    }
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
    const tmpProperty: PropertyValue = {
      num: [0, 0, 0, 0],
      str: [''],
      bool: [false],
      object: []
    };
    value.get.call(object, tmpProperty);
    switch (value.type) {
      case 'bool': {
        const val = tmpProperty.bool as [boolean];
        changed = ImGui.Checkbox(`##value`, val) && !readonly;
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
      case 'object': {
        const val = tmpProperty.str as [string];
        const assetInfo = this._assetRegistry.getAssetInfo(val[0]);
        if (assetInfo) {
          val[0] = assetInfo.name;
        }
        if (value.nullable) {
          ImGui.SetNextItemWidth(ImGui.GetContentRegionAvail().x - ImGui.GetFrameHeight());
        }
        ImGui.InputText('##value', val, undefined, ImGui.InputTextFlags.ReadOnly);
        if (ImGui.BeginDragDropTarget()) {
          const payload = ImGui.AcceptDragDropPayload('ASSET:texture');
          if (payload) {
            tmpProperty.str[0] = (payload.Data as DBAssetInfo).uuid;
            value.set.call(object, tmpProperty);
          }
          ImGui.EndDragDropTarget();
        }
        if (value.nullable) {
          ImGui.SameLine(0, 0);
          if (ImGui.Button('X##clear', new ImGui.ImVec2(-1, 0))) {
            value.set.call(object, null);
            if (property.value.objectTypes?.length > 0) {
              ImGui.OpenPopup('X##list');
              if (ImGui.BeginPopup('X##list')) {
                for (const t of property.value.objectTypes) {
                  const cls = this._serializationInfo.get(t);
                  if (cls && ImGui.MenuItem(`${cls.className}##create`)) {
                    alert(cls.className);
                  }
                }
                ImGui.EndPopup();
              }
            }
          }
        }
      }
    }
    if (changed && value.set) {
      value.set.call(object, tmpProperty);
    }
    ImGui.PopID();
  }
}
