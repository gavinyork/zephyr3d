import type { Interpolator } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import { CurveEditor } from '../../components/curveeditor';

export class DlgCurveEditor extends DialogRenderer {
  private labels: string[];
  private channel: [number];
  private resolve: (val: Interpolator) => void;
  private editor: CurveEditor;
  constructor(
    id: string,
    width: number,
    height: number,
    interpolator: Interpolator,
    resolve: (val: Interpolator) => void
  ) {
    super(id, width, height);
    this.resolve = resolve;
    this.editor = new CurveEditor(interpolator);
    if (interpolator && interpolator.target !== 'number') {
      this.labels = ['x', 'y', 'z'];
      this.channel = [0];
    }
  }

  public doRender(): void {
    this.editor.renderSettings();
    if (
      ImGui.BeginChild(
        'Canvas',
        new ImGui.ImVec2(0, -ImGui.GetFrameHeightWithSpacing()),
        false,
        ImGui.WindowFlags.NoScrollbar | ImGui.WindowFlags.NoScrollWithMouse
      )
    ) {
      const canvasSize = ImGui.GetContentRegionAvail();
      this.editor.renderCurveView(canvasSize);
    }
    ImGui.EndChild();
    ImGui.Columns(2, 'ButtonLayout', false);
    if (ImGui.Button('Ok')) {
      this.resolve(this.editor.interpolator);
      this.close();
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this.resolve(null);
      this.close();
    }
    if (this.labels) {
      ImGui.SameLine();
      if (ImGui.Combo('Channel', this.channel, this.labels)) {
        this.editor.channel = this.channel[0];
      }
    }
    ImGui.NextColumn();
  }
}
