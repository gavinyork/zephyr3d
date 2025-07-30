import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';

export class DlgMessageBoxEx extends DialogRenderer<string> {
  private _text: string;
  private _buttons: string[];
  public static async messageBoxEx(
    title: string,
    message: string,
    buttons?: string[],
    width?: number,
    height?: number
  ) {
    return new DlgMessageBoxEx(title, message, buttons, width, height).showModal();
  }
  constructor(id?: string, message?: string, buttons?: string[], width?: number, height?: number) {
    super(id ?? 'MessageBox', width ?? 300, height ?? 0);
    this._text = message ?? '';
    this._buttons = buttons ? buttons.slice() : ['Ok'];
  }
  get text() {
    return this._text;
  }
  set text(val) {
    this._text = val;
  }
  doRender(): void {
    ImGui.TextWrapped(this._text);
    for (const btn of this._buttons) {
      if (ImGui.Button(btn)) {
        this.close(btn);
      }
      ImGui.SameLine();
    }
  }
}
