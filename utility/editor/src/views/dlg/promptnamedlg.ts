import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';

export class DlgPromptName extends DialogRenderer<string> {
  private _name: string;
  private _hint: string;
  public static async promptName(
    title: string,
    hint?: string,
    defaultName?: string,
    width?: number
  ): Promise<string> {
    return new DlgPromptName(title, defaultName, hint, width).showModal();
  }
  constructor(id: string, defaultName: string, hint: string, width = 300) {
    super(id, width, 0, true, true);
    this._name = defaultName ?? '';
    this._hint = hint ?? '';
  }
  doRender(): void {
    const name = [this._name] as [string];
    ImGui.SetKeyboardFocusHere();
    if (ImGui.InputText(this._hint, name, undefined, ImGui.InputTextFlags.AutoSelectAll)) {
      this._name = name[0];
    }
    ImGui.Button('Ok');
    if (ImGui.IsItemHovered() && ImGui.IsMouseReleased(0)) {
      this.close(this._name);
    }
    ImGui.SameLine();
    ImGui.Button('Cancel');
    if (ImGui.IsItemHovered() && ImGui.IsMouseReleased(0)) {
      this.close('');
    }
  }
}
