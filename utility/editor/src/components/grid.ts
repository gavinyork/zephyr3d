import { ImGui } from '@zephyr3d/imgui';
import type { PropertyType } from '@zephyr3d/scene';
import {
  AnimationClip,
  Camera,
  getEngine,
  PropertyTrack,
  SceneNode,
  type PropertyAccessor,
  type PropertyValue,
  type SerializableClass
} from '@zephyr3d/scene';
import { FontGlyph } from '../core/fontglyph';
import type { GenericConstructor, Nullable, RequireOptionals } from '@zephyr3d/base';
import {
  AABB,
  ASSERT,
  degree2radian,
  Interpolator,
  Observable,
  Quaternion,
  radian2degree
} from '@zephyr3d/base';
import { RotationEditor } from './rotationeditor';
import { Dialog } from '../views/dlg/dlg';
import { ProjectService } from '../core/services/project';
import { eventBus } from '../core/eventbus';
import type { SceneHierarchyNodePickerPayload } from './scenehierarchy';
import type { VFSRendererAssetPickerPayload } from './vfsrenderer';
import { matchesMimeType } from '../helpers/mimematch';
import { CustomInputTextFlags, customTextInput, requestCustomTextInputFocus } from './textinput';

interface Property<T extends {}> {
  objectPath: string;
  path: string;
  name: string;
  object: any;
  value: Nullable<PropertyAccessor<T>>;
}

interface RawProperty {
  name: string;
  type: PropertyType;
  get: (value: PropertyValue) => void;
  set?: (value: PropertyValue) => void;
  options?: {
    enum?: {
      labels: string[];
      values: any[];
    };
    multiline?: boolean;
    speed?: number;
    minValue?: number;
    maxValue?: number;
  };
}

type PropertyRowData =
  | {
      type: 'group';
      group: PropertyGroup;
      level: number;
      toplevel: boolean;
    }
  | {
      type: 'inlineObjectArrayGroup';
      group: PropertyGroup;
      level: number;
    }
  | {
      type: 'property';
      property: Property<any>;
      owner: PropertyGroup;
      level: number;
    }
  | {
      type: 'rawProperty';
      property: RawProperty;
      owner: PropertyGroup;
      level: number;
    };

type PropertyRow = PropertyRowData & {
  id: number;
  y: number;
  height: number;
};

class PropertyGroup {
  grid: PropertyEditor;
  name: string;
  index: number;
  selected: [number];
  count: number;
  value: RequireOptionals<PropertyValue>;
  parent: Nullable<PropertyGroup>;
  path: string;
  statePath: string;
  property: Nullable<Property<any>>;
  currentType: number;
  opened: boolean;
  defaultOpen: Nullable<boolean>;
  objectTypes: Nullable<Nullable<SerializableClass>[]>;
  prop: Nullable<PropertyAccessor<any>>;
  properties: (PropertyGroup | { name: string; property: Property<any> })[];
  rawProperties: RawProperty[];
  object: any;
  subgroups: PropertyGroup[];
  constructor(name: string, grid: PropertyEditor) {
    this.grid = grid;
    this.name = name;
    this.index = 0;
    this.selected = [-1];
    this.count = 1;
    this.path = '';
    this.statePath = name;
    this.parent = null;
    this.value = { num: [], str: [], bool: [], object: [null] };
    this.property = null;
    this.prop = null;
    this.currentType = -1;
    this.opened = true;
    this.defaultOpen = null;
    this.objectTypes = null;
    this.properties = [];
    this.rawProperties = [];
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
  addRawProperty(
    name: string,
    type: PropertyType,
    get: (value: PropertyValue) => void,
    set?: (value: PropertyValue) => void,
    options?: {
      enum?: {
        labels: string[];
        values: any[];
      };
      speed?: number;
      minValue?: number;
      maxValue?: number;
    }
  ) {
    this.rawProperties.push({
      name,
      type,
      get,
      set,
      options
    });
  }
  addProperty(obj: any, value: PropertyAccessor<any>) {
    let group: PropertyGroup = this;
    if (value.isValid && !value.isValid.call(obj)) {
      return;
    }
    if (value.options?.group) {
      group = this.findOrAddGroup(value.options.group, value.options.defaultOpen);
    }
    const tmpProperty = {
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
    group.statePath = `${this.statePath}/${name}`;
    this.subgroups.push(group);
    return group;
  }
  findOrAddGroup(name: string, defaultOpen?: boolean) {
    const parts = name.split('/');
    const firstPart = parts.shift()!;
    let parent = this.properties.find(
      (p) => p instanceof PropertyGroup && p.name === firstPart
    ) as PropertyGroup;
    if (!parent) {
      parent = new PropertyGroup(firstPart, this.grid);
      parent.parent = this;
      parent.path = this.path;
      parent.statePath = `${this.statePath}/${firstPart}`;
      parent.defaultOpen = defaultOpen ?? null;
      this.properties.push(parent);
    } else if (defaultOpen !== undefined && parent.defaultOpen == null) {
      parent.defaultOpen = defaultOpen;
    }
    let group = parent;
    while (parts.length > 0) {
      const part = parts.shift()!;
      group = group.subgroups.find((g) => g.name === part) ?? group.addGroup(part);
    }
    return group;
  }
  getObject() {
    let group: Nullable<PropertyGroup> = this;
    while (group) {
      if (group.value.object[0]) {
        return group.value.object[0];
      }
      group = group.parent;
    }
    return null;
  }
  setObject(
    obj: any,
    prop?: PropertyAccessor<any>,
    parentObj?: any,
    index?: Nullable<number>,
    count?: number
  ) {
    if (this.value.object[0] !== obj || this.prop !== prop) {
      const resourceManager = getEngine().resourceManager;
      const parentPath = this.parent?.path ?? '';
      const parentStatePath = this.parent?.statePath ?? this.name;
      this.value.object[0] = obj ?? null;
      this.property = null;
      this.object = parentObj;
      this.currentType = -1;
      this.index = index ?? 0;
      this.count = count ?? 1;
      this.prop = prop ?? null;
      this.path = parentPath;
      this.statePath = parentStatePath;
      if (this.prop) {
        this.path = `${this.path}/${this.prop.name}${typeof index === 'number' ? `[${index}]` : ''}`;
        this.statePath = `${this.statePath}/${this.prop.name}${typeof index === 'number' ? `[${index}]` : ''}`;
      }
      this.objectTypes =
        prop?.options?.objectTypes?.length! > 0
          ? (prop!.options!.objectTypes!.map((ctor) => resourceManager.getClassByConstructor(ctor)) ?? [])
          : null;
      if (this.objectTypes?.length! > 0 && this.prop!.isNullable?.call(obj, this.index)) {
        this.objectTypes!.unshift(null);
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
        let cls: Nullable<SerializableClass> = null;
        let ctor = this.value.object[0].constructor as GenericConstructor;
        while (ctor) {
          cls = resourceManager.getClassByConstructor(ctor);
          if (cls) {
            const props = resourceManager
              .getPropertiesByClass(cls)!
              .filter((p) => !p.isHidden || !p.isHidden.call(this.value.object[0]!, -1));
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

function isScriptArrayElementObject(value: unknown): value is {
  constructor: { __scriptArrayElement?: boolean };
  propertyName?: unknown;
  index?: unknown;
} {
  return !!value && typeof value === 'object' && !!(value as any).constructor?.__scriptArrayElement;
}

export class PropertyEditor extends Observable<{
  request_edit_aabb: [aabb: AABB];
  end_edit_aabb: [aabb: AABB];
  request_edit_curve1f: [curve: Interpolator, name: string, apply: (curve: Interpolator) => void];
  end_edit_curve1f: [curve: Interpolator, apply: Nullable<(curve: Interpolator) => void>];
  request_edit_track: [track: PropertyTrack, target: object];
  end_edit_track: [track: PropertyTrack, target: object, edited: boolean];
  object_property_changed: [object: Nullable<object>, prop: PropertyAccessor];
  object_property_edit_finished: [
    object: Nullable<object>,
    prop: PropertyAccessor,
    oldValue: RequireOptionals<PropertyValue>,
    newValue: RequireOptionals<PropertyValue>
  ];
}> {
  static readonly defaultExtraPropertyProviderId = '__default__';
  private _rootGroup: PropertyGroup;
  private readonly _labelPercent: number;
  private _dragging: boolean;
  private _dirty: boolean;
  private _editSessions: Map<string, RequireOptionals<PropertyValue>>;
  private _activeStringEditors: Set<string>;
  private _pendingStringEditorFocus: Nullable<string>;
  private _showLeadingColumn: boolean;
  private _virtualClipMinY: number;
  private _virtualClipMaxY: number;
  private _rowHeight: number;
  private _rows: PropertyRow[];
  private _rowVersion: number;
  private _builtRowVersion: number;
  private _totalRowsHeight: number;
  private _groupOpenStates: Map<string, boolean>;
  private _inspectedGroup: PropertyGroup;
  private _scrollToTopRequested: boolean;
  private _restoreScrollY: Nullable<number>;
  private _restoreScrollFrames: number;
  private readonly _extraPropertiesProviders: Map<
    string,
    (object: any) => PropertyAccessor<any>[] | Promise<PropertyAccessor<any>[]>
  >;
  private _extraPropertiesVersion: number;
  private static readonly HDR_COLOR_EDIT_FLAGS =
    ImGui.ColorEditFlags.Float |
    ImGui.ColorEditFlags.HDR |
    ImGui.ColorEditFlags.DisplayRGB |
    ImGui.ColorEditFlags.InputRGB |
    ImGui.ColorEditFlags.AlphaPreviewHalf |
    ImGui.ColorEditFlags.NoOptions;
  constructor(labelPercent: number) {
    super();
    this._rootGroup = new PropertyGroup('Root', this);
    this._labelPercent = labelPercent;
    this._dragging = false;
    this._dirty = false;
    this._editSessions = new Map();
    this._activeStringEditors = new Set();
    this._pendingStringEditorFocus = null;
    this._showLeadingColumn = true;
    this._virtualClipMinY = 0;
    this._virtualClipMaxY = 0;
    this._rowHeight = 0;
    this._rows = [];
    this._rowVersion = 0;
    this._builtRowVersion = -1;
    this._totalRowsHeight = 0;
    this._groupOpenStates = new Map();
    this._inspectedGroup = this._rootGroup;
    this._scrollToTopRequested = false;
    this._restoreScrollY = null;
    this._restoreScrollFrames = 0;
    this._extraPropertiesProviders = new Map();
    this._extraPropertiesVersion = 0;
  }
  get object(): any {
    return this._rootGroup.getObject();
  }
  set object(value: any) {
    const oldObject = this.object;
    this._rootGroup.setObject(value);
    if (oldObject !== value) {
      this.resetInspectedGroup();
    } else {
      this.invalidateRows();
    }
    if (this._extraPropertiesProviders.size > 0) {
      const version = ++this._extraPropertiesVersion;
      void this.appendExtraProperties(value, version);
    }
  }
  get root() {
    return this._rootGroup;
  }
  get currentObject() {
    this._inspectedGroup = this.resolveExistingObjectGroup(this._inspectedGroup.statePath);
    const prop = this._inspectedGroup.prop;
    if (!prop) {
      return this.object;
    }
    ASSERT(prop.type === 'object' || prop.type === 'object_array');
    ASSERT(this._inspectedGroup.object);
    const value = { num: [], bool: [], str: [], object: [] };
    prop.get.call(this._inspectedGroup.object, value);
    return value.object[this._inspectedGroup.index ?? 0];
  }
  get scrollToTopRequested() {
    return this._scrollToTopRequested;
  }
  private resetInspectedGroup() {
    this._inspectedGroup = this._rootGroup;
    this._groupOpenStates.clear();
    this._scrollToTopRequested = true;
    this.invalidateRows();
  }
  private isObjectPropertyGroup(group: PropertyGroup) {
    return !!group.prop && (group.prop.type === 'object' || group.prop.type === 'object_array');
  }
  private getGroupLabel(group: PropertyGroup) {
    if (group === this._rootGroup) {
      return 'Root';
    }
    const currentObject = group.value.object?.[0];
    if (isScriptArrayElementObject(currentObject) && group.prop?.type === 'object_array') {
      const baseLabel =
        group.prop.options?.label ??
        (typeof currentObject.propertyName === 'string' && currentObject.propertyName
          ? currentObject.propertyName
          : group.name);
      const index =
        typeof currentObject.index === 'number' && Number.isFinite(currentObject.index)
          ? currentObject.index
          : group.index;
      return `${baseLabel}[${index}]`;
    }
    return group.prop?.options?.label ?? group.name;
  }
  private findGroupByStatePath(path: string) {
    const visit = (group: PropertyGroup): Nullable<PropertyGroup> => {
      if (group.statePath === path) {
        return group;
      }
      for (const property of group.properties) {
        if (property instanceof PropertyGroup) {
          const found = visit(property);
          if (found) {
            return found;
          }
        }
      }
      for (const subgroup of group.subgroups) {
        const found = visit(subgroup);
        if (found) {
          return found;
        }
      }
      return null;
    };
    return visit(this._rootGroup);
  }
  private resolveExistingObjectGroup(path: string) {
    let currentPath = path;
    while (currentPath) {
      const group = this.findGroupByStatePath(currentPath);
      if (group && (group === this._rootGroup || this.isObjectPropertyGroup(group))) {
        return group;
      }
      const index = currentPath.lastIndexOf('/');
      if (index < 0) {
        break;
      }
      currentPath = currentPath.slice(0, index);
    }
    return this._rootGroup;
  }
  private restoreInspectedGroup(statePath: string) {
    this._inspectedGroup = this.resolveExistingObjectGroup(statePath);
    this.invalidateRows();
  }
  private inspectGroup(group: PropertyGroup) {
    this._inspectedGroup = this.getNearestObjectGroup(group);
  }
  private setGroupOpenStateRecursive(group: PropertyGroup, opened: boolean) {
    let changed = false;
    if (group !== this._rootGroup) {
      changed = group.opened !== opened || this._groupOpenStates.get(group.statePath) !== opened || changed;
      group.opened = opened;
      this._groupOpenStates.set(group.statePath, opened);
    }
    for (const property of group.properties) {
      if (property instanceof PropertyGroup) {
        changed = this.setGroupOpenStateRecursive(property, opened) || changed;
      }
    }
    for (const subgroup of group.subgroups) {
      changed = this.setGroupOpenStateRecursive(subgroup, opened) || changed;
    }
    return changed;
  }
  private getNearestObjectGroup(group: PropertyGroup) {
    let current: Nullable<PropertyGroup> = group;
    while (current && current !== this._rootGroup) {
      if (this.isObjectPropertyGroup(current)) {
        return current;
      }
      current = current.parent;
    }
    return this._rootGroup;
  }
  set extraPropertiesProvider(
    provider: Nullable<(object: any) => PropertyAccessor<any>[] | Promise<PropertyAccessor<any>[]>>
  ) {
    if (provider) {
      this._extraPropertiesProviders.set(PropertyEditor.defaultExtraPropertyProviderId, provider);
    } else {
      this._extraPropertiesProviders.delete(PropertyEditor.defaultExtraPropertyProviderId);
    }
    this.refresh();
  }
  setExtraPropertiesProvider(
    id: string,
    provider: Nullable<(object: any) => PropertyAccessor<any>[] | Promise<PropertyAccessor<any>[]>>
  ) {
    if (provider) {
      this._extraPropertiesProviders.set(id, provider);
    } else {
      this._extraPropertiesProviders.delete(id);
    }
    this.refresh();
  }
  clear() {
    this._rootGroup = new PropertyGroup('Root', this);
    this.resetInspectedGroup();
  }
  set showLeadingColumn(value: boolean) {
    this._showLeadingColumn = !!value;
  }
  get showLeadingColumn() {
    return this._showLeadingColumn;
  }
  refresh() {
    this._dirty = true;
    this.invalidateRows();
  }
  async rebuild() {
    const object = this.object;
    const rawProps = this._rootGroup.rawProperties;
    const inspectedGroupStatePath = this._inspectedGroup.statePath;
    const version = ++this._extraPropertiesVersion;
    const rootGroup = new PropertyGroup('Root', this);
    rootGroup.setObject(object);
    rootGroup.rawProperties = rawProps;
    if (!(await this.appendExtraProperties(object, version, rootGroup))) {
      return;
    }
    this._rootGroup = rootGroup;
    this._inspectedGroup = this._rootGroup;
    this.restoreInspectedGroup(inspectedGroupStatePath);
  }
  private async appendExtraProperties(object: any, version: number, targetGroup = this._rootGroup) {
    if (!object || this._extraPropertiesProviders.size === 0) {
      return true;
    }
    const results = await Promise.all(
      [...this._extraPropertiesProviders.values()].map((provider) => Promise.resolve(provider(object)))
    );
    if (version !== this._extraPropertiesVersion || object !== this.object) {
      return false;
    }
    for (const extraProps of results) {
      for (const prop of extraProps ?? []) {
        if (prop.isHidden?.call(object, -1, object)) {
          continue;
        }
        targetGroup.addProperty(object, prop);
      }
    }
    if (targetGroup === this._rootGroup) {
      this.invalidateRows();
    }
    return true;
  }
  render() {
    if (this._dirty) {
      if (!this._scrollToTopRequested) {
        this._restoreScrollY = ImGui.GetScrollY();
        this._restoreScrollFrames = 2;
      }
      this._dirty = false;
      void this.rebuild();
    }
    if (this._scrollToTopRequested) {
      ImGui.SetScrollY(0);
      this._scrollToTopRequested = false;
      this._restoreScrollY = null;
      this._restoreScrollFrames = 0;
    } else if (this._restoreScrollY !== null) {
      ImGui.SetScrollY(Math.min(this._restoreScrollY, ImGui.GetScrollMaxY()));
      this._restoreScrollFrames--;
      if (this._restoreScrollFrames <= 0) {
        this._restoreScrollY = null;
      }
    }
    const availableWidth = ImGui.GetContentRegionAvail().x;
    const animateLabelWidth = this._showLeadingColumn ? ImGui.GetFrameHeight() : 0;
    const contentWidth = this._showLeadingColumn ? availableWidth - animateLabelWidth : availableWidth;
    const labelWidth = Math.max(0, contentWidth * this._labelPercent);
    const valueWidth = Math.max(0, contentWidth * (1 - this._labelPercent));
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
        this._showLeadingColumn ? 3 : 2,
        ImGui.TableFlags.BordersInnerV | ImGui.TableFlags.PadOuterX | ImGui.TableFlags.SizingFixedFit
      )
    ) {
      if (this._showLeadingColumn) {
        ImGui.TableSetupColumn(
          'Animatable',
          ImGui.TableColumnFlags.NoResize | ImGui.TableColumnFlags.WidthFixed,
          animateLabelWidth
        );
      }
      ImGui.TableSetupColumn('Name', ImGui.TableColumnFlags.WidthFixed, labelWidth);
      ImGui.TableSetupColumn('Value', ImGui.TableColumnFlags.WidthFixed, valueWidth);
      this.ensureRows();
      this.beginVirtualizedContent();
      this.renderRows();

      ImGui.EndTable();
    }
  }
  private beginVirtualizedContent() {
    const drawList = ImGui.GetWindowDrawList();
    const clipMin = drawList.GetClipRectMin();
    const clipMax = drawList.GetClipRectMax();
    const overscan = ImGui.GetFrameHeight() * 2;
    const contentStartY = ImGui.GetCursorScreenPos().y;
    this._virtualClipMinY = clipMin.y - contentStartY - overscan;
    this._virtualClipMaxY = clipMax.y - contentStartY + overscan;
  }
  private invalidateRows() {
    this._rowVersion++;
  }
  private ensureRows() {
    const rowHeight = this.getTableRowHeight();
    if (this._rowHeight !== rowHeight) {
      this._rowHeight = rowHeight;
      this.invalidateRows();
    }
    if (this._builtRowVersion === this._rowVersion) {
      return;
    }
    this._rows = [];
    this._totalRowsHeight = 0;
    this._inspectedGroup = this.resolveExistingObjectGroup(this._inspectedGroup.statePath);
    this.appendGroupRows(this._rootGroup, 0, true);
    this._builtRowVersion = this._rowVersion;
  }
  private appendRow(row: PropertyRowData, height = this._rowHeight) {
    this._rows.push({
      ...row,
      id: this._rows.length,
      y: this._totalRowsHeight,
      height
    } as PropertyRow);
    this._totalRowsHeight += height;
  }
  private appendGroupRows(group: PropertyGroup, level = 0, toplevel = false) {
    if (group.prop?.isValid && group.object && !group.prop.isValid.call(group.object)) {
      return;
    }
    this.applyGroupOpenState(group, toplevel);
    if (this.isInlineObjectArrayGroup(group)) {
      this.appendRow({ type: 'inlineObjectArrayGroup', group, level });
      return;
    }
    if (!toplevel || group !== this._rootGroup) {
      this.appendRow({ type: 'group', group, level, toplevel });
    }
    if (!toplevel && !group.opened) {
      return;
    }
    for (const property of group.properties) {
      if (property instanceof PropertyGroup) {
        this.appendGroupRows(property, level + 1);
      } else {
        const prop = property.property;
        if (prop.value?.isValid && !prop.value.isValid.call(prop.object)) {
          continue;
        }
        this.appendRow(
          { type: 'property', property: prop, owner: group, level: level + 2 },
          this.getPropertyHeight(prop)
        );
      }
    }
    for (const rawProperty of group.rawProperties) {
      this.appendRow(
        { type: 'rawProperty', property: rawProperty, owner: group, level: level + 2 },
        this.getRawPropertyHeight(rawProperty)
      );
    }
    for (const subgroup of group.subgroups) {
      this.appendGroupRows(subgroup, level + 1);
    }
  }
  private applyGroupOpenState(group: PropertyGroup, toplevel = false) {
    if (toplevel) {
      group.opened = true;
      return;
    }
    const opened = this._groupOpenStates.get(group.statePath);
    group.opened =
      opened ??
      group.defaultOpen ??
      (isScriptArrayElementObject(group.value.object?.[0])
        ? true
        : this.getNearestObjectGroup(group) === this._rootGroup);
  }
  private getPropertyHeight(property: Property<any>) {
    return this.getTableRowHeight(property.value?.options?.multiline ? 100 : undefined);
  }
  private getRawPropertyHeight(property: RawProperty) {
    return this.getTableRowHeight(property.options?.multiline ? 100 : undefined);
  }
  private getTableRowHeight(controlHeight?: number) {
    const style = ImGui.GetStyle();
    return Math.max(controlHeight ?? 0, ImGui.GetFrameHeight()) + style.CellPadding.y * 2;
  }
  private renderRows() {
    if (this._rows.length === 0) {
      return;
    }
    const startIndex = this.findFirstRowOverlapping(this._virtualClipMinY);
    const endIndex = this.findFirstRowAfter(this._virtualClipMaxY);
    const visibleStart = Math.min(startIndex, this._rows.length);
    const visibleEnd = Math.max(visibleStart, Math.min(endIndex, this._rows.length));
    const topHeight = visibleStart < this._rows.length ? this._rows[visibleStart].y : this._totalRowsHeight;
    this.renderVirtualSpacer(topHeight);
    for (let i = visibleStart; i < visibleEnd; i++) {
      this.renderRow(this._rows[i]);
    }
    const bottomStart = visibleEnd < this._rows.length ? this._rows[visibleEnd].y : this._totalRowsHeight;
    this.renderVirtualSpacer(this._totalRowsHeight - bottomStart);
  }
  private findFirstRowOverlapping(y: number) {
    let lo = 0;
    let hi = this._rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const row = this._rows[mid];
      if (row.y + row.height <= y) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }
  private findFirstRowAfter(y: number) {
    let lo = 0;
    let hi = this._rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this._rows[mid].y < y) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }
  private renderVirtualSpacer(height: number) {
    if (height <= 0) {
      return;
    }
    ImGui.TableNextRow(0, height);
    ImGui.TableNextColumn();
    ImGui.Dummy(new ImGui.ImVec2(0, 0));
  }
  private renderRow(row: PropertyRow) {
    switch (row.type) {
      case 'group':
        ImGui.PushID(row.group.statePath);
        this.renderGroup(row.group, row.level, row.toplevel);
        ImGui.PopID();
        break;
      case 'inlineObjectArrayGroup':
        ImGui.PushID(row.group.statePath);
        this.renderInlineObjectArrayGroup(row.group, row.level);
        ImGui.PopID();
        break;
      case 'property':
        this.renderProperty(row.property, row.level, row.owner);
        break;
      case 'rawProperty':
        this.renderRawProperty(row.property, row.level, row.owner);
        break;
    }
  }
  private renderGroup(group: PropertyGroup, level = 0, toplevel = false) {
    ImGui.TableNextRow(0, this._rowHeight);
    if (this._showLeadingColumn) {
      ImGui.TableNextColumn();
    }
    ImGui.TableNextColumn();
    const baseX = ImGui.GetCursorPosX();
    if (level > 0) {
      ImGui.SetCursorPosX(baseX + level * 10);
    }
    ImGui.AlignTextToFramePadding();
    if (!toplevel) {
      ImGui.SetNextItemOpen(group.opened, ImGui.Cond.Always);
    }
    let opened = true;
    if (toplevel) {
      if (group !== this._rootGroup) {
        ImGui.TextDisabled(this.getGroupLabel(group));
      }
    } else {
      let recursiveChanged = false;
      opened = ImGui.TreeNodeEx(this.getGroupLabel(group), ImGui.TreeNodeFlags.OpenOnArrow);
      if (ImGui.IsItemClicked(ImGui.MouseButton.Left) || ImGui.IsItemActivated()) {
        this.inspectGroup(group);
      }
      if (ImGui.IsItemToggledOpen() && ImGui.GetIO().KeyShift) {
        recursiveChanged = this.setGroupOpenStateRecursive(group, opened);
      }
      if (recursiveChanged) {
        this.invalidateRows();
      }
    }
    if (group.opened !== opened) {
      group.opened = opened;
      if (group !== this._rootGroup) {
        this._groupOpenStates.set(group.statePath, opened);
        this.invalidateRows();
      }
    }
    if (
      group.object &&
      group.prop &&
      (group.prop.type === 'object' || group.prop.type === 'object_array') &&
      group.objectTypes
    ) {
      const isScriptArrayElement = isScriptArrayElementObject(group.value.object?.[0]);
      const editable =
        (group.value.object?.[0] instanceof AABB && group.prop.options?.edit === 'aabb') ||
        (group.value.object?.[0] instanceof PropertyTrack && group.prop.options?.edit === 'proptrack') ||
        (group.value.object?.[0] instanceof Interpolator &&
          group.value.object[0].target === 'number' &&
          group.prop.options?.edit === 'curve1f');
      const settable =
        !group.prop.readonly &&
        !!group.prop.set &&
        (group.prop.type === 'object' || (!isScriptArrayElement && group.index < group.count));
      const addable = group.prop.type === 'object_array' && !!group.prop.add;
      const deletable = group.prop.type === 'object_array' && group.prop.delete && group.index < group.count;
      const showTypeSelector = group.objectTypes.length > 1;

      const buttonSize = ImGui.GetFrameHeight();
      const buttonCount =
        (editable ? buttonSize : 0) +
        (settable ? buttonSize : 0) +
        (addable ? buttonSize : 0) +
        (deletable ? buttonSize : 0);
      ImGui.TableNextColumn();
      if (showTypeSelector || settable || addable || deletable || editable) {
        ImGui.BeginChild('', new ImGui.ImVec2(-1, ImGui.GetFrameHeight()));
        if (showTypeSelector) {
          const fieldWidth = Math.max(0, ImGui.GetContentRegionAvail().x - buttonCount);
          const currentTypeName = group.objectTypes[group.selected[0]]?.name ?? 'NULL';
          const clicked = this.renderClippedStringField(
            `##group_type_${group.path}`,
            currentTypeName,
            fieldWidth,
            true
          );
          if (clicked) {
            this.inspectGroup(group);
            ImGui.OpenPopup(`##group_type_popup_${group.path}`);
          }
          if (ImGui.BeginPopup(`##group_type_popup_${group.path}`)) {
            for (let i = 0; i < group.objectTypes.length; i++) {
              const typeName = group.objectTypes[i]?.name ?? 'NULL';
              if (ImGui.Selectable(typeName, group.selected[0] === i)) {
                this.inspectGroup(group);
                group.selected[0] = i;
              }
            }
            ImGui.EndPopup();
          }
          if (settable) {
            ImGui.SameLine(0, 0);
            this.pushInlineActionButtonStyle();
            if (ImGui.Button(`${FontGlyph.glyphs['ok']}##set`, new ImGui.ImVec2(buttonSize, 0))) {
              this.inspectGroup(group);
              const ctor = group.objectTypes[group.selected[0]]?.ctor;
              const newObj = ctor
                ? group.prop.create
                  ? group.prop.create.call(group.object, ctor, group.index)
                  : new ctor()
                : null;
              const value = { object: [newObj], str: [], bool: [], num: [] };
              group.prop.set!.call(group.object, value, group.index);
              this.dispatchEvent('object_property_changed', group.object, group.prop);
              this.refresh();
            }
            this.popInlineActionButtonStyle();
          }
          if (addable) {
            ImGui.SameLine(0, 0);
            this.pushInlineActionButtonStyle();
            if (
              ImGui.Button(`${FontGlyph.glyphs['plus']}##add`, new ImGui.ImVec2(buttonSize, 0)) &&
              group.selected[0] >= 0
            ) {
              this.inspectGroup(group);
              const ctor = group.objectTypes[group.selected[0]]?.ctor;
              const insertIndex = group.index + 1;
              const newObj = isScriptArrayElement
                ? null
                : ctor
                  ? group.prop.create
                    ? group.prop.create.call(group.object, ctor, insertIndex)
                    : new ctor()
                  : null;
              (group.prop.add<'object'>).call(group.object, { object: newObj ? [newObj] : [] }, insertIndex);
              this.dispatchEvent('object_property_changed', group.object, group.prop);
              this.refresh();
            }
            this.popInlineActionButtonStyle();
          }
          if (deletable) {
            ImGui.SameLine(0, 0);
            this.pushInlineActionButtonStyle();
            if (ImGui.Button(`${FontGlyph.glyphs['cancel']}##delete`, new ImGui.ImVec2(buttonSize, 0))) {
              this.inspectGroup(group);
              group.prop.delete!.call(group.object, group.index);
              this.dispatchEvent('object_property_changed', group.object, group.prop);
              this.refresh();
              if (editable) {
                if (group.prop.options?.edit === 'aabb') {
                  this.dispatchEvent('end_edit_aabb', group.value.object[0] as AABB);
                } else if (group.prop.options?.edit === 'curve1f') {
                  this.dispatchEvent('end_edit_curve1f', group.value.object[0] as Interpolator, null);
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
                    getEngine().resourceManager.findAnimationTarget(node, group.value.object[0])!,
                    false
                  );
                }
              }
            }
            this.popInlineActionButtonStyle();
          }
          if (editable) {
            ImGui.SameLine(0, 0);
            this.pushInlineActionButtonStyle();
            if (ImGui.Button(`${FontGlyph.glyphs['pencil']}##edit`, new ImGui.ImVec2(-1, 0))) {
              this.inspectGroup(group);
              if (group.prop.options?.edit === 'aabb') {
                this.dispatchEvent('request_edit_aabb', group.value.object[0] as AABB);
              } else if (group.prop.options?.edit === 'curve1f') {
                this.dispatchEvent(
                  'request_edit_curve1f',
                  group.value.object[0] as Interpolator,
                  group.name,
                  (curve) =>
                    group.prop.set.call(group.object, { num: [], bool: [], str: [], object: [curve] })
                );
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
                  getEngine().resourceManager.findAnimationTarget(node, group.value.object[0])!
                );
              }
            }
            this.popInlineActionButtonStyle();
          }
        } else {
          if (settable) {
            this.pushInlineActionButtonStyle();
            if (ImGui.Button(`${FontGlyph.glyphs['ok']}##set`, new ImGui.ImVec2(buttonSize, 0))) {
              this.inspectGroup(group);
              const ctor = group.objectTypes[0]?.ctor;
              const newObj = ctor
                ? group.prop.create
                  ? group.prop.create.call(group.object, ctor, group.index)
                  : new ctor()
                : null;
              const value = { object: [newObj], str: [], bool: [], num: [] };
              group.prop.set!.call(group.object, value, group.index);
              this.dispatchEvent('object_property_changed', group.object, group.prop);
              this.refresh();
            }
            this.popInlineActionButtonStyle();
          }
          if (addable) {
            if (settable) {
              ImGui.SameLine(0, 0);
            }
            this.pushInlineActionButtonStyle();
            if (ImGui.Button(`${FontGlyph.glyphs['plus']}##add`, new ImGui.ImVec2(buttonSize, 0))) {
              this.inspectGroup(group);
              const ctor = group.objectTypes[0]?.ctor;
              const insertIndex = group.index + 1;
              const newObj = isScriptArrayElement
                ? null
                : ctor
                  ? group.prop.create
                    ? group.prop.create.call(group.object, ctor, insertIndex)
                    : new ctor()
                  : null;
              (group.prop.add<'object'>).call(group.object, { object: newObj ? [newObj] : [] }, insertIndex);
              this.dispatchEvent('object_property_changed', group.object, group.prop);
              this.refresh();
            }
            this.popInlineActionButtonStyle();
          }
          if (deletable) {
            if (settable || addable) {
              ImGui.SameLine(0, 0);
            }
            this.pushInlineActionButtonStyle();
            if (ImGui.Button(`${FontGlyph.glyphs['cancel']}##delete`, new ImGui.ImVec2(buttonSize, 0))) {
              this.inspectGroup(group);
              group.prop.delete!.call(group.object, group.index);
              this.dispatchEvent('object_property_changed', group.object, group.prop);
              this.refresh();
              if (editable) {
                if (group.prop.options?.edit === 'aabb') {
                  this.dispatchEvent('end_edit_aabb', group.value.object[0] as AABB);
                } else if (group.prop.options?.edit === 'curve1f') {
                  this.dispatchEvent('end_edit_curve1f', group.value.object[0] as Interpolator, null);
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
                    getEngine().resourceManager.findAnimationTarget(node, group.value.object[0])!,
                    false
                  );
                }
              }
            }
            this.popInlineActionButtonStyle();
          }
          if (editable) {
            if (settable || addable || deletable) {
              ImGui.SameLine(0, 0);
            }
            this.pushInlineActionButtonStyle();
            if (ImGui.Button(`${FontGlyph.glyphs['pencil']}##edit`, new ImGui.ImVec2(buttonSize, 0))) {
              this.inspectGroup(group);
              if (group.prop.options?.edit === 'aabb') {
                this.dispatchEvent('request_edit_aabb', group.value.object[0] as AABB);
              } else if (group.prop.options?.edit === 'curve1f') {
                this.dispatchEvent(
                  'request_edit_curve1f',
                  group.value.object[0] as Interpolator,
                  group.name,
                  (curve) =>
                    group.prop.set.call(group.object, { num: [], bool: [], str: [], object: [curve] })
                );
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
                  getEngine().resourceManager.findAnimationTarget(node, group.value.object[0])!
                );
              }
            }
            this.popInlineActionButtonStyle();
          }
        }
        ImGui.EndChild();
      }
    }
    if (opened && !toplevel) {
      ImGui.TreePop();
    }
    if (level > 0) {
      ImGui.SetCursorPosX(baseX);
    }
  }
  private isInlineObjectArrayGroup(group: PropertyGroup) {
    return (
      !!group.object &&
      !!group.prop &&
      group.prop.type === 'object_array' &&
      !!group.prop.options?.inlineObjectArray &&
      group.properties.length === 1 &&
      group.subgroups.length === 0 &&
      group.rawProperties.length === 0 &&
      !(group.properties[0] instanceof PropertyGroup) &&
      group.properties[0].property.value?.type === 'string'
    );
  }
  private renderInlineObjectArrayGroup(group: PropertyGroup, level: number) {
    if (
      !group.object ||
      !group.prop ||
      group.prop.type !== 'object_array' ||
      !group.prop.options?.inlineObjectArray ||
      group.properties.length !== 1 ||
      group.subgroups.length > 0 ||
      group.rawProperties.length > 0 ||
      group.properties[0] instanceof PropertyGroup
    ) {
      this.renderVirtualSpacer(this._rowHeight);
      return false;
    }
    const inlineProperty = group.properties[0].property;
    const value = inlineProperty.value;
    const object = inlineProperty.object;
    if (!value || value.type !== 'string') {
      this.renderVirtualSpacer(this._rowHeight);
      return false;
    }

    ImGui.TableNextRow(0, this._rowHeight);
    if (this._showLeadingColumn) {
      ImGui.TableNextColumn();
    }
    ImGui.TableNextColumn();
    const baseX = ImGui.GetCursorPosX();
    if (level > 0) {
      ImGui.SetCursorPosX(baseX + level * 10);
    }
    ImGui.AlignTextToFramePadding();
    ImGui.Text(value.options?.label ?? group.prop.options?.label ?? inlineProperty.name);
    if (ImGui.IsItemClicked(ImGui.MouseButton.Left)) {
      this.inspectGroup(group);
    }
    if (level > 0) {
      ImGui.SetCursorPosX(baseX);
    }

    ImGui.TableNextColumn();
    const tmpProperty: RequireOptionals<PropertyValue> = {
      num: [0, 0, 0, 0],
      str: [''],
      bool: [false],
      object: []
    };
    value.get.call(object, tmpProperty);
    const readonly = !value.set;
    const val = tmpProperty.str as [string];
    const isSceneNodeRef = !!value.options?.sceneNode;
    const isAssetRef = !!value.options?.mimeTypes?.length;
    const canInlineEdit = !!value.set && !readonly && !isSceneNodeRef && !isAssetRef;
    const hasValue = !!String(val[0] ?? '').trim();
    const addable = !!group.prop.add && group.index === group.count - 1;
    const deletable = !!group.prop.delete && group.index < group.count && (group.count > 1 || hasValue);
    const pickerButtonCount = (isSceneNodeRef || isAssetRef) && value.set ? 1 : 0;
    const clearButtonCount = (isSceneNodeRef || isAssetRef) && !!value.set && !!val[0] ? 1 : 0;
    const extraButtons = pickerButtonCount + clearButtonCount + (addable ? 1 : 0) + (deletable ? 1 : 0);
    if (extraButtons > 0) {
      ImGui.BeginChild('', new ImGui.ImVec2(-1, ImGui.GetFrameHeight()));
    }
    const fieldWidth =
      extraButtons > 0
        ? ImGui.GetContentRegionAvail().x - extraButtons * ImGui.GetFrameHeight()
        : ImGui.GetContentRegionAvail().x;
    let changed = false;
    if (isSceneNodeRef || isAssetRef) {
      const displayText = isSceneNodeRef ? this.resolveSceneNodeRefLabel(object, val[0]) : val[0];
      this.renderClippedStringField('##value_display', displayText, fieldWidth, false);
    } else {
      const clicked = this.renderClippedStringField('##value_display', val[0], fieldWidth, canInlineEdit);
      if (clicked && canInlineEdit) {
        this.inspectGroup(group);
        changed = customTextInput('##value', val, '', readonly ? CustomInputTextFlags.ReadOnly : 0);
      }
    }
    if (ImGui.IsItemClicked(ImGui.MouseButton.Left)) {
      this.inspectGroup(group);
      this.revealAsset(val[0]);
    }
    this.setDragDropProperty(object, value, tmpProperty);
    if (pickerButtonCount > 0) {
      ImGui.SameLine(0, 0);
      this.pushInlineActionButtonStyle();
      if (ImGui.Button(`${FontGlyph.glyphs['link']}##pick`, new ImGui.ImVec2(ImGui.GetFrameHeight(), 0))) {
        this.inspectGroup(group);
      }
      if (ImGui.IsItemHovered()) {
        ImGui.SetTooltip(
          isSceneNodeRef
            ? 'Drag this button onto a node in the scene hierarchy to set the reference'
            : 'Drag this button onto an asset to set the reference'
        );
      }
      if (ImGui.BeginDragDropSource()) {
        if (isSceneNodeRef) {
          const payload: SceneHierarchyNodePickerPayload = {
            type: 'node-picker',
            object,
            prop: value
          };
          ImGui.SetDragDropPayload('NODE', payload);
          ImGui.Text('Drop on a scene node');
        } else {
          const payload: VFSRendererAssetPickerPayload = {
            type: 'asset-picker',
            object,
            prop: value
          };
          ImGui.SetDragDropPayload('ASSET', payload);
          ImGui.Text('Drop on an asset');
        }
        ImGui.EndDragDropSource();
      }
      this.popInlineActionButtonStyle();
    }
    if (clearButtonCount > 0) {
      ImGui.SameLine(0, 0);
      this.pushInlineActionButtonStyle();
      if (ImGui.Button(`${FontGlyph.glyphs['cancel']}##clear`, new ImGui.ImVec2(ImGui.GetFrameHeight(), 0))) {
        this.inspectGroup(group);
        tmpProperty.str[0] = '';
        Promise.resolve(value.set!.call(object, tmpProperty)).then(() => {
          this.invalidateRows();
          this.dispatchEvent('object_property_changed', object, value);
        });
      }
      this.popInlineActionButtonStyle();
    }
    if (addable) {
      ImGui.SameLine(0, 0);
      this.pushInlineActionButtonStyle();
      if (ImGui.Button(`${FontGlyph.glyphs['plus']}##add`, new ImGui.ImVec2(ImGui.GetFrameHeight(), 0))) {
        this.inspectGroup(group);
        const ctor = group.objectTypes?.[0]?.ctor;
        const newObj = ctor
          ? group.prop.create
            ? group.prop.create.call(group.object, ctor, group.index + 1)
            : new ctor()
          : null;
        (group.prop.add<'object'>).call(group.object, { object: [newObj] }, group.index + 1);
        this.dispatchEvent('object_property_changed', group.object, group.prop);
        this.refresh();
      }
      this.popInlineActionButtonStyle();
    }
    if (deletable) {
      ImGui.SameLine(0, 0);
      this.pushInlineActionButtonStyle();
      if (
        ImGui.Button(`${FontGlyph.glyphs['cancel']}##delete`, new ImGui.ImVec2(ImGui.GetFrameHeight(), 0))
      ) {
        this.inspectGroup(group);
        group.prop.delete!.call(group.object, group.index);
        this.dispatchEvent('object_property_changed', group.object, group.prop);
        this.refresh();
      }
      this.popInlineActionButtonStyle();
    }
    if (extraButtons > 0) {
      ImGui.EndChild();
    }
    if (changed && value.set) {
      this.inspectGroup(group);
      const result = value.set.call(object, tmpProperty);
      const onChanged = () => {
        this.invalidateRows();
        this.dispatchEvent('object_property_changed', object, value);
      };
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        Promise.resolve(result).then(onChanged);
      } else {
        onChanged();
      }
    }
    return true;
  }
  private renderRawProperty(value: RawProperty, level: number, owner: PropertyGroup) {
    ImGui.PushID(value.name);
    ImGui.TableNextRow(0, this.getRawPropertyHeight(value));
    if (this._showLeadingColumn) {
      ImGui.TableNextColumn();
    }
    ImGui.TableNextColumn();
    const baseX = ImGui.GetCursorPosX();
    if (level > 0) {
      ImGui.SetCursorPosX(baseX + level * 10);
    }
    ImGui.Text(value.name);
    if (ImGui.IsItemClicked(ImGui.MouseButton.Left)) {
      this.inspectGroup(owner);
    }
    if (level > 0) {
      ImGui.SetCursorPosX(baseX);
    }
    ImGui.TableNextColumn();
    ImGui.SetNextItemWidth(-1);
    const readonly = !value.set;
    let changed = false;
    const tmpProperty: RequireOptionals<PropertyValue> = {
      num: [0, 0, 0, 0],
      str: [''],
      bool: [false],
      object: []
    };
    value.get(tmpProperty);
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
            readonly ? 0 : (value.options?.speed ?? 0.1),
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
            readonly ? 0 : (value.options?.speed ?? 0.01),
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
          changed = value.options?.multiline
            ? customTextInput(
                '##value',
                val,
                '',
                readonly
                  ? CustomInputTextFlags.ReadOnly | CustomInputTextFlags.Multiline
                  : CustomInputTextFlags.Multiline,
                -1,
                100
              )
            : customTextInput('##value', val, '', readonly ? CustomInputTextFlags.ReadOnly : 0);
        }
        break;
      }
      case 'int2': {
        const val = tmpProperty.num as [number, number];
        changed = ImGui.DragInt2(
          '##value',
          val,
          readonly ? 0 : (value.options?.speed ?? 0.1),
          value.options?.minValue ?? undefined,
          value.options?.maxValue ?? undefined
        );
        break;
      }
      case 'int3': {
        const val = tmpProperty.num as [number, number, number];
        changed = ImGui.DragInt3(
          '##value',
          val,
          readonly ? 0 : (value.options?.speed ?? 0.1),
          value.options?.minValue ?? undefined,
          value.options?.maxValue ?? undefined
        );
        break;
      }
      case 'int4': {
        const val = tmpProperty.num as [number, number, number, number];
        changed = ImGui.DragInt4(
          '##value',
          val,
          readonly ? 0 : (value.options?.speed ?? 0.1),
          value.options?.minValue ?? undefined,
          value.options?.maxValue ?? undefined
        );
        break;
      }
      case 'vec2': {
        const val = tmpProperty.num as [number, number];
        changed = ImGui.DragFloat2(
          '##value',
          val,
          readonly ? 0 : (value.options?.speed ?? 0.01),
          value.options?.minValue ?? undefined,
          value.options?.maxValue ?? undefined,
          '%.3f'
        );
        break;
      }
      case 'vec3': {
        const val = tmpProperty.num as [number, number, number];
        changed = ImGui.DragFloat3(
          '##value',
          val,
          readonly ? 0 : (value.options?.speed ?? 0.01),
          value.options?.minValue ?? undefined,
          value.options?.maxValue ?? undefined,
          '%.3f'
        );
        break;
      }
      case 'vec4': {
        const val = tmpProperty.num as [number, number, number, number];
        changed = ImGui.DragFloat4(
          '##value',
          val,
          readonly ? 0 : (value.options?.speed ?? 0.01),
          value.options?.minValue ?? undefined,
          value.options?.maxValue ?? undefined,
          '%.3f'
        );
        break;
      }
      case 'rgb': {
        const val = tmpProperty.num as [number, number, number];
        const flags =
          PropertyEditor.HDR_COLOR_EDIT_FLAGS |
          (readonly ? ImGui.ColorEditFlags.NoInputs : ImGui.ColorEditFlags.None);
        changed = ImGui.ColorEdit3('##value', val, flags);
        break;
      }
      case 'rgba': {
        const val = tmpProperty.num as [number, number, number, number];
        const flags =
          PropertyEditor.HDR_COLOR_EDIT_FLAGS |
          (readonly ? ImGui.ColorEditFlags.NoInputs : ImGui.ColorEditFlags.None);
        changed = ImGui.ColorEdit4('##value', val, flags);
        break;
      }
    }
    ImGui.PopID();
    if (changed && value.set) {
      this.inspectGroup(owner);
      value.set(tmpProperty);
      this.invalidateRows();
      this.dispatchEvent('object_property_changed', null, value);
    }
  }
  public linearToSRGB(_x: number): number {
    // 线性 -> sRGB（2.2 近似）
    const srgb = Math.pow(Math.max(0, Math.min(1, _x)), 1 / 2.2);
    // 量化到 0-255 再还原到 0-1，避免无限精度
    const q = Math.round(srgb * 255);
    return q / 255;
  }

  public sRGBToLinear(_x: number): number {
    // sRGB -> 线性
    return Math.pow(Math.max(0, Math.min(1, _x)), 2.2);
  }
  private revealAsset(path: string) {
    if (!path || !path.startsWith('/')) {
      return;
    }
    eventBus.dispatchEvent('reveal_asset', ProjectService.VFS.normalizePath(path));
  }
  private resolveSceneNodeRefHost(object: any): Nullable<SceneNode> {
    if (object instanceof SceneNode) {
      return object;
    }
    if (object?.host instanceof SceneNode) {
      return object.host;
    }
    if (object?.scriptHost instanceof SceneNode) {
      return object.scriptHost;
    }
    if (this.object instanceof SceneNode) {
      return this.object;
    }
    return null;
  }
  private resolveSceneNodeRefLabel(object: any, value: string) {
    const id = String(value ?? '').trim();
    if (!id) {
      return '';
    }
    const host = this.resolveSceneNodeRefHost(object);
    const scope = host
      ? (typeof (host as any)?.getPrefabNode === 'function' && (host as any).getPrefabNode()) ||
        host.scene?.rootNode ||
        host
      : null;
    const node = scope?.findNodeById?.(id);
    if (node instanceof SceneNode) {
      const name = String(node.name ?? '').trim();
      return name || node.persistentId || id;
    }
    return `[Missing] ${id}`;
  }
  private revealAssetFromProperty(object: any, prop: PropertyAccessor<any>) {
    if (!prop.options?.mimeTypes?.length) {
      return;
    }
    const tmpProperty: RequireOptionals<PropertyValue> = {
      num: [0, 0, 0, 0],
      str: [''],
      bool: [false],
      object: []
    };
    prop.get.call(object, tmpProperty);
    this.revealAsset(tmpProperty.str[0]);
  }
  private renderProperty(property: Property<any>, level: number, owner: PropertyGroup) {
    const { name, object, value } = property;
    if (value && value.isValid && !value.isValid.call(object)) {
      this.renderVirtualSpacer(this.getPropertyHeight(property));
      return;
    }
    ImGui.PushID(property.path);
    ImGui.TableNextRow(0, this.getPropertyHeight(property));
    if (this._showLeadingColumn) {
      ImGui.TableNextColumn();
      ImGui.SetNextItemWidth(-1);
      const animatable = value && !!value.options?.animatable;
      if (animatable && this.object instanceof SceneNode) {
        if (ImGui.Button('A')) {
          this.inspectGroup(owner);
          Dialog.selectAnimationAndTrack(
            'Create animation track',
            this.object.animationSet.getAnimationNames(),
            300
          ).then((val) => {
            if (val) {
              let animation = this.object.animationSet.getAnimationClip(val.animationName);
              if (!animation) {
                animation = this.object.animationSet.createAnimation(val.animationName, false);
              }
              const propValue = { num: [0, 0, 0, 0], str: [], bool: [], object: [] };
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
      if (ImGui.IsItemClicked(ImGui.MouseButton.Left)) {
        this.inspectGroup(owner);
        this.revealAssetFromProperty(object, value);
      }
      if (value.description && ImGui.IsItemHovered()) {
        ImGui.SetTooltip(value.description);
      }
      if (level > 0) {
        ImGui.SetCursorPosX(baseX);
      }
    }
    if (value) {
      const editSessionKey = this.getEditSessionKey(object, property.path);
      ImGui.TableNextColumn();
      ImGui.SetNextItemWidth(-1);
      const readonly = !!value.readonly || !value.set;
      let changed = false;
      const tmpProperty = {
        num: [0, 0, 0, 0],
        str: [''],
        bool: [false],
        object: []
      };
      value.get.call(object, tmpProperty);
      const oldValue = this.clonePropertyValue(tmpProperty);
      let needRefresh = false;
      switch (value.type) {
        case 'bool': {
          const val = tmpProperty.bool as [boolean];
          changed = ImGui.Checkbox(`##value`, val) && !readonly;
          if (changed) {
            needRefresh = true;
          }
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
              readonly ? 0 : (value.options?.speed ?? 0.1),
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
              readonly ? 0 : (value.options?.speed ?? 0.01),
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
              needRefresh = true;
            }
          } else {
            const val = tmpProperty.str as [string];
            const isSceneNodeRef = !!value.options?.sceneNode;
            const isAssetRef = !!value.options?.mimeTypes?.length;
            const canInlineEdit = !!value.set && !readonly && !isSceneNodeRef && !isAssetRef;
            const stringEditorActive = canInlineEdit && this._activeStringEditors.has(editSessionKey);
            const canClearValue = (isAssetRef || isSceneNodeRef) && !!value.set && !!val[0];
            const pickerButtonCount = (isSceneNodeRef || isAssetRef) && value.set ? 1 : 0;
            const clearButtonCount = canClearValue ? 1 : 0;
            const totalButtonCount = pickerButtonCount + clearButtonCount;
            const fieldWidth =
              totalButtonCount > 0
                ? ImGui.GetContentRegionAvail().x - totalButtonCount * ImGui.GetFrameHeight()
                : ImGui.GetContentRegionAvail().x;
            if (stringEditorActive) {
              ImGui.SetNextItemWidth(fieldWidth);
              if (this._pendingStringEditorFocus === editSessionKey) {
                requestCustomTextInputFocus('##value');
                this._pendingStringEditorFocus = null;
              }
              changed = value.options?.multiline
                ? customTextInput(
                    '##value',
                    val,
                    '',
                    readonly
                      ? CustomInputTextFlags.ReadOnly | CustomInputTextFlags.Multiline
                      : CustomInputTextFlags.Multiline,
                    -1,
                    100
                  )
                : customTextInput('##value', val, '', readonly ? CustomInputTextFlags.ReadOnly : 0);
            } else {
              const displayText = isSceneNodeRef ? this.resolveSceneNodeRefLabel(object, val[0]) : val[0];
              const clicked = this.renderClippedStringField(
                '##value_display',
                displayText,
                fieldWidth,
                canInlineEdit
              );
              if (clicked && canInlineEdit) {
                this.inspectGroup(owner);
                this.activateStringEditor(editSessionKey);
              }
            }
            if (ImGui.IsItemClicked(ImGui.MouseButton.Left)) {
              this.inspectGroup(owner);
              this.revealAsset(val[0]);
            }
            this.setDragDropProperty(object, value, tmpProperty);
            if (pickerButtonCount > 0) {
              ImGui.SameLine(0, 0);
              this.pushInlineActionButtonStyle();
              if (
                ImGui.Button(`${FontGlyph.glyphs['link']}##pick`, new ImGui.ImVec2(ImGui.GetFrameHeight(), 0))
              ) {
                this.inspectGroup(owner);
              }
              if (ImGui.IsItemHovered()) {
                ImGui.SetTooltip(
                  isSceneNodeRef
                    ? 'Drag this button onto a node in the scene hierarchy to set the reference'
                    : 'Drag this button onto an asset to set the reference'
                );
              }
              if (ImGui.BeginDragDropSource()) {
                if (isSceneNodeRef) {
                  const payload: SceneHierarchyNodePickerPayload = {
                    type: 'node-picker',
                    object,
                    prop: value
                  };
                  ImGui.SetDragDropPayload('NODE', payload);
                  ImGui.Text('Drop on a scene node');
                } else {
                  const payload: VFSRendererAssetPickerPayload = {
                    type: 'asset-picker',
                    object,
                    prop: value
                  };
                  ImGui.SetDragDropPayload('ASSET', payload);
                  ImGui.Text('Drop on an asset');
                }
                ImGui.EndDragDropSource();
              }
              this.popInlineActionButtonStyle();
            }
            if (clearButtonCount > 0) {
              ImGui.SameLine(0, 0);
              this.pushInlineActionButtonStyle();
              if (
                ImGui.Button(
                  `${FontGlyph.glyphs['cancel']}##clear`,
                  new ImGui.ImVec2(ImGui.GetFrameHeight(), 0)
                )
              ) {
                this.inspectGroup(owner);
                tmpProperty.str[0] = '';
                Promise.resolve(value.set.call(object, tmpProperty)).then(() => {
                  this.invalidateRows();
                  this.dispatchEvent('object_property_changed', object, value);
                });
              }
              this.popInlineActionButtonStyle();
            }
          }
          break;
        }
        case 'int2': {
          const val = tmpProperty.num as [number, number];
          changed = ImGui.DragInt2(
            '##value',
            val,
            readonly ? 0 : (value.options?.speed ?? 0.1),
            value.options?.minValue ?? undefined,
            value.options?.maxValue ?? undefined
          );
          break;
        }
        case 'int3': {
          const val = tmpProperty.num as [number, number, number];
          changed = ImGui.DragInt3(
            '##value',
            val,
            readonly ? 0 : (value.options?.speed ?? 0.1),
            value.options?.minValue ?? undefined,
            value.options?.maxValue ?? undefined
          );
          break;
        }
        case 'int4': {
          const val = tmpProperty.num as [number, number, number, number];
          changed = ImGui.DragInt4(
            '##value',
            val,
            readonly ? 0 : (value.options?.speed ?? 0.1),
            value.options?.minValue ?? undefined,
            value.options?.maxValue ?? undefined
          );
          break;
        }
        case 'vec2': {
          const val = tmpProperty.num as [number, number];
          changed = ImGui.DragFloat2(
            '##value',
            val,
            readonly ? 0 : (value.options?.speed ?? 0.01),
            value.options?.minValue ?? undefined,
            value.options?.maxValue ?? undefined,
            '%.3f'
          );
          break;
        }
        case 'vec3': {
          const val = tmpProperty.num as [number, number, number];
          const isOrthoCamera = object instanceof Camera && object.isOrtho();
          const editRotation = !isOrthoCamera && value.options?.edit === 'quaternion';
          if (editRotation) {
            ImGui.BeginChild('', new ImGui.ImVec2(-1, ImGui.GetFrameHeight()));
            ImGui.SetNextItemWidth(ImGui.GetContentRegionAvail().x - ImGui.GetFrameHeight());
          }
          changed = ImGui.DragFloat3(
            '##value',
            val,
            readonly ? 0 : (value.options?.speed ?? 0.01),
            value.options?.minValue ?? undefined,
            value.options?.maxValue ?? undefined,
            '%.3f'
          );
          if (editRotation) {
            ImGui.SameLine(0, 0);
            if (ImGui.Button(`${FontGlyph.glyphs['pencil']}##edit`, new ImGui.ImVec2(-1, 0))) {
              this.inspectGroup(owner);
              ImGui.OpenPopup('EditQuaternion');
              RotationEditor.enable(!(object instanceof Camera) || !object.isOrtho());
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
          changed = ImGui.DragFloat4(
            '##value',
            val,
            readonly ? 0 : (value.options?.speed ?? 0.01),
            value.options?.minValue ?? undefined,
            value.options?.maxValue ?? undefined,
            '%.3f'
          );
          break;
        }
        case 'rgb': {
          const val = tmpProperty.num as [number, number, number];
          const flags =
            PropertyEditor.HDR_COLOR_EDIT_FLAGS |
            (readonly ? ImGui.ColorEditFlags.NoInputs : ImGui.ColorEditFlags.None);
          changed = ImGui.ColorEdit3('##value', val, flags);
          break;
        }
        case 'rgba': {
          const val = tmpProperty.num as [number, number, number, number];
          const flags =
            PropertyEditor.HDR_COLOR_EDIT_FLAGS |
            (readonly ? ImGui.ColorEditFlags.NoInputs : ImGui.ColorEditFlags.None);
          changed = ImGui.ColorEdit4('##value', val, flags);
          break;
        }
        case 'command': {
          for (let i = 0; i < tmpProperty.str.length; i++) {
            if (i > 0) {
              ImGui.SameLine();
            }
            if (ImGui.Button(`${tmpProperty.str[i]}##command${i}`)) {
              this.inspectGroup(owner);
              if (value.command && value.command.call(object, i)) {
                this.refresh();
              }
            }
          }
          break;
        }
        case 'object': {
          const val = tmpProperty.str as [string];
          const hasClearButton = !!value.isNullable?.call(object, 0);
          const fieldWidth = hasClearButton
            ? ImGui.GetContentRegionAvail().x - ImGui.GetFrameHeight()
            : ImGui.GetContentRegionAvail().x;
          this.renderClippedStringField('##value_object', val[0], fieldWidth, false);
          if (ImGui.IsItemClicked(ImGui.MouseButton.Left)) {
            this.inspectGroup(owner);
            this.revealAsset(val[0]);
          }
          this.setDragDropProperty(object, value, tmpProperty);
          if (hasClearButton) {
            ImGui.SameLine(0, 0);
            this.pushInlineActionButtonStyle();
            if (
              ImGui.Button(
                `${FontGlyph.glyphs['cancel']}##clear`,
                new ImGui.ImVec2(ImGui.GetFrameHeight(), 0)
              )
            ) {
              this.inspectGroup(owner);
              Promise.resolve(value.set!.call(object, null)).then(() => {
                this.refresh();
                this.dispatchEvent('object_property_changed', object, value);
              });
              if (property.value.options?.objectTypes?.length > 0) {
                ImGui.OpenPopup('X##list');
                if (ImGui.BeginPopup('X##list')) {
                  for (const t of property.value.options.objectTypes) {
                    const cls = getEngine().resourceManager.getClassByConstructor(t);
                    if (cls && ImGui.MenuItem(`${cls.name}##create`)) {
                      alert(cls.name);
                    }
                  }
                  ImGui.EndPopup();
                }
              }
            }
            this.popInlineActionButtonStyle();
          }
          break;
        }
      }
      /*
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
                    this.dispatchEvent('object_property_changed', object, value);
                  });
                }
              }
            }
          }
          ImGui.EndDragDropTarget();
        }
      }
      */
      if (changed && value.set) {
        this.inspectGroup(owner);
        const result = value.set.call(object, tmpProperty);
        const onChanged = () => {
          this.invalidateRows();
          this.dispatchEvent('object_property_changed', object, value);
        };
        if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
          Promise.resolve(result).then(onChanged);
        } else {
          onChanged();
        }
      }
      if (value.set && ImGui.IsItemActivated()) {
        this.inspectGroup(owner);
      }
      if (value.set && ImGui.IsItemActivated() && !this._editSessions.has(editSessionKey)) {
        this._editSessions.set(editSessionKey, oldValue);
      }
      if (value.set && ImGui.IsItemDeactivatedAfterEdit()) {
        this.inspectGroup(owner);
        const oldSnapshot = this._editSessions.get(editSessionKey) ?? oldValue;
        const newSnapshot = {
          num: [0, 0, 0, 0],
          str: [''],
          bool: [false],
          object: []
        } as RequireOptionals<PropertyValue>;
        value.get.call(object, newSnapshot);
        this.dispatchEvent(
          'object_property_edit_finished',
          object,
          value,
          this.clonePropertyValue(oldSnapshot),
          this.clonePropertyValue(newSnapshot)
        );
        this._editSessions.delete(editSessionKey);
        this.deactivateStringEditor(editSessionKey);
      } else if (value.type === 'string' && !ImGui.IsItemActive() && !ImGui.IsItemHovered()) {
        if (this._activeStringEditors.has(editSessionKey) && !ImGui.GetIO().MouseDown[0]) {
          this.deactivateStringEditor(editSessionKey);
        }
      }
      if (needRefresh) {
        this.refresh();
      }
    }
    ImGui.PopID();
  }
  private getEditSessionKey(object: any, propertyPath: string) {
    const objectId =
      object?.runtimeId !== undefined
        ? `${object.runtimeId}`
        : `${object?.constructor?.name ?? 'Object'}:${Object.prototype.toString.call(object)}`;
    return `${objectId}::${propertyPath}`;
  }
  private clonePropertyValue(value: {
    num: number[];
    str: string[];
    bool: boolean[];
    object: object[];
  }): RequireOptionals<PropertyValue> {
    return {
      num: [...(value.num ?? [])],
      str: [...(value.str ?? [])],
      bool: [...(value.bool ?? [])],
      object: [...(value.object ?? [])]
    };
  }
  private activateStringEditor(key: string) {
    this._activeStringEditors.add(key);
    this._pendingStringEditorFocus = key;
  }
  private deactivateStringEditor(key: string) {
    this._activeStringEditors.delete(key);
    if (this._pendingStringEditorFocus === key) {
      this._pendingStringEditorFocus = null;
    }
  }
  private renderClippedStringField(id: string, text: string, width?: number, editable?: boolean) {
    const style = ImGui.GetStyle();
    const fieldWidth = width && width > 0 ? width : ImGui.GetContentRegionAvail().x;
    const fieldSize = new ImGui.ImVec2(fieldWidth, ImGui.GetFrameHeight());
    const clicked = ImGui.InvisibleButton(id, fieldSize, 0);
    const hovered = ImGui.IsItemHovered();
    const drawList = ImGui.GetWindowDrawList();
    const rectMin = ImGui.GetItemRectMin();
    const rectMax = ImGui.GetItemRectMax();
    const bgColor = ImGui.GetColorU32(hovered && editable ? ImGui.Col.FrameBgHovered : ImGui.Col.FrameBg);
    const borderColor = ImGui.GetColorU32(ImGui.Col.Border);
    const textColor = ImGui.GetColorU32(ImGui.Col.Text);
    drawList.AddRectFilled(rectMin, rectMax, bgColor, style.FrameRounding);
    drawList.AddRect(rectMin, rectMax, borderColor, style.FrameRounding, ImGui.DrawCornerFlags.None, 1);
    const textPos = new ImGui.ImVec2(rectMin.x + style.FramePadding.x, rectMin.y + style.FramePadding.y);
    const clipMin = new ImGui.ImVec2(rectMin.x + style.FramePadding.x, rectMin.y);
    const clipMax = new ImGui.ImVec2(rectMax.x - style.FramePadding.x, rectMax.y);
    drawList.PushClipRect(clipMin, clipMax, true);
    drawList.AddText(textPos, textColor, text ?? '');
    drawList.PopClipRect();
    const textWidth = ImGui.CalcTextSize(text ?? '').x;
    const availableWidth = Math.max(0, clipMax.x - clipMin.x);
    if (hovered && text && textWidth > availableWidth) {
      ImGui.SetTooltip(text);
    }
    return clicked;
  }
  private pushInlineActionButtonStyle() {
    const style = ImGui.GetStyle();
    const normal = style.Colors[ImGui.Col.FrameBg];
    const hovered = style.Colors[ImGui.Col.FrameBgHovered];
    const active = style.Colors[ImGui.Col.FrameBgActive];
    ImGui.PushStyleColor(ImGui.Col.Button, new ImGui.ImVec4(normal.x, normal.y, normal.z, 1));
    ImGui.PushStyleColor(ImGui.Col.ButtonHovered, new ImGui.ImVec4(hovered.x, hovered.y, hovered.z, 1));
    ImGui.PushStyleColor(ImGui.Col.ButtonActive, new ImGui.ImVec4(active.x, active.y, active.z, 1));
    ImGui.PushStyleVar(ImGui.StyleVar.FrameBorderSize, 1);
  }
  private popInlineActionButtonStyle() {
    ImGui.PopStyleVar();
    ImGui.PopStyleColor(3);
  }
  private setDragDropProperty(obj: any, prop: PropertyAccessor, value: PropertyValue) {
    if (prop.set) {
      if (prop.options?.sceneNode && ImGui.BeginDragDropTarget()) {
        const peekPayload = ImGui.AcceptDragDropPayload('NODE', ImGui.DragDropFlags.AcceptBeforeDelivery);
        if (peekPayload) {
          const data = peekPayload.Data as SceneNode;
          if (
            data instanceof SceneNode &&
            (!prop.options.sceneNode.kind || prop.options.sceneNode.kind === 'node' || data.isMesh?.())
          ) {
            const payload = ImGui.AcceptDragDropPayload('NODE');
            if (payload) {
              const dropped = payload.Data as unknown;
              if (dropped instanceof SceneNode) {
                value.str[0] = dropped?.persistentId ?? '';
                Promise.resolve(prop.set.call(obj, value as RequireOptionals<PropertyValue>)).then(() => {
                  this.invalidateRows();
                  this.dispatchEvent('object_property_changed', obj, prop);
                });
              }
            }
          }
        }
        ImGui.EndDragDropTarget();
      }
      if (prop.options?.mimeTypes?.length > 0 && ImGui.BeginDragDropTarget()) {
        const peekPayload = ImGui.AcceptDragDropPayload('ASSET', ImGui.DragDropFlags.AcceptBeforeDelivery);
        if (peekPayload) {
          const data = peekPayload.Data as { isDir: boolean; path: string }[];
          if (data.length === 1 && !data[0].isDir) {
            const mimeType = ProjectService.VFS.guessMIMEType(data[0].path);
            if (matchesMimeType(prop.options.mimeTypes, mimeType)) {
              const payload = ImGui.AcceptDragDropPayload('ASSET');
              if (payload) {
                value.str[0] = data[0].path;
                Promise.resolve(prop.set.call(obj, value as RequireOptionals<PropertyValue>)).then(() => {
                  this.invalidateRows();
                  this.dispatchEvent('object_property_changed', obj, prop);
                });
              }
            }
          }
        }
        ImGui.EndDragDropTarget();
      }
    }
  }
}
