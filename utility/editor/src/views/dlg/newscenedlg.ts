import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';

export class DlgPromptName extends DialogRenderer<string> {
  private _sceneName: string;
  constructor(id: string, defaultName: string, width: number, height: number) {
    super(id, width, height);
    this._sceneName = defaultName ?? '';
  }
  doRender(): void {
    const name = [this._sceneName] as [string];
    ImGui.SetKeyboardFocusHere();
    if (ImGui.InputText('Scene Name', name, undefined, ImGui.InputTextFlags.AutoSelectAll)) {
      this._sceneName = name[0];
    }
    ImGui.Button('Save');
    if (ImGui.IsItemHovered() && ImGui.IsMouseReleased(0)) {
      this.close(this._sceneName);
    }
    ImGui.SameLine();
    ImGui.Button('Cancel');
    if (ImGui.IsItemHovered() && ImGui.IsMouseReleased(0)) {
      this.close('');
    }
  }
}
