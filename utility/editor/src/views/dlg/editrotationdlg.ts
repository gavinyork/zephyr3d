import { ImGui } from '@zephyr3d/imgui';
import { ModalDialog } from '../../components/modal';
import { RotationEditor } from '../../components/rotationeditor';
import type { Quaternion } from '@zephyr3d/base';

export class DlgRotationEditor extends ModalDialog {
  private editor: RotationEditor;
  constructor(
    id: string,
    open: boolean,
    width: number,
    height: number,
    rotation: Quaternion,
    callback: (val: Quaternion) => void
  ) {
    super(id, open, width, height, false);
    this.editor = new RotationEditor(rotation, callback);
  }

  public doRender(): void {
    if (
      ImGui.BeginChild(
        'Canvas',
        new ImGui.ImVec2(0, -ImGui.GetFrameHeightWithSpacing()),
        false,
        ImGui.WindowFlags.NoScrollbar | ImGui.WindowFlags.NoScrollWithMouse
      )
    ) {
      const canvasSize = ImGui.GetContentRegionAvail();
      this.editor.render(canvasSize);
    }
    ImGui.EndChild();
    if (ImGui.Button('Finish')) {
      this.editor.dispose();
      this.close();
    }
  }
}
