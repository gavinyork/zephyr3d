import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';

export class DlgMessageBoxEx extends DialogRenderer<string> {
  private _text: string;
  private readonly _buttons: string[];
  public static async messageBoxEx(
    title: string,
    message: string,
    buttons?: string[],
    width?: number,
    height?: number,
    mask?: boolean
  ) {
    return new DlgMessageBoxEx(title, message, buttons, width, height, mask).showModal();
  }
  constructor(
    id?: string,
    message?: string,
    buttons?: string[],
    width?: number,
    height?: number,
    mask?: boolean
  ) {
    super(id ?? 'MessageBox', width ?? 300, height ?? 0, mask);
    this._text = message ?? '';
    this._buttons = buttons ? buttons.slice() : ['Ok'];
  }
  get text() {
    return this._text;
  }
  set text(val) {
    this._text = val;
  }
  get buttons() {
    return this._buttons;
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
