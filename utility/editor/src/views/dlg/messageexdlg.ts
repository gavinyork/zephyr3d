import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';

export class DlgMessageBoxEx extends DialogRenderer {
  private _text: string;
  private _buttons: string[];
  private _resolve: (val: string) => void;
  constructor(
    id?: string,
    message?: string,
    buttons?: string[],
    width?: number,
    height?: number,
    resolve?: (val: string) => void
  ) {
    super(id ?? 'MessageBox', width ?? 300, height ?? 0);
    this._text = message ?? '';
    this._buttons = buttons ? buttons.slice() : ['Ok'];
    this._resolve = resolve;
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
        this._resolve?.(btn);
        this.close();
      }
      ImGui.SameLine();
    }
  }
}
