import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';

export class DlgOpen extends DialogRenderer<string> {
  private readonly _names: string[];
  private readonly _ids: string[];
  private _selected: [number];
  public static async openFromList(
    title: string,
    names: string[],
    ids: string[],
    width?: number,
    height?: number
  ): Promise<string> {
    return new DlgOpen(title, names, ids, width, height).showModal();
  }
  constructor(id: string, names: string[], ids: string[], width: number, height: number) {
    super(id, width, height);
    this._names = names.slice();
    this._ids = ids.slice();
    this._selected = [0];
  }
  doRender(): void {
    if (ImGui.BeginChild('ListBox', new ImGui.ImVec2(0, -ImGui.GetFrameHeightWithSpacing()), true)) {
      if (ImGui.ListBoxHeader('ListBoxHeader', new ImGui.ImVec2(-1, -1))) {
        for (let i = 0; i < this._ids.length; i++) {
          if (ImGui.Selectable(this._names[i], this._selected[0] === i)) {
            this._selected[0] = i;
          }
        }
        ImGui.ListBoxFooter();
      }
    }
    ImGui.EndChild();
    if (ImGui.Button('Open')) {
      if (this._selected[0] >= 0 && this._selected[0] < this._ids.length) {
        this.close(this._ids[this._selected[0]]);
      }
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this.close('');
    }
  }
}
