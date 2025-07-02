import { makeEventTarget } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';

export class DialogRenderer extends makeEventTarget(Object)<{
  opened: [];
  closed: [];
}>() {
  private static _currentDodal: DialogRenderer = null;
  private static _modeless: DialogRenderer[] = [];
  private _id: string;
  private _size: ImGui.ImVec2;
  private _mask: boolean;
  private _noResize: boolean;
  static render() {
    for (const dlg of this._modeless) {
      dlg.renderModeless();
    }
    if (this._currentDodal) {
      this._currentDodal.renderModal();
    }
  }
  constructor(id: string, width = 0, height = 0, mask = true, noResize = false) {
    super();
    this._id = id;
    this._mask = mask;
    this._size = new ImGui.ImVec2(width, height);
    this._noResize = !!noResize;
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
  show() {
    if (DialogRenderer._currentDodal === this) {
      console.error('Dialog was already opened as modal dialog');
      return;
    }
    let index = DialogRenderer._modeless.indexOf(this);
    if (index < 0) {
      DialogRenderer._modeless.push(this);
    }
    this.dispatchEvent('opened');
  }
  showModal() {
    if (DialogRenderer._modeless.indexOf(this) >= 0) {
      console.error('Dialog was already opened as modeless dialog');
      return;
    }
    if (DialogRenderer._currentDodal) {
      console.error('Only one modal dialog should be opened');
      return;
    }
    DialogRenderer._currentDodal = this;
    this.dispatchEvent('opened');
  }
  close() {
    const index = DialogRenderer._modeless.indexOf(this);
    if (index >= 0) {
      DialogRenderer._modeless.splice(index, 1);
    } else {
      if (DialogRenderer._currentDodal !== this) {
        throw new Error('Modal dialog is not shown');
      }
      DialogRenderer._currentDodal = null;
    }
    this.dispatchEvent('closed');
  }
  renderModeless() {
    ImGui.SetNextWindowSize(this._size, this._noResize ? ImGui.Cond.Always : ImGui.Cond.FirstUseEver);
    if (ImGui.Begin(this._id, null, this._noResize ? ImGui.WindowFlags.NoResize : undefined)) {
      ImGui.PushID(this._id);
      this.doRender();
      ImGui.PopID();
    }
    ImGui.End();
  }
  renderModal() {
    if (DialogRenderer._currentDodal !== this) {
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
