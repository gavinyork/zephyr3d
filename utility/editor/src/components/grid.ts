import { ImGui } from '@zephyr3d/imgui';
import type { SerializationManager } from '@zephyr3d/scene';
import {
  AnimationClip,
  AnimationSet,
  PropertyTrack,
  SceneNode,
  type PropertyAccessor,
  type PropertyValue,
  type SerializableClass
} from '@zephyr3d/scene';
import type { DBAssetInfo } from '../storage/db';
import { FontGlyph } from '../core/fontglyph';
import type { GenericConstructor } from '@zephyr3d/base';
import { AABB, degree2radian, makeEventTarget, Quaternion, radian2degree } from '@zephyr3d/base';
import { RotationEditor } from './rotationeditor';
import { Dialog } from '../views/dlg/dlg';

interface Property<T extends {}> {
  path: string;
  name: string;
  object: any;
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
  properties: (PropertyGroup | { name: string; property: Property<any> })[];
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
    this.properties = [];
    this.subgroups = [];
  }
  addSeparator(label: string) {
    this.properties.push({
      name: label,
      property: {
        name: label,
        path: '',
        object: null,
        value: null
      }
    });
  }
  addProperty(obj: any, value: PropertyAccessor<any>) {
    let group: PropertyGroup = this;
    if (value.isValid && !value.isValid.call(obj)) {
      return;
    }
    if (value.group) {
      group = this.findOrAddGroup(value.group);
    }
    const tmpProperty: PropertyValue = {
      num: [0, 0, 0, 0],
      str: [''],
      bool: [false],
      object: []
    };
    if (value.type === 'object' && value.objectTypes?.length > 0) {
      value.get.call(obj, tmpProperty);
      const propGroup = group.addGroup(value.name);
      propGroup.setObject(tmpProperty.object[0], value, obj);
    } else if (value.type === 'object_array' && value.objectTypes?.length > 0) {
      value.get.call(obj, tmpProperty);
      if (tmpProperty.object) {
        for (let i = 0; i < tmpProperty.object.length; i++) {
          const propGroup = group.addGroup(`${value.name}[${i}]`);
          propGroup.setObject(tmpProperty.object[i], value, obj);
        }
      }
    } else {
      const property: Property<any> = {
        path: `${group.name}/${value.name}`,
        name: value.name,
        object: obj,
        value
      };
      if (!value.isValid || value.isValid.call(obj)) {
        value.get.call(obj, group.value);
      }
      group.properties.push({ name: value.name, property });
    }
  }
  addGroup(name: string) {
    const group = new PropertyGroup(name, this.grid);
    group.parent = this;
    this.subgroups.push(group);
    return group;
  }
  findOrAddGroup(name: string) {
    const parts = name.split('/');
    const firstPart = parts.shift();
    let parent = this.properties.find(
      (p) => p instanceof PropertyGroup && p.name === firstPart
    ) as PropertyGroup;
    if (!parent) {
      parent = new PropertyGroup(firstPart, this.grid);
      this.properties.push(parent);
    }
    let group: PropertyGroup = null;
    while (parts.length > 0) {
      const part = parts.shift();
      group = parent.subgroups.find((g) => g.name === part);
      if (!group) {
        group = parent.addGroup(part);
      }
      parent = group;
    }
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
    if (this.value.object[0] !== obj || this.prop !== prop) {
      const serializationManager = this.grid.serailizationManager;
      this.value.object[0] = obj ?? null;
      this.property = null;
      this.object = parentObj;
      this.currentType = -1;
      this.prop = prop ?? null;
      this.objectTypes =
        prop?.objectTypes?.length > 0
          ? prop.objectTypes.map((ctor) => serializationManager.getClassByConstructor(ctor)) ?? []
          : [];
      this.properties = [];
      this.subgroups = [];
      if (this.value.object[0]) {
        let cls: SerializableClass = null;
        let ctor = this.value.object[0].constructor as GenericConstructor;
        while (ctor) {
          cls = serializationManager.getClassByConstructor(ctor);
          if (cls) {
            const props = serializationManager.getPropertiesByClass(cls).filter((p) => !p.hidden);
            if (props.length > 0) {
              this.addSeparator(cls.ctor.name);
              for (const prop of props) {
                this.addProperty(this.value.object[0], prop);
              }
            }
          }
          ctor = Object.getPrototypeOf(ctor);
        }
      }
    }
  }
}

export class PropertyEditor extends makeEventTarget(Object)<{
  request_edit_aabb: [aabb: AABB];
  end_edit_aabb: [aabb: AABB];
  object_property_changed: [object: unknown, prop: string];
}>() {
  private _rootGroup: PropertyGroup;
  private _top: number;
  private _bottom: number;
  private _width: number;
  private _maxWidth: number;
  private _minWidth: number;
  private _padding: number;
  private _labelPercent: number;
  private _serializationManager: SerializationManager;
  private _dragging: boolean;
  private _dirty: boolean;
  constructor(
    serializationManager: SerializationManager,
    top: number,
    bottom: number,
    width: number,
    padding: number,
    maxWidth: number,
    minWidth: number,
    labelPercent = 0.4
  ) {
    super();

    this._serializationManager = serializationManager;
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
  get serailizationManager(): SerializationManager {
    return this._serializationManager;
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
    const animateLabelWidth = ImGui.GetFrameHeight();
    const availableWidth = this._width - this._padding * 2 - 4 - resizeBarWidth - padding - animateLabelWidth;
    const labelWidth = Math.max(0, availableWidth * this._labelPercent);
    const valueWidth = Math.max(0, availableWidth * (1 - this._labelPercent));
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
          3,
          ImGui.TableFlags.BordersInnerV | ImGui.TableFlags.PadOuterX | ImGui.TableFlags.SizingFixedFit
        )
      ) {
        ImGui.TableSetupColumn(
          'Animatable',
          ImGui.TableColumnFlags.NoResize | ImGui.TableColumnFlags.WidthFixed,
          animateLabelWidth
        );
        ImGui.TableSetupColumn('Name', ImGui.TableColumnFlags.WidthFixed, labelWidth);
        ImGui.TableSetupColumn('Value', ImGui.TableColumnFlags.WidthFixed, valueWidth);
        this.renderGroup(this._rootGroup, 0, true);

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

    ImGui.PushStyleColor(ImGui.Col.Button, ImGui.GetColorU32(ImGui.Col.ScrollbarGrab));
    ImGui.PushStyleColor(ImGui.Col.ButtonHovered, ImGui.GetColorU32(ImGui.Col.ScrollbarGrabHovered));
    ImGui.PushStyleColor(ImGui.Col.ButtonActive, ImGui.GetColorU32(ImGui.Col.ScrollbarGrabActive));

    ImGui.PushStyleVar(ImGui.StyleVar.FramePadding, new ImGui.ImVec2(0, 0));

    ImGui.SetCursorPos(initialCursorPos);
    ImGui.Button('##resize', new ImGui.ImVec2(resizeBarWidth, availableHeight));

    ImGui.PopStyleVar();
    ImGui.PopStyleColor(3);

    if (ImGui.IsItemActive()) {
      const mouseDelta = ImGui.GetIO().MouseDelta.x;
      this._width = Math.max(Math.min(this._width - mouseDelta, this._maxWidth), this._minWidth);
      ImGui.SetMouseCursor(ImGui.MouseCursor.ResizeEW);
    } else if (ImGui.IsItemHovered()) {
      ImGui.SetMouseCursor(ImGui.MouseCursor.ResizeEW);
    }
  }
  private renderGroup(group: PropertyGroup, level = 0, toplevel = false) {
    if (group.prop?.isValid && group.object && !group.prop.isValid.call(group.object)) {
      return;
    }
    ImGui.TableNextRow();
    ImGui.TableNextColumn();
    ImGui.TableNextColumn();
    const baseX = ImGui.GetCursorPosX();
    if (level > 0) {
      ImGui.SetCursorPosX(baseX + level * 10);
    }
    ImGui.AlignTextToFramePadding();
    const flags = ImGui.TreeNodeFlags.DefaultOpen;
    const opened = toplevel ? true : ImGui.TreeNodeEx(group.name, flags);
    if (group.object && group.prop && group.objectTypes.length > 0) {
      const deletable = group.prop.isNullable?.() && group.prop.set && group.value.object?.[0];
      const readonly = !!group.prop.readonly;
      const editable = group.value.object?.[0] instanceof AABB && group.prop.edit === 'aabb';
      const buttonSize = ImGui.GetFrameHeight();
      const spacing = (editable ? buttonSize : 0) + (deletable ? buttonSize : 0);
      ImGui.TableNextColumn();
      if (!readonly) {
        ImGui.BeginChild('', new ImGui.ImVec2(-1, ImGui.GetFrameHeight()));
        ImGui.SetNextItemWidth(ImGui.GetContentRegionAvail().x - spacing);
        const index = [
          group.objectTypes.findIndex((val) => val.ctor === (group.value.object?.[0]?.constructor ?? null))
        ] as [number];
        if (
          ImGui.Combo(
            '',
            index,
            group.objectTypes.map((val) => val.ctor.name),
            group.objectTypes.length
          )
        ) {
          const newObj = new group.objectTypes[index[0]].ctor();
          group.prop.set.call(group.object, { object: [newObj] });
          this.dispatchEvent('object_property_changed', group.object, group.prop.name);
          this.refresh();
        }
        if (deletable) {
          ImGui.SameLine(0, 0);
          if (ImGui.Button(`${FontGlyph.glyphs['trash-empty']}##clear`, new ImGui.ImVec2(buttonSize, 0))) {
            group.prop.set.call(group.object, { object: [null] });
            this.dispatchEvent('object_property_changed', group.object, group.prop.name);
            this.refresh();
            if (editable) {
              this.dispatchEvent('end_edit_aabb', group.value.object[0] as AABB);
            }
          }
        }
        if (editable) {
          ImGui.SameLine(0, 0);
          if (ImGui.Button(`${FontGlyph.glyphs['pencil']}##edit`, new ImGui.ImVec2(-1, 0))) {
            this.dispatchEvent('request_edit_aabb', group.value.object[0] as AABB);
          }
        }
        ImGui.EndChild();
      }
    }
    if (opened) {
      if (!toplevel) {
        ImGui.TreePop();
      }
      for (const property of group.properties) {
        this.renderProperty(property instanceof PropertyGroup ? property : property.property, level + 2);
      }
      this.renderSubGroups(group, level + 1);
    }
    if (level > 0) {
      ImGui.SetCursorPosX(baseX);
    }
  }
  private renderProperty(property: PropertyGroup | Property<any>, level: number) {
    if (property instanceof PropertyGroup) {
      this.renderGroup(property, level - 1);
      return;
    }
    const { name, object, value } = property;
    if (value && value.isValid && !value.isValid.call(object)) {
      return;
    }
    ImGui.PushID(property.path);
    ImGui.TableNextRow();
    ImGui.TableNextColumn();
    ImGui.SetNextItemWidth(-1);
    const animatable = value && !!value.animatable;
    if (animatable && this.object instanceof SceneNode) {
      if (ImGui.Button('A')) {
        let animationSet = this.object.animationSet;
        Dialog.selectAnimationAndTrack(
          'Create animation track',
          animationSet ? animationSet.getAnimationNames() : [],
          300
        ).then((val) => {
          if (val) {
            if (!animationSet) {
              animationSet = new AnimationSet(this.object);
              this.object.animationSet = animationSet;
            }
            let animation = animationSet.getAnimationClip(val.animationName);
            if (!animation) {
              animation = new AnimationClip(val.animationName);
              animationSet.add(animation);
            }
            const track = new PropertyTrack(value);
            track.name = val.trackName;
            animation.addTrack(object, track);
            this.refresh();
          }
        });
      }
    }
    ImGui.TableNextColumn();
    const baseX = ImGui.GetCursorPosX();
    if (level > 0) {
      ImGui.SetCursorPosX(baseX + level * 10);
    }
    ImGui.AlignTextToFramePadding();
    if (!value) {
      ImGui.TextDisabled(name ?? '');
    } else {
      ImGui.Text(value.label ?? name);
      if (level > 0) {
        ImGui.SetCursorPosX(baseX);
      }
    }
    if (value) {
      ImGui.TableNextColumn();
      ImGui.SetNextItemWidth(-1);
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
            const val = [tmpProperty.num[0]] as [number];
            changed = ImGui.DragFloat(
              '##value',
              val,
              readonly ? 0 : value.options?.speed ?? 0.01,
              value.options?.minValue ?? undefined,
              value.options?.maxValue ?? undefined,
              '%.3f'
            );
            tmpProperty.num[0] = val[0];
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
        case 'int2': {
          const val = tmpProperty.num as [number, number];
          changed = ImGui.InputInt2('##value', val, readonly ? ImGui.InputTextFlags.ReadOnly : undefined);
          break;
        }
        case 'int3': {
          const val = tmpProperty.num as [number, number, number];
          changed = ImGui.InputInt3('##value', val, readonly ? ImGui.InputTextFlags.ReadOnly : undefined);
          break;
        }
        case 'int4': {
          const val = tmpProperty.num as [number, number, number, number];
          changed = ImGui.InputInt4('##value', val, readonly ? ImGui.InputTextFlags.ReadOnly : undefined);
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
          if (value.edit === 'quaternion') {
            ImGui.BeginChild('', new ImGui.ImVec2(-1, ImGui.GetFrameHeight()));
            ImGui.SetNextItemWidth(ImGui.GetContentRegionAvail().x - ImGui.GetFrameHeight());
          }
          changed = ImGui.InputFloat3(
            '##value',
            val,
            undefined,
            readonly ? ImGui.InputTextFlags.ReadOnly : undefined
          );
          if (value.edit === 'quaternion') {
            ImGui.SameLine(0, 0);
            if (ImGui.Button(`${FontGlyph.glyphs['pencil']}##edit`, new ImGui.ImVec2(-1, 0))) {
              ImGui.OpenPopup('EditQuaternion');
              RotationEditor.reset(
                Quaternion.fromEulerAngle(
                  degree2radian(val[0]),
                  degree2radian(val[1]),
                  degree2radian(val[2])
                ),
                new ImGui.ImVec2(100, 100)
              );
            }
            if (
              ImGui.BeginPopup('EditQuaternion', ImGui.WindowFlags.NoResize | ImGui.WindowFlags.NoScrollbar)
            ) {
              ImGui.BeginChild('xxyy', new ImGui.ImVec2(100, 100));
              const quat = RotationEditor.render();
              const v = quat.toEulerAngles();
              val[0] = radian2degree(v.x);
              val[1] = radian2degree(v.y);
              val[2] = radian2degree(v.z);
              changed = true;
              ImGui.EndChild();
              ImGui.EndPopup();
            }
            ImGui.EndChild();
          }
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
        case 'command': {
          for (let i = 0; i < tmpProperty.str.length; i++) {
            if (i > 0) {
              ImGui.SameLine();
            }
            if (ImGui.Button(`${tmpProperty.str[i]}##command${i}`)) {
              if (value.command && value.command.call(object, i)) {
                this.refresh();
              }
            }
          }
          break;
        }
        case 'object': {
          const val = tmpProperty.str as [string];
          const assetInfo = this._serializationManager.assetRegistry.getAssetInfo(val[0]);
          if (assetInfo) {
            val[0] = assetInfo.name;
          }
          if (value.isNullable?.()) {
            ImGui.SetNextItemWidth(ImGui.GetContentRegionAvail().x - ImGui.GetFrameHeight());
          }
          ImGui.InputText('##value', val, undefined, ImGui.InputTextFlags.ReadOnly);
          if (ImGui.BeginDragDropTarget()) {
            const payload = ImGui.AcceptDragDropPayload('ASSET:texture');
            if (payload) {
              tmpProperty.str[0] = (payload.Data as DBAssetInfo).uuid;
              value.set.call(object, tmpProperty);
              this.dispatchEvent('object_property_changed', object, value.name);
            }
            ImGui.EndDragDropTarget();
          }
          if (value.isNullable?.()) {
            ImGui.SameLine(0, 0);
            if (ImGui.Button('X##clear', new ImGui.ImVec2(-1, 0))) {
              value.set.call(object, null);
              this.dispatchEvent('object_property_changed', object, value.name);
              if (property.value.objectTypes?.length > 0) {
                ImGui.OpenPopup('X##list');
                if (ImGui.BeginPopup('X##list')) {
                  for (const t of property.value.objectTypes) {
                    const cls = this._serializationManager.getClassByConstructor(t);
                    if (cls && ImGui.MenuItem(`${cls.ctor.name}##create`)) {
                      alert(cls.ctor.name);
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
        this.dispatchEvent('object_property_changed', object, value.name);
      }
    }
    ImGui.PopID();
  }
}
