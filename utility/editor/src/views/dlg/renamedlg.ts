import { ImGui } from '@zephyr3d/imgui';
import { ModalDialog } from '../../components/modal';

export class DlgRename extends ModalDialog {
  private _name: string;
  private _firstOpen: boolean;
  private _resolve: (s: string) => void;
  constructor(id: string, open: boolean, width: number, name: string, resolve: (s: string) => void) {
    super(id, open, width, 0);
    this._name = name;
    this._resolve = resolve;
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
        this._resolve(this._name);
        this.close();
      }
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this._resolve('');
      this.close();
    }
  }
}
