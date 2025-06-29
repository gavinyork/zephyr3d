import { makeEventTarget } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';

export class ModalDialog extends makeEventTarget(Object)<{
  opened: [];
  closed: [];
}>() {
  private static _currentDlg: ModalDialog = null;
  private _id: string;
  private _size: ImGui.ImVec2;
  private _mask: boolean;
  private _noResize: boolean;
  static render() {
    if (this._currentDlg) {
      this._currentDlg.render();
    }
  }
  constructor(id: string, open: boolean, width = 0, height = 0, mask = true, noResize = false) {
    super();
    this._id = id;
    this._mask = mask;
    this._size = new ImGui.ImVec2(width, height);
    this._noResize = !!noResize;
    if (open) {
      this.open();
    }
  }
  get mask() {
    return this._mask;
  }
  get id() {
    return this._id;
  }
  set id(value) {
    this._id = value;
  }
  get width() {
    return this._size.x;
  }
  set width(value: number) {
    this._size.x = value;
  }
  get height() {
    return this._size.y;
  }
  set height(value: number) {
    this._size.y = value;
  }
  open() {
    if (ModalDialog._currentDlg) {
      console.error('Only one modal dialog should be opened');
      return;
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
    ImGui.SetNextWindowSize(this._size, this._noResize ? ImGui.Cond.Always : ImGui.Cond.FirstUseEver);
    ImGui.OpenPopup(this._id);
    if (!this._mask) {
      ImGui.PushStyleColor(ImGui.Col.ModalWindowDimBg, new ImGui.ImVec4(0, 0, 0, 0));
    }
    if (ImGui.BeginPopupModal(this._id, null, this._noResize ? ImGui.WindowFlags.NoResize : undefined)) {
      ImGui.PushID(this._id);
      this.doRender();
      ImGui.PopID();
      ImGui.EndPopup();
    }
    if (!this._mask) {
      ImGui.PopStyleColor(1);
    }
  }
  doRender() {}
}
