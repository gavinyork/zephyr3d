import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';

export class DlgProgress extends DialogRenderer<void> {
  private _progress: string;
  constructor(id: string) {
    super(id, 300);
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
