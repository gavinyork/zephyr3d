import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';

export class DlgRename extends DialogRenderer<string> {
  private _name: string;
  private _firstOpen: boolean;
  constructor(id: string, width: number, name: string) {
    super(id, width, 0);
    this._name = name;
    this._firstOpen = true;
  }
  doRender(): void {
    const text = [this._name] as [string];
    if (this._firstOpen) {
      ImGui.SetKeyboardFocusHere();
      this._firstOpen = false;
    }
    ImGui.PushItemWidth(ImGui.GetContentRegionAvail().x);
    if (ImGui.InputText('###Rename', text, undefined, ImGui.InputTextFlags.AutoSelectAll)) {
      this._name = text[0];
    }
    ImGui.PopItemWidth();
    if (ImGui.Button('Ok')) {
      if (this._name) {
        this.close(this._name);
      }
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this.close('');
    }
  }
}
