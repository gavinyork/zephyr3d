import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';

export class DlgPromptName extends DialogRenderer<string> {
  private _hint: string;
  private readonly _label: string;
  public static async promptName(
    title: string,
    label?: string,
    hint?: string,
    width?: number
  ): Promise<string> {
    return new DlgPromptName(title, hint, label, width).showModal();
  }
  constructor(id: string, hint: string, label: string, width = 300) {
    super(id, width, 0, true, true);
    this._hint = hint ?? '';
    this._label = label ?? '';
  }
  doRender(): void {
    const name = [''] as [string];
    ImGui.SetKeyboardFocusHere();
    if (
      ImGui.InputTextWithHint(
        this._label,
        this._hint ?? '',
        name,
        undefined,
        ImGui.InputTextFlags.AutoSelectAll
      )
    ) {
      this._hint = name[0];
    }
    ImGui.Button('Ok');
    if (ImGui.IsItemHovered() && ImGui.IsMouseReleased(0)) {
      this.close(this._hint);
    }
    ImGui.SameLine();
    ImGui.Button('Cancel');
    if (ImGui.IsItemHovered() && ImGui.IsMouseReleased(0)) {
      this.close('');
    }
  }
}
