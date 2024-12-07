import { ImGui } from '@zephyr3d/imgui';

export class ModalDialog {
  private static _currentDlg: ModalDialog = null;
  private _id: string;
  static render() {
    if (this._currentDlg) {
      this._currentDlg.render();
    }
  }
  constructor(id: string, open: boolean) {
    this._id = id;
    if (open) {
      this.open();
    }
  }
  open() {
    if (ModalDialog._currentDlg) {
      throw new Error('Only one modal dialog should be opened');
    }
    ModalDialog._currentDlg = this;
  }
  close() {
    if (ModalDialog._currentDlg !== this) {
      throw new Error('Cannot close modal dialog');
    }
    ModalDialog._currentDlg = null;
  }
  render() {
    if (ModalDialog._currentDlg !== this) {
      return;
    }
    ImGui.OpenPopup(this._id);
    if (ImGui.BeginPopupModal(this._id, null, ImGui.WindowFlags.AlwaysAutoResize)) {
      this.doRender();
      ImGui.EndPopup();
    }
  }
  doRender() {}
}
