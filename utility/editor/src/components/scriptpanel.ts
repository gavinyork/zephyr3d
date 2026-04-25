import { ImGui } from '@zephyr3d/imgui';
import type { Nullable } from '@zephyr3d/base';
import { Scene, SceneNode, ScriptAttachment, type PropertyAccessor } from '@zephyr3d/scene';
import { FontGlyph } from '../core/fontglyph';
import { ProjectService } from '../core/services/project';
import { PropertyEditor } from './grid';
import { clearScriptPropertyAccessorCache, getSingleScriptPropertyAccessors } from '../helpers/scriptprops';

type PropertySnapshot = {
  num: number[];
  str: string[];
  bool: boolean[];
  object: object[];
};

type ScriptConfigEditorHost = {
  scriptHost: Scene | SceneNode;
  scriptPath: string;
};

export type ScriptPanelOptions = {
  onPropertyChanged?: (object: object, prop: PropertyAccessor) => void;
  onPropertyEditFinished?: (
    object: Nullable<object>,
    prop: PropertyAccessor,
    oldValue: PropertySnapshot,
    newValue: PropertySnapshot
  ) => void;
  onSceneChanged?: () => void;
  onRefreshMainProperties?: () => void;
  getSelectedAssetPath?: () => Nullable<string>;
};

export class ScriptPanel {
  private readonly _scriptConfigGrid: PropertyEditor;
  private readonly _options: ScriptPanelOptions;
  private _host: Nullable<Scene | SceneNode>;
  private _height: number;
  private _selectedScriptIndex: number;
  private _scriptConfigEditorHost: Nullable<ScriptConfigEditorHost>;

  constructor(options: ScriptPanelOptions = {}) {
    this._options = options;
    this._scriptConfigGrid = new PropertyEditor(0.4);
    this._scriptConfigGrid.showLeadingColumn = false;
    this._host = null;
    this._height = 260;
    this._selectedScriptIndex = 0;
    this._scriptConfigEditorHost = null;
    this._scriptConfigGrid.on('object_property_changed', this.handleScriptConfigPropertyChanged, this);
    this._scriptConfigGrid.on(
      'object_property_edit_finished',
      this.handleScriptConfigPropertyEditFinished,
      this
    );
  }

  get height() {
    return this._height;
  }
  set height(value: number) {
    this._height = value;
  }

  get host() {
    return this._host;
  }
  set host(value: Nullable<Scene | SceneNode>) {
    this._host = value;
    this._selectedScriptIndex = 0;
    this.syncScriptConfigEditor();
  }

  notifyScriptStructureChanged() {
    clearScriptPropertyAccessorCache();
    this.syncScriptConfigEditor();
    this._options.onRefreshMainProperties?.();
  }

  clear() {
    this._host = null;
    this._selectedScriptIndex = 0;
    this._scriptConfigEditorHost = null;
    this._scriptConfigGrid.object = null;
    this._scriptConfigGrid.clear();
  }

  render() {
    const host = this._host;
    ImGui.Text('Scripts');
    if (!host) {
      ImGui.Separator();
      ImGui.TextDisabled('Select a scene or node to edit scripts');
      return;
    }
    const attachments = this.getScriptAttachments(host);
    ImGui.Separator();
    if (attachments.length === 0) {
      ImGui.TextDisabled('No scripts attached');
    }
    if (attachments.length > 0 && ImGui.BeginTable('##ScriptList', 2, ImGui.TableFlags.SizingStretchProp)) {
      const buttonWidth = ImGui.GetFrameHeight();
      const actionColumnWidth = buttonWidth * 3 + ImGui.GetStyle().ItemSpacing.x * 2;
      ImGui.TableSetupColumn('Script', ImGui.TableColumnFlags.WidthStretch);
      ImGui.TableSetupColumn('Action', ImGui.TableColumnFlags.WidthFixed, actionColumnWidth);
      for (let i = 0; i < attachments.length; i++) {
        const attachment = attachments[i];
        const selected = i === this._selectedScriptIndex;
        ImGui.TableNextRow();
        ImGui.TableNextColumn();
        const clicked = this.renderScriptListItem(`##script_item_${i}`, attachment.script || '<Empty Script>', selected);
        if (clicked) {
          this._selectedScriptIndex = i;
          this.syncScriptConfigEditor();
        }
        ImGui.TableNextColumn();
        this.pushInlineActionButtonStyle();
        if (i > 0) {
          if (ImGui.Button(`⬆##move_script_up_${i}`, new ImGui.ImVec2(buttonWidth, 0))) {
            this.moveScriptAttachment(host, i, -1);
            this.popInlineActionButtonStyle();
            ImGui.EndTable();
            return;
          }
        } else {
          ImGui.PushStyleVar(ImGui.StyleVar.Alpha, ImGui.GetStyle().Alpha * 0.5);
          ImGui.Button(`⬆##move_script_up_${i}`, new ImGui.ImVec2(buttonWidth, 0));
          ImGui.PopStyleVar();
        }
        ImGui.SameLine();
        if (i < attachments.length - 1) {
          if (ImGui.Button(`⬇##move_script_down_${i}`, new ImGui.ImVec2(buttonWidth, 0))) {
            this.moveScriptAttachment(host, i, 1);
            this.popInlineActionButtonStyle();
            ImGui.EndTable();
            return;
          }
        } else {
          ImGui.PushStyleVar(ImGui.StyleVar.Alpha, ImGui.GetStyle().Alpha * 0.5);
          ImGui.Button(`⬇##move_script_down_${i}`, new ImGui.ImVec2(buttonWidth, 0));
          ImGui.PopStyleVar();
        }
        ImGui.SameLine();
        if (ImGui.Button(`${FontGlyph.glyphs['cancel']}##remove_script_${i}`, new ImGui.ImVec2(buttonWidth, 0))) {
          this.popInlineActionButtonStyle();
          this.removeScriptAttachment(host, i);
          ImGui.EndTable();
          return;
        }
        this.popInlineActionButtonStyle();
      }
      ImGui.EndTable();
    }
    ImGui.Separator();
    if (this.renderScriptDropTarget(host)) {
      return;
    }
    if (attachments.length > 0) {
      ImGui.Separator();
      ImGui.Text('Config');
      this._scriptConfigGrid.render();
      if (!attachments[this._selectedScriptIndex]?.script) {
        ImGui.TextDisabled('Select a valid script to edit config');
      }
    }
  }

  private getScriptAttachments(host: Scene | SceneNode) {
    return Array.isArray((host as any).scripts) ? ((host as any).scripts as ScriptAttachment[]) : [];
  }

  private syncScriptConfigEditor() {
    const host = this._host;
    const attachments = host ? this.getScriptAttachments(host) : [];
    if (attachments.length === 0) {
      this._selectedScriptIndex = 0;
      this._scriptConfigEditorHost = null;
      this._scriptConfigGrid.object = null;
      this._scriptConfigGrid.clear();
      return;
    }
    this._selectedScriptIndex = Math.max(0, Math.min(this._selectedScriptIndex, attachments.length - 1));
    const attachment = attachments[this._selectedScriptIndex];
    this._scriptConfigEditorHost = attachment?.script ? { scriptHost: host!, scriptPath: attachment.script } : null;
    this._scriptConfigGrid.object = this._scriptConfigEditorHost;
    this._scriptConfigGrid.setExtraPropertiesProvider(
      'script-config',
      this._scriptConfigEditorHost
        ? async (object) =>
            object === this._scriptConfigEditorHost
              ? this.bindScriptPropertyAccessors(
                  this._scriptConfigEditorHost.scriptHost,
                  await getSingleScriptPropertyAccessors(
                    this._scriptConfigEditorHost.scriptHost,
                    this._scriptConfigEditorHost.scriptPath,
                    this._selectedScriptIndex
                  )
                )
              : []
        : null
    );
    this._scriptConfigGrid.refresh();
  }

  private bindScriptPropertyAccessors(host: Scene | SceneNode, accessors: PropertyAccessor<any>[]) {
    return accessors.map((prop) => ({
      ...prop,
      get: prop.get ? ((value) => prop.get!.call(host as never, value as never)) as typeof prop.get : undefined,
      set: prop.set
        ? ((value, index) => prop.set!.call(host as never, value as never, index)) as typeof prop.set
        : undefined,
      create: prop.create ? ((ctor, index) => prop.create!.call(host as never, ctor, index)) : undefined,
      delete: prop.delete ? ((index) => prop.delete!.call(host as never, index)) : undefined,
      add: prop.add
        ? ((value, index) => prop.add!.call(host as never, value as never, index)) as typeof prop.add
        : undefined,
      isValid: prop.isValid ? (() => prop.isValid!.call(host as never)) : undefined,
      isPersistent: prop.isPersistent ? (() => prop.isPersistent!.call(host as never)) : undefined,
      isNullable: prop.isNullable ? ((index) => prop.isNullable!.call(host as never, index)) : undefined,
      isHidden: prop.isHidden
        ? ((index, obj) => prop.isHidden!.call(host as never, index, obj)) as typeof prop.isHidden
        : undefined,
      command: prop.command ? ((index) => prop.command!.call(host as never, index)) : undefined,
      getDefaultValue: prop.getDefaultValue ? (() => prop.getDefaultValue!.call(host as never)) : undefined
    }));
  }

  private appendScriptAttachment(host: Scene | SceneNode, path: string) {
    if (!path) {
      return;
    }
    const attachments = [...this.getScriptAttachments(host)];
    attachments.push(new ScriptAttachment(path, null));
    (host as any).scripts = attachments;
    this._selectedScriptIndex = attachments.length - 1;
    this.notifyScriptStructureChanged();
    this._options.onSceneChanged?.();
  }

  private removeScriptAttachment(host: Scene | SceneNode, index: number) {
    const attachments = [...this.getScriptAttachments(host)];
    if (index < 0 || index >= attachments.length) {
      return;
    }
    attachments.splice(index, 1);
    (host as any).scripts = attachments;
    this._selectedScriptIndex = Math.max(0, Math.min(this._selectedScriptIndex, attachments.length - 1));
    this.notifyScriptStructureChanged();
    this._options.onSceneChanged?.();
  }

  private moveScriptAttachment(host: Scene | SceneNode, index: number, direction: -1 | 1) {
    const attachments = [...this.getScriptAttachments(host)];
    const targetIndex = index + direction;
    if (index < 0 || index >= attachments.length || targetIndex < 0 || targetIndex >= attachments.length) {
      return;
    }
    const [item] = attachments.splice(index, 1);
    attachments.splice(targetIndex, 0, item);
    (host as any).scripts = attachments;
    this.notifyScriptStructureChanged();
    this._options.onSceneChanged?.();
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

  private renderScriptListItem(id: string, text: string, selected: boolean) {
    const style = ImGui.GetStyle();
    const size = new ImGui.ImVec2(ImGui.GetContentRegionAvail().x, ImGui.GetFrameHeight());
    const clicked = ImGui.InvisibleButton(id, size, 0);
    const hovered = ImGui.IsItemHovered();
    const drawList = ImGui.GetWindowDrawList();
    const rectMin = ImGui.GetItemRectMin();
    const rectMax = ImGui.GetItemRectMax();
    const bgColor = ImGui.GetColorU32(
      selected
        ? hovered
          ? ImGui.Col.HeaderHovered
          : ImGui.Col.Header
        : hovered
          ? ImGui.Col.FrameBgHovered
          : ImGui.Col.FrameBg
    );
    const borderColor = ImGui.GetColorU32(selected ? ImGui.Col.HeaderActive : ImGui.Col.Border);
    const textColor = ImGui.GetColorU32(ImGui.Col.Text);
    drawList.AddRectFilled(rectMin, rectMax, bgColor, style.FrameRounding);
    drawList.AddRect(rectMin, rectMax, borderColor, style.FrameRounding, ImGui.DrawCornerFlags.None, 1);
    const textPos = new ImGui.ImVec2(rectMin.x + style.FramePadding.x, rectMin.y + style.FramePadding.y);
    const clipMin = new ImGui.ImVec2(rectMin.x + style.FramePadding.x, rectMin.y);
    const clipMax = new ImGui.ImVec2(rectMax.x - style.FramePadding.x, rectMax.y);
    drawList.PushClipRect(clipMin, clipMax, true);
    drawList.AddText(textPos, textColor, text);
    drawList.PopClipRect();
    const textWidth = ImGui.CalcTextSize(text).x;
    const availableWidth = Math.max(0, clipMax.x - clipMin.x);
    if (hovered && textWidth > availableWidth) {
      ImGui.SetTooltip(text);
    }
    return clicked;
  }

  private renderScriptDropTarget(host: Scene | SceneNode) {
    const style = ImGui.GetStyle();
    const size = new ImGui.ImVec2(ImGui.GetContentRegionAvail().x, ImGui.GetFrameHeight());
    ImGui.InvisibleButton('##script_drop_target', size, 0);
    const hovered = ImGui.IsItemHovered();
    const drawList = ImGui.GetWindowDrawList();
    const rectMin = ImGui.GetItemRectMin();
    const rectMax = ImGui.GetItemRectMax();
    const bgColor = ImGui.GetColorU32(hovered ? ImGui.Col.FrameBgHovered : ImGui.Col.FrameBg);
    const borderColor = ImGui.GetColorU32(ImGui.Col.Border);
    const textColor = ImGui.GetColorU32(ImGui.Col.TextDisabled);
    drawList.AddRectFilled(rectMin, rectMax, bgColor, style.FrameRounding);
    drawList.AddRect(rectMin, rectMax, borderColor, style.FrameRounding, ImGui.DrawCornerFlags.None, 1);
    const hint = 'Drop a script here to attach';
    const textSize = ImGui.CalcTextSize(hint);
    drawList.AddText(
      new ImGui.ImVec2(
        rectMin.x + Math.max(style.FramePadding.x, (size.x - textSize.x) * 0.5),
        rectMin.y + style.FramePadding.y
      ),
      textColor,
      hint
    );

    if (ImGui.BeginDragDropTarget()) {
      const peekPayload = ImGui.AcceptDragDropPayload('ASSET', ImGui.DragDropFlags.AcceptBeforeDelivery);
      if (peekPayload) {
        const data = peekPayload.Data as { isDir: boolean; path: string }[];
        if (data.length === 1 && !data[0].isDir) {
          const mimeType = ProjectService.VFS.guessMIMEType(data[0].path);
          if (mimeType === 'text/x-typescript' || mimeType === 'text/javascript') {
            const payload = ImGui.AcceptDragDropPayload('ASSET');
            if (payload) {
              this.appendScriptAttachment(host, data[0].path);
              ImGui.EndDragDropTarget();
              return true;
            }
          }
        }
      }
      ImGui.EndDragDropTarget();
    }
    return false;
  }

  private handleScriptConfigPropertyChanged(_object: object, prop: PropertyAccessor) {
    const host = this._scriptConfigEditorHost?.scriptHost;
    if (!host) {
      return;
    }
    this._options.onPropertyChanged?.(host, prop);
  }

  private handleScriptConfigPropertyEditFinished(
    _object: Nullable<object>,
    prop: PropertyAccessor,
    oldValue: PropertySnapshot,
    newValue: PropertySnapshot
  ) {
    const host = this._scriptConfigEditorHost?.scriptHost;
    if (!host) {
      return;
    }
    this._options.onPropertyEditFinished?.(host, prop, oldValue, newValue);
  }
}
