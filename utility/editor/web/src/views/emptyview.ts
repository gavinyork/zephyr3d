import { ImGui } from '@zephyr3d/imgui';
import { BaseView } from './baseview';
import type { BaseModel } from '../models/basemodel';
import { eventBus } from '../core/eventbus';
import { MenubarView } from '../components/menubar';
import { StatusBar } from '../components/statusbar';

export class EmptyView<T extends BaseModel> extends BaseView<T> {
  private _menubar: MenubarView;
  private _statusbar: StatusBar;
  private _bgColor: ImGui.ImVec4;
  private _transColor: ImGui.ImVec4;
  private _zeroPadding: ImGui.ImVec2;
  private _windowPos: ImGui.ImVec2;
  private _windowSize: ImGui.ImVec2;
  private _drawBackground: boolean;
  private _baseFlags: number;
  private _dragDropTypes: string[];
  constructor(model: T) {
    super(model);
    this._drawBackground = true;
    this._statusbar = new StatusBar();
    this._menubar = new MenubarView({
      items: [
        {
          label: `File`,
          subMenus: [
            {
              label: 'New',
              subMenus: [
                {
                  label: 'Scene',
                  id: 'NEW_SCENE'
                }
              ]
            },
            {
              label: 'Open',
              shortCut: 'Ctrl+O',
              id: 'OPEN_DOC'
            },
            {
              label: 'Save',
              shortCut: 'Ctrl+S',
              id: 'SAVE_DOC'
            },
            {
              label: 'Close',
              id: 'CLOSE_DOC'
            }
          ]
        }
      ]
    });
    this._bgColor = new ImGui.ImVec4(0.2, 0.2, 0.2, 1);
    this._transColor = new ImGui.ImVec4(0, 0, 0, 0);
    this._zeroPadding = new ImGui.ImVec2(0, 0);
    this._windowPos = new ImGui.ImVec2();
    this._windowSize = new ImGui.ImVec2();
    this._baseFlags =
      ImGui.WindowFlags.NoTitleBar |
      ImGui.WindowFlags.NoBringToFrontOnFocus |
      ImGui.WindowFlags.NoCollapse |
      ImGui.WindowFlags.NoDecoration |
      ImGui.WindowFlags.NoScrollbar |
      ImGui.WindowFlags.NoScrollWithMouse |
      ImGui.WindowFlags.NoMove |
      ImGui.WindowFlags.NoResize;
    this._dragDropTypes = [];
  }
  get menubar() {
    return this._menubar;
  }
  get drawBackground() {
    return this._drawBackground;
  }
  set drawBackground(value: boolean) {
    this._drawBackground = value;
  }
  get dragDropTypes() {
    return this._dragDropTypes;
  }
  set dragDropTypes(val) {
    this._dragDropTypes = val;
  }
  get statusbar() {
    return this._statusbar;
  }
  get bgColor() {
    return this._bgColor;
  }
  render() {
    const displaySize = ImGui.GetIO().DisplaySize;
    ImGui.PushStyleColor(ImGui.Col.WindowBg, this._bgColor);
    ImGui.PushStyleVar(ImGui.StyleVar.WindowPadding, this._zeroPadding);
    ImGui.PushStyleVar(ImGui.StyleVar.WindowBorderSize, 0);
    this._windowPos.Set(0, 0);
    this._windowSize.Set(displaySize.x, displaySize.y);
    ImGui.SetNextWindowPos(this._windowPos);
    ImGui.SetNextWindowSize(this._windowSize);
    const dropzone = this._dragDropTypes?.length > 0;
    let flags = this._baseFlags;
    if (!this._drawBackground) {
      flags |= ImGui.WindowFlags.NoBackground;
    }
    if (!dropzone) {
      flags |= ImGui.WindowFlags.NoMouseInputs;
    }
    ImGui.Begin('##Background', null, flags);
    if (this._dragDropTypes?.length > 0) {
      ImGui.BeginChild('##dropzone_container', ImGui.GetContentRegionAvail());
      ImGui.PushStyleColor(ImGui.Col.Header, this._transColor);
      ImGui.PushStyleColor(ImGui.Col.HeaderActive, this._transColor);
      ImGui.PushStyleColor(ImGui.Col.HeaderHovered, this._transColor);
      ImGui.Selectable('##dropzone', false, ImGui.SelectableFlags.Disabled, ImGui.GetContentRegionAvail());
      if (ImGui.BeginDragDropTarget()) {
        for (const type of this._dragDropTypes) {
          const payload = ImGui.AcceptDragDropPayload(type);
          if (payload) {
            eventBus.dispatchEvent('workspace_drag_drop', type, payload.Data);
            break;
          }
        }
        ImGui.EndDragDropTarget();
      }
      ImGui.PopStyleColor(3);
      ImGui.EndChild();
    }
    ImGui.End();
    ImGui.PopStyleColor();
    ImGui.PopStyleVar(2);
    this._menubar.render();
    this._statusbar.render();
  }
  protected onActivate(): void {
    this._menubar.on('action', this.handleFileMenu, this);
  }
  protected onDeactivate(): void {
    this._menubar.off('action', this.handleFileMenu, this);
  }
  private handleFileMenu(action: string) {
    switch (action) {
      case 'NEW_SCENE':
        eventBus.dispatchEvent('action_doc_request_new', 'scene');
        break;
      case 'OPEN_DOC':
        eventBus.dispatchEvent('action_doc_request_open');
        break;
      case 'SAVE_DOC':
        eventBus.dispatchEvent('action_doc_request_save');
        break;
      case 'CLOSE_DOC':
        eventBus.dispatchEvent('action_doc_request_close');
        break;
    }
  }
}
