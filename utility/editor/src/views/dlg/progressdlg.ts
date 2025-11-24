import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';

export class DlgProgress extends DialogRenderer<void> {
  private _current: number;
  private _total: number;
  private _current2: number;
  private _total2: number;
  private _twoLevel: boolean;
  private _barSize: ImGui.ImVec2;
  constructor(id: string, width: number, twoLevel = false) {
    super(id, width, 0, false, true, true);
    this._current = 0;
    this._total = 1;
    this._current2 = 0;
    this._total2 = 1;
    this._twoLevel = twoLevel;
    this._barSize = new ImGui.ImVec2();
  }
  setProgress(current: number, total: number) {
    this._current = current;
    this._total = total;
  }
  setSubProgress(current: number, total: number) {
    this._current2 = current;
    this._total2 = total;
  }
  doRender(): void {
    this._barSize.x = ImGui.GetContentRegionAvail().x;
    this._barSize.y = 5;
    ImGui.Text(`Finished: ${this._current} of ${this._total}`);
    ImGui.ProgressBar(this._current / this._total, this._barSize, '');
    if (this._twoLevel) {
      ImGui.ProgressBar(this._current2 / this._total2, this._barSize, '');
    }
  }
}
