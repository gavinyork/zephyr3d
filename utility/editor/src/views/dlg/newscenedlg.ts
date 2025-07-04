import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';

export class DlgPromptName extends DialogRenderer {
  private _sceneName: string;
  private _resolve: (s: string) => void;
  constructor(id: string, defaultName: string, width: number, height: number, resolve: (s: string) => void) {
    super(id, width, height);
    this._sceneName = defaultName ?? '';
    this._resolve = resolve;
  }
  doRender(): void {
    const name = [this._sceneName] as [string];
    ImGui.SetKeyboardFocusHere();
    if (ImGui.InputText('Scene Name', name, undefined, ImGui.InputTextFlags.AutoSelectAll)) {
      this._sceneName = name[0];
    }
    ImGui.Button('Save');
    if (ImGui.IsItemHovered() && ImGui.IsMouseReleased(0)) {
      this._resolve(this._sceneName);
      this.close();
    }
    ImGui.SameLine();
    ImGui.Button('Cancel');
    if (ImGui.IsItemHovered() && ImGui.IsMouseReleased(0)) {
      this._resolve('');
      this.close();
    }
  }
}
