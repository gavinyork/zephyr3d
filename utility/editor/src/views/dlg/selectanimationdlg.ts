import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import { renderEditableCombo } from '../../components/editablecombo';

export class DlgSelectAnimation extends DialogRenderer<{ animationName: string; trackName: string }> {
  private readonly _animationNames: string[];
  private readonly _selected: [string];
  private readonly _trackName: [string];
  constructor(id: string, animations: string[], width: number) {
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
  }
  public static async selectAnimationAndTrack(
    title: string,
    animationNames: string[],
    width?: number
  ): Promise<{ animationName: string; trackName: string }> {
    return new DlgSelectAnimation(title, animationNames, width).showModal();
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
        this.close({ animationName: this._selected[0], trackName: this._trackName[0] });
      }
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this.close(null);
    }
  }
}
