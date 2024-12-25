import { ImGui } from '@zephyr3d/imgui';
import { ModalDialog } from '../../components/modal';

export class DlgProgress extends ModalDialog {
  private _progress: string;
  constructor(id: string, open: boolean) {
    super(id, open, 300);
    this._progress = '';
  }
  get progress() {
    return this._progress;
  }
  set progress(val) {
    this._progress = val;
  }
  doRender(): void {
    ImGui.Text(`Finished: ${this._progress}`);
  }
}
