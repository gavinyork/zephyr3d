import { ImGui } from '@zephyr3d/imgui';
import { MenubarView } from '@zephyr3d/inspector';
import { BaseView } from './baseview';
import { BaseModel } from '../models/basemodel';

export class EmptyView<T extends BaseModel> extends BaseView<T> {
  private _menubar: MenubarView;
  private _bgColor: ImGui.ImVec4;
  private _zeroPadding: ImGui.ImVec2;
  private _windowPos: ImGui.ImVec2;
  private _windowSize: ImGui.ImVec2;
  constructor() {
    super(null);
    this._menubar = new MenubarView({
      items: [
        {
          label: 'File',
          subMenus: [
            {
              label: 'New',
              subMenus: [
                {
                  label: 'Scene',
                  id: 'NEW_DOC'
                }
              ]
            },
            {
              label: 'Open',
              id: 'OPEN_DOC'
            },
            {
              label: 'Save',
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
  }
  get menubar() {
    return this._menubar;
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
    ImGui.Begin(
      '##Background',
      null,
      ImGui.WindowFlags.NoTitleBar |
        ImGui.WindowFlags.NoBringToFrontOnFocus |
        ImGui.WindowFlags.NoCollapse |
        ImGui.WindowFlags.NoDecoration |
        ImGui.WindowFlags.NoScrollbar |
        ImGui.WindowFlags.NoScrollWithMouse |
        ImGui.WindowFlags.NoMouseInputs |
        ImGui.WindowFlags.NoMove |
        ImGui.WindowFlags.NoResize
    );
    ImGui.End();
    ImGui.PopStyleColor();
    ImGui.PopStyleVar(2);
    this.renderMenubar();
  }
  protected renderMenubar() {
    this._menubar.render();
  }
}
