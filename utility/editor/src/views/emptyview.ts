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
  private _zeroPadding: ImGui.ImVec2;
  private _windowPos: ImGui.ImVec2;
  private _windowSize: ImGui.ImVec2;
  private _drawBackground: boolean;
  private _baseFlags: number;
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
  get statusbar() {
    return this._statusbar;
  }
  get bgColor() {
    return this._bgColor;
  }
  render() {
    if (this._drawBackground) {
      const displaySize = ImGui.GetIO().DisplaySize;
      ImGui.PushStyleColor(ImGui.Col.WindowBg, this._bgColor);
      ImGui.PushStyleVar(ImGui.StyleVar.WindowPadding, this._zeroPadding);
      ImGui.PushStyleVar(ImGui.StyleVar.WindowBorderSize, 0);
      this._windowPos.Set(0, 0);
      this._windowSize.Set(displaySize.x, displaySize.y);
      ImGui.SetNextWindowPos(this._windowPos);
      ImGui.SetNextWindowSize(this._windowSize);
      ImGui.Begin('##Background', null, this._baseFlags);
      ImGui.End();
      ImGui.PopStyleColor();
      ImGui.PopStyleVar(2);
    }
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
