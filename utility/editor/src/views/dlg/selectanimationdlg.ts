import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import { renderEditableCombo } from '../../components/editablecombo';

export class DlgSelectAnimation extends DialogRenderer {
  private _animationNames: string[];
  private _selected: [string];
  private _trackName: [string];
  private _resolve: (result: { animationName: string; trackName: string }) => void;
  constructor(
    id: string,
    animations: string[],
    width: number,
    resolve: (result: { animationName: string; trackName: string }) => void
  ) {
    super(
      id,
      width,
      4 * ImGui.GetStyle().WindowPadding.y + 2 * ImGui.GetStyle().ItemSpacing.y + 4 * ImGui.GetFrameHeight(),
      true,
      true
    );
    this._animationNames = animations.slice();
    this._selected = [''];
    this._trackName = [''];
    this._resolve = resolve;
  }
  doRender(): void {
    if (ImGui.BeginChild('Panel', new ImGui.ImVec2(0, -ImGui.GetFrameHeightWithSpacing()), true)) {
      renderEditableCombo(
        'Select animation:',
        this._selected,
        this._animationNames,
        -1,
        false,
        'Enter the animation name or select one...'
      );
      ImGui.InputText('TrackName:', this._trackName);
    }
    ImGui.EndChild();
    if (ImGui.Button('Create')) {
      if (this._selected[0] && this._trackName[0]) {
        this._resolve({ animationName: this._selected[0], trackName: this._trackName[0] });
        this.close();
      }
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this._resolve(null);
      this.close();
    }
  }
}
