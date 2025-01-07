import { ImGui } from '@zephyr3d/imgui';
import { ModalDialog } from '../../components/modal';

export class DlgMessage extends ModalDialog {
  private _text: string;
  constructor(id?: string, message?: string, open?: boolean, width?: number, height?: number) {
    super(id ?? 'MessageBox', open ?? true, width ?? 300, height ?? 0);
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
