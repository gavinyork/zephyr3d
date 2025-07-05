import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';

export class DlgMessage extends DialogRenderer<void> {
  private _text: string;
  constructor(id?: string, message?: string, width?: number, height?: number) {
    super(id ?? 'MessageBox', width ?? 300, height ?? 0);
    this._text = message ?? '';
  }
  get text() {
    return this._text;
  }
  set text(val) {
    this._text = val;
  }
  doRender(): void {
    ImGui.TextWrapped(this._text);
    if (ImGui.Button('OK')) {
      this.close();
    }
  }
}
