import type { Interpolator } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';
import { ModalDialog } from '../../components/modal';
import { CurveEditor } from '../../components/curveeditor';

export class DlgCurveEditor extends ModalDialog {
  private resolve: (val: Interpolator) => void;
  private editor: CurveEditor;
  constructor(
    id: string,
    open: boolean,
    width: number,
    height: number,
    resolve: (val: Interpolator) => void
  ) {
    super(id, open, width, height);
    this.resolve = resolve;
    this.editor = new CurveEditor();
  }

  public doRender(): void {
    this.editor.renderSettings();
    if (
      ImGui.BeginChild(
        `##${this.id}_CANVAS`,
        new ImGui.ImVec2(0, -ImGui.GetFrameHeightWithSpacing()),
        false,
        ImGui.WindowFlags.NoScrollbar | ImGui.WindowFlags.NoScrollWithMouse
      )
    ) {
      const canvasSize = ImGui.GetContentRegionAvail();
      this.editor.renderCurveView(canvasSize);
    }
    ImGui.EndChild();
    if (ImGui.Button('Ok')) {
      this.resolve(this.editor.interpolator);
      this.close();
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this.resolve(null);
      this.close();
    }
  }
}
