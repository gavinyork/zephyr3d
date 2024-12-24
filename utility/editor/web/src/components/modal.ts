import { makeEventTarget } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';

export class ModalDialog extends makeEventTarget(Object)<{
  opened: [];
  closed: [];
}>() {
  private static _currentDlg: ModalDialog = null;
  private _id: string;
  private _width: number;
  static render() {
    if (this._currentDlg) {
      this._currentDlg.render();
    }
  }
  constructor(id: string, open: boolean, width = 0) {
    super();
    this._id = id;
    this._width = width;
    if (open) {
      this.open();
    }
  }
  get id() {
    return this._id;
  }
  set id(value) {
    this._id = value;
  }
  get width() {
    return this._width;
  }
  set width(value: number) {
    this._width = value;
  }
  open() {
    if (ModalDialog._currentDlg) {
      throw new Error('Only one modal dialog should be opened');
    }
    ModalDialog._currentDlg = this;
    this.dispatchEvent('opened');
  }
  close() {
    if (ModalDialog._currentDlg !== this) {
      throw new Error('Cannot close modal dialog');
    }
    ModalDialog._currentDlg = null;
    this.dispatchEvent('closed');
  }
  render() {
    if (ModalDialog._currentDlg !== this) {
      return;
    }
    if (this._width !== 0) {
      ImGui.SetNextWindowSize(new ImGui.ImVec2(this._width, 0));
    }
    ImGui.OpenPopup(this._id);
    if (ImGui.BeginPopupModal(this._id, null, ImGui.WindowFlags.AlwaysAutoResize)) {
      this.doRender();
      ImGui.EndPopup();
    }
  }
  doRender() {}
}
