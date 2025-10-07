import { ImGui } from '@zephyr3d/imgui';
import {
  AnimationClip,
  PropertyTrack,
  SceneNode,
  type PropertyAccessor,
  type PropertyValue,
  type SerializableClass
} from '@zephyr3d/scene';
import { FontGlyph } from '../core/fontglyph';
import type { GenericConstructor } from '@zephyr3d/base';
import { AABB, ASSERT, degree2radian, Observable, Quaternion, radian2degree } from '@zephyr3d/base';
import { RotationEditor } from './rotationeditor';
import { Dialog } from '../views/dlg/dlg';
import { ProjectService } from '../core/services/project';
import { eventBus } from '../core/eventbus';

interface Property<T extends {}> {
  objectPath: string;
  path: string;
  name: string;
  object: any;
  value: PropertyAccessor<T>;
}

class PropertyGroup {
  grid: PropertyEditor;
  name: string;
  index: number;
  selected: [number];
  count: number;
  value: PropertyValue;
  parent: PropertyGroup;
  path: string;
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
    this.index = 0;
    this.selected = [-1];
    this.count = 1;
    this.path = '';
    this.parent = null;
    this.value = { num: [], str: [], bool: [], object: [null] };
    this.property = null;
    this.prop = null;
    this.currentType = -1;
    this.objectTypes = null;
    this.properties = [];
    this.subgroups = [];
  }
  addSeparator(label: string) {
    this.properties.push({
      name: label,
      property: {
        name: label,
        objectPath: '',
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
    if (value.options?.group) {
      group = this.findOrAddGroup(value.options.group);
    }
    const tmpProperty: PropertyValue = {
      num: [0, 0, 0, 0],
      str: [''],
      bool: [false],
      object: []
    };
    if (value.type === 'object' && value.options?.objectTypes) {
      value.get.call(obj, tmpProperty);
      const propGroup = group.addGroup(value.name);
      propGroup.setObject(tmpProperty.object[0], value, obj, null, 1);
    } else if (value.type === 'object_array' && value.options?.objectTypes) {
      value.get.call(obj, tmpProperty);
      if (tmpProperty.object) {
        if (tmpProperty.object.length === 0) {
          if (value.add) {
            const propGroup = group.addGroup('<Add Element>');
            propGroup.setObject(null, value, obj, 0, 0);
          }
        } else {
          for (let i = 0; i < tmpProperty.object.length; i++) {
            if (!value.isHidden || !value.isHidden.call(obj, i, tmpProperty.object[i])) {
              const propGroup = group.addGroup(`${value.name}[${i}]`);
              propGroup.setObject(tmpProperty.object[i], value, obj, i, tmpProperty.object.length);
            }
          }
        }
      }
    } else {
      const property: Property<any> = {
        objectPath: group.path,
        path: `${group.path}/${value.name}`,
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
    group.path = this.path;
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
    let group = parent;
    while (parts.length > 0) {
      const part = parts.shift();
      group = group.subgroups.find((g) => g.name === part) ?? group.addGroup(part);
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
  setObject(obj: any, prop?: PropertyAccessor<any>, parentObj?: any, index?: number, count?: number) {
    if (this.value.object[0] !== obj || this.prop !== prop) {
      const serializationManager = ProjectService.serializationManager;
      this.value.object[0] = obj ?? null;
      this.property = null;
      this.object = parentObj;
      this.currentType = -1;
      this.index = index ?? 0;
      this.count = count ?? 1;
      this.prop = prop ?? null;
      if (this.prop) {
        this.path = `${this.path}/${this.prop.name}${typeof index === 'number' ? `[${index}]` : ''}`;
      }
      this.objectTypes =
        prop?.options?.objectTypes?.length > 0
          ? prop.options.objectTypes.map((ctor) => serializationManager.getClassByConstructor(ctor)) ?? []
          : null;
      if (this.objectTypes?.length > 0 && this.prop.isNullable?.call(obj, this.index)) {
        this.objectTypes.unshift(null);
      }
      this.selected[0] = this.objectTypes
        ? this.objectTypes.findIndex((val) => {
            if (!val) {
              return !obj;
            }
            return val.ctor === (obj?.constructor ?? null);
          })
        : -1;

      this.properties = [];
      this.subgroups = [];
      if (this.value.object[0]) {
        let cls: SerializableClass = null;
        let ctor = this.value.object[0].constructor as GenericConstructor;
        while (ctor) {
          cls = serializationManager.getClassByConstructor(ctor);
          if (cls) {
            const props = serializationManager
              .getPropertiesByClass(cls)
              .filter((p) => !p.isHidden || !p.isHidden.call(this.value.object[0], -1));
            if (props.length > 0) {
              if (!cls.noTitle) {
                this.addSeparator(cls.name);
              }
              for (const prop of props) {
                this.addProperty(this.value.object[0], prop);
              }
            }
          }
          ctor = cls ? cls.parent : Object.getPrototypeOf(ctor);
        }
      }
    }
  }
}

export class PropertyEditor extends Observable<{
  request_edit_aabb: [aabb: AABB];
  end_edit_aabb: [aabb: AABB];
  request_edit_track: [track: PropertyTrack, target: object];
  end_edit_track: [track: PropertyTrack, target: object, edited: boolean];
  object_property_changed: [object: object, prop: PropertyAccessor];
}> {
  private _rootGroup: PropertyGroup;
  private readonly _labelPercent: number;
  private _dragging: boolean;
  private _dirty: boolean;
  constructor(labelPercent: number) {
    super();
    this._rootGroup = new PropertyGroup('Root', this);
    this._labelPercent = labelPercent;
    this._dragging = false;
    this._dirty = false;
  }
  get object(): any {
    return this._rootGroup.getObject();
  }
  set object(value: any) {
    this._rootGroup.setObject(value);
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
    const animateLabelWidth = ImGui.GetFrameHeight();
    const availableWidth = ImGui.GetContentRegionAvail().x;
    const labelWidth = Math.max(0, availableWidth * this._labelPercent);
    const valueWidth = Math.max(0, availableWidth * (1 - this._labelPercent));
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
  }
  private renderSubGroups(group: PropertyGroup, level: number) {
    for (let i = 0; i < group.subgroups.length; i++) {
      const subgroup = group.subgroups[i];
      ImGui.PushID(i);
      this.renderGroup(subgroup, level);
      ImGui.PopID();
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
    if (
      group.object &&
      group.prop &&
      (group.prop.type === 'object' || group.prop.type === 'object_array') &&
      group.objectTypes
    ) {
      const editable =
        (group.value.object?.[0] instanceof AABB && group.prop.options?.edit === 'aabb') ||
        (group.value.object?.[0] instanceof PropertyTrack && group.prop.options?.edit === 'proptrack');
      const settable =
        !group.prop.readonly &&
        !!group.prop.set &&
        (group.prop.type === 'object' || group.index < group.count);
      const addable = group.prop.type === 'object_array' && !!group.prop.add;
      const deletable = group.prop.type === 'object_array' && group.prop.delete && group.index < group.count;

      const buttonSize = ImGui.GetFrameHeight();
      const spacing =
        (editable ? buttonSize : 0) +
        (settable ? buttonSize : 0) +
        (addable ? buttonSize : 0) +
        (deletable ? buttonSize : 0);
      ImGui.TableNextColumn();
      if (settable || addable || deletable || editable) {
        ImGui.BeginChild('', new ImGui.ImVec2(-1, ImGui.GetFrameHeight()));
        ImGui.SetNextItemWidth(ImGui.GetContentRegionAvail().x - spacing);
        if (group.objectTypes.length > 0) {
          ImGui.Combo(
            '',
            group.selected,
            group.objectTypes.map((val) => val?.name ?? 'NULL'),
            group.objectTypes.length
          );
          if (settable) {
            ImGui.SameLine(0, 0);
            if (ImGui.Button(`${FontGlyph.glyphs['ok']}##set`, new ImGui.ImVec2(buttonSize, 0))) {
              const ctor = group.objectTypes[group.selected[0]]?.ctor;
              const newObj = ctor
                ? group.prop.create
                  ? group.prop.create.call(group.object, ctor, group.index)
                  : new ctor()
                : null;
              const value = { object: [newObj] };
              group.prop.set.call(group.object, value, group.index);
              this.dispatchEvent('object_property_changed', group.object, group.prop);
              this.refresh();
            }
          }
          if (addable) {
            ImGui.SameLine(0, 0);
            if (
              ImGui.Button(`${FontGlyph.glyphs['plus']}##add`, new ImGui.ImVec2(buttonSize, 0)) &&
              group.selected[0] >= 0
            ) {
              const ctor = group.objectTypes[group.selected[0]]?.ctor;
              const newObj = ctor
                ? group.prop.create
                  ? group.prop.create.call(group.object, ctor, group.index)
                  : new ctor()
                : null;
              group.prop.add.call(group.object, { object: [newObj] }, group.index);
              this.dispatchEvent('object_property_changed', group.object, group.prop);
              this.refresh();
            }
          }
          if (deletable) {
            ImGui.SameLine(0, 0);
            if (ImGui.Button(`${FontGlyph.glyphs['cancel']}##delete`, new ImGui.ImVec2(buttonSize, 0))) {
              group.prop.delete.call(group.object, group.index);
              this.dispatchEvent('object_property_changed', group.object, group.prop);
              this.refresh();
              if (editable) {
                if (group.prop.options?.edit === 'aabb') {
                  this.dispatchEvent('end_edit_aabb', group.value.object[0] as AABB);
                } else if (group.prop.options?.edit === 'proptrack') {
                  const animation: unknown = group.object;
                  ASSERT(
                    animation instanceof AnimationClip,
                    'PropertyTrack can only be edited in AnimationClip'
                  );
                  ASSERT(group.value.object[0] instanceof PropertyTrack);
                  const node = animation.animationSet.model;
                  this.dispatchEvent(
                    'end_edit_track',
                    group.value.object[0],
                    ProjectService.serializationManager.findAnimationTarget(node, group.value.object[0]),
                    false
                  );
                }
              }
            }
          }
          if (editable) {
            ImGui.SameLine(0, 0);
            if (ImGui.Button(`${FontGlyph.glyphs['pencil']}##edit`, new ImGui.ImVec2(-1, 0))) {
              if (group.prop.options?.edit === 'aabb') {
                this.dispatchEvent('request_edit_aabb', group.value.object[0] as AABB);
              } else if (group.prop.options?.edit === 'proptrack') {
                const animation: unknown = group.object;
                ASSERT(
                  animation instanceof AnimationClip,
                  'PropertyTrack can only be edited in AnimationClip'
                );
                ASSERT(group.value.object[0] instanceof PropertyTrack);
                const node = animation.animationSet.model;
                this.dispatchEvent(
                  'request_edit_track',
                  group.value.object[0],
                  ProjectService.serializationManager.findAnimationTarget(node, group.value.object[0])
                );
              }
            }
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
    const animatable = value && !!value.options?.animatable;
    if (animatable && this.object instanceof SceneNode) {
      if (ImGui.Button('A')) {
        const animationSet = this.object.animationSet;
        Dialog.selectAnimationAndTrack(
          'Create animation track',
          animationSet ? animationSet.getAnimationNames() : [],
          300
        ).then((val) => {
          if (val) {
            let animation = animationSet.getAnimationClip(val.animationName);
            if (!animation) {
              animation = animationSet.createAnimation(val.animationName, false);
            }
            const propValue = { num: [0, 0, 0, 0] };
            value.get.call(object, propValue);
            const track = new PropertyTrack(value, propValue.num);
            track.target = property.objectPath;
            track.name = val.trackName;
            animation.addTrack(object, track);
            this.refresh();
            eventBus.dispatchEvent('scene_changed');
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
      ImGui.Text(value.options?.label ?? name);
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
          if (value.options?.enum) {
            const val = [value.options.enum.values.indexOf(tmpProperty.num[0])] as [number];
            changed = ImGui.Combo('##value', val, value.options.enum.labels) && !readonly;
            if (changed) {
              tmpProperty.num[0] = value.options.enum.values[val[0]] as number;
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
          if (value.options?.enum) {
            const val = [value.options.enum.values.indexOf(tmpProperty.num[0])] as [number];
            changed = ImGui.Combo('##value', val, value.options.enum.labels) && !readonly;
            if (changed) {
              tmpProperty.num[0] = value.options.enum.values[val[0]] as number;
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
          if (value.options?.enum) {
            const val = [value.options.enum.values.indexOf(tmpProperty.str[0])] as [number];
            changed = ImGui.Combo('##value', val, value.options.enum.labels) && !readonly;
            if (changed) {
              tmpProperty.str[0] = value.options.enum.values[val[0]] as string;
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
          if (value.options?.edit === 'quaternion') {
            ImGui.BeginChild('', new ImGui.ImVec2(-1, ImGui.GetFrameHeight()));
            ImGui.SetNextItemWidth(ImGui.GetContentRegionAvail().x - ImGui.GetFrameHeight());
          }
          changed = ImGui.InputFloat3(
            '##value',
            val,
            undefined,
            readonly ? ImGui.InputTextFlags.ReadOnly : undefined
          );
          if (value.options?.edit === 'quaternion') {
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
          if (value.isNullable?.call(object, 0)) {
            ImGui.SetNextItemWidth(ImGui.GetContentRegionAvail().x - ImGui.GetFrameHeight());
          }
          ImGui.InputText('##value', val, undefined, ImGui.InputTextFlags.ReadOnly);
          if (value.isNullable?.call(object, 0)) {
            ImGui.SameLine(0, 0);
            if (ImGui.Button('X##clear', new ImGui.ImVec2(-1, 0))) {
              Promise.resolve(value.set.call(object, null)).then(() => {
                this.refresh();
              });
              this.dispatchEvent('object_property_changed', object, value);
              if (property.value.options?.objectTypes?.length > 0) {
                ImGui.OpenPopup('X##list');
                if (ImGui.BeginPopup('X##list')) {
                  for (const t of property.value.options.objectTypes) {
                    const cls = ProjectService.serializationManager.getClassByConstructor(t);
                    if (cls && ImGui.MenuItem(`${cls.name}##create`)) {
                      alert(cls.name);
                    }
                  }
                  ImGui.EndPopup();
                }
              }
            }
          }
        }
      }
      if (value.set && (value.type === 'string' || value.type === 'object')) {
        if (value.options?.mimeTypes?.length > 0 && ImGui.BeginDragDropTarget()) {
          const peekPayload = ImGui.AcceptDragDropPayload('ASSET', ImGui.DragDropFlags.AcceptBeforeDelivery);
          if (peekPayload) {
            const data = peekPayload.Data as { isDir: boolean; path: string }[];
            if (data.length === 1 && !data[0].isDir) {
              const mimeType = ProjectService.VFS.guessMIMEType(data[0].path);
              if (value.options.mimeTypes.includes(mimeType)) {
                const payload = ImGui.AcceptDragDropPayload('ASSET');
                if (payload) {
                  tmpProperty.str[0] = data[0].path;
                  Promise.resolve(value.set.call(object, tmpProperty)).then(() => {
                    this.refresh();
                  });
                  this.dispatchEvent('object_property_changed', object, value);
                }
              }
            }
          }
          ImGui.EndDragDropTarget();
        }
      }
      if (changed && value.set) {
        value.set.call(object, tmpProperty);
        this.refresh();
        this.dispatchEvent('object_property_changed', object, value);
      }
    }
    ImGui.PopID();
  }
}
