import { makeEventTarget } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';

export class DialogRenderer<T> extends makeEventTarget(Object)<{
  opened: [];
  closed: [];
}>() {
  private static _currentModal: DialogRenderer<any>[] = [];
  private static _modeless: DialogRenderer<any>[] = [];
  private _id: string;
  private _size: ImGui.ImVec2;
  private _mask: boolean;
  private _noResize: boolean;
  private _promise: Promise<T>;
  private _resolve: (value: T) => void;
  static render() {
    for (const dlg of this._modeless) {
      dlg.renderModeless();
    }
    if (this._currentModal.length > 0) {
      this._currentModal[0].renderModal();
    }
  }
  static close<T>(id: string, result: T) {
    let index = DialogRenderer.findModeless(id);
    if (index >= 0) {
      DialogRenderer._modeless[index].close(result);
    } else {
      index = DialogRenderer.findModal(id);
      if (index >= 0) {
        DialogRenderer._currentModal.splice(0, index);
        DialogRenderer._currentModal[0].close(result);
      }
    }
  }
  constructor(id: string, width = 0, height = 0, mask = true, noResize = false) {
    super();
    this._id = id;
    this._mask = mask;
    this._size = new ImGui.ImVec2(width, height);
    this._noResize = !!noResize;
    this._promise = null;
    this._resolve = null;
  }
  get mask() {
    return this._mask;
  }
  get promise() {
    return this._promise;
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
  static getModeless(index: number) {
    return this._modeless[index] ?? null;
  }
  static findModeless(id: string): number {
    return this._modeless.findIndex((dlg) => dlg._id === id);
  }
  static findModal(id: string): number {
    return this._currentModal.findIndex((dlg) => dlg._id === id);
  }
  show(): Promise<T> {
    if (DialogRenderer.findModal(this._id) >= 0) {
      throw new Error(`Dialog <${this._id}> is already opened as modal dialog`);
    }
    const existing = DialogRenderer.findModeless(this._id);
    if (existing >= 0) {
      if (DialogRenderer._modeless[existing] !== this) {
        throw new Error(`Dialog <${this._id}> is already opened`);
      }
      ImGui.SetWindowFocus(this._id);
      return this._promise;
    }
    DialogRenderer._modeless.push(this);
    this._promise = new Promise<T>((resolve) => {
      this._resolve = resolve;
    });
    this.dispatchEvent('opened');
    return this._promise;
  }
  showModal() {
    if (DialogRenderer.findModeless(this._id) >= 0) {
      throw new Error(`Dialog <${this._id}> is already opened as modeless dialog`);
    }
    if (DialogRenderer.findModal(this._id) >= 0) {
      throw new Error(`Dialog <${this._id}> is already opened as modal dialog`);
    }
    DialogRenderer._currentModal.unshift(this);
    this._promise = new Promise<T>((resolve) => {
      this._resolve = resolve;
    });
    this.dispatchEvent('opened');
    return this._promise;
  }
  close(result: T) {
    let index = DialogRenderer.findModeless(this._id);
    if (index >= 0) {
      const dlg = DialogRenderer._modeless[index];
      if (dlg !== this) {
        throw new Error(`Dialog <${this._id}> is not opened as modeless dialog`);
      }
      DialogRenderer._modeless.splice(index, 1);
      this._resolve(result);
      this._promise = null;
      this._resolve = null;
      this.dispatchEvent('closed');
    }
    index = DialogRenderer.findModal(this._id);
    if (index >= 0) {
      if (index !== 0) {
        throw new Error(`Dialog <${this._id}> is not the current modal dialog`);
      }
      DialogRenderer._currentModal.shift();
      this._resolve(result);
      this._promise = null;
      this._resolve = null;
      this.dispatchEvent('closed');
    }
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
